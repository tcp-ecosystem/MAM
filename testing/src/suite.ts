/**
 * MAM Test Suite Builder
 *
 * Fluent builder for constructing test suites and test cases using a
 * describe/it style API with support for `only`, `skip`, and `todo`
 * modifiers. Produces {@link TestSuite} objects compatible with the
 * {@link TestRunner} result types.
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestSuite, TestCase } from './runner.js';

// ============================================================================
// Types
// ============================================================================

/** Modifier applied to a registered test */
export type TestMode = 'normal' | 'only' | 'skip' | 'todo';

/** A single test registered on the builder */
export interface RegisteredTest {
  /** Test name */
  name: string;
  /** Test body (omitted for `todo` tests) */
  fn?: () => void | Promise<void>;
  /** Modifier applied to the test */
  mode: TestMode;
}

/** A suite under construction */
export interface RegisteredSuite {
  /** Suite name */
  name: string;
  /** Tests registered in the suite */
  tests: RegisteredTest[];
}

/** Options for {@link TestSuiteBuilder.collect} */
export interface CollectOptions {
  /** File basename suffixes to discover (default `['.test.ts', '.test.mam.md']`) */
  patterns?: string[];
  /** Populate each discovered suite's cases from the file */
  onFile?: (file: string) => TestCase[];
  /** Whether to recurse into subdirectories (default true) */
  recursive?: boolean;
}

// ============================================================================
// Test Suite Builder
// ============================================================================

export class TestSuiteBuilder {
  private suites: RegisteredSuite[] = [];
  private current: RegisteredSuite | null = null;

  // --------------------------------------------------------------------------
  // Registration
  // --------------------------------------------------------------------------

  /**
   * Start (or switch to) a suite with the given name
   */
  suite(name: string): this {
    const suite: RegisteredSuite = { name, tests: [] };
    this.suites.push(suite);
    this.current = suite;
    return this;
  }

  /**
   * describe/it wrapper: opens a suite and optionally runs a callback that
   * registers tests against it.
   */
  describe(name: string, fn?: (builder: this) => void): this {
    this.suite(name);
    if (fn) {
      fn(this);
    }
    return this;
  }

  /**
   * Register a normal test on the current suite
   */
  test(name: string, fn: () => void | Promise<void>): this {
    return this.addTest(name, fn, 'normal');
  }

  /**
   * `it` is an alias for {@link test}
   */
  it(name: string, fn: () => void | Promise<void>): this {
    return this.test(name, fn);
  }

  /**
   * Register a test that runs exclusively: when any `only` test is present,
   * non-`only` tests are skipped during {@link build}.
   */
  only(name: string, fn: () => void | Promise<void>): this {
    return this.addTest(name, fn, 'only');
  }

  /**
   * Register a test that is skipped during {@link build}
   */
  skip(name: string, fn: () => void | Promise<void>): this {
    return this.addTest(name, fn, 'skip');
  }

  /**
   * Register a placeholder test that is reported as skipped until implemented
   */
  todo(name: string): this {
    return this.addTest(name, undefined, 'todo');
  }

  private addTest(name: string, fn: (() => void | Promise<void>) | undefined, mode: TestMode): this {
    if (!this.current) {
      this.suite('default');
    }
    this.current!.tests.push({ name, fn, mode });
    return this;
  }

  // --------------------------------------------------------------------------
  // Building & execution
  // --------------------------------------------------------------------------

  /**
   * Build all registered suites. Executes each test body (unless skipped) and
   * produces {@link TestSuite} instances with per-case pass/fail/skip status.
   *
   * If any test is marked `only`, only those tests run; everything else is
   * reported as skipped.
   */
  async build(): Promise<TestSuite[]> {
    const hasOnly = this.suites.some((s) => s.tests.some((t) => t.mode === 'only'));
    const built: TestSuite[] = [];

    for (const registered of this.suites) {
      const cases: TestCase[] = [];
      const suiteStart = performance.now();

      for (const test of registered.tests) {
        const shouldSkip =
          test.mode === 'skip' || test.mode === 'todo' || (hasOnly && test.mode !== 'only');

        if (shouldSkip) {
          cases.push({ name: test.name, type: 'custom', status: 'skip', timeMs: 0 });
          continue;
        }

        cases.push(await this.executeTest(test));
      }

      built.push({
        name: registered.name,
        file: '',
        cases,
        success: cases.every((c) => c.status === 'pass'),
        timeMs: performance.now() - suiteStart,
      });
    }

    return built;
  }

  private async executeTest(test: RegisteredTest): Promise<TestCase> {
    const start = performance.now();
    try {
      await test.fn?.();
      return {
        name: test.name,
        type: 'custom',
        status: 'pass',
        timeMs: performance.now() - start,
      };
    } catch (error) {
      return {
        name: test.name,
        type: 'custom',
        status: 'fail',
        error: (error as Error).message,
        timeMs: performance.now() - start,
      };
    }
  }

  // --------------------------------------------------------------------------
  // Collection
  // --------------------------------------------------------------------------

  /**
   * Gather suites from one or more directories by discovering files whose
   * basenames match the configured patterns. If `onFile` is provided, each
   * discovered file is turned into a populated {@link TestCase} list;
   * otherwise suites are returned with empty case lists for later processing.
   */
  static async collect(dirs: string | string[], options?: CollectOptions): Promise<TestSuite[]> {
    const dirList = Array.isArray(dirs) ? dirs : [dirs];
    const patterns = options?.patterns ?? ['.test.ts', '.test.mam.md'];
    const recursive = options?.recursive ?? true;
    const suites: TestSuite[] = [];

    for (const dir of dirList) {
      const files = await listFiles(dir, recursive);
      for (const file of files) {
        if (!patterns.some((p) => file.endsWith(p))) {
          continue;
        }
        const cases = options?.onFile ? options.onFile(file) : [];
        suites.push({
          name: file.split(/[\\/]/).pop() ?? file,
          file,
          cases,
          success: cases.length === 0 || cases.every((c) => c.status === 'pass'),
          timeMs: 0,
        });
      }
    }

    return suites;
  }

  // --------------------------------------------------------------------------
  // State management
  // --------------------------------------------------------------------------

  /** Get all registered (unbuilt) suites */
  getSuites(): RegisteredSuite[] {
    return this.suites;
  }

  /** Reset all registered suites */
  clear(): void {
    this.suites = [];
    this.current = null;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Recursively list all files under a directory
 */
export async function listFiles(dir: string, recursive: boolean): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          results.push(...(await listFiles(full, recursive)));
        }
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  } catch {
    // Unreadable or missing directory: yield no files
  }
  return results;
}