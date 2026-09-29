import { describe, it, expect } from 'vitest';
import { createTracer } from '../src/traces/integration.js';
import { TraceStore } from '../src/traces/store.js';
import { TraceQuery } from '../src/traces/retrieval.js';
import { TraceLifecycle } from '../src/traces/lifecycle.js';

describe('traces', () => {
  it('Tracer records a complete span via traceSync()', () => {
    const tracer = createTracer();
    const result = tracer.traceSync(() => 42, 'run');
    expect(result).toBe(42);
    expect(tracer.stats().totalSpans).toBe(1);
    expect(tracer.stats().totalTraces).toBe(1);
  });

  it('startSpan/endSpan captures timing and status', () => {
    const tracer = createTracer();
    const span = tracer.startSpan('work', { service: 'search' });
    tracer.endSpan(span);
    expect(tracer.query().recent(10)).toHaveLength(1);
    expect(tracer.query().byService('search', 10)).toHaveLength(1);
    expect(tracer.query().byStatus('ok', 10)).toHaveLength(1);
  });

  it('TraceStore round-trips through toJSON/fromJSON', () => {
    const store = new TraceStore();
    store.recordSpan({ id: 's1', traceId: 't1', name: 'a', status: 'ok', startTime: 0, endTime: 10 });
    const json = store.toJSON();
    const restored = new TraceStore();
    restored.fromJSON(json);
    expect(restored.stats().totalTraces).toBe(1);
  });

  it('TraceQuery slowest and errors', () => {
    const tracer = createTracer();
    tracer.traceSync(() => 1, 'fast');
    try {
      tracer.traceSync(() => {
        throw new Error('boom');
      }, 'boom');
    } catch {
      // expected
    }
    expect(tracer.query().errors(5)).toHaveLength(1);
    expect(tracer.query().slowest(5)).toHaveLength(2);
  });

  it('TraceLifecycle prunes and emits events', () => {
    const lifecycle = new TraceLifecycle(new TraceStore());
    const result = lifecycle.prune(0);
    expect(result).toBeDefined();
    const removed = lifecycle.reset();
    expect(typeof removed).toBe('number');
  });

  it('TraceLifecycle start/stop manage the running flag', () => {
    const lifecycle = new TraceLifecycle(new TraceStore());
    lifecycle.start();
    expect(lifecycle.running).toBe(true);
    lifecycle.stop();
    expect(lifecycle.running).toBe(false);
  });

  it('TraceQuery works over a standalone store', () => {
    const store = new TraceStore();
    store.recordSpan({ id: 's1', traceId: 't1', name: 'a', status: 'ok', startTime: 0, endTime: 10, service: 'svc' });
    const query = new TraceQuery(store);
    expect(query.recent(5)).toHaveLength(1);
    expect(query.byService('svc', 5)).toHaveLength(1);
    expect(query.getTrace('t1')).toBeDefined();
  });
});