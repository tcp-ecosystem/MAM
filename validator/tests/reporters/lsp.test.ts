/**
 * LSP Reporter Tests
 */

import { describe, it, expect } from 'vitest';
import { LSPReporter } from '../../src/reporters/lsp.js';
import type { ValidationReport, ValidationIssue } from '../../src/reporters/lsp.js';

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

describe('LSPReporter', () => {
  describe('report', () => {
    it('should return LSPResult with uri and diagnostics', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(createReport());
      expect(result.uri).toBeDefined();
      expect(result.diagnostics).toBeDefined();
      expect(Array.isArray(result.diagnostics)).toBe(true);
    });

    it('should convert file path to URI', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(createReport({ file: 'test.mam.md' }));
      expect(result.uri).toMatch(/^file:\/\//);
    });

    it('should map error severity to LSP severity 1', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'error' })],
        })
      );
      expect(result.diagnostics[0].severity).toBe(1);
    });

    it('should map warning severity to LSP severity 2', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'warning' })],
        })
      );
      expect(result.diagnostics[0].severity).toBe(2);
    });

    it('should map info severity to LSP severity 3', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ severity: 'info' })],
        })
      );
      expect(result.diagnostics[0].severity).toBe(3);
    });

    it('should include diagnostic code', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ code: 'MISSING_FIELD' })],
        })
      );
      expect(result.diagnostics[0].code).toBe('MISSING_FIELD');
    });

    it('should include source as mam-validator', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue()],
        })
      );
      expect(result.diagnostics[0].source).toBe('mam-validator');
    });

    it('should include rule in message', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ rule: 'required' })],
        })
      );
      expect(result.diagnostics[0].message).toContain('[required]');
    });

    it('should map line/column to LSP range (0-indexed)', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ line: 10, column: 5 })],
        })
      );
      expect(result.diagnostics[0].range.start.line).toBe(9);
      expect(result.diagnostics[0].range.start.character).toBe(5);
    });

    it('should default line to 0 when not provided', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue()],
        })
      );
      expect(result.diagnostics[0].range.start.line).toBe(0);
    });

    it('should include related information when configured', () => {
      const reporter = new LSPReporter({ includeRelatedInformation: true });
      const result = reporter.report(
        createReport({
          issues: [createIssue({ path: 'frontmatter.id' })],
        })
      );
      expect(result.diagnostics[0].relatedInformation).toBeDefined();
      expect(result.diagnostics[0].relatedInformation![0].message).toContain('frontmatter.id');
    });

    it('should include code actions for quickfix', () => {
      const reporter = new LSPReporter({ includeCodeActions: true });
      const result = reporter.report(
        createReport({
          issues: [createIssue({ code: 'MISSING_REQUIRED_FIELD' })],
        })
      );
      expect(result.codeActions).toBeDefined();
      expect(result.codeActions!.length).toBeGreaterThan(0);
      expect(result.codeActions![0].kind).toBe('quickfix');
    });

    it('should include code description href', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [createIssue({ rule: 'required' })],
        })
      );
      expect(result.diagnostics[0].codeDescription).toBeDefined();
      expect(result.diagnostics[0].codeDescription!.href).toContain('required');
    });

    it('should sort diagnostics by severity then location', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(
        createReport({
          issues: [
            createIssue({ severity: 'info', message: 'info1' }),
            createIssue({ severity: 'error', message: 'err1' }),
          ],
        })
      );
      expect(result.diagnostics[0].severity).toBe(1);
      expect(result.diagnostics[1].severity).toBe(3);
    });

    it('should handle empty issues', () => {
      const reporter = new LSPReporter();
      const result = reporter.report(createReport());
      expect(result.diagnostics).toHaveLength(0);
    });

    it('should use custom source name', () => {
      const reporter = new LSPReporter({ source: 'custom-validator' });
      const result = reporter.report(
        createReport({
          issues: [createIssue()],
        })
      );
      expect(result.diagnostics[0].source).toBe('custom-validator');
    });
  });
});
