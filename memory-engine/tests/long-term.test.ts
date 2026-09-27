/**
 * Long-term memory layer tests.
 */

import { describe, it, expect, afterEach } from 'vitest';

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

import { LongTermStore } from '../src/long-term/store.js';
import { LongTermIndex } from '../src/long-term/index.js';
import {
  LongTermRetriever,
  createLongTermRetriever,
} from '../src/long-term/retrieval.js';
import {
  LongTermLifecycle,
  createLongTermLifecycle,
} from '../src/long-term/lifecycle.js';
import {
  createLongTermAdapter,
  createLongTermRepository,
} from '../src/long-term/integration.js';

const tempFiles: string[] = [];

function tempPath(): string {
  const path = join(tmpdir(), `mam-lt-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tempFiles.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(tempFiles.splice(0).map((path) => rm(path, { force: true })));
});

describe('LongTermStore', () => {
  it('puts, gets and tags entries', () => {
    const store = new LongTermStore();
    store.put({ id: 'a', value: 'hello', options: { tags: ['greeting'], source: 'tests' } });
    expect(store.get('a')?.value).toBe('hello');
    expect(store.getByTag('greeting')[0].id).toBe('a');
    expect(store.getByImportance(0).length).toBe(1);
    expect(store.has('a')).toBe(true);
  });

  it('persists and loads from disk', async () => {
    const path = tempPath();
    const store = new LongTermStore({ persistPath: path, autoLoad: false });
    store.put({ id: 'a', value: { n: 1 }, options: { tags: ['x'] } });
    await store.persist();

    const loaded = new LongTermStore({ persistPath: path, autoLoad: false });
    await loaded.load();
    expect(loaded.get('a')?.value).toEqual({ n: 1 });
    expect(loaded.get('a')?.tags).toContain('x');
  });

  it('archives entries out of normal retrieval', () => {
    const store = new LongTermStore();
    store.put({ id: 'a', value: 1 });
    expect(store.archive('a')).toBe(true);
    expect(store.get('a')?.archived).toBe(true);
    expect(store.getAll().length).toBe(0);
    expect(store.getAll({ includeArchived: true }).length).toBe(1);
    expect(store.unarchive('a')).toBe(true);
    expect(store.getAll().length).toBe(1);
  });

  it('updates entries in place', () => {
    const store = new LongTermStore();
    store.put({ id: 'a', value: 1 });
    const updated = store.update('a', { value: 2, importance: 0.8 });
    expect(updated?.value).toBe(2);
    expect(updated?.importance).toBe(0.8);
    expect(store.get('a')?.value).toBe(2);
  });
});

describe('LongTermRetriever', () => {
  function setup() {
    const store = new LongTermStore();
    store.put({ id: 'a', value: 'hello world', options: { tags: ['greeting'], importance: 0.2, createdAt: 100 } });
    store.put({ id: 'b', value: 'world of warcraft', options: { tags: ['game'], importance: 0.9, createdAt: 200 } });
    const index = new LongTermIndex();
    index.rebuild(store.getAll({ includeArchived: true }));
    return { store, index, retriever: createLongTermRetriever(store, index) };
  }

  it('returns the most recent entries first', () => {
    const { retriever } = setup();
    expect(retriever.recent(1)[0].id).toBe('b');
  });

  it('returns the most important entries first', () => {
    const { retriever } = setup();
    expect(retriever.important(1)[0].id).toBe('b');
  });

  it('filters by tag', () => {
    const { retriever } = setup();
    expect(retriever.tagged('greeting').map((e) => e.id)).toEqual(['a']);
  });

  it('hybrid-scores against a query', () => {
    const { retriever } = setup();
    const hits = retriever.hybrid('hello', { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe('a');
    expect(hits[0].breakdown.match).toBeGreaterThan(0);
  });
});

describe('LongTermLifecycle', () => {
  it('prunes down to maxEntries by importance', () => {
    const store = new LongTermStore({ maxEntries: 10 });
    const lifecycle = new LongTermLifecycle(store, { autoStart: false });
    store.put({ id: 'a', value: 1, options: { importance: 0.1, createdAt: 100 } });
    store.put({ id: 'b', value: 2, options: { importance: 0.2, createdAt: 200 } });
    store.put({ id: 'c', value: 3, options: { importance: 0.9, createdAt: 300 } });
    store.put({ id: 'd', value: 4, options: { importance: 0.8, createdAt: 400 } });
    const removed = lifecycle.prune({ maxEntries: 2 });
    expect(removed.length).toBe(2);
    expect(store.size()).toBe(2);
    expect(store.has('c')).toBe(true);
    expect(store.has('d')).toBe(true);
  });

  it('consolidates duplicate-valued entries', () => {
    const store = new LongTermStore();
    const lifecycle = new LongTermLifecycle(store, { autoStart: false });
    store.put({ id: 'a', value: 'dup', options: { tags: ['x'], importance: 0.5 } });
    store.put({ id: 'b', value: 'dup', options: { tags: ['x'], importance: 0.8 } });
    const result = lifecycle.consolidate();
    expect(result.merged.length).toBe(1);
    expect(store.size()).toBe(1);
  });

  it('emits prune events and can be reset', () => {
    const store = new LongTermStore();
    const lifecycle = new LongTermLifecycle(store, { autoStart: false });
    store.put({ id: 'a', value: 1 });
    let pruned = 0;
    lifecycle.on('prune', () => {
      pruned += 1;
    });
    lifecycle.prune({ maxEntries: 0 });
    expect(pruned).toBe(1);
    expect(lifecycle.reset()).toBe(0);
  });

  it('createLongTermLifecycle wires store, index and lifecycle', () => {
    const { store, index, lifecycle } = createLongTermLifecycle({ maxEntries: 5 });
    store.put({ id: 'a', value: 1, options: { tags: ['t'], importance: 0.7 } });
    lifecycle.syncIndex();
    expect(index.has('a')).toBe(true);
    expect(lifecycle.isRunning()).toBe(true);
    lifecycle.stop();
    expect(lifecycle.isRunning()).toBe(false);
  });
});

describe('LongTermRuntimeAdapter', () => {
  it('implements the runtime memory surface', async () => {
    const adapter = createLongTermAdapter({ autoStart: false });
    adapter.set('k', 'durable value', { tags: ['durable'], importance: 0.7 });
    expect(adapter.get('k')?.value).toBe('durable value');
    expect(adapter.has('k')).toBe(true);
    expect(adapter.search('durable').length).toBeGreaterThan(0);
    expect(adapter.recall('durable').length).toBeGreaterThan(0);
    expect(adapter.keys()).toContain('k');
    expect(adapter.delete('k')).toBe(true);
    expect(adapter.has('k')).toBe(false);
  });

  it('archives and rescore entries', () => {
    const adapter = createLongTermAdapter({ autoStart: false });
    adapter.set('k', 1);
    expect(adapter.archive('k')).toBe(true);
    expect(adapter.get('k')?.archived).toBe(true);
    adapter.unarchive('k');
    const rescored = adapter.rescore('k', 0.95);
    expect(rescored?.importance).toBe(0.95);
  });
});

describe('LongTermRepository', () => {
  it('remembers, recalls and snapshots knowledge', async () => {
    const repo = createLongTermRepository({ autoStart: false });
    repo.remember('the parser handles EOF', { key: 'parser', tags: ['parser'], importance: 0.9 });
    expect(repo.knowledge('parser')?.importance).toBe(0.9);
    expect(repo.recall('parser').length).toBeGreaterThan(0);
    expect(repo.byTag('parser').length).toBe(1);
    const snapshot = repo.snapshot();
    expect(snapshot.kind).toBe('mam.long-term.repository');
    expect((snapshot.entries as unknown[]).length).toBe(1);
    expect(repo.forget('parser')).toBe(true);
  });
});