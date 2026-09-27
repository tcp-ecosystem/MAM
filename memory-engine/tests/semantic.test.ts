/**
 * Semantic memory layer tests.
 */

import { describe, it, expect } from 'vitest';

import { SemanticStore, createStore } from '../src/semantic/store.js';
import {
  SemanticIndex,
  createIndex,
  cosineSimilarity,
  tokenize,
} from '../src/semantic/index.js';
import { SemanticRetriever, createRetriever } from '../src/semantic/retrieval.js';
import { SemanticLifecycle, createLifecycle } from '../src/semantic/lifecycle.js';
import {
  createSemanticAdapter,
  createKnowledgeBase,
} from '../src/semantic/integration.js';

describe('SemanticStore', () => {
  it('stores and retrieves facts', () => {
    const store = createStore();
    store.put('the database is postgres', { id: 'db', tags: ['infra'], confidence: 0.9 });
    expect(store.get('db')?.fact).toBe('the database is postgres');
    expect(store.get('db')?.tags).toEqual(['infra']);
    expect(store.has('db')).toBe(true);
    expect(store.size()).toBe(1);
  });

  it('normalises tags and clamps confidence', () => {
    const store = createStore();
    const entry = store.put('x', { tags: ['Infra', 'infra', '  DB '], confidence: 5 });
    expect(entry.tags).toEqual(['infra', 'db']);
    expect(entry.confidence).toBe(1);
  });

  it('updates entries and bumps updatedAt', () => {
    const store = createStore();
    store.put('original fact', { id: 'a' });
    const updated = store.update('a', { fact: 'updated fact', tags: ['t'] });
    expect(updated.fact).toBe('updated fact');
    expect(store.get('a')?.fact).toBe('updated fact');
  });

  it('round-trips through JSON', () => {
    const store = createStore();
    store.put('a fact', { id: 'a', tags: ['x'] });
    const restored = SemanticStore.fromJSON(JSON.stringify(store.toJSON()));
    expect(restored.get('a')?.fact).toBe('a fact');
  });

  it('rejects empty facts', () => {
    const store = createStore();
    expect(() => store.put('   ')).toThrow();
  });
});

describe('SemanticIndex', () => {
  it('builds a vocabulary and computes vectors', () => {
    const index = new SemanticIndex();
    index.indexEntry({ id: 'a', fact: 'the database runs postgres', createdAt: 0 });
    index.indexEntry({ id: 'b', fact: 'the parser tokenizes markdown', createdAt: 0 });
    const vocab = index.vocabulary();
    expect(vocab.length).toBeGreaterThan(0);
    const vec = index.computeVector('database postgres');
    expect(vec.length).toBe(vocab.length);
    expect(vec.some((v) => v > 0)).toBe(true);
    expect(index.stats().documents).toBe(2);
  });

  it('tracks document frequency across entries', () => {
    const index = createIndex([
      { id: 'a', fact: 'postgres database engine', createdAt: 0 },
      { id: 'b', fact: 'postgres scales well', createdAt: 0 },
    ]);
    expect(index.vocabulary()).toContain('postgre');
    expect(index.vocabulary().length).toBeGreaterThan(3);
  });

  it('computes cosine similarity', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('tokenizes and stems text', () => {
    const tokens = tokenize('The databases are running');
    expect(tokens).toContain('database');
    expect(tokens).toContain('run');
    expect(tokens).not.toContain('the');
    expect(tokens).not.toContain('are');
  });
});

describe('SemanticRetriever', () => {
  function setup() {
    const store = new SemanticStore();
    store.put('postgres is the database engine', { id: 'db', tags: ['database'] });
    store.put('postgres scales well for large databases', { id: 'pg' });
    store.put('typescript is a programming language', { id: 'ts', tags: ['language'] });
    const index = new SemanticIndex(store.getAll());
    return { store, index, retriever: createRetriever(store, index) };
  }

  it('searches by meaning and ranks best first', () => {
    const { retriever } = setup();
    const hits = retriever.search('postgres database', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe('db');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('finds entries similar to a stored entry', () => {
    const { retriever } = setup();
    const sim = retriever.similarTo('db', 5);
    expect(sim.length).toBeGreaterThan(0);
    expect(sim[0].entry.id).toBe('pg');
  });

  it('returns top-k matches', () => {
    const { retriever } = setup();
    const top = retriever.topK('database', 2);
    expect(top.length).toBeLessThanOrEqual(2);
    expect(top.length).toBeGreaterThan(0);
  });

  it('filters by tag, subject and confidence', () => {
    const { retriever, store } = setup();
    store.put('the api returns json', { id: 'api', subject: 'api', confidence: 0.4, tags: ['backend'] });
    expect(retriever.byTag(['language']).map((e) => e.id)).toEqual(['ts']);
    expect(retriever.bySubject('api').map((e) => e.id)).toEqual(['api']);
    expect(retriever.byConfidence(0.9).map((e) => e.id)).not.toContain('api');
  });
});

describe('SemanticLifecycle', () => {
  it('prunes down to a max entry count', () => {
    const store = new SemanticStore();
    const lifecycle = createLifecycle(store, new SemanticIndex());
    store.put('fact one', { id: 'a', confidence: 0.1, createdAt: 100 });
    store.put('fact two', { id: 'b', confidence: 0.9, createdAt: 200 });
    const result = lifecycle.prune(1);
    expect(result.removed).toEqual(['a']);
    expect(store.size()).toBe(1);
    expect(store.has('b')).toBe(true);
  });

  it('dedupes identical facts', () => {
    const store = new SemanticStore();
    const index = new SemanticIndex();
    const lifecycle = new SemanticLifecycle(store, index);
    store.put('duplicate fact here', { id: 'a', createdAt: 100 });
    store.put('duplicate fact here', { id: 'b', createdAt: 200 });
    const result = lifecycle.dedupe();
    expect(result.merged).toBe(1);
    expect(store.size()).toBe(1);
    expect(result.removed).toEqual(['a']);
    expect(store.has('b')).toBe(true);
    expect(index.stats().documents).toBe(1);
  });

  it('decays stale confidence', () => {
    const store = new SemanticStore();
    const lifecycle = createLifecycle(store, new SemanticIndex());
    store.put('old fact', { id: 'a', confidence: 1, createdAt: 100, updatedAt: 100 });
    store.put('fresh fact', { id: 'b', confidence: 1, updatedAt: 9999999999999 });
    const decay = lifecycle.decayStale(1000);
    expect(decay.decayed).toBe(1);
    expect(store.get('a')?.confidence).toBeLessThan(1);
    expect(store.get('b')?.confidence).toBe(1);
  });

  it('emits lifecycle events', () => {
    const store = new SemanticStore();
    const lifecycle = createLifecycle(store, new SemanticIndex());
    store.put('f', { id: 'a' });
    store.put('f', { id: 'b' });
    let deduped = 0;
    lifecycle.on('dedupe', () => {
      deduped += 1;
    });
    lifecycle.dedupe();
    expect(deduped).toBe(1);
  });
});

describe('SemanticRuntimeAdapter & KnowledgeBase', () => {
  it('implements the runtime memory surface', async () => {
    const adapter = createSemanticAdapter();
    await adapter.set('k1', 'the sky is blue', { tags: ['nature'] });
    expect(await adapter.get('k1')).toBeDefined();
    expect(await adapter.has('k1')).toBe(true);
    const hits = adapter.search('blue sky');
    expect(hits.length).toBeGreaterThan(0);
    expect(await adapter.delete('k1')).toBe(true);
    expect(await adapter.has('k1')).toBe(false);
    await adapter.clear();
  });

  it('recalls against averaged context', async () => {
    const adapter = createSemanticAdapter();
    await adapter.set('k1', 'the parser tokenizes markdown', {});
    await adapter.set('k2', 'the linter checks types', {});
    const hits = adapter.recall('tokenize markdown');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('exposes a knowledge base with housekeeping', () => {
    const kb = createKnowledgeBase();
    kb.put('the sun is a star', { id: 's1', tags: ['astronomy'], confidence: 0.8 });
    kb.put('the sun is a star', { id: 's2', tags: ['stars'] });
    expect(kb.get('s1')?.fact).toBe('the sun is a star');
    expect(kb.topK('sun', 1).length).toBe(1);
    expect(kb.stats().entries).toBe(2);
    const dedupe = kb.dedupe();
    expect(dedupe.merged).toBe(1);
    expect(kb.size()).toBe(1);
    expect(kb.facts().length).toBe(1);
  });
});