/**
 * MAM Inspect Command
 *
 * Produces a deep, read-only inspection report for a MAM module.
 *
 * Unlike `mam smoke` (which exercises the pipeline and reports PASS/FAIL),
 * `mam inspect` answers the question *"what exactly is in this module?"*:
 *
 *   1. **source**    -> byte size, line count, encoding sanity, checksum
 *   2. **frontmatter**-> parsed YAML metadata (name, version, type, author...)
 *   3. **sections**  -> every section with kind, title, line range, byte size
 *                       and a heuristic token estimate
 *   4. **dependencies / exports / imports / plugins** -> the module contract
 *   5. **permissions / capabilities** -> the security + tool surface
 *   6. **ast**       -> node counts by kind via `@mam/ast` (`getASTStats`)
 *   7. **warnings**  -> parser warnings and validator warnings, grouped
 *
 * The report is rendered as an aligned, colourised text table by default and
 * as a single JSON document with `--json`, so it can be piped into other
 * tooling. Nothing is written to disk and no code is executed.
 *
 * @module inspect
 */
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import { parseMAM, type MAMModule as ParserModule } from '@mam/parser';
import { validate, type ValidationReport } from '@mam/validator';
import { getASTStats } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by {@link inspectCommand}. */
export interface InspectOptions {
  /** Path of the module to inspect. */
  file: string;
  /** Emit the full report as JSON instead of a text table. */
  json?: boolean;
  /** Include verbose extras (full section bodies, raw warnings). */
  verbose?: boolean;
  /** Report character encoding issues instead of assuming UTF-8. */
  detectEncoding?: boolean;
}

/** Source-level facts about the module file. */
export interface SourceReport {
  /** Absolute path that was inspected. */
  path: string;
  /** Basename of the file. */
  name: string;
  /** Total size on disk, in bytes. */
  bytes: number;
  /** Number of lines (newline separated). */
  lines: number;
  /** Number of non-empty, non-comment lines. */
  codeLines: number;
  /** Mean line length in characters. */
  averageLineLength: number;
  /** SHA-256 checksum of the raw source, hex encoded. */
  checksum: string;
  /** Whether the source appears to be valid UTF-8 text. */
  utf8: boolean;
}

/** A single rendered section of the module. */
export interface SectionReport {
  /** Section kind as reported by the parser (e.g. `metadata`, `workflow`). */
  kind: string;
  /** Section title/heading text. */
  title: string;
  /** 1-based starting line of the section. */
  startLine: number;
  /** 1-based ending line of the section. */
  endLine: number;
  /** Size of the section body in bytes. */
  bytes: number;
  /** Heuristic token estimate for the section body. */
  tokens: number;
}

/** Metadata parsed out of the module frontmatter. */
export interface MetadataReport {
  /** Whether frontmatter was present at all. */
  present: boolean;
  /** Flattened `key: value` pairs from the frontmatter. */
  fields: Record<string, string>;
}

/** Contract-level facts (dependencies, exports, imports, plugins). */
export interface ContractReport {
  /** Declared dependency names. */
  dependencies: string[];
  /** Declared export names. */
  exports: string[];
  /** Declared import names. */
  imports: string[];
  /** Declared plugin names. */
  plugins: string[];
  /** Declared permission names. */
  permissions: string[];
  /** Declared capability names. */
  capabilities: string[];
  /** Input names declared by the module. */
  inputs: string[];
  /** Output names declared by the module. */
  outputs: string[];
}

/** AST-level statistics. */
export interface AstReport {
  /** Total AST nodes. */
  totalNodes: number;
  /** Node counts keyed by node kind. */
  nodesByKind: Record<string, number>;
  /** Maximum nesting depth observed. */
  maxDepth: number;
}

/** Parser + validator diagnostics, grouped by severity. */
export interface DiagnosticReport {
  /** Hard parse errors. */
  errors: string[];
  /** Non-fatal parse warnings. */
  warnings: string[];
  /** Validation errors, formatted. */
  validationErrors: string[];
  /** Validation warnings, formatted. */
  validationWarnings: string[];
}

/** The complete inspection result. */
export interface InspectReport {
  /** Source-level facts. */
  source: SourceReport;
  /** Frontmatter metadata. */
  metadata: MetadataReport;
  /** Every section in the module. */
  sections: SectionReport[];
  /** Contract-level facts. */
  contract: ContractReport;
  /** AST statistics. */
  ast: AstReport;
  /** Diagnostics. */
  diagnostics: DiagnosticReport;
  /** Heuristic token estimate for the whole module. */
  estimatedTokens: number;
  /** ISO timestamp of when the inspection ran. */
  inspectedAt: number;
}

// ============================================================================
// Heuristics
// ============================================================================

/**
 * Heuristic token estimate: ~4 characters per token, which tracks closely
 * enough with BPE tokenizers for reporting purposes.
 *
 * @param text - text to measure.
 * @returns estimated token count.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Count lines and code lines in a source string.
 *
 * @param source - raw module source.
 * @returns `{ lines, codeLines, averageLineLength }`.
 */
export function countLines(source: string): {
  lines: number;
  codeLines: number;
  averageLineLength: number;
} {
  const lines = source.length === 0 ? 0 : source.split('\n').length;
  let codeLines = 0;
  let totalChars = 0;
  for (const raw of source.split('\n')) {
    totalChars += raw.length;
    const trimmed = raw.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#')) codeLines += 1;
  }
  const averageLineLength = lines === 0 ? 0 : Math.round(totalChars / lines);
  return { lines, codeLines, averageLineLength };
}

/**
 * Detect whether a buffer is plausible UTF-8 text.
 *
 * @param buffer - raw file bytes.
 * @returns `true` when the buffer decodes as UTF-8 without loss.
 */
export function looksLikeUtf8(buffer: Buffer): boolean {
  const decoded = buffer.toString('utf-8');
  return !decoded.includes('\uFFFD');
}

// ============================================================================
// Report builders
// ============================================================================

/**
 * Build the source-level portion of the report.
 *
 * @param raw - raw file bytes.
 * @param filePath - resolved path used for reporting.
 * @returns a {@link SourceReport}.
 */
export function buildSourceReport(raw: Buffer, filePath: string): SourceReport {
  const source = raw.toString('utf-8');
  const { lines, codeLines, averageLineLength } = countLines(source);
  return {
    path: filePath,
    name: basename(filePath),
    bytes: raw.byteLength,
    lines,
    codeLines,
    averageLineLength,
    checksum: createHash('sha256').update(raw).digest('hex'),
    utf8: looksLikeUtf8(raw),
  };
}

/**
 * Build the metadata (frontmatter) portion of the report.
 *
 * @param mod - the parsed module.
 * @returns a {@link MetadataReport}.
 */
export function buildMetadataReport(mod: ParserModule | undefined): MetadataReport {
  const fields: Record<string, string> = {};
  const raw = (mod as { raw_content?: string } | undefined)?.raw_content ?? '';
  const match = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (match) {
    for (const line of match[1].split('\n')) {
      const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line.trim());
      if (kv) fields[kv[1]] = kv[2].trim();
    }
  }
  return { present: Object.keys(fields).length > 0, fields };
}

/**
 * Build the section list portion of the report.
 *
 * @param mod - the parsed module.
 * @param source - raw module source (used for line ranges).
 * @returns an array of {@link SectionReport}.
 */
export function buildSectionReport(mod: ParserModule | undefined, source: string): SectionReport[] {
  const sections =
    ((mod as unknown as { sections?: Array<Record<string, unknown>> } | undefined)?.sections ?? []);
  const sourceLines = source.split('\n');
  const offset = sourceLines.findIndex((l) => l.trim() === '---');
  const reports: SectionReport[] = [];

  for (const section of sections) {
    const startLine = Number(section.start_line ?? section.line ?? 0);
    const endLine = Number(section.end_line ?? startLine);
    const content = String(section.content ?? section.body ?? '');
    reports.push({
      kind: String(section.kind ?? 'Custom'),
      title: String(section.title ?? section.kind ?? '(untitled)'),
      startLine: offset >= 0 && startLine > 0 ? startLine + offset : startLine,
      endLine: offset >= 0 && endLine > 0 ? endLine + offset : endLine,
      bytes: Buffer.byteLength(content, 'utf-8'),
      tokens: estimateTokens(content),
    });
  }
  return reports;
}

/**
 * Read a list-valued contract field from a section.
 *
 * @param mod - the parsed module.
 * @param sectionKind - section kind to read.
 * @param field - field name within the section.
 * @returns the string list, or an empty array.
 */
export function readListField(
  mod: ParserModule | undefined,
  sectionKind: string,
  field: string,
): string[] {
  const sections =
    ((mod as unknown as { sections?: Array<Record<string, unknown>> } | undefined)?.sections ?? []);
  const section = sections.find((s) => String(s.kind) === sectionKind);
  if (!section) return [];
  const value = section[field];
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(/[\n,]/)
      .map((v) => v.replace(/^[-*]\s*/, '').trim())
      .filter((v) => v.length > 0);
  }
  return [];
}

/**
 * Build the contract portion of the report.
 *
 * @param mod - the parsed module.
 * @returns a {@link ContractReport}.
 */
export function buildContractReport(mod: ParserModule | undefined): ContractReport {
  return {
    dependencies: readListField(mod, 'dependencies', 'items'),
    exports: readListField(mod, 'exports', 'items'),
    imports: readListField(mod, 'imports', 'items'),
    plugins: readListField(mod, 'plugins', 'items'),
    permissions: readListField(mod, 'permissions', 'items'),
    capabilities: readListField(mod, 'capabilities', 'items'),
    inputs: readListField(mod, 'inputs', 'items'),
    outputs: readListField(mod, 'outputs', 'items'),
  };
}

/**
 * Build the AST statistics portion of the report.
 *
 * @param mod - the parsed module.
 * @returns an {@link AstReport}.
 */
export function buildAstReport(mod: ParserModule | undefined): AstReport {
  try {
    const stats = getASTStats(mod as never) as unknown as {
      totalNodes?: number;
      nodesByKind?: Record<string, number>;
      maxDepth?: number;
    };
    return {
      totalNodes: stats?.totalNodes ?? 0,
      nodesByKind: stats?.nodesByKind ?? {},
      maxDepth: stats?.maxDepth ?? 0,
    };
  } catch {
    return { totalNodes: 0, nodesByKind: {}, maxDepth: 0 };
  }
}

/**
 * Build the diagnostics portion of the report.
 *
 * @param mod - the parsed module.
 * @param validation - the validator report, if validation ran.
 * @returns a {@link DiagnosticReport}.
 */
export function buildDiagnosticReport(
  mod: ParserModule | undefined,
  validation: ValidationReport | undefined,
): DiagnosticReport {
  const parseErrors = ((mod as { errors?: unknown[] } | undefined)?.errors ?? []) as Array<{
    message?: string;
    line?: number;
  }>;
  const parseWarnings = ((mod as { warnings?: unknown[] } | undefined)?.warnings ?? []) as Array<{
    message?: string;
    line?: number;
  }>;
  return {
    errors: parseErrors.map((e) => formatDiagnostic(e.message, e.line)),
    warnings: parseWarnings.map((e) => formatDiagnostic(e.message, e.line)),
    validationErrors: (validation?.errors ?? []).map((e) => String(e.message ?? e)),
    validationWarnings: (validation?.warnings ?? []).map((e) => String(e.message ?? e)),
  };
}

/**
 * Format a single diagnostic with its line number when available.
 *
 * @param message - diagnostic message.
 * @param line - optional 1-based line number.
 * @returns a formatted diagnostic string.
 */
export function formatDiagnostic(message: string | undefined, line: number | undefined): string {
  const text = message ?? '(no message)';
  return line !== undefined && line > 0 ? `line ${line}: ${text}` : text;
}

// ============================================================================
// Inspection core
// ============================================================================

/**
 * Inspect a module file and return the full report without printing it.
 *
 * @param options - inspection options.
 * @returns the complete {@link InspectReport}.
 */
export async function runInspect(options: InspectOptions): Promise<InspectReport> {
  const filePath = resolve(options.file);
  const raw = await readFile(filePath);
  const source = raw.toString('utf-8');

  const parsed = parseMAM(source, { source: filePath }) as unknown as {
    ast?: ParserModule;
    errors?: unknown[];
    warnings?: unknown[];
  };

  const mod = parsed?.ast ?? (parsed as unknown as ParserModule);

  let validation: ValidationReport | undefined;
  try {
    validation = validate(mod as never) as unknown as ValidationReport;
  } catch {
    validation = undefined;
  }

  const sections = buildSectionReport(mod, source);

  return {
    source: buildSourceReport(raw, filePath),
    metadata: buildMetadataReport(mod),
    sections,
    contract: buildContractReport(mod),
    ast: buildAstReport(mod),
    diagnostics: buildDiagnosticReport(mod, validation),
    estimatedTokens: sections.reduce((sum, s) => sum + s.tokens, 0),
    inspectedAt: Date.now(),
  };
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render an aligned key/value line.
 *
 * @param label - row label.
 * @param value - row value.
 * @param labelWidth - fixed label column width.
 * @returns the formatted line (no newline).
 */
export function row(label: string, value: string, labelWidth = 18): string {
  return `  ${chalk.cyan(label.padEnd(labelWidth))} ${value}`;
}

/**
 * Render a list row, or a dim dash when the list is empty.
 *
 * @param label - row label.
 * @param items - values to render.
 * @returns the formatted line (no newline).
 */
export function listRow(label: string, items: string[]): string {
  if (items.length === 0) return row(label, chalk.gray('(none)'));
  return row(label, items.map((i) => chalk.white(i)).join(chalk.gray(', ')));
}

/**
 * Render the whole report as a colourised text block.
 *
 * @param report - the inspection report.
 * @param verbose - include extra detail (per-node-kind counts, raw warnings).
 * @returns the rendered text.
 */
export function renderInspectReport(report: InspectReport, verbose = false): string {
  const out: string[] = [];
  const { source, metadata, contract, ast, diagnostics } = report;

  out.push('');
  out.push(chalk.cyan.bold(`Inspect: ${source.name}`));
  out.push(chalk.gray('='.repeat(60)));
  out.push(row('path', chalk.white(source.path)));
  out.push(row('bytes', chalk.white(String(source.bytes))));
  out.push(row('lines', chalk.white(`${source.lines} (${source.codeLines} code)`)));
  out.push(row('avg line', chalk.white(String(source.averageLineLength))));
  out.push(row('utf-8', source.utf8 ? chalk.green('yes') : chalk.yellow('no')));
  out.push(row('checksum', chalk.gray(source.checksum.slice(0, 16))));

  out.push('');
  out.push(chalk.cyan.bold('Metadata'));
  out.push(chalk.gray('-'.repeat(60)));
  if (!metadata.present) {
    out.push(row('frontmatter', chalk.gray('(absent)')));
  } else {
    for (const [key, value] of Object.entries(metadata.fields)) {
      out.push(row(key, chalk.white(value)));
    }
  }

  out.push('');
  out.push(chalk.cyan.bold(`Sections (${report.sections.length})`));
  out.push(chalk.gray('-'.repeat(60)));
  if (report.sections.length === 0) {
    out.push(row('sections', chalk.gray('(none found)')));
  } else {
    out.push(
      row(
        'idx',
        `${chalk.gray('kind')}${' '.repeat(10)}${chalk.gray('lines')}${' '.repeat(10)}${chalk.gray('bytes')}${' '.repeat(8)}${chalk.gray('tokens')}`,
      ),
    );
    report.sections.forEach((s, i) => {
      const range = `${s.startLine}-${s.endLine}`;
      out.push(
        `  ${chalk.gray(String(i).padEnd(20))}${chalk.white(s.kind.padEnd(12))}${chalk.gray(range.padEnd(12))}${chalk.gray(String(s.bytes).padEnd(10))}${chalk.gray(String(s.tokens))}`,
      );
    });
  }

  out.push('');
  out.push(chalk.cyan.bold('Contract'));
  out.push(chalk.gray('-'.repeat(60)));
  out.push(listRow('dependencies', contract.dependencies));
  out.push(listRow('imports', contract.imports));
  out.push(listRow('exports', contract.exports));
  out.push(listRow('plugins', contract.plugins));
  out.push(listRow('permissions', contract.permissions));
  out.push(listRow('capabilities', contract.capabilities));
  out.push(listRow('inputs', contract.inputs));
  out.push(listRow('outputs', contract.outputs));

  out.push('');
  out.push(chalk.cyan.bold('AST'));
  out.push(chalk.gray('-'.repeat(60)));
  out.push(row('nodes', chalk.white(String(ast.totalNodes))));
  out.push(row('max depth', chalk.white(String(ast.maxDepth))));
  if (verbose) {
    for (const [kind, count] of Object.entries(ast.nodesByKind)) {
      out.push(row(`  ${kind}`, chalk.white(String(count))));
    }
  }

  out.push('');
  out.push(chalk.cyan.bold('Diagnostics'));
  out.push(chalk.gray('-'.repeat(60)));
  out.push(row('parse errors', diagnostics.errors.length === 0 ? chalk.green('0') : chalk.red(String(diagnostics.errors.length))));
  for (const e of diagnostics.errors) out.push(`    ${chalk.red('x')} ${e}`);
  out.push(row('parse warnings', diagnostics.warnings.length === 0 ? chalk.green('0') : chalk.yellow(String(diagnostics.warnings.length))));
  for (const w of diagnostics.warnings) out.push(`    ${chalk.yellow('!')} ${w}`);
  out.push(row('validation errors', diagnostics.validationErrors.length === 0 ? chalk.green('0') : chalk.red(String(diagnostics.validationErrors.length))));
  for (const e of diagnostics.validationErrors) out.push(`    ${chalk.red('x')} ${e}`);
  out.push(row('validation warnings', diagnostics.validationWarnings.length === 0 ? chalk.green('0') : chalk.yellow(String(diagnostics.validationWarnings.length))));
  for (const w of diagnostics.validationWarnings) out.push(`    ${chalk.yellow('!')} ${w}`);

  out.push('');
  out.push(row('estimated tokens', chalk.white.bold(String(report.estimatedTokens))));
  out.push('');
  return out.join('\n');
}

// ============================================================================
// Command entry point
// ============================================================================

/**
 * `mam inspect` entry point: inspect a module and print the report.
 *
 * @param options - inspection options.
 * @returns void; resolves once the report has been printed.
 */
export async function inspectCommand(options: InspectOptions): Promise<void> {
  const report = await runInspect(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(renderInspectReport(report, options.verbose === true));
}