/**
 * Front Matter Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/lexer/index.js';
import { parseFrontMatter } from '../../src/parser/frontmatter.js';

function tokenizeAndParse(input: string) {
  const tokens = tokenize(input).tokens;
  return parseFrontMatter(tokens, 0, 'test.mam.md');
}

describe('Front Matter Parser', () => {
  // ==========================================================================
  // Valid Front Matter
  // ==========================================================================

  describe('valid front matter', () => {
    it('should parse all required fields', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('test');
      expect(result.data?.version).toBe('1.0.0');
      expect(result.data?.name).toBe('Test');
      expect(result.data?.author).toBe('Author');
      expect(result.data?.runtime).toBe('python');
    });

    it('should parse optional tags field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\ntags:\n  - auth\n  - security\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.tags).toEqual(['auth', 'security']);
    });

    it('should parse optional description field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\ndescription: A test module\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.description).toBe('A test module');
    });

    it('should parse optional dependencies field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\ndependencies:\n  - lodash\n  - express\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.dependencies).toEqual(['lodash', 'express']);
    });

    it('should parse optional permissions field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\npermissions:\n  - read\n  - write\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.permissions).toEqual(['read', 'write']);
    });

    it('should parse optional license field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\nlicense: MIT\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.license).toBe('MIT');
    });

    it('should parse optional repository field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\nrepository: https://github.com/test/repo\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.repository).toBe('https://github.com/test/repo');
    });

    it('should parse optional mam_version field', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\nmam_version: 2.0.0\n---';
      const result = tokenizeAndParse(input);

      expect(result.data?.mam_version).toBe('2.0.0');
    });

    it('should parse all fields together', () => {
      const input = [
        '---',
        'id: my-module',
        'version: 1.2.3',
        'name: My Module',
        'author: Developer',
        'runtime: typescript',
        'tags:',
        '  - utility',
        '  - helper',
        'description: A helpful module',
        'dependencies:',
        '  - lodash',
        'license: Apache-2.0',
        'repository: https://github.com/test/module',
        'mam_version: 2.0.0',
        '---',
      ].join('\n');
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('my-module');
      expect(result.data?.version).toBe('1.2.3');
      expect(result.data?.name).toBe('My Module');
      expect(result.data?.author).toBe('Developer');
      expect(result.data?.runtime).toBe('typescript');
      expect(result.data?.tags).toEqual(['utility', 'helper']);
      expect(result.data?.description).toBe('A helpful module');
      expect(result.data?.dependencies).toEqual(['lodash']);
      expect(result.data?.license).toBe('Apache-2.0');
      expect(result.data?.repository).toBe('https://github.com/test/module');
      expect(result.data?.mam_version).toBe('2.0.0');
    });
  });

  // ==========================================================================
  // Missing Front Matter
  // ==========================================================================

  describe('missing front matter', () => {
    it('should return null data for missing front matter', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should return null data when input is empty', () => {
      const input = '';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
    });

    it('should return null data for plain text without front matter', () => {
      const input = 'Just some text without any front matter delimiters.';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
    });
  });

  // ==========================================================================
  // Missing Required Fields
  // ==========================================================================

  describe('missing required fields', () => {
    it('should report error for missing id', () => {
      const input = '---\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes('id'))).toBe(true);
    });

    it('should report error for missing version', () => {
      const input = '---\nid: test\nname: Test\nauthor: Author\nruntime: python\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.some(e => e.message.includes('version'))).toBe(true);
    });

    it('should report error for missing name', () => {
      const input = '---\nid: test\nversion: 2.0.0\nauthor: Author\nruntime: python\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.some(e => e.message.includes('name'))).toBe(true);
    });

    it('should report error for missing author', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nruntime: python\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.some(e => e.message.includes('author'))).toBe(true);
    });

    it('should report error for missing runtime', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).toBeNull();
      expect(result.errors.some(e => e.message.includes('runtime'))).toBe(true);
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle front matter with extra whitespace', () => {
      const input = '---\n  id: test  \n  version: 2.0.0  \n  name: Test  \n  author: Author  \n  runtime: python  \n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('test');
    });

    it('should handle front matter with quoted values', () => {
      const input = '---\nid: "test-id"\nversion: "1.0.0"\nname: "My Test Module"\nauthor: "Author Name"\nruntime: "python"\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect(result.data?.id).toBe('test-id');
    });

    it('should handle front matter with boolean values', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\nactive: true\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect((result.data as any)?.active).toBe(true);
    });

    it('should handle front matter with null values', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\noptional_field: null\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect((result.data as any)?.optional_field).toBeNull();
    });

    it('should handle front matter with integer values', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\ncount: 42\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect((result.data as any)?.count).toBe(42);
    });

    it('should handle front matter with float values', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\nratio: 3.14\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect((result.data as any)?.ratio).toBeCloseTo(3.14);
    });

    it('should handle custom fields not in standard schema', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\ncustom_field: custom_value\n---';
      const result = tokenizeAndParse(input);

      expect(result.data).not.toBeNull();
      expect((result.data as any)?.custom_field).toBe('custom_value');
    });
  });

  // ==========================================================================
  // Error Reporting
  // ==========================================================================

  describe('error reporting', () => {
    it('should report correct line and column for missing front matter', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.errors.length).toBeGreaterThan(0);
      const error = result.errors[0];
      expect(error).toBeDefined();
      expect(error!.line).toBeGreaterThan(0);
    });

    it('should track endIndex correctly after parsing', () => {
      const input = '---\nid: test\nversion: 2.0.0\nname: Test\nauthor: Author\nruntime: python\n---\n\n## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.endIndex).toBeGreaterThan(0);
    });

    it('should return endIndex 0 when no front matter found', () => {
      const input = '## Purpose\n\nTest.';
      const result = tokenizeAndParse(input);

      expect(result.endIndex).toBe(0);
    });
  });
});
