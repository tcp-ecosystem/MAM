/**
 * MAM Smoke Command
 *
 * Smoke-tests a MAM module end-to-end without producing any side effects.
 *
 * The command drives the complete MAM pipeline against a single module file:
 *
 *   1. **load**     – read the module source from disk (bytes + line count)
 *   2. **parse**    – lex + parse via `@mam/parser` (`parseMAM`), reporting
 *                    lexer and parser errors with formatted source locations
 *   3. **validate** – schema/semantic validation via `@mam/validator`
 *   4. **compile**  – transform the parsed AST with `transformToV2` and emit
 *                    the requested target with `new MAMCompiler().compile()`
 *   5. **execute**  – best-effort in-process execution through the MAM v2
 *                    native runtime (`createV2Runtime`)
 *
 * Every stage is reported as a row in a PASS/FAIL table and the command ends
 * with a single verdict (PASS/FAIL) plus a machine-readable `SmokeResult`.
 *
 * Smoke runs are intentionally sandboxed in-process: an allow-all permission
 * checker, throw-away in-memory stores and a bounded execution timeout keep
 * the command safe to run against untrusted or partially-complete modules.
 * Successful runs are cached in a short-lived working-memory store
 * (`createWorkingMemory`) keyed by content hash; pass `--noCache` to bypass.
 *
 * @module smoke
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import { parseMAM, type MAMModule as ParserModule } from '@mam/parser';
import { validate, type ValidationReport } from '@mam/validator';
import { MAMCompiler, transformToV2, type CompileTarget, type CompileResult } from '@mam/compiler';
import {
  createV2Runtime,
  type MemoryStore,
  type StateManager,
  type PermissionChecker,
  type EventEmitter as V2EventEmitter,
  type MAMEvent,
  type ExecutionResult as V2ExecutionResult,
} from '@mam/runtime/v2';
import { createWorkingMemory } from '@mam/memory-engine';
import { createTracer, createEvaluator } from '@mam/observability';
import { getASTStats, type MAMModule as AstModule } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/**
 * Options accepted by {@link smokeCommand} / {@link runSmoke}.
 *
 * @param file - path (relative or absolute) of the `.mam` / `.mam.md` module.
 * @param target - compiler target to emit during the compile stage.
 * @param strict - run validation at the strict level instead of schema level.
 * @param noCache - bypass the working-memory smoke cache and always re-run.
 */
export interface SmokeOptions {
  file: string;
  target?: string;
  strict?: boolean;
  noCache?: boolean;
}

/**
 * Identifiers for each stage of the smoke pipeline.
 */
export type SmokeStepId = 'cache' | 'load' | 'parse' | 'validate' | 'compile' | 'execute';

/**
 * Outcome of a single smoke stage.
 */
export type SmokeStepStatus = 'pass' | 'fail' | 'skip' | 'warn';

/**
 * Result of one smoke stage.
 *
 * @param id - stable stage identifier.
 * @param name - human-readable stage name.
 * @param status - PASS/FAIL/SKIP/WARN outcome.
 * @param message - human-readable outcome message.
 * @param durationMs - wall-clock time spent in the stage.
 * @param details - optional structured payload (e.g. output keys, node counts).
 */
export interface SmokeStepResult {
  id: SmokeStepId;
  name: string;
  status: SmokeStepStatus;
  message: string;
  durationMs: number;
  details?: unknown;
}

/**
 * Aggregated counts derived from the step list.
 */
export interface SmokeStats {
  /** Total number of recorded steps. */
  total: number;
  /** Number of steps that passed. */
  passed: number;
  /** Number of steps that failed. */
  failed: number;
  /** Number of steps that were skipped (dependency failed earlier). */
  skipped: number;
  /** Number of steps that completed with a warning. */
  warnings: number;
  /** Total wall-clock duration across the run. */
  totalDurationMs: number;
}

/**
 * Metadata captured while smoke-testing a module.
 */
export interface SmokeMetadata {
  /** Module name from frontmatter (when present). */
  moduleName?: string;
  /** Module type from frontmatter (when present). */
  moduleType?: string;
  /** Number of parsed top-level sections. */
  sectionCount: number;
  /** Number of AST content nodes (via `getASTStats`). */
  nodeCount: number;
  /** Size of the module source in bytes. */
  bytes: number;
  /** Number of lines in the module source. */
  lines: number;
  /** Parse stage duration in milliseconds. */
  parseTimeMs: number;
  /** Compile stage duration in milliseconds. */
  compileTimeMs: number;
  /** Execute stage duration in milliseconds (0 when skipped). */
  executeTimeMs: number;
  /** Total smoke run duration in milliseconds. */
  totalTimeMs: number;
  /** Absolute path of the module that was smoke-tested. */
  source: string;
}

/**
 * Structured outcome of a smoke run.
 *
 * @param success - true when the final verdict is PASS.
 * @param file - resolved path of the module.
 * @param target - compiler target used for the compile stage.
 * @param verdict - human verdict banner: 'PASS' or 'FAIL'.
 * @param steps - ordered list of per-stage results.
 * @param stats - aggregated step statistics.
 * @param metadata - captured module / timing metadata.
 */
export interface SmokeResult {
  success: boolean;
  file: string;
  target: string;
  verdict: 'PASS' | 'FAIL';
  steps: SmokeStepResult[];
  stats: SmokeStats;
  metadata: SmokeMetadata;
}

// ============================================================================
// Constants
// ============================================================================

/** Compiler targets that `MAMCompiler` is able to resolve by name. */
const VALID_TARGETS = [
  'python',
  'javascript',
  'typescript',
  'go',
  'rust',
  'json',
  'yaml',
  'openai',
  'langgraph',
  'crewai',
];

/** Fallback target used when no (or an unknown) target is requested. */
const DEFAULT_TARGET = 'python';

/** TTL for the working-memory smoke cache (5 minutes). */
const SMOKE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Bounded timeout for the best-effort execution stage. */
const EXECUTION_TIMEOUT_MS = 15_000;

// ============================================================================
// In-process runtime collaborators (safe, throw-away implementations)
// ============================================================================

/**
 * Minimal in-memory {@link MemoryStore} used to satisfy the v2 runtime during
 * a smoke execution. Nothing is persisted beyond the process lifetime.
 */
class InMemoryStore implements MemoryStore {
  private readonly data = new Map<string, unknown>();

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  async stats(): Promise<{ totalEntries: number; memoryUsed: number; hitRate: number; evictions: number }> {
    return { totalEntries: this.data.size, memoryUsed: 0, hitRate: 0, evictions: 0 };
  }
}

/**
 * Minimal in-memory {@link StateManager} for smoke executions.
 */
class InMemoryState implements StateManager {
  private readonly data = new Map<string, unknown>();

  get(key: string): unknown {
    return this.data.get(key);
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  getAll(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }

  subscribe(): void {
    // Not needed for a smoke run.
  }

  unsubscribe(): void {
    // Not needed for a smoke run.
  }

  history(): never[] {
    return [];
  }
}

/**
 * Permissive {@link PermissionChecker} — smoke executions are sandboxed in
 * memory, so every action is allowed. Real deployments should use a policy
 * module instead.
 */
class AllowAllPermissions implements PermissionChecker {
  check(): { allowed: true; reason?: string } {
    return { allowed: true };
  }

  getAllowed(): string[] {
    return ['*'];
  }

  getDenied(): string[] {
    return [];
  }
}

/**
 * No-op {@link V2EventEmitter} that still records an event history.
 */
class SilentEventEmitter implements V2EventEmitter {
  private readonly events: MAMEvent[] = [];

  emit(name: string, data?: unknown): void {
    this.events.push({ name, data, timestamp: Date.now(), source: 'mam.smoke' });
  }

  on(): void {
    // No listeners are registered during a smoke run.
  }

  off(): void {
    // No listeners are registered during a smoke run.
  }

  once(): void {
    // No listeners are registered during a smoke run.
  }

  history(): MAMEvent[] {
    return this.events;
  }
}

// ============================================================================
// Step builders
// ============================================================================

/**
 * Build a passing step result.
 *
 * @param id - stage identifier.
 * @param message - success message.
 * @param durationMs - stage duration.
 * @param details - optional structured payload.
 * @returns a `SmokeStepResult` with status `pass`.
 */
function passStep(id: SmokeStepId, message: string, durationMs: number, details?: unknown): SmokeStepResult {
  return { id, name: stepName(id), status: 'pass', message, durationMs, details };
}

/**
 * Build a failing step result.
 *
 * @param id - stage identifier.
 * @param message - failure message.
 * @param durationMs - stage duration.
 * @param details - optional structured payload.
 * @returns a `SmokeStepResult` with status `fail`.
 */
function failStep(id: SmokeStepId, message: string, durationMs: number, details?: unknown): SmokeStepResult {
  return { id, name: stepName(id), status: 'fail', message, durationMs, details };
}

/**
 * Build a skipped step result (used when an earlier stage failed).
 *
 * @param id - stage identifier.
 * @param message - reason the stage was skipped.
 * @param durationMs - stage duration (usually 0).
 * @returns a `SmokeStepResult` with status `skip`.
 */
function skipStep(id: SmokeStepId, message: string, durationMs = 0): SmokeStepResult {
  return { id, name: stepName(id), status: 'skip', message, durationMs };
}

/**
 * Build a warn-level step result (non-fatal, e.g. execution unavailable).
 *
 * @param id - stage identifier.
 * @param message - warning message.
 * @param durationMs - stage duration.
 * @returns a `SmokeStepResult` with status `warn`.
 */
function warnStep(id: SmokeStepId, message: string, durationMs: number): SmokeStepResult {
  return { id, name: stepName(id), status: 'warn', message, durationMs };
}

/**
 * Human-readable label for a stage identifier.
 *
 * @param id - the stage identifier.
 * @returns the display name for the stage.
 */
function stepName(id: SmokeStepId): string {
  switch (id) {
    case 'cache': return 'Cache';
    case 'load': return 'Load';
    case 'parse': return 'Parse';
    case 'validate': return 'Validate';
    case 'compile': return 'Compile';
    case 'execute': return 'Execute';
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** A module loaded from disk. */
interface LoadedModule {
  /** Absolute path of the module. */
  file: string;
  /** Raw source text. */
  content: string;
  /** Size in bytes (UTF-8). */
  bytes: number;
  /** Number of lines. */
  lines: number;
}

/**
 * Read a MAM module from disk and report basic file statistics.
 *
 * @param file - path to the module.
 * @returns the loaded module contents plus byte/line counts.
 * @throws when the file cannot be read.
 */
async function readModule(file: string): Promise<LoadedModule> {
  const content = await readFile(file, 'utf-8');
  const bytes = Buffer.byteLength(content, 'utf-8');
  const lines = content.length === 0 ? 0 : content.split(/\r\n|\r|\n/).length;
  return { file, content, bytes, lines };
}

/**
 * Normalize a user-supplied target into a `CompileTarget`.
 *
 * Unknown targets fall back to the default so the smoke run never aborts on a
 * typo; the compile stage reports the resolved target in its output.
 *
 * @param target - optional user-supplied target string.
 * @returns a valid `CompileTarget`.
 */
function normalizeTarget(target?: string): CompileTarget {
  const candidate = (target ?? DEFAULT_TARGET).trim().toLowerCase();
  return (VALID_TARGETS.includes(candidate) ? candidate : DEFAULT_TARGET) as CompileTarget;
}

/**
 * Format an arbitrary thrown value into a human-readable error string.
 *
 * Handles parser errors (which expose `toFormattedString()`), validation
 * diagnostics, plain `Error` objects and unknown values.
 *
 * @param error - the value to format.
 * @returns a single-line error message with source location when available.
 */
export function formatError(error: unknown): string {
  if (error === null || error === undefined) return 'Unknown error';
  if (typeof error === 'string') return error;

  const obj = error as { toFormattedString?: () => unknown; message?: unknown; code?: unknown; path?: unknown; severity?: unknown };
  if (typeof obj.toFormattedString === 'function') {
    const formatted = obj.toFormattedString();
    return typeof formatted === 'string' ? formatted : String(formatted);
  }
  if (typeof obj.message === 'string') {
    const parts: string[] = [];
    if (typeof obj.code === 'string' && obj.code.length > 0) parts.push(`[${obj.code}]`);
    parts.push(obj.message);
    if (typeof obj.path === 'string' && obj.path.length > 0) parts.push(`at ${obj.path}`);
    return parts.join(' ');
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * SHA-256 hex digest of the module content, used as the smoke cache key.
 *
 * @param content - module source text.
 * @returns a 64-character hex digest.
 */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Aggregate step results into {@link SmokeStats}.
 *
 * @param steps - the recorded steps.
 * @returns aggregated counts.
 */
export function collectStats(steps: SmokeStepResult[]): SmokeStats {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let warnings = 0;
  let totalDurationMs = 0;
  for (const step of steps) {
    totalDurationMs += step.durationMs;
    switch (step.status) {
      case 'pass': passed++; break;
      case 'fail': failed++; break;
      case 'skip': skipped++; break;
      case 'warn': warnings++; break;
    }
  }
  return { total: steps.length, passed, failed, skipped, warnings, totalDurationMs };
}

/**
 * Determine the overall smoke verdict from a step list.
 *
 * A run passes only when no step failed; `warn` and `skip` steps do not fail
 * the run (a skipped execution is acceptable for modules without runnable
 * content, and warnings are informational).
 *
 * @param steps - the recorded steps.
 * @returns `true` when the run should be considered PASS.
 */
function computeVerdict(steps: SmokeStepResult[]): boolean {
  return steps.every((step) => step.status !== 'fail');
}

/**
 * Render a single step row to the terminal.
 *
 * @param step - the step to print.
 */
export function printStep(step: SmokeStepResult): void {
  const icon = step.status === 'pass' ? '✓' : step.status === 'fail' ? '✗' : step.status === 'warn' ? '!' : '·';
  const coloredIcon =
    step.status === 'pass' ? chalk.green(icon)
    : step.status === 'fail' ? chalk.red(icon)
    : step.status === 'warn' ? chalk.yellow(icon)
    : chalk.gray(icon);
  const label = chalk.bold(
    step.status === 'pass' ? chalk.green('PASS')
    : step.status === 'fail' ? chalk.red('FAIL')
    : step.status === 'warn' ? chalk.yellow('WARN')
    : chalk.gray('SKIP'),
  );
  const dur = chalk.gray(`(${step.durationMs.toFixed(1)}ms)`);
  console.log(`  ${coloredIcon} ${label} ${chalk.cyan(step.id.padEnd(9))} ${step.message} ${dur}`);
  if (step.details !== undefined && typeof step.details === 'string' && step.details.length > 0) {
    console.log(chalk.gray(`            ${step.details}`));
  }
}

/**
 * Render the step table header used by {@link printTable}.
 */
function printTableHeader(): void {
  console.log('');
  console.log(chalk.bold.underline('Smoke steps'));
  console.log(chalk.gray('  ' + '-'.repeat(72)));
}

/**
 * Render the full PASS/FAIL table for a smoke result.
 *
 * @param result - the smoke run outcome.
 */
export function printTable(result: SmokeResult): void {
  printTableHeader();
  for (const step of result.steps) {
    printStep(step);
  }
  console.log(chalk.gray('  ' + '-'.repeat(72)));
}

/**
 * Render the final verdict banner and aggregate statistics.
 *
 * @param result - the smoke run outcome.
 */
export function printSummary(result: SmokeResult): void {
  const ok = result.success;
  console.log('');
  console.log(ok ? chalk.green.bold('  ✔ SMOKE VERDICT: PASS') : chalk.red.bold('  ✘ SMOKE VERDICT: FAIL'));
  console.log(chalk.gray('  ' + '='.repeat(72)));
  console.log(chalk.gray(`    module:     ${result.metadata.moduleName ?? basename(result.file)}`));
  if (result.metadata.moduleType) {
    console.log(chalk.gray(`    type:       ${result.metadata.moduleType}`));
  }
  console.log(chalk.gray(`    target:     ${result.target}`));
  console.log(chalk.gray(`    sections:   ${result.metadata.sectionCount}`));
  console.log(chalk.gray(`    nodes:      ${result.metadata.nodeCount}`));
  console.log(chalk.gray(`    steps:      ${result.stats.passed} passed, ${result.stats.failed} failed, ${result.stats.warnings} warned, ${result.stats.skipped} skipped`));
  console.log(chalk.gray(`    total:      ${result.stats.totalDurationMs.toFixed(1)}ms (parse ${result.metadata.parseTimeMs.toFixed(1)}ms, compile ${result.metadata.compileTimeMs.toFixed(1)}ms, execute ${result.metadata.executeTimeMs.toFixed(1)}ms)`));
  console.log(chalk.gray('  ' + '='.repeat(72)));
}

// ============================================================================
// Smoke runner
// ============================================================================

/**
 * Execute a full smoke run against a MAM module and return a structured,
 * side-effect-free result.
 *
 * Stages are recorded in order; when a stage fails, dependent stages are
 * marked as skipped so the report always reflects the true pipeline state.
 * Successful runs are cached (unless {@link SmokeOptions.noCache} is set) in a
 * short-lived working-memory store; a subsequent run against an unchanged
 * module short-circuits and reports PASS from cache.
 *
 * @param options - the smoke options (file, target, strict, noCache).
 * @returns the full {@link SmokeResult} for the module.
 */
export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const startedAt = performance.now();
  const file = resolve(options.file);
  const target = normalizeTarget(options.target);
  const steps: SmokeStepResult[] = [];
  const metadata: SmokeMetadata = {
    sectionCount: 0,
    nodeCount: 0,
    bytes: 0,
    lines: 0,
    parseTimeMs: 0,
    compileTimeMs: 0,
    executeTimeMs: 0,
    totalTimeMs: 0,
    source: file,
  };

  const finish = (): SmokeResult => {
    const stats = collectStats(steps);
    const success = computeVerdict(steps);
    metadata.totalTimeMs = performance.now() - startedAt;
    return { success, file, target, verdict: success ? 'PASS' : 'FAIL', steps, stats, metadata };
  };

  // 1. Load stage
  const loadStart = performance.now();
  let content: string;
  try {
    const loaded = await readModule(file);
    content = loaded.content;
    metadata.bytes = loaded.bytes;
    metadata.lines = loaded.lines;
    steps.push(passStep('load', `Loaded ${basename(file)} (${loaded.bytes} bytes, ${loaded.lines} lines)`, performance.now() - loadStart));
  } catch (error) {
    steps.push(failStep('load', formatError(error), performance.now() - loadStart));
    for (const id of ['parse', 'validate', 'compile', 'execute'] as SmokeStepId[]) {
      steps.push(skipStep(id, 'Skipped: module could not be loaded'));
    }
    return finish();
  }

  // 2. Cache lookup stage
  const cacheStart = performance.now();
  const contentHash = hashContent(content);
  if (options.noCache) {
    steps.push(skipStep('cache', 'Bypassed (--noCache)'));
  } else {
    try {
      const cache = createWorkingMemory(SMOKE_CACHE_TTL_MS);
      const cached = (await cache.get(`smoke:${contentHash}`)) as { verdict?: string; target?: string; at?: string } | undefined;
      if (cached && cached.verdict === 'PASS' && cached.target === target) {
        steps.push(passStep('cache', `Reused previous PASS for unchanged module (cached at ${cached.at ?? 'unknown'})`, performance.now() - cacheStart));
        steps.push(skipStep('load', 'Skipped: cached result reused'));
        steps.push(skipStep('parse', 'Skipped: cached result reused'));
        steps.push(skipStep('validate', 'Skipped: cached result reused'));
        steps.push(skipStep('compile', 'Skipped: cached result reused'));
        steps.push(skipStep('execute', 'Skipped: cached result reused'));
        return finish();
      }
      steps.push(steps.length === 1
        ? passStep('cache', 'No usable cache entry', performance.now() - cacheStart)
        : warnStep('cache', 'No usable cache entry', performance.now() - cacheStart));
    } catch (error) {
      steps.push(warnStep('cache', `Cache unavailable: ${formatError(error)}`, performance.now() - cacheStart));
    }
  }

  // 3. Parse stage
  const parseStart = performance.now();
  let parserAst: ParserModule | null = null;
  try {
    const parsed = parseMAM(content, { source: file, strict: options.strict });
    metadata.parseTimeMs = performance.now() - parseStart;
    metadata.sectionCount = parsed.ast.sections.length;

    const warnings: string[] = [];
    for (const warning of parsed.warnings) {
      warnings.push(formatError(warning));
    }
    if (parsed.errors.length > 0) {
      const details = parsed.errors.map((e) => formatError(e)).join('; ');
      steps.push(failStep('parse', `Parse failed with ${parsed.errors.length} error(s)`, metadata.parseTimeMs, details));
      for (const id of ['validate', 'compile', 'execute'] as SmokeStepId[]) {
        steps.push(skipStep(id, 'Skipped: module failed to parse'));
      }
      return finish();
    }
    parserAst = parsed.ast;

    const extra = warnings.length > 0 ? ` · ${warnings.length} warning(s)` : '';
    steps.push(passStep('parse', `Parsed ${parsed.ast.sections.length} section(s)${extra}`, metadata.parseTimeMs, { stats: parsed.stats }));
    for (const warning of warnings) {
      steps.push(warnStep('parse', `Parse warning: ${warning}`, 0));
    }
  } catch (error) {
    steps.push(failStep('parse', formatError(error), performance.now() - parseStart));
    for (const id of ['validate', 'compile', 'execute'] as SmokeStepId[]) {
      steps.push(skipStep(id, 'Skipped: parser threw'));
    }
    return finish();
  }

  // 4. Validate stage
  const validateStart = performance.now();
  let report: ValidationReport | null = null;
  try {
    const ast = parserAst as unknown as AstModule;
    report = validate(ast, { level: options.strict ? 'strict' : 'schema' });
    const duration = performance.now() - validateStart;

    if (!report.valid) {
      const details = report.errors.map((e) => `[${e.code}] ${e.message}${e.path ? ` at ${e.path}` : ''}`).join('; ');
      steps.push(failStep('validate', `Validation failed with ${report.errors.length} error(s)`, duration, details));
      for (const id of ['compile', 'execute'] as SmokeStepId[]) {
        steps.push(skipStep(id, 'Skipped: module failed validation'));
      }
      return finish();
    }
    const warnCount = report.warnings.length;
    const extra = warnCount > 0 ? ` · ${warnCount} warning(s)` : '';
    steps.push(passStep('validate', `Module is valid (${report.stats.rulesChecked} rules, ${report.stats.timeMs.toFixed(1)}ms)${extra}`, duration));
    for (const warning of report.warnings) {
      steps.push(warnStep('validate', `[${warning.code}] ${warning.message}`, 0));
    }
  } catch (error) {
    steps.push(failStep('validate', formatError(error), performance.now() - validateStart));
    for (const id of ['compile', 'execute'] as SmokeStepId[]) {
      steps.push(skipStep(id, 'Skipped: validator threw'));
    }
    return finish();
  }

  // AST summary for metadata
  try {
    const stats = getASTStats(parserAst as unknown as AstModule);
    metadata.nodeCount = stats.totalNodes;
    if (!metadata.moduleType) {
      const data = (parserAst.frontmatter?.data ?? {}) as Record<string, unknown>;
      metadata.moduleType = typeof data.type === 'string' ? data.type : undefined;
      metadata.moduleName = typeof data.name === 'string' ? data.name : undefined;
    }
  } catch {
    // Metadata enrichment is best-effort.
  }

  // 5. Compile stage
  const compileStart = performance.now();
  let v2Modules: ReturnType<typeof transformToV2> = [];
  let compiled: CompileResult | null = null;
  try {
    v2Modules = transformToV2(parserAst);
    const compiler = new MAMCompiler();
    compiled = compiler.compile(v2Modules, { target });
    metadata.compileTimeMs = performance.now() - compileStart;

    if (!compiled.success) {
      const details = compiled.errors.join('; ');
      steps.push(failStep('compile', `Compilation to '${target}' failed`, metadata.compileTimeMs, details));
      steps.push(skipStep('execute', 'Skipped: compilation failed'));
      return finish();
    }
    const tokenNote = compiled.tokenOptimization
      ? ` · saved ${compiled.tokenOptimization.savedTokens} tokens (${compiled.tokenOptimization.savedPercent.toFixed(1)}%)`
      : '';
    steps.push(passStep(
      'compile',
      `Compiled ${v2Modules.length} module(s) → '${target}' (${compiled.stats.linesGenerated} lines)${tokenNote}`,
      metadata.compileTimeMs,
      { outputLength: compiled.output.length },
    ));
    for (const warning of compiled.warnings) {
      steps.push(warnStep('compile', `Compile warning: ${warning}`, 0));
    }
  } catch (error) {
    steps.push(failStep('compile', formatError(error), performance.now() - compileStart));
    steps.push(skipStep('execute', 'Skipped: compiler threw'));
    return finish();
  }

  // 6. Execute stage (best-effort, in-process, sandboxed)
  const executeStart = performance.now();
  try {
    const module = v2Modules[0];
    if (!module) {
      throw new Error('No executable modules produced by the transformer');
    }
    const tracer = createTracer();
    const runtime = createV2Runtime({
      workingDir: dirname(file),
      defaultTimeout: EXECUTION_TIMEOUT_MS,
      memoryLimit: 0,
      logging: false,
      logLevel: 'info',
      pluginDirs: [],
    });

    // The runtime's own `timeout` cannot interrupt synchronous work, so a module
    // whose execution blocks the event loop would hang the whole command.
    // Race the execution against a hard deadline and record a failure instead.
    const execDeadline = new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new Error(`execution exceeded ${EXECUTION_TIMEOUT_MS}ms budget`)),
        EXECUTION_TIMEOUT_MS,
      );
      t.unref?.();
    });

    let execResult: V2ExecutionResult;
    execResult = await Promise.race([
      tracer.trace(
        () =>
          runtime.execute(module, {
            module,
            allModules: new Map(v2Modules.map((m) => [m.name, m])),
            inputs: {},
            memory: new InMemoryStore(),
            events: new SilentEventEmitter(),
            state: new InMemoryState(),
            permissions: new AllowAllPermissions(),
            options: { timeout: EXECUTION_TIMEOUT_MS },
          }),
        'mam.smoke.execute',
      ),
      execDeadline,
    ]);
    metadata.executeTimeMs = performance.now() - executeStart;

    if (execResult.success) {
      const outputKeys = Object.keys(execResult.output ?? {});
      steps.push(passStep(
        'execute',
        `Executed '${module.name}' successfully (${metadata.executeTimeMs.toFixed(1)}ms)${outputKeys.length > 0 ? ` · output: ${outputKeys.join(', ')}` : ''}`,
        metadata.executeTimeMs,
        { outputKeys, events: execResult.events.length },
      ));
    } else {
      steps.push(failStep('execute', execResult.error ?? 'Execution failed', metadata.executeTimeMs));
    }
  } catch (error) {
    steps.push(warnStep('execute', `Execution skipped (unavailable): ${formatError(error)}`, performance.now() - executeStart));
  }

  // 7. Cache successful runs
  if (!options.noCache) {
    try {
      const cache = createWorkingMemory(SMOKE_CACHE_TTL_MS);
      await cache.set(`smoke:${contentHash}`, {
        verdict: computeVerdict(steps) ? 'PASS' : 'FAIL',
        target,
        at: new Date().toISOString(),
      });
    } catch {
      // Caching is best-effort.
    }
  }

  return finish();
}

// ============================================================================
// CLI command
// ============================================================================

/**
 * Smoke-test a MAM module end-to-end and print the report to the terminal.
 *
 * Drives the pipeline described in the module docs, renders a PASS/FAIL step
 * table plus a final verdict banner, and sets the process exit code to match
 * the verdict (0 = PASS, 1 = FAIL).
 *
 * @param options - the {@link SmokeOptions} for the run.
 */
export async function smokeCommand(options: SmokeOptions): Promise<void> {
  const spinner = ora('Smoke-testing module...').start();

  try {
    const result = await runSmoke(options);
    spinner.stop();

    printTable(result);
    printSummary(result);

    // Observability verdict mirror: record the binary outcome as an evaluation.
    try {
      const evaluator = createEvaluator();
      const evaluation = evaluator.evaluate('mam.smoke.verdict', result.success ? 1 : 0);
      if (!evaluation.passed) {
        console.log(chalk.yellow(`  [evaluation] mam.smoke.verdict gate not met (score=${evaluation.score.toFixed(2)})`));
      }
    } catch {
      // Observability is best-effort.
    }

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    spinner.fail(formatError(error));
    process.exit(1);
  }
}