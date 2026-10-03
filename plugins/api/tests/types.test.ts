/**
 * Plugin Types Tests
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_HOOK_NAMES,
  ALL_PLUGIN_CATEGORIES,
  ALL_PLUGIN_EVENTS,
  isPluginManifest,
  isHookName,
  isPluginEvent,
  isPluginCategory,
  isSectionDefinition,
  isValidationRule,
  isPluginMiddleware,
  type PluginManifest,
  type PluginHooks,
  type MAMPlugin,
} from '../src/types.js';
import {
  PLUGIN_API_VERSION,
  compareApiVersions,
  isPluginApiCompatible,
  assertMAMPlugin,
  describePluginApi,
  createPluginApi,
} from '../src/index.js';

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
describe('Runtime type guards and constants', () => {
  const manifest: PluginManifest = {
    name: 'demo',
    version: '1.0.0',
    description: 'demo',
    author: 'test',
    license: 'MIT',
    main: 'index.js',
  };

  it('ALL_PLUGIN_EVENTS should be a non-empty list of unique events', () => {
    expect(ALL_PLUGIN_EVENTS.length).toBeGreaterThan(0);
    expect(new Set(ALL_PLUGIN_EVENTS).size).toBe(ALL_PLUGIN_EVENTS.length);
  });

  it('ALL_PLUGIN_CATEGORIES should be unique', () => {
    expect(new Set(ALL_PLUGIN_CATEGORIES).size).toBe(ALL_PLUGIN_CATEGORIES.length);
  });

  it('isPluginManifest should require name, version and main', () => {
    expect(isPluginManifest(manifest)).toBe(true);
    expect(isPluginManifest({ ...manifest, main: undefined })).toBe(false);
    expect(isPluginManifest(null)).toBe(false);
  });

  it('isHookName should only accept known hooks', () => {
    expect(isHookName('beforeParse')).toBe(true);
    expect(isHookName(ALL_HOOK_NAMES[0])).toBe(true);
    expect(isHookName('notAHook')).toBe(false);
    expect(isHookName(42)).toBe(false);
  });

  it('isPluginEvent should only accept known events', () => {
    expect(isPluginEvent('plugin:loaded')).toBe(true);
    expect(isPluginEvent(ALL_PLUGIN_EVENTS[0])).toBe(true);
    expect(isPluginEvent('plugin:exploded')).toBe(false);
  });

  it('isPluginCategory should only accept known categories', () => {
    expect(isPluginCategory('renderer')).toBe(true);
    expect(isPluginCategory('quantum')).toBe(false);
  });

  it('isSectionDefinition should require name, description and contentTypes array', () => {
    expect(isSectionDefinition({ name: 's', description: 'd', contentTypes: ['text'] })).toBe(true);
    expect(isSectionDefinition({ name: 's', description: 'd', contentTypes: 'text' })).toBe(false);
  });

  it('isValidationRule should require name, check and severity', () => {
    expect(isValidationRule({ name: 'r', check: () => true, severity: 'error' })).toBe(true);
    expect(isValidationRule({ name: 'r', check: 'nope', severity: 'error' })).toBe(false);
  });

  it('isPluginMiddleware should require name, phase and handler', () => {
    expect(isPluginMiddleware({ name: 'm', phase: 'before', handler: () => {} })).toBe(true);
    expect(isPluginMiddleware({ name: 'm', phase: 'before' })).toBe(false);
  });
});
describe('Barrel utilities (index.ts)', () => {
  it('PLUGIN_API_VERSION should be a semver string', () => {
    expect(PLUGIN_API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('compareApiVersions should order versions correctly', () => {
    expect(compareApiVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareApiVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareApiVersions('2.0.0', '2.0.0')).toBe(0);
  });

  it('compareApiVersions should return NaN for unparsable input', () => {
    expect(compareApiVersions('nope', '1.0.0')).toBeNaN();
  });

  it('isPluginApiCompatible should require host >= minimum', () => {
    expect(isPluginApiCompatible('0.2.0', '0.1.0')).toBe(true);
    expect(isPluginApiCompatible('0.1.0', '0.1.0')).toBe(true);
    expect(isPluginApiCompatible('0.0.9', '0.1.0')).toBe(false);
  });

  it('assertMAMPlugin should pass a valid plugin and throw otherwise', () => {
    const plugin: MAMPlugin = {
      manifest: {
        name: 'p', version: '1.0.0', description: 'd',
        author: 'a', license: 'MIT', main: 'index.js',
      },
    };
    expect(() => assertMAMPlugin(plugin)).not.toThrow();
    expect(() => assertMAMPlugin({})).toThrow(TypeError);
    expect(() => assertMAMPlugin(null)).toThrow(/null/);
    expect(() => assertMAMPlugin([])).toThrow(/array/);
  });

  it('describePluginApi should summarise the surface', () => {
    const summary = describePluginApi();
    expect(summary).toContain(PLUGIN_API_VERSION);
    expect(summary).toContain(String(ALL_HOOK_NAMES.length));
  });

  it('createPluginApi should wire the managers and dispose cleanly twice', () => {
    const api = createPluginApi({ searchPaths: [] });
    expect(api.version).toBe(PLUGIN_API_VERSION);
    expect(api.registry).toBeDefined();
    expect(api.events).toBeDefined();
    expect(api.hooks).toBeDefined();
    expect(api.lifecycle).toBeDefined();
    expect(api.context).toBeDefined();
    expect(() => { api.dispose(); api.dispose(); }).not.toThrow();
  });
});