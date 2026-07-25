/**
 * MAM Validator Tests
 * 
 * Tests for the MAM validator.
 */

import { describe, it, expect } from 'vitest';
import { validate, MAMValidator } from '../src/index.js';
import { MAMModule } from '@mam/ast';

describe('MAM Validator', () => {
  const createValidModule = (): MAMModule => ({
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: {
        id: 'test-module',
        version: '1.0.0',
        name: 'Test Module',
        author: 'TestAuthor',
        runtime: 'python',
        tags: ['test'],
        description: 'A test module',
      },
      location: {
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 8, column: 3, offset: 100 },
        source: 'test.mam.md',
      },
    },
    sections: [
      {
        type: 'Section',
        name: 'Purpose',
        level: 2,
        content: [
          {
            type: 'Paragraph',
            value: 'This is a test module.',
            inlineNodes: [],
            location: {
              start: { line: 10, column: 0, offset: 110 },
              end: { line: 11, column: 0, offset: 135 },
              source: 'test.mam.md',
            },
          },
        ],
        location: {
          start: { line: 9, column: 0, offset: 105 },
          end: { line: 11, column: 0, offset: 135 },
          source: 'test.mam.md',
        },
        attributes: {
          required: true,
          isCustom: false,
          contentTypes: ['text'],
        },
      },
    ],
    location: {
      start: { line: 1, column: 0, offset: 0 },
      end: { line: 11, column: 0, offset: 135 },
      source: 'test.mam.md',
    },
    metadata: {
      sectionCount: 1,
      codeBlockCount: 0,
      languages: [],
      customSections: [],
    },
  });

  describe('validate', () => {
    it('should validate a correct module', () => {
      const module = createValidModule();
      const result = validate(module);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing front matter', () => {
      const module = createValidModule();
      module.frontmatter = null;

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_FRONTMATTER')).toBe(true);
    });

    it('should detect invalid ID format', () => {
      const module = createValidModule();
      module.frontmatter!.data.id = 'Invalid_ID!';

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_ID_FORMAT')).toBe(true);
    });

    it('should detect invalid version format', () => {
      const module = createValidModule();
      module.frontmatter!.data.version = 'not-a-version';

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_VERSION_FORMAT')).toBe(true);
    });

    it('should detect missing required sections', () => {
      const module = createValidModule();
      module.sections = []; // No Purpose section

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'MISSING_SECTION')).toBe(true);
    });

    it('should detect duplicate sections', () => {
      const module = createValidModule();
      // Add duplicate Purpose section
      module.sections.push({
        ...module.sections[0]!,
        content: [{ ...module.sections[0]!.content[0]!, value: 'Duplicate' }],
      });

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DUPLICATE_SECTION')).toBe(true);
    });

    it('should detect empty sections', () => {
      const module = createValidModule();
      module.sections[0]!.content = [];

      const result = validate(module);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'EMPTY_SECTION')).toBe(true);
    });

    it('should generate warnings for best practices', () => {
      const module = createValidModule();
      module.frontmatter!.data.description = undefined;
      module.frontmatter!.data.tags = [];

      const result = validate(module, { collectWarnings: true });

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should respect max errors limit', () => {
      const module = createValidModule();
      module.frontmatter!.data.id = 'bad';
      module.frontmatter!.data.version = 'bad';

      const result = validate(module, { maxErrors: 1 });

      expect(result.errors.length).toBeLessThanOrEqual(1);
    });
  });

  describe('MAMValidator', () => {
    it('should support custom rules', () => {
      const module = createValidModule();
      
      const validator = new MAMValidator({
        customRules: [
          {
            name: 'no-test-in-name',
            description: 'Module name should not contain "test"',
            severity: 'error',
            check: (m) => {
              if (m.frontmatter?.data.name.toLowerCase().includes('test')) {
                return [{
                  code: 'CUSTOM_RULE' as any,
                  message: 'Module name contains "test"',
                  severity: 'error',
                }];
              }
              return [];
            },
          },
        ],
      });

      const result = validator.validate(module);

      expect(result.errors.some(e => e.message.includes('test'))).toBe(true);
    });

    it('should track validation statistics', () => {
      const module = createValidModule();
      const validator = new MAMValidator();

      const result = validator.validate(module);

      expect(result.stats.rulesChecked).toBeGreaterThan(0);
      expect(result.stats.timeMs).toBeGreaterThan(0);
    });
  });
});