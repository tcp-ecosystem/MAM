/**
 * Plugin Types Tests
 */

import { describe, it, expect } from 'vitest';
import type { PluginManifest, PluginHooks, MAMPlugin } from '../src/types.js';

describe('Plugin Types', () => {
  it('should export and use PluginManifest type', () => {
    const manifest: PluginManifest = {
      name: 'test',
      version: '1.0.0',
      description: 'test plugin',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    };
    expect(manifest.name).toBe('test');
    expect(manifest.version).toBe('1.0.0');
  });

  it('should construct a valid PluginManifest', () => {
    const manifest: PluginManifest = {
      name: 'my-plugin',
      version: '2.0.0',
      description: 'A test manifest',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: ['test', 'example'],
      main: 'index.js',
    };

    expect(manifest.name).toBe('my-plugin');
    expect(manifest.keywords).toHaveLength(2);
    expect(manifest.main).toBe('index.js');
  });

  it('should define PluginHooks with optional handlers', () => {
    const hooks: PluginHooks = {};

    expect(hooks.beforeParse).toBeUndefined();
    expect(hooks.afterParse).toBeUndefined();
    expect(hooks.onError).toBeUndefined();
  });

  it('should allow assigning hook handlers', () => {
    const hooks: PluginHooks = {
      beforeParse: (input: string) => input.toUpperCase(),
      afterParse: (module: any) => module,
    };

    expect(typeof hooks.beforeParse).toBe('function');
    expect(typeof hooks.afterParse).toBe('function');
  });

  it('should construct a minimal MAMPlugin', () => {
    const plugin: MAMPlugin = {
      manifest: {
        name: 'minimal',
        version: '1.0.0',
        description: 'minimal plugin',
        author: 'test',
        license: 'MIT',
        mamVersion: '0.1.0',
        keywords: [],
        main: 'index.js',
      },
    };

    expect(plugin.manifest.name).toBe('minimal');
    expect(plugin.onLoad).toBeUndefined();
    expect(plugin.onUnload).toBeUndefined();
    expect(plugin.hooks).toBeUndefined();
  });
});
