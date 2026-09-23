/**
 * GitHub Actions Validation Reporter
 *
 * Emits GitHub Actions workflow-command lines so validation results
 * appear inline in pull requests and checks.
 */

export interface ValidationIssue {
  rule: string;
  code?: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  line?: number;
  column?: number;
  path?: string;
}

export interface ValidationReport {
  file: string;
  issues: ValidationIssue[];
  passed: boolean;
}

export interface GitHubReporterOptions {
  /** Prefix the message with the rule name (default: true) */
  includeRule?: boolean;
  /** Include column in the command properties (default: true) */
  includeColumn?: boolean;
}

const COMMAND_BY_SEVERITY: Record<string, string> = {
  error: 'error',
  warning: 'warning',
  info: 'notice',
};

function escapeProperty(value: string): string {
  return value
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/:/g, '%3A')
    .replace(/,/g, '%2C');
}

function escapeMessage(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export class GitHubReporter {
  private options: GitHubReporterOptions;

  constructor(options?: GitHubReporterOptions) {
    this.options = {
      includeRule: true,
      includeColumn: true,
      ...options,
    };
  }

  report(result: ValidationReport): string {
    if (result.issues.length === 0) return '';

    const lines = result.issues.map(issue => {
      const command = COMMAND_BY_SEVERITY[issue.severity] ?? 'notice';
      const properties: string[] = [`file=${escapeProperty(result.file)}`];

      if (issue.line != null) {
        properties.push(`line=${issue.line}`);
        if (this.options.includeColumn) {
          properties.push(`col=${issue.column ?? 0}`);
        }
      }

      const body = this.options.includeRule
        ? `[${issue.rule}] ${issue.message}`
        : issue.message;

      return `::${command} ${properties.join(',')}::${escapeMessage(body)}`;
    });

    return lines.join('\n');
  }
}