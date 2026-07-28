/**
 * LSP Validation Reporter
 *
 * Formats validation results for Language Server Protocol consumption.
 */

export interface ValidationIssue {
  rule: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
}

export interface ValidationReport {
  file: string;
  issues: ValidationIssue[];
  passed: boolean;
}

export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 1 | 2 | 3;
  source: string;
  message: string;
}

export class LSPReporter {
  report(result: ValidationReport): LSPDiagnostic[] {
    return result.issues.map(issue => ({
      range: {
        start: { line: (issue.line ?? 1) - 1, character: issue.column ?? 0 },
        end: { line: (issue.line ?? 1) - 1, character: (issue.column ?? 0) + 1 },
      },
      severity: issue.severity === 'error' ? 1 as const : issue.severity === 'warning' ? 2 as const : 3 as const,
      source: 'mam-validator',
      message: `[${issue.rule}] ${issue.message}`,
    }));
  }
}
