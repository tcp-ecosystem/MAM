import { describe, it, expect } from 'vitest';
import { QueryAnalyzer } from '../src/query/retrieval.js';
import { QueryStore } from '../src/query/store.js';
import { QueryIndex } from '../src/query/index.js';
import { QueryLifecycle } from '../src/query/lifecycle.js';
import {
  createQueryAnalysis,
  QUERY_INTENTS,
  DEFAULT_ANALYSIS_CONFIG,
} from '../src/query/types.js';

describe('query', () => {
  it('QueryAnalyzer.analyze classifies intent and extracts terms', () => {
    const analyzer = new QueryAnalyzer();
    const analysis = analyzer.analyze('How do I configure TLS in Postgres?');

    expect(analysis.original).toBe('How do I configure TLS in Postgres?');
    expect(analysis.normalized).toBe('how do i configure tls in postgres?');
    expect(analysis.intent).toBe('howto');
    expect(analysis.terms).toEqual(['configure', 'postgres', 'tls']);
    expect(analysis.confidence).toBeGreaterThan(0.8);
    expect(analysis.id).toBeTruthy();
    expect(Number.isInteger(analysis.analyzedAt)).toBe(true);
    expect(analysis.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('QueryAnalyzer.analyze decomposes comparative queries into sub-queries', () => {
    const analyzer = new QueryAnalyzer();
    const analysis = analyzer.analyze('compare postgres vs mysql');

    expect(analysis.intent).toBe('comparison');
    expect(analysis.subQueries).toEqual(['postgres', 'mysql']);
  });

  it('QueryAnalyzer.classifyIntent returns evidence-backed signals', () => {
    const analyzer = new QueryAnalyzer();
    const signal = analyzer.classifyIntent('how to bake a sourdough loaf');

    expect(signal.intent).toBe('howto');
    expect(signal.reasons).toContain('explicit how-to phrase');
    expect(signal.confidence).toBeGreaterThan(0.5);

    const empty = analyzer.classifyIntent('');
    expect(empty.intent).toBe('unknown');
    expect(empty.confidence).toBe(0);
  });

  it('QueryAnalyzer.extractTerms ranks by frequency and honors boosts', () => {
    const analyzer = new QueryAnalyzer();
    const terms = analyzer.extractTerms('How do I configure TLS in Postgres?');

    expect(terms.map((entry) => entry.term)).toEqual(['configure', 'postgres', 'tls']);
    expect(terms[0].count).toBe(1);
    expect(terms[0].score).toBeGreaterThan(0);
    expect(terms[0].score).toBeLessThanOrEqual(1);
  });

  it('QueryAnalyzer.expand appends synonym additions to the term set', () => {
    const analyzer = new QueryAnalyzer();
    const result = analyzer.expand('ai programming', {
      synonyms: { ai: ['artificial intelligence'] },
    });

    expect(result.terms).toContain('ai');
    expect(result.added).toContain('artificial intelligence');
    expect(result.expanded).toContain('ai');
    expect(result.expanded).toContain('artificial intelligence');
  });

  it('QueryAnalyzer.decompose splits comparison intents on connectors', () => {
    const analyzer = new QueryAnalyzer();
    const parts = analyzer.decompose('compare postgres vs mysql', 'comparison');

    expect(parts).toEqual(['postgres', 'mysql']);

    const atomic = analyzer.decompose('what is a vector database', 'factoid');
    expect(atomic).toEqual(['what is a vector database']);
  });

  it('QueryStore round-trips analyses through toJSON/fromJSON', () => {
    const store = new QueryStore({ capacity: 100 });
    const analyzer = new QueryAnalyzer();
    const analysis = analyzer.analyze('hello world');
    store.put(analysis);

    expect(store.hasFor('hello world')).toBe(true);
    expect(store.getFor('hello world')?.id).toBe(analysis.id);
    expect(store.size()).toBe(1);

    const restored = new QueryStore({ capacity: 100 });
    const count = restored.fromJSON(store.toJSON());
    expect(count).toBe(1);
    expect(restored.getFor('hello world')?.intent).toBe(analysis.intent);
  });

  it('QueryIndex indexes by intent and term', () => {
    const store = new QueryStore({ capacity: 100 });
    const index = new QueryIndex({ store });
    const analyzer = new QueryAnalyzer({ store });
    const analysis = analyzer.analyze('how to configure TLS');

    index.indexAnalysis(analysis);
    expect(index.size()).toBe(1);
    expect(index.findByIntent('howto').length).toBe(1);
    expect(index.findByTerm('tls').length).toBe(1);
    expect(index.findByTerm('configure').length).toBe(1);
  });

  it('QueryLifecycle.process caches, indexes and prunes to a bound', () => {
    const store = new QueryStore({ capacity: 100 });
    const index = new QueryIndex({ store });
    const analyzer = new QueryAnalyzer({ store });
    const lifecycle = new QueryLifecycle(store, { analyzer, index });

    let analyzedEvents = 0;
    lifecycle.onEvent('analyzed', () => {
      analyzedEvents += 1;
    });

    for (let i = 0; i < 20; i += 1) {
      lifecycle.process(`entry ${i}`);
    }
    expect(store.size()).toBe(20);
    expect(index.size()).toBe(20);
    expect(analyzedEvents).toBe(20);
    expect(lifecycle.stats().analyses).toBe(20);

    const pruned = lifecycle.prune(10);
    expect(pruned).toBe(10);
    expect(store.size()).toBe(10);
    lifecycle.reset();
  });

  it('QUERY_INTENTS and DEFAULT_ANALYSIS_CONFIG are available', () => {
    expect(QUERY_INTENTS).toContain('unknown');
    expect(DEFAULT_ANALYSIS_CONFIG.maxTerms).toBe(8);
    expect(DEFAULT_ANALYSIS_CONFIG.intentThreshold).toBe(0.35);

    const analysis = createQueryAnalysis({
      original: 'test',
      normalized: 'test',
      intent: 'factoid',
      terms: ['test'],
      confidence: 0.9,
      analyzedAt: 1,
      durationMs: 2,
    });
    expect(analysis.intent).toBe('factoid');
    expect(analysis.terms).toEqual(['test']);
  });
});