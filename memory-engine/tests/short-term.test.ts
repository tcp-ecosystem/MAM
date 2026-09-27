/**
 * Short-term memory layer tests.
 */

import { describe, it, expect } from 'vitest';

import { ShortTermStore } from '../src/short-term/store.js';
import { ShortTermIndex } from '../src/short-term/index.js';
import { ShortTermRetriever } from '../src/short-term/retrieval.js';
import {
  ShortTermLifecycle,
  createShortTermLifecycle,
} from '../src/short-term/lifecycle.js';
import {
  ShortTermRuntimeAdapter,
  createShortTermAdapter,
  ShortTermSession,
  createWorkingMemory,
} from '../src/short-term/integration.js';

describe('ShortTermStore', () => {
  it('puts and gets entries', () => {
    const store = new ShortTermStore();
    store.put({ id: 'a', value: 'hello' });
    expect(store.get('a')).toBe('hello');
    expect(store.has('a')).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('overwrites entries with the same id', () => {
    const store = new ShortTermStore();
    store.put({ id: 'a', value: 1 });
    store.put({ id: 'a', value: 2 });
    expect(store.get('a')).toBe(2);
  });

  it('expires fixed-TTL entries', () => {
    let now = 1000;
    const store = new ShortTermStore({ now: () => now });
    store.put({ id: 'exp', value: 'x', options: { ttlMs: 100, retention: 'fixed' } });
    expect(store.get('exp')).toBe('x');
    now = 1200;
    expect(store.get('exp')).toBeUndefined();
    expect(store.has('exp')).toBe(false);
  });

  it('keeps sliding-TTL entries alive on access', () => {
    let now = 1000;
    const store = new ShortTermStore({ now: () => now });
    store.put({ id: 's', value: 'x', options: { ttlMs: 100, retention: 'sliding' } });
    now = 1050;
    store.get('s'); // pushes deadline forward
    now = 1130; // 80ms after the read -> still within the new window
    expect(store.get('s')).toBe('x');
  });

  it('evicts least-recently-accessed entries when over maxEntries', () => {
    let now = 0;
    const store = new ShortTermStore({ maxEntries: 2, now: () => now });
    store.put({ id: 'a', value: 1 });
    now += 10;
    store.put({ id: 'b', value: 2 });
    now += 10;
    store.get('a'); // a is now the most recently used
    now += 10;
    store.put({ id: 'c', value: 3 }); // must evict 'b'
    expect(store.has('b')).toBe(false);
    expect(store.has('a')).toBe(true);
    expect(store.has('c')).toBe(true);
    expect(store.stats().evictions).toBe(1);
  });

  it('round-trips through JSON', () => {
    const store = new ShortTermStore();
    store.put({ id: 'a', value: { n: 1 }, options: { tags: ['t'], scope: 's' } });
    const snapshot = store.toJSON();
    const restored = ShortTermStore.fromJSON(JSON.stringify(snapshot));
    expect(restored.get('a')).toEqual({ n: 1 });
    expect(restored.get('a')).toEqual({ n: 1 });
  });
});

describe('ShortTermIndex', () => {
  it('indexes tags, scopes and text', () => {
    const store = new ShortTermStore();
    const index = new ShortTermIndex();
    store.put({ id: 'a', value: 'alpha beta', options: { tags: ['x'], scope: 's1' } });
    store.put({ id: 'b', value: 'gamma', options: { tags: ['y'], scope: 's1' } });
    index.rebuild(store.entries());
    expect(index.findByTag(['x']).map((e) => e.id)).toEqual(['a']);
    expect(index.findByScope('s1').length).toBe(2);
    expect(index.findByText('beta').map((e) => e.id)).toEqual(['a']);
    expect(index.stats().totalEntries).toBe(2);
  });
});

describe('ShortTermRetriever', () => {
  function setup() {
    const store = new ShortTermStore();
    const index = new ShortTermIndex();
    store.put({ id: '1', value: 'alpha', options: { tags: ['x'] } });
    store.put({ id: '2', value: 'beta', options: { tags: ['y'] } });
    store.get('1');
    store.get('1');
    index.rebuild(store.entries());
    return new ShortTermRetriever(store, index);
  }

  it('returns the most recent entries first', () => {
    const retriever = setup();
    const recent = retriever.recent(1);
    expect(recent[0].entry.id).toBe('2');
  });

  it('returns the most frequent entries first', () => {
    const retriever = setup();
    const frequent = retriever.frequent(1);
    expect(frequent[0].entry.id).toBe('1');
  });

  it('filters by tag', () => {
    const retriever = setup();
    const tagged = retriever.tagged(['x']);
    expect(tagged.map((s) => s.entry.id)).toEqual(['1']);
  });

  it('hybrid-scores against a query', () => {
    const retriever = setup();
    const hybrid = retriever.hybrid('alpha', { limit: 1 });
    expect(hybrid.length).toBe(1);
    expect(hybrid[0].entry.id).toBe('1');
    expect(hybrid[0].score).toBeGreaterThan(0);
  });
});

describe('ShortTermLifecycle', () => {
  it('prunes expired entries and emits events', () => {
    let now = 0;
    const store = new ShortTermStore({ now: () => now, maxEntries: 10 });
    const index = new ShortTermIndex();
    const lifecycle = new ShortTermLifecycle(store, index);
    store.put({ id: 'e', value: 1, options: { ttlMs: 100, retention: 'fixed' } });
    now = 200;
    let pruned = 0;
    const off = lifecycle.onPrune(() => {
      pruned += 1;
    });
    const result = lifecycle.prune();
    off();
    expect(result.expired).toBe(1);
    expect(store.has('e')).toBe(false);
    expect(pruned).toBe(1);
  });

  it('evicts down to a bound and emits evict events', () => {
    let now = 0;
    const store = new ShortTermStore({ now: () => now });
    const index = new ShortTermIndex();
    const lifecycle = new ShortTermLifecycle(store, index);
    store.put({ id: 'a', value: 1 });
    now += 10;
    store.put({ id: 'b', value: 2 });
    now += 10;
    store.put({ id: 'c', value: 3 });
    let evictIds: string[] = [];
    const off = lifecycle.onEvict((ids) => {
      evictIds = [...ids];
    });
    const result = lifecycle.evict(2);
    off();
    expect(result.evicted).toBe(1);
    expect(evictIds.length).toBe(1);
    expect(store.size()).toBe(2);
  });

  it('starts and stops the prune timer', () => {
    const { lifecycle } = createShortTermLifecycle({ pruneIntervalMs: 1000 });
    lifecycle.start();
    expect(lifecycle.isRunning()).toBe(true);
    lifecycle.stop();
    expect(lifecycle.isRunning()).toBe(false);
    lifecycle.dispose();
  });

  it('resets the store and index', () => {
    const { lifecycle, store, index } = createShortTermLifecycle();
    const entry = store.put({ id: 'a', value: 1 });
    index.indexEntry(entry);
    lifecycle.stop();
    expect(lifecycle.reset()).toBe(1);
    expect(store.size()).toBe(0);
  });
});

describe('ShortTermRuntimeAdapter', () => {
  it('implements the RuntimeMemory contract', async () => {
    const adapter = createShortTermAdapter();
    await adapter.set('k', 'hello', { tags: ['greeting'] });
    expect(await adapter.get('k')).toBe('hello');
    expect(await adapter.has('k')).toBe(true);
    expect(await adapter.keys()).toContain('k');
    const results = await adapter.search('hello');
    expect(results.total).toBeGreaterThan(0);
    expect(await adapter.delete('k')).toBe(true);
    expect(await adapter.has('k')).toBe(false);
    await adapter.clear();
  });

  it('exposes the underlying store', async () => {
    const adapter = new ShortTermRuntimeAdapter();
    adapter.storeView.put({ id: 'a', value: 1 });
    expect(await adapter.get('a')).toBe(1);
  });

  it('createWorkingMemory wires a pruning adapter', async () => {
    const adapter = createWorkingMemory(60_000, 100, 30_000);
    await adapter.set('k', 'v');
    expect(await adapter.get('k')).toBe('v');
    expect(adapter.lifecycleView).toBeDefined();
    adapter.lifecycleView?.stop();
  });
});

describe('ShortTermSession', () => {
  it('isolates sessions over a shared store', () => {
    const shared = new ShortTermStore();
    const s1 = new ShortTermSession({ store: shared, sessionId: 'one' });
    const s2 = new ShortTermSession({ store: shared, sessionId: 'two' });
    s1.set('key', 'from-one');
    s2.set('key', 'from-two');
    expect(s1.get('key')).toBe('from-one');
    expect(s2.get('key')).toBe('from-two');
    s1.end();
    s2.end();
  });

  it('searches within a session', () => {
    const session = new ShortTermSession();
    session.set('draft', 'parser EOF handling', { tags: ['parser'] });
    const results = session.search('EOF');
    expect(results.total).toBeGreaterThan(0);
    session.end();
  });
});