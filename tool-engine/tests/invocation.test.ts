import { describe, it, expect } from 'vitest';
import { createInvocationResult, type InvocationResult } from '../src/invocation/types.js';
import { InvocationStore } from '../src/invocation/store.js';
import { InvocationIndex } from '../src/invocation/index.js';
import { ToolExecutor } from '../src/invocation/retrieval.js';
import { InvocationLifecycle } from '../src/invocation/lifecycle.js';
import { createToolInvoker } from '../src/invocation/integration.js';

describe('invocation', () => {
  it('InvocationStore records history and statistics', () => {
    const store = new InvocationStore();
    const record = store.record(
      createInvocationResult({ tool: 'math.add', ok: true, value: 3, durationMs: 5 }),
    );
    expect(record.id).toBe(0);
    expect(store.size).toBe(1);
    expect(store.historyFor('math.add')).toHaveLength(1);

    const stats = store.statsFor('math.add');
    expect(stats.totalExecutions).toBe(1);
    expect(stats.successCount).toBe(1);

    const aggregate = store.getStats();
    expect(aggregate.totalExecutions).toBe(1);
    expect(aggregate.tools).toContain('math.add');
  });

  it('ToolExecutor executes successfully', async () => {
    const executor = new ToolExecutor({ defaultTimeoutMs: 1000 });
    const result = await executor.execute(
      { tool: 'math.add', params: { a: 1, b: 2 } },
      async (params) => (params as { a: number; b: number }).a + (params as { a: number; b: number }).b,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
  });

  it('ToolExecutor times out a hanging handler', async () => {
    const executor = new ToolExecutor();
    const result = await executor.execute(
      { tool: 'slow', params: {} },
      () => new Promise(() => {}),
      { timeoutMs: 50, retry: { maxRetries: 0 } },
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('timed out');
  });

  it('ToolExecutor retries failing attempts', async () => {
    const executor = new ToolExecutor();
    let calls = 0;
    const result = await executor.execute(
      { tool: 'flaky', params: {} },
      async () => {
        calls += 1;
        if (calls < 3) {
          throw new Error('boom');
        }
        return 'ok';
      },
      { timeoutMs: 1000, retry: { maxRetries: 3, backoffMs: 1 } },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe('ok');
    expect(calls).toBe(3);
    expect(result.attempt).toBe(3);
  });

  it('ToolInvoker invokes, mocks and serves from an external cache', async () => {
    const invoker = createToolInvoker({ config: { timeoutMs: 1000 } });

    const result = await invoker.invoke(
      { tool: 'math.add', params: { a: 1, b: 2 } },
      async (params) => (params as { a: number; b: number }).a + (params as { a: number; b: number }).b,
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);

    invoker.mock('flaky', 'stubbed').enableMock();
    const mocked = await invoker.invoke({ tool: 'flaky', params: {} }, async () => 'real');
    expect(mocked.ok).toBe(true);
    expect(mocked.mock).toBe(true);
    expect(mocked.value).toBe('stubbed');

    const cache = new Map<string, InvocationResult>();
    let handlerCalls = 0;
    const handler = async (params: unknown) => {
      handlerCalls += 1;
      return (params as { a: number; b: number }).a + (params as { a: number; b: number }).b;
    };
    const first = await invoker.invokeWithCache(
      { tool: 'math.add', params: { a: 10, b: 20 } },
      handler,
      cache,
    );
    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);

    const second = await invoker.invokeWithCache(
      { tool: 'math.add', params: { a: 10, b: 20 } },
      handler,
      cache,
    );
    expect(second.cached).toBe(true);
    expect(second.value).toBe(30);
    expect(handlerCalls).toBe(1);
  });

  it('InvocationLifecycle prunes history to a bound', () => {
    const store = new InvocationStore();
    const index = new InvocationIndex();
    const lifecycle = new InvocationLifecycle(store, index);
    for (let i = 0; i < 5; i += 1) {
      store.record(createInvocationResult({ tool: 't', ok: true, value: i }));
    }
    expect(lifecycle.size).toBe(5);

    const removed = lifecycle.prune(2);
    expect(removed).toBe(3);
    expect(lifecycle.size).toBe(2);

    expect(lifecycle.start()).toBe(true);
    expect(lifecycle.stop()).toBe(true);
  });
});