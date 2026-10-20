/**
 * CLI validate rule regression tests.
 *
 * Runs individual built-in rules directly against synthetic contexts, so a
 * rule can be pinned down without standing up the whole validator run.
 */

import { describe, it, expect } from 'vitest';
import { BUILT_IN_RULES, type ValidationContext } from '../src/commands/validate.js';

function ctxFor(lines: string[], filePath = 'test.mam'): ValidationContext {
  const content = lines.join('\n');
  return {
    content,
    lines,
    ast: null as any,
    filePath,
    config: {} as any,
    level: 'syntax',
    frontmatter: {},
    sections: [],
    codeBlocks: [],
    links: [],
  } as unknown as ValidationContext;
}

describe('FM002 frontmatter-closed', () => {
  const fm002 = BUILT_IN_RULES.find((r) => r.id === 'FM002');

  it('is registered at syntax level as an error', () => {
    expect(fm002).toBeDefined();
    expect(fm002!.severity).toBe('error');
    expect(fm002!.level).toBe('syntax');
  });

  it('accepts a long frontmatter block (52 lines, regression: the rule previously stopped searching at line 50)', () => {
    // 51 key/value lines then the closing fence, i.e. close on line 52.
    const lines = ['---'];
    for (let i = 2; i <= 51; i++) lines.push(`key-${i}: value-${i}`);
    lines.push('---');
    lines.push('## Purpose');

    const ctx = ctxFor(lines);
    expect(fm002!.check(ctx)).toEqual([]);
  });

  it('reports a frontmatter block with no closing fence', () => {
    const lines = ['---', 'id: runaway', '## Purpose'];
    const ctx = ctxFor(lines);

    const diags = fm002!.check(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ ruleId: 'FM002', severity: 'error', line: 1 });
  });

  it('skips files that do not open with frontmatter', () => {
    const ctx = ctxFor(['## Purpose', 'plain prose']);
    expect(fm002!.check(ctx)).toEqual([]);
  });

  it('rejects a frontmatter block longer than the old 50-line window when unclosed', () => {
    const lines = ['---'];
    for (let i = 2; i <= 60; i++) lines.push(`key-${i}: value-${i}`);
    const ctx = ctxFor(lines);

    const diags = fm002!.check(ctx);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe('FM002');
  });
});