import { describe, it, expect, beforeEach } from 'vitest';
import {
  SearchEngine,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  normalizeSearchLimit,
  normalizeSearchOffset,
} from '../src/search.js';
import { ModuleRecord, VersionRecord } from '../src/store.js';

function makeVersion(name: string, version: string): VersionRecord {
  return {
    version,
    manifest: {
      name,
      version,
      description: 'A test module for unit testing',
      author: 'tester',
      license: 'MIT',
      tags: ['test', 'utility'],
      dependencies: [],
      main: 'index.js',
      files: [],
    },
    files: {},
    tarball: `/tarballs/${name}-${version}.tgz`,
    integrity: 'sha256-abc123',
    publishedAt: '2024-01-01T00:00:00.000Z',
    publishedBy: 'tester',
  };
}

function makeModule(overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    name: 'test-module',
    description: 'A test module for unit testing',
    author: 'tester',
    tags: ['test', 'utility'],
    versions: {
      '1.0.0': {
        version: '1.0.0',
        manifest: {
          name: 'test-module',
          version: '1.0.0',
          description: 'A test module for unit testing',
          author: 'tester',
          license: 'MIT',
          tags: ['test', 'utility'],
          dependencies: [],
          main: 'index.js',
          files: [],
        },
        files: {},
        tarball: '/tarballs/test-module-1.0.0.tgz',
        integrity: 'sha256-abc123',
        publishedAt: '2024-01-01T00:00:00.000Z',
        publishedBy: 'tester',
      },
    },
    latest: '1.0.0',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('SearchEngine', () => {
  let engine: SearchEngine;

  beforeEach(() => {
    engine = new SearchEngine();
  });

  describe('indexModule()', () => {
    it('adds a module to the index', () => {
      const mod = makeModule();
      engine.indexModule(mod);
      expect(engine.getIndexSize()).toBe(1);
    });

    it('indexes multiple modules', () => {
      engine.indexModule(makeModule({ name: 'module-a', author: 'alice' }));
      engine.indexModule(makeModule({ name: 'module-b', author: 'bob' }));
      expect(engine.getIndexSize()).toBe(2);
    });
  });

  describe('removeModule()', () => {
    it('removes a module from the index', () => {
      engine.indexModule(makeModule({ name: 'to-remove' }));
      expect(engine.getIndexSize()).toBe(1);
      engine.removeModule('to-remove');
      expect(engine.getIndexSize()).toBe(0);
    });

    it('does not throw when removing a non-existent module', () => {
      expect(() => engine.removeModule('nonexistent')).not.toThrow();
    });
  });

  describe('search()', () => {
    beforeEach(() => {
      engine.indexModule(makeModule({ name: 'http-client', description: 'HTTP client library', tags: ['http', 'network'] }));
      engine.indexModule(makeModule({ name: 'http-server', description: 'HTTP server framework', tags: ['http', 'web'] }));
      engine.indexModule(makeModule({ name: 'database-orm', description: 'ORM for SQL databases', tags: ['database', 'sql'] }));
    });

    it('finds matching modules with a text query', async () => {
      const results = await engine.search('http');
      expect(results.modules.length).toBe(2);
      expect(results.modules.every(m => m.name.includes('http') || m.description.toLowerCase().includes('http'))).toBe(true);
    });

    it('returns empty results for non-matching query', async () => {
      const results = await engine.search('xyz-nonexistent');
      expect(results.modules.length).toBe(0);
      expect(results.total).toBe(0);
    });

    it('filters by tag', async () => {
      const results = await engine.search({ text: '', tags: ['web'] });
      expect(results.modules.length).toBe(1);
      expect(results.modules[0].name).toBe('http-server');
    });

    it('filters by author', async () => {
      engine.indexModule(makeModule({ name: 'authored-by-alice', author: 'alice', description: 'authored module' }));
      const results = await engine.search({ text: '', author: 'alice' });
      expect(results.modules.length).toBe(1);
      expect(results.modules[0].author).toBe('alice');
    });

    it('applies limit and offset pagination', async () => {
      const all = await engine.search({ text: 'http', limit: 1, offset: 0 });
      expect(all.modules.length).toBe(1);

      const page2 = await engine.search({ text: 'http', limit: 1, offset: 1 });
      expect(page2.modules.length).toBe(1);
      expect(page2.modules[0].name).not.toBe(all.modules[0].name);
    });

    it('scores exact name matches higher', async () => {
      engine.indexModule(makeModule({
        name: 'exact',
        description: 'not exact',
        tags: [],
      }));
      engine.indexModule(makeModule({
        name: 'exact-match-extended',
        description: 'exact',
        tags: [],
      }));

      const results = await engine.search('exact');
      expect(results.modules.length).toBeGreaterThanOrEqual(2);
      // The module whose name equals 'exact' should score higher
      expect(results.modules[0].name).toBe('exact');
      expect(results.modules[0].score).toBeGreaterThan(results.modules[1].score);
    });

    it('returns timeMs in results', async () => {
      const results = await engine.search('http');
      expect(results.timeMs).toBeTypeOf('number');
      expect(results.timeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSuggestions()', () => {
    it('returns modules matching the prefix', () => {
      engine.indexModule(makeModule({ name: 'alpha' }));
      engine.indexModule(makeModule({ name: 'beta' }));
      engine.indexModule(makeModule({ name: 'alphabet' }));

      const suggestions = engine.getSuggestions('alp');
      expect(suggestions).toContain('alpha');
      expect(suggestions).toContain('alphabet');
      expect(suggestions).not.toContain('beta');
    });

    it('respects the limit parameter', () => {
      engine.indexModule(makeModule({ name: 'a1' }));
      engine.indexModule(makeModule({ name: 'a2' }));
      engine.indexModule(makeModule({ name: 'a3' }));

      const suggestions = engine.getSuggestions('a', 2);
      expect(suggestions.length).toBeLessThanOrEqual(2);
    });

    it('returns empty array when no matches', () => {
      engine.indexModule(makeModule({ name: 'alpha' }));
      const suggestions = engine.getSuggestions('zzz');
      expect(suggestions).toEqual([]);
    });
  });

  describe('getPopular()', () => {
    it('returns indexed modules', () => {
      engine.indexModule(makeModule({ name: 'popular-1' }));
      engine.indexModule(makeModule({ name: 'popular-2' }));

      const popular = engine.getPopular();
      expect(popular.length).toBe(2);
    });

    it('respects the limit parameter', () => {
      engine.indexModule(makeModule({ name: 'a' }));
      engine.indexModule(makeModule({ name: 'b' }));
      engine.indexModule(makeModule({ name: 'c' }));

      const popular = engine.getPopular(2);
      expect(popular.length).toBe(2);
    });
  });

  describe('getRecent()', () => {
    it('returns modules sorted by updatedAt descending', () => {
      engine.indexModule(makeModule({
        name: 'old-module',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }));
      engine.indexModule(makeModule({
        name: 'new-module',
        updatedAt: '2024-06-01T00:00:00.000Z',
      }));

      const recent = engine.getRecent();
      expect(recent.length).toBe(2);
      expect(recent[0].name).toBe('new-module');
      expect(recent[1].name).toBe('old-module');
    });

    it('respects the limit parameter', () => {
      engine.indexModule(makeModule({ name: 'x', updatedAt: '2024-01-01T00:00:00.000Z' }));
      engine.indexModule(makeModule({ name: 'y', updatedAt: '2024-02-01T00:00:00.000Z' }));
      engine.indexModule(makeModule({ name: 'z', updatedAt: '2024-03-01T00:00:00.000Z' }));

      const recent = engine.getRecent(1);
      expect(recent.length).toBe(1);
    });
  });

  describe('clearIndex()', () => {
    it('empties the index', () => {
      engine.indexModule(makeModule({ name: 'a' }));
      engine.indexModule(makeModule({ name: 'b' }));
      expect(engine.getIndexSize()).toBe(2);

      engine.clearIndex();
      expect(engine.getIndexSize()).toBe(0);
    });
  });

  describe('getIndexSize()', () => {
    it('returns 0 for an empty index', () => {
      expect(engine.getIndexSize()).toBe(0);
    });

    it('returns correct count', () => {
      engine.indexModule(makeModule({ name: 'one' }));
      expect(engine.getIndexSize()).toBe(1);
      engine.indexModule(makeModule({ name: 'two' }));
      expect(engine.getIndexSize()).toBe(2);
    });
  });

  describe('indexModules()', () => {
    it('indexes a batch of modules', () => {
      engine.indexModules([
        makeModule({ name: 'batch-a' }),
        makeModule({ name: 'batch-b' }),
        makeModule({ name: 'batch-c' }),
      ]);
      expect(engine.getIndexSize()).toBe(3);
    });
  });

  describe('reindex()', () => {
    it('drops modules that are no longer in the store', async () => {
      engine.indexModule(makeModule({ name: 'stale' }));
      engine.indexModule(makeModule({ name: 'kept' }));

      engine.reindex([makeModule({ name: 'kept' })]);

      expect(engine.getIndexSize()).toBe(1);
      const results = await engine.search({ text: '' });
      expect(results.modules.map(m => m.name)).toEqual(['kept']);
    });

    it('empties the index when given nothing', () => {
      engine.indexModule(makeModule({ name: 'gone' }));

      engine.reindex();

      expect(engine.getIndexSize()).toBe(0);
    });

    it('works after the index has been cleared', () => {
      engine.indexModule(makeModule({ name: 'before-clear' }));
      engine.clear();
      expect(engine.getIndexSize()).toBe(0);

      engine.reindex([makeModule({ name: 'after-clear' })]);

      expect(engine.getIndexSize()).toBe(1);
    });
  });

  describe('clear()', () => {
    it('empties the index', () => {
      engine.indexModule(makeModule({ name: 'a' }));
      engine.clear();
      expect(engine.getIndexSize()).toBe(0);
    });
  });

  describe('search() sort order', () => {
    beforeEach(() => {
      engine.indexModule(makeModule({
        name: 'zebra-module',
        description: 'striped helper',
        tags: [],
        updatedAt: '2024-03-01T00:00:00.000Z',
      }));
      engine.indexModule(makeModule({
        name: 'alpha-module',
        description: 'first helper',
        tags: [],
        updatedAt: '2024-01-01T00:00:00.000Z',
      }));
      engine.indexModule(makeModule({
        name: 'middle-module',
        description: 'second helper',
        tags: [],
        updatedAt: '2024-06-01T00:00:00.000Z',
      }));
    });

    it('orders by relevance when no sort is given', async () => {
      engine.indexModule(makeModule({
        name: 'helper',
        description: 'helper',
        tags: [],
      }));

      const results = await engine.search('helper');
      expect(results.modules[0].name).toBe('helper');
      for (let i = 1; i < results.modules.length; i++) {
        expect(results.modules[i - 1].score).toBeGreaterThanOrEqual(results.modules[i].score);
      }
    });

    it('sorts by name ascending when asked', async () => {
      const results = await engine.search({ text: 'module', sort: 'name' });
      expect(results.modules.map(m => m.name)).toEqual([
        'alpha-module',
        'middle-module',
        'zebra-module',
      ]);
    });

    it('sorts by updatedAt descending when asked', async () => {
      const results = await engine.search({ text: 'module', sort: 'updated' });
      expect(results.modules.map(m => m.name)).toEqual([
        'middle-module',
        'zebra-module',
        'alpha-module',
      ]);
    });

    it('sorts by downloads as a stable name order, because downloads are not tracked', async () => {
      const results = await engine.search({ text: 'module', sort: 'downloads' });
      expect(results.modules.map(m => m.name)).toEqual([
        'alpha-module',
        'middle-module',
        'zebra-module',
      ]);
    });

    it('breaks score ties by name so repeated searches agree', async () => {
      const first = await engine.search({ text: 'helper', sort: 'relevance' });
      const second = await engine.search({ text: 'helper', sort: 'relevance' });
      expect(first.modules.map(m => m.name)).toEqual(second.modules.map(m => m.name));
    });

    it('paginates after sorting, so page 2 continues the chosen order', async () => {
      const all = await engine.search({ text: 'module', sort: 'name' });
      const page = await engine.search({ text: 'module', sort: 'name', limit: 1, offset: 1 });
      expect(page.modules[0].name).toBe(all.modules[1].name);
      expect(page.total).toBe(all.total);
    });
  });

  describe('search() archived modules', () => {
    beforeEach(() => {
      engine.indexModule(makeModule({ name: 'live-module' }));
      engine.indexModule(makeModule({ name: 'archived-module', archived: true }));
    });

    it('excludes archived modules by default', async () => {
      const results = await engine.search({ text: 'module' });
      expect(results.modules.map(m => m.name)).toEqual(['live-module']);
      expect(results.total).toBe(1);
    });

    it('includes archived modules when the query opts in', async () => {
      const results = await engine.search({ text: 'module', includeArchived: true });
      expect(results.modules.map(m => m.name).sort()).toEqual(['archived-module', 'live-module']);
      expect(results.total).toBe(2);
    });

    it('excludes archived modules from suggestions by default', () => {
      engine.indexModule(makeModule({ name: 'archived-helper', archived: true }));
      expect(engine.getSuggestions('archived')).toEqual([]);
      expect(engine.getSuggestions('archived', 10, true)).toContain('archived-helper');
    });

    it('excludes archived modules from popular and recent listings', () => {
      expect(engine.getPopular().map(m => m.name)).toEqual(['live-module']);
      expect(engine.getRecent().map(m => m.name)).toEqual(['live-module']);
      expect(engine.getPopular(10, true).map(m => m.name).sort()).toEqual(['archived-module', 'live-module']);
    });
  });

  describe('search() limit and offset clamping', () => {
    it('clamps a limit above the maximum', async () => {
      for (let i = 0; i < MAX_SEARCH_LIMIT + 20; i++) {
        engine.indexModule(makeModule({ name: `bulk-module-${i}`, description: 'bulk', tags: [] }));
      }

      const results = await engine.search({ text: 'bulk-module', limit: 1_000_000 });
      expect(results.modules.length).toBe(MAX_SEARCH_LIMIT);
      expect(results.total).toBe(MAX_SEARCH_LIMIT + 20);
    });

    it('treats limit 0 as the smallest page rather than the default', async () => {
      engine.indexModule(makeModule({ name: 'one', description: 'clamped', tags: [] }));
      engine.indexModule(makeModule({ name: 'two', description: 'clamped', tags: [] }));

      const results = await engine.search({ text: 'clamped', limit: 0 });
      expect(results.modules.length).toBe(1);
      expect(results.total).toBe(2);
    });

    it('clamps a negative limit to the smallest page', async () => {
      engine.indexModule(makeModule({ name: 'one', description: 'clamped', tags: [] }));
      engine.indexModule(makeModule({ name: 'two', description: 'clamped', tags: [] }));

      const results = await engine.search({ text: 'clamped', limit: -5 });
      expect(results.modules.length).toBe(1);
    });

    it('defaults to 20 when no limit is given', async () => {
      for (let i = 0; i < 30; i++) {
        engine.indexModule(makeModule({ name: `defaulted-${i}`, description: 'defaulted', tags: [] }));
      }

      const results = await engine.search({ text: 'defaulted' });
      expect(results.modules.length).toBe(DEFAULT_SEARCH_LIMIT);
    });

    it('never paginates from a negative offset', async () => {
      engine.indexModule(makeModule({ name: 'alpha', description: 'paged', tags: [] }));
      engine.indexModule(makeModule({ name: 'beta', description: 'paged', tags: [] }));

      const results = await engine.search({ text: 'paged', sort: 'name', offset: -10 });
      expect(results.modules.map(m => m.name)).toEqual(['alpha', 'beta']);
    });
  });

  describe('normalizeSearchLimit()', () => {
    it('falls back to the default for a missing or unusable limit', () => {
      expect(normalizeSearchLimit(undefined)).toBe(DEFAULT_SEARCH_LIMIT);
      expect(normalizeSearchLimit(NaN)).toBe(DEFAULT_SEARCH_LIMIT);
      expect(normalizeSearchLimit(Infinity)).toBe(DEFAULT_SEARCH_LIMIT);
    });

    it('clamps to 1..100', () => {
      expect(normalizeSearchLimit(0)).toBe(1);
      expect(normalizeSearchLimit(500)).toBe(MAX_SEARCH_LIMIT);
      expect(normalizeSearchLimit(7.9)).toBe(7);
    });

    it('honours a caller supplied fallback and maximum', () => {
      expect(normalizeSearchLimit(undefined, 10, 5)).toBe(10);
      expect(normalizeSearchLimit(50, 10, 5)).toBe(5);
    });
  });

  describe('normalizeSearchOffset()', () => {
    it('floors to a non-negative integer', () => {
      expect(normalizeSearchOffset(undefined)).toBe(0);
      expect(normalizeSearchOffset(-1)).toBe(0);
      expect(normalizeSearchOffset(NaN)).toBe(0);
      expect(normalizeSearchOffset(4.7)).toBe(4);
      expect(normalizeSearchOffset(9)).toBe(9);
    });
  });

  describe('getPopular() ranking', () => {
    it('ranks by the number of published versions, then by name', () => {
      engine.indexModule(makeModule({
        name: 'one-release',
        versions: { '1.0.0': makeVersion('one-release', '1.0.0') },
      }));
      engine.indexModule(makeModule({
        name: 'two-releases-b',
        versions: {
          '1.0.0': makeVersion('two-releases-b', '1.0.0'),
          '1.1.0': makeVersion('two-releases-b', '1.1.0'),
        },
      }));
      engine.indexModule(makeModule({
        name: 'two-releases-a',
        versions: {
          '1.0.0': makeVersion('two-releases-a', '1.0.0'),
          '1.1.0': makeVersion('two-releases-a', '1.1.0'),
        },
      }));

      const popular = engine.getPopular();
      expect(popular.map(m => m.name)).toEqual([
        'two-releases-a',
        'two-releases-b',
        'one-release',
      ]);
    });

    it('carries the version count as the score instead of a hardcoded 1', () => {
      engine.indexModule(makeModule({
        name: 'many-releases',
        versions: {
          '1.0.0': makeVersion('many-releases', '1.0.0'),
          '1.1.0': makeVersion('many-releases', '1.1.0'),
          '1.2.0': makeVersion('many-releases', '1.2.0'),
        },
      }));

      const popular = engine.getPopular();
      expect(popular[0].score).toBe(3);
    });
  });

  describe('search() substring semantics', () => {
    beforeEach(() => {
      engine.indexModule(makeModule({
        name: 'data-pipeline',
        description: 'streaming pipeline runner for data pipelines',
        author: 'pipeline-owner',
        tags: ['pipeline', 'data'],
      }));
      engine.indexModule(makeModule({
        name: 'http-server',
        description: 'HTTP server framework',
        author: 'bob',
        tags: ['http', 'web'],
      }));
    });

    it('matches a partial word against a longer name', async () => {
      const results = await engine.search('pipe');

      expect(results.modules.map(m => m.name)).toEqual(['data-pipeline']);
      // "pipe" is inside the name rather than at the front of it, so this is
      // the name-contains score, not the name-prefix one
      expect(results.modules[0].score).toBe(25 + 10 + 15);
    });

    it('matches a fragment from the middle of a word', async () => {
      // "peline" is a substring of "pipeline" but not a prefix of it, which is
      // exactly the case a word-prefix index would drop
      const results = await engine.search('peline');

      expect(results.modules.map(m => m.name)).toEqual(['data-pipeline']);
    });

    it('matches a query that spans a token boundary', async () => {
      const results = await engine.search('pipeline runner');

      expect(results.modules.map(m => m.name)).toEqual(['data-pipeline']);
    });

    it('matches a multi-token query that spans two indexed fields', async () => {
      const results = await engine.search('http server');

      expect(results.modules.map(m => m.name)).toEqual(['http-server']);
    });

    it('matches an inner fragment of the description', async () => {
      const results = await engine.search('ming pip');

      expect(results.modules.map(m => m.name)).toEqual(['data-pipeline']);
      expect(results.modules[0].highlights[0]).toContain('ming pip');
    });

    it('matches a single character query', async () => {
      const results = await engine.search('h');

      expect(results.modules.map(m => m.name)).toEqual(['http-server']);
    });

    it('matches a two character query', async () => {
      const results = await engine.search('ht');

      expect(results.modules.map(m => m.name)).toEqual(['http-server']);
    });

    it('keeps the ellipsis behaviour of a highlighted description', async () => {
      engine.indexModule(makeModule({
        name: 'long-description',
        description: `${'x'.repeat(60)}needle${'y'.repeat(60)}`,
        tags: [],
      }));

      const results = await engine.search('needle');

      expect(results.modules[0].highlights).toEqual([
        `...${'x'.repeat(40)}needle${'y'.repeat(40)}...`,
      ]);
    });

    it('returns nothing for a query whose grams are not in the index', async () => {
      const results = await engine.search('zzzz-nonexistent');

      expect(results.total).toBe(0);
      expect(results.modules).toEqual([]);
    });
  });

  describe('search() candidate narrowing', () => {
    beforeEach(() => {
      for (let i = 0; i < 50; i++) {
        engine.indexModule(makeModule({
          name: `corpus-module-${i}`,
          description: `synthetic module number ${i}`,
          author: 'bot',
          tags: ['synthetic'],
        }));
      }
    });

    it('scans only the modules a gram points at', async () => {
      const results = await engine.search('number 42');

      expect(results.modules.map(m => m.name)).toEqual(['corpus-module-42']);
      expect(engine.getLastCandidateCount()).toBeLessThan(50);
    });

    it('scans the whole index when there is no text to narrow with', async () => {
      const results = await engine.search({ text: '', tags: ['synthetic'] });

      expect(results.total).toBe(50);
      expect(engine.getLastCandidateCount()).toBe(50);
    });

    it('stays bounded on a pathological multi-kilobyte query', async () => {
      const started = performance.now();
      const results = await engine.search(`${'q'.repeat(5000)}corpus`);
      const elapsed = performance.now() - started;

      expect(results.total).toBe(0);
      expect(engine.getLastCandidateCount()).toBe(0);
      // narrowing is proven by the candidate count; the clock is only here to
      // catch a regression into something quadratic
      expect(elapsed).toBeLessThan(2_000);
    });
  });

  describe('indexModule() re-indexing', () => {
    it('replaces a module rather than duplicating it', async () => {
      engine.indexModule(makeModule({
        name: 'dup',
        description: 'the first description',
        tags: ['alpha'],
      }));
      engine.indexModule(makeModule({
        name: 'dup',
        description: 'the second description',
        tags: ['beta'],
      }));

      expect(engine.getIndexSize()).toBe(1);

      const results = await engine.search('second');
      expect(results.total).toBe(1);
      expect(results.modules[0].tags).toEqual(['beta']);
    });

    it('withdraws the replaced text from the inverted index', async () => {
      engine.indexModule(makeModule({ name: 'dup', description: 'zebra striping' }));
      engine.indexModule(makeModule({ name: 'dup', description: 'apple pressing' }));

      // 'zebra' has no gram in common with the new blob, so the stale entry
      // cannot still be a candidate
      const stale = await engine.search('zebra');
      expect(stale.total).toBe(0);
      expect(engine.getLastCandidateCount()).toBe(0);
    });

    it('keeps the name prefix index in step with the entry', async () => {
      engine.indexModule(makeModule({ name: 'dup' }));
      expect(engine.getSuggestions('dup')).toEqual(['dup']);

      engine.removeModule('dup');

      expect(engine.getSuggestions('dup')).toEqual([]);
      expect(engine.getIndexSize()).toBe(0);
    });
  });

  describe('removeModule() index hygiene', () => {
    it('stops suggesting and matching a removed module', async () => {
      engine.indexModule(makeModule({ name: 'data-pipeline', description: 'pipe things' }));
      engine.removeModule('data-pipeline');

      expect(engine.getSuggestions('data')).toEqual([]);
      const results = await engine.search('pipe');
      expect(results.total).toBe(0);
    });
  });

  describe('getSuggestions() with an empty prefix', () => {
    it('returns every indexed name, as a prefix scan always has', () => {
      engine.indexModule(makeModule({ name: 'beta' }));
      engine.indexModule(makeModule({ name: 'alpha' }));

      expect(engine.getSuggestions('')).toEqual(['alpha', 'beta']);
    });

    it('still hides archived modules', () => {
      engine.indexModule(makeModule({ name: 'live' }));
      engine.indexModule(makeModule({ name: 'archived', archived: true }));

      expect(engine.getSuggestions('')).toEqual(['live']);
      expect(engine.getSuggestions('', 10, true)).toEqual(['archived', 'live']);
    });
  });

  describe('search() over a large corpus', () => {
    /** A module per index, each with a distinct name, description and author. */
    function makeCorpus(size: number): ModuleRecord[] {
      return Array.from({ length: size }, (_, i) => makeModule({
        name: `scale-${i}`,
        description: `Synthetic module number ${i} for scale testing`,
        author: `author-${i % 17}`,
        tags: ['synthetic', `bucket-${i % 7}`],
        updatedAt: new Date(Date.UTC(2024, 0, 1) + i * 1000).toISOString(),
      }));
    }

    it('finds a single module in 2,000 without walking the corpus', async () => {
      const corpus = makeCorpus(2_000);
      engine.indexModules(corpus);
      expect(engine.getIndexSize()).toBe(2_000);

      const started = performance.now();
      const results = await engine.search('scale-1999');
      const elapsed = performance.now() - started;

      expect(results.total).toBe(1);
      expect(results.modules[0].name).toBe('scale-1999');
      // the point of the inverted index: the corpus is walked, not searched
      expect(engine.getLastCandidateCount()).toBeLessThan(100);
      // the clock only catches a regression into something quadratic
      expect(elapsed).toBeLessThan(2_000);
    });

    it('agrees with the corpus on a query that matches many modules', async () => {
      engine.indexModules(makeCorpus(2_000));

      const results = await engine.search('synthetic');

      expect(results.total).toBe(2_000);
      expect(results.modules).toHaveLength(20);
    });

    it('paginates a large result set consistently', async () => {
      engine.indexModules(makeCorpus(2_000));

      const all = await engine.search({ text: 'scale', sort: 'name', limit: 2_000 });
      const page = await engine.search({ text: 'scale', sort: 'name', limit: 5, offset: 10 });

      expect(all.total).toBe(2_000);
      expect(page.total).toBe(2_000);
      expect(page.modules.map(m => m.name)).toEqual(
        all.modules.slice(10, 15).map(m => m.name),
      );
    });

    it('filters by author across a large corpus', async () => {
      engine.indexModules(makeCorpus(2_000));

      const results = await engine.search({
        text: 'synthetic',
        author: 'author-3',
        limit: 100,
      });

      expect(results.total).toBeGreaterThan(0);
      expect(results.modules.every(m => m.author === 'author-3')).toBe(true);
    });

    it('clears both inverted indexes along with the entries', async () => {
      engine.indexModules(makeCorpus(50));
      engine.clearIndex();

      expect(engine.getIndexSize()).toBe(0);
      expect(engine.getSuggestions('scale')).toEqual([]);
      const results = await engine.search('scale');
      expect(results.total).toBe(0);
    });
  });

  describe('getSuggestions() ranking', () => {
    it('sorts suggestions by name instead of index order', () => {
      engine.indexModule(makeModule({ name: 'a-zebra' }));
      engine.indexModule(makeModule({ name: 'a-mango' }));
      engine.indexModule(makeModule({ name: 'a-apple' }));

      expect(engine.getSuggestions('a-')).toEqual(['a-apple', 'a-mango', 'a-zebra']);
    });

    it('returns the top of the sorted list when over the limit', () => {
      engine.indexModule(makeModule({ name: 'a-zebra' }));
      engine.indexModule(makeModule({ name: 'a-apple' }));

      expect(engine.getSuggestions('a-', 1)).toEqual(['a-apple']);
    });
  });
});
