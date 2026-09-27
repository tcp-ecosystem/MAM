import { allCodeBlocks, Module, Section } from './ast.js';
import { Diagnostic, ValidationResult, errors, info, warnings } from './validator.js';
import { ExecutionResult } from './runtime.js';

/** Formats a one-line module summary. */
export function formatModuleSummary(module: Module): string {
  return `${module.frontmatter?.name || '(untitled)'}: ${module.sections.length} sections, ${allCodeBlocks(module).length} code blocks`;
}

/** Formats a module as indented JSON. */
export function formatModuleJSON(module: Module): string {
  return JSON.stringify(module, null, 2);
}

/** Formats section titles with their canonical kind. */
export function formatSectionList(module: Module): string {
  return module.sections.map((section) => `${section.kind.padEnd(15)} ${section.title}`).join('\n') || 'no sections';
}

/** Formats validation diagnostics grouped by severity. */
export function formatValidationReport(result: ValidationResult): string {
  return result.diagnostics.length ? result.diagnostics.map((item) => `${item.severity.padEnd(7)} ${item.code} ${item.message}`).join('\n') : 'no diagnostics';
}

/** Formats execution results with truncated output. */
export function formatExecutionResults(results: ExecutionResult[]): string {
  return results.map((result) => `${result.exit_code === 0 ? 'PASS' : 'FAIL'} ${result.language} (${result.duration_ms}ms)\n${result.stdout}${result.stderr}`).join('\n') || 'no executions';
}

/** Formats code blocks with languages and line counts. */
export function formatCodeBlockList(module: Module): string {
  return allCodeBlocks(module).map((block, index) => `${index + 1}. ${block.language || 'unknown'} (${block.code.split('\n').length} lines)`).join('\n') || 'no code blocks';
}

/** Formats frontmatter fields in stable order. */
export function formatFrontMatter(module: Module): string {
  const fm = module.frontmatter;
  if (!fm) return 'no frontmatter';
  return [`name: ${fm.name}`, `version: ${fm.version}`, `description: ${fm.description}`, `authors: ${fm.authors.join(', ')}`, `tags: ${fm.tags.join(', ')}`, `license: ${fm.license}`, `dependencies: ${fm.dependencies.join(', ')}`].join('\n');
}

/** Formats a table row with aligned columns. */
export function formatTableRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/** Formats a Markdown table from rows. */
export function formatMarkdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  return [formatTableRow(rows[0]), formatTableRow(rows[0].map(() => '---')), ...rows.slice(1).map(formatTableRow)].join('\n');
}

/** Formats a section's content nodes. */
export function formatSectionContent(section: Section): string {
  return section.content.map((node) => node.kind === 'CodeBlock' ? `\`\`\`${node.language}\n${node.code}\n\`\`\`` : node.kind === 'List' ? node.items.map((item) => `- ${item}`).join('\n') : 'text' in node ? node.text : '').filter(Boolean).join('\n\n');
}

/** Formats a diagnostic for one-line display. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  return `${diagnostic.severity} ${diagnostic.code} at line ${diagnostic.line}${diagnostic.section ? ` in ${diagnostic.section}` : ''}: ${diagnostic.message}`;
}

/** Formats all diagnostics in stable order. */
export function formatDiagnostics(result: ValidationResult): string {
  return result.diagnostics.map(formatDiagnostic).join('\n') || 'no diagnostics';
}

/** Formats a graph as a Mermaid flowchart. */
export function formatGraphText(graph: { nodes: string[]; edges: Array<[string, string]> }): string {
  const lines = ['flowchart TD', ...graph.nodes.map((node) => `  ${safeGraphId(node)}[${node}]`), ...graph.edges.map(([from, to]) => `  ${safeGraphId(from)} --> ${safeGraphId(to)}`)];
  return lines.join('\n');
}

/** Formats a dependency list as a Markdown bullet list. */
export function formatDependencyList(dependencies: string[]): string {
  return dependencies.map((item) => `- ${item}`).join('\n') || '- none';
}

/** Formats a language histogram. */
export function formatLanguageCounts(counts: Record<string, number>): string {
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => `${name}: ${count}`).join(', ') || 'none';
}

/** Truncates a string for display. */
export function truncateText(text: string, length = 80): string {
  return text.length <= length ? text : `${text.slice(0, Math.max(0, length - 3))}...`;
}

/** Returns a summary with no trailing whitespace. */
export function trimReport(text: string): string {
  return text.split('\n').map((line) => line.trimEnd()).join('\n').trim();
}

/** Returns a JSON-friendly diagnostic object. */
export function diagnosticToJSON(diagnostic: Diagnostic): Record<string, unknown> {
  return { code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message, line: diagnostic.line, section: diagnostic.section };
}

/** Returns a JSON-friendly execution object. */
export function executionToJSON(result: ExecutionResult): Record<string, unknown> {
  return { exit_code: result.exit_code, stdout: result.stdout, stderr: result.stderr, duration_ms: result.duration_ms };
}

/** Returns a report header. */
export function reportHeader(title: string): string {
  return `== ${title} ==`;
}

/** Returns a bullet list from arbitrary strings. */
export function formatBulletList(values: string[]): string {
  return values.map((value) => `- ${value}`).join('\n') || '- none';
}

/** Returns a normalized table separator. */
export function formatTableSeparator(columns: number): string {
  return `|${' --- |'.repeat(columns)}`;
}

function safeGraphId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, '_');
}


/** Returns a heading under a report title. */
export function formatSubheading(title: string): string {
  return `${title}\n${'-'.repeat(Math.max(1, title.length))}`;
}

/** Returns a code block with a normalized language tag. */
export function formatCode(language: string, code: string): string {
  return `\`\`\`${language.trim() || 'text'}\n${code.replace(/\s+$/, '')}\n\`\`\``;
}

/** Returns a list of labels for a frontmatter object. */
export function formatLabels(labels: string[]): string {
  return labels.length ? labels.join(', ') : 'none';
}

/** Returns a short module name with a fallback. */
export function formatModuleName(name: string | undefined): string {
  return name?.trim() || '(untitled)';
}

/** Returns a duration in milliseconds with a stable unit. */
export function formatDuration(durationMs: number): string {
  return `${Math.max(0, Math.round(durationMs))}ms`;
}

/** Returns a percentage with one decimal place. */
export function formatPercent(value: number): string {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

/** Returns a table of section content counts. */
export function formatContentCounts(module: Module): string {
  return module.sections.map((section) => `${section.title}: ${section.content.length}`).join('\n') || 'no sections';
}

/** Returns a list of diagnostic sections. */
export function diagnosticSectionNames(result: ValidationResult): string[] {
  return [...new Set(result.diagnostics.map((diagnostic) => diagnostic.section).filter(Boolean))];
}

/** Returns a compact execution result. */
export function formatExecution(result: ExecutionResult): string {
  return `${result.language}: ${result.exit_code === 0 ? 'ok' : 'error'} in ${formatDuration(result.duration_ms)}`;
}

/** Returns a list of languages from a module. */
export function formatModuleLanguages(module: Module): string {
  return formatLanguageCounts(allCodeBlocks(module).reduce<Record<string, number>>((counts, block) => { const key = block.language || 'unknown'; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}));
}

/** Returns a stable code block line. */
export function formatCodeBlockLine(index: number, language: string, code: string): string {
  return `${index}. ${language || 'unknown'}: ${code.split('\n').length} lines`;
}

/** Returns a deterministic report section. */
export function formatSection(title: string, body: string): string {
  return `${formatSubheading(title)}\n${body || 'none'}`;
}

/** Returns a JSON string with stable two-space indentation. */
export function prettyJSON(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Returns a display-safe value for unknown data. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  return prettyJSON(value);
}

/** Returns a count suffix. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** Returns a report-safe value. */
export function safeReportText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Returns a frontmatter line. */
export function formatConfigLine(key: string, value: unknown): string {
  return `${key}: ${displayValue(value)}`;
}

/** Returns a list of configuration lines. */
export function formatConfigLines(values: Record<string, unknown>): string {
  return Object.entries(values).map(([key, value]) => formatConfigLine(key, value)).join('\n');
}

/** Returns a list of section count lines. */
export function formatSectionCounts(module: Module): string {
  return formatContentCounts(module);
}

/** Returns a list of code count lines. */
export function formatCodeCounts(module: Module): string {
  return allCodeBlocks(module).map((block, index) => formatCodeBlockLine(index + 1, block.language, block.code)).join('\n') || 'no code blocks';
}

/** Returns a diagnostic count line. */
export function formatDiagnosticCounts(result: ValidationResult): string {
  return `${errors(result).length} errors, ${warnings(result).length} warnings, ${info(result).length} info`;
}

/** Returns a JSON report with a stable envelope. */
export function formatJSONReport(value: unknown): string {
  return prettyJSON({ value });
}

/** Returns a simple heading line. */
export function formatHeading(title: string): string {
  return `# ${title.trim() || 'MAM'}`;
}

/** Returns a section heading line. */
export function formatSectionHeading(title: string): string {
  return `## ${title.trim() || 'Untitled'}`;
}

/** Returns a quote line. */
export function formatQuote(text: string): string {
  return text.split('\n').map((line) => `> ${line}`).join('\n');
}

/** Returns a list line. */
export function formatListItem(text: string): string {
  return `- ${text}`;
}

/** Returns a list of code lines. */
export function formatCodeLines(code: string): string {
  return code.split('\n').map((line) => `  ${line}`).join('\n');
}

/** Returns a table separator for rows. */
export function formatRows(rows: string[][]): string {
  return rows.map(formatTableRow).join('\n');
}

/** Returns a compact label-value report. */
export function formatLabelValue(label: string, value: string): string {
  return `${label}: ${value || 'none'}`;
}

/** Returns a safe truncation with an ellipsis. */
export function formatEllipsis(value: string, length = 40): string {
  return truncateText(value, length);
}

/** Returns a normalized duration. */
export function formatMillis(value: number): string {
  return formatDuration(value);
}

/** Returns a stable section list count. */
export function formatCount(label: string, count: number): string {
  return `${label}: ${count}`;
}

/** Returns a report with a final newline. */
export function withFinalNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

/** Returns a report without a final newline. */
export function withoutFinalNewline(value: string): string {
  return value.replace(/\n+$/, '');
}

/** Returns a list of lines. */
export function lines(value: string): string[] {
  return value.split('\n');
}

/** Returns a text value with tabs normalized. */
export function normalizeTabs(value: string): string {
  return value.replace(/\t/g, '  ');
}

/** Returns a safe text excerpt. */
export function excerpt(value: string, limit = 120): string {
  return normalizeTabs(truncateText(value, limit));
}

/** Returns a title-case section kind. */
export function displaySectionKind(kind: string): string {
  return kind === 'Custom' ? kind : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/** Returns a language count report. */
export function formatLanguageReport(counts: Record<string, number>): string {
  return formatLanguageCounts(counts);
}

/** Returns an execution aggregate report. */
export function formatExecutionReport(results: ExecutionResult[]): string {
  return formatExecutionResults(results);
}
