/**
 * JSON Validation Reporter
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

export class JSONReporter {
  report(result: ValidationReport): string {
    return JSON.stringify(result, null, 2);
  }
}
