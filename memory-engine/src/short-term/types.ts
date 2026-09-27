/**
 * Short-term memory domain types for the MAM Memory Engine.
 *
 * Short-term memory holds the **working set** of an agent or runtime: facts,
 * fragments and intermediate products that are relevant *right now* and that
 * should be allowed to decay once they stop being useful. Unlike semantic
 * memory (which persists timeless facts) or episodic memory (which records
 * temporally-bounded experiences), short-term memory is:
 *
 * - **Ephemeral** — entries may carry a TTL and expire automatically.
 * - **Access-aware** — frequently-accessed entries are kept alive longer and
 *   rank higher during retrieval.
 * - **Bounded** — the store enforces a maximum entry count, evicting the least
 *   recently used entries when the bound is exceeded.
 * - **Scoped** — entries can be tagged and assigned to logical scopes so that
 *   concurrent sessions or subsystems do not bleed into each other.
 *
 * The types in this module form the public contract shared by every other
 * layer of the short-term subsystem:
 *
 * - {@link ShortTermEntry} — the atomic unit of short-term memory.
 * - {@link ShortTermConfig} — construction/behaviour options for stores.
 * - {@link ShortTermStats} — aggregate counters describing a store or index.
 * - {@link ShortTermEntryOptions} — per-write tuning (TTL, tags, scope, ...).
 * - {@link RetentionPolicy} — how a TTL is measured once it is set.
 * - {@link AccessRecord} — the access-tracking metadata used for LRU ranking.
 * - {@link ScoredEntry}, {@link SearchResult}, {@link PruneResult} — the
 *   helper result shapes produced by retrieval and lifecycle operations.
 * - {@link RuntimeMemory} — the uniform key/value surface that the runtime
 *   adapter in `integration.ts` presents to a host runtime.
 *
 * Every type here is plain, JSON-serialisable data. An entry captured in one
 * process can be persisted with {@link ShortTermStore.toJSON} and restored by
 * another process without schema migration, which keeps the layer embeddable
 * in any Node runtime.
 *
 * @packageDocumentation
 * @module short-term/types
 */

/**
 * Unique identifier for a short-term entry.
 *
 * Identifiers are opaque to the short-term layer: callers may use UUIDs,
 * monotonic counters, hashes of the value, or any other scheme, as long as ids
 * are collision-free within a single store. The index and retriever treat ids
 * as plain strings and never inspect their structure.
 */
export type ShortTermId = string;

/**
 * The payload of a short-term entry.
 *
 * Values are intentionally untyped beyond `unknown`: they may be primitive
 * scalars, structured objects, tool outputs, or serialised model responses.
 * The store preserves them verbatim and never parses or interprets them. To
 * guarantee {@link ShortTermStore.toJSON}/{@link ShortTermStore.fromJSON}
 * round-trips, values should be JSON-serialisable (or at least serialisable by
 * the store's configured clone strategy).
 */
export type ShortTermValue = unknown;

/**
 * Milliseconds-since-epoch timestamp.
 *
 * All wall-clock values in the short-term layer use epoch milliseconds so that
 * they interoperate cleanly with `Date.now()` and `performance.now()` derived
 * clocks and so that TTL arithmetic does not need to deal with calendar
 * complexity.
 */
export type Timestamp = number;

/**
 * Unstructured, caller-owned metadata attached to an entry.
 *
 * Metadata is preserved verbatim and never interpreted by the short-term
 * layer. It is the natural home for provenance (model names, trace ids,
 * confidence scores), routing hints, or any domain payload the caller wants to
 * carry alongside the value without polluting the value itself.
 */
export type ShortTermMetadata = Record<string, unknown>;

/**
 * Logical grouping name for a set of entries.
 *
 * Scopes provide a coarse-grained partitioning mechanism on top of tags:
 * typically one scope per session, subsystem or agent instance. The store does
 * not enforce scope isolation by itself — enforcement is the responsibility of
 * the {@link ShortTermSession} and runtime adapter layers — but every entry may
 * record the scope it belongs to so that retrieval can filter on it cheaply.
 */
export type ShortTermScope = string;

/**
 * How an entry's TTL is measured once a `ttlMs` value is present.
 *
 * Three retention behaviours are supported, giving callers a choice between
 * "keep it for a fixed window" and "keep it as long as it keeps being used":
 *
 * - `'fixed'` — the entry expires `ttlMs` milliseconds after it was
 *   **created**. Reads and touches do not extend its life. Suitable for
 *   leases, one-shot prompts and request-scoped scratch space.
 * - `'sliding'` (default) — the expiry deadline is recomputed from the entry's
 *   **most recent activity** (`updatedAt`). Every `get`, `touch` or `update`
 *   pushes the deadline forward, so an actively-used entry never expires. This
 *   matches how human working memory keeps relevant items alive.
 * - `'persistent'` — the entry never expires, regardless of `ttlMs`. It can
 *   still be evicted by the maximum-entry-count bound.
 *
 * The policy is recorded per entry at write time and serialised into the
 * store snapshot so that a restored store preserves the same expiry behaviour.
 */
export type RetentionPolicy = 'fixed' | 'sliding' | 'persistent';

/**
 * Access-tracking metadata maintained for every entry.
 *
 * The store keeps an {@link AccessRecord} for each entry so it can answer two
 * questions cheaply: *which entries have been used most often* (frequency
 * ranking) and *which entry should be evicted next* (LRU ordering). The record
 * is updated on every `get`, `peek`-freeing `touch`, and `update`, and it is
 * exposed through the entry's `accessCount` and `lastAccessAt` fields.
 */
export interface AccessRecord {
  /**
   * Number of times the entry has been accessed since it was stored.
   *
   * Incremented by {@link ShortTermStore.get} and
   * {@link ShortTermStore.touch}; never reset by eviction attempts that fail.
   */
  readonly accessCount: number;

  /**
   * Epoch-millisecond time of the most recent access.
   *
   * The store uses this as the LRU key when the entry set exceeds
   * `maxEntries`; the entry with the oldest `lastAccessAt` is evicted first.
   * A newly-written entry that has never been read uses `createdAt`.
   */
  readonly lastAccessAt: Timestamp;

  /**
   * Epoch-millisecond time of the first access after the entry was written.
   *
   * `null` means the entry has never been read since it was stored. This is
   * useful for diagnosing "written but never consumed" entries.
   */
  readonly firstAccessAt: Timestamp | null;
}

/**
 * The atomic unit of short-term memory: one value plus its bookkeeping.
 *
 * An entry is the persistence record inside the store. It is intentionally
 * immutable from the store's point of view — mutations go through
 * {@link ShortTermStore.update} or a fresh {@link ShortTermStore.put}, never
 * by editing a returned reference — so that callers can cache and share entry
 * objects without corrupting the store.
 *
 * @example
 * ```ts
 * const entry: ShortTermEntry = {
 *   id: 'fact:42',
 *   value: { role: 'assistant', snippet: '...' },
 *   createdAt: Date.now(),
 *   updatedAt: Date.now(),
 *   ttlMs: 60_000,
 *   lastAccessAt: Date.now(),
 *   accessCount: 3,
 *   tags: ['draft', 'tool-output'],
 *   metadata: { traceId: 'abc-123' },
 *   scope: 'session:user-7',
 * };
 * ```
 */
export interface ShortTermEntry {
  /**
   * Unique identifier of the entry. See {@link ShortTermId}.
   */
  readonly id: ShortTermId;

  /**
   * The stored payload. Preserved verbatim; see {@link ShortTermValue}.
   */
  readonly value: ShortTermValue;

  /**
   * Epoch-millisecond time at which the entry was created.
   *
   * This is the reference point for `'fixed'` retention and for recency
   * scoring during retrieval (newer entries outrank older ones).
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the entry's most recent mutation.
   *
   * Refreshed on every `put`, `update` and (for `'sliding'` retention) every
   * `get`/`touch`. For `'sliding'` retention this is the base from which the
   * TTL deadline is computed.
   */
  readonly updatedAt?: Timestamp;

  /**
   * Time-to-live in milliseconds, when the entry is meant to expire.
   *
   * `undefined` (or a non-positive value) means the entry does not expire on
   * its own and will only be removed by explicit deletion or by the maximum-
   * entry-count eviction policy. See {@link RetentionPolicy} for how the TTL
   * is measured.
   */
  readonly ttlMs?: number;

  /**
   * Epoch-millisecond time of the most recent access.
   *
   * `undefined` indicates the entry has never been read. This is the LRU key
   * used when the store must evict an entry to stay within `maxEntries`.
   */
  readonly lastAccessAt?: Timestamp;

  /**
   * Number of times the entry has been read or touched since storage.
   *
   * Starts at `0` on write and is incremented by `get`/`touch`. Retrievers use
   * it as the frequency signal for {@link ShortTermRetriever.frequent} and for
   * the frequency component of hybrid scoring.
   */
  readonly accessCount: number;

  /**
   * Optional set of tags for cross-cutting classification.
   *
   * Tags are lower-cased, trimmed and deduplicated at write time (when
   * {@link ShortTermConfig.normalizeTags} is enabled, the default) and are
   * indexed by {@link ShortTermIndex.findByTag}.
   */
  readonly tags?: readonly string[];

  /**
   * Caller-owned structured context. Preserved verbatim. See
   * {@link ShortTermMetadata}.
   */
  readonly metadata?: ShortTermMetadata;

  /**
   * Optional logical grouping for the entry. See {@link ShortTermScope}.
   */
  readonly scope?: ShortTermScope;
}

/**
 * Configuration options for a short-term store, index or runtime adapter.
 *
 * All fields are optional; the defaults are chosen to be safe for general use
 * (bounded memory, sliding-window expiry, periodic pruning, normalised tags).
 */
export interface ShortTermConfig {
  /**
   * Upper bound on the number of entries the store may hold.
   *
   * When a write would push the count above this value the store evicts the
   * least-recently-accessed entries until the bound is satisfied. `0` (default
   * `1000`) disables the bound — use with care, since memory is then
   * unbounded. A negative value is clamped to `0` (unbounded).
   */
  readonly maxEntries?: number;

  /**
   * Default TTL in milliseconds applied to entries written without an explicit
   * `ttlMs`.
   *
   * `undefined` (default) means entries do not expire by default; callers opt
   * into expiry per-write with {@link ShortTermEntryOptions.ttlMs}.
   */
  readonly defaultTtlMs?: number;

  /**
   * Interval in milliseconds at which {@link ShortTermLifecycle.start} runs an
   * automatic prune pass.
   *
   * `undefined` (default `30_000`) disables automatic pruning when the
   * lifecycle is started without an explicit value.
   */
  readonly pruneIntervalMs?: number;

  /**
   * Default scope assigned to entries written without an explicit scope.
   *
   * When set, every entry in the store is attributable to a single logical
   * partition unless the caller overrides it per-write. This is how
   * {@link ShortTermSession} isolates one session's memory.
   */
  readonly scope?: ShortTermScope;

  /**
   * Default retention behaviour applied to entries written without an explicit
   * policy. See {@link RetentionPolicy}. Defaults to `'sliding'`.
   */
  readonly retention?: RetentionPolicy;

  /**
   * When `true` (default), entry tags are lower-cased, trimmed and
   * deduplicated before storage and indexing. Disable only when tag casing is
   * meaningful to the caller.
   */
  readonly normalizeTags?: boolean;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps.
   *
   * Injecting a clock makes the layer deterministic under test and lets
   * callers drive simulated time forwards without sleeping.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate statistics describing the contents of a short-term store.
 *
 * Returned by {@link ShortTermStore.stats}, {@link ShortTermRuntimeAdapter.stats}
 * and {@link ShortTermSession.stats}. Several fields are derived on demand
 * rather than cached, guaranteeing freshness at the cost of an O(n) scan for
 * very large stores.
 */
export interface ShortTermStats {
  /**
   * Total number of entries currently held.
   */
  readonly totalEntries: number;

  /**
   * Rough estimate of the total memory footprint of the stored values in
   * bytes.
   *
   * Computed by serialising each value (and its metadata) and summing the
   * UTF-8 byte lengths. Values that cannot be serialised contribute a nominal
   * per-entry estimate instead, so the figure is an approximation suitable for
   * capacity planning, not an exact measurement.
   */
  readonly totalBytesEstimate: number;

  /**
   * Fraction of `get`/`getMany` lookups that hit an existing entry, in
   * `[0, 1]`.
   *
   * Computed as `hits / (hits + misses)`; `1` when no lookups have happened
   * yet (vacuously perfect) and `0` when every lookup so far has missed.
   */
  readonly hitRate: number;

  /**
   * Total number of entries evicted to enforce the `maxEntries` bound.
   *
   * Expirations caused by TTL are *not* counted here — they are reported
   * separately by {@link ShortTermStats.ttlExpirations}. A growing eviction
   * count with a stable entry count suggests the store is at capacity.
   */
  readonly evictions: number;

  /**
   * Epoch-millisecond timestamp of the oldest entry's `createdAt`, or `null`
   * when the store is empty.
   */
  readonly oldestTs: Timestamp | null;

  /**
   * Epoch-millisecond timestamp of the newest entry's `createdAt`, or `null`
   * when the store is empty.
   */
  readonly newestTs: Timestamp | null;

  /**
   * Total number of lookups that hit an existing entry.
   */
  readonly hits: number;

  /**
   * Total number of lookups that missed (key absent or already expired).
   */
  readonly misses: number;

  /**
   * Total number of entries removed because their TTL elapsed.
   */
  readonly ttlExpirations: number;
}

/**
 * Per-write options accepted by `put`, `set`, and the runtime adapter.
 *
 * These options let a single write override the store-level defaults for that
 * entry only. Any field left `undefined` falls back to the corresponding
 * {@link ShortTermConfig} default.
 */
export interface ShortTermEntryOptions {
  /**
   * TTL in milliseconds for this entry. Overrides
   * {@link ShortTermConfig.defaultTtlMs}. `0` or negative clears any default,
   * making the entry non-expiring.
   */
  readonly ttlMs?: number;

  /**
   * Tags for this entry. Overrides nothing (tags are per-entry by nature) and
   * is normalised per {@link ShortTermConfig.normalizeTags}.
   */
  readonly tags?: readonly string[];

  /**
   * Scope for this entry. Overrides {@link ShortTermConfig.scope}.
   */
  readonly scope?: ShortTermScope;

  /**
   * Caller-owned metadata attached to the entry. See {@link ShortTermMetadata}.
   */
  readonly metadata?: ShortTermMetadata;

  /**
   * Retention behaviour for this entry. Overrides
   * {@link ShortTermConfig.retention}.
   */
  readonly retention?: RetentionPolicy;
}

/**
 * Input shape accepted by {@link ShortTermStore.put} and
 * {@link ShortTermStore.putMany}.
 *
 * Bundles the value with its per-write options. The store resolves the
 * options against the configured defaults, stamps `createdAt`/`updatedAt`,
 * initialises the access record, and produces the canonical
 * {@link ShortTermEntry}.
 */
export interface ShortTermEntryInput {
  /**
   * Unique identifier for the entry. Overwriting an existing id replaces the
   * stored entry wholesale.
   */
  readonly id: ShortTermId;

  /**
   * The payload to store. See {@link ShortTermValue}.
   */
  readonly value: ShortTermValue;

  /**
   * Optional per-write tuning. See {@link ShortTermEntryOptions}.
   */
  readonly options?: ShortTermEntryOptions;
}

/**
 * An entry paired with the score assigned to it by a retrieval operation.
 *
 * All retrieval entry points — `recent`, `frequent`, `tagged`, `scoped` and
 * `hybrid` — return {@link ScoredEntry}s sorted in descending order of
 * `score`, so consumers can slice the top-k directly.
 */
export interface ScoredEntry {
  /**
   * The retrieved entry itself.
   */
  readonly entry: ShortTermEntry;

  /**
   * Relevance score in `[0, 1]`. Higher is more relevant.
   *
   * The score's exact meaning depends on the strategy that produced it:
   * `recent` scores pure recency, `frequent` pure frequency, `tagged`/`scoped`
   * the strength of the tag/scope match, and `hybrid` a weighted blend of
   * recency, frequency and text match.
   */
  readonly score: number;

  /**
   * Human-readable explanation of why this score was assigned.
   *
   * Useful for debugging retrieval decisions and for explaining results to
   * users ("matched tag `project:alpha`", "newest of 12 entries", ...).
   */
  readonly reason: string;
}

/**
 * Result of a text search across the indexed short-term entries.
 *
 * Produced by {@link ShortTermIndex.findByText} and
   * {@link ShortTermRetriever.hybrid} when a query term is supplied.
 */
export interface SearchResult {
  /**
   * The (normalised) query that produced this result.
   */
  readonly query: string;

  /**
   * Total number of entries that matched, before any limit was applied.
   */
  readonly total: number;

  /**
   * The matching entries, best match first.
   */
  readonly results: readonly ScoredEntry[];

  /**
   * Epoch-millisecond time at which the search was executed.
   */
  readonly timestamp: Timestamp;
}

/**
 * Report produced by pruning and eviction operations.
 *
 * Returned by {@link ShortTermStore.prune}, {@link ShortTermStore.evict},
 * {@link ShortTermLifecycle.prune}, {@link ShortTermLifecycle.evict},
 * {@link ShortTermLifecycle.purgeExpired} and the lifecycle's `'prune'` /
 * `'evict'` events.
 */
export interface PruneResult {
  /**
   * Number of entries removed because their TTL elapsed.
   */
  readonly expired: number;

  /**
   * Number of entries removed to satisfy the `maxEntries` bound.
   */
  readonly evicted: number;

  /**
   * Total number of entries removed (`expired + evicted`).
   */
  readonly removed: number;

  /**
   * Number of entries remaining after the operation.
   */
  readonly remaining: number;

  /**
   * Ids of the entries that were removed, for index synchronisation.
   */
  readonly removedIds: readonly ShortTermId[];

  /**
   * Epoch-millisecond time at which the operation ran.
   */
  readonly timestamp: Timestamp;
}

/**
 * Statistics describing the contents of a {@link ShortTermIndex}.
 *
 * Returned by {@link ShortTermIndex.stats}. All counts are derived on demand.
 */
export interface ShortTermIndexStats {
  /**
   * Total number of entries currently indexed.
   */
  readonly totalEntries: number;

  /**
   * Total number of distinct tags across all indexed entries.
   */
  readonly distinctTags: number;

  /**
   * Total number of distinct scopes across all indexed entries.
   */
  readonly distinctScopes: number;

  /**
   * Number of entries indexed for text search (those with a string value or
   * string metadata).
   */
  readonly textIndexed: number;

  /**
   * Number of tags that appear on at least two entries.
   */
  readonly sharedTags: number;

  /**
   * Map from tag to the number of entries carrying it. Only tags that appear
   * at least once are present.
   */
  readonly tagFrequency: Readonly<Record<string, number>>;

  /**
   * Map from scope to the number of entries in it. Only scopes that appear at
   * least once are present.
   */
  readonly scopeFrequency: Readonly<Record<string, number>>;
}

/**
 * Canonical serialisable shape used by {@link ShortTermStore.toJSON}.
 *
 * Persisting the store as a single object — rather than a bare array — gives
 * the format room to grow (versioning, config, per-entry retention policies)
 * without breaking existing dumps.
 */
export interface ShortTermSnapshot {
  /**
   * Format version. Bumped whenever the serialised layout changes.
   */
  readonly version: 1;

  /**
   * The config in effect when the snapshot was produced. Restoring with
   * {@link ShortTermStore.fromJSON} prefers the stored config for
   * un-specified fields.
   */
  readonly config: Readonly<ShortTermConfig>;

  /**
   * The entries held by the store, in insertion order.
   */
  readonly entries: readonly ShortTermEntry[];

  /**
   * Per-entry retention policies, keyed by entry id.
   *
   * Entries absent from this map use the store's default retention. Policies
   * are stored separately from the entry so that the public
   * {@link ShortTermEntry} shape stays clean.
   */
  readonly policies: Readonly<Record<ShortTermId, RetentionPolicy>>;

  /**
   * Cumulative access and eviction counters, so restored stores keep
   * meaningful stats across serialisation.
   */
  readonly counters: {
    readonly hits: number;
    readonly misses: number;
    readonly evictions: number;
    readonly ttlExpirations: number;
  };

  /**
   * Wall-clock time at which the snapshot was created.
   */
  readonly savedAt: Timestamp;
}

/**
 * Uniform key/value memory surface implemented by
 * {@link ShortTermRuntimeAdapter}.
 *
 * The adapter deliberately mirrors the same contract used by the semantic and
 * episodic runtime adapters (see the episodic `RuntimeMemory` interface) so
 * that a working-memory store, a semantic store and an episodic store can be
 * swapped behind the same consumer. Every method is asynchronous because the
 * interface is designed to be dropped into runtimes that may eventually back
 * the store with a disk, database or remote cache — today the in-memory
 * implementation simply resolves immediately.
 */
export interface RuntimeMemory {
  /**
   * Store a value under a key, replacing any previous value with the same key.
   *
   * @param key - the identifier to store under
   * @param value - the payload to store
   * @param options - optional per-write tuning (TTL, tags, scope, metadata)
   */
  set(key: string, value: unknown, options?: ShortTermEntryOptions): Promise<void>;

  /**
   * Retrieve the value stored under a key, or `undefined` when absent (or
   * expired).
   */
  get(key: string): Promise<unknown>;

  /**
   * Remove the value stored under a key. Resolves `true` if a value existed.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Whether a key currently holds a non-expired value.
   */
  has(key: string): Promise<boolean>;

  /**
   * All currently-held keys (non-expired).
   */
  keys(): Promise<string[]>;

  /**
   * Remove all values.
   */
  clear(): Promise<void>;

  /**
   * Aggregate statistics about the current contents. See {@link ShortTermStats}.
   */
  stats(): Promise<ShortTermStats>;
}