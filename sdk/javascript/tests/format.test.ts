import { describe, it, expect } from 'vitest';
import {
  formatModuleSummary,
  formatModuleJSON,
  formatSectionList,
  formatValidationReport,
  formatExecutionResults,
  formatCodeBlockList,
  formatFrontMatter,
} from '../mam/format.js';
import { parseMAM } from '../mam/parser.js';

const FIXTURE = `---
title: Format Me
version: 2.0.0
author: Tester
---

## Purpose

A module for formatting.

## Python

\`\`\`python
print('hi')
\`\`\`
`;

describe('formatModuleSummary', () => {
  it('summarizes sections and code blocks', () => {
    const text = formatModuleSummary(parseMAM(FIXTURE).ast);
    expect(text).toContain('Format Me');
    expect(text).toContain('2 sections');
    expect(text).toContain('1 code blocks');
  });

  it('falls back for untitled modules', () => {
    const text = formatModuleSummary(parseMAM('## Purpose\n\nHi.\n').ast);
    expect(text).toContain('(untitled)');
  });
});

describe('formatModuleJSON', () => {
  it('round-trips through JSON.parse', () => {
    const ast = parseMAM(FIXTURE).ast;
    const text = formatModuleJSON(ast);
    expect(JSON.parse(text)).toEqual(ast);
  });
});

describe('formatSectionList', () => {
  it('lists sections with totals', () => {
    const text = formatSectionList(parseMAM(FIXTURE).ast);
    expect(text).toContain('Purpose');
    expect(text).toContain('Python');
    expect(text).toContain('2 sections');
  });

  it('handles empty modules', () => {
    expect(formatSectionList(parseMAM('').ast)).toBe('(no sections)');
  });
});

describe('formatValidationReport', () => {
  it('reports clean modules', () => {
    const issues = [{ rule: 'r', code: 'X', message: 'w', severity: 'warning' }];
    expect(formatValidationReport([])).toBe('No issues found.');
    const text = formatValidationReport(issues);
    expect(text).toContain('[r]');
    expect(text).toContain('1 warning');
  });
});

describe('formatExecutionResults', () => {
  it('renders per-section lines and failures', () => {
    const result = {
      success: false,
      sectionResults: [
        { success: true, output: 'a', errors: [], duration: 1, sectionName: 'A', language: 'python' },
        { success: false, output: '', errors: ['boom'], duration: 1, sectionName: 'B', language: 'js' },
      ],
      output: {},
      duration: 10,
      memory: {},
      errors: ['[B] boom'],
    };
    const text = formatExecutionResults(result);
    expect(text).toContain('Execution failed');
    expect(text).toContain('B');
    expect(text).toContain('failed: B');
  });
});

describe('formatCodeBlockList', () => {
  it('lists code blocks with language breakdown', () => {
    const text = formatCodeBlockList(parseMAM(FIXTURE).ast);
    expect(text).toContain('python');
    expect(text).toContain('Language');
  });

  it('handles modules without code blocks', () => {
    expect(formatCodeBlockList(parseMAM('## Purpose\n\nWords.\n').ast)).toBe('(no code blocks)');
  });
});

describe('formatFrontMatter', () => {
  it('renders front matter data aligned', () => {
    const ast = parseMAM(FIXTURE).ast;
    const text = formatFrontMatter(ast.frontmatter);
    expect(text).toContain('Format Me');
    expect(text).toContain('2.0.0');
  });

  it('handles missing front matter', () => {
    expect(formatFrontMatter(parseMAM('## Purpose\n\nHi.\n').ast.frontmatter)).toBe('(no front matter)');
  });
});