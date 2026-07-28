import { describe, it, expect, beforeEach } from 'vitest';
import { SearchEngine } from '../src/search.js';
import { ModuleRecord } from '../src/store.js';

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
});
