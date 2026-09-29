import { describe, it, expect } from 'vitest';
import { createCostTracker, CostCalculator } from '../src/costs/integration.js';
import { CostStore } from '../src/costs/store.js';
import { CostQuery } from '../src/costs/retrieval.js';
import { CostLifecycle } from '../src/costs/lifecycle.js';

const pricing = {
  'gpt-4': { inputCostPer1k: 0.03, outputCostPer1k: 0.06 },
  'gpt-3.5-turbo': { inputCostPer1k: 0.001, outputCostPer1k: 0.002 },
};

describe('costs', () => {
  it('CostCalculator estimates from token counts', () => {
    const calc = new CostCalculator({ pricing });
    expect(calc.estimate('gpt-4', 1000, 1000)).toBeCloseTo(0.09, 6);
    expect(calc.estimate('gpt-4', 0, 0)).toBe(0);
  });

  it('CostCalculator detailed estimate breaks out input/output', () => {
    const calc = new CostCalculator({ pricing });
    const est = calc.estimateDetailed('gpt-4', 1000, 1000);
    expect(est.inputCost).toBeCloseTo(0.03, 6);
    expect(est.outputCost).toBeCloseTo(0.06, 6);
    expect(est.applied).toBe(true);
  });

  it('CostTracker records calls and computes totals', () => {
    const tracker = createCostTracker({ pricing });
    tracker.record('gpt-4', 1000, 1000, { sessionId: 's1' });
    expect(tracker.total()).toBeCloseTo(0.09, 6);
    expect(tracker.size).toBe(1);
  });

  it('CostTracker persists records per session', () => {
    const tracker = createCostTracker({ pricing });
    tracker.record('gpt-3.5-turbo', 1000, 0, { sessionId: 's2' });
    expect(tracker.total()).toBeCloseTo(0.001, 6);
  });

  it('CostTracker begin/end timed sessions', () => {
    const tracker = createCostTracker({ pricing });
    const handle = tracker.begin('gpt-4', { sessionId: 's3' });
    expect(tracker.activeSessions).toBe(1);
    tracker.end(handle, 1000, 1000);
    expect(tracker.activeSessions).toBe(0);
    expect(tracker.total()).toBeCloseTo(0.09, 6);
  });

  it('CostQuery totals by provider', () => {
    const store = new CostStore();
    store.record({ model: 'gpt-4', tokensIn: 1000, tokensOut: 0, cost: 0.03, timestamp: Date.now() });
    const query = new CostQuery(store);
    expect(query.total()).toBeCloseTo(0.03, 6);
    expect(query.averagePerCall()).toBeCloseTo(0.03, 6);
  });

  it('CostStore round-trips through JSON', () => {
    const store = new CostStore();
    store.record({ model: 'gpt-4', tokensIn: 100, tokensOut: 0, cost: 0.01, timestamp: Date.now() });
    const restored = new CostStore();
    restored.fromJSON(store.toJSON());
    expect(restored.size).toBe(1);
    expect(restored.getTotal()).toBeCloseTo(0.01, 6);
  });

  it('CostLifecycle prune and stats', () => {
    const store = new CostStore();
    store.record({ model: 'gpt-4', tokensIn: 10, tokensOut: 0, cost: 0.01, timestamp: 1 });
    const lifecycle = new CostLifecycle({ store });
    const removed = lifecycle.prune(0);
    expect(removed).toHaveLength(1);
    expect(lifecycle.stats().recordCount).toBe(0);
  });
});