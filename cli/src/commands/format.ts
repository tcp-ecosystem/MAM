/**
 * MAM Format Command
 *
 * Formats MAM modules with consistent style.
 *
 * Formatting rules applied by this command:
 *
 *   1. strip trailing whitespace from every line
 *   2. collapse runs of blank lines to a single blank line
 *   3. normalise line endings to `\n`
 *   4. guarantee exactly one trailing newline
 *   5. normalise heading spacing (`##  Title` -> `## Title`)
 *
 * It can operate on a single file, on every module under a directory
 * (`--dir`), and can report what would change without writing anything
 * (`--check`, `--dry-run`). `--json` emits a machine-readable diff summary,
 * which is what CI uses to assert formatting without console parsing.
 *
 * @module format
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by {@link formatCommand}. */
export interface FormatOptions {
  /** Module file to format. */
  file?: string;
  /** Format every module under this directory instead of a single file. */
  dir?: string;
  /** Write changes back to disk. */
  inPlace?: boolean;
  /** Exit non-zero when changes are needed (implies no write). */
  check?: boolean;
  /** Report what would change without writing. */
  dryRun?: boolean;
  /** Emit a JSON summary instead of human output. */
  json?: boolean;
}

/** Result of formatting one file. */
export interface FileFormatResult {
  /** Absolute path of the file. */
  path: string;
  /** Path relative to the processed root. */
  relative: string;
  /** Whether formatting changed the content. */
  changed: boolean;
  /** Number of characters removed. */
  removed: number;
  /** Number of characters added. */
  added: number;
  /** Whether the file was written. */
  written: boolean;
}

/** Aggregate result of a format run. */
export interface FormatRunResult {
  /** Per-file results. */
  files: FileFormatResult[];
  /** Number of files that needed changes. */
  changedCount: number;
  /** Number of files processed. */
  totalCount: number;
}

// ============================================================================
// Core formatting
// ============================================================================

/**
 * Apply the MAM formatting rules to a string.
 *
 * Pure and side-effect free: the caller decides whether to persist the result.
 *
 * @param content - raw module source.
 * @returns the formatted source.
 */
export function formatContent(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];
  let lastBlank = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\s+$/, '');
    // Normalise ATX heading spacing.
    line = line.replace(/^(#{1,6})\s{2,}(.*)$/, '$1 $2');

    const isBlank = line.trim().length === 0;
    if (isBlank) {
      if (lastBlank) continue; // collapse consecutive blanks
      lastBlank = true;
    } else {
      lastBlank = false;
    }
    out.push(line);
  }

  // Guarantee exactly one trailing newline.
  while (out.length > 0 && out[out.length - 1].trim().length === 0) {
    out.pop();
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`;
}

/**
 * Compute a numeric diff summary between two strings.
 *
 * @param before - original content.
 * @param after - formatted content.
 * @returns `{ removed, added }` character counts.
 */
export function diffSize(before: string, after: string): { removed: number; added: number } {
  return {
    removed: Math.max(0, before.length - after.length),
    added: Math.max(0, after.length - before.length),
  };
}

// ============================================================================
// File discovery
// ============================================================================

/**
 * Whether a path is a MAM module.
 *
 * @param path - candidate path.
 * @returns `true` for `.mam` / `.mam.md`.
 */
export function isModule(path: string): boolean {
  return path.endsWith('.mam') || path.endsWith('.mam.md');
}

/**
 * Recursively find module files under a directory.
 *
 * @param dir - directory to scan.
 * @param out - accumulator.
 * @returns discovered module paths.
 */
export async function findModules(dir: string, out: string[] = []): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const info = await stat(full).catch(() => undefined);
    if (!info) continue;
    if (info.isDirectory()) await findModules(full, out);
    else if (isModule(full)) out.push(full);
  }
  return out;
}

/**
 * Resolve the set of files to format from the options.
 *
 * @param options - format options.
 * @returns the absolute paths to process.
 */
export async function resolveTargets(options: FormatOptions): Promise<string[]> {
  if (options.dir) {
    return findModules(resolve(options.dir));
  }
  if (options.file) return [resolve(options.file)];
  return [];
}

// ============================================================================
// Processing
// ============================================================================

/**
 * Format a single file.
 *
 * @param path - absolute file path.
 * @param root - root used to compute the relative display path.
 * @param write - whether to persist changes.
 * @returns the {@link FileFormatResult}.
 */
export async function formatOne(path: string, root: string, write: boolean): Promise<FileFormatResult> {
  const content = await readFile(path, 'utf-8');
  const formatted = formatContent(content);
  const changed = formatted !== content;
  const { removed, added } = diffSize(content, formatted);
  let written = false;
  if (changed && write) {
    await writeFile(path, formatted, 'utf-8');
    written = true;
  }
  return { path, relative: relative(root, path) || path, changed, removed, added, written };
}

/**
 * Format every target file.
 *
 * @param options - format options.
 * @returns the aggregate {@link FormatRunResult}.
 */
export async function runFormat(options: FormatOptions): Promise<FormatRunResult> {
  const targets = await resolveTargets(options);
  const root = options.dir ? resolve(options.dir) : process.cwd();
  const write = options.inPlace === true && options.check !== true && options.dryRun !== true;
  const files: FileFormatResult[] = [];
  for (const target of targets) {
    files.push(await formatOne(target, root, write));
  }
  return {
    files,
    changedCount: files.filter((f) => f.changed).length,
    totalCount: files.length,
  };
}

// ============================================================================
// Rendering
// ============================================================================

/**
 * Render the per-file result lines.
 *
 * @param result - the run result.
 * @param dryRun - whether the run was a dry run.
 * @returns the rendered lines.
 */
export function renderFormatResult(result: FormatRunResult, dryRun: boolean): string[] {
  const lines: string[] = [];
  for (const file of result.files) {
    if (!file.changed) {
      lines.push(`  ${chalk.green('ok')}       ${chalk.gray(file.relative)}`);
    } else if (dryRun) {
      lines.push(
        `  ${chalk.yellow('needs')}   ${chalk.white(file.relative)} ${chalk.gray(`(-${file.removed} +${file.added})`)}`,
      );
    } else {
      lines.push(
        `  ${chalk.cyan('fixed')}    ${chalk.white(file.relative)} ${chalk.gray(`(-${file.removed} +${file.added})`)}`,
      );
    }
  }
  return lines;
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * `mam format` entry point.
 *
 * @param options - format options.
 * @returns the aggregate {@link FormatRunResult}.
 */
export async function formatCommand(options: FormatOptions): Promise<FormatRunResult> {
  const spinner = ora('Formatting modules...').start();

  try {
    const result = await runFormat(options);
    spinner.stop();

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('');
      console.log(renderFormatResult(result, options.inPlace !== true).join('\n'));
      console.log('');
      const summary =
        result.changedCount === 0
          ? chalk.green(`  ${result.totalCount} file(s) already formatted`)
          : chalk.yellow(
              `  ${result.changedCount} of ${result.totalCount} file(s) ${options.inPlace ? 'formatted' : 'need formatting'}`,
            );
      console.log(summary);
      console.log('');
    }

    if (options.check && result.changedCount > 0) {
      process.exitCode = 1;
    }
    return result;
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exitCode = 1;
    return { files: [], changedCount: 0, totalCount: 0 };
  }
}

/**
 * Backwards-compatible alias kept because older callers imported `formatCommand`
 * with a required `file` property. Both entry points now share
 * {@link runFormat} so behaviour is identical.
 *
 * @param options - format options with a required file.
 * @returns the aggregate {@link FormatRunResult}.
 */
export async function formatFileCommand(options: FormatOptions & { file: string }): Promise<FormatRunResult> {
  return formatCommand(options);
}

/**
 * The list of formatting rules this module applies, for `mam docs` and `--help`.
 *
 * @returns human-readable rule descriptions.
 */
export function formattingRules(): string[] {
  return [
    'strip trailing whitespace',
    'collapse consecutive blank lines',
    'normalise CRLF/CR to LF',
    'normalise heading spacing',
    'guarantee a single trailing newline',
  ];
}