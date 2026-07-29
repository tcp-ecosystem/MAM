import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseMemoryContent, mergeMemory, filterMemoryByPrefix } from '../src/parser.js';
import { MemoryStore } from '../src/store.js';
import { memoryRule } from '../src/rule.js';
import { memorySection, MEMORY_MANIFEST, getMemorySection } from '../src/manifest.js';
import { createMemoryHooks, createAfterParseHook, createBeforeExecutionHook } from '../src/hooks.js';
import memoryPlugin from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

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
});

describe('Memory Plugin - Store', () => {
  let store: MemoryStore;
  beforeEach(() => {
    store = new MemoryStore('/tmp/mam-test-memory');
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
});

describe('Memory Plugin - Rule', () => {
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
});

describe('Memory Plugin - Hooks', () => {
  it('createAfterParseHook should persist memory', async () => {
    const store = new MemoryStore('/tmp/mam-test-hooks');
    const hook = createAfterParseHook(store);
    const mod = makeModule([{
      name: 'Memory',
      content: [{ type: 'Paragraph', value: '**status**: active' }],
    }]);
    (mod.frontmatter as unknown as Record<string, unknown>).id = 'test-module';
    await hook(mod);
    expect(store.get('test-module', 'status')).toBe('active');
  });

  it('createBeforeExecutionHook should sync from file', async () => {
    const store = new MemoryStore('/tmp/mam-test-hooks');
    const hook = createBeforeExecutionHook(store);
    const mod = makeModule([]);
    (mod.frontmatter as unknown as Record<string, unknown>).id = 'test-module';
    await hook(mod);
    // no error = success
    expect(true).toBe(true);
  });

  it('createMemoryHooks returns both hooks', () => {
    const store = new MemoryStore();
    const hooks = createMemoryHooks(store);
    expect(typeof hooks.afterParse).toBe('function');
    expect(typeof hooks.beforeExecution).toBe('function');
  });
});

describe('Memory Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(memoryPlugin.manifest.name).toBe('@mam/plugin-memory');
    expect(memoryPlugin.sections).toHaveLength(1);
    expect(memoryPlugin.rules).toHaveLength(1);
    expect(memoryPlugin.hooks).toBeDefined();
  });
});
