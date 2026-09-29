/**
 * index.ts
 *
 * The `InvocationIndex` — a query index over recorded invocation results.
 *
 * While `store.ts` keeps the authoritative history buffer and statistics, this
 * module maintains the derived lookups that make queries fast and cheap:
 *
 *   - `byTool`     — tool name → record ids for that tool.
 *   - `byOk`       — outcome (true/false) → record ids.
 *   - `byError`    — tool name → ids of *failed* records for that tool.
 *   - `byCached`   — cache flag → ids, so cache-served results are countable.
 *   - `byMock`     — mock flag → ids, so mock-served results are countable.
 *
 * Entries are keyed by the monotonic id assigned by the store, so history
 * and index stay in lock-step: the executor calls `indexRecord` right after
 * `store.record` (same id), and lifecycle pruning removes by id. The index is
 * *eventually consistent* by construction — it is only ever mutated through
 * `indexRecord` / `removeRecord` / `removeTool` / `rebuild`.
 *
 * Unlike the store, the index is memory-light: it stores the full
 * {@link InvocationResult} per record id plus inverted sets, which makes
 * `findByOk`, `findByError` and `stats` O(1)-ish rather than O(history).
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type InvocationIndexStats,
  type InvocationResult,
  type ToolCounts,
  isInvocationResult,
} from './types.js';

/**
 * An inverted index over invocation results.
 *
 * @example
 * const index = new InvocationIndex();
 * index.indexRecord(result, recordId);       // index a fresh result
 * index.findByTool('http.get');              // InvocationResult[]
 * index.findByOk(false);                     // InvocationResult[] (failures)
 * index.findByError('http.get');             // failed results for a tool
 * index.removeTool('http.get');              // drop all entries for a tool
 * index.rebuild(results);                    // full rebuild from a list
 * index.stats();                             // InvocationIndexStats
 */
export class InvocationIndex {
  /** Record id → full result. The authoritative row store. */
  private readonly byId = new Map<number, InvocationResult>();

  /** Tool name → set of record ids for that tool. */
  private readonly byTool = new Map<string, Set<number>>();

  /** Outcome → set of record ids (true = ok, false = error). */
  private readonly byOk = new Map<boolean, Set<number>>();

  /** Tool name → set of record ids whose result failed (`ok: false`). */
  private readonly byError = new Map<string, Set<number>>();

  /** Cache flag → set of record ids with that flag. */
  private readonly byCached = new Map<boolean, Set<number>>();

  /** Mock flag → set of record ids with that flag. */
  private readonly byMock = new Map<boolean, Set<number>>();

  /** Monotonic id counter used when callers do not supply an id. */
  private nextId = 0;

  /** Epoch ms of the most recent mutation or rebuild. */
  private lastIndexedAt = 0;

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  /**
   * Indexes a result under an id.
   *
   * When `id` is omitted, the index mints its own monotonic id — useful for
   * standalone use. When callers pass the store's record id, history and
   * index share the same identity, which is what lifecycle pruning relies on.
   *
   * Re-indexing an id that already exists replaces the old entry, so the
   * operation is idempotent.
   *
   * @param result the result to index.
   * @param id the record id to index under; defaults to a fresh id.
   * @returns the id the result was indexed under.
   * @throws {TypeError} when `result` does not satisfy the
   *   {@link isInvocationResult} guard or has an empty tool name.
   */
  indexRecord(result: InvocationResult, id?: number): number {
    if (!isInvocationResult(result)) {
      throw new TypeError(
        'InvocationIndex.indexRecord: result is not a valid InvocationResult.',
      );
    }
    if (typeof result.tool !== 'string' || result.tool.length === 0) {
      throw new TypeError(
        'InvocationIndex.indexRecord: result must reference a tool with a non-empty name.',
      );
    }
    const recordId = id === undefined ? this.nextId++ : id;
    if (this.byId.has(recordId)) {
      this.removeRecord(recordId);
    }

    this.byId.set(recordId, result);
    this.addToSet(this.byTool, result.tool, recordId);
    this.addToSet(this.byOk, result.ok, recordId);
    if (!result.ok) {
      this.addToSet(this.byError, result.tool, recordId);
    }
    this.addToSet(this.byCached, result.cached === true, recordId);
    this.addToSet(this.byMock, result.mock === true, recordId);
    this.lastIndexedAt = Date.now();
    return recordId;
  }

  /**
   * Removes the record with the given id and every index entry referencing
   * it.
   *
   * @param id the record id to remove.
   * @returns `true` when a record was removed, `false` when the id was
   *   unknown.
   */
  removeRecord(id: number): boolean {
    const result = this.byId.get(id);
    if (result === undefined) {
      return false;
    }
    this.byId.delete(id);
    this.removeFromSet(this.byTool, result.tool, id);
    this.removeFromSet(this.byOk, result.ok, id);
    if (!result.ok) {
      this.removeFromSet(this.byError, result.tool, id);
    }
    this.removeFromSet(this.byCached, result.cached === true, id);
    this.removeFromSet(this.byMock, result.mock === true, id);
    this.lastIndexedAt = Date.now();
    return true;
  }

  /**
   * Removes every record belonging to a tool.
   *
   * @param tool the tool name to purge.
   * @returns the number of records removed.
   */
  removeTool(tool: string): number {
    const ids = this.byTool.get(tool);
    if (ids === undefined || ids.size === 0) {
      return 0;
    }
    const snapshot = Array.from(ids);
    for (const id of snapshot) {
      this.removeRecord(id);
    }
    return snapshot.length;
  }

  /**
   * Rebuilds the index from scratch from a list of results. The id counter is
   * reset and every result is re-indexed with fresh sequential ids.
   *
   * @param results the results to index.
   * @returns `this` for chaining.
   */
  rebuild(results: Iterable<InvocationResult>): this {
    this.clear();
    for (const result of results) {
      this.indexRecord(result);
    }
    this.lastIndexedAt = Date.now();
    return this;
  }

  /**
   * Removes every entry from the index, leaving it empty but reusable.
   */
  clear(): void {
    this.byId.clear();
    this.byTool.clear();
    this.byOk.clear();
    this.byError.clear();
    this.byCached.clear();
    this.byMock.clear();
    this.nextId = 0;
    this.lastIndexedAt = 0;
  }

  /* ------------------------------------------------------------------ *
   * Lookups
   * ------------------------------------------------------------------ */

  /**
   * Returns the indexed result for an id, or `undefined`.
   *
   * @param id the record id to look up.
   */
  get(id: number): InvocationResult | undefined {
    return this.byId.get(id);
  }

  /**
   * Returns `true` when the index contains a record with the given id.
   *
   * @param id the record id to probe.
   */
  has(id: number): boolean {
    return this.byId.has(id);
  }

  /**
   * Returns the number of indexed records.
   */
  get size(): number {
    return this.byId.size;
  }

  /**
   * Returns every indexed result as an array, ordered by id.
   */
  all(): InvocationResult[] {
    return Array.from(this.byId.values());
  }

  /**
   * Returns every indexed record id as an array.
   */
  ids(): number[] {
    return Array.from(this.byId.keys());
  }

  /**
   * Returns every indexed result for a tool, ordered by id (oldest first).
   *
   * @param tool the tool name to filter by.
   */
  findByTool(tool: string): InvocationResult[] {
    const ids = this.byTool.get(tool);
    if (ids === undefined) {
      return [];
    }
    return Array.from(ids, (id) => this.byId.get(id)).filter(
      (result): result is InvocationResult => result !== undefined,
    );
  }

  /**
   * Returns every indexed result with the given outcome.
   *
   * @param ok the outcome to filter by: `true` for successes, `false` for
   *   failures.
   */
  findByOk(ok: boolean): InvocationResult[] {
    const ids = this.byOk.get(ok);
    if (ids === undefined) {
      return [];
    }
    return Array.from(ids, (id) => this.byId.get(id)).filter(
      (result): result is InvocationResult => result !== undefined,
    );
  }

  /**
   * Returns every indexed *failed* result — optionally restricted to a single
   * tool.
   *
   * @param tool when given, only failures of this tool are returned.
   */
  findByError(tool?: string): InvocationResult[] {
    const ids = tool === undefined ? this.byOk.get(false) : this.byError.get(tool);
    if (ids === undefined) {
      return [];
    }
    return Array.from(ids, (id) => this.byId.get(id)).filter(
      (result): result is InvocationResult => result !== undefined,
    );
  }

  /**
   * Returns every indexed result served from cache.
   */
  findByCached(): InvocationResult[] {
    const ids = this.byCached.get(true);
    if (ids === undefined) {
      return [];
    }
    return Array.from(ids, (id) => this.byId.get(id)).filter(
      (result): result is InvocationResult => result !== undefined,
    );
  }

  /**
   * Returns every indexed result served by a mock.
   */
  findByMock(): InvocationResult[] {
    const ids = this.byMock.get(true);
    if (ids === undefined) {
      return [];
    }
    return Array.from(ids, (id) => this.byId.get(id)).filter(
      (result): result is InvocationResult => result !== undefined,
    );
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  /**
   * Returns the distinct tools currently present in the index, sorted for
   * determinism.
   */
  tools(): string[] {
    return Array.from(this.byTool.keys()).sort();
  }

  /**
   * Returns the epoch ms of the most recent mutation or rebuild.
   */
  lastIndexed(): number {
    return this.lastIndexedAt;
  }

  /**
   * Computes an {@link InvocationIndexStats} snapshot. Counts are derived
   * purely from the index contents, so calling this directly on a partially
   * pruned index reflects the index, not the store — prefer lifecycle-managed
   * stats for authoritative numbers.
   */
  stats(): InvocationIndexStats {
    const byTool: Record<string, ToolCounts> = {};
    let okCount = 0;
    let errorCount = 0;
    let cachedCount = 0;
    let mockCount = 0;

    for (const [tool, ids] of this.byTool) {
      let total = 0;
      let ok = 0;
      let err = 0;
      let cached = 0;
      let mock = 0;
      for (const id of ids) {
        const result = this.byId.get(id);
        if (result === undefined) {
          continue;
        }
        total += 1;
        if (result.ok) {
          ok += 1;
        } else {
          err += 1;
        }
        if (result.cached === true) {
          cached += 1;
        }
        if (result.mock === true) {
          mock += 1;
        }
      }
      byTool[tool] = { total, okCount: ok, errorCount: err, cachedCount: cached, mockCount: mock };
      okCount += ok;
      errorCount += err;
      cachedCount += cached;
      mockCount += mock;
    }

    return {
      total: this.byId.size,
      okCount,
      errorCount,
      cachedCount,
      mockCount,
      distinctTools: this.byTool.size,
      byTool,
    };
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /** Adds `id` to the set behind `key` in `map`, creating it on demand. */
  private addToSet(
    map: Map<boolean | string, Set<number>>,
    key: boolean | string,
    id: number,
  ): void {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set();
      map.set(key, set);
    }
    set.add(id);
  }

  /** Removes `id` from the set behind `key`; drops empty sets. */
  private removeFromSet(
    map: Map<boolean | string, Set<number>>,
    key: boolean | string,
    id: number,
  ): void {
    const set = map.get(key);
    if (set === undefined) {
      return;
    }
    set.delete(id);
    if (set.size === 0) {
      map.delete(key);
    }
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param results optional results to index immediately.
 * @returns a new {@link InvocationIndex}.
 */
export function createIndex(results: Iterable<InvocationResult> = []): InvocationIndex {
  const index = new InvocationIndex();
  if (Array.isArray(results)) {
    index.rebuild(results);
  } else {
    for (const result of results) {
      index.indexRecord(result);
    }
  }
  return index;
}