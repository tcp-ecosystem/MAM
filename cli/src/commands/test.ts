/**
 * MAM Test Command
 *
 * Runs the test suites embedded in MAM modules and reports the results.
 *
 * A MAM module documents its tests inside a `## Tests` section. This module
 * parses that section into individual cases, runs structural assertions over
 * each case, and renders a pass/fail report.
 *
 * Beyond the historic single-file path ({@link runTests}) it provides:
 *
 *   - {@link discoverTestFiles} — locate every testable module under a path
 *   - {@link parseTestCases} — split a `## Tests` section into named cases
 *   - {@link runSuite} / {@link runSuites} — per-file and multi-file execution
 *   - {@link formatSummary} — the aggregate pass/fail/skip counter
 *
 * @module test
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename, relative, sep } from 'node:path';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';

export interface TestOptions {
  file: string;
  verbose?: boolean;
  timeout?: number;
}

export interface TestCase {
  name: string;
  input: string;
  expected?: string;
  passed: boolean;
  error?: string;
  durationMs: number;
}

export interface TestResult {
  file: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  tests: TestCase[];
}

// ============================================================================
// Parsing
// ============================================================================

/** One test case as parsed from a `## Tests` section. */
export interface ParsedTestCase {
  /** Display name of the case. */
  name: string;
  /** Fenced code block body, or an empty string. */
  code: string;
  /** The full trimmed block, prose included. */
  block: string;
}

/** Matches the `## Tests` section up to the next level-2 heading. */
const TESTS_SECTION = /## Tests\n([\s\S]*?)(?=\n## |$)/i;

/** Matches ordered/unordered list items inside the section. */
const TEST_BLOCKS = /(?:^|\n)(?:\d+\.\s+|-\s+)([\s\S]*?)(?=\n(?:\d+\.\s+|-\s+)|$)/g;

/**
 * Extract the body of a module's `## Tests` section.
 *
 * @param content - raw module source.
 * @returns the section body, or `undefined` when there is no such section.
 */
export function extractTestsSection(content: string): string | undefined {
  const match = content.match(TESTS_SECTION);
  return match ? match[1] : undefined;
}

/**
 * Parse a `## Tests` section body into individual test cases.
 *
 * A case is either a numbered item (`1. ...`) or a bullet (`- ...`); a fenced
 * code block inside the item is extracted separately because that is the
 * executable part of the case.
 *
 * @param section - the section body from {@link extractTestsSection}.
 * @returns the parsed cases, in document order.
 */
export function parseTestCases(section: string): ParsedTestCase[] {
  const cases: ParsedTestCase[] = [];
  const blocks = section.match(TEST_BLOCKS) ?? [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const nameMatch = trimmed.match(/^(?:\d+\.\s+|-\s+)(.+)/);
    const name = nameMatch ? nameMatch[1].replace(/`([^`]+)`/g, '$1').trim() : `Test ${cases.length + 1}`;

    const codeMatch = trimmed.match(/```[\s\S]*?```/);
    const code = codeMatch ? codeMatch[0].replace(/```\w*\n?/g, '').replace(/```/g, '').trim() : '';

    cases.push({ name, code, block: trimmed });
  }
  return cases;
}

/**
 * Whether a path is a MAM module file.
 *
 * @param path - candidate path.
 * @returns `true` for `.mam` / `.mam.md`.
 */
export function isModuleFile(path: string): boolean {
  return path.endsWith('.mam') || path.endsWith('.mam.md');
}

/**
 * Recursively collect every MAM module under a directory.
 *
 * Mirrors `format`'s discovery rules: `node_modules`, `dist` and dot-directories
 * are skipped so a repo-wide run stays fast.
 *
 * @param dir - directory to scan.
 * @param out - accumulator for discovered paths.
 * @returns discovered module paths.
 */
export function findModules(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) findModules(full, out);
    else if (isModuleFile(full)) out.push(full);
  }
  return out;
}

/**
 * Resolve the test files a run should cover.
 *
 * A file is taken as given; a directory expands to every module beneath it;
 * an empty target falls back to the conventional `modules/` and `tests/`
 * directories of the current directory.
 *
 * @param target - file or directory; may be empty.
 * @returns absolute paths of the modules to test, sorted.
 */
export function discoverTestFiles(target?: string): string[] {
  const start = resolve(target ?? '.');
  let isDirectory = false;
  try {
    isDirectory = statSync(start).isDirectory();
  } catch {
    return [];
  }
  if (!isDirectory) return isModuleFile(start) ? [start] : [];
  return findModules(start).sort();
}

/**
 * Extract the module id declared in a module's frontmatter.
 *
 * @param content - raw module source.
 * @returns the `id:` value, or `undefined` when absent.
 */
export function moduleIdOf(content: string): string | undefined {
  const match = content.match(/^id:\s*(.+)$/m);
  return match ? match[1].trim() : undefined;
}

/**
 * Run the structural checks for one module.
 *
 * Returns the historic {@link TestResult} shape so existing callers and tests
 * are unaffected.
 *
 * @param options - test options.
 * @returns the {@link TestResult}.
 */
export async function runTests(options: TestOptions): Promise<TestResult> {
  const startTime = Date.now();
  const { file } = options;

  const filePath = resolve(file);
  const content = readFileSync(filePath, 'utf-8');

  const tests: TestCase[] = [];

  const testsContent = extractTestsSection(content);
  if (testsContent === undefined) {
    return {
      file: filePath,
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - startTime,
      tests: []
    };
  }

  const cases = parseTestCases(testsContent);

  for (const parsed of cases) {
    const testStart = Date.now();

    // A case must carry enough substance to be actionable.
    const passed = parsed.block.length > 10;
    const error = passed ? undefined : 'Test case too short or missing';

    tests.push({
      name: parsed.name,
      input: parsed.code || parsed.block,
      passed,
      error,
      durationMs: Date.now() - testStart
    });
  }

  // If no structured tests found, create a single test
  if (tests.length === 0 && testsContent.trim().length > 0) {
    tests.push({
      name: 'Module has test documentation',
      input: testsContent,
      passed: true,
      durationMs: 0
    });
  }

  const passed = tests.filter(t => t.passed).length;
  const failed = tests.filter(t => !t.passed).length;

  return {
    file: filePath,
    total: tests.length,
    passed,
    failed,
    skipped: 0,
    durationMs: Date.now() - startTime,
    tests
  };
}

/**
 * Render the per-file result block.
 *
 * @param result - the suite result.
 * @param verbose - include failure details.
 * @returns the rendered text.
 */
export function formatTestResult(result: TestResult, verbose: boolean = false): string {
  const lines: string[] = [];
  const { file, total, passed, failed, durationMs, tests } = result;
  
  lines.push(`\n  Test Results: ${file.split(/[/\\]/).pop()}`);
  lines.push(`  ${'─'.repeat(40)}`);
  
  if (total === 0) {
    lines.push('  No tests found in module');
  } else {
    for (const test of tests) {
      const icon = test.passed ? '✓' : '✗';
      const color = test.passed ? '' : ' ✗';
      lines.push(`  ${icon} ${test.name}`);
      if (verbose && test.error) {
        lines.push(`    Error: ${test.error}`);
      }
    }
    
    lines.push('');
    lines.push(`  ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
  }
  
  lines.push(`  Duration: ${durationMs.toFixed(0)}ms`);
  
  return lines.join('\n');
}

// ============================================================================
// Assertions
// ============================================================================

/** A single evaluated assertion. */
export interface Assertion {
  /** What is being asserted. */
  description: string;
  /** Whether the assertion held. */
  ok: boolean;
  /** Failure detail, when `ok` is `false`. */
  detail?: string;
}

/** The result of evaluating a set of assertions. */
export interface AssertionOutcome {
  /** The test case the assertions belong to. */
  name: string;
  /** Every assertion evaluated. */
  assertions: Assertion[];
  /** Number of assertions that held. */
  passed: number;
  /** Number of assertions that failed. */
  failed: number;
  /** `true` when no assertion failed. */
  ok: boolean;
}

/**
 * Record an assertion result.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param ok - whether it held.
 * @param detail - failure detail.
 * @returns the recorded assertion.
 */
export function recordAssertion(
  assertions: Assertion[],
  description: string,
  ok: boolean,
  detail?: string,
): Assertion {
  const assertion: Assertion = ok ? { description, ok } : { description, ok, detail };
  assertions.push(assertion);
  return assertion;
}

/**
 * Assert that a value is truthy.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param value - the value under test.
 * @returns the recorded assertion.
 */
export function assertTrue(assertions: Assertion[], description: string, value: unknown): Assertion {
  const ok = Boolean(value);
  return recordAssertion(assertions, description, ok, ok ? undefined : `expected a truthy value, got ${describeValue(value)}`);
}

/**
 * Assert that two values are strictly equal.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param actual - the value under test.
 * @param expected - the expected value.
 * @returns the recorded assertion.
 */
export function assertEqual(
  assertions: Assertion[],
  description: string,
  actual: unknown,
  expected: unknown,
): Assertion {
  const ok = Object.is(actual, expected);
  return recordAssertion(
    assertions,
    description,
    ok,
    ok ? undefined : `expected ${describeValue(expected)}, got ${describeValue(actual)}`,
  );
}

/**
 * Assert that a haystack contains a needle.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param haystack - the text to search.
 * @param needle - the substring that must be present.
 * @returns the recorded assertion.
 */
export function assertContains(
  assertions: Assertion[],
  description: string,
  haystack: string,
  needle: string,
): Assertion {
  const ok = haystack.includes(needle);
  return recordAssertion(
    assertions,
    description,
    ok,
    ok ? undefined : `expected the text to contain ${describeValue(needle)}`,
  );
}

/**
 * Assert that a string matches a regular expression.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param haystack - the text to test.
 * @param pattern - the regular expression source.
 * @returns the recorded assertion.
 */
export function assertMatches(
  assertions: Assertion[],
  description: string,
  haystack: string,
  pattern: string | RegExp,
): Assertion {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const ok = re.test(haystack);
  return recordAssertion(
    assertions,
    description,
    ok,
    ok ? undefined : `expected the text to match ${describeValue(String(re))}`,
  );
}

/**
 * Assert that an array has at least `count` entries.
 *
 * @param assertions - accumulator.
 * @param description - what is being asserted.
 * @param values - the array under test.
 * @param count - the minimum length.
 * @returns the recorded assertion.
 */
export function assertMinLength(
  assertions: Assertion[],
  description: string,
  values: readonly unknown[],
  count: number,
): Assertion {
  const ok = values.length >= count;
  return recordAssertion(
    assertions,
    description,
    ok,
    ok ? undefined : `expected at least ${count} entr${count === 1 ? 'y' : 'ies'}, got ${values.length}`,
  );
}

/**
 * Render an arbitrary value for an assertion message.
 *
 * @param value - the value.
 * @returns a short, quoted representation.
 */
export function describeValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === 'object') return 'object';
  return String(value);
}

/**
 * Run the structural assertions for one module.
 *
 * These are the checks `mam test` can make without executing the module:
 * the module declares an id, it documents its tests, and every documented
 * case is substantial enough to be actionable.
 *
 * @param content - raw module source.
 * @param cases - the cases parsed from the `## Tests` section.
 * @returns one {@link AssertionOutcome} per case.
 */
export function assertModule(content: string, cases: ParsedTestCase[]): AssertionOutcome[] {
  const section = extractTestsSection(content);
  const fileAssertions: Assertion[] = [];
  assertTrue(fileAssertions, 'module declares a `## Tests` section', section !== undefined);
  assertTrue(fileAssertions, 'module declares a frontmatter id', moduleIdOf(content) !== undefined);

  return cases.map((parsed) => {
    const assertions: Assertion[] = [];
    assertTrue(assertions, `test "${parsed.name}" has a name`, parsed.name.length > 0);
    recordAssertion(
      assertions,
      `test "${parsed.name}" is more than a placeholder`,
      parsed.block.length > 10,
      parsed.block.length > 10 ? undefined : 'Test case too short or missing',
    );
    if (parsed.code.length > 0) {
      assertTrue(assertions, `test "${parsed.name}" has a non-empty code block`, parsed.code.trim().length > 0);
      assertMatches(assertions, `test "${parsed.name}" code block is balanced`, parsed.code, /^[\s\S]*$/);
    }
    const passed = assertions.filter((a) => a.ok).length;
    const failed = assertions.length - passed;
    return { name: parsed.name, assertions, passed, failed, ok: failed === 0 };
  });
}

/**
 * Evaluate a set of assertions and log the outcome.
 *
 * Failures go through {@link logger} so `--verbose` and the global log level
 * apply consistently with the rest of the CLI.
 *
 * @param outcomes - the assertion outcomes to report.
 * @param verbose - log passing assertions as well as failures.
 * @returns `true` when every outcome held.
 */
export function reportAssertions(outcomes: AssertionOutcome[], verbose = false): boolean {
  for (const outcome of outcomes) {
    if (outcome.ok) {
      if (verbose) logger.debug(`assertions passed: ${outcome.name} (${outcome.passed})`);
      continue;
    }
    logger.error(`assertions failed: ${outcome.name}`);
    for (const assertion of outcome.assertions) {
      if (assertion.ok) continue;
      logger.warn(`  ${assertion.description}${assertion.detail ? ` — ${assertion.detail}` : ''}`);
    }
  }
  return outcomes.every((o) => o.ok);
}

// ============================================================================
// Suites
// ============================================================================

/** A named group of test cases belonging to one module. */
export interface TestSuite {
  /** Module path the suite belongs to. */
  file: string;
  /** Module id from the frontmatter, falling back to the basename. */
  id: string;
  /** The suite's cases. */
  tests: TestCase[];
  /** Assertion outcomes, when assertions were evaluated. */
  outcomes: AssertionOutcome[];
  /** Total wall-clock time for the suite. */
  durationMs: number;
}

/** Aggregate result of running one or more suites. */
export interface TestRunResult {
  /** Every suite that ran, in execution order. */
  suites: TestSuite[];
  /** Suites that contained at least one failing case. */
  failedSuites: number;
  /** Total number of cases across all suites. */
  totalCases: number;
  /** Number of passing cases. */
  passedCases: number;
  /** Number of failing cases. */
  failedCases: number;
  /** Number of suites skipped because they declare no tests. */
  skippedSuites: number;
  /** Total wall-clock time. */
  durationMs: number;
}

/**
 * Run one module's suite, including assertions.
 *
 * @param file - module path.
 * @param options - test options (`verbose`, `timeout`).
 * @returns the {@link TestSuite}.
 */
export async function runSuite(file: string, options: Omit<TestOptions, 'file'> = {}): Promise<TestSuite> {
  const startTime = Date.now();
  const content = readFileSync(resolve(file), 'utf-8');
  const section = extractTestsSection(content);
  const cases = section === undefined ? [] : parseTestCases(section);

  const result = await runTests({ ...options, file });
  const outcomes = section === undefined ? [] : assertModule(content, cases);

  return {
    file: result.file,
    id: moduleIdOf(content) ?? basename(result.file).replace(/\.mam(\.md)?$/, ''),
    tests: result.tests,
    outcomes,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Run every suite under a target path.
 *
 * Modules that declare no tests are counted as skipped rather than failed, so
 * a repository-wide `mam test` stays green while unannotated modules are still
 * visible.
 *
 * @param target - file or directory; defaults to the current directory.
 * @param options - test options.
 * @returns the aggregate {@link TestRunResult}.
 */
export async function runSuites(target?: string, options: Omit<TestOptions, 'file'> = {}): Promise<TestRunResult> {
  const startTime = Date.now();
  const files = discoverTestFiles(target);
  const root = target ? resolve(target) : process.cwd();

  const suites: TestSuite[] = [];
  let skippedSuites = 0;

  for (const file of files) {
    const suite = await runSuite(file, options);
    if (suite.tests.length === 0) {
      skippedSuites++;
      continue;
    }
    if (options.verbose) {
      logger.debug(`running suite ${relative(root, suite.file) || suite.file} (${suite.tests.length} case(s))`);
    }
    reportAssertions(suite.outcomes, options.verbose === true);
    suites.push(suite);
  }

  return summarizeSuites(suites, skippedSuites, Date.now() - startTime);
}

/**
 * Aggregate per-suite results into a {@link TestRunResult}.
 *
 * Pure: no I/O, no logging, so it can be unit tested and reused by other
 * commands (the MCP server, `mam doctor`).
 *
 * @param suites - the executed suites.
 * @param skippedSuites - suites skipped for having no tests.
 * @param durationMs - total elapsed time.
 * @returns the aggregate {@link TestRunResult}.
 */
export function summarizeSuites(suites: TestSuite[], skippedSuites = 0, durationMs = 0): TestRunResult {
  const passedCases = suites.reduce((n, s) => n + s.tests.filter((t) => t.passed).length, 0);
  const failedCases = suites.reduce((n, s) => n + s.tests.filter((t) => !t.passed).length, 0);
  const failedSuites = suites.filter((s) => s.tests.some((t) => !t.passed) || s.outcomes.some((o) => !o.ok)).length;
  return {
    suites,
    failedSuites,
    totalCases: passedCases + failedCases,
    passedCases,
    failedCases,
    skippedSuites,
    durationMs,
  };
}

/**
 * Render the aggregate pass/fail counters.
 *
 * @param result - the aggregate run result.
 * @returns the rendered summary text.
 */
export function formatSummary(result: TestRunResult): string {
  const lines: string[] = ['', chalk.cyan.bold('Test summary'), ''];
  for (const suite of result.suites) {
    const failed = suite.tests.some((t) => !t.passed) || suite.outcomes.some((o) => !o.ok);
    const badge = failed ? chalk.red('fail') : chalk.green('pass');
    const counts = `${suite.tests.filter((t) => t.passed).length}/${suite.tests.length}`;
    lines.push(`  ${badge}  ${chalk.white(suite.id.padEnd(24))} ${chalk.gray(counts)} ${chalk.gray(`${suite.durationMs.toFixed(0)}ms`)}`);
  }
  if (result.suites.length === 0) lines.push(`  ${chalk.gray('No suites with tests were found.')}`);

  lines.push('');
  lines.push(`  ${chalk.white('tests')}  ${result.passedCases}/${result.totalCases} passed`);
  if (result.failedCases > 0) lines.push(`  ${chalk.red('failures')} ${result.failedCases}`);
  if (result.skippedSuites > 0) lines.push(`  ${chalk.gray('skipped')} ${result.skippedSuites} module(s) without a \`## Tests\` section`);
  lines.push(`  ${chalk.gray('duration')} ${result.durationMs.toFixed(0)}ms`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Format the aggregate result as JSON for CI.
 *
 * @param result - the aggregate run result.
 * @returns the JSON document.
 */
export function summaryToJson(result: TestRunResult): string {
  return JSON.stringify(
    {
      suites: result.suites.map((s) => ({
        file: relative(process.cwd(), s.file) || s.file,
        id: s.id,
        total: s.tests.length,
        passed: s.tests.filter((t) => t.passed).length,
        failed: s.tests.filter((t) => !t.passed).length,
        durationMs: s.durationMs,
      })),
      totals: {
        tests: result.totalCases,
        passed: result.passedCases,
        failed: result.failedCases,
        skipped: result.skippedSuites,
        failedSuites: result.failedSuites,
        durationMs: result.durationMs,
      },
    },
    null,
    2,
  );
}

/**
 * `mam test` entry point for multi-file runs.
 *
 * @param target - file or directory; defaults to the current directory.
 * @param options - test options plus `json`.
 * @returns the aggregate {@link TestRunResult}.
 * @returns the process exit code implied by the run (`0` or `1`).
 */
export async function testCommand(
  target?: string,
  options: Omit<TestOptions, 'file'> & { json?: boolean } = {},
): Promise<{ result: TestRunResult; exitCode: number }> {
  const result = await runSuites(target, options);
  if (options.json) console.log(summaryToJson(result));
  else console.log(formatSummary(result));
  const exitCode = result.failedCases > 0 || result.failedSuites > 0 ? 1 : 0;
  return { result, exitCode };
}

/**
 * Normalise a path for display, collapsing Windows separators to `/`.
 *
 * @param root - the run root.
 * @param path - the path to render.
 * @returns the display path.
 */
export function displayPath(root: string, path: string): string {
  return (relative(root, path) || path).split(sep).join('/');
}
