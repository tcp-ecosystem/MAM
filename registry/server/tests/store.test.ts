import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleStore, writeFileAtomic, PathSafetyError, assertSafeFilePath, type ModuleRecord } from '../src/store.js';
import type { PackageManifest } from '@mam/package-manager';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

  describe('content integrity', () => {
    const files = { 'index.js': 'console.log(1)', 'README.md': '# hi' };

    it('produces a real 64-hex SHA-256 digest', async () => {
      // Regression: this used to be a 32-bit rolling hash still labelled
      // "sha256-", so a field called integrity could not detect a modified
      // payload.
      await store.publish(makeManifest(), new Map(Object.entries(files)), 'tester');
      const version = await store.getVersion('test-module', '1.0.0');
      expect(version!.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    });

    it('is stable across republishing the same content', async () => {
      await store.publish(makeManifest(), new Map(Object.entries(files)), 'tester');
      const first = (await store.getVersion('test-module', '1.0.0'))!.integrity;
      await store.publish(makeManifest(), new Map(Object.entries(files)), 'tester');
      const second = (await store.getVersion('test-module', '1.0.0'))!.integrity;
      expect(second).toBe(first);
    });

    it('does not depend on the order files were supplied in', async () => {
      await store.publish(makeManifest({ name: 'a' }), new Map(Object.entries(files)), 'tester');
      await store.publish(
        makeManifest({ name: 'b' }),
        new Map([['README.md', '# hi'], ['index.js', 'console.log(1)']]),
        'tester',
      );
      const a = (await store.getVersion('a', '1.0.0'))!.integrity;
      const b = (await store.getVersion('b', '1.0.0'))!.integrity;
      expect(a).toBe(b);
    });

    it('changes when any file content changes', async () => {
      await store.publish(makeManifest({ name: 'a' }), new Map(Object.entries(files)), 'tester');
      await store.publish(
        makeManifest({ name: 'b' }),
        new Map([['index.js', 'console.log(2)'], ['README.md', '# hi']]),
        'tester',
      );
      const a = (await store.getVersion('a', '1.0.0'))!.integrity;
      const b = (await store.getVersion('b', '1.0.0'))!.integrity;
      expect(b).not.toBe(a);
    });

    it('changes when a file is added', async () => {
      await store.publish(makeManifest({ name: 'a' }), new Map(Object.entries(files)), 'tester');
      await store.publish(
        makeManifest({ name: 'b' }),
        new Map([...Object.entries(files), ['extra.js', '// x']]),
        'tester',
      );
      expect((await store.getVersion('b', '1.0.0'))!.integrity)
        .not.toBe((await store.getVersion('a', '1.0.0'))!.integrity);
    });

    it('cannot be tricked by moving characters between name and body', async () => {
      // Length-prefixing each part stops {"ab": "c"} colliding with {"a": "bc"}.
      await store.publish(makeManifest({ name: 'a' }), new Map([['ab', 'c']]), 'tester');
      await store.publish(makeManifest({ name: 'b' }), new Map([['a', 'bc']]), 'tester');
      expect((await store.getVersion('a', '1.0.0'))!.integrity)
        .not.toBe((await store.getVersion('b', '1.0.0'))!.integrity);
    });
  });
});

// ============================================================================
// Durability
// ============================================================================

describe('ModuleStore durability', () => {
  let tmpDir: string;
  let store: ModuleStore;
  const files = new Map([['index.js', 'export default 1;']]);

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-store-durability-'));
    store = new ModuleStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const metaPathFor = (name: string): string => join(tmpDir, 'modules', name, 'meta.json');

  /** Every leftover temp file anywhere under the data directory. */
  async function findTempFiles(root: string): Promise<string[]> {
    const found: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.tmp')) found.push(full);
      }
    };
    await walk(root);
    return found;
  }

  /**
   * Runs `work` with the module's metadata writer slowed down, and reports the
   * largest number of writes that were ever in flight at once.
   *
   * One is the wanted answer for a single module; more than one for distinct
   * modules is the whole point of locking per module rather than globally.
   */
  async function peakMetaConcurrency(work: () => Promise<unknown>): Promise<number> {
    const internals = store as unknown as {
      writeMeta: (name: string, record: ModuleRecord) => Promise<void>;
    };
    const original = internals.writeMeta.bind(store);
    let inFlight = 0;
    let peak = 0;
    internals.writeMeta = async (name, record) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        await sleep(20);
        await original(name, record);
      } finally {
        inFlight--;
      }
    };
    try {
      await work();
    } finally {
      delete internals.writeMeta;
    }
    return peak;
  }

  // ---------------------------------------------------------------------------
  // writeFileAtomic
  // ---------------------------------------------------------------------------

  describe('writeFileAtomic()', () => {
    it('never lets a reader see a partially written file', async () => {
      const target = join(tmpDir, 'meta.json');
      const small = 'x'.repeat(150_000);
      const large = 'y'.repeat(150_000);
      await writeFileAtomic(target, small);

      const lengths: number[] = [];
      let reading = true;
      const reader = (async () => {
        while (reading) {
          try {
            lengths.push((await readFile(target, 'utf-8')).length);
          } catch {
            return;
          }
          await sleep(1);
        }
      })();

      // Same length, different bytes, so a writer that truncated or partially
      // overwrote the target would show up as a short read.
      const writes = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => writeFileAtomic(target, i % 2 ? large : small)),
      );
      reading = false;
      await reader;

      // On Windows a rename can lose a race with an open file and be reported
      // rather than silently corrupting the target. That is the guarantee
      // being tested here, so the burst is allowed some rejected writes.
      expect(writes.some((w) => w.status === 'fulfilled')).toBe(true);
      expect(lengths.length).toBeGreaterThan(0);
      expect(lengths.every((n) => n === 150_000)).toBe(true);
    });

    it('leaves the previous file untouched when the rename fails', async () => {
      // A directory where the target should be makes the rename fail on every
      // platform, after the temp file has already been written.
      const target = join(tmpDir, 'meta.json');
      await mkdir(target, { recursive: true });

      await expect(writeFileAtomic(target, 'content')).rejects.toThrow();

      expect((await stat(target)).isDirectory()).toBe(true);
      expect(await findTempFiles(tmpDir)).toEqual([]);
    });

    it('removes its temp file when the write itself fails', async () => {
      const target = join(tmpDir, 'missing', 'meta.json');

      await expect(writeFileAtomic(target, 'content')).rejects.toThrow();

      expect(await findTempFiles(tmpDir)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Locking
  // ---------------------------------------------------------------------------

  describe('locking', () => {
    it('serialises operations on a single module', async () => {
      const versions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '1.5.0'];

      const peak = await peakMetaConcurrency(() =>
        Promise.all(
          versions.map((version) =>
            store.publish(makeManifest({ name: 'serial', version }), files, 'tester'),
          ),
        ),
      );

      expect(peak).toBe(1);
      expect((await store.getVersions('serial')).sort()).toEqual([...versions].sort());
    });

    it('lets different modules publish in parallel', async () => {
      // A single global lock would make peak 1 here, and every module in the
      // registry would queue behind every other one.
      const peak = await peakMetaConcurrency(() =>
        Promise.all(
          ['alpha', 'bravo', 'charlie'].map((name) =>
            store.publish(makeManifest({ name }), files, 'tester'),
          ),
        ),
      );

      expect(peak).toBe(3);
      expect((await store.getAllModules()).length).toBe(3);
    });

    it('does not wedge the module after a failed operation', async () => {
      const internals = store as unknown as {
        writeMeta: (name: string, record: ModuleRecord) => Promise<void>;
      };
      const original = internals.writeMeta.bind(store);
      internals.writeMeta = async () => {
        throw new Error('disk on fire');
      };
      await expect(
        store.publish(makeManifest({ name: 'flaky' }), files, 'tester'),
      ).rejects.toThrow('disk on fire');
      delete internals.writeMeta;

      // The next caller must not be stuck behind the failed one's rejected
      // promise forever.
      await expect(
        store.publish(makeManifest({ name: 'flaky', version: '2.0.0' }), files, 'tester'),
      ).resolves.toEqual({ name: 'flaky', version: '2.0.0' });
      expect(await store.getVersions('flaky')).toEqual(['2.0.0']);
    });
  });

  // ---------------------------------------------------------------------------
  // Concurrent publishing
  // ---------------------------------------------------------------------------

  describe('concurrent publish', () => {
    it('converges on one record when the same version is published concurrently', async () => {
      const results = await Promise.all(
        Array.from({ length: 25 }, () => store.publish(makeManifest(), files, 'tester')),
      );

      expect(results.every((r) => r.name === 'test-module' && r.version === '1.0.0')).toBe(true);
      expect(await store.getVersions('test-module')).toEqual(['1.0.0']);

      const record = await store.getModule('test-module');
      expect(Object.keys(record!.versions)).toEqual(['1.0.0']);
      expect(record!.versions['1.0.0'].files).toEqual({ 'index.js': 'export default 1;' });
      expect(record!.versions['1.0.0'].publishedBy).toBe('tester');
      expect((await store.getVersion('test-module', '1.0.0'))!.integrity)
        .toMatch(/^sha256-[0-9a-f]{64}$/);
    });

    it('produces the same record whether a version is published once or twenty times', async () => {
      const bundle = new Map([['index.js', 'code'], ['README.md', '# hi']]);
      await store.publish(makeManifest({ name: 'solo' }), bundle, 'tester');
      const solo = (await store.getVersion('solo', '1.0.0'))!;

      await Promise.all(
        Array.from({ length: 20 }, () =>
          store.publish(makeManifest({ name: 'burst' }), bundle, 'tester'),
        ),
      );
      const burst = (await store.getVersion('burst', '1.0.0'))!;

      expect(burst.integrity).toBe(solo.integrity);
      // Same manifest apart from the name, which is the only intended difference.
      expect(burst.manifest).toEqual({ ...solo.manifest, name: 'burst' });
      expect(burst.tarball).toBe('/tarballs/burst-1.0.0.tgz');
      expect(burst.files).toEqual(solo.files);
    });

    it('keeps every version when different versions of one module race', async () => {
      const versions = ['1.0.0', '1.1.0', '2.0.0', '2.1.0', '3.0.0', '4.0.0', '5.0.0', '6.0.0'];

      await Promise.all(
        versions.map((version) =>
          store.publish(makeManifest({ version }), files, 'tester'),
        ),
      );

      expect((await store.getVersions('test-module')).sort()).toEqual([...versions].sort());
      for (const version of versions) {
        expect(await store.getVersion('test-module', version)).not.toBeNull();
      }
      const stats = await store.getStats();
      expect(stats.totalModules).toBe(1);
      expect(stats.totalVersions).toBe(versions.length);
    });

    it('never exposes a partially written meta.json during a burst', async () => {
      const metaPath = metaPathFor('test-module');
      const problems: string[] = [];
      let reading = true;
      const reader = (async () => {
        while (reading) {
          try {
            const parsed = JSON.parse(await readFile(metaPath, 'utf-8'));
            // Every observable state must be a whole record, not a fragment.
            if (parsed.name !== 'test-module' || typeof parsed.versions !== 'object') {
              problems.push('incomplete record');
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push(String(error));
          }
          await sleep(1);
        }
      })();

      const publishes = await Promise.allSettled([
        ...Array.from({ length: 20 }, () => store.publish(makeManifest(), files, 'tester')),
        ...['1.1.0', '1.2.0', '1.3.0', '2.0.0'].map((version) =>
          store.publish(makeManifest({ version }), files, 'tester'),
        ),
      ]);
      reading = false;
      await reader;

      // This is the point of the atomic writer: under a reader hammering the
      // file, it is never possible to observe a truncated or half-merged
      // record. A publish may still be reported as failed when Windows refuses
      // to replace a file that is open, and that is a different, recoverable
      // outcome than corruption.
      expect(problems).toEqual([]);
      expect(publishes.some((p) => p.status === 'fulfilled')).toBe(true);

      const record = await store.getModule('test-module');
      expect(record).not.toBeNull();
      expect(record!.name).toBe('test-module');
      for (const version of Object.keys(record!.versions)) {
        expect(await store.getVersion('test-module', version)).not.toBeNull();
      }
    });

    it('reports consistent stats across many modules at once', async () => {
      const names = ['mod-a', 'mod-b', 'mod-c', 'mod-d', 'mod-e'];

      await Promise.all(
        names.flatMap((name) =>
          ['1.0.0', '2.0.0'].map((version) =>
            store.publish(makeManifest({ name, version }), files, 'tester'),
          ),
        ),
      );

      const stats = await store.getStats();
      expect(stats.totalModules).toBe(5);
      expect(stats.totalVersions).toBe(10);
      expect((await store.getAllModules()).map((m) => m.name).sort()).toEqual([...names].sort());
    });

    it('does not lose a version when archiving races a publish', async () => {
      await store.publish(makeManifest({ version: '1.0.0' }), files, 'tester');

      await Promise.all([
        store.setArchived('test-module', true),
        store.publish(makeManifest({ version: '2.0.0' }), files, 'tester'),
      ]);

      const record = await store.getModule('test-module');
      expect(Object.keys(record!.versions).sort()).toEqual(['1.0.0', '2.0.0']);
      expect(record!.archived).toBe(true);
    });

    it('stays consistent when a delete races a publish', async () => {
      await store.publish(makeManifest({ name: 'racy' }), files, 'tester');

      const results = await Promise.allSettled([
        store.publish(makeManifest({ name: 'racy', version: '2.0.0' }), files, 'tester'),
        store.deleteModule('racy'),
      ]);

      expect(results).toHaveLength(2);
      // Either interleaving is fine; a corrupt or unreadable record is not.
      const record = await store.getModule('racy');
      if (record) {
        expect(record.versions['1.0.0']).toBeDefined();
        expect(Object.keys(record.versions).length).toBeLessThanOrEqual(2);
      }
      expect(await findTempFiles(tmpDir)).toEqual([]);
      // The store is still usable afterwards.
      await expect(
        store.publish(makeManifest({ name: 'racy', version: '3.0.0' }), files, 'tester'),
      ).resolves.toEqual({ name: 'racy', version: '3.0.0' });
    });
  });

  // ---------------------------------------------------------------------------
  // Failure paths
  // ---------------------------------------------------------------------------

  describe('failure paths', () => {
    it('leaves the last good meta.json in place when a publish fails', async () => {
      await store.publish(makeManifest({ name: 'keep', version: '1.0.0' }), files, 'tester');
      const internals = store as unknown as {
        writeMeta: (name: string, record: ModuleRecord) => Promise<void>;
      };
      internals.writeMeta = async () => {
        throw new Error('disk on fire');
      };

      await expect(
        store.publish(makeManifest({ name: 'keep', version: '2.0.0' }), files, 'tester'),
      ).rejects.toThrow('disk on fire');
      delete internals.writeMeta;

      const record = await store.getModule('keep');
      // The version that was committed is still readable, and the one that
      // failed to commit left no trace.
      expect(Object.keys(record!.versions)).toEqual(['1.0.0']);
      expect(record!.latest).toBe('1.0.0');
      expect(JSON.parse(await readFile(metaPathFor('keep'), 'utf-8')).name).toBe('keep');
    });

    it('leaves no .tmp files when a metadata rename is forced to fail', async () => {
      // A directory at meta.json makes the rename fail after the temp exists.
      const moduleDir = join(tmpDir, 'modules', 'broken');
      await mkdir(join(moduleDir, 'meta.json'), { recursive: true });

      await expect(
        store.publish(makeManifest({ name: 'broken' }), files, 'tester'),
      ).rejects.toThrow();

      expect(await findTempFiles(tmpDir)).toEqual([]);
      expect((await stat(join(moduleDir, 'meta.json'))).isDirectory()).toBe(true);
      // Still a clean miss from a reader's point of view, not a broken parse.
      expect(await store.getModule('broken')).toBeNull();
    });

    it('leaves no .tmp files after a successful run', async () => {
      await Promise.all(
        ['1.0.0', '1.1.0', '2.0.0'].map((version) =>
          store.publish(makeManifest({ version }), files, 'tester'),
        ),
      );
      await store.setArchived('test-module', true);
      await store.setArchived('test-module', false);
      await store.deleteModule('test-module');
      await store.publish(makeManifest({ version: '3.0.0' }), files, 'tester');

      expect(await findTempFiles(tmpDir)).toEqual([]);
    });

    it('does not advertise a version before its files are on disk', async () => {
      await store.publish(makeManifest({ name: 'ordered' }), files, 'tester');

      const record = await store.getModule('ordered');
      const listed = Object.keys(record!.versions);
      for (const version of listed) {
        expect(record!.versions[version].files).toEqual({ 'index.js': 'export default 1;' });
        await expect(
          readFile(join(tmpDir, 'modules', 'ordered', version, 'index.js'), 'utf-8'),
        ).resolves.toBe('export default 1;');
      }
    });
  });
});
// ============================================================================
// Path safety
//
// A module name and a published file path are both attacker-controlled. Without
// validation `join(modulesDir, "../../x")` normalises straight past the registry,
// so a publish could write anywhere the process can. These tests pin the
// containment guarantee rather than just the individual patterns.
// ============================================================================

describe('path safety', () => {
  let tmpDir: string;
  let store: ModuleStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-store-pathsafe-'));
    store = new ModuleStore(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const TRAVERSING_NAMES = [
    '../escape',
    '../../ESCAPED',
    '..',
    '.',
    'a/../../b',
    '/absolute',
    'C:/windows',
    'back\\slash',
    'null\0byte',
    'a/b/c',
    '',
  ];

  it.each(TRAVERSING_NAMES)('refuses to publish the module name %j', async (name) => {
    await expect(
      store.publish(makeManifest({ name }), new Map([['index.js', 'x']]), 'tester'),
    ).rejects.toThrow(PathSafetyError);
  });

  it.each(TRAVERSING_NAMES)('refuses to read or delete the module name %j', async (name) => {
    await expect(store.getModule(name)).rejects.toThrow(PathSafetyError);
    await expect(store.getVersions(name)).rejects.toThrow(PathSafetyError);
    await expect(store.getVersion(name, '1.0.0')).rejects.toThrow(PathSafetyError);
    await expect(store.deleteModule(name)).rejects.toThrow(PathSafetyError);
  });

  it.each([
    '../escaped.js',
    '../../also-escaped.js',
    'nested/../../escape.js',
    '/etc/passwd',
    'C:/windows/system32/x.js',
    'back\\slash.js',
    'null\0byte.js',
    '',
  ])('refuses to publish the file path %j', async (filePath) => {
    await expect(
      store.publish(makeManifest(), new Map([[filePath, 'pwned']]), 'tester'),
    ).rejects.toThrow(PathSafetyError);
  });

  it('writes nothing outside the registry when a publish is rejected', async () => {
    const outside = join(tmpdir(), 'mam-escape-canary.txt');
    await rm(outside, { force: true });

    await expect(
      store.publish(
        makeManifest({ name: '../../../../../../../../canary' }),
        new Map([['../../../../../../../../canary.txt', 'pwned']]),
        'tester',
      ),
    ).rejects.toThrow(PathSafetyError);

    await expect(readFile(outside, 'utf-8')).rejects.toThrow();
    const siblings = await readdir(tmpdir());
    expect(siblings.filter((e) => e.includes('canary'))).toEqual([]);
  });

  it('does not leave a partial module behind when a file path is rejected', async () => {
    await expect(
      store.publish(
        makeManifest({ name: 'half-written' }),
        new Map([['index.js', 'ok'], ['../../escape.js', 'bad']]),
        'tester',
      ),
    ).rejects.toThrow(PathSafetyError);

    expect(await store.getModule('half-written')).toBeNull();
  });

  it('accepts scoped and nested legitimate paths', async () => {
    await expect(
      store.publish(
        makeManifest({ name: '@mam/thing' }),
        new Map([['index.js', 'x'], ['src/lib/util.js', 'y']]),
        'tester',
      ),
    ).resolves.toEqual({ name: '@mam/thing', version: '1.0.0' });

    expect(await store.getVersions('@mam/thing')).toEqual(['1.0.0']);
    await expect(readFile(join(tmpDir, 'modules', '@mam', 'thing', '1.0.0', 'src/lib/util.js'), 'utf-8'))
      .resolves.toBe('y');
  });

  it('rejects a traversal that only appears after normalisation', async () => {
    // A pattern match alone would miss this; the resolve-then-compare check catches it.
    const root = join(tmpDir, 'modules', 'm');
    expect(() => assertSafeFilePath(root, 'a/./../../../../canary')).toThrow(PathSafetyError);
    // The same input without the climb is fine, so the rejection is about the escape
    // and not about dots or slashes in general.
    expect(() => assertSafeFilePath(root, 'a/./b/c.js')).not.toThrow();
  });

});
