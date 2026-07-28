import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleStore } from '../src/store.js';
import type { PackageManifest } from '@mam/package-manager';

function makeManifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: 'test-module',
    version: '1.0.0',
    description: 'A test module',
    author: 'tester',
    license: 'MIT',
    tags: ['test'],
    dependencies: [],
    main: 'index.js',
    files: [],
    ...overrides,
  };
}

describe('ModuleStore', () => {
  let tmpDir: string;
  let store: ModuleStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-store-test-'));
    store = new ModuleStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('init()', () => {
    it('creates the modules directory', async () => {
      const { access } = await import('node:fs/promises');
      const modulesDir = join(tmpDir, 'modules');
      await expect(access(modulesDir)).resolves.toBeUndefined();
    });
  });

  describe('getModule()', () => {
    it('returns null for an unknown module', async () => {
      const result = await store.getModule('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('publish()', () => {
    it('stores a module and creates a version', async () => {
      const manifest = makeManifest();
      const files = new Map([['index.js', 'export default 1;']]);

      const result = await store.publish(manifest, files, 'tester');
      expect(result.name).toBe('test-module');
      expect(result.version).toBe('1.0.0');
    });

    it('creates a new version for an existing module', async () => {
      const v1 = makeManifest({ version: '1.0.0' });
      const v2 = makeManifest({ version: '2.0.0' });
      const files = new Map([['index.js', 'export default 1;']]);

      await store.publish(v1, files, 'tester');
      const result = await store.publish(v2, files, 'tester');
      expect(result.version).toBe('2.0.0');
    });
  });

  describe('getModule() after publish', () => {
    it('returns the published module', async () => {
      const manifest = makeManifest();
      const files = new Map([['index.js', 'export default 1;']]);
      await store.publish(manifest, files, 'tester');

      const mod = await store.getModule('test-module');
      expect(mod).not.toBeNull();
      expect(mod!.name).toBe('test-module');
      expect(mod!.description).toBe('A test module');
      expect(mod!.author).toBe('tester');
      expect(mod!.latest).toBe('1.0.0');
    });
  });

  describe('getVersions()', () => {
    it('returns a list of versions', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest({ version: '1.0.0' }), files, 'tester');
      await store.publish(makeManifest({ version: '1.1.0' }), files, 'tester');
      await store.publish(makeManifest({ version: '2.0.0' }), files, 'tester');

      const versions = await store.getVersions('test-module');
      expect(versions).toContain('1.0.0');
      expect(versions).toContain('1.1.0');
      expect(versions).toContain('2.0.0');
      expect(versions.length).toBe(3);
    });

    it('returns empty array for unknown module', async () => {
      const versions = await store.getVersions('nonexistent');
      expect(versions).toEqual([]);
    });
  });

  describe('getVersion()', () => {
    it('returns a specific version', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest({ version: '1.0.0' }), files, 'tester');

      const version = await store.getVersion('test-module', '1.0.0');
      expect(version).not.toBeNull();
      expect(version!.version).toBe('1.0.0');
      expect(version!.publishedBy).toBe('tester');
    });

    it('returns null for non-existent version', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest(), files, 'tester');

      const version = await store.getVersion('test-module', '9.9.9');
      expect(version).toBeNull();
    });
  });

  describe('getAllModules()', () => {
    it('returns all published modules', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest({ name: 'module-a' }), files, 'tester');
      await store.publish(makeManifest({ name: 'module-b' }), files, 'tester');

      const modules = await store.getAllModules();
      expect(modules.length).toBe(2);
      const names = modules.map(m => m.name);
      expect(names).toContain('module-a');
      expect(names).toContain('module-b');
    });

    it('returns empty array when no modules exist', async () => {
      const modules = await store.getAllModules();
      expect(modules).toEqual([]);
    });
  });

  describe('deleteModule()', () => {
    it('removes a module', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest(), files, 'tester');

      await store.deleteModule('test-module');
      const mod = await store.getModule('test-module');
      expect(mod).toBeNull();
    });

    it('does not throw for non-existent module', async () => {
      await expect(store.deleteModule('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('getStats()', () => {
    it('returns correct counts for empty store', async () => {
      const stats = await store.getStats();
      expect(stats.totalModules).toBe(0);
      expect(stats.totalVersions).toBe(0);
      expect(stats.totalDownloads).toBe(0);
      expect(stats.lastUpdated).toBeDefined();
    });

    it('returns correct counts after publishing', async () => {
      const files = new Map([['index.js', 'code']]);
      await store.publish(makeManifest({ name: 'mod-a', version: '1.0.0' }), files, 'tester');
      await store.publish(makeManifest({ name: 'mod-a', version: '1.1.0' }), files, 'tester');
      await store.publish(makeManifest({ name: 'mod-b', version: '1.0.0' }), files, 'tester');

      const stats = await store.getStats();
      expect(stats.totalModules).toBe(2);
      expect(stats.totalVersions).toBe(3);
    });
  });
});
