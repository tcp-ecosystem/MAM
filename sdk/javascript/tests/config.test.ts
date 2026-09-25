import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  DEFAULT_SDK_CONFIG,
  loadSDKConfig,
  saveSDKConfig,
  validateSDKConfig,
  mergeSDKConfigs,
  resolveSDKConfigPath,
  isSupportedSDKTarget,
  listSDKTargets,
} from '../mam/config.js';

describe('DEFAULT_SDK_CONFIG', () => {
  it('provides sensible defaults that validate', () => {
    expect(DEFAULT_SDK_CONFIG.target).toBe('python');
    expect(validateSDKConfig(DEFAULT_SDK_CONFIG)).toEqual([]);
  });
});

describe('validateSDKConfig', () => {
  it('rejects empty configs', () => {
    const problems = validateSDKConfig({ version: '', workDir: '', target: '', verbose: false });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects unsupported targets', () => {
    const problems = validateSDKConfig({ ...DEFAULT_SDK_CONFIG, target: 'cobol' });
    expect(problems.some((p) => p.includes('cobol'))).toBe(true);
  });

  it('rejects malformed versions', () => {
    const problems = validateSDKConfig({ ...DEFAULT_SDK_CONFIG, version: 'abc' });
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('mergeSDKConfigs', () => {
  it('overlays non-empty override fields', () => {
    const merged = mergeSDKConfigs(DEFAULT_SDK_CONFIG, { target: 'go', verbose: true });
    expect(merged.target).toBe('go');
    expect(merged.verbose).toBe(true);
    expect(merged.version).toBe(DEFAULT_SDK_CONFIG.version);
  });

  it('does not mutate the base', () => {
    const merged = mergeSDKConfigs(DEFAULT_SDK_CONFIG, { target: 'rust' });
    expect(DEFAULT_SDK_CONFIG.target).toBe('python');
    expect(merged).not.toBe(DEFAULT_SDK_CONFIG);
  });

  it('merges extra maps', () => {
    const merged = mergeSDKConfigs(
      { ...DEFAULT_SDK_CONFIG, extra: { a: '1' } },
      { extra: { b: '2' } },
    );
    expect(merged.extra).toEqual({ a: '1', b: '2' });
  });
});

describe('saveSDKConfig / loadSDKConfig', () => {
  it('round-trips through a temp file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-config-'));
    try {
      const path = join(dir, 'mam.sdk.json');
      const config = { ...DEFAULT_SDK_CONFIG, target: 'go', verbose: true, extra: { team: 'core' } };
      const savedPath = await saveSDKConfig(config, path);
      expect(savedPath).toBe(path);
      const loaded = await loadSDKConfig(path);
      expect(loaded.target).toBe('go');
      expect(loaded.verbose).toBe(true);
      expect(loaded.extra).toEqual({ team: 'core' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when an explicit file is missing', async () => {
    const missing = join(await mkdtemp(join(tmpdir(), 'mam-missing-')), 'nope.json');
    await expect(loadSDKConfig(missing)).rejects.toThrow();
  });

  it('throws on invalid content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-bad-'));
    try {
      const path = join(dir, 'mam.sdk.json');
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, JSON.stringify({ version: '', target: 'nope', workDir: '' }), 'utf-8');
      await expect(loadSDKConfig(path)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to save invalid configs', async () => {
    await expect(
      saveSDKConfig({ version: '', workDir: '', target: '', verbose: false }, join(tmpdir(), 'x.json')),
    ).rejects.toThrow();
  });
});

describe('resolveSDKConfigPath / targets', () => {
  it('resolves a config path inside a directory', () => {
    const path = resolveSDKConfigPath(join('a', 'b'));
    expect(path.endsWith(join('a', 'b', 'mam.sdk.json'))).toBe(true);
  });

  it('supports the empty dir fallback', () => {
    expect(resolveSDKConfigPath('').endsWith('mam.sdk.json')).toBe(true);
  });

  it('lists and checks supported targets', () => {
    expect(listSDKTargets()).toContain('python');
    expect(isSupportedSDKTarget('go')).toBe(true);
    expect(isSupportedSDKTarget('cobol')).toBe(false);
  });
});