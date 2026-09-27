/**
 * Shared domain types for the **Sources** layer of the standalone MAM Knowledge
 * Engine.
 *
 * The Sources layer is the ingestion boundary of the engine: it manages the raw
 * knowledge sources (documents, free text, local files and remote URLs) that
 * every downstream stage — chunking, embedding, indexing and retrieval — draws
 * from. This module defines the public contract every other file in the
 * `sources/` subsystem builds on:
 *
 * 1. **Shapes** — {@link KnowledgeSource} is the canonical record for a
 *    registered source; {@link SourceStats}, {@link SourceConfig} and
 *    {@link SourceOptions} describe aggregates, construction behaviour and
 *    per-call overrides respectively.
 * 2. **Results** — {@link IngestResult} reports the outcome of every ingestion
 *    operation (created, replaced or skipped) together with timing data.
 * 3. **Events** — {@link SourceEvent} is the payload shape emitted by the
 *    lifecycle layer when sources are ingested, refreshed or pruned.
 *
 * The types are deliberately framework-agnostic and JSON-serialisable: every
 * value here round-trips through `JSON.stringify`/`JSON.parse` without loss, so
 * a {@link KnowledgeSource} registered in one process can be persisted and
 * replayed by another (see `store.ts` `toJSON`/`fromJSON`).
 *
 * @packageDocumentation
 * @module sources/types
 */

/**
 * Unique identifier for a knowledge source.
 *
 * Source ids are opaque to the Sources layer; any collision-free scheme is
 * acceptable. In practice they are a short slug (`"manual"`, `"api-ref"`), a
 * generated handle produced by {@link buildSourceId}, or an arbitrary caller
 * token. The engine never inspects the internal structure of a source id — it
 * only uses it as a map key and a correlation handle across layers.
 */
export type SourceId = string;

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the Sources layer use epoch milliseconds so they
 * interoperate cleanly with `Date`, `performance.now()`-derived clocks and the
 * TTL arithmetic performed by the lifecycle layer.
 */
export type Timestamp = number;

/**
 * The four kinds of knowledge source the engine can ingest.
 *
 * - `'text'` — raw free text supplied directly to the engine (no backing
 *   artifact).
 * - `'file'` — a local file on disk, re-readable on refresh.
 * - `'url'` — a remote resource, re-fetchable on refresh.
 * - `'memory'` — an in-process record with no external backing; the engine
 *   treats it as ephemeral working knowledge.
 */
export type SourceKind = 'text' | 'file' | 'url' | 'memory';

/**
 * A MIME type string, e.g. `'text/markdown'` or `'application/json'`.
 */
export type MimeType = string;

/**
 * A single tag string attached to a {@link KnowledgeSource}.
 */
export type SourceTag = string;

/**
 * All {@link SourceKind} values, in a canonical order used for iteration and
 * for {@link SourceStats.byKind} enumeration.
 */
export const SOURCE_KINDS: readonly SourceKind[] = [
  'text',
  'file',
  'url',
  'memory',
];

/**
 * A registered knowledge source.
 *
 * A {@link KnowledgeSource} is the smallest self-contained unit of provenance
 * the engine tracks: it carries enough information to (a) display and organise
 * the source (`id`, `name`, `kind`, `tags`), (b) re-hydrate it on demand
 * (`content`, `path`, `url`), and (c) support lifecycle decisions (`createdAt`,
 * `updatedAt`). Only `id`, `name`, `kind` and `createdAt` are required; every
 * other field is optional and may be filled in by the store as metadata is
 * discovered (e.g. a MIME type detected from a file extension).
 *
 * @example
 * ```ts
 * const source: KnowledgeSource = {
 *   id: 'ops-manual',
 *   name: 'operations-manual.md',
 *   kind: 'file',
 *   path: '/docs/ops.md',
 *   content: '# Operations\nAlways back up before migrating.',
 *   mimeType: 'text/markdown',
 *   tags: ['ops', 'runbook'],
 *   createdAt: 1_700_000_000_000,
 *   updatedAt: 1_700_000_000_000,
 * };
 * ```
 */
export interface KnowledgeSource {
  /**
   * Unique identifier of the source. See {@link SourceId}.
   */
  readonly id: SourceId;

  /**
   * Human-readable display name. Defaults to a slug derived from the id when an
   * ingest call does not supply one.
   */
  readonly name: string;

  /**
   * The kind of source. See {@link SourceKind}.
   */
  readonly kind: SourceKind;

  /**
   * The textual content of the source, when it is known. Free text, file
   * contents and fetched URL bodies are all stored here. Absent for URL-only
   * sources whose remote fetch failed or was disabled.
   */
  readonly content?: string;

  /**
   * Absolute path of the backing file for `kind === 'file'` sources. Used by
   * the lifecycle layer to re-read the file on refresh.
   */
  readonly path?: string;

  /**
   * Remote location of the resource for `kind === 'url'` sources. Used by the
   * lifecycle layer to re-fetch on refresh.
   */
  readonly url?: string;

  /**
   * MIME type of the content, when known. Detected from the file extension or
   * the HTTP `Content-Type` header during ingestion; defaults to
   * {@link DEFAULT_MIME_TYPE}.
   */
  readonly mimeType?: string;

  /**
   * Optional set of tags attached to the source. Normalised to lower-cased,
   * de-duplicated strings by the store before persistence.
   */
  readonly tags?: readonly SourceTag[];

  /**
   * Caller-owned structured metadata preserved verbatim (e.g. `title`,
   * `language`, `author`). The engine never interprets these values.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /**
   * Epoch-millisecond time at which the source was first registered.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time at which the source was last touched — created,
   * updated or refreshed. Absent until the first write, after which the store
   * keeps it in step with `createdAt` or later.
   */
  readonly updatedAt?: Timestamp;
}

/**
 * Construction/behaviour options for the source store and its helpers.
 *
 * A {@link SourceConfig} tunes duplicate handling, content-size guards and the
 * clock. Every field is optional; defaults are chosen to be safe for general
 * knowledge-corpus use. A single config may be shared by the store, the index
 * and the lifecycle.
 */
export interface SourceConfig {
  /**
   * MIME type assumed when none can be detected. Defaults to
   * {@link DEFAULT_MIME_TYPE} (`'application/octet-stream'`).
   */
  readonly defaultMimeType?: MimeType;

  /**
   * Maximum size in bytes a source's content may reach before ingestion is
   * rejected with an error. `0` disables the cap. Defaults to `0`.
   */
  readonly maxContentBytes?: number;

  /**
   * When `true`, calling `register` with an id that already exists replaces the
   * existing record. Defaults to `false`; the authoritative policy is
   * {@link SourceConfig.onDuplicate}.
   */
  readonly allowOverwrite?: boolean;

  /**
   * Policy applied when `register` receives an id that is already present:
   * `'replace'` updates the record, `'skip'` keeps the existing record and
   * returns a skipped {@link IngestResult}, and `'error'` throws. Defaults to
   * `'replace'`.
   */
  readonly onDuplicate?: 'replace' | 'skip' | 'error';

  /**
   * Default tags applied to every source ingested through this config, merged
   * with any per-call tags.
   */
  readonly defaultTags?: readonly SourceTag[];

  /**
   * Optional clock used instead of `Date.now()` for all timestamps. Injecting a
   * clock makes the layer deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Per-call overrides accepted by every ingestion entry point.
 *
 * These values shape the {@link KnowledgeSource} produced for a single call and
 * override the store's constructor-time {@link SourceConfig}. They are
 * deliberately optional — the store falls back to its defaults for anything the
 * caller omits.
 */
export interface SourceOptions {
  /**
   * Display name for the source. Defaults to a slug derived from the id.
   */
  readonly name?: string;

  /**
   * Explicit MIME type. Overrides {@link SourceConfig.defaultMimeType} and any
   * auto-detection performed by the store.
   */
  readonly mimeType?: MimeType;

  /**
   * Tags to attach, merged with {@link SourceConfig.defaultTags}.
   */
  readonly tags?: readonly SourceTag[];

  /**
   * Structured metadata preserved verbatim on the source.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /**
   * Content to attach when the source kind does not imply a backing artifact
   * (e.g. `'text'`, `'memory'` or a URL with a caller-provided body).
   */
  readonly content?: string;

  /**
   * Override the wall-clock `createdAt` recorded for a brand-new source.
   */
  readonly createdAt?: Timestamp;

  /**
   * Override the `updatedAt` stamp. Ignored for new sources, which always start
   * at `createdAt`.
   */
  readonly updatedAt?: Timestamp;

  /**
   * Override {@link SourceConfig.allowOverwrite} for a single call.
   */
  readonly allowOverwrite?: boolean;
}

/**
 * Per-call options specific to text ingestion.
 */
export interface TextIngestOptions extends SourceOptions {
  /**
   * MIME type for the supplied text. Defaults to {@link TEXT_MIME_TYPE}.
   */
  readonly mimeType?: MimeType;
}

/**
 * Per-call options specific to file ingestion.
 */
export interface FileIngestOptions extends SourceOptions {
  /**
   * Encoding used when reading the file. Defaults to `'utf8'`.
   */
  readonly encoding?: BufferEncoding;

  /**
   * Explicit MIME type; otherwise detected from the file extension via
   * {@link detectMimeType}.
   */
  readonly mimeType?: MimeType;
}

/**
 * Per-call options specific to URL ingestion.
 */
export interface UrlIngestOptions extends SourceOptions {
  /**
   * When `true` (default), the store best-effort fetches the URL body over
   * HTTP(S) and attaches it as `content`. When `false`, the URL is stored
   * without content (a URL-only source).
   */
  readonly autoFetch?: boolean;

  /**
   * Maximum time in milliseconds to wait for a remote fetch before aborting.
   * Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}.
   */
  readonly fetchTimeoutMs?: number;
}

/**
 * Aggregate statistics describing a source store.
 *
 * Returned by `KnowledgeSourceStore.stats` and forwarded by the adapter and
 * registry layers. Counters that track behaviour over time (`ingested`,
 * `updated`, `removed`, `errors`) are monotonically increasing from
 * construction, while corpus-derived fields are computed on demand.
 */
export interface SourceStats {
  /**
   * Number of sources currently registered.
   */
  readonly sources: number;

  /**
   * Breakdown of registered sources by {@link SourceKind}.
   */
  readonly byKind: Readonly<Record<SourceKind, number>>;

  /**
   * Total size in bytes of all stored content (UTF-8 encoded).
   */
  readonly totalBytes: number;

  /**
   * Number of sources that carry textual content.
   */
  readonly withContent: number;

  /**
   * Number of sources that carry at least one tag.
   */
  readonly tagged: number;

  /**
   * Number of `'file'` sources with a backing path.
   */
  readonly withPath: number;

  /**
   * Number of `'url'` sources with a remote location.
   */
  readonly withUrl: number;

  /**
   * Epoch-millisecond `createdAt` of the oldest registered source, or `null`
   * when the store is empty.
   */
  readonly oldestAt: Timestamp | null;

  /**
   * Epoch-millisecond `createdAt` of the newest registered source, or `null`
   * when the store is empty.
   */
  readonly newestAt: Timestamp | null;

  /**
   * Total number of sources ingested (created) since construction.
   */
  readonly ingested: number;

  /**
   * Total number of sources updated since construction.
   */
  readonly updated: number;

  /**
   * Total number of sources removed since construction.
   */
  readonly removed: number;

  /**
   * Total number of ingest operations that failed since construction.
   */
  readonly errors: number;
}

/**
 * The outcome of a single ingestion or registration operation.
 *
 * Every ingestion entry point (`ingestText`, `ingestFile`, `ingestUrl`,
 * `register`) returns an {@link IngestResult} describing what happened. Exactly
 * one of `created`, `replaced` or `skipped` is `true` on a successful call;
 * hard failures (file-not-found, over-limit content, duplicate-with-`'error'`
 * policy) throw an `Error` instead.
 */
export interface IngestResult {
  /**
   * The source as it now exists in the store (the newly created record, the
   * replacement, or the pre-existing record when the call was skipped).
   */
  readonly source: KnowledgeSource;

  /**
   * `true` when this call registered a brand-new source id.
   */
  readonly created: boolean;

  /**
   * `true` when this call replaced a source id that already existed.
   */
  readonly replaced: boolean;

  /**
   * `true` when the duplicate policy (`'skip'`) kept a pre-existing record and
   * discarded the incoming data.
   */
  readonly skipped: boolean;

  /**
   * `true` for every non-throwing completion, including graceful degradations
   * such as a failed best-effort URL fetch (recorded in `detail`).
   */
  readonly ok: boolean;

  /**
   * Epoch-millisecond time at which the operation ran.
   */
  readonly at: Timestamp;

  /**
   * Wall-clock duration of the operation in milliseconds.
   */
  readonly tookMs: number;

  /**
   * Optional machine-readable reason, e.g. `'url-fetch-failed'` or
   * `'duplicate-skipped'`.
   */
  readonly detail?: string;
}

/**
 * Discriminator for source lifecycle events.
 */
export type SourceEventType =
  | 'register'
  | 'update'
  | 'remove'
  | 'ingest'
  | 'refresh'
  | 'prune'
  | 'reset';

/**
 * Payload emitted by the lifecycle event emitter.
 *
 * Every event carries the discriminator, a timestamp and the source ids
 * affected. `'ingest'` fires when a source is created, `'refresh'` when a
 * source is re-hydrated from its backing artifact, `'prune'` when sources are
 * evicted for staleness, and `'reset'` when the store is cleared.
 */
export interface SourceEvent {
  /**
   * The lifecycle operation that fired.
   */
  readonly type: SourceEventType;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: Timestamp;

  /**
   * Source ids affected by the operation.
   */
  readonly ids: readonly SourceId[];

  /**
   * Operation-specific detail (e.g. the removal reason for a prune).
   */
  readonly detail?: unknown;
}

/**
 * A JSON-safe serialisation of a source store.
 *
 * Produced by `KnowledgeSourceStore.toJSON` and consumed by
 * `KnowledgeSourceStore.fromJSON`. Carries a format version so future revisions
 * can migrate older payloads.
 */
export interface SerializedSources {
  /**
   * Serialisation format version. Currently always `1`.
   */
  readonly version: 1;

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * The registered sources, in insertion order.
   */
  readonly sources: readonly KnowledgeSource[];
}

/**
 * Default maximum number of results returned by retrieval/listing entry points
 * when the caller omits an explicit limit.
 */
export const DEFAULT_SOURCE_LIMIT = 50;

/**
 * Default interval in milliseconds between automatic lifecycle refreshes.
 */
export const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60_000;

/**
 * Default staleness threshold in milliseconds used by lifecycle pruning.
 */
export const DEFAULT_TTL_MS = 24 * 60 * 60_000;

/**
 * Default MIME type assumed when none can be detected.
 */
export const DEFAULT_MIME_TYPE = 'application/octet-stream';

/**
 * MIME type used for raw text ingestion.
 */
export const TEXT_MIME_TYPE = 'text/plain';

/**
 * Default timeout in milliseconds for best-effort URL fetches.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

/**
 * Maximum number of leading id characters indexed for prefix lookups.
 *
 * The prefix index stores ids under every prefix up to this length; capping the
 * depth bounds index memory while still covering realistic id prefixes.
 */
export const MAX_PREFIX_LENGTH = 32;

/**
 * Extension → MIME type map used by {@link detectMimeType}.
 */
export const MIME_BY_EXTENSION: Readonly<Record<string, MimeType>> = {
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.mdown': 'text/markdown',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.toml': 'application/toml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.ts': 'text/x-typescript',
  '.tsx': 'text/x-typescript',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.jsx': 'text/javascript',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.xml': 'text/xml',
  '.sql': 'text/x-sql',
  '.log': 'text/plain',
  '.rtf': 'application/rtf',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.tar': 'application/x-tar',
  '.wasm': 'application/wasm',
};

/**
 * Normalise free text for comparison and indexing.
 *
 * Trims surrounding whitespace, collapses internal runs of whitespace to a
 * single space and optionally lower-cases the result. Used to canonicalise
 * names, queries and tags before they are indexed or compared.
 *
 * @param text - the raw text to normalise
 * @param lower - when `true` (default), the result is lower-cased
 * @returns the normalised text, or `''` when `text` is falsy
 */
export function normalizeText(text: string | undefined, lower = true): string {
  if (!text) {
    return '';
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return lower ? collapsed.toLowerCase() : collapsed;
}

/**
 * Normalise a collection of tags.
 *
 * Trims each tag, drops empty strings, lower-cases and de-duplicates while
 * preserving first-seen order. `undefined`/`null` inputs yield an empty array.
 *
 * @param tags - the raw tags
 * @returns a clean, de-duplicated array of tags
 */
export function normalizeTags(
  tags: readonly SourceTag[] | undefined | null,
): SourceTag[] {
  if (!tags) {
    return [];
  }
  const seen = new Set<string>();
  const out: SourceTag[] = [];
  for (const raw of tags) {
    const tag = normalizeText(raw);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      out.push(tag);
    }
  }
  return out;
}

/**
 * Clamp a number into `[min, max]`.
 *
 * @param value - the value to clamp
 * @param min - inclusive lower bound
 * @param max - inclusive upper bound
 * @returns the clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Test whether a value is one of the four valid {@link SourceKind} strings.
 *
 * @param kind - the value to test
 * @returns `true` when `kind` is a recognised source kind
 */
export function isValidKind(kind: unknown): kind is SourceKind {
  return (
    typeof kind === 'string' &&
    (kind === 'text' || kind === 'file' || kind === 'url' || kind === 'memory')
  );
}

/**
 * Coerce an arbitrary value into a {@link SourceKind}, or `null`.
 *
 * @param kind - the value to coerce
 * @returns the matching {@link SourceKind}, or `null` when unrecognised
 */
export function parseSourceKind(kind: unknown): SourceKind | null {
  return isValidKind(kind) ? kind : null;
}

/**
 * Detect a MIME type from a file path, file name or URL.
 *
 * If the input already looks like a MIME string (contains a `/`), it is
 * returned as-is. Otherwise the file extension is looked up in
 * {@link MIME_BY_EXTENSION}; unrecognised extensions fall back to
 * {@link DEFAULT_MIME_TYPE}.
 *
 * @param input - a path, file name or URL
 * @returns the detected (or defaulted) MIME type
 */
export function detectMimeType(input: string | undefined): MimeType {
  if (!input) {
    return DEFAULT_MIME_TYPE;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return DEFAULT_MIME_TYPE;
  }
  if (trimmed.includes('/')) {
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  for (const [ext, mime] of Object.entries(MIME_BY_EXTENSION)) {
    if (lower.endsWith(ext)) {
      return mime;
    }
  }
  return DEFAULT_MIME_TYPE;
}

/**
 * Generate a collision-resistant source id.
 *
 * The returned id is `"<prefix>-<hex>"` where `<hex>` is `entropy` random
 * bytes expressed in hex. The prefix is normalised to a safe slug character
 * set.
 *
 * @param prefix - a readable prefix for the id (defaults to `'src'`)
 * @param entropy - number of random bytes (defaults to `8`)
 * @returns a new source id
 */
export function buildSourceId(prefix = 'src', entropy = 8): SourceId {
  const slug = normalizeText(prefix).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const bytes = new Uint8Array(entropy);
  for (let i = 0; i < entropy; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = '';
  for (let i = 0; i < entropy; i += 1) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return `${slug || 'src'}-${hex}`;
}

/**
 * Narrow a value to {@link KnowledgeSource} by structural inspection.
 *
 * Useful for guards in generic pipelines that may receive either a source or a
 * plain record. Checks the four required fields only.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link KnowledgeSource}
 */
export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<KnowledgeSource>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    isValidKind(record.kind) &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt)
  );
}

/**
 * Compute the UTF-8 byte length of a string.
 *
 * @param content - the string to measure
 * @returns the number of UTF-8 bytes, or `0` for empty input
 */
export function byteLength(content: string | undefined): number {
  if (!content) {
    return 0;
  }
  return Buffer.byteLength(content, 'utf8');
}