import { describe, it, expect } from 'vitest';
import { createTokenUsageTracker } from '../src/token-usage/integration.js';
import { createTokenUsageQuery } from '../src/token-usage/retrieval.js';
import { TokenUsageStore } from '../src/token-usage/store.js';
import { TokenUsageLifecycle } from '../src/token-usage/lifecycle.js';

describe('token usage', () => {
  it('tracker records totals per model', () => {
    const tracker = createTokenUsageTracker();
    tracker.record('gpt-4', 120, 300, { sessionId: 's1' });
    tracker.record('gpt-4', 80, 100, { sessionId: 's1' });
    const totals = tracker.summary().byModel;
    expect(totals.get('gpt-4')).toMatchObject({ inputTokens: 200, outputTokens: 400, totalTokens: 600 });
  });

  it('totalsByProvider aggregates across models', () => {
    const tracker = createTokenUsageTracker();
    tracker.record('gpt-4', 10, 20, { provider: 'openai' });
    tracker.record('claude-3', 30, 40, { provider: 'anthropic' });
    const query = createTokenUsageQuery(tracker.getStore());
    expect(query.totalsByProvider().get('openai')?.totalTokens).toBe(30);
    expect(query.totalsByProvider().get('anthropic')?.totalTokens).toBe(70);
  });

  it('sessionUsage scopes totals to a session', () => {
    const tracker = createTokenUsageTracker();
    tracker.record('gpt-4', 100, 100, { sessionId: 'a' });
    tracker.record('gpt-4', 1, 1, { sessionId: 'b' });
    const query = createTokenUsageQuery(tracker.getStore());
    expect(query.sessionUsage('a').totalTokens).toBe(200);
  });

  it('budgetUsage reports percent consumed', () => {
    const store = new TokenUsageStore();
    store.record({ id: '1', model: 'gpt-4', inputTokens: 50000, outputTokens: 0, totalTokens: 50000, timestamp: Date.now() });
    const query = createTokenUsageQuery(store);
    const usage = query.budgetUsage({ inputLimit: 100000, outputLimit: 100000 });
    expect(usage).toBeDefined();
    expect(query.grandTotal().totalTokens).toBe(50000);
  });

  it('store round-trips through JSON', () => {
    const store = new TokenUsageStore();
    store.record({ id: '1', model: 'gpt-4', inputTokens: 10, outputTokens: 20, totalTokens: 30, timestamp: Date.now() });
    const json = store.toJSON();
    const restored = TokenUsageStore.fromJSON(json);
    expect(restored.size).toBe(1);
  });

  it('lifecycle prune and reset', () => {
    const lifecycle = new TokenUsageLifecycle();
    expect(lifecycle.prune(0)).toBeDefined();
    lifecycle.reset();
    lifecycle.start();
    expect(lifecycle.state().running).toBe(true);
    lifecycle.stop();
  });
});