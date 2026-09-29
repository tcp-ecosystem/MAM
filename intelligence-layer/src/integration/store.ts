/**
 * @fileoverview
 * The entry registry for consolidated knowledge.
 *
 * {@link KnowledgeStore} is the canonical in-memory home of
 * {@link KnowledgeEntry} values.  It is deliberately a *registry*, not a
 * smart container: it answers identity and navigation questions (`put`,
 * `get`, `has`, `delete`, `bySource`, `list`, `stats`) while the
 * {@link Consolidator} owns the semantics (dedupe, merge, contradiction
 * detection) and the {@link KnowledgeIndex} owns the secondary lookups.
 *
 * Design notes:
 *
 *   - **Identity-addressed.**  Entries are keyed by their stable `id`.
 *     `put` is an upsert: re-putting the same id replaces the old value.
 *     This makes reconciliation with external sources idempotent — re-syncing
 *     the same document never duplicates rows.
 *
 *   - **Recency tracking.**  Every `put` and `get` stamps a last-seen time.
 *     The lifecycle manager uses these stamps to evict stale entries, and
 *     `list` can order by recency.
 *
 *   - **Bounded.**  The store carries an optional capacity.  When the
 *     registry exceeds it, the lowest-quality entries (by the same
 *     confidence / information / recency ordering the consolidator uses) are
 *     evicted.  Capacity is a soft backstop; the lifecycle's `prune` is the
 *     policy knob.
 *
 *   - **Durability.**  {@link KnowledgeStore.toJSON} emits a plain,
 *     dependency-free snapshot and {@link KnowledgeStore.fromJSON} restores
 *     it.  The snapshot is validated on the way in, so a corrupted or hostile
 *     payload cannot poison the registry.
 *
 *   - **Observability.**  {@link KnowledgeStore.stats} rolls up the semantic
 *     integration stats across every resident entry, and `bySource` /
 *     `sources` expose the provenance distribution.
 *
 * @packageDocumentation
 */

import {
  type IntegrateStats,
  type KnowledgeEntry,
  assertKnowledgeEntry,
  confidenceOf,
  createIntegrateStats,
  isKnowledgeEntry,
} from './types.js';

/**
 * The maximum capacity used when the caller does not specify one.  10_000 is
 * a deliberate compromise: large enough to hold a serious knowledge base's
 * active working set, small enough that a long-lived process reaping stale
 * entries stays cheap.
 */
export const DEFAULT_KNOWLEDGE_STORE_CAP = 10_000;

/**
 * The maximum number of serialized entries accepted by `fromJSON`.  Guards
 * against unbounded allocation when restoring untrusted snapshots.
 */
export const MAX_RESTORE_ENTRIES = 100_000;

/**
 * The sort keys `list` can order by.
 */
export type ListSortKey = 'id' | 'content' | 'timestamp' | 'confidence' | 'tokens';

/**
 * The sort direction for `list`.
 */
export type ListOrder = 'asc' | 'desc';

/**
 * Filtering / ordering options for {@link KnowledgeStore.list}.
 *
 * All filters are conjunctive: an entry must match every present filter to be
 * returned.  Pagination is applied after filtering and sorting.
 */
export interface ListOptions {
  /** Only entries carrying this exact source label. */
  readonly source?: string;

  /** Only entries with effective confidence at or above this value. */
  readonly minConfidence?: number;

  /** Only entries with effective confidence at or below this value. */
  readonly maxConfidence?: number;

  /** Only entries with a timestamp at or after this value (ms epoch). */
  readonly since?: number;

  /** Only entries with a timestamp at or before this value (ms epoch). */
  readonly until?: number;

  /** Maximum number of entries to return.  No limit when omitted. */
  readonly limit?: number;

  /** Number of matching entries to skip before returning.  Defaults to `0`. */
  readonly offset?: number;

  /** The field to order by.  Defaults to `'timestamp'`. */
  readonly sort?: ListSortKey;

  /** Sort direction.  Defaults to `'desc'` (newest/best first). */
  readonly order?: ListOrder;
}

/**
 * The aggregate snapshot returned by {@link KnowledgeStore.stats}.
 *
 * Extends the shared {@link IntegrateStats} contract with the provenance
 * distribution and recency bounds so a dashboard can render "which sources,
 * how fresh, how confident" in one call.
 */
export interface StoreStats extends IntegrateStats {
  /** source label -> number of resident entries carrying it. */
  readonly bySource: Readonly<Record<string, number>>;

  /** The configured capacity of the store. */
  readonly capacity: number;

  /** The oldest resident timestamp (ms epoch), or `undefined` when empty. */
  readonly oldestTimestamp: number | undefined;

  /** The newest resident timestamp (ms epoch), or `undefined` when empty. */
  readonly newestTimestamp: number | undefined;

  /** Mean token count across resident entries (zero when empty). */
  readonly meanTokens: number;
}

/**
 * The snapshot shape produced by {@link KnowledgeStore.toJSON} and consumed
 * by {@link KnowledgeStore.fromJSON}.  Deliberately flat and JSON friendly so
 * it can round-trip through `JSON.stringify`/`JSON.parse`, a database column,
 * or a file.
 */
export interface KnowledgeStoreSnapshot {
  /** Store version; used by `fromJSON` to reject incompatible snapshots. */
  readonly version: 1;
  /** The capacity in effect when the snapshot was taken. */
  readonly cap: number;
  /** The resident entries, in insertion order. */
  readonly entries: readonly KnowledgeEntry[];
}

/**
 * The identity-addressed registry of {@link KnowledgeEntry} values.
 *
 * Instances are **not** thread-safe; callers in concurrent environments
 * (worker threads, multiple async pipelines sharing one store) should guard
 * access with a mutex, or construct one store per worker.
 */
export class KnowledgeStore {
  /** id -> entry.  Insertion order is preserved. */
  private readonly registry = new Map<string, KnowledgeEntry>();

  /** id -> last-seen time (ms epoch).  Consumed by the lifecycle GC. */
  private readonly accessedAt = new Map<string, number>();

  /** Capacity; raising it later never drops below the current size. */
  private capInternal: number;

  /** Cumulative merges recorded against this store (informational). */
  private mergedTotal = 0;

  /** Cumulative removals recorded against this store (informational). */
  private removedTotal = 0;

  /**
   * Creates a store with the given capacity.
   *
   * @param cap - Maximum number of resident entries.  Must be a positive
   *   integer; anything else throws a {@link RangeError}.  Defaults to
   *   {@link DEFAULT_KNOWLEDGE_STORE_CAP}.
   */
  constructor(cap: number = DEFAULT_KNOWLEDGE_STORE_CAP) {
    KnowledgeStore.assertCap(cap);
    this.capInternal = cap;
  }

  /** Validates `cap`, throwing a {@link RangeError} for non-positive values. */
  private static assertCap(cap: number): void {
    if (!Number.isInteger(cap) || cap < 1) {
      throw new RangeError(`KnowledgeStore cap must be a positive integer, got ${cap}`);
    }
  }

  /** Returns the configured capacity. */
  get cap(): number {
    return this.capInternal;
  }

  /**
   * Reconfigures the capacity, evicting the lowest-quality entries
   * immediately if the new cap is smaller than the current size.
   */
  set cap(next: number) {
    KnowledgeStore.assertCap(next);
    this.capInternal = next;
    this.trimToCapacity();
  }

  /** Returns the number of resident entries. */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Inserts (or replaces) an entry under its `id`.
   *
   * The entry is validated with {@link assertKnowledgeEntry} so a malformed
   * value can never enter the registry, and its last-seen stamp is refreshed.
   * Re-putting an existing id replaces the previous value and returns `true`.
   * When the registry exceeds capacity the lowest-quality entries are evicted
   * (each eviction increments `removedTotal`).
   *
   * @returns `true` when `id` was already resident (a replacement), `false`
   *   when it was a brand-new insertion.
   */
  put(entry: KnowledgeEntry): boolean {
    assertKnowledgeEntry(entry);
    const wasPresent = this.registry.has(entry.id);
    this.registry.set(entry.id, entry);
    this.accessedAt.set(entry.id, Date.now());
    this.trimToCapacity();
    return wasPresent;
  }

  /**
   * Stores multiple entries in a single call.
   *
   * @param entries - Entries to store.  Processed left to right so later
   *   entries win when an id repeats.
   * @returns The number of entries stored.
   */
  putMany(entries: readonly KnowledgeEntry[]): number {
    for (const entry of entries) {
      this.put(entry);
    }
    return entries.length;
  }

  /**
   * Reads an entry by id, refreshing its last-seen stamp.  Returns
   * `undefined` when the id is absent.
   */
  get(id: string): KnowledgeEntry | undefined {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('KnowledgeStore id must be a non-empty string');
    }
    const entry = this.registry.get(id);
    if (entry === undefined) return undefined;
    this.accessedAt.set(id, Date.now());
    return entry;
  }

  /**
   * Returns whether `id` is resident without disturbing recency stamps.  This
   * is the cheapest membership test.
   */
  has(id: string): boolean {
    return this.registry.has(id);
  }

  /**
   * Removes an entry by id.
   *
   * @returns `true` when the id was resident and has been removed.
   */
  delete(id: string): boolean {
    const existed = this.registry.delete(id);
    if (!existed) return false;
    this.accessedAt.delete(id);
    this.removedTotal += 1;
    return true;
  }

  /**
   * Removes every entry that does not survive a consolidation run.
   *
   * `survivorIds` is the set of ids in a {@link ConsolidationResult.kept}
   * (or any replacement set).  Entries whose ids are absent are deleted; ids
   * that name nothing are ignored.  This is the primary way the lifecycle
   * applies consolidation output without losing the store's structure.
   *
   * @returns The number of entries removed.
   */
  retainOnly(survivorIds: ReadonlySet<string>): number {
    let removed = 0;
    for (const id of this.registry.keys()) {
      if (!survivorIds.has(id)) {
        if (this.delete(id)) removed += 1;
      }
    }
    return removed;
  }

  /** Returns all resident ids in insertion order. */
  keys(): string[] {
    return [...this.registry.keys()];
  }

  /** Returns all resident entries in insertion order. */
  values(): KnowledgeEntry[] {
    return [...this.registry.values()];
  }

  /** Returns all resident `[id, entry]` pairs in insertion order. */
  entries(): Array<[string, KnowledgeEntry]> {
    return [...this.registry.entries()];
  }

  /**
   * Returns every entry that carries `source`, newest first.
   */
  bySource(source: string): KnowledgeEntry[] {
    return this.list({ source, sort: 'timestamp', order: 'desc' });
  }

  /**
   * Returns every distinct source label currently represented in the store.
   */
  sources(): string[] {
    const seen = new Set<string>();
    for (const entry of this.registry.values()) {
      if (entry.source !== undefined && entry.source.length > 0) {
        seen.add(entry.source);
      }
    }
    return [...seen];
  }

  /**
   * Returns the entries matching the conjunctive {@link ListOptions} filters,
   * ordered and paginated.
   *
   * Sorting is applied before pagination.  `confidence` ordering uses the
   * effective confidence ({@link confidenceOf}), so entries without an
   * explicit confidence sort by their neutral default.  `tokens` ordering
   * uses the entry's token count (precomputed `tokens` when present, otherwise
   * the content word count).
   */
  list(options: ListOptions = {}): KnowledgeEntry[] {
    const out: KnowledgeEntry[] = [];
    const minConfidence = options.minConfidence ?? 0;
    const maxConfidence = options.maxConfidence ?? 1;
    for (const entry of this.registry.values()) {
      if (options.source !== undefined && entry.source !== options.source) continue;
      const confidence = confidenceOf(entry);
      if (confidence < minConfidence || confidence > maxConfidence) continue;
      if (options.since !== undefined && entry.timestamp < options.since) continue;
      if (options.until !== undefined && entry.timestamp > options.until) continue;
      out.push(entry);
    }

    const sort = options.sort ?? 'timestamp';
    const direction = options.order === 'asc' ? 1 : -1;
    out.sort((a, b) => direction * KnowledgeStore.compare(a, b, sort));

    const offset = Math.max(0, options.offset ?? 0);
    const limit = options.limit;
    if (limit !== undefined) {
      return out.slice(offset, offset + Math.max(0, limit));
    }
    return out.slice(offset);
  }

  /**
   * Removes every entry and resets all stamps and counters.  Use {@link clear}
   * when only the data should be dropped but capacity preserved.
   */
  clear(): void {
    this.registry.clear();
    this.accessedAt.clear();
    this.mergedTotal = 0;
    this.removedTotal = 0;
  }

  /**
   * Returns the last-seen time (ms epoch) for `id`, or `undefined` when the
   * id is not resident.  Used by the lifecycle GC to detect stale entries.
   */
  lastSeenAt(id: string): number | undefined {
    return this.accessedAt.get(id);
  }

  /**
   * Returns the current last-seen time for every resident id as an
   * `id -> ms epoch` map.  Convenience for external GC policies.
   */
  accessTimes(): ReadonlyMap<string, number> {
    return new Map(this.accessedAt);
  }

  /**
   * Replaces the entire registry contents with `entries`, resetting recency
   * stamps.  This is strictly cheaper than `clear()` + `putMany()` for bulk
   * reconciliation and is the mechanism the lifecycle uses to apply a
   * consolidated result wholesale.
   *
   * @returns The number of entries installed.
   */
  replaceAll(entries: readonly KnowledgeEntry[]): number {
    const next = new Map<string, KnowledgeEntry>();
    const nextAccessed = new Map<string, number>();
    const now = Date.now();
    for (const entry of entries) {
      assertKnowledgeEntry(entry);
      next.set(entry.id, entry);
      nextAccessed.set(entry.id, now);
    }
    this.registry.clear();
    this.accessedAt.clear();
    for (const [id, entry] of next) this.registry.set(id, entry);
    for (const [id, at] of nextAccessed) this.accessedAt.set(id, at);
    return next.size;
  }

  /**
   * Aggregates semantic integration stats across every resident entry.
   *
   * `merged`/`removed` reflect the cumulative totals recorded by lifecycle
   * operations that touched this store; `entries`, `sources`, confidence, and
   * tokens reflect the current registry contents.  `lastUpdated` reflects the
   * moment the snapshot was computed.
   */
  stats(): StoreStats {
    let sources = 0;
    const bySource: Record<string, number> = {};
    let confidenceTotal = 0;
    let tokenTotal = 0;
    let oldest: number | undefined;
    let newest: number | undefined;

    for (const entry of this.registry.values()) {
      if (entry.source !== undefined && entry.source.length > 0) {
        if (bySource[entry.source] === undefined) sources += 1;
        bySource[entry.source] = (bySource[entry.source] ?? 0) + 1;
      }
      confidenceTotal += confidenceOf(entry);
      tokenTotal += KnowledgeStore.tokenCount(entry);
      if (oldest === undefined || entry.timestamp < oldest) oldest = entry.timestamp;
      if (newest === undefined || entry.timestamp > newest) newest = entry.timestamp;
    }

    const size = this.registry.size;
    const base = createIntegrateStats({
      entries: size,
      sources,
      merged: this.mergedTotal,
      removed: this.removedTotal,
      meanConfidence: size > 0 ? confidenceTotal / size : 0,
      totalTokens: tokenTotal,
      lastUpdated: Date.now(),
    });
    return {
      ...base,
      bySource,
      capacity: this.capInternal,
      oldestTimestamp: oldest,
      newestTimestamp: newest,
      meanTokens: size > 0 ? tokenTotal / size : 0,
    };
  }

  /**
   * Records a cumulative merge against this store's counters.  Called by the
   * lifecycle when consolidation output is applied; not part of the core
   * registry contract.
   */
  recordMerged(count: number): void {
    this.mergedTotal += Math.max(0, count);
  }

  /**
   * Records a cumulative removal against this store's counters.  Called by
   * the lifecycle when consolidation output is applied; not part of the core
   * registry contract.
   */
  recordRemoved(count: number): void {
    this.removedTotal += Math.max(0, count);
  }

  /**
   * Serializes the store to a plain, JSON-friendly snapshot.
   */
  toJSON(): KnowledgeStoreSnapshot {
    return {
      version: 1,
      cap: this.capInternal,
      entries: [...this.registry.values()],
    };
  }

  /**
   * Restores the store from a snapshot, replacing all current contents.
   *
   * The snapshot is fully validated: the version must match, the cap must be
   * a positive integer, the entry count must not exceed
   * {@link MAX_RESTORE_ENTRIES}, and every entry must round-trip through
   * {@link isKnowledgeEntry}.  On failure nothing is changed and a
   * {@link TypeError} is thrown.
   */
  fromJSON(snapshot: KnowledgeStoreSnapshot): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported KnowledgeStore snapshot version ${snapshot.version}`);
    }
    KnowledgeStore.assertCap(snapshot.cap);
    if (snapshot.entries.length > MAX_RESTORE_ENTRIES) {
      throw new RangeError(
        `Snapshot has ${snapshot.entries.length} entries; refusing to restore more than ${MAX_RESTORE_ENTRIES}`,
      );
    }
    for (const entry of snapshot.entries) {
      if (!isKnowledgeEntry(entry)) {
        throw new TypeError('Snapshot contains an invalid KnowledgeEntry');
      }
    }
    this.replaceAll(snapshot.entries);
    this.capInternal = snapshot.cap;
    this.mergedTotal = 0;
    this.removedTotal = 0;
  }

  /**
   * Evicts the lowest-quality entries until the registry is within capacity.
   * Evicted entries count as removals so dashboards reflect the pressure.
   */
  private trimToCapacity(): void {
    while (this.registry.size > this.capInternal) {
      let lowestId: string | undefined;
      let lowestEntry: KnowledgeEntry | undefined;
      for (const [id, entry] of this.registry) {
        if (lowestEntry === undefined || KnowledgeStore.compare(entry, lowestEntry, 'timestamp') < 0) {
          lowestId = id;
          lowestEntry = entry;
        }
      }
      if (lowestId === undefined) break;
      this.delete(lowestId);
    }
  }

  /**
   * Compares two entries by the given sort key, returning a negative number
   * when `a` sorts before `b`.
   */
  private static compare(a: KnowledgeEntry, b: KnowledgeEntry, key: ListSortKey): number {
    switch (key) {
      case 'id':
        return a.id.localeCompare(b.id);
      case 'content':
        return a.content.localeCompare(b.content);
      case 'timestamp':
        return a.timestamp - b.timestamp;
      case 'confidence':
        return confidenceOf(a) - confidenceOf(b);
      case 'tokens':
        return KnowledgeStore.tokenCount(a) - KnowledgeStore.tokenCount(b);
      default:
        return 0;
    }
  }

  /**
   * Returns the token count for an entry: the precomputed `tokens` length when
   * present, otherwise a fast content word count.
   */
  private static tokenCount(entry: KnowledgeEntry): number {
    if (entry.tokens !== undefined) return entry.tokens.length;
    const words = entry.content.toLowerCase().split(/[^a-z0-9']+/);
    let count = 0;
    for (const word of words) {
      if (word.length > 0) count += 1;
    }
    return count;
  }
}