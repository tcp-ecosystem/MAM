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
describe('PluginRegistry introspection', () => {
  let registry: PluginRegistry;

  function seed(name: string, dependencies: string[] = [], loadCount = 0): void {
    const plugin = makePlugin(name);
    (registry as any).plugins.set(name, {
      manifest: plugin.manifest,
      plugin,
      path: `/fake/${name}`,
      enabled: true,
      loadedAt: new Date(),
      dependencies,
      dependents: [],
      loadCount,
    });
    // Mirror what registerPlugin does: back-link each dependency to this plugin.
    for (const dep of dependencies) {
      const depEntry = (registry as any).plugins.get(dep);
      if (depEntry) depEntry.dependents.push(name);
    }
  }

  beforeEach(() => {
    registry = new PluginRegistry(new HookManager());
  });

  it('getPluginNames() should return loaded names sorted', () => {
    seed('zeta');
    seed('alpha');
    expect(registry.getPluginNames()).toEqual(['alpha', 'zeta']);
  });

  it('getPluginNames() should be empty for a fresh registry', () => {
    expect(registry.getPluginNames()).toEqual([]);
  });

  it('recordLoad() should increment loadCount for a known plugin', () => {
    seed('p', [], 0);
    expect(registry.recordLoad('p')).toBe(true);
    expect(registry.recordLoad('p')).toBe(true);
    expect((registry as any).plugins.get('p').loadCount).toBe(2);
  });

  it('recordLoad() should return false for an unknown plugin', () => {
    expect(registry.recordLoad('missing')).toBe(false);
  });

  it('getPluginsByPrefix() should match by name prefix, sorted', () => {
    seed('@mam/alpha');
    seed('@mam/beta');
    seed('other');
    const found = registry.getPluginsByPrefix('@mam/');
    expect(found.map((p) => p.manifest.name)).toEqual(['@mam/alpha', '@mam/beta']);
  });

  it('getDependencyGraph() should return edges for every loaded plugin', () => {
    seed('app', ['core', 'ui']);
    seed('core', []);
    const graph = registry.getDependencyGraph();
    expect(graph.get('app')).toEqual(['core', 'ui']);
    expect(graph.get('core')).toEqual([]);
    expect(graph.size).toBe(2);
  });

  it('getMissingDependencies() should report only absent dependencies', () => {
    seed('app', ['core', 'absent']);
    seed('core', []);
    expect(registry.getMissingDependencies()).toEqual([
      { plugin: 'app', missing: ['absent'] },
    ]);
  });

  it('getMissingDependencies() should be empty when all deps are loaded', () => {
    seed('app', ['core']);
    seed('core', []);
    expect(registry.getMissingDependencies()).toEqual([]);
  });

  it('findDependencyCycles() should detect a cycle', () => {
    seed('a', ['b']);
    seed('b', ['c']);
    seed('c', ['a']);
    const cycles = registry.findDependencyCycles();
    expect(cycles.length).toBeGreaterThan(0);
    expect(registry.hasCircularDependencies()).toBe(true);
    expect(cycles[0]).toContain('a');
  });

  it('findDependencyCycles() should return none for an acyclic graph', () => {
    seed('a', ['b']);
    seed('b', ['c']);
    seed('c', []);
    expect(registry.findDependencyCycles()).toEqual([]);
    expect(registry.hasCircularDependencies()).toBe(false);
  });

  it('unloadAll() should unload dependents before their dependencies', async () => {
    seed('core', []);
    seed('app', ['core']);
    expect((registry as any).plugins.get('core').dependents).toEqual(['app']);

    const unloaded = await registry.unloadAll();
    expect(unloaded).toEqual(['app', 'core']);
    expect(registry.getPluginCount()).toBe(0);
  });
});