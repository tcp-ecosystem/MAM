import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface CacheEntry {
  key: string;
  value: unknown;
  storedAt: number;
  ttlMs: number;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

export const DEFAULT_CACHE_TTL = 5 * 60 * 1000;

const DEFAULT_MAX_ENTRIES = 4096;
const MAX_KEY_LENGTH = 1024;

export function hashCacheKey(parts: Array<string | number>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function isValidCacheKey(key: string): boolean {
  return normalizeCacheKey(key) !== undefined;
}

export function formatCacheStats(stats: CacheStats): string {
  const total = stats.hits + stats.misses;
  const rate = total === 0 ? '0.0' : ((stats.hits / total) * 100).toFixed(1);
  return `${stats.entries} entries, ${stats.hits} hits, ${stats.misses} misses, ${rate}% hit rate`;
}

export function createResultCache(ttlMs: number = DEFAULT_CACHE_TTL): ResultCache {
  return new ResultCache(ttlMs);
}

export class ResultCache {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlMs: number = DEFAULT_CACHE_TTL) {
    this.ttlMs = clampCacheTTL(ttlMs);
    this.maxEntries = DEFAULT_MAX_ENTRIES;
  }

  get(key: string, now: number = Date.now()): unknown {
    const normalized = normalizeCacheKey(key);
    if (normalized === undefined) {
      this.misses++;
      return undefined;
    }
    const entry = this.entries.get(normalized);
    if (entry === undefined) {
      this.misses++;
      return undefined;
    }
    if (isEntryExpired(entry, now)) {
      this.entries.delete(normalized);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  has(key: string, now: number = Date.now()): boolean {
    return this.get(key, now) !== undefined;
  }

  set(key: string, value: unknown, now: number = Date.now()): void {
    const normalized = normalizeCacheKey(key);
    if (normalized === undefined) {
      return;
    }
    this.purgeExpired(now);
    if (!this.entries.has(normalized) && this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }
    this.entries.set(normalized, createCacheEntry(normalized, value, this.ttlMs, now));
  }

  delete(key: string): boolean {
    const normalized = normalizeCacheKey(key);
    if (normalized === undefined) {
      return false;
    }
    return this.entries.delete(normalized);
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  size(now: number = Date.now()): number {
    this.purgeExpired(now);
    return this.entries.size;
  }

  prune(now: number = Date.now()): number {
    return this.purgeExpired(now);
  }

  getOrSet(key: string, factory: () => unknown, now: number = Date.now()): unknown {
    const cached = this.get(key, now);
    if (cached !== undefined) {
      return cached;
    }
    const value = factory();
    this.set(key, value, now);
    return value;
  }

  keys(now: number = Date.now()): string[] {
    this.purgeExpired(now);
    return Array.from(this.entries.keys());
  }

  stats(): CacheStats {
    return {
      entries: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }

  hitRate(): number {
    const total = this.hits + this.misses;
    if (total === 0) {
      return 0;
    }
    return this.hits / total;
  }

  getRemainingTTL(key: string, now: number = Date.now()): number | undefined {
    const normalized = normalizeCacheKey(key);
    if (normalized === undefined) {
      return undefined;
    }
    const entry = this.entries.get(normalized);
    if (entry === undefined || entry.ttlMs <= 0) {
      return undefined;
    }
    return Math.max(0, entry.ttlMs - (now - entry.storedAt));
  }

  async saveToFile(path: string): Promise<void> {
    const snapshot = serializeCacheEntries(this.entries);
    const resolved = resolve(path);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  }

  async loadFromFile(path: string, now: number = Date.now()): Promise<number> {
    let raw: string;
    try {
      raw = await readFile(resolve(path), 'utf-8');
    } catch {
      return 0;
    }
    const snapshot = parseCacheSnapshot(raw);
    let loaded = 0;
    for (const record of snapshot) {
      if (!isValidCacheKey(record.key)) {
        continue;
      }
      const entry: CacheEntry = {
        key: record.key,
        value: record.value,
        storedAt: record.storedAt,
        ttlMs: record.ttlMs,
      };
      if (isEntryExpired(entry, now)) {
        continue;
      }
      this.entries.set(record.key, entry);
      loaded++;
    }
    return loaded;
  }

  private purgeExpired(now: number): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (isEntryExpired(entry, now)) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  private evictOldest(): void {
    const oldest = oldestCacheEntry(this.entries);
    if (oldest !== undefined) {
      this.entries.delete(oldest[0]);
      this.evictions++;
    }
  }
}

function normalizeCacheKey(key: string): string | undefined {
  const normalized = key.trim();
  if (normalized === '' || normalized.length > MAX_KEY_LENGTH) {
    return undefined;
  }
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return undefined;
    }
  }
  return normalized;
}

function isEntryExpired(entry: CacheEntry, now: number): boolean {
  if (entry.ttlMs <= 0) {
    return false;
  }
  return now - entry.storedAt >= entry.ttlMs;
}

function clampCacheTTL(ttlMs: number): number {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    return 0;
  }
  return ttlMs;
}

interface CacheSnapshotRecord {
  key: string;
  value: unknown;
  storedAt: number;
  ttlMs: number;
}

function serializeCacheEntries(entries: Map<string, CacheEntry>): CacheSnapshotRecord[] {
  const records: CacheSnapshotRecord[] = [];
  for (const entry of entries.values()) {
    records.push({ key: entry.key, value: entry.value, storedAt: entry.storedAt, ttlMs: entry.ttlMs });
  }
  records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return records;
}

function parseCacheSnapshot(raw: string): CacheSnapshotRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const records: CacheSnapshotRecord[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Partial<CacheSnapshotRecord>;
    if (typeof record.key !== 'string' || typeof record.storedAt !== 'number' || typeof record.ttlMs !== 'number') {
      continue;
    }
    records.push({ key: record.key, value: record.value, storedAt: record.storedAt, ttlMs: record.ttlMs });
  }
  return records;
}

function createCacheEntry(key: string, value: unknown, ttlMs: number, now: number): CacheEntry {
  return { key, value, storedAt: now, ttlMs };
}

function entryAge(entry: CacheEntry, now: number): number {
  return Math.max(0, now - entry.storedAt);
}

function oldestCacheEntry(entries: Map<string, CacheEntry>): [string, CacheEntry] | undefined {
  let oldest: [string, CacheEntry] | undefined;
  for (const pair of entries) {
    if (oldest === undefined || entryAge(pair[1], Date.now()) > entryAge(oldest[1], Date.now())) {
      oldest = pair;
    }
  }
  return oldest;
}
