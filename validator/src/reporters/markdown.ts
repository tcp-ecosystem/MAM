/**
 * Markdown Validation Reporter
 *
 * Renders validation issues as a Markdown list or table with
 * severity badges, plus an optional summary section.
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

export interface MarkdownReporterOptions {
  /** Include a summary section (default: true) */
  includeSummary?: boolean;
  /** Render issues as a Markdown table instead of a list (default: false) */
  tableFormat?: boolean;
}

const SEVERITY_BADGE: Record<string, string> = {
  error: '**ERROR**',
  warning: '**WARN**',
  info: '**INFO**',
};

function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function location(issue: ValidationIssue): string {
  if (issue.line == null) return '';
  return `:${issue.line}${issue.column != null ? `:${issue.column}` : ''}`;
}

export class MarkdownReporter {
  private options: MarkdownReporterOptions;

  constructor(options?: MarkdownReporterOptions) {
    this.options = {
      includeSummary: true,
      tableFormat: false,
      ...options,
    };
  }

  report(result: ValidationReport): string {
    const lines: string[] = [];

    lines.push('# Validation Report');
    lines.push('');
    lines.push(`**File:** \`${result.file}\``);
    lines.push('');

    if (result.issues.length === 0) {
      lines.push('_No issues found._');
      lines.push('');
    } else if (this.options.tableFormat) {
      lines.push('| Severity | Rule | Message | Location |');
      lines.push('| --- | --- | --- | --- |');
      for (const issue of result.issues) {
        const badge = SEVERITY_BADGE[issue.severity] ?? issue.severity;
        lines.push(
          `| ${escapeTableCell(badge)} | \`${escapeTableCell(issue.rule)}\` | ${escapeTableCell(issue.message)} | ${escapeTableCell(location(issue))} |`
        );
      }
      lines.push('');
    } else {
      lines.push('### Issues');
      lines.push('');
      for (const issue of result.issues) {
        const badge = SEVERITY_BADGE[issue.severity] ?? issue.severity;
        const code = issue.code ? ` \`${issue.code}\`` : '';
        const loc = location(issue);
        lines.push(
          `- ${badge} \`${issue.rule}\`${code}: ${issue.message}${loc ? ` (${loc})` : ''}`
        );
      }
      lines.push('');
    }

    if (this.options.includeSummary) {
      const errors = result.issues.filter(i => i.severity === 'error').length;
      const warnings = result.issues.filter(i => i.severity === 'warning').length;
      const infos = result.issues.filter(i => i.severity === 'info').length;
      lines.push('### Summary');
      lines.push('');
      lines.push(`- **Result:** ${result.passed ? 'PASS' : 'FAIL'}`);
      lines.push(
        `- **Issues:** ${result.issues.length} (${errors} errors, ${warnings} warnings, ${infos} info)`
      );
    }

    return lines.join('\n').trimEnd() + '\n';
  }
}