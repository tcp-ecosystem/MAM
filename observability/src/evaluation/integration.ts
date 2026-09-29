/**
 * @fileoverview High-level evaluation API that ties the layer together.
 *
 * `integration.ts` exposes the entry points the MAM observability engine uses
 * day to day:
 *
 * - {@link Evaluator} — scores a single named check, aggregates metrics into a
 *   weighted score, and runs {@link QualityGate}s over the result;
 * - {@link EvaluationEngine} — collects many evaluations, aggregates them into
 *   {@link EvaluationStats}, and emits a summary suited for dashboards and CI;
 * - {@link createEvaluator} / {@link createEvaluationEngine} — factory helpers
 *   that merge a caller config over the {@link DEFAULT_CONFIG}.
 *
 * All scores are handled in ratio space (0-1) internally; the configured
 * `scale` only affects reporting and summary output.
 */

import {
  DEFAULT_CONFIG,
  DEFAULT_GATES,
  EvalOptions,
  EvaluationCheck,
  EvaluationConfig,
  EvaluationMetric,
  EvaluationResult,
  EvaluationStats,
  EvaluationThreshold,
  QualityGate,
  convertScore,
  evaluateThreshold,
  isQualityGate,
  round,
} from "./types.js";
import { EvaluationStore } from "./store.js";
import { EvaluationIndex } from "./index.js";
import { EvaluationLifecycle } from "./lifecycle.js";
import { EvaluationQuery } from "./retrieval.js";

/**
 * Result of running a result through the configured quality gates. Produced by
 * {@link Evaluator.gate}.
 */
export interface GateReport {
  /** The result, with `checks` populated and `passed` recomputed. */
  result: EvaluationResult;
  /** The raw per-gate outcomes, for detailed reporting. */
  outcomes: Array<{
    gate: string;
    passed: boolean;
    actual: number;
    expected?: number;
    message?: string;
    weight: number;
  }>;
  /** Weighted fraction of enabled gates that passed, in [0, 1]. */
  gateScore: number;
}

/**
 * A single suite item consumed by {@link EvaluationEngine.runSuite}.
 */
export interface SuiteItem {
  /** Name of the evaluation to run. */
  name: string;
  /** Raw score for the evaluation, in ratio space (0-1). */
  score: number;
  /** Optional evaluation options. */
  opts?: EvalOptions;
}

/**
 * Scores individual named checks and applies quality gates.
 *
 * An `Evaluator` is configured once with thresholds, weights and gates, then
 * reused for many evaluations. It is intentionally stateless apart from its
 * config: pass results to an {@link EvaluationEngine} (or a store/lifecycle)
 * for persistence and aggregation.
 *
 * @example
 * const evaluator = createEvaluator();
 * const result = evaluator.evaluate("answer_accuracy", 0.91);
 * const gated = evaluator.gate(result);
 * console.log(gated.gateScore); // 0.75 (3 of 4 default gates passed)
 */
export class Evaluator {
  /** Effective configuration, merged with {@link DEFAULT_CONFIG}. */
  private readonly config: EvaluationConfig;
  /** Optional store the evaluator can persist results into. */
  private readonly store?: EvaluationStore | EvaluationLifecycle;

  /**
   * Create an evaluator.
   *
   * @param config Partial config; missing keys are filled from the defaults.
   * @param store Optional store/lifecycle used by `record()`.
   */
  constructor(config: Partial<EvaluationConfig> = {}, store?: EvaluationStore | EvaluationLifecycle) {
    const merged: EvaluationConfig = {
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...(config.thresholds ?? {}) },
      weights: { ...DEFAULT_CONFIG.weights, ...(config.weights ?? {}) },
      gates: mergeGates(config.gates, config.includeDefaultGates),
      scale: config.scale ?? DEFAULT_CONFIG.scale ?? "ratio",
      includeDefaultGates: config.includeDefaultGates ?? true,
      scope: config.scope,
    };
    this.config = merged;
    this.store = store;
  }

  /**
   * The effective configuration in force for this evaluator.
   *
   * @returns A defensive copy of the config.
   */
  getConfig(): EvaluationConfig {
    return { ...this.config, gates: [...(this.config.gates ?? [])] };
  }

  /**
   * Evaluate a single named check with a raw score.
   *
   * The pass decision is derived from the named threshold: `opts.threshold`
   * wins, then `config.thresholds[name]`, then the default accuracy gate.
   *
   * @param name The name of the evaluation.
   * @param score The raw score, ratio space (0-1).
   * @param opts Optional overrides (id, timestamp, metrics, checks, threshold).
   * @returns A fully formed {@link EvaluationResult}.
   */
  evaluate(name: string, score: number, opts: EvalOptions = {}): EvaluationResult {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("Evaluator.evaluate: `name` must be a non-empty string");
    }
    const value = Number(score);
    if (!Number.isFinite(value)) {
      throw new Error(`Evaluator.evaluate: invalid score for "${name}"`);
    }
    const clamped = Math.min(Math.max(value, 0), 1);
    const threshold =
      opts.threshold ?? this.config.thresholds[name] ?? DEFAULT_CONFIG.thresholds.accuracy;
    const passed =
      typeof opts.passed === "boolean" ? opts.passed : evaluateThreshold(threshold, clamped);
    const metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
    const checks = Array.isArray(opts.checks) ? opts.checks : undefined;
    return {
      id: opts.id ?? `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      name,
      score: round(clamped),
      passed,
      metrics,
      timestamp: opts.timestamp ?? Date.now(),
      checks,
      metadata: opts.metadata,
    };
  }

  /**
   * Aggregate a set of metrics into a single weighted score.
   *
   * Each metric's weight is resolved as: `config.weights[metric.name]` first,
   * then the metric's own `weight`, then `1`. The score is the weighted mean of
   * the (clamped) metric values. Per-metric thresholds are evaluated and
   * surfaced as checks; the overall pass decision is the weighted fraction of
   * metrics that passed their thresholds, falling back to the accuracy
   * threshold when no metric carries one.
   *
   * @param metrics The metrics to aggregate.
   * @param name Optional evaluation name (default "weighted_metrics").
   * @returns An {@link EvaluationResult} carrying metrics and checks.
   */
  evaluateMetrics(metrics: EvaluationMetric[], name = "weighted_metrics"): EvaluationResult {
    if (!Array.isArray(metrics) || metrics.length === 0) {
      throw new Error("Evaluator.evaluateMetrics: at least one metric is required");
    }
    const weights = metrics.map((metric) => {
      const configured = this.config.weights[metric.name];
      if (configured !== undefined) return configured;
      if (metric.weight !== undefined) return metric.weight;
      return 1;
    });
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || 1;

    let weightedScore = 0;
    for (let i = 0; i < metrics.length; i += 1) {
      const value = Math.min(Math.max(metrics[i].value, 0), 1);
      weightedScore += value * weights[i];
    }
    weightedScore = weightedScore / totalWeight;

    const checks: EvaluationCheck[] = metrics.map((metric) => {
      const threshold =
        metric.threshold ??
        this.config.thresholds[metric.name] ??
        this.config.thresholds.accuracy;
      const passed = evaluateThreshold(threshold, metric.value);
      return {
        name: metric.name,
        passed,
        value: metric.value,
        score: passed ? 1 : 0,
        detail: threshold.description ?? `${metric.name} ${passed ? "passed" : "failed"}`,
      };
    });
    const weightedPassRate =
      checks.reduce((sum, check, i) => sum + (check.passed ? weights[i] : 0), 0) / totalWeight;
    const hasAnyThreshold = metrics.some(
      (m) => m.threshold !== undefined || this.config.thresholds[m.name] !== undefined,
    );
    const passed = hasAnyThreshold
      ? weightedPassRate >= 0.5
      : weightedScore >= (this.config.thresholds.accuracy.value ?? 0.6);

    const normalizedMetrics = metrics.map((metric) => ({
      ...metric,
      weight: weights[metrics.indexOf(metric)],
    }));

    return {
      id: `${name}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
      name,
      score: round(weightedScore),
      passed,
      metrics: normalizedMetrics,
      checks,
      timestamp: Date.now(),
    };
  }

  /**
   * Run every enabled quality gate against a result.
   *
   * Each gate is evaluated against the metric of the same name (when present on
   * the result) or against the result's overall score otherwise. The result is
   * returned with `checks` populated and `passed` recomputed as the weighted
   * fraction of enabled gates that succeeded (>= 0.5).
   *
   * @param result The result to gate.
   * @returns A {@link GateReport} with the gated result and per-gate outcomes.
   */
  gate(result: EvaluationResult): GateReport {
    const gates = this.config.gates ?? [];
    const enabled = gates.filter((g) => g.enabled !== false);
    if (enabled.length === 0) {
      return {
        result,
        outcomes: [],
        gateScore: result.passed ? 1 : 0,
      };
    }

    const outcomes: GateReport["outcomes"] = enabled.map((gate) => {
      const metric = result.metrics.find((m) => m.name === gate.name);
      const actual = metric ? metric.value : result.score;
      const passed = evaluateThreshold(gate.threshold, actual);
      return {
        gate: gate.name,
        passed,
        actual: round(actual),
        expected: gate.threshold.value,
        message: passed
          ? `${gate.name}: ok`
          : `${gate.name}: ${round(actual)} outside threshold ${gate.threshold.description ?? ""}`.trim(),
        weight: gate.weight ?? 1,
      };
    });

    const totalWeight = outcomes.reduce((sum, o) => sum + o.weight, 0) || 1;
    const gateScore =
      outcomes.reduce((sum, o) => sum + (o.passed ? o.weight : 0), 0) / totalWeight;
    const passed = gateScore >= 0.5;

    const checks: EvaluationCheck[] = outcomes.map((o) => ({
      name: o.gate,
      passed: o.passed,
      value: o.actual,
      score: o.passed ? 1 : 0,
      detail: o.message,
    }));

    return {
      result: {
        ...result,
        passed,
        checks: [...(result.checks ?? []), ...checks],
      },
      outcomes,
      gateScore: round(gateScore),
    };
  }

  /**
   * Persist a result into the optional store/lifecycle handed to the
   * constructor.
   *
   * @param result The result to record.
   * @returns The stored result.
   * @throws {Error} When no store was configured.
   */
  record(result: EvaluationResult): EvaluationResult {
    if (!this.store) {
      throw new Error("Evaluator.record: no store configured; pass one to the constructor");
    }
    return this.store.record(result);
  }

  /**
   * Convenience: evaluate, gate, and record in one call.
   *
   * @param name The evaluation name.
   * @param score The raw score.
   * @param opts Optional evaluation options.
   * @returns The gated result, recorded when a store is present.
   */
  evaluateAndGate(name: string, score: number, opts: EvalOptions = {}): EvaluationResult {
    const result = this.evaluate(name, score, opts);
    const gated = this.gate(result).result;
    if (this.store) {
      this.store.record(gated);
    }
    return gated;
  }

  /**
   * The effective gates, for inspection.
   *
   * @returns A copy of the enabled gates.
   */
  gates(): QualityGate[] {
    return [...(this.config.gates ?? [])];
  }
}

/**
 * Aggregates many evaluations into summary statistics.
 *
 * The engine owns an {@link Evaluator} (and optionally a store) and accumulates
 * results over its lifetime. `summary()` renders the current picture for
 * dashboards, CI gates and release decisions.
 *
 * @example
 * const engine = createEvaluationEngine();
 * engine.runSuite([
 *   { name: "accuracy", score: 0.92 },
 *   { name: "quality", score: 0.61 },
 * ]);
 * console.log(engine.summary().stats.passRate); // 0.5
 */
export class EvaluationEngine {
  /** The evaluator used to produce results. */
  private readonly evaluator: Evaluator;
  /** Results accumulated by this engine. */
  private readonly results: EvaluationResult[] = [];

  /**
   * Create an engine.
   *
   * @param config Partial config forwarded to the internal evaluator.
   * @param store Optional store/lifecycle results are also persisted into.
   */
  constructor(config: Partial<EvaluationConfig> = {}, store?: EvaluationStore | EvaluationLifecycle) {
    this.evaluator = new Evaluator(config, store);
  }

  /**
   * The internal evaluator, for direct use.
   *
   * @returns The evaluator.
   */
  getEvaluator(): Evaluator {
    return this.evaluator;
  }

  /**
   * Run a single evaluation, gated, and accumulate the result.
   *
   * @param name The evaluation name.
   * @param score The raw score.
   * @param opts Optional evaluation options.
   * @returns The gated result, also stored in the engine.
   */
  evaluate(name: string, score: number, opts: EvalOptions = {}): EvaluationResult {
    const gated = this.evaluator.evaluateAndGate(name, score, opts);
    this.results.push(gated);
    return gated;
  }

  /**
   * Add an already-produced result to the engine's collection.
   *
   * @param result The result to add.
   * @returns The same result, for chaining.
   */
  add(result: EvaluationResult): EvaluationResult {
    this.results.push(result);
    return result;
  }

  /**
   * Run an entire suite of evaluations in one call.
   *
   * @param items The suite items to run.
   * @returns The gated results, in order.
   */
  runSuite(items: SuiteItem[]): EvaluationResult[] {
    const produced: EvaluationResult[] = [];
    for (const item of items) {
      produced.push(this.evaluate(item.name, item.score, item.opts));
    }
    return produced;
  }

  /**
   * Aggregate statistics over the accumulated results.
   *
   * @returns {@link EvaluationStats} for everything the engine has run.
   */
  aggregate(results: EvaluationResult[] = this.results): EvaluationStats {
    const scale = this.evaluator.getConfig().scale ?? "ratio";
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const scores = results.map((r) => convertScore(r.score, "ratio", scale));
    const averageScore = total === 0 ? 0 : scores.reduce((s, x) => s + x, 0) / total;
    const bestScore = total === 0 ? 0 : Math.max(...scores);
    const worstScore = total === 0 ? 0 : Math.min(...scores);
    const sorted = [...scores].sort((a, b) => a - b);
    const medianScore =
      total === 0
        ? 0
        : total % 2 === 1
          ? sorted[(total - 1) / 2]
          : (sorted[total / 2 - 1] + sorted[total / 2]) / 2;
    const variance =
      total === 0 ? 0 : scores.reduce((s, x) => s + (x - averageScore) ** 2, 0) / total;

    const byName: EvaluationStats["byName"] = {};
    for (const result of results) {
      const bucket = byName[result.name] ?? { total: 0, passed: 0, averageScore: 0 };
      bucket.total += 1;
      if (result.passed) bucket.passed += 1;
      bucket.averageScore += convertScore(result.score, "ratio", scale);
      byName[result.name] = bucket;
    }
    for (const name of Object.keys(byName)) {
      byName[name].averageScore = byName[name].total
        ? byName[name].averageScore / byName[name].total
        : 0;
    }

    let totalChecks = 0;
    let totalChecksPassed = 0;
    for (const result of results) {
      if (!result.checks) continue;
      for (const check of result.checks) {
        totalChecks += 1;
        if (check.passed) totalChecksPassed += 1;
      }
    }

    return {
      total,
      passed,
      failed,
      passRate: total === 0 ? 0 : passed / total,
      averageScore: round(averageScore),
      bestScore: round(bestScore),
      worstScore: round(worstScore),
      medianScore: round(medianScore),
      standardDeviation: round(Math.sqrt(variance)),
      byName,
      totalChecks,
      totalChecksPassed,
    };
  }

  /**
   * Render a full summary of the engine's state for reporting.
   *
   * @returns A structured summary with stats, gate outcomes, and config.
   */
  summary(): {
    stats: EvaluationStats;
    gates: QualityGate[];
    config: EvaluationConfig;
    generatedAt: number;
  } {
    return {
      stats: this.aggregate(),
      gates: this.evaluator.gates(),
      config: this.evaluator.getConfig(),
      generatedAt: Date.now(),
    };
  }

  /**
   * Query the accumulated results.
   *
   * @returns An {@link EvaluationQuery} over the engine's results.
   */
  query(): EvaluationQuery {
    return new EvaluationQuery(this.results, this.evaluator.getConfig().scale);
  }

  /**
   * Number of results accumulated.
   */
  get size(): number {
    return this.results.length;
  }

  /**
   * Clear all accumulated results (the evaluator config is untouched).
   */
  clear(): void {
    this.results.length = 0;
  }
}

/**
 * Merge caller gates with the default gate set.
 *
 * @param gates Caller-supplied gates.
 * @param includeDefaults Whether defaults should be appended.
 * @returns The merged gate list.
 */
function mergeGates(
  gates: QualityGate[] | undefined,
  includeDefaults: boolean | undefined,
): QualityGate[] {
  const custom = (gates ?? []).filter(isQualityGate);
  if (includeDefaults === false) return custom;
  const customNames = new Set(custom.map((g) => g.name));
  const defaults = DEFAULT_GATES.filter((g) => !customNames.has(g.name));
  return [...defaults, ...custom];
}

/**
 * Create a fully configured {@link Evaluator} over the default config.
 *
 * @param config Optional overrides merged onto {@link DEFAULT_CONFIG}.
 * @param store Optional store/lifecycle for persistence.
 * @returns A ready-to-use evaluator.
 */
export function createEvaluator(
  config: Partial<EvaluationConfig> = {},
  store?: EvaluationStore | EvaluationLifecycle,
): Evaluator {
  return new Evaluator(config, store);
}

/**
 * Create a fully configured {@link EvaluationEngine} over the default config.
 *
 * @param config Optional overrides merged onto {@link DEFAULT_CONFIG}.
 * @param store Optional store/lifecycle for persistence.
 * @returns A ready-to-use engine.
 */
export function createEvaluationEngine(
  config: Partial<EvaluationConfig> = {},
  store?: EvaluationStore | EvaluationLifecycle,
): EvaluationEngine {
  return new EvaluationEngine(config, store);
}

/**
 * Helper: resolve a named threshold, falling back to the default accuracy
 * threshold when the name is unknown.
 *
 * @param thresholds The threshold map to search.
 * @param name The threshold name.
 * @returns The resolved threshold.
 */
export function resolveThreshold(
  thresholds: Record<string, EvaluationThreshold>,
  name: string,
): EvaluationThreshold {
  return thresholds[name] ?? DEFAULT_CONFIG.thresholds.accuracy;
}