/**
 * HTML Validation Reporter
 *
 * Self-contained HTML report page with inline styles and no
 * external dependencies. Simple and valid HTML.
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

export type HTMLTheme = 'light' | 'dark' | 'auto';

export interface HTMLReporterOptions {
  /** Report page title (default: 'MAM Validation Report') */
  title?: string;
  /** Color theme: 'light', 'dark', or 'auto' (default: 'light') */
  theme?: HTMLTheme;
}

const THEME_STYLES: Record<HTMLTheme, string> = {
  light:
    ':root { --bg: #ffffff; --text: #1f2937; --muted: #6b7280; --border: #e5e7eb; --error: #dc2626; --warning: #d97706; --info: #2563eb; --pass: #16a34a; --fail: #dc2626; }',
  dark:
    ':root { --bg: #111827; --text: #e5e7eb; --muted: #9ca3af; --border: #374151; --error: #f87171; --warning: #fbbf24; --info: #60a5fa; --pass: #4ade80; --fail: #f87171; }',
  auto:
    '@media (prefers-color-scheme: light) { :root { --bg: #ffffff; --text: #1f2937; --muted: #6b7280; --border: #e5e7eb; --error: #dc2626; --warning: #d97706; --info: #2563eb; --pass: #16a34a; --fail: #dc2626; } } @media (prefers-color-scheme: dark) { :root { --bg: #111827; --text: #e5e7eb; --muted: #9ca3af; --border: #374151; --error: #f87171; --warning: #fbbf24; --info: #60a5fa; --pass: #4ade80; --fail: #f87171; } }',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function location(issue: ValidationIssue): string {
  if (issue.line == null) return '';
  return `:${issue.line}${issue.column != null ? `:${issue.column}` : ''}`;
}

export class HTMLReporter {
  private options: HTMLReporterOptions;

  constructor(options?: HTMLReporterOptions) {
    this.options = {
      title: 'MAM Validation Report',
      theme: 'light',
      ...options,
    };
  }

  report(result: ValidationReport): string {
    const title = this.options.title!;
    const theme = this.options.theme!;

    const errors = result.issues.filter(i => i.severity === 'error').length;
    const warnings = result.issues.filter(i => i.severity === 'warning').length;
    const infos = result.issues.filter(i => i.severity === 'info').length;

    let issuesHtml: string;
    if (result.issues.length === 0) {
      issuesHtml = '<p class="none">No issues found.</p>';
    } else {
      const items = result.issues
        .map(issue => {
          const sev = escapeHtml(issue.severity);
          const code = issue.code ? ` <code>[${escapeHtml(issue.code)}]</code>` : '';
          const loc = location(issue);
          const path = issue.path
            ? ` <span class="path">(${escapeHtml(issue.path)})</span>`
            : '';
          return (
            `<li class="issue ${sev}">` +
            `<span class="badge ${sev}">${sev.toUpperCase()}</span> ` +
            `<span class="rule">${escapeHtml(issue.rule)}</span>${code} ` +
            `<span class="message">${escapeHtml(issue.message)}</span>` +
            (loc ? `<span class="loc">${escapeHtml(loc)}</span>` : '') +
            path +
            '</li>'
          );
        })
        .join('\n');
      issuesHtml = `<ul>\n${items}\n</ul>`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${THEME_STYLES[theme]}
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 2rem; background: var(--bg); color: var(--text); }
h1 { font-size: 1.5rem; margin: 0 0 0.25rem; }
.file { color: var(--muted); font-size: 0.9rem; margin-bottom: 1.5rem; }
.result { display: inline-block; font-weight: 700; padding: 0.25rem 0.75rem; border-radius: 4px; margin-bottom: 1.5rem; color: #ffffff; }
.result.pass { background: var(--pass); }
.result.fail { background: var(--fail); }
ul { list-style: none; padding: 0; margin: 0; }
.issue { padding: 0.5rem 0.75rem; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 0.5rem; }
.badge { font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 3px; color: #ffffff; font-size: 0.75rem; }
.badge.error { background: var(--error); }
.badge.warning { background: var(--warning); }
.badge.info { background: var(--info); }
.rule { font-weight: 600; }
.message { color: var(--text); }
.code, .loc, .path { color: var(--muted); font-size: 0.85rem; }
.none { color: var(--muted); }
.summary { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="file">${escapeHtml(result.file)}</div>
<div class="result ${result.passed ? 'pass' : 'fail'}">${result.passed ? 'PASS' : 'FAIL'}</div>
${issuesHtml}
<div class="summary">${result.issues.length} issues: ${errors} errors, ${warnings} warnings, ${infos} info</div>
</body>
</html>
`;
  }
}