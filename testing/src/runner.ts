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
      ...config,
    };
  }

  /**
   * Run all tests
   */
  async run(): Promise<TestResult> {
    this.startTime = performance.now();
    const suites: TestSuite[] = [];

    try {
      // Find test files
      const testFiles = await this.findTestFiles();

      // Run each test file
      for (const file of testFiles) {
        const suite = await this.runTestFile(file);
        suites.push(suite);
      }
    } catch (error) {
      console.error('Test runner error:', error);
    }

    const summary = this.calculateSummary(suites);

    return {
      success: summary.failed === 0,
      suites,
      summary,
      timeMs: performance.now() - this.startTime,
    };
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
}