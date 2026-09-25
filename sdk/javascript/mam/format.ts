import type { AST, FrontMatter, Section, SourceLocation } from './parser.js';
import type { ExecutionResult, ModuleExecutionResult } from './runtime.js';
import type { ValidationIssue } from './validator.js';

export function formatModuleSummary(ast: AST): string {
  const rawTitle = ast.frontmatter?.data['title'];
  const title = typeof rawTitle === 'string' && rawTitle !== '' ? rawTitle : '(untitled)';
  const sections = ast.sections.length;
  const blocks = countASTCodeBlocks(ast);
  return `${title}: ${sections} sections, ${blocks} code blocks`;
}

export function formatModuleJSON(ast: AST): string {
  return JSON.stringify(ast, null, 2);
}

export function formatSectionList(ast: AST): string {
  if (ast.sections.length === 0) {
    return '(no sections)';
  }
  const totalChars = ast.sections.reduce((total, section) => total + sectionContentLength(section), 0);
  const rows = ast.sections.map((section, index) => [
    String(index + 1),
    truncateMiddle(section.name, 40),
    String(countSectionCodeBlocks(section)),
  ]);
  const table = formatDataTable(['#', 'Section', 'Blocks'], rows);
  return `${table}\n${ast.sections.length} sections, ${totalChars} chars`;
}

function sectionContentLength(section: Section): number {
  return section.content.reduce((total, node) => total + node.value.length, 0);
}

export function formatValidationReport(issues: ValidationIssue[]): string {
  if (issues.length === 0) {
    return 'No issues found.';
  }
  const lines: string[] = [];
  for (const issue of issues) {
    lines.push(formatValidationIssue(issue));
  }
  lines.push('---');
  lines.push(formatIssueCounts(countIssueSeverities(issues)));
  const ruleBreakdown = formatRuleBreakdown(issues);
  if (ruleBreakdown !== '') {
    lines.push(ruleBreakdown);
  }
  return lines.join('\n');
}

export function formatExecutionResults(result: ModuleExecutionResult): string {
  const lines: string[] = [];
  lines.push(result.success ? 'Execution succeeded' : 'Execution failed');
  result.sectionResults.forEach((section, index) => {
    const status = section.success ? 'ok' : 'failed';
    lines.push(`[${index}] ${section.sectionName} (${section.language}, ${status}, ${section.duration}ms)`);
    if (typeof section.output === 'string' && section.output !== '') {
      lines.push(indentBlock(`output:\n${excerptLines(section.output, 3)}`, '    '));
    }
    for (const error of section.errors) {
      lines.push(`    error: ${wrapSingleLine(error, 100)}`);
    }
  });
  const failed = result.sectionResults.filter((section) => !section.success).map((section) => section.sectionName);
  if (failed.length > 0) {
    lines.push(`failed: ${failed.join(', ')}`);
  }
  lines.push(`total: ${result.duration}ms, ${result.errors.length} error(s)`);
  return lines.join('\n');
}

export function formatCodeBlockList(ast: AST): string {
  const rows: string[][] = [];
  let index = 0;
  for (const section of ast.sections) {
    for (const node of section.content) {
      if (node.type === 'CodeBlock') {
        rows.push([
          String(index),
          normalizeLanguageLabel(node.language),
          `${node.value.length} chars`,
          `${node.value.split('\n').length} lines`,
        ]);
        index++;
      }
    }
  }
  if (rows.length === 0) {
    return '(no code blocks)';
  }
  const breakdown = formatLanguageBreakdown(rows);
  const table = formatDataTable(['#', 'Language', 'Size', 'Lines'], rows);
  return breakdown === '' ? table : `${breakdown}\n${table}`;
}

export function formatFrontMatter(frontmatter: FrontMatter | null): string {
  if (frontmatter === null) {
    return '(no front matter)';
  }
  const keys = Object.keys(frontmatter.data).sort();
  if (keys.length === 0) {
    return '(empty front matter)';
  }
  const width = keys.reduce((max, key) => Math.max(max, key.length), 0);
  return keys
    .map((key) => `${padRightTo(key, width)}: ${truncateMiddle(formatFrontMatterValue(frontmatter.data[key]), 80)}`)
    .join('\n');
}

function formatFrontMatterValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function countASTCodeBlocks(ast: AST): number {
  let total = 0;
  for (const section of ast.sections) {
    total += countSectionCodeBlocks(section);
  }
  return total;
}

function countSectionCodeBlocks(section: { content: Array<{ type: string }> }): number {
  return section.content.filter((node) => node.type === 'CodeBlock').length;
}

function countIssueSeverities(issues: ValidationIssue[]): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity] = (counts[issue.severity] ?? 0) + 1;
  }
  return counts;
}

function formatValidationIssue(issue: ValidationIssue): string {
  const tag = formatSeverityTag(issue.severity);
  const location = issue.location === undefined ? '' : ` (${formatIssueLocation(issue.location)})`;
  return `${tag} [${issue.rule}] ${issue.message}${location}`;
}

function formatSeverityTag(severity: string): string {
  if (severity === 'error') {
    return 'ERROR';
  }
  if (severity === 'warning') {
    return 'WARN ';
  }
  return 'INFO ';
}

function formatIssueLocation(location: SourceLocation): string {
  const at = `line ${location.start.line}, col ${location.start.column}`;
  if (location.source === '' || location.source === '<input>') {
    return at;
  }
  return `${location.source} ${at}`;
}

function formatIssueCounts(counts: Record<string, number>): string {
  const parts: string[] = [];
  const errors = counts.error ?? 0;
  const warnings = counts.warning ?? 0;
  const infos = counts.info ?? 0;
  parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  parts.push(`${infos} info`);
  return parts.join(', ');
}

function formatDataTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header) => header.length);
  for (const row of rows) {
    headers.forEach((_, index) => {
      const cell = row[index] ?? '';
      if (cell.length > (widths[index] ?? 0)) {
        widths[index] = cell.length;
      }
    });
  }
  const lines = [formatTableRow(headers, widths), formatTableSeparator(widths)];
  for (const row of rows) {
    lines.push(formatTableRow(padRowCells(row, headers.length), widths));
  }
  return lines.join('\n');
}

function formatTableRow(cells: string[], widths: number[]): string {
  const parts = widths.map((width, index) => padRightTo(cells[index] ?? '', width));
  return `| ${parts.join(' | ')} |`;
}

function formatTableSeparator(widths: number[]): string {
  return `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`;
}

function padRowCells(row: string[], width: number): string[] {
  if (row.length >= width) {
    return row.slice(0, width);
  }
  return [...row, ...new Array<string>(width - row.length).fill('')];
}

function padRightTo(text: string, width: number): string {
  if (text.length >= width) {
    return text;
  }
  return text + ' '.repeat(width - text.length);
}

function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength || maxLength <= 3) {
    return text;
  }
  const keep = maxLength - 3;
  const left = Math.floor(keep / 2);
  return text.slice(0, left) + '...' + text.slice(text.length - (keep - left));
}

function wrapSingleLine(text: string, maxLength: number): string {
  const single = text.split(/\s+/).filter((part) => part !== '').join(' ');
  if (single.length <= maxLength) {
    return single;
  }
  const words = single.split(' ');
  let kept = '';
  for (const word of words) {
    const candidate = kept === '' ? word : `${kept} ${word}`;
    if (candidate.length > maxLength - 3) {
      break;
    }
    kept = candidate;
  }
  if (kept === '') {
    return single.slice(0, maxLength - 3) + '...';
  }
  return `${kept}...`;
}

function formatRuleBreakdown(issues: ValidationIssue[]): string {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.rule, (counts.get(issue.rule) ?? 0) + 1);
  }
  if (counts.size <= 1) {
    return '';
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([rule, count]) => `${rule} x${count}`);
  return `rules: ${parts.join(', ')}`;
}

function excerptLines(text: string, maxLines: number): string {
  const trimmed = text.replace(/\n+$/, '');
  if (trimmed === '') {
    return '';
  }
  const lines = trimmed.split('\n');
  if (lines.length <= maxLines) {
    return trimmed;
  }
  const total = lines.length;
  return [...lines.slice(0, maxLines), `... (${total - maxLines} more lines)`].join('\n');
}

function indentBlock(text: string, prefix: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? line : prefix + line))
    .join('\n');
}

function normalizeLanguageLabel(language: string | undefined): string {
  const trimmed = (language ?? '').trim().toLowerCase();
  return trimmed === '' ? 'unknown' : trimmed;
}

function formatLanguageBreakdown(rows: string[][]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const language = row[1] ?? 'unknown';
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  if (counts.size <= 1) {
    return '';
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([language, count]) => `${language} x${count}`);
  return parts.join(', ');
}
