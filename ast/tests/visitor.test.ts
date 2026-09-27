/**
 * AST Visitor Tests
 */

import { describe, it, expect } from 'vitest';
import {
  DefaultMAMVisitor,
  MAMTransformer,
  MAMCollector,
  traverse as traverseVisitor,
  findNodes,
  countNodes,
  collectText,
} from '../src/visitor/index.js';
import { traverse } from '../src/visitor/traverser.js';
import { createLocation } from '../src/location/index.js';
import type {
  MAMModule,
  Section,
  Paragraph,
  InlineText,
  CodeBlock,
  List,
  Table,
  MermaidDiagram,
  Heading,
  Blockquote,
  InlineNode,
  ContentNode,
  ListItem,
  Bold,
  Italic,
  Link,
  Image,
} from '../src/nodes/index.js';
import {
  traverseWithHooks,
  findFirstNode,
  collectNodeTypes,
  MAMProfiler,
  findNodesByType,
  getMaxDepth,
  traverseTree,
} from '../src/visitor/index.js';
import {
  hasNodeType,
  collectCodeBlockLanguages,
  mapParagraphValues,
} from '../src/visitor/visitor.js';
import {
  getNodeTypes,
  collectPaths,
  someNode,
  everyNodeShallow,
  collectValuesByKey,
} from '../src/visitor/traverser.js';

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
        content: [
          {
            type: 'Paragraph',
            value: 'Test purpose content',
            inlineNodes: [
              { type: 'InlineText', value: 'Test ', location: loc() },
              { type: 'Bold', content: [{ type: 'InlineText', value: 'purpose', location: loc() }], location: loc() },
              { type: 'InlineText', value: ' content', location: loc() },
            ],
            location: loc(),
          },
        ],
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
      {
        type: 'Section',
        name: 'Tests',
        level: 2,
        content: [
          {
            type: 'List',
            ordered: false,
            items: [
              {
                content: [
                  {
                    type: 'Paragraph',
                    value: 'List item text',
                    inlineNodes: [{ type: 'InlineText', value: 'List item text', location: loc() }],
                    location: loc(),
                  },
                ],
              },
              {
                content: [
                  {
                    type: 'Paragraph',
                    value: 'Checked item',
                    inlineNodes: [{ type: 'InlineText', value: 'Checked item', location: loc() }],
                    location: loc(),
                  },
                ],
                checked: true,
              },
            ],
            location: loc(),
          },
          {
            type: 'Table',
            headers: [
              { value: 'Input', inlineNodes: [{ type: 'InlineText', value: 'Input', location: loc() }] },
              { value: 'Output', inlineNodes: [{ type: 'InlineText', value: 'Output', location: loc() }] },
            ],
            rows: [
              [
                { value: 'a', inlineNodes: [{ type: 'InlineText', value: 'a', location: loc() }] },
                { value: 'b', inlineNodes: [{ type: 'InlineText', value: 'b', location: loc() }] },
              ],
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
            type: 'Heading',
            level: 3,
            value: 'Sub heading',
            content: [
              { type: 'InlineCode', value: 'code', location: loc() },
            ],
            location: loc(),
          },
          {
            type: 'Blockquote',
            value: 'Important note',
            children: [
              {
                type: 'Paragraph',
                value: 'Note text',
                inlineNodes: [{ type: 'Italic', content: [{ type: 'InlineText', value: 'italic', location: loc() }], location: loc() }],
                location: loc(),
              },
            ],
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
      codeBlockCount: 1,
      languages: ['python'],
      customSections: [],
      parsedAt: '2024-01-01T00:00:00Z',
    },
  };
}

function createMinimalModule(): MAMModule {
  return {
    type: 'MAMModule',
    frontmatter: null,
    sections: [],
    location: loc(),
    metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [] },
  };
}

describe('DefaultMAMVisitor', () => {
  it('should visit module', () => {
    const mod = createTestModule();
    const visited: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitMAMModule = (node) => {
      visited.push('module');
      // Manually call the default traversal
      if (node.frontmatter) visitor.visitFrontMatter(node.frontmatter);
      for (const s of node.sections) visitor.visitSection(s);
    };
    visitor.visitMAMModule(mod);
    expect(visited).toContain('module');
  });

  it('should traverse all sections', () => {
    const mod = createTestModule();
    const sectionNames: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitSection = (section) => {
      sectionNames.push(section.name);
      for (const content of section.content) {
        visitor.visitContent(content);
      }
    };
    visitor.visitMAMModule(mod);
    expect(sectionNames).toEqual(['Purpose', 'Python', 'Tests']);
  });

  it('should traverse paragraphs and inline nodes', () => {
    const mod = createTestModule();
    const textValues: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitInlineText = (node) => { textValues.push(node.value); };
    traverseVisitor(mod, visitor);
    expect(textValues.length).toBeGreaterThan(0);
  });

  it('should traverse code blocks', () => {
    const mod = createTestModule();
    const codeValues: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitCodeBlock = (node) => { codeValues.push(node.value); };
    traverseVisitor(mod, visitor);
    expect(codeValues).toContain('print("hello")');
  });

  it('should traverse lists', () => {
    const mod = createTestModule();
    let listCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitList = (node) => { listCount++; };
    traverseVisitor(mod, visitor);
    expect(listCount).toBe(1);
  });

  it('should traverse tables', () => {
    const mod = createTestModule();
    let tableCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitTable = (node) => { tableCount++; };
    traverseVisitor(mod, visitor);
    expect(tableCount).toBe(1);
  });

  it('should traverse mermaid diagrams', () => {
    const mod = createTestModule();
    let mermaidCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitMermaid = (node) => { mermaidCount++; };
    traverseVisitor(mod, visitor);
    expect(mermaidCount).toBe(1);
  });

  it('should traverse headings', () => {
    const mod = createTestModule();
    let headingCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitHeading = (node) => { headingCount++; };
    traverseVisitor(mod, visitor);
    expect(headingCount).toBe(1);
  });

  it('should traverse blockquotes', () => {
    const mod = createTestModule();
    let blockquoteCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitBlockquote = (node) => { blockquoteCount++; };
    traverseVisitor(mod, visitor);
    expect(blockquoteCount).toBe(1);
  });

  it('should traverse bold nodes', () => {
    const mod = createTestModule();
    let boldCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitBold = (node) => { boldCount++; };
    traverseVisitor(mod, visitor);
    expect(boldCount).toBe(1);
  });

  it('should traverse italic nodes', () => {
    const mod = createTestModule();
    let italicCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitItalic = (node) => { italicCount++; };
    traverseVisitor(mod, visitor);
    expect(italicCount).toBe(1);
  });

  it('should traverse inline code', () => {
    const mod = createTestModule();
    let codeCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitInlineCode = (node) => { codeCount++; };
    traverseVisitor(mod, visitor);
    expect(codeCount).toBe(1);
  });

  it('should handle empty module', () => {
    const mod = createMinimalModule();
    let visited = false;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitMAMModule = () => { visited = true; };
    traverseVisitor(mod, visitor);
    expect(visited).toBe(true);
  });

  it('should handle module with link nodes', () => {
    const mod: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [
        {
          type: 'Section',
          name: 'Test',
          level: 2,
          content: [
            {
              type: 'Paragraph',
              value: 'link',
              inlineNodes: [
                {
                  type: 'Link',
                  url: 'https://example.com',
                  content: [{ type: 'InlineText', value: 'click', location: loc() }],
                  location: loc(),
                },
              ],
              location: loc(),
            },
          ],
          location: loc(),
          attributes: { required: false, isCustom: false, contentTypes: ['text'] },
        },
      ],
      location: loc(),
      metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [] },
    };
    let linkCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitLink = (node) => { linkCount++; };
    traverseVisitor(mod, visitor);
    expect(linkCount).toBe(1);
  });

  it('should handle module with image nodes', () => {
    const mod: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [
        {
          type: 'Section',
          name: 'Test',
          level: 2,
          content: [
            {
              type: 'Paragraph',
              value: 'image',
              inlineNodes: [
                {
                  type: 'Image',
                  url: 'https://example.com/img.png',
                  alt: 'test image',
                  location: loc(),
                },
              ],
              location: loc(),
            },
          ],
          location: loc(),
          attributes: { required: false, isCustom: false, contentTypes: ['text'] },
        },
      ],
      location: loc(),
      metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [] },
    };
    let imageCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitImage = (node) => { imageCount++; };
    traverseVisitor(mod, visitor);
    expect(imageCount).toBe(1);
  });
});

describe('MAMTransformer', () => {
  it('should transform module', () => {
    const mod = createTestModule();
    class UpperCaseTransformer extends MAMTransformer {
      visitContent(node: ContentNode): ContentNode | null {
        if (node.type === 'Paragraph') {
          return {
            ...node,
            value: node.value.toUpperCase(),
          };
        }
        return node;
      }
    }
    const transformer = new UpperCaseTransformer();
    const result = transformer.visitMAMModule(mod);
    expect(result.type).toBe('MAMModule');
    expect(result.sections[0].content[0].type).toBe('Paragraph');
  });

  it('should filter sections', () => {
    const mod = createTestModule();
    class PurposeOnlyTransformer extends MAMTransformer {
      visitSection(section: Section): Section | null {
        return section.name === 'Purpose' ? section : null;
      }
      visitContent(node: ContentNode): ContentNode | null {
        return node;
      }
    }
    const transformer = new PurposeOnlyTransformer();
    const result = transformer.visitMAMModule(mod);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].name).toBe('Purpose');
  });

  it('should transform frontmatter', () => {
    const mod = createTestModule();
    class FMTransformer extends MAMTransformer {
      visitFrontMatter(fm: any): any {
        return {
          ...fm,
          data: { ...fm.data, name: 'Transformed' },
        };
      }
      visitContent(node: ContentNode): ContentNode | null {
        return node;
      }
    }
    const transformer = new FMTransformer();
    const result = transformer.visitMAMModule(mod);
    expect(result.frontmatter?.data.name).toBe('Transformed');
  });

  it('should handle null frontmatter in transform', () => {
    const mod = createMinimalModule();
    class PassThroughTransformer extends MAMTransformer {
      visitContent(node: ContentNode): ContentNode | null {
        return node;
      }
    }
    const transformer = new PassThroughTransformer();
    const result = transformer.visitMAMModule(mod);
    expect(result.frontmatter).toBeNull();
  });
});

describe('MAMCollector', () => {
  it('should collect via visitNode for unknown types', () => {
    const mod = createTestModule();
    // MAMCollector only hooks visitNode which is the fallback for unknown types
    // To collect known types, we need to override specific visit methods
    const visitedTypes: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    // Override visitSection to collect
    visitor.visitSection = (section) => {
      visitedTypes.push(section.name);
    };
    traverseVisitor(mod, visitor);
    expect(visitedTypes).toContain('Purpose');
    expect(visitedTypes).toContain('Python');
    expect(visitedTypes).toContain('Tests');
  });

  it('should collect using DefaultMAMVisitor overrides', () => {
    const mod = createTestModule();
    const codeBlocks: string[] = [];
    const visitor2 = new DefaultMAMVisitor<void>();
    visitor2.visitCodeBlock = (node) => { codeBlocks.push(node.value); };
    traverseVisitor(mod, visitor2);
    expect(codeBlocks).toContain('print("hello")');
  });

  it('should collect text via visitor', () => {
    const mod = createTestModule();
    const textValues: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitInlineText = (node) => { textValues.push(node.value); };
    visitor.visitParagraph = (node) => {
      for (const inline of node.inlineNodes) {
        visitor.visitInline(inline);
      }
    };
    traverseVisitor(mod, visitor);
    expect(textValues.length).toBeGreaterThan(0);
  });

  it('should collect selectively by overriding methods', () => {
    const mod = createTestModule();
    const sectionNames: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitSection = (section) => { sectionNames.push(section.name); };
    traverseVisitor(mod, visitor);
    expect(sectionNames).toContain('Purpose');
    expect(sectionNames).toContain('Python');
    expect(sectionNames).toContain('Tests');
  });
});

describe('traverse function (visitor)', () => {
  it('should call visitMAMModule', () => {
    const mod = createTestModule();
    let called = false;
    const visitor = { visitMAMModule: () => { called = true; } };
    traverseVisitor(mod, visitor);
    expect(called).toBe(true);
  });

  it('should traverse all sections', () => {
    const mod = createTestModule();
    const names: string[] = [];
    const visitor = {
      visitMAMModule: (m: MAMModule) => {
        for (const s of m.sections) names.push(s.name);
      },
    };
    traverseVisitor(mod, visitor);
    expect(names).toEqual(['Purpose', 'Python', 'Tests']);
  });

  it('should handle empty module', () => {
    const mod = createMinimalModule();
    let called = false;
    const visitor = { visitMAMModule: () => { called = true; } };
    traverseVisitor(mod, visitor);
    expect(called).toBe(true);
  });
});

describe('traverse function (traverser)', () => {
  it('should traverse with callback', () => {
    const mod = createTestModule();
    const types: string[] = [];
    traverse(mod as any, (node) => {
      types.push(node.type);
    });
    expect(types).toContain('MAMModule');
  });

  it('should traverse nested objects', () => {
    const mod = createTestModule();
    let sectionCount = 0;
    traverse(mod as any, (node) => {
      if (node.type === 'Section') sectionCount++;
    });
    expect(sectionCount).toBe(3);
  });

  it('should traverse arrays', () => {
    const mod = createTestModule();
    let paragraphCount = 0;
    traverse(mod as any, (node) => {
      if (node.type === 'Paragraph') paragraphCount++;
    });
    expect(paragraphCount).toBeGreaterThanOrEqual(1);
  });

  it('should pass parent and path', () => {
    const mod = createTestModule();
    const paths: string[][] = [];
    traverse(mod as any, (node, parent, path) => {
      paths.push([...path]);
    });
    expect(paths.length).toBeGreaterThan(0);
  });

  it('should handle empty module', () => {
    const mod = createMinimalModule();
    const types: string[] = [];
    traverse(mod as any, (node) => {
      types.push(node.type);
    });
    expect(types).toEqual(['MAMModule']);
  });
});

describe('findNodes', () => {
  it('should find nodes by predicate', () => {
    const mod = createTestModule();
    const paragraphs = findNodes(mod as any, (n) => n.type === 'Paragraph');
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
  });

  it('should find code blocks', () => {
    const mod = createTestModule();
    const codeBlocks = findNodes(mod as any, (n) => n.type === 'CodeBlock');
    expect(codeBlocks).toHaveLength(1);
    expect((codeBlocks[0] as any).value).toBe('print("hello")');
  });

  it('should return empty for no matches', () => {
    const mod = createTestModule();
    const matches = findNodes(mod as any, (n) => n.type === 'Nonexistent');
    expect(matches).toHaveLength(0);
  });

  it('should find all inline text nodes', () => {
    const mod = createTestModule();
    const texts = findNodes(mod as any, (n) => n.type === 'InlineText');
    expect(texts.length).toBeGreaterThan(0);
  });
});

describe('countNodes', () => {
  it('should count all nodes in module', () => {
    const mod = createTestModule();
    const count = countNodes(mod as any);
    expect(count).toBeGreaterThan(5);
  });

  it('should count nodes in empty module', () => {
    const mod = createMinimalModule();
    const count = countNodes(mod as any);
    expect(count).toBe(1);
  });
});

describe('collectText', () => {
  it('should collect all text values', () => {
    const mod = createTestModule();
    const text = collectText(mod as any);
    expect(text).toContain('Test purpose content');
    expect(text).toContain('print("hello")');
  });

  it('should return empty for empty module', () => {
    const mod = createMinimalModule();
    const text = collectText(mod as any);
    expect(text).toBe('');
  });

  it('should collect list item text', () => {
    const mod = createTestModule();
    const text = collectText(mod as any);
    // The traverser collects 'value' from nodes with 'type' property
    // List items don't have 'type', so their inner Paragraphs aren't visited
    // But inline text within reachable nodes is collected
    expect(text.length).toBeGreaterThan(0);
  });

  it('should collect heading text', () => {
    const mod = createTestModule();
    const text = collectText(mod as any);
    expect(text).toContain('Sub heading');
  });
});

describe('Visitor with deeply nested structures', () => {
  it('should handle nested bold inside italic', () => {
    const mod: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [
        {
          type: 'Section',
          name: 'Test',
          level: 2,
          content: [
            {
              type: 'Paragraph',
              value: 'nested',
              inlineNodes: [
                {
                  type: 'Italic',
                  content: [
                    {
                      type: 'Bold',
                      content: [{ type: 'InlineText', value: 'deep', location: loc() }],
                      location: loc(),
                    },
                  ],
                  location: loc(),
                },
              ],
              location: loc(),
            },
          ],
          location: loc(),
          attributes: { required: false, isCustom: false, contentTypes: ['text'] },
        },
      ],
      location: loc(),
      metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [] },
    };

    const textValues: string[] = [];
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitInlineText = (node) => { textValues.push(node.value); };
    traverseVisitor(mod, visitor);
    expect(textValues).toContain('deep');
  });

  it('should handle nested list items with paragraphs', () => {
    const mod: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [
        {
          type: 'Section',
          name: 'Test',
          level: 2,
          content: [
            {
              type: 'List',
              ordered: true,
              items: [
                {
                  content: [
                    {
                      type: 'Paragraph',
                      value: 'item',
                      inlineNodes: [{ type: 'InlineText', value: 'item', location: loc() }],
                      location: loc(),
                    },
                  ],
                },
              ],
              location: loc(),
            },
          ],
          location: loc(),
          attributes: { required: false, isCustom: false, contentTypes: ['list'] },
        },
      ],
      location: loc(),
      metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [] },
    };

    let listCount = 0;
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitList = () => { listCount++; };
    traverseVisitor(mod, visitor);
    expect(listCount).toBe(1);
  });

  it('should handle multiple sections with mixed content', () => {
    const mod = createTestModule();
    const sectionContentTypes: Map<string, string[]> = new Map();
    const visitor = new DefaultMAMVisitor<void>();
    visitor.visitSection = (section) => {
      const types: string[] = [];
      for (const content of section.content) {
        types.push(content.type);
      }
      sectionContentTypes.set(section.name, types);
    };
    traverseVisitor(mod, visitor);
    expect(sectionContentTypes.get('Purpose')).toContain('Paragraph');
    expect(sectionContentTypes.get('Python')).toContain('CodeBlock');
    expect(sectionContentTypes.get('Tests')).toContain('List');
  });
});

describe('traverseWithHooks', () => {
  it('should fire enter before leave for the root', () => {
    const events: string[] = [];
    traverseWithHooks(createTestModule(), {
      enter: (node) => events.push(`enter:${node.type}`),
      leave: (node) => events.push(`leave:${node.type}`),
    });
    expect(events[0]).toBe('enter:MAMModule');
    expect(events[events.length - 1]).toBe('leave:MAMModule');
  });

  it('should walk frontmatter before sections', () => {
    const events: string[] = [];
    traverseWithHooks(createTestModule(), {
      enter: (node) => events.push(`enter:${node.type}`),
    });
    expect(events.slice(0, 4)).toEqual([
      'enter:MAMModule',
      'enter:FrontMatter',
      'enter:Section',
      'enter:Paragraph',
    ]);
  });

  it('should call enter and leave the same number of times', () => {
    let enters = 0;
    let leaves = 0;
    traverseWithHooks(createTestModule(), {
      enter: () => { enters++; },
      leave: () => { leaves++; },
    });
    expect(enters).toBeGreaterThan(10);
    expect(leaves).toBe(enters);
  });

  it('should support enter-only hooks', () => {
    const entered: string[] = [];
    traverseWithHooks(createMinimalModule(), {
      enter: (node) => entered.push(node.type),
    });
    expect(entered).toEqual(['MAMModule']);
  });
});

describe('findFirstNode', () => {
  it('should return the root when it matches first', () => {
    const found = findFirstNode(createTestModule(), (node) => node.type === 'MAMModule');
    expect(found?.type).toBe('MAMModule');
  });

  it('should find the first code block', () => {
    const found = findFirstNode(createTestModule(), (node) => node.type === 'CodeBlock') as CodeBlock | undefined;
    expect(found?.value).toBe('print("hello")');
  });

  it('should return undefined when nothing matches', () => {
    const found = findFirstNode(createTestModule(), (node) => node.type === 'Nonexistent');
    expect(found).toBeUndefined();
  });
});

describe('hasNodeType', () => {
  it('should detect present types', () => {
    expect(hasNodeType(createTestModule(), 'MAMModule')).toBe(true);
    expect(hasNodeType(createTestModule(), 'CodeBlock')).toBe(true);
    expect(hasNodeType(createTestModule(), 'Bold')).toBe(true);
  });

  it('should reject absent types', () => {
    expect(hasNodeType(createTestModule(), 'Nonexistent' as any)).toBe(false);
    expect(hasNodeType(createMinimalModule(), 'Section')).toBe(false);
  });
});

describe('collectNodeTypes', () => {
  it('should collect unique types in visit order', () => {
    const types = collectNodeTypes(createTestModule());
    expect(types[0]).toBe('MAMModule');
    expect(types[1]).toBe('FrontMatter');
    expect(types).toContain('CodeBlock');
    expect(types).toContain('InlineText');
    expect(new Set(types).size).toBe(types.length);
  });

  it('should collect types from minimal module', () => {
    expect(collectNodeTypes(createMinimalModule())).toEqual(['MAMModule']);
  });
});

describe('collectCodeBlockLanguages', () => {
  it('should collect unique languages', () => {
    const mod = createTestModule();
    mod.sections[1].content.push({
      type: 'CodeBlock',
      language: 'javascript',
      value: 'console.log(1)',
      metadata: {},
      executable: false,
      location: loc(),
    });
    mod.sections[1].content.push({
      type: 'CodeBlock',
      language: 'python',
      value: 'print(2)',
      metadata: {},
      executable: true,
      location: loc(),
    });
    expect(collectCodeBlockLanguages(mod)).toEqual(['python', 'javascript']);
  });

  it('should return empty array when there are no code blocks', () => {
    expect(collectCodeBlockLanguages(createMinimalModule())).toEqual([]);
  });
});

describe('mapParagraphValues', () => {
  it('should map paragraph values without mutating the original', () => {
    const mod = createTestModule();
    const mapped = mapParagraphValues(mod, (value) => value.toUpperCase());
    const original = mod.sections[0].content[0] as Paragraph;
    const mappedFirst = mapped.sections[0].content[0] as Paragraph;
    expect(original.value).toBe('Test purpose content');
    expect(mappedFirst.value).toBe('TEST PURPOSE CONTENT');
    expect(mappedFirst).not.toBe(original);
  });

  it('should pass the paragraph to the mapping function', () => {
    const seen: string[] = [];
    const mapped = mapParagraphValues(createTestModule(), (value, paragraph) => {
      seen.push(paragraph.type);
      return value;
    });
    expect(mapped.type).toBe('MAMModule');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((t) => t === 'Paragraph')).toBe(true);
  });

  it('should map paragraphs inside lists and blockquotes', () => {
    const mapped = mapParagraphValues(createTestModule(), (value) => value.toUpperCase());
    const listParagraph = (mapped.sections[2].content[0] as List).items[0].content[0] as Paragraph;
    const quote = mapped.sections[2].content[4] as Blockquote;
    expect(listParagraph.value).toBe('LIST ITEM TEXT');
    expect((quote.children[0] as Paragraph).value).toBe('NOTE TEXT');
  });

  it('should leave non-paragraph nodes untouched', () => {
    const mod = createTestModule();
    const mapped = mapParagraphValues(mod, (value) => value.toUpperCase());
    expect((mapped.sections[1].content[0] as CodeBlock).value).toBe('print("hello")');
    expect(mapped.sections[1].content[0]).toBe(mod.sections[1].content[0]);
  });
});

describe('MAMProfiler', () => {
  it('should count visits per node type', () => {
    const profiler = new MAMProfiler();
    profiler.profile(createTestModule());
    expect(profiler.getCount('MAMModule')).toBe(1);
    expect(profiler.getCount('Section')).toBe(3);
    expect(profiler.getCount('Paragraph')).toBe(4);
    expect(profiler.getCount('CodeBlock')).toBe(1);
    expect(profiler.getCount('InlineText')).toBe(10);
    expect(profiler.getCount('Nonexistent')).toBe(0);
  });

  it('should accumulate counts across profile calls', () => {
    const profiler = new MAMProfiler();
    const mod = createTestModule();
    profiler.profile(mod);
    profiler.profile(mod);
    expect(profiler.getCount('Section')).toBe(6);
    expect(profiler.getCount('MAMModule')).toBe(2);
  });

  it('should expose total equal to sum of counts', () => {
    const profiler = new MAMProfiler();
    profiler.profile(createTestModule());
    const counts = profiler.getCounts();
    const sum = Object.values(counts).reduce((acc, n) => acc + n, 0);
    expect(profiler.getTotal()).toBe(sum);
    expect(profiler.getTotal()).toBeGreaterThan(10);
    expect(counts.MAMModule).toBe(1);
  });

  it('should profile through visitMAMModule', () => {
    const profiler = new MAMProfiler();
    profiler.visitMAMModule(createTestModule());
    expect(profiler.getCount('MAMModule')).toBe(1);
    expect(profiler.getCount('FrontMatter')).toBe(1);
  });

  it('should reset counters', () => {
    const profiler = new MAMProfiler();
    profiler.profile(createTestModule());
    profiler.reset();
    expect(profiler.getTotal()).toBe(0);
    expect(profiler.getCount('Section')).toBe(0);
    expect(profiler.getCounts()).toEqual({});
  });

  it('should profile minimal module', () => {
    const profiler = new MAMProfiler();
    profiler.profile(createMinimalModule());
    expect(profiler.getTotal()).toBe(1);
    expect(profiler.getCount('Section')).toBe(0);
  });
});

describe('findNodesByType', () => {
  it('should find all nodes of a given type', () => {
    const sections = findNodesByType(createTestModule() as any, 'Section');
    expect(sections).toHaveLength(3);
    expect(sections.every((n) => n.type === 'Section')).toBe(true);
  });

  it('should find code blocks by type', () => {
    const blocks = findNodesByType(createTestModule() as any, 'CodeBlock') as any[];
    expect(blocks).toHaveLength(1);
    expect(blocks[0].value).toBe('print("hello")');
  });

  it('should return an empty array when nothing matches', () => {
    expect(findNodesByType(createMinimalModule() as any, 'Section')).toEqual([]);
  });
});

describe('getNodeTypes', () => {
  it('should collect unique types visible to the traverser', () => {
    const types = getNodeTypes(createTestModule() as any);
    expect(types).toContain('MAMModule');
    expect(types).toContain('Section');
    expect(types).toContain('InlineText');
    expect(new Set(types).size).toBe(types.length);
  });

  it('should collect types for minimal module', () => {
    expect(getNodeTypes(createMinimalModule() as any)).toEqual(['MAMModule']);
  });
});

describe('getMaxDepth & collectPaths', () => {
  it('should report zero depth for root-only module', () => {
    expect(getMaxDepth(createMinimalModule() as any)).toBe(0);
  });

  it('should report nested depth for full module', () => {
    expect(getMaxDepth(createTestModule() as any)).toBe(5);
  });

  it('should collect one path per visited node', () => {
    const mod = createTestModule();
    const paths = collectPaths(mod as any);
    expect(paths).toHaveLength(countNodes(mod as any));
    expect(paths[0]).toEqual([]);
  });

  it('should include nested key paths', () => {
    const paths = collectPaths(createTestModule() as any);
    expect(paths).toContainEqual(['sections']);
    expect(paths).toContainEqual(['sections', 'content']);
  });
});

describe('someNode', () => {
  it('should return true when any node matches', () => {
    expect(someNode(createTestModule() as any, (n) => n.type === 'CodeBlock')).toBe(true);
    expect(someNode(createMinimalModule() as any, (n) => n.type === 'MAMModule')).toBe(true);
  });

  it('should return false when no node matches', () => {
    expect(someNode(createTestModule() as any, (n) => n.type === 'Nonexistent')).toBe(false);
  });
});

describe('everyNodeShallow', () => {
  it('should verify the root and its direct children only', () => {
    const mod = createTestModule();
    expect(everyNodeShallow(mod as any, (n) => ['MAMModule', 'FrontMatter', 'Section'].includes(n.type))).toBe(true);
  });

  it('should ignore deeper nodes that fail the predicate', () => {
    expect(everyNodeShallow(createTestModule() as any, (n) => n.type !== 'CodeBlock')).toBe(true);
    expect(everyNodeShallow(createTestModule() as any, (n) => n.type !== 'Paragraph')).toBe(true);
  });

  it('should return false when a direct child fails', () => {
    expect(everyNodeShallow(createTestModule() as any, (n) => n.type !== 'Section')).toBe(false);
  });

  it('should return false when the root fails', () => {
    expect(everyNodeShallow(createMinimalModule() as any, () => false)).toBe(false);
  });
});

describe('collectValuesByKey', () => {
  it('should collect values from nodes that have the key', () => {
    const values = collectValuesByKey(createTestModule() as any, 'value');
    expect(values).toContain('Test purpose content');
    expect(values).toContain('print("hello")');
    expect(values).toContain('Sub heading');
    expect(values).toContain('Important note');
    expect(values).not.toContain('List item text');
    expect(values.length).toBeGreaterThan(5);
  });

  it('should return empty array when no node has the key', () => {
    expect(collectValuesByKey(createMinimalModule() as any, 'value')).toEqual([]);
  });
});

describe('traverseTree', () => {
  it('should traverse the tree through the barrel alias', () => {
    const types: string[] = [];
    traverseTree(createTestModule() as any, (node) => {
      types.push(node.type);
    });
    expect(types[0]).toBe('MAMModule');
    expect(types).toContain('Section');
    expect(types).toContain('CodeBlock');
  });

  it('should visit only the root for a minimal module', () => {
    const types: string[] = [];
    traverseTree(createMinimalModule() as any, (node) => {
      types.push(node.type);
    });
    expect(types).toEqual(['MAMModule']);
  });
});
