/**
 * MAM Performance Benchmarking
 *
 * Provides performance testing utilities for MAM parse, validate, and compile
 * operations with statistical analysis and regression detection.
 */

// ============================================================================
// Types
// ============================================================================

/** Result of a single benchmark run */
export interface BenchmarkRunResult {
  /** Operation name */
  operation: string;
  /** Execution times in milliseconds */
  times: number[];
  /** Number of iterations */
  iterations: number;
  /** Total wall time in ms */
  totalTimeMs: number;
}

/** Statistical summary of benchmark results */
export interface BenchmarkStats {
  /** Operation name */
  operation: string;
  /** Number of samples */
  count: number;
  /** Mean execution time (ms) */
  mean: number;
  /** Median execution time (ms) */
  median: number;
  /** Minimum execution time (ms) */
  min: number;
  /** Maximum execution time (ms) */
  max: number;
  /** Standard deviation */
  stdDev: number;
  /** 95th percentile */
  p95: number;
  /** 99th percentile */
  p99: number;
  /** Variance */
  variance: number;
  /** Relative margin of error (95% CI) */
  marginOfError: number;
}

/** Comparison result between two benchmark runs */
export interface BenchmarkComparison {
  /** Operation name */
  operation: string;
  /** Baseline stats */
  baseline: BenchmarkStats;
  /** Current stats */
  current: BenchmarkStats;
  /** Percentage change in mean */
  meanChangePercent: number;
  /** Percentage change in p95 */
  p95ChangePercent: number;
  /** Whether regression detected */
  hasRegression: boolean;
  /** Regression severity */
  severity: 'none' | 'minor' | 'moderate' | 'severe';
}

/** Regression detection configuration */
export interface RegressionConfig {
  /** Threshold for regression detection (default: 0.1 = 10%) */
  threshold?: number;
  /** Minimum number of samples required */
  minSamples?: number;
  /** Whether to use strict mode (fail on any degradation) */
  strict?: boolean;
  /** Threshold at or below which a change is treated as a warning (defaults to `threshold`) */
  warnThreshold?: number;
  /** Threshold above which a change is treated as a failure (defaults to `threshold * 2`, or 0 in strict mode) */
  failThreshold?: number;
}

/** Outcome of a regression check */
export type RegressionVerdict = 'pass' | 'warn' | 'fail';

/** Detailed result of running regression config checks against a comparison */
export interface RegressionCheck {
  /** The underlying comparison */
  comparison: BenchmarkComparison;
  /** Final verdict: pass, warn, or fail */
  verdict: RegressionVerdict;
  /** Percentage change in mean (fraction) */
  meanChangePercent: number;
  /** Effective warning threshold used */
  warnThreshold: number;
  /** Effective failure threshold used */
  failThreshold: number;
  /** Human-readable message describing the outcome */
  message: string;
}

/** High-level summary of a set of benchmark results */
export interface MAMBenchmarkSummary {
  /** Operation names included in the summary */
  operations: string[];
  /** Total number of measured samples across all operations */
  totalRuns: number;
  /** Combined wall time across all runs (ms) */
  totalTimeMs: number;
  /** Name of the fastest operation (lowest mean) */
  fastest: string;
  /** Name of the slowest operation (highest mean) */
  slowest: string;
  /** Mean of all per-operation means (ms) */
  averageMeanMs: number;
  /** Overall median across all measured samples (ms) */
  overallMedianMs: number;
  /** Timestamp the summary was generated */
  timestamp: string;
}

/** Benchmark operation function */
export type BenchmarkOperation = () => Promise<void> | void;

// ============================================================================
// Benchmark Runner
// ============================================================================

export class MAMBenchmark {
  private results: BenchmarkRunResult[] = [];
  private regressionConfig: RegressionConfig;

  constructor(regressionConfig?: RegressionConfig) {
    this.regressionConfig = {
      threshold: 0.1,
      minSamples: 10,
      strict: false,
      ...regressionConfig,
    };
  }

  // --------------------------------------------------------------------------
  // Running benchmarks
  // --------------------------------------------------------------------------

  /**
   * Run a benchmark operation multiple times
   */
  async run(
    name: string,
    operation: BenchmarkOperation,
    iterations?: number,
    warmupRuns?: number
  ): Promise<BenchmarkRunResult> {
    const totalIterations = iterations ?? this.regressionConfig.minSamples ?? 10;
    const times: number[] = [];
    const startTime = performance.now();

    // Warmup (run once to prime caches)
    const warmups = warmupRuns ?? 1;
    for (let i = 0; i < warmups; i++) {
      await operation();
    }

    // Measured runs
    for (let i = 0; i < totalIterations; i++) {
      const runStart = performance.now();
      await operation();
      times.push(performance.now() - runStart);
    }

    const totalTimeMs = performance.now() - startTime;

    const result: BenchmarkRunResult = {
      operation: name,
      times,
      iterations: totalIterations,
      totalTimeMs,
    };

    this.results.push(result);
    return result;
  }

  /**
   * Run a synchronous benchmark operation
   */
  async runSync(
    name: string,
    operation: () => void,
    iterations?: number,
    warmupRuns?: number
  ): Promise<BenchmarkRunResult> {
    const totalIterations = iterations ?? this.regressionConfig.minSamples ?? 10;
    const times: number[] = [];
    const startTime = performance.now();

    // Warmup
    const warmups = warmupRuns ?? 1;
    for (let i = 0; i < warmups; i++) {
      operation();
    }

    // Measured runs
    for (let i = 0; i < totalIterations; i++) {
      const runStart = performance.now();
      operation();
      times.push(performance.now() - runStart);
    }

    const totalTimeMs = performance.now() - startTime;

    const result: BenchmarkRunResult = {
      operation: name,
      times,
      iterations: totalIterations,
      totalTimeMs,
    };

    this.results.push(result);
    return result;
  }

  /**
   * Run multiple benchmarks in sequence
   */
  async runAll(
    benchmarks: Array<{ name: string; operation: BenchmarkOperation; iterations?: number }>
  ): Promise<BenchmarkRunResult[]> {
    const results: BenchmarkRunResult[] = [];
    for (const bench of benchmarks) {
      results.push(await this.run(bench.name, bench.operation, bench.iterations));
    }
    return results;
  }

  /**
   * Run a warmup pass without recording measurements. Useful to prime
   * JIT caches, module loading, or connection pools before measured runs.
   */
  async warmup(name: string, operation: BenchmarkOperation, warmups?: number): Promise<void> {
    const count = warmups ?? 1;
    for (let i = 0; i < count; i++) {
      await operation();
    }
  }

  /**
   * Run a synchronous warmup pass without recording measurements.
   */
  warmupSync(name: string, operation: () => void, warmups?: number): void {
    const count = warmups ?? 1;
    for (let i = 0; i < count; i++) {
      operation();
    }
  }

  // --------------------------------------------------------------------------
  // Statistical analysis
  // --------------------------------------------------------------------------

  /**
   * Get statistical summary for a benchmark result
   */
  getStats(result: BenchmarkRunResult): BenchmarkStats {
    const sorted = [...result.times].sort((a, b) => a - b);
    const count = sorted.length;

    const mean = sorted.reduce((a, b) => a + b, 0) / count;
    const variance = sorted.reduce((sum, t) => sum + (t - mean) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    const median = this.calculateMedian(sorted);
    const p95 = this.calculatePercentile(sorted, 0.95);
    const p99 = this.calculatePercentile(sorted, 0.99);

    // 95% confidence interval margin of error
    const marginOfError = (1.96 * stdDev) / Math.sqrt(count);

    return {
      operation: result.operation,
      count,
      mean,
      median,
      min: sorted[0],
      max: sorted[count - 1],
      stdDev,
      p95,
      p99,
      variance,
      marginOfError,
    };
  }

  /**
   * Get stats for all stored results
   */
  getAllStats(): BenchmarkStats[] {
    return this.results.map((r) => this.getStats(r));
  }

  /**
   * Get the median execution time for a benchmark result
   */
  getMedian(result: BenchmarkRunResult): number {
    return median(result.times);
  }

  /**
   * Get an arbitrary percentile execution time for a benchmark result
   */
  getPercentile(result: BenchmarkRunResult, p: number): number {
    return percentile(result.times, p);
  }

  // --------------------------------------------------------------------------
  // Comparison and regression detection
  // --------------------------------------------------------------------------

  /**
   * Compare two benchmark results
   */
  compare(baseline: BenchmarkRunResult, current: BenchmarkRunResult): BenchmarkComparison {
    const baselineStats = this.getStats(baseline);
    const currentStats = this.getStats(current);

    const meanChangePercent = (currentStats.mean - baselineStats.mean) / baselineStats.mean;
    const p95ChangePercent = (currentStats.p95 - baselineStats.p95) / baselineStats.p95;

    const threshold = this.regressionConfig.threshold ?? 0.1;
    const hasRegression = meanChangePercent > threshold;
    const strict = this.regressionConfig.strict ?? false;

    let severity: BenchmarkComparison['severity'] = 'none';

    if (hasRegression || (strict && meanChangePercent > 0)) {
      if (meanChangePercent > 0.5) {
        severity = 'severe';
      } else if (meanChangePercent > 0.25) {
        severity = 'moderate';
      } else {
        severity = 'minor';
      }
    }

    return {
      operation: baseline.operation,
      baseline: baselineStats,
      current: currentStats,
      meanChangePercent,
      p95ChangePercent,
      hasRegression,
      severity,
    };
  }

  /**
   * Detect regression between stored results
   */
  detectRegression(
    baselineName: string,
    currentName: string
  ): BenchmarkComparison | null {
    const baseline = this.results.find((r) => r.operation === baselineName);
    const current = this.results.find((r) => r.operation === currentName);

    if (!baseline || !current) {
      return null;
    }

    return this.compare(baseline, current);
  }

  /**
   * Detect regressions for all paired results (same name)
   */
  detectAllRegressions(): BenchmarkComparison[] {
    const grouped = new Map<string, BenchmarkRunResult[]>();

    for (const result of this.results) {
      const existing = grouped.get(result.operation) ?? [];
      existing.push(result);
      grouped.set(result.operation, existing);
    }

    const comparisons: BenchmarkComparison[] = [];

    for (const [, runs] of grouped) {
      if (runs.length >= 2) {
        // Compare last two runs
        const baseline = runs[runs.length - 2];
        const current = runs[runs.length - 1];
        comparisons.push(this.compare(baseline, current));
      }
    }

    return comparisons;
  }

  /**
   * Run regression config checks against all paired results and return verdicts.
   * Each paired comparison is evaluated with warn/fail thresholds derived from
   * the regression configuration.
   */
  checkRegressions(config?: RegressionConfig): RegressionCheck[] {
    const comparisons = this.detectAllRegressions();
    const effective = { ...this.regressionConfig, ...config };
    return comparisons.map((c) => evaluateRegression(c, effective));
  }

  /**
   * Whether any stored paired results fail regression checks under the config.
   */
  hasRegressions(config?: RegressionConfig): boolean {
    return this.checkRegressions(config).some((c) => c.verdict === 'fail');
  }

  /**
   * Build a high-level summary of all stored results
   */
  summarize(): MAMBenchmarkSummary {
    if (this.results.length === 0) {
      return {
        operations: [],
        totalRuns: 0,
        totalTimeMs: 0,
        fastest: '',
        slowest: '',
        averageMeanMs: 0,
        overallMedianMs: 0,
        timestamp: new Date().toISOString(),
      };
    }
    return MAMBenchmarkSummaryBuilder.from(this.results).build();
  }

  // --------------------------------------------------------------------------
  // Results management
  // --------------------------------------------------------------------------

  /**
   * Get all stored results
   */
  getResults(): readonly BenchmarkRunResult[] {
    return this.results;
  }

  /**
   * Clear stored results
   */
  clear(): void {
    this.results = [];
  }

  /**
   * Export results as JSON
   */
  export(): string {
    return JSON.stringify(
      {
        results: this.results,
        stats: this.getAllStats(),
        timestamp: new Date().toISOString(),
      },
      null,
      2
    );
  }

  /**
   * Format stats as a readable table string
   */
  formatTable(): string {
    const stats = this.getAllStats();

    if (stats.length === 0) {
      return 'No benchmark results.';
    }

    const header = [
      'Operation'.padEnd(25),
      'Count'.padStart(6),
      'Mean (ms)'.padStart(12),
      'Median'.padStart(12),
      'P95'.padStart(12),
      'P99'.padStart(12),
      'StdDev'.padStart(12),
    ].join(' | ');

    const separator = '-'.repeat(header.length);

    const rows = stats.map((s) =>
      [
        s.operation.padEnd(25),
        String(s.count).padStart(6),
        s.mean.toFixed(3).padStart(12),
        s.median.toFixed(3).padStart(12),
        s.p95.toFixed(3).padStart(12),
        s.p99.toFixed(3).padStart(12),
        s.stdDev.toFixed(3).padStart(12),
      ].join(' | ')
    );

    return [header, separator, ...rows].join('\n');
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  private calculateMedian(sorted: number[]): number {
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
  }

  private calculatePercentile(sorted: number[], percentile: number): number {
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }
}

// ============================================================================
// Standalone Statistical Helpers
// ============================================================================

/**
 * Compute the arithmetic mean of a set of values
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Compute the median of a set of values
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute an arbitrary percentile (0..1) of a set of values
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Compute the population variance of a set of values
 */
export function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  return values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
}

/**
 * Compute the population standard deviation of a set of values
 */
export function standardDeviation(values: number[]): number {
  return Math.sqrt(variance(values));
}

/**
 * Compute full benchmark statistics from a run result
 */
export function computeStats(result: BenchmarkRunResult): BenchmarkStats {
  const sorted = [...result.times].sort((a, b) => a - b);
  const count = sorted.length;
  const var_ = variance(sorted);

  return {
    operation: result.operation,
    count,
    mean: mean(sorted),
    median: median(sorted),
    min: sorted[0],
    max: sorted[count - 1],
    stdDev: Math.sqrt(var_),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    variance: var_,
    marginOfError: (1.96 * Math.sqrt(var_)) / Math.sqrt(count),
  };
}

// ============================================================================
// MAMBenchmarkSummary Builder
// ============================================================================

/**
 * Incrementally accumulates benchmark results and builds a high-level
 * {@link MAMBenchmarkSummary}. Accepts raw run results or pre-computed stats.
 */
export class MAMBenchmarkSummaryBuilder {
  private stats: BenchmarkStats[] = [];
  private runs: BenchmarkRunResult[] = [];

  /**
   * Add a single benchmark result (raw run or pre-computed stats)
   */
  add(result: BenchmarkRunResult | BenchmarkStats): this {
    if ('times' in result) {
      this.runs.push(result);
      this.stats.push(computeStats(result));
    } else {
      this.stats.push(result);
    }
    return this;
  }

  /**
   * Add multiple benchmark results at once
   */
  addAll(results: BenchmarkRunResult[] | BenchmarkStats[]): this {
    for (const result of results) {
      this.add(result);
    }
    return this;
  }

  /**
   * Build the summary from all accumulated results
   */
  build(): MAMBenchmarkSummary {
    if (this.stats.length === 0) {
      throw new Error('Cannot build a benchmark summary with no entries.');
    }

    const sorted = [...this.stats].sort((a, b) => a.mean - b.mean);
    const allTimes =
      this.runs.length > 0 ? this.runs.flatMap((r) => r.times) : this.stats.map((s) => s.mean);

    return {
      operations: this.stats.map((s) => s.operation),
      totalRuns: this.stats.reduce((sum, s) => sum + s.count, 0),
      totalTimeMs: this.runs.reduce((sum, r) => sum + r.totalTimeMs, 0),
      fastest: sorted[0].operation,
      slowest: sorted[sorted.length - 1].operation,
      averageMeanMs: mean(this.stats.map((s) => s.mean)),
      overallMedianMs: median(allTimes),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Convenience: build a summary directly from results
   */
  static from(results: BenchmarkRunResult[] | BenchmarkStats[]): MAMBenchmarkSummaryBuilder {
    return new MAMBenchmarkSummaryBuilder().addAll(results);
  }
}

/**
 * Build a {@link MAMBenchmarkSummary} from benchmark results
 */
export function buildSummary(
  results: BenchmarkRunResult[] | BenchmarkStats[]
): MAMBenchmarkSummary {
  return MAMBenchmarkSummaryBuilder.from(results).build();
}

// ============================================================================
// Result Formatting
// ============================================================================

/** Options for {@link formatBenchmarkResults} */
export interface FormatBenchmarkOptions {
  /** Number of decimal places for times (default 3) */
  precision?: number;
  /** Append a total row to the table */
  showTotal?: boolean;
}

/**
 * Format benchmark results as an aligned text table
 */
export function formatBenchmarkResults(
  results: BenchmarkRunResult[] | BenchmarkStats[],
  options?: FormatBenchmarkOptions
): string {
  if (results.length === 0) {
    return 'No benchmark results.';
  }

  const precision = options?.precision ?? 3;
  const stats: BenchmarkStats[] = 'times' in results[0]
    ? (results as BenchmarkRunResult[]).map((r) => computeStats(r))
    : (results as BenchmarkStats[]);

  const header = [
    'Operation'.padEnd(25),
    'Count'.padStart(6),
    'Mean (ms)'.padStart(12),
    'Median'.padStart(12),
    'P95'.padStart(12),
    'P99'.padStart(12),
    'StdDev'.padStart(12),
  ].join(' | ');

  const separator = '-'.repeat(header.length);

  const rows = stats.map((s) =>
    [
      s.operation.padEnd(25),
      String(s.count).padStart(6),
      s.mean.toFixed(precision).padStart(12),
      s.median.toFixed(precision).padStart(12),
      s.p95.toFixed(precision).padStart(12),
      s.p99.toFixed(precision).padStart(12),
      s.stdDev.toFixed(precision).padStart(12),
    ].join(' | ')
  );

  const lines = [header, separator, ...rows];

  if (options?.showTotal) {
    lines.push(separator);
    lines.push(
      [
        'TOTAL'.padEnd(25),
        String(stats.reduce((sum, s) => sum + s.count, 0)).padStart(6),
        mean(stats.map((s) => s.mean)).toFixed(precision).padStart(12),
        median(stats.map((s) => s.median)).toFixed(precision).padStart(12),
        ''.padStart(12),
        ''.padStart(12),
        ''.padStart(12),
      ].join(' | ')
    );
  }

  return lines.join('\n');
}

// ============================================================================
// Comparison & Regression Checks
// ============================================================================

/**
 * Compare two benchmark results (raw runs or pre-computed stats) and return a
 * {@link BenchmarkComparison} describing the percentage change between them.
 */
export function compareBenchmarks(
  a: BenchmarkRunResult | BenchmarkStats,
  b: BenchmarkRunResult | BenchmarkStats,
  config?: RegressionConfig
): BenchmarkComparison {
  const baseline = 'times' in a ? computeStats(a) : a;
  const current = 'times' in b ? computeStats(b) : b;

  const meanChangePercent = (current.mean - baseline.mean) / (baseline.mean || 1);
  const p95ChangePercent = (current.p95 - baseline.p95) / (baseline.p95 || 1);

  const threshold = config?.threshold ?? 0.1;
  const hasRegression = meanChangePercent > threshold;
  const strict = config?.strict ?? false;

  let severity: BenchmarkComparison['severity'] = 'none';

  if (hasRegression || (strict && meanChangePercent > 0)) {
    if (meanChangePercent > 0.5) {
      severity = 'severe';
    } else if (meanChangePercent > 0.25) {
      severity = 'moderate';
    } else {
      severity = 'minor';
    }
  }

  return {
    operation: baseline.operation,
    baseline,
    current,
    meanChangePercent,
    p95ChangePercent,
    hasRegression,
    severity,
  };
}

/**
 * Evaluate a comparison against regression config thresholds and produce a
 * verdict of `pass`, `warn`, or `fail` plus a human-readable message.
 */
export function evaluateRegression(
  comparison: BenchmarkComparison,
  config?: RegressionConfig
): RegressionCheck {
  const threshold = config?.threshold ?? 0.1;
  const warnThreshold = config?.warnThreshold ?? threshold;
  const failThreshold =
    config?.failThreshold ?? (config?.strict ? 0 : Math.max(warnThreshold * 2, warnThreshold + 0.1));

  const meanChangePercent = comparison.meanChangePercent;
  const pct = (meanChangePercent * 100).toFixed(1);

  let verdict: RegressionVerdict;
  let detail: string;

  if (meanChangePercent > failThreshold) {
    verdict = 'fail';
    detail = `regressed by ${pct}% (fail threshold ${(failThreshold * 100).toFixed(1)}%)`;
  } else if (meanChangePercent > warnThreshold) {
    verdict = 'warn';
    detail = `regressed by ${pct}% (warn threshold ${(warnThreshold * 100).toFixed(1)}%)`;
  } else {
    verdict = 'pass';
    detail = `within bounds (${pct}% change, warn threshold ${(warnThreshold * 100).toFixed(1)}%)`;
  }

  return {
    comparison,
    verdict,
    meanChangePercent,
    warnThreshold,
    failThreshold,
    message: `Operation "${comparison.operation}" ${detail}`,
  };
}

// ============================================================================
// Convenience Runner
// ============================================================================

/** Options for {@link benchmarkRuns} */
export interface BenchmarkRunOptions {
  /** Operation name recorded on the result (default 'benchmark') */
  name?: string;
  /** Number of measured iterations (default 10) */
  iterations?: number;
  /** Number of warmup iterations before measuring (default 1) */
  warmupRuns?: number;
}

/**
 * Run a single benchmark operation with warmup and return a raw run result.
 * Convenience wrapper that does not require instantiating {@link MAMBenchmark}.
 */
export async function benchmarkRuns(
  fn: BenchmarkOperation,
  options?: BenchmarkRunOptions
): Promise<BenchmarkRunResult> {
  const name = options?.name ?? 'benchmark';
  const iterations = options?.iterations ?? 10;
  const warmupRuns = options?.warmupRuns ?? 1;
  const times: number[] = [];
  const startTime = performance.now();

  for (let i = 0; i < warmupRuns; i++) {
    await fn();
  }

  for (let i = 0; i < iterations; i++) {
    const runStart = performance.now();
    await fn();
    times.push(performance.now() - runStart);
  }

  return {
    operation: name,
    times,
    iterations,
    totalTimeMs: performance.now() - startTime,
  };
}
