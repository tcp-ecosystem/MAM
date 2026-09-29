/**
 * @fileoverview In-memory storage for {@link EvaluationResult}s.
 *
 * `EvaluationStore` is the durable-ish heart of the evaluation layer. It keeps
 * results in an insertion-ordered `Map`, enforces an optional capacity (dropping
 * the oldest entries first), and exposes CRUD plus derived statistics. The
 * class is intentionally dependency free: it can be embedded in the MAM
 * observability engine, serialised to disk for crash recovery, and loaded back
 * with `fromJSON` without any external tooling.
 *
 * The store is not itself an event emitter; lifecycle orchestration (periodic
 * pruning, record/prune notifications) lives in `lifecycle.ts`. Consumers that
 * want push notifications should wrap a store with an
 * {@link Lifecycle.EvaluationLifecycle}.
 */

import { randomUUID } from "node:crypto";

import {
  DEFAULT_CONFIG,
  EvaluationResult,
  EvaluationStats,
  EvaluationStoreOptions,
  clamp,
  convertScore,
  evaluateThreshold,
  isEvaluationResult,
  round,
} from "./types.js";

/**
 * Version tag written into {@link SerializedEvaluationStore} so future schema
 * migrations can be detected on load.
 */
const SERIALIZATION_VERSION = 1;

/**
 * Serialised snapshot of a store, produced by {@link EvaluationStore.toJSON}
 * and consumed by {@link EvaluationStore.fromJSON}.
 */
export interface SerializedEvaluationStore {
  /** Serialisation schema version. */
  version: number;
  /** The stored results, oldest first. */
  results: EvaluationResult[];
  /** The capacity bound in effect at serialisation time. */
  capacity?: number;
}

/**
 * Compute a fresh unique id for a result when the caller did not supply one.
 *
 * @returns A random UUID string.
 */
export function createResultId(): string {
  return randomUUID();
}

/**
 * Insertion-ordered, capacity-bounded store of {@link EvaluationResult}s.
 *
 * The store guarantees:
 * - ids are unique; recording a result with an existing id overwrites it in
 *   place (keeping its original insertion position);
 * - when `capacity` is reached the oldest results (by timestamp) are dropped
 *   before the new result is inserted;
 * - `stats()` computes aggregate metrics over the live contents every call, so
 *   it always reflects the current state.
 *
 * @example
 * const store = new EvaluationStore({ capacity: 1000 });
 * store.record({ name: "answer_accuracy", score: 0.91, passed: true, metrics: [] });
 * console.log(store.stats().passRate); // 1
 */
export class EvaluationStore {
  /** Internal insertion-ordered map of id -> result. */
  private readonly _results = new Map<string, EvaluationResult>();

  /** Optional hard bound on how many results can live in the store at once. */
  private readonly _capacity: number | undefined;

  /**
   * Create a new store.
   *
   * @param options Capacity bound and future tuning knobs.
   */
  constructor(options: EvaluationStoreOptions = {}) {
    this._capacity =
      options.capacity !== undefined
        ? Math.max(0, Math.floor(options.capacity))
        : undefined;
  }

  /**
   * Insert (or overwrite) a result in the store.
   *
   * Missing `id`, `timestamp` and `metrics` fields are filled in with defaults
   * (`randomUUID`, `Date.now()`, `[]`). When the store has a capacity and it is
   * already full, the oldest results are evicted first.
   *
   * @param input A full result or a partial result; only `name` and `score`
   *   are strictly required.
   * @returns The fully normalised result as stored.
   */
  record(
    input: EvaluationResult | (Partial<EvaluationResult> & { name: string; score: number }),
  ): EvaluationResult {
    const result = this.normalize(input);
    if (this._capacity !== undefined && this._capacity === 0) {
      // Capacity zero means "store nothing" — still return the normalised
      // result so callers can inspect what would have been stored.
      return result;
    }
    if (this._results.has(result.id)) {
      this._results.set(result.id, result);
    } else {
      this.ensureCapacity(1);
      this._results.set(result.id, result);
    }
    return result;
  }

  /**
   * Record many results at once, in order.
   *
   * @param inputs The results to record.
   * @returns The normalised results, one per input, in input order.
   */
  recordMany(
    inputs: Array<EvaluationResult | (Partial<EvaluationResult> & { name: string; score: number })>,
  ): EvaluationResult[] {
    return inputs.map((input) => this.record(input));
  }

  /**
   * Fetch a single result by its id.
   *
   * @param id The result id to look up.
   * @returns The stored result, or `undefined` when absent.
   */
  get(id: string): EvaluationResult | undefined {
    return this._results.get(id);
  }

  /**
   * Fetch all results that belong to a named evaluation.
   *
   * @param name The evaluation name to filter by.
   * @param limit Maximum number of results to return (newest first).
   * @param predicate Optional extra filter applied before limiting.
   * @returns Matching results, newest first.
   */
  getByName(
    name: string,
    limit?: number,
    predicate?: (result: EvaluationResult) => boolean,
  ): EvaluationResult[] {
    const matches: EvaluationResult[] = [];
    for (const result of this._results.values()) {
      if (result.name !== name) continue;
      if (predicate && !predicate(result)) continue;
      matches.push(result);
    }
    matches.sort((a, b) => b.timestamp - a.timestamp);
    if (limit !== undefined && limit >= 0) {
      return matches.slice(0, limit);
    }
    return matches;
  }

  /**
   * Fetch the most recently recorded results.
   *
   * @param limit Maximum number of results to return.
   * @param predicate Optional extra filter applied before limiting.
   * @returns The newest `limit` results matching the predicate, newest first.
   */
  listRecent(
    limit?: number,
    predicate?: (result: EvaluationResult) => boolean,
  ): EvaluationResult[] {
    const sorted = Array.from(this._results.values());
    sorted.sort((a, b) => b.timestamp - a.timestamp);
    const filtered = predicate ? sorted.filter(predicate) : sorted;
    if (limit !== undefined && limit >= 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  /**
   * Whether a result with the given id exists.
   *
   * @param id The id to test.
   * @returns `true` when the store contains the id.
   */
  has(id: string): boolean {
    return this._results.has(id);
  }

  /**
   * Remove a result by id.
   *
   * @param id The id to remove.
   * @returns `true` when a result was actually removed.
   */
  delete(id: string): boolean {
    return this._results.delete(id);
  }

  /**
   * Remove every result from the store.
   */
  clear(): void {
    this._results.clear();
  }

  /**
   * All ids currently in the store, in insertion order.
   *
   * @returns An array of ids.
   */
  keys(): string[] {
    return Array.from(this._results.keys());
  }

  /**
   * All results currently in the store, in insertion order.
   *
   * @returns An array of results.
   */
  values(): EvaluationResult[] {
    return Array.from(this._results.values());
  }

  /**
   * Number of results currently stored.
   */
  get size(): number {
    return this._results.size;
  }

  /**
   * Whether the store is empty.
   *
   * @returns `true` when there are no results.
   */
  get isEmpty(): boolean {
    return this._results.size === 0;
  }

  /**
   * Compute aggregate statistics over the live contents.
   *
   * Scores are converted to the configured scale (default ratio 0-1) before
   * aggregation so the numbers reported here are comparable across evaluators.
   *
   * @param scale The scale to report in ("ratio" or "percent").
   * @returns {@link EvaluationStats} computed from the current contents.
   */
  stats(scale: "ratio" | "percent" = DEFAULT_CONFIG.scale ?? "ratio"): EvaluationStats {
    const all = Array.from(this._results.values());
    const total = all.length;
    const passed = all.filter((r) => r.passed).length;
    const failed = total - passed;
    const scores = all.map((r) => convertScore(r.score, "ratio", scale));
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
    const standardDeviation = Math.sqrt(variance);

    const byName: EvaluationStats["byName"] = {};
    for (const result of all) {
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
      standardDeviation: round(standardDeviation),
      byName,
      totalChecks,
      totalChecksPassed,
    };
  }

  /**
   * Serialise the store contents to a plain JSON-safe object.
   *
   * @returns A {@link SerializedEvaluationStore} snapshot.
   */
  toJSON(): SerializedEvaluationStore {
    return {
      version: SERIALIZATION_VERSION,
      results: this.values(),
      capacity: this._capacity,
    };
  }

  /**
   * Replace the store contents with the payload of `toJSON()`.
   *
   * @param data A snapshot produced by {@link EvaluationStore.toJSON} (or a
   *   bare array of results for convenience).
   * @returns The number of results loaded.
   * @throws {Error} When the payload contains malformed results.
   */
  fromJSON(data: SerializedEvaluationStore | EvaluationResult[]): number {
    const results = Array.isArray(data) ? data : data.results;
    if (!Array.isArray(results)) {
      throw new Error("EvaluationStore.fromJSON: expected a results array");
    }
    const loaded: EvaluationResult[] = [];
    for (const raw of results) {
      if (!isEvaluationResult(raw)) {
        throw new Error(
          `EvaluationStore.fromJSON: malformed result at index ${loaded.length}`,
        );
      }
      loaded.push(this.normalize(raw));
    }
    this._results.clear();
    for (const result of loaded) {
      if (this._capacity !== undefined && this._results.size >= this._capacity) {
        break;
      }
      this._results.set(result.id, result);
    }
    return this._results.size;
  }

  /**
   * Merge the payload of `toJSON()` into the existing contents without
   * clearing first. Existing ids are overwritten in place.
   *
   * @param data A snapshot produced by {@link EvaluationStore.toJSON}.
   * @returns The number of results in the store after merging.
   */
  merge(data: SerializedEvaluationStore | EvaluationResult[]): number {
    const results = Array.isArray(data) ? data : data.results;
    for (const raw of results) {
      if (isEvaluationResult(raw)) {
        this.record(raw);
      }
    }
    return this.size;
  }

  /**
   * Remove every result whose timestamp is older than the cutoff. The store's
   * capacity bound is respected after pruning.
   *
   * @param cutoffMs Results with `timestamp < cutoffMs` are removed.
   * @returns The ids of removed results.
   */
  prune(cutoffMs: number): string[] {
    const removed: string[] = [];
    for (const result of this._results.values()) {
      if (result.timestamp < cutoffMs) {
        removed.push(result.id);
      }
    }
    for (const id of removed) {
      this._results.delete(id);
    }
    return removed;
  }

  /**
   * Normalise a caller-supplied partial result into a full, valid
   * {@link EvaluationResult}.
   *
   * @param input The input to normalise.
   * @returns A fully populated result.
   */
  private normalize(
    input: EvaluationResult | (Partial<EvaluationResult> & { name: string; score: number }),
  ): EvaluationResult {
    const name = input.name;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("EvaluationStore.record: `name` must be a non-empty string");
    }
    const score = Number(input.score);
    if (!Number.isFinite(score)) {
      throw new Error(`EvaluationStore.record: invalid score for "${name}"`);
    }
    const metrics =
      Array.isArray(input.metrics) && input.metrics.length > 0
        ? input.metrics
        : input.metrics
          ? input.metrics
          : [];
    const result: EvaluationResult = {
      id: typeof input.id === "string" && input.id.length > 0 ? input.id : createResultId(),
      name,
      score: clamp(score, 0, 1),
      passed:
        typeof input.passed === "boolean"
          ? input.passed
          : evaluateThreshold(
              { value: DEFAULT_CONFIG.thresholds.accuracy.value ?? 0.6, comparison: "gte" },
              score,
            ),
      metrics,
      timestamp:
        typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
          ? input.timestamp
          : Date.now(),
    };
    if (Array.isArray(input.checks)) {
      result.checks = input.checks;
    }
    if (input.metadata !== undefined) {
      result.metadata = input.metadata;
    }
    return result;
  }

  /**
   * Evict the oldest results until `additional` new results fit within the
   * capacity bound.
   *
   * @param additional Number of results about to be inserted.
   */
  private ensureCapacity(additional: number): void {
    if (this._capacity === undefined) return;
    const overflow = this._results.size + additional - this._capacity;
    if (overflow <= 0) return;
    const sorted = Array.from(this._results.values()).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    for (let i = 0; i < overflow && i < sorted.length; i += 1) {
      this._results.delete(sorted[i].id);
    }
  }
}