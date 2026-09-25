import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  ResultCache,
  createResultCache,
  DEFAULT_CACHE_TTL,
  hashCacheKey,
  formatCacheStats,
  isValidCacheKey,
} from '../mam/cache.js';

describe('ResultCache basics', () => {
  it('sets, gets, and checks keys', () => {
    const cache = new ResultCache();
    cache.set('a', 'value');
    expect(cache.get('a')).toBe('value');
    expect(cache.has('a')).toBe(true);
    expect(cache.get('missing')).toBeUndefined();
  });

  it('overwrites existing keys', () => {
    const cache = createResultCache();
    cache.set('a', '1');
    cache.set('a', '2');
    expect(cache.get('a')).toBe('2');
  });

  it('deletes and clears', () => {
    const cache = createResultCache();
    cache.set('a', 'x');
    cache.set('b', 'y');
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('expires entries by TTL', () => {
    const cache = new ResultCache(50);
    cache.set('a', 'x', 0);
    expect(cache.get('a', Date.now() + 1000)).toBeUndefined();
    const forever = createResultCache(0);
    forever.set('a', 'x');
    expect(forever.get('a', Date.now() + 100000)).toBe('x');
  });

  it('purges expired entries', () => {
    const cache = new ResultCache(50);
    cache.set('a', 'x', 0);
    cache.set('b', 'y', 0);
    expect(cache.prune(Date.now() + 1000)).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it('getOrSet computes only on miss', () => {
    const cache = createResultCache();
    let calls = 0;
    const first = cache.getOrSet('a', () => {
      calls++;
      return 'made';
    });
    const second = cache.getOrSet('a', () => {
      calls++;
      return 'other';
    });
    expect(first).toBe('made');
    expect(second).toBe('made');
    expect(calls).toBe(1);
  });

  it('tracks hit/miss stats', () => {
    const cache = createResultCache();
    cache.get('missing');
    cache.set('a', 'x');
    cache.get('a');
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(cache.hitRate()).toBe(0.5);
    expect(cache.hitRate()).toBeGreaterThanOrEqual(0);
  });

  it('rejects invalid keys', () => {
    const cache = createResultCache();
    cache.set('  ', 'x');
    cache.set('bad\nkey', 'x');
    expect(cache.size()).toBe(0);
    expect(cache.has('  ')).toBe(false);
    expect(isValidCacheKey('ok-key')).toBe(true);
    expect(isValidCacheKey('   ')).toBe(false);
    expect(isValidCacheKey('bad\nkey')).toBe(false);
  });

  it('supports remaining TTL inspection', () => {
    const cache = new ResultCache(100);
    cache.set('a', 'x');
    expect(cache.getRemainingTTL('a')).toBeGreaterThan(0);
    expect(cache.getRemainingTTL('missing')).toBeUndefined();
    const forever = createResultCache(0);
    forever.set('a', 'x');
    expect(forever.getRemainingTTL('a')).toBeUndefined();
  });

  it('persists to and loads from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-cache-'));
    try {
      const cache = new ResultCache();
      cache.set('a', { n: 1 });
      const path = join(dir, 'cache.json');
      await cache.saveToFile(path);
      const other = new ResultCache();
      const loaded = await other.loadFromFile(path);
      expect(loaded).toBe(1);
      expect(other.get('a')).toEqual({ n: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('formats cache stats', () => {
    const stats = { entries: 3, hits: 2, misses: 2, evictions: 0 };
    const text = formatCacheStats(stats);
    expect(text).toContain('3 entries');
    expect(text).toContain('50.0% hit rate');
  });
});

describe('cache constants and hashing', () => {
  it('hashes keys deterministically', () => {
    expect(hashCacheKey(['a', 1])).toBe(hashCacheKey(['a', 1]));
    expect(hashCacheKey(['a', 1])).not.toBe(hashCacheKey(['a', 2]));
    expect(hashCacheKey(['a'])).toHaveLength(64);
  });

  it('exposes a default TTL', () => {
    expect(DEFAULT_CACHE_TTL).toBe(5 * 60 * 1000);
  });
});