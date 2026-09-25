/**
 * MAM Module Test
 * 
 * Tests individual MAM modules.
 */

import { readFile } from 'node:fs/promises';
import { parseMAM } from '@mam/parser';
import { validate } from '@mam/validator';

// ============================================================================
// Types
// ============================================================================

export interface ModuleTestConfig {
  /** Module file path */
  file: string;
  /** Test name */
  name?: string;
  /** Validate before testing */
  validateFirst?: boolean;
  /** Expected sections */
  expectedSections?: string[];
  /** Expected module type */
  expectedType?: string;
  /** Maximum time in milliseconds before the test fails (0 disables) */
  timeoutMs?: number;
  /** Skip this test entirely */
  skip?: boolean;
}

export interface ModuleTestResult {
  /** Test name */
  name: string;
  /** Test success */
  success: boolean;
  /** Test errors */
  errors: string[];
  /** Test warnings */
  warnings: string[];
  /** Test stats */
  stats: {
    parseTimeMs: number;
    validateTimeMs: number;
    sectionCount: number;
    codeBlockCount: number;
  };
  /** Number of passed checks in this result */
  passed?: number;
  /** Number of failed checks in this result */
  failed?: number;
  /** Number of skipped checks in this result */
  skipped?: number;
  /** Total wall-clock duration in milliseconds */
  durationMs?: number;
}

// ============================================================================
// Module Test
// ============================================================================

export class ModuleTest {
  /**
   * Test a module file
   */
  static async test(config: ModuleTestConfig): Promise<ModuleTestResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const startTime = performance.now();

    try {
      const content = await readFile(config.file, 'utf-8');
      
      // Parse
      const parseStart = performance.now();
      const parseResult = parseMAM(content, { source: config.file });
      const parseTimeMs = performance.now() - parseStart;

      // Collect parse errors
      for (const error of parseResult.errors) {
        errors.push(error.message);
      }

      // Validate
      let validateTimeMs = 0;
      if (config.validateFirst !== false) {
        const validateStart = performance.now();
        const validationResult = validate(parseResult.ast as any);
        validateTimeMs = performance.now() - validateStart;

        for (const error of validationResult.errors) {
          errors.push(error.message);
        }
        for (const warning of validationResult.warnings) {
          warnings.push(warning.message);
        }
      }

      // Check expected sections
      if (config.expectedSections) {
        const actualSections = parseResult.ast.sections.map(s => s.name);
        for (const expected of config.expectedSections) {
          if (!actualSections.includes(expected)) {
            errors.push(`Missing expected section: ${expected}`);
          }
        }
      }

      // Check module type
      if (config.expectedType) {
        const moduleType = parseResult.ast.frontmatter?.data.runtime;
        if (moduleType !== config.expectedType) {
          warnings.push(`Expected runtime "${config.expectedType}", got "${moduleType}"`);
        }
      }

      return {
        name: config.name || config.file,
        success: errors.length === 0,
        errors,
        warnings,
        stats: {
          parseTimeMs,
          validateTimeMs,
          sectionCount: parseResult.ast.sections.length,
          codeBlockCount: parseResult.ast.metadata.codeBlockCount,
        },
      };
    } catch (error) {
      return {
        name: config.name || config.file,
        success: false,
        errors: [(error as Error).message],
        warnings,
        stats: {
          parseTimeMs: 0,
          validateTimeMs: 0,
          sectionCount: 0,
          codeBlockCount: 0,
        },
      };
    }
  }

  /**
   * Test multiple modules
   */
  static async testAll(configs: ModuleTestConfig[]): Promise<ModuleTestResult[]> {
    const results: ModuleTestResult[] = [];
    for (const config of configs) {
      results.push(await this.test(config));
    }
    return results;
  }
}

// ============================================================================
// Timeout Handling
// ============================================================================

export interface ModuleTestTimeoutOptions {
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Message used when the timeout triggers */
  message?: string;
}

/**
 * Race a promise against a wall-clock timeout.
 *
 * If `timeoutMs` is zero or negative the promise is returned untouched so that
 * callers can enable/disable timeouts without branching at every call site.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message = 'Operation timed out'): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

// ============================================================================
// Convenience Runner
// ============================================================================

/**
 * Convenience wrapper around `ModuleTest.test` that adds skip support,
 * optional timeout enforcement, and populates the extended result statistics
 * (`passed`, `failed`, `skipped`, `durationMs`).
 */
export async function runModule(config: ModuleTestConfig): Promise<ModuleTestResult> {
  const startTime = performance.now();

  if (config.skip) {
    return {
      name: config.name || config.file,
      success: true,
      errors: [],
      warnings: [],
      stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
      passed: 0,
      failed: 0,
      skipped: 1,
      durationMs: 0,
    };
  }

  let result: ModuleTestResult;
  if (config.timeoutMs && config.timeoutMs > 0) {
    result = await withTimeout(
      ModuleTest.test(config),
      config.timeoutMs,
      `Module "${config.name || config.file}" exceeded ${config.timeoutMs}ms`
    );
  } else {
    result = await ModuleTest.test(config);
  }

  result.durationMs = (result.durationMs ?? 0) || performance.now() - startTime;
  result.passed = result.success ? 1 : 0;
  result.failed = result.success ? 0 : 1;
  result.skipped = 0;
  return result;
}

/**
 * Run every config in the list, enforcing each config's timeout/skip settings.
 * Results are returned in declaration order.
 */
export async function runModules(configs: ModuleTestConfig[]): Promise<ModuleTestResult[]> {
  const results: ModuleTestResult[] = [];
  for (const config of configs) {
    results.push(await runModule(config));
  }
  return results;
}

// ============================================================================
// describe / it Style Wrappers
// ============================================================================

export interface RunCaseOptions {
  /** File associated with this case; appended to the result name */
  file?: string;
  /** Timeout in milliseconds (0 disables) */
  timeoutMs?: number;
  /** Skip this case entirely */
  skip?: boolean;
  /** Optional module type label recorded on the result */
  type?: string;
}

/**
 * Run a single test body (`it` style) and normalize the outcome into a
 * `ModuleTestResult`. Async rejection, thrown errors, and timeout violations
 * all produce a failed result with a message.
 */
export async function runCase(name: string, fn: () => void | Promise<void>, options: RunCaseOptions = {}): Promise<ModuleTestResult> {
  const startTime = performance.now();
  const baseName = options.file ? `${name} (${options.file})` : name;

  if (options.skip) {
    return {
      name: baseName,
      success: true,
      errors: [],
      warnings: [],
      stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
      passed: 0,
      failed: 0,
      skipped: 1,
      durationMs: 0,
    };
  }

  try {
    let body: Promise<void> = Promise.resolve().then(fn);
    if (options.timeoutMs && options.timeoutMs > 0) {
      body = withTimeout(body, options.timeoutMs, `Case "${baseName}" exceeded ${options.timeoutMs}ms`);
    }
    await body;
    return {
      name: baseName,
      success: true,
      errors: [],
      warnings: [],
      stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: performance.now() - startTime,
    };
  } catch (error) {
    return {
      name: baseName,
      success: false,
      errors: [(error as Error).message],
      warnings: [],
      stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: performance.now() - startTime,
    };
  }
}

export interface ParameterizedCase<TParams> {
  /** Case name */
  name: string;
  /** Case parameters passed to the runner */
  params: TParams;
}

export interface ParameterizeOptions {
  /** Timeout in milliseconds (0 disables) */
  timeoutMs?: number;
  /** Skip every generated case */
  skip?: boolean;
}

/**
 * Run the same test body against a table of parameter sets.
 *
 * Each generated case is named `<suiteName> › <caseName> [case <index>]` so
 * failures can be traced back to the exact parameters that caused them.
 */
export async function parameterize<TParams>(
  suiteName: string,
  cases: ParameterizedCase<TParams>[],
  run: (params: TParams, index: number) => void | Promise<void>,
  options: ParameterizeOptions = {}
): Promise<ModuleTestResult[]> {
  const results: ModuleTestResult[] = [];
  for (let index = 0; index < cases.length; index++) {
    const item = cases[index];
    if (!item) continue;
    const name = `${suiteName} › ${item.name} [case ${index}]`;
    results.push(await runCase(name, () => run(item.params, index), {
      timeoutMs: options.timeoutMs,
      skip: options.skip,
    }));
  }
  return results;
}

// ============================================================================
// Before / After Hooks
// ============================================================================

export interface ModuleTestCase {
  /** Case name */
  name: string;
  /** Case body */
  fn: () => void | Promise<void>;
  /** Skip this case */
  skip?: boolean;
}

export interface ModuleTestRunStats {
  /** Number of passing results */
  passed: number;
  /** Number of failing results */
  failed: number;
  /** Number of skipped results */
  skipped: number;
  /** Aggregated duration in milliseconds */
  durationMs: number;
}

export interface ModuleTestSuiteOptions {
  /** Timeout applied to every case in milliseconds (0 disables) */
  timeoutMs?: number;
  /** Skip every registered case */
  skip?: boolean;
}

export interface ModuleTestSuiteResult {
  /** Suite name */
  name: string;
  /** Individual case results */
  results: ModuleTestResult[];
  /** Aggregated statistics */
  stats: ModuleTestRunStats;
}

/**
 * A lightweight suite with `beforeEach`/`afterEach` lifecycle hooks, mirroring
 * the behavior of xUnit style `describe` blocks.
 */
export class ModuleTestSuite {
  private readonly name: string;
  private readonly options: ModuleTestSuiteOptions;
  private readonly beforeHooks: Array<() => void | Promise<void>> = [];
  private readonly afterHooks: Array<() => void | Promise<void>> = [];
  private readonly cases: ModuleTestCase[] = [];

  constructor(name: string, options: ModuleTestSuiteOptions = {}) {
    this.name = name;
    this.options = { timeoutMs: 0, skip: false, ...options };
  }

  /** Register a hook that runs before every case */
  beforeEach(hook: () => void | Promise<void>): this {
    this.beforeHooks.push(hook);
    return this;
  }

  /** Register a hook that runs after every case */
  afterEach(hook: () => void | Promise<void>): this {
    this.afterHooks.push(hook);
    return this;
  }

  /** Register a test case */
  it(name: string, fn: () => void | Promise<void>): this {
    this.cases.push({ name, fn });
    return this;
  }

  /** Register a case that is always skipped */
  skip(name: string, fn?: () => void | Promise<void>): this {
    this.cases.push({ name, fn: fn ?? (() => undefined), skip: true });
    return this;
  }

  /** Run every registered case with hooks applied */
  async run(): Promise<ModuleTestSuiteResult> {
    const results: ModuleTestResult[] = [];
    for (const testCase of this.cases) {
      results.push(await this.runOne(testCase));
    }
    return {
      name: this.name,
      results,
      stats: {
        passed: results.filter((r) => (r.passed ?? 0) > 0).length,
        failed: results.filter((r) => (r.failed ?? 0) > 0).length,
        skipped: results.filter((r) => (r.skipped ?? 0) > 0).length,
        durationMs: results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
      },
    };
  }

  /** Run a single case with before/after hooks */
  async runOne(testCase: ModuleTestCase): Promise<ModuleTestResult> {
    const startTime = performance.now();
    const baseName = `${this.name} › ${testCase.name}`;

    if (testCase.skip || this.options.skip) {
      for (const hook of this.beforeHooks) {
        try {
          await hook();
        } catch {
          // Hook errors do not fail a skipped case
        }
      }
      return {
        name: baseName,
        success: true,
        errors: [],
        warnings: [],
        stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
        passed: 0,
        failed: 0,
        skipped: 1,
        durationMs: performance.now() - startTime,
      };
    }

    let error: Error | undefined;
    try {
      for (const hook of this.beforeHooks) {
        await hook();
      }
      let body: Promise<void> = Promise.resolve().then(() => testCase.fn());
      if (this.options.timeoutMs && this.options.timeoutMs > 0) {
        body = withTimeout(body, this.options.timeoutMs, `Case "${baseName}" exceeded ${this.options.timeoutMs}ms`);
      }
      await body;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }

    try {
      for (const hook of this.afterHooks) {
        await hook();
      }
    } catch (err) {
      if (!error) error = err instanceof Error ? err : new Error(String(err));
    }

    return error
      ? {
          name: baseName,
          success: false,
          errors: [error.message],
          warnings: [],
          stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
          passed: 0,
          failed: 1,
          skipped: 0,
          durationMs: performance.now() - startTime,
        }
      : {
          name: baseName,
          success: true,
          errors: [],
          warnings: [],
          stats: { parseTimeMs: 0, validateTimeMs: 0, sectionCount: 0, codeBlockCount: 0 },
          passed: 1,
          failed: 0,
          skipped: 0,
          durationMs: performance.now() - startTime,
        };
  }

  /** Aggregate statistics for the registered (not yet run) cases */
  summary(): ModuleTestRunStats & { total: number } {
    const skipped = this.cases.filter((c) => c.skip || this.options.skip).length;
    return {
      total: this.cases.length,
      passed: this.cases.length - skipped,
      failed: 0,
      skipped,
      durationMs: 0,
    };
  }
}

/** Factory shorthand for building a suite */
export function createModuleSuite(name: string, options?: ModuleTestSuiteOptions): ModuleTestSuite {
  return new ModuleTestSuite(name, options);
}

/** Convenience wrapper for running a suite */
export async function runModuleSuite(suite: ModuleTestSuite): Promise<ModuleTestSuiteResult> {
  return suite.run();
}

// ============================================================================
// Summary + Reporting
// ============================================================================

export interface ModuleTestSummary {
  /** Total results */
  total: number;
  /** Passing results */
  passed: number;
  /** Failing results */
  failed: number;
  /** Skipped results */
  skipped: number;
  /** Aggregate duration in milliseconds */
  durationMs: number;
}

/**
 * Aggregate a list of results into a compact summary. Skips are detected from
 * the `skipped` field; anything else falls back to the `success` flag.
 */
export function moduleTestSummary(results: ModuleTestResult[]): ModuleTestSummary {
  const summary: ModuleTestSummary = { total: results.length, passed: 0, failed: 0, skipped: 0, durationMs: 0 };
  for (const result of results) {
    summary.durationMs += result.durationMs ?? 0;
    if ((result.skipped ?? 0) > 0) summary.skipped++;
    else if (result.success) summary.passed++;
    else summary.failed++;
  }
  return summary;
}

export interface ModuleTestReporterOptions {
  /** Output sink; defaults to `console.log` */
  stream?: { write(line: string): void };
  /** Include warnings in each rendered result */
  showWarnings?: boolean;
  /** Include per-result statistics */
  showStats?: boolean;
}

/**
 * Renders `ModuleTestResult` lists into a human readable report and writes it
 * to a stream (console by default).
 */
export class ModuleTestReporter {
  private readonly options: ModuleTestReporterOptions;

  constructor(options: ModuleTestReporterOptions = {}) {
    this.options = {
      stream: { write: (line: string) => console.log(line) },
      showWarnings: true,
      showStats: true,
      ...options,
    };
  }

  /** Build the report text without writing anywhere */
  render(results: ModuleTestResult[]): string {
    const lines: string[] = [];
    lines.push('MAM Module Test Report');
    lines.push('='.repeat(40));

    for (const result of results) {
      const status = (result.skipped ?? 0) > 0 ? 'SKIP' : result.success ? 'PASS' : 'FAIL';
      const time = (result.durationMs ?? 0).toFixed(1);
      lines.push(`[${status}] ${result.name} (${time}ms)`);

      if (this.options.showStats) {
        lines.push(`       passed=${result.passed ?? 0} failed=${result.failed ?? 0} skipped=${result.skipped ?? 0}`);
      }
      if (this.options.showWarnings) {
        for (const warning of result.warnings) {
          lines.push(`       warning: ${warning}`);
        }
      }
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          lines.push(`       error: ${error}`);
        }
      }
    }

    const summary = moduleTestSummary(results);
    lines.push('='.repeat(40));
    lines.push(
      `Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}  Skipped: ${summary.skipped}  (${summary.durationMs.toFixed(1)}ms)`
    );
    return lines.join('\n');
  }

  /** Render and write the report to the configured stream */
  report(results: ModuleTestResult[], options?: ModuleTestReporterOptions): void {
    const stream = options?.stream ?? this.options.stream;
    stream.write(this.render(results));
  }
}