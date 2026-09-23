/**
 * MAM Validation Formatting
 *
 * Text-oriented formatters for `ValidationIssue` and `ValidationReport`.
 * These produce CLI-friendly output (human readable, tables, and JSON) without
 * mutating their inputs. Note the distinct names from the validator's existing
 * `formatValidationError`/`formatValidationWarning` helpers: those render the
 * strict `ValidationError`/`ValidationWarning` shapes, while these render the
 * unified `ValidationIssue` and whole reports.
 */

import type { ValidationReport, ValidationStats } from './index.js';
import type { ValidationIssue } from './types.js';

/**
 * Options controlling how a report is rendered by `formatReport`.
 *
 * @property includeErrors - Whether to include error issues. Defaults to `true`.
 * @property includeWarnings - Whether to include warning issues. Defaults to `true`.
 * @property maxIssues - Cap on the number of rendered issues. Defaults to `50`.
 * @property includeSummary - Whether to append a summary line. Defaults to `true`.
 */
export interface FormatReportOptions {
  includeErrors?: boolean;
  includeWarnings?: boolean;
  maxIssues?: number;
  includeSummary?: boolean;
}

/**
 * Format a single issue as a multi-line, human-readable block.
 *
 * Includes the location, severity, code, message, producing rule, AST path,
 * and suggested fix when present.
 *
 * @param issue - The issue to format.
 * @returns A multi-line string describing the issue.
 */
export function formatIssue(issue: ValidationIssue): string {
  const loc = issue.location
    ? `[${issue.location.start.line}:${issue.location.start.column}] `
    : '';
  const rule = issue.rule ? ` (${issue.rule})` : '';
  let out = `${loc}${issue.severity} [${String(issue.code)}]: ${issue.message}${rule}`;
  if (issue.path) out += `\n  at: ${issue.path}`;
  if (issue.suggestedFix) out += `\n  fix: ${issue.suggestedFix.description}`;
  return out;
}

/**
 * Format a single issue as a compact, single-line string.
 *
 * Suitable for log lines and tight terminal output.
 *
 * @param issue - The issue to format.
 * @returns A one-line string describing the issue.
 */
export function formatCompact(issue: ValidationIssue): string {
  const loc = issue.location
    ? ` ${issue.location.start.line}:${issue.location.start.column}`
    : '';
  return `${issue.severity}${loc} [${String(issue.code)}] ${issue.message}`;
}

/**
 * Format a collection of issues as an aligned plain-text table.
 *
 * Columns: severity, code, location, rule, message. Column widths are derived
 * from the content so the table renders cleanly in monospace terminals.
 *
 * @param issues - Issues to tabulate.
 * @returns A table string (no trailing newline).
 */
export function formatTable(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return 'No issues.';
  }

  const rows = issues.map((issue) => ({
    severity: issue.severity,
    code: String(issue.code),
    loc: issue.location
      ? `${issue.location.start.line}:${issue.location.start.column}`
      : '-',
    rule: issue.rule ?? '-',
    message: issue.message,
  }));

  const widths = {
    severity: Math.max(8, ...rows.map((r) => r.severity.length)),
    code: Math.max(4, ...rows.map((r) => r.code.length)),
    loc: Math.max(3, ...rows.map((r) => r.loc.length)),
    rule: Math.max(4, ...rows.map((r) => r.rule.length)),
  };

  const pad = (value: string, width: number) => value.padEnd(width);
  const header =
    pad('severity', widths.severity) +
    '  ' +
    pad('code', widths.code) +
    '  ' +
    pad('loc', widths.loc) +
    '  ' +
    pad('rule', widths.rule) +
    '  message';
  const separator = '-'.repeat(header.length);

  const lines = rows.map((r) =>
    pad(r.severity, widths.severity) +
    '  ' +
    pad(r.code, widths.code) +
    '  ' +
    pad(r.loc, widths.loc) +
    '  ' +
    pad(r.rule, widths.rule) +
    '  ' +
    r.message
  );

  return [header, separator, ...lines].join('\n');
}

/**
 * Format validation statistics as a single summary line.
 *
 * @param stats - Statistics to summarize.
 * @returns A one-line summary string.
 */
export function formatSummary(stats: ValidationStats): string {
  const outcome = stats.errorCount === 0 ? 'valid' : 'invalid';
  return (
    `${outcome} — ${stats.errorCount} error(s), ${stats.warningCount} warning(s), ` +
    `${stats.rulesChecked} rule(s) checked in ${stats.timeMs.toFixed(1)}ms`
  );
}

/**
 * Format an entire validation report as human-readable text.
 *
 * Renders errors and warnings (subject to options), then optionally appends a
 * summary line.
 *
 * @param report - The report to format.
 * @param options - Rendering options.
 * @returns A multi-line report string (no trailing newline).
 */
export function formatReport(
  report: ValidationReport,
  options: FormatReportOptions = {}
): string {
  const includeErrors = options.includeErrors ?? true;
  const includeWarnings = options.includeWarnings ?? true;
  const maxIssues = options.maxIssues ?? 50;
  const includeSummary = options.includeSummary ?? true;

  const lines: string[] = [];
  const render = (kind: 'error' | 'warning', code: string, message: string, source?: string, line?: number, column?: number) => {
    const loc = source && line !== undefined ? ` at ${source}:${line}:${column}` : '';
    lines.push(`${kind} [${code}]: ${message}${loc}`);
  };

  if (includeErrors) {
    for (const error of report.errors) {
      render('error', String(error.code), error.message, error.location?.source, error.location?.start.line, error.location?.start.column);
      if (lines.length >= maxIssues) break;
    }
  }

  if (includeWarnings) {
    for (const warning of report.warnings) {
      render('warning', String(warning.code), warning.message, warning.location?.source, warning.location?.start.line, warning.location?.start.column);
      if (lines.length >= maxIssues) break;
    }
  }

  if (includeSummary) {
    lines.push(formatSummary(report.stats));
  }

  return lines.join('\n');
}

/**
 * Serialize a validation report to pretty-printed JSON.
 *
 * @param report - The report to serialize.
 * @returns A JSON string with two-space indentation.
 */
export function formatJSON(report: ValidationReport): string {
  return JSON.stringify(report, null, 2);
}