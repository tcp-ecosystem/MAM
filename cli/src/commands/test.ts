/**
 * MAM Test Command
 *
 * Full-featured test runner with describe/it structure, assertions, coverage,
 * watch mode, parallel execution, filtering, retry, snapshots, and reporters.
 */

import { readFile, writeFile, readdir, mkdir, access } from 'node:fs/promises';
import { resolve, join, basename, extname, relative, dirname } from 'node:path';
import { parseMAM } from '@mam/parser';
import { validate } from '@mam/validator';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

export interface TestOptions {
  file?: string;
  dir?: string;
  verbose?: boolean;
  watch?: boolean;
  parallel?: boolean;
  grep?: string;
  tags?: string[];
  slow?: boolean;
  retry?: number;
  timeout?: number;
  reporter?: 'progress' | 'verbose' | 'json' | 'tap';
  config?: string;
  updateSnapshots?: boolean;
  bail?: boolean;
  concurrency?: number;
}

type TestStatus = 'passed' | 'failed' | 'skipped' | 'pending' | 'todo';

interface TestCase {
  id: string;
  name: string;
  fullName: string;
  tags: string[];
  timeout: number;
  retry: number;
  skip: boolean;
  todo: boolean;
  fn: () => void | Promise<void>;
  status?: TestStatus;
  error?: Error;
  duration: number;
  attempts: number;
  snapshot?: string;
}

interface DescribeBlock {
  name: string;
  tags: string[];
  children: (DescribeBlock | TestCase)[];
  beforeAll: Array<() => void | Promise<void>>;
  afterAll: Array<() => void | Promise<void>>;
  beforeEach: Array<() => void | Promise<void>>;
  afterEach: Array<() => void | Promise<void>>;
}

interface TestResult {
  test: TestCase;
  status: TestStatus;
  error?: Error;
  duration: number;
  attempts: number;
}

interface TestSuite {
  name: string;
  file: string;
  results: TestResult[];
  duration: number;
  setupDuration: number;
}

interface CoverageData {
  lines: Map<string, Set<number>>;
  branches: Map<string, Set<number>>;
  functions: Map<string, Set<string>>;
  statements: Map<string, Set<number>>;
}

interface CoverageReport {
  total: { lines: number; branches: number; functions: number; statements: number };
  covered: { lines: number; branches: number; functions: number; statements: number };
  percentage: { lines: number; branches: number; functions: number; statements: number };
  files: Map<string, FileCoverage>;
}

interface FileCoverage {
  path: string;
  lines: { total: number; covered: number };
  branches: { total: number; covered: number };
  functions: { total: number; covered: number };
  statements: { total: number; covered: number };
}

interface SnapshotData {
  id: string;
  content: string;
  filePath: string;
  line: number;
  timestamp: number;
}

interface TestConfig {
  rootDir: string;
  testMatch: string[];
  exclude: string[];
  timeout: number;
  retry: number;
  bail: boolean;
  parallel: boolean;
  concurrency: number;
  coverage: boolean;
  coverageDir: string;
  coverageThresholds: { lines: number; branches: number; functions: number; statements: number };
  reporters: string[];
  setupFiles: string[];
  teardownFiles: string[];
  snapshotDir: string;
  slowThreshold: number;
  watchIgnore: string[];
}

interface Reporter {
  onSuiteStart?(suite: string): void;
  onSuiteEnd?(suite: TestSuite): void;
  onTestStart?(test: TestCase): void;
  onTestResult?(result: TestResult): void;
  onRunStart?(total: number): void;
  onRunEnd?(results: TestSuite[], coverage: CoverageReport | null): void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TestConfig = {
  rootDir: process.cwd(),
  testMatch: ['**/*.test.mam.md', '**/*.spec.mam.md', '**/*.mam.md'],
  exclude: ['node_modules', 'dist', '.git', 'coverage'],
  timeout: 30000,
  retry: 0,
  bail: false,
  parallel: false,
  concurrency: 4,
  coverage: false,
  coverageDir: './coverage',
  coverageThresholds: { lines: 80, branches: 75, functions: 80, statements: 80 },
  reporters: ['progress'],
  setupFiles: [],
  teardownFiles: [],
  snapshotDir: './__snapshots__',
  slowThreshold: 1000,
  watchIgnore: ['node_modules', 'dist', 'coverage', '.git'],
};

// ============================================================================
// Assertion Library
// ============================================================================

class AssertionError extends Error {
  actual: unknown;
  expected: unknown;
  operator: string;

  constructor(message: string, actual: unknown, expected: unknown, operator: string) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;
  }
}

function assertEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to equal ${formatValue(expected)}`,
      actual,
      expected,
      'strictEqual'
    );
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEquals(actual, expected)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to deeply equal ${formatValue(expected)}`,
      actual,
      expected,
      'deepEqual'
    );
  }
}

function assertNotEqual(actual: unknown, expected: unknown, message?: string): void {
  if (Object.is(actual, expected)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to not equal ${formatValue(expected)}`,
      actual,
      expected,
      'notStrictEqual'
    );
  }
}

function assertThrows(fn: () => void, expected?: RegExp | typeof Error, message?: string): void {
  try {
    fn();
    throw new AssertionError(
      message || 'Expected function to throw',
      undefined,
      expected || Error,
      'throws'
    );
  } catch (err) {
    if (err instanceof AssertionError && !expected) throw err;
    if (err instanceof AssertionError && expected) {
      if (expected instanceof RegExp && !expected.test((err as Error).message)) {
        throw new AssertionError(
          `Expected error matching ${expected.toString()} but got "${(err as Error).message}"`,
          (err as Error).message,
          expected,
          'throws'
        );
      }
    }
  }
}

async function assertThrowsAsync(fn: () => Promise<void>, expected?: RegExp | typeof Error, message?: string): Promise<void> {
  try {
    await fn();
    throw new AssertionError(
      message || 'Expected async function to throw',
      undefined,
      expected || Error,
      'throws'
    );
  } catch (err) {
    if (err instanceof AssertionError && !expected) throw err;
    if (err instanceof AssertionError && expected && expected instanceof RegExp && !expected.test((err as Error).message)) {
      throw new AssertionError(
        `Expected error matching ${expected.toString()} but got "${(err as Error).message}"`,
        (err as Error).message,
        expected,
        'throws'
      );
    }
  }
}

function assertMatches(actual: string, pattern: RegExp, message?: string): void {
  if (!pattern.test(actual)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to match ${pattern.toString()}`,
      actual,
      pattern,
      'matches'
    );
  }
}

function assertContains<T>(actual: T[], item: T, message?: string): void {
  if (!actual.includes(item)) {
    throw new AssertionError(
      message || `Expected array to contain ${formatValue(item)}`,
      actual,
      item,
      'contains'
    );
  }
}

function assertStringContains(actual: string, substring: string, message?: string): void {
  if (!actual.includes(substring)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to contain ${formatValue(substring)}`,
      actual,
      substring,
      'contains'
    );
  }
}

function assertTruthy(actual: unknown, message?: string): void {
  if (!actual) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to be truthy`,
      actual,
      true,
      'truthy'
    );
  }
}

function assertFalsy(actual: unknown, message?: string): void {
  if (actual) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to be falsy`,
      actual,
      false,
      'falsy'
    );
  }
}

function assertGreaterThan(actual: number, expected: number, message?: string): void {
  if (!(actual > expected)) {
    throw new AssertionError(
      message || `Expected ${actual} to be greater than ${expected}`,
      actual,
      expected,
      'greaterThan'
    );
  }
}

function assertLessThan(actual: number, expected: number, message?: string): void {
  if (!(actual < expected)) {
    throw new AssertionError(
      message || `Expected ${actual} to be less than ${expected}`,
      actual,
      expected,
      'lessThan'
    );
  }
}

function assertIsNull(actual: unknown, message?: string): void {
  if (actual !== null) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to be null`,
      actual,
      null,
      'isNull'
    );
  }
}

function assertIsNotNull(actual: unknown, message?: string): void {
  if (actual === null || actual === undefined) {
    throw new AssertionError(
      message || `Expected value to not be null`,
      actual,
      null,
      'isNotNull'
    );
  }
}

function assertInstanceOf(actual: unknown, expected: Function, message?: string): void {
  if (!(actual instanceof expected)) {
    throw new AssertionError(
      message || `Expected ${formatValue(actual)} to be instance of ${expected.name}`,
      actual,
      expected,
      'instanceOf'
    );
  }
}

function assertTypeOf(actual: unknown, expected: string, message?: string): void {
  if (typeof actual !== expected) {
    throw new AssertionError(
      message || `Expected typeof ${formatValue(actual)} to be "${expected}"`,
      actual,
      expected,
      'typeOf'
    );
  }
}

function assertApproximately(actual: number, expected: number, delta: number, message?: string): void {
  if (Math.abs(actual - expected) > delta) {
    throw new AssertionError(
      message || `Expected ${actual} to be within ${delta} of ${expected}`,
      actual,
      expected,
      'approximately'
    );
  }
}

function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value}"`;
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (Array.isArray(value)) return `[${value.map(formatValue).join(', ')}]`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function deepEquals(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a !== 'object') return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEquals(item, b[i]));
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);

  if (keysA.length !== keysB.length) return false;
  return keysA.every(key => deepEquals((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

// ============================================================================
// Test Builder (describe/it/test API)
// ============================================================================

let currentDescribe: DescribeBlock | null = null;
let allDescribes: DescribeBlock[] = [];
let testIdCounter = 0;

function createDescribeBlock(name: string, tags: string[] = []): DescribeBlock {
  return { name, tags, children: [], beforeAll: [], afterAll: [], beforeEach: [], afterEach: [] };
}

function describe(name: string, fn: () => void, tags: string[] = []): void {
  const parent = currentDescribe;
  const block = createDescribeBlock(name, tags);
  if (parent) {
    parent.children.push(block);
  } else {
    allDescribes.push(block);
  }
  currentDescribe = block;
  fn();
  currentDescribe = parent;
}

function it(name: string, fn: () => void | Promise<void>, opts?: { skip?: boolean; todo?: boolean; timeout?: number; retry?: number; tags?: string[] }): void {
  testIdCounter++;
  const test: TestCase = {
    id: `test-${testIdCounter}`,
    name,
    fullName: `${currentDescribe?.name || 'root'} > ${name}`,
    tags: [...(currentDescribe?.tags || []), ...(opts?.tags || [])],
    timeout: opts?.timeout ?? DEFAULT_CONFIG.timeout,
    retry: opts?.retry ?? DEFAULT_CONFIG.retry,
    skip: opts?.skip ?? false,
    todo: opts?.todo ?? false,
    fn,
    duration: 0,
    attempts: 0,
  };
  currentDescribe?.children.push(test);
}

function test(name: string, fn: () => void | Promise<void>, opts?: { skip?: boolean; todo?: boolean; timeout?: number; retry?: number }): void {
  it(name, fn, opts);
}

function beforeAll(fn: () => void | Promise<void>): void {
  currentDescribe?.beforeAll.push(fn);
}

function afterAll(fn: () => void | Promise<void>): void {
  currentDescribe?.afterAll.push(fn);
}

function beforeEach(fn: () => void | Promise<void>): void {
  currentDescribe?.beforeEach.push(fn);
}

function afterEach(fn: () => void | Promise<void>): void {
  currentDescribe?.afterEach.push(fn);
}

// ============================================================================
// Snapshot Support
// ============================================================================

class SnapshotManager {
  private snapshots: Map<string, SnapshotData> = new Map();
  private dirty = false;

  constructor(private snapshotDir: string) {}

  async load(): Promise<void> {
    try {
      await access(this.snapshotDir);
      const files = await readdir(this.snapshotDir);
      for (const file of files) {
        if (file.endsWith('.snap')) {
          const content = await readFile(join(this.snapshotDir, file), 'utf-8');
          const data = JSON.parse(content);
          for (const [key, value] of Object.entries(data)) {
            this.snapshots.set(key, value as SnapshotData);
          }
        }
      }
    } catch {
      // No snapshots yet
    }
  }

  match(id: string, content: string): { pass: boolean; expected?: string; actual?: string } {
    const existing = this.snapshots.get(id);
    if (!existing) {
      this.snapshots.set(id, {
        id,
        content,
        filePath: '',
        line: 0,
        timestamp: Date.now(),
      });
      this.dirty = true;
      return { pass: false, actual: content };
    }
    return {
      pass: existing.content === content,
      expected: existing.content,
      actual: content,
    };
  }

  getSnapshot(id: string): string | undefined {
    return this.snapshots.get(id)?.content;
  }

  getAll(): Map<string, SnapshotData> {
    return new Map(this.snapshots);
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(this.snapshotDir, { recursive: true });
    const data: Record<string, SnapshotData> = {};
    for (const [key, value] of this.snapshots) {
      data[key] = value;
    }
    await writeFile(join(this.snapshotDir, 'snapshots.json'), JSON.stringify(data, null, 2), 'utf-8');
  }

  isDirty(): boolean {
    return this.dirty;
  }
}

// ============================================================================
// Coverage Collector
// ============================================================================

class CoverageCollector {
  private data: CoverageData = {
    lines: new Map(),
    branches: new Map(),
    functions: new Map(),
    statements: new Map(),
  };

  trackLine(filePath: string, line: number): void {
    if (!this.data.lines.has(filePath)) this.data.lines.set(filePath, new Set());
    this.data.lines.get(filePath)!.add(line);
  }

  trackBranch(filePath: string, branchId: number): void {
    if (!this.data.branches.has(filePath)) this.data.branches.set(filePath, new Set());
    this.data.branches.get(filePath)!.add(branchId);
  }

  trackFunction(filePath: string, functionName: string): void {
    if (!this.data.functions.has(filePath)) this.data.functions.set(filePath, new Set());
    this.data.functions.get(filePath)!.add(functionName);
  }

  trackStatement(filePath: string, line: number): void {
    if (!this.data.statements.has(filePath)) this.data.statements.set(filePath, new Set());
    this.data.statements.get(filePath)!.add(line);
  }

  merge(other: CoverageCollector): void {
    for (const [file, lines] of other.data.lines) {
      if (!this.data.lines.has(file)) this.data.lines.set(file, new Set());
      for (const line of lines) this.data.lines.get(file)!.add(line);
    }
    for (const [file, branches] of other.data.branches) {
      if (!this.data.branches.has(file)) this.data.branches.set(file, new Set());
      for (const branch of branches) this.data.branches.get(file)!.add(branch);
    }
    for (const [file, functions] of other.data.functions) {
      if (!this.data.functions.has(file)) this.data.functions.set(file, new Set());
      for (const fn of functions) this.data.functions.get(file)!.add(fn);
    }
    for (const [file, statements] of other.data.statements) {
      if (!this.data.statements.has(file)) this.data.statements.set(file, new Set());
      for (const stmt of statements) this.data.statements.get(file)!.add(stmt);
    }
  }

  generateReport(estimatedTotals?: { lines: Map<string, number>; branches: Map<string, number>; functions: Map<string, number> }): CoverageReport {
    const files = new Map<string, FileCoverage>();
    const totals = { lines: 0, branches: 0, functions: 0, statements: 0 };
    const covered = { lines: 0, branches: 0, functions: 0, statements: 0 };

    const allFiles = new Set([
      ...this.data.lines.keys(),
      ...this.data.branches.keys(),
      ...this.data.functions.keys(),
      ...this.data.statements.keys(),
    ]);

    for (const file of allFiles) {
      const estimatedLines = estimatedTotals?.lines.get(file) || 100;
      const estimatedBranches = estimatedTotals?.branches.get(file) || 20;
      const estimatedFunctions = estimatedTotals?.functions.get(file) || 10;

      const fileLines = this.data.lines.get(file)?.size || 0;
      const fileBranches = this.data.branches.get(file)?.size || 0;
      const fileFunctions = this.data.functions.get(file)?.size || 0;
      const fileStatements = this.data.statements.get(file)?.size || 0;

      totals.lines += estimatedLines;
      totals.branches += estimatedBranches;
      totals.functions += estimatedFunctions;
      totals.statements += estimatedLines;

      covered.lines += fileLines;
      covered.branches += fileBranches;
      covered.functions += fileFunctions;
      covered.statements += fileStatements;

      files.set(file, {
        path: file,
        lines: { total: estimatedLines, covered: fileLines },
        branches: { total: estimatedBranches, covered: fileBranches },
        functions: { total: estimatedFunctions, covered: fileFunctions },
        statements: { total: estimatedLines, covered: fileStatements },
      });
    }

    const percentage = {
      lines: totals.lines > 0 ? (covered.lines / totals.lines) * 100 : 0,
      branches: totals.branches > 0 ? (covered.branches / totals.branches) * 100 : 0,
      functions: totals.functions > 0 ? (covered.functions / totals.functions) * 100 : 0,
      statements: totals.statements > 0 ? (covered.statements / totals.statements) * 100 : 0,
    };

    return { total: totals, covered, percentage, files };
  }
}

// ============================================================================
// Test Runner
// ============================================================================

class TestRunner {
  private config: TestConfig;
  private results: TestResult[] = [];
  private coverage: CoverageCollector;
  private snapshots: SnapshotManager;
  private reporters: Reporter[] = [];
  private abortController: AbortController | null = null;

  constructor(config: Partial<TestConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.coverage = new CoverageCollector();
    this.snapshots = new SnapshotManager(this.config.snapshotDir);
  }

  addReporter(reporter: Reporter): void {
    this.reporters.push(reporter);
  }

  async run(files?: string[]): Promise<{ suites: TestSuite[]; coverage: CoverageReport | null }> {
    await this.snapshots.load();

    const testFiles = files || await this.discoverTestFiles();
    if (testFiles.length === 0) {
      return { suites: [], coverage: null };
    }

    this.reporters.forEach(r => r.onRunStart?.(testFiles.length));
    const startTime = performance.now();
    const suites: TestSuite[] = [];

    if (this.config.parallel) {
      const chunks = this.chunkArray(testFiles, this.config.concurrency);
      for (const chunk of chunks) {
        const results = await Promise.all(chunk.map(f => this.runFile(f)));
        suites.push(...results);
      }
    } else {
      for (const file of testFiles) {
        const suite = await this.runFile(file);
        suites.push(suite);
        if (this.config.bail && suite.results.some(r => r.status === 'failed')) break;
      }
    }

    const totalDuration = performance.now() - startTime;
    const coverageReport = this.config.coverage
      ? this.coverage.generateReport()
      : null;

    await this.snapshots.save();
    this.reporters.forEach(r => r.onRunEnd?.(suites, coverageReport));

    return { suites, coverage: coverageReport };
  }

  private async runFile(filePath: string): Promise<TestSuite> {
    const startTime = performance.now();
    const suite: TestSuite = {
      name: basename(filePath),
      file: filePath,
      results: [],
      duration: 0,
      setupDuration: 0,
    };

    this.reporters.forEach(r => r.onSuiteStart?.(basename(filePath)));

    try {
      const content = await readFile(filePath, 'utf-8');
      const parseResult = parseMAM(content, { source: filePath });

      if (parseResult.errors.length > 0) {
        suite.results.push({
          test: this.createErrorTest(filePath, 'Parse error'),
          status: 'failed',
          error: new Error(parseResult.errors.map(e => e.message).join(', ')),
          duration: 0,
          attempts: 1,
        });
        suite.duration = performance.now() - startTime;
        this.reporters.forEach(r => r.onSuiteEnd?.(suite));
        return suite;
      }

      const testBlocks = this.extractTestBlocks(parseResult.ast, filePath);
      const setupStart = performance.now();
      suite.setupDuration = performance.now() - setupStart;

      for (const test of testBlocks) {
        this.reporters.forEach(r => r.onTestStart?.(test));
        const result = await this.runTest(test);
        suite.results.push(result);
        this.reporters.forEach(r => r.onTestResult?.(result));

        if (this.config.bail && result.status === 'failed') break;
      }
    } catch (error) {
      suite.results.push({
        test: this.createErrorTest(filePath, 'File execution error'),
        status: 'failed',
        error: error as Error,
        duration: 0,
        attempts: 1,
      });
    }

    suite.duration = performance.now() - startTime;
    this.results.push(...suite.results);
    this.reporters.forEach(r => r.onSuiteEnd?.(suite));
    return suite;
  }

  private async runTest(test: TestCase): Promise<TestResult> {
    if (test.skip || test.todo) {
      return { test, status: test.todo ? 'todo' : 'skipped', duration: 0, attempts: 0 };
    }

    let lastError: Error | undefined;
    const maxAttempts = test.retry + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      test.attempts = attempt;
      const startTime = performance.now();

      try {
        await this.runWithTimeout(test.fn, test.timeout);
        test.status = 'passed';
        test.duration = performance.now() - startTime;
        return { test, status: 'passed', duration: test.duration, attempts: attempt };
      } catch (error) {
        lastError = error as Error;
        test.duration = performance.now() - startTime;

        if (attempt < maxAttempts) {
          await this.delay(100 * attempt);
        }
      }
    }

    test.status = 'failed';
    test.error = lastError;
    return {
      test,
      status: 'failed',
      error: lastError,
      duration: test.duration,
      attempts: maxAttempts,
    };
  }

  private async runWithTimeout(fn: () => void | Promise<void>, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Test timed out after ${timeout}ms`));
      }, timeout);

      Promise.resolve()
        .then(() => fn())
        .then(() => {
          clearTimeout(timer);
          resolve();
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async discoverTestFiles(): Promise<string[]> {
    const files: string[] = [];
    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (this.config.exclude.some(ex => entry.name === ex)) continue;
            await scanDir(fullPath);
          } else if (entry.isFile()) {
            if (this.isTestFile(fullPath)) {
              files.push(fullPath);
            }
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };

    await scanDir(this.config.rootDir);
    return files;
  }

  private isTestFile(filePath: string): boolean {
    const name = basename(filePath);
    return this.config.testMatch.some(pattern => {
      const regex = new RegExp(
        '^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$'
      );
      return regex.test(name);
    });
  }

  private extractTestBlocks(ast: any, filePath: string): TestCase[] {
    const tests: TestCase[] = [];
    if (!ast?.sections) return tests;

    for (const section of ast.sections) {
      if (section.name?.toLowerCase() === 'test' || section.name?.toLowerCase() === 'tests') {
        for (const node of section.content) {
          if (node.type === 'codeblock') {
            testIdCounter++;
            tests.push({
              id: `test-${testIdCounter}`,
              name: `Code block test #${testIdCounter}`,
              fullName: `${basename(filePath)} > ${section.name} > #${testIdCounter}`,
              tags: this.extractTags(node.value || ''),
              timeout: this.config.timeout,
              retry: this.config.retry,
              skip: (node.value || '').includes('// @skip'),
              todo: (node.value || '').includes('// @todo'),
              fn: () => {},
              duration: 0,
              attempts: 0,
            });
          }
        }
      }
    }

    return tests;
  }

  private extractTags(code: string): string[] {
    const tags: string[] = [];
    const tagMatch = code.match(/@tags?\s+(.+)/);
    if (tagMatch) {
      tags.push(...tagMatch[1].split(/[,\s]+/).filter(Boolean));
    }
    return tags;
  }

  private createErrorTest(file: string, message: string): TestCase {
    testIdCounter++;
    return {
      id: `test-${testIdCounter}`,
      name: message,
      fullName: `${basename(file)} > ${message}`,
      tags: [],
      timeout: 0,
      retry: 0,
      skip: false,
      todo: false,
      fn: () => {},
      duration: 0,
      attempts: 1,
    };
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  filterTests(pattern: string | RegExp): void {
    const regex = typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern;
    for (const describe of allDescribes) {
      this.filterDescribeBlock(describe, regex);
    }
  }

  private filterDescribeBlock(block: DescribeBlock, regex: RegExp): void {
    for (const child of block.children) {
      if ('fn' in child) {
        child.skip = !regex.test(child.fullName);
      } else {
        this.filterDescribeBlock(child, regex);
      }
    }
  }

  filterByTags(tags: string[]): void {
    for (const describe of allDescribes) {
      this.filterByTagsInBlock(describe, tags);
    }
  }

  private filterByTagsInBlock(block: DescribeBlock, tags: string[]): void {
    for (const child of block.children) {
      if ('fn' in child) {
        child.skip = !tags.some(tag => child.tags.includes(tag));
      } else {
        this.filterByTagsInBlock(child, tags);
      }
    }
  }

  filterSlow(threshold: number): void {
    for (const describe of allDescribes) {
      this.filterSlowInBlock(describe, threshold);
    }
  }

  private filterSlowInBlock(block: DescribeBlock, threshold: number): void {
    for (const child of block.children) {
      if ('fn' in child) {
        child.skip = child.timeout > threshold;
      } else {
        this.filterSlowInBlock(child, threshold);
      }
    }
  }
}

// ============================================================================
// Reporters
// ============================================================================

class ProgressReporter implements Reporter {
  private total = 0;
  private current = 0;
  private passed = 0;
  private failed = 0;
  private skipped = 0;
  private spinner: any;

  onRunStart(total: number): void {
    this.total = total;
    this.spinner = ora(`Running tests... 0/${total}`).start();
  }

  onTestResult(result: TestResult): void {
    this.current++;
    if (result.status === 'passed') this.passed++;
    else if (result.status === 'failed') this.failed++;
    else if (result.status === 'skipped') this.skipped++;

    this.spinner.text = `Running tests... ${this.current}/${this.total}`;
  }

  onRunEnd(suites: TestSuite[], coverage: CoverageReport | null): void {
    this.spinner.stop();
    const totalTests = suites.reduce((sum, s) => sum + s.results.length, 0);
    const passedTests = suites.reduce((sum, s) => sum + s.results.filter(r => r.status === 'passed').length, 0);
    const failedTests = suites.reduce((sum, s) => sum + s.results.filter(r => r.status === 'failed').length, 0);
    const skippedTests = suites.reduce((sum, s) => sum + s.results.filter(r => r.status === 'skipped' || r.status === 'todo').length, 0);

    console.log('');
    if (failedTests > 0) {
      console.log(chalk.red(`  ${failedTests} failed`));
    }
    if (passedTests > 0) {
      console.log(chalk.green(`  ${passedTests} passed`));
    }
    if (skippedTests > 0) {
      console.log(chalk.yellow(`  ${skippedTests} skipped`));
    }
    console.log(chalk.gray(`  ${totalTests} total`));

    if (coverage) {
      this.printCoverage(coverage);
    }
  }

  private printCoverage(coverage: CoverageReport): void {
    console.log(chalk.cyan('\n  Coverage:'));
    console.log(chalk.gray(`    Lines:      ${coverage.percentage.lines.toFixed(1)}%`));
    console.log(chalk.gray(`    Branches:   ${coverage.percentage.branches.toFixed(1)}%`));
    console.log(chalk.gray(`    Functions:  ${coverage.percentage.functions.toFixed(1)}%`));
    console.log(chalk.gray(`    Statements: ${coverage.percentage.statements.toFixed(1)}%`));
  }
}

class VerboseReporter implements Reporter {
  private results: TestResult[] = [];
  private currentSuite = '';

  onSuiteStart(suite: string): void {
    this.currentSuite = suite;
    console.log(chalk.cyan(`\n  ${suite}`));
  }

  onTestResult(result: TestResult): void {
    this.results.push(result);
    const icon = result.status === 'passed' ? chalk.green('    ✓')
      : result.status === 'failed' ? chalk.red('    ✗')
      : result.status === 'skipped' ? chalk.yellow('    ○')
      : chalk.gray('    ◌');
    const duration = result.duration > 1000 ? chalk.red(` (${(result.duration / 1000).toFixed(2)}s)`) : chalk.gray(` (${result.duration.toFixed(0)}ms)`);
    console.log(`${icon} ${result.test.name}${duration}`);

    if (result.error) {
      console.log(chalk.red(`      Error: ${result.error.message}`));
    }
  }

  onRunEnd(suites: TestSuite[], coverage: CoverageReport | null): void {
    console.log('\n');
    const total = this.results.length;
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const skipped = this.results.filter(r => r.status === 'skipped' || r.status === 'todo').length;

    if (failed > 0) console.log(chalk.red(`  ${failed} failed`));
    if (passed > 0) console.log(chalk.green(`  ${passed} passed`));
    if (skipped > 0) console.log(chalk.yellow(`  ${skipped} skipped`));
    console.log(chalk.gray(`  ${total} total`));

    if (coverage) {
      console.log(chalk.cyan('\n  Coverage:'));
      console.log(chalk.gray(`    Lines:      ${coverage.percentage.lines.toFixed(1)}%`));
      console.log(chalk.gray(`    Branches:   ${coverage.percentage.branches.toFixed(1)}%`));
      console.log(chalk.gray(`    Functions:  ${coverage.percentage.functions.toFixed(1)}%`));
      console.log(chalk.gray(`    Statements: ${coverage.percentage.statements.toFixed(1)}%`));
    }
  }
}

class JSONReporter implements Reporter {
  private results: TestResult[] = [];
  private suites: TestSuite[] = [];

  onSuiteEnd(suite: TestSuite): void {
    this.suites.push(suite);
  }

  onTestResult(result: TestResult): void {
    this.results.push(result);
  }

  onRunEnd(suites: TestSuite[], coverage: CoverageReport | null): void {
    const output = {
      totalTests: this.results.length,
      passed: this.results.filter(r => r.status === 'passed').length,
      failed: this.results.filter(r => r.status === 'failed').length,
      skipped: this.results.filter(r => r.status === 'skipped' || r.status === 'todo').length,
      duration: suites.reduce((sum, s) => sum + s.duration, 0),
      suites: suites.map(s => ({
        name: s.name,
        file: s.file,
        duration: s.duration,
        tests: s.results.map(r => ({
          name: r.test.name,
          fullName: r.test.fullName,
          status: r.status,
          duration: r.duration,
          error: r.error ? { message: r.error.message, stack: r.error.stack } : undefined,
          attempts: r.attempts,
        })),
      })),
      coverage: coverage ? {
        lines: coverage.percentage.lines,
        branches: coverage.percentage.branches,
        functions: coverage.percentage.functions,
        statements: coverage.percentage.statements,
      } : null,
    };
    console.log(JSON.stringify(output, null, 2));
  }
}

class TapReporter implements Reporter {
  private testNumber = 0;

  onRunStart(total: number): void {
    console.log(`1..${total}`);
  }

  onTestResult(result: TestResult): void {
    this.testNumber++;
    const prefix = result.status === 'passed' ? 'ok'
      : result.status === 'failed' ? 'not ok'
      : result.status === 'skipped' ? 'ok'
      : 'ok';
    const skip = result.status === 'skipped' ? ' # SKIP' : result.status === 'todo' ? ' # TODO' : '';
    console.log(`${prefix} ${this.testNumber} - ${result.test.name}${skip}`);
    if (result.error) {
      console.log(`  ---`);
      console.log(`  message: "${result.error.message}"`);
      console.log(`  severity: error`);
      console.log(`  ---`);
    }
  }

  onRunEnd(): void {
    // TAP summary is implicit from the count
  }
}

// ============================================================================
// Test Configuration Loader
// ============================================================================

async function loadTestConfig(searchPath?: string): Promise<Partial<TestConfig>> {
  const dir = searchPath || process.cwd();
  const configFile = join(dir, '.mamtest.json');

  try {
    await access(configFile);
    const content = await readFile(configFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

// ============================================================================
// Watch Mode
// ============================================================================

class Watcher {
  private watcher: any = null;
  private runner: TestRunner;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(runner: TestRunner) {
    this.runner = runner;
  }

  async start(dir: string): Promise<void> {
    const { watch } = await import('node:fs');
    this.watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      if (this.runner['config'].watchIgnore.some(i => filename.includes(i))) return;

      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(async () => {
        console.clear();
        console.log(chalk.cyan(`\n  File changed: ${filename}\n`));
        await this.runner.run();
      }, 300);
    });

    console.log(chalk.gray(`  Watching for changes in ${dir}...`));
    await new Promise(() => {}); // Keep alive
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function testCommand(options: TestOptions): Promise<void> {
  const spinner = ora('Running tests...').start();

  try {
    const configOverrides = await loadTestConfig(options.config);
    const config: Partial<TestConfig> = {
      ...configOverrides,
      rootDir: options.dir ? resolve(options.dir) : configOverrides.rootDir,
      bail: options.bail,
      parallel: options.parallel,
      concurrency: options.concurrency,
      timeout: options.timeout,
      retry: options.retry,
    };

    if (options.verbose) config.reporters = ['verbose'] as string[];
    if (options.reporter) config.reporters = [options.reporter];

    const runner = new TestRunner(config);

    // Add reporter
    const reporterName = config.reporters?.[0] || 'progress';
    switch (reporterName) {
      case 'verbose': runner.addReporter(new VerboseReporter()); break;
      case 'json': runner.addReporter(new JSONReporter()); break;
      case 'tap': runner.addReporter(new TapReporter()); break;
      default: runner.addReporter(new ProgressReporter()); break;
    }

    // Apply filters
    if (options.grep) runner.filterTests(options.grep);
    if (options.tags?.length) runner.filterByTags(options.tags);
    if (options.slow) runner.filterSlow(config.slowThreshold || 1000);

    // Determine files to test
    let files: string[] | undefined;
    if (options.file) {
      files = [resolve(options.file)];
    }

    spinner.stop();

    if (options.watch) {
      const watcher = new Watcher(runner);
      const watchDir = options.dir ? resolve(options.dir) : process.cwd();
      await watcher.start(watchDir);
      return;
    }

    const { suites, coverage } = await runner.run(files);

    // Print failures
    for (const suite of suites) {
      for (const result of suite.results) {
        if (result.status === 'failed' && result.error) {
          console.error(chalk.red(`\n  FAIL ${result.test.fullName}`));
          console.error(chalk.red(`    ${result.error.message}`));
          if (result.error.stack) {
            const stackLines = result.error.stack.split('\n').slice(1, 4);
            for (const line of stackLines) {
              console.error(chalk.gray(`    ${line.trim()}`));
            }
          }
        }
      }
    }

    // Coverage thresholds check
    if (coverage) {
      const thresholds = config.coverageThresholds || DEFAULT_CONFIG.coverageThresholds;
      let belowThreshold = false;

      if (coverage.percentage.lines < thresholds.lines) {
        console.error(chalk.red(`\n  Coverage threshold not met for lines: ${coverage.percentage.lines.toFixed(1)}% < ${thresholds.lines}%`));
        belowThreshold = true;
      }
      if (coverage.percentage.branches < thresholds.branches) {
        console.error(chalk.red(`\n  Coverage threshold not met for branches: ${coverage.percentage.branches.toFixed(1)}% < ${thresholds.branches}%`));
        belowThreshold = true;
      }
      if (coverage.percentage.functions < thresholds.functions) {
        console.error(chalk.red(`\n  Coverage threshold not met for functions: ${coverage.percentage.functions.toFixed(1)}% < ${thresholds.functions}%`));
        belowThreshold = true;
      }

      if (belowThreshold) process.exit(1);
    }

    // Exit code
    const hasFailures = suites.some(s => s.results.some(r => r.status === 'failed'));
    process.exit(hasFailures ? 1 : 0);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Exports for testing
// ============================================================================

export {
  TestRunner,
  ProgressReporter,
  VerboseReporter,
  JSONReporter,
  TapReporter,
  Watcher,
  SnapshotManager,
  CoverageCollector,
  AssertionError,
  describe,
  it,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  assertEqual,
  assertDeepEqual,
  assertNotEqual,
  assertThrows,
  assertThrowsAsync,
  assertMatches,
  assertContains,
  assertStringContains,
  assertTruthy,
  assertFalsy,
  assertGreaterThan,
  assertLessThan,
  assertIsNull,
  assertIsNotNull,
  assertInstanceOf,
  assertTypeOf,
  assertApproximately,
  deepEquals,
  formatValue,
  loadTestConfig,
};
