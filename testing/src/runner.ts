/**
 * MAM Test Runner
 * 
 * Runs test suites and individual test cases.
 */

import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseMAM } from '@mam/parser';

// ============================================================================
// Types
// ============================================================================

export interface TestConfig {
  /** Test directory */
  dir: string;
  /** Test pattern (glob) */
  pattern?: string;
  /** Verbose output */
  verbose?: boolean;
  /** Timeout per test */
  timeout?: number;
  /** Parallel execution */
  parallel?: boolean;
  /** Maximum number of suites run concurrently (0 = unlimited) */
  concurrency?: number;
  /** Only run suites/tests whose name matches this pattern */
  filter?: string | RegExp;
  /** Reporter hooks for observing the run lifecycle */
  reporter?: TestRunnerReporter;
  /** Number of retries for failing suites */
  retry?: number;
  /** Suite execution order */
  order?: TestOrder;
}

export interface TestResult {
  /** Overall success */
  success: boolean;
  /** Test suites */
  suites: TestSuite[];
  /** Summary */
  summary: TestSummary;
  /** Total time */
  timeMs: number;
}

export interface TestSuite {
  /** Suite name */
  name: string;
  /** Suite file */
  file: string;
  /** Test cases */
  cases: TestCase[];
  /** Suite success */
  success: boolean;
  /** Suite time */
  timeMs: number;
}

export interface TestCase {
  /** Test name */
  name: string;
  /** Test type */
  type: 'parse' | 'validate' | 'compile' | 'execute' | 'snapshot' | 'custom';
  /** Test status */
  status: 'pass' | 'fail' | 'skip';
  /** Error message if failed */
  error?: string;
  /** Expected value */
  expected?: unknown;
  /** Actual value */
  actual?: unknown;
  /** Test time */
  timeMs: number;
}

export interface TestSummary {
  /** Total tests */
  total: number;
  /** Passed tests */
  passed: number;
  /** Failed tests */
  failed: number;
  /** Skipped tests */
  skipped: number;
}

// ============================================================================
// Test Runner
// ============================================================================

export class TestRunner {
  private config: TestConfig;
  private startTime: number = 0;

  constructor(config: TestConfig) {
    this.config = {
      pattern: '*.test.mam.md',
      verbose: false,
      timeout: 30000,
      parallel: false,
      concurrency: 1,
      retry: 0,
      order: 'declared',
      ...config,
    };
  }

  /**
   * Run all tests honoring the configured order, filter, concurrency and
   * retry settings. Defaults preserve the historical sequential behavior.
   */
  async run(): Promise<TestResult> {
    this.startTime = performance.now();
    const suites: TestSuite[] = [];

    try {
      const testFiles = await this.prepareFiles();
      const executed = await this.runFilesWithConcurrency(testFiles, this.config.concurrency ?? 1);
      suites.push(...executed);
    } catch (error) {
      console.error('Test runner error:', error);
    }

    const summary = this.calculateSummary(suites);

    const result: TestResult = {
      success: summary.failed === 0,
      suites,
      summary,
      timeMs: performance.now() - this.startTime,
    };

    this.config.reporter?.onDone?.(result);
    return result;
  }

  /**
   * Run every discovered test file concurrently. Equivalent to `run()` with
   * `concurrency` set to the number of test files.
   */
  async runAll(): Promise<TestResult> {
    this.startTime = performance.now();
    const suites: TestSuite[] = [];

    try {
      const testFiles = await this.prepareFiles();
      const executed = await this.runFilesWithConcurrency(testFiles, testFiles.length);
      suites.push(...executed);
    } catch (error) {
      console.error('Test runner error:', error);
    }

    const summary = this.calculateSummary(suites);

    const result: TestResult = {
      success: summary.failed === 0,
      suites,
      summary,
      timeMs: performance.now() - this.startTime,
    };

    this.config.reporter?.onDone?.(result);
    return result;
  }

  /**
   * Run a single test file
   */
  async runTestFile(file: string): Promise<TestSuite> {
    const startTime = performance.now();
    const cases: TestCase[] = [];

    try {
      const content = await readFile(file, 'utf-8');
      const result = parseMAM(content, { source: file });

      // Parse test
      cases.push({
        name: 'Parse module',
        type: 'parse',
        status: result.errors.length === 0 ? 'pass' : 'fail',
        error: result.errors.length > 0 ? result.errors[0].message : undefined,
        timeMs: 0,
      });

      // Validate test
      if (result.ast.frontmatter) {
        const hasRequired = result.ast.frontmatter.data.id && 
                           result.ast.frontmatter.data.version &&
                           result.ast.frontmatter.data.name;
        cases.push({
          name: 'Validate front matter',
          type: 'validate',
          status: hasRequired ? 'pass' : 'fail',
          error: hasRequired ? undefined : 'Missing required fields',
          timeMs: 0,
        });
      }

      // Section tests
      const hasPurpose = result.ast.sections.some(s => s.name === 'Purpose');
      cases.push({
        name: 'Has Purpose section',
        type: 'validate',
        status: hasPurpose ? 'pass' : 'fail',
        error: hasPurpose ? undefined : 'Missing Purpose section',
        timeMs: 0,
      });

    } catch (error) {
      cases.push({
        name: 'File loading',
        type: 'parse',
        status: 'fail',
        error: (error as Error).message,
        timeMs: 0,
      });
    }

    const success = cases.every(c => c.status === 'pass');

    return {
      name: file.split('/').pop() || file,
      file,
      cases,
      success,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Run a specific test case
   */
  async runTestCase(test: () => Promise<void> | void, name: string): Promise<TestCase> {
    const startTime = performance.now();

    try {
      await test();
      return {
        name,
        type: 'custom',
        status: 'pass',
        timeMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        name,
        type: 'custom',
        status: 'fail',
        error: (error as Error).message,
        timeMs: performance.now() - startTime,
      };
    }
  }

  private async findTestFiles(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const files: string[] = [];

    try {
      const entries = await readdir(this.config.dir);
      for (const entry of entries) {
        if (entry.endsWith('.test.mam.md') || entry.endsWith('.test.ts')) {
          files.push(join(this.config.dir, entry));
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return files;
  }

  private calculateSummary(suites: TestSuite[]): TestSummary {
    let total = 0;
    let passed = 0;
    let failed = 0;
    let skipped = 0;

    for (const suite of suites) {
      for (const testCase of suite.cases) {
        total++;
        if (testCase.status === 'pass') passed++;
        else if (testCase.status === 'fail') failed++;
        else skipped++;
      }
    }

    return { total, passed, failed, skipped };
  }

  // ==========================================================================
  // Ordering, Filtering, Concurrency
  // ==========================================================================

  /**
   * Discover, order, and filter the test files before execution.
   */
  private async prepareFiles(): Promise<string[]> {
    const files = await this.findTestFiles();
    const ordered = this.orderFiles(files);
    if (!this.config.filter) return ordered;
    return ordered.filter((file) => this.matchesFilter(file));
  }

  /**
   * Apply the configured execution order to a list of files.
   */
  private orderFiles(files: string[]): string[] {
    switch (this.config.order) {
      case 'random':
        return this.shuffle(files);
      case 'reverse':
        return [...files].reverse();
      default:
        return files;
    }
  }

  /**
   * Fisher-Yates shuffle returning a new array.
   */
  private shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
    }
    return copy;
  }

  /**
   * Match a suite/test name against the configured filter. A string filter is
   * treated as a substring; a RegExp filter is tested directly.
   */
  private matchesFilter(name: string): boolean {
    const filter = this.config.filter;
    if (!filter) return true;
    if (filter instanceof RegExp) return filter.test(name);
    return name.includes(filter);
  }

  /**
   * Run the given files with a bounded worker pool. Suite ordering is
   * preserved even when suites complete out of order.
   */
  private async runFilesWithConcurrency(files: string[], concurrency: number): Promise<TestSuite[]> {
    const suites: TestSuite[] = new Array<TestSuite>(files.length);
    if (files.length === 0) return suites;
    const limit = Math.max(1, concurrency);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < files.length) {
        const index = next++;
        const file = files[index]!;
        const suiteName = file.split(/[\\/]/).pop() || file;

        this.config.reporter?.onSuiteStart?.({ name: suiteName, file });
        const suite = await this.runTestFileWithRetry(file);
        const filtered = this.applyFilterToSuite(suite);
        suites[index] = filtered;

        for (const testCase of filtered.cases) {
          this.config.reporter?.onTestStart?.({ name: testCase.name, type: testCase.type, suite: suiteName });
          this.config.reporter?.onTestEnd?.(testCase);
        }
      }
    };

    const workers: Promise<void>[] = [];
    for (let i = 0; i < limit; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return suites;
  }

  /**
   * Run a test file, retrying the whole file up to `retry` times when the
   * suite fails.
   */
  private async runTestFileWithRetry(file: string): Promise<TestSuite> {
    const retries = Math.max(0, this.config.retry ?? 0);
    let suite = await this.runTestFile(file);
    let attempt = 0;
    while (!suite.success && attempt < retries) {
      attempt++;
      suite = await this.runTestFile(file);
    }
    return suite;
  }

  /**
   * Optionally drop test cases that do not match the configured filter.
   */
  private applyFilterToSuite(suite: TestSuite): TestSuite {
    if (!this.config.filter) return suite;
    const cases = suite.cases.filter((c) => this.matchesFilter(c.name));
    return {
      ...suite,
      cases,
      success: cases.length > 0 && cases.every((c) => c.status === 'pass'),
    };
  }
}

// ============================================================================
// Ordering + Reporter Types
// ============================================================================

/** Supported suite execution orders */
export type TestOrder = 'declared' | 'random' | 'reverse';

/**
 * Callback hooks invoked during a test run. All hooks are optional.
 */
export interface TestRunnerReporter {
  /** Called before a suite begins executing */
  onSuiteStart?(suite: { name: string; file: string }): void;
  /** Called before a test case begins executing */
  onTestStart?(test: { name: string; type: TestCase['type']; suite: string }): void;
  /** Called after a test case finishes */
  onTestEnd?(test: TestCase): void;
  /** Called once the whole run is complete */
  onDone?(result: TestResult): void;
}

// ============================================================================
// Summary Builder
// ============================================================================

export interface TestRunSummary {
  /** Overall success */
  success: boolean;
  /** Total wall-clock time in milliseconds */
  timeMs: number;
  /** Suite breakdown */
  suites: TestSuite[];
  /** Aggregate totals */
  summary: TestSummary;
  /** Per-suite duration keyed by suite name */
  durations: Record<string, number>;
}

/**
 * Incrementally collects suites and builds aggregate summaries. Useful for
 * streaming reporters that want to accumulate results as suites finish.
 */
export class TestRunSummaryBuilder {
  private suites: TestSuite[] = [];
  private startedAt: number = 0;

  /** Begin a fresh collection window */
  start(): this {
    this.startedAt = performance.now();
    this.suites = [];
    return this;
  }

  /** Record a finished suite */
  addSuite(suite: TestSuite): this {
    this.suites.push(suite);
    return this;
  }

  /** Aggregate totals across all recorded suites */
  getSummary(): TestSummary {
    return this.calculate(this.suites);
  }

  /** Build a fully shaped run summary */
  build(): TestRunSummary {
    const summary = this.calculate(this.suites);
    const durations: Record<string, number> = {};
    for (const suite of this.suites) {
      durations[suite.name] = suite.timeMs;
    }
    return {
      success: summary.failed === 0,
      timeMs: performance.now() - this.startedAt,
      suites: this.suites,
      summary,
      durations,
    };
  }

  /** Print the summary to the console */
  report(options: { showSuites?: boolean } = {}): void {
    const built = this.build();
    console.log(formatTestResults(built, options));
  }

  private calculate(suites: TestSuite[]): TestSummary {
    const summary: TestSummary = { total: 0, passed: 0, failed: 0, skipped: 0 };
    for (const suite of suites) {
      for (const testCase of suite.cases) {
        summary.total++;
        if (testCase.status === 'pass') summary.passed++;
        else if (testCase.status === 'fail') summary.failed++;
        else summary.skipped++;
      }
    }
    return summary;
  }
}

// ============================================================================
// Result Formatting
// ============================================================================

export interface FormatTestResultsOptions {
  /** Include a per-suite, per-case breakdown */
  showSuites?: boolean;
  /** Include failing test details */
  showFailures?: boolean;
}

/**
 * Render a `TestResult` into a human readable multi-line report.
 */
export function formatTestResults(result: TestResult, options: FormatTestResultsOptions = {}): string {
  const lines: string[] = [];
  lines.push(`Test run ${result.success ? 'PASSED' : 'FAILED'} in ${result.timeMs.toFixed(1)}ms`);
  lines.push(`  Suites: ${result.suites.length}`);
  lines.push(
    `  Tests:  ${result.summary.total}  (passed=${result.summary.passed}, failed=${result.summary.failed}, skipped=${result.summary.skipped})`
  );

  if (options.showSuites) {
    lines.push('');
    lines.push('Suites:');
    for (const suite of result.suites) {
      const marker = suite.success ? 'PASS' : 'FAIL';
      lines.push(`  [${marker}] ${suite.name} (${suite.timeMs.toFixed(1)}ms) ${suite.cases.length} cases`);
      for (const testCase of suite.cases) {
        lines.push(`      ${testCase.status.toUpperCase().padEnd(6)} ${testCase.name} (${testCase.timeMs.toFixed(1)}ms)`);
      }
    }
  }

  if (options.showFailures) {
    const failures = result.suites.flatMap((s) => s.cases.filter((c) => c.status === 'fail'));
    if (failures.length > 0) {
      lines.push('');
      lines.push('Failures:');
      for (const failure of failures) {
        lines.push(`  FAIL ${failure.name}: ${failure.error ?? 'unknown error'}`);
      }
    }
  }

  return lines.join('\n');
}