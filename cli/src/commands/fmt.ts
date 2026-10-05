/**
 * MAM Fmt Command
 *
 * The `mam fmt` alias of `mam format`.
 *
 * Historically `fmt` carried a few extra knobs that `format` did not
 * (`--indent`, `--max-line-length`, and the `MAMFormatter` engine from
 * `src/utils/formatter.js`). Those are preserved here: this command runs the
 * shared pipeline in {@link ./format.js} and then, when the advanced options
 * are supplied, hands the result to `MAMFormatter` for the structural pass.
 *
 * Keeping both modules means:
 *
 *   - `mam format <file>` stays the simple, fast path
 *   - `mam fmt <file> --indent 2 --max-line-length 120` keeps working exactly
 *     as it did before the two commands were unified
 *
 * @module fmt
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { MAMFormatter, type FormatConfig } from '../utils/formatter.js';
import {
  formatContent,
  findModules,
  isModule,
  runFormat,
  type FormatOptions as SharedFormatOptions,
  type FormatRunResult,
} from './format.js';

// ============================================================================
// Types
// ============================================================================

/** Options accepted by {@link formatCommand} (the `fmt` entry point). */
export interface FormatOptions {
  /** Module file to format. */
  file: string;
  /** Write changes back to disk. */
  inPlace?: boolean;
  /** Report changes without writing; sets a non-zero exit code. */
  check?: boolean;
  /** Indentation width forwarded to `MAMFormatter`. */
  indent?: number;
  /** Maximum line length forwarded to `MAMFormatter`. */
  maxLineLength?: number;
  /** Use single quotes in YAML frontmatter. */
  singleQuote?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Build a `MAMFormatter` config from the advanced CLI options.
 *
 * @param options - fmt options.
 * @returns the formatter config (empty when no advanced options were given).
 */
export function buildFormatterConfig(options: FormatOptions): Partial<FormatConfig> {
  const config: Partial<FormatConfig> = {};
  if (typeof options.indent === 'number') config.indent = options.indent;
  if (typeof options.maxLineLength === 'number') config.maxLineLength = options.maxLineLength;
  if (options.singleQuote === true) config.useSpaces = false;
  return config;
}

/**
 * Whether the advanced structural pass is required.
 *
 * @param options - fmt options.
 * @returns `true` when at least one advanced option was supplied.
 */
export function needsStructuralPass(options: FormatOptions): boolean {
  return (
    typeof options.indent === 'number' ||
    typeof options.maxLineLength === 'number' ||
    options.singleQuote === true
  );
}

/**
 * Run the structural pass over already whitespace-normalised content.
 *
 * @param content - normalised source.
 * @param options - fmt options.
 * @returns the structurally formatted source.
 */
export function applyStructuralPass(content: string, options: FormatOptions): string {
  if (!needsStructuralPass(options)) return content;
  try {
    const formatter = new MAMFormatter(buildFormatterConfig(options));
    return formatter.format(content).formatted;
  } catch {
    return content;
  }
}

/**
 * Count the number of change sites between two strings.
 *
 * A change site is a line index that differs, plus one when the line counts
 * differ — cheap but good enough for a human-facing summary.
 *
 * @param before - original source.
 * @param after - formatted source.
 * @returns the change count.
 */
export function countChangeSites(before: string, after: string): number {
  const a = before.split('\n');
  const b = after.split('\n');
  let changes = 0;
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i++) {
    if (a[i] !== b[i]) changes += 1;
  }
  return changes + Math.abs(a.length - b.length);
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * `mam fmt` entry point.
 *
 * Runs the shared whitespace pipeline first, then the optional structural
 * pass, and honours `--check` (no writes, non-zero exit) and `--in-place`.
 *
 * @param options - fmt options.
 * @returns the aggregate {@link FormatRunResult}.
 */
export async function formatCommand(options: FormatOptions): Promise<FormatRunResult> {
  const spinner = ora('Formatting module...').start();
  const filePath = resolve(options.file);

  try {
    const original = await readFile(filePath, 'utf-8');

    // Pass 1: the shared whitespace pipeline from ./format.js.
    const normalized = applyStructuralPass(formatContent(original), options);
    const changed = normalized !== original;
    const changeCount = changed ? countChangeSites(original, normalized) : 0;

    spinner.stop();

    if (options.check) {
      if (changed) {
        console.log(chalk.yellow('File needs formatting'));
        console.log(chalk.gray(`  Changes: ${changeCount}`));
        process.exitCode = 1;
      } else {
        console.log(chalk.green('File is already formatted'));
        process.exitCode = 0;
      }
      return { files: [], changedCount: changed ? 1 : 0, totalCount: 1 };
    }

    if (options.inPlace) {
      if (changed) {
        await writeFile(filePath, normalized, 'utf-8');
        console.log(chalk.green(`Formatted: ${filePath}`));
        console.log(chalk.gray(`  Changes: ${changeCount}`));
      } else {
        console.log(chalk.gray('No changes needed'));
      }
      return { files: [], changedCount: changed ? 1 : 0, totalCount: 1 };
    }

    console.log(normalized);
    return { files: [], changedCount: changed ? 1 : 0, totalCount: 1 };
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exitCode = 1;
    return { files: [], changedCount: 0, totalCount: 0 };
  }
}

/**
 * Format every module under a directory using the shared pipeline.
 *
 * Exposed so `mam fmt --dir <d>` can reuse the batch behaviour without
 * duplicating the discovery logic.
 *
 * @param options - directory format options.
 * @returns the aggregate {@link FormatRunResult}.
 */
export async function formatDirectory(options: FormatOptions & { dir: string }): Promise<FormatRunResult> {
  const result = await runFormat({
    dir: options.dir,
    inPlace: options.inPlace,
    check: options.check,
  } satisfies SharedFormatOptions);
  return result;
}

/**
 * Produce a unified-diff-style preview of what formatting would change.
 *
 * Renders each differing line as `- old` / `+ new` with a small context
 * window, which is what `--diff` prints. It is intentionally simple (line
 * based) rather than a real LCS diff — the goal is to let a human eyeball the
 * change, not to produce a patch suitable for `git apply`.
 *
 * @param before - original source.
 * @param after - formatted source.
 * @param context - number of unchanged lines kept around each change.
 * @returns the rendered diff lines (without a trailing newline).
 */
export function diffPreview(before: string, after: string, context = 2): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (a[i] !== undefined) lines.push(chalk.red(`- ${a[i]}`));
      if (b[i] !== undefined) lines.push(chalk.green(`+ ${b[i]}`));
      // Push a couple of unchanged lines of trailing context.
      for (let c = 1; c <= context && i + c < max; c++) {
        lines.push(chalk.gray(`  ${b[i + c] ?? ''}`));
      }
    }
  }
  return lines;
}

/**
 * Read content from stdin when no file is supplied (`mam fmt -`).
 *
 * @returns the stdin contents, or `undefined` when stdin is a TTY.
 */
export async function readStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Print a diff preview for a single file without writing it.
 *
 * @param filePath - absolute file path.
 * @returns `true` when the file would change.
 */
export async function previewFile(filePath: string): Promise<boolean> {
  const original = await readFile(filePath, 'utf-8');
  const formatted = formatContent(original);
  if (formatted === original) return false;
  console.log(chalk.cyan(`--- ${filePath}`));
  console.log(chalk.cyan(`+++ ${filePath} (formatted)`));
  console.log(diffPreview(original, formatted).join('\n'));
  return true;
}

// ============================================================================
// Diff model
// ============================================================================

/** Kind of a single diff line. */
export type DiffLineKind = 'context' | 'add' | 'remove';

/** One rendered line of a unified diff. */
export interface DiffLine {
  /** 1-based line number in the original source. */
  oldLine?: number;
  /** 1-based line number in the formatted source. */
  newLine?: number;
  /** What happened to this line. */
  kind: DiffLineKind;
  /** The raw line text, without any diff marker. */
  text: string;
}

/** A contiguous run of diff lines sharing a hunk header. */
export interface DiffHunk {
  /** 1-based first old line covered by the hunk. */
  oldStart: number;
  /** 1-based first new line covered by the hunk. */
  newStart: number;
  /** Number of old lines covered. */
  oldCount: number;
  /** Number of new lines covered. */
  newCount: number;
  /** Header text, e.g. `@@ -1,4 +1,4 @@`. */
  header: string;
  /** Lines belonging to the hunk. */
  lines: DiffLine[];
}

/** A fully rendered unified diff for one file. */
export interface UnifiedDiff {
  /** Path rendered on the `---` line. */
  from: string;
  /** Path rendered on the `+++` line. */
  to: string;
  /** Hunks making up the diff (empty when the sources are equal). */
  hunks: DiffHunk[];
  /** Total number of added lines across all hunks. */
  added: number;
  /** Total number of removed lines across all hunks. */
  removed: number;
}

/** Options accepted by {@link buildUnifiedDiff} and {@link renderUnifiedDiff}. */
export interface UnifiedDiffOptions {
  /** Label used on the `---` line. */
  from?: string;
  /** Label used on the `+++` line. */
  to?: string;
  /** Unchanged lines kept around each change. Defaults to `3`. */
  context?: number;
  /** Maximum number of rendered lines; `0` means unlimited. */
  maxLines?: number;
}

/**
 * Split a source string into lines without a trailing empty element.
 *
 * The formatter guarantees a single trailing newline, so a plain `split('\n')`
 * would produce a phantom final line and shift every hunk header.
 *
 * @param content - source text.
 * @returns the lines of the source.
 */
export function toLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ============================================================================
// Longest-common-subsequence diff
// ============================================================================

/**
 * Compute a line-level edit script via a dynamic-programming LCS.
 *
 * Whitespace normalisation moves almost every line of a badly formatted
 * module, so a naive positional comparison is not good enough for the
 * `--diff` output; this produces minimal insertions and deletions instead.
 *
 * The matrix is only materialised when both inputs are small enough
 * (`MAX_DIFF_CELLS`); beyond that the function degrades to a positional
 * comparison, which is still correct but reports more changed lines.
 *
 * @param a - original lines.
 * @param b - formatted lines.
 * @returns the edit script in source order.
 */
function editScript(a: string[], b: string[]): DiffLine[] {
  const script: DiffLine[] = [];

  // Fallback: positional comparison, still a valid (if noisier) edit script.
  if (a.length * b.length > MAX_DIFF_CELLS) {
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== undefined && b[i] !== undefined && a[i] === b[i]) {
        script.push({ oldLine: i + 1, newLine: i + 1, kind: 'context', text: a[i] });
      } else {
        if (a[i] !== undefined) script.push({ oldLine: i + 1, kind: 'remove', text: a[i] });
        if (b[i] !== undefined) script.push({ newLine: i + 1, kind: 'add', text: b[i] });
      }
    }
    return script;
  }

  // lengths[i][j] = LCS length of a[i..] and b[j..].
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lengths[i][j] =
        a[i] === b[j] ? lengths[i + 1][j + 1] + 1 : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      script.push({ oldLine: i + 1, newLine: j + 1, kind: 'context', text: a[i] });
      i++;
      j++;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      script.push({ oldLine: i + 1, kind: 'remove', text: a[i] });
      i++;
    } else {
      script.push({ newLine: j + 1, kind: 'add', text: b[j] });
      j++;
    }
  }
  while (i < a.length) script.push({ oldLine: i + 1, kind: 'remove', text: a[i++] });
  while (j < b.length) script.push({ newLine: j + 1, kind: 'add', text: b[j++] });
  return script;
}

/** Upper bound on the LCS matrix area before the diff degrades. */
const MAX_DIFF_CELLS = 4_000_000;

/**
 * Split an edit script into hunks, coalescing nearby changes.
 *
 * @param script - edit script from {@link editScript}.
 * @param context - unchanged lines kept around each change.
 * @returns the hunks, in source order.
 */
export function groupIntoHunks(script: DiffLine[], context: number): DiffHunk[] {
  const changed = script.map((line) => line.kind !== 'context');
  const keep: boolean[] = new Array(script.length).fill(false);
  for (let i = 0; i < script.length; i++) {
    if (!changed[i]) continue;
    const from = Math.max(0, i - context);
    const to = Math.min(script.length - 1, i + context);
    for (let k = from; k <= to; k++) keep[k] = true;
  }

  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < script.length) {
    if (!keep[index]) {
      index++;
      continue;
    }
    let end = index;
    while (end + 1 < script.length && keep[end + 1]) end++;

    const slice = script.slice(index, end + 1);
    const oldStart = slice.find((l) => l.oldLine !== undefined)?.oldLine ?? 0;
    const newStart = slice.find((l) => l.newLine !== undefined)?.newLine ?? 0;
    const oldCount = slice.filter((l) => l.kind !== 'add').length;
    const newCount = slice.filter((l) => l.kind !== 'remove').length;

    hunks.push({
      oldStart,
      newStart,
      oldCount,
      newCount,
      header: `@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`,
      lines: slice,
    });
    index = end + 1;
  }
  return hunks;
}

/**
 * Format a `start,count` range the way unified diffs do (count omitted at 1).
 *
 * @param start - 1-based start line.
 * @param count - number of lines covered.
 * @returns the range text.
 */
function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/**
 * Build a unified diff between two sources.
 *
 * Pure and side-effect free: no colours, no I/O. Use
 * {@link renderUnifiedDiff} for the human-facing output.
 *
 * @param before - original source.
 * @param after - formatted source.
 * @param options - labels, context width and an output budget.
 * @returns the structured diff.
 */
export function buildUnifiedDiff(before: string, after: string, options: UnifiedDiffOptions = {}): UnifiedDiff {
  const from = options.from ?? 'a';
  const to = options.to ?? 'b';
  const context = options.context ?? 3;

  if (before === after) return { from, to, hunks: [], added: 0, removed: 0 };

  const script = editScript(toLines(before), toLines(after));
  let hunks = groupIntoHunks(script, context);

  // Trim hunks from the end until the rendered diff fits the line budget.
  const maxLines = options.maxLines ?? 0;
  if (maxLines > 0) {
    while (hunks.length > 1 && hunks.reduce((n, h) => n + h.lines.length, 0) > maxLines) {
      hunks = hunks.slice(0, hunks.length - 1);
    }
  }

  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'add') added++;
      else if (line.kind === 'remove') removed++;
    }
  }
  return { from, to, hunks, added, removed };
}

/**
 * Render a unified diff as coloured, `git diff`-shaped text.
 *
 * @param diff - the structured diff.
 * @returns the rendered diff, without a trailing newline.
 */
export function renderUnifiedDiff(diff: UnifiedDiff): string {
  if (diff.hunks.length === 0) return '';
  const lines: string[] = [chalk.cyan(`--- ${diff.from}`), chalk.cyan(`+++ ${diff.to}`)];
  for (const hunk of diff.hunks) {
    lines.push(chalk.magenta(hunk.header));
    for (const line of hunk.lines) {
      if (line.kind === 'add') {
        lines.push(chalk.green(`+${line.text}`));
      } else if (line.kind === 'remove') {
        lines.push(chalk.red(`-${line.text}`));
      } else {
        lines.push(chalk.gray(` ${line.text}`));
      }
    }
  }
  return lines.join('\n');
}

// ============================================================================
// Multi-file runs
// ============================================================================

/** Result of formatting a single target during a multi-file run. */
export interface FmtFileResult {
  /** Absolute path of the file. */
  path: string;
  /** Path relative to the run root. */
  relative: string;
  /** Original source. */
  before: string;
  /** Formatted source. */
  after: string;
  /** Whether formatting changed anything. */
  changed: boolean;
  /** Number of change sites, via {@link countChangeSites}. */
  changeCount: number;
  /** Whether the file was written back to disk. */
  written: boolean;
  /** Error message when the file could not be processed. */
  error?: string;
}

/** Aggregate result of a multi-file `fmt` run. */
export interface FmtRunResult {
  /** Per-file results in processing order. */
  files: FmtFileResult[];
  /** Number of files that needed changes. */
  changedCount: number;
  /** Number of files processed. */
  totalCount: number;
  /** Number of files that could not be read or written. */
  errorCount: number;
}

/** Options accepted by {@link runFmt}. */
export interface FmtRunOptions {
  /** File or directory to format. */
  target: string;
  /** Apply the `MAMFormatter` structural pass. */
  structural?: boolean;
  /** Structural-pass options. */
  format?: FormatOptions;
  /** Persist changes. */
  inPlace?: boolean;
  /** Report only; never write. */
  dryRun?: boolean;
  /** Stop after the first file that needs changes. */
  bail?: boolean;
}

/**
 * Resolve the files a `fmt` run should touch.
 *
 * A directory expands to every module beneath it (via `findModules`), a file
 * is taken as-is, and `-` means stdin.
 *
 * @param target - file, directory or `-`.
 * @returns absolute paths, sorted for deterministic output.
 */
export async function collectFmtTargets(target: string): Promise<string[]> {
  if (target === '-') return [];
  const { stat } = await import('node:fs/promises');
  const resolved = resolve(target);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    return [];
  }
  if (info.isDirectory()) return (await findModules(resolved)).sort();
  return [resolved];
}

/**
 * Format one file, optionally persisting the result.
 *
 * Never throws: a failure is reported on the result so that a single bad file
 * cannot abort a whole-directory run.
 *
 * @param path - absolute path.
 * @param root - root used for the relative display path.
 * @param options - run options.
 * @returns the {@link FmtFileResult}.
 */
export async function formatOneFmt(path: string, root: string, options: FmtRunOptions): Promise<FmtFileResult> {
  const rel = relative(root, path) || path;
  let before: string;
  try {
    before = await readFile(path, 'utf-8');
  } catch (error) {
    return {
      path,
      relative: rel,
      before: '',
      after: '',
      changed: false,
      changeCount: 0,
      written: false,
      error: (error as Error).message,
    };
  }

  const fmtOptions = options.format ?? { file: path };
  const after = options.structural ? applyStructuralPass(formatContent(before), fmtOptions) : formatContent(before);
  const changed = after !== before;

  let written = false;
  const shouldWrite = changed && options.inPlace === true && options.dryRun !== true;
  if (shouldWrite) {
    try {
      await writeFile(path, after, 'utf-8');
      written = true;
    } catch (error) {
      return {
        path,
        relative: rel,
        before,
        after,
        changed,
        changeCount: countChangeSites(before, after),
        written: false,
        error: (error as Error).message,
      };
    }
  }

  return { path, relative: rel, before, after, changed, changeCount: countChangeSites(before, after), written };
}

/**
 * Format every target, honouring `--dry-run`, `--in-place` and `--bail`.
 *
 * @param options - run options.
 * @returns the aggregate {@link FmtRunResult}.
 */
export async function runFmt(options: FmtRunOptions): Promise<FmtRunResult> {
  const root = resolve(options.target === '-' ? process.cwd() : options.target);
  const isDir = (await import('node:fs/promises')).stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  const base = (await isDir) ? root : process.cwd();
  const targets = await collectFmtTargets(options.target);

  const files: FmtFileResult[] = [];
  for (const target of targets) {
    const result = await formatOneFmt(target, base, options);
    files.push(result);
    if (options.bail && result.changed) break;
  }

  return {
    files,
    changedCount: files.filter((f) => f.changed).length,
    totalCount: targets.length,
    errorCount: files.filter((f) => f.error !== undefined).length,
  };
}

// ============================================================================
// Reporting
// ============================================================================

/** CI-oriented summary of a `--check` run. */
export interface CheckSummary {
  /** Files inspected. */
  checked: number;
  /** Files that need formatting. */
  needsFormatting: number;
  /** Files already formatted. */
  clean: number;
  /** Files that could not be processed. */
  errors: number;
  /** Total change sites across all files. */
  changeCount: number;
  /** Relative paths of the offending files. */
  offenders: string[];
  /** Process exit code: `0` clean, `1` needs formatting, `2` errors. */
  exitCode: number;
}

/**
 * Build the machine-readable summary CI consumers assert on.
 *
 * Exit codes follow the usual formatter convention:
 * `0` everything is formatted, `1` at least one file needs changes,
 * `2` at least one file could not be read.
 *
 * @param result - a multi-file run result.
 * @returns the {@link CheckSummary}.
 */
export function summarizeCheck(result: FmtRunResult): CheckSummary {
  const offenders = result.files.filter((f) => f.changed).map((f) => f.relative);
  const errors = result.files.filter((f) => f.error !== undefined).length;
  const changeCount = result.files.reduce((n, f) => n + (f.changed ? f.changeCount : 0), 0);
  const needsFormatting = offenders.length;

  let exitCode = 0;
  if (needsFormatting > 0) exitCode = 1;
  if (errors > 0) exitCode = 2;

  return {
    checked: result.totalCount,
    needsFormatting,
    clean: Math.max(0, result.totalCount - needsFormatting - errors),
    errors,
    changeCount,
    offenders,
    exitCode,
  };
}

/**
 * Render a `--check` summary for humans.
 *
 * @param summary - the summary from {@link summarizeCheck}.
 * @returns the rendered lines.
 */
export function renderCheckSummary(summary: CheckSummary): string[] {
  const lines: string[] = ['', chalk.cyan.bold('Formatting check'), ''];
  lines.push(`  ${chalk.white(String(summary.checked).padStart(5))} file(s) inspected`);
  lines.push(`  ${summary.clean > 0 ? chalk.green(String(summary.clean).padStart(5)) : chalk.gray('    0')} already formatted`);
  if (summary.needsFormatting > 0) {
    lines.push(`  ${chalk.yellow(String(summary.needsFormatting).padStart(5))} need formatting (${summary.changeCount} change site(s))`);
    const shown = summary.offenders.slice(0, 10);
    for (const offender of shown) lines.push(`        ${chalk.white(offender)}`);
    if (summary.offenders.length > shown.length) {
      lines.push(`        ${chalk.gray(`... and ${summary.offenders.length - shown.length} more`)}`);
    }
  }
  if (summary.errors > 0) lines.push(`  ${chalk.red(String(summary.errors).padStart(5))} could not be processed`);
  lines.push('');
  if (summary.exitCode === 0) lines.push(chalk.green('  All files are formatted.'));
  else lines.push(chalk.yellow('  Run `mam fmt <path> --in-place` to fix.'));
  lines.push('');
  return lines;
}

/**
 * Render a dry-run report: what would change, with inline diffs.
 *
 * @param result - a multi-file run result.
 * @param context - unchanged lines kept around each change.
 * @returns the rendered report.
 */
export function renderDryRun(result: FmtRunResult, context = 3): string[] {
  const lines: string[] = ['', chalk.cyan.bold(`Dry run — ${basename(result.files[0]?.path ?? '')}`), ''];
  if (result.files.length === 0) {
    lines.push(chalk.gray('  No files matched.'), '');
    return lines;
  }

  for (const file of result.files) {
    if (file.error) {
      lines.push(`  ${chalk.red('error')}  ${file.relative} ${chalk.gray(file.error)}`);
      continue;
    }
    if (!file.changed) {
      lines.push(`  ${chalk.green('ok')}      ${chalk.gray(file.relative)}`);
      continue;
    }
    lines.push(`  ${chalk.yellow('would')}  ${chalk.white(file.relative)} ${chalk.gray(`(${file.changeCount} change site(s), not written)`)}`);
    const diff = buildUnifiedDiff(file.before, file.after, { from: `${file.relative} (current)`, to: `${file.relative} (formatted)`, context });
    const rendered = renderUnifiedDiff(diff);
    if (rendered.length > 0) {
      for (const line of rendered.split('\n')) lines.push(`    ${line}`);
    }
  }

  const summary = summarizeCheck(result);
  lines.push('');
  lines.push(
    summary.needsFormatting === 0
      ? chalk.green(`  ${summary.checked} file(s) already formatted.`)
      : chalk.yellow(`  ${summary.needsFormatting} of ${summary.checked} file(s) would be rewritten.`),
  );
  lines.push('');
  return lines;
}

/**
 * Render the standard per-file run listing.
 *
 * @param result - a multi-file run result.
 * @param dryRun - whether the run was a dry run.
 * @returns the rendered lines.
 */
export function renderRunSummary(result: FmtRunResult, dryRun: boolean): string[] {
  const lines: string[] = [''];
  for (const file of result.files) {
    if (file.error) {
      lines.push(`  ${chalk.red('error')}  ${file.relative} ${chalk.gray(file.error)}`);
    } else if (file.written) {
      lines.push(`  ${chalk.cyan('fixed')}  ${chalk.white(file.relative)} ${chalk.gray(`(${file.changeCount} change site(s))`)}`);
    } else if (file.changed && dryRun) {
      lines.push(`  ${chalk.yellow('needs')}  ${chalk.white(file.relative)} ${chalk.gray(`(${file.changeCount} change site(s))`)}`);
    } else {
      lines.push(`  ${chalk.green('ok')}     ${chalk.gray(file.relative)}`);
    }
  }
  const summary = summarizeCheck(result);
  lines.push('');
  lines.push(
    summary.needsFormatting === 0
      ? chalk.green(`  ${summary.checked} file(s) formatted.`)
      : chalk.yellow(`  ${summary.needsFormatting} of ${summary.checked} file(s) still need formatting.`),
  );
  lines.push('');
  return lines;
}

// ============================================================================
// Multi-file entry point
// ============================================================================

/**
 * `mam fmt` entry point for multi-target runs.
 *
 * Complements the single-file {@link formatCommand}: it accepts a directory,
 * renders unified diffs, and produces the CI summary used by `--check`.
 *
 * @param options - fmt options; `file` may point at a file *or* a directory.
 * @returns the aggregate {@link FmtRunResult}.
 */
export async function fmtCommand(
  options: FormatOptions & { diff?: boolean; context?: number; json?: boolean },
): Promise<FmtRunResult> {
  const spinner = ora('Formatting modules...').start();
  try {
    const result = await runFmt({
      target: options.file,
      structural: needsStructuralPass(options),
      format: options,
      inPlace: options.inPlace === true && options.check !== true,
      dryRun: options.inPlace !== true && options.check !== true,
    });
    spinner.stop();

    const context = options.context ?? 3;

    if (options.json) {
      console.log(JSON.stringify(summarizeCheck(result), null, 2));
    } else if (options.check) {
      const summary = summarizeCheck(result);
      console.log(renderCheckSummary(summary).join('\n'));
      process.exitCode = summary.exitCode;
    } else if (options.inPlace) {
      console.log(renderRunSummary(result, false).join('\n'));
      process.exitCode = result.errorCount > 0 ? 1 : 0;
    } else if (options.diff) {
      const lines: string[] = [''];
      for (const file of result.files) {
        if (!file.changed) continue;
        const rendered = renderUnifiedDiff(
          buildUnifiedDiff(file.before, file.after, {
            from: `${file.relative} (current)`,
            to: `${file.relative} (formatted)`,
            context,
          }),
        );
        lines.push(rendered, '');
      }
      if (lines.length === 1) lines.push(chalk.green('  Everything is already formatted.'), '');
      console.log(lines.join('\n'));
    } else {
      console.log(renderDryRun(result, context).join('\n'));
    }

    return result;
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exitCode = 1;
    return { files: [], changedCount: 0, totalCount: 0, errorCount: 1 };
  }
}

/**
 * Whether a path looks like something the formatter can handle.
 *
 * @param path - candidate path.
 * @returns `true` for MAM modules.
 */
export function isFormattableModule(path: string): boolean {
  return isModule(path);
}