/**
 * PluginRegistry Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginRegistry } from '../src/registry.js';
import { HookManager } from '../src/hooks.js';
import type { MAMPlugin } from '../src/types.js';

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

describe('PluginRegistry', () => {
  let hookManager: HookManager;
  let registry: PluginRegistry;

  beforeEach(() => {
    hookManager = new HookManager();
    registry = new PluginRegistry(hookManager);
  });

  it('getPlugin() should return undefined for unknown plugin', () => {
    expect(registry.getPlugin('nonexistent')).toBeUndefined();
  });

  it('getAllPlugins() should return empty array initially', () => {
    expect(registry.getAllPlugins()).toEqual([]);
  });

  it('getPluginCount() should return 0 initially', () => {
    expect(registry.getPluginCount()).toBe(0);
  });

  it('isLoaded() should return false for unknown plugin', () => {
    expect(registry.isLoaded('nonexistent')).toBe(false);
  });

  it('getEnabledPlugins() should return empty array initially', () => {
    expect(registry.getEnabledPlugins()).toEqual([]);
  });

  it('disablePlugin() should disable a loaded plugin', async () => {
    const plugin = makePlugin('test-plugin');
    const entry = {
      manifest: plugin.manifest,
      plugin,
      path: '/fake/path',
      enabled: true,
      loadedAt: new Date(),
    };

    // Manually insert into registry via internal state
    (registry as any).plugins.set('test-plugin', entry);

    registry.disablePlugin('test-plugin');
    expect(registry.getPlugin('test-plugin')?.enabled).toBe(false);
  });

  it('enablePlugin() should enable a disabled plugin', async () => {
    const plugin = makePlugin('test-plugin');
    const entry = {
      manifest: plugin.manifest,
      plugin,
      path: '/fake/path',
      enabled: false,
      loadedAt: new Date(),
    };

    (registry as any).plugins.set('test-plugin', entry);

    registry.enablePlugin('test-plugin');
    expect(registry.getPlugin('test-plugin')?.enabled).toBe(true);
  });

  it('enablePlugin() should be a no-op for unknown plugin', () => {
    expect(() => registry.enablePlugin('nonexistent')).not.toThrow();
  });

  it('disablePlugin() should be a no-op for unknown plugin', () => {
    expect(() => registry.disablePlugin('nonexistent')).not.toThrow();
  });

  it('getEnabledPlugins() should only return enabled plugins', () => {
    const plugin1 = makePlugin('enabled-plugin');
    const plugin2 = makePlugin('disabled-plugin');

    (registry as any).plugins.set('enabled-plugin', {
      manifest: plugin1.manifest,
      plugin: plugin1,
      path: '/a',
      enabled: true,
      loadedAt: new Date(),
    });
    (registry as any).plugins.set('disabled-plugin', {
      manifest: plugin2.manifest,
      plugin: plugin2,
      path: '/b',
      enabled: false,
      loadedAt: new Date(),
    });

    const enabled = registry.getEnabledPlugins();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].manifest.name).toBe('enabled-plugin');
  });
});
