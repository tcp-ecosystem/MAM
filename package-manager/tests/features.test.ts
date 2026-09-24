/**
 * Feature Tests for Manifest, Resolver, Lockfile, Registry, Config, and Validation Helpers
 */

import { describe, it, expect } from 'vitest';
import { createPackageManifest, getManifestDependenciesMap } from '../src/package.js';
import { sortVersions, findHighestVersion } from '../src/resolver.js';
import { summarizeLockfile, type LockFile } from '../src/lockfile.js';
import { normalizeRegistryUrl, buildPackageUrl } from '../src/registry.js';
import { mergeConfigs, getDefaultConfigData, type MAMPConfigData } from '../src/config.js';
import {
  validatePackageName,
  validateVersionRange,
  validatePackageSpec,
  validatePackageManifest,
  isValidPackageManifest,
} from '../src/validate.js';

describe('createPackageManifest', () => {
  it('should apply defaults when given no partial', () => {
    const manifest = createPackageManifest();
    expect(manifest.name).toBe('');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toBe('');
    expect(manifest.author).toBe('');
    expect(manifest.license).toBe('MIT');
    expect(manifest.tags).toEqual([]);
    expect(manifest.dependencies).toEqual([]);
    expect(manifest.main).toBe('index.mam.md');
    expect(manifest.files).toEqual([]);
  });

  it('should merge provided fields over the defaults', () => {
    const manifest = createPackageManifest({
      name: 'my-pkg',
      version: '2.0.0',
      description: 'A package',
      author: 'me',
      license: 'Apache-2.0',
      tags: ['a'],
      dependencies: [{ name: 'lodash', version: '^4.17.21' }],
      main: 'custom.mam.md',
      files: ['*.mam.md'],
    });

    expect(manifest.name).toBe('my-pkg');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.description).toBe('A package');
    expect(manifest.author).toBe('me');
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.tags).toEqual(['a']);
    expect(manifest.dependencies).toEqual([{ name: 'lodash', version: '^4.17.21' }]);
    expect(manifest.main).toBe('custom.mam.md');
    expect(manifest.files).toEqual(['*.mam.md']);
  });

  it('should preserve optional fields when provided', () => {
    const manifest = createPackageManifest({
      name: 'my-pkg',
      version: '1.0.0',
      repository: 'https://github.com/user/repo',
      homepage: 'https://example.com',
      keywords: ['mam'],
      mamVersion: '2.0.0',
    });

    expect(manifest.repository).toBe('https://github.com/user/repo');
    expect(manifest.homepage).toBe('https://example.com');
    expect(manifest.keywords).toEqual(['mam']);
    expect(manifest.mamVersion).toBe('2.0.0');
  });
});

describe('getManifestDependenciesMap', () => {
  it('should map dependency names to versions', () => {
    const manifest = createPackageManifest({
      name: 'root',
      version: '1.0.0',
      dependencies: [
        { name: 'lodash', version: '4.17.21' },
        { name: 'react', version: '^18.2.0' },
      ],
    });

    expect(getManifestDependenciesMap(manifest)).toEqual({
      lodash: '4.17.21',
      react: '^18.2.0',
    });
  });

  it('should return an empty map for a manifest with no dependencies', () => {
    const manifest = createPackageManifest({ name: 'root', version: '1.0.0' });
    expect(getManifestDependenciesMap(manifest)).toEqual({});
  });
});

describe('sortVersions', () => {
  it('should sort versions highest-first', () => {
    expect(sortVersions(['1.0.0', '2.0.0', '1.5.0'])).toEqual(['2.0.0', '1.5.0', '1.0.0']);
  });

  it('should not mutate the input array', () => {
    const input = ['1.0.0', '2.0.0'];
    const sorted = sortVersions(input);
    expect(sorted).toEqual(['2.0.0', '1.0.0']);
    expect(input).toEqual(['1.0.0', '2.0.0']);
  });

  it('should push invalid versions to the end', () => {
    expect(sortVersions(['2.0.0', '1.0.0', 'foo', ''])).toEqual(['2.0.0', '1.0.0', 'foo', '']);
  });
});

describe('findHighestVersion', () => {
  it('should return the highest valid version', () => {
    expect(findHighestVersion(['1.0.0', '2.5.0', '2.4.0', 'not-a-version'])).toBe('2.5.0');
  });

  it('should prefer a release over a prerelease on the same base', () => {
    expect(findHighestVersion(['1.0.0-beta', '1.0.0'])).toBe('1.0.0');
  });

  it('should return undefined when there are no valid versions', () => {
    expect(findHighestVersion(['abc', ''])).toBeUndefined();
    expect(findHighestVersion([])).toBeUndefined();
  });
});

describe('summarizeLockfile', () => {
  const buildLock = (packages: LockFile['packages']): LockFile => ({
    lockfileVersion: 1,
    name: 'root',
    packages,
    metadata: { createdAt: '', updatedAt: '' },
  });

  it('should classify direct, transitive, optional, and integrity counts', () => {
    const lock = buildLock({
      '': { version: '', resolved: '', integrity: '', dependencies: {} },
      lodash: { version: '1.0.0', resolved: 'https://r/lodash', integrity: 'sha256-abc', dependencies: {} },
      react: { version: '18.2.0', resolved: 'https://r/react', integrity: 'sha256-def', dependencies: {}, optional: true },
      'node_modules/foo/node_modules/bar': { version: '1.0.0', resolved: 'https://r/bar', integrity: '', dependencies: {} },
      'node_modules/@scope/pkg': { version: '2.0.0', resolved: 'https://r/pkg', integrity: 'sha256-ghi', dependencies: {} },
    });

    expect(summarizeLockfile(lock)).toEqual({
      packageCount: 5,
      directCount: 2,
      transitiveCount: 2,
      optionalCount: 1,
      hasIntegrity: 3,
      missingIntegrity: 1,
    });
  });

  it('should count the root entry in packageCount but not classify it', () => {
    const lock = buildLock({
      '': { version: '1.0.0', resolved: '', integrity: '', dependencies: {} },
      lodash: { version: '1.0.0', resolved: 'https://r/lodash', integrity: '', dependencies: {} },
    });

    const summary = summarizeLockfile(lock);
    expect(summary.packageCount).toBe(2);
    expect(summary.directCount).toBe(1);
    expect(summary.transitiveCount).toBe(0);
    expect(summary.missingIntegrity).toBe(1);
  });

  it('should return all-zero counts for an empty packages map', () => {
    expect(summarizeLockfile(buildLock({}))).toEqual({
      packageCount: 0,
      directCount: 0,
      transitiveCount: 0,
      optionalCount: 0,
      hasIntegrity: 0,
      missingIntegrity: 0,
    });
  });
});

describe('normalizeRegistryUrl', () => {
  it('should strip trailing slashes', () => {
    expect(normalizeRegistryUrl('https://registry.mam.dev/')).toBe('https://registry.mam.dev');
    expect(normalizeRegistryUrl('https://registry.mam.dev//')).toBe('https://registry.mam.dev');
  });

  it('should prepend https when no scheme is present', () => {
    expect(normalizeRegistryUrl('registry.mam.dev')).toBe('https://registry.mam.dev');
  });

  it('should upgrade http to https', () => {
    expect(normalizeRegistryUrl('http://registry.mam.dev')).toBe('https://registry.mam.dev');
  });

  it('should trim surrounding whitespace', () => {
    expect(normalizeRegistryUrl('  https://registry.mam.dev  ')).toBe('https://registry.mam.dev');
  });
});

describe('buildPackageUrl', () => {
  it('should build a plain package URL', () => {
    expect(buildPackageUrl('registry.mam.dev', 'lodash')).toBe('https://registry.mam.dev/lodash');
  });

  it('should encode scoped names', () => {
    expect(buildPackageUrl('https://registry.mam.dev/', '@scope/name')).toBe('https://registry.mam.dev/@scope%2fname');
  });

  it('should append the version when provided', () => {
    expect(buildPackageUrl('http://registry.mam.dev', 'lodash', '4.17.21')).toBe(
      'https://registry.mam.dev/lodash/4.17.21'
    );
  });
});

describe('mergeConfigs', () => {
  it('should let later configs override earlier scalar values', () => {
    const merged = mergeConfigs({ registry: 'https://a.dev', strict: true }, { registry: 'https://b.dev', logLevel: 'debug' });

    expect(merged.registry).toBe('https://b.dev');
    expect(merged.strict).toBe(true);
    expect(merged.logLevel).toBe('debug');
  });

  it('should shallow-merge object fields such as registries', () => {
    const merged = mergeConfigs(
      { registries: { a: { url: 'https://a.dev' } } },
      { registries: { b: { url: 'https://b.dev' } } }
    );

    expect(merged.registries).toEqual({
      a: { url: 'https://a.dev' },
      b: { url: 'https://b.dev' },
    });
  });

  it('should concatenate and deduplicate array values', () => {
    const merged = mergeConfigs(
      { tags: ['x', 'y'] } as unknown as MAMPConfigData,
      { tags: ['y', 'z'] } as unknown as MAMPConfigData
    );

    expect((merged as unknown as { tags: string[] }).tags).toEqual(['x', 'y', 'z']);
  });

  it('should skip undefined values', () => {
    const merged = mergeConfigs(
      { registry: 'https://a.dev' },
      { registry: undefined, strict: true } as MAMPConfigData
    );

    expect(merged.registry).toBe('https://a.dev');
    expect(merged.strict).toBe(true);
  });

  it('should return an empty object when given no configs', () => {
    expect(mergeConfigs()).toEqual({});
  });
});

describe('getDefaultConfigData', () => {
  it('should return the full set of defaults', () => {
    expect(getDefaultConfigData()).toEqual({
      registry: 'https://registry.mam.dev',
      cacheDir: '.mam-cache',
      packagesDir: 'node_modules',
      lockfile: true,
      strict: false,
      logLevel: 'info',
      installStrategy: 'hoist',
      telemetry: false,
      maxConcurrency: 8,
      registries: {},
      scopeRegistries: {},
    });
  });

  it('should return a fresh object on each call', () => {
    const first = getDefaultConfigData();
    first.registry = 'https://custom.dev';
    expect(getDefaultConfigData().registry).toBe('https://registry.mam.dev');
  });
});

describe('validatePackageName', () => {
  it('should accept a valid name', () => {
    expect(validatePackageName('my-module')).toEqual([]);
    expect(validatePackageName('@scope/name')).toEqual([]);
  });

  it('should reject uppercase names', () => {
    expect(validatePackageName('MyModule')).toContain('Package name must be lowercase');
  });

  it('should reject empty names', () => {
    expect(validatePackageName('')).toEqual(['Package name is required']);
  });

  it('should reject invalid characters and overlong names', () => {
    expect(validatePackageName('bad!name').length).toBeGreaterThan(0);
    expect(validatePackageName('a'.repeat(215)).length).toBeGreaterThan(0);
  });
});

describe('validateVersionRange', () => {
  it('should accept valid ranges', () => {
    expect(validateVersionRange('^1.2.3')).toEqual([]);
    expect(validateVersionRange('>=1.2.3')).toEqual([]);
  });

  it('should reject empty ranges', () => {
    expect(validateVersionRange('')).toEqual(['Version range is required']);
  });

  it('should reject malformed ranges', () => {
    expect(validateVersionRange('garbage')).toContain('Invalid version range: garbage');
  });
});

describe('validatePackageSpec', () => {
  it('should accept valid name and range specs', () => {
    expect(validatePackageSpec('lodash@^1.2')).toEqual([]);
  });

  it('should accept source specs without a name', () => {
    expect(validatePackageSpec('workspace:*')).toEqual([]);
    expect(validatePackageSpec('file:./path')).toEqual([]);
  });

  it('should reject invalid names', () => {
    expect(validatePackageSpec('BadName').length).toBeGreaterThan(0);
  });

  it('should reject invalid ranges', () => {
    expect(validatePackageSpec('lodash@bogus')).toContain('Invalid version range: bogus');
  });

  it('should reject empty specs', () => {
    expect(validatePackageSpec('')).toEqual(['Package spec is required']);
  });
});

describe('validatePackageManifest', () => {
  it('should accept a valid manifest', () => {
    const manifest = createPackageManifest({
      name: 'my-pkg',
      version: '1.0.0',
      dependencies: [{ name: 'lodash', version: '^4.17.21' }],
    });

    expect(validatePackageManifest(manifest)).toEqual([]);
  });

  it('should reject an invalid version', () => {
    const manifest = createPackageManifest({ name: 'my-pkg', version: '1.0.0' });
    manifest.version = 'not-semver';

    expect(validatePackageManifest(manifest)).toContain('Invalid package version: not-semver');
  });

  it('should reject a missing name', () => {
    const manifest = createPackageManifest({ version: '1.0.0' });
    expect(validatePackageManifest(manifest)).toContain('Package name is required');
  });

  it('should reject a dependency with a missing version', () => {
    const manifest = createPackageManifest({
      name: 'my-pkg',
      version: '1.0.0',
      dependencies: [{ name: 'lodash', version: '' }],
    });

    expect(validatePackageManifest(manifest)).toContain('Dependency "lodash" version is required');
  });
});

describe('isValidPackageManifest', () => {
  it('should return true for a valid manifest', () => {
    const manifest = createPackageManifest({ name: 'my-pkg', version: '1.0.0' });
    expect(isValidPackageManifest(manifest)).toBe(true);
  });

  it('should return false for an invalid manifest', () => {
    const manifest = createPackageManifest({ name: 'my-pkg', version: '1.0.0' });
    manifest.version = 'bad';
    expect(isValidPackageManifest(manifest)).toBe(false);
  });
});