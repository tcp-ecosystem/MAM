import type { BuildResult, BuildStats, ValidationDetail } from './types.js';

export const REPORT_SEPARATOR = '─'.repeat(60);

export function summarizeBuildResult(result: BuildResult): string {
  const lines: string[] = [];
  lines.push(formatResultHeader(result));
  lines.push(REPORT_SEPARATOR);
  if (result.output) {
    lines.push(`Output: ${result.output}`);
  }
  lines.push(`Stats: ${formatBuildStats(result.stats)}`);
  if (result.errors.length > 0) {
    lines.push(`Errors (${result.errors.length}):`);
    for (const error of result.errors) {
      lines.push(`  - ${error}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
  }
  return lines.join('\n');
}

export function formatValidationDetails(details: ValidationDetail[]): string {
  if (details.length === 0) return 'No issues found.';
  const lines: string[] = [];
  for (const detail of details) {
    lines.push(formatValidationDetail(detail));
  }
  const counts = countBySeverity(details);
  lines.push(REPORT_SEPARATOR);
  lines.push(formatSeverityCounts(counts));
  return lines.join('\n');
}

export function formatBuildStats(stats: BuildStats): string {
  return `${stats.sections} sections, ${stats.codeBlocks} code blocks, ${stats.edges} edges, ` +
    `${stats.inputSize}B in / ${stats.outputSize}B out, ${stats.timeMs.toFixed(1)}ms`;
}

export function formatAsJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function countBySeverity(details: ValidationDetail[]): Record<string, number> {
  const counts: Record<string, number> = { error: 0, warning: 0, info: 0 };
  for (const detail of details) {
    const key = detail.severity;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function hasErrors(details: ValidationDetail[]): boolean {
  return details.some((detail) => detail.severity === 'error');
}

function formatResultHeader(result: BuildResult): string {
  const status = result.success ? 'BUILD SUCCEEDED' : 'BUILD FAILED';
  return `${status} in ${result.stats.timeMs.toFixed(1)}ms`;
}

function formatValidationDetail(detail: ValidationDetail): string {
  const tag = formatSeverityTag(detail.severity);
  const location = formatDetailLocation(detail);
  const suffix = location ? ` (${location})` : '';
  return `${tag} [${detail.code}] ${detail.message}${suffix}`;
}

function formatSeverityTag(severity: ValidationDetail['severity']): string {
  if (severity === 'error') return 'ERROR';
  if (severity === 'warning') return 'WARN ';
  return 'INFO ';
}

function formatDetailLocation(detail: ValidationDetail): string {
  if (!detail.path) return '';
  const parts = [detail.path];
  if (detail.line !== undefined) parts.push(String(detail.line));
  if (detail.column !== undefined) parts.push(String(detail.column));
  return parts.join(':');
}

function formatSeverityCounts(counts: Record<string, number>): string {
  const parts: string[] = [];
  const errors = counts.error ?? 0;
  const warnings = counts.warning ?? 0;
  const infos = counts.info ?? 0;
  parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  parts.push(`${infos} info`);
  return parts.join(', ');
}

function formatErrorList(errors: string[], prefix: string): string[] {
  return errors.map((error) => `${prefix}${error}`);
}

function indentReportLines(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line.length === 0 ? line : pad + line)).join('\n');
}

function truncateReportLine(line: string, maxLength: number): string {
  if (line.length <= maxLength) return line;
  return line.slice(0, maxLength - 3) + '...';
}

function buildReportSection(title: string, body: string[]): string[] {
  const lines: string[] = [title, REPORT_SEPARATOR];
  lines.push(...body);
  return lines;
}

function summarizeErrors(errors: string[], limit = 5): string {
  if (errors.length === 0) return 'no errors';
  const shown = errors.slice(0, limit).map((error) => `  - ${truncateReportLine(error, 100)}`);
  if (errors.length > limit) {
    shown.push(`  ... and ${errors.length - limit} more`);
  }
  return shown.join('\n');
}

function summarizeWarnings(warnings: string[], limit = 5): string {
  if (warnings.length === 0) return 'no warnings';
  const shown = warnings.slice(0, limit).map((warning) => `  - ${truncateReportLine(warning, 100)}`);
  if (warnings.length > limit) {
    shown.push(`  ... and ${warnings.length - limit} more`);
  }
  return shown.join('\n');
}

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function buildStatsTable(stats: BuildStats): string[] {
  return [
    `sections    ${stats.sections}`,
    `code blocks ${stats.codeBlocks}`,
    `edges       ${stats.edges}`,
    `input       ${formatBytesShort(stats.inputSize)}`,
    `output      ${formatBytesShort(stats.outputSize)}`,
    `time        ${formatDurationShort(stats.timeMs)}`,
  ];
}

function renderFullBuildReport(result: BuildResult): string {
  const sections: string[] = [];
  sections.push(...buildReportSection(formatResultHeader(result), []));
  if (result.output) {
    sections.push(`Output: ${result.output}`);
  }
  sections.push(...buildReportSection('Stats', buildStatsTable(result.stats)));
  sections.push(...buildReportSection('Errors', [summarizeErrors(result.errors)]));
  sections.push(...buildReportSection('Warnings', [summarizeWarnings(result.warnings)]));
  return sections.join('\n');
}

function renderValidationReport(details: ValidationDetail[]): string {
  const sections: string[] = [];
  sections.push(...buildReportSection('Validation', details.map(formatValidationDetail)));
  sections.push(formatSeverityCounts(countBySeverity(details)));
  return sections.join('\n');
}

function groupDetailsByCode(details: ValidationDetail[]): Record<string, ValidationDetail[]> {
  const groups: Record<string, ValidationDetail[]> = {};
  for (const detail of details) {
    if (!groups[detail.code]) {
      groups[detail.code] = [];
    }
    groups[detail.code]!.push(detail);
  }
  return groups;
}

function formatGroupedDetails(details: ValidationDetail[]): string {
  const groups = groupDetailsByCode(details);
  const lines: string[] = [];
  for (const [code, items] of Object.entries(groups)) {
    lines.push(`${code} (${items.length}):`);
    for (const item of items) {
      lines.push(`  - ${truncateReportLine(item.message, 100)}`);
    }
  }
  return lines.join('\n');
}

function severityIcon(severity: ValidationDetail['severity']): string {
  if (severity === 'error') return 'E';
  if (severity === 'warning') return 'W';
  return 'I';
}

function padReportColumn(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  return text + ' '.repeat(width - text.length);
}

function buildDetailsTable(details: ValidationDetail[]): string[] {
  const codeWidth = Math.max(4, ...details.map((detail) => detail.code.length));
  return details.map((detail) => {
    const icon = severityIcon(detail.severity);
    const code = padReportColumn(detail.code, codeWidth);
    const location = formatDetailLocation(detail);
    const suffix = location ? ` @ ${location}` : '';
    return `${icon} ${code} ${truncateReportLine(detail.message, 80)}${suffix}`;
  });
}

function renderMarkdownValidationReport(details: ValidationDetail[]): string {
  const lines: string[] = ['# Validation Report', ''];
  const counts = countBySeverity(details);
  lines.push(`Errors: ${counts.error ?? 0} | Warnings: ${counts.warning ?? 0} | Info: ${counts.info ?? 0}`, '');
  for (const detail of details) {
    const location = formatDetailLocation(detail);
    const suffix = location ? ` (${location})` : '';
    lines.push(`- **${detail.severity}** \`${detail.code}\`: ${detail.message}${suffix}`);
  }
  return lines.join('\n');
}

function renderMarkdownBuildReport(result: BuildResult): string {
  const lines: string[] = ['# Build Report', ''];
  lines.push(`Status: ${result.success ? 'succeeded' : 'failed'}`, '');
  if (result.output) {
    lines.push(`Output: \`${result.output}\``, '');
  }
  lines.push('## Stats', '');
  lines.push(...buildStatsTable(result.stats).map((row) => `- ${row}`), '');
  lines.push('## Errors', '');
  lines.push(summarizeErrors(result.errors), '');
  lines.push('## Warnings', '');
  lines.push(summarizeWarnings(result.warnings));
  return lines.join('\n');
}

function wrapReportText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length > width && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function shortenReportPath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  const parts = path.split('/');
  while (parts.length > 1 && parts.join('/').length > maxLength - 3) {
    parts.shift();
  }
  return `.../${parts.join('/')}`;
}

function countErrors(details: ValidationDetail[]): number {
  return details.filter((detail) => detail.severity === 'error').length;
}

function countWarnings(details: ValidationDetail[]): number {
  return details.filter((detail) => detail.severity === 'warning').length;
}

function getWorstSeverity(details: ValidationDetail[]): ValidationDetail['severity'] | undefined {
  if (details.some((detail) => detail.severity === 'error')) return 'error';
  if (details.some((detail) => detail.severity === 'warning')) return 'warning';
  if (details.length > 0) return 'info';
  return undefined;
}

function diffBuildStats(before: BuildStats, after: BuildStats): string[] {
  const lines: string[] = [];
  lines.push(`sections: ${before.sections} -> ${after.sections}`);
  lines.push(`code blocks: ${before.codeBlocks} -> ${after.codeBlocks}`);
  lines.push(`edges: ${before.edges} -> ${after.edges}`);
  lines.push(`input: ${formatBytesShort(before.inputSize)} -> ${formatBytesShort(after.inputSize)}`);
  lines.push(`output: ${formatBytesShort(before.outputSize)} -> ${formatBytesShort(after.outputSize)}`);
  lines.push(`time: ${formatDurationShort(before.timeMs)} -> ${formatDurationShort(after.timeMs)}`);
  return lines;
}
