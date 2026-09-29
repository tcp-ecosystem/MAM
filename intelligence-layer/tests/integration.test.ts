import { describe, it, expect } from 'vitest';
import { Consolidator } from '../src/integration/retrieval.js';
import { KnowledgeStore } from '../src/integration/store.js';
import { KnowledgeIndex } from '../src/integration/index.js';
import { IntegrateLifecycle } from '../src/integration/lifecycle.js';
import {
  createKnowledgeEntry,
  createConflict,
  DEFAULT_INTEGRATE_CONFIG,
  DEFAULT_MERGE_THRESHOLD,
} from '../src/integration/types.js';

describe('integration', () => {
  it('Consolidator.consolidate dedupes near-duplicate entries', () => {
    const consolidator = new Consolidator();
    const a = createKnowledgeEntry({
      id: 'kb-1',
      content: 'Paris is the capital of France.',
      source: 'a.md',
      confidence: 0.9,
      timestamp: 1000,
    });
    const b = createKnowledgeEntry({
      id: 'kb-2',
      content: 'Paris is the capital of France.',
      source: 'b.md',
      confidence: 0.8,
      timestamp: 2000,
    });

    const result = consolidator.consolidate([a, b]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].id).toBe('kb-1');
    expect(result.removed).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('Consolidator.consolidate merges compatible entries into a canonical form', () => {
    const consolidator = new Consolidator();
    const a = createKnowledgeEntry({
      id: 'kb-1',
      content: 'Paris is the capital of France.',
      confidence: 0.9,
      timestamp: 1000,
    });
    const b = createKnowledgeEntry({
      id: 'kb-2',
      content: 'Paris is the largest city in France.',
      confidence: 0.6,
      timestamp: 2000,
    });

    const result = consolidator.consolidate([a, b]);
    expect(result.merged).toBe(1);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].content).toContain('Paris is the largest city');
    expect(result.kept[0].metadata?.mergedFrom).toContain('kb-2');
  });

  it('Consolidator.consolidate surfaces contradictions without resolving them', () => {
    const consolidator = new Consolidator();
    const a = createKnowledgeEntry({
      id: 'kb-1',
      content: 'TLS is supported by Postgres.',
      confidence: 0.9,
      timestamp: 1000,
    });
    const b = createKnowledgeEntry({
      id: 'kb-2',
      content: 'TLS is not supported by Postgres.',
      confidence: 0.8,
      timestamp: 2000,
    });

    const result = consolidator.consolidate([a, b]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].entries).toEqual(['kb-1', 'kb-2']);
    expect(result.conflicts[0].reason).toMatch(/negated term|polarity/);
    expect(result.kept).toHaveLength(2);
  });

  it('Consolidator.similarity computes Dice overlap and isContradiction detects clashes', () => {
    const consolidator = new Consolidator();
    const a = createKnowledgeEntry({
      id: 'kb-1',
      content: 'TLS is supported by Postgres.',
      confidence: 0.9,
    });
    const b = createKnowledgeEntry({
      id: 'kb-2',
      content: 'TLS is not supported by Postgres.',
      confidence: 0.8,
    });
    const unrelated = createKnowledgeEntry({
      id: 'kb-3',
      content: 'The Eiffel Tower is in Paris.',
      confidence: 0.9,
    });

    expect(consolidator.similarity(a, b)).toBeGreaterThan(0.5);
    expect(consolidator.isContradiction(a, b)).toBe(true);
    expect(consolidator.isContradiction(a, unrelated)).toBe(false);
  });

  it('Consolidator.decide previews the pairwise action', () => {
    const consolidator = new Consolidator();
    const a = createKnowledgeEntry({ id: 'kb-1', content: 'Paris is the capital of France.', confidence: 0.9 });
    const b = createKnowledgeEntry({ id: 'kb-2', content: 'Paris is the capital of France.', confidence: 0.8 });

    const decision = consolidator.decide(a, b);
    expect(decision.kind).toBe('dedupe');
    expect(decision.primary).toBe('kb-1');
    expect(decision.secondary).toBe('kb-2');
  });

  it('KnowledgeStore round-trips entries through toJSON/fromJSON', () => {
    const store = new KnowledgeStore(100);
    const entry = createKnowledgeEntry({
      id: 'kb-1',
      content: 'Paris is the capital of France.',
      confidence: 0.9,
    });
    store.put(entry);

    expect(store.has('kb-1')).toBe(true);
    expect(store.get('kb-1')?.content).toContain('Paris');
    expect(store.size).toBe(1);

    store.fromJSON(store.toJSON());
    expect(store.size).toBe(1);
    expect(store.get('kb-1')?.confidence).toBe(0.9);
  });

  it('IntegrateLifecycle.integrate ingests, consolidates and prunes to a bound', () => {
    const store = new KnowledgeStore(100);
    const index = new KnowledgeIndex();
    const lifecycle = new IntegrateLifecycle(store, index);

    const entries = [];
    for (let i = 0; i < 20; i += 1) {
      entries.push(
        createKnowledgeEntry({ id: `e${i}`, content: `entry ${i}`, tokens: [`t${i}`] }),
      );
    }
    const result = lifecycle.integrate(entries);
    expect(result.kept).toHaveLength(20);
    expect(store.size).toBe(20);
    expect(index.size).toBe(20);

    const pruned = lifecycle.prune(10);
    expect(pruned).toBe(10);
    expect(store.size).toBe(10);
    expect(lifecycle.stats().pruned).toBe(10);
    lifecycle.dispose();
  });

  it('factories and defaults are available', () => {
    const entry = createKnowledgeEntry({ id: 'kb-1', content: 'hello world', confidence: 0.8 });
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.confidence).toBe(0.8);

    const conflict = createConflict({ entries: ['kb-1', 'kb-2'], reason: 'opposite polarity' });
    expect(conflict.entries).toEqual(['kb-1', 'kb-2']);

    expect(DEFAULT_INTEGRATE_CONFIG.dedupeThreshold).toBe(0.75);
    expect(DEFAULT_MERGE_THRESHOLD).toBe(0.45);
  });
});