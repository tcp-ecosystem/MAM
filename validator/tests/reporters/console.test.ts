/**
 * Console Reporter Tests
 */

import { describe, it, expect } from 'vitest';
import { ConsoleReporter } from '../../src/reporters/console.js';
import type { ValidationReport, ValidationIssue } from '../../src/reporters/console.js';

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
    message: 'Missing field',
    severity: 'error',
    ...overrides,
  };
}

describe('ConsoleReporter', () => {
  describe('report', () => {
    it('should output PASS for passed validation', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(createReport());
      expect(output).toContain('PASS');
      expect(output).toContain('test.mam.md');
    });

    it('should output FAIL for failed validation', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          passed: false,
          issues: [createIssue()],
        })
      );
      expect(output).toContain('FAIL');
    });

    it('should display error issues', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          passed: false,
          issues: [createIssue({ rule: 'required', message: 'Missing id' })],
        })
      );
      expect(output).toContain('ERROR');
      expect(output).toContain('Missing id');
    });

    it('should display warning issues', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'warning', message: 'Deprecated' })],
        })
      );
      expect(output).toContain('WARN');
      expect(output).toContain('Deprecated');
    });

    it('should display info issues', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'info', message: 'Hint' })],
        })
      );
      expect(output).toContain('INFO');
      expect(output).toContain('Hint');
    });

    it('should include line numbers when present', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ line: 10, column: 5 })],
        })
      );
      expect(output).toContain(':10:5');
    });

    it('should include rule name', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ rule: 'ordering' })],
        })
      );
      expect(output).toContain('ordering');
    });

    it('should show summary statistics', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'error' }),
            createIssue({ severity: 'error' }),
            createIssue({ severity: 'warning' }),
          ],
        })
      );
      expect(output).toContain('Summary');
      expect(output).toContain('2 error');
      expect(output).toContain('1 warning');
    });

    it('should show 0 issues when none present', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(createReport());
      expect(output).toContain('0 issues');
    });

    it('should sort issues by severity then location', () => {
      const reporter = new ConsoleReporter({ color: false, sort: true });
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'info', message: 'info1' }),
            createIssue({ severity: 'error', message: 'err1' }),
            createIssue({ severity: 'warning', message: 'warn1' }),
          ],
        })
      );
      const errPos = output.indexOf('err1');
      const warnPos = output.indexOf('warn1');
      const infoPos = output.indexOf('info1');
      expect(errPos).toBeLessThan(warnPos);
      expect(warnPos).toBeLessThan(infoPos);
    });

    it('should group by rule when configured', () => {
      const reporter = new ConsoleReporter({ color: false, groupBy: 'rule' });
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ rule: 'required', message: 'msg1' }),
            createIssue({ rule: 'ordering', message: 'msg2' }),
          ],
        })
      );
      expect(output).toContain('[required]');
      expect(output).toContain('[ordering]');
    });

    it('should group by severity when configured', () => {
      const reporter = new ConsoleReporter({ color: false, groupBy: 'severity' });
      const output = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'error', message: 'err' }),
            createIssue({ severity: 'warning', message: 'warn' }),
          ],
        })
      );
      expect(output).toContain('ERRORS');
      expect(output).toContain('WARNINGS');
    });

    it('should use color when enabled', () => {
      const reporter = new ConsoleReporter({ color: true });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'error' })],
        })
      );
      expect(output).toContain('\x1b[');
    });

    it('should handle verbose mode', () => {
      const reporter = new ConsoleReporter({ color: false, verbose: true });
      const output = reporter.report(
        createReport({
          issues: [createIssue({ path: 'frontmatter.id' })],
        })
      );
      expect(output).toContain('path:');
    });

    it('should handle empty issues with "No issues found"', () => {
      const reporter = new ConsoleReporter({ color: false });
      const output = reporter.report(createReport());
      expect(output).toContain('No issues found');
    });
  });
});
