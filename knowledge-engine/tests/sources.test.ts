/**
 * Sources layer tests.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { KnowledgeSourceStore } from '../src/sources/store.js';
import { SourceRetriever } from '../src/sources/retrieval.js';
import { SourceLifecycle } from '../src/sources/lifecycle.js';
import {
  KnowledgeSourceAdapter,
  createSourceAdapter,
  SourceRegistry,
} from '../src/sources/integration.js';

describe('SourceStore', () => {
  it('registers and reads back a source', () => {
    const store = new KnowledgeSourceStore();
    const result = store.register({
      id: 'manual',
      name: 'manual',
      kind: 'text',
      content: 'back up',
      createdAt: 1,
    });
    expect(result.created).toBe(true);
    expect(store.get('manual')?.content).toBe('back up');
    expect(store.getContent('manual')).toBe('back up');
    expect(store.size).toBe(1);
    expect(store.has('manual')).toBe(true);
  });

  it('ingests text and honours the duplicate skip policy', async () => {
    const store = new KnowledgeSourceStore({ onDuplicate: 'skip' });
    const first = await store.ingestText('a', 'hello', { tags: ['greeting'] });
    const second = await store.ingestText('a', 'hello again', { tags: ['greeting'] });
    expect(first.created).toBe(true);
    expect(second.skipped).toBe(true);
    expect(store.getContent('a')).toBe('hello');
  });

  it('ingests a file and resolves an absolute path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-src-'));
    try {
      const file = join(dir, 'note.md');
      await writeFile(file, '# Note\nHello world', 'utf8');
      const store = new KnowledgeSourceStore();
      const result = await store.ingestFile('note', file);
      expect(result.created).toBe(true);
      expect(store.get('note')?.kind).toBe('file');
      expect(store.getContent('note')).toBe('# Note\nHello world');
      expect(store.get('note')?.mimeType).toBe('text/markdown');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns content only for registered sources', async () => {
    const store = new KnowledgeSourceStore();
    await store.ingestText('a', 'x');
    expect(store.getContent('a')).toBe('x');
    expect(store.getContent('missing')).toBeUndefined();
  });
});

describe('SourceRetriever', () => {
  it('lists sources by kind', async () => {
    const store = new KnowledgeSourceStore();
    await store.ingestText('t1', 'alpha text', { tags: ['ops'] });
    await store.ingestText('t2', 'beta text', { tags: ['ops'] });
    const retriever = new SourceRetriever(store);
    expect(retriever.byKind('text').map((s) => s.id)).toEqual(['t1', 't2']);
    expect(retriever.byKind('file')).toEqual([]);
  });

  it('searches by weighted relevance', async () => {
    const store = new KnowledgeSourceStore();
    await store.ingestText('migration', 'Always back up before migrating the database', { tags: ['ops'] });
    await store.ingestText('cooking', 'Boil the pasta and add salt', { tags: ['kitchen'] });
    const retriever = new SourceRetriever(store);
    const result = retriever.search('back up migrate', 5);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].source.id).toBe('migration');
  });

  it('filters sources by tag mode', async () => {
    const store = new KnowledgeSourceStore();
    await store.ingestText('a', 'one', { tags: ['ops', 'runbook'] });
    await store.ingestText('b', 'two', { tags: ['ops'] });
    const retriever = new SourceRetriever(store);
    expect(retriever.byTags(['ops', 'runbook'], 10, 'all').map((s) => s.id)).toEqual(['a']);
    expect(retriever.byTags(['runbook', 'kitchen'], 10, 'any').map((s) => s.id)).toEqual(['a']);
  });
});

describe('SourceLifecycle', () => {
  it('emits ingest events', async () => {
    const lifecycle = new SourceLifecycle(new KnowledgeSourceStore());
    const events: string[] = [];
    lifecycle.on('ingest', (result) => events.push(result.source.id));
    await lifecycle.ingestText('a', 'hello');
    expect(events).toEqual(['a']);
    expect(lifecycle.storeRef.has('a')).toBe(true);
  });

  it('refreshes a file source when its content changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-lc-'));
    try {
      const file = join(dir, 'note.md');
      await writeFile(file, 'v1', 'utf8');
      const store = new KnowledgeSourceStore();
      await store.ingestFile('note', file);
      await writeFile(file, 'v2', 'utf8');
      const lifecycle = new SourceLifecycle(store);
      const refreshed: string[] = [];
      lifecycle.on('refresh', (ids) => refreshed.push(...ids));
      await lifecycle.refresh('note');
      expect(store.getContent('note')).toBe('v2');
      expect(refreshed).toContain('note');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('prunes stale sources and emits the prune event', () => {
    let now = 1000;
    const store = new KnowledgeSourceStore({ now: () => now });
    store.register({ id: 'fresh', name: 'fresh', kind: 'text', content: 'x', createdAt: now - 100 });
    store.register({ id: 'stale', name: 'stale', kind: 'text', content: 'y', createdAt: now - 10_000 });
    const lifecycle = new SourceLifecycle(store, {
      now: () => now,
      defaultTtlMs: 5_000,
    });
    const pruned: string[] = [];
    lifecycle.on('prune', (removed) => pruned.push(...removed.map((s) => s.id)));
    const removed = lifecycle.prune();
    expect(removed.map((s) => s.id)).toEqual(['stale']);
    expect(pruned).toEqual(['stale']);
    expect(store.has('stale')).toBe(false);
    expect(store.has('fresh')).toBe(true);
  });
});

describe('SourceRegistry & Adapter', () => {
  it('wires a store, index and retriever behind an adapter', async () => {
    const adapter = createSourceAdapter({ name: 'docs' });
    await adapter.ingestText('welcome', 'Hello from the engine.', { tags: ['greeting'] });
    expect(adapter.size).toBe(1);
    expect(adapter.getContent('welcome')).toBe('Hello from the engine.');
    expect(adapter.byTags(['greeting'])[0].id).toBe('welcome');
    const hits = adapter.search('engine', 5);
    expect(hits.results.length).toBe(1);
  });

  it('exposes the SourceStore surface on the concrete adapter', async () => {
    const store = new KnowledgeSourceStore();
    const adapter = new KnowledgeSourceAdapter(store);
    await adapter.ingestText('a', 'alpha');
    expect(adapter.get('a')?.content).toBe('alpha');
    expect(adapter.keys()).toEqual(['a']);
    expect(adapter.stats().sources).toBe(1);
  });

  it('bulk-ingests across adapters and reports failures', async () => {
    const registry = new SourceRegistry();
    registry.register(createSourceAdapter({ name: 'docs' }));
    registry.register(createSourceAdapter({ name: 'kb' }));
    const batch = await registry.ingestAll([
      { id: 'a', text: 'Alpha doc' },
      { id: 'b', path: 'does-not-exist.md' },
    ]);
    expect(batch.ok).toBe(1);
    expect(batch.failed).toBe(1);
  });

  it('searches across registered adapters', async () => {
    const registry = new SourceRegistry();
    const adapter = createSourceAdapter({ name: 'docs' });
    registry.register(adapter);
    await adapter.ingestText('x', 'alpha beta gamma');
    const search = registry.search('alpha');
    expect(search.adapters).toBe(1);
    expect(search.returned).toBeGreaterThan(0);
    expect(search.results[0].source.id).toBe('x');
    expect(registry.stats().adapters).toBe(1);
  });
});