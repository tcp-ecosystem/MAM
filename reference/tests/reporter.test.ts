import { describe, it, expect } from 'vitest';
import {
  REPORT_SEPARATOR,
  summarizeBuildResult,
  formatValidationDetails,
  formatBuildStats,
  formatAsJson,
  countBySeverity,
  hasErrors,
} from '../src/reporter.js';
import type { BuildResult, ValidationDetail } from '../src/types.js';

function makeResult(overrides: Partial<BuildResult> = {}): BuildResult {
  return {
    success: true,
    errors: [],
    warnings: [],
    stats: {
      timeMs: 12.5,
      inputSize: 100,
      outputSize: 200,
      sections: 3,
      codeBlocks: 1,
      edges: 2,
    },
    ...overrides,
  };
}

describe('summarizeBuildResult', () => {
  it('should summarize successful builds', () => {
    const text = summarizeBuildResult(makeResult({ output: './dist/out.py' }));
    expect(text).toContain('BUILD SUCCEEDED');
    expect(text).toContain('./dist/out.py');
    expect(text).toContain(REPORT_SEPARATOR);
  });

  it('should list errors and warnings', () => {
    const text = summarizeBuildResult(
      makeResult({ success: false, errors: ['boom'], warnings: ['careful'] }),
    );
    expect(text).toContain('BUILD FAILED');
    expect(text).toContain('boom');
    expect(text).toContain('careful');
  });
});

describe('formatValidationDetails', () => {
  it('should handle clean results', () => {
    expect(formatValidationDetails([])).toBe('No issues found.');
  });

  it('should format each detail with counts', () => {
    const details: ValidationDetail[] = [
      { severity: 'error', code: 'E1', message: 'bad', path: 'f.mam.md', line: 2 },
      { severity: 'warning', code: 'W1', message: 'warn' },
    ];
    const text = formatValidationDetails(details);
    expect(text).toContain('[E1]');
    expect(text).toContain('f.mam.md:2');
    expect(text).toContain('1 error');
    expect(text).toContain('1 warning');
  });
});

describe('formatBuildStats', () => {
  it('should include key figures', () => {
    const text = formatBuildStats(makeResult().stats);
    expect(text).toContain('3 sections');
    expect(text).toContain('1 code blocks');
    expect(text).toContain('12.5ms');
  });
});

describe('formatAsJson', () => {
  it('should pretty-print JSON', () => {
    const text = formatAsJson({ a: 1 });
    expect(JSON.parse(text)).toEqual({ a: 1 });
    expect(text).toContain('\n');
  });
});

describe('countBySeverity', () => {
  it('should count severities', () => {
    const details: ValidationDetail[] = [
      { severity: 'error', code: 'E', message: 'x' },
      { severity: 'error', code: 'E', message: 'y' },
      { severity: 'info', code: 'I', message: 'z' },
    ];
    expect(countBySeverity(details)).toEqual({ error: 2, warning: 0, info: 1 });
  });
});

describe('hasErrors', () => {
  it('should detect errors', () => {
    expect(hasErrors([{ severity: 'error', code: 'E', message: 'x' }])).toBe(true);
    expect(hasErrors([{ severity: 'warning', code: 'W', message: 'x' }])).toBe(false);
    expect(hasErrors([])).toBe(false);
  });
});
