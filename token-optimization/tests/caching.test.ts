import { describe, it, expect } from 'vitest';
import {
  CacheManager,
  createCacheManager,
  fnv1a,
  segmentIdFor,
} from '../src/caching/retrieval.js';
import { CacheSegmentStore, storeFromSegments } from '../src/caching/store.js';
import { CacheIndex, classifyBucket, lengthBucket, LENGTH_BUCKETS } from '../src/caching/index.js';
import { CachingLifecycle, CACHE_EVENTS } from '../src/caching/lifecycle.js';
import {
  createCachedSegment,
  estimateTokens,
  createCacheMiss,
  promotionStatusFor,
  normalizeCacheConfig,
  DEFAULT_CACHE_CONFIG,
} from '../src/caching/types.js';

describe('caching', () => {
  it('CacheManager.cache stores a segment and lookup serves an exact hit', () => {
    const manager = new CacheManager({ minHitsForPromotion: 3 });
    const text = 'SYSTEM: You are a helpful assistant';
    const segment = manager.cache(text, 8);

    expect(segment).toBeDefined();
    expect(manager.store.has(segment!.id)).toBe(true);
    expect(segment!.tokens).toBe(8);

    const hit = manager.lookup(text);
    expect(hit.hit).toBe(true);
    expect(hit.segmentId).toBe(segment!.id);
    expect(hit.savedTokens).toBe(estimateTokens(text));
    expect(hit.segmentHits).toBe(1);
  });

  it('CacheManager.lookup serves a prefix hit when text starts with a segment', () => {
    const manager = new CacheManager();
    const prefix = 'prefix-part';
    manager.cache(prefix, 4);

    const hit = manager.lookup('prefix-part extra suffix');
    expect(hit.hit).toBe(true);
    expect(hit.savedTokens).toBe(estimateTokens(prefix));

    // Exact-only suppresses prefix matches.
    const exactOnly = manager.lookup('prefix-part extra suffix', { exactOnly: true });
    expect(exactOnly.hit).toBe(false);
  });

  it('CacheManager.lookup misses for unknown text and respects minSavedTokens', () => {
    const manager = new CacheManager();
    manager.cache('known fragment', 4);

    expect(manager.lookup('something else entirely').hit).toBe(false);
    expect(manager.lookup('known fragment', { minSavedTokens: 1000 }).hit).toBe(false);
    expect(manager.lookup('').hit).toBe(false);
  });

  it('CacheManager.cache promotes a segment to hot after minHitsForPromotion', () => {
    const manager = new CacheManager({ minHitsForPromotion: 2 });
    manager.cache('promotable', 2);
    manager.lookup('promotable');
    manager.lookup('promotable');

    const id = manager.idFor('promotable');
    expect(manager.isHot(id)).toBe(true);
    expect(manager.hotIds()).toContain(id);
    expect(manager.status(id)).toBe('hot');
  });

  it('CacheManager.prefixScore computes LCP, shared tokens and stability', () => {
    const manager = new CacheManager();
    const score = manager.prefixScore(['Turn 1: hello', 'Turn 1: hello again']);

    expect(score.turns).toBe(2);
    expect(score.prefix).toBe('Turn 1: hello');
    expect(score.sharedTokens).toBe(estimateTokens('Turn 1: hello'));
    expect(score.totalTokens).toBeGreaterThan(0);
    expect(score.stability).toBeGreaterThan(0);
    expect(score.stability).toBeLessThanOrEqual(1);
  });

  it('CacheManager.evict removes cold segments first and keeps warm ones', () => {
    const manager = new CacheManager({ minHitsForPromotion: 3 });
    // Omitting `tokens` lets the manager estimate a footprint that matches the
    // heuristic used by lookup (stored tokens must be <= the input estimate).
    manager.cache('hello');
    manager.cache('world');
    manager.lookup('hello'); // 'hello' gets a hit -> warm (hits 1)

    const summary = manager.evict();
    expect(summary.removed).toBe(1);
    expect(summary.evicted).toContain(manager.idFor('world'));
    expect(manager.store.has(manager.idFor('hello'))).toBe(true);
    expect(manager.store.has(manager.idFor('world'))).toBe(false);
    expect(summary.remaining).toBe(1);
  });

  it('CacheManager.evict honours targetTokens and limit', () => {
    const manager = new CacheManager();
    manager.cache('big', 100);
    manager.cache('medium', 40);
    manager.cache('small', 10);

    const summary = manager.evict({ targetTokens: 110, limit: 10 });
    expect(summary.removed).toBe(2);
    expect(summary.freedTokens).toBeGreaterThanOrEqual(110);
  });

  it('CacheSegmentStore round-trips through toJSON/fromJSON', () => {
    const store = new CacheSegmentStore({ maxSegments: 10 });
    store.put(createCachedSegment('a', 'hello', 2));
    store.put(createCachedSegment('b', 'world', 3, { model: 'gpt-4' }));

    const json = store.toJSON();
    expect(json.version).toBe(1);
    expect(json.segments).toHaveLength(2);

    const restored = CacheSegmentStore.from(json);
    expect(restored.size).toBe(2);
    expect(restored.hits('a')).toBe(0);
    expect(restored.tokens('b')).toBe(3);
  });

  it('CacheSegmentStore.recordHit and touch update access accounting', () => {
    const store = new CacheSegmentStore();
    store.put(createCachedSegment('a', 'hello', 2));

    const hit = store.recordHit('a');
    expect(hit!.hits).toBe(1);

    const touched = store.touch('a');
    expect(touched!.lastAccessAt).toBeGreaterThanOrEqual(hit!.lastAccessAt);
    expect(store.totalHits()).toBe(1);
  });

  it('CacheSegmentStore.prune caps to maxSegments', () => {
    const store = new CacheSegmentStore({ maxSegments: 3 });
    store.put(createCachedSegment('a', 'one', 1));
    store.put(createCachedSegment('b', 'two', 1));
    store.put(createCachedSegment('c', 'three', 1));

    const summary = store.prune({ maxSegments: 1, detail: true });
    expect(summary.removed).toBe(2);
    expect(summary.remaining).toBe(1);
    expect(summary.freedTokens).toBe(2);
  });

  it('storeFromSegments pre-populates a store', () => {
    const store = storeFromSegments([createCachedSegment('a', 'hello', 2)]);
    expect(store.has('a')).toBe(true);
  });

  it('CacheIndex classifies by model, length bucket and hits', () => {
    const index = new CacheIndex();
    index.indexSegment(createCachedSegment('a', 'x', 600, { model: 'gpt-4' }));
    index.indexSegment(createCachedSegment('b', 'y', 10));

    // findByModel always includes model-agnostic segments ('*') too.
    expect(index.findByModel('gpt-4').map((s) => s.id)).toEqual(['a', 'b']);
    expect(index.findByModel('*').map((s) => s.id)).toContain('b');
    expect(index.findByMaxTokens(100).map((s) => s.id)).toEqual(['b']);
    expect(index.findCold().map((s) => s.id)).toEqual(['a', 'b']);
    expect(index.stats().segments).toBe(2);
  });

  it('CachingLifecycle.prune caps the cache and CachingLifecycle emits events', () => {
    const lifecycle = new CachingLifecycle({ maxSegments: 2 });
    let hit = 0;
    lifecycle.on(CACHE_EVENTS.hit, () => {
      hit += 1;
    });

    lifecycle.cache('alpha');
    lifecycle.cache('beta');
    lifecycle.cache('gamma');
    lifecycle.lookup('alpha');

    const summary = lifecycle.prune(1);
    expect(summary.removed).toBeGreaterThan(0);
    expect(lifecycle.manager.store.size).toBe(1);
    expect(hit).toBe(1);
  });

  it('CachingLifecycle emits promoted when a segment crosses the threshold', () => {
    const lifecycle = new CachingLifecycle({ minHitsForPromotion: 3 });
    let promoted = 0;
    lifecycle.on(CACHE_EVENTS.promoted, () => {
      promoted += 1;
    });
    lifecycle.cache('x', 2);
    lifecycle.cache('x', 2);
    lifecycle.cache('x', 2);
    lifecycle.cache('x', 2);
    expect(promoted).toBe(1);
  });

  it('helpers: fnv1a, segmentIdFor, createCacheMiss, promotionStatusFor', () => {
    expect(fnv1a('hello')).toBe(fnv1a('hello'));
    expect(fnv1a('hello')).not.toBe(fnv1a('world'));
    expect(segmentIdFor('text', 'gpt-4')).toBe(segmentIdFor('text', 'gpt-4'));
    expect(segmentIdFor('text', 'gpt-4')).not.toBe(segmentIdFor('text', 'claude'));

    expect(createCacheMiss()).toEqual({ hit: false, savedTokens: 0 });
    expect(promotionStatusFor(0, 3)).toBe('cold');
    expect(promotionStatusFor(2, 3)).toBe('warm');
    expect(promotionStatusFor(5, 3)).toBe('hot');

    expect(lengthBucket(10)).toBe('0-50');
    expect(classifyBucket(600)).toBe('501-1000');
    expect(LENGTH_BUCKETS).toContain('0-50');
    expect(normalizeCacheConfig({ enabled: false }).enabled).toBe(false);
    expect(DEFAULT_CACHE_CONFIG.enabled).toBe(true);
  });

  it('createCacheManager mirrors the constructor', () => {
    const manager = createCacheManager({ enabled: true });
    expect(manager.enabled).toBe(true);
  });
});