import { describe, it, expect } from 'vitest';
import { validatePluginManifest, validatePluginIntegrity, getPluginStats } from '../src/validator.js';
import type { MAMPlugin } from '../src/types.js';

function makePlugin(overrides?: Partial<MAMPlugin>): MAMPlugin {
  return {
    manifest: {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'Test plugin',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    },
    ...overrides,
  };
}

describe('Plugin Manifest Validator', () => {
  it('should accept valid manifest', () => {
    const result = validatePluginManifest(makePlugin().manifest);
    expect(result.valid).toBe(true);
  });

  it('should reject missing name', () => {
    const manifest = makePlugin().manifest;
    manifest.name = '';
    const result = validatePluginManifest(manifest);
    expect(result.valid).toBe(false);
  });

  it('should reject invalid name format', () => {
    const manifest = makePlugin().manifest;
    manifest.name = '123-bad';
    const result = validatePluginManifest(manifest);
    expect(result.valid).toBe(false);
  });

  it('should warn on too many keywords', () => {
    const manifest = makePlugin().manifest;
    manifest.keywords = Array.from({ length: 25 }, (_, i) => `kw${i}`);
    const result = validatePluginManifest(manifest);
    expect(result.warnings.some((w) => w.includes('keywords'))).toBe(true);
  });
});

describe('Plugin Integrity Validator', () => {
  it('should validate a minimal plugin', () => {
    const results = validatePluginIntegrity(makePlugin());
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('should detect missing section name', () => {
    const plugin = makePlugin({
      sections: [{ name: '', description: '', required: false, contentTypes: ['text'] }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should detect missing section content types', () => {
    const plugin = makePlugin({
      sections: [{ name: 'Test', description: '', required: false, contentTypes: [] }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid && r.message?.includes('content types'))).toBe(true);
  });

  it('should detect rule without check function', () => {
    const plugin = makePlugin({
      rules: [{ name: 'test', description: '', severity: 'info', check: null as any }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should detect context without execute function', () => {
    const plugin = makePlugin({
      contexts: [{ name: 'test', language: 'py', execute: null as any, canHandle: () => true }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should detect renderer without render function', () => {
    const plugin = makePlugin({
      renderers: [{ name: 'test', target: 'html', render: null as any }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should detect exporter without export function', () => {
    const plugin = makePlugin({
      exporters: [{ name: 'test', format: 'json', export: null as any, extension: '.json' }],
    });
    const results = validatePluginIntegrity(plugin);
    expect(results.some((r) => !r.valid)).toBe(true);
  });
});

describe('Plugin Stats', () => {
  it('should return correct stats', () => {
    const plugin = makePlugin({
      sections: [{ name: 'A', description: '', required: false, contentTypes: ['text'] }],
      rules: [{ name: 'r1', description: '', severity: 'info', check: () => [] }],
      hooks: { beforeParse: () => '' },
      contexts: [{ name: 'c1', language: 'py', execute: async () => ({ success: true, timeMs: 0 }), canHandle: () => true }],
      renderers: [{ name: 'ren1', target: 'html', render: () => '' }],
    });
    const stats = getPluginStats(plugin);
    expect(stats.sections).toBe(1);
    expect(stats.rules).toBe(1);
    expect(stats.hooks).toBe(1);
    expect(stats.contexts).toBe(1);
    expect(stats.renderers).toBe(1);
    expect(stats.exporters).toBe(0);
  });
});
