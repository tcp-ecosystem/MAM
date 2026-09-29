import { describe, it, expect } from 'vitest';
import { BudgetAllocator, createAllocator, ELLIPSIS_TOKENS } from '../src/budgeting/retrieval.js';
import { AllocationStore, storeFromAllocations } from '../src/budgeting/store.js';
import { AllocationIndex, INDEX_STATUSES } from '../src/budgeting/index.js';
import { BudgetingLifecycle, BUDGET_EVENTS } from '../src/budgeting/lifecycle.js';
import {
  createSectionAllocation,
  createAllocationResult,
  createFitResult,
  normalizeBudgetConfig,
  DEFAULT_BUDGET_CONFIG,
} from '../src/budgeting/types.js';

describe('budgeting', () => {
  it('BudgetAllocator.check flags requests that would exceed a ceiling', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'trim' });
    expect(allocator.check('user', 50)).toBe(false);
    expect(allocator.fits('user', 50)).toBe(true);
    expect(allocator.check('user', 150)).toBe(true);
  });

  it('BudgetAllocator.allocate trims an overrun to the available headroom', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'trim' });

    const first = allocator.allocate('user', 80);
    expect(first.allowed).toBe(80);
    expect(first.used).toBe(80);
    expect(first.exceeded).toBeUndefined();

    const second = allocator.allocate('user', 80);
    expect(second.allowed).toBe(20);
    expect(second.used).toBe(100);
    expect(second.remaining).toBe(0);
    expect(second.exceeded).toBe(true);
  });

  it('BudgetAllocator.allocate rejects overruns under the reject policy', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'reject' });
    const result = allocator.allocate('user', 150);
    expect(result.allowed).toBe(0);
    expect(result.exceeded).toBe(true);
    expect(allocator.overall().totalUsed).toBe(0);
  });

  it('BudgetAllocator.allocate allows overruns under the allow policy', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'allow' });
    const result = allocator.allocate('user', 150);
    expect(result.allowed).toBe(150);
    expect(result.exceeded).toBe(true);
    expect(allocator.overall().totalUsed).toBe(150);
  });

  it('BudgetAllocator.fit truncates long text at a word boundary with an ellipsis', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 1000 } });
    const longText =
      'This is a very long section of text that definitely exceeds the tiny token budget we are about to impose on it.';

    const full = allocator.fit('short text', 'user', 100);
    expect(full.truncated).toBe(false);
    expect(full.status).toBe('full');

    const trimmed = allocator.fit(longText, 'user', 12);
    expect(trimmed.truncated).toBe(true);
    expect(trimmed.status).toBe('trimmed');
    expect(trimmed.text).toMatch(/…$/);
    expect(trimmed.text.length).toBeLessThan(longText.length);
    expect(trimmed.usedTokens).toBeLessThanOrEqual(12 + ELLIPSIS_TOKENS);
  });

  it('BudgetAllocator.overall and available reflect usage', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100, system: 50 }, overrun: 'trim' });
    allocator.allocate('user', 40);
    allocator.allocate('system', 10);

    const overall = allocator.overall();
    expect(overall.sections).toBe(2);
    expect(overall.totalUsed).toBe(50);
    expect(overall.totalLimit).toBe(150);
    expect(overall.remaining).toBe(100);

    expect(allocator.available()).toBe(100);
  });

  it('BudgetAllocator.project is a non-mutating preview', () => {
    const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'trim' });
    const projected = allocator.project('user', 120);
    expect(projected.allowed).toBe(100);
    expect(projected.exceeded).toBe(true);
    expect(allocator.overall().totalUsed).toBe(0); // nothing committed
  });

  it('createAllocator mirrors the constructor', () => {
    const allocator = createAllocator({ overrun: 'allow' });
    expect(allocator.allocate('user', 10).allowed).toBe(10);
  });

  it('AllocationStore round-trips through toJSON/fromJSON', () => {
    const store = new AllocationStore(100);
    store.set(createSectionAllocation('user', 100, { used: 30 }));
    store.set(createSectionAllocation('system', 50, { used: 10, reserved: 5 }));

    const json = store.toJSON();
    expect(json.version).toBe(1);
    expect(json.allocations).toHaveLength(2);

    const restored = AllocationStore.from(json);
    expect(restored.size).toBe(2);
    expect(restored.used('user')).toBe(30);
    expect(restored.reserved('system')).toBe(5);
    expect(restored.remaining('system')).toBe(35);
  });

  it('AllocationStore.allocate clamps to the ceiling by default', () => {
    const store = new AllocationStore(100);
    const granted = store.allocate('user', 250);
    expect(granted).toBe(100);
    expect(store.used('user')).toBe(100);
    expect(store.isOverLimit('user')).toBe(false);

    store.allocate('user', 10, { clamp: false });
    expect(store.used('user')).toBe(110);
    expect(store.isOverLimit('user')).toBe(true);
  });

  it('storeFromAllocations pre-populates a store', () => {
    const store = storeFromAllocations([
      createSectionAllocation('user', 100, { used: 20 }),
    ]);
    expect(store.has('user')).toBe(true);
    expect(store.used('user')).toBe(20);
  });

  it('AllocationIndex classifies sections and exposes INDEX_STATUSES', () => {
    const index = new AllocationIndex({ nearThreshold: 10 });
    index.indexAllocation(createSectionAllocation('under', 100, { used: 10 }));
    index.indexAllocation(createSectionAllocation('near', 100, { used: 95 }));
    index.indexAllocation(createSectionAllocation('over', 100, { used: 120 }));

    expect(INDEX_STATUSES).toEqual(['under', 'near', 'over']);
    expect(index.statusOf('under')).toBe('under');
    expect(index.statusOf('near')).toBe('near');
    expect(index.statusOf('over')).toBe('over');
    expect(index.findOverLimit().map((a) => a.section)).toEqual(['over']);
    expect(index.findNearLimit().map((a) => a.section)).toEqual(['near']);
    expect(index.findUnderLimit().map((a) => a.section)).toEqual(['under']);
    expect(index.stats().over).toBe(1);
  });

  it('BudgetingLifecycle.prune removes idle zero-used sections', () => {
    const lifecycle = new BudgetingLifecycle({ perSection: { user: 100 } });
    lifecycle.allocate('user', 10);
    lifecycle.allocator.store.set(createSectionAllocation('memory', 100));
    lifecycle.allocator.store.set(createSectionAllocation('tools', 100, { reserved: 0 }));

    const summary = lifecycle.prune();
    expect(summary.removed).toBe(2);
    expect(lifecycle.allocator.store.has('memory')).toBe(false);
    expect(lifecycle.allocator.store.has('tools')).toBe(false);
    expect(lifecycle.allocator.store.has('user')).toBe(true);
  });

  it('BudgetingLifecycle emits events on allocation and overrun', () => {
    const lifecycle = new BudgetingLifecycle({ perSection: { user: 50 }, overrun: 'trim' });
    let allocated = 0;
    let overruns = 0;
    lifecycle.on(BUDGET_EVENTS.allocated, () => {
      allocated += 1;
    });
    lifecycle.on(BUDGET_EVENTS.overrun, () => {
      overruns += 1;
    });

    lifecycle.allocate('user', 40);
    lifecycle.allocate('user', 40);
    expect(allocated).toBe(2);
    expect(overruns).toBe(1);
  });

  it('createFitResult and normalizeBudgetConfig are exported', () => {
    const fit = createFitResult({
      section: 'user',
      sourceText: 'long input',
      text: 'long',
      truncated: true,
      status: 'trimmed',
      limit: 10,
      usedTokens: 2,
      remaining: 8,
    });
    expect(fit.originalLength).toBe(10);
    expect(fit.resultLength).toBe(4);

    const config = normalizeBudgetConfig({ overrun: 'allow' });
    expect(config.overrun).toBe('allow');
    expect(config.defaultLimit).toBe(DEFAULT_BUDGET_CONFIG.defaultLimit);
  });
});