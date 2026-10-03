import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginLifecycleManager } from '../src/lifecycle.js';
import { PluginContextProvider } from '../src/context.js';
import type { MAMPlugin } from '../src/types.js';

function makePlugin(name: string, opts?: { onLoad?: () => Promise<void>; onUnload?: () => Promise<void> }): MAMPlugin {
  return {
    manifest: {
      name,
      version: '1.0.0',
      description: `Test plugin ${name}`,
      author: 'test',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    },
    onLoad: opts?.onLoad,
    onUnload: opts?.onUnload,
  };
}

describe('PluginLifecycleManager', () => {
  let manager: PluginLifecycleManager;

  beforeEach(() => {
    manager = new PluginLifecycleManager();
  });

  it('should register a plugin', () => {
    const plugin = makePlugin('test');
    manager.register(plugin);
    expect(manager.getState('test')).toBe('registered');
  });

  it('should load a plugin', async () => {
    const plugin = makePlugin('test');
    manager.register(plugin);
    await manager.load('test');
    expect(manager.getState('test')).toBe('ready');
    expect(manager.isReady('test')).toBe(true);
  });

  it('should call onLoad during load', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin('test', { onLoad });
    manager.register(plugin);
    await manager.load('test');
    expect(onLoad).toHaveBeenCalled();
  });

  it('should call onUnload during unload', async () => {
    const onUnload = vi.fn().mockResolvedValue(undefined);
    const plugin = makePlugin('test', { onUnload });
    manager.register(plugin);
    await manager.load('test');
    await manager.unload('test');
    expect(onUnload).toHaveBeenCalled();
    expect(manager.getState('test')).toBe('unloaded');
  });

  it('should throw when loading unregistered plugin', async () => {
    await expect(manager.load('nonexistent')).rejects.toThrow('not registered');
  });

  it('should handle load errors', async () => {
    const plugin = makePlugin('test', {
      onLoad: vi.fn().mockRejectedValue(new Error('load failed')),
    });
    manager.register(plugin);
    await expect(manager.load('test')).rejects.toThrow('load failed');
    expect(manager.getState('test')).toBe('error');
  });

  it('should track load count', async () => {
    const plugin = makePlugin('test');
    manager.register(plugin);
    await manager.load('test');
    await manager.load('test');
    expect(manager.getEntry('test')?.loadCount).toBe(1);
  });

  it('getReadyPlugins should return loaded plugins', async () => {
    const plugin = makePlugin('test');
    manager.register(plugin);
    await manager.load('test');
    const ready = manager.getReadyPlugins();
    expect(ready).toHaveLength(1);
    expect(ready[0].manifest.name).toBe('test');
  });

  it('getErrorPlugins should return errored plugins', async () => {
    const plugin = makePlugin('test', {
      onLoad: vi.fn().mockRejectedValue(new Error('fail')),
    });
    manager.register(plugin);
    try { await manager.load('test'); } catch {}
    const errors = manager.getErrorPlugins();
    expect(errors).toHaveLength(1);
  });

  it('remove should remove a plugin', async () => {
    const plugin = makePlugin('test');
    manager.register(plugin);
    expect(manager.remove('test')).toBe(true);
    expect(manager.getState('test')).toBeUndefined();
  });

  it('clear should remove all plugins', () => {
    manager.register(makePlugin('a'));
    manager.register(makePlugin('b'));
    manager.clear();
    expect(manager.getAllEntries()).toHaveLength(0);
  });
});
describe('PluginLifecycleManager introspection', () => {
  let manager: PluginLifecycleManager;

  beforeEach(() => {
    manager = new PluginLifecycleManager();
  });

  it('getAvailableTransitions() should list legal next states', () => {
    manager.register(makePlugin('p'));
    expect(manager.getAvailableTransitions('p').sort()).toEqual(['loading', 'unloaded']);
  });

  it('getAvailableTransitions() should be empty for an unknown plugin', () => {
    expect(manager.getAvailableTransitions('missing')).toEqual([]);
  });

  it('getTimeInState() should return elapsed time since the last change', () => {
    manager.register(makePlugin('p'));
    const elapsed = manager.getTimeInState('p');
    expect(elapsed).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(5000);
    expect(manager.getTimeInState('missing')).toBeUndefined();
  });

  it('getTotalLoadTime() should be undefined until loaded, then defined', async () => {
    manager.register(makePlugin('p'));
    expect(manager.getTotalLoadTime('p')).toBeUndefined();
    await manager.load('p');
    expect(manager.getTotalLoadTime('p')! ).toBeGreaterThanOrEqual(0);
    expect(manager.getTotalLoadTime('missing')).toBeUndefined();
  });

  it('getStateSummary() should count plugins per state', () => {
    manager.register(makePlugin('a'));
    manager.register(makePlugin('b'));
    expect(manager.getStateSummary().registered).toBe(2);
    expect(manager.getStateSummary().ready).toBe(0);
  });

  it('getStuckPlugins() should return plugins idle beyond the threshold', async () => {
    manager.register(makePlugin('p'));
    expect(manager.getStuckPlugins(-1)).toHaveLength(1);
    expect(manager.getStuckPlugins(60000)).toHaveLength(0);
  });

  it('waitForState() should resolve once the plugin reaches the state', async () => {
    manager.register(makePlugin('p'));
    const waiting = manager.waitForState('p', 'ready', 2000);
    await manager.load('p');
    await expect(waiting).resolves.toBeUndefined();
  });

  it('waitForState() should reject for an unknown plugin', async () => {
    await expect(manager.waitForState('missing', 'ready', 100)).rejects.toThrow(/not registered/);
  });

  it('waitForState() should time out when the state is never reached', async () => {
    manager.register(makePlugin('p'));
    await expect(manager.waitForState('p', 'ready', 20)).rejects.toThrow(/Timed out/);
  });

  it('batchTransition() should isolate failures per plugin', async () => {
    manager.register(makePlugin('ok'));
    manager.register(makePlugin('bad'));

    const results = await manager.batchTransition(['ok', 'bad'], async (name) => {
      if (name === 'bad') throw new Error('nope');
      await manager.load(name);
    });

    expect(results).toEqual([
      { name: 'ok', ok: true },
      { name: 'bad', ok: false, error: 'nope' },
    ]);
    expect(manager.getState('ok')).toBe('ready');
  });
});

describe('PluginContextProvider introspection', () => {
  let provider: PluginContextProvider;

  beforeEach(() => {
    provider = new PluginContextProvider();
  });

  it('getNamespaces() should list plugins with values, sorted', () => {
    provider.setNamespaced('zeta', 'k', 1);
    provider.setNamespaced('alpha', 'k', 1);
    expect(provider.getNamespaces()).toEqual(['alpha', 'zeta']);
  });

  it('getNamespacedKeys() should return a plugin keys sorted', () => {
    provider.setNamespaced('p', 'b', 1);
    provider.setNamespaced('p', 'a', 1);
    expect(provider.getNamespacedKeys('p')).toEqual(['a', 'b']);
    expect(provider.getNamespacedKeys('missing')).toEqual([]);
  });

  it('deleteNamespaced() should remove one value and drop the empty namespace', () => {
    provider.setNamespaced('p', 'a', 1);
    expect(provider.deleteNamespaced('p', 'a')).toBe(true);
    expect(provider.getNamespacedKeys('p')).toEqual([]);
    expect(provider.getNamespaces()).toEqual([]);
    expect(provider.deleteNamespaced('p', 'a')).toBe(false);
    expect(provider.deleteNamespaced('missing', 'a')).toBe(false);
  });

  it('getExecutionById() should find a recorded execution', () => {
    const record = provider.recordExecution({
      plugin: 'p', startMs: 1, endMs: 2, success: true, output: 'ok',
    });
    expect(provider.getExecutionById(record.id)).toEqual(record);
    expect(provider.getExecutionById('nope')).toBeUndefined();
  });

  it('getFailedExecutions() should return failures newest first', () => {
    provider.recordExecution({ plugin: 'p', startMs: 1, endMs: 2, success: false, error: 'first' });
    provider.recordExecution({ plugin: 'p', startMs: 3, endMs: 4, success: true });
    provider.recordExecution({ plugin: 'p', startMs: 5, endMs: 6, success: false, error: 'second' });

    const failed = provider.getFailedExecutions('p');
    expect(failed.map((r) => r.error)).toEqual(['second', 'first']);
  });

  it('getSlowestExecutions() should rank by duration', () => {
    provider.recordExecution({ plugin: 'p', startMs: 0, endMs: 10, success: true });
    provider.recordExecution({ plugin: 'p', startMs: 0, endMs: 50, success: true });
    provider.recordExecution({ plugin: 'p', startMs: 0, endMs: 25, success: true });

    const slowest = provider.getSlowestExecutions(2, 'p');
    expect(slowest.map((r) => r.durationMs)).toEqual([50, 25]);
  });

  it('withContext() should remove the context after a successful call', async () => {
    const plugin = makePlugin('p');
    const result = await provider.withContext(plugin, { a: 1 }, async (ctx) => {
      expect(ctx.inputs).toEqual({ a: 1 });
      return 'done';
    });
    expect(result).toBe('done');
    expect(provider.getActiveContextCount()).toBe(0);
  });

  it('withContext() should clean up even when the callback throws', async () => {
    const plugin = makePlugin('p');
    await expect(
      provider.withContext(plugin, {}, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(provider.getActiveContextCount()).toBe(0);
  });
});