/**
 * AST Serializer Tests
 */

import { describe, it, expect } from 'vitest';
import {
  serializeToJSON,
  deserializeFromJSON,
  prettyPrint,
  getASTStats,
} from '../src/serializer/index.js';
import {
  serializeToJSON as serializeToJSONAdvanced,
  deserializeFromJSON as deserializeFromJSONAdvanced,
  validateJSONSchema,
  compactSerialize,
  astToJSON,
  patchAST,
} from '../src/serializer/json.js';
import {
  serializeToYAML,
  deserializeFromYAML,
} from '../src/serializer/yaml.js';
import { createLocation } from '../src/location/index.js';
import type { MAMModule } from '../src/nodes/index.js';
import {
  estimateJSONSize,
  canonicalSerialize,
  stripLocations,
  diffAST,
  hashAST,
  validateRoundTrip,
  isPlainASTObject,
} from '../src/serializer/json.js';
import {
  escapeYAMLString,
  detectYAMLIndent,
  normalizeYAMLIndent,
  validateYAMLShape,
  serializeFrontMatterToYAML,
  parseFlatYAMLMap,
  yamlHasDocumentMarkers,
} from '../src/serializer/yaml.js';
import {
  findSectionByName,
  getSectionSummaries,
  collectLanguages,
  countInlineNodes,
  astOutline,
  roundTripClone,
  getASTComplexity,
} from '../src/serializer/index.js';

function loc() {
  return createLocation(1, 0, 0, 10, 5, 100, 'test.mam.md');
}

function createTestModule(): MAMModule {
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'test', version: '1.0.0', name: 'Test Module', author: 'Author', runtime: 'python' },
      location: loc(),
    },
    sections: [
      {
        type: 'Section',
        name: 'Purpose',
        level: 2,
        content: [{ type: 'Paragraph', value: 'Test purpose content', inlineNodes: [], location: loc() }],
        location: loc(),
        attributes: { required: true, isCustom: false, contentTypes: ['text'] },
      },
      {
        type: 'Section',
        name: 'Python',
        level: 2,
        content: [
          {
            type: 'CodeBlock',
            language: 'python',
            value: 'print("hello")',
            metadata: {},
            executable: true,
            location: loc(),
          },
        ],
        location: loc(),
        attributes: { required: false, isCustom: false, contentTypes: ['code'] },
      },
    ],
    location: loc(),
    metadata: {
      sectionCount: 2,
      codeBlockCount: 1,
      languages: ['python'],
      customSections: [],
      parsedAt: '2024-01-01T00:00:00Z',
    },
  };
}

function createComplexModule(): MAMModule {
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: {
        id: 'complex',
        version: '2.0.0',
        name: 'Complex Module',
        author: 'Author',
        runtime: 'typescript',
        tags: ['ai', 'ml'],
        permissions: ['network', 'filesystem'],
      },
      location: loc(),
    },
    sections: [
      {
        type: 'Section',
        name: 'Purpose',
        level: 2,
        content: [
          {
            type: 'Paragraph',
            value: 'Purpose text',
            inlineNodes: [
              { type: 'InlineText', value: 'Purpose ', location: loc() },
              { type: 'Bold', content: [{ type: 'InlineText', value: 'text', location: loc() }], location: loc() },
            ],
            location: loc(),
          },
        ],
        location: loc(),
        attributes: { required: true, isCustom: false, contentTypes: ['text'] },
      },
      {
        type: 'Section',
        name: 'Inputs',
        level: 2,
        content: [
          {
            type: 'List',
            ordered: false,
            items: [
              { content: [{ type: 'Paragraph', value: 'item1', inlineNodes: [], location: loc() }] },
              { content: [{ type: 'Paragraph', value: 'item2', inlineNodes: [], location: loc() }], checked: true },
            ],
            location: loc(),
          },
        ],
        location: loc(),
        attributes: { required: false, isCustom: false, contentTypes: ['list'] },
      },
      {
        type: 'Section',
        name: 'Tests',
        level: 2,
        content: [
          {
            type: 'Table',
            headers: [
              { value: 'Input', inlineNodes: [] },
              { value: 'Expected', inlineNodes: [] },
            ],
            rows: [
              [{ value: 'a', inlineNodes: [] }, { value: 'b', inlineNodes: [] }],
            ],
            alignments: ['left', 'left'],
            location: loc(),
          },
          {
            type: 'Mermaid',
            value: 'graph LR\n  A --> B',
            diagramType: 'flowchart',
            location: loc(),
          },
          {
            type: 'Blockquote',
            value: 'Important note',
            children: [
              { type: 'Paragraph', value: 'Note text', inlineNodes: [], location: loc() },
            ],
            location: loc(),
          },
          {
            type: 'Heading',
            level: 3,
            value: 'Sub heading',
            content: [{ type: 'InlineCode', value: 'code', location: loc() }],
            location: loc(),
          },
        ],
        location: loc(),
        attributes: { required: false, isCustom: false, contentTypes: ['mixed'] },
      },
    ],
    location: loc(),
    metadata: {
      sectionCount: 3,
      codeBlockCount: 0,
      languages: [],
      customSections: [],
    },
  };
}

describe('Basic Serialization (index.ts)', () => {
  it('should serialize to JSON with default format', () => {
    const mod = createTestModule();
    const json = serializeToJSON(mod);
    expect(json).toContain('"type": "MAMModule"');
    expect(json).toContain('"Purpose"');
  });

  it('should serialize to compact JSON', () => {
    const mod = createTestModule();
    const json = serializeToJSON(mod, 'compact');
    expect(json).not.toContain('\n');
  });

  it('should deserialize from JSON', () => {
    const mod = createTestModule();
    const json = serializeToJSON(mod);
    const parsed = deserializeFromJSON(json);
    expect(parsed.type).toBe('MAMModule');
    expect(parsed.frontmatter?.data.id).toBe('test');
    expect(parsed.sections).toHaveLength(2);
  });

  it('should deserialize complex module', () => {
    const mod = createComplexModule();
    const json = serializeToJSON(mod);
    const parsed = deserializeFromJSON(json);
    expect(parsed.sections).toHaveLength(3);
    expect(parsed.sections[1].content[0].type).toBe('List');
  });

  it('should pretty print', () => {
    const mod = createTestModule();
    const output = prettyPrint(mod);
    expect(output).toContain('MAMModule');
    expect(output).toContain('Sections: 2');
    expect(output).toContain('Purpose');
    expect(output).toContain('codeBlocks: 1');
    expect(output).toContain('python');
  });

  it('should get AST stats', () => {
    const mod = createComplexModule();
    const stats = getASTStats(mod);
    expect(stats.totalSections).toBe(3);
    expect(stats.totalNodes).toBeGreaterThan(0);
  });

  it('should get stats for simple module', () => {
    const mod = createTestModule();
    const stats = getASTStats(mod);
    expect(stats.totalSections).toBe(2);
    expect(stats.totalCodeBlocks).toBe(1);
    expect(stats.languages).toContain('python');
  });

  it('should roundtrip serialize/deserialize', () => {
    const mod = createComplexModule();
    const json = serializeToJSON(mod);
    const parsed = deserializeFromJSON(json);
    const json2 = serializeToJSON(parsed);
    expect(json).toBe(json2);
  });
});

describe('Advanced JSON Serialization', () => {
  it('should serialize with options', () => {
    const mod = createTestModule();
    const json = serializeToJSONAdvanced(mod, { indent: 4 });
    expect(json).toContain('"type": "MAMModule"');
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('MAMModule');
  });

  it('should serialize without location', () => {
    const mod = createTestModule();
    const json = serializeToJSONAdvanced(mod, { includeLocation: false });
    const parsed = JSON.parse(json);
    expect(parsed.location).toBeUndefined();
  });

  it('should serialize without metadata', () => {
    const mod = createTestModule();
    const json = serializeToJSONAdvanced(mod, { includeMetadata: false });
    const parsed = JSON.parse(json);
    expect(parsed.metadata).toBeUndefined();
  });

  it('should compact serialize', () => {
    const mod = createTestModule();
    const json = compactSerialize(mod);
    expect(json.length).toBeLessThan(serializeToJSONAdvanced(mod).length);
  });

  it('should astToJSON deep clone', () => {
    const mod = createTestModule();
    const obj = astToJSON(mod);
    expect(obj.type).toBe('MAMModule');
    // Verify it's a plain object (no functions, undefined)
    expect(typeof obj).toBe('object');
  });

  it('should patchAST', () => {
    const mod = createTestModule();
    const patched = patchAST(mod, {
      metadata: {
        sectionCount: 99,
        codeBlockCount: 0,
        languages: [],
        customSections: [],
      },
    });
    expect(patched.metadata.sectionCount).toBe(99);
    expect(patched.frontmatter?.data.id).toBe('test');
  });

  it('should patchAST sections', () => {
    const mod = createTestModule();
    const patched = patchAST(mod, {
      sections: [
        {
          type: 'Section',
          name: 'New',
          level: 2,
          content: [],
          location: loc(),
          attributes: { required: false, isCustom: false, contentTypes: [] },
        },
      ],
    });
    expect(patched.sections).toHaveLength(1);
    expect(patched.sections[0].name).toBe('New');
  });
});

describe('JSON Schema Validation', () => {
  it('should validate valid AST', () => {
    const mod = createTestModule();
    const result = validateJSONSchema(mod);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-object root', () => {
    const result = validateJSONSchema('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject wrong root type', () => {
    const result = validateJSONSchema({ type: 'Wrong' });
    expect(result.valid).toBe(false);
  });

  it('should reject missing sections array', () => {
    const result = validateJSONSchema({ type: 'MAMModule' });
    expect(result.valid).toBe(false);
  });

  it('should validate sections structure', () => {
    const data = {
      type: 'MAMModule',
      sections: [
        { type: 'Section', name: 'Test', level: 2, content: [] },
      ],
    };
    const result = validateJSONSchema(data);
    expect(result.valid).toBe(true);
  });

  it('should detect invalid section type', () => {
    const data = {
      type: 'MAMModule',
      sections: [
        { type: 'Wrong', name: 'Test', level: 2, content: [] },
      ],
    };
    const result = validateJSONSchema(data);
    expect(result.valid).toBe(false);
  });

  it('should detect missing section name', () => {
    const data = {
      type: 'MAMModule',
      sections: [
        { type: 'Section', level: 2, content: [] },
      ],
    };
    const result = validateJSONSchema(data);
    expect(result.valid).toBe(false);
  });

  it('should handle null frontmatter', () => {
    const data = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [],
    };
    const result = validateJSONSchema(data);
    expect(result.valid).toBe(true);
  });
});

describe('Advanced Deserialization', () => {
  it('should deserialize from JSON string', () => {
    const mod = createTestModule();
    const json = serializeToJSONAdvanced(mod);
    const parsed = deserializeFromJSONAdvanced(json);
    expect(parsed.type).toBe('MAMModule');
    expect(parsed.frontmatter?.data.id).toBe('test');
  });

  it('should throw on invalid JSON', () => {
    expect(() => deserializeFromJSONAdvanced('not json')).toThrow();
  });

  it('should throw on invalid AST type', () => {
    expect(() => deserializeFromJSONAdvanced('{"type":"Wrong"}')).toThrow();
  });

  it('should validate on deserialize', () => {
    expect(() =>
      deserializeFromJSONAdvanced('{"type":"Wrong"}', { validate: true })
    ).toThrow();
  });

  it('should skip validation when validate=false', () => {
    // This should not throw even with invalid structure
    const result = deserializeFromJSONAdvanced(
      '{"type":"MAMModule","sections":[]}',
      { validate: false }
    );
    expect(result.type).toBe('MAMModule');
  });

  it('should apply transform function', () => {
    const mod = createTestModule();
    const json = serializeToJSONAdvanced(mod);
    const parsed = deserializeFromJSONAdvanced(json, {
      transform: (node) => {
        // Transform is applied per node
        return node;
      },
    });
    expect(parsed.type).toBe('MAMModule');
  });
});

describe('Error Handling', () => {
  it('should throw on malformed JSON', () => {
    expect(() => deserializeFromJSON('{invalid')).toThrow();
  });

  it('should handle missing sections gracefully', () => {
    const result = deserializeFromJSON('{"type":"MAMModule"}');
    expect(result.type).toBe('MAMModule');
    expect(result.sections).toEqual([]);
  });

  it('should throw on non-object root', () => {
    expect(() => deserializeFromJSON('"string"')).toThrow();
  });

  it('should handle empty sections array', () => {
    const mod = createTestModule();
    mod.sections = [];
    const json = serializeToJSON(mod);
    const parsed = deserializeFromJSON(json);
    expect(parsed.sections).toHaveLength(0);
  });
});

describe('Cycle Detection', () => {
  it('should throw on cycle during serialization', () => {
    const mod = createTestModule();
    // Create a circular reference
    const anyMod = mod as any;
    anyMod.self = anyMod;
    expect(() => serializeToJSONAdvanced(anyMod)).toThrow('Cycle detected');
  });
});

describe('YAML Serialization', () => {
  it('should serialize to YAML', () => {
    const mod = createTestModule();
    const yaml = serializeToYAML(mod);
    expect(yaml).toContain('---');
    expect(yaml).toContain('type:');
  });

  it('should serialize without document marker', () => {
    const mod = createTestModule();
    const yaml = serializeToYAML(mod, { documentMarker: false });
    expect(yaml).not.toContain('---');
  });

  it('should serialize with sorted keys', () => {
    const mod = createTestModule();
    const yaml = serializeToYAML(mod, { sortKeys: true });
    expect(yaml).toContain('type:');
  });

  it('should serialize empty module', () => {
    const mod: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [],
      location: loc(),
      metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [] },
    };
    const yaml = serializeToYAML(mod);
    expect(yaml).toContain('type:');
  });

  it('should deserialize from YAML (basic)', () => {
    const mod = createTestModule();
    const yaml = serializeToYAML(mod);
    const parsed = deserializeFromYAML(yaml);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');
  });

  it('should handle multiline strings in YAML', () => {
    const mod = createTestModule();
    mod.sections[0].content[0] = {
      type: 'Paragraph',
      value: 'Line 1\nLine 2\nLine 3',
      inlineNodes: [],
      location: loc(),
    };
    const yaml = serializeToYAML(mod);
    expect(yaml).toContain('Line 1');
  });

  it('should handle special characters in YAML', () => {
    const mod = createTestModule();
    mod.frontmatter!.data.name = 'Test: Module with "quotes" & special chars';
    const yaml = serializeToYAML(mod);
    expect(yaml).toContain('Test');
  });
});

describe('Pretty Print Edge Cases', () => {
  it('should handle module without frontmatter', () => {
    const mod = createTestModule();
    mod.frontmatter = null;
    const output = prettyPrint(mod);
    expect(output).toContain('MAMModule');
    expect(output).toContain('Sections: 2');
  });

  it('should handle empty sections', () => {
    const mod = createTestModule();
    mod.sections = [];
    const output = prettyPrint(mod);
    expect(output).toContain('Sections: 0');
  });

  it('should handle multiple code blocks in stats', () => {
    const mod = createComplexModule();
    mod.sections.push({
      type: 'Section',
      name: 'More Code',
      level: 2,
      content: [
        {
          type: 'CodeBlock',
          language: 'javascript',
          value: 'console.log("hi")',
          metadata: {},
          executable: true,
          location: loc(),
        },
      ],
      location: loc(),
      attributes: { required: false, isCustom: false, contentTypes: ['code'] },
    });
    const stats = getASTStats(mod);
    expect(stats.totalCodeBlocks).toBe(1);
    expect(stats.languages).toContain('javascript');
  });
});

describe('JSON Helper Utilities', () => {
  it('should estimate JSON size', () => {
    const mod = createTestModule();
    expect(estimateJSONSize(mod)).toBe(JSON.stringify(mod).length);
    expect(estimateJSONSize(mod)).toBeGreaterThan(0);
  });

  it('should produce stable canonical serialization', () => {
    const a = { type: 'MAMModule', frontmatter: null, sections: [] } as unknown as MAMModule;
    const b = { sections: [], frontmatter: null, type: 'MAMModule' } as unknown as MAMModule;
    expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
    expect(canonicalSerialize(createTestModule())).toBe(
      canonicalSerialize(createTestModule())
    );
  });

  it('should hash AST deterministically', () => {
    const hash = hashAST(createTestModule());
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(hashAST(createTestModule())).toBe(hash);
    expect(hashAST(createComplexModule())).not.toBe(hash);
  });

  it('should strip locations without mutating input', () => {
    const mod = createTestModule();
    const stripped = stripLocations(mod);
    expect(stripped.location).toBeUndefined();
    expect(stripped.sections[0].location).toBeUndefined();
    expect(JSON.stringify(stripped)).not.toContain('"location"');
    expect(mod.location).toBeDefined();
    expect(mod.sections[0].location).toBeDefined();
  });

  it('should diff AST changes', () => {
    const a = createTestModule();
    const b = createTestModule();
    b.frontmatter!.data.id = 'changed';
    const diffs = diffAST(a, b);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.some((d) => d.kind === 'changed' && d.path.includes('id'))).toBe(true);
    expect(diffAST(createTestModule(), createTestModule())).toEqual([]);
  });

  it('should validate round-trip fidelity', () => {
    const result = validateRoundTrip(createTestModule());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    const bad = validateRoundTrip({ type: 'Wrong' } as unknown as MAMModule);
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it('should detect plain AST objects', () => {
    class Foo {}
    expect(isPlainASTObject({})).toBe(true);
    expect(isPlainASTObject(createTestModule())).toBe(true);
    expect(isPlainASTObject([])).toBe(false);
    expect(isPlainASTObject(null)).toBe(false);
    expect(isPlainASTObject('str')).toBe(false);
    expect(isPlainASTObject(new Foo())).toBe(false);
  });
});

describe('YAML Helper Utilities', () => {
  it('should escape YAML strings', () => {
    expect(escapeYAMLString('a"b')).toBe('a\\"b');
    expect(escapeYAMLString('line1\nline2')).toBe('line1\\nline2');
    expect(escapeYAMLString('tab\there')).toBe('tab\\there');
    expect(escapeYAMLString('back\\slash')).toBe('back\\\\slash');
    expect(escapeYAMLString('plain')).toBe('plain');
  });

  it('should detect and normalize YAML indentation', () => {
    expect(detectYAMLIndent('root:\n  child: 1')).toBe(2);
    expect(detectYAMLIndent('root:\nchild: 1')).toBe(0);
    expect(detectYAMLIndent('')).toBe(0);
    expect(normalizeYAMLIndent('a:\n    b: 1', 2)).toBe('a:\n  b: 1');
    expect(normalizeYAMLIndent('a:\nb: 1', 4)).toBe('a:\nb: 1');
    expect(normalizeYAMLIndent('a:\n  b: 1', 2)).toBe('a:\n  b: 1');
  });

  it('should validate YAML shape', () => {
    expect(validateYAMLShape('').valid).toBe(false);
    expect(validateYAMLShape('a: 1\nb: 2').valid).toBe(true);
    expect(validateYAMLShape('a: 1\n\ta: 2').valid).toBe(false);
    const dup = validateYAMLShape('a: 1\nb: 2\na: 3');
    expect(dup.valid).toBe(false);
    expect(dup.errors.some((e) => e.includes('duplicate'))).toBe(true);
  });

  it('should serialize front matter to YAML and parse flat maps back', () => {
    const yaml = serializeFrontMatterToYAML({ id: 'demo', name: 'Demo' });
    expect(yaml).toContain('id: demo');
    expect(yaml).toContain('name: Demo');
    const parsed = parseFlatYAMLMap(yaml);
    expect(parsed.id).toBe('demo');
    expect(parsed.name).toBe('Demo');
    const quoted = parseFlatYAMLMap('id: "demo"\nname: \'test\'\n  nested: skip');
    expect(quoted).toEqual({ id: 'demo', name: 'test' });
  });

  it('should detect YAML document markers', () => {
    expect(yamlHasDocumentMarkers('---\ntype: MAMModule')).toBe(true);
    expect(yamlHasDocumentMarkers('type: MAMModule\n...')).toBe(true);
    expect(yamlHasDocumentMarkers('type: MAMModule')).toBe(false);
  });
});

describe('Serializer Index Utilities', () => {
  it('should find section by name and summarize sections', () => {
    const mod = createTestModule();
    expect(findSectionByName(mod, 'Purpose')?.name).toBe('Purpose');
    expect(findSectionByName(mod, 'Python')?.content).toHaveLength(1);
    expect(findSectionByName(mod, 'Missing')).toBeUndefined();
    const summaries = getSectionSummaries(mod);
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toEqual({
      name: 'Purpose',
      level: 2,
      contentCount: 1,
      types: ['Paragraph'],
    });
  });

  it('should collect languages and count inline nodes', () => {
    expect(collectLanguages(createTestModule())).toEqual(['python']);
    expect(collectLanguages(createComplexModule())).toEqual([]);
    expect(countInlineNodes(createTestModule())).toBe(0);
    expect(countInlineNodes(createComplexModule())).toBe(4);
  });

  it('should build an AST outline', () => {
    const outline = astOutline(createTestModule());
    expect(outline).toEqual([
      'MAMModule',
      '  FrontMatter',
      '  Section(Purpose)',
      '    Paragraph',
      '  Section(Python)',
      '    CodeBlock',
    ]);
  });

  it('should round-trip clone a module', () => {
    const mod = createTestModule();
    const clone = roundTripClone(mod);
    expect(clone).not.toBe(mod);
    expect(clone.sections).not.toBe(mod.sections);
    expect(clone.type).toBe('MAMModule');
    expect(clone.sections).toHaveLength(2);
    expect(clone.sections[0].name).toBe('Purpose');
    expect(clone.frontmatter?.data.id).toBe('test');
  });

  it('should compute AST complexity', () => {
    const complexity = getASTComplexity(createTestModule());
    expect(complexity.sections).toBe(2);
    expect(complexity.depth).toBe(3);
    expect(complexity.maxSectionContent).toBe(1);
    expect(complexity.inlineNodes).toBe(0);
    expect(complexity.totalNodes).toBe(6);
    const complex = getASTComplexity(createComplexModule());
    expect(complex.sections).toBe(3);
    expect(complex.inlineNodes).toBe(4);
    expect(complex.maxSectionContent).toBe(4);
  });
});
