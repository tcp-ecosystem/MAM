/**
 * Front Matter Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/lexer/index.js';
import { parseFrontMatter } from '../../src/parser/frontmatter.js';

describe('Front Matter Parser', () => {
  it('should parse valid front matter', () => {
    const input = '---\nid: test\nversion: 1.0.0\nname: Test\nauthor: Author\nruntime: python\n---';
    const tokens = tokenize(input).tokens;
    const result = parseFrontMatter(tokens, 0, 'test.mam.md');

    expect(result.data).not.toBeNull();
    expect(result.data?.id).toBe('test');
    expect(result.data?.version).toBe('1.0.0');
    expect(result.data?.name).toBe('Test');
    expect(result.data?.author).toBe('Author');
    expect(result.data?.runtime).toBe('python');
  });

  it('should parse list fields', () => {
    const input = '---\nid: test\nversion: 1.0.0\nname: Test\nauthor: Author\nruntime: python\ntags:\n  - auth\n  - security\n---';
    const tokens = tokenize(input).tokens;
    const result = parseFrontMatter(tokens, 0, 'test.mam.md');

    expect(result.data?.tags).toEqual(['auth', 'security']);
  });

  it('should return null for missing front matter', () => {
    const input = '## Purpose\n\nTest.';
    const tokens = tokenize(input).tokens;
    const result = parseFrontMatter(tokens, 0, 'test.mam.md');

    expect(result.data).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should report errors for missing required fields', () => {
    const input = '---\nid: test\n---';
    const tokens = tokenize(input).tokens;
    const result = parseFrontMatter(tokens, 0, 'test.mam.md');

    expect(result.errors.length).toBeGreaterThan(0);
  });
});