/**
 * JSON Reporter Tests
 */

import { describe, it, expect } from 'vitest';
import { JSONReporter } from '../../src/reporters/json.js';
import type { ValidationReport, ValidationIssue } from '../../src/reporters/json.js';

function createReport(
  overrides: Partial<ValidationReport> = {}
): ValidationReport {
  return {
    file: 'test.mam.md',
    issues: [],
    passed: true,
    ...overrides,
  };
}

function createIssue(overrides: Partial<ValidationIssue> = {}): ValidationIssue {
  return {
    rule: 'required',
    code: 'MISSING_FIELD',
    message: 'Missing field',
    severity: 'error',
    ...overrides,
  };
}

describe('JSONReporter', () => {
  describe('report', () => {
    it('should output valid JSON', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(createReport());
      const parsed = JSON.parse(output);
      expect(parsed).toBeDefined();
    });

    it('should include file name', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(createReport({ file: 'my-module.mam.md' }));
      const parsed = JSON.parse(output);
      expect(parsed.file).toBe('my-module.mam.md');
    });

    it('should include passed status', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(createReport({ passed: true }));
      const parsed = JSON.parse(output);
      expect(parsed.passed).toBe(true);
    });

    it('should include issues', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(
        createReport({
          issues: [createIssue({ message: 'test error' })],
        })
      );
      const parsed = JSON.parse(output);
      expect(parsed.issues).toHaveLength(1);
      expect(parsed.issues[0].message).toBe('test error');
    });

    it('should include metadata', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(createReport());
      const parsed = JSON.parse(output);
      expect(parsed.metadata).toBeDefined();
      expect(parsed.metadata.validator).toBe('@mam/validator');
      expect(parsed.metadata.timestamp).toBeDefined();
    });

    it('should include stats', () => {
      const reporter = new JSONReporter({ includeStats: true });
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'error' }),
            createIssue({ severity: 'warning' }),
          ],
        })
      );
      const parsed = JSON.parse(output);
      expect(parsed.stats.errors).toBe(1);
      expect(parsed.stats.warnings).toBe(1);
      expect(parsed.stats.total).toBe(2);
    });

    it('should include locations when configured', () => {
      const reporter = new JSONReporter({ includeLocations: true });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ line: 10, column: 5 })],
        })
      );
      const parsed = JSON.parse(output);
      expect(parsed.issues[0].location).toEqual({ line: 10, column: 5 });
    });

    it('should exclude locations when configured', () => {
      const reporter = new JSONReporter({ includeLocations: false });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ line: 10, column: 5 })],
        })
      );
      const parsed = JSON.parse(output);
      expect(parsed.issues[0].location).toBeUndefined();
    });

    it('should sort issues by severity', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'info', message: 'info1' }),
            createIssue({ severity: 'error', message: 'err1' }),
          ],
        })
      );
      const parsed = JSON.parse(output);
      expect(parsed.issues[0].severity).toBe('error');
      expect(parsed.issues[1].severity).toBe('info');
    });

    it('should pretty-print by default', () => {
      const reporter = new JSONReporter({ pretty: true });
      const output = reporter.report(createReport());
      expect(output).toContain('\n');
      expect(output).toContain('  ');
    });

    it('should compact output when configured', () => {
      const reporter = new JSONReporter({ pretty: false });
      const output = reporter.report(createReport());
      // Compact: no newlines from formatting
      const lines = output.split('\n');
      expect(lines.length).toBe(1);
    });

    it('should output JSONL when configured', () => {
      const reporter = new JSONReporter({ jsonl: true });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ message: 'test' })],
        })
      );
      const lines = output.split('\n').filter(l => l.trim());
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const header = JSON.parse(lines[0]!);
      expect(header.type).toBe('report');
      const issueRecord = JSON.parse(lines[1]!);
      expect(issueRecord.type).toBe('issue');
      expect(issueRecord.issue.message).toBe('test');
    });

    it('should handle empty issues', () => {
      const reporter = new JSONReporter();
      const output = reporter.report(createReport());
      const parsed = JSON.parse(output);
      expect(parsed.issues).toHaveLength(0);
      expect(parsed.stats.total).toBe(0);
    });
  });
});
