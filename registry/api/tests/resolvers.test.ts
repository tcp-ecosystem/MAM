/**
 * MAM Registry API — resolver tests
 *
 * Exercises the pure input helpers directly and the resolvers against a real
 * `ModuleStore` on a temp directory, so the tests cover the same path a host
 * takes rather than a mocked store.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModuleStore } from '@mam/registry-server';
import type { ModuleRecord, VersionRecord } from '@mam/registry-server';
import {
  resolvers,
  createResolverContext,
  resetResolverStore,
  invoke,
  sanitizeModule,
  sanitizeVersion,
  requireString,
  normalizeLimit,
  normalizeOffset,
  normalizeTags,
  compareVersionsDesc,
  ResolverInputError,
  ModuleNotFoundError,
  type ResolverContext,
  type ModuleShape,
  type VersionShape,
  type ListArgs,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    name: 'test-module',
    description: 'A test module',
    author: 'tester',
    tags: ['test'],
    versions: {
      '1.0.0': makeVersionRecord(),
    },
    latest: '1.0.0',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function makeVersionRecord(overrides: Partial<VersionRecord> = {}): VersionRecord {
  return {
    version: '1.0.0',
    manifest: { name: 'test-module', version: '1.0.0' } as VersionRecord['manifest'],
    files: { 'index.js': 'export default 1;' },
    tarball: '/tarballs/test-module-1.0.0.tgz',
    integrity: 'sha256-0000',
    publishedAt: '2024-01-01T00:00:00.000Z',
    publishedBy: 'tester',
    ...overrides,
  };
}

const FILES = { 'index.js': 'export default 1;' };

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

describe('requireString()', () => {
  it('trims the value', () => {
    expect(requireString('  hello  ', 'name')).toBe('hello');
  });

  it('throws ResolverInputError on an empty string', () => {
    expect(() => requireString('', 'name')).toThrow(ResolverInputError);
  });

  it('throws ResolverInputError on a blank string', () => {
    expect(() => requireString('   ', 'name')).toThrow(ResolverInputError);
  });

  it('throws ResolverInputError on a non-string', () => {
    expect(() => requireString(42, 'name')).toThrow(ResolverInputError);
    expect(() => requireString(undefined, 'name')).toThrow(ResolverInputError);
    expect(() => requireString(null, 'name')).toThrow(ResolverInputError);
  });

  it('names the offending field on the error', () => {
    try {
      requireString('', 'version');
      expect.unreachable('requireString should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ResolverInputError);
      expect((err as ResolverInputError).field).toBe('version');
      expect((err as ResolverInputError).message).toContain('version');
    }
  });
});

describe('normalizeLimit()', () => {
  it('falls back to 20 when undefined', () => {
    expect(normalizeLimit(undefined)).toBe(20);
  });

  it('falls back to 20 for a non-numeric value', () => {
    expect(normalizeLimit(Number.NaN)).toBe(20);
  });

  it('clamps 0 up to 1', () => {
    expect(normalizeLimit(0)).toBe(1);
  });

  it('clamps a negative value up to 1', () => {
    expect(normalizeLimit(-7)).toBe(1);
  });

  it('clamps 500 down to 100', () => {
    expect(normalizeLimit(500)).toBe(100);
  });

  it('passes an in-range value through', () => {
    expect(normalizeLimit(42)).toBe(42);
  });

  it('honours custom fallback and maximum', () => {
    expect(normalizeLimit(undefined, 5)).toBe(5);
    expect(normalizeLimit(9, 5, 8)).toBe(8);
  });
});

describe('normalizeOffset()', () => {
  it('returns 0 for undefined', () => {
    expect(normalizeOffset(undefined)).toBe(0);
  });

  it('clamps negatives to 0', () => {
    expect(normalizeOffset(-1)).toBe(0);
  });

  it('returns 0 for a non-numeric value', () => {
    expect(normalizeOffset(Number.NaN)).toBe(0);
  });

  it('floors a fractional offset', () => {
    expect(normalizeOffset(3.9)).toBe(3);
  });

  it('passes a valid offset through', () => {
    expect(normalizeOffset(10)).toBe(10);
  });
});

describe('normalizeTags()', () => {
  it('lowercases and trims', () => {
    expect(normalizeTags(['  Alpha  ', 'BETA'])).toEqual(['alpha', 'beta']);
  });

  it('de-duplicates', () => {
    expect(normalizeTags(['a', 'A', ' a '])).toEqual(['a']);
  });

  it('sorts', () => {
    expect(normalizeTags(['zeta', 'alpha', 'mu'])).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('drops non-strings and empties', () => {
    expect(normalizeTags(['keep', 1, null, '', '   ', undefined, { a: 1 }])).toEqual(['keep']);
  });

  it('returns an empty array for a non-array', () => {
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags('a,b')).toEqual([]);
  });
});

describe('compareVersionsDesc()', () => {
  it('orders 2.0.0 above 1.9.9', () => {
    expect(compareVersionsDesc('2.0.0', '1.9.9')).toBeLessThan(0);
  });

  it('orders 1.0.0 above 1.0.0-rc1', () => {
    expect(compareVersionsDesc('1.0.0', '1.0.0-rc1')).toBeGreaterThan(0);
  });

  it('orders 1.10.0 above 1.9.0 numerically, not lexically', () => {
    expect(compareVersionsDesc('1.10.0', '1.9.0')).toBeLessThan(0);
  });

  it('returns 0 for identical versions', () => {
    expect(compareVersionsDesc('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('sanitizeModule()', () => {
  it('maps a record to the declared shape', () => {
    const shape = sanitizeModule(makeRecord());
    expect(Object.keys(shape).sort()).toEqual([
      'archived', 'author', 'description', 'downloads', 'name',
      'publishedAt', 'tags', 'version', 'versionCount',
    ]);
    expect(shape).toEqual<ModuleShape>({
      name: 'test-module',
      version: '1.0.0',
      description: 'A test module',
      author: 'tester',
      tags: ['test'],
      downloads: 0,
      publishedAt: '2024-01-02T00:00:00.000Z',
      archived: false,
      versionCount: 1,
    });
  });

  it('defaults archived to false when the record omits it', () => {
    expect(sanitizeModule(makeRecord({ archived: undefined })).archived).toBe(false);
    expect(sanitizeModule(makeRecord({ archived: false })).archived).toBe(false);
  });

  it('reports archived when the record sets it', () => {
    expect(sanitizeModule(makeRecord({ archived: true })).archived).toBe(true);
  });

  it('counts every version', () => {
    const record = makeRecord({
      versions: {
        '1.0.0': makeVersionRecord(),
        '1.1.0': makeVersionRecord({ version: '1.1.0' }),
        '2.0.0': makeVersionRecord({ version: '2.0.0' }),
      },
    });
    expect(sanitizeModule(record).versionCount).toBe(3);
  });

  it('normalises an empty description to null', () => {
    expect(sanitizeModule(makeRecord({ description: '' })).description).toBeNull();
  });

  it('copies the tags array rather than aliasing it', () => {
    const record = makeRecord({ tags: ['a', 'b'] });
    const shape = sanitizeModule(record);
    shape.tags.push('c');
    expect(record.tags).toEqual(['a', 'b']);
  });
});

describe('sanitizeVersion()', () => {
  it('maps a version record and includes fileCount', () => {
    const shape = sanitizeVersion(makeVersionRecord());
    expect(Object.keys(shape).sort()).toEqual([
      'fileCount', 'integrity', 'manifest', 'publishedAt', 'publishedBy', 'tarball', 'version',
    ]);
    expect(shape.fileCount).toBe(1);
  });

  it('counts every published file', () => {
    const shape = sanitizeVersion(makeVersionRecord({ files: { 'a.js': 'a', 'b.js': 'b' } }));
    expect(shape.fileCount).toBe(2);
  });

  it('reports zero files for an empty file map', () => {
    expect(sanitizeVersion(makeVersionRecord({ files: {} })).fileCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Resolvers against a real store
// ---------------------------------------------------------------------------

describe('resolvers', () => {
  let tmpDir: string;
  let store: ModuleStore;
  let ctx: ResolverContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-registry-api-test-'));
    store = new ModuleStore(tmpDir);
    await store.init();
    ctx = createResolverContext({ store });
    resetResolverStore();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const publish = (args: Record<string, unknown>): Promise<ModuleShape> =>
    resolvers.Mutation.publishModule(null, args as never, ctx);

  const list = (args: ListArgs = {}): Promise<ModuleShape[]> =>
    resolvers.Query.modules(null, args, ctx);

  describe('publishModule()', () => {
    it('creates a module', async () => {
      const result = await publish({
        name: 'alpha', version: '1.0.0', description: 'First', author: 'ann', files: FILES,
      });
      expect(result.name).toBe('alpha');
      expect(result.version).toBe('1.0.0');
      expect(result.versionCount).toBe(1);
      expect(result.description).toBe('First');
      expect(result.author).toBe('ann');
    });

    it('updates an existing module and grows versionCount', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await publish({ name: 'alpha', version: '1.1.0', author: 'ann', files: FILES });
      expect(result.versionCount).toBe(2);
      expect(result.version).toBe('1.1.0');
    });

    it('lowercases and sorts tags', async () => {
      const result = await publish({
        name: 'alpha', version: '1.0.0', tags: ['  Zeta ', 'Alpha', 'alpha'], files: FILES,
      });
      expect(result.tags).toEqual(['alpha', 'zeta']);
    });

    it('defaults the author to anonymous', async () => {
      const result = await publish({ name: 'alpha', version: '1.0.0' });
      expect(result.author).toBe('anonymous');
    });

    it('throws ResolverInputError without a name or version', async () => {
      await expect(publish({ version: '1.0.0' })).rejects.toBeInstanceOf(ResolverInputError);
      await expect(publish({ name: 'alpha' })).rejects.toBeInstanceOf(ResolverInputError);
    });
  });

  describe('modules()', () => {
    beforeEach(async () => {
      await publish({ name: 'alpha', version: '1.0.0', description: 'Payments library', author: 'ann', tags: ['money'], files: FILES });
      await publish({ name: 'beta', version: '1.0.0', description: 'Testing helpers', author: 'bob', tags: ['test'], files: FILES });
      await publish({ name: 'gamma', version: '1.0.0', description: 'GraphQL helpers', author: 'ann', tags: ['graphql', 'test'], files: FILES });
    });

    it('returns every module by default', async () => {
      const names = (await list()).map((m) => m.name);
      expect(names).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']));
      expect(names.length).toBe(3);
    });

    it('filters by query against the name', async () => {
      const names = (await list({ query: 'alph' })).map((m) => m.name);
      expect(names).toEqual(['alpha']);
    });

    it('filters by query against the description', async () => {
      const names = (await list({ query: 'testing' })).map((m) => m.name);
      expect(names).toEqual(['beta']);
    });

    it('filters by query against the tags', async () => {
      const names = (await list({ query: 'graphql' })).map((m) => m.name);
      expect(names).toEqual(['gamma']);
    });

    it('filters by tag case-insensitively', async () => {
      const names = (await list({ tag: 'TEST' })).map((m) => m.name);
      expect(names).toEqual(expect.arrayContaining(['beta', 'gamma']));
    });

    it('filters by author case-insensitively', async () => {
      const names = (await list({ author: 'Ann' })).map((m) => m.name);
      expect(names).toEqual(expect.arrayContaining(['alpha', 'gamma']));
    });

    it('paginates with limit and offset', async () => {
      const first = await list({ limit: 2, offset: 0 });
      const second = await list({ limit: 2, offset: 2 });
      expect(first.length).toBe(2);
      expect(second.length).toBe(1);
      const all = [...first, ...second].map((m) => m.name);
      expect(new Set(all).size).toBe(3);
    });

    it('clamps a hostile limit rather than returning everything', async () => {
      expect((await list({ limit: 0 })).length).toBe(1);
    });

    it('hides archived modules by default', async () => {
      await resolvers.Mutation.archiveModule(null, { name: 'beta' }, ctx);
      const names = (await list()).map((m) => m.name);
      expect(names).not.toContain('beta');
      expect(names.length).toBe(2);
    });

    it('includes archived modules with includeArchived', async () => {
      await resolvers.Mutation.archiveModule(null, { name: 'beta' }, ctx);
      const names = (await list({ includeArchived: true })).map((m) => m.name);
      expect(names).toContain('beta');
      expect(names.length).toBe(3);
    });
  });

  describe('module()', () => {
    it('returns the module when it exists', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Query.module(null, { name: 'alpha' }, ctx);
      expect(result?.name).toBe('alpha');
    });

    it('returns null for a missing module rather than throwing', async () => {
      const result = await resolvers.Query.module(null, { name: 'nonexistent' }, ctx);
      expect(result).toBeNull();
    });

    it('throws ResolverInputError on a blank name', async () => {
      await expect(resolvers.Query.module(null, { name: '  ' }, ctx))
        .rejects.toBeInstanceOf(ResolverInputError);
    });
  });

  describe('searchModules()', () => {
    beforeEach(async () => {
      await publish({ name: 'alpha', version: '1.0.0', description: 'Payments library', author: 'ann', tags: ['money'], files: FILES });
      await publish({ name: 'beta', version: '1.0.0', description: 'Payments sandbox', author: 'bob', tags: ['money'], files: FILES });
    });

    it('finds by name', async () => {
      const names = (await resolvers.Query.searchModules(null, { q: 'alpha' }, ctx)).map((m) => m.name);
      expect(names).toEqual(['alpha']);
    });

    it('finds by description', async () => {
      const names = (await resolvers.Query.searchModules(null, { q: 'sandbox' }, ctx)).map((m) => m.name);
      expect(names).toEqual(['beta']);
    });

    it('finds by tag', async () => {
      const names = (await resolvers.Query.searchModules(null, { q: 'money' }, ctx)).map((m) => m.name);
      expect(names).toEqual(expect.arrayContaining(['alpha', 'beta']));
    });

    it('excludes archived modules', async () => {
      await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);
      const names = (await resolvers.Query.searchModules(null, { q: 'payments' }, ctx)).map((m) => m.name);
      expect(names).toEqual(['beta']);
    });

    it('honours the limit', async () => {
      const results = await resolvers.Query.searchModules(null, { q: 'payments', limit: 1 }, ctx);
      expect(results.length).toBe(1);
    });

    it('throws ResolverInputError on an empty query', async () => {
      await expect(resolvers.Query.searchModules(null, { q: '  ' }, ctx))
        .rejects.toBeInstanceOf(ResolverInputError);
    });
  });

  describe('moduleVersions()', () => {
    beforeEach(async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await publish({ name: 'alpha', version: '1.10.0', author: 'ann', files: FILES });
      await publish({ name: 'alpha', version: '2.0.0', author: 'ann', files: FILES });
    });

    it('returns every version newest first', async () => {
      const versions = await resolvers.Query.moduleVersions(null, { name: 'alpha' }, ctx);
      expect(versions.map((v) => v.version)).toEqual(['2.0.0', '1.10.0', '1.0.0']);
    });

    it('includes the file count on each version', async () => {
      const versions = await resolvers.Query.moduleVersions(null, { name: 'alpha' }, ctx);
      expect(versions[0]!.fileCount).toBe(1);
    });

    it('throws ModuleNotFoundError for a missing module', async () => {
      await expect(resolvers.Query.moduleVersions(null, { name: 'nonexistent' }, ctx))
        .rejects.toBeInstanceOf(ModuleNotFoundError);
    });
  });

  describe('moduleVersion()', () => {
    it('returns the requested version', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Query.moduleVersion(null, { name: 'alpha', version: '1.0.0' }, ctx);
      expect(result?.version).toBe('1.0.0');
      expect(result?.publishedBy).toBe('ann');
    });

    it('returns null for a missing version', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Query.moduleVersion(null, { name: 'alpha', version: '9.9.9' }, ctx);
      expect(result).toBeNull();
    });

    it('returns null for a missing module', async () => {
      const result = await resolvers.Query.moduleVersion(null, { name: 'nonexistent', version: '1.0.0' }, ctx);
      expect(result).toBeNull();
    });
  });

  describe('registryStats()', () => {
    it('counts an empty registry', async () => {
      const stats = await resolvers.Query.registryStats(null, {}, ctx);
      expect(stats.archived).toBe(0);
      expect(stats.totalModules).toBe(0);
      expect(stats.totalVersions).toBe(0);
    });

    it('counts modules and versions, including the archived tally', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await publish({ name: 'alpha', version: '1.1.0', author: 'ann', files: FILES });
      await publish({ name: 'beta', version: '1.0.0', author: 'bob', files: FILES });
      await resolvers.Mutation.archiveModule(null, { name: 'beta' }, ctx);

      const stats = await resolvers.Query.registryStats(null, {}, ctx);
      expect(stats.totalModules).toBe(2);
      expect(stats.totalVersions).toBe(3);
      expect(stats.archived).toBe(1);
    });
  });

  describe('deleteModule()', () => {
    it('returns true and removes the module', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Mutation.deleteModule(null, { name: 'alpha' }, ctx);
      expect(result).toBe(true);
      expect(await store.getModule('alpha')).toBeNull();
      expect(await list()).toEqual([]);
    });

    it('throws ModuleNotFoundError for a missing module', async () => {
      await expect(resolvers.Mutation.deleteModule(null, { name: 'nonexistent' }, ctx))
        .rejects.toBeInstanceOf(ModuleNotFoundError);
    });
  });

  describe('archiveModule()', () => {
    it('sets archived and reports it on the returned shape', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);
      expect(result.archived).toBe(true);
    });

    it('persists the flag to disk so a fresh read still sees it', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);

      // Read straight from the store rather than through a cached shape: setting
      // the flag on the in-memory record alone reported success while writing
      // nothing to meta.json.
      const reread = await store.getModule('alpha');
      expect(reread).not.toBeNull();
      expect(reread!.archived).toBe(true);
    });

    it('keeps the flag after a re-publish of another version', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);
      await publish({ name: 'alpha', version: '1.1.0', author: 'ann', files: FILES });

      const reread = await store.getModule('alpha');
      expect(reread!.archived).toBe(true);
    });

    it('un-archives when archived is false', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);
      const result = await resolvers.Mutation.archiveModule(null, { name: 'alpha', archived: false }, ctx);
      expect(result.archived).toBe(false);
      expect((await store.getModule('alpha'))!.archived).toBe(false);
    });

    it('defaults archived to true when the argument is absent', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const result = await resolvers.Mutation.archiveModule(null, { name: 'alpha' }, ctx);
      expect(result.archived).toBe(true);
    });
  });

  describe('Module.versions', () => {
    it('returns the versions of a module shape, newest first', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      await publish({ name: 'alpha', version: '1.1.0', author: 'ann', files: FILES });
      await publish({ name: 'alpha', version: '2.0.0', author: 'ann', files: FILES });

      const parent = (await resolvers.Query.module(null, { name: 'alpha' }, ctx))!;
      const versions = await resolvers.Module.versions(parent, {}, ctx);
      expect(versions.map((v: VersionShape) => v.version)).toEqual(['2.0.0', '1.1.0', '1.0.0']);
    });

    it('returns an empty list for a module that has since been deleted', async () => {
      await publish({ name: 'alpha', version: '1.0.0', author: 'ann', files: FILES });
      const parent = (await resolvers.Query.module(null, { name: 'alpha' }, ctx))!;
      await resolvers.Mutation.deleteModule(null, { name: 'alpha' }, ctx);
      expect(await resolvers.Module.versions(parent, {}, ctx)).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// invoke()
// ---------------------------------------------------------------------------

describe('invoke()', () => {
  let tmpDir: string;
  let store: ModuleStore;
  let ctx: ResolverContext;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-registry-api-invoke-'));
    store = new ModuleStore(tmpDir);
    await store.init();
    ctx = createResolverContext({ store });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('dispatches to a Mutation resolver', async () => {
    const result = await invoke('publishModule', {
      name: 'alpha', version: '1.0.0', author: 'ann', files: FILES,
    }, ctx) as ModuleShape;
    expect(result.name).toBe('alpha');
    expect(result.versionCount).toBe(1);
  });

  it('dispatches to a Query resolver', async () => {
    await invoke('publishModule', { name: 'alpha', version: '1.0.0', author: 'ann', files: FILES }, ctx);
    const result = await invoke('module', { name: 'alpha' }, ctx) as ModuleShape;
    expect(result.name).toBe('alpha');
  });

  it('dispatches list and aggregate queries', async () => {
    await invoke('publishModule', { name: 'alpha', version: '1.0.0', author: 'ann', files: FILES }, ctx);
    expect(Array.isArray(await invoke('modules', {}, ctx))).toBe(true);
    expect((await invoke('moduleVersions', { name: 'alpha' }, ctx) as VersionShape[]).length).toBe(1);
    expect((await invoke('registryStats', {}, ctx) as { archived: number }).archived).toBe(0);
  });

  it('dispatches archive and delete mutations', async () => {
    await invoke('publishModule', { name: 'alpha', version: '1.0.0', author: 'ann', files: FILES }, ctx);
    expect((await invoke('archiveModule', { name: 'alpha' }, ctx) as ModuleShape).archived).toBe(true);
    expect(await invoke('deleteModule', { name: 'alpha' }, ctx)).toBe(true);
  });

  it('throws for an unknown operation name', async () => {
    await expect(invoke('nope' as never, {}, ctx)).rejects.toThrow(Error);
    await expect(invoke('nope' as never, {}, ctx)).rejects.toThrow(/Unknown resolver/);
  });
});
