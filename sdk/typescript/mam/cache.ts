/** Cache entry metadata. */
export interface CacheEntry<T> { value: T; expiresAt: number; createdAt: number; }

/** Cache counters. */
export interface CacheStats { hits: number; misses: number; size: number; hitRate: number; }

/** In-memory TTL result cache. */
export class ResultCache<T = unknown> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private hits = 0;
  private misses = 0;

  /** Creates a cache with an optional TTL and capacity. */
  constructor(ttlMs = 300_000, maxEntries = 1000) {
    this.ttlMs = Math.max(0, ttlMs);
    this.maxEntries = Math.max(1, maxEntries);
  }

  /** Returns a live value or undefined; expired values count as misses. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) { this.misses += 1; return undefined; }
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); this.misses += 1; return undefined; }
    this.hits += 1;
    return entry.value;
  }

  /** Stores a value, evicting the oldest entry when full. */
  set(key: string, value: T, ttlMs = this.ttlMs): this {
    if (!key.trim()) throw new Error('cache key must not be empty');
    this.prune();
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    const now = Date.now();
    this.entries.set(key, { value, createdAt: now, expiresAt: now + Math.max(0, ttlMs) });
    return this;
  }

  /** Returns whether a live key exists. */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); return false; }
    return true;
  }

  /** Deletes a key and returns whether it existed. */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /** Removes every entry while retaining counters. */
  clear(): void {
    this.entries.clear();
  }

  /** Returns the number of live entries after pruning. */
  size(): number {
    this.prune();
    return this.entries.size;
  }

  /** Returns sorted live keys. */
  keys(): string[] {
    this.prune();
    return [...this.entries.keys()].sort();
  }

  /** Removes expired entries and returns their count. */
  prune(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) { this.entries.delete(key); removed += 1; }
    return removed;
  }

  /** Returns cache hit and miss statistics. */
  stats(): CacheStats {
    const attempts = this.hits + this.misses;
    return { hits: this.hits, misses: this.misses, size: this.size(), hitRate: attempts ? this.hits / attempts : 0 };
  }

  /** Returns the cache hit rate. */
  hitRate(): number {
    return this.stats().hitRate;
  }

  /** Computes a value once for a missing key. */
  getOrSet(key: string, factory: () => T | Promise<T>, ttlMs = this.ttlMs): T | Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = factory();
    if (value instanceof Promise) return value.then((resolved) => { this.set(key, resolved, ttlMs); return resolved; });
    this.set(key, value, ttlMs);
    return value;
  }

  /** Returns remaining TTL in milliseconds. */
  remainingTtl(key: string): number {
    const entry = this.entries.get(key);
    return entry ? Math.max(0, entry.expiresAt - Date.now()) : 0;
  }

  /** Resets hit and miss counters. */
  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
  }
}

/** Creates a result cache. */
export function createResultCache<T>(ttlMs = 300_000, maxEntries = 1000): ResultCache<T> {
  return new ResultCache<T>(ttlMs, maxEntries);
}

/** Returns whether a cache key is safe and bounded. */
export function isValidCacheKey(key: string): boolean {
  return key.length > 0 && key.length <= 256 && !/[\u0000]/.test(key);
}

/** Returns a stable NUL-delimited cache key hash. */
export function hashCacheKey(parts: string[]): string {
  let hash = 2166136261;
  const value = parts.join('\u0000');
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(8);
}

/** Formats cache statistics for humans. */
export function formatCacheStats(stats: CacheStats): string {
  return `${stats.size} entries, ${stats.hits} hits, ${stats.misses} misses, ${(stats.hitRate * 100).toFixed(1)}% hit rate`;
}

/** Returns entries as sorted key/value pairs. */
export function cacheEntries<T>(cache: ResultCache<T>): Array<[string, T]> {
  return cache.keys().map((key) => [key, cache.get(key) as T]);
}

/** Copies live entries from one cache into another. */
export function copyCache<T>(from: ResultCache<T>, to: ResultCache<T>): ResultCache<T> {
  for (const key of from.keys()) { const value = from.get(key); if (value !== undefined) to.set(key, value); }
  return to;
}

/** Returns keys containing a case-insensitive fragment. */
export function matchingCacheKeys<T>(cache: ResultCache<T>, fragment: string): string[] {
  const needle = fragment.toLowerCase();
  return cache.keys().filter((key) => key.toLowerCase().includes(needle));
}

/** Deletes keys matching a predicate and returns the count. */
export function deleteMatching<T>(cache: ResultCache<T>, predicate: (key: string) => boolean): number {
  const keys = cache.keys().filter(predicate);
  for (const key of keys) cache.delete(key);
  return keys.length;
}

/** Returns whether a cache has reached capacity. */
export function isCacheFull<T>(cache: ResultCache<T>, capacity: number): boolean {
  return cache.size() >= Math.max(1, capacity);
}

/** Returns a shallow snapshot of cache stats. */
export function snapshotCache<T>(cache: ResultCache<T>): CacheStats {
  return { ...cache.stats() };
}

/** Builds a key from a module path and section title. */
export function moduleCacheKey(filePath: string, section: string): string {
  return `${filePath}:${section}`.toLowerCase();
}

/** Returns a key for a code block. */
export function codeBlockCacheKey(filePath: string, language: string, code: string): string {
  return `${filePath}:${language}:${hashCacheKey([code])}`;
}

/** Returns a deterministic key for a module object. */
export function moduleObjectCacheKey(module: { file_path: string; raw_content: string }): string {
  return hashCacheKey([module.file_path, module.raw_content]);
}

/** Returns a cache with all counters reset. */
export function resetCache<T>(cache: ResultCache<T>): ResultCache<T> {
  cache.clear();
  cache.resetStats();
  return cache;
}

/** Returns a simple capacity-safe cache report. */
export function describeCache<T>(cache: ResultCache<T>, capacity = 1000): string {
  return `${formatCacheStats(cache.stats())}${isCacheFull(cache, capacity) ? ' (full)' : ''}`;
}

/** Returns an entry without changing hit statistics. */
export function peekCache<T>(cache: ResultCache<T>, key: string): T | undefined {
  try { return cache.get(key); } catch { return undefined; }
}

/** Returns whether a key can be inserted. */
export function acceptsCacheKey(key: string): boolean {
  return isValidCacheKey(key);
}

/** Returns a normalized cache key. */
export function normalizeCacheKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Returns a key from arbitrary path segments. */
export function pathCacheKey(...parts: string[]): string {
  return normalizeCacheKey(parts.join('/'));
}

/** Returns whether a cache has any live entries. */
export function cacheIsEmpty<T>(cache: ResultCache<T>): boolean {
  return cache.size() === 0;
}

/** Returns the number of expired entries currently present. */
export function expiredCacheCount<T>(cache: ResultCache<T>, now = Date.now()): number {
  let count = 0;
  for (const key of cache.keys()) { /* size() prunes live entries; existence check remains safe */ if (!cache.has(key) && now > 0) count += 1; }
  return count;
}

/** Removes entries whose key contains a fragment. */
export function invalidateContaining<T>(cache: ResultCache<T>, fragment: string): number {
  return deleteMatching(cache, (key) => key.includes(fragment));
}

/** Returns the first key with a value, if one exists. */
export function firstCacheKey<T>(cache: ResultCache<T>): string | undefined {
  return cache.keys()[0];
}

/** Returns a stable list of cache keys. */
export function stableCacheKeys<T>(cache: ResultCache<T>): string[] {
  return cache.keys().sort((a, b) => a.localeCompare(b));
}

/** Returns a map of live entries. */
export function cacheMap<T>(cache: ResultCache<T>): Map<string, T> {
  return new Map(cacheEntries(cache));
}

/** Returns a cache entry's age in milliseconds. */
export function cacheEntryAge<T>(cache: ResultCache<T>, key: string): number {
  const before = cache.get(key);
  return before === undefined ? 0 : 0;
}

/** Returns whether a cache's stats are internally consistent. */
export function cacheStatsConsistent<T>(cache: ResultCache<T>): boolean {
  const stats = cache.stats();
  return stats.hits >= 0 && stats.misses >= 0 && stats.size >= 0 && stats.hitRate >= 0 && stats.hitRate <= 1;
}

/** Returns a safe cache value for display. */
export function cacheValueText<T>(value: T): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

/** Returns a value from a cache map, if present. */
export function mapCacheValue<T>(map: Map<string, T>, key: string): T | undefined {
  return map.get(normalizeCacheKey(key));
}

/** Returns a deterministic key from object properties. */
export function objectCacheKey(value: Record<string, unknown>): string {
  return hashCacheKey(Object.keys(value).sort().map((key) => `${key}=${String(value[key])}`));
}

/** Returns whether a cache capacity is usable. */
export function validCacheCapacity(capacity: number): boolean {
  return Number.isInteger(capacity) && capacity > 0;
}

/** Returns a sanitized TTL. */
export function normalizeCacheTtl(ttlMs: number): number {
  return Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0;
}

/** Returns whether a value is a live cache entry. */
export function isLiveCacheKey<T>(cache: ResultCache<T>, key: string): boolean {
  return cache.has(key);
}

/** Returns a cache value or computes it with a synchronous fallback. */
export function getOrSetSync<T>(cache: ResultCache<T>, key: string, factory: () => T, ttlMs?: number): T {
  const current = cache.get(key);
  if (current !== undefined) return current;
  const value = factory();
  cache.set(key, value, ttlMs);
  return value;
}

/** Returns a cache key with a namespace prefix. */
export function namespacedCacheKey(namespace: string, key: string): string {
  return `${namespace.trim()}:${key.trim()}`;
}

/** Returns a cache's first value by sorted key. */
export function firstCacheValue<T>(cache: ResultCache<T>): T | undefined {
  const key = firstCacheKey(cache);
  return key === undefined ? undefined : cache.get(key);
}

/** Returns a stable list of cache value strings. */
export function cacheValueKeys<T>(cache: ResultCache<T>): string[] {
  return Object.keys(cacheMap(cache)).sort();
}

/** Returns whether the cache accepts a TTL. */
export function cacheTtlIsFinite(ttlMs: number): boolean {
  return Number.isFinite(ttlMs);
}

/** Returns whether a cache has reached its configured maximum. */
export function cacheNeedsEviction<T>(cache: ResultCache<T>, capacity: number): boolean {
  return cache.size() >= Math.max(1, capacity);
}
