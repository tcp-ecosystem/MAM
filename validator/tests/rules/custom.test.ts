/**
 * Custom Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validate } from '../../src/validator.js';
import { createLocation } from '@mam/ast';
import type { MAMModule } from '@mam/ast';

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
      content: [{ type: 'Paragraph', value: 'Test purpose', inlineNodes: [], location: loc }],
      location: loc, attributes: { required: true, isCustom: false, contentTypes: ['text'] },
    }],
    location: loc,
    metadata: { sectionCount: 1, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
  };
}

describe('Custom Validation Rules', () => {
  it('should support custom rules', () => {
    const module = createTestModule();
    const result = validate(module, {
      customRules: [{
        name: 'no-test',
        description: 'No test in name',
        severity: 'error',
        check: (m) => {
          if (m.frontmatter?.data.name.toLowerCase().includes('test')) {
            return [{ code: 'CUSTOM', message: 'Name contains test', severity: 'error' }];
          }
          return [];
        },
      }],
    });
    expect(result.errors.some(e => e.message.includes('test'))).toBe(true);
  });

  it('should respect max errors', () => {
    const module = createTestModule();
    const result = validate(module, { maxErrors: 1 });
    expect(result.errors.length).toBeLessThanOrEqual(1);
  });
});