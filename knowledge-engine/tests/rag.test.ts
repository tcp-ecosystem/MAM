/**
 * RAG layer tests.
 */

import { describe, it, expect } from 'vitest';

import { RagStore } from '../src/rag/store.js';
import { RagIndex } from '../src/rag/index.js';
import { RagRetriever } from '../src/rag/retrieval.js';
import { RagLifecycle } from '../src/rag/lifecycle.js';
import { RagEngine } from '../src/rag/integration.js';
import type { RagPiece } from '../src/rag/types.js';

describe('RagStore', () => {
  it('puts, reads and clears entries', () => {
    const store = new RagStore();
    const piece: RagPiece = { id: 'p1', sourceId: 'manual', text: 'Back up first.', score: 0.8 };
    store.put('ctx-1', { query: 'back up', budgetTokens: 100, pieces: [piece], sources: ['manual'] });
    expect(store.has('ctx-1')).toBe(true);
    expect(store.get('ctx-1')).toBeDefined();
    expect(store.getPiece('p1')?.id).toBe('p1');
    expect(store.stats().pieces).toBe(1);
    expect(store.clear()).toBe(1);
    expect(store.size).toBe(0);
  });

  it('sweeps expired entries', () => {
    let now = 1000;
    const store = new RagStore({ ttlMs: 100, now: () => now });
    store.put('k', { id: 'p1', sourceId: 's', text: 'x', score: 0.5 });
    now = 1200;
    expect(store.sweep()).toBe(1);
    expect(store.has('k')).toBe(false);
  });
});

describe('RagIndex', () => {
  it('indexes pieces and finds them by source', () => {
    const index = new RagIndex();
    index.indexPiece({ id: 'p1', sourceId: 'manual', text: 'Back up before migrating', score: 0.9 });
    index.indexPiece({ id: 'p2', sourceId: 'manual', text: 'Rollback on failure', score: 0.4 });
    index.indexPiece({ id: 'q1', sourceId: 'faq', text: 'What is MCP?', score: 0.7 });
    expect(index.findBySource('manual').length).toBe(2);
    expect(index.has('p1')).toBe(true);
    expect(index.stats().pieces).toBe(3);
    expect(index.stats().sources).toBe(2);
  });

  it('finds pieces overlapping a query', () => {
    const index = new RagIndex();
    index.indexPiece({ id: 'p1', sourceId: 'manual', text: 'Back up before migrating the database', score: 0.9 });
    index.indexPiece({ id: 'q1', sourceId: 'faq', text: 'Serve pasta with salt', score: 0.7 });
    const hits = index.findByQuery('how do I back up?');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].id).toBe('p1');
  });
});

describe('RagRetriever', () => {
  it('retrieves and assembles a context from a source', async () => {
    const retriever = new RagRetriever({
      config: { topK: 5, budgetTokens: 100 },
      source: async () => [
        { id: 'p1', sourceId: 'manual', text: 'Always back up before migrating the database', score: 0.9 },
        { id: 'p2', sourceId: 'manual', text: 'Rollback on failure', score: 0.4 },
        { id: 'q1', sourceId: 'faq', text: 'What is a recovery point?', score: 0.7 },
      ],
    });
    const context = await retriever.retrieve('how do I back up?');
    expect(context.pieces.length).toBeGreaterThan(0);
    expect(context.budgetTokens).toBe(100);
    expect(context.query).toBe('how do i back up?');
  });

  it('assembles pieces within a token budget and builds a prompt', () => {
    const retriever = new RagRetriever();
    const context = retriever.assemble(
      [
        { id: 'a', sourceId: 's', text: 'Alpha alpha alpha', score: 0.9 },
        { id: 'b', sourceId: 's', text: 'Beta beta', score: 0.5 },
      ],
      6,
      'query text',
    );
    expect(context.totalTokens).toBeLessThanOrEqual(6);
    expect(context.sources).toContain('s');
    const prompt = retriever.buildPrompt('query text', context);
    expect(prompt).toContain('query text');
    expect(prompt).toContain('Alpha');
  });
});

describe('RagLifecycle', () => {
  it('sweeps and prunes the managed store', () => {
    let now = 1000;
    const store = new RagStore({ ttlMs: 100, now: () => now });
    const lifecycle = new RagLifecycle(store, undefined, undefined, { now: () => now });
    store.put('k', { id: 'p', sourceId: 's', text: 'x', score: 0.5 });
    now = 1200;
    expect(lifecycle.sweep()).toBe(1);
    expect(store.has('k')).toBe(false);
  });

  it('prunes to a max entry count', () => {
    const store = new RagStore();
    const lifecycle = new RagLifecycle(store);
    store.put('a', { id: 'p', sourceId: 's', text: 'x', score: 0.5 });
    store.put('b', { id: 'p2', sourceId: 's', text: 'y', score: 0.5 });
    expect(lifecycle.prune(1)).toBe(1);
    expect(store.size).toBe(1);
  });
});

describe('RagEngine', () => {
  it('retrieves, assembles and generates in one call', async () => {
    const engine = new RagEngine({ config: { topK: 5, budgetTokens: 200 } });
    engine.indexPiece({ id: 'p1', sourceId: 'manual', text: 'Always back up before migrating the database', score: 0.9 });
    engine.indexPiece({ id: 'q1', sourceId: 'faq', text: 'Rollback on failure', score: 0.4 });
    const result = await engine.retrieveAndGenerate('how do I back up?', { includePrompt: true });
    expect(result.context.pieces.length).toBeGreaterThan(0);
    expect(result.sources).toContain('manual');
    expect(result.prompt).toContain('how do i back up?');
    expect(result.score).toBeGreaterThanOrEqual(0);
    engine.dispose();
  });

  it('serves repeated queries from cache', async () => {
    const engine = new RagEngine({ config: { topK: 3, budgetTokens: 100 } });
    engine.indexPiece({ id: 'p1', sourceId: 'manual', text: 'Always back up before migrating', score: 0.9 });
    const first = await engine.retrieveAndGenerate('back up');
    expect(first.cached).toBe(false);
    const second = await engine.retrieveAndGenerate('back up');
    expect(second.cached).toBe(true);
    engine.dispose();
  });
});