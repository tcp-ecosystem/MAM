/**
 * Console Validation Reporter
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

export class ConsoleReporter {
  report(result: ValidationReport): void {
    const prefix = result.passed ? '✓' : '✗';
    console.log(`${prefix} ${result.file}`);

    for (const issue of result.issues) {
      const loc = issue.line ? `:${issue.line}:${issue.column || 0}` : '';
      const marker = issue.severity === 'error' ? '  ERROR' : issue.severity === 'warning' ? '  WARN ' : '  INFO ';
      console.log(`  ${marker} [${issue.rule}] ${issue.message}${loc}`);
    }
  }
}
