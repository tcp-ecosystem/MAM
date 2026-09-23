/**
 * JSON Validation Reporter
 *
 * Structured JSON output with metadata, pretty-printing,
 * source locations, rule information, stats, and JSONL support.
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

export interface JSONReporterOptions {
  /** Pretty-print JSON output (default: true) */
  pretty?: boolean;
  /** Include source location details (default: true) */
  includeLocations?: boolean;
  /** Include rule metadata (default: true) */
  includeRuleInfo?: boolean;
  /** Include stats summary (default: true) */
  includeStats?: boolean;
  /** Output as JSONL (newline-delimited JSON) (default: false) */
  jsonl?: boolean;
  /** Indentation spaces (default: 2) */
  indent?: number;
  /** Only include error-severity issues (default: false) */
  errorOnly?: boolean;
  /** Include trimmed source line text for each issue (default: false) */
  includeSource?: boolean;
  /** Callback to fetch source line text when includeSource is enabled */
  getLine?: (line: number) => string | undefined;
}

export interface JSONIssueOutput {
  rule: string;
  code: string;
  message: string;
  severity: string;
  location?: {
    line: number;
    column: number;
  };
  path?: string;
  source?: {
    line: string;
  };
}

export interface JSONReportOutput {
  file: string;
  passed: boolean;
  issues: JSONIssueOutput[];
  stats: {
    total: number;
    errors: number;
    warnings: number;
    info: number;
  };
  metadata: {
    timestamp: string;
    validator: string;
    version: string;
  };
}

export interface JSONLRecord {
  type: 'report' | 'issue';
  file?: string;
  issue?: JSONIssueOutput;
  passed?: boolean;
  stats?: JSONReportOutput['stats'];
}

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const sevDiff =
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    const lineA = a.line ?? Infinity;
    const lineB = b.line ?? Infinity;
    if (lineA !== lineB) return lineA - lineB;
    return (a.column ?? 0) - (b.column ?? 0);
  });
}

function computeStats(issues: ValidationIssue[]): JSONReportOutput['stats'] {
  return {
    total: issues.length,
    errors: issues.filter(i => i.severity === 'error').length,
    warnings: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
  };
}

export class JSONReporter {
  private options: JSONReporterOptions;

  constructor(options?: JSONReporterOptions) {
    this.options = {
      pretty: true,
      includeLocations: true,
      includeRuleInfo: true,
      includeStats: true,
      jsonl: false,
      indent: 2,
      errorOnly: false,
      includeSource: false,
      ...options,
    };
  }

  report(result: ValidationReport): string {
    if (this.options.jsonl) {
      return this.reportJSONL(result);
    }
    return this.reportJSON(result);
  }

  private reportJSON(result: ValidationReport): string {
    const sorted = sortIssues(
      this.options.errorOnly
        ? result.issues.filter(i => i.severity === 'error')
        : result.issues
    );
    const stats = computeStats(sorted);

    const issues: JSONIssueOutput[] = sorted.map(issue => {
      const out: JSONIssueOutput = {
        rule: issue.rule,
        code: issue.code ?? 'UNKNOWN',
        message: issue.message,
        severity: issue.severity,
      };

      if (this.options.includeLocations && issue.line != null) {
        out.location = {
          line: issue.line,
          column: issue.column ?? 0,
        };
      }

      if (issue.path) {
        out.path = issue.path;
      }

      if (this.options.includeSource && issue.line != null) {
        const text = this.options.getLine?.(issue.line);
        if (text !== undefined) {
          out.source = { line: text.trim() };
        }
      }

      return out;
    });

    const output: JSONReportOutput = {
      file: result.file,
      passed: result.passed,
      issues,
      stats: this.options.includeStats ? stats : { total: stats.total, errors: stats.errors, warnings: stats.warnings, info: stats.info },
      metadata: {
        timestamp: new Date().toISOString(),
        validator: '@mam/validator',
        version: '0.1.0',
      },
    };

    const indent = this.options.pretty ? this.options.indent : 0;
    return JSON.stringify(output, null, indent);
  }

  private reportJSONL(result: ValidationReport): string {
    const sorted = sortIssues(
      this.options.errorOnly
        ? result.issues.filter(i => i.severity === 'error')
        : result.issues
    );
    const stats = computeStats(sorted);
    const lines: string[] = [];

    const header: JSONLRecord = {
      type: 'report',
      file: result.file,
      passed: result.passed,
      stats,
    };
    lines.push(JSON.stringify(header));

    for (const issue of sorted) {
      const issueOut: JSONIssueOutput = {
        rule: issue.rule,
        code: issue.code ?? 'UNKNOWN',
        message: issue.message,
        severity: issue.severity,
      };

      if (this.options.includeLocations && issue.line != null) {
        issueOut.location = { line: issue.line, column: issue.column ?? 0 };
      }
      if (issue.path) {
        issueOut.path = issue.path;
      }
      if (this.options.includeSource && issue.line != null) {
        const text = this.options.getLine?.(issue.line);
        if (text !== undefined) {
          issueOut.source = { line: text.trim() };
        }
      }

      const record: JSONLRecord = {
        type: 'issue',
        issue: issueOut,
      };
      lines.push(JSON.stringify(record));
    }

    return lines.join('\n');
  }
}
