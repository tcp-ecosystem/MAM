/**
 * Ranking layer tests.
 */

import { describe, it, expect } from 'vitest';

import { RankIndex } from '../src/ranking/index.js';
import { KnowledgeRanker } from '../src/ranking/retrieval.js';
import { RankingStore } from '../src/ranking/store.js';
import { RankingLifecycle } from '../src/ranking/lifecycle.js';
import {
  RankingAdapter,
  createRankingAdapter,
  ScoredRetriever,
} from '../src/ranking/integration.js';
import type {
  ChunkCandidate,
  RankingQuery,
  RankingResult,
  Bm25Context,
  RetrievalSource,
} from '../src/ranking/types.js';

describe('RankIndex', () => {
  it('tracks term and document frequency', () => {
    const index = new RankIndex();
    index.indexDocument('a', 'the quick brown fox jumps over the lazy dog');
    index.indexDocument('b', 'the quick brown fox');
    expect(index.documentCount()).toBe(2);
    expect(index.documentFrequency('quick')).toBe(2);
    expect(index.documentFrequency('jumps')).toBe(1);
    expect(index.termFrequency('fox', 'a')).toBe(1);
    expect(index.documentFrequency('the')).toBe(0);
  });

  it('computes BM25-style inverse document frequency', () => {
    const index = new RankIndex();
    index.indexDocument('a', 'quick fox');
    index.indexDocument('b', 'quick dog');
    const idf = index.inverseDocumentFrequency('quick');
    expect(idf).toBeGreaterThan(0);
    const expected = Math.log((2 - 2 + 0.5) / (2 + 0.5) + 1);
    expect(idf).toBeCloseTo(expected, 10);
    const unseen = index.inverseDocumentFrequency('unseen');
    expect(unseen).toBeCloseTo(Math.log((2 - 0 + 0.5) / (0 + 0.5) + 1), 10);
  });

  it('produces TF-IDF vectors and cosine similarity', () => {
    const index = new RankIndex();
    index.indexDocument('a', 'quick brown fox');
    index.indexDocument('b', 'quick brown dog');
    const sim = index.similarity('a', 'b');
    expect(sim).toBeGreaterThan(0);
    expect(index.vectorize('a').quick).toBeGreaterThan(0);
  });
});

describe('KnowledgeRanker', () => {
  const query: RankingQuery = { text: 'back up before migrate' };
  const match: ChunkCandidate = {
    chunkId: 'a',
    sourceId: 'manual',
    text: 'Always back up before migrating the database',
    metadata: { updatedAt: Date.now(), authority: 4 },
  };
  const unrelated: ChunkCandidate = {
    chunkId: 'b',
    sourceId: 'cookbook',
    text: 'Boil the pasta and add salt',
    metadata: { updatedAt: Date.now(), authority: 1 },
  };

  it('scores a matching chunk higher than an unrelated one', () => {
    const ranker = new KnowledgeRanker();
    const scoreA = ranker.score(match, query).score;
    const scoreB = ranker.score(unrelated, query).score;
    expect(scoreA).toBeGreaterThan(scoreB);
    expect(scoreA).toBeGreaterThanOrEqual(0);
    expect(scoreA).toBeLessThanOrEqual(1);
  });

  it('ranks chunks and assigns positions', () => {
    const ranker = new KnowledgeRanker();
    const ranked = ranker.rank([unrelated, match], query);
    expect(ranked[0].chunkId).toBe('a');
    expect(ranked[0].rank).toBe(1);
    expect(ranked[1].rank).toBe(2);
  });

  it('returns the best k results', () => {
    const ranker = new KnowledgeRanker();
    const best = ranker.best([unrelated, match], query, 1);
    expect(best.length).toBe(1);
    expect(best[0].chunkId).toBe('a');
  });

  it('computes BM25 and cosine components', () => {
    const ranker = new KnowledgeRanker();
    const corpus: Bm25Context = {
      documentCount: 2,
      documentFrequency: (term) => (term === 'back' ? 1 : 0),
      avgDocumentLength: 5,
    };
    const bm25 = ranker.bm25('back', { back: 2 }, corpus);
    expect(bm25).toBeGreaterThan(0);
    const cosine = ranker.cosine({ back: 1, up: 1 }, { back: 1, up: 1 });
    expect(cosine).toBeCloseTo(1, 10);
  });
});

describe('RankingLifecycle', () => {
  function result(text: string): RankingResult {
    return {
      query: { text },
      chunks: [],
      candidates: 0,
      returned: 0,
      removed: 0,
      tookMs: 0,
      at: 0,
      weights: { lexical: 1, vector: 1, recency: 0.25, authority: 0.1 },
      cached: false,
    };
  }

  it('prunes the store down to a target size and emits an event', () => {
    const store = new RankingStore();
    store.put('q-1', result('alpha'));
    store.put('q-2', result('beta'));
    store.put('q-3', result('gamma'));
    const lifecycle = new RankingLifecycle(store);
    const events: string[] = [];
    lifecycle.on('prune', (event) => events.push(event.type));
    const removed = lifecycle.prune(2);
    expect(removed).toBe(1);
    expect(store.size).toBe(2);
    expect(events).toEqual(['prune']);
  });

  it('sweeps expired entries', () => {
    let now = 1000;
    const store = new RankingStore({ ttlMs: 100, now: () => now });
    store.put('q-1', result('alpha'));
    now = 1500;
    const lifecycle = new RankingLifecycle(store, { now: () => now });
    const swept = lifecycle.sweep();
    expect(swept).toBe(1);
    expect(store.size).toBe(0);
  });
});

describe('RankingAdapter & ScoredRetriever', () => {
  const chunks: ChunkCandidate[] = [
    { chunkId: 'a', sourceId: 's', text: 'Always back up before migrating' },
    { chunkId: 'b', sourceId: 's', text: 'Boil the pasta and add salt' },
  ];

  it('ranks and caches through the adapter', () => {
    const adapter = createRankingAdapter({ cache: true });
    const ranked = adapter.rank(chunks, { text: 'back up' });
    expect(ranked[0].chunkId).toBe('a');
    const top = adapter.topK(chunks, { text: 'back up' }, 1);
    expect(top.length).toBe(1);
    expect(top[0].chunkId).toBe('a');
    expect(adapter.stats().cachedQueries).toBeGreaterThanOrEqual(1);
  });

  it('scores candidates via a ScoredRetriever wrapping a source', async () => {
    const source: RetrievalSource = {
      search: () => chunks,
    };
    const scored = new ScoredRetriever(source);
    const results = await scored.best({ text: 'back up' }, 5);
    expect(results.length).toBe(2);
    expect(results[0].chunkId).toBe('a');
    expect(results[0].rank).toBe(1);
  });
});