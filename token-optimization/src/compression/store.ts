/**
 * @fileoverview Content-addressed result cache for the Compression layer.
 *
 * {@link CompressionStore} is the storage backbone of the standalone MAM Token
 * Optimization engine's Compression layer. It stores {@link CompressionResult}
 * records keyed by a deterministic hash of the *original input text* (falling
 * back to the compressed text when `originalText` is absent) so that:
 *
 *   - compressing the same input twice resolves to the same key (no dupes),
 *   - cache hits are O(1) content lookups, and
 *   - the store can be serialized / deserialized for persistence.
 *
 * The store applies an LRU-ish eviction policy: when the number of resident
 * entries exceeds the configured `maxEntries`, the least-recently-accessed
 * entries are evicted first. This bounds memory while keeping hot results
 * warm. All access paths (`get`, `getFor`) refresh the LRU clock.
 *
 * The store is deliberately dumb — it has no opinion about *how* results are
 * produced. The deterministic engine lives in {@link ./retrieval.js}; query /
 * grouping logic lives in {@link ./index.js}; GC orchestration lives in
 * {@link ./lifecycle.js}.
 *
 * @module compression/store
 */

import type {
  CompressionResult,
  CompressionStats,
} from './types.js';
import {
  isCompressionResult,
} from './types.js';

/**
 * Default maximum number of results held by {@link CompressionStore} before
 * LRU eviction begins.
 */
export const DEFAULT_MAX_CACHE_ENTRIES = 5_000;

/**
 * Lower bound for `maxEntries`. Stores smaller than this are pointless because
 * a handful of long prompt texts would immediately thrash the cache.
 */
export const MIN_MAX_CACHE_ENTRIES = 16;

/** Seed constant for the FNV-1a 32-bit content hash. */
const FNV_OFFSET_BASIS = 0x811c9dc5;
/** Prime multiplier for the FNV-1a 32-bit content hash. */
const FNV_PRIME = 0x01000193;

/** Separator used between the content hash and any namespace in cache keys. */
const KEY_SEPARATOR = '::';

/**
 * Options accepted by the {@link CompressionStore} constructor.
 */
export interface CompressionStoreOptions {
  /** Maximum resident results before LRU eviction (default 5_000). */
  readonly maxEntries?: number;
  /**
   * Optional namespace prefix for every key. Lets multiple independent stores
   * share one logical key space (e.g. per-tenancy) without colliding.
   */
  readonly namespace?: string;
}

/**
 * Serialized snapshot shape produced by `CompressionStore#toJSON()` and
 * consumed by `CompressionStore#fromJSON()`. The version field allows future
 * migrations.
 */
export interface StoreSnapshot {
  /** Schema version; currently always `1`. */
  readonly version: 1;
  /** The maximum entries the store was configured with at snapshot time. */
  readonly maxEntries: number;
  /** Flat list of all results resident in the cache. */
  readonly results: readonly CompressionResult[];
  /** `true` when an LRU clock (per-entry access order) was captured. */
  readonly lru: boolean;
}

/**
 * Internal envelope stored for every cache entry. Keeps the LRU bookkeeping
 * (`createdAt`, `lastAccess`) separate from the public {@link CompressionResult}.
 */
interface StoredEntry {
  /** The result payload. */
  readonly result: CompressionResult;
  /** Cache key (content hash, plus optional namespace). */
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
 * adequate to deduplicate exact text in a cache.
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
 * Build a stable, human-debuggable cache key from a content hash and an
 * optional namespace segment. The namespace is kept verbatim (not hashed) so
 * cache keys remain greppable in logs and inspectable in dumps.
 *
 * @param contentHash - Hash produced by {@link hashContent}.
 * @param namespace - Optional namespace prefix; `''` means "no namespace".
 * @returns A combined key like `t4x1a1b2::tenant-a`.
 */
export function buildKey(contentHash: string, namespace: string): string {
  return `${namespace}${contentHash}`;
}

/**
 * Split a {@link buildKey} result back into its `[namespace, contentHash]`
 * parts. Used by lifecycle tooling that needs to recover the hash from a
 * stored key.
 *
 * @param key - A key previously produced by {@link buildKey}.
 * @param namespace - The store's namespace (used to strip the prefix).
 * @returns A tuple `[namespace, contentHash]` (namespace may be `''`).
 */
export function parseKey(key: string, namespace: string): [string, string] {
  if (namespace.length > 0 && key.startsWith(namespace)) {
    return [namespace, key.slice(namespace.length)];
  }
  const separatorAt = key.indexOf(KEY_SEPARATOR);
  if (separatorAt === -1) return ['', key];
  return [key.slice(0, separatorAt), key.slice(separatorAt + KEY_SEPARATOR.length)];
}

/**
 * LRU-ish content-addressed compression-result cache.
 *
 * Thread-safety note: Node is single-threaded for JS, but callers may still
 * interleave access from microtask boundaries. All mutating methods are
 * synchronous, so each call is atomic with respect to the event loop.
 *
 * @example
 * ```ts
 * const store = new CompressionStore({ maxEntries: 1000 });
 * store.put(result);
 * const hit = store.getFor(compressedText);
 * ```
 */
export class CompressionStore {
  /** Maximum resident results before eviction. */
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
   * @param options - Tuning options (see {@link CompressionStoreOptions}).
   */
  constructor(options: Readonly<CompressionStoreOptions> = {}) {
    const raw = options.maxEntries ?? DEFAULT_MAX_CACHE_ENTRIES;
    if (!Number.isInteger(raw) || raw < MIN_MAX_CACHE_ENTRIES) {
      throw new RangeError(
        `CompressionStore: maxEntries must be an integer >= ${MIN_MAX_CACHE_ENTRIES} (got ${String(raw)})`,
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
   * Return the deterministic cache key for a piece of text without inserting
   * anything. Content addressing means the same original input always resolves
   * to the same key, so compress-time lookups are O(1).
   *
   * @param text - The original (or compressed) text.
   * @returns The cache key.
   */
  keyFor(text: string): string {
    return buildKey(hashContent(text), this.namespace);
  }

  /**
   * Insert (or overwrite) a result. The key is derived from the result's
   * *original* input text (`originalText`, falling back to the compressed
   * `text`), so caching is keyed by "what was compressed" rather than "what it
   * became". Repeated puts of equivalent results collapse onto the same entry
   * and simply refresh its LRU clock.
   *
   * @param result - The compression result to cache.
   * @returns The cache key the result was stored under.
   */
  put(result: CompressionResult): string {
    if (!isCompressionResult(result)) {
      throw new TypeError('CompressionStore#put: `result` failed structural validation');
    }
    const key = this.keyFor(result.originalText ?? result.text);
    const existing = this.entries.get(key);
    if (existing) {
      existing.lastAccess = Date.now();
      existing.accesses += 1;
      this.counters.puts += 1;
      return key;
    }
    const now = Date.now();
    this.entries.set(key, {
      result: Object.freeze({ ...result }),
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
   * Insert many results in one call. Equivalent to looping {@link put} but
   * performs a single eviction pass at the end, which is cheaper for large
   * batches.
   *
   * @param results - Iterable of results to cache.
   * @returns The number of results inserted / refreshed.
   */
  putMany(results: Iterable<CompressionResult>): number {
    let count = 0;
    for (const result of results) {
      if (!isCompressionResult(result)) continue;
      const key = this.keyFor(result.originalText ?? result.text);
      const existing = this.entries.get(key);
      if (existing) {
        existing.lastAccess = Date.now();
        existing.accesses += 1;
      } else {
        const now = Date.now();
        this.entries.set(key, {
          result: Object.freeze({ ...result }),
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
   * Read a result by exact cache key. On a hit the entry's LRU clock and
   * access counter are refreshed and the hit counter is incremented; on a miss
   * the miss counter is incremented.
   *
   * @param key - A key previously returned by {@link put} or {@link keyFor}.
   * @returns The cached result, or `undefined` when absent.
   */
  get(key: string): CompressionResult | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.counters.misses += 1;
      return undefined;
    }
    entry.lastAccess = Date.now();
    entry.accesses += 1;
    this.counters.hits += 1;
    return entry.result;
  }

  /**
   * Content-addressed lookup: compute the key for a piece of *original* text
   * and return the cached result. This is the primary read path used by the
   * compressor to avoid recomputing identical transforms.
   *
   * @param text - The original text whose result is wanted.
   * @returns The cached result, or `undefined`.
   */
  getFor(text: string): CompressionResult | undefined {
    return this.get(this.keyFor(text));
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
   * Check whether a piece of *original* text has a resident result without
   * touching the LRU clock.
   *
   * @param text - The original text.
   * @returns `true` when a resident result exists for the text.
   */
  hasFor(text: string): boolean {
    return this.entries.has(this.keyFor(text));
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
   * Remove every resident entry whose key begins with the given namespace
   * segment. Useful when multi-tenancy consumers purge one tenant.
   *
   * @param namespace - The namespace segment to purge.
   * @returns The number of entries removed.
   */
  deleteForNamespace(namespace: string): number {
    if (namespace === undefined || namespace === null || namespace === '') return 0;
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(namespace)) {
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
   * Collect health / usage counters for this store. See {@link CompressionStats}.
   *
   * @returns A fresh stats snapshot.
   */
  stats(): CompressionStats {
    const { hits, misses, puts, evictions, clears } = this.counters;
    const lookups = hits + misses;
    let approxBytes = 0;
    let savedTokensTotal = 0;
    let savedPercentSum = 0;
    for (const { result } of this.entries.values()) {
      approxBytes += result.text.length * 2;
      approxBytes += (result.originalText?.length ?? 0) * 2;
      approxBytes += String(result.savedTokens).length;
      savedTokensTotal += result.savedTokens;
      savedPercentSum += result.savedPercent;
    }
    const entries = this.entries.size;
    return {
      entries,
      puts,
      hits,
      misses,
      evictions,
      clears,
      hitRate: lookups === 0 ? 0 : hits / lookups,
      approxBytes,
      savedTokensTotal,
      avgSavedPercent: entries === 0 ? 0 : savedPercentSum / entries,
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
   * snapshot carries `maxEntries` and a flat result list so it can be restored
   * on another process or persisted to disk.
   *
   * @returns A serializable snapshot.
   */
  toJSON(): StoreSnapshot {
    return {
      version: 1,
      maxEntries: this.maxEntries,
      lru: true,
      results: [...this.entries.values()].map((entry) => entry.result),
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
      throw new TypeError('CompressionStore#fromJSON: unsupported snapshot version');
    }
    this.entries.clear();
    let restored = 0;
    for (const result of snapshot.results) {
      if (!isCompressionResult(result)) continue;
      const key = this.keyFor(result.originalText ?? result.text);
      const now = Date.now();
      this.entries.set(key, {
        result: Object.freeze({ ...result }),
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
    const limit = Number.isFinite(target)
      ? Math.max(MIN_MAX_CACHE_ENTRIES, Math.floor(target))
      : this.maxEntries;
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
    this.counters.evictions += this.prune(this.maxEntries);
  }

  /**
   * Convenience: compute the aggregate token savings of every resident entry.
   * Useful for dashboards that want a single "total tokens saved by cache"
   * number without materializing all results.
   *
   * @returns The sum of `savedTokens` across resident entries.
   */
  totalSavedTokens(): number {
    let total = 0;
    for (const { result } of this.entries.values()) {
      total += result.savedTokens;
    }
    return total;
  }
}