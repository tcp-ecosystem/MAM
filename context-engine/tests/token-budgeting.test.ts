import { describe, it, expect } from 'vitest';
import { createTokenBudgeter, TokenBudgeter, BudgetAdapter } from '../src/token-budgeting/integration.js';
import { TokenBudgetStore } from '../src/token-budgeting/store.js';
import { BudgetManager } from '../src/token-budgeting/retrieval.js';
import { BudgetLifecycle } from '../src/token-budgeting/lifecycle.js';
import { estimateTokens } from '../src/token-budgeting/types.js';

describe('token-budgeting', () => {
  it('TokenBudgetStore allocates and releases tokens', () => {
    const store = new TokenBudgetStore({ perSection: { knowledge: 1000 } });
    const allocation = store.allocate('knowledge', 400);
    expect(allocation.granted).toBe(400);
    expect(allocation.denied).toBe(0);
    expect(allocation.ok).toBe(true);
    expect(store.used('knowledge')).toBe(400);
    expect(store.remaining('knowledge')).toBe(600);
    const released = store.release('knowledge', 150);
    expect(released).toBe(250);
    expect(store.remaining('knowledge')).toBe(750);
  });

  it('TokenBudgetStore trims, rejects and allows overruns per policy', () => {
    const store = new TokenBudgetStore({ perSection: { system: 100 }, overrunPolicy: 'trim' });
    const trimmed = store.allocate('system', 500);
    expect(trimmed.granted).toBe(100);
    expect(trimmed.denied).toBe(400);

    store.set('system', { limit: 100, used: 90 });
    const rejected = store.allocate('system', 500, { policy: 'reject' });
    expect(rejected.granted).toBe(0);
    expect(rejected.denied).toBe(500);

    store.set('system', { limit: 100, used: 0 });
    const allowed = store.allocate('system', 500, { policy: 'allow' });
    expect(allowed.granted).toBe(500);
    expect(store.status('system')).toBe('over');
    expect(store.overloaded()).toContain('system');
  });

  it('BudgetManager checks, trims and rolls up totals', () => {
    const store = new TokenBudgetStore({ perSection: { user: 1000 } });
    const manager = new BudgetManager(store);
    const check = manager.check('user', 2000);
    expect(check.wouldExceed).toBe(true);
    expect(check.deficit).toBe(1000);

    manager.allocate('user', 800);
    expect(manager.trim('user', 500)).toBe(300);
    const overall = manager.overall();
    expect(overall.totalUsed).toBe(800);
    expect(overall.totalLimit).toBe(1000);
    expect(overall.sections).toBe(1);
  });

  it('TokenBudgeter estimates token counts', () => {
    const budgeter = createTokenBudgeter(undefined, { lifecycle: false });
    expect(budgeter.estimate('')).toBe(0);
    expect(budgeter.estimate('abcd')).toBe(1);
    expect(budgeter.estimate('abcdefghij')).toBe(3);
    expect(estimateTokens('abcdefghij')).toBe(3);
  });

  it('TokenBudgeter.fit trims text to a section budget', () => {
    const budgeter = createTokenBudgeter({ perSection: { knowledge: 100 } }, { lifecycle: false });
    budgeter.allocate('knowledge', 90);
    const long = 'x'.repeat(200);
    const result = budgeter.fit(long, 'knowledge');
    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeLessThanOrEqual(10);
    expect(result.text.length).toBeLessThanOrEqual(40);
    expect(budgeter.available('knowledge')).toBe(10);
  });

  it('TokenBudgeter.fit returns text unchanged when it fits', () => {
    const budgeter = createTokenBudgeter(undefined, { lifecycle: false });
    const result = budgeter.fit('short text', 'tool');
    expect(result.truncated).toBe(false);
    expect(result.text).toBe('short text');
  });

  it('BudgetAdapter adapts an existing store and manager', () => {
    const store = new TokenBudgetStore();
    const manager = new BudgetManager(store);
    const adapter = new BudgetAdapter({ store, manager, lifecycle: false });
    const allocation = adapter.allocate('system', 100);
    expect(allocation.granted).toBe(100);
    expect(adapter.stats().totalUsed).toBe(100);
  });

  it('BudgetLifecycle prunes the least-used sections', () => {
    const store = new TokenBudgetStore({ perSection: { a: 1000, b: 1000, c: 1000 } });
    store.allocate('a', 5);
    store.allocate('b', 0);
    store.allocate('c', 0);
    const lifecycle = new BudgetLifecycle(store, { maxEntries: 2 });
    const removed = lifecycle.prune(2);
    expect(removed).toBe(1);
    expect(store.size).toBe(2);
    expect(store.has('a')).toBe(true);
    expect(lifecycle.stats().pruned).toBe(1);
  });
});