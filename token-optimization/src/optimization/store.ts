/**
 * @file store.ts
 * @module optimization/store
 *
 * {@link OptimizationStore}: the content-addressed, LRU-bounded result cache
 * for the Optimization layer.
 *
 * The store holds {@link OptimizeResult}s produced by the optimizer so that
 * identical (or near-identical) prompts never pay the optimization cost
 * twice. Its responsibilities:
 *
 *  - **keyed access** — `put`/`get`/`has`/`delete`/`keys`/`clear`/`size`
 *    mirror a `Map`, but every entry also tracks access recency so the cache
 *    can enforce an LRU cap;
 *  - **content addressing** — {@link getFor} looks an entry up by a
 *    deterministic hash of the prompt text, so callers can ask "have we
 *    optimized this exact prompt before?" without maintaining their own key
 *    scheme;
 *  - **bulk loading** — {@link putMany} inserts a batch in one pass;
 *  - **eviction** — {@link evict}/{@link setCap} drop the least-recently
 *    used entries first, keeping memory bounded;
 *  - **observability** — {@link stats} reports hit/miss counters, cached
 *    token totals and access-age distribution;
 *  - **serialization** — {@link toJSON}/{@link fromJSON} round-trip the
 *    whole cache (for persistence or cross-process handoff).
 *
 * The store performs no I/O and holds no timers; periodic pruning of idle
 * entries is the {@link OptimizationLifecycle}'s job (`lifecycle.ts`).
 *
 * @packageDocumentation
 */

import type { OptimizeResult } from './types.js';

import { isOptimizeResult, isPromptSection } from './types.js';

/* ------------------------------------------------------------------------ *
 * Constants & helpers
 * ------------------------------------------------------------------------ */

/**
 * Default maximum number of entries the cache retains before evicting the
 * least-recently-used entry.
 */
export const DEFAULT_CACHE_CAP = 512;

/**
 * Default cap applied when a JSON payload does not declare one.
 */
export const FALLBACK_JSON_CAP = 256;

/**
 * Access-age classifications used by {@link OptimizationStoreStats}.
 *
 * - `'cold'`:  not accessed for a long time (eligible for pruning first).
 * - `'warm'`:  accessed recently but not hot.
 * - `'hot'`:   accessed within the last few minutes.
 */
export const ACCESS_CLASSES = ['cold', 'warm', 'hot'] as const;

/**
 * A union of the access-age classes ({@link ACCESS_CLASSES} as a type).
 */
export type AccessClass = (typeof ACCESS_CLASSES)[number];

/**
 * Age (milliseconds) below which an entry counts as `'hot'`.
 */
export const HOT_AGE_MS = 60_000;

/**
 * Age (milliseconds) below which an entry counts as `'warm'` (otherwise
 * `'cold'`).
 */
export const WARM_AGE_MS = 600_000;

/**
 * Deterministic 32-bit FNV-1a hash of `text`, hex-encoded.
 *
 * Used for content addressing. Collisions are possible in theory but the
 * cache only ever uses the hash as a lookup key for the *stored* prompt, and
 * every hit is re-verified against the caller's text by the lifecycle, so a
 * rare collision degrades to a harmless miss.
 */
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  const input = typeof text === 'string' ? text : '';
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Coerces `value` into a non-negative integer cap, floored at 1.
 */
function toCap(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CACHE_CAP;
  return Math.max(1, Math.floor(value));
}

/* ------------------------------------------------------------------------ *
 * Entry & serialization shapes
 * ------------------------------------------------------------------------ */

/**
 * One cached optimization plus its bookkeeping metadata.
 */
export interface OptimizationCacheEntry {
  /** Stable key under which the entry is stored. */
  key: string;
  /** The cached optimization result. */
  result: OptimizeResult;
  /** {@link contentHash} of the prompt text this result was produced from. */
  contentHash: string;
  /** Epoch milliseconds when the entry was first stored. */
  createdAt: number;
  /** Epoch milliseconds of the most recent read. */
  lastAccessedAt: number;
  /** Number of times the entry has been read. */
  accessCount: number;
}

/**
 * Plain-JSON shape produced by {@link OptimizationStore.toJSON} and accepted
 * by {@link OptimizationStore.fromJSON}.
 */
export interface OptimizationStoreJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** The LRU cap in force. */
  cap: number;
  /** Lifetime cache-hit count. */
  hits: number;
  /** Lifetime cache-miss count. */
  misses: number;
  /** The cached entries, in insertion order. */
  entries: Array<Omit<OptimizationCacheEntry, 'result'> & { result: OptimizeResult }>;
}

/**
 * Aggregate statistics over the cache's current contents and lifetime.
 */
export interface OptimizationStoreStats {
  /** Number of entries currently cached. */
  size: number;
  /** The LRU cap in force. */
  cap: number;
  /** Lifetime cache-hit count. */
  hits: number;
  /** Lifetime cache-miss count. */
  misses: number;
  /** `hits / (hits + misses)`, or `0` when no lookups have happened. */
  hitRate: number;
  /** Sum of `originalTokens` across cached entries. */
  totalCachedTokens: number;
  /** Sum of `optimizedTokens` across cached entries. */
  totalOptimizedTokens: number;
  /** Sum of `savedTokens` across cached entries. */
  totalSavedTokens: number;
  /** Mean `savedPercent` across cached entries (0..100). */
  avgSavedPercent: number;
  /** Epoch ms of the oldest entry's creation, or `undefined` when empty. */
  oldestEntryAt: number | undefined;
  /** Epoch ms of the newest entry's creation, or `undefined` when empty. */
  newestEntryAt: number | undefined;
  /** Count of entries per access-age class (cold/warm/hot). */
  accessDistribution: Record<AccessClass, number>;
}

/**
 * Options accepted by {@link OptimizationStore.put}.
 */
export interface PutOptions {
  /**
   * The prompt text this result was produced from. When supplied it is
   * hashed and registered for content-addressed lookups; when omitted the
   * entry is only reachable by its key.
   */
  sourceText?: string;
  /** Optional explicit content hash (overrides hashing `sourceText`). */
  contentHash?: string;
  /** Optional `createdAt` override, mainly for deserialization. */
  createdAt?: number;
}

/* ------------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------------ */

/**
 * A content-addressed result cache with LRU eviction.
 *
 * The cache is backed by a single `Map` used as an insertion-ordered list:
 * every read re-inserts the entry at the tail, so the head is always the
 * least-recently-used entry and eviction is O(1). A second map aliases
 * content hashes to keys for {@link getFor}.
 *
 * ```ts
 * const cache = new OptimizationStore(128);
 * cache.put('sys:1', result, { sourceText: prompt });
 * const again = cache.getFor(prompt); // content-addressed hit
 * ```
 */
export class OptimizationStore {
  /** Authoritative, insertion-ordered entries (head = LRU). */
  private readonly _entries: Map<string, OptimizationCacheEntry>;
  /** Content hash -> key alias for {@link getFor}. */
  private readonly _byContent: Map<string, string>;
  /** LRU cap; exceeding it triggers eviction on the next write. */
  private _cap: number;
  /** Lifetime hit counter. */
  private _hits: number;
  /** Lifetime miss counter. */
  private _misses: number;

  /**
   * Creates an empty cache.
   *
   * @param cap - maximum number of entries retained; defaults to
   *   {@link DEFAULT_CACHE_CAP}.
   */
  constructor(cap: number = DEFAULT_CACHE_CAP) {
    this._entries = new Map<string, OptimizationCacheEntry>();
    this._byContent = new Map<string, string>();
    this._cap = toCap(cap);
    this._hits = 0;
    this._misses = 0;
  }

  /* -------------------------------------------------------------------- *
   * Raw record access
   * -------------------------------------------------------------------- */

  /**
   * Stores `result` under `key`, registering its content hash (when
   * `options.sourceText` or `options.contentHash` is provided) and evicting
   * the LRU entry if the cap is exceeded.
   *
   * Re-`put`ting an existing key refreshes its position (newest), metadata
   * and result.
   *
   * @returns the stored entry's key.
   */
  put(key: string, result: OptimizeResult, options: PutOptions = {}): string {
    if (typeof key !== 'string' || key.length === 0) {
      throw new TypeError(`Invalid cache key: ${String(key)}`);
    }
    if (!isOptimizeResult(result)) {
      throw new TypeError(`Invalid OptimizeResult for key "${key}"`);
    }
    const hash =
      options.contentHash ??
      (options.sourceText !== undefined ? contentHash(options.sourceText) : undefined);
    const now = options.createdAt ?? Date.now();
    this._entries.delete(key);
    const entry: OptimizationCacheEntry = {
      key,
      result,
      contentHash: hash ?? '',
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    };
    this._entries.set(key, entry);
    if (hash !== undefined) this._byContent.set(hash, key);
    this._evictIfNeeded();
    return key;
  }

  /**
   * Stores a batch of `[key, result, options]` tuples in one pass.
   *
   * @returns the number of entries inserted or replaced.
   */
  putMany(
    pairs: Iterable<[string, OptimizeResult, PutOptions?]>,
  ): number {
    let added = 0;
    for (const [key, result, options] of pairs) {
      this.put(key, result, options);
      added += 1;
    }
    return added;
  }

  /**
   * Returns the cached result for `key`, refreshing its LRU position and
   * bumping the hit counter. Returns `undefined` on a miss.
   *
   * The returned result is a shallow copy so callers cannot corrupt the
   * cached payload through the nested `sections` array (which is copied
   * again here).
   */
  get(key: string): OptimizeResult | undefined {
    const entry = this._entries.get(key);
    if (!entry) {
      this._misses += 1;
      return undefined;
    }
    this._touch(entry);
    this._hits += 1;
    return copyResult(entry.result);
  }

  /**
   * Content-addressed lookup: returns the cached result for the prompt whose
   * {@link contentHash} equals `text`'s hash, or `undefined`.
   *
   * On a hit the entry's LRU position is refreshed exactly like {@link get}.
   */
  getFor(text: string): OptimizeResult | undefined {
    const hash = contentHash(text);
    const key = this._byContent.get(hash);
    if (key === undefined) {
      this._misses += 1;
      return undefined;
    }
    return this.get(key);
  }

  /**
   * Returns `true` when an entry exists for `key`.
   */
  has(key: string): boolean {
    return this._entries.has(key);
  }

  /**
   * Returns `true` when an entry is content-registered for `text`.
   */
  hasFor(text: string): boolean {
    return this._byContent.has(contentHash(text));
  }

  /**
   * Removes the entry for `key`, including any content-hash alias.
   *
   * @returns `true` when an entry existed and was removed.
   */
  delete(key: string): boolean {
    const entry = this._entries.get(key);
    if (!entry) return false;
    this._entries.delete(key);
    if (entry.contentHash && this._byContent.get(entry.contentHash) === key) {
      this._byContent.delete(entry.contentHash);
    }
    return true;
  }

  /**
   * Removes the entry whose content hash matches `text`'s.
   *
   * @returns `true` when such an entry existed and was removed.
   */
  deleteFor(text: string): boolean {
    const hash = contentHash(text);
    const key = this._byContent.get(hash);
    if (key === undefined) return false;
    return this.delete(key);
  }

  /**
   * Returns a snapshot `Array` of every cached key, LRU-first.
   */
  keys(): string[] {
    return Array.from(this._entries.keys());
  }

  /**
   * Returns a snapshot `Array` of every cached entry, LRU-first.
   */
  values(): OptimizationCacheEntry[] {
    return Array.from(this._entries.values(), (entry) => ({ ...entry, result: copyResult(entry.result) }));
  }

  /**
   * Returns a snapshot `Array` of `[key, entry]` pairs, LRU-first.
   */
  entries(): Array<[string, OptimizationCacheEntry]> {
    return Array.from(this._entries, ([key, entry]) => [
      key,
      { ...entry, result: copyResult(entry.result) },
    ]);
  }

  /**
   * Invokes `callback` for every cached entry, LRU-first.
   */
  forEach(callback: (entry: OptimizationCacheEntry, key: string) => void): void {
    for (const [key, entry] of this._entries) {
      callback(entry, key);
    }
  }

  /**
   * Number of entries currently cached.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * The LRU cap in force.
   */
  get cap(): number {
    return this._cap;
  }

  /**
   * Lifetime hit count.
   */
  get hits(): number {
    return this._hits;
  }

  /**
   * Lifetime miss count.
   */
  get misses(): number {
    return this._misses;
  }

  /**
   * `hits / (hits + misses)`, or `0` when no lookups have happened.
   */
  hitRate(): number {
    const total = this._hits + this._misses;
    return total > 0 ? this._hits / total : 0;
  }

  /* -------------------------------------------------------------------- *
   * Capacity & eviction
   * -------------------------------------------------------------------- */

  /**
   * Changes the LRU cap and immediately evicts enough least-recently-used
   * entries to comply.
   *
   * @returns the number of entries evicted.
   */
  setCap(cap: number): number {
    this._cap = toCap(cap);
    return this.evict();
  }

  /**
   * Evicts least-recently-used entries until the cache is within its cap.
   *
   * @returns the number of entries evicted.
   */
  evict(): number {
    let evicted = 0;
    while (this._entries.size > this._cap) {
      const oldestKey = this._entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.delete(oldestKey);
      evicted += 1;
    }
    return evicted;
  }

  /**
   * Removes every entry (and content alias), resetting hit/miss counters.
   *
   * @returns the number of entries that were dropped.
   */
  clear(): number {
    const cleared = this._entries.size;
    this._entries.clear();
    this._byContent.clear();
    this._hits = 0;
    this._misses = 0;
    return cleared;
  }

  /**
   * Returns the raw metadata entry for `key` without touching LRU order or
   * counters (read-only observability).
   */
  entry(key: string): OptimizationCacheEntry | undefined {
    const entry = this._entries.get(key);
    if (!entry) return undefined;
    return { ...entry, result: copyResult(entry.result) };
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Derives {@link OptimizationStoreStats} over the current contents.
   */
  stats(): OptimizationStoreStats {
    let totalCachedTokens = 0;
    let totalOptimizedTokens = 0;
    let totalSavedTokens = 0;
    let savedPercentSum = 0;
    let oldestEntryAt: number | undefined;
    let newestEntryAt: number | undefined;
    const now = Date.now();
    const accessDistribution: Record<AccessClass, number> = { cold: 0, warm: 0, hot: 0 };

    for (const entry of this._entries.values()) {
      totalCachedTokens += entry.result.originalTokens;
      totalOptimizedTokens += entry.result.optimizedTokens;
      totalSavedTokens += entry.result.savedTokens;
      savedPercentSum += entry.result.savedPercent;
      if (oldestEntryAt === undefined || entry.createdAt < oldestEntryAt) oldestEntryAt = entry.createdAt;
      if (newestEntryAt === undefined || entry.createdAt > newestEntryAt) newestEntryAt = entry.createdAt;
      accessDistribution[accessClassFor(now - entry.lastAccessedAt)] += 1;
    }

    const size = this._entries.size;
    return {
      size,
      cap: this._cap,
      hits: this._hits,
      misses: this._misses,
      hitRate: this.hitRate(),
      totalCachedTokens,
      totalOptimizedTokens,
      totalSavedTokens,
      avgSavedPercent: size > 0 ? clampPercent(savedPercentSum / size) : 0,
      oldestEntryAt,
      newestEntryAt,
      accessDistribution,
    };
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the cache to a plain, JSON-friendly object.
   */
  toJSON(): OptimizationStoreJSON {
    return {
      version: 1,
      cap: this._cap,
      hits: this._hits,
      misses: this._misses,
      entries: Array.from(this._entries.values(), (entry) => ({
        key: entry.key,
        result: copyResult(entry.result),
        contentHash: entry.contentHash,
        createdAt: entry.createdAt,
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: entry.accessCount,
      })),
    };
  }

  /**
   * Clears this cache and loads `data`. Malformed entries are skipped; an
   * entirely malformed payload leaves the cache cleared.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this.clear();
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    if (isFiniteNonNegative(parsed['cap'])) this._cap = toCap(parsed['cap']);
    if (isFiniteNonNegative(parsed['hits'])) this._hits = Math.max(0, Math.floor(parsed['hits']));
    if (isFiniteNonNegative(parsed['misses'])) this._misses = Math.max(0, Math.floor(parsed['misses']));
    const list = parsed['entries'];
    if (Array.isArray(list)) {
      for (const raw of list) {
        const entry = parseEntry(raw);
        if (!entry) continue;
        this._entries.set(entry.key, entry);
        if (entry.contentHash) this._byContent.set(entry.contentHash, entry.key);
      }
    }
    this._evictIfNeeded();
    return this;
  }

  /**
   * Rehydrates a new cache from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): OptimizationStore {
    const store = new OptimizationStore(FALLBACK_JSON_CAP);
    store.fromJSON(data);
    return store;
  }

  /**
   * Builds a cache pre-populated from an iterable of entries.
   */
  static build(
    entries: Iterable<OptimizationCacheEntry>,
    cap: number = DEFAULT_CACHE_CAP,
  ): OptimizationStore {
    const store = new OptimizationStore(cap);
    for (const entry of entries) {
      store.put(entry.key, entry.result, {
        contentHash: entry.contentHash || undefined,
        createdAt: entry.createdAt,
      });
    }
    return store;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Refreshes an entry's recency: bumps `accessCount`, stamps
   * `lastAccessedAt` and re-inserts the entry at the tail of the order map
   * so it is no longer the LRU candidate.
   */
  private _touch(entry: OptimizationCacheEntry): void {
    entry.accessCount += 1;
    entry.lastAccessedAt = Date.now();
    this._entries.delete(entry.key);
    this._entries.set(entry.key, entry);
  }

  /**
   * Evicts entries when the cap is exceeded (called after writes).
   */
  private _evictIfNeeded(): void {
    if (this._entries.size > this._cap) this.evict();
  }
}

/* ------------------------------------------------------------------------ *
 * Module-level helpers
 * ------------------------------------------------------------------------ */

/**
 * Returns a deep-enough copy of an {@link OptimizeResult} so the caller's
 * mutations never leak into the cache: the top-level object and the nested
 * `sections` array are both copied.
 */
function copyResult(result: OptimizeResult): OptimizeResult {
  return { ...result, sections: result.sections.map((section) => ({ ...section })) };
}

/**
 * Classifies an entry whose last access was `ageMs` ago into an
 * {@link AccessClass} bucket.
 */
export function accessClassFor(ageMs: number): AccessClass {
  if (ageMs <= HOT_AGE_MS) return 'hot';
  if (ageMs <= WARM_AGE_MS) return 'warm';
  return 'cold';
}

/**
 * Parses one entry out of a JSON payload, or returns `undefined` when the
 * payload is malformed. Entries with invalid results are skipped.
 */
function parseEntry(raw: unknown): OptimizationCacheEntry | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const v = raw as Record<string, unknown>;
  if (typeof v['key'] !== 'string' || v['key'].length === 0) return undefined;
  if (!isOptimizeResult(v['result'])) return undefined;
  if (!Array.isArray(v['result']['sections'])) return undefined;
  if (!v['result']['sections'].every((s) => isPromptSection(s))) return undefined;
  const now = Date.now();
  const entry: OptimizationCacheEntry = {
    key: v['key'],
    result: v['result'],
    contentHash: typeof v['contentHash'] === 'string' ? v['contentHash'] : '',
    createdAt: isFiniteNonNegative(v['createdAt']) ? v['createdAt'] : now,
    lastAccessedAt: isFiniteNonNegative(v['lastAccessedAt']) ? v['lastAccessedAt'] : now,
    accessCount: isFiniteNonNegative(v['accessCount']) ? Math.floor(v['accessCount']) : 0,
  };
  return entry;
}

/**
 * Returns `true` when `value` is a finite, non-negative number.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Clamps a percentage into 0..100.
 */
function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createOptimizationStore(cap: number = DEFAULT_CACHE_CAP): OptimizationStore {
  return new OptimizationStore(cap);
}