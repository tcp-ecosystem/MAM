import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseMemoryContent, parseMemoryValue, isCoercible, mergeMemory, deepMerge, diffMemory,
  flattenMemory, unflattenMemory, getPath, setPath, deletePath, splitPath, pickMemory,
  groupByPrefix, filterMemoryByPrefix, namespaceMemory, formatMemory,
} from '../src/parser.js';
import { MemoryStore, MemoryLimitError, MEMORY_FILE_VERSION } from '../src/store.js';
import {
  memoryRule, createMemoryRule, createMemoryRules, configureMemoryRules, resetMemoryRuleConfig,
  runMemoryRules, formatRuleSummary, readMemory, hasMemorySection, MEMORY_RULES,
  duplicateKeysRule, emptyValueRule, keyFormatRule, keyLengthRule, valueLengthRule,
  entryCountRule, reservedPrefixRule, nestingDepthRule, requiredKeysRule,
} from '../src/rule.js';
import {
  memorySection, MEMORY_MANIFEST, getMemorySection, createMemoryManifest, validateMemoryContent,
  findMemorySection, isValidMemoryKey, MEMORY_LIMITS, MEMORY_EXAMPLE, MEMORY_SECTION_NAME,
} from '../src/manifest.js';
import {
  createMemoryHooks, createAfterParseHook, createBeforeExecutionHook, createAfterExecutionHook,
  createMemoryInjector, getModuleId, MemoryHookTracker,
} from '../src/hooks.js';
import memoryPlugin, {
  createMemoryPlugin, createMemoryApi, describeMemoryPlugin, getMemoryStore,
  MEMORY_PLUGIN_VERSION, createMemoryHookTracker,
} from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = [], id?: string): MAMModule {
  const module = {
    type: 'MAMModule',
    frontmatter: id ? { id } : {},
    sections,
    location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } },
  };
  return module as any;
}

function memorySectionNode(value: string, extra: Record<string, unknown> = {}) {
  return { name: 'Memory', content: [{ type: 'Paragraph', value }], ...extra };
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Memory Plugin - Parser', () => {
  it('should parse bold bullet memory entries', () => {
    const content = [{ type: 'Paragraph', value: '**key1**: value1\n**key2**: value2' }];
    const result = parseMemoryContent(content as any);
    expect(result.keys).toEqual(['key1', 'key2']);
    expect(result.flat['key1']).toBe('value1');
    expect(result.flat['key2']).toBe('value2');
  });

  it('should parse simple bullet entries', () => {
    const content = [{ type: 'Paragraph', value: '- name: test\n- version: 1.0' }];
    const result = parseMemoryContent(content as any);
    expect(result.keys).toContain('name');
    expect(result.keys).toContain('version');
  });

  it('should parse JSON code blocks', () => {
    const content = [{ type: 'CodeBlock', language: 'json', value: '{"count": 42, "active": true}' }];
    const result = parseMemoryContent(content as any);
    expect(result.flat['count']).toBe(42);
    expect(result.flat['active']).toBe(true);
  });

  it('should handle empty content', () => {
    const result = parseMemoryContent([]);
    expect(result.keys).toEqual([]);
    expect(result.entries).toEqual([]);
  });

  it('should skip invalid JSON code blocks', () => {
    const content = [{ type: 'CodeBlock', language: 'json', value: 'invalid json' }];
    const result = parseMemoryContent(content as any);
    expect(result.keys).toEqual([]);
  });

  it('should track entry sources', () => {
    const content = [
      { type: 'Paragraph', value: '**key1**: val1' },
      { type: 'CodeBlock', language: 'json', value: '{"key2": "val2"}' },
    ];
    const result = parseMemoryContent(content as any);
    expect(result.entries[0].source).toBe('paragraph');
    expect(result.entries[1].source).toBe('codeblock');
  });

  it('should report line numbers for paragraph entries', () => {
    const result = parseMemoryContent([{ type: 'Paragraph', value: 'first line\n**a**: 1' }] as any);
    expect(result.entries[0].line).toBe(2);
  });

  it('should report malformed JSON in errors', () => {
    const result = parseMemoryContent([{ type: 'CodeBlock', language: 'json', value: '{bad' }] as any);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].source).toBe('codeblock');
  });

  it('should ignore non-JSON code blocks', () => {
    const result = parseMemoryContent([{ type: 'CodeBlock', language: 'python', value: 'x = 1' }] as any);
    expect(result.keys).toEqual([]);
  });

  it('mergeMemory should prioritize incoming over existing', () => {
    const existing = { a: 1, b: 2 };
    const incoming = { b: 3, c: 4 };
    const merged = mergeMemory(existing, incoming);
    expect(merged).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('filterMemoryByPrefix should filter keys', () => {
    const data = { 'db.host': 'localhost', 'db.port': 5432, 'app.name': 'test' };
    const filtered = filterMemoryByPrefix(data, 'db.');
    expect(filtered).toEqual({ host: 'localhost', port: 5432 });
  });

  describe('type coercion', () => {
    it('should leave values as strings by default', () => {
      expect(parseMemoryValue('42')).toBe('42');
      expect(parseMemoryValue('true')).toBe('true');
    });

    it('should convert numbers, booleans and null when enabled', () => {
      expect(parseMemoryValue('42', true)).toBe(42);
      expect(parseMemoryValue('-1.5', true)).toBe(-1.5);
      expect(parseMemoryValue('true', true)).toBe(true);
      expect(parseMemoryValue('false', true)).toBe(false);
      expect(parseMemoryValue('null', true)).toBeNull();
    });

    it('should keep padded numbers and versions as strings', () => {
      expect(parseMemoryValue('007', true)).toBe('007');
      expect(parseMemoryValue('1.0.0', true)).toBe('1.0.0');
      expect(parseMemoryValue('yes', true)).toBe('yes');
    });

    it('should pass non-strings through unchanged', () => {
      expect(parseMemoryValue(7, true)).toBe(7);
      expect(parseMemoryValue(null, true)).toBeNull();
    });

    it('isCoercible should detect convertible values', () => {
      expect(isCoercible('42')).toBe(true);
      expect(isCoercible('1.0.0')).toBe(false);
    });

    it('should apply coercion through parseMemoryContent', () => {
      const result = parseMemoryContent([{ type: 'Paragraph', value: '- port: 5432' }] as any, { coerce: true });
      expect(result.flat.port).toBe(5432);
    });
  });

  describe('nested paths', () => {
  it('splitPath should reject empty and unsafe segments', () => {
    expect(splitPath('a.b.c')).toEqual(['a', 'b', 'c']);
    expect(splitPath('a.__proto__.b')).toEqual([]);
    expect(splitPath('a..b')).toEqual([]);
  });


    it('getPath should read nested values', () => {
      expect(getPath({ a: { b: { c: 1 } } }, 'a.b.c')).toBe(1);
      expect(getPath({}, 'a.b')).toBeUndefined();
      expect(getPath({ a: 1 }, 'a.b')).toBeUndefined();
    });

    it('setPath should create intermediate objects', () => {
      const data: Record<string, unknown> = {};
      expect(setPath(data, 'a.b.c', 1)).toBe(true);
      expect(data).toEqual({ a: { b: { c: 1 } } });
    });

    it('setPath should refuse unsafe paths', () => {
      const data: Record<string, unknown> = {};
      expect(setPath(data, '__proto__.polluted', true)).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('deletePath should remove nested keys', () => {
      const data = { a: { b: 1, c: 2 } };
      expect(deletePath(data, 'a.b')).toBe(true);
      expect(data.a).toEqual({ c: 2 });
      expect(deletePath(data, 'a.zzz')).toBe(false);
    });

    it('flattenMemory should flatten objects and keep arrays as leaves', () => {
      const flat = flattenMemory({ db: { host: 'x', port: 1 }, list: [1, 2] });
      expect(flat).toEqual({ 'db.host': 'x', 'db.port': 1, list: [1, 2] });
    });

    it('flattenMemory should honour maxDepth', () => {
      const flat = flattenMemory({ a: { b: { c: 1 } } }, { maxDepth: 1 });
      expect(flat).toEqual({ a: { b: { c: 1 } } });
    });

    it('unflattenMemory should be the inverse of flattenMemory', () => {
      const original = { db: { host: 'x' } };
      expect(unflattenMemory(flattenMemory(original))).toEqual(original);
    });

    it('should flatten nested JSON in a code block', () => {
      const result = parseMemoryContent([
        { type: 'CodeBlock', language: 'json', value: '{"db":{"host":"x"}}' },
      ] as any);
      expect(result.flat['db.host']).toBe('x');
    });

    it('should keep nested JSON whole when flatten is off', () => {
      const result = parseMemoryContent([
        { type: 'CodeBlock', language: 'json', value: '{"db":{"host":"x"}}' },
      ] as any, { flatten: false });
      expect(result.flat.db).toEqual({ host: 'x' });
    });
  });

  describe('parse options', () => {
    it('should apply a key prefix', () => {
      const result = parseMemoryContent([{ type: 'Paragraph', value: '**a**: 1' }] as any, { prefix: 'run.' });
      expect(result.keys).toEqual(['run.a']);
    });

    it('should ignore bare key:value prose by default', () => {
      const result = parseMemoryContent([{ type: 'Paragraph', value: 'Note: this is prose' }] as any);
      expect(result.keys).toEqual([]);
    });

    it('should read bare pairs when enabled', () => {
      const result = parseMemoryContent([{ type: 'Paragraph', value: 'Note: real value' }] as any, {
        includeBarePairs: true,
      });
      expect(result.flat.Note).toBe('real value');
    });

    it('should cap entries and report the overflow', () => {
      const value = Array.from({ length: 5 }, (_, i) => `- k${i}: v`).join('\n');
      const result = parseMemoryContent([{ type: 'Paragraph', value }] as any, { maxEntries: 2 });
      expect(result.keys).toHaveLength(2);
      expect(result.truncated).toBe(3);
    });

    it('should report a conflict when a key is defined twice', () => {
      const result = parseMemoryContent([
        { type: 'Paragraph', value: '**k**: first' },
        { type: 'CodeBlock', language: 'json', value: '{"k":"second"}' },
      ] as any);
      expect(result.flat.k).toBe('first');
      expect(result.conflicts).toEqual([{ key: 'k', kept: 'paragraph', shadowed: 'codeblock' }]);
    });

    it('should skip unsafe JSON keys', () => {
      const result = parseMemoryContent([
        { type: 'CodeBlock', language: 'json', value: '{"__proto__":{"bad":1},"good":2}' },
      ] as any);
      expect(result.flat.good).toBe(2);
      expect(result.errors.some((e) => e.message.includes('unsafe'))).toBe(true);
    });

    it('should ignore a non-object top-level JSON value', () => {
      const result = parseMemoryContent([{ type: 'CodeBlock', language: 'json', value: '[1,2]' }] as any);
      expect(result.keys).toEqual([]);
      expect(result.errors[0].message).toMatch(/must be an object/);
    });
  });

  describe('record helpers', () => {
    it('deepMerge should merge nested objects', () => {
      expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
    });

    it('deepMerge should replace arrays rather than merge them', () => {
      expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    });

    it('diffMemory should classify every key', () => {
      const diff = diffMemory({ a: 1, gone: 2 }, { a: 1, b: 3 });
      expect(diff.added).toEqual(['b']);
      expect(diff.removed).toEqual(['gone']);
      expect(diff.unchanged).toEqual(['a']);
      expect(diff.changed).toEqual([]);
    });

    it('diffMemory should detect changed values', () => {
      expect(diffMemory({ a: 1 }, { a: 2 }).changed).toEqual(['a']);
    });

    it('pickMemory should keep only known keys', () => {
      expect(pickMemory({ a: 1, b: 2 }, ['a', 'z'])).toEqual({ a: 1 });
    });

    it('groupByPrefix should group by leading segment', () => {
      expect(groupByPrefix({ 'db.host': 1, top: 2 })).toEqual({ db: { host: 1 }, _root: { top: 2 } });
    });

    it('namespaceMemory should be the inverse of filterMemoryByPrefix', () => {
      const data = { host: 'x', port: 1 };
      expect(namespaceMemory(data, 'db.')).toEqual({ 'db.host': 'x', 'db.port': 1 });
    });

    it('formatMemory should render strings as bullets', () => {
      expect(formatMemory({ status: 'active' }, { bullets: true })).toBe('- status: active');
    });

    it('formatMemory should put non-strings in a JSON block', () => {
      const text = formatMemory({ port: 5432 }, { bullets: true, includeJsonBlock: true });
      expect(text).toContain('```json');
      expect(text).toContain('5432');
    });

    it('formatMemory should round-trip through the parser', () => {
      const original = { status: 'active', port: 5432, nested: { flag: true } };
      const text = formatMemory(original, { bullets: true, includeJsonBlock: true });
      const parsed = parseMemoryContent(
        [
          { type: 'Paragraph', value: text.split('```json')[0].trim() },
          { type: 'CodeBlock', language: 'json', value: text.split('```json')[1].replace('```', '').trim() },
        ] as any,
        { flatten: true },
      );
      expect(parsed.flat.status).toBe('active');
      expect(parsed.flat.port).toBe(5432);
      expect(parsed.flat['nested.flag']).toBe(true);
    });
  });
});

describe('Memory Plugin - Store', () => {
  let store: MemoryStore;
  let dir: string;

  beforeAll(async () => {
    dir = await makeTempDir('mam-store-');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    store = new MemoryStore(dir);
  });

  it('should set and get values', () => {
    store.set('mod1', 'key1', 'value1');
    expect(store.get('mod1', 'key1')).toBe('value1');
  });

  it('should return undefined for missing keys', () => {
    expect(store.get('mod1', 'missing')).toBeUndefined();
  });

  it('should check existence', () => {
    store.set('mod1', 'key1', 'value1');
    expect(store.has('mod1', 'key1')).toBe(true);
    expect(store.has('mod1', 'key2')).toBe(false);
  });

  it('should delete keys', () => {
    store.set('mod1', 'key1', 'value1');
    expect(store.delete('mod1', 'key1')).toBe(true);
    expect(store.get('mod1', 'key1')).toBeUndefined();
  });

  it('should list keys for a module', () => {
    store.set('mod1', 'a', 1);
    store.set('mod1', 'b', 2);
    store.set('mod2', 'c', 3);
    expect(store.keys('mod1').sort()).toEqual(['a', 'b']);
  });

  it('should return entries for a module', () => {
    store.set('mod1', 'x', 10);
    expect(store.entries('mod1')).toEqual({ x: 10 });
  });

  it('should clear all or by module', () => {
    store.set('mod1', 'a', 1);
    store.set('mod2', 'b', 2);
    store.clear('mod1');
    expect(store.get('mod1', 'a')).toBeUndefined();
    expect(store.get('mod2', 'b')).toBe(2);
  });

  it('should report size', () => {
    store.set('mod1', 'a', 1);
    store.set('mod1', 'b', 2);
    expect(store.size('mod1')).toBe(2);
    expect(store.size()).toBe(2);
  });

  it('clear() with no args clears everything', () => {
    store.set('mod1', 'a', 1);
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('should not leak keys between modules whose ids share a prefix', () => {
    store.set('a', 'k', 1);
    store.set('a:b', 'k', 2);
    expect(store.keys('a')).toEqual(['k']);
    expect(store.entries('a')).toEqual({ k: 1 });
    expect(store.keys('a:b')).toEqual(['k']);
  });

  it('getOrDefault should seed and return the default once', () => {
    expect(store.getOrDefault('m', 'k', 'default')).toBe('default');
    store.set('m', 'k', 'real');
    expect(store.getOrDefault('m', 'k', 'default')).toBe('real');
  });

  it('setIfAbsent should not overwrite an existing key', () => {
    expect(store.setIfAbsent('m', 'k', 'first')).toBe(true);
    expect(store.setIfAbsent('m', 'k', 'second')).toBe(false);
    expect(store.get('m', 'k')).toBe('first');
  });

  it('update should replace a value functionally', () => {
    store.set('m', 'k', 1);
    expect(store.update('m', 'k', (n) => (n as number) + 1)).toBe(2);
    expect(store.get('m', 'k')).toBe(2);
  });

  it('update should delete the key when the updater returns undefined', () => {
    store.set('m', 'k', 1);
    store.update('m', 'k', () => undefined);
    expect(store.has('m', 'k')).toBe(false);
  });

  it('findKeysByPrefix should filter within a module', () => {
    store.set('m', 'db.host', 1);
    store.set('m', 'db.port', 2);
    store.set('m', 'app', 3);
    expect(store.findKeysByPrefix('m', 'db.')).toEqual(['db.host', 'db.port']);
  });

  it('listModules should return non-empty modules sorted', () => {
    store.set('zeta', 'a', 1);
    store.set('alpha', 'b', 1);
    store.set('gone', 'c', 1);
    store.delete('gone', 'c');
    expect(store.listModules()).toEqual(['alpha', 'zeta']);
  });

  it('getMany should omit absent keys', () => {
    store.set('m', 'a', 1);
    expect(store.getMany('m', ['a', 'b'])).toEqual({ a: 1 });
  });

  it('setMany should emit a single change event', () => {
    const changes: string[][] = [];
    store.onChange((c) => changes.push(c.keys));
    store.setMany('m', { a: 1, b: 2, c: 3 });
    expect(changes).toEqual([['a', 'b', 'c']]);
  });

  it('deleteMany should report which keys were removed', () => {
    store.setMany('m', { a: 1, b: 2 });
    expect(store.deleteMany('m', ['a', 'zz'])).toEqual(['a']);
    expect(store.has('m', 'a')).toBe(false);
  });

  it('deleteModule and renameModule should manage whole modules', () => {
    store.set('m', 'a', 1);
    expect(store.renameModule('m', 'm2')).toBe(true);
    expect(store.get('m2', 'a')).toBe(1);
    expect(store.deleteModule('m2')).toBe(true);
    expect(store.deleteModule('m2')).toBe(false);
  });

  it('should notify listeners on set, delete and clear', () => {
    const seen: string[] = [];
    store.onChange((c) => seen.push(c.type));
    store.set('m', 'a', 1);
    store.delete('m', 'a');
    store.set('m', 'b', 1);
    store.clear('m');
    expect(seen).toEqual(['set', 'delete', 'set', 'clear']);
  });

  it('should stop notifying after unsubscribe', () => {
    const seen: string[] = [];
    const off = store.onChange((c) => seen.push(c.type));
    store.set('m', 'a', 1);
    off();
    store.set('m', 'b', 1);
    expect(seen).toEqual(['set']);
  });

  it('should survive a listener that throws', () => {
    store.onChange(() => { throw new Error('bad listener'); });
    expect(() => store.set('m', 'a', 1)).not.toThrow();
    expect(store.get('m', 'a')).toBe(1);
  });

  it('should expire keys after their ttl', async () => {
    store.set('m', 'a', 1, { ttlMs: 20 });
    expect(store.has('m', 'a')).toBe(true);
    await sleep(40);
    expect(store.has('m', 'a')).toBe(false);
    expect(store.get('m', 'a')).toBeUndefined();
  });

  it('should apply a default ttl to every write', async () => {
    const ttlStore = new MemoryStore({ memoryDir: dir, defaultTtlMs: 20 });
    ttlStore.set('m', 'a', 1);
    await sleep(40);
    expect(ttlStore.has('m', 'a')).toBe(false);
  });

  it('getExpiry and getTimeToLive should describe the ttl', async () => {
    store.set('m', 'a', 1, { ttlMs: 1000 });
    expect(store.getExpiry('m', 'a')).toBeGreaterThan(Date.now());
    expect(store.getTimeToLive('m', 'a')).toBeGreaterThan(0);
    store.set('m', 'forever', 1);
    expect(store.getExpiry('m', 'forever')).toBeUndefined();
    expect(store.getTimeToLive('m', 'forever')).toBeUndefined();
  });

  it('purgeExpired should remove and report expired keys', async () => {
    store.set('m', 'a', 1, { ttlMs: 10 });
    store.set('m', 'b', 2);
    await sleep(30);
    expect(store.purgeExpired()).toEqual(['m:a']);
    expect(store.keys('m')).toEqual(['b']);
  });

  it('should reject writes past the key limit', () => {
    const limited = new MemoryStore({ memoryDir: dir, maxKeys: 1 });
    limited.set('m', 'a', 1);
    expect(() => limited.set('m', 'b', 2)).toThrow(MemoryLimitError);
  });

  it('should reject keys past the length limit', () => {
    const limited = new MemoryStore({ memoryDir: dir, maxKeyLength: 4 });
    expect(() => limited.set('m', 'toolong', 1)).toThrow(/too long/);
  });

  it('should report hit and miss statistics', () => {
    store.set('m', 'a', 1);
    store.get('m', 'a');
    store.get('m', 'missing');
    const stats = store.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.keys).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  it('resetStats should clear counters but keep data', () => {
    store.set('m', 'a', 1);
    store.get('m', 'a');
    store.resetStats();
    expect(store.getStats().hits).toBe(0);
    expect(store.has('m', 'a')).toBe(true);
  });

  it('exportAll and importAll should round-trip', () => {
    store.set('a', 'x', 1);
    store.set('b', 'y', 2);
    const snapshot = store.exportAll();
    store.clear();
    expect(store.size()).toBe(0);
    store.importAll(snapshot);
    expect(store.get('a', 'x')).toBe(1);
    expect(store.get('b', 'y')).toBe(2);
  });

  it('getMemoryDir should report the persistence directory', () => {
    expect(store.getMemoryDir()).toBe(dir);
  });
});

describe('Memory Plugin - Store persistence', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeTempDir('mam-persist-');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should write and read a module file', async () => {
    const store = new MemoryStore(dir);
    await store.saveFile('m1', { a: 1 });
    expect(await store.loadFile('m1')).toEqual({ a: 1 });
  });

  it('should return an empty record for a missing file', async () => {
    const store = new MemoryStore(dir);
    expect(await store.loadFile('nope')).toEqual({});
  });

  it('should write a versioned envelope', async () => {
    const store = new MemoryStore(dir);
    await store.saveFile('m2', { a: 1 });
    const raw = JSON.parse(await readFile(join(dir, 'm2.json'), 'utf-8'));
    expect(raw.version).toBe(MEMORY_FILE_VERSION);
    expect(raw.data).toEqual({ a: 1 });
    expect(typeof raw.updatedAt).toBe('string');
  });

  it('should read a legacy bare-object file', async () => {
    const legacy = await makeTempDir('mam-legacy-');
    try {
      await writeFile(join(legacy, 'old.json'), JSON.stringify({ legacyKey: 'kept' }));
      const store = new MemoryStore(legacy);
      expect(await store.loadFile('old')).toEqual({ legacyKey: 'kept' });
    } finally {
      await rm(legacy, { recursive: true, force: true });
    }
  });

  it('should leave no temp file behind after a successful write', async () => {
    const store = new MemoryStore(dir);
    await store.saveFile('m3', { a: 1 });
    const files = await readdir(dir);
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('should report failure and clean up when the directory is unusable', async () => {
    const broken = join(dir, 'not-a-dir');
    await writeFile(broken, 'file in the way');
    const errors: string[] = [];
    const store = new MemoryStore({ memoryDir: broken, onError: (e) => errors.push(e.message) });

    expect(await store.saveFile('m', { a: 1 })).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    const leftovers = (await readdir(dir)).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('should stay silent when no error handler is registered', async () => {
    const broken = join(dir, 'also-not-a-dir');
    await writeFile(broken, 'x');
    const store = new MemoryStore(broken);
    expect(await store.saveFile('m', { a: 1 })).toBe(false);
    expect(await store.loadFile('m')).toEqual({});
  });

  it('syncFromFile should let the file win over memory', async () => {
    const store = new MemoryStore(dir);
    store.set('m5', 'status', 'in-memory');
    await store.saveFile('m5', { status: 'on-disk' });
    await store.syncFromFile('m5');
    expect(store.get('m5', 'status')).toBe('on-disk');
  });

  it('persistToFile should write the current entries', async () => {
    const store = new MemoryStore(dir);
    store.set('m6', 'a', 1);
    await store.persistToFile('m6');
    expect(await store.loadFile('m6')).toEqual({ a: 1 });
  });

  it('persistAll should write every module', async () => {
    const store = new MemoryStore(dir);
    store.set('p1', 'a', 1);
    store.set('p2', 'b', 2);
    expect((await store.persistAll()).sort()).toEqual(['p1', 'p2']);
  });

  it('deleteFile should remove the file but keep memory', async () => {
    const store = new MemoryStore(dir);
    store.set('m7', 'a', 1);
    await store.persistToFile('m7');
    expect(await store.deleteFile('m7')).toBe(true);
    expect(await store.loadFile('m7')).toEqual({});
    expect(store.get('m7', 'a')).toBe(1);
  });

  it('should create the directory on demand', async () => {
    const nested = join(dir, 'a', 'b', 'c');
    const store = new MemoryStore(nested);
    await store.saveFile('deep', { a: 1 });
    expect(await store.loadFile('deep')).toEqual({ a: 1 });
  });
});

describe('Memory Plugin - Rule', () => {
  afterEach(() => {
    resetMemoryRuleConfig();
  });

  it('should report when no Memory section exists', () => {
    const mod = makeModule([]);
    const results = memoryRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it('should report empty memory', () => {
    const mod = makeModule([{ name: 'Memory', content: [] }]);
    const results = memoryRule.check(mod);
    expect(results.some((r) => r.message?.includes('empty'))).toBe(true);
  });

  it('should report valid memory entries', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'Paragraph', value: '**status**: active' }],
    }]);
    const results = memoryRule.check(mod);
    expect(results.some((r) => r.valid === true && r.message?.includes('valid entries'))).toBe(true);
  });

  it('should report duplicate keys', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [
        { type: 'Paragraph', value: '**k**: 1' },
        { type: 'CodeBlock', language: 'json', value: '{"k":2}' },
      ],
    }]);
    expect(memoryRule.check(mod).some((r) => !r.valid && r.message?.includes('Duplicate'))).toBe(true);
  });

  it('should report empty values', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"blank":""}' }],
    }]);
    const results = memoryRule.check(mod);
    expect(results.some((r) => !r.valid && r.message?.includes('Empty value'))).toBe(true);
  });

  it('createMemoryRule should override the severity', () => {
    expect(createMemoryRule('error').severity).toBe('error');
    expect(createMemoryRule().severity).toBe('info');
  });

  it('createMemoryRule should accept an options object', () => {
    const rule = createMemoryRule({ severity: 'warning' });
    expect(rule.severity).toBe('warning');
  });

  it('readMemory and hasMemorySection should inspect a module', () => {
    const mod = makeModule([{ name: 'Memory', content: [{ type: 'Paragraph', value: '**a**: 1' }] }]);
    expect(readMemory(mod)?.keys).toEqual(['a']);
    expect(hasMemorySection(mod)).toBe(true);
    expect(readMemory(makeModule([]))).toBeUndefined();
  });

  it('duplicateKeysRule should report conflicts', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [
        { type: 'Paragraph', value: '**k**: 1' },
        { type: 'Paragraph', value: '**k**: 2' },
      ],
    }]);
    const results = duplicateKeysRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('k');
  });

  it('emptyValueRule should report null and empty values', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"a":null,"b":"","c":1}' }],
    }]);
    const results = emptyValueRule.check(mod);
    expect(results.map((r) => r.path).sort()).toEqual(['a', 'b']);
  });

  it('keyFormatRule should reject keys outside the charset', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"good":1,"bad key":2}' }],
    }]);
    expect(keyFormatRule.check(mod)).toHaveLength(1);
  });

  it('keyFormatRule should accept dotted paths', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"db.host":"x"}' }],
    }]);
    expect(keyFormatRule.check(mod)).toEqual([]);
  });

  it('keyLengthRule should respect the configured limit', () => {
    const long = 'x'.repeat(40);
    const mod = makeModule([{ name: 'Memory', content: [{ type: 'CodeBlock', language: 'json', value: JSON.stringify({ [long]: 1 }) }] }]);
    expect(keyLengthRule.check(mod)).toEqual([]);

    configureMemoryRules({ maxKeyLength: 10 });
    expect(keyLengthRule.check(mod)).toHaveLength(1);
  });

  it('valueLengthRule should flag long strings', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'Paragraph', value: `- note: ${'y'.repeat(50)}` }],
    }]);
    expect(valueLengthRule.check(mod)).toEqual([]);
    configureMemoryRules({ maxValueLength: 10 });
    expect(valueLengthRule.check(mod)).toHaveLength(1);
  });

  it('entryCountRule should flag oversized sections and truncation', () => {
    const many = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [`k${i}`, i]),
    );
    const mod = makeModule([{ name: 'Memory', content: [{ type: 'CodeBlock', language: 'json', value: JSON.stringify(many) }] }]);
    expect(entryCountRule.check(mod)).toEqual([]);
    configureMemoryRules({ maxEntries: 2 });
    expect(entryCountRule.check(mod)).toHaveLength(1);
  });

  it('reservedPrefixRule should reject double-underscore keys', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"__internal":1}' }],
    }]);
    expect(reservedPrefixRule.check(mod)).toHaveLength(1);
  });

  it('nestingDepthRule should flag deep paths', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"a.b.c.d.e.f":1}' }],
    }]);
    configureMemoryRules({ maxDepth: 2 });
    expect(nestingDepthRule.check(mod)).toHaveLength(1);
  });

  it('requiredKeysRule should report missing keys', () => {
    const mod = makeModule([{ name: 'Memory', content: [{ type: 'Paragraph', value: '**a**: 1' }] }]);
    configureMemoryRules({ requiredKeys: ['a', 'b'] });
    const results = requiredKeysRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].path).toBe('b');
  });

  it('rules should return nothing for a module without a Memory section', () => {
    for (const rule of MEMORY_RULES) {
      expect(rule.check(makeModule([]))).toEqual([]);
    }
  });

  it('MEMORY_RULES should contain the full family', () => {
    expect(MEMORY_RULES).toHaveLength(9);
    expect(new Set(MEMORY_RULES.map((r) => r.name)).size).toBe(MEMORY_RULES.length);
  });

  it('createMemoryRules should re-level every rule', () => {
    expect(createMemoryRules('warning').every((r) => r.severity === 'warning')).toBe(true);
    expect(createMemoryRules().every((r) => r.severity !== undefined)).toBe(true);
  });

  it('runMemoryRules should run the family and flatten results', () => {
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'CodeBlock', language: 'json', value: '{"__bad":1,"ok":2}' }],
    }]);
    const results = runMemoryRules(mod);
    expect(results.some((r) => r.rule === 'memory-reserved-prefix')).toBe(true);
  });

  it('runMemoryRules should contain a rule that throws', () => {
    const exploding = {
      name: 'boom',
      description: '',
      severity: 'error' as const,
      check: () => { throw new Error('kaboom'); },
    };
    const results = runMemoryRules(makeModule([]), [exploding]);
    expect(results[0].message).toMatch(/kaboom/);
  });

  it('formatRuleSummary should count errors and warnings', () => {
    expect(formatRuleSummary([{ valid: true, message: 'a' }])).toBe('no problems');
    expect(formatRuleSummary([{ valid: false, message: 'a' }])).toBe('1 error');
    expect(formatRuleSummary([
      { valid: false, message: 'a' },
      { valid: false, message: 'b' },
      { valid: true, message: 'c', severity: 'warning' },
    ])).toBe('2 errors, 1 warning');
  });
});

describe('Memory Plugin - Manifest', () => {
  it('should have correct manifest', () => {
    expect(MEMORY_MANIFEST.name).toBe('@mam/plugin-memory');
    expect(MEMORY_MANIFEST.keywords).toContain('memory');
  });

  it('getMemorySection should return a copy', () => {
    const s1 = getMemorySection();
    const s2 = getMemorySection();
    expect(s1).not.toBe(s2);
    expect(s1.name).toBe('Memory');
  });

  it('memorySection validator should reject invalid JSON', () => {
    const results = memorySection.validator!([
      { type: 'CodeBlock', language: 'json', value: '{invalid}' },
    ] as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('memorySection validator should accept valid JSON', () => {
    const results = memorySection.validator!([
      { type: 'CodeBlock', language: 'json', value: '{"a": 1}' },
    ] as any);
    expect(results.every((r) => r.valid)).toBe(true);
  });

  it('should require a MAM version the host can satisfy', () => {
    expect(MEMORY_MANIFEST.mamVersion).toBe('>=0.1.0');
  });

  it('should point main at a file the package actually ships', () => {
    expect(MEMORY_MANIFEST.main).toBe('./dist/index.js');
    expect(MEMORY_MANIFEST.version).toBe('0.1.0');
  });

  it('should export the section name and limits', () => {
    expect(MEMORY_SECTION_NAME).toBe('Memory');
    expect(MEMORY_LIMITS.maxEntries).toBeGreaterThan(0);
    expect(MEMORY_EXAMPLE).toContain('status');
  });

  it('isValidMemoryKey should enforce the charset and reserved prefix', () => {
    expect(isValidMemoryKey('status')).toBe(true);
    expect(isValidMemoryKey('db.host')).toBe(true);
    expect(isValidMemoryKey('bad key')).toBe(false);
    expect(isValidMemoryKey('__reserved')).toBe(false);
    expect(isValidMemoryKey('1leading')).toBe(false);
  });

  it('findMemorySection should locate the section', () => {
    const mod = makeModule([{ name: 'Other' }, memorySectionNode('**a**: 1')]);
    expect(findMemorySection(mod)?.name).toBe('Memory');
  });

  it('createMemoryManifest should override without mutating the original', () => {
    const custom = createMemoryManifest({ version: '2.0.0', keywords: ['custom'] });
    expect(custom.version).toBe('2.0.0');
    expect(custom.keywords).toEqual(['custom']);
    expect(MEMORY_MANIFEST.version).toBe('0.1.0');
    expect(MEMORY_MANIFEST.keywords).toContain('memory');
  });

  it('validateMemoryContent should reject reserved keys', () => {
    const results = validateMemoryContent([
      { type: 'CodeBlock', language: 'json', value: '{"__x":1}' },
    ] as any);
    expect(results.some((r) => r.rule === 'memory-reserved-prefix' && !r.valid)).toBe(true);
  });

  it('validateMemoryContent should reject duplicate keys', () => {
    const results = validateMemoryContent([
      { type: 'Paragraph', value: '**k**: 1' },
      { type: 'Paragraph', value: '**k**: 2' },
    ] as any);
    expect(results.some((r) => r.rule === 'memory-duplicate-keys')).toBe(true);
  });

  it('validateMemoryContent should warn past the limits', () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, i]));
    const results = validateMemoryContent(
      [{ type: 'CodeBlock', language: 'json', value: JSON.stringify(many) }] as any,
      { maxEntries: 2 },
    );
    expect(results.some((r) => r.rule === 'memory-entry-count' && r.valid)).toBe(true);
  });

  it('getMemorySection should apply overridden limits', () => {
    const section = getMemorySection({ maxEntries: 1 });
    const many = Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`k${i}`, i]));
    const results = section.validator!([
      { type: 'CodeBlock', language: 'json', value: JSON.stringify(many) },
    ] as any);
    expect(results.some((r) => r.rule === 'memory-entry-count')).toBe(true);
  });

  it('validateMemoryContent should skip non-JSON code blocks', () => {
    expect(validateMemoryContent([{ type: 'CodeBlock', language: 'js', value: 'oops' }] as any)).toEqual([]);
  });
});

describe('Memory Plugin - Hooks', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeTempDir('mam-hooks-');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('createAfterParseHook should persist memory', async () => {
    const store = new MemoryStore(join(dir, 'a'));
    const hook = createAfterParseHook(store);
    const mod = makeModule([memorySectionNode('**status**: active')], 'test-module');
    await hook(mod);
    expect(store.get('test-module', 'status')).toBe('active');
  });

  it('createBeforeExecutionHook should sync from file', async () => {
    const store = new MemoryStore(join(dir, 'b'));
    const hook = createBeforeExecutionHook(store);
    const mod = makeModule([], 'test-module');
    await expect(hook(mod)).resolves.toBeDefined();
  });

  it('createMemoryHooks returns both hooks', () => {
    const store = new MemoryStore(dir);
    const hooks = createMemoryHooks(store);
    expect(typeof hooks.afterParse).toBe('function');
    expect(typeof hooks.beforeExecution).toBe('function');
  });

  it('should skip modules with no Memory section', async () => {
    const store = new MemoryStore(join(dir, 'c'));
    const hook = createAfterParseHook(store);
    const mod = makeModule([{ name: 'Other', content: [] }], 'm');
    await hook(mod);
    expect(store.size()).toBe(0);
  });

  it('should merge new keys without dropping persisted ones', async () => {
    const store = new MemoryStore(join(dir, 'd'));
    await store.saveFile('m', { existing: 'kept' });
    const hook = createAfterParseHook(store);
    await hook(makeModule([memorySectionNode('**added**: new')], 'm'));
    expect(store.get('m', 'existing')).toBe('kept');
    expect(store.get('m', 'added')).toBe('new');
  });

  it('should not rewrite the file when nothing changed', async () => {
    const store = new MemoryStore(join(dir, 'e'));
    const hook = createAfterParseHook(store);
    const mod = makeModule([memorySectionNode('**status**: active')], 'm');
    await hook(mod);
    const first = (await store.loadFile('m'));
    await hook(mod);
    expect(await store.loadFile('m')).toEqual(first);
  });

  it('should expose the diff of the last write', async () => {
    const store = new MemoryStore(join(dir, 'f'));
    const hook = createAfterParseHook(store);
    await hook(makeModule([memorySectionNode('**a**: 1')], 'm'));
    expect(hook.lastDiff?.added).toEqual(['a']);
    await hook(makeModule([memorySectionNode('**a**: 2')], 'm'));
    expect(hook.lastDiff?.changed).toEqual(['a']);
  });

  it('should always write when diffWrites is off', async () => {
    const store = new MemoryStore(join(dir, 'g'));
    const hook = createAfterParseHook(store, { diffWrites: false });
    const mod = makeModule([memorySectionNode('**status**: active')], 'm');
    await hook(mod);
    await hook(mod);
    expect(hook.lastDiff).toBeDefined();
  });

  it('should read a custom module id field', async () => {
    const store = new MemoryStore(join(dir, 'h'));
    const hook = createAfterParseHook(store, { moduleIdField: 'slug' });
    const mod = makeModule([memorySectionNode('**a**: 1')], undefined);
    (mod.frontmatter as any).slug = 'by-slug';
    await hook(mod);
    expect(store.get('by-slug', 'a')).toBe('1');
  });

  it('should fall back to "unknown" without an id', async () => {
    const store = new MemoryStore(join(dir, 'i'));
    const hook = createAfterParseHook(store);
    await hook(makeModule([memorySectionNode('**a**: 1')]));
    expect(store.get('unknown', 'a')).toBe('1');
  });

  it('getModuleId should read the frontmatter id', () => {
    expect(getModuleId(makeModule([], 'x'))).toBe('x');
    expect(getModuleId(makeModule([]))).toBe('unknown');
  });

  it('should swallow a persistence failure and report it', async () => {
    const broken = join(dir, 'blocked');
    await mkdir(broken, { recursive: true });
    const asFile = join(broken, 'inner');
    await writeFile(asFile, 'x');

    const errors: string[] = [];
    const store = new MemoryStore({ memoryDir: asFile, onError: (e) => errors.push(e.message) });
    const hook = createAfterParseHook(store, { onError: (e) => errors.push(e.message) });
    const mod = makeModule([memorySectionNode('**a**: 1')], 'm');

    await expect(hook(mod)).resolves.toBe(mod);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should swallow a failure even with no handler', async () => {
    const asFile = join(dir, 'plain-file');
    await writeFile(asFile, 'x');
    const store = new MemoryStore(asFile);
    const hook = createAfterParseHook(store);
    const mod = makeModule([memorySectionNode('**a**: 1')], 'm');
    await expect(hook(mod)).resolves.toBe(mod);
  });

  it('should track hook activity', async () => {
    const store = new MemoryStore(join(dir, 'j'));
    const tracker = new MemoryHookTracker();
    const afterParse = createAfterParseHook(store, { tracker });
    const beforeExecution = createBeforeExecutionHook(store, { tracker });

    await afterParse(makeModule([memorySectionNode('**a**: 1')], 'm'));
    await beforeExecution(makeModule([], 'm'));

    const stats = tracker.getStats();
    expect(stats.parses).toBe(1);
    expect(stats.writes).toBe(1);
    expect(stats.syncs).toBe(1);
    expect(stats.lastWriteAt).toBeInstanceOf(Date);
    tracker.reset();
    expect(tracker.getStats().parses).toBe(0);
  });

  it('createAfterExecutionHook should flush a result memory record', async () => {
    const store = new MemoryStore(join(dir, 'k'));
    const hook = createAfterExecutionHook(store, { moduleId: 'm' });
    const result = await hook({ success: true, timeMs: 1, memory: { computed: 42 } });
    expect(result.memory).toEqual({ computed: 42 });
    expect(await store.loadFile('m')).toEqual({ computed: 42 });
  });

  it('createAfterExecutionHook should be a no-op without a module id', async () => {
    const store = new MemoryStore(join(dir, 'l'));
    const hook = createAfterExecutionHook(store);
    const result = { success: true, timeMs: 0, memory: { x: 1 } };
    expect(await hook(result)).toBe(result);
    expect(store.size()).toBe(0);
  });

  it('createMemoryInjector should rewrite the section', async () => {
    const store = new MemoryStore(join(dir, 'm'));
    store.set('mod', 'status', 'active');
    store.set('mod', 'port', 5432);
    const inject = createMemoryInjector(store, { rewrite: true });

    const mod = makeModule([memorySectionNode('**old**: value')], 'mod');
    await inject(mod);
    const text = (findMemorySection(mod)! as any).content[0].value;
    expect(text).toContain('- status: active');
    expect(text).toContain('5432');
  });

  it('createMemoryInjector should leave the section alone by default', async () => {
    const store = new MemoryStore(join(dir, 'n'));
    store.set('mod', 'status', 'active');
    const inject = createMemoryInjector(store);
    const mod = makeModule([memorySectionNode('**old**: value')], 'mod');
    await inject(mod);
    expect((findMemorySection(mod)! as any).content[0].value).toBe('**old**: value');
  });

  it('createMemoryInjector should filter by prefix', async () => {
    const store = new MemoryStore(join(dir, 'o'));
    store.set('mod', 'run.status', 'active');
    store.set('mod', 'other', 'skipped');
    const inject = createMemoryInjector(store, { rewrite: true, prefix: 'run.' });
    const mod = makeModule([memorySectionNode('**old**: value')], 'mod');
    await inject(mod);
    const value = (findMemorySection(mod)! as any).content[0].value;
    expect(value).toContain('status: active');
    expect(value).not.toContain('skipped');
  });

  it('createMemoryInjector should skip modules with no Memory section', async () => {
    const store = new MemoryStore(join(dir, 'p'));
    store.set('mod', 'a', 1);
    const inject = createMemoryInjector(store);
    const mod = makeModule([{ name: 'Other', content: [] }], 'mod');
    expect(await inject(mod)).toBe(mod);
  });

  it('createMemoryHooks should build the requested subset', () => {
    const store = new MemoryStore();
    const hooks = createMemoryHooks(store, { hooks: ['afterExecution', 'onError'], moduleId: 'm' });
    expect(hooks.afterParse).toBeUndefined();
    expect(typeof hooks.afterExecution).toBe('function');
    expect(typeof hooks.onError).toBe('function');
  });

  it('the onError hook should record and forward the error', () => {
    const tracker = new MemoryHookTracker();
    const seen: string[] = [];
    const hooks = createMemoryHooks(new MemoryStore(dir), {
      hooks: ['onError'],
      tracker,
      onError: (_e, ctx) => seen.push(ctx.hook),
    });
    hooks.onError?.({ error: new Error('bad'), phase: 'execute', handled: false, module: 'm' });
    expect(tracker.getStats().errors).toBe(1);
    expect(seen).toEqual(['onError']);
  });
});

describe('Memory Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(memoryPlugin.manifest.name).toBe('@mam/plugin-memory');
    expect(memoryPlugin.sections).toHaveLength(1);
    expect(memoryPlugin.rules).toHaveLength(1);
    expect(memoryPlugin.hooks).toBeDefined();
  });

  it('should expose the default store', () => {
    expect(getMemoryStore()).toBeInstanceOf(MemoryStore);
  });
});

describe('Memory Plugin - Factories', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await makeTempDir('mam-factories-');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('createMemoryPlugin should build a default plugin', () => {
    const plugin = createMemoryPlugin({ storeOptions: { memoryDir: join(dir, 'default') } });
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.sections?.[0]?.name).toBe(MEMORY_SECTION_NAME);
  });

  it('createMemoryPlugin should include the full rule family on request', () => {
    expect(createMemoryPlugin({ allRules: true }).rules).toHaveLength(9);
  });

  it('createMemoryPlugin should apply a severity', () => {
    const plugin = createMemoryPlugin({ allRules: true, severity: 'warning' });
    expect(plugin.rules?.every((r) => r.severity === 'warning')).toBe(true);
  });

  it('createMemoryPlugin should reuse a supplied store', async () => {
    const store = new MemoryStore(join(dir, 'reuse'));
    const plugin = createMemoryPlugin({ store });
    const hook = plugin.hooks?.afterParse as (m: MAMModule) => Promise<MAMModule>;
    await hook(makeModule([memorySectionNode('**a**: 1')], 'm'));
    expect(store.get('m', 'a')).toBe('1');
  });

  it('createMemoryPlugin should override the manifest', () => {
    const plugin = createMemoryPlugin({ manifest: { version: '9.9.9' } });
    expect(plugin.manifest.version).toBe('9.9.9');
  });

  it('createMemoryApi should bundle store, rules and limits', () => {
    const api = createMemoryApi({ storeOptions: { memoryDir: join(dir, 'api') } });
    expect(api.sectionName).toBe('Memory');
    expect(api.rules).toHaveLength(9);
    expect(api.limits.maxEntries).toBeGreaterThan(0);
    expect(api.example).toContain('status');
    expect(api.version).toBe(MEMORY_PLUGIN_VERSION);
    api.store.set('m', 'a', 1);
    api.dispose();
    expect(api.store.size()).toBe(0);
  });

  it('createMemoryHookTracker should start empty', () => {
    expect(createMemoryHookTracker().getStats().writes).toBe(0);
  });

  it('describeMemoryPlugin should summarise the surface', () => {
    const text = describeMemoryPlugin();
    expect(text).toContain(MEMORY_PLUGIN_VERSION);
    expect(text).toContain('Memory');
  });
});
