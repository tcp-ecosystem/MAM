/**
 * MAM Registry HTTP transport
 *
 * The `node:http` adapter that puts `RegistryServer`'s handlers on a socket.
 * The handler class deliberately knows nothing about HTTP; this file owns
 * everything the transport needs: routing, CORS, body limits, security
 * headers, error containment and graceful shutdown.
 *
 * ============================================================================
 * The wire-format mapping (read this before changing any handler)
 * ============================================================================
 *
 * `RegistryServer` speaks in `ApiResponse<T>`:
 *
 *     { success: boolean, data?: T, error?: string, meta?: { total, page, limit, offset } }
 *
 * `@mam/registry-client` does not. Its `doRequest` returns the *raw parsed
 * body* as `T`, and reads `parsed.error` off a non-2xx response. The two
 * therefore disagree. The client is a published surface whose shapes consumers
 * already depend on, so the disagreement is resolved here, at the adapter:
 *
 *   handler                       HTTP
 *   -----------------------------------------------------------------------
 *   success + data                200/201 with `data` as the whole body
 *   success + no data             204 No Content
 *   success + data + pagination   200 `{ data, total, page, limit }`
 *                                 <- `PaginatedResponse<T>`, which is what
 *                                    `listModules`/`searchModules` promise
 *   failure                       non-2xx `{ error: string }`
 *                                 <- `RegistryError` reads `body.error`
 *
 * Pagination deserves a note. The server works in `offset`; the client works
 * in 1-based `page` (`PaginatedResponse<T> { data, total, page, limit }`, and
 * `?page=` on the wire). So `?page` is converted to an offset before the
 * handler runs, and the response page is derived from the same normalised
 * limit/offset the handler was given. The two views cannot disagree, because
 * there is only one of them.
 *
 * Failure statuses are derived from the error *message*, because
 * `ApiResponse` carries no status. `classifyFailure` is the whole mapping, and
 * it is deliberately conservative: a message it does not recognise becomes a
 * 500 with a generic body, so an internal message — a filesystem path, a stack
 * frame — can never reach a client through the error channel.
 *
 * `openapi.yaml` in `@mam/registry-api` documents exactly this mapping.
 */

// ============================================================================
// Imports
// ============================================================================

import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

import type {
  ApiResponse,
  ArchiveOptions,
  HandlerRequest,
  ListModulesOptions,
  RegistryLogger,
  RegistryServerConfig,
  SearchOptions,
} from './server.js';
import type { RegistryServer } from './server.js';
import { buildGraphQL, loadRegistryGraphQL, type GraphQLSpec } from './graphql.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Loopback by default.
 *
 * A registry bound to every interface is a registry that published a module
 * endpoint nobody asked it to expose, so the safe interface is the default and
 * widening it is an explicit choice.
 */
export const DEFAULT_HOST = '127.0.0.1';

/**
 * Ceiling applied when `maxUploadSize` is disabled (zero or less).
 *
 * "Unlimited" is not a limit, and the body reader needs a number to compare
 * against: without one an unauthenticated POST buffers without bound.
 */
export const DEFAULT_MAX_BODY_BYTES = 10 * 1024 * 1024;

/** How long `close()` waits for in-flight requests before forcing sockets shut. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const HSTS_MAX_AGE_SECONDS = 15_552_000; // 180 days

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** The only message a client ever sees for a failure the server did not word. */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

// ============================================================================
// Types
// ============================================================================

/** Everything a route handler is given about one request. */
export interface RequestContext {
  readonly method: string;
  /** Path segments, each already percent-decoded. */
  readonly segments: string[];
  readonly query: URLSearchParams;
  /** Captured `:name`-style parameters. */
  readonly params: Record<string, string>;
  /** Parsed JSON body, or `undefined` when there was none. */
  readonly body: unknown;
  /** Bearer / ApiKey credential, if the caller sent one. */
  readonly token?: string;
  /** Client IP used for rate limiting. */
  readonly clientId: string;
  /** The full request URL. */
  readonly url: URL;
  /** True when the request arrived over TLS. */
  readonly secure: boolean;
}

/** A body sent verbatim rather than JSON-encoded. */
export interface RawBody {
  data: string | Buffer;
  contentType: string;
}

/** What a route handler returns. */
export interface RouteResult {
  status: number;
  /** JSON body. Omit for 204 / empty responses. */
  body?: unknown;
  /** Non-JSON body (YAML, SDL, a tarball). Takes precedence over `body`. */
  raw?: RawBody;
  /** Extra headers for this response only. */
  headers?: Record<string, string>;
}

export interface GraphQLOptions {
  /** Executable spec. When omitted the api package's schema is loaded lazily. */
  spec?: GraphQLSpec;
  /** Serve the SDL at `GET /graphql`. Defaults to true. */
  serveSdl?: boolean;
  /** `false` refuses `/graphql` with 501 without trying to load anything. */
  enabled?: boolean;
}

export interface RegistryHttpOptions {
  /** The handler layer to expose. */
  server: RegistryServer;
  /** Interface to bind. Defaults to 127.0.0.1. */
  host?: string;
  /** Port to bind. Defaults to the server config; 0 picks a free port. */
  port?: number;
  /** Where request failures are logged. Defaults to the server's logger. */
  logger?: RegistryLogger;
  /**
   * Honour `X-Forwarded-For` and `X-Forwarded-Proto`.
   *
   * Off by default: the header is attacker-controlled, so trusting it hands
   * every caller a fresh rate limit budget by sending a new value.
   */
  trustProxy?: boolean;
  /** Path of the OpenAPI document served at `GET /openapi.yaml`. */
  openapiPath?: string;
  /** GraphQL wiring. `false` disables the endpoint. */
  graphql?: GraphQLOptions | false;
  /** Hard deadline for `close()`. Defaults to 10s. */
  shutdownTimeoutMs?: number;
}

interface Route {
  method: string;
  /** Literal segments and `:param` placeholders. */
  pattern: string[];
  handler: (ctx: RequestContext) => Promise<RouteResult>;
  /** Status for a failed `ApiResponse`, when the default classification is wrong. */
  failureStatus?: number;
}

// ============================================================================
// Failure classification
// ============================================================================

/**
 * Turns an `ApiResponse` error message into a status.
 *
 * The message is the only signal `ApiResponse` carries, so it is matched
 * against the wording the handlers actually use. Anything unrecognised becomes
 * a 500, deliberately: a handler that failed in a way nobody anticipated is a
 * server fault, and echoing an unrecognised message is how an internal path
 * ends up in a response body.
 */
export function classifyFailure(message: string): number {
  const text = (message ?? '').toLowerCase();
  if (!text) return 500;

  if (text.includes('rate limit') || text.includes('too many failed attempts')) return 429;
  if (text.includes('account_locked')) return 429;
  // Auth is checked before validation: "Invalid or missing authentication
  // token" and "Invalid credentials" must not be reported as bad requests.
  if (text.includes('authentication token') || text.includes('invalid credentials')) return 401;
  if (text.startsWith('not authorized') || text.includes('forbidden')) return 403;
  if (text.includes('not found')) return 404;
  if (text.includes('already exists') || text.includes('already registered')) return 409;
  if (text.includes('method not allowed')) return 405;
  if (text.includes('maximum upload size')) return 413;
  if (text.includes('exceeds the maximum')) return 413;
  if (
    text.includes('required') ||
    text.includes('must be') ||
    text.includes('must contain') ||
    text.includes('invalid') ||
    text.includes('unsafe ') ||
    text.includes('exceeds')
  ) {
    return 400;
  }
  return 500;
}

/**
 * Whether a handler-authored error message is safe to hand back verbatim.
 *
 * A message carrying a stack frame, a newline or an absolute path is an
 * exception that reached the error channel by accident, not prose written for a
 * caller.
 */
export function isSafeErrorMessage(message: string): boolean {
  if (!message) return false;
  if (/[\r\n]/.test(message)) return false;
  // A V8 stack frame. Matching the whole frame rather than the function name is
  // the point: names contain characters a character class has to keep widening
  // (`Object.<anonymous>`), and every widening is a spelling that slips past.
  if (/^\s*at\s+\S/m.test(message)) return false;
  // Any `path:line:column` reference is an internal detail whatever precedes it.
  if (/[/\\][\w.@ -]+:\d+:\d+/.test(message)) return false;
  if (/[A-Za-z]:[\\/]/.test(message)) return false; // C:\... or C:/...
  if (/(^|[\s"'(])\/(?:home|root|usr|var|etc|tmp|private|Users|workspace)\//.test(message)) return false;
  if (/(?:node_modules|[/\\]dist)[/\\]/.test(message)) return false;
  return true;
}

// ============================================================================
// Body reading
// ============================================================================

type BodyResult = { ok: true; raw: string } | { ok: false; reason: 'too_large' };

/**
 * Reads the request body, refusing anything over `limit` bytes.
 *
 * The limit is enforced *while* reading, not after: an oversized body is
 * abandoned the moment it crosses the line, so a caller cannot make the process
 * hold an arbitrary amount of it in memory. `Content-Length` is checked first,
 * so the common case never reads a byte at all.
 */
export function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise<BodyResult>((resolve) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.pause();
      resolve({ ok: false, reason: 'too_large' });
      return;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
      resolve(result);
    };

    function onData(chunk: Buffer): void {
      total += chunk.length;
      if (total > limit) {
        // Stop accumulating at once. The rest of the request is never buffered,
        // so peak memory is bounded by `limit` however much the caller sends.
        chunks.length = 0;
        finish({ ok: false, reason: 'too_large' });
        return;
      }
      chunks.push(chunk);
    }
    function onEnd(): void {
      finish({ ok: true, raw: Buffer.concat(chunks).toString('utf-8') });
    }
    function onError(): void {
      finish({ ok: true, raw: '' });
    }
    function onAborted(): void {
      finish({ ok: true, raw: '' });
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}

// ============================================================================
// Route matching
// ============================================================================

function countParams(pattern: string[]): number {
  return pattern.filter((segment) => segment.startsWith(':')).length;
}

function matchPattern(pattern: string[], segments: string[]): Record<string, string> | null {
  if (pattern.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const part = pattern[i];
    if (part.startsWith(':')) {
      params[part.slice(1)] = segments[i];
    } else if (part !== segments[i]) {
      return null;
    }
  }
  return params;
}

type MatchResult =
  | { kind: 'ok'; route: Route; params: Record<string, string> }
  | { kind: 'method_not_allowed'; allow: string[] }
  | { kind: 'not_found' };

/**
 * Picks the route for a request.
 *
 * When two patterns match the same path — `/modules/search` and
 * `/modules/:name` both match `GET /modules/search` — the one with fewer
 * wildcards wins. Ordering by specificity is what stops `search` from being
 * read as a module name, and it needs no reserved-name list to keep in sync
 * and no ambiguity to resolve at the call site.
 */
export function matchRoute(routes: Route[], method: string, segments: string[]): MatchResult {
  const shapeMatches = routes.filter((route) => matchPattern(route.pattern, segments) !== null);
  if (shapeMatches.length === 0) return { kind: 'not_found' };

  const specific = [...shapeMatches].sort((a, b) => countParams(a.pattern) - countParams(b.pattern));
  // HEAD is GET without a body; answering it costs one line here.
  const wanted = method === 'HEAD' ? 'GET' : method;
  const hit = specific.find((route) => route.method === wanted);
  if (!hit) {
    const allow = new Set<string>(shapeMatches.map((route) => route.method));
    if (allow.has('GET')) allow.add('HEAD');
    allow.add('OPTIONS');
    return { kind: 'method_not_allowed', allow: [...allow].sort() };
  }
  return { kind: 'ok', route: hit, params: matchPattern(hit.pattern, segments)! };
}

/**
 * Splits a path into segments, percent-decoding each one.
 *
 * Decoding happens *after* splitting, which is the whole trick: the client
 * percent-encodes a scoped name as `%40mam%2Fthing`, so it arrives as a single
 * segment and only becomes `@mam/thing` here. Decoding first would split it
 * into three segments and no route would match.
 */
export function decodeSegments(pathname: string): string[] {
  const trimmed = pathname.replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') return [];
  return trimmed
    .slice(1)
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        // A malformed escape is left as-is; the route will not match and the
        // caller gets a 404 rather than a 500 from a URIError.
        return segment;
      }
    });
}

// ============================================================================
// Tarballs
// ============================================================================

/** One 512-byte tar record, plus the data it introduces. */
const TAR_BLOCK = 512;

/**
 * Builds a gzipped tar from a published file map.
 *
 * Written here rather than pulled in as a dependency because the shape needed
 * is small and completely specified: one ustar header and one data block per
 * file, then the two zero blocks that mark the end of the archive. The output
 * is a real `.tgz` — `tar -tzf` and every npm-compatible client read it — which
 * is the point: the URL `handleGetDownload` hands out resolves to bytes that
 * actually unpack, rather than to a path nothing ever wrote.
 *
 * PAX is used for long names because a ustar `prefix`/`name` split cannot
 * express every path, and a name silently truncated to 100 bytes would produce
 * an archive that unpacks the wrong files.
 */
export function buildTarballGz(
  files: Record<string, string>,
  options: { mtime?: number } = {}
): Buffer {
  const mtime = Math.max(0, Math.floor(options.mtime ?? 0));
  const chunks: Buffer[] = [];

  for (const path of Object.keys(files).sort()) {
    const content = Buffer.from(files[path] ?? '', 'utf-8');
    const ustar = ustarName(path);
    if (ustar) {
      chunks.push(ustarHeader(ustar.prefix, ustar.name, content.length, mtime));
    } else {
      // A PAX extended header carries the full path, and the ustar header that
      // follows only needs *some* name; readers take the real one from here.
      const pax = paxPathRecord(path);
      const paxName = 'PaxHeaders';
      chunks.push(ustarHeader('', paxName, pax.length, mtime, 'x'));
      chunks.push(pad512(pax));
      chunks.push(ustarHeader('', path.slice(0, 100), content.length, mtime, '0', true));
    }
    chunks.push(pad512(content));
  }

  // Two zero blocks terminate the archive. One is not enough: readers that see
  // a single zero block have to guess, and some report a truncated archive.
  chunks.push(Buffer.alloc(TAR_BLOCK * 2));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

function pad512(buffer: Buffer): Buffer {
  const remainder = buffer.length % TAR_BLOCK;
  if (remainder === 0) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(TAR_BLOCK - remainder)]);
}

interface UstarName {
  prefix: string;
  name: string;
}

/** Splits a path into ustar's `prefix`/`name` pair, or null when it cannot fit. */
function ustarName(path: string): UstarName | null {
  const bytes = Buffer.from(path, 'utf-8');
  if (bytes.length <= 100) return { prefix: '', name: path };
  // A `/` within the first 155 bytes gives a prefix short enough for the field.
  for (let i = Math.min(100, bytes.length - 1); i < 155 && i < bytes.length; i++) {
    if (bytes[i] !== 0x2f) continue; // '/'
    const prefix = bytes.subarray(0, i).toString('utf-8');
    const name = bytes.subarray(i + 1).toString('utf-8');
    if (Buffer.byteLength(name, 'utf-8') <= 100) return { prefix, name };
  }
  return null;
}

/** `len key=value\n`, the PAX record format. The length includes itself. */
function paxPathRecord(path: string): Buffer {
  const body = Buffer.from(` path=${path}\n`, 'utf-8');
  let total = body.length + 1;
  for (;;) {
    const candidate = Buffer.from(`${total}`, 'utf-8').length + body.length;
    if (candidate === total) break;
    total = candidate;
  }
  return Buffer.concat([Buffer.from(`${total}`, 'utf-8'), body]);
}

function octal(value: number, width: number): string {
  return value.toString(8).padStart(width - 1, '0');
}

function ustarHeader(
  prefix: string,
  name: string,
  size: number,
  mtime: number,
  typeflag = '0',
  sizeAlreadySet = false
): Buffer {
  const header = Buffer.alloc(TAR_BLOCK);
  const write = (text: string, offset: number, length: number): void => {
    header.write(text.slice(0, length - 1), offset, length - 1, 'utf-8');
  };

  write(name, 0, 100);
  write(octal(0o644, 8), 100, 8);
  write(octal(0, 8), 108, 8);
  write(octal(0, 8), 116, 8);
  // The size field is 12 bytes: 11 octal digits and a terminator, which caps a
  // single file at 8 GiB. A larger one is a hard error rather than a truncated
  // header that would make the archive unpack to the wrong content.
  if (!sizeAlreadySet && size > 0o77777777777) {
    throw new Error(`Published file is too large to archive: ${size} bytes`);
  }
  write(octal(size, 12), 124, 12);
  write(octal(mtime, 12), 136, 12);
  // Checksum is computed with the checksum field itself read as spaces.
  header.write('        ', 148, 8, 'utf-8');
  header.write(typeflag, 156, 1, 'utf-8');
  write('ustar', 257, 6);
  write('00', 263, 3);
  write('mam', 265, 32); // uname
  write('mam', 297, 32); // gname
  write(octal(0, 8), 329, 8);
  write(octal(0, 8), 337, 8);
  write(prefix, 345, 155);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'utf-8');
  return header;
}

// ============================================================================
// RegistryHttpServer
// ============================================================================

/**
 * An HTTP server in front of a {@link RegistryServer}.
 *
 * Owns the socket, the routing table and transport-level policy. It does not
 * own the registry's lifecycle: `RegistryServer.start()`/`stop()` stay with the
 * host, so one handler instance can sit behind several transports, or none.
 */
export class RegistryHttpServer {
  private readonly server: RegistryServer;
  private readonly settings: Readonly<RegistryServerConfig>;
  private readonly logger: RegistryLogger;
  private readonly host: string;
  private readonly configuredPort: number;
  private readonly trustProxy: boolean;
  private readonly openapiPath: string | undefined;
  private readonly graphqlOptions: GraphQLOptions;
  private readonly shutdownTimeoutMs: number;
  private readonly maxBodyBytes: number;

  private http: NodeHttpServer | null = null;
  private listening = false;
  private closePromise: Promise<void> | null = null;
  private inFlight = 0;
  private drained: (() => void) | null = null;

  private readonly routes: Route[];
  private graphQL: GraphQLSpec | null = null;
  private graphQLLoad: Promise<GraphQLSpec | null> | null = null;
  private openapiCache: { path: string; body: string } | null = null;

  constructor(options: RegistryHttpOptions) {
    this.server = options.server;
    this.settings = options.server.settings;
    this.logger = options.logger ?? this.settings.logger ?? consoleLogger;
    this.host = options.host ?? DEFAULT_HOST;
    this.configuredPort = options.port ?? this.settings.port;
    this.trustProxy = options.trustProxy === true;
    this.openapiPath = options.openapiPath;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    this.graphqlOptions = options.graphql === false
      ? { enabled: false }
      : { enabled: true, ...(options.graphql ?? {}) };

    const configured = this.settings.maxUploadSize;
    this.maxBodyBytes = configured > 0 ? configured : DEFAULT_MAX_BODY_BYTES;

    this.routes = this.buildRoutes();
    this.http = createNodeHttpServer((req, res) => {
      void this.dispatch(req, res);
    });
    this.http.keepAliveTimeout = 5_000;
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Binds the socket and starts serving.
   *
   * Returns the bound address, so a caller that asked for port 0 can find out
   * which port the OS handed it.
   */
  async listen(): Promise<{ host: string; port: number }> {
    if (!this.http) throw new Error('This server has been closed');
    if (this.listening) return this.address();

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.http!.once('error', onError);
      this.http!.listen(this.configuredPort, this.host, () => {
        this.http!.removeListener('error', onError);
        resolve();
      });
    });

    this.listening = true;
    const bound = this.address();
    this.logger.info(`MAM Registry HTTP listening on http://${bound.host}:${bound.port}`);
    return bound;
  }

  /** The bound address, or a zero port when not listening. */
  address(): { host: string; port: number } {
    const address = this.http?.address();
    if (!address || typeof address === 'string') {
      return { host: this.host, port: this.listening ? this.configuredPort : 0 };
    }
    return { host: address.address, port: (address as AddressInfo).port };
  }

  /** The bound port, or 0 when not listening. */
  get port(): number {
    return this.address().port;
  }

  /** True between a successful `listen()` and a completed `close()`. */
  get isListening(): boolean {
    return this.listening;
  }

  /**
   * Stops accepting connections, drains what is in flight, then closes.
   *
   * Idempotent, and safe on a server that was never started. A hard deadline
   * backs the drain: a client that opened a request and then went quiet would
   * otherwise hold the process open indefinitely, so when the deadline passes
   * the remaining sockets are destroyed whether or not their request finished.
   */
  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = this.runClose();
    }
    return this.closePromise;
  }

  private async runClose(): Promise<void> {
    const http = this.http;
    if (!http || !this.listening) return;

    const closed = new Promise<void>((resolve) => http.close(() => resolve()));

    // Keep-alive sockets with no request on them would otherwise never let
    // `close()` resolve, because Node waits for every connection to end.
    http.closeIdleConnections?.();

    if (this.inFlight > 0) {
      const drained = new Promise<void>((resolve) => {
        this.drained = resolve;
      });
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.shutdownTimeoutMs);
        timer.unref?.();
      });
      await Promise.race([drained, deadline]);
      if (timer) clearTimeout(timer);
      this.drained = null;
    }

    http.closeIdleConnections?.();
    http.closeAllConnections?.();
    await closed;
    this.listening = false;
  }

  // --------------------------------------------------------------------------
  // Dispatch
  // --------------------------------------------------------------------------

  private async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.inFlight++;
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      this.inFlight--;
      if (this.inFlight === 0 && this.drained) {
        const resolve = this.drained;
        this.drained = null;
        resolve();
      }
    };
    res.on('close', release);
    res.on('finish', release);

    const secure = this.isSecure(req);
    this.applySecurityHeaders(res, secure);

    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://placeholder.invalid');
    } catch {
      this.send(res, 400, { error: 'Malformed request target' });
      return;
    }
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      // CORS first. An origin the config does not grant is refused before any
      // handler runs, so a disallowed caller cannot make the registry work at
      // all — and every non-preflight response still carries the CORS headers
      // for an origin that *is* allowed, so a browser can read it.
      if (this.applyCorsHeaders(req, res)) return;

      const segments = decodeSegments(url.pathname);
      const match = matchRoute(this.routes, method, segments);
      if (match.kind === 'not_found') {
        this.send(res, 404, { error: `No route for ${method} ${url.pathname}` });
        return;
      }
      if (match.kind === 'method_not_allowed') {
        res.setHeader('Allow', match.allow.join(', '));
        this.send(res, 405, { error: `${method} is not allowed on ${url.pathname}` });
        return;
      }

      const { handled, body } = await this.readRequestBody(req, res);
      if (handled) return; // 413 / 400 already answered

      const ctx: RequestContext = {
        method,
        segments,
        query: url.searchParams,
        params: match.params,
        body,
        token: extractToken(req),
        clientId: this.clientIp(req),
        url,
        secure,
      };

      const result = await match.route.handler(ctx);
      this.respond(res, result);
    } catch (error) {
      // Nothing below this line may leak. The detail goes to the log; the
      // client gets a fixed string.
      this.logger.error(
        `Unhandled error serving ${method} ${url.pathname}`,
        error instanceof Error ? (error.stack ?? error.message) : error
      );
      if (!res.headersSent) this.send(res, 500, { error: INTERNAL_ERROR_MESSAGE });
      else res.end();
    }
  }

  /**
   * Answers a CORS preflight, or returns false to let the request continue.
   *
   * A preflight is a request carrying `Access-Control-Request-Method`. An
   * OPTIONS without one is an ordinary request for a method this server does
   * not implement, and is answered as a 405 rather than as a preflight.
   */
  private applyCorsHeaders(req: IncomingMessage, res: ServerResponse): boolean {
    const origin = req.headers.origin;
    if (!origin) return false;

    if (req.method === 'OPTIONS' && req.headers['access-control-request-method']) {
      const preflight = this.server.handlePreflight(
        origin,
        String(req.headers['access-control-request-method'])
      );
      for (const [key, value] of Object.entries(preflight.headers)) res.setHeader(key, value);
      if (preflight.status === 204) {
        res.statusCode = 204;
        res.end();
      } else {
        this.send(res, preflight.status, {
          error: preflight.status === 403 ? 'Origin not allowed' : 'Method not allowed in preflight',
        });
      }
      return true;
    }

    // A disallowed origin is refused outright rather than merely un-allowed:
    // otherwise the only thing stopping it is the browser, and a non-browser
    // caller would be served regardless.
    if (!this.server.isOriginAllowed(origin)) {
      this.send(res, 403, { error: 'Origin not allowed' });
      return true;
    }

    for (const [key, value] of Object.entries(this.server.getCorsHeaders(origin))) {
      res.setHeader(key, value);
    }
    return false;
  }

  private applySecurityHeaders(res: ServerResponse, secure: boolean): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // The API serves JSON, YAML, SDL and tarballs, never a document that
    // should load or execute anything, so the strictest policy that still
    // allows the downloads is also the correct one.
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; sandbox"
    );
    if (secure) {
      res.setHeader('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`);
    }
  }

  private isSecure(req: IncomingMessage): boolean {
    const socket = req.socket as { encrypted?: boolean };
    if (socket?.encrypted) return true;
    if (!this.trustProxy) return false;
    return this.forwardedProto(req) === 'https';
  }

  private forwardedProto(req: IncomingMessage): string {
    const header = req.headers['x-forwarded-proto'];
    const value = Array.isArray(header) ? header[0] : header;
    return typeof value === 'string' ? (value.split(',')[0]?.trim().toLowerCase() ?? '') : '';
  }

  /**
   * The client key used for rate limiting.
   *
   * The socket address, not the forwarded header: `X-Forwarded-For` is
   * attacker-controlled unless a trusted proxy sets it, and honouring it by
   * default would let a caller reset its budget by sending a new value. It is
   * read only when `trustProxy` is set, and then the left-most entry — the
   * original client as recorded by the first proxy.
   */
  private clientIp(req: IncomingMessage): string {
    const address = req.socket.remoteAddress ?? 'unknown';
    if (!this.trustProxy) return address;
    const header = req.headers['x-forwarded-for'];
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== 'string' || value.length === 0) return address;
    return value.split(',')[0]!.trim() || address;
  }

  /**
   * Reads and parses the body.
   *
   * The two outcomes are kept distinct on purpose. An earlier version returned
   * `undefined` both for "this request has no body" and for "I already answered
   * with 413/400", so the caller could not tell a bodyless GET from a rejected
   * request and returned without answering — every GET hung until it timed out.
   * `handled` says whether a response has been written.
   */
  private async readRequestBody(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<{ handled: boolean; body?: unknown }> {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return { handled: false };

    const result = await readBody(req, this.maxBodyBytes);
    if (!result.ok) {
      // The rest of the request is never read. `Connection: close` lets the 413
      // be delivered and stops the socket being reused with a half-read body
      // still on it.
      res.setHeader('Connection', 'close');
      this.send(res, 413, {
        error: `Request body exceeds the maximum size of ${this.maxBodyBytes} bytes`,
      });
      req.destroy();
      return { handled: true };
    }

    const raw = result.raw.trim();
    if (raw.length === 0) return { handled: false };
    try {
      return { handled: false, body: JSON.parse(raw) };
    } catch {
      this.send(res, 400, { error: 'Request body is not valid JSON' });
      return { handled: true };
    }
  }

  private respond(res: ServerResponse, result: RouteResult): void {
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
    }
    if (result.status === 204 || (result.body === undefined && !result.raw)) {
      res.statusCode = result.status;
      res.removeHeader('Content-Type');
      res.removeHeader('Content-Length');
      res.end();
      return;
    }
    if (result.raw) {
      const payload = Buffer.isBuffer(result.raw.data)
        ? result.raw.data
        : Buffer.from(result.raw.data, 'utf-8');
      res.statusCode = result.status;
      res.setHeader('Content-Type', result.raw.contentType);
      res.setHeader('Content-Length', String(payload.length));
      res.end(payload);
      return;
    }
    this.send(res, result.status, result.body);
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    if (res.headersSent) {
      res.end();
      return;
    }
    const payload = JSON.stringify(body ?? null);
    res.statusCode = status;
    res.setHeader('Content-Type', JSON_CONTENT_TYPE);
    res.setHeader('Content-Length', String(Buffer.byteLength(payload)));
    res.end(payload);
  }

  // --------------------------------------------------------------------------
  // ApiResponse -> wire
  // --------------------------------------------------------------------------

  /**
   * The one place the internal response envelope becomes an HTTP response.
   *
   * See the file header for the full mapping. `paginated` is supplied by the
   * caller, which knows the query it was asked, so the `PaginatedResponse` the
   * client types is the one the client gets.
   */
  private toWire(
    response: ApiResponse,
    options: {
      successStatus?: number;
      paginated?: { page: number; limit: number };
      failureStatus?: number;
    } = {}
  ): RouteResult {
    if (response.success) {
      const paginated = options.paginated;
      if (paginated) {
        const rows = Array.isArray(response.data) ? response.data : [];
        return {
          status: options.successStatus ?? 200,
          body: {
            data: rows,
            total: response.meta?.total ?? rows.length,
            page: paginated.page,
            limit: paginated.limit,
          },
        };
      }
      if (response.data === undefined) {
        return { status: options.successStatus ?? 204 };
      }
      return { status: options.successStatus ?? 200, body: response.data };
    }

    const message = response.error ?? '';
    // A route that passes `failureStatus` has deliberately chosen that status,
    // which is what makes a 501 different from a 500: 501 is a considered
    // "this registry does not do that", and its message is written for the
    // client. Treating every 5xx as internal turned a clear "token refresh is
    // not supported" into "Internal server error".
    const deliberate = options.failureStatus !== undefined;
    const status = options.failureStatus ?? classifyFailure(message);
    const mustHide = status === 500 || !isSafeErrorMessage(message) || (status >= 500 && !deliberate);
    if (mustHide) {
      this.logger.error(`Request failed with status ${status} and an internal message: ${message}`);
      return { status: 500, body: { error: INTERNAL_ERROR_MESSAGE } };
    }
    return { status, body: { error: message } };
  }

  /**
   * Surfaces the rate limit the handler layer applied.
   *
   * `checkRateLimit` is internal to `RegistryServer` and reports only a
   * message, so the budget is read from config and the outcome from the
   * message. That is enough for a client to back off correctly, which is what
   * the headers are for.
   */
  private applyRateLimitHeaders(_ctx: RequestContext, result: RouteResult): RouteResult {
    const limit = this.settings.rateLimit;
    if (!Number.isFinite(limit) || limit <= 0) return result;
    const windowSeconds = Math.max(1, Math.round((this.settings.rateLimitWindowMs ?? 60_000) / 1000));

    const message = (result.body as { error?: string } | undefined)?.error ?? '';
    const limited = result.status === 429 || /rate limit/i.test(message);

    return {
      ...result,
      headers: {
        ...(result.headers ?? {}),
        'RateLimit-Limit': String(limit),
        'RateLimit-Policy': `${limit};w=${windowSeconds}`,
        'RateLimit-Remaining': limited ? '0' : String(Math.max(0, limit - 1)),
        ...(limited
          ? {
              'RateLimit-Reset': String(windowSeconds),
              // The handler's own message carries the exact remaining seconds;
              // the window is only a fallback for a 429 that came from
              // somewhere else.
              'Retry-After': /retry in (\d+)s/i.exec(message)?.[1] ?? String(windowSeconds),
            }
          : {}),
      },
    };
  }

  // --------------------------------------------------------------------------
  // Query helpers
  // --------------------------------------------------------------------------

  /** `?limit=` clamped the way the search layer clamps it. */
  private readLimit(query: URLSearchParams, fallback = 20): number {
    const raw = query.get('limit');
    if (raw === null) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(Math.floor(parsed), 100));
  }

  /**
   * 1-based `?page=` to an offset.
   *
   * Page 1 is the first page, which is what the client's `PaginatedResponse`
   * and its query builder both assume.
   */
  private readPage(query: URLSearchParams, limit: number): { page: number; offset: number } {
    const raw = query.get('page');
    const parsed = raw === null ? Number.NaN : Number(raw);
    if (!Number.isFinite(parsed) || parsed < 1) return { page: 1, offset: 0 };
    const page = Math.floor(parsed);
    return { page, offset: (page - 1) * limit };
  }

  private handlerRequest(ctx: RequestContext): HandlerRequest {
    return ctx.token ? { token: ctx.token, clientId: ctx.clientId } : { clientId: ctx.clientId };
  }

  private boolParam(query: URLSearchParams, name: string): boolean | undefined {
    const raw = query.get(name);
    if (raw === null) return undefined;
    return raw === '1' || raw.toLowerCase() === 'true';
  }

  private sortParam(query: URLSearchParams): 'relevance' | 'downloads' | 'updated' | 'name' | undefined {
    const raw = query.get('sort');
    return raw === 'relevance' || raw === 'downloads' || raw === 'updated' || raw === 'name' ? raw : undefined;
  }

  private tagsParam(query: URLSearchParams): string[] {
    return query
      .getAll('tag')
      .concat(query.getAll('tags'))
      .flatMap((tag) => tag.split(','))
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  private body(ctx: RequestContext): Record<string, unknown> {
    return ctx.body && typeof ctx.body === 'object' && !Array.isArray(ctx.body)
      ? (ctx.body as Record<string, unknown>)
      : {};
  }

  // --------------------------------------------------------------------------
  // Routes
  // --------------------------------------------------------------------------

  private buildRoutes(): Route[] {
    const request = (ctx: RequestContext): HandlerRequest => this.handlerRequest(ctx);

    return [
      // --- health and specs -------------------------------------------------
      {
        method: 'GET',
        pattern: ['healthz'],
        handler: async () => ({
          status: 200,
          body: { status: 'ok', uptime: Math.round(process.uptime() * 1000) / 1000 },
        }),
      },
      { method: 'GET', pattern: ['openapi.yaml'], handler: () => this.serveOpenAPI() },
      { method: 'GET', pattern: ['graphql'], handler: (ctx) => this.serveGraphQLGet(ctx) },
      { method: 'POST', pattern: ['graphql'], handler: (ctx) => this.serveGraphQLPost(ctx) },

      // --- modules ----------------------------------------------------------
      {
        method: 'GET',
        pattern: ['modules'],
        handler: async (ctx) => {
          const limit = this.readLimit(ctx.query);
          const { page, offset } = this.readPage(ctx.query, limit);
          const options: ListModulesOptions = {
            ...request(ctx),
            tags: this.tagsParam(ctx.query),
            author: ctx.query.get('author') ?? undefined,
            query: ctx.query.get('q') ?? ctx.query.get('query') ?? undefined,
            sort: this.sortParam(ctx.query),
            limit,
            offset,
            includeArchived: this.boolParam(ctx.query, 'includeArchived'),
          };
          const response = await this.server.handleListModules(options);
          return this.applyRateLimitHeaders(ctx, this.toWire(response, { paginated: { page, limit } }));
        },
      },
      {
        method: 'POST',
        pattern: ['modules'],
        handler: async (ctx) => {
          const payload = this.body(ctx);
          const files = new Map<string, string>();
          if (payload.files && typeof payload.files === 'object') {
            for (const [path, content] of Object.entries(payload.files as Record<string, unknown>)) {
              files.set(path, typeof content === 'string' ? content : String(content ?? ''));
            }
          }
          // The client sends one flat object, not `{manifest, files}`, so the
          // file map is split back out before the manifest reaches the store.
          const { files: _files, ...manifest } = payload;
          const response = await this.server.handlePublish(manifest, files, ctx.token ?? '');
          return this.applyRateLimitHeaders(ctx, this.toWire(response, { successStatus: 201 }));
        },
      },
      // Static beats parameter, so `/modules/search` is never read as a module
      // named "search". See `matchRoute`.
      {
        method: 'GET',
        pattern: ['modules', 'search'],
        handler: async (ctx) => {
          const limit = this.readLimit(ctx.query);
          const { page, offset } = this.readPage(ctx.query, limit);
          const options: SearchOptions = {
            ...request(ctx),
            limit,
            offset,
            sort: this.sortParam(ctx.query),
            tags: this.tagsParam(ctx.query),
            author: ctx.query.get('author') ?? undefined,
            includeArchived: this.boolParam(ctx.query, 'includeArchived'),
          };
          const response = await this.server.handleSearch(ctx.query.get('q') ?? '', options);
          return this.applyRateLimitHeaders(ctx, this.toWire(response, { paginated: { page, limit } }));
        },
      },
      {
        method: 'GET',
        pattern: ['modules', ':name'],
        handler: async (ctx) =>
          this.toWire(await this.server.handleGetModule(ctx.params.name, request(ctx))),
      },
      {
        method: 'DELETE',
        pattern: ['modules', ':name'],
        handler: async (ctx) =>
          this.toWire(await this.server.handleDeleteModule(ctx.params.name, ctx.token ?? '')),
      },
      {
        method: 'GET',
        pattern: ['modules', ':name', 'versions'],
        handler: async (ctx) =>
          this.toWire(await this.server.handleGetVersions(ctx.params.name, request(ctx))),
      },
      {
        method: 'GET',
        pattern: ['modules', ':name', 'versions', ':version'],
        handler: async (ctx) =>
          this.toWire(
            await this.server.handleGetVersion(ctx.params.name, ctx.params.version, request(ctx))
          ),
      },
      {
        method: 'GET',
        pattern: ['modules', ':name', 'dependencies'],
        handler: async (ctx) =>
          this.toWire(await this.server.handleGetDependencies(ctx.params.name, request(ctx))),
      },
      {
        method: 'GET',
        pattern: ['modules', ':name', 'download'],
        handler: async (ctx) =>
          this.toWire(
            await this.server.handleGetDownload(
              ctx.params.name,
              ctx.query.get('version') ?? undefined,
              request(ctx)
            )
          ),
      },
      {
        method: 'GET',
        pattern: ['modules', ':name', 'stats'],
        handler: async (ctx) =>
          this.toWire(await this.server.handleModuleStats(ctx.params.name, request(ctx))),
      },
      {
        method: 'PUT',
        pattern: ['modules', ':name', 'archive'],
        handler: async (ctx) => {
          const options: ArchiveOptions = {
            ...request(ctx),
            archived:
              typeof this.body(ctx).archived === 'boolean'
                ? (this.body(ctx).archived as boolean)
                : (this.boolParam(ctx.query, 'archived') ?? true),
          };
          return this.toWire(await this.server.handleArchive(ctx.params.name, options));
        },
      },

      // --- registry-level stats --------------------------------------------
      {
        method: 'GET',
        pattern: ['stats'],
        handler: async (ctx) => this.toWire(await this.server.handleStats(request(ctx))),
      },

      // --- auth -------------------------------------------------------------
      {
        method: 'POST',
        pattern: ['auth', 'login'],
        handler: async (ctx) => {
          const payload = this.body(ctx);
          const response = await this.server.handleLogin(
            String(payload.username ?? ''),
            String(payload.password ?? ''),
            { clientId: ctx.clientId }
          );
          return this.applyRateLimitHeaders(ctx, this.toWire(response));
        },
      },
      {
        method: 'POST',
        pattern: ['auth', 'register'],
        handler: async (ctx) => {
          const payload = this.body(ctx);
          const response = await this.server.handleRegister(
            String(payload.username ?? ''),
            String(payload.email ?? ''),
            String(payload.password ?? ''),
            { clientId: ctx.clientId }
          );
          return this.applyRateLimitHeaders(ctx, this.toWire(response, { successStatus: 201 }));
        },
      },
      {
        method: 'POST',
        pattern: ['auth', 'logout'],
        handler: async (ctx) => {
          const response = await this.server.handleLogout(ctx.token ?? '');
          if (!response.success) return this.toWire(response);
          return { status: 204 };
        },
      },
      {
        method: 'GET',
        pattern: ['auth', 'profile'],
        handler: async (ctx) => this.toWire(await this.server.handleProfile(ctx.token ?? '')),
      },
      {
        method: 'POST',
        pattern: ['auth', 'password'],
        handler: async (ctx) => {
          const payload = this.body(ctx);
          const response = await this.server.handleChangePassword(
            ctx.token ?? '',
            String(payload.oldPassword ?? ''),
            String(payload.newPassword ?? '')
          );
          return response.success ? { status: 204 } : this.toWire(response);
        },
      },
      {
        method: 'POST',
        pattern: ['auth', 'refresh'],
        handler: async (ctx) => {
          const response = await this.server.handleRefresh(String(this.body(ctx).refreshToken ?? ''));
          // This registry issues opaque session tokens and no refresh tokens,
          // so there is nothing to exchange. 501 says "not implemented" rather
          // than 401, which would send a client hunting a credential problem it
          // does not have.
          return this.toWire(response, { failureStatus: 501 });
        },
      },

      // --- tarballs ---------------------------------------------------------
      // The URL `handleGetDownload` hands out points here, so it resolves to
      // bytes that actually unpack.
      { method: 'GET', pattern: ['tarballs', ':name', ':version'], handler: (ctx) => this.serveTarball(ctx) },
    ];
  }

  // --------------------------------------------------------------------------
  // Route implementations needing more than a handler call
  // --------------------------------------------------------------------------

  private async serveOpenAPI(): Promise<RouteResult> {
    const path = await this.resolveOpenApiPath();
    if (!path) {
      return {
        status: 501,
        body: {
          error:
            'The OpenAPI document is unavailable; install @mam/registry-api or pass openapiPath to the HTTP server',
        },
      };
    }
    if (this.openapiCache?.path === path) {
      return { status: 200, raw: { data: this.openapiCache.body, contentType: 'application/yaml; charset=utf-8' } };
    }
    const body = await readFile(path, 'utf-8');
    this.openapiCache = { path, body };
    return { status: 200, raw: { data: body, contentType: 'application/yaml; charset=utf-8' } };
  }

  private async resolveOpenApiPath(): Promise<string | null> {
    if (this.openapiPath) return this.openapiPath;
    try {
      return createRequire(import.meta.url).resolve('@mam/registry-api/openapi.yaml');
    } catch {
      return null;
    }
  }

  private async serveGraphQLGet(ctx: RequestContext): Promise<RouteResult> {
    if (this.graphqlOptions.enabled === false) {
      return { status: 501, body: { error: 'GraphQL is disabled on this server' } };
    }
    const query = ctx.query.get('query');
    if (query) return this.executeGraphQL(query, ctx);

    const spec = await this.loadGraphQL();
    if (!spec) return { status: 501, body: { error: 'GraphQL is not available on this server' } };
    if (this.graphqlOptions.serveSdl === false) {
      return { status: 405, body: { error: 'Send a GraphQL operation as POST /graphql' } };
    }
    return { status: 200, raw: { data: spec.sdl, contentType: 'text/plain; charset=utf-8' } };
  }

  private async serveGraphQLPost(ctx: RequestContext): Promise<RouteResult> {
    if (this.graphqlOptions.enabled === false) {
      return { status: 501, body: { error: 'GraphQL is disabled on this server' } };
    }
    const payload = this.body(ctx) as {
      query?: unknown;
      variables?: unknown;
      operationName?: unknown;
    };
    if (typeof payload.query !== 'string' || payload.query.length === 0) {
      return { status: 400, body: { error: 'A GraphQL request needs a "query" string' } };
    }
    return this.executeGraphQL(
      payload.query,
      ctx,
      payload.variables as Record<string, unknown> | undefined,
      typeof payload.operationName === 'string' ? payload.operationName : undefined
    );
  }

  private async executeGraphQL(
    query: string,
    ctx: RequestContext,
    variables?: Record<string, unknown>,
    operationName?: string
  ): Promise<RouteResult> {
    const spec = await this.loadGraphQL();
    if (!spec) return { status: 501, body: { error: 'GraphQL is not available on this server' } };

    const result = await spec.execute({
      query,
      ...(variables ? { variables } : {}),
      ...(operationName ? { operationName } : {}),
      contextValue: spec.createContext({
        // The shared store is what makes GraphQL and REST agree; the identity
        // travels with it so a resolver can apply the same checks the REST
        // handlers do.
        store: this.server.moduleStore,
        token: ctx.token,
        clientId: ctx.clientId,
      }),
    });
    // GraphQL reports its own failures inside the body, which is what the spec
    // says a client should expect; a request that could not be executed at all
    // is a 400 and never reaches here.
    return { status: 200, body: result };
  }

  private loadGraphQL(): Promise<GraphQLSpec | null> {
    if (this.graphQL) return Promise.resolve(this.graphQL);
    if (!this.graphQLLoad) {
      this.graphQLLoad = (async () => {
        try {
          const source = this.graphqlOptions.spec
            ? { sdl: this.graphqlOptions.spec.sdl, resolvers: {}, createContext: undefined }
            : await loadRegistryGraphQL();
          this.graphQL = this.graphqlOptions.spec ?? buildGraphQL(source, this.server);
          return this.graphQL;
        } catch (error) {
          // One missing optional dependency must not take the whole registry
          // down: /graphql answers 501 and every other route keeps working.
          this.logger.error(
            'GraphQL could not be loaded; /graphql will answer 501',
            error instanceof Error ? (error.stack ?? error.message) : error
          );
          return null;
        }
      })();
    }
    return this.graphQLLoad;
  }

  /**
   * Serves the published files as a real gzipped tar.
   *
   * The content is exactly the version's `files` map as the store recorded it,
   * and the digest in `X-Checksum-Sha256` is the same `sha256-…` the store
   * published as `integrity`, so a client can verify what it unpacked.
   */
  private async serveTarball(ctx: RequestContext): Promise<RouteResult> {
    const version = ctx.params.version.replace(/\.t?gz$/i, '');
    const record = await this.server.handleGetVersion(ctx.params.name, version, this.handlerRequest(ctx));
    if (!record.success || !record.data) {
      return this.toWire(record, { failureStatus: 404 });
    }
    const data = record.data as { files?: Record<string, string>; integrity?: string; publishedAt?: string };
    const archive = buildTarballGz(data.files ?? {}, { mtime: Date.parse(data.publishedAt ?? '') || 0 });
    return {
      status: 200,
      raw: { data: archive, contentType: 'application/gzip' },
      headers: {
        'Content-Disposition': `attachment; filename="${sanitizeFilename(ctx.params.name, version)}.tgz"`,
        'X-Checksum-Sha256': data.integrity ?? '',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^(?:Bearer|ApiKey|Token)\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

function sanitizeFilename(name: string, version: string): string {
  const safe = `${name}-${version}`.replace(/[^A-Za-z0-9._-]/g, '-');
  return safe.slice(0, 100) || 'module';
}

const consoleLogger: RegistryLogger = {
  info: (message, ...details) => console.log(message, ...details),
  error: (message, ...details) => console.error(message, ...details),
};

/** Convenience: build a server, bind it, and hand back the address. */
export async function createRegistryHttpServer(
  options: RegistryHttpOptions
): Promise<{ http: RegistryHttpServer; host: string; port: number; close: () => Promise<void> }> {
  const http = new RegistryHttpServer(options);
  const { host, port } = await http.listen();
  return { http, host, port, close: () => http.close() };
}
