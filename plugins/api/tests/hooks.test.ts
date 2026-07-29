import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookManager } from '../src/hooks.js';
import type { MAMPlugin, HookName } from '../src/types.js';

function makePlugin(name: string): MAMPlugin {
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
  };
}

describe('HookManager', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  it('register() should add a hook', () => {
    const plugin = makePlugin('test-plugin');
    const handler = vi.fn();
    manager.register('beforeParse', plugin, handler);
    const registrations = manager.getRegistrations('beforeParse');
    expect(registrations).toHaveLength(1);
    expect(registrations[0].handler).toBe(handler);
    expect(registrations[0].plugin).toBe(plugin);
  });

  it('register() should sort by priority', () => {
    const plugin1 = makePlugin('low-priority');
    const plugin2 = makePlugin('high-priority');
    manager.register('beforeParse', plugin2, vi.fn(), 200);
    manager.register('beforeParse', plugin1, vi.fn(), 10);
    const registrations = manager.getRegistrations('beforeParse');
    expect(registrations[0].priority).toBe(10);
    expect(registrations[1].priority).toBe(200);
  });

  it('register() should return an id', () => {
    const id = manager.register('beforeParse', makePlugin('p'), vi.fn());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('execute() should call registered hooks with data', async () => {
    const plugin = makePlugin('test-plugin');
    const handler = vi.fn().mockResolvedValue('transformed');
    manager.register('beforeParse', plugin, handler);
    const result = await manager.execute<string>('beforeParse', 'original');
    expect(handler).toHaveBeenCalledWith('original');
    expect(result.data).toBe('transformed');
    expect(result.executed).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('execute() should return original data when no hooks registered', async () => {
    const result = await manager.execute<string>('beforeParse', 'original');
    expect(result.data).toBe('original');
    expect(result.executed).toBe(0);
  });

  it('execute() should chain multiple hooks', async () => {
    const plugin1 = makePlugin('plugin1');
    const plugin2 = makePlugin('plugin2');
    manager.register('beforeParse', plugin1, vi.fn().mockResolvedValue('step1'), 10);
    manager.register('beforeParse', plugin2, vi.fn().mockResolvedValue('step2'), 20);
    const result = await manager.execute<string>('beforeParse', 'start');
    expect(result.data).toBe('step2');
    expect(result.executed).toBe(2);
  });

  it('execute() should skip undefined/null returns and keep previous data', async () => {
    const plugin = makePlugin('test-plugin');
    const handler = vi.fn().mockResolvedValue(undefined);
    manager.register('beforeParse', plugin, handler);
    const result = await manager.execute<string>('beforeParse', 'keep-me');
    expect(result.data).toBe('keep-me');
  });

  it('execute() should continue on handler error', async () => {
    const plugin1 = makePlugin('bad-plugin');
    const plugin2 = makePlugin('good-plugin');
    manager.register('beforeParse', plugin1, vi.fn().mockRejectedValue(new Error('fail')), 10);
    manager.register('beforeParse', plugin2, vi.fn().mockResolvedValue('recovered'), 20);
    const result = await manager.execute<string>('beforeParse', 'input');
    expect(result.data).toBe('recovered');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].plugin).toBe('bad-plugin');
  });

  it('executeError() should call error hooks', async () => {
    const plugin = makePlugin('error-handler');
    const handler = vi.fn().mockResolvedValue({ handled: true });
    manager.register('onError', plugin, handler);
    const error = new Error('test error');
    const result = await manager.executeError(error, 'parse');
    expect(result).toBe(true);
  });

  it('executeError() should return false when no handler marks as handled', async () => {
    const plugin = makePlugin('error-handler');
    const handler = vi.fn().mockResolvedValue({ handled: false });
    manager.register('onError', plugin, handler);
    const result = await manager.executeError(new Error('test'), 'parse');
    expect(result).toBe(false);
  });

  it('executeError() should return false when no error hooks registered', async () => {
    const result = await manager.executeError(new Error('test'), 'parse');
    expect(result).toBe(false);
  });

  it('clear() should remove all hooks', () => {
    const plugin = makePlugin('test-plugin');
    manager.register('beforeParse', plugin, vi.fn());
    manager.register('afterParse', plugin, vi.fn());
    manager.clear();
    expect(manager.getRegistrations('beforeParse')).toHaveLength(0);
    expect(manager.getRegistrations('afterParse')).toHaveLength(0);
  });

  it('getRegistrations() should return empty array for unregistered hook', () => {
    const result = manager.getRegistrations('beforeParse');
    expect(result).toEqual([]);
  });

  it('registerPlugin() should register all hook handlers from a plugin', () => {
    const plugin = makePlugin('hook-plugin');
    plugin.hooks = { beforeParse: vi.fn(), afterParse: vi.fn() };
    manager.registerPlugin(plugin);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(1);
    expect(manager.getRegistrations('afterParse')).toHaveLength(1);
  });

  it('registerPlugin() should skip non-function hooks', () => {
    const plugin = makePlugin('mixed-plugin');
    plugin.hooks = { beforeParse: vi.fn() };
    (plugin.hooks as any).afterParse = 'not-a-function';
    manager.registerPlugin(plugin);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(1);
    expect(manager.getRegistrations('afterParse')).toHaveLength(0);
  });

  it('unregisterPlugin() should remove a plugin from all hooks', () => {
    const plugin = makePlugin('test-plugin');
    plugin.hooks = { beforeParse: vi.fn(), afterParse: vi.fn() };
    manager.registerPlugin(plugin);
    manager.unregisterPlugin(plugin);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(0);
    expect(manager.getRegistrations('afterParse')).toHaveLength(0);
  });

  it('unregister() should remove by id', () => {
    const id = manager.register('beforeParse', makePlugin('p'), vi.fn());
    expect(manager.getRegistrations('beforeParse')).toHaveLength(1);
    manager.unregister(id);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(0);
  });

  it('disable() should disable a registration', () => {
    const id = manager.register('beforeParse', makePlugin('p'), vi.fn());
    manager.disable(id);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(0);
  });

  it('enable() should re-enable a registration', () => {
    const id = manager.register('beforeParse', makePlugin('p'), vi.fn());
    manager.disable(id);
    manager.enable(id);
    expect(manager.getRegistrations('beforeParse')).toHaveLength(1);
  });

  it('getStats() should return stats', () => {
    manager.register('beforeParse', makePlugin('p'), vi.fn());
    const stats = manager.getStats();
    expect(stats.totalRegistrations).toBe(1);
    expect(stats.hooksByType.beforeParse).toBe(1);
  });

  it('hasHooks() should return true for registered hooks', () => {
    manager.register('beforeParse', makePlugin('p'), vi.fn());
    expect(manager.hasHooks('beforeParse')).toBe(true);
    expect(manager.hasHooks('afterParse')).toBe(false);
  });

  it('getPluginsByHook() should return plugin names', () => {
    manager.register('beforeParse', makePlugin('p1'), vi.fn());
    manager.register('beforeParse', makePlugin('p2'), vi.fn());
    const names = manager.getPluginsByHook('beforeParse');
    expect(names).toEqual(expect.arrayContaining(['p1', 'p2']));
  });
});
