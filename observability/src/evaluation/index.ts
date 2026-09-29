/**
 * @fileoverview A secondary index over {@link EvaluationResult}s.
 *
 * `EvaluationIndex` trades a little memory for fast lookups across the three
 * dimensions the MAM observability engine cares about most:
 *
 * - **name** — every result belongs to a named evaluation;
 * - **passed** — results are bucketed by their pass/fail decision;
 * - **date** — results are kept in a timestamp-sorted list so range queries
 *   run in O(log n) via binary search instead of a full scan.
 *
 * The index is designed to be fed by `store.ts` (via `indexResult`) and to
 * back the query layer in `retrieval.ts`. It never owns results; it only
 * references the ones handed to it. `rebuild()` is provided for the common
 * case of loading a serialised store and re-populating the index from scratch.
 */

import {
  DEFAULT_CONFIG,
  EvaluationResult,
  EvaluationStats,
  convertScore,
  round,
} from "./types.js";

/** A single entry in the timestamp-sorted date index. */
interface DateEntry {
  /** The result id this entry points at. */
  id: string;
  /** Epoch ms timestamp used for ordering. */
  timestamp: number;
}

/**
 * In-memory secondary index for fast retrieval of evaluation results.
 *
 * The index maintains four internal structures that are always kept in sync:
 *
 * - a primary id -> result map (source of truth for individual lookups);
 * - a name -> id-set map for {@link EvaluationIndex.findByName};
 * - a passed -> id-set map for {@link EvaluationIndex.findByPassed};
 * - a timestamp-sorted entry list for {@link EvaluationIndex.findByDateRange}.
 *
 * Lookups across any single dimension are O(1) or O(log n); the only linear
 * operations are the ones that inherently must combine dimensions.
 *
 * @example
 * const index = new EvaluationIndex();
 * index.indexResult(store.record({ name: "accuracy", score: 0.8, passed: true, metrics: [] }));
 * index.findByPassed(true); // -> [result]
 */
export class EvaluationIndex {
  /** Primary id -> result map. */
  private readonly _results = new Map<string, EvaluationResult>();
  /** name -> set of result ids. */
  private readonly _byName = new Map<string, Set<string>>();
  /** passed -> set of result ids. */
  private readonly _byPassed = new Map<boolean, Set<string>>();
  /** Timestamp-sorted entries (ascending) for date range queries. */
  private readonly _byDate: DateEntry[] = [];

  /**
   * Register (or update) a result in the index.
   *
   * When the id already exists the previous entry is fully removed first, so
   * name/passed/date buckets never retain stale references.
   *
   * @param result The result to index.
   * @returns `true` when the result was newly inserted, `false` when it
   *   replaced an existing entry.
   */
  indexResult(result: EvaluationResult): boolean {
    const existed = this._results.has(result.id);
    if (existed) {
      this.removeResult(result.id);
    }
    this._results.set(result.id, result);

    let names = this._byName.get(result.name);
    if (!names) {
      names = new Set();
      this._byName.set(result.name, names);
    }
    names.add(result.id);

    let passed = this._byPassed.get(result.passed);
    if (!passed) {
      passed = new Set();
      this._byPassed.set(result.passed, passed);
    }
    passed.add(result.id);

    this.insertDateEntry({ id: result.id, timestamp: result.timestamp });
    return !existed;
  }

  /**
   * Remove a result from the index by id.
   *
   * @param id The id to remove.
   * @returns The removed result, or `undefined` when it was not indexed.
   */
  removeResult(id: string): EvaluationResult | undefined {
    const result = this._results.get(id);
    if (!result) return undefined;

    this._results.delete(id);

    const names = this._byName.get(result.name);
    if (names) {
      names.delete(id);
      if (names.size === 0) this._byName.delete(result.name);
    }

    const passed = this._byPassed.get(result.passed);
    if (passed) {
      passed.delete(id);
      if (passed.size === 0) this._byPassed.delete(result.passed);
    }

    const pos = this.findDatePosition(result.timestamp, id);
    if (pos >= 0 && pos < this._byDate.length && this._byDate[pos].id === id) {
      this._byDate.splice(pos, 1);
    }

    return result;
  }

  /**
   * Fetch a single result by id.
   *
   * @param id The id to look up.
   * @returns The indexed result, or `undefined`.
   */
  get(id: string): EvaluationResult | undefined {
    return this._results.get(id);
  }

  /**
   * Whether a result id is currently indexed.
   *
   * @param id The id to test.
   * @returns `true` when indexed.
   */
  has(id: string): boolean {
    return this._results.has(id);
  }

  /**
   * All ids currently indexed, in insertion order.
   *
   * @returns An array of ids.
   */
  keys(): string[] {
    return Array.from(this._results.keys());
  }

  /**
   * All indexed results, in insertion order.
   *
   * @returns An array of results.
   */
  values(): EvaluationResult[] {
    return Array.from(this._results.values());
  }

  /**
   * Number of results currently indexed.
   */
  get size(): number {
    return this._results.size;
  }

  /**
   * All distinct evaluation names currently indexed.
   *
   * @returns An array of names.
   */
  names(): string[] {
    return Array.from(this._byName.keys());
  }

  /**
   * Look up every result belonging to a named evaluation, newest first.
   *
   * @param name The evaluation name.
   * @param limit Optional cap on the number of results returned.
   * @returns Matching results, newest first.
   */
  findByName(name: string, limit?: number): EvaluationResult[] {
    const ids = this._byName.get(name);
    if (!ids || ids.size === 0) return [];
    const results: EvaluationResult[] = [];
    for (const id of ids) {
      const result = this._results.get(id);
      if (result) results.push(result);
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return limit !== undefined && limit >= 0 ? results.slice(0, limit) : results;
  }

  /**
   * Look up every result bucketed by its pass/fail decision, newest first.
   *
   * @param passed The bucket to read (`true` or `false`).
   * @param limit Optional cap on the number of results returned.
   * @returns Matching results, newest first.
   */
  findByPassed(passed: boolean, limit?: number): EvaluationResult[] {
    const ids = this._byPassed.get(passed);
    if (!ids || ids.size === 0) return [];
    const results: EvaluationResult[] = [];
    for (const id of ids) {
      const result = this._results.get(id);
      if (result) results.push(result);
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return limit !== undefined && limit >= 0 ? results.slice(0, limit) : results;
  }

  /**
   * Look up every result whose timestamp falls inside `[from, to]`.
   *
   * Both bounds are inclusive. The date index is sorted ascending, so this
   * runs a pair of binary searches to find the window and then maps entries
   * back to results. Results are returned newest first.
   *
   * @param from Inclusive lower bound in epoch ms.
   * @param to Inclusive upper bound in epoch ms.
   * @param limit Optional cap on the number of results returned.
   * @returns Matching results, newest first.
   */
  findByDateRange(from: number, to: number, limit?: number): EvaluationResult[] {
    if (to < from) {
      // Swapped bounds: normalise silently rather than returning nothing.
      [from, to] = [to, from];
    }
    const start = this.lowerBound(this._byDate, from);
    const end = this.upperBound(this._byDate, to);
    const results: EvaluationResult[] = [];
    for (let i = start; i < end; i += 1) {
      const result = this._results.get(this._byDate[i].id);
      if (result) results.push(result);
    }
    results.sort((a, b) => b.timestamp - a.timestamp);
    return limit !== undefined && limit >= 0 ? results.slice(0, limit) : results;
  }

  /**
   * Remove every result indexed before a timestamp cutoff.
   *
   * @param cutoffMs Results with `timestamp < cutoffMs` are removed.
   * @returns The ids that were removed.
   */
  prune(cutoffMs: number): string[] {
    const removed: string[] = [];
    const start = this.lowerBound(this._byDate, cutoffMs);
    for (let i = start; i < this._byDate.length; i += 1) {
      removed.push(this._byDate[i].id);
    }
    for (const id of removed) {
      this.removeResult(id);
    }
    return removed;
  }

  /**
   * Wipe every bucket and re-populate the index from a fresh result list.
   *
   * This is the recommended way to load a serialised store: clear the index,
   * iterate the stored results and re-index them in order.
   *
   * @param results The full result set to index.
   * @returns The number of results indexed.
   */
  rebuild(results: EvaluationResult[]): number {
    this.clear();
    for (const result of results) {
      this.indexResult(result);
    }
    return this.size;
  }

  /**
   * Remove all entries from every bucket.
   */
  clear(): void {
    this._results.clear();
    this._byName.clear();
    this._byPassed.clear();
    this._byDate.length = 0;
  }

  /**
   * Aggregate statistics over the indexed results.
   *
   * @param scale The scale to report in ("ratio" or "percent").
   * @returns {@link EvaluationStats} computed over the indexed results.
   */
  stats(scale: "ratio" | "percent" = DEFAULT_CONFIG.scale ?? "ratio"): EvaluationStats {
    const all = this.values();
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
      standardDeviation: round(Math.sqrt(variance)),
      byName,
      totalChecks,
      totalChecksPassed,
    };
  }

  /**
   * Describe the internal bucket sizes. Useful for diagnostics and dashboards.
   *
   * @returns A breakdown of the index contents.
   */
  describe(): Record<string, number> {
    const byName: Record<string, number> = {};
    for (const [name, ids] of this._byName) {
      byName[name] = ids.size;
    }
    return {
      total: this.size,
      byPassedTrue: this._byPassed.get(true)?.size ?? 0,
      byPassedFalse: this._byPassed.get(false)?.size ?? 0,
      byNameCount: this._byName.size,
      ...byName,
    };
  }

  /**
   * Insert a date entry into the ascending-sorted list using binary search,
   * keeping the list ordered in O(log n) time.
   *
   * @param entry The entry to insert.
   */
  private insertDateEntry(entry: DateEntry): void {
    const pos = this.lowerBound(this._byDate, entry.timestamp);
    // When timestamps collide, scan forward to keep ids stable and unique.
    let i = pos;
    while (i < this._byDate.length && this._byDate[i].timestamp === entry.timestamp) {
      if (this._byDate[i].id === entry.id) return; // already present
      i += 1;
    }
    this._byDate.splice(i, 0, entry);
  }

  /**
   * First index whose timestamp is >= `value` (lower bound binary search).
   *
   * @param entries The ascending-sorted entry list.
   * @param value The timestamp to search for.
   * @returns The insertion index.
   */
  private lowerBound(entries: DateEntry[], value: number): number {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].timestamp < value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * First index whose timestamp is > `value` (upper bound binary search).
   *
   * @param entries The ascending-sorted entry list.
   * @param value The timestamp to search for.
   * @returns The insertion index just past all entries equal to `value`.
   */
  private upperBound(entries: DateEntry[], value: number): number {
    let lo = 0;
    let hi = entries.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (entries[mid].timestamp <= value) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Locate the index of a specific id inside the date list by scanning the
   * run of entries that share its timestamp.
   *
   * @param timestamp The timestamp of the id being located.
   * @param id The id being located.
   * @returns The position, or `-1` when not found.
   */
  private findDatePosition(timestamp: number, id: string): number {
    const start = this.lowerBound(this._byDate, timestamp);
    for (let i = start; i < this._byDate.length; i += 1) {
      if (this._byDate[i].timestamp !== timestamp) break;
      if (this._byDate[i].id === id) return i;
    }
    return -1;
  }
}