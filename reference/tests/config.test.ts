import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_CONFIG,
  validateConfig,
  mergeConfigs,
  getConfigForTarget,
  resolveConfigPath,
  saveConfig,
  loadConfig,
  cloneConfig,
  getConfigValue,
  setConfigValue,
  listConfiguredTargets,
  hasTarget,
  diffConfigKeys,
  isDefaultConfig,
} from '../src/config.js';
import type { MAMConfig } from '../src/types.js';

const TMP = join(tmpdir(), 'mam-config-test-' + Date.now());

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('DEFAULT_CONFIG', () => {
  it('should have version "1"', () => {
    expect(DEFAULT_CONFIG.version).toBe('1');
  });

  it('should have a default project', () => {
    expect(DEFAULT_CONFIG.project).toBeDefined();
    expect(DEFAULT_CONFIG.project!.name).toBe('my-mam-project');
    expect(DEFAULT_CONFIG.project!.version).toBe('0.1.0');
  });

  it('should have default build config', () => {
    expect(DEFAULT_CONFIG.build).toBeDefined();
    expect(DEFAULT_CONFIG.build!.target).toBe('python');
    expect(DEFAULT_CONFIG.build!.output).toBe('./dist');
    expect(DEFAULT_CONFIG.build!.sourceMap).toBe(false);
    expect(DEFAULT_CONFIG.build!.minify).toBe(false);
    expect(DEFAULT_CONFIG.build!.optimize).toBe(true);
    expect(DEFAULT_CONFIG.build!.includeComments).toBe(true);
    expect(DEFAULT_CONFIG.build!.indent).toBe(2);
  });

  it('should have default registry', () => {
    expect(DEFAULT_CONFIG.registry).toBeDefined();
    expect(DEFAULT_CONFIG.registry!.url).toBe('https://registry.mam.dev');
  });

  it('should have empty plugins array', () => {
    expect(DEFAULT_CONFIG.plugins).toEqual([]);
  });
});

describe('validateConfig', () => {
  it('should return no errors for DEFAULT_CONFIG', () => {
    const errors = validateConfig(DEFAULT_CONFIG);
    expect(errors).toEqual([]);
  });

  it('should return error when version is missing', () => {
    const config: MAMConfig = { version: '' };
    const errors = validateConfig(config);
    expect(errors).toContain('config.version is required');
  });

  it('should return error when project.name is missing', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: '', version: '1.0.0' },
    };
    const errors = validateConfig(config);
    expect(errors).toContain('config.project.name is required');
  });

  it('should return error for non-semver project.version', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: 'test', version: 'not-semver' },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('semver'))).toBe(true);
  });

  it('should accept valid semver', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: 'test', version: '1.0.0' },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('semver'))).toBe(false);
  });

  it('should accept semver with prerelease', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: 'test', version: '1.0.0-beta.1' },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('semver'))).toBe(false);
  });

  it('should return error for invalid build target', () => {
    const config: MAMConfig = {
      version: '1',
      build: { target: 'cobol' as any },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('not a supported target'))).toBe(true);
  });

  it('should accept valid build targets', () => {
    const targets = ['python', 'javascript', 'typescript', 'go', 'rust', 'json'];
    for (const target of targets) {
      const config: MAMConfig = {
        version: '1',
        build: { target: target as any },
      };
      const errors = validateConfig(config);
      expect(errors.some((e) => e.includes('not a supported target'))).toBe(false);
    }
  });

  it('should return error for invalid registry URL', () => {
    const config: MAMConfig = {
      version: '1',
      registry: { url: 'not-a-url' },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('not a valid URL'))).toBe(true);
  });

  it('should accept valid registry URL', () => {
    const config: MAMConfig = {
      version: '1',
      registry: { url: 'https://registry.mam.dev' },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('not a valid URL'))).toBe(false);
  });

  it('should return error for plugin without name', () => {
    const config: MAMConfig = {
      version: '1',
      plugins: [{ name: '' }],
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes('plugins[0].name'))).toBe(true);
  });

  it('should accept valid plugins', () => {
    const config: MAMConfig = {
      version: '1',
      plugins: [{ name: 'my-plugin', enabled: true }],
    };
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  it('should handle missing optional fields gracefully', () => {
    const config: MAMConfig = {
      version: '1',
      project: { name: 'test', version: '1.0.0' },
    };
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });
});

describe('mergeConfigs', () => {
  it('should return a new object', () => {
    const base: MAMConfig = { version: '1' };
    const result = mergeConfigs(base, {});
    expect(result).not.toBe(base);
  });

  it('should not mutate base', () => {
    const base: MAMConfig = { version: '1', build: { target: 'python' } };
    mergeConfigs(base, { version: '2' });
    expect(base.version).toBe('1');
  });

  it('should override version', () => {
    const result = mergeConfigs({ version: '1' }, { version: '2' });
    expect(result.version).toBe('2');
  });

  it('should shallow merge project', () => {
    const base: MAMConfig = {
      version: '1',
      project: { name: 'old', version: '0.1.0' },
    };
    const result = mergeConfigs(base, {
      project: { name: 'new' },
    });
    expect(result.project!.name).toBe('new');
    expect(result.project!.version).toBe('0.1.0');
  });

  it('should shallow merge build', () => {
    const base: MAMConfig = {
      version: '1',
      build: { target: 'python', indent: 2 },
    };
    const result = mergeConfigs(base, {
      build: { indent: 4 },
    });
    expect(result.build!.indent).toBe(4);
    expect(result.build!.target).toBe('python');
  });

  it('should replace plugins entirely', () => {
    const base: MAMConfig = {
      version: '1',
      plugins: [{ name: 'old' }],
    };
    const result = mergeConfigs(base, {
      plugins: [{ name: 'new' }],
    });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins![0].name).toBe('new');
  });

  it('should replace targets entirely', () => {
    const base: MAMConfig = {
      version: '1',
      targets: { python: { minify: true } },
    };
    const result = mergeConfigs(base, {
      targets: { go: { sourceMap: true } },
    });
    expect(result.targets).toEqual({ go: { sourceMap: true } });
  });

  it('should merge registry', () => {
    const base: MAMConfig = {
      version: '1',
      registry: { url: 'https://old.dev', scope: '@old' },
    };
    const result = mergeConfigs(base, {
      registry: { url: 'https://new.dev' },
    });
    expect(result.registry!.url).toBe('https://new.dev');
    expect(result.registry!.scope).toBe('@old');
  });
});

describe('getConfigForTarget', () => {
  it('should return config unchanged when no override', () => {
    const config: MAMConfig = { version: '1', build: { target: 'python' } };
    const result = getConfigForTarget(config, 'python');
    expect(result).toBe(config);
  });

  it('should apply target-specific override', () => {
    const config: MAMConfig = {
      version: '1',
      build: { target: 'python', minify: false, indent: 2 },
      targets: { python: { minify: true } },
    };
    const result = getConfigForTarget(config, 'python');
    expect(result.build!.minify).toBe(true);
    expect(result.build!.indent).toBe(2);
  });

  it('should not affect other targets', () => {
    const config: MAMConfig = {
      version: '1',
      build: { target: 'python' },
      targets: { python: { minify: true } },
    };
    const result = getConfigForTarget(config, 'go');
    expect(result).toBe(config);
  });
});

describe('resolveConfigPath', () => {
  it('should return default mam.config.json when no path given', () => {
    const result = resolveConfigPath('/base');
    expect(result).toContain('mam.config.json');
  });

  it('should resolve explicit path relative to basePath', () => {
    const result = resolveConfigPath('/base', 'custom.json');
    expect(result).toContain('custom.json');
  });

  it('should return resolved path when configPath is absolute', () => {
    const result = resolveConfigPath('/base', '/abs/path/config.json');
    // On Windows, path.resolve normalizes forward slashes to backslashes
    expect(result).toContain('config.json');
    expect(result).toContain('abs');
    expect(result).toContain('path');
  });
});

describe('saveConfig', () => {
  it('should write config to disk as JSON', async () => {
    const configPath = join(TMP, 'test-config.json');
    const config: MAMConfig = { version: '1', project: { name: 'test', version: '1.0.0' } };
    await saveConfig(config, configPath);
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed.version).toBe('1');
    expect(parsed.project.name).toBe('test');
  });

  it('should create parent directories', async () => {
    const configPath = join(TMP, 'sub', 'dir', 'config.json');
    await saveConfig({ version: '1' }, configPath);
    const content = await readFile(configPath, 'utf-8');
    expect(JSON.parse(content).version).toBe('1');
  });
});

describe('loadConfig', () => {
  it('should return defaults when no config file exists', async () => {
    const config = await loadConfig(TMP);
    expect(config.version).toBe(DEFAULT_CONFIG.version);
  });

  it('should load mam.config.json from basePath', async () => {
    const configPath = join(TMP, 'mam.config.json');
    const config: MAMConfig = { version: '1', project: { name: 'loaded', version: '2.0.0' } };
    await writeFile(configPath, JSON.stringify(config), 'utf-8');
    const loaded = await loadConfig(TMP);
    expect(loaded.project?.name).toBe('loaded');
  });

  it('should load explicit configPath', async () => {
    const configPath = join(TMP, 'custom.json');
    const config: MAMConfig = { version: '1', project: { name: 'custom', version: '1.0.0' } };
    await writeFile(configPath, JSON.stringify(config), 'utf-8');
    const loaded = await loadConfig(TMP, 'custom.json');
    expect(loaded.project?.name).toBe('custom');
  });

  it('should merge loaded config with defaults', async () => {
    const configPath = join(TMP, 'mam.config.json');
    await writeFile(configPath, JSON.stringify({ version: '1', build: { indent: 8 } }), 'utf-8');
    const loaded = await loadConfig(TMP);
    expect(loaded.build!.indent).toBe(8);
    expect(loaded.build!.target).toBe('python');
  });

  it('should load config from package.json mam field', async () => {
    const pkgPath = join(TMP, 'package.json');
    await writeFile(pkgPath, JSON.stringify({ mam: { version: '1', project: { name: 'from-pkg', version: '1.0.0' } } }), 'utf-8');
    const loaded = await loadConfig(TMP);
    expect(loaded.project?.name).toBe('from-pkg');
  });
});

describe('cloneConfig', () => {
  it('should deep clone without sharing references', () => {
    const clone = cloneConfig(DEFAULT_CONFIG);
    expect(clone).toEqual(DEFAULT_CONFIG);
    expect(clone).not.toBe(DEFAULT_CONFIG);
    clone.project!.name = 'changed';
    expect(DEFAULT_CONFIG.project!.name).not.toBe('changed');
  });
});

describe('getConfigValue', () => {
  it('should read nested values by dot path', () => {
    expect(getConfigValue(DEFAULT_CONFIG, 'version')).toBe('1');
    expect(getConfigValue(DEFAULT_CONFIG, 'project.name')).toBe('my-mam-project');
    expect(getConfigValue(DEFAULT_CONFIG, 'build.target')).toBe('python');
  });

  it('should return undefined for missing paths', () => {
    expect(getConfigValue(DEFAULT_CONFIG, 'nope')).toBeUndefined();
    expect(getConfigValue(DEFAULT_CONFIG, 'project.nope.deeper')).toBeUndefined();
  });
});

describe('setConfigValue', () => {
  it('should set nested values immutably', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'project.name', 'renamed');
    expect(updated.project!.name).toBe('renamed');
    expect(DEFAULT_CONFIG.project!.name).toBe('my-mam-project');
  });

  it('should create intermediate objects', () => {
    const updated = setConfigValue(DEFAULT_CONFIG, 'targets.python.output', './out');
    expect((updated.targets as Record<string, Record<string, string>>).python!.output).toBe('./out');
  });
});

describe('listConfiguredTargets / hasTarget', () => {
  it('should list and check targets', () => {
    expect(listConfiguredTargets(DEFAULT_CONFIG)).toEqual([]);
    expect(hasTarget(DEFAULT_CONFIG, 'python')).toBe(false);
    const updated = setConfigValue(DEFAULT_CONFIG, 'targets.python.output', './out');
    expect(listConfiguredTargets(updated)).toEqual(['python']);
    expect(hasTarget(updated, 'python')).toBe(true);
  });
});

describe('diffConfigKeys', () => {
  it('should report differing top-level keys', () => {
    const other = cloneConfig(DEFAULT_CONFIG);
    other.version = '2';
    expect(diffConfigKeys(DEFAULT_CONFIG, other)).toEqual(['version']);
    expect(diffConfigKeys(DEFAULT_CONFIG, cloneConfig(DEFAULT_CONFIG))).toEqual([]);
  });
});

describe('isDefaultConfig', () => {
  it('should detect default configuration', () => {
    expect(isDefaultConfig(DEFAULT_CONFIG)).toBe(true);
    expect(isDefaultConfig(cloneConfig(DEFAULT_CONFIG))).toBe(true);
    const other = setConfigValue(DEFAULT_CONFIG, 'version', '2');
    expect(isDefaultConfig(other)).toBe(false);
  });
});
