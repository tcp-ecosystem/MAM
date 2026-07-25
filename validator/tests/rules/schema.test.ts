/**
 * Schema Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validateFrontMatter, validateSections } from '../../src/rules/schema.js';
import { createLocation } from '@mam/ast';
import type { MAMModule } from '@mam/ast';

function createTestModule(overrides: Partial<MAMModule> = {}): MAMModule {
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
    ...overrides,
  };
}

describe('Schema Validation', () => {
  it('should validate correct front matter', () => {
    const module = createTestModule();
    const errors = validateFrontMatter(module.frontmatter);
    expect(errors).toHaveLength(0);
  });

  it('should detect missing front matter', () => {
    const errors = validateFrontMatter(null);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should detect invalid ID format', () => {
    const module = createTestModule();
    module.frontmatter!.data.id = 'Invalid_ID!';
    const errors = validateFrontMatter(module.frontmatter);
    expect(errors.some(e => e.code === 'INVALID_ID_FORMAT')).toBe(true);
  });

  it('should validate sections', () => {
    const module = createTestModule();
    const errors = validateSections(module.sections);
    expect(errors).toHaveLength(0);
  });

  it('should detect missing required sections', () => {
    const errors = validateSections([]);
    expect(errors.some(e => e.code === 'MISSING_SECTION')).toBe(true);
  });
});