/**
 * Retrieval layer tests.
 */

import { describe, it, expect } from 'vitest';

import { RetrievalStore } from '../src/retrieval/store.js';
import { RetrievalIndex } from '../src/retrieval/index.js';
import { KnowledgeRetriever } from '../src/retrieval/retrieval.js';
import { RetrievalLifecycle } from '../src/retrieval/lifecycle.js';
import {
  KnowledgeRetrieverAdapter,
  createRetrieverAdapter,
  HybridRetriever,
} from '../src/retrieval/integration.js';

describe('RetrievalStore', () => {
  it('puts and gets chunks', () => {
    const store = new RetrievalStore();
    store.put({ chunkId: 'a/1', sourceId: 'a', text: 'Back up first.' });
    expect(store.get('a/1')?.text).toBe('Back up first.');
    expect(store.has('a/1')).toBe(true);
    expect(store.size).toBe(1);
    expect(store.keys()).toEqual(['a/1']);
  });

  it('returns chunks by source and filters by tags', () => {
    const store = new RetrievalStore();
    store.putMany([
      { chunkId: 'a/1', sourceId: 'a', text: 'x', tags: ['ops'] },
      { chunkId: 'a/2', sourceId: 'a', text: 'y' },
      { chunkId: 'b/1', sourceId: 'b', text: 'z', tags: ['kitchen'] },
    ]);
    expect(store.getBySource('a').length).toBe(2);
    expect(store.filter({ tags: ['ops'] }).map((c) => c.chunkId)).toEqual(['a/1']);
    expect(store.stats().chunks).toBe(3);
    expect(store.stats().sources).toBe(2);
  });
});

describe('RetrievalIndex', () => {
  it('tokenizes text and computes document frequency', () => {
    const index = new RetrievalIndex();
    index.indexText('a', 'Back up before migrating.');
    index.indexText('b', 'Migrate after a full backup.');
    expect(index.has('a')).toBe(true);
    expect(index.docFrequency('back')).toBe(1);
    expect(index.idf('back')).toBeGreaterThan(0);
    expect(index.idf('unseen-term')).toBe(0);
    expect(index.size).toBe(2);
  });

  it('builds TF-IDF vectors and ranks a matching document above an unrelated one', () => {
    const index = new RetrievalIndex();
    index.indexText('a', 'Always back up before migrating the database');
    index.indexText('b', 'Boil the pasta and add salt');
    const query = index.computeVector('back up migrate');
    const simA = index.cosineWithDocument(query, 'a');
    const simB = index.cosineWithDocument(query, 'b');
    expect(simA).toBeGreaterThan(simB);
    expect(simA).toBeGreaterThan(0);
  });
});

describe('KnowledgeRetriever', () => {
  it('searches the corpus and returns ranked chunks', () => {
    const retriever = new KnowledgeRetriever({ defaultTopK: 5 });
    retriever.addMany([
      { chunkId: 'manual/1', sourceId: 'manual', text: 'Always back up before migrating.', tags: ['ops'] },
      { chunkId: 'manual/2', sourceId: 'manual', text: 'Rollback on failure.', tags: ['ops'] },
    ]);
    const result = retriever.search('back up');
    expect(result.returned).toBeGreaterThan(0);
    expect(result.chunks[0].chunkId).toBe('manual/1');
    expect(result.chunks[0].score).toBeGreaterThanOrEqual(0);
  });

  it('returns the top k chunks', () => {
    const retriever = new KnowledgeRetriever();
    retriever.addMany([
      { chunkId: 'a', sourceId: 's', text: 'Alpha beta gamma' },
      { chunkId: 'b', sourceId: 's', text: 'Delta epsilon' },
    ]);
    const top = retriever.topK('alpha', 1);
    expect(top.length).toBe(1);
    expect(top[0].chunkId).toBe('a');
  });

  it('expands queries with context via recall', () => {
    const retriever = new KnowledgeRetriever();
    retriever.addMany([
      { chunkId: 'a', sourceId: 's', text: 'Back up the database before migrating' },
      { chunkId: 'b', sourceId: 's', text: 'Serve pasta with salt' },
    ]);
    const recalled = retriever.recall('database', 'backup migration');
    expect(recalled[0].chunkId).toBe('a');
  });
});

describe('RetrievalLifecycle', () => {
  it('registers entries and sweeps expired ones', () => {
    let now = 1000;
    const lifecycle = new RetrievalLifecycle({ ttlMs: 100, now: () => now });
    const events: string[] = [];
    lifecycle.on('cache', (event) => events.push(event.type));
    lifecycle.register('q-1', { answer: 42 });
    expect(lifecycle.get('q-1')).toEqual({ answer: 42 });
    expect(events).toContain('cache');
    now = 1200;
    expect(lifecycle.sweep()).toBe(1);
    expect(lifecycle.has('q-1')).toBe(false);
  });

  it('prunes to a maximum entry count', () => {
    const lifecycle = new RetrievalLifecycle({ maxEntries: 2 });
    lifecycle.register('a', 1);
    lifecycle.register('b', 2);
    lifecycle.register('c', 3);
    const pruned = lifecycle.prune();
    expect(pruned).toBe(1);
    expect(lifecycle.size).toBe(2);
  });
});

describe('KnowledgeRetrieverAdapter & HybridRetriever', () => {
  it('adapts a retriever behind a single surface', () => {
    const adapter = createRetrieverAdapter({ defaultTopK: 5 });
    adapter.add({ chunkId: 'a', sourceId: 's', text: 'Back up before migrating' });
    adapter.add({ chunkId: 'b', sourceId: 's', text: 'Boil pasta' });
    const result = adapter.search('back up');
    expect(result.chunks[0].chunkId).toBe('a');
    const top = adapter.topK('back up', 1);
    expect(top.length).toBe(1);
    expect(top[0].chunkId).toBe('a');
  });

  it('blends lexical and TF-IDF cosine in the hybrid retriever', async () => {
    const hybrid = new HybridRetriever(
      {},
      [
        { chunkId: 'a', sourceId: 's', text: 'Back up before migrating', tags: ['ops'] },
        { chunkId: 'b', sourceId: 's', text: 'Serve pasta with salt', tags: ['kitchen'] },
      ],
    );
    const result = await hybrid.search('how do I back up?');
    expect(hybrid.size).toBe(2);
    expect(result.chunks[0].chunkId).toBe('a');
  });
});