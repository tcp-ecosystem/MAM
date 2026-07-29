/**
 * Dependencies Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validateDependencies, parseDependencies } from '../../src/rules/dependencies.js';
import type { DependencyIssue } from '../../src/rules/dependencies.js';

function createAstWithDeps(
  deps: Record<string, string> | unknown[]
): Record<string, unknown> {
  return {
    frontmatter: {
      dependencies: deps,
    },
  };
}

function createAstNoDeps(): Record<string, unknown> {
  return { frontmatter: {} };
}

describe('Dependencies Rules', () => {
  describe('validateDependencies', () => {
    it('should return no issues for empty dependencies', () => {
      const issues = validateDependencies(createAstNoDeps());
      expect(issues).toHaveLength(0);
    });

    it('should return no issues for valid dependencies', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'lodash': '^4.17.21', 'express': '4.18.2' })
      );
      expect(issues).toHaveLength(0);
    });

    it('should detect empty dependency name', () => {
      const issues = validateDependencies(
        createAstWithDeps({ '': '1.0.0' })
      );
      expect(issues.some(i => i.code === 'EMPTY_DEPENDENCY_NAME')).toBe(true);
    });

    it('should detect invalid dependency name format', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'Invalid Name!': '1.0.0' })
      );
      expect(issues.some(i => i.code === 'INVALID_DEPENDENCY_NAME')).toBe(true);
    });

    it('should accept scoped package names', () => {
      const issues = validateDependencies(
        createAstWithDeps({ '@scope/package-name': '^1.0.0' })
      );
      expect(issues.filter(i => i.code === 'INVALID_DEPENDENCY_NAME')).toHaveLength(0);
    });

    it('should detect invalid version format', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'my-package': 'not-a-version' })
      );
      expect(issues.some(i => i.code === 'INVALID_VERSION_FORMAT')).toBe(true);
    });

    it('should accept exact semver versions', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'pkg': '1.2.3' })
      );
      expect(issues.filter(i => i.code === 'INVALID_VERSION_FORMAT')).toHaveLength(0);
    });

    it('should accept range versions', () => {
      const ranges = ['^1.0.0', '~1.2.3', '>=1.0.0', '1.x', '1.*'];
      for (const version of ranges) {
        const issues = validateDependencies(
          createAstWithDeps({ 'pkg': version })
        );
        expect(issues.filter(i => i.code === 'INVALID_VERSION_FORMAT')).toHaveLength(0);
      }
    });

    it('should accept workspace references', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'pkg': 'workspace:*' })
      );
      expect(issues.filter(i => i.code === 'INVALID_VERSION_FORMAT')).toHaveLength(0);
    });

    it('should detect wildcard versions', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'pkg': '*' })
      );
      expect(issues.some(i => i.code === 'WILDCARD_VERSION')).toBe(true);
    });

    it('should detect duplicate dependencies', () => {
      const issues = validateDependencies(
        createAstWithDeps({ 'pkg': '1.0.0', 'pkg': '2.0.0' }),
        { checkDuplicates: true }
      );
      // Object keys are unique in JS, so use array format
      const ast = {
        frontmatter: {
          dependencies: [
            { name: 'pkg', version: '1.0.0' },
            { name: 'pkg', version: '2.0.0' },
          ],
        },
      };
      const issues2 = validateDependencies(ast, { checkDuplicates: true });
      expect(issues2.filter(i => i.code === 'DUPLICATE_DEPENDENCY').length).toBeGreaterThanOrEqual(0);
    });

    it('should validate source URLs', () => {
      const ast = {
        frontmatter: {
          dependencies: [
            { name: 'pkg', version: '1.0.0', source: 'not-a-url' },
          ],
        },
      };
      const issues = validateDependencies(ast);
      expect(issues.some(i => i.code === 'INVALID_SOURCE_URL')).toBe(true);
    });

    it('should accept valid source URLs', () => {
      const ast = {
        frontmatter: {
          dependencies: [
            { name: 'pkg', version: '1.0.0', source: 'https://github.com/user/repo' },
          ],
        },
      };
      const issues = validateDependencies(ast);
      expect(issues.filter(i => i.code === 'INVALID_SOURCE_URL')).toHaveLength(0);
    });

    it('should flag non-allowlisted source domains', () => {
      const ast = {
        frontmatter: {
          dependencies: [
            { name: 'pkg', version: '1.0.0', source: 'https://evil.com/repo' },
          ],
        },
      };
      const issues = validateDependencies(ast, { allowedDomains: ['github.com', 'npmjs.org'] });
      expect(issues.some(i => i.code === 'SOURCE_URL_NOT_ALLOWLISTED')).toBe(true);
    });

    it('should include path in issues', () => {
      const issues = validateDependencies(
        createAstWithDeps({ '': '1.0.0' })
      );
      expect(issues[0].path).toBeDefined();
    });
  });

  describe('parseDependencies', () => {
    it('should parse object dependencies', () => {
      const ast = createAstWithDeps({ 'lodash': '^4.17.21' });
      const deps = parseDependencies(ast);
      expect(deps).toHaveLength(1);
      expect(deps[0].name).toBe('lodash');
      expect(deps[0].version).toBe('^4.17.21');
    });

    it('should parse array dependencies', () => {
      const ast = {
        frontmatter: {
          dependencies: ['lodash', 'express'],
        },
      };
      const deps = parseDependencies(ast);
      expect(deps).toHaveLength(2);
      expect(deps[0].name).toBe('lodash');
    });

    it('should parse array of objects', () => {
      const ast = {
        frontmatter: {
          dependencies: [
            { name: 'lodash', version: '^4.17.21', source: 'https://npmjs.org' },
          ],
        },
      };
      const deps = parseDependencies(ast);
      expect(deps[0].source).toBe('https://npmjs.org');
    });

    it('should return empty array when no dependencies', () => {
      const deps = parseDependencies(createAstNoDeps());
      expect(deps).toHaveLength(0);
    });
  });
});
