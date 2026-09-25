import { describe, it, expect } from 'vitest';
import {
  MAMModule,
  fromAST,
  fromMarkdown,
  diffModules,
  compareModules,
} from '../mam/mam.js';
import { parseMAM } from '../mam/parser.js';
import type { AST, ContentNode } from '../mam/parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAST(content: string): AST {
  return parseMAM(content).ast;
}

// ---------------------------------------------------------------------------
// MAMModule class
// ---------------------------------------------------------------------------

describe('MAMModule', () => {
  describe('constructor', () => {
    it('creates a module with defaults', () => {
      const mod = new MAMModule({ name: 'test' });
      expect(mod.name).toBe('test');
      expect(mod.version).toBe('0.1.0');
      expect(mod.runtime).toBe('python');
      expect(mod.id).toBe('test');
      expect(mod.sections).toHaveLength(0);
    });

    it('creates a module with custom config', () => {
      const mod = new MAMModule({
        name: 'My Module',
        version: '2.0.0',
        author: 'Alice',
        description: 'A module',
        runtime: 'javascript',
        tags: ['test'],
        permissions: ['network'],
        dependencies: ['lodash >= 4.0'],
      });
      expect(mod.name).toBe('My Module');
      expect(mod.version).toBe('2.0.0');
      expect(mod.author).toBe('Alice');
      expect(mod.description).toBe('A module');
      expect(mod.runtime).toBe('javascript');
      expect(mod.tags).toEqual(['test']);
      expect(mod.permissions).toEqual(['network']);
      expect(mod.dependencies).toEqual(['lodash >= 4.0']);
    });
  });

  describe('fluent setters', () => {
    it('supports chaining', () => {
      const mod = new MAMModule({ name: 'test' })
        .setName('renamed')
        .setVersion('1.2.3')
        .setAuthor('Bob')
        .setDescription('desc')
        .setRuntime('javascript')
        .setTags(['a', 'b'])
        .setPermissions(['fs'])
        .setDependencies(['dep']);
      expect(mod.name).toBe('renamed');
      expect(mod.version).toBe('1.2.3');
      expect(mod.author).toBe('Bob');
      expect(mod.description).toBe('desc');
      expect(mod.runtime).toBe('javascript');
      expect(mod.tags).toEqual(['a', 'b']);
      expect(mod.permissions).toEqual(['fs']);
      expect(mod.dependencies).toEqual(['dep']);
    });
  });

  describe('section management', () => {
    it('adds sections', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'A purpose.');
      expect(mod.sections).toHaveLength(1);
      expect(mod.sections[0].name).toBe('Purpose');
    });

    it('replaces existing sections with same name', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'First');
      mod.addSectionText('Purpose', 'Second');
      expect(mod.sections).toHaveLength(1);
      expect(mod.sections[0].content[0].value).toBe('Second');
    });

    it('adds list sections', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionList('Rules', ['Rule 1', 'Rule 2']);
      expect(mod.sections[0].content[0].type).toBe('List');
      expect(mod.sections[0].content[0].items).toEqual(['Rule 1', 'Rule 2']);
    });

    it('adds code sections', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionCode('Python', 'python', 'print("hello")');
      expect(mod.sections[0].content[0].type).toBe('CodeBlock');
      expect(mod.sections[0].content[0].language).toBe('python');
    });

    it('gets sections by name', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'test');
      expect(mod.getSection('Purpose')).toBeDefined();
      expect(mod.getSection('Nonexistent')).toBeUndefined();
    });

    it('checks section existence', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'test');
      expect(mod.hasSection('Purpose')).toBe(true);
      expect(mod.hasSection('Nope')).toBe(false);
    });

    it('lists section names', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'test');
      mod.addSectionText('Rules', 'rules');
      expect(mod.sectionNames()).toEqual(['Purpose', 'Rules']);
    });

    it('removes sections', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'test');
      mod.addSectionText('Rules', 'rules');
      mod.removeSection('Purpose');
      expect(mod.sections).toHaveLength(1);
      expect(mod.sectionNames()).toEqual(['Rules']);
    });

    it('removes non-existent section without error', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.removeSection('Nothing');
      expect(mod.sections).toHaveLength(0);
    });
  });

  describe('toJSON', () => {
    it('serializes to JSON', () => {
      const mod = new MAMModule({ name: 'test', version: '1.0.0', author: 'A' });
      mod.addSectionText('Purpose', 'A test.');
      const json = mod.toJSON();
      expect(json.frontmatter).toBeDefined();
      expect(json.sections).toBeDefined();
      expect((json.frontmatter as Record<string, unknown>).name).toBe('test');
      expect((json.sections as unknown[])).toHaveLength(1);
    });
  });

  describe('toYAML', () => {
    it('serializes to YAML string', () => {
      const mod = new MAMModule({ name: 'test', version: '1.0.0', author: 'A' });
      mod.addSectionText('Purpose', 'A test.');
      mod.addSectionList('Rules', ['Rule 1']);
      const yaml = mod.toYAML();
      expect(yaml).toContain('---');
      expect(yaml).toContain('name: test');
      expect(yaml).toContain('## Purpose');
      expect(yaml).toContain('## Rules');
      expect(yaml).toContain('- Rule 1');
    });
  });

  describe('toMarkdown', () => {
    it('produces same output as toYAML', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'test');
      expect(mod.toMarkdown()).toBe(mod.toYAML());
    });
  });

  describe('toAST', () => {
    it('builds a valid AST', () => {
      const mod = new MAMModule({ name: 'test', version: '1.0.0', author: 'A', runtime: 'python' });
      mod.addSectionText('Purpose', 'test');
      mod.addSectionCode('Python', 'python', 'x = 1');
      const ast = mod.toAST();
      expect(ast.type).toBe('MAMModule');
      expect(ast.frontmatter).not.toBeNull();
      expect(ast.frontmatter!.data.name).toBe('test');
      expect(ast.sections).toHaveLength(2);
      expect(ast.metadata.totalCodeBlocks).toBe(1);
    });
  });

  describe('clone', () => {
    it('creates an independent copy', () => {
      const mod = new MAMModule({ name: 'test' });
      mod.addSectionText('Purpose', 'original');
      const cloned = mod.clone();
      cloned.sections[0].content[0].value = 'modified';
      expect(mod.sections[0].content[0].value).toBe('original');
    });
  });
});

// ---------------------------------------------------------------------------
// fromAST
// ---------------------------------------------------------------------------

describe('fromAST', () => {
  it('creates MAMModule from AST', () => {
    const content = `---
id: from-ast
version: 2.0.0
name: From AST
author: Test
runtime: python
tags:
  - tag1
---

## Purpose

Test.

## Rules

- Rule 1
`;
    const ast = makeAST(content);
    const mod = fromAST(ast);
    expect(mod.name).toBe('From AST');
    expect(mod.version).toBe('2.0.0');
    expect(mod.id).toBe('from-ast');
    expect(mod.tags).toEqual(['tag1']);
    expect(mod.hasSection('Purpose')).toBe(true);
    expect(mod.hasSection('Rules')).toBe(true);
  });

  it('handles AST with no frontmatter', () => {
    const ast: AST = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [],
      location: {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
        source: '<test>',
      },
      metadata: { totalSections: 0, totalCodeBlocks: 0, totalLines: 0, sourceName: '<test>' },
    };
    const mod = fromAST(ast);
    expect(mod.name).toBe('unnamed');
  });
});

// ---------------------------------------------------------------------------
// fromMarkdown
// ---------------------------------------------------------------------------

describe('fromMarkdown', () => {
  it('creates MAMModule from raw markdown', () => {
    const content = `---
id: from-md
version: 2.0.0
name: From Markdown
author: Test
runtime: javascript
---

## Purpose

Parsed from markdown.

## JavaScript

\`\`\`javascript
output = 42;
\`\`\`
`;
    const mod = fromMarkdown(content);
    expect(mod.name).toBe('From Markdown');
    expect(mod.hasSection('Purpose')).toBe(true);
    expect(mod.hasSection('JavaScript')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// diffModules
// ---------------------------------------------------------------------------

describe('diffModules', () => {
  it('detects identical modules', () => {
    const mod1 = new MAMModule({ name: 'test', version: '1.0.0' });
    mod1.addSectionText('Purpose', 'test');
    const mod2 = new MAMModule({ name: 'test', version: '1.0.0' });
    mod2.addSectionText('Purpose', 'test');
    const diff = diffModules(mod1, mod2);
    expect(diff.identical).toBe(true);
    expect(diff.changes).toHaveLength(0);
  });

  it('detects frontmatter differences', () => {
    const mod1 = new MAMModule({ name: 'test', version: '1.0.0' });
    const mod2 = new MAMModule({ name: 'test', version: '2.0.0' });
    const diff = diffModules(mod1, mod2);
    expect(diff.identical).toBe(false);
    expect(diff.summary.modified).toBeGreaterThan(0);
  });

  it('detects added sections', () => {
    const mod1 = new MAMModule({ name: 'test' });
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'new');
    const diff = diffModules(mod1, mod2);
    expect(diff.summary.added).toBeGreaterThan(0);
  });

  it('detects removed sections', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'old');
    const mod2 = new MAMModule({ name: 'test' });
    const diff = diffModules(mod1, mod2);
    expect(diff.summary.removed).toBeGreaterThan(0);
  });

  it('detects modified section content', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'old content');
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'new content');
    const diff = diffModules(mod1, mod2);
    expect(diff.identical).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// compareModules
// ---------------------------------------------------------------------------

describe('compareModules', () => {
  it('returns empty diffs for identical modules', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'test');
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'test');
    const result = compareModules(mod1, mod2);
    expect(result.frontmatter).toHaveLength(0);
    expect(result.sections).toHaveLength(0);
    expect(result.content).toHaveLength(0);
  });

  it('detects frontmatter changes', () => {
    const mod1 = new MAMModule({ name: 'test', version: '1.0.0' });
    const mod2 = new MAMModule({ name: 'test', version: '2.0.0' });
    const result = compareModules(mod1, mod2);
    expect(result.frontmatter.length).toBeGreaterThan(0);
  });

  it('detects section additions and removals', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'test');
    mod1.addSectionText('Rules', 'rules');
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'test');
    mod2.addSectionText('Examples', 'examples');
    const result = compareModules(mod1, mod2);
    expect(result.sections.some((c) => c.type === 'removed')).toBe(true);
    expect(result.sections.some((c) => c.type === 'added')).toBe(true);
  });

  it('detects content changes within sections', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'old');
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'new');
    const result = compareModules(mod1, mod2);
    expect(result.content.some((c) => c.type === 'modified')).toBe(true);
  });

  it('detects added content nodes', () => {
    const mod1 = new MAMModule({ name: 'test' });
    mod1.addSectionText('Purpose', 'test');
    const mod2 = new MAMModule({ name: 'test' });
    mod2.addSectionText('Purpose', 'test');
    // Manually append an extra content node to the section
    const section = mod2.getSection('Purpose')!;
    (section.content as ContentNode[]).push({
      type: 'CodeBlock',
      value: 'x = 1',
      language: 'javascript',
      location: {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
        source: '<test>',
      },
    });
    const result = compareModules(mod1, mod2);
    expect(result.content.some((c) => c.type === 'added')).toBe(true);
  });
});

describe('MAMModule accessor methods', () => {
  it('getName returns the configured name', () => {
    const mod = new MAMModule({ name: 'alpha' });
    expect(mod.getName()).toBe('alpha');
    mod.setName('beta');
    expect(mod.getName()).toBe('beta');
  });

  it('getVersion returns the version with a fallback', () => {
    expect(new MAMModule({ name: 'a' }).getVersion()).toBe('0.1.0');
    const mod = new MAMModule({ name: 'a', version: '3.1.4' });
    expect(mod.getVersion()).toBe('3.1.4');
    mod.setVersion('9.9.9');
    expect(mod.getVersion()).toBe('9.9.9');
  });

  it('getConfig returns a defensive copy', () => {
    const mod = new MAMModule({ name: 'a', tags: ['x'], permissions: ['p'], dependencies: ['d'] });
    const config = mod.getConfig();
    expect(config.name).toBe('a');
    expect(config.tags).toEqual(['x']);
    config.tags.push('mutated');
    config.permissions!.push('mutated');
    expect(mod.getConfig().tags).toEqual(['x']);
    expect(mod.getConfig().permissions).toEqual(['p']);
  });

  it('sectionCount and isEmpty reflect sections', () => {
    const mod = new MAMModule({ name: 'a' });
    expect(mod.sectionCount()).toBe(0);
    expect(mod.isEmpty()).toBe(true);
    mod.addSectionText('Purpose', 'hi');
    expect(mod.sectionCount()).toBe(1);
    expect(mod.isEmpty()).toBe(false);
  });

  it('hasContent reports non-empty sections', () => {
    const mod = new MAMModule({ name: 'a' });
    expect(mod.hasContent('Purpose')).toBe(false);
    mod.addSectionText('Purpose', 'body');
    expect(mod.hasContent('Purpose')).toBe(true);
    expect(mod.hasContent('Missing')).toBe(false);
  });

  it('toSummary describes the module', () => {
    const mod = new MAMModule({ name: 'demo' });
    expect(mod.toSummary()).toContain('demo');
    expect(mod.toSummary()).toContain('0 sections');
    mod.addSectionCode('Python', 'python', 'print(1)');
    expect(mod.toSummary()).toContain('1 sections');
    expect(mod.toSummary()).toContain('1 code blocks');
  });

  it('toSummary handles untitled modules', () => {
    const mod = new MAMModule({ name: '' });
    expect(mod.toSummary()).toContain('(untitled)');
  });
});
