/**
 * @fileoverview Core type definitions for the MAM Observability Evaluation layer.
 *
 * The Evaluation layer scores outputs produced by the MAM engine (responses,
 * extractions, tool calls, plans) and runs quality gates that enforce
 * thresholds around accuracy, latency, cost and generic quality checks.
 *
 * Every public shape consumed or produced by the classes in this directory is
 * declared here so that `store.ts`, `index.ts`, `retrieval.ts`, `lifecycle.ts`
 * and `integration.ts` can share one vocabulary without circular imports.
 *
 * All types are intentionally structural (plain interfaces / type aliases) so
 * consumers can supply plain object literals and still get full inference.
 */

/**
 * Unit of measure attached to an {@link EvaluationMetric}. Kept as a closed
 * union so serialisation and reporting code can render human-friendly labels.
 */
export type MetricUnit =
  | "count"
  | "ms"
  | "s"
  | "usd"
  | "usdPer1k"
  | "percent"
  | "bytes"
  | "tokens"
  | "ratio"
  | "score"
  | "plain";

/**
 * Comparator used when a threshold must be evaluated against a raw value.
 * Mirrors the operators available to {@link QualityGate}.
 */
export type ThresholdComparison =
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "eq"
  | "neq"
  | "range"
  | "in";

/**
 * A single measured quantity recorded on an {@link EvaluationResult}.
 *
 * Metrics are the raw material the evaluation layer turns into a score. Each
 * metric may carry its own threshold (e.g. "p95 latency must be below 500 ms")
 * and its own weight, which is how {@link Integration.Evaluator} derives a
 * weighted average score when multiple metrics are supplied at once.
 */
export interface EvaluationMetric {
  /** Machine readable, stable identifier for the metric (e.g. "latency_p95"). */
  name: string;
  /** Numeric value measured for this metric. */
  value: number;
  /** Optional unit of measurement used for display and gating. */
  unit?: MetricUnit;
  /**
   * Optional per-metric threshold. When present, the metric is considered
   * "passed" by applying {@link EvaluationThreshold.evaluate}. Used by
   * {@link Integration.Evaluator.evaluateMetrics} and quality gates.
   */
  threshold?: EvaluationThreshold;
  /**
   * Optional weight in the range [0, 1]. When weights are aggregated the
   * metric contributes `value * weight`; weights are normalised internally so
   * they never have to sum to one.
   */
  weight?: number;
  /**
   * Whether this single metric satisfied its own threshold. Derived lazily by
   * tooling; when not supplied it is computed from `threshold`.
   */
  passed?: boolean;
  /** Free-form extra context (source step, prompt id, run id, ...). */
  metadata?: Record<string, unknown>;
}

/**
 * A named, user-facing threshold description bound to a value or a range.
 *
 * Thresholds express the boundary between "acceptable" and "unacceptable" for
 * a metric or gate. Two families are supported:
 *
 * - Range thresholds: only `min` / `max` are set. A value passes when it falls
 *   inside `[min, max]`.
 * - Comparator thresholds: `value` + `comparison` are set. The comparison is
 *   applied with {@link ThresholdComparison} semantics.
 */
export interface EvaluationThreshold {
  /** Lower bound for a range comparison. Ignored unless `comparison === "range"`. */
  min?: number;
  /** Upper bound for a range comparison. Ignored unless `comparison === "range"`. */
  max?: number;
  /**
   * Reference value for comparator thresholds. When set together with
   * `comparison` the threshold is evaluated as `actual <op> value`.
   */
  value?: number;
  /**
   * Comparison operator. Defaults to `"range"` when `min`/`max` are present and
   * to `"gte"` otherwise.
   */
  comparison?: ThresholdComparison;
  /**
   * Optional list of values for the `"in"` comparison. When present, a value
   * passes only if it is a member of the list (numeric equality).
   */
  in?: number[];
  /** Human readable explanation of what the threshold enforces. */
  description?: string;

  /** Evaluate a raw numeric value against this threshold. Returns a boolean. */
  evaluate?(value: number): boolean;
}

/**
 * A single quality gate evaluated against a numeric value or an
 * {@link EvaluationResult} score.
 *
 * Quality gates are the decision points of the evaluation layer. They bundle a
 * human readable name ("cost_budget", "accuracy_min", ...), a threshold and a
 * weight. {@link Integration.Evaluator.gate} runs a result through every gate
 * in the {@link EvaluationConfig} and decides whether the overall output
 * "passed" based on weighted gate outcomes.
 */
export interface QualityGate {
  /** Stable unique name of the gate (e.g. "latency_p99_gate"). */
  name: string;
  /** Threshold this gate enforces. */
  threshold: EvaluationThreshold;
  /**
   * Weight controlling how much this gate contributes to the aggregate gate
   * score. Defaults to 1.
   */
  weight?: number;
  /** Optional unit label for reporting. */
  unit?: MetricUnit;
  /** Human readable description surfaced in reports and logs. */
  description?: string;
  /** Whether the gate is active. Inactive gates are skipped. */
  enabled?: boolean;
}

/**
 * The outcome of evaluating a single {@link QualityGate} against a value.
 * Instances of this shape are stored on {@link EvaluationResult.checks}.
 */
export interface GateOutcome {
  /** Name of the gate that was evaluated. */
  gate: string;
  /** Whether the value satisfied the gate's threshold. */
  passed: boolean;
  /** The actual value that was measured. */
  actual: number;
  /** The value the gate was compared against (for comparator gates). */
  expected?: number;
  /** Human readable description of why the gate passed or failed. */
  message?: string;
  /** Weight applied to this gate during aggregation. */
  weight: number;
}

/**
 * A standalone check attached to an {@link EvaluationResult}.
 *
 * Checks are the fine-grained evidence behind a score. They are recorded as a
 * flat list on the result so that downstream tooling (dashboards, CI gates,
 * alerting) can render pass/fail state per check without re-evaluating.
 */
export interface EvaluationCheck {
  /** Stable name of the check (e.g. "no_hallucinated_entities"). */
  name: string;
  /** Whether the check passed. */
  passed: boolean;
  /** Optional score contribution in [0, 1] when the check is graded. */
  score?: number;
  /** Optional free-form detail or evidence for the check outcome. */
  detail?: string;
  /** Optional numeric value measured for the check (e.g. BLEU score). */
  value?: number;
}

/**
 * The canonical record produced by the evaluation layer for one scored output.
 *
 * Every class in this directory operates on `EvaluationResult`. The result is
 * intentionally denormalised: it carries its score, pass/fail decision,
 * associated metrics, and optional per-gate checks in one immutable object.
 */
export interface EvaluationResult {
  /** Stable unique identifier for the result (usually a UUID). */
  id: string;
  /**
   * Logical name of the evaluation this result belongs to
   * (e.g. "answer_accuracy", "tool_call_correctness", "latency_budget").
   */
  name: string;
  /** Aggregate score in the range [0, 1] (or [0, 100] depending on config). */
  score: number;
  /** Whether the overall evaluation passed its configured quality bar. */
  passed: boolean;
  /**
   * Raw metrics captured during the evaluation. Each metric may carry its own
   * threshold and weight.
   */
  metrics: EvaluationMetric[];
  /** Epoch milliseconds at which the evaluation completed. */
  timestamp: number;
  /**
   * Optional per-gate/per-check outcomes. Populated when the result was
   * produced through {@link Integration.Evaluator.gate} or `evaluateMetrics`.
   */
  checks?: EvaluationCheck[];
  /** Optional free-form metadata attached to the result. */
  metadata?: Record<string, unknown>;
}

/**
 * Weight map used by {@link Integration.Evaluator.evaluateMetrics} to combine
 * individual metrics into a single score. Keys are metric names, values are
 * weights (any finite number; normalisation happens internally).
 */
export type EvaluationWeights = Record<string, number>;

/**
 * Named threshold map used by {@link EvaluationConfig}. Keys are metric names
 * or gate names, values are thresholds.
 */
export type EvaluationThresholds = Record<string, EvaluationThreshold>;

/**
 * Configuration that drives scoring and gating behaviour for one evaluator.
 *
 * - `thresholds` map names to {@link EvaluationThreshold}s and is used by
 *   {@link Integration.Evaluator} to decide whether a named evaluation passed.
 * - `weights` map names to weights used when aggregating a score.
 * - `gates` list the {@link QualityGate}s run by `gate()`.
 */
export interface EvaluationConfig {
  /** Named thresholds keyed by metric/evaluation name. */
  thresholds: EvaluationThresholds;
  /** Named weights keyed by metric/evaluation name. */
  weights: EvaluationWeights;
  /** Quality gates applied when gating a result. */
  gates?: QualityGate[];
  /**
   * Score scale the evaluator reports in: 0-1 ("ratio") or 0-100 ("percent").
   * Defaults to "ratio".
   */
  scale?: "ratio" | "percent";
  /**
   * When `true` the default gate set (accuracy >= 0.6, latency, cost, quality)
   * is merged with any custom gates. Defaults to `true`.
   */
  includeDefaultGates?: boolean;
  /** Optional human readable scope label (e.g. "prod", "canary"). */
  scope?: string;
}

/**
 * Options accepted by {@link Integration.Evaluator.evaluate} when producing a
 * single {@link EvaluationResult}.
 */
export interface EvalOptions {
  /** Optional explicit id. A UUID is generated when omitted. */
  id?: string;
  /** Optional explicit timestamp. `Date.now()` when omitted. */
  timestamp?: number;
  /** Optional metrics recorded alongside the score. */
  metrics?: EvaluationMetric[];
  /** Optional per-check outcomes attached to the result. */
  checks?: EvaluationCheck[];
  /**
   * Optional override of the named threshold from the config. When supplied
   * the threshold wins over the configured one for this evaluation.
   */
  threshold?: EvaluationThreshold;
  /** Optional override of the named weight for this evaluation. */
  weight?: number;
  /** Optional free-form metadata attached to the result. */
  metadata?: Record<string, unknown>;
  /** Optional explicit pass decision. Computed from the threshold when omitted. */
  passed?: boolean;
}

/**
 * Aggregated statistics over a collection of {@link EvaluationResult}s.
 *
 * Produced by {@link Store.EvaluationStore.stats}, {@link Integration.EvaluationEngine.summary}
 * and {@link Retrieval.EvaluationQuery.averageScore}.
 */
export interface EvaluationStats {
  /** Total number of results in the collection. */
  total: number;
  /** Number of results whose `passed` flag is `true`. */
  passed: number;
  /** Number of results whose `passed` flag is `false`. */
  failed: number;
  /** Fraction of results that passed in [0, 1]. */
  passRate: number;
  /** Arithmetic mean of all scores. */
  averageScore: number;
  /** Maximum score observed. */
  bestScore: number;
  /** Minimum score observed. */
  worstScore: number;
  /** Median score observed. */
  medianScore: number;
  /** Sample standard deviation of scores. */
  standardDeviation: number;
  /** Per-name breakdown of counts and average scores. */
  byName: Record<string, { total: number; passed: number; averageScore: number }>;
  /** Total number of checks recorded across all results. */
  totalChecks: number;
  /** Number of checks that passed across all results. */
  totalChecksPassed: number;
}

/**
 * Summary returned by `prune()` operations describing what was removed.
 * Emitted with the lifecycle `"prune"` event and returned directly by
 * {@link Lifecycle.EvaluationLifecycle.prune}.
 */
export interface PruneSummary {
  /** Number of results removed. */
  removed: number;
  /** Number of results that remain after pruning. */
  remaining: number;
  /** Epoch ms cutoff used for the prune. */
  cutoff: number;
  /** Ids of the results that were removed. */
  ids: string[];
}

/**
 * Event names and payloads emitted by {@link Lifecycle.EvaluationLifecycle}.
 * `record` fires whenever a new result is recorded; `prune` fires whenever a
 * prune removes at least one result.
 */
export interface EvaluationEvents {
  record: EvaluationResult;
  prune: PruneSummary;
}

/** Listener callback type for lifecycle events. */
export type EvaluationListener<K extends keyof EvaluationEvents> = (
  payload: EvaluationEvents[K],
) => void;

/**
 * Options accepted by {@link Lifecycle.EvaluationLifecycle} when it creates
 * its internal store and index.
 */
export interface EvaluationLifecycleOptions {
  /** Maximum number of results kept in the store before automatic pruning. */
  capacity?: number;
  /** Interval in ms for periodic automatic pruning when `start()` is called. */
  pruneIntervalMs?: number;
}

/**
 * Options accepted by {@link Store.EvaluationStore}.
 */
export interface EvaluationStoreOptions {
  /**
   * Optional maximum capacity. When exceeded, the store drops the oldest
   * results (by timestamp) before inserting new ones.
   */
  capacity?: number;
}

/**
 * A generic predicate used to filter collections of results in retrieval and
 * index code.
 */
export type ResultPredicate = (result: EvaluationResult) => boolean;

/** Resolve a partial value to its optional full form. */
export type Maybe<T> = T | null | undefined;

/** Recursively make every property of T read-only. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

/**
 * The set of metric units recognised by the evaluation layer. Kept as a
 * runtime array so code can validate user-supplied units without a switch.
 */
export const METRIC_UNITS: readonly MetricUnit[] = [
  "count",
  "ms",
  "s",
  "usd",
  "usdPer1k",
  "percent",
  "bytes",
  "tokens",
  "ratio",
  "score",
  "plain",
] as const;

/**
 * Default threshold for the accuracy gate: score must be at least 0.6.
 * Sensible for most LLM quality checks; override via {@link EvaluationConfig}.
 */
export const DEFAULT_ACCURACY_THRESHOLD: EvaluationThreshold = {
  value: 0.6,
  comparison: "gte",
  description: "Accuracy gate requires a score of at least 0.6",
};

/**
 * Default threshold for the latency gate: p95 latency must stay under 2000 ms.
 */
export const DEFAULT_LATENCY_THRESHOLD: EvaluationThreshold = {
  value: 2000,
  comparison: "lte",
  description: "Latency gate requires p95 latency of at most 2000 ms",
};

/**
 * Default threshold for the cost gate: cost per 1k tokens must stay under
 * $0.05 USD.
 */
export const DEFAULT_COST_THRESHOLD: EvaluationThreshold = {
  value: 0.05,
  comparison: "lte",
  description: "Cost gate requires at most $0.05 per 1k tokens",
};

/**
 * Default threshold for the generic quality gate: score must be at least 0.7.
 */
export const DEFAULT_QUALITY_THRESHOLD: EvaluationThreshold = {
  value: 0.7,
  comparison: "gte",
  description: "Quality gate requires a score of at least 0.7",
};

/**
 * The default {@link QualityGate}s applied by the evaluator unless the config
 * disables them via `includeDefaultGates`.
 */
export const DEFAULT_GATES: readonly QualityGate[] = [
  { name: "accuracy", threshold: DEFAULT_ACCURACY_THRESHOLD, weight: 1 },
  { name: "latency", threshold: DEFAULT_LATENCY_THRESHOLD, weight: 1 },
  { name: "cost", threshold: DEFAULT_COST_THRESHOLD, weight: 1 },
  { name: "quality", threshold: DEFAULT_QUALITY_THRESHOLD, weight: 1 },
] as const;

/** Default weights used when aggregating metric scores. */
export const DEFAULT_WEIGHTS: EvaluationWeights = {
  accuracy: 0.4,
  quality: 0.3,
  latency: 0.2,
  cost: 0.1,
};

/**
 * A config pre-populated with the default thresholds, weights and gates. Use
 * as a starting point: `createEvaluator(DEFAULT_CONFIG)` behaves sensibly out
 * of the box.
 */
export const DEFAULT_CONFIG: EvaluationConfig = {
  thresholds: {
    accuracy: DEFAULT_ACCURACY_THRESHOLD,
    latency: DEFAULT_LATENCY_THRESHOLD,
    cost: DEFAULT_COST_THRESHOLD,
    quality: DEFAULT_QUALITY_THRESHOLD,
  },
  weights: { ...DEFAULT_WEIGHTS },
  gates: [...DEFAULT_GATES],
  includeDefaultGates: true,
  scale: "ratio",
};

/**
 * Evaluate a raw numeric value against an {@link EvaluationThreshold}.
 *
 * This is the single source of truth for threshold semantics and is reused by
 * metrics, gates and the evaluator. The threshold may supply its own custom
 * `evaluate` function, in which case that function wins.
 *
 * @param threshold The threshold to evaluate against.
 * @param value The raw numeric value to test.
 * @returns `true` when the value satisfies the threshold.
 */
export function evaluateThreshold(
  threshold: EvaluationThreshold,
  value: number,
): boolean {
  if (typeof threshold.evaluate === "function") {
    return threshold.evaluate(value);
  }
  const comparison = threshold.comparison ?? (threshold.min !== undefined || threshold.max !== undefined ? "range" : "gte");
  switch (comparison) {
    case "range": {
      const min = threshold.min ?? -Infinity;
      const max = threshold.max ?? Infinity;
      return value >= min && value <= max;
    }
    case "gte":
      return value >= (threshold.value ?? 0);
    case "lte":
      return value <= (threshold.value ?? 0);
    case "gt":
      return value > (threshold.value ?? 0);
    case "lt":
      return value < (threshold.value ?? 0);
    case "eq":
      return value === (threshold.value ?? 0);
    case "neq":
      return value !== (threshold.value ?? 0);
    case "in":
      return (threshold.in ?? []).includes(value);
    default:
      return false;
  }
}

/**
 * Type guard narrowing an unknown value to {@link EvaluationMetric}.
 *
 * @param value Any value to inspect.
 * @returns `true` when the value looks like a metric (has a string `name` and
 *   finite numeric `value`).
 */
export function isEvaluationMetric(value: unknown): value is EvaluationMetric {
  if (typeof value !== "object" || value === null) return false;
  const metric = value as Record<string, unknown>;
  return typeof metric.name === "string" && typeof metric.value === "number" && Number.isFinite(metric.value);
}

/**
 * Type guard narrowing an unknown value to {@link EvaluationResult}.
 *
 * @param value Any value to inspect.
 * @returns `true` when the value carries the required fields of a result.
 */
export function isEvaluationResult(value: unknown): value is EvaluationResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.id === "string" &&
    typeof result.name === "string" &&
    typeof result.score === "number" &&
    typeof result.passed === "boolean" &&
    typeof result.timestamp === "number" &&
    Array.isArray(result.metrics)
  );
}

/**
 * Type guard narrowing an unknown value to {@link QualityGate}.
 *
 * @param value Any value to inspect.
 * @returns `true` when the value carries a gate shape.
 */
export function isQualityGate(value: unknown): value is QualityGate {
  if (typeof value !== "object" || value === null) return false;
  const gate = value as Record<string, unknown>;
  return (
    typeof gate.name === "string" &&
    typeof gate.threshold === "object" &&
    gate.threshold !== null
  );
}

/**
 * Clamp a value into the inclusive range `[min, max]`.
 *
 * @param value The value to clamp.
 * @param min Inclusive lower bound.
 * @param max Inclusive upper bound.
 * @returns The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Round a number to `digits` decimal places, guarding against NaN.
 *
 * @param value The value to round.
 * @param digits Number of decimal places (default 4).
 * @returns The rounded value.
 */
export function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Convert a score between the two supported scales.
 *
 * @param score The score to convert.
 * @param from The scale the score is currently expressed in.
 * @param to The scale to convert into.
 * @returns The converted score.
 */
export function convertScore(score: number, from: "ratio" | "percent", to: "ratio" | "percent"): number {
  if (from === to) return score;
  if (from === "percent" && to === "ratio") return clamp(score / 100, 0, 1);
  return clamp(score * 100, 0, 100);
}