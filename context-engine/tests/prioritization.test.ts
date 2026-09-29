import { describe, it, expect } from 'vitest';
import { createPrioritizer } from '../src/prioritization/integration.js';
import { PriorityStore } from '../src/prioritization/store.js';
import { PriorityLifecycle } from '../src/prioritization/lifecycle.js';
import { createScorer } from '../src/prioritization/retrieval.js';

const parts = [
  { partId: 'p1', content: 'onboarding flow steps and welcome email', role: 'system', createdAt: Date.now() },
  { partId: 'p2', content: 'unrelated note about groceries and milk', role: 'user', createdAt: Date.now() - 100000 },
  { partId: 'p3', content: 'account setup and welcome email settings', role: 'knowledge', createdAt: Date.now() - 5000 },
];

describe('prioritization', () => {
  it('PriorityScorer prioritizes by query relevance', () => {
    const scorer = createScorer();
    const ranked = scorer.prioritize(parts, { query: 'welcome email' });
    expect(ranked).toHaveLength(3);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(['p1', 'p3']).toContain(ranked[0].partId);
    expect(ranked.slice(0, 2).map((r) => r.partId)).toContain('p1');
  });

  it('PriorityScorer topK returns the best k', () => {
    const scorer = createScorer();
    const top = scorer.topK(parts, 1, { query: 'onboarding' });
    expect(top).toHaveLength(1);
    expect(top[0].partId).toBe('p1');
  });

  it('PriorityScorer withinBudget selects until budget exhausted', () => {
    const scorer = createScorer();
    const sel = scorer.withinBudget(parts, 1024, { query: 'email' });
    expect(sel.selected.length).toBeGreaterThan(0);
    expect(sel.selected[0].part.partId).toBeDefined();
    expect(sel.usedTokens).toBeGreaterThan(0);
  });

  it('Prioritizer run returns ranked entries with reasons', () => {
    const prioritizer = createPrioritizer();
    const ranked = prioritizer.run(parts, { query: 'email' });
    expect(ranked).toHaveLength(3);
    expect(ranked[0].score.rank).toBe(1);
    expect(Array.isArray(ranked[0].score.reasons)).toBe(true);
    expect(typeof ranked[0].score.score).toBe('number');
  });

  it('Prioritizer best and fitBudget', () => {
    const prioritizer = createPrioritizer();
    const best = prioritizer.best(parts, 1, { query: 'onboarding' });
    expect(best).toHaveLength(1);
    expect(best[0].part.partId).toBe('p1');
    const fitted = prioritizer.fitBudget(parts, 2048, { query: 'email' });
    expect(fitted.length).toBeGreaterThan(0);
    expect(fitted[0].part).toBeDefined();
    const stats = prioritizer.stats();
    expect(typeof stats.cached).toBe('number');
  });

  it('PriorityStore caches scores and round-trips JSON', () => {
    const store = new PriorityStore();
    const scorer = createScorer();
    const score = scorer.prioritize([parts[0]])[0];
    store.put(score);
    expect(store.getByPart('p1')).toBeDefined();
    expect(store.size).toBe(1);
    const restored = new PriorityStore();
    restored.fromJSON(store.toJSON());
    expect(restored.size).toBe(1);
  });

  it('PriorityLifecycle prune and clearPart', () => {
    const lifecycle = new PriorityLifecycle({ store: new PriorityStore() });
    lifecycle.start();
    expect(typeof lifecycle.prune()).toBe('number');
    expect(lifecycle.clearPart('nope')).toBe(false);
    lifecycle.reset();
    lifecycle.stop();
  });
});