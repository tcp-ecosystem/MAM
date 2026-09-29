/**
 * @fileoverview Content-addressed estimate cache for the Estimation layer.
 *
 * {@link EstimateStore} is the storage backbone of the standalone MAM Token
 * Optimization engine's Estimation layer. It stores {@link TokenEstimate}
 * records keyed by a deterministic hash of `(input, model)` so that:
 *
 *   - identical text + model pairs always resolve to the same key (no dupes),
 *   - cache hits are O(1) content lookups, and
 *   - the store can be serialized / deserialized for persistence.
 *
 * The store applies an LRU-ish eviction policy: when the number of resident
 * entries exceeds the configured `maxEntries`, the least-recently-accessed
 * entries are evicted first. This bounds memory while keeping hot estimates
 * warm. All access paths (`get`, `has`, `getFor`) refresh the LRU clock.
 *
 * The store is deliberately dumb — it has no opinion about *how* estimates are
 * produced. Heuristic logic lives in {@link ./retrieval.js}; query / grouping
 * logic lives in {@link ./index.js}; GC orchestration lives in
 * {@link ./lifecycle.js}.
 *
 * @module estimation/store
 */

import type {
  EstimationStats,
  ModelProfile,
  StoreSnapshot,
  TokenEstimate,
} from './types.js';
import {
  isModelProfile,
  isTokenEstimate,
  resolveModelProfile,
} from './types.js';

/**
 * Default maximum number of entries held by {@link EstimateStore} before LRU
 * eviction begins. Mirrors `EstimationConfig.maxCacheEntries`.
 */
export const DEFAULT_MAX_CACHE_ENTRIES = 10_000;

/**
 * Lower bound for `maxEntries`. Stores smaller than this are pointless because
 * a handful of long prompt texts would immediately thrash the cache.
 */
export const MIN_MAX_CACHE_ENTRIES = 16;

/** Seed constant for the FNV-1a 32-bit content hash. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** Prime multiplier for the FNV-1a 32-bit content hash. */
const FNV_PRIME = 0x01000193;

/** Separator used between the content hash and the model in cache keys. */
const KEY_SEPARATOR = '::';

/**
 * Options accepted by the {@link EstimateStore} constructor.
 */
export interface EstimateStoreOptions {
  /** Maximum resident entries before LRU eviction (default 10_000). */
  readonly maxEntries?: number;
  /**
   * Optional namespace prefix for every key. Lets multiple independent stores
   * share one logical key space (e.g. per-tenancy) without colliding.
   */
  readonly namespace?: string;
}

/**
 * Internal envelope stored for every cache entry. Keeps the LRU bookkeeping
 * (`createdAt`, `lastAccess`) separate from the public {@link TokenEstimate}.
 */
interface StoredEntry {
  /** The estimate payload. */
  readonly estimate: TokenEstimate;
  /** Cache key (`contentHash::model`). */
  readonly key: string;
  /** Monotonic creation timestamp (ms). */
  readonly createdAt: number;
  /** Monotonic last-access timestamp (ms); drives LRU eviction. */
  lastAccess: number;
  /** Number of times this entry has been read. */
  accesses: number;
}

/**
 * A deterministic, dependency-free FNV-1a 32-bit hash. Used purely for
 * content addressing — it is not a cryptographic hash, but it is more than
 * adequate to deduplicate exact text + model pairs in a cache.
 *
 * @param text - Input string to hash.
 * @returns Lower-case hex string (8 chars) of the 32-bit hash.
 */
export function hashContent(text: string): string {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Build a stable, human-debuggable cache key from a content hash and a model
 * id. The model segment is included verbatim (not hashed) so cache keys remain
 * greppable in logs and inspectable in dumps.
 *
 * @param contentHash - Hash produced by {@link hashContent}.
 * @param model - Optional canonical model id; `''` stands for "no model".
 * @returns A combined key like `a1b2c3d4::gpt-4`.
 */
export function buildKey(contentHash: string, model: string | undefined): string {
  return `${contentHash}${KEY_SEPARATOR}${model ?? ''}`;
}

/**
 * Split a {@link buildKey} result back into its `[contentHash, model]` parts.
 * Used by `deleteForModel` and by index / lifecycle tooling that needs to
 * recover the model from a stored key.
 *
 * @param key - A key previously produced by {@link buildKey}.
 * @returns A tuple `[contentHash, model]` (model may be `''`).
 */
export function parseKey(key: string): [string, string] {
  const separatorAt = key.indexOf(KEY_SEPARATOR);
  if (separatorAt === -1) return [key, ''];
  return [key.slice(0, separatorAt), key.slice(separatorAt + KEY_SEPARATOR.length)];
}

/**
 * LRU-ish content-addressed estimate cache.
 *
 * Thread-safety note: Node is single-threaded for JS, but callers may still
 * interleave access from microtask boundaries. All mutating methods are
 * synchronous, so each call is atomic with respect to the event loop.
 *
 * @example
 * ```ts
 * const store = new EstimateStore({ maxEntries: 1000 });
 * store.put(estimate);
 * const hit = store.getFor('the quick brown fox', 'gpt-4');
 * ```
 */
export class EstimateStore {
  /** Maximum resident entries before eviction. */
  readonly maxEntries: number;

  /** Optional namespace baked into every key. */
  readonly namespace: string;

  /** Internal map from cache key to stored envelope. */
  private readonly entries: Map<string, StoredEntry> = new Map();

  /** Lifetime counters exposed via {@link stats}. */
  private readonly counters = {
    puts: 0,
    hits: 0,
    misses: 0,
    evictions: 0,
    clears: 0,
  };

  /**
   * @param options - Tuning options (see {@link EstimateStoreOptions}).
   */
  constructor(options: Readonly<EstimateStoreOptions> = {}) {
    const raw = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    if (!Number.isInteger(raw) || raw < MIN_MAX_CACHE_ENTRIES) {
      throw new RangeError(
        `EstimateStore: maxEntries must be an integer >= ${MIN_MAX_CACHE_ENTRIES} (got ${String(raw)})`,
      );
    }
    this.maxEntries = raw;
    this.namespace = options.namespace ?? '';
  }

  /**
   * Compute the content hash for arbitrary text. Exposed so callers can build
   * keys ahead of time (e.g. for deletion sweeps) without depending on the
   * private hashing routine.
   *
   * @param text - Text to hash.
   * @returns The FNV-1a hex hash of `text`.
   */
  hash(text: string): string {
    return hashContent(text);
  }

  /**
   * Insert (or overwrite) an estimate. The key is derived from
   * `estimate.input` and `estimate.model`, so repeated puts of equivalent
   * estimates collapse onto the same entry and simply refresh its LRU clock.
   *
   * @param estimate - The estimate to cache.
   * @returns The cache key the estimate was stored under.
   */
  put(estimate: TokenEstimate): string {
    if (!isTokenEstimate(estimate)) {
      throw new TypeError('EstimateStore#put: `estimate` failed structural validation');
    }
    const key = this.keyFor(estimate.input, estimate.model);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccess = Date.now();
      existing.accesses += 1;
      this.counters.puts += 1;
      return key;
    }
    const now = Date.now();
    this.entries.set(key, {
      estimate: Object.freeze({ ...estimate }),
      key,
      createdAt: now,
      lastAccess: now,
      accesses: 0,
    });
    this.counters.puts += 1;
    this.evictIfNeeded();
    return key;
  }

  /**
   * Insert many estimates in one call. Equivalent to looping {@link put} but
   * performs a single eviction pass at the end, which is cheaper for large
   * batches.
   *
   * @param estimates - Iterable of estimates to cache.
   * @returns The number of estimates inserted / refreshed.
   */
  putMany(estimates: Iterable<TokenEstimate>): number {
    let count = 0;
    for (const estimate of estimates) {
      if (!isTokenEstimate(estimate)) continue;
      const key = this.keyFor(estimate.input, estimate.model);
      const existing = this.entries.get(key);
      if (existing) {
        existing.lastAccess = Date.now();
        existing.accesses += 1;
      } else {
        const now = Date.now();
        this.entries.set(key, {
          estimate: Object.freeze({ ...estimate }),
          key,
          createdAt: now,
          lastAccess: now,
          accesses: 0,
        });
      }
      this.counters.puts += 1;
      count += 1;
    }
    this.evictIfNeeded();
    return count;
  }

  /**
   * Read an estimate by exact cache key. On a hit the entry's LRU clock and
   * access counter are refreshed and the hit counter is incremented; on a miss
   * the miss counter is incremented.
   *
   * @param key - A key previously returned by {@link put} or {@link keyFor}.
   * @returns The cached estimate, or `undefined` when absent.
   */
  get(key: string): TokenEstimate | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.counters.misses += 1;
      return undefined;
    }
    entry.lastAccess = Date.now();
    entry.accesses += 1;
    this.counters.hits += 1;
    return entry.estimate;
  }

  /**
   * Content-addressed lookup: compute the key for `(text, model)` and return
   * the cached estimate. This is the primary read path used by the estimator.
   *
   * @param text - The text whose estimate is wanted.
   * @param model - Optional model family; must match the model the estimate was
   *   stored under or the lookup will miss.
   * @returns The cached estimate, or `undefined`.
   */
  getFor(text: string, model?: string): TokenEstimate | undefined {
    return this.get(this.keyFor(text, model));
  }

  /**
   * Return the deterministic cache key for a `(text, model)` pair *without*
   * inserting anything. Useful for deletion sweeps and for `index.ts` which
   * needs to address entries uniformly.
   *
   * @param text - The text.
   * @param model - Optional model id.
   * @returns The cache key.
   */
  keyFor(text: string, model?: string): string {
    const contentHash = hashContent(text);
    return `${this.namespace}${buildKey(contentHash, model)}`;
  }

  /**
   * Check whether a cache key is resident without touching the LRU clock.
   *
   * @param key - Cache key to probe.
   * @returns `true` when the key is present.
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Check whether a `(text, model)` pair has a resident estimate without
   * touching the LRU clock.
   *
   * @param text - The text.
   * @param model - Optional model id.
   * @returns `true` when a resident estimate exists for the pair.
   */
  hasFor(text: string, model?: string): boolean {
    return this.entries.has(this.keyFor(text, model));
  }

  /**
   * Remove a single entry by key.
   *
   * @param key - Cache key to delete.
   * @returns `true` when an entry was actually removed.
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * Remove every resident entry belonging to a given model family. The model
   * segment of cache keys is kept verbatim (see {@link buildKey}), so this is
   * a simple suffix sweep over the key space.
   *
   * @param model - Canonical model id to purge.
   * @returns The number of entries removed.
   */
  deleteForModel(model: string): number {
    if (model === undefined || model === null || model === '') return 0;
    const prefix = `${this.namespace}`;
    const suffix = `${KEY_SEPARATOR}${model}`;
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      const bare = key.startsWith(prefix) ? key.slice(prefix.length) : key;
      if (bare.endsWith(suffix)) {
        if (this.entries.delete(key)) removed += 1;
      }
    }
    return removed;
  }

  /**
   * Snapshot of all resident cache keys. Returned as a fresh array so callers
   * can iterate safely while the store is mutated.
   *
   * @returns All cache keys, in insertion order.
   */
  keys(): string[] {
    return [...this.entries.keys()];
  }

  /**
   * Number of resident entries.
   */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Whether the store currently holds zero entries.
   */
  get empty(): boolean {
    return this.entries.size === 0;
  }

  /**
   * Remove all resident entries. Lifetime counters (`puts`, `hits`, `misses`)
   * are preserved so callers can still compute aggregate hit rates across
   * clears; only `clears` is incremented.
   */
  clear(): void {
    this.entries.clear();
    this.counters.clears += 1;
  }

  /**
   * Collect health / usage counters for this store. See {@link EstimationStats}.
   *
   * @returns A fresh stats snapshot.
   */
  stats(): EstimationStats {
    const { hits, misses, puts, evictions, clears } = this.counters;
    const lookups = hits + misses;
    let approxBytes = 0;
    for (const { estimate } of this.entries.values()) {
      approxBytes += estimate.input.length * 2;
      approxBytes += String(estimate.tokens).length;
    }
    return {
      entries: this.entries.size,
      puts,
      hits,
      misses,
      evictions,
      clears,
      hitRate: lookups === 0 ? 0 : hits / lookups,
      approxBytes,
    };
  }

  /**
   * Return the least-recently-accessed resident key, or `undefined` when the
   * store is empty. Used by {@link prune} and by lifecycle GC.
   *
   * @returns The stalest key, or `undefined`.
   */
  lruKey(): string | undefined {
    let oldest: StoredEntry | undefined;
    for (const entry of this.entries.values()) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) oldest = entry;
    }
    return oldest?.key;
  }

  /**
   * Serialize the full store into a JSON-friendly {@link StoreSnapshot}. The
   * snapshot carries `maxEntries` and a flat estimate list so it can be
   * restored on another process or persisted to disk.
   *
   * @returns A serializable snapshot.
   */
  toJSON(): StoreSnapshot {
    return {
      version: 1,
      maxEntries: this.maxEntries,
      lru: true,
      estimates: [...this.entries.values()].map((entry) => entry.estimate),
    };
  }

  /**
   * Restore a store from a snapshot produced by {@link toJSON}. The store's
   * configured `maxEntries` is left untouched; snapshot `maxEntries` is kept
   * for informational purposes only. Invalid entries are skipped.
   *
   * @param snapshot - Snapshot to restore from.
   * @returns The number of entries restored.
   */
  fromJSON(snapshot: StoreSnapshot): number {
    if (!snapshot || snapshot.version !== 1) {
      throw new TypeError('EstimateStore#fromJSON: unsupported snapshot version');
    }
    this.entries.clear();
    let restored = 0;
    for (const estimate of snapshot.estimates) {
      if (!isTokenEstimate(estimate)) continue;
      const key = this.keyFor(estimate.input, estimate.model);
      const now = Date.now();
      this.entries.set(key, {
        estimate: Object.freeze({ ...estimate }),
        key,
        createdAt: now,
        lastAccess: now,
        accesses: 0,
      });
      restored += 1;
    }
    this.evictIfNeeded();
    return restored;
  }

  /**
   * Prune the store down to at most `target` entries by evicting the
   * least-recently-accessed entries. Safe to call when already under target.
   *
   * @param target - Maximum entries after pruning; defaults to `maxEntries`.
   * @returns The number of entries evicted by this call.
   */
  prune(target: number = this.maxEntries): number {
    const limit = Math.max(MIN_MAX_CACHE_ENTRIES, Math.floor(target));
    let evicted = 0;
    while (this.entries.size > limit) {
      const stale = this.lruKey();
      if (stale === undefined) break;
      if (this.entries.delete(stale)) evicted += 1;
    }
    this.counters.evictions += evicted;
    return evicted;
  }

  /**
   * Enforce the LRU cap. Called internally after every mutation. If the store
   * exceeds `maxEntries` it evicts just enough stalest entries to return to the
   * cap (does not prune below the cap on a single put).
   */
  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const evicted = this.prune(this.maxEntries);
    this.counters.evictions += evicted;
  }

  /**
   * Validate a candidate {@link ModelProfile} against the store's expectations
   * and, when valid, use it to derive a recommended default ratio. Convenience
   * for callers that pair a store with a profile table. Mostly useful for
   * integration code; retained here so the store stays self-describing.
   *
   * @param profile - Candidate profile.
   * @returns The profile's `charsPerToken`, or the generic default.
   */
  defaultRatioFor(profile: unknown): number {
    if (isModelProfile(profile)) {
      return profile.charsPerToken ?? 4.0;
    }
    return resolveModelProfile(undefined).charsPerToken ?? 4.0;
  }
}