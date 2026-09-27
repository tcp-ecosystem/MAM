import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  storedAt: number;
  ttlMs?: number;
}

interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class MemoryCache<T = unknown> {
  private entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private defaultTtlMs?: number;
  private maxEntries?: number;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
  }

  get(key: string, now: number = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (isExpired(entry, now)) {
      this.entries.delete(key);
      this.evictions++;
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    if (this.maxEntries !== undefined && !this.entries.has(key) && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.entries.set(key, {
      key,
      value,
      storedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  has(key: string, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  getKeys(): string[] {
    return Array.from(this.entries.keys());
  }

  getValues(): T[] {
    return Array.from(this.entries.values()).map((entry) => entry.value);
  }

  getEntries(): Array<{ key: string; value: T }> {
    return Array.from(this.entries.values()).map((entry) => ({ key: entry.key, value: entry.value }));
  }

  prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (isExpired(entry, now)) {
        this.entries.delete(key);
        this.evictions++;
        removed++;
      }
    }
    return removed;
  }

  getStats(): CacheStats {
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  getHitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) return 0;
    return this.hits / total;
  }

  formatStats(): string {
    const stats = this.getStats();
    const rate = (this.getHitRate() * 100).toFixed(1);
    return `${stats.entries} entries, ${stats.hits} hits, ${stats.misses} misses, ${rate}% hit rate`;
  }

  resetStats(): void {
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  touch(key: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || isExpired(entry, now)) return false;
    entry.storedAt = now;
    return true;
  }

  getEntryAge(key: string, now: number = Date.now()): number | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    return Math.max(0, now - entry.storedAt);
  }

  getRemainingTtl(key: string, now: number = Date.now()): number | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.ttlMs === undefined) return undefined;
    return Math.max(0, entry.ttlMs - (now - entry.storedAt));
  }

  setMany(values: Record<string, T>, ttlMs?: number): void {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value, ttlMs);
    }
  }

  getMany(keys: string[], now: number = Date.now()): Record<string, T | undefined> {
    const result: Record<string, T | undefined> = {};
    for (const key of keys) {
      result[key] = this.get(key, now);
    }
    return result;
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Number.POSITIVE_INFINITY;
    for (const [key, entry] of this.entries) {
      if (entry.storedAt < oldestTime) {
        oldestTime = entry.storedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.entries.delete(oldestKey);
      this.evictions++;
    }
  }

  getOrSet(key: string, factory: () => T, ttlMs?: number): T {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }

  async getOrSetAsync(key: string, factory: () => Promise<T>, ttlMs?: number): Promise<T> {
    const existing = this.get(key);
    if (existing !== undefined) return existing;
    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  refresh(key: string, ttlMs?: number, now: number = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || isExpired(entry, now)) return false;
    entry.storedAt = now;
    if (ttlMs !== undefined) {
      entry.ttlMs = ttlMs;
    } else if (this.defaultTtlMs !== undefined) {
      entry.ttlMs = this.defaultTtlMs;
    }
    return true;
  }

  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const key of Array.from(this.entries.keys())) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  filterKeys(predicate: (key: string) => boolean): string[] {
    return this.getKeys().filter(predicate);
  }

  toObject(): Record<string, T> {
    const result: Record<string, T> = {};
    for (const [key, entry] of this.entries) {
      result[key] = entry.value;
    }
    return result;
  }

  loadObject(values: Record<string, T>, ttlMs?: number): void {
    for (const [key, value] of Object.entries(values)) {
      this.set(key, value, ttlMs);
    }
  }

  clone(): MemoryCache<T> {
    const clone = new MemoryCache<T>({ ttlMs: this.defaultTtlMs, maxEntries: this.maxEntries });
    for (const [key, entry] of this.entries) {
      clone.entries.set(key, { ...entry });
    }
    return clone;
  }

  merge(other: MemoryCache<T>): void {
    for (const [key, entry] of other.entries) {
      this.entries.set(key, { ...entry });
    }
  }
}

export function createMemoryCache<T = unknown>(ttlMs?: number): MemoryCache<T> {
  return new MemoryCache<T>(ttlMs === undefined ? {} : { ttlMs });
}

export function getCacheKey(parts: Array<string | number>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function isExpired(entry: { storedAt: number; ttlMs?: number }, now: number = Date.now()): boolean {
  if (entry.ttlMs === undefined) return false;
  return now - entry.storedAt >= entry.ttlMs;
}

export async function readJsonCacheFile<T = unknown>(path: string): Promise<T | undefined> {
  try {
    const raw = await readFile(resolve(path), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonCacheFile(path: string, value: unknown): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, JSON.stringify(value, null, 2) + '\n', 'utf-8');
}

function normalizeCacheKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '-');
}

function getCacheFileName(key: string, extension = 'json'): string {
  const safe = normalizeCacheKey(key).replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
  return `${safe}.${extension}`;
}

function mergeCacheStats(a: CacheStats, b: CacheStats): CacheStats {
  return {
    entries: a.entries + b.entries,
    hits: a.hits + b.hits,
    misses: a.misses + b.misses,
    evictions: a.evictions + b.evictions,
  };
}

function validateCacheOptions(options: CacheOptions): string[] {
  const errors: string[] = [];
  if (options.ttlMs !== undefined && options.ttlMs < 0) {
    errors.push('cache ttlMs must be non-negative');
  }
  if (options.maxEntries !== undefined && (!Number.isInteger(options.maxEntries) || options.maxEntries <= 0)) {
    errors.push('cache maxEntries must be a positive integer');
  }
  return errors;
}

function normalizeCacheOptions(options: CacheOptions): CacheOptions {
  const normalized: CacheOptions = {};
  if (options.ttlMs !== undefined && options.ttlMs >= 0) {
    normalized.ttlMs = options.ttlMs;
  }
  if (options.maxEntries !== undefined && options.maxEntries > 0) {
    normalized.maxEntries = Math.floor(options.maxEntries);
  }
  return normalized;
}

function serializeCacheEntries<T>(entries: Array<{ key: string; value: T }>): string {
  return JSON.stringify(entries, null, 2);
}

function deserializeCacheEntries<T>(text: string): Array<{ key: string; value: T }> {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item): item is { key: string; value: T } =>
      typeof item === 'object' && item !== null && typeof (item as { key: unknown }).key === 'string',
  );
}

function hashKeyParts(parts: Array<string | number>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 32);
}

function formatCacheDebugLine(key: string, age: number, ttl: number | undefined): string {
  const ttlPart = ttl === undefined ? 'no expiry' : `${Math.max(0, ttl - age)}ms left`;
  return `${key} (age ${age}ms, ${ttlPart})`;
}

function computeExpiry(storedAt: number, ttlMs: number): number {
  return storedAt + ttlMs;
}

function isExpiringSoon(storedAt: number, ttlMs: number, now: number, thresholdMs: number): boolean {
  const remaining = computeExpiry(storedAt, ttlMs) - now;
  return remaining > 0 && remaining <= thresholdMs;
}
