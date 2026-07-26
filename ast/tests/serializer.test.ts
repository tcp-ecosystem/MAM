/**
 * AST Serializer Tests
 */

import { describe, it, expect } from 'vitest';
import { serializeToJSON, deserializeFromJSON, prettyPrint, getASTStats } from '../src/serializer/index.js';
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
      type: 'Section', name: 'Purpose', level: 2,
      content: [{ type: 'Paragraph', value: 'Test', inlineNodes: [], location: loc }],
      location: loc, attributes: { required: true, isCustom: false, contentTypes: ['text'] },
    }],
    location: loc,
    metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
  };
}

describe('AST Serializer', () => {
  it('should serialize to JSON', () => {
    const module = createTestModule();
    const json = serializeToJSON(module);
    expect(json).toContain('"type": "MAMModule"');
  });

  it('should deserialize from JSON', () => {
    const module = createTestModule();
    const json = serializeToJSON(module);
    const parsed = deserializeFromJSON(json);
    expect(parsed.type).toBe('MAMModule');
    expect(parsed.frontmatter?.data.id).toBe('test');
  });

  it('should pretty print', () => {
    const module = createTestModule();
    const output = prettyPrint(module);
    expect(output).toContain('MAMModule');
    expect(output).toContain('Sections: 1');
  });

  it('should get stats', () => {
    const module = createTestModule();
    const stats = getASTStats(module);
    expect(stats.totalSections).toBe(1);
    expect(stats.totalCodeBlocks).toBe(0);
  });
});