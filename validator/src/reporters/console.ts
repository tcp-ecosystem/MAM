/**
 * Console Validation Reporter
 *
 * Colorized, grouped, sortable output with compact/verbose modes
 * and summary statistics.
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

export interface ConsoleReporterOptions {
  /** Use ANSI color codes (default: true) */
  color?: boolean;
  /** Show summary statistics (default: true) */
  showSummary?: boolean;
  /** Group issues by section/rule (default: false) */
  groupBy?: 'rule' | 'file' | 'severity';
  /** Sort by severity then location (default: true) */
  sort?: boolean;
  /** Verbose mode shows all details (default: false) */
  verbose?: boolean;
  /** Limit the number of issues printed (default: unlimited) */
  maxIssues?: number;
  /** Print only the PASS/FAIL line and summary, no issues (default: false) */
  summaryOnly?: boolean;
  /** Show the rule name column (default: true) */
  showRuleColumn?: boolean;
}

const SEVERITY_ORDER: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

const LABELS: Record<string, string> = {
  error: 'ERROR',
  warning: 'WARN ',
  info: 'INFO ',
};

function severityColor(severity: string, useColor: boolean): string {
  if (!useColor) return '';
  switch (severity) {
    case 'error':
      return COLORS.red;
    case 'warning':
      return COLORS.yellow;
    case 'info':
      return COLORS.blue;
    default:
      return '';
  }
}

function resetColor(useColor: boolean): string {
  return useColor ? COLORS.reset : '';
}

function dimColor(useColor: boolean): string {
  return useColor ? COLORS.dim : '';
}

function boldColor(useColor: boolean): string {
  return useColor ? COLORS.bold : '';
}

function sortIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return [...issues].sort((a, b) => {
    const sevDiff =
      (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3);
    if (sevDiff !== 0) return sevDiff;
    const lineA = a.line ?? Infinity;
    const lineB = b.line ?? Infinity;
    if (lineA !== lineB) return lineA - lineB;
    const colA = a.column ?? 0;
    const colB = b.column ?? 0;
    return colA - colB;
  });
}

function formatIssue(
  issue: ValidationIssue,
  useColor: boolean,
  verbose: boolean,
  showRuleColumn: boolean
): string {
  const color = severityColor(issue.severity, useColor);
  const reset = resetColor(useColor);
  const dim = dimColor(useColor);
  const bold = boldColor(useColor);

  const label = LABELS[issue.severity] ?? '???  ';
  const loc =
    issue.line != null
      ? `:${issue.line}:${issue.column ?? 0}`
      : '';

  const codeStr = issue.code ? ` [${issue.code}]` : '';
  const ruleStr = showRuleColumn ? `${bold}${issue.rule}${reset} ` : '';
  const pathStr = issue.path ? ` ${dim}(${issue.path})${reset}` : '';

  let line = `  ${color}${label}${reset} ${ruleStr}${issue.message}${loc}${pathStr}`;

  if (verbose && issue.path) {
    line += `\n       ${dim}path: ${issue.path}${reset}`;
  }

  return line;
}

export class ConsoleReporter {
  private options: ConsoleReporterOptions;

  constructor(options?: ConsoleReporterOptions) {
    this.options = {
      color: true,
      showSummary: true,
      sort: true,
      verbose: false,
      summaryOnly: false,
      showRuleColumn: true,
      ...options,
    };
  }

  report(result: ValidationReport): string {
    const useColor = this.options.color !== false;
    const lines: string[] = [];

    const passColor = useColor ? COLORS.green : '';
    const failColor = useColor ? COLORS.red : '';
    const reset = resetColor(useColor);
    const bold = boldColor(useColor);
    const dim = dimColor(useColor);

    const prefix = result.passed
      ? `${passColor}${bold}PASS${reset}`
      : `${failColor}${bold}FAIL${reset}`;
    lines.push(`${prefix} ${result.file}`);

    if (result.issues.length === 0) {
      lines.push(`  ${dim}No issues found${reset}`);
    } else if (this.options.summaryOnly) {
      // summaryOnly: no issue details, only the PASS/FAIL line and summary
    } else {
      let issues = result.issues;
      if (this.options.sort) {
        issues = sortIssues(issues);
      }

      const maxIssues = this.options.maxIssues;
      const verbose = this.options.verbose ?? false;
      const showRuleColumn = this.options.showRuleColumn !== false;
      let printed = 0;
      const emit = (issue: ValidationIssue) => {
        if (maxIssues != null && printed >= maxIssues) return;
        lines.push(formatIssue(issue, useColor, verbose, showRuleColumn));
        printed++;
      };
      const atLimit = () => maxIssues != null && printed >= maxIssues;

      if (this.options.groupBy === 'rule') {
        const groups = new Map<string, ValidationIssue[]>();
        for (const issue of issues) {
          const key = issue.rule;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(issue);
        }
        for (const [rule, groupIssues] of groups) {
          if (atLimit()) break;
          lines.push(
            `\n  ${bold}${useColor ? COLORS.cyan : ''}[${rule}]${reset} (${groupIssues.length} issue${groupIssues.length > 1 ? 's' : ''})`
          );
          for (const issue of groupIssues) {
            emit(issue);
          }
        }
      } else if (this.options.groupBy === 'severity') {
        const groups = new Map<string, ValidationIssue[]>();
        for (const issue of issues) {
          const key = issue.severity;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(issue);
        }
        for (const severity of ['error', 'warning', 'info']) {
          const groupIssues = groups.get(severity);
          if (!groupIssues || groupIssues.length === 0) continue;
          if (atLimit()) break;
          const color = severityColor(severity, useColor);
          lines.push(
            `\n  ${color}${bold}${severity.toUpperCase()}S${reset} (${groupIssues.length})`
          );
          for (const issue of groupIssues) {
            emit(issue);
          }
        }
      } else {
        for (const issue of issues) {
          emit(issue);
        }
      }

      if (maxIssues != null && printed < issues.length) {
        lines.push(`  ${dim}+${issues.length - printed} more...${reset}`);
      }
    }

    if (this.options.showSummary) {
      const errors = result.issues.filter(i => i.severity === 'error').length;
      const warnings = result.issues.filter(i => i.severity === 'warning').length;
      const infos = result.issues.filter(i => i.severity === 'info').length;

      lines.push('');
      const summaryParts: string[] = [];
      if (errors > 0)
        summaryParts.push(`${useColor ? COLORS.red : ''}${errors} error${errors > 1 ? 's' : ''}${reset}`);
      if (warnings > 0)
        summaryParts.push(`${useColor ? COLORS.yellow : ''}${warnings} warning${warnings > 1 ? 's' : ''}${reset}`);
      if (infos > 0)
        summaryParts.push(`${useColor ? COLORS.blue : ''}${infos} info${infos > 1 ? 's' : ''}${reset}`);
      if (summaryParts.length === 0) {
        summaryParts.push(`${useColor ? COLORS.green : ''}0 issues${reset}`);
      }
      lines.push(`  ${dim}Summary:${reset} ${summaryParts.join(', ')}`);
    }

    return lines.join('\n');
  }
}
