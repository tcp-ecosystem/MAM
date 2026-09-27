/**
 * Cache store for the Ranking layer of the standalone MAM Knowledge Engine.
 *
 * {@link RankingStore} is a bounded, TTL-aware, LRU-ish cache of ranked
 * results keyed by normalised query text. It exists so that repeated ranking
 * passes over the same query — a common pattern when a UI refreshes or a
 * pipeline re-runs — do not re-scan and re-score the candidate pool.
 *
 * Responsibilities:
 *
 * - **Write** — {@link RankingStore.put} / {@link RankingStore.putMany} insert
 *   results with per-entry timestamps and an optional custom TTL.
 * - **Read** — {@link RankingStore.get} serves fresh entries (bumping their
 *   access counters) and transparently drops expired ones, counting cache
 *   hits and misses.
 * - **Mutate** — {@link RankingStore.update} applies an in-place updater to a
 *   cached result; {@link RankingStore.getByQuery} is the query-aware read.
 * - **Bounds** — {@link RankingStore.prune} enforces the capacity cap by
 *   evicting the least-recently-accessed entries, and
 *   {@link RankingStore.sweepExpired} removes entries past their TTL.
 * - **Inspect** — {@link RankingStore.size}, {@link RankingStore.keys} and
 *   {@link RankingStore.stats} expose live state without disturbing it.
 * - **Persist** — {@link RankingStore.toJSON} / {@link RankingStore.fromJSON}
 *   (and the instance {@link RankingStore.load}) round-trip the cache through
 *   plain JSON so a warm cache can be saved to disk and restored.
 *
 * The store extends `node:events`' `EventEmitter` and emits a `'cache'` event
 * carrying a {@link RankingLifecycleEvent} on every mutating or notable read,
 * which lets {@link RankingLifecycle} observe and react without polling.
 *
 * The store is deliberately query-key oriented: it does not score or rank
 * anything itself, it simply remembers the outputs of {@link KnowledgeRanker}
 * for later reuse. Its eviction policy is *recency* based — the least recently
 * accessed entry is evicted first when the capacity cap is hit — which
 * combines LRU discipline with a simple O(n) scan that is cheap at the cache
 * sizes involved here.
 *
 * @module ranking/store
 */

import { EventEmitter } from 'node:events';

import {
  DEFAULT_MAX_CACHE_SIZE,
  DEFAULT_TTL_MS,
  clamp,
  normalizeText,
} from './types.js';
import type {
  RankingLifecycleEvent,
  RankingQuery,
  RankingResult,
  RankingStats,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link RankingStore}.
 */
export interface RankingStoreOptions {
  /**
   * Time-to-live in milliseconds for cached results. `0` disables expiry
   * (entries live until pruned or cleared). Defaults to {@link DEFAULT_TTL_MS}.
   */
  readonly ttlMs: number;

  /**
   * Maximum number of entries retained before least-recently-accessed
   * eviction kicks in. `0` disables the cap. Defaults to
   * {@link DEFAULT_MAX_CACHE_SIZE}.
   */
  readonly maxCacheSize: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the store
   * deterministic under test.
   */
  readonly now: () => Timestamp;
}

/**
 * A single cached entry: the stored {@link RankingResult} plus the bookkeeping
 * the store needs to enforce TTL and recency eviction.
 */
export interface CacheEntry {
  /**
   * The canonical cache key (normalised query text).
   */
  readonly key: string;

  /**
   * The query that produced the cached result.
   */
  readonly query: RankingQuery;

  /**
   * The cached ranked result.
   */
  result: RankingResult;

  /**
   * Epoch-millisecond time the entry was first written.
   */
  readonly insertedAt: Timestamp;

  /**
   * Epoch-millisecond time the entry expires (`null` = never).
   */
  readonly expiresAt: Timestamp | null;

  /**
   * Epoch-millisecond time the entry was last read.
   */
  lastAccessedAt: Timestamp;

  /**
   * Number of times the entry has been served by {@link RankingStore.get}.
   */
  hits: number;
}

/**
 * Live statistics for a {@link RankingStore}.
 *
 * Counter fields are monotonically increasing from construction; size fields
 * reflect the current map state.
 */
export interface RankingStoreStats {
  /**
   * Current number of cached entries.
   */
  readonly size: number;

  /**
   * Total cache hits (fresh entry served) since construction.
   */
  readonly hits: number;

  /**
   * Total cache misses (absent or expired) since construction.
   */
  readonly misses: number;

  /**
   * Total entries written since construction.
   */
  readonly inserted: number;

  /**
   * Total entries evicted for capacity since construction.
   */
  readonly evicted: number;

  /**
   * Total entries evicted by {@link RankingStore.prune} since construction.
   */
  readonly pruned: number;

  /**
   * Total entries dropped as expired since construction.
   */
  readonly expired: number;

  /**
   * Average number of hits per live entry, or `0` when the store is empty.
   */
  readonly averageHitsPerEntry: number;

  /**
   * Epoch-millisecond time of the oldest live entry, or `null`.
   */
  readonly oldestEntryAt: Timestamp | null;

  /**
   * Epoch-millisecond time of the newest live entry, or `null`.
   */
  readonly newestEntryAt: Timestamp | null;

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;
}

/**
 * JSON-serialisable snapshot of a {@link RankingStore} produced by
 * {@link RankingStore.toJSON} and consumed by {@link RankingStore.fromJSON}.
 */
export interface RankingStoreJSON {
  /**
   * Format version for forward-compatible migrations.
   */
  readonly version: number;

  /**
   * Epoch-millisecond time the store was created.
   */
  readonly createdAt: Timestamp;

  /**
   * The cached entries, as plain tuples.
   */
  readonly entries: ReadonlyArray<{
    readonly key: string;
    readonly query: RankingQuery;
    readonly result: RankingResult;
    readonly insertedAt: Timestamp;
    readonly expiresAt: Timestamp | null;
    readonly lastAccessedAt: Timestamp;
    readonly hits: number;
  }>;
}

/**
 * Discriminated detail payload carried on the store's `'cache'` events.
 */
export type RankingStoreEvent =
  | { readonly op: 'put'; readonly key: string }
  | { readonly op: 'get'; readonly key: string; readonly hit: boolean }
  | { readonly op: 'delete'; readonly key: string }
  | { readonly op: 'clear'; readonly count: number }
  | { readonly op: 'evict'; readonly key: string; readonly reason: 'lru' | 'expired' | 'prune' };

/**
 * A bounded, TTL-aware cache of ranked results keyed by query.
 *
 * See the module documentation for a full walkthrough. The store never scores
 * anything itself; it remembers {@link RankingResult}s and exposes the
 * bookkeeping ({@link RankingStore.stats}, {@link RankingStore.toJSON}) that
 * makes caching observable and persistent.
 *
 * @example
 * ```ts
 * const store = new RankingStore({ ttlMs: 30_000, maxCacheSize: 100 });
 * store.put('what is mcp', result);
 * const cached = store.getByQuery({ text: 'what is MCP?' }); // hit — keys normalise
 * console.log(store.stats().hits); // 1
 * store.prune(10); // shrink to at most 10 entries
 * ```
 */
export class RankingStore extends EventEmitter {
  private readonly _entries: Map<string, CacheEntry> = new Map();
  private readonly _options: RankingStoreOptions;
  private readonly _createdAt: Timestamp;
  private _hits = 0;
  private _misses = 0;
  private _inserted = 0;
  private _evicted = 0;
  private _pruned = 0;
  private _expired = 0;

  /**
   * Construct a store.
   *
   * @param options - partial {@link RankingStoreOptions}; omitted fields use
   *   the defaults
   */
  constructor(options: Partial<RankingStoreOptions> = {}) {
    super();
    this._options = {
      ttlMs: clamp(options.ttlMs ?? DEFAULT_TTL_MS, 0, Number.MAX_SAFE_INTEGER),
      maxCacheSize: clamp(options.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE, 0, Number.MAX_SAFE_INTEGER),
      now: options.now ?? (() => Date.now()),
    };
    this._createdAt = this._options.now();
  }

  /**
   * The resolved store options.
   */
  get options(): Readonly<RankingStoreOptions> {
    return this._options;
  }

  /**
   * The number of live entries currently cached.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * Derive the canonical cache key for a query.
   *
   * Keys are the normalised, lower-cased query text, so `"What is MCP?"` and
   * `"what  is mcp"` address the same entry.
   *
   * @param query - the query to key
   * @returns the canonical key (may be `''` for an empty query)
   */
  static keyForQuery(query: RankingQuery): string {
    return normalizeText(query?.text);
  }

  /**
   * Write a result under a cache key.
   *
   * A fresh entry is stamped with the current time; a re-put of an existing key
   * preserves the original `insertedAt` and bumps the hit counter. After the
   * write, the store evicts least-recently-accessed entries if the capacity
   * cap was exceeded.
   *
   * @param key - the cache key (usually {@link RankingStore.keyForQuery})
   * @param result - the ranked result to cache
   * @param ttlMs - optional per-entry TTL override; `null`/negative disables
   *   expiry for this entry
   * @returns the stored entry
   */
  put(key: string, result: RankingResult, ttlMs?: number): CacheEntry {
    const now = this._options.now();
    const effectiveTtl = ttlMs === undefined ? this._options.ttlMs : ttlMs;
    const expiresAt = effectiveTtl > 0 ? now + effectiveTtl : null;
    const existing = this._entries.get(key);
    const entry: CacheEntry = {
      key,
      query: result.query,
      result,
      insertedAt: existing ? existing.insertedAt : now,
      expiresAt,
      lastAccessedAt: now,
      hits: existing ? existing.hits + 1 : 1,
    };
    this._entries.set(key, entry);
    this._inserted += 1;
    this._evictIfOverCapacity();
    this._emit({ op: 'put', key });
    return entry;
  }

  /**
   * Write many results in one pass.
   *
   * @param entries - `[key, result]` tuples to cache
   * @param ttlMs - optional per-entry TTL override
   * @returns the number of entries written
   */
  putMany(entries: ReadonlyArray<readonly [string, RankingResult]>, ttlMs?: number): number {
    let added = 0;
    for (const [key, result] of entries) {
      this.put(key, result, ttlMs);
      added += 1;
    }
    return added;
  }

  /**
   * Read a result by cache key.
   *
   * Expired entries are removed on read and counted as misses. Fresh reads
   * bump the entry's `hits` and `lastAccessedAt`.
   *
   * @param key - the cache key
   * @returns the cached result, or `undefined` on miss
   */
  get(key: string): RankingResult | undefined {
    const entry = this._entries.get(key);
    if (!entry) {
      this._misses += 1;
      this._emit({ op: 'get', key, hit: false });
      return undefined;
    }
    if (this._isExpired(entry)) {
      this._entries.delete(key);
      this._expired += 1;
      this._misses += 1;
      this._emit({ op: 'evict', key, reason: 'expired' });
      this._emit({ op: 'get', key, hit: false });
      return undefined;
    }
    entry.hits += 1;
    entry.lastAccessedAt = this._options.now();
    this._hits += 1;
    this._emit({ op: 'get', key, hit: true });
    return entry.result;
  }

  /**
   * Read a result by query, deriving the key automatically.
   *
   * @param query - the query to look up
   * @returns the cached result, or `undefined` on miss
   */
  getByQuery(query: RankingQuery): RankingResult | undefined {
    return this.get(RankingStore.keyForQuery(query));
  }

  /**
   * Test whether a key is currently cached (and not expired).
   *
   * @param key - the cache key
   * @returns `true` when a fresh entry exists
   */
  has(key: string): boolean {
    const entry = this._entries.get(key);
    if (!entry) {
      return false;
    }
    if (this._isExpired(entry)) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove a cache entry.
   *
   * @param key - the cache key
   * @returns `true` when an entry was actually removed
   */
  delete(key: string): boolean {
    const removed = this._entries.delete(key);
    if (removed) {
      this._emit({ op: 'delete', key });
    }
    return removed;
  }

  /**
   * Apply an in-place updater to a cached result.
   *
   * The updater receives the current result and returns the replacement. The
   * entry's `lastAccessedAt` is refreshed. No-op for missing or expired keys.
   *
   * @param key - the cache key
   * @param updater - the mutation callback
   * @returns `true` when an entry was updated
   */
  update(key: string, updater: (result: RankingResult) => RankingResult): boolean {
    const entry = this._entries.get(key);
    if (!entry || this._isExpired(entry)) {
      return false;
    }
    entry.result = updater(entry.result);
    entry.lastAccessedAt = this._options.now();
    return true;
  }

  /**
   * Remove all entries.
   *
   * @returns the number of entries cleared
   */
  clear(): number {
    const count = this._entries.size;
    this._entries.clear();
    if (count > 0) {
      this._emit({ op: 'clear', count });
    }
    return count;
  }

  /**
   * List the keys of all live entries.
   *
   * Expired entries are dropped as a side effect so the returned list is
   * always fresh.
   *
   * @returns the live cache keys
   */
  keys(): string[] {
    const now = this._options.now();
    const expired: string[] = [];
    const keys: string[] = [];
    for (const [key, entry] of this._entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        expired.push(key);
      } else {
        keys.push(key);
      }
    }
    for (const key of expired) {
      this.delete(key);
    }
    return keys;
  }

  /**
   * Remove every entry past its TTL.
   *
   * @returns the number of entries swept
   */
  sweepExpired(): number {
    const now = this._options.now();
    let removed = 0;
    for (const [key, entry] of this._entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        this._entries.delete(key);
        this._expired += 1;
        removed += 1;
        this._emit({ op: 'evict', key, reason: 'expired' });
      }
    }
    return removed;
  }

  /**
   * Shrink the cache to at most `maxEntries` live entries.
   *
   * Eviction removes the least-recently-accessed entries first, so
   * frequently-used queries survive a prune.
   *
   * @param maxEntries - the target maximum size (clamped to `>= 0`)
   * @returns the number of entries evicted
   */
  prune(maxEntries: number): number {
    const target = Math.max(0, Math.floor(maxEntries));
    let removed = 0;
    while (this._entries.size > target) {
      const victim = this._leastRecentlyUsed();
      if (!victim) {
        break;
      }
      this._entries.delete(victim.key);
      this._pruned += 1;
      removed += 1;
      this._emit({ op: 'evict', key: victim.key, reason: 'prune' });
    }
    return removed;
  }

  /**
   * Compute live statistics for the store.
   *
   * @returns a {@link RankingStoreStats} snapshot
   */
  stats(): RankingStoreStats {
    let oldest: Timestamp | null = null;
    let newest: Timestamp | null = null;
    let hitTotal = 0;
    for (const entry of this._entries.values()) {
      if (oldest === null || entry.insertedAt < oldest) {
        oldest = entry.insertedAt;
      }
      if (newest === null || entry.insertedAt > newest) {
        newest = entry.insertedAt;
      }
      hitTotal += entry.hits;
    }
    return {
      size: this._entries.size,
      hits: this._hits,
      misses: this._misses,
      inserted: this._inserted,
      evicted: this._evicted,
      pruned: this._pruned,
      expired: this._expired,
      averageHitsPerEntry: this._entries.size === 0 ? 0 : hitTotal / this._entries.size,
      oldestEntryAt: oldest,
      newestEntryAt: newest,
      createdAt: this._createdAt,
    };
  }

  /**
   * Serialise the store to plain JSON.
   *
   * Expired entries are dropped first so the snapshot only contains data worth
   * persisting. The output round-trips through {@link RankingStore.fromJSON}
   * without loss.
   *
   * @returns a JSON-serialisable snapshot
   */
  toJSON(): RankingStoreJSON {
    const entries: Array<RankingStoreJSON['entries'][number]> = [];
    for (const [key, entry] of this._entries) {
      if (this._isExpired(entry)) {
        continue;
      }
      entries.push({
        key,
        query: entry.query,
        result: entry.result,
        insertedAt: entry.insertedAt,
        expiresAt: entry.expiresAt,
        lastAccessedAt: entry.lastAccessedAt,
        hits: entry.hits,
      });
    }
    return { version: 1, createdAt: this._createdAt, entries };
  }

  /**
   * Restore a store from a {@link RankingStoreJSON} snapshot.
   *
   * @param json - the snapshot produced by {@link RankingStore.toJSON}
   * @param options - optional {@link RankingStoreOptions} overrides for the
   *   restored store
   * @returns a new store populated with the snapshot's entries
   */
  static fromJSON(json: RankingStoreJSON, options?: Partial<RankingStoreOptions>): RankingStore {
    const store = new RankingStore(options);
    store.load(json);
    return store;
  }

  /**
   * Load a snapshot into this store, replacing its current contents.
   *
   * @param json - the snapshot produced by {@link RankingStore.toJSON}
   * @returns the number of entries loaded
   */
  load(json: RankingStoreJSON): number {
    this.clear();
    let loaded = 0;
    for (const entry of json?.entries ?? []) {
      const live: CacheEntry = {
        key: entry.key,
        query: entry.query,
        result: entry.result,
        insertedAt: entry.insertedAt ?? this._options.now(),
        expiresAt: entry.expiresAt,
        lastAccessedAt: entry.lastAccessedAt ?? this._options.now(),
        hits: entry.hits ?? 0,
      };
      this._entries.set(live.key, live);
      this._inserted += 1;
      loaded += 1;
    }
    return loaded;
  }

  /**
   * Adapter-friendly view of the store's counters, mirroring the fields the
   * rest of the ranking layer reports.
   *
   * @returns a {@link RankingStats}-compatible snapshot (store-local fields)
   */
  toRankingStats(): RankingStats {
    const stats = this.stats();
    return {
      chunks: 0,
      documents: 0,
      distinctTerms: 0,
      totalTerms: 0,
      averageDocumentLength: 0,
      cachedQueries: stats.size,
      queries: 0,
      cacheHits: stats.hits,
      cacheMisses: stats.misses,
      ranked: 0,
      pruned: stats.pruned,
      swept: stats.expired,
      averageScore: 0,
      topScore: 0,
      lastQueryAt: null,
      createdAt: stats.createdAt,
    };
  }

  /**
   * Whether an entry has outlived its TTL under the current clock.
   *
   * @param entry - the entry to test
   * @returns `true` when the entry is expired
   */
  private _isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= this._options.now();
  }

  /**
   * Find the entry with the smallest `lastAccessedAt` (the LRU victim).
   *
   * @returns the victim entry, or `null` when the store is empty
   */
  private _leastRecentlyUsed(): CacheEntry | null {
    let victim: CacheEntry | null = null;
    for (const entry of this._entries.values()) {
      if (victim === null || entry.lastAccessedAt < victim.lastAccessedAt) {
        victim = entry;
      }
    }
    return victim;
  }

  /**
   * Evict least-recently-accessed entries while the cache exceeds capacity.
   */
  private _evictIfOverCapacity(): void {
    while (this._options.maxCacheSize > 0 && this._entries.size > this._options.maxCacheSize) {
      const victim = this._leastRecentlyUsed();
      if (!victim) {
        break;
      }
      this._entries.delete(victim.key);
      this._evicted += 1;
      this._emit({ op: 'evict', key: victim.key, reason: 'lru' });
    }
  }

  /**
   * Emit a `'cache'` lifecycle event carrying the store operation.
   *
   * @param event - the operation detail
   */
  private _emit(event: RankingStoreEvent): void {
    const lifecycle: RankingLifecycleEvent = {
      type: 'cache',
      timestamp: this._options.now(),
      count: 1,
      keys: 'key' in event ? [event.key] : undefined,
      detail: event,
    };
    this.emit('cache', lifecycle);
  }
}