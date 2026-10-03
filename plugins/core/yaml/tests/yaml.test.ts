import { describe, it, expect, afterEach } from 'vitest';
import {
  parseYAMLValue, validateYAMLContent, parseYAML, stringifyYAML, parseYAMLDocuments,
  parseFlowCollection, countDocuments, stripYAMLComment, needsQuoting,
} from '../src/parser.js';
import {
  yamlRule, createYamlRule, createYAMLRules, createYAMLValidationRule, configureYAMLRules,
  resetYAMLRuleConfig, runYAMLRules, formatYAMLRuleSummary, findYAMLBlocks, countYAMLBlocks,
  YAML_RULES, syntaxRule, duplicateKeyRule, tabIndentRule, keyFormatRule, emptyRule,
  multiDocumentRule, sizeRule, depthRule,
} from '../src/rule.js';
import {
  yamlSection, YAML_MANIFEST, getYamlSection, createYamlManifest, validateYAMLContentBlocks,
  readModuleConfig, isValidYAMLKey, createValidatedYamlSection,
  YAML_SECTION_NAME, YAML_LANGUAGES, YAML_LIMITS, YAML_EXAMPLE,
} from '../src/manifest.js';
import {
  validateYAMLSchema, MAM_CORE_SCHEMA, MAM_BUILD_SCHEMA, applyYAMLSchemaDefaults,
  getRequiredFields, getSchemaPaths, mergeYAMLSchemas, getValueType,
} from '../src/schema.js';
import {
  flattenYAML, unflattenYAML, mergeYAMLObjects, diffYAMLObjects, mergeYAMLDefaults,
  getYAMLPath, setYAMLPath, deleteYAMLPath, hasYAMLPath, pickYAML, yamlKeys, yamlEquals,
  sortYAMLKeys, describeYAMLShape, splitYAMLPath, YAMLToJSON, yamlToJSONResult, jsonToYAML,
} from '../src/utils.js';
import yamlPlugin, {
  createYamlPlugin, createYamlApi, describeYamlPlugin, YAML_PLUGIN_VERSION,
} from '../src/index.js';
import type { MAMModule } from '@mam/ast';

function makeModule(sections: any[] = []): MAMModule {
  return { type: 'MAMModule', frontmatter: {}, sections, location: { start: { line: 1, column: 1 }, end: { line: 10, column: 1 } } } as any;
}

function yamlBlock(value: string, language = 'yaml') {
  return [{ type: 'CodeBlock', language, value }];
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

  describe('regression: nested structures', () => {
    it('should parse nested maps', () => {
      // Previously the indented lines were joined into one string.
      const { data } = parseYAML('db:\n  host: localhost\n  port: 5432');
      expect(data).toEqual({ db: { host: 'localhost', port: 5432 } });
    });

    it('should parse a sequence', () => {
      const { data } = parseYAML('items:\n  - a\n  - b');
      expect(data).toEqual({ items: ['a', 'b'] });
    });

    it('should parse a sequence indented at the key level', () => {
      expect(parseYAML('l:\n- a\n- b').data).toEqual({ l: ['a', 'b'] });
    });

    it('should parse a sequence of mappings', () => {
      const { data } = parseYAML('l:\n  - name: a\n    v: 1\n  - name: b\n    v: 2');
      expect(data).toEqual({ l: [{ name: 'a', v: 1 }, { name: 'b', v: 2 }] });
    });

    it('should parse a nested sequence', () => {
      expect(parseYAML('m:\n  - - 1\n    - 2').data).toEqual({ m: [[1, 2]] });
    });

    it('should parse deeply nested maps', () => {
      expect(parseYAML('a:\n  b:\n    c:\n      d: 1').data).toEqual({ a: { b: { c: { d: 1 } } } });
    });

    it('should keep types through nesting', () => {
      const { data } = parseYAML('db:\n  port: 5432\n  secure: true\n  extra: null');
      expect(data.db).toEqual({ port: 5432, secure: true, extra: null });
    });
  });

  describe('regression: flow collections', () => {
    it('should parse a flow sequence with bare scalars', () => {
      expect(parseYAMLValue('[a, b]')).toEqual(['a', 'b']);
    });

    it('should parse a flow sequence of numbers', () => {
      expect(parseYAMLValue('[1, 2, 3]')).toEqual([1, 2, 3]);
    });

    it('should parse a flow mapping with bare keys', () => {
      expect(parseYAMLValue('{a: 1, b: two}')).toEqual({ a: 1, b: 'two' });
    });

    it('should parse nested flow collections', () => {
      expect(parseYAMLValue('{a: [1, {b: 2}]}')).toEqual({ a: [1, { b: 2 }] });
    });

    it('should parse quoted scalars inside a flow collection', () => {
      expect(parseYAMLValue('["a,b", "c"]')).toEqual(['a,b', 'c']);
    });

    it('should report an unterminated flow collection', () => {
      expect(parseFlowCollection('[1, 2').ok).toBe(false);
    });

    it('should parse a flow collection from a block', () => {
      expect(parseYAML('l: [a, b]').data).toEqual({ l: ['a', 'b'] });
    });
  });

  describe('regression: comments, quotes and numbers', () => {
    it('should strip an inline comment from a value', () => {
      expect(parseYAMLValue('hello # note')).toBe('hello');
    });

    it('should keep a # inside a quoted scalar', () => {
      expect(parseYAMLValue("'a # b'")).toBe('a # b');
    });

    it('should keep a # that is not preceded by a space', () => {
      expect(parseYAMLValue('a#b')).toBe('a#b');
    });

    it('stripYAMLComment should respect quotes', () => {
      expect(stripYAMLComment('a: "x # y" # real')).toBe('a: "x # y" ');
    });

    it('should decode double-quoted escapes', () => {
      expect(parseYAMLValue('"a\\"b"')).toBe('a"b');
      expect(parseYAMLValue('"line\\nbreak"')).toBe('line\nbreak');
      expect(parseYAMLValue('"tab\\there"')).toBe('tab\there');
    });

    it('should decode a single-quoted doubled quote', () => {
      expect(parseYAMLValue("'it''s'")).toBe("it's");
    });

    it('should keep a padded number as a string', () => {
      // The float pattern also matches a bare integer, so 007 used to become 7.
      expect(parseYAMLValue('007')).toBe('007');
      expect(parseYAML('e: 007').data.e).toBe('007');
    });

    it('should keep a version string as a string', () => {
      expect(parseYAMLValue('1.0.0')).toBe('1.0.0');
    });

    it('should parse hex, octal and exponent numbers', () => {
      expect(parseYAMLValue('0x10')).toBe(16);
      expect(parseYAMLValue('1e3')).toBe(1000);
      expect(parseYAMLValue('-1.5e-2')).toBeCloseTo(-0.015);
    });

    it('should parse infinity and NaN', () => {
      expect(parseYAMLValue('.inf')).toBe(Infinity);
      expect(parseYAMLValue('-.inf')).toBe(-Infinity);
      expect(parseYAMLValue('.nan')).toBeNaN();
    });

    it('should parse a key containing a colon-like value', () => {
      expect(parseYAML('url: http://x/y').data.url).toBe('http://x/y');
    });

    it('should parse a quoted key', () => {
      expect(parseYAML('"a b": 1').data['a b']).toBe(1);
    });
  });

  describe('block scalars and documents', () => {
    it('should read a literal block scalar', () => {
      expect(parseYAML('text: |\n  line1\n  line2').data.text).toBe('line1\nline2\n');
    });

    it('should strip trailing newlines with |-', () => {
      expect(parseYAML('t: |-\n  one\n  two').data.t).toBe('one\ntwo');
    });

    it('should fold a > block scalar', () => {
      expect(parseYAML('t: >\n  one\n  two').data.t).toBe('one two\n');
    });

    it('should keep relative indentation inside a block scalar', () => {
      expect(parseYAML('t: |\n  a\n    b').data.t).toBe('a\n  b\n');
    });

    it('should stop a document at a following marker', () => {
      // Previously the marker was appended to the preceding value.
      expect(parseYAML('a: 1\n---\nb: 2').data).toEqual({ a: 1 });
    });

    it('should skip a leading document marker', () => {
      expect(parseYAML('---\na: 1').data).toEqual({ a: 1 });
    });

    it('countDocuments should count boundaries', () => {
      expect(countDocuments('a: 1')).toBe(1);
      expect(countDocuments('a: 1\n---\nb: 2')).toBe(2);
    });

    it('should warn when more documents are present', () => {
      expect(parseYAML('a: 1\n---\nb: 2').warnings.join()).toMatch(/2 documents/);
    });

    it('parseYAMLDocuments should read every document', () => {
      const docs = parseYAMLDocuments('a: 1\n---\nb: 2');
      expect(docs).toHaveLength(2);
      expect(docs[0].data).toEqual({ a: 1 });
      expect(docs[1].data).toEqual({ b: 2 });
    });

    it('should resolve an anchor and alias', () => {
      const { data } = parseYAML('base: &b\n  x: 1\nuse: *b');
      expect(data.use).toEqual({ x: 1 });
    });

    it('should report an unknown alias', () => {
      expect(parseYAML('a: *missing').details[0].code).toBe('unknown-alias');
    });
  });

  describe('error reporting', () => {
    it('should report duplicate keys', () => {
      const result = parseYAML('a: 1\na: 2');
      expect(result.details[0].code).toBe('duplicate-key');
      expect(result.errors[0]).toMatch(/line 2/);
    });

    it('should report tab indentation', () => {
      expect(parseYAML('a:\n\tb: 2').details.some((d) => d.code === 'tab-indent')).toBe(true);
    });

    it('should report a line that is not a key', () => {
      expect(parseYAML('a: 1\nplain text').details.some((d) => d.code === 'expected-key')).toBe(true);
    });

    it('should report bad indentation', () => {
      expect(parseYAML('a: 1\n  b: 2').details.some((d) => d.code === 'bad-indent')).toBe(true);
    });

    it('should handle an empty document', () => {
      const result = parseYAML('');
      expect(result.data).toEqual({});
      expect(result.errors).toEqual([]);
    });

    it('should handle a comments-only document', () => {
      expect(parseYAML('# nothing here').data).toEqual({});
    });

    it('should accept a dotted key', () => {
      // The key pattern used to reject db.host, which this repo uses widely.
      expect(validateYAMLContent('db.host: x').valid).toBe(true);
    });

    it('should still reject a key starting with a digit', () => {
      expect(validateYAMLContent('123bad: x').valid).toBe(false);
    });

    it('should reject a dotted key when dots are disallowed', () => {
      expect(validateYAMLContent('db.host: x', { allowDottedKeys: false }).valid).toBe(false);
    });

    it('should return structured issues with line numbers', () => {
      const result = validateYAMLContent('a: 1\nb: 2\nb: 3');
      expect(result.errors.some((e) => e.line === 3)).toBe(true);
    });
  });

  describe('serialisation', () => {
    it('should round-trip nested structures', () => {
      const original = { a: { b: 1, c: [1, 2] } };
      expect(parseYAML(stringifyYAML(original)).data).toEqual(original);
    });

    it('should round-trip a multi-line string', () => {
      expect(parseYAML(stringifyYAML({ m: 'l1\nl2' })).data.m).toBe('l1\nl2');
    });

    it('should round-trip a string containing a colon', () => {
      expect(parseYAML(stringifyYAML({ s: 'x: y' })).data.s).toBe('x: y');
    });

    it('should round-trip types', () => {
      const original = { n: null, t: true, f: 1.25, s: 'plain' };
      expect(parseYAML(stringifyYAML(original)).data).toEqual(original);
    });

    it('should round-trip empty collections', () => {
      expect(parseYAML(stringifyYAML({ e: [], o: {} })).data).toEqual({ e: [], o: {} });
    });

    it('should quote a value that would read back as a number', () => {
      expect(parseYAML(stringifyYAML({ v: '007' })).data.v).toBe('007');
    });

    it('needsQuoting should spot ambiguous scalars', () => {
      expect(needsQuoting('true')).toBe(true);
      expect(needsQuoting('123')).toBe(true);
      expect(needsQuoting(' leading')).toBe(true);
      expect(needsQuoting('a: b')).toBe(true);
      expect(needsQuoting('plain')).toBe(false);
    });
  });
});

describe('YAML Plugin - Rule', () => {
  afterEach(() => {
    resetYAMLRuleConfig();
  });

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

  it('should accept the yml language tag', () => {
    const mod = makeModule([{ name: 'Config', content: yamlBlock('name: test', 'yml') }]);
    expect(countYAMLBlocks(mod)).toBe(1);
  });

  it('should find blocks across every section', () => {
    const mod = makeModule([
      { name: 'A', content: yamlBlock('a: 1') },
      { name: 'B', content: yamlBlock('b: 1') },
    ]);
    expect(findYAMLBlocks(mod)).toHaveLength(2);
  });

  it('should carry the node location when available', () => {
    const node = { type: 'CodeBlock', language: 'yaml', value: '123bad: v', location: { start: { line: 7, column: 3 } } };
    const results = yamlRule.check(makeModule([{ name: 'C', content: [node] }]));
    expect(results[0].location).toEqual({ line: 7, column: 3 });
  });

  it('syntaxRule should report unparsable YAML', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a: 1\nplain text') }]);
    expect(syntaxRule.check(mod).length).toBeGreaterThan(0);
  });

  it('duplicateKeyRule should report duplicate keys', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a: 1\na: 2') }]);
    const results = duplicateKeyRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].rule).toBe('yaml-duplicate-keys');
  });

  it('duplicateKeyRule should be silent when duplicates are allowed', () => {
    configureYAMLRules({ rejectDuplicates: false });
    const mod = makeModule([{ name: 'C', content: yamlBlock('a: 1\na: 2') }]);
    expect(duplicateKeyRule.check(mod)).toEqual([]);
  });

  it('tabIndentRule should report tab indentation', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a:\n\tb: 2') }]);
    expect(tabIndentRule.check(mod).length).toBeGreaterThan(0);
  });

  it('keyFormatRule should report a bad key', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('1bad: x') }]);
    expect(keyFormatRule.check(mod).length).toBeGreaterThan(0);
  });

  it('keyFormatRule should accept a dotted key', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('db.host: x') }]);
    expect(keyFormatRule.check(mod)).toEqual([]);
  });

  it('emptyRule should be quiet unless enabled', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('# nothing') }]);
    expect(emptyRule.check(mod)).toEqual([]);
    configureYAMLRules({ rejectEmpty: true });
    expect(emptyRule.check(mod)).toHaveLength(1);
  });

  it('multiDocumentRule should flag extra documents when enabled', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a: 1\n---\nb: 2') }]);
    expect(multiDocumentRule.check(mod)).toEqual([]);
    configureYAMLRules({ rejectMultiDocument: true });
    expect(multiDocumentRule.check(mod)).toHaveLength(1);
  });

  it('sizeRule should flag long and wide blocks when configured', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a: 1\nb: 2\nc: 3') }]);
    expect(sizeRule.check(mod)).toEqual([]);
    configureYAMLRules({ maxLines: 1, maxKeys: 1 });
    const results = sizeRule.check(mod);
    expect(results.some((r) => r.message.includes('lines'))).toBe(true);
    expect(results.some((r) => r.message.includes('top-level keys'))).toBe(true);
  });

  it('depthRule should report very deep nesting as info', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('a:\n  b:\n    c:\n      d:\n        e:\n          f: 1') }]);
    const results = depthRule.check(mod);
    expect(results).toHaveLength(1);
    expect(results[0].severity).toBe('info');
    expect(results[0].valid).toBe(true);
  });

  it('YAML_RULES should contain the full family', () => {
    expect(YAML_RULES).toHaveLength(8);
    expect(new Set(YAML_RULES.map((r) => r.name)).size).toBe(YAML_RULES.length);
  });

  it('createYamlRule should override the severity', () => {
    expect(createYamlRule('warning').severity).toBe('warning');
    expect(createYamlRule().severity).toBe('error');
  });

  it('createYAMLRules should re-level every rule', () => {
    expect(createYAMLRules('info').every((r) => r.severity === 'info')).toBe(true);
  });

  it('createYAMLValidationRule should report every problem', () => {
    const mod = makeModule([{ name: 'C', content: yamlBlock('1bad: x\n1bad: y') }]);
    const results = createYAMLValidationRule().check(mod);
    const messages = results.map((r) => r.message).join(' | ');
    expect(messages).toMatch(/Invalid YAML key/);
    expect(messages).toMatch(/Duplicate key/);
  });

  it('runYAMLRules should contain a rule that throws', () => {
    const exploding = {
      name: 'boom', description: '', severity: 'error' as const,
      check: () => { throw new Error('kaboom'); },
    };
    const results = runYAMLRules(makeModule([]), [exploding]);
    expect(results[0].message).toMatch(/kaboom/);
  });

  it('formatYAMLRuleSummary should count each severity', () => {
    expect(formatYAMLRuleSummary([])).toBe('no problems');
    expect(formatYAMLRuleSummary([
      { valid: false, message: 'a' },
      { valid: true, message: 'b', severity: 'warning' },
      { valid: true, message: 'c', severity: 'info' },
    ])).toBe('1 error, 1 warning, 1 info');
  });

  it('rules should return nothing for a module with no YAML blocks', () => {
    const mod = makeModule([{ name: 'C', content: [{ type: 'Paragraph', value: 'hi' }] }]);
    for (const rule of YAML_RULES) {
      expect(rule.check(mod)).toEqual([]);
    }
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

  it('should require a MAM version the host can satisfy', () => {
    expect(YAML_MANIFEST.mamVersion).toBe('>=0.1.0');
  });

  it('should point main at a file the package actually ships', () => {
    expect(YAML_MANIFEST.main).toBe('./dist/index.js');
    expect(YAML_MANIFEST.version).toBe('0.1.0');
  });

  it('should export the section name, languages, limits and example', () => {
    expect(YAML_SECTION_NAME).toBe('Config');
    expect(YAML_LANGUAGES).toContain('yml');
    expect(YAML_LIMITS.maxLines).toBeGreaterThan(0);
    expect(YAML_EXAMPLE).toContain('```yaml');
  });

  it('isValidYAMLKey should accept identifiers and dotted paths', () => {
    expect(isValidYAMLKey('name')).toBe(true);
    expect(isValidYAMLKey('db.host')).toBe(true);
    expect(isValidYAMLKey('1bad')).toBe(false);
  });

  it('should reject a duplicate key', () => {
    const results = yamlSection.validator!(yamlBlock('a: 1\na: 2') as any);
    expect(results.some((r) => r.rule === 'yaml-duplicate-key')).toBe(true);
  });

  it('should reject tab indentation', () => {
    const results = yamlSection.validator!(yamlBlock('a:\n\tb: 2') as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('should warn past the size limits', () => {
    const results = validateYAMLContentBlocks(yamlBlock('a: 1\nb: 2\nc: 3'), { limits: { maxLines: 1, maxKeys: 1 } });
    expect(results.filter((r) => r.severity === 'warning').length).toBe(2);
  });

  it('should enforce a schema when one is supplied', () => {
    const results = validateYAMLContentBlocks(yamlBlock('version: 1.0'), { schema: MAM_CORE_SCHEMA });
    expect(results.some((r) => r.rule === 'yaml-schema' && !r.valid)).toBe(true);
  });

  it('getYamlSection should apply a schema', () => {
    const section = createValidatedYamlSection(MAM_CORE_SCHEMA);
    expect(section.validator!(yamlBlock('version: 1.0') as any).some((r) => !r.valid)).toBe(true);
  });

  it('getYamlSection should apply overridden limits', () => {
    const section = getYamlSection({ limits: { maxLines: 1 } });
    expect(section.validator!(yamlBlock('a: 1\nb: 2') as any).some((r) => r.rule === 'yaml-size')).toBe(true);
  });

  it('should ignore non-YAML blocks', () => {
    expect(yamlSection.validator!([{ type: 'CodeBlock', language: 'js', value: 'a: 1' }] as any)).toEqual([]);
  });

  it('createYamlManifest should override without mutating the original', () => {
    const custom = createYamlManifest({ version: '2.0.0', keywords: ['custom'] });
    expect(custom.version).toBe('2.0.0');
    expect(custom.keywords).toEqual(['custom']);
    expect(YAML_MANIFEST.version).toBe('0.1.0');
    expect(YAML_MANIFEST.keywords).toContain('yaml');
  });

  it('readModuleConfig should flatten a module configuration', () => {
    const mod = { sections: [{ name: 'Config', content: yamlBlock('db:\n  host: x') }] };
    expect(readModuleConfig(mod)).toEqual({ 'db.host': 'x' });
  });

  it('readModuleConfig should return an empty record without the section', () => {
    expect(readModuleConfig({ sections: [] })).toEqual({});
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

  it('regression: should not mutate the caller data', () => {
    // Defaults used to be written straight into the caller's object.
    const data: Record<string, unknown> = { id: 'x' };
    const result = validateYAMLSchema(data, MAM_CORE_SCHEMA);
    expect(result.valid).toBe(true);
    expect('enabled' in data).toBe(false);
    expect(result.warnings.some((w) => w.includes('enabled'))).toBe(true);
  });

  it('should write defaults when asked', () => {
    const data: Record<string, unknown> = { id: 'x' };
    validateYAMLSchema(data, MAM_CORE_SCHEMA, { applyDefaults: true });
    expect(data.enabled).toBe(true);
  });

  it('applyYAMLSchemaDefaults should return a copy with defaults', () => {
    const original: Record<string, unknown> = { id: 'x' };
    const filled = applyYAMLSchemaDefaults(original, MAM_CORE_SCHEMA);
    expect(filled.enabled).toBe(true);
    expect('enabled' in original).toBe(false);
  });

  it('should report a type mismatch', () => {
    const result = validateYAMLSchema({ id: 5 }, MAM_CORE_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.typeMismatches).toEqual(['id']);
  });

  it('should accept a union of types', () => {
    const schema = { name: 'u', fields: [{ name: 'a', type: 'string' as const }, { name: 'b', type: ['string', 'number'] as const }] };
    expect(validateYAMLSchema({ a: 'x', b: 1 }, schema).valid).toBe(true);
  });

  it('should enforce an enum', () => {
    const result = validateYAMLSchema({ id: 'x', license: 'WTFPL' }, MAM_CORE_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.fieldIssues.some((i) => i.code === 'enum')).toBe(true);
  });

  it('should enforce a pattern', () => {
    expect(validateYAMLSchema({ id: 'has space' }, MAM_CORE_SCHEMA).valid).toBe(false);
  });

  it('should enforce numeric bounds', () => {
    const schema = { name: 'b', fields: [{ name: 'n', type: 'number' as const, min: 1, max: 10 }] };
    expect(validateYAMLSchema({ n: 0 }, schema).valid).toBe(false);
    expect(validateYAMLSchema({ n: 11 }, schema).valid).toBe(false);
    expect(validateYAMLSchema({ n: 5 }, schema).valid).toBe(true);
  });

  it('should enforce length bounds', () => {
    const schema = { name: 'l', fields: [{ name: 's', type: 'string' as const, minLength: 2, maxLength: 4 }] };
    expect(validateYAMLSchema({ s: 'a' }, schema).valid).toBe(false);
    expect(validateYAMLSchema({ s: 'abcde' }, schema).valid).toBe(false);
  });

  it('should validate nested fields', () => {
    const data = { target: 'esm', output: { sourcemap: 'yes' } };
    const result = validateYAMLSchema(data, MAM_BUILD_SCHEMA);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('output.sourcemap'))).toBe(true);
  });

  it('should validate array items', () => {
    expect(validateYAMLSchema({ id: 'x', tags: ['a', 2] }, MAM_CORE_SCHEMA).valid).toBe(false);
  });

  it('should report a deprecated field as a warning', () => {
    const schema = { name: 'd', fields: [{ name: 'old', type: 'string' as const, deprecated: true }] };
    const result = validateYAMLSchema({ old: 'v' }, schema);
    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('deprecated'))).toBe(true);
  });

  it('should accept an alias for a field', () => {
    const schema = { name: 'a', fields: [{ name: 'name', type: 'string' as const, aliases: ['title'] }] };
    expect(validateYAMLSchema({ title: 'x' }, schema).valid).toBe(true);
  });

  it('should address a dotted field path', () => {
    const schema = { name: 'p', fields: [{ name: 'db.port', type: 'number' as const }] };
    expect(validateYAMLSchema({ db: { port: 1 } }, schema).valid).toBe(true);
    expect(validateYAMLSchema({ db: { port: 'x' } }, schema).valid).toBe(false);
  });

  it('strict should promote unknown fields to errors', () => {
    const result = validateYAMLSchema({ id: 'x', extra: 1 }, MAM_CORE_SCHEMA, { strict: true });
    expect(result.valid).toBe(false);
  });

  it('getRequiredFields should list required fields', () => {
    expect(getRequiredFields(MAM_CORE_SCHEMA)).toEqual(['id']);
  });

  it('getSchemaPaths should include nested paths', () => {
    expect(getSchemaPaths(MAM_BUILD_SCHEMA)).toContain('output.dir');
  });

  it('mergeYAMLSchemas should combine by field name', () => {
    const merged = mergeYAMLSchemas(
      { name: 'a', fields: [{ name: 'x', type: 'string' }] },
      { name: 'a', fields: [{ name: 'x', type: 'number' }, { name: 'y', type: 'string' }] },
    );
    expect(merged.fields).toHaveLength(2);
    expect(merged.fields[0].type).toBe('number');
  });

  it('getValueType should name the type', () => {
    expect(getValueType(null)).toBe('null');
    expect(getValueType([])).toBe('array');
    expect(getValueType({})).toBe('object');
    expect(getValueType(1)).toBe('number');
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

  it('diffYAMLObjects should report unchanged keys', () => {
    expect(diffYAMLObjects({ a: 1 }, { a: 1 }).unchanged).toEqual(['a']);
  });

  it('mergeYAMLObjects should not mutate its inputs', () => {
    const base = { a: { b: 1 } };
    mergeYAMLObjects(base, { a: { c: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });

  it('flattenYAML should keep arrays as leaves', () => {
    expect(flattenYAML({ list: [1, 2] })).toEqual({ list: [1, 2] });
  });

  it('flattenYAML should honour maxDepth', () => {
    expect(flattenYAML({ a: { b: 1 } }, '', { maxDepth: 0 })).toEqual({ a: { b: 1 } });
  });

  it('unflattenYAML should refuse an unsafe path', () => {
    const out: Record<string, unknown> = {};
    unflattenYAML({ '__proto__.polluted': true });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    void out;
  });

  it('splitYAMLPath should reject empty and unsafe segments', () => {
    expect(splitYAMLPath('a.b')).toEqual(['a', 'b']);
    expect(splitYAMLPath('a.__proto__')).toEqual([]);
    expect(splitYAMLPath('a..b')).toEqual([]);
  });

  it('getYAMLPath should read nested values', () => {
    expect(getYAMLPath({ a: { b: 1 } }, 'a.b')).toBe(1);
    expect(getYAMLPath({}, 'a.b')).toBeUndefined();
  });

  it('setYAMLPath should create intermediate objects', () => {
    const data: Record<string, unknown> = {};
    expect(setYAMLPath(data, 'a.b.c', 1)).toBe(true);
    expect(data).toEqual({ a: { b: { c: 1 } } });
  });

  it('setYAMLPath should refuse an unsafe path', () => {
    const data: Record<string, unknown> = {};
    expect(setYAMLPath(data, '__proto__.x', 1)).toBe(false);
  });

  it('deleteYAMLPath should remove a nested key', () => {
    const data = { a: { b: 1, c: 2 } };
    expect(deleteYAMLPath(data, 'a.b')).toBe(true);
    expect(data.a).toEqual({ c: 2 });
    expect(deleteYAMLPath(data, 'a.zz')).toBe(false);
  });

  it('hasYAMLPath should report presence', () => {
    expect(hasYAMLPath({ a: 1 }, 'a')).toBe(true);
    expect(hasYAMLPath({ a: 1 }, 'b')).toBe(false);
  });

  it('pickYAML should keep only known paths', () => {
    expect(pickYAML({ a: { b: 1 }, c: 2 }, ['a.b'])).toEqual({ a: { b: 1 } });
  });

  it('mergeYAMLDefaults should ignore null overrides', () => {
    expect(mergeYAMLDefaults({ a: 1, b: 2 }, { a: null })).toEqual({ a: 1, b: 2 });
  });

  it('yamlKeys should return sorted top-level keys', () => {
    expect(yamlKeys({ b: 1, a: 2 })).toEqual(['a', 'b']);
  });

  it('yamlEquals should compare structurally', () => {
    expect(yamlEquals({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(yamlEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('sortYAMLKeys should sort recursively', () => {
    expect(Object.keys(sortYAMLKeys({ b: 1, a: { d: 1, c: 2 } }))).toEqual(['a', 'b']);
    expect(Object.keys(sortYAMLKeys({ a: { d: 1, c: 2 } }).a as object)).toEqual(['c', 'd']);
  });

  it('describeYAMLShape should count nodes and depth', () => {
    const shape = describeYAMLShape({ a: { b: 1 }, c: [2] });
    expect(shape.maxDepth).toBe(2);
    expect(shape.leaves).toBeGreaterThan(0);
    expect(shape.arrays).toBe(1);
  });

  it('YAMLToJSON should keep nested structure and types', () => {
    // Previously a second naive scanner dropped nesting and stringified numbers.
    const parsed = JSON.parse(YAMLToJSON('db:\n  port: 5432'));
    expect(parsed).toEqual({ db: { port: 5432 } });
  });

  it('yamlToJSONResult should include parse errors', () => {
    // A key-pattern problem is a validation concern, not a parse one, so this
    // uses a real syntax fault.
    const result = yamlToJSONResult('a: 1\na: 2');
    expect(result.details.length).toBeGreaterThan(0);
    expect(typeof result.json).toBe('string');
  });

  it('jsonToYAML should produce parseable YAML', () => {
    const yaml = jsonToYAML('{"a":{"b":1}}');
    expect(parseYAML(yaml).data).toEqual({ a: { b: 1 } });
  });
});

describe('YAML Plugin - Default Export', () => {
  it('should export a valid plugin', () => {
    expect(yamlPlugin.manifest.name).toBe('@mam/plugin-yaml');
    expect(yamlPlugin.sections).toHaveLength(1);
    expect(yamlPlugin.rules).toHaveLength(1);
  });
});

describe('YAML Plugin - Factories', () => {
  it('createYamlPlugin should build a default plugin', () => {
    const plugin = createYamlPlugin();
    expect(plugin.rules).toHaveLength(1);
    expect(plugin.sections?.[0]?.name).toBe(YAML_SECTION_NAME);
  });

  it('createYamlPlugin should include the full rule family on request', () => {
    expect(createYamlPlugin({ allRules: true }).rules).toHaveLength(8);
  });

  it('createYamlPlugin should apply a severity', () => {
    const plugin = createYamlPlugin({ allRules: true, severity: 'info' });
    expect(plugin.rules?.every((r) => r.severity === 'info')).toBe(true);
  });

  it('createYamlPlugin should enforce a schema', () => {
    const plugin = createYamlPlugin({ schema: MAM_CORE_SCHEMA });
    const results = plugin.sections![0]!.validator!(yamlBlock('version: 1.0') as any);
    expect(results.some((r) => !r.valid)).toBe(true);
  });

  it('createYamlPlugin should override the manifest', () => {
    expect(createYamlPlugin({ manifest: { version: '9.9.9' } }).manifest.version).toBe('9.9.9');
  });

  it('createYamlApi should bundle the parser, rules and schema', () => {
    const api = createYamlApi();
    expect(api.version).toBe(YAML_PLUGIN_VERSION);
    expect(api.sectionName).toBe('Config');
    expect(api.rules).toHaveLength(8);
    expect(api.schema.name).toBe('MAM Core');
    expect(api.example).toContain('```yaml');
    expect(api.limits.maxLines).toBeGreaterThan(0);
  });

  it('createYamlApi should parse, validate and stringify', () => {
    const api = createYamlApi();
    expect(api.parse('a: 1').data).toEqual({ a: 1 });
    expect(api.validate({ id: 'x' }).valid).toBe(true);
    expect(api.stringify({ a: 1 })).toContain('a: 1');
  });

  it('describeYamlPlugin should summarise the surface', () => {
    const text = describeYamlPlugin();
    expect(text).toContain(YAML_PLUGIN_VERSION);
    expect(text).toContain('8 rules');
  });
});
