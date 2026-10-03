import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginEventBus } from '../src/events.js';

describe('PluginEventBus', () => {
  let bus: PluginEventBus;

  beforeEach(() => {
    bus = new PluginEventBus();
  });

  it('should emit and receive events', async () => {
    const handler = vi.fn();
    bus.on('test', handler);
    await bus.emit('test', { data: 42 });
    expect(handler).toHaveBeenCalledWith({ data: 42 });
  });

  it('should support multiple handlers', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('test', h1);
    bus.on('test', h2);
    await bus.emit('test');
    expect(h1).toHaveBeenCalled();
    expect(h2).toHaveBeenCalled();
  });

  it('once should only fire once', async () => {
    const handler = vi.fn();
    bus.once('test', handler);
    await bus.emit('test');
    await bus.emit('test');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off should remove a handler', async () => {
    const handler = vi.fn();
    bus.on('test', handler);
    bus.off('test', handler);
    await bus.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('off with no handler should remove all for event', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('test', h1);
    bus.on('test', h2);
    bus.off('test');
    await bus.emit('test');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });

  it('listenerCount should return count', () => {
    bus.on('test', vi.fn());
    bus.on('test', vi.fn());
    expect(bus.listenerCount('test')).toBe(2);
    expect(bus.listenerCount('other')).toBe(0);
  });

  it('eventNames should return registered events', () => {
    bus.on('a', vi.fn());
    bus.on('b', vi.fn());
    expect(bus.eventNames().sort()).toEqual(['a', 'b']);
  });

  it('should track event log', async () => {
    await bus.emit('test', 'hello');
    const log = bus.getEventLog('test');
    expect(log).toHaveLength(1);
    expect(log[0].event).toBe('test');
  });

  it('clearEventLog should clear log', async () => {
    await bus.emit('test');
    bus.clearEventLog();
    expect(bus.getEventLog()).toHaveLength(0);
  });

  it('clear should remove everything', async () => {
    bus.on('test', vi.fn());
    await bus.emit('test');
    bus.clear();
    expect(bus.listenerCount('test')).toBe(0);
    expect(bus.getEventLog()).toHaveLength(0);
  });

  it('unsubscribe function should work', async () => {
    const handler = vi.fn();
    const unsub = bus.on('test', handler);
    unsub();
    await bus.emit('test');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle async handlers', async () => {
    let value = 0;
    bus.on('test', async () => { value = 42; });
    await bus.emit('test');
    expect(value).toBe(42);
  });

  it('should continue on handler error', async () => {
    const goodHandler = vi.fn();
    bus.on('test', vi.fn().mockRejectedValue(new Error('fail')));
    bus.on('test', goodHandler);
    await bus.emit('test');
    expect(goodHandler).toHaveBeenCalled();
  });
});
describe('PluginEventBus introspection', () => {
  let bus: PluginEventBus;

  beforeEach(() => {
    bus = new PluginEventBus();
  });

  it('getSubscribers() should include wildcard handlers before direct ones', () => {
    const order: string[] = [];
    bus.on('x', () => { order.push('direct'); }, { priority: 1 });
    bus.onAny(() => { order.push('wildcard'); });

    const subs = bus.getSubscribers('x');
    expect(subs).toHaveLength(2);
    subs.forEach((h) => h('x', undefined));
    expect(order).toEqual(['wildcard', 'direct']);
  });

  it('hasSubscribers() should reflect direct and wildcard registrations', () => {
    expect(bus.hasSubscribers('x')).toBe(false);
    bus.on('x', vi.fn());
    expect(bus.hasSubscribers('x')).toBe(true);
    expect(bus.hasSubscribers('y')).toBe(false);

    const bus2 = new PluginEventBus();
    bus2.onAny(vi.fn());
    expect(bus2.hasSubscribers('anything')).toBe(true);
  });

  it('emitBatch() should emit events in order', async () => {
    const seen: string[] = [];
    bus.on('a', () => { seen.push('a'); });
    bus.on('b', () => { seen.push('b'); });

    await bus.emitBatch([{ event: 'a' }, { event: 'b' }, { event: 'a' }]);
    expect(seen).toEqual(['a', 'b', 'a']);
  });

  it('emitBatch() should handle an empty list', async () => {
    const handler = vi.fn();
    bus.on('a', handler);
    await bus.emitBatch([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('filterLog() should return only matching logged events', async () => {
    await bus.emit('keep', { n: 1 });
    await bus.emit('drop', { n: 2 });
    await bus.emit('keep', { n: 3 });

    const kept = bus.filterLog((e) => e.event === 'keep');
    expect(kept).toHaveLength(2);
    expect(kept.map((e) => (e.data as { n: number }).n)).toEqual([1, 3]);
  });

  it('getEventsSince() should exclude events at or before the cutoff', async () => {
    await bus.emit('first');
    const cutoff = new Date(Date.now() + 5);
    await new Promise((r) => setTimeout(r, 15));
    await bus.emit('second');

    const since = bus.getEventsSince(cutoff);
    expect(since.map((e) => e.event)).toEqual(['second']);
  });

  it('getAverageDuration() should average per event and return 0 when unseen', async () => {
    expect(bus.getAverageDuration('never')).toBe(0);
    await bus.emit('x');
    await bus.emit('x');
    expect(bus.getAverageDuration('x')).toBeGreaterThan(0);
  });

  it('getTopEvents() should rank events by frequency, most common first', async () => {
    await bus.emit('a');
    await bus.emit('b');
    await bus.emit('b');
    await bus.emit('c');
    await bus.emit('c');
    await bus.emit('c');

    const top = bus.getTopEvents(2);
    expect(top).toEqual([{ event: 'c', count: 3 }, { event: 'b', count: 2 }]);
  });
});