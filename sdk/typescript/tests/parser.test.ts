import { describe, expect, it } from 'vitest';
import { allCodeBlocks, isValidModule, moduleSummary, parse, parseString, SECTION_KINDS, mustParse } from '../mam/index.js';

const valid = `---\nschema_version: "1"\nname: Demo\nversion: "1.0.0"\ndescription: A demo\nauthors:\n  - Team\ntags:\n  - demo\nlicense: MIT\n---\n\n## Metadata\n\nDemo metadata.\n\n## Purpose\n\nDo work.\n\n## Python\n\n\`\`\`python\nprint("ok")\n\`\`\`\n`;

describe('contract parser', () => {
  it('parses frontmatter fields', () => {
    const module = parse(valid);
    expect(module.frontmatter?.name).toBe('Demo');
    expect(module.frontmatter?.authors).toEqual(['Team']);
    expect(module.frontmatter?.tags).toEqual(['demo']);
  });

  it('parses sections and canonical kinds', () => {
    const module = parseString(valid);
    expect(module.sections.map((section) => section.kind)).toEqual(['metadata', 'purpose', 'python']);
    expect(SECTION_KINDS).toHaveLength(20);
  });

  it('extracts code blocks with locations', () => {
    const blocks = allCodeBlocks(parseString(valid));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].language).toBe('python');
    expect(blocks[0].location.line).toBeGreaterThan(0);
  });

  it('retains unknown sections as Custom', () => {
    const module = parseString('---\nname: X\n---\n\n## Mystery\n\nHello.\n');
    expect(module.sections[0].kind).toBe('Custom');
  });

  it('parses list and table content', () => {
    const module = parseString('---\nname: X\n---\n\n## Purpose\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    expect(module.sections[0].content.some((node) => node.kind === 'List')).toBe(true);
    expect(module.sections[0].content.some((node) => node.kind === 'Table')).toBe(true);
  });

  it('accepts content without frontmatter for validation', () => {
    expect(parse('## Purpose\n\nText.').frontmatter).toBeNull();
  });

  it('rejects unterminated frontmatter', () => {
    expect(() => parseString('---\nname: X\n\n## Purpose\n\nText.')).toThrow(/closing/);
  });

  it('provides mustParse for static fixtures', () => {
    expect(mustParse(valid).frontmatter?.name).toBe('Demo');
  });

  it('reports validity and summary', () => {
    const module = parseString(valid);
    expect(isValidModule(module)).toBe(true);
    expect(moduleSummary(module)).toContain('Demo');
  });
});
