/**
 * retrieval.ts
 *
 * Wire codec for the MCP protocol layer.
 *
 * MCP frames travel as newline- or content-delimited JSON-RPC 2.0 messages.
 * The {@link ProtocolCodec} is the single place where in-memory protocol
 * messages become text (`encode*` / `serialize`) and where untrusted text
 * becomes validated, discriminated {@link ProtocolMessage} values (`decode`).
 *
 * Decoding is lossless and strict: every frame is parsed, classified against
 * the four JSON-RPC shapes, and reduced into the same discriminated union used
 * by the store and index layers. Malformed input never silently becomes a
 * message: it raises a {@link McpProtocolError} carrying a standard JSON-RPC
 * error code (`-32700` parse error, `-32600` invalid request).
 *
 * The module also exports {@link MCP_METHODS}, the canonical catalog of MCP
 * method names, so servers and clients agree on one spelling for each
 * operation.
 *
 * @module protocol/retrieval
 */

import {
  ErrorCodes,
  McpProtocolError,
  createErrorMessage,
  createNotificationMessage,
  createRequestMessage,
  createResponseMessage,
  isJsonRpcError,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  normalizeRequestId,
  type JsonRpcError,
  type JsonRpcErrorResponse,
  type MessageType,
  type ProtocolMessage,
  type RequestId,
} from './types.js';

/**
 * Canonical MCP method names.
 *
 * This catalog is the single source of spelling truth for the protocol layer:
 * feature code (servers, clients, proxies, mocks) should reference these
 * constants instead of inline strings so that typo'd methods are caught at
 * compile time and log output stays consistent.
 */
export const MCP_METHODS = {
  /** Client -> server handshake; negotiates version and capabilities. */
  initialize: 'initialize',
  /** Client -> server notification that initialization is complete. */
  initialized: 'initialized',
  /** Alias spelling of `notifications/initialized` (see below). */
  notificationsInitialized: 'notifications/initialized',
  /** Server -> client notification that the tool list changed. */
  toolsListChanged: 'notifications/tools/list_changed',
  /** List available tools. */
  toolsList: 'tools/list',
  /** Invoke a tool. */
  toolsCall: 'tools/call',
  /** Legacy alias of `tools/list` used by older MCP revisions. */
  toolsListTools: 'tools/list-tools',
  /** Server -> client notification that the resource list changed. */
  resourcesListChanged: 'notifications/resources/list_changed',
  /** Subscribe to resource change notifications. */
  resourcesSubscribe: 'resources/subscribe',
  /** Unsubscribe from resource change notifications. */
  resourcesUnsubscribe: 'resources/unsubscribe',
  /** List available resources. */
  resourcesList: 'resources/list',
  /** Read a resource's contents. */
  resourcesRead: 'resources/read',
  /** List resource URI templates. */
  resourcesTemplatesList: 'resources/templates/list',
  /** Server -> client notification that the prompt list changed. */
  promptsListChanged: 'notifications/prompts/list_changed',
  /** List available prompt templates. */
  promptsList: 'prompts/list',
  /** Render a prompt template. */
  promptsGet: 'prompts/get',
  /** Liveness probe; must be answered with an empty result. */
  ping: 'ping',
  /** Set the server's minimum logging level. */
  loggingSetLevel: 'logging/setLevel',
  /** Server -> client structured log message. */
  loggingMessage: 'notifications/message',
  /** Request argument completion for prompts/resources. */
  completionComplete: 'completion/complete',
} as const;

/**
 * The union of every known MCP method name, derived from {@link MCP_METHODS}.
 */
export type McpMethodName = (typeof MCP_METHODS)[keyof typeof MCP_METHODS];

/**
 * All known MCP method names as a flat, ordered array (deduplicated). Useful
 * for documentation, allow-lists and test fixtures.
 */
export const MCP_METHOD_LIST: readonly string[] = [...new Set<string>(Object.values(MCP_METHODS))];

/**
 * Check whether a method string is a known MCP method name.
 *
 * @param method - the method string to inspect.
 * @returns `true` when the method appears in {@link MCP_METHODS}.
 */
export function isMcpMethod(method: string): method is McpMethodName {
  return (MCP_METHOD_LIST as readonly string[]).indexOf(method) !== -1;
}

/**
 * A decoded frame together with its classification. `decode` returns this
 * richer object so callers can inspect both the message and, when decoding
 * failed, the precise reason.
 */
export interface DecodedFrame {
  /** Whether decoding produced a valid message. */
  readonly ok: boolean;
  /** The normalized message when `ok` is `true`. */
  readonly message?: ProtocolMessage;
  /** The classification label when `ok` is `true`. */
  readonly type?: MessageType;
  /** The error when `ok` is `false`. */
  readonly error?: McpProtocolError;
}

/**
 * Options controlling {@link ProtocolCodec.decode} behaviour.
 */
export interface DecodeOptions {
  /**
   * When `true`, a frame that matches no protocol shape produces a
   * `DecodedFrame` with `ok: false` instead of throwing. The error is still
   * reported on the frame. Defaults to `false` (decode throws).
   */
  readonly lenient?: boolean;
  /**
   * When `true`, frames missing the `jsonrpc: "2.0"` marker are still
   * accepted. Useful when interoperating with minimal third-party peers.
   * Defaults to `false` (strict).
   */
  readonly tolerateMissingVersion?: boolean;
}

/**
 * Serialize a normalized {@link ProtocolMessage} to its JSON-RPC text frame.
 *
 * @param message - the normalized message.
 * @returns the serialized JSON text (unwrapped: just the inner JSON-RPC object).
 * @throws {@link McpProtocolError} when the message cannot be serialized.
 */
export function serializeMessage(message: ProtocolMessage): string {
  try {
    switch (message.type) {
      case 'request':
        return JSON.stringify(message.request);
      case 'response':
        return JSON.stringify(message.response);
      case 'error':
        return JSON.stringify(message.error);
      case 'notification':
        return JSON.stringify(message.notification);
    }
  } catch (err) {
    throw new McpProtocolError(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to serialize protocol message',
      { type: message.type },
      { cause: err },
    );
  }
}

/**
 * Wire codec: encodes and decodes MCP JSON-RPC frames.
 *
 * Instances are cheap and keep their own monotonically increasing request-id
 * generator (see {@link ProtocolCodec.newRequestId}), so each transport /
 * connection normally owns one codec.
 */
export class ProtocolCodec {
  /** Monotonic request-id counter (numbers only). */
  private _nextId: number;

  /**
   * Create a codec.
   *
   * @param startId - the first request id to hand out (default `0`).
   */
  constructor(startId = 0) {
    if (!Number.isInteger(startId) || startId < 0) {
      throw new TypeError(`ProtocolCodec: startId must be a non-negative integer, got ${String(startId)}`);
    }
    this._nextId = startId;
  }

  /**
   * Produce the next monotonic request id. Guaranteed to strictly increase for
   * the lifetime of the codec, so ids never collide within one connection.
   *
   * @returns the next numeric id.
   */
  newRequestId(): number {
    this._nextId += 1;
    return this._nextId;
  }

  /**
   * Current value of the id counter (the last id handed out).
   *
   * @returns the last allocated id.
   */
  currentRequestId(): number {
    return this._nextId;
  }

  /**
   * Encode a request into its JSON-RPC text frame.
   *
   * @param id - the request id (use {@link ProtocolCodec.newRequestId} to
   *   generate one).
   * @param method - the method to invoke.
   * @param params - optional structured parameters.
   * @returns the serialized frame text.
   */
  encodeRequest(id: RequestId, method: string, params?: unknown): string {
    return serializeMessage(createRequestMessage(id, method, params));
  }

  /**
   * Convenience: allocate an id and encode a request in one step.
   *
   * @param method - the method to invoke.
   * @param params - optional structured parameters.
   * @returns a tuple of the allocated id and the serialized frame text.
   */
  encodeNewRequest(method: string, params?: unknown): { id: RequestId; text: string } {
    const id = this.newRequestId();
    return { id, text: this.encodeRequest(id, method, params) };
  }

  /**
   * Encode a success response into its JSON-RPC text frame.
   *
   * @param id - the id of the request being answered.
   * @param result - the successful result payload.
   * @returns the serialized frame text.
   */
  encodeResponse(id: RequestId, result?: unknown): string {
    return serializeMessage(createResponseMessage(id, result));
  }

  /**
   * Encode an error response into its JSON-RPC text frame.
   *
   * @param id - the id of the failed request, or `null` when unknown.
   * @param code - the numeric JSON-RPC/MCP error code.
   * @param message - a short human-readable description.
   * @param data - optional structured detail.
   * @returns the serialized frame text.
   */
  encodeError(id: RequestId | null, code: number, message: string, data?: unknown): string {
    return serializeMessage(createErrorMessage(id, code, message, data));
  }

  /**
   * Encode a notification into its JSON-RPC text frame.
   *
   * @param method - the method to notify about.
   * @param params - optional structured parameters.
   * @returns the serialized frame text.
   */
  encodeNotification(method: string, params?: unknown): string {
    return serializeMessage(createNotificationMessage(method, params));
  }

  /**
   * Serialize a normalized message to its JSON-RPC text frame. Identical to the
   * module-level {@link serializeMessage} but exposed on the instance for
   * symmetry with the encode helpers.
   *
   * @param message - the normalized message.
   * @returns the serialized frame text.
   */
  serialize(message: ProtocolMessage): string {
    return serializeMessage(message);
  }

  /**
   * Parse and validate a single JSON-RPC frame from text, returning a
   * normalized {@link ProtocolMessage}.
   *
   * Classification order matters: a frame with `method` + `id` is a request; a
   * frame with `method` and no `id` is a notification; a frame with `result`
   * is a response; a frame with `error` is an error response.
   *
   * @param text - the raw frame text (must contain exactly one JSON value).
   * @param options - optional decoding controls.
   * @returns the normalized message.
   * @throws {@link McpProtocolError} (`-32700`/`-32600`) on malformed input,
   *   unless `options.lenient` is set (see {@link ProtocolCodec.tryDecode}).
   */
  decode(text: string, options: DecodeOptions = {}): ProtocolMessage {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw McpProtocolError.parseError({
        reason: 'frame is not valid JSON',
        snippet: text.length > 160 ? `${text.slice(0, 160)}...` : text,
      });
    }

    const message = this._classify(parsed, options);
    if (message === undefined) {
      throw McpProtocolError.invalidRequest({
        reason: 'frame matches no JSON-RPC shape (request, response, error or notification)',
        frame: parsed,
      });
    }
    return message;
  }

  /**
   * Lenient variant of {@link ProtocolCodec.decode}: never throws. Returns a
   * {@link DecodedFrame} that either carries the parsed message or a
   * {@link McpProtocolError} describing the failure.
   *
   * @param text - the raw frame text.
   * @returns a decoded-frame result.
   */
  tryDecode(text: string): DecodedFrame {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return {
        ok: false,
        error: McpProtocolError.parseError({
          reason: 'frame is not valid JSON',
          snippet: text.length > 160 ? `${text.slice(0, 160)}...` : text,
        }),
      };
    }
    const message = this._classify(parsed, {});
    if (message === undefined) {
      return {
        ok: false,
        error: McpProtocolError.invalidRequest({
          reason: 'frame matches no JSON-RPC shape',
          frame: parsed,
        }),
      };
    }
    return { ok: true, message, type: message.type };
  }

  /**
   * Parse a frame (string) or structured value that is *expected* to be an
   * error response, and reduce it to a {@link McpProtocolError}. This is the
   * canonical way to surface a peer's failure as a throwable exception.
   *
   * @param message - a serialized error-response string, a
   *   {@link JsonRpcErrorResponse} object, or a standalone {@link JsonRpcError}.
   * @returns the parsed protocol error.
   * @throws {@link McpProtocolError} (`-32600`) when the input is not an error.
   */
  parseError(message: string | JsonRpcErrorResponse | JsonRpcError): McpProtocolError {
    if (typeof message === 'string') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(message);
      } catch (err) {
        return McpProtocolError.parseError({
          reason: 'error frame is not valid JSON',
          snippet: message.length > 160 ? `${message.slice(0, 160)}...` : message,
        });
      }
      return this.parseError(parsed as JsonRpcErrorResponse | JsonRpcError);
    }
    if (isJsonRpcErrorResponse(message)) {
      return McpProtocolError.fromJsonRpcErrorResponse(message);
    }
    if (isJsonRpcError(message)) {
      return McpProtocolError.fromJsonRpcError(message);
    }
    return McpProtocolError.invalidRequest({ reason: 'value is not a JSON-RPC error' });
  }

  /**
   * Decode a request frame specifically, throwing when the frame is not a
   * request. Convenience for server dispatch loops.
   *
   * @param text - the raw frame text.
   * @returns the normalized request message.
   * @throws {@link McpProtocolError} when the frame is not a valid request.
   */
  decodeRequest(text: string): ProtocolMessage & { readonly type: 'request' } {
    const message = this.decode(text);
    if (message.type !== 'request') {
      throw McpProtocolError.invalidRequest({
        reason: 'expected a request frame',
        actualType: message.type,
      });
    }
    return message;
  }

  /**
   * Extract just the request id from an arbitrary frame (string or structured),
   * returning `undefined` for notifications and unclassifiable input.
   *
   * @param frame - the frame to inspect.
   * @returns the request id, or `undefined`.
   */
  extractRequestId(frame: string | Record<string, unknown>): RequestId | undefined {
    let value: unknown = frame;
    if (typeof frame === 'string') {
      try {
        value = JSON.parse(frame);
      } catch {
        return undefined;
      }
    }
    if (!isJsonRpcRequest(value) && !isJsonRpcResponse(value) && !isJsonRpcErrorResponse(value)) {
      return undefined;
    }
    const record = value as unknown as Record<string, unknown>;
    const id = record['id'];
    try {
      return normalizeRequestId(id);
    } catch {
      return undefined;
    }
  }

  /**
   * Internal classifier: reduce an already-parsed JSON value into a
   * discriminated {@link ProtocolMessage}, or `undefined` when no shape
   * matches.
   *
   * @param parsed - the parsed JSON value.
   * @param options - decoding controls.
   * @returns the normalized message, or `undefined`.
   */
  private _classify(parsed: unknown, options: DecodeOptions): ProtocolMessage | undefined {
    if (isJsonRpcRequest(parsed)) {
      return { type: 'request', request: parsed };
    }
    if (isJsonRpcNotification(parsed)) {
      return { type: 'notification', notification: parsed };
    }
    if (isJsonRpcResponse(parsed)) {
      return { type: 'response', response: parsed };
    }
    if (isJsonRpcErrorResponse(parsed)) {
      return { type: 'error', error: parsed };
    }
    if (options.tolerateMissingVersion === true && isPlainObject(parsed)) {
      return this._classifyLenient(parsed);
    }
    return undefined;
  }

  /**
   * Internal classifier for lenient mode: accept frames whose only deviation
   * is the missing `jsonrpc` version marker.
   *
   * @param record - the parsed object.
   * @returns the normalized message, or `undefined`.
   */
  private _classifyLenient(record: Record<string, unknown>): ProtocolMessage | undefined {
    if ('method' in record) {
      const id = record['id'];
      if (id !== undefined && (typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id)))) {
        if (typeof record['method'] === 'string') {
          return { type: 'request', request: record as never };
        }
      }
      if (typeof record['method'] === 'string') {
        return { type: 'notification', notification: record as never };
      }
    }
    if ('result' in record) {
      return { type: 'response', response: record as never };
    }
    if ('error' in record && isJsonRpcError(record['error'])) {
      return { type: 'error', error: record as never };
    }
    return undefined;
  }
}

/**
 * Convenience factory: create a codec with a fresh id counter.
 *
 * @returns a new {@link ProtocolCodec}.
 */
export function createCodec(): ProtocolCodec {
  return new ProtocolCodec();
}

/**
 * Convenience factory: create a codec that is about to take over an existing
 * connection's id namespace, seeded so new ids continue the sequence.
 *
 * @param lastId - the last id the previous codec handed out.
 * @returns a new {@link ProtocolCodec} that continues from `lastId`.
 */
export function continueCodec(lastId: number): ProtocolCodec {
  return new ProtocolCodec(lastId);
}

/**
 * Render a decoded message as a compact one-line diagnostic string (used for
 * logs and error reports).
 *
 * @param message - the normalized message.
 * @returns a human-readable single-line description.
 */
export function describeMessage(message: ProtocolMessage): string {
  switch (message.type) {
    case 'request':
      return `request #${String(message.request.id)} ${message.request.method}`;
    case 'notification':
      return `notification ${message.notification.method}`;
    case 'response':
      return `response #${String(message.response.id)}`;
    case 'error':
      return `error #${String(message.error.id)} (${message.error.error.code}) ${message.error.error.message}`;
  }
}

/**
 * Guard: reports whether `value` is a plain object. Local copy of the shared
 * `types.ts` predicate kept private to this module's classifier so lenient
 * decoding stays self-contained.
 *
 * @param value - the value to inspect.
 * @returns `true` for plain objects.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}