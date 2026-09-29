import { describe, it, expect } from 'vitest';
import { createEvaluator, createEvaluationEngine } from '../src/evaluation/integration.js';
import { EvaluationStore } from '../src/evaluation/store.js';
import { EvaluationQuery } from '../src/evaluation/retrieval.js';
import { EvaluationLifecycle } from '../src/evaluation/lifecycle.js';

describe('evaluation', () => {
  it('Evaluator evaluate() marks pass/fail', () => {
    const evaluator = createEvaluator();
    const pass = evaluator.evaluate('accuracy', 0.99);
    expect(pass.score).toBeCloseTo(0.99, 3);
    expect(pass.passed).toBe(true);
    const fail = evaluator.evaluate('accuracy', 0.05);
    expect(fail.passed).toBe(false);
  });

  it('gate() applies default quality gates', () => {
    const evaluator = createEvaluator();
    const report = evaluator.gate(evaluator.evaluate('accuracy', 0.99));
    expect(report.outcomes.length).toBeGreaterThan(0);
    expect(report.gateScore).toBeGreaterThan(0);
    expect(report.result.passed).toBe(true);
  });

  it('evaluateMetrics aggregates a weighted score', () => {
    const evaluator = createEvaluator();
    const result = evaluator.evaluateMetrics([
      { name: 'accuracy', value: 0.9 },
      { name: 'latency', value: 0.8 },
    ]);
    expect(result.metrics).toHaveLength(2);
    expect(result.score).toBeGreaterThan(0);
  });

  it('EvaluationEngine runSuite + summary', () => {
    const engine = createEvaluationEngine();
    const suite = engine.runSuite([
      { name: 'accuracy', score: 0.9 },
      { name: 'quality', score: 0.8 },
    ]);
    expect(suite).toHaveLength(2);
    const stats = engine.summary().stats;
    expect(stats.total).toBe(2);
    expect(stats.passed).toBe(2);
    expect(stats.averageScore).toBeGreaterThan(0);
    expect(stats.passRate).toBe(1);
  });

  it('store persists results and round-trips JSON', () => {
    const store = new EvaluationStore();
    const evaluator = createEvaluator(undefined, store);
    const result = evaluator.evaluate('accuracy', 0.9);
    store.record(result);
    expect(store.size).toBe(1);
    const restored = new EvaluationStore();
    restored.fromJSON(store.toJSON());
    expect(restored.size).toBe(1);
  });

  it('EvaluationQuery filters by passed/failed', () => {
    const store = new EvaluationStore();
    const evaluator = createEvaluator(undefined, store);
    store.record(evaluator.evaluate('accuracy', 0.99));
    store.record(evaluator.evaluate('accuracy', 0.05));
    const query = new EvaluationQuery(store);
    expect(query.passed(10)).toHaveLength(1);
    expect(query.failed(10)).toHaveLength(1);
    expect(query.averageScore('accuracy')).toBeGreaterThan(0);
  });

  it('lifecycle prune', () => {
    const lifecycle = new EvaluationLifecycle();
    expect(lifecycle.prune(0)).toBeDefined();
  });
});