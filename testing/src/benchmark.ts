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
    iterations?: number
  ): Promise<BenchmarkRunResult> {
    const totalIterations = iterations ?? this.regressionConfig.minSamples ?? 10;
    const times: number[] = [];
    const startTime = performance.now();

    // Warmup (run once to prime caches)
    await operation();

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
    iterations?: number
  ): Promise<BenchmarkRunResult> {
    const totalIterations = iterations ?? this.regressionConfig.minSamples ?? 10;
    const times: number[] = [];
    const startTime = performance.now();

    // Warmup
    operation();

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
