/**
 * @fileoverview Read-side query API over stored {@link EvaluationResult}s.
 *
 * `EvaluationQuery` sits on top of either an {@link Store.EvaluationStore} or
 * an {@link Index.EvaluationIndex} and turns "give me results" into the
 * concrete questions the MAM observability engine asks most often:
 *
 * - "what did the last 20 evaluations look like?" → `recent()`;
 * - "how is `answer_accuracy` trending?" → `trend()` + `averageScore()`;
 * - "which evaluations are failing?" → `failed()`;
 * - "what is my best run?" → `best()`.
 *
 * The class never mutates its source; every method returns a fresh snapshot so
 * callers can rely on the returned arrays not changing underneath them.
 */

import {
  DEFAULT_CONFIG,
  EvaluationResult,
  EvaluationStats,
  convertScore,
  round,
} from "./types.js";
import { EvaluationStore } from "./store.js";
import { EvaluationIndex } from "./index.js";

/** Anything that exposes a `values()` collection of results can back a query. */
export interface ResultSource {
  /** All results held by the source, in any order. */
  values(): EvaluationResult[];
}

/** A single point on a score trend line. */
export interface TrendPoint {
  /** Epoch ms of the underlying result. */
  timestamp: number;
  /** The score of the underlying result. */
  score: number;
  /** The id of the underlying result, for drill-down. */
  id: string;
  /** Whether the underlying result passed. */
  passed: boolean;
}

/**
 * Immutable, source-agnostic query view over a collection of evaluation
 * results.
 *
 * Construct one with a store, an index, or a plain array of results:
 *
 * @example
 * const query = new EvaluationQuery(store);
 * query.recent(5);          // last 5 results
 * query.trend("accuracy");  // time-series points
 * query.averageScore();     // overall mean
 */
export class EvaluationQuery {
  /** The backing source this query reads from. */
  private readonly source: ResultSource;

  /** Scale used for score reporting (inherited from {@link DEFAULT_CONFIG}). */
  private readonly scale: "ratio" | "percent";

  /**
   * Create a query over a source.
   *
   * @param source A store, index, or array of results to query.
   * @param scale Optional score scale for reporting.
   */
  constructor(
    source: EvaluationStore | EvaluationIndex | EvaluationResult[] | ResultSource,
    scale: "ratio" | "percent" = DEFAULT_CONFIG.scale ?? "ratio",
  ) {
    if (Array.isArray(source)) {
      this.source = {
        values: () => source,
      };
    } else {
      this.source = source;
    }
    this.scale = scale;
  }

  /**
   * All results currently visible through the query.
   *
   * @returns A snapshot array of every result, newest first.
   */
  all(): EvaluationResult[] {
    return this.sortNewestFirst(this.source.values());
  }

  /**
   * The most recent results.
   *
   * @param limit Maximum number of results to return (default 10).
   * @returns The newest `limit` results, newest first.
   */
  recent(limit = 10): EvaluationResult[] {
    return this.all().slice(0, Math.max(0, limit));
  }

  /**
   * Results belonging to a single named evaluation.
   *
   * @param name The evaluation name to filter by.
   * @param limit Maximum number of results to return (default unlimited).
   * @returns Matching results, newest first.
   */
  byName(name: string, limit?: number): EvaluationResult[] {
    const matches = this.all().filter((r) => r.name === name);
    return limit !== undefined && limit >= 0 ? matches.slice(0, limit) : matches;
  }

  /**
   * Results whose `passed` flag is `true`.
   *
   * @param limit Maximum number of results to return (default unlimited).
   * @returns Passing results, newest first.
   */
  passed(limit?: number): EvaluationResult[] {
    const matches = this.all().filter((r) => r.passed);
    return limit !== undefined && limit >= 0 ? matches.slice(0, limit) : matches;
  }

  /**
   * Results whose `passed` flag is `false`.
   *
   * @param limit Maximum number of results to return (default unlimited).
   * @returns Failing results, newest first.
   */
  failed(limit?: number): EvaluationResult[] {
    const matches = this.all().filter((r) => !r.passed);
    return limit !== undefined && limit >= 0 ? matches.slice(0, limit) : matches;
  }

  /**
   * The highest-scoring results, best first.
   *
   * @param limit Maximum number of results to return (default 1).
   * @returns The best `limit` results, descending by score.
   */
  best(limit = 1): EvaluationResult[] {
    const sorted = this.all().sort((a, b) => b.score - a.score);
    return sorted.slice(0, Math.max(0, limit));
  }

  /**
   * The lowest-scoring results, worst first.
   *
   * @param limit Maximum number of results to return (default 1).
   * @returns The worst `limit` results, ascending by score.
   */
  worst(limit = 1): EvaluationResult[] {
    const sorted = this.all().sort((a, b) => a.score - b.score);
    return sorted.slice(0, Math.max(0, limit));
  }

  /**
   * The average score over all results, or over one named evaluation.
   *
   * @param name When given, only results with this name are included.
   * @returns The mean score in the configured scale, or `0` when empty.
   */
  averageScore(name?: string): number {
    const matches = name ? this.byName(name) : this.all();
    if (matches.length === 0) return 0;
    const sum = matches.reduce((acc, r) => acc + r.score, 0);
    return round(convertScore(sum / matches.length, "ratio", this.scale));
  }

  /**
   * Pass rate over all results, or over one named evaluation.
   *
   * @param name When given, only results with this name are included.
   * @returns The fraction of results that passed in [0, 1].
   */
  passRate(name?: string): number {
    const matches = name ? this.byName(name) : this.all();
    if (matches.length === 0) return 0;
    const passed = matches.filter((r) => r.passed).length;
    return round(passed / matches.length);
  }

  /**
   * Build a time-series of scores for one evaluation, oldest point first.
   *
   * Useful for sparklines and trend dashboards. Points are ordered ascending
   * by timestamp so they can be fed straight into a chart.
   *
   * @param name The evaluation name to trend.
   * @param limit Maximum number of points to return (default 50).
   * @returns An ascending-by-time array of {@link TrendPoint}s.
   */
  trend(name: string, limit = 50): TrendPoint[] {
    const matches = this.byName(name);
    const sorted = [...matches].sort((a, b) => a.timestamp - b.timestamp);
    const take = Math.max(0, limit);
    const slice = take === 0 ? [] : sorted.slice(-take);
    return slice.map((r) => ({
      timestamp: r.timestamp,
      score: convertScore(r.score, "ratio", this.scale),
      id: r.id,
      passed: r.passed,
    }));
  }

  /**
   * The median score over all results, or over one named evaluation.
   *
   * @param name When given, only results with this name are included.
   * @returns The median score in the configured scale, or `0` when empty.
   */
  medianScore(name?: string): number {
    const matches = name ? this.byName(name) : this.all();
    if (matches.length === 0) return 0;
    const scores = matches.map((r) => convertScore(r.score, "ratio", this.scale)).sort((a, b) => a - b);
    const mid = Math.floor(scores.length / 2);
    const median =
      scores.length % 2 === 1
        ? scores[mid]
        : (scores[mid - 1] + scores[mid]) / 2;
    return round(median);
  }

  /**
   * Count how many results match a predicate.
   *
   * @param predicate Optional filter; counts everything when omitted.
   * @returns The number of matching results.
   */
  count(predicate?: (result: EvaluationResult) => boolean): number {
    if (!predicate) return this.source.values().length;
    let n = 0;
    for (const result of this.source.values()) {
      if (predicate(result)) n += 1;
    }
    return n;
  }

  /**
   * Aggregate statistics over the whole source.
   *
   * @returns {@link EvaluationStats} for the entire collection.
   */
  stats(): EvaluationStats {
    const all = this.all();
    const total = all.length;
    const passed = all.filter((r) => r.passed).length;
    const failed = total - passed;
    const scores = all.map((r) => convertScore(r.score, "ratio", this.scale));
    const averageScore =
      total === 0 ? 0 : scores.reduce((sum, s) => sum + s, 0) / total;
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
      total === 0
        ? 0
        : scores.reduce((sum, s) => sum + (s - averageScore) ** 2, 0) / total;

    const byName: EvaluationStats["byName"] = {};
    for (const result of all) {
      const bucket = byName[result.name] ?? { total: 0, passed: 0, averageScore: 0 };
      bucket.total += 1;
      if (result.passed) bucket.passed += 1;
      bucket.averageScore += convertScore(result.score, "ratio", this.scale);
      byName[result.name] = bucket;
    }
    for (const name of Object.keys(byName)) {
      byName[name].averageScore = byName[name].total
        ? byName[name].averageScore / byName[name].total
        : 0;
    }

    let totalChecks = 0;
    let totalChecksPassed = 0;
    for (const result of all) {
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
   * Sort an arbitrary collection newest-first.
   *
   * @param results The collection to sort.
   * @returns A new array sorted by descending timestamp.
   */
  private sortNewestFirst(results: EvaluationResult[]): EvaluationResult[] {
    return [...results].sort((a, b) => b.timestamp - a.timestamp);
  }
}