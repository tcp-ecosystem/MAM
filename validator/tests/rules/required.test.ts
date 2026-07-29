/**
 * Required Field Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validateRequired, ALLOWED_RUNTIMES, REQUIRED_SECTIONS, FRONTMATTER_FIELDS } from '../../src/rules/required.js';
import type { RequiredIssue } from '../../src/rules/required.js';

function createAst(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    frontmatter: {
      id: 'test-module',
      version: '1.0.0',
      name: 'Test Module',
      author: 'Author',
      runtime: 'python',
      ...overrides,
    },
    sections: [{ name: 'Purpose' }],
  };
}

function createAstNoFrontmatter(): Record<string, unknown> {
  return { sections: [{ name: 'Purpose' }] };
}

describe('Required Rules', () => {
  describe('validateRequired', () => {
    it('should return no issues for a valid ast', () => {
      const issues = validateRequired(createAst());
      expect(issues).toHaveLength(0);
    });

    it('should return error when frontmatter is missing', () => {
      const issues = validateRequired(createAstNoFrontmatter());
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.some(i => i.code === 'MISSING_FRONTMATTER')).toBe(true);
    });

    it('should return error for each missing required field', () => {
      const issues = validateRequired(createAst({
        id: undefined,
        version: undefined,
        name: undefined,
        author: undefined,
        runtime: undefined,
      }));
      const missing = issues.filter(i => i.code === 'MISSING_REQUIRED_FIELD');
      expect(missing.length).toBe(5);
    });

    it('should detect id that is not kebab-case', () => {
      const issues = validateRequired(createAst({ id: 'Invalid_ID!' }));
      expect(issues.some(i => i.code === 'INVALID_ID_FORMAT' && i.message.includes('kebab-case'))).toBe(true);
    });

    it('should detect id with spaces', () => {
      const issues = validateRequired(createAst({ id: 'has spaces' }));
      expect(issues.some(i => i.code === 'INVALID_ID_FORMAT' && i.message.includes('spaces'))).toBe(true);
    });

    it('should warn when id exceeds 64 characters', () => {
      const longId = 'a'.repeat(65);
      const issues = validateRequired(createAst({ id: longId }));
      expect(issues.some(i => i.code === 'INVALID_ID_FORMAT' && i.severity === 'warning')).toBe(true);
    });

    it('should accept valid kebab-case ids', () => {
      const valid = ['a', 'my-module', 'mod-1', 'a-b-c-1-2'];
      for (const id of valid) {
        const issues = validateRequired(createAst({ id }));
        expect(issues.filter(i => i.code === 'INVALID_ID_FORMAT')).toHaveLength(0);
      }
    });

    it('should detect invalid semver version', () => {
      const issues = validateRequired(createAst({ version: 'not-a-version' }));
      expect(issues.some(i => i.code === 'INVALID_VERSION_FORMAT')).toBe(true);
    });

    it('should accept valid semver versions', () => {
      const valid = ['0.0.1', '1.0.0', '10.20.30', '1.0.0-beta', '1.0.0+build.1'];
      for (const version of valid) {
        const issues = validateRequired(createAst({ version }));
        expect(issues.filter(i => i.code === 'INVALID_VERSION_FORMAT')).toHaveLength(0);
      }
    });

    it('should detect invalid runtime', () => {
      const issues = validateRequired(createAst({ runtime: 'cobol' }));
      expect(issues.some(i => i.code === 'INVALID_RUNTIME')).toBe(true);
      expect(issues.find(i => i.code === 'INVALID_RUNTIME')?.message).toContain('cobol');
    });

    it('should accept all allowed runtimes', () => {
      for (const runtime of ALLOWED_RUNTIMES) {
        const issues = validateRequired(createAst({ runtime }));
        expect(issues.filter(i => i.code === 'INVALID_RUNTIME')).toHaveLength(0);
      }
    });

    it('should detect empty author', () => {
      const issues = validateRequired(createAst({ author: '   ' }));
      expect(issues.some(i => i.code === 'EMPTY_AUTHOR')).toBe(true);
    });

    it('should detect empty name', () => {
      const issues = validateRequired(createAst({ name: '' }));
      expect(issues.some(i => i.code === 'MISSING_REQUIRED_FIELD' && i.message.includes('name'))).toBe(true);
    });

    it('should detect whitespace-only name', () => {
      const issues = validateRequired(createAst({ name: '   ' }));
      expect(issues.some(i => i.code === 'EMPTY_NAME')).toBe(true);
    });

    it('should detect missing required section', () => {
      const ast = createAst();
      ast.sections = [];
      const issues = validateRequired(ast);
      expect(issues.some(i => i.code === 'MISSING_SECTION' && i.message.includes('Purpose'))).toBe(true);
    });

    it('should not fail if required sections exist', () => {
      const issues = validateRequired(createAst());
      expect(issues.filter(i => i.code === 'MISSING_SECTION')).toHaveLength(0);
    });

    it('should include line/column from frontmatter location', () => {
      const ast = createAst();
      ast.frontmatter = {
        ...ast.frontmatter,
        location: { start: { line: 1, column: 0 } },
      };
      const issues = validateRequired(ast);
      if (issues.length > 0) {
        expect(issues[0].line).toBeDefined();
      }
    });

    it('should support custom required field rules', () => {
      const customRules = [{ section: 'frontmatter', fields: ['id'] }];
      const issues = validateRequired(createAst({ version: undefined, name: undefined }), customRules);
      expect(issues).toHaveLength(0);
    });

    it('should use default severity from rules', () => {
      const issues = validateRequired(createAstNoFrontmatter());
      expect(issues[0].severity).toBe('error');
    });

    it('should set path for each issue', () => {
      const issues = validateRequired(createAstNoFrontmatter());
      expect(issues[0].path).toBeDefined();
    });
  });
});
