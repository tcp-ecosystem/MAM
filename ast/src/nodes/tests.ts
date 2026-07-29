/**
 * MAM Tests Section Node
 *
 * Defines the TestsNode and related types for the Tests section.
 * Each test case describes an input/output pair, metadata, and execution
 * options for validating module behaviour.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Test case status. */
export type TestCaseStatus =
  | 'pending'
  | 'pass'
  | 'fail'
  | 'skip'
  | 'error';

/** A single test case. */
export interface TestCase {
  /** Test name. */
  name: string;
  /** Input data (JSON, YAML, or free-form). */
  input?: string;
  /** Expected output. */
  expected?: string;
  /** Human-readable description. */
  description?: string;
  /** Tags for filtering. */
  tags?: string[];
  /** Whether the test is skipped. */
  skip?: boolean;
  /** Test status (after execution). */
  status?: TestCaseStatus;
  /** Actual output (populated after execution). */
  actual?: string;
  /** Execution time in milliseconds. */
  duration?: number;
  /** Error message if the test errored. */
  error?: string;
}

/** The Tests section AST node. */
export interface TestsNode {
  /** Discriminant – always `'Tests'`. */
  type: 'Tests';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of test cases. */
  cases: TestCase[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a TestsNode.
 * Returns an empty array when the node is valid.
 */
export function validateTestsNode(node: TestsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'TestsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Tests') {
    errors.push({ path: 'type', message: `Expected type "Tests", got "${node.type}".` });
  }

  if (!Array.isArray(node.cases)) {
    errors.push({ path: 'cases', message: 'cases must be an array.' });
    return errors;
  }

  const seen = new Set<string>();
  node.cases.forEach((tc, idx) => {
    const base = `cases[${idx}]`;

    if (!tc.name || typeof tc.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'test case name must be a non-empty string.' });
    } else if (seen.has(tc.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate test case "${tc.name}".` });
    } else {
      seen.add(tc.name);
    }

    if (tc.skip !== undefined && typeof tc.skip !== 'boolean') {
      errors.push({ path: `${base}.skip`, message: 'skip must be a boolean.' });
    }

    if (tc.tags !== undefined) {
      if (!Array.isArray(tc.tags)) {
        errors.push({ path: `${base}.tags`, message: 'tags must be an array.' });
      }
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateTestsNodeOptions {
  cases?: TestCase[];
  location?: SourceLocation;
}

/** Create a TestsNode with sensible defaults. */
export function createTestsNode(options: CreateTestsNodeOptions = {}): TestsNode {
  return {
    type: 'Tests',
    cases: options.cases ?? [],
    location: options.location,
  };
}

/** Create a single TestCase. */
export function createTestCase(
  name: string,
  overrides: Partial<Omit<TestCase, 'name'>> = {},
): TestCase {
  return {
    name,
    skip: false,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a TestsNode. */
export function isTestsNode(value: unknown): value is TestsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as TestsNode).type === 'Tests' &&
    Array.isArray((value as TestsNode).cases)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all test case names. */
export function getTestCaseNames(node: TestsNode): string[] {
  return node.cases.map((tc) => tc.name);
}

/** Find a test case by name. */
export function findTestCaseByName(node: TestsNode, name: string): TestCase | undefined {
  return node.cases.find((tc) => tc.name === name);
}

/** Filter test cases by tag. */
export function findTestCasesByTag(node: TestsNode, tag: string): TestCase[] {
  return node.cases.filter((tc) => tc.tags?.includes(tag));
}

/** Return only skipped test cases. */
export function getSkippedTestCases(node: TestsNode): TestCase[] {
  return node.cases.filter((tc) => tc.skip === true);
}

/** Return only non-skipped test cases. */
export function getActiveTestCases(node: TestsNode): TestCase[] {
  return node.cases.filter((tc) => tc.skip !== true);
}

/** Return test cases by status. */
export function getTestCasesByStatus(node: TestsNode, status: TestCaseStatus): TestCase[] {
  return node.cases.filter((tc) => tc.status === status);
}

/** Collect all unique tags across test cases. */
export function getAllTestTags(node: TestsNode): string[] {
  const tags = new Set<string>();
  for (const tc of node.cases) {
    if (tc.tags) {
      for (const tag of tc.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags);
}

/** Count total test cases. */
export function countTestCases(node: TestsNode): number {
  return node.cases.length;
}

/** Count test cases that have both input and expected defined. */
export function countCompleteTestCases(node: TestsNode): number {
  return node.cases.filter((tc) => tc.input !== undefined && tc.expected !== undefined).length;
}
