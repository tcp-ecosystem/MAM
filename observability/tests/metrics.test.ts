import { describe, it, expect } from 'vitest';
import { createMetricsRegistry } from '../src/metrics/integration.js';
import { MetricStore } from '../src/metrics/store.js';
import { MetricQuery } from '../src/metrics/retrieval.js';
import { MetricLifecycle } from '../src/metrics/lifecycle.js';

describe('metrics', () => {
  it('counter increments accumulate', () => {
    const registry = createMetricsRegistry();
    const calls = registry.counter('executions');
    calls.increment();
    calls.increment();
    calls.increment(3);
    expect(registry.query.latest('executions')?.value).toBe(5);
  });

  it('histogram observes samples and summaries', () => {
    const registry = createMetricsRegistry();
    const latency = registry.histogram('latency_ms');
    latency.observe(100);
    latency.observe(200);
    latency.observe(300);
    const s = registry.query.summary('latency_ms');
    expect(s?.count).toBe(3);
    expect(s?.avg).toBe(200);
    expect(s?.min).toBe(100);
    expect(s?.max).toBe(300);
  });

  it('gauge set/get current value', () => {
    const registry = createMetricsRegistry();
    const queue = registry.gauge('queue_depth');
    queue.set(4);
    expect(registry.query.latest('queue_depth')?.value).toBe(4);
    queue.set(1);
    expect(registry.query.latest('queue_depth')?.value).toBe(1);
  });

  it('labels and byLabel query', () => {
    const registry = createMetricsRegistry();
    registry.counter('requests', { labels: { route: '/run' } }).increment();
    const rows = registry.query.byLabel('requests', { route: '/run' });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].value).toBe(1);
  });

  it('MetricStore works standalone with record/sample', () => {
    const store = new MetricStore();
    store.record('latency_ms', 10);
    store.sample('latency_ms', 20);
    const query = new MetricQuery(store);
    expect(query.count('latency_ms')).toBe(2);
    expect(query.total('latency_ms')).toBe(30);
  });

  it('MetricLifecycle reset and stats', () => {
    const store = new MetricStore();
    store.record('x', 1);
    const lifecycle = new MetricLifecycle(store);
    const reset = lifecycle.resetAll();
    expect(typeof reset).toBe('number');
    expect(lifecycle.stats().seriesCount).toBe(0);
    lifecycle.start();
    expect(lifecycle.stats().isRunning).toBe(true);
    lifecycle.stop();
    expect(lifecycle.stats().isRunning).toBe(false);
  });
});