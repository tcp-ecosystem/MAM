/**
 * MAM Test Reporters
 *
 * Serialize {@link TestResult} objects into console text, JSON, and JUnit XML
 * output. All reporters implement the {@link Reporter} interface and are
 * selectable via {@link createReporter}.
 */

import type { TestResult, TestSuite, TestCase } from './runner.js';

// ============================================================================
// Types
// ============================================================================

/** Supported reporter types */
export type ReporterType = 'console' | 'json' | 'junit';

/** A reporter serializes a TestResult into a string */
export interface Reporter {
  /** Serialize a test result to a string */
  report(result: TestResult): string;
}

/** Options for {@link ConsoleReporter} */
export interface ConsoleReporterOptions {
  /** Include per-case detail lines */
  verbose?: boolean;
}

// ============================================================================
// Console Reporter
// ============================================================================

/**
 * Human-readable reporter that prints a summary with per-suite status and
 * optionally per-case detail.
 */
export class ConsoleReporter implements Reporter {
  constructor(private options?: ConsoleReporterOptions) {}

  report(result: TestResult): string {
    const lines: string[] = [];
    const verbose = this.options?.verbose ?? false;

    lines.push(`Test run completed in ${result.timeMs.toFixed(2)}ms`);
    lines.push(
      `  ${result.summary.total} total, ${result.summary.passed} passed, ` +
        `${result.summary.failed} failed, ${result.summary.skipped} skipped`
    );
    lines.push('');

    for (const suite of result.suites) {
      const mark = suite.success ? 'PASS' : 'FAIL';
      lines.push(`[${mark}] ${suite.name} (${suite.timeMs.toFixed(2)}ms)`);
      if (verbose) {
        for (const testCase of suite.cases) {
          const status = testCase.status.toUpperCase().padEnd(4);
          const error = testCase.error ? ` - ${testCase.error}` : '';
          lines.push(`    ${status} ${testCase.name}${error}`);
        }
      }
    }

    lines.push('');
    lines.push(result.success ? 'SUCCESS' : 'FAILURE');
    return lines.join('\n');
  }
}

// ============================================================================
// JSON Reporter
// ============================================================================

/**
 * Machine-readable reporter that dumps the entire TestResult as pretty-printed
 * JSON.
 */
export class JSONReporter implements Reporter {
  report(result: TestResult): string {
    return JSON.stringify(result, null, 2);
  }
}

// ============================================================================
// JUnit Reporter
// ============================================================================

/**
 * JUnit-compatible XML reporter. Emits a `<testsuites>` document with one
 * `<testsuite>` per suite and `<testcase>` elements for every case.
 */
export class JUnitReporter implements Reporter {
  report(result: TestResult): string {
    const attrs =
      `tests="${result.summary.total}" ` +
      `failures="${result.summary.failed}" ` +
      `skipped="${result.summary.skipped}" ` +
      `time="${(result.timeMs / 1000).toFixed(3)}"`;

    const suites = result.suites.map((s) => this.suiteToXml(s)).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites ${attrs}>\n${suites}\n</testsuites>`;
  }

  private suiteToXml(suite: TestSuite): string {
    const failed = suite.cases.filter((c) => c.status === 'fail').length;
    const cases = suite.cases.map((c) => this.caseToXml(c)).join('\n');
    return (
      `  <testsuite name="${escapeXml(suite.name)}" tests="${suite.cases.length}" ` +
      `failures="${failed}" time="${(suite.timeMs / 1000).toFixed(3)}">\n` +
      `${cases}\n  </testsuite>`
    );
  }

  private caseToXml(testCase: TestCase): string {
    const time = (testCase.timeMs / 1000).toFixed(3);
    if (testCase.status === 'skip') {
      return `    <testcase name="${escapeXml(testCase.name)}" time="${time}"><skipped /></testcase>`;
    }
    if (testCase.status === 'fail') {
      return (
        `    <testcase name="${escapeXml(testCase.name)}" time="${time}">` +
        `<failure message="${escapeXml(testCase.error ?? '')}" /></testcase>`
      );
    }
    return `    <testcase name="${escapeXml(testCase.name)}" time="${time}" />`;
  }
}

// ============================================================================
// Helpers & factory
// ============================================================================

/**
 * Escape a string for safe inclusion in XML content and attributes
 */
export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => {
    switch (ch) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return ch;
    }
  });
}

/**
 * Create a reporter by type name
 */
export function createReporter(type: ReporterType, options?: ConsoleReporterOptions): Reporter {
  switch (type) {
    case 'json':
      return new JSONReporter();
    case 'junit':
      return new JUnitReporter();
    case 'console':
    default:
      return new ConsoleReporter(options);
  }
}