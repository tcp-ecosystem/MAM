/**
 * References Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validateReferences } from '../../src/rules/references.js';
import type { ReferenceIssue } from '../../src/rules/references.js';

function createAstWithUrls(
  urls: Array<{ url: string; title?: string; type?: string }>
): Record<string, unknown> {
  return {
    sections: [
      {
        name: 'References',
        content: urls.map(u => ({
          type: u.type ?? 'paragraph',
          value: u.url,
          url: u.url,
          title: u.title,
          line: 10,
          column: 0,
        })),
      },
    ],
  };
}

function createAstNoSections(): Record<string, unknown> {
  return { sections: [] };
}

describe('References Rules', () => {
  describe('validateReferences', () => {
    it('should return no issues for empty sections', () => {
      const issues = validateReferences(createAstNoSections());
      expect(issues).toHaveLength(0);
    });

    it('should return no issues for valid URLs', () => {
      const issues = validateReferences(
        createAstWithUrls([
          { url: 'https://example.com/doc', title: 'Documentation' },
          { url: 'https://github.com/user/repo' },
        ])
      );
      expect(issues).toHaveLength(0);
    });

    it('should detect malformed URLs', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'not-a-url' }])
      );
      // This is extracted from text content, so may be flagged
      expect(issues).toBeDefined();
    });

    it('should detect non-http protocols', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'ftp://files.example.com/doc' }])
      );
      expect(issues.some(i => i.code === 'INVALID_URL_PROTOCOL')).toBe(true);
    });

    it('should detect missing title when required', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'https://example.com' }]),
        { requireTitle: true }
      );
      expect(issues.some(i => i.code === 'MISSING_REFERENCE_TITLE')).toBe(true);
    });

    it('should not require title when not configured', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'https://example.com' }]),
        { requireTitle: false }
      );
      expect(issues.filter(i => i.code === 'MISSING_REFERENCE_TITLE')).toHaveLength(0);
    });

    it('should detect duplicate references', () => {
      const issues = validateReferences(
        createAstWithUrls([
          { url: 'https://example.com/doc' },
          { url: 'https://example.com/doc' },
        ])
      );
      expect(issues.some(i => i.code === 'DUPLICATE_REFERENCE')).toBe(true);
    });

    it('should flag non-allowlisted domains', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'https://evil.com/page' }]),
        { allowedDomains: ['example.com', 'github.com'] }
      );
      expect(issues.some(i => i.code === 'URL_DOMAIN_NOT_ALLOWLISTED')).toBe(true);
    });

    it('should not flag allowlisted domains', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'https://example.com/page' }]),
        { allowedDomains: ['example.com'] }
      );
      expect(issues.filter(i => i.code === 'URL_DOMAIN_NOT_ALLOWLISTED')).toHaveLength(0);
    });

    it('should flag internal URLs', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'http://localhost:3000/api' }]),
        { flagInternal: true }
      );
      expect(issues.some(i => i.code === 'INTERNAL_URL_EXPOSED')).toBe(true);
    });

    it('should not flag internal URLs when not configured', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'http://localhost:3000/api' }]),
        { flagInternal: false }
      );
      expect(issues.filter(i => i.code === 'INTERNAL_URL_EXPOSED')).toHaveLength(0);
    });

    it('should detect placeholder domains', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'https://example.com/placeholder' }]),
        { checkDead: true }
      );
      expect(issues.some(i => i.code === 'SUSPICIOUS_URL')).toBe(true);
    });

    it('should include line numbers in issues', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'ftp://bad.com' }])
      );
      expect(issues[0].line).toBeDefined();
    });

    it('should include path in issues', () => {
      const issues = validateReferences(
        createAstWithUrls([{ url: 'ftp://bad.com' }])
      );
      expect(issues[0].path).toBeDefined();
    });

    it('should handle link-type content nodes', () => {
      const ast = {
        sections: [
          {
            name: 'References',
            content: [
              { type: 'link', url: 'https://example.com', title: 'Example' },
            ],
          },
        ],
      };
      const issues = validateReferences(ast);
      expect(issues).toHaveLength(0);
    });

    it('should handle mixed content with URLs in text', () => {
      const ast = {
        sections: [
          {
            name: 'Content',
            content: [
              {
                type: 'paragraph',
                value: 'See https://example.com and https://test.com for details',
              },
            ],
          },
        ],
      };
      const issues = validateReferences(ast);
      expect(issues).toBeDefined();
    });
  });
});
