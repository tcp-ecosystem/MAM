import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, rm } from 'node:fs/promises';
import {
  MemoryCache,
  createMemoryCache,
  getCacheKey,
  isExpired,
  readJsonCacheFile,
  writeJsonCacheFile,
} from '../src/cache.js';

const TMP = join(tmpdir(), 'mam-cache-test-' + Date.now());

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('MemoryCache basics', () => {
  it('should set, get, and check keys', () => {
    const cache = new MemoryCache<string>();
    expect(cache.get('a')).toBeUndefined();
    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');
    expect(cache.has('a')).toBe(true);
    expect(cache.size).toBe(1);
  });

  it('should delete and clear entries', () => {
    const cache = createMemoryCache<string>();
    cache.set('a', 'x');
    cache.set('b', 'y');
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('should expire entries by TTL', () => {
    const cache = new MemoryCache<string>({ ttlMs: 100 });
    cache.set('a', 'x');
    expect(cache.get('a', Date.now())).toBe('x');
    expect(cache.get('a', Date.now() + 1000)).toBeUndefined();
    expect(cache.has('a', Date.now() + 1000)).toBe(false);
  });

  it('should evict oldest when maxEntries is reached', () => {
    const cache = new MemoryCache<string>({ maxEntries: 2 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should prune expired entries and report stats', () => {
    const cache = new MemoryCache<string>();
    cache.set('a', 'x', 10);
    cache.set('b', 'y');
    const removed = cache.prune(Date.now() + 1000);
    expect(removed).toBe(1);
    expect(cache.size).toBe(1);
    const stats = cache.getStats();
    expect(stats.entries).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(cache.getHitRate()).toBeGreaterThanOrEqual(0);
    expect(cache.formatStats()).toContain('entries');
    cache.resetStats();
    expect(cache.getStats().hits).toBe(0);
  });

  it('should getOrSet, refresh, and filter keys', () => {
    const cache = new MemoryCache<string>();
    expect(cache.getOrSet('a', () => 'made')).toBe('made');
    expect(cache.getOrSet('a', () => 'other')).toBe('made');
    expect(cache.refresh('a')).toBe(true);
    expect(cache.refresh('missing')).toBe(false);
    cache.set('ns:x', '1');
    cache.set('ns:y', '2');
    cache.set('other', '3');
    expect(cache.invalidatePrefix('ns:')).toBe(2);
    expect(cache.filterKeys((key) => key.startsWith('n'))).toEqual([]);
  });

  it('should convert to/from objects and clone/merge', () => {
    const cache = new MemoryCache<number>();
    cache.loadObject({ a: 1, b: 2 });
    expect(cache.toObject()).toEqual({ a: 1, b: 2 });
    const clone = cache.clone();
    expect(clone.toObject()).toEqual({ a: 1, b: 2 });
    const other = new MemoryCache<number>();
    other.set('c', 3);
    cache.merge(other);
    expect(cache.get('c')).toBe(3);
    expect(cache.getKeys().sort()).toEqual(['a', 'b', 'c']);
    expect(cache.getEntryAge('a')).toBeGreaterThanOrEqual(0);
    expect(cache.getRemainingTtl('a')).toBeUndefined();
  });

  it('should track misses in stats', () => {
    const cache = new MemoryCache<string>();
    cache.get('missing');
    expect(cache.getStats().misses).toBe(1);
  });
});

describe('getCacheKey', () => {
  it('should hash deterministically', () => {
    expect(getCacheKey(['a', 1])).toBe(getCacheKey(['a', 1]));
    expect(getCacheKey(['a', 1])).not.toBe(getCacheKey(['a', 2]));
    expect(getCacheKey(['a'])).toHaveLength(64);
  });
});

describe('isExpired', () => {
  it('should respect TTL', () => {
    const now = Date.now();
    expect(isExpired({ storedAt: now, ttlMs: 100 }, now + 50)).toBe(false);
    expect(isExpired({ storedAt: now, ttlMs: 100 }, now + 100)).toBe(true);
    expect(isExpired({ storedAt: now })).toBe(false);
  });
});

describe('readJsonCacheFile / writeJsonCacheFile', () => {
  it('should round-trip JSON files', async () => {
    const path = join(TMP, 'cache.json');
    expect(await readJsonCacheFile(path)).toBeUndefined();
    await writeJsonCacheFile(path, { a: 1 });
    expect(await readJsonCacheFile<{ a: number }>(path)).toEqual({ a: 1 });
  });

  it('should return undefined for invalid JSON', async () => {
    const { writeFile } = await import('node:fs/promises');
    const path = join(TMP, 'bad.json');
    await writeFile(path, 'not json', 'utf-8');
    expect(await readJsonCacheFile(path)).toBeUndefined();
  });
});
