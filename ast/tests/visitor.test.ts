/**
 * AST Visitor Tests
 */

import { describe, it, expect } from 'vitest';
import { DefaultMAMVisitor, traverse } from '../src/visitor/index.js';
import { createLocation } from '../src/location/index.js';
import type { MAMModule } from '../src/nodes/index.js';

function createTestModule(): MAMModule {
  const loc = createLocation(1, 0, 0, 10, 0, 100, 'test.mam.md');
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'test', version: '1.0.0', name: 'Test', author: 'Author', runtime: 'python' },
      location: loc,
    },
    sections: [{
      type: 'Section',
      name: 'Purpose',
      level: 2,
      content: [{ type: 'Paragraph', value: 'Test purpose', inlineNodes: [], location: loc }],
      location: loc,
      attributes: { required: true, isCustom: false, contentTypes: ['text'] },
    }],
    location: loc,
    metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
  };
}

describe('AST Visitor', () => {
  it('should traverse module', () => {
    const module = createTestModule();
    let visited = false;
    const visitor = { visitMAMModule: () => { visited = true; } };
    traverse(module, visitor);
    expect(visited).toBe(true);
  });

  it('should traverse sections', () => {
    const module = createTestModule();
    let sectionNames: string[] = [];
    const visitor = new DefaultMAMVisitor();
    visitor.visitSection = (section) => { sectionNames.push(section.name); };
    traverse(module, visitor);
    expect(sectionNames).toContain('Purpose');
  });
});