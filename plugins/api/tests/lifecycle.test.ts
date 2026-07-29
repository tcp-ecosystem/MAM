import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginLifecycleManager } from '../src/lifecycle.js';
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
