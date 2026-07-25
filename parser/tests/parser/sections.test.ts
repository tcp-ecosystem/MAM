/**
 * Sections Parser Tests
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/lexer/index.js';
import { parseSections } from '../../src/parser/sections.js';

describe('Sections Parser', () => {
  it('should parse a simple section', () => {
    const input = '## Purpose\n\nThis is the purpose.';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.name).toBe('Purpose');
    expect(result.sections[0]?.content.length).toBeGreaterThan(0);
  });

  it('should parse multiple sections', () => {
    const input = '## Purpose\n\nPurpose text.\n\n## Rules\n\n- Rule 1\n- Rule 2';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]?.name).toBe('Purpose');
    expect(result.sections[1]?.name).toBe('Rules');
  });

  it('should parse code blocks', () => {
    const input = '## Python\n\n```python\ndef hello():\n    pass\n```';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.sections).toHaveLength(1);
    const codeBlock = result.sections[0]?.content.find(c => c.type === 'codeblock');
    expect(codeBlock).toBeDefined();
  });

  it('should parse lists', () => {
    const input = '## Rules\n\n- Rule 1\n- Rule 2\n- Rule 3';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.sections).toHaveLength(1);
    const list = result.sections[0]?.content.find(c => c.type === 'list');
    expect(list).toBeDefined();
  });

  it('should warn on unknown sections', () => {
    const input = '## Purpose\n\nTest.\n\n## CustomSection\n\nContent.';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.warnings.some(w => w.message.includes('CustomSection'))).toBe(true);
  });

  it('should warn on empty sections', () => {
    const input = '## Purpose\n\nTest.\n\n## Empty\n\n';
    const tokens = tokenize(input).tokens;
    const result = parseSections(tokens, 0, 'test.mam.md');

    expect(result.warnings.some(w => w.message.includes('EmptySection') || w.message.includes('empty'))).toBe(true);
  });
});