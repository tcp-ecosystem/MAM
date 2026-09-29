import { describe, it, expect } from 'vitest';
import {
  PromptOptimizer,
  createOptimizer,
  section,
  reorderSections,
  joinSections,
} from '../src/optimization/retrieval.js';
import { OptimizationStore, createOptimizationStore, contentHash } from '../src/optimization/store.js';
import { OptimizationIndex, createOptimizationIndex, bucketFor, SAVINGS_BUCKETS } from '../src/optimization/index.js';
import { OptimizationLifecycle, createLifecycle, OPTIMIZATION_EVENTS } from '../src/optimization/lifecycle.js';
import {
  createPromptSection,
  createOptimizeResult,
  normalizeOptimizationConfig,
  DEFAULT_OPTIMIZATION_CONFIG,
} from '../src/optimization/types.js';

describe('optimization', () => {
  it('PromptOptimizer.analyze computes totals and flags over-budget sections', () => {
    const optimizer = new PromptOptimizer({ perSection: { 'system:0': 2 } });
    const analysis = optimizer.analyze([
      section('system', 'This is a long system prompt that is definitely over its tiny budget'),
      section('user', 'hi'),
    ]);

    expect(analysis.totalTokens).toBeGreaterThan(0);
    expect(analysis.perSection['system:0']).toBeGreaterThan(2);
    expect(analysis.overBudget).toContain('system:0');
    expect(analysis.suggestions.length).toBeGreaterThan(0);
    expect(analysis.sections).toHaveLength(2);
  });

  it('PromptOptimizer.analyze returns an empty result for no sections', () => {
    const optimizer = new PromptOptimizer();
    const analysis = optimizer.analyze([]);
    expect(analysis.totalTokens).toBe(0);
    expect(analysis.suggestions.length).toBeGreaterThan(0);
  });

  it('PromptOptimizer.optimize reorders sections by priority', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const result = optimizer.optimize([
      section('knowledge', 'low priority content', { priority: 1 }),
      section('user', 'high priority user turn', { priority: 10 }),
    ]);

    expect(result.applied).toContain('reorder');
    expect(result.sections[0]!.role).toBe('user');
    expect(result.optimizedText).toContain('high priority user turn');
  });

  it('PromptOptimizer.optimize compresses low-priority filler-heavy content', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const verbose = Array.from({ length: 8 }, () => 'Actually basically really quite essentially just simply honestly').join(' ');
    const result = optimizer.optimize([
      section('system', 'You are a helpful assistant.', { priority: 10 }),
      section('knowledge', verbose, { priority: 2 }),
    ]);

    expect(result.applied).toContain('compress');
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.optimizedTokens).toBeLessThan(result.originalTokens);
    expect(result.savedPercent).toBeGreaterThan(0);
  });

  it('PromptOptimizer.optimize deduplicates repeated blocks across sections', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const block = 'This repeated block of text appears in both sections and should only be kept once.';
    const result = optimizer.optimize([
      section('system', `${block} First section content.`, { priority: 10 }),
      section('knowledge', `${block} Second section content.`, { priority: 1 }),
    ]);

    expect(result.applied).toContain('dedupe');
    expect(result.optimizedText.indexOf(block)).toBe(result.optimizedText.lastIndexOf(block));
  });

  it('PromptOptimizer.optimize truncates to the global token budget', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 5 });
    const result = optimizer.optimize([
      section('system', 'The system directive that we definitely want to keep in full', { priority: 10 }),
      section('memory', 'Lots of expendable memory content that can be trimmed away entirely when the budget is tight', { priority: 1 }),
    ]);

    expect(result.applied).toContain('truncate');
    expect(result.optimizedTokens).toBeLessThanOrEqual(5);
  });

  it('PromptOptimizer.optimize tracks per-strategy details on request', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 5 });
    const result = optimizer.optimize(
      [
        section('system', 'Directive that stays', { priority: 10 }),
        section('memory', 'A whole lot of expendable memory content that will get trimmed right down to nothing.', { priority: 1 }),
      ],
      { track: true },
    );

    expect(result.strategyDetails).toBeDefined();
    expect(result.strategyDetails!.length).toBeGreaterThan(0);
    expect(result.strategyDetails!.some((d) => d.name === 'truncate')).toBe(true);
  });

  it('PromptOptimizer.savingsReport renders a human-readable report', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const result = optimizer.optimize([
      section('system', 'System directive', { priority: 10 }),
      section('user', 'User content', { priority: 8 }),
    ]);

    const report = optimizer.savingsReport(result);
    expect(report).toContain('Optimization Report');
    expect(report).toContain('Original:');
    expect(report).toContain('Optimized:');
    expect(report).toContain('Saved:');
  });

  it('reorderSections and joinSections are pure helpers', () => {
    const reordered = reorderSections([
      section('knowledge', 'b', { priority: 1 }),
      section('system', 'a', { priority: 10 }),
    ]);
    expect(reordered[0]!.role).toBe('system');
    expect(joinSections(reordered)).toContain('a');

    const joined = joinSections([section('system', 'one'), section('user', 'two')], '\n');
    expect(joined).toBe('one\ntwo');
  });

  it('OptimizationStore round-trips results through toJSON/fromJSON', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const result = optimizer.optimize([section('user', 'hello world')]);

    const store = new OptimizationStore(100);
    store.put('opt:test', result, { sourceText: 'hello world' });

    expect(store.has('opt:test')).toBe(true);
    expect(store.getFor('hello world')?.optimizedText).toBe(result.optimizedText);
    expect(store.get('opt:test')?.savedTokens).toBe(result.savedTokens);

    const restored = OptimizationStore.from(store.toJSON());
    expect(restored.size).toBe(1);
    expect(restored.getFor('hello world')?.sections).toHaveLength(1);
  });

  it('OptimizationStore respects its LRU cap and reports stats', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const store = createOptimizationStore(2);
    store.put('a', optimizer.optimize([section('user', 'aaa')]), { sourceText: 'aaa' });
    store.put('b', optimizer.optimize([section('user', 'bbb')]), { sourceText: 'bbb' });
    store.put('c', optimizer.optimize([section('user', 'ccc')]), { sourceText: 'ccc' });

    expect(store.size).toBe(2);
    expect(store.has('a')).toBe(false); // LRU-evicted
    expect(store.stats().size).toBe(2);
  });

  it('OptimizationIndex classifies by strategy and savings bucket', () => {
    const optimizer = new PromptOptimizer({ maxTotalTokens: 100_000 });
    const result = optimizer.optimize([
      section('system', 'System directive', { priority: 10 }),
      section('user', 'User content here', { priority: 8 }),
    ]);

    const index = createOptimizationIndex();
    index.indexResult('k', result);
    expect(index.size).toBe(1);
    expect(index.findByStrategy('reorder')).toHaveLength(0);
    expect(index.findByStrategy('cache')).toHaveLength(0);
    expect(bucketFor(result.savedPercent)).toMatch(/0-10|10-25|25-50|50-100/);
    expect(SAVINGS_BUCKETS).toContain('0-10');
    expect(index.stats().total).toBe(1);
  });

  it('OptimizationLifecycle caches results and short-circuits on a cache hit', () => {
    const lifecycle = new OptimizationLifecycle({ maxTotalTokens: 100_000 });
    const sections = [section('system', 'same content here')];

    const first = lifecycle.optimize(sections);
    const second = lifecycle.optimize(sections);

    expect(first.applied).not.toContain('cache');
    expect(second.applied).toContain('cache');
    expect(lifecycle.stats().cached).toBe(1);
    expect(lifecycle.stats().optimized).toBe(2);
  });

  it('OptimizationLifecycle emits optimized and pruned events and prunes the cache', () => {
    const lifecycle = new OptimizationLifecycle({ maxTotalTokens: 100_000 }, { maxEntries: 2 });
    let optimized = 0;
    lifecycle.on(OPTIMIZATION_EVENTS.optimized, () => {
      optimized += 1;
    });

    lifecycle.optimize([section('system', 'first')]);
    lifecycle.optimize([section('system', 'second')]);
    lifecycle.optimize([section('system', 'third')]);

    expect(optimized).toBe(3);
    expect(lifecycle.store.size).toBe(3);

    const summary = lifecycle.prune();
    expect(summary.removed).toBe(1);
    expect(lifecycle.store.size).toBe(2);
    expect(lifecycle.index.size).toBe(2);
  });

  it('factories: createOptimizer, createLifecycle, createPromptSection', () => {
    const optimizer = createOptimizer({ maxTotalTokens: 100_000 });
    expect(optimizer.optimize([section('user', 'x')]).optimizedText).toBe('x');

    const lifecycle = createLifecycle({ maxTotalTokens: 100_000 });
    expect(lifecycle.optimizer).toBeInstanceOf(PromptOptimizer);

    const built = createPromptSection('system', 'content', { priority: 9 });
    expect(built.priority).toBe(9);

    const result = createOptimizeResult({
      optimizedText: 't',
      originalTokens: 10,
      optimizedTokens: 5,
      applied: ['compress'],
      sections: [createPromptSection('user', 't')],
    });
    expect(result.savedTokens).toBe(5);
    expect(result.savedPercent).toBe(50);
  });

  it('normalizeOptimizationConfig and contentHash are available', () => {
    const config = normalizeOptimizationConfig({ maxTotalTokens: 99 });
    expect(config.maxTotalTokens).toBe(99);
    expect(config.strategies!.compress).toBe(true);
    expect(DEFAULT_OPTIMIZATION_CONFIG.budget).toBe(DEFAULT_OPTIMIZATION_CONFIG.maxTotalTokens);
    expect(contentHash('abc')).toBe(contentHash('abc'));
  });
});