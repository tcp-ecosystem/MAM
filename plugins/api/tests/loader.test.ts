import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateManifest,
  compareSemver,
  satisfiesSemver,
  readPluginManifest,
  formatManifestSummary,
  getManifestDependencyNames,
  findRootManifests,
  sortManifestsForLoad,
} from '../src/loader.js';
import type { PluginManifest } from '../src/types.js';

function base(): PluginManifest {
  return {
    name: 'demo',
    version: '1.0.0',
    description: 'A demo plugin',
    author: 'test',
    license: 'MIT',
    main: 'index.js',
  };
}

describe('Plugin Loader', () => {
  it('validateManifest should accept valid manifest', () => {
    const result = validateManifest({
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateManifest should reject missing name', () => {
    const result = validateManifest({
      name: '',
      version: '1.0.0',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('validateManifest should reject invalid name format', () => {
    const result = validateManifest({
      name: '123-invalid',
      version: '1.0.0',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid plugin name'))).toBe(true);
  });

  it('validateManifest should reject invalid version', () => {
    const result = validateManifest({
      name: 'test',
      version: 'abc',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('validateManifest should reject missing fields', () => {
    const result = validateManifest({
      name: '',
      version: '',
      description: '',
      author: '',
      license: '',
      mamVersion: '',
      keywords: [],
      main: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
describe('Plugin Loader semver and manifest utilities', () => {
  it('compareSemver() should order releases correctly', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareSemver('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareSemver('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('compareSemver() should rank a prerelease below its release', () => {
    expect(compareSemver('1.0.0-rc.1', '1.0.0')).toBeLessThan(0);
    expect(compareSemver('1.0.0-rc.1', '1.0.0-rc.2')).toBeLessThan(0);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });

  it('compareSemver() should return NaN for malformed input', () => {
    expect(compareSemver('not-a-version', '1.0.0')).toBeNaN();
  });

  it('satisfiesSemver() should honour caret ranges', () => {
    expect(satisfiesSemver('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfiesSemver('1.9.9', '^1.0.0')).toBe(true);
    expect(satisfiesSemver('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfiesSemver('0.9.0', '^0.1.0')).toBe(false);
  });

  it('satisfiesSemver() should honour tilde, exact and comparator ranges', () => {
    expect(satisfiesSemver('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesSemver('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesSemver('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesSemver('1.2.4', '1.2.3')).toBe(false);
    expect(satisfiesSemver('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesSemver('2.1.0', '>=1.0.0 <2.0.0')).toBe(false);
  });

  it('satisfiesSemver() should accept wildcards and reject bad input', () => {
    expect(satisfiesSemver('1.0.0', '*')).toBe(true);
    expect(satisfiesSemver('1.0.0', 'latest')).toBe(true);
    expect(satisfiesSemver('garbage', '^1.0.0')).toBe(false);
  });

  it('formatManifestSummary() should include name, version and description', () => {
    const summary = formatManifestSummary({
      name: 'demo', version: '2.1.0', description: 'A demo',
      author: 'a', license: 'MIT', main: 'index.js',
    });
    expect(summary).toContain('demo@2.1.0');
    expect(summary).toContain('A demo');
  });

  it('formatManifestSummary() should mark a scope and count dependencies', () => {
    const summary = formatManifestSummary({
      name: '@mam/thing', version: '1.0.0', description: 'd',
      author: 'a', license: 'MIT', main: 'index.js', dependencies: ['core'],
    });
    expect(summary).toContain('@mam ');
    expect(summary).toContain('1 deps');
  });

  it('getManifestDependencyNames() should dedupe and sort dependency names', () => {
    const names = getManifestDependencyNames([
      { ...base(), name: 'a', dependencies: ['z', 'y', 'z'] },
      { ...base(), name: 'b', dependencies: ['y'] },
    ]);
    expect(names).toEqual(['y', 'z']);
  });

  it('findRootManifests() should return manifests nothing depends on', () => {
    const core = { ...base(), name: 'core' };
    const app = { ...base(), name: 'app', dependencies: ['core'] };
    const solo = { ...base(), name: 'solo' };
    const roots = findRootManifests([core, app, solo]);
    expect(roots.map((m) => m.name).sort()).toEqual(['app', 'solo']);
  });

  it('sortManifestsForLoad() should order dependencies before dependents', () => {
    const sorted = sortManifestsForLoad([
      { ...base(), name: 'app', dependencies: ['core'] },
      { ...base(), name: 'core', dependencies: ['util'] },
      { ...base(), name: 'util' },
    ]);
    expect(sorted.map((m) => m.name)).toEqual(['util', 'core', 'app']);
  });

  it('sortManifestsForLoad() should not mutate the input and survive cycles', () => {
    const input = [
      { ...base(), name: 'a', dependencies: ['b'] },
      { ...base(), name: 'b', dependencies: ['a'] },
    ];
    const sorted = sortManifestsForLoad(input);
    expect(sorted).toHaveLength(2);
    expect(input.map((m) => m.name)).toEqual(['a', 'b']);
  });
});

describe('readPluginManifest', () => {
  it('should return null for a directory without plugin.json', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'mam-loader-'));
    try {
      expect(await readPluginManifest(empty)).toBeNull();
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('should return null for invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-loader-'));
    try {
      await writeFile(join(dir, 'plugin.json'), '{ not json');
      expect(await readPluginManifest(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should parse a valid manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-loader-'));
    try {
      const manifest = { ...base(), name: 'from-disk' };
      await writeFile(join(dir, 'plugin.json'), JSON.stringify(manifest));
      expect(await readPluginManifest(dir)).toEqual(manifest);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});