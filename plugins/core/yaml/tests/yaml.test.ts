import { describe, it, expect } from 'vitest';
import { parseYAMLValue, validateYAMLContent, parseYAML, stringifyYAML } from '../src/parser.js';
import { yamlRule } from '../src/rule.js';
import { yamlSection, YAML_MANIFEST, getYamlSection } from '../src/manifest.js';
import { validateYAMLSchema, MAM_CORE_SCHEMA } from '../src/schema.js';
import { flattenYAML, unflattenYAML, mergeYAMLObjects, diffYAMLObjects } from '../src/utils.js';
import yamlPlugin from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

describe('YAML Plugin - Parser', () => {
  it('should parse boolean values', () => {
    expect(parseYAMLValue('true')).toBe(true);
    expect(parseYAMLValue('false')).toBe(false);
  });

  it('should parse null values', () => {
    expect(parseYAMLValue('null')).toBeNull();
    expect(parseYAMLValue('~')).toBeNull();
  });

  it('should parse integers', () => {
    expect(parseYAMLValue('42')).toBe(42);
    expect(parseYAMLValue('-7')).toBe(-7);
  });

  it('should parse floats', () => {
    expect(parseYAMLValue('3.14')).toBeCloseTo(3.14);
  });

  it('should parse quoted strings', () => {
    expect(parseYAMLValue('"hello world"')).toBe('hello world');
    expect(parseYAMLValue("'test'")).toBe('test');
  });

  it('should return plain strings for unquoted values', () => {
    expect(parseYAMLValue('hello')).toBe('hello');
  });

  it('validateYAMLContent should accept valid YAML', () => {
    const result = validateYAMLContent('name: test\nversion: 1.0');
    expect(result.valid).toBe(true);
  });

  it('validateYAMLContent should reject invalid keys', () => {
    const result = validateYAMLContent('123invalid: value');
    expect(result.valid).toBe(false);
  });

  it('validateYAMLContent should skip comments', () => {
    const result = validateYAMLContent('# this is a comment\nname: test');
    expect(result.valid).toBe(true);
  });

  it('parseYAML should parse simple key-value pairs', () => {
    const { data } = parseYAML('name: test\nversion: 1.0');
    expect(data['name']).toBe('test');
    expect(typeof data['version']).toBe('number');
    expect(data['version']).toBe(1);
  });

  it('stringifyYAML should produce valid YAML output', () => {
    const output = stringifyYAML({ name: 'test', count: 42, active: true });
    expect(output).toContain('name: test');
    expect(output).toContain('count: 42');
    expect(output).toContain('active: true');
  });
});

describe('YAML Plugin - Rule', () => {
  it('should validate YAML code blocks', () => {
    const mod = makeModule([{
      name: 'Config',
      content: [{ type: 'CodeBlock', language: 'yaml', value: '123invalid: value' }],
    }]);
    const results = yamlRule.check(mod);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should pass valid YAML', () => {
    const mod = makeModule([{
      name: 'Config',
      content: [{ type: 'CodeBlock', language: 'yaml', value: 'name: test\nversion: 1.0' }],
    }]);
    const results = yamlRule.check(mod);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});

describe('YAML Plugin - Manifest', () => {
  it('should have correct manifest', () => {
    expect(YAML_MANIFEST.name).toBe('@mam/plugin-yaml');
    expect(YAML_MANIFEST.keywords).toContain('yaml');
  });

  it('getYamlSection should return a copy', () => {
    const s1 = getYamlSection();
    const s2 = getYamlSection();
    expect(s1).not.toBe(s2);
  });

  it('section validator should reject invalid YAML', () => {
    const results = yamlSection.validator!([
      { type: 'CodeBlock', language: 'yaml', value: '123bad: value' },
    ] as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('section validator should accept valid YAML', () => {
    const results = yamlSection.validator!([
      { type: 'CodeBlock', language: 'yaml', value: 'name: test' },
    ] as any);
    expect(results.every((r) => r.valid)).toBe(true);
  });
});

describe('YAML Plugin - Schema', () => {
  it('validateYAMLSchema should accept valid data', () => {
    const data = { id: 'test', version: '1.0', title: 'Test' };
    const result = validateYAMLSchema(data, MAM_CORE_SCHEMA);
    expect(result.valid).toBe(true);
  });

  it('validateYAMLSchema should require id field', () => {
    const data = { version: '1.0' };
    const result = validateYAMLSchema(data, MAM_CORE_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('validateYAMLSchema should warn on unknown fields', () => {
    const data = { id: 'test', unknownField: 'value' };
    const result = validateYAMLSchema(data, MAM_CORE_SCHEMA);
    expect(result.warnings.some((w) => w.includes('unknownField'))).toBe(true);
  });
});

describe('YAML Plugin - Utils', () => {
  it('flattenYAML should flatten nested objects', () => {
    const data = { a: { b: { c: 1 } } };
    expect(flattenYAML(data)).toEqual({ 'a.b.c': 1 });
  });

  it('unflattenYAML should restore nested structure', () => {
    const data = { 'a.b.c': 1 };
    expect(unflattenYAML(data)).toEqual({ a: { b: { c: 1 } } });
  });

  it('mergeYAMLObjects should deep merge', () => {
    const base = { a: { b: 1, c: 2 } };
    const override = { a: { c: 3, d: 4 } };
    const merged = mergeYAMLObjects(base, override);
    expect(merged).toEqual({ a: { b: 1, c: 3, d: 4 } });
  });

  it('diffYAMLObjects should detect changes', () => {
    const a = { x: 1, y: 2 };
    const b = { y: 3, z: 4 };
    const diff = diffYAMLObjects(a, b);
    expect(diff.added).toEqual(['z']);
    expect(diff.removed).toEqual(['x']);
    expect(diff.changed).toEqual(['y']);
  });
});

describe('YAML Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(yamlPlugin.manifest.name).toBe('@mam/plugin-yaml');
    expect(yamlPlugin.sections).toHaveLength(1);
    expect(yamlPlugin.rules).toHaveLength(1);
  });
});
