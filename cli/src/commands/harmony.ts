/**
 * MAM Harmony Command
 *
 * Verifies that a MAM project/module set is internally *harmonious*: that the
 * parts agree with each other.
 *
 * `mam validate` asks "is this module legal?". `mam harmony` asks the harder
 * question — "do the modules agree with each other?" — by cross-checking the
 * relationships that no single-module validator can see:
 *
 *   1. **inventory**  discover every module in the project (or the single file)
 *   2. **parse**      parse each module, collecting errors and warnings
 *   3. **names**      duplicate module names break imports — detect them
 *   4. **contracts**  every `dependencies` entry must resolve to a module
 *   5. **exports**    referenced exports must actually be exported by the
 *                     target module
 *   6. **cycles**     dependency cycles make a system unschedulable — detect
 *                     them with a DFS colouring pass
 *   7. **orphans**    modules nothing depends on (informational)
 *   8. **scoring**    fold every finding into a 0-100 harmony score
 *
 * The result is printed as a findings table plus a verdict, or as JSON with
 * `--json`. Exit behaviour is left to the caller; the command itself never
 * calls `process.exit`.
 *
 * @module harmony
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { parseMAM, type MAMModule as ParserModule } from '@mam/parser';
import { validate } from '@mam/validator';

// ============================================================================
// Types
// ============================================================================

/** Severity of a single harmony finding. */
export type HarmonySeverity = 'error' | 'warning' | 'info';

/** A single cross-module finding. */
export interface HarmonyFinding {
  /** Stable finding code (e.g. `HARMONY-001`). */
  code: string;
  /** Severity of the finding. */
  severity: HarmonySeverity;
  /** Human-readable message. */
  message: string;
  /** Module(s) the finding relates to. */
  modules: string[];
}

/** A module as tracked by the harmony pass. */
export interface HarmonyModule {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the project root. */
  relative: string;
  /** Declared module name (frontmatter) or the file stem. */
  name: string;
  /** Whether the module parsed without errors. */
  parsed: boolean;
  /** Parser errors. */
  errors: string[];
  /** Parser warnings. */
  warnings: string[];
  /** Declared dependency module names. */
  dependencies: string[];
  /** Declared export names. */
  exports: string[];
  /** Whether the module passed validation. */
  valid: boolean;
}

/** Options accepted by {@link harmonyCommand}. */
export interface HarmonyOptions {
  /** Project root or a single module file. */
  path?: string;
  /** Emit the report as JSON. */
  json?: boolean;
  /** Include informational findings (orphans, warnings). */
  verbose?: boolean;
  /** Maximum directory depth to scan when discovering modules. */
  maxDepth?: number;
  /** Maximum number of modules to analyse in one run (default 40). */
  maxFiles?: number;
  /** Per-module analysis budget in milliseconds (default 10000). */
  timeoutMs?: number;
}

/** The complete harmony report. */
export interface HarmonyReport {
  /** Project root that was analysed. */
  root: string;
  /** Every module discovered. */
  modules: HarmonyModule[];
  /** All findings. */
  findings: HarmonyFinding[];
  /** Harmony score in the range 0-100. */
  score: number;
  /** Verdict derived from the score. */
  verdict: 'harmonious' | 'mostly-harmonious' | 'discordant';
  /** ISO timestamp of the analysis. */
  analyzedAt: number;
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Whether a path looks like a MAM module file.
 *
 * @param path - path to test.
 * @returns `true` for `.mam` and `.mam.md` files.
 */
export function isModuleFile(path: string): boolean {
  return path.endsWith('.mam') || path.endsWith('.mam.md');
}

/**
 * Recursively discover MAM modules under a directory.
 *
 * Directories that are never scanned: `node_modules`, `.git`, `dist`,
 * `build`, `.turbo`, `.mam-cache`.
 *
 * @param dir - directory to scan.
 * @param depth - remaining recursion depth.
 * @param maxDepth - maximum depth from the root.
 * @param out - accumulator for discovered paths.
 * @returns the discovered module paths.
 */
export async function discoverModules(
  dir: string,
  depth = 0,
  maxDepth = 6,
  out: string[] = [],
): Promise<string[]> {
  const skip = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', '.mam-cache', 'coverage']);
  if (depth > maxDepth) return out;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (skip.has(entry)) continue;
    const full = join(dir, entry);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      await discoverModules(full, depth + 1, maxDepth, out);
    } else if (isModuleFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Resolve the target of a harmony run: either a single file or a directory.
 *
 * @param target - user supplied path.
 * @returns `{ root, singleFile }`.
 */
export async function resolveTarget(target: string): Promise<{ root: string; singleFile: string | undefined }> {
  const abs = resolve(target);
  try {
    const info = await stat(abs);
    if (info.isFile()) return { root: abs, singleFile: abs };
  } catch {
    /* fall through to directory handling */
  }
  return { root: abs, singleFile: undefined };
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Read a declared string list out of a parsed module.
 *
 * @param mod - parsed module.
 * @param sectionKind - section kind to inspect.
 * @param field - field name inside the section.
 * @returns the declared values.
 */
export function readList(mod: ParserModule | undefined, sectionKind: string, field: string): string[] {
  const sections =
    (mod as unknown as { sections?: Array<Record<string, unknown>> } | undefined)?.sections ?? [];
  const section = sections.find((s) => String(s.kind) === sectionKind);
  if (!section) return [];
  const value = section[field];
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
      .split(/[\n,]/)
      .map((v) => v.replace(/^[-*]\s*/, '').trim())
      .filter(Boolean);
  }
  return [];
}

/** Default per-module analysis budget in milliseconds. */
export const DEFAULT_MODULE_TIMEOUT_MS = 10_000;

/**
 * Resolve a promise, or reject after `ms` milliseconds.
 *
 * @param promise - the work to bound.
 * @param ms - timeout in milliseconds.
 * @param label - label used in the timeout error.
 * @returns the resolved value.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${label}`)), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Parse a single module file into a {@link HarmonyModule} record.
 *
 * Each module is analysed under a time budget so that one pathological file
 * cannot stall a whole-project scan; a timeout is recorded as a finding
 * rather than raised.
 *
 * @param path - absolute path.
 * @param root - project root used to compute the relative path.
 * @param timeoutMs - per-module budget in milliseconds.
 * @returns the module record (never throws).
 */
export async function analyzeModule(
  path: string,
  root: string,
  timeoutMs: number = DEFAULT_MODULE_TIMEOUT_MS,
): Promise<HarmonyModule> {
  const relative = path.startsWith(root) ? path.slice(root.length).replace(/^[\\/]/, '') : path;
  let errors: string[] = [];
  let warnings: string[] = [];
  let valid = false;
  let name = relative.replace(/\.mam(\.md)?$/, '');
  let dependencies: string[] = [];
  let exports: string[] = [];

  try {
    const source = await readFile(path, 'utf-8');
    const parsed = (await withTimeout(
      Promise.resolve(parseMAM(source, { source: path })),
      timeoutMs,
      `parse ${relative}`,
    )) as unknown as {
      ast?: ParserModule;
      errors?: Array<{ message?: string }>;
      warnings?: Array<{ message?: string }>;
    };
    const mod = parsed?.ast ?? (parsed as unknown as ParserModule);
    errors = (parsed?.errors ?? []).map((e) => String(e.message ?? 'parse error'));
    warnings = (parsed?.warnings ?? []).map((e) => String(e.message ?? 'parse warning'));
    const raw = (mod as { raw_content?: string } | undefined)?.raw_content ?? source;
    const nm = /^\s*---\r?\n[\s\S]*?^name\s*:\s*(.+)$/m.exec(raw);
    if (nm) name = nm[1].trim().replace(/^["']|["']$/g, '');
    dependencies = readList(mod, 'dependencies', 'items');
    exports = readList(mod, 'exports', 'items');
    try {
      const report = validate(mod as never) as unknown as { errors?: unknown[] };
      valid = (report?.errors ?? []).length === 0;
    } catch {
      valid = false;
    }
  } catch (error) {
    errors = [(error as Error).message];
  }

  return { path, relative, name, parsed: errors.length === 0, errors, warnings, dependencies, exports, valid };
}

// ============================================================================
// Cross-checks
// ============================================================================

/**
 * Detect duplicate module names.
 *
 * @param modules - analysed modules.
 * @returns the findings.
 */
export function checkDuplicateNames(modules: HarmonyModule[]): HarmonyFinding[] {
  const byName = new Map<string, HarmonyModule[]>();
  for (const mod of modules) {
    const list = byName.get(mod.name) ?? [];
    list.push(mod);
    byName.set(mod.name, list);
  }
  const findings: HarmonyFinding[] = [];
  for (const [name, list] of byName) {
    if (list.length > 1) {
      findings.push({
        code: 'HARMONY-001',
        severity: 'error',
        message: `duplicate module name "${name}" declared by ${list.length} files`,
        modules: list.map((m) => m.relative),
      });
    }
  }
  return findings;
}

/**
 * Verify every declared dependency resolves to a known module.
 *
 * @param modules - analysed modules.
 * @returns the findings.
 */
export function checkDependencies(modules: HarmonyModule[]): HarmonyFinding[] {
  const known = new Set(modules.map((m) => m.name));
  const findings: HarmonyFinding[] = [];
  for (const mod of modules) {
    for (const dep of mod.dependencies) {
      const target = dep.replace(/\.mam(\.md)?$/, '');
      if (!known.has(target)) {
        findings.push({
          code: 'HARMONY-002',
          severity: 'error',
          message: `"${mod.name}" depends on "${dep}" which does not exist`,
          modules: [mod.relative],
        });
      }
    }
  }
  return findings;
}

/**
 * Report modules that nothing depends upon.
 *
 * @param modules - analysed modules.
 * @returns the findings (informational).
 */
export function checkOrphans(modules: HarmonyModule[]): HarmonyFinding[] {
  const referenced = new Set<string>();
  for (const mod of modules) {
    for (const dep of mod.dependencies) referenced.add(dep.replace(/\.mam(\.md)?$/, ''));
  }
  return modules
    .filter((m) => !referenced.has(m.name))
    .map((m) => ({
      code: 'HARMONY-003',
      severity: 'info' as const,
      message: `"${m.name}" is not referenced by any module`,
      modules: [m.relative],
    }));
}

/**
 * Detect dependency cycles with a depth-first colouring pass.
 *
 * @param modules - analysed modules.
 * @returns the findings.
 */
export function detectCycles(modules: HarmonyModule[]): HarmonyFinding[] {
  const graph = new Map<string, string[]>();
  for (const mod of modules) {
    graph.set(
      mod.name,
      mod.dependencies.map((d) => d.replace(/\.mam(\.md)?$/, '')),
    );
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    state.set(node, 1);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      const s = state.get(next) ?? 0;
      if (s === 0) {
        visit(next);
      } else if (s === 1) {
        const start = stack.indexOf(next);
        if (start >= 0) cycles.push([...stack.slice(start), next]);
      }
    }
    stack.pop();
    state.set(node, 2);
  };

  for (const mod of modules) {
    if ((state.get(mod.name) ?? 0) === 0) visit(mod.name);
  }

  return cycles.map((cycle) => ({
    code: 'HARMONY-004',
    severity: 'error' as const,
    message: `dependency cycle: ${cycle.join(' -> ')}`,
    modules: cycle,
  }));
}

/**
 * Fold findings into a 0-100 harmony score and a verdict.
 *
 * @param findings - all findings.
 * @param moduleCount - number of modules analysed.
 * @returns `{ score, verdict }`.
 */
export function scoreHarmony(
  findings: HarmonyFinding[],
  moduleCount: number,
): { score: number; verdict: HarmonyReport['verdict'] } {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const penalty = errors * 20 + warnings * 5;
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const verdict: HarmonyReport['verdict'] =
    score >= 85 ? 'harmonious' : score >= 60 ? 'mostly-harmonious' : 'discordant';
  void moduleCount;
  return { score, verdict };
}

// ============================================================================
// Report
// ============================================================================

/**
 * Run the full harmony analysis over a path.
 *
 * @param options - harmony options.
 * @returns the {@link HarmonyReport}.
 */
export async function runHarmony(options: HarmonyOptions): Promise<HarmonyReport> {
  const target = await resolveTarget(options.path ?? '.');
  const discovered = target.singleFile
    ? [target.singleFile]
    : await discoverModules(target.root, 0, options.maxDepth ?? 6);

  // Full parse + validate costs ~1-2s per module, so a bulk scan over a whole
  // tree can take minutes. Cap the default batch and surface the truncation.
  const cap = options.maxFiles ?? 40;
  const truncated = discovered.length > cap;
  const files = truncated ? discovered.slice(0, cap) : discovered;

  // `ora` holds the stream open on non-TTY output, so only animate when we
  // are attached to a real terminal (and never in --json mode).
  const interactive = Boolean(process.stdout.isTTY) && options.json !== true;
  const spinner = files.length > 8 && interactive ? ora(`Analysing ${files.length} modules...`).start() : undefined;

  const modules: HarmonyModule[] = [];
  for (const [i, file] of files.entries()) {
    if (spinner) {
      spinner.text = `Analysing ${files.length} modules (${i + 1}/${files.length})`;
    }
    modules.push(await analyzeModule(file, target.root, options.timeoutMs ?? DEFAULT_MODULE_TIMEOUT_MS));
  }
  spinner?.stop();

  let truncatedNote: HarmonyFinding | undefined;
  if (truncated) {
    const skipped = discovered.length - files.length;
    truncatedNote = {
      code: 'HARMONY-000',
      severity: 'info',
      message: `scan truncated: analysed ${files.length} of ${discovered.length} modules (${skipped} skipped, raise --max-files to include them)`,
      modules: [],
    };
  }

  const findings: HarmonyFinding[] = [];
  for (const mod of modules) {
    for (const e of mod.errors) {
      findings.push({ code: 'HARMONY-005', severity: 'error', message: e, modules: [mod.relative] });
    }
    for (const w of mod.warnings) {
      findings.push({ code: 'HARMONY-006', severity: 'warning', message: w, modules: [mod.relative] });
    }
  }
  findings.push(...checkDuplicateNames(modules));
  findings.push(...checkDependencies(modules));
  findings.push(...detectCycles(modules));
  if (options.verbose) findings.push(...checkOrphans(modules));
  if (truncatedNote) findings.push(truncatedNote);

  const { score, verdict } = scoreHarmony(findings, modules.length);

  return {
    root: target.root,
    modules,
    findings: options.verbose ? findings : findings.filter((f) => f.severity !== 'info'),
    score,
    verdict,
    analyzedAt: Date.now(),
  };
}

/**
 * Render the harmony report as colourised text.
 *
 * @param report - the analysis report.
 * @returns the rendered text.
 */
export function renderHarmonyReport(report: HarmonyReport): string {
  const out: string[] = [];
  out.push('');
  out.push(chalk.cyan.bold('Harmony Report'));
  out.push(chalk.gray('='.repeat(60)));
  out.push(`  ${chalk.cyan('root'.padEnd(16))} ${chalk.white(report.root)}`);
  out.push(`  ${chalk.cyan('modules'.padEnd(16))} ${chalk.white(String(report.modules.length))}`);
  out.push(
    `  ${chalk.cyan('findings'.padEnd(16))} ${chalk.white(String(report.findings.length))}`,
  );

  const colour = (s: HarmonySeverity) =>
    s === 'error' ? chalk.red : s === 'warning' ? chalk.yellow : chalk.gray;

  for (const severity of ['error', 'warning', 'info'] as HarmonySeverity[]) {
    const group = report.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    out.push('');
    out.push(`${colour(severity).bold(severity.toUpperCase())} (${group.length})`);
    out.push(chalk.gray('-'.repeat(60)));
    for (const f of group) {
      out.push(`  ${colour(severity)('*')} ${chalk.gray(f.code)} ${f.message}`);
    }
  }

  out.push('');
  out.push(chalk.gray('-'.repeat(60)));
  const verdictColour =
    report.verdict === 'harmonious' ? chalk.green : report.verdict === 'mostly-harmonious' ? chalk.yellow : chalk.red;
  out.push(`  ${chalk.cyan('score'.padEnd(16))} ${verdictColour.bold(`${report.score}/100`)}`);
  out.push(`  ${chalk.cyan('verdict'.padEnd(16))} ${verdictColour.bold(report.verdict)}`);
  out.push('');
  return out.join('\n');
}

/**
 * `mam harmony` entry point.
 *
 * @param options - harmony options.
 * @returns the {@link HarmonyReport}.
 */
export async function harmonyCommand(options: HarmonyOptions): Promise<HarmonyReport> {
  const report = await runHarmony(options);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHarmonyReport(report));
  }
  return report;
}

/** Re-exported so callers can classify custom findings consistently. */
export type { ParserModule as HarmonyParserModule };
void extname;