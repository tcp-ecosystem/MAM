/**
 * The source store: a real, working registry of {@link KnowledgeSource}s.
 *
 * `KnowledgeSourceStore` is the persistence heart of the Sources layer. It owns
 * the authoritative in-memory map of source id → source, applies duplicate
 * policies, enforces content-size limits, and provides the three ingestion
 * entry points (`ingestText`, `ingestFile`, `ingestUrl`) plus structured query
 * and serialisation helpers.
 *
 * Design notes:
 *
 * - **File ingestion** reads through `node:fs/promises` and stores the decoded
 *   text along with the resolved absolute path, so the lifecycle layer can
 *   re-read the file on refresh.
 * - **URL ingestion** stores the remote location and best-effort fetches the
 *   body over built-in `node:http`/`node:https` when auto-fetch is enabled; a
 *   failed fetch degrades gracefully to a URL-only source rather than throwing.
 * - **Duplicates** are governed by the `onDuplicate` config policy
 *   (`'replace'` default, `'skip'` or `'error'`).
 * - **Timestamps** use an injectable clock for determinism under test.
 *
 * @packageDocumentation
 * @module sources/store
 */

import { readFile } from 'node:fs/promises';
import { resolve, extname, basename } from 'node:path';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

import type {
  KnowledgeSource,
  SourceId,
  SourceKind,
  SourceConfig,
  SourceOptions,
  TextIngestOptions,
  FileIngestOptions,
  UrlIngestOptions,
  IngestResult,
  SourceStats,
  SerializedSources,
  Timestamp,
} from './types.js';
import {
  DEFAULT_MIME_TYPE,
  DEFAULT_FETCH_TIMEOUT_MS,
  SOURCE_KINDS,
  TEXT_MIME_TYPE,
  byteLength,
  buildSourceId,
  clamp,
  detectMimeType,
  isValidKind,
  normalizeTags,
  normalizeText,
} from './types.js';

/**
 * Internal, resolved configuration for a store instance.
 */
interface ResolvedStoreConfig {
  /** MIME type assumed when none can be detected. */
  defaultMimeType: string;
  /** Maximum content size in bytes; `0` disables the cap. */
  maxContentBytes: number;
  /** When `true`, re-registering an existing id replaces the record. */
  allowOverwrite: boolean;
  /** Duplicate policy. */
  onDuplicate: NonNullable<SourceConfig['onDuplicate']>;
  /** Default tags merged into every ingested source. */
  defaultTags: readonly string[];
  /** Injectable clock. */
  now: () => Timestamp;
}

/**
 * The result of a best-effort remote URL fetch.
 */
interface FetchedPayload {
  /** Decoded response body. */
  content: string;
  /** MIME type from the `Content-Type` header, if any. */
  mimeType: string;
}

/**
 * A working registry of {@link KnowledgeSource}s with ingestion, query,
 * statistics and serialisation support.
 *
 * @example
 * ```ts
 * const store = new KnowledgeSourceStore();
 * await store.ingestText('welcome', 'Hello from the engine!', { tags: ['greeting'] });
 * await store.ingestFile('readme', './README.md');
 * const source = store.get('welcome');
 * console.log(store.stats().sources); // 2
 * ```
 */
export class KnowledgeSourceStore {
  /** Authoritative source map, in insertion order. */
  private readonly sources = new Map<SourceId, KnowledgeSource>();

  /** Resolved behaviour configuration. */
  private readonly config: ResolvedStoreConfig;

  /** Monotonic behaviour counters. */
  private counters = { ingested: 0, updated: 0, removed: 0, errors: 0 };

  /** Epoch-millisecond construction time. */
  private readonly createdAt: Timestamp;

  /**
   * Construct a new source store.
   *
   * @param config - behaviour options; all fields are optional (see
   * {@link SourceConfig})
   */
  constructor(config: SourceConfig = {}) {
    const now = config.now ?? (() => Date.now());
    this.config = {
      defaultMimeType: config.defaultMimeType ?? DEFAULT_MIME_TYPE,
      maxContentBytes: config.maxContentBytes ?? 0,
      allowOverwrite: config.allowOverwrite ?? false,
      onDuplicate: config.onDuplicate ?? 'replace',
      defaultTags: normalizeTags(config.defaultTags),
      now,
    };
    this.createdAt = now();
  }

  /** @returns the number of sources currently registered. */
  get size(): number {
    return this.sources.size;
  }

  /** @returns the epoch-millisecond construction time of this store. */
  get created(): Timestamp {
    return this.createdAt;
  }

  /**
   * Register (create or, per policy, replace) a source.
   *
   * This is the low-level entry point behind every ingest method. The incoming
   * record is normalised (tags de-duplicated, MIME defaulted, timestamps
   * back-filled) before it is stored, and the caller's object is never
   * mutated.
   *
   * @param source - the source to register
   * @returns an {@link IngestResult} describing the outcome
   * @throws `Error` on an empty id, over-limit content, or when the duplicate
   * policy is `'error'` and the id already exists
   */
  register(source: KnowledgeSource): IngestResult {
    const started = this.config.now();
    const id = normalizeText(source.id, false);
    if (!id) {
      throw new Error('Cannot register a source with an empty id');
    }

    const existing = this.sources.get(id);
    if (existing && !this.config.allowOverwrite) {
      if (this.config.onDuplicate === 'error') {
        throw new Error(`Source "${id}" already exists (duplicate policy: error)`);
      }
      if (this.config.onDuplicate === 'skip') {
        return {
          source: existing,
          created: false,
          replaced: false,
          skipped: true,
          ok: true,
          at: started,
          tookMs: this.config.now() - started,
          detail: 'duplicate-skipped',
        };
      }
    }

    this.assertContentSize(id, source.content);

    const now = this.config.now();
    const createdAt = Number.isFinite(source.createdAt)
      ? source.createdAt
      : now;
    const normalized: KnowledgeSource = {
      id,
      name: source.name || id,
      kind: source.kind,
      content: source.content,
      path: source.path,
      url: source.url,
      mimeType: source.mimeType ?? this.config.defaultMimeType,
      tags: normalizeTags(source.tags ?? this.config.defaultTags),
      metadata: source.metadata,
      createdAt,
      updatedAt: source.updatedAt ?? createdAt,
    };

    const created = !existing;
    this.sources.set(id, normalized);
    if (created) {
      this.counters.ingested += 1;
    } else {
      this.counters.updated += 1;
    }

    return {
      source: normalized,
      created,
      replaced: !created,
      skipped: false,
      ok: true,
      at: started,
      tookMs: this.config.now() - started,
    };
  }

  /**
   * Remove a source by id.
   *
   * @param id - the source id to remove
   * @returns `true` when a source was removed, `false` when it did not exist
   */
  unregister(id: SourceId): boolean {
    const removed = this.sources.delete(id);
    if (removed) {
      this.counters.removed += 1;
    }
    return removed;
  }

  /**
   * Fetch a source by id.
   *
   * @param id - the source id
   * @returns the source, or `undefined` when not registered
   */
  get(id: SourceId): KnowledgeSource | undefined {
    return this.sources.get(id);
  }

  /**
   * Test whether a source id is registered.
   *
   * @param id - the source id
   * @returns `true` when the source exists
   */
  has(id: SourceId): boolean {
    return this.sources.has(id);
  }

  /**
   * All registered source ids, in insertion order.
   *
   * @returns the ids
   */
  keys(): SourceId[] {
    return [...this.sources.keys()];
  }

  /**
   * All registered sources, in insertion order.
   *
   * @returns the sources
   */
  values(): KnowledgeSource[] {
    return [...this.sources.values()];
  }

  /**
   * Remove every registered source.
   *
   * @returns the number of sources removed
   */
  clear(): number {
    const count = this.sources.size;
    if (count > 0) {
      this.sources.clear();
      this.counters.removed += count;
    }
    return count;
  }

  /**
   * Ingest a free-text source.
   *
   * @param id - the source id
   * @param text - the textual content
   * @param opts - per-call overrides (name, mime, tags, metadata, …)
   * @returns the ingestion outcome
   * @throws `Error` when `text` is empty or exceeds the content-size cap
   */
  async ingestText(
    id: SourceId,
    text: string,
    opts: TextIngestOptions = {},
  ): Promise<IngestResult> {
    if (!text) {
      throw new Error(`Cannot ingest text for "${id}": text is empty`);
    }
    const source: KnowledgeSource = {
      id,
      name: opts.name ?? id,
      kind: 'text',
      content: text,
      mimeType: opts.mimeType ?? TEXT_MIME_TYPE,
      tags: opts.tags,
      metadata: opts.metadata,
      createdAt: opts.createdAt ?? this.config.now(),
      updatedAt: opts.updatedAt,
    };
    return this.register(source);
  }

  /**
   * Ingest a local file.
   *
   * Reads the file with `node:fs/promises`, resolves the absolute path, and
   * detects the MIME type from the file extension.
   *
   * @param id - the source id
   * @param path - the file path to read
   * @param opts - per-call overrides (encoding, mime, tags, metadata, …)
   * @returns the ingestion outcome
   * @throws `Error` when the file cannot be read, is empty, or exceeds the
   * content-size cap
   */
  async ingestFile(
    id: SourceId,
    path: string,
    opts: FileIngestOptions = {},
  ): Promise<IngestResult> {
    if (!path) {
      throw new Error(`Cannot ingest file for "${id}": path is empty`);
    }
    const encoding = opts.encoding ?? 'utf8';
    const content = await readFile(path, encoding);
    if (!content) {
      throw new Error(`Cannot ingest file for "${id}": file is empty: ${path}`);
    }
    const absolute = resolve(path);
    const source: KnowledgeSource = {
      id,
      name: opts.name ?? basename(absolute),
      kind: 'file',
      content,
      path: absolute,
      mimeType: opts.mimeType ?? detectMimeType(extname(absolute) || absolute),
      tags: opts.tags,
      metadata: opts.metadata,
      createdAt: opts.createdAt ?? this.config.now(),
      updatedAt: opts.updatedAt,
    };
    return this.register(source);
  }

  /**
   * Ingest a remote URL.
   *
   * Stores the URL (and optional caller-provided content). When `autoFetch` is
   * enabled (default), the body is fetched best-effort over built-in
   * `node:http`/`node:https`; a network failure degrades gracefully to a
   * URL-only source recorded with `detail: 'url-fetch-failed'`.
   *
   * @param id - the source id
   * @param url - the remote location
   * @param opts - per-call overrides (autoFetch, fetchTimeoutMs, tags, …)
   * @returns the ingestion outcome
   * @throws `Error` when the URL is invalid or the content exceeds the cap
   */
  async ingestUrl(
    id: SourceId,
    url: string,
    opts: UrlIngestOptions = {},
  ): Promise<IngestResult> {
    if (!url) {
      throw new Error(`Cannot ingest url for "${id}": url is empty`);
    }
    this.assertValidUrl(url);

    let content = opts.content;
    let mimeType = opts.mimeType;
    let detail: string | undefined;
    const autoFetch = opts.autoFetch ?? true;

    if (autoFetch && content === undefined) {
      try {
        const fetched = await KnowledgeSourceStore.fetchUrl(
          url,
          opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        );
        content = fetched.content;
        mimeType = mimeType ?? fetched.mimeType;
      } catch {
        detail = 'url-fetch-failed';
      }
    }

    const source: KnowledgeSource = {
      id,
      name: opts.name ?? url,
      kind: 'url',
      content,
      url,
      mimeType: mimeType ?? this.config.defaultMimeType,
      tags: opts.tags,
      metadata: opts.metadata,
      createdAt: opts.createdAt ?? this.config.now(),
      updatedAt: opts.updatedAt,
    };
    return this.register(source);
  }

  /**
   * Return the textual content of a source.
   *
   * @param id - the source id
   * @returns the content, or `undefined` when the source is absent or has no
   * content
   */
  getContent(id: SourceId): string | undefined {
    return this.sources.get(id)?.content;
  }

  /**
   * List every registered source of a given kind.
   *
   * @param kind - the {@link SourceKind} to filter by
   * @returns the matching sources, in insertion order
   */
  listByKind(kind: SourceKind): KnowledgeSource[] {
    const out: KnowledgeSource[] = [];
    for (const source of this.sources.values()) {
      if (source.kind === kind) {
        out.push(source);
      }
    }
    return out;
  }

  /**
   * Update a registered source by merging a patch.
   *
   * `id` and `createdAt` can never change; `updatedAt` is set to the current
   * clock time unless the patch supplies its own. An empty patch is a legal
   * "touch".
   *
   * @param id - the source id
   * @param patch - the fields to merge
   * @returns the updated source, or `undefined` when the id is not registered
   * @throws `Error` when the merged content exceeds the size cap
   */
  update(
    id: SourceId,
    patch: Partial<
      Omit<KnowledgeSource, 'id' | 'createdAt'>
    > = {},
  ): KnowledgeSource | undefined {
    const existing = this.sources.get(id);
    if (!existing) {
      return undefined;
    }
    const mergedContent = patch.content ?? existing.content;
    this.assertContentSize(id, mergedContent);
    const now = this.config.now();
    const updated: KnowledgeSource = {
      id: existing.id,
      name: patch.name ?? existing.name,
      kind: patch.kind ?? existing.kind,
      content: mergedContent,
      path: patch.path ?? existing.path,
      url: patch.url ?? existing.url,
      mimeType: patch.mimeType ?? existing.mimeType,
      tags: normalizeTags(patch.tags ?? existing.tags),
      metadata: patch.metadata ?? existing.metadata,
      createdAt: existing.createdAt,
      updatedAt: patch.updatedAt ?? now,
    };
    this.sources.set(id, updated);
    this.counters.updated += 1;
    return updated;
  }

  /**
   * Serialise the store to a JSON-safe object.
   *
   * @returns a {@link SerializedSources} payload
   */
  toJSON(): SerializedSources {
    return {
      version: 1,
      createdAt: this.createdAt,
      sources: [...this.sources.values()],
    };
  }

  /**
   * Rebuild a store from a serialised payload.
   *
   * @param data - the {@link SerializedSources} payload
   * @param config - behaviour options for the new store
   * @returns a new store containing the serialised sources
   * @throws `Error` on an unsupported version or when a source fails the
   * duplicate/content validation
   */
  static fromJSON(
    data: SerializedSources,
    config: SourceConfig = {},
  ): KnowledgeSourceStore {
    if (data.version !== 1) {
      throw new Error(`Unsupported serialized source version: ${data.version}`);
    }
    const store = new KnowledgeSourceStore(config);
    for (const source of data.sources) {
      store.register(source);
    }
    return store;
  }

  /**
   * Load a store from a JSON file on disk.
   *
   * @param filePath - path to the JSON file
   * @param config - behaviour options for the new store
   * @returns the loaded store
   * @throws `Error` on read or parse failure
   */
  static async load(
    filePath: string,
    config: SourceConfig = {},
  ): Promise<KnowledgeSourceStore> {
    const raw = await readFile(filePath, 'utf8');
    const data = JSON.parse(raw) as SerializedSources;
    return KnowledgeSourceStore.fromJSON(data, config);
  }

  /**
   * Persist the store to a JSON file on disk.
   *
   * @param filePath - path to write to
   * @param pretty - when `true` (default), the JSON is pretty-printed
   * @returns a promise resolving once the file is written
   */
  async save(filePath: string, pretty = true): Promise<void> {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      pretty
        ? JSON.stringify(this.toJSON(), null, 2)
        : JSON.stringify(this.toJSON()),
      'utf8',
    );
  }

  /**
   * Aggregate statistics describing this store.
   *
   * @returns a {@link SourceStats} snapshot
   */
  stats(): SourceStats {
    const byKind: Record<SourceKind, number> = {
      text: 0,
      file: 0,
      url: 0,
      memory: 0,
    };
    let totalBytes = 0;
    let withContent = 0;
    let tagged = 0;
    let withPath = 0;
    let withUrl = 0;
    let oldestAt: Timestamp | null = null;
    let newestAt: Timestamp | null = null;

    for (const source of this.sources.values()) {
      byKind[source.kind] = (byKind[source.kind] ?? 0) + 1;
      totalBytes += byteLength(source.content);
      if (source.content !== undefined) {
        withContent += 1;
      }
      if (source.tags && source.tags.length > 0) {
        tagged += 1;
      }
      if (source.path !== undefined) {
        withPath += 1;
      }
      if (source.url !== undefined) {
        withUrl += 1;
      }
      if (oldestAt === null || source.createdAt < oldestAt) {
        oldestAt = source.createdAt;
      }
      if (newestAt === null || source.createdAt > newestAt) {
        newestAt = source.createdAt;
      }
    }

    return {
      sources: this.sources.size,
      byKind,
      totalBytes,
      withContent,
      tagged,
      withPath,
      withUrl,
      oldestAt,
      newestAt,
      ingested: this.counters.ingested,
      updated: this.counters.updated,
      removed: this.counters.removed,
      errors: this.counters.errors,
    };
  }

  /**
   * Register many sources at once.
   *
   * @param sources - the sources to register
   * @param onError - optional error handler invoked for each failing source;
   * when omitted, the first error is rethrown
   * @returns the results, one per input source
   */
  registerMany(
    sources: readonly KnowledgeSource[],
    onError?: (id: SourceId, error: Error) => void,
  ): IngestResult[] {
    const results: IngestResult[] = [];
    for (const source of sources) {
      try {
        results.push(this.register(source));
      } catch (error) {
        this.counters.errors += 1;
        const wrapped =
          error instanceof Error ? error : new Error(String(error));
        if (onError) {
          onError(source.id, wrapped);
          results.push({
            source,
            created: false,
            replaced: false,
            skipped: true,
            ok: false,
            at: this.config.now(),
            tookMs: 0,
            detail: wrapped.message,
          });
        } else {
          throw wrapped;
        }
      }
    }
    return results;
  }

  /**
   * Attempt to fetch a URL body over built-in HTTP(S).
   *
   * @param url - the URL to fetch
   * @param timeoutMs - abort timeout in milliseconds
   * @returns the decoded body and MIME type
   * @throws `Error` on invalid URL, network failure, timeout or non-2xx status
   */
  private static async fetchUrl(
    url: string,
    timeoutMs: number,
  ): Promise<FetchedPayload> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    const isHttps = parsed.protocol === 'https:';
    const get = isHttps ? httpsGet : httpGet;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

    return new Promise<FetchedPayload>((resolvePromise, rejectPromise) => {
      const request = get(
        url,
        { signal: controller.signal },
        (response) => {
          const status = response.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            response.resume();
            rejectPromise(
              new Error(`HTTP ${status} while fetching ${url}`),
            );
            return;
          }
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });
          response.on('end', () => {
            const content = Buffer.concat(chunks).toString('utf8');
            const header = response.headers['content-type'];
            const mimeType =
              (typeof header === 'string'
                ? header.split(';')[0]?.trim()
                : undefined) ?? DEFAULT_MIME_TYPE;
            resolvePromise({ content, mimeType });
          });
          response.on('error', rejectPromise);
        },
      );
      request.on('error', rejectPromise);
    }).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Validate a URL string without performing any network activity.
   *
   * @param url - the URL to validate
   * @throws `Error` when the URL is malformed or uses an unsupported protocol
   */
  private assertValidUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(
        `Unsupported URL protocol "${parsed.protocol}" for ${url}`,
      );
    }
  }

  /**
   * Enforce the configured content-size cap.
   *
   * @param id - the source id (for the error message)
   * @param content - the content to measure
   * @throws `Error` when the content exceeds `maxContentBytes`
   */
  private assertContentSize(id: SourceId, content: string | undefined): void {
    const cap = this.config.maxContentBytes;
    if (cap <= 0) {
      return;
    }
    const bytes = byteLength(content);
    if (bytes > cap) {
      throw new Error(
        `Content for "${id}" is ${bytes} bytes, exceeding the cap of ${cap}`,
      );
    }
  }
}

/**
 * Guard: a subset of the store API used for structural duck-typing checks.
 *
 * @param value - the value to test
 * @returns `true` when the value exposes the core store surface
 */
export function isSourceStoreLike(
  value: unknown,
): value is Pick<KnowledgeSourceStore, 'get' | 'has' | 'size' | 'keys'> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.get === 'function' &&
    typeof record.has === 'function' &&
    typeof record.size === 'number' &&
    typeof record.keys === 'function'
  );
}

/**
 * Sanitise a free-form id into a safe map key.
 *
 * @param id - the raw id
 * @returns the trimmed id, or `''` when empty
 */
export function canonicalId(id: SourceId | undefined): string {
  return normalizeText(id, false);
}

/**
 * Count registered sources per kind for a collection of ids.
 *
 * @param ids - the ids to count
 * @param lookup - a `get`-style lookup returning the source or `undefined`
 * @returns a per-kind tally
 */
export function countByKind(
  ids: readonly SourceId[],
  lookup: (id: SourceId) => KnowledgeSource | undefined,
): Record<SourceKind, number> {
  const tally: Record<SourceKind, number> = {
    text: 0,
    file: 0,
    url: 0,
    memory: 0,
  };
  for (const id of ids) {
    const source = lookup(id);
    const kind = source?.kind;
    if (kind && isValidKind(kind)) {
      tally[kind] = (tally[kind] ?? 0) + 1;
    }
  }
  return tally;
}

/**
 * Build a stable pseudo-id for a source that lacks one (defensive helper).
 *
 * @param seed - a seed string influencing the generated id
 * @returns a {@link buildSourceId}-generated id incorporating the seed
 */
export function idForSeed(seed: string): SourceId {
  return buildSourceId(normalizeText(seed) || 'seed');
}

/**
 * Clamp a user-supplied result limit into `[1, 10_000]`.
 *
 * @param limit - the raw limit
 * @param fallback - the value used when `limit` is not finite
 * @returns the clamped limit
 */
export function normalizeLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return clamp(fallback, 1, 10_000);
  }
  return clamp(Math.floor(limit), 1, 10_000);
}

/**
 * Return every {@link SourceKind} string (re-export convenience).
 *
 * @returns the canonical kind list
 */
export function sourceKinds(): readonly SourceKind[] {
  return SOURCE_KINDS;
}