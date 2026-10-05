/**
 * MAM Optimize Command
 *
 * Wired directly against `@mam/token-optimization`: reads a prompt/module
 * file, splits it into sections, runs `PromptOptimizer.optimize()` and
 * reports the savings.
 *
 * Beyond the basic report the command can:
 *
 *   - print a **per-section** breakdown of where the tokens went and which
 *     strategy claimed them
 *   - run the analyzer first (`analyze()`) so over-budget sections and
 *     concrete suggestions are surfaced before optimizing
 *   - emit **JSON** (`--json`) for CI budgets
 *   - **fail** when savings fall below a threshold (`--min-savings <pct>`),
 *     which is how a repo pins its token budget
 *   - write the optimized text back with `--write`
 *
 * @module optimize
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { PromptOptimizer, section, type PromptSection } from '@mam/token-optimization';
import chalk from 'chalk';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by {@link optimizeCommand}. */
export interface OptimizeOptions {
  /** File to optimize. */
  file: string;
  /** Emit the report as JSON. */
  json?: boolean;
  /** Include the analyzer pass (over-budget sections + suggestions). */
  analyze?: boolean;
  /** Fail (non-zero exit) when savings are below this percentage. */
  minSavings?: number;
  /** Write the optimized text back to disk. */
  write?: boolean;
}

/** Per-section token accounting. */
export interface SectionAccounting {
  /** Section index within the file. */
  index: number;
  /** Resolved role used for prioritization. */
  role: string;
  /** Heading the section came from (or `(preamble)`). */
  title: string;
  /** Estimated tokens before optimization. */
  tokensBefore: number;
  /** Estimated tokens after optimization. */
  tokensAfter: number;
  /** Tokens saved in this section. */
  saved: number;
}

/** The full optimization report. */
export interface OptimizeReport {
  /** Absolute path that was optimized. */
  path: string;
  /** Number of sections detected. */
  sectionCount: number;
  /** Tokens before optimization. */
  originalTokens: number;
  /** Tokens after optimization. */
  optimizedTokens: number;
  /** Tokens saved overall. */
  savedTokens: number;
  /** Percentage saved overall. */
  savedPercent: number;
  /** Strategies that actually changed something. */
  applied: string[];
  /** Per-section accounting. */
  sections: SectionAccounting[];
  /** Suggestions produced by the analyzer (when requested). */
  suggestions: string[];
  /** Whether the file was rewritten. */
  written: boolean;
}

// ============================================================================
// Section parsing
// ============================================================================

/**
 * Slugify a heading into a stable section id.
 *
 * @param value - raw heading.
 * @returns the slug.
 */
export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Map a heading to a prompt role so the optimizer can prioritize correctly.
 *
 * @param title - section heading.
 * @returns the role name.
 */
export function roleFor(title: string): string {
  const lower = title.toLowerCase();
  if (/system|purpose|overview|intent|instruction/.test(lower)) return 'system';
  if (/memory|context|history/.test(lower)) return 'memory';
  if (/knowledge|source|reference|docs|example/.test(lower)) return 'knowledge';
  if (/tool|function|api|command/.test(lower)) return 'tool';
  return 'user';
}

/**
 * Split raw module/prompt content into prompt sections.
 *
 * Headings (`## Title`) start a new section; anything before the first
 * heading becomes a preamble section.
 *
 * @param content - raw file content.
 * @returns the detected sections.
 */
export function buildSections(content: string): PromptSection[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const parts = trimmed.split(/^##\s+/m);
  const sections: PromptSection[] = [];

  for (const raw of parts) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const firstNewline = chunk.indexOf('\n');
    const title = (firstNewline === -1 ? chunk : chunk.slice(0, firstNewline)).trim();
    const body = (firstNewline === -1 ? '' : chunk.slice(firstNewline + 1)).trim();
    if (!title && !body) continue;
    sections.push(
      section(roleFor(title), body || title, {
        id: slugify(title || 'section'),
      }),
    );
  }

  return sections;
}

/**
 * Heuristic token estimate (~4 characters per token).
 *
 * @param text - text to measure.
 * @returns the estimate.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Derive the heading for each section by re-walking the source.
 *
 * @param content - raw file content.
 * @returns a heading per section, in order.
 */
export function sectionTitles(content: string): string[] {
  const trimmed = content.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/^##\s+/m);
  const titles: string[] = [];
  for (const raw of parts) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const newline = chunk.indexOf('\n');
    titles.push((newline === -1 ? chunk : chunk.slice(0, newline)).trim() || '(preamble)');
  }
  return titles;
}

// ============================================================================
// Analysis + optimization
// ============================================================================

/**
 * Run the optimizer (and optionally the analyzer) over a file's sections.
 *
 * Pure with respect to the filesystem apart from the optional `--write`.
 *
 * @param content - raw file content.
 * @param filePath - path used for reporting.
 * @param options - optimize options.
 * @returns the {@link OptimizeReport}.
 */
export function optimizeContent(
  content: string,
  filePath: string,
  options: OptimizeOptions = { file: '' },
): OptimizeReport {
  const sections = buildSections(content);
  const titles = sectionTitles(content);
  const optimizer = new PromptOptimizer();

  const report: OptimizeReport = {
    path: filePath,
    sectionCount: sections.length,
    originalTokens: 0,
    optimizedTokens: 0,
    savedTokens: 0,
    savedPercent: 0,
    applied: [],
    sections: [],
    suggestions: [],
    written: false,
  };

  if (sections.length === 0) return report;

  if (options.analyze) {
    try {
      const analysis = optimizer.analyze(sections);
      report.suggestions = [...(analysis.suggestions ?? [])];
    } catch {
      report.suggestions = [];
    }
  }

  const before = sections.map((s) => estimateTokens(String((s as { content?: string }).content ?? '')));
  const result = optimizer.optimize(sections);
  const optimizedSections = result.sections ?? sections;
  const after = optimizedSections.map((s) => estimateTokens(String((s as { content?: string }).content ?? '')));

  report.originalTokens = result.originalTokens ?? before.reduce((a, b) => a + b, 0);
  report.optimizedTokens = result.optimizedTokens ?? after.reduce((a, b) => a + b, 0);
  report.savedTokens = result.savedTokens ?? Math.max(0, report.originalTokens - report.optimizedTokens);
  report.savedPercent = result.savedPercent ?? 0;
  report.applied = result.applied ?? [];

  report.sections = sections.map((s, i) => ({
    index: i,
    role: String((s as { role?: string }).role ?? 'user'),
    title: titles[i] ?? `(section ${i + 1})`,
    tokensBefore: before[i] ?? 0,
    tokensAfter: after[i] ?? 0,
    saved: Math.max(0, (before[i] ?? 0) - (after[i] ?? 0)),
  }));

  return report;
}

/**
 * Concatenate optimized sections back into text.
 *
 * @param sections - the optimized sections.
 * @returns the joined text.
 */
export function joinSections(sections: Array<{ content?: string }>): string {
  return sections.map((s) => String(s.content ?? '')).join('\n\n');
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render the human-readable optimization report.
 *
 * @param report - the report to render.
 * @returns the rendered lines.
 */
export function renderReport(report: OptimizeReport): string[] {
  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.cyan(`  Optimization Report — ${basename(report.path)}`));
  lines.push('');
  lines.push(`  ${chalk.gray('sections:')}       ${chalk.white(String(report.sectionCount))}`);
  lines.push(`  ${chalk.gray('originalTokens:')} ${chalk.white(String(report.originalTokens))}`);
  lines.push(`  ${chalk.gray('optimizedTokens:')} ${chalk.white(String(report.optimizedTokens))}`);
  lines.push(`  ${chalk.gray('savedTokens:')}    ${chalk.white(String(report.savedTokens))}`);
  const pct = report.savedPercent.toFixed(1);
  const pctColour = report.savedPercent > 0 ? chalk.green : chalk.gray;
  lines.push(`  ${chalk.gray('savedPercent:')}   ${pctColour(`${pct}%`)}`);
  lines.push(`  ${chalk.gray('applied:')}        ${chalk.white(report.applied.join(', ') || 'none')}`);

  if (report.sections.length > 0) {
    lines.push('');
    lines.push(chalk.cyan.bold('  Per-section'));
    lines.push(chalk.gray('  ' + '-'.repeat(56)));
    for (const section of report.sections) {
      const marker = section.saved > 0 ? chalk.green('-') : chalk.gray('=');
      lines.push(
        `  ${marker} ${chalk.white(section.title.slice(0, 28).padEnd(28))} ${chalk.gray(`${section.tokensBefore} -> ${section.tokensAfter}`)} ${chalk.gray(`(${section.role})`)}`,
      );
    }
  }

  if (report.suggestions.length > 0) {
    lines.push('');
    lines.push(chalk.cyan.bold('  Suggestions'));
    lines.push(chalk.gray('  ' + '-'.repeat(56)));
    for (const suggestion of report.suggestions) {
      lines.push(`  ${chalk.yellow('*')} ${suggestion}`);
    }
  }

  lines.push('');
  return lines;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * `mam optimize` entry point.
 *
 * @param options - optimize options.
 * @returns the {@link OptimizeReport}.
 */
export async function optimizeCommand(options: OptimizeOptions): Promise<OptimizeReport> {
  const filePath = resolve(options.file);
  const content = await readFile(filePath, 'utf-8');

  const report = optimizeContent(content, filePath, options);

  if (report.sectionCount === 0) {
    if (!options.json) {
      console.log(chalk.yellow(`No sections found in ${basename(filePath)}`));
    } else {
      console.log(JSON.stringify(report, null, 2));
    }
    return report;
  }

  if (options.write) {
    const sections = buildSections(content);
    const optimizer = new PromptOptimizer();
    const result = optimizer.optimize(sections);
    const joined = joinSections((result.sections ?? []) as Array<{ content?: string }>);
    await writeFile(filePath, joined, 'utf-8');
    report.written = true;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderReport(report).join('\n'));
  }

  if (typeof options.minSavings === 'number' && report.savedPercent < options.minSavings) {
    console.error(
      chalk.red(`  Savings ${report.savedPercent.toFixed(1)}% below required ${options.minSavings}%`),
    );
    process.exitCode = 1;
  }

  return report;
}