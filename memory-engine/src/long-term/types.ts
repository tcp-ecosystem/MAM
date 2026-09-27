/**
 * @fileOverview Core type definitions and small pure helper utilities for the
 * long-term memory layer of the standalone MAM Memory Engine.
 *
 * The long-term layer is a durable, taggable, importance-scored key/value
 * memory that survives process restarts.  It is intentionally dependency free
 * (Node built-ins only) so that it can be embedded in any runtime, service, or
 * agent host.
 *
 * This module defines the data contracts shared by every other module in the
 * layer:
 *
 *   - {@link LongTermEntry}            a single durable memory record
 *   - {@link LongTermConfig}           behaviour knobs for stores / adapters
 *   - {@link LongTermStats}            structural statistics about a store
 *   - {@link LongTermEntryOptions}     per-entry write hints
 *   - {@link PersistenceOptions}       options that tune serialization
 *
 * It also exports a handful of pure functions (clamping, normalisation, deep
 * cloning, merging, validation, sorting, size estimation) that are reused
 * across `store.ts`, `index.ts`, `retrieval.ts`, `lifecycle.ts` and
 * `integration.ts` so that no one module re-implements them.
 */

/* -------------------------------------------------------------------------- *
 * Constants
 * -------------------------------------------------------------------------- */

/** Default number of entries a long-term store will keep before pruning. */
export const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Default minimum importance (inclusive) considered "significant" when
 * filtering with {@link LongTermStore.getByImportance} or the
 * {@link LongTermIndex}.
 */
export const DEFAULT_IMPORTANCE_THRESHOLD = 0.5;

/** Inclusive lower bound of the normalised importance scale. */
export const IMPORTANCE_MIN = 0;

/** Inclusive upper bound of the normalised importance scale. */
export const IMPORTANCE_MAX = 1;

/**
 * Default interval, in milliseconds, between automatic persistence sweeps in
 * {@link LongTermLifecycle}.  Sixty seconds balances durability against disk
 * write pressure.
 */
export const DEFAULT_PERSIST_INTERVAL_MS = 60_000;

/** Default tag used to namespace entries that have no explicit tag. */
export const DEFAULT_TAG = 'general';

/** How many importance buckets the importance index partitions into. */
export const IMPORTANCE_BUCKETS = 100;

/** The name of the property used to store an entry's id in JSON form. */
export const JSON_ID_FIELD = 'id';

/** The name of the property used to store an entry's value in JSON form. */
export const JSON_VALUE_FIELD = 'value';

/* -------------------------------------------------------------------------- *
 * Interfaces
 * -------------------------------------------------------------------------- */

/**
 * A single durable memory record stored in the long-term layer.
 *
 * Every entry has a stable `id`, an opaque `value` (anything JSON-serialisable),
 * and a millisecond `createdAt` timestamp.  The remaining fields are optional
 * and let callers enrich the record with semantics the retrieval and lifecycle
 * layers can exploit:
 *
 *   - `importance`   – a float in [0, 1] ranking how valuable the memory is.
 *   - `tags`         – free-form labels used by the tag index and hybrid search.
 *   - `metadata`     – arbitrary structured notes attached to the record.
 *   - `source`       – provenance string (e.g. a channel, tool, or file path).
 *   - `archived`     – soft-delete flag; archived entries stay on disk but are
 *                      excluded from normal retrieval.
 *   - `updatedAt`    – last write timestamp; `lastAccessAt` – last read time.
 */
export interface LongTermEntry {
  /** Stable unique identifier for the entry. */
  id: string;
  /** The stored payload.  Must be JSON-serialisable. */
  value: unknown;
  /** Milliseconds since epoch when the entry was first created. */
  createdAt: number;
  /** Milliseconds since epoch when the entry was last modified. */
  updatedAt?: number;
  /** Milliseconds since epoch when the entry was last read. */
  lastAccessAt?: number;
  /** Normalised importance in [0, 1]; higher is more significant. */
  importance?: number;
  /** Free-form labels used for tag-based retrieval. */
  tags?: string[];
  /** Arbitrary structured notes attached to the record. */
  metadata?: Record<string, unknown>;
  /** Provenance string describing where the memory came from. */
  source?: string;
  /** Soft-delete marker; archived entries are hidden from normal retrieval. */
  archived?: boolean;
}

/**
 * Configuration that shapes the behaviour of a long-term store, index, or
 * lifecycle manager.
 *
 * All fields are optional so that callers can construct configs incrementally
 * (`{ persistPath }` for file-backed storage, `{ maxEntries: 100 }` for a
 * bounded in-memory cache, etc.).
 */
export interface LongTermConfig {
  /**
   * Hard cap on the number of entries retained.  When the store exceeds this
   * size, a prune pass drops the least important / oldest entries.  Defaults
   * to {@link DEFAULT_MAX_ENTRIES}.
   */
  maxEntries: number;
  /**
   * Absolute path of the JSON file used for persistence.  When omitted the
   * store runs purely in memory and {@link LongTermStore.persist} is a no-op
   * (unless a path is supplied at call time).
   */
  persistPath?: string;
  /**
   * Interval, in milliseconds, between automatic persistence sweeps.  Used by
   * {@link LongTermLifecycle}.  Defaults to
   * {@link DEFAULT_PERSIST_INTERVAL_MS}.
   */
  persistIntervalMs?: number;
  /**
   * When true, a store constructed over a `persistPath` will attempt to load
   * the file synchronously in the constructor.  Defaults to `true`.
   */
  autoLoad?: boolean;
  /**
   * Entries whose importance is below this threshold are considered low
   * priority and are the first to be pruned.  Defaults to
   * {@link DEFAULT_IMPORTANCE_THRESHOLD}.
   */
  importanceThreshold?: number;
}

/**
 * Structural statistics describing the current state of a long-term store.
 *
 * Returned by {@link LongTermStore.stats} and mirrored by the index and the
 * lifecycle manager so that callers can monitor memory growth, archived
 * pressure, and persistence health without reaching into internals.
 */
export interface LongTermStats {
  /** Total number of entries currently held (including archived ones). */
  total: number;
  /** Number of archived (soft-deleted) entries. */
  archived: number;
  /** Number of live (non-archived) entries. */
  live: number;
  /** Number of distinct tags in use across all live entries. */
  tags: number;
  /** Number of distinct sources recorded across all live entries. */
  sources: number;
  /** Millisecond timestamp of the most recent mutation. */
  lastWriteAt: number;
  /** Millisecond timestamp of the most recent read. */
  lastReadAt: number;
  /** Millisecond timestamp of the last successful persist. */
  lastPersistAt: number;
  /** Total bytes written by the last persistence (0 if never persisted). */
  lastPersistBytes: number;
  /** True once any entry has been written, read, or persisted. */
  dirty: boolean;
}

/**
 * Per-entry hints accepted by the convenience write APIs
 * (`put`, `remember`, `create`, etc.).  They let callers attach semantics to a
 * value without building a full {@link LongTermEntry} by hand.
 */
export interface LongTermEntryOptions {
  /** Normalised importance in [0, 1]. */
  importance?: number;
  /** Tags to attach to the entry. */
  tags?: string[];
  /** Structured metadata attached to the entry. */
  metadata?: Record<string, unknown>;
  /** Provenance string for the entry. */
  source?: string;
  /** Milliseconds since epoch at which the entry was created. */
  createdAt?: number;
  /** Start the entry in the archived state. */
  archived?: boolean;
  /** Replace the existing entry if `id` is already present (default true). */
  overwrite?: boolean;
}

/**
 * Options that tune a single {@link LongTermStore.persist} / `load` call.
 * These override the store-level configuration for that one operation.
 */
export interface PersistenceOptions {
  /** Override the persistence path for this call only. */
  path?: string;
  /**
   * When `true` (default), load() replaces all in-memory entries with the file
   * contents.  When `false`, file entries are merged into the existing map
   * (in-memory entries win on id collisions).
   */
  replace?: boolean;
  /** Pretty-print the JSON output with two-space indentation. */
  pretty?: boolean;
  /** Throw if the persistence file is missing or malformed.  Defaults false. */
  strict?: boolean;
}

/**
 * Union of inputs accepted by `put` / `putMany` / `remember`.  Callers may
 * either pass a fully-formed {@link LongTermEntry} or a lightweight tuple of
 * `(id, value, options)`.
 */
export type LongTermEntryInput =
  | LongTermEntry
  | { id: string; value: unknown; options?: LongTermEntryOptions };

/**
 * A single weighted retrieval hit produced by the hybrid scorer in
 * `retrieval.ts`.  `score` is a normalised float in [0, 1] where higher means
 * "more relevant to the query".
 */
export interface ScoredLongTermResult {
  /** The matched entry. */
  entry: LongTermEntry;
  /** Weighted relevance score in [0, 1]. */
  score: number;
  /** Breakdown of the score components for debugging / tuning. */
  breakdown: {
    importance: number;
    recency: number;
    match: number;
  };
}

/* -------------------------------------------------------------------------- *
 * Pure helpers
 * -------------------------------------------------------------------------- */

/**
 * Clamps any numeric importance into the inclusive [0, 1] range, defaulting
 * to `0` when the input is missing or non-finite.
 */
export function normalizeImportance(value: number | undefined | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(IMPORTANCE_MAX, Math.max(IMPORTANCE_MIN, value));
}

/**
 * Clamps and normalises a raw importance *including* the ability to preserve
 * `undefined` (i.e. "importance not yet scored").  Used internally so that
 * missing importance scores are not silently converted to zero before they
 * have a chance to be scored.
 */
export function optionalImportance(value: number | undefined): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizeImportance(value);
}

/**
 * Normalises a flexible tag input (single string, iterable of strings, or
 * undefined) into a sorted, de-duplicated, lower-cased array.  Empty strings
 * and whitespace-only tags are dropped; entries with no tags fall back to
 * {@link DEFAULT_TAG}.
 */
export function normalizeTags(tags: string | Iterable<string> | undefined | null): string[] {
  const source: Iterable<string> =
    typeof tags === 'string' ? [tags] : tags ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of source) {
    const tag = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (tag.length === 0 || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    out.push(tag);
  }
  if (out.length === 0) {
    out.push(DEFAULT_TAG);
  }
  return out.sort();
}

/**
 * Returns `true` when a value is structurally a {@link LongTermEntry}, i.e. it
 * has a string `id`, a `value` property, and a numeric `createdAt`.  Used to
 * disambiguate {@link LongTermEntryInput} at runtime.
 */
export function isLongTermEntry(value: unknown): value is LongTermEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    typeof candidate['createdAt'] === 'number'
  );
}

/**
 * Deep-clones a JSON-serialisable value.  Uses `structuredClone` when
 * available and falls back to `JSON.parse(JSON.stringify(...))` for older
 * runtimes.  Functions, symbols, and cyclic structures are not preserved.
 */
export function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      /* structuredClone may fail on exotic values; fall through to JSON. */
    }
  }
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Deep-equality check specialised for entry `value`s.  Primitive and JSON
 * values are compared structurally; this is used by the consolidate pass to
 * detect "duplicate-ish" memories.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, i) => valuesEqual(item, (b as unknown[])[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) =>
    Object.prototype.hasOwnProperty.call(bObj, key) &&
    valuesEqual(aObj[key], bObj[key]),
  );
}

/**
 * Merges a base entry with a patch, producing a new entry.  The id is taken
 * from the base and is immutable; `updatedAt` is always refreshed.  Tag
 * patches replace the full tag list rather than merging, to keep behaviour
 * predictable.  Returns a *new* object; the inputs are never mutated.
 */
export function mergeEntry(
  base: LongTermEntry,
  patch: Partial<Omit<LongTermEntry, 'id'>>,
): LongTermEntry {
  const merged: LongTermEntry = {
    ...base,
    ...patch,
    id: base.id,
    updatedAt: Date.now(),
    value: patch.value !== undefined ? patch.value : base.value,
    createdAt: base.createdAt,
  };
  if (patch.tags !== undefined) {
    merged.tags = normalizeTags(patch.tags);
  } else if (base.tags !== undefined) {
    merged.tags = normalizeTags(base.tags);
  }
  if (patch.metadata !== undefined) {
    merged.metadata = {
      ...(base.metadata ?? {}),
      ...patch.metadata,
    };
  }
  if (patch.importance !== undefined) {
    merged.importance = normalizeImportance(patch.importance);
  }
  return merged;
}

/**
 * Computes the age of an entry in milliseconds relative to `now`.  Uses the
 * entry's `updatedAt` when present, otherwise `createdAt`.
 */
export function entryAgeMs(entry: LongTermEntry, now: number = Date.now()): number {
  return Math.max(0, now - (entry.updatedAt ?? entry.createdAt));
}

/**
 * Roughly estimates the number of bytes an entry occupies when serialised.
 * Used by the lifecycle layer to report store weight without actually
 * serialising the whole store.
 */
export function estimateEntryBytes(entry: LongTermEntry): number {
  let total = entry.id.length * 2 + 16;
  try {
    total += JSON.stringify(entry.value ?? null).length * 2;
  } catch {
    total += 128;
  }
  if (entry.tags) {
    total += entry.tags.reduce((sum, tag) => sum + tag.length * 2 + 8, 0);
  }
  if (entry.source) {
    total += entry.source.length * 2;
  }
  if (entry.metadata) {
    try {
      total += JSON.stringify(entry.metadata).length * 2;
    } catch {
      total += 64;
    }
  }
  return total;
}

/**
 * Throws an `Error` if the supplied id is not a non-empty string.  Guards the
 * store, index, and lifecycle APIs against unusable identifiers.
 */
export function assertValidId(id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new TypeError(
      `Long-term entry ids must be non-empty strings; received ${JSON.stringify(id)}`,
    );
  }
}

/**
 * Validates an entry's invariants: a valid id, a JSON-serialisable value, and
 * a sane `createdAt`.  Throws a descriptive {@link TypeError} on failure.
 */
export function assertValidEntry(entry: LongTermEntry): void {
  assertValidId(entry.id);
  if (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)) {
    throw new TypeError(
      `Entry "${entry.id}" must have a numeric createdAt timestamp`,
    );
  }
  if (entry.importance !== undefined) {
    normalizeImportance(entry.importance); // throws for NaN via clamp; see impl
    if (
      typeof entry.importance !== 'number' ||
      !Number.isFinite(entry.importance)
    ) {
      throw new TypeError(
        `Entry "${entry.id}" importance must be a finite number`,
      );
    }
  }
  try {
    JSON.stringify(entry.value);
  } catch (cause) {
    throw new TypeError(
      `Entry "${entry.id}" value must be JSON-serialisable`,
      { cause },
    );
  }
}

/**
 * Builds a fully-formed {@link LongTermEntry} from an id, a value, and
 * {@link LongTermEntryOptions}.  Timestamps are defaulted to `Date.now()`,
 * tags are normalised, and importance is clamped.
 */
export function buildEntry(
  id: string,
  value: unknown,
  options: LongTermEntryOptions = {},
): LongTermEntry {
  assertValidId(id);
  const createdAt = options.createdAt ?? Date.now();
  const entry: LongTermEntry = {
    id,
    value: cloneValue(value),
    createdAt,
    updatedAt: createdAt,
    lastAccessAt: createdAt,
    tags: normalizeTags(options.tags),
    archived: options.archived ?? false,
  };
  const importance = optionalImportance(options.importance);
  if (importance !== undefined) {
    entry.importance = importance;
  }
  if (options.metadata !== undefined) {
    entry.metadata = cloneValue(options.metadata);
  }
  if (options.source !== undefined) {
    entry.source = options.source;
  }
  assertValidEntry(entry);
  return entry;
}

/**
 * Converts an entry into its JSON-safe serialisable form (a plain object that
 * only contains JSON types).  This is what `LongTermStore.persist` writes.
 */
export function entryToJSON(entry: LongTermEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [JSON_ID_FIELD]: entry.id,
    [JSON_VALUE_FIELD]: cloneValue(entry.value),
    createdAt: entry.createdAt,
  };
  if (entry.updatedAt !== undefined) out['updatedAt'] = entry.updatedAt;
  if (entry.lastAccessAt !== undefined) out['lastAccessAt'] = entry.lastAccessAt;
  if (entry.importance !== undefined) out['importance'] = entry.importance;
  if (entry.tags !== undefined) out['tags'] = [...entry.tags];
  if (entry.metadata !== undefined) out['metadata'] = cloneValue(entry.metadata);
  if (entry.source !== undefined) out['source'] = entry.source;
  if (entry.archived === true) out['archived'] = true;
  return out;
}

/**
 * Parses a JSON-safe object back into a {@link LongTermEntry}, applying the
 * same validation the in-memory API enforces.  Returns `undefined` when the
 * payload is not a valid entry (unless `strict` is true, in which case it
 * throws).
 */
export function entryFromJSON(
  raw: unknown,
  strict = false,
): LongTermEntry | undefined {
  if (typeof raw !== 'object' || raw === null) {
    if (strict) {
      throw new TypeError('Persisted entry must be a JSON object');
    }
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const id = record[JSON_ID_FIELD];
  if (typeof id !== 'string') {
    if (strict) {
      throw new TypeError('Persisted entry is missing a string id');
    }
    return undefined;
  }
  const createdAt = record['createdAt'];
  if (typeof createdAt !== 'number') {
    if (strict) {
      throw new TypeError(`Persisted entry "${id}" is missing createdAt`);
    }
    return undefined;
  }
  const entry: LongTermEntry = {
    id,
    value: record[JSON_VALUE_FIELD],
    createdAt,
  };
  if (typeof record['updatedAt'] === 'number') entry.updatedAt = record['updatedAt'];
  if (typeof record['lastAccessAt'] === 'number') entry.lastAccessAt = record['lastAccessAt'];
  if (typeof record['importance'] === 'number') entry.importance = record['importance'];
  if (Array.isArray(record['tags'])) {
    entry.tags = normalizeTags(record['tags'] as unknown[] as string[]);
  }
  if (typeof record['metadata'] === 'object' && record['metadata'] !== null) {
    entry.metadata = cloneValue(record['metadata'] as Record<string, unknown>);
  }
  if (typeof record['source'] === 'string') entry.source = record['source'];
  if (record['archived'] === true) entry.archived = true;
  assertValidEntry(entry);
  return entry;
}

/**
 * Sorts an array of entries in place by `updatedAt ?? createdAt`, descending
 * (newest first).  Returns the same array for chaining.
 */
export function sortByNewest(entries: LongTermEntry[]): LongTermEntry[] {
  return entries.sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  );
}

/**
 * Sorts an array of entries in place by importance descending.  Entries
 * without an importance score sort last (treated as zero).  Returns the same
 * array for chaining.
 */
export function sortByImportance(entries: LongTermEntry[]): LongTermEntry[] {
  return entries.sort(
    (a, b) => normalizeImportance(b.importance) - normalizeImportance(a.importance),
  );
}

/**
 * Sorts an array of entries in place by `lastAccessAt` descending, falling
 * back to `createdAt`.  Most-recently-used entries sort first.  Returns the
 * same array for chaining.
 */
export function sortByRecency(entries: LongTermEntry[]): LongTermEntry[] {
  return entries.sort(
    (a, b) => (b.lastAccessAt ?? b.createdAt) - (a.lastAccessAt ?? a.createdAt),
  );
}

/**
 * Partitions an array of entries into live and archived buckets.  Archived is
 * defined by the explicit `archived === true` flag.
 */
export function partitionLive(
  entries: LongTermEntry[],
): { live: LongTermEntry[]; archived: LongTermEntry[] } {
  const live: LongTermEntry[] = [];
  const archived: LongTermEntry[] = [];
  for (const entry of entries) {
    (entry.archived === true ? archived : live).push(entry);
  }
  return { live, archived };
}

/**
 * Returns the current millisecond timestamp as a stable ISO date-string bucket
 * key of the form `YYYY-MM-DD`, used by the date index to group entries by
 * day without allocating a `Date` object per entry.
 */
export function dateBucketKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns a human readable rendering of a millisecond duration (e.g. `3.2s`),
 * used by the lifecycle layer when reporting persist/prune timings.
 */
export function formatDuration(ms: number): string {
  if (ms < 1_000) {
    return `${ms.toFixed(1)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1_000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

/**
 * Computes the union of the tag sets present on the given entries, in sorted
 * order.  Used by the consolidation pass to merge tags of duplicate entries.
 */
export function unionTags(entries: LongTermEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      seen.add(tag);
    }
  }
  return [...seen].sort();
}

/**
 * Returns a copy of `entries` with archived entries removed unless
 * `includeArchived` is `true`.
 */
export function filterArchived(
  entries: LongTermEntry[],
  includeArchived = false,
): LongTermEntry[] {
  if (includeArchived) {
    return entries;
  }
  return entries.filter((entry) => entry.archived !== true);
}