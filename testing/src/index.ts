/**
 * MAM Testing Framework
 *
 * Module testing, system testing, integration testing, and snapshot testing.
 * Includes assertions, fixtures, matchers, and benchmarking utilities.
 */

export { TestRunner, type TestConfig, type TestResult, type TestSuite, type TestCase } from './runner.js';
export { ModuleTest, type ModuleTestConfig, type ModuleTestResult } from './module-test.js';
export { SystemTest, type SystemTestConfig, type SystemTestResult } from './system-test.js';
export { SnapshotTest, type SnapshotConfig, type SnapshotResult } from './snapshot.js';
export {
  MAMAssert,
  MAMAssertionError,
  type AssertionResult,
  type AssertionConfig,
  type SourceLocation,
  type MAMASTPartial,
} from './assertions.js';
export {
  TestFixtureManager,
  type FixtureFile,
  type FixtureTemplate,
  type FixtureSection,
  type FixtureCacheEntry,
  MINIMAL_TEMPLATE,
  FULL_TEMPLATE,
  SYSTEM_TEMPLATE,
} from './fixtures.js';
export {
  MAMMatcher,
  type MatchResult,
  type StructuralMatchResult,
  type MatchableAST,
  type PatternDefinition,
  type SectionQuery,
} from './matcher.js';
export {
  MAMBenchmark,
  type BenchmarkRunResult,
  type BenchmarkStats,
  type BenchmarkComparison,
  type RegressionConfig,
  type BenchmarkOperation,
} from './benchmark.js';