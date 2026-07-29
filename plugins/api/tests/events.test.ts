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
