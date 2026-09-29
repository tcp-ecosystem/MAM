/**
 * Result index for the Summarization layer of the standalone MAM Context
 * Engine.
 *
 * {@link SummarizationIndex} answers the read-side questions the rest of the
 * layer keeps asking: *"which cached summaries were produced by the rolling
 * technique?"*, *"show me every digest between 300 and 600 characters"*. Rather
 * than scanning the whole cache on every query, it maintains a set of secondary
 * indexes — one per {@link SummarizeTechnique}, one per length bucket (see
 * {@link lengthBucket}) — and keeps them consistent through explicit
 * `indexResult` / `removeResult` calls or a wholesale {@link
 * SummarizationIndex.rebuild}.
 *
 * Responsibilities:
 *
 * - **Index** — {@link SummarizationIndex.indexResult} inserts or updates a
 *   result and routes it into the correct technique and length-bucket
 *   secondary indexes; {@link SummarizationIndex.removeResult} evicts it from
 *   every index.
 * - **Query** — {@link SummarizationIndex.findByTechnique} /
 *   {@link SummarizationIndex.findByLengthBucket} resolve indexed results;
 *   {@link SummarizationIndex.findByLengthRange} narrows a `[min, max]` length
 *   window to the handful of buckets that can possibly contain it before
 *   filtering; {@link SummarizationIndex.size} reports how many results are
 *   tracked.
 * - **Rebuild** — {@link SummarizationIndex.rebuild} drops and re-populates
 *   the whole index from an arbitrary iterable of `[key, result]` pairs, which
 *   is how a store snapshot gets mirrored into the index cheaply.
 * - **Reset** — {@link SummarizationIndex.clear} empties every index at once.
 * - **Inspect** — {@link SummarizationIndex.stats} and
 *   {@link SummarizationIndex.buckets} expose the shape and health of the
 *   index.
 *
 * The index is deliberately **decoupled from {@link SummarizationStore}**: it
 * indexes plain `[key, {@link SummaryResult}]` pairs, so it can mirror the
 * store's live cache, index results from a serialised snapshot, or index a
 * hypothetical "what-if" set without touching the store at all.
 *
 * Length buckets are derived with {@link lengthBucket} using a configurable
 * bucket width (default {@link DEFAULT_BUCKET_WIDTH}, 200 characters), so the
 * coarse size index stays small while `findByLengthRange` remains precise.
 *
 * @module summarization/index
 */

import {
  DEFAULT_BUCKET_WIDTH,
  clampLength,
  isSummarizeTechnique,
  isSummaryResult,
  lengthBucket,
} from './types.js';
import type {
  SummarizeTechnique,
  SummaryResult,
} from './types.js';

/**
 * An indexed result: the result plus the derived keys used by the secondary
 * indexes.
 */
export interface IndexedSummary {
  /**
   * The cache key the result is indexed under.
   */
  readonly key: string;

  /**
   * The indexed {@link SummaryResult}.
   */
  readonly result: SummaryResult;

  /**
   * The result's technique (mirrors `result.technique`).
   */
  readonly technique: SummarizeTechnique;

  /**
   * The length bucket the result's `summaryLength` fell into (see
   * {@link lengthBucket}).
   */
  readonly lengthBucket: string;

  /**
   * The result's `summaryLength`, kept denormalised for cheap range filtering.
   */
  readonly length: number;
}

/**
 * Construction options for a {@link SummarizationIndex}.
 */
export interface SummarizationIndexOptions {
  /**
   * Width in characters of each length bucket. Defaults to
   * {@link DEFAULT_BUCKET_WIDTH} (`200`). Only affects the granularity of the
   * coarse size index, never the results themselves.
   */
  readonly bucketWidth?: number;
}

/**
 * Shape of the {@link SummarizationIndex.stats} report.
 */
export interface SummarizationIndexStats {
  /**
   * Total number of results indexed.
   */
  readonly size: number;

  /**
   * Number of results indexed under each technique.
   */
  readonly byTechnique: Readonly<Record<SummarizeTechnique, number>>;

  /**
   * Number of results per length bucket, keyed by bucket label.
   */
  readonly byBucket: Readonly<Record<string, number>>;

  /**
   * Sum of every indexed result's `summaryLength`.
   */
  readonly totalLength: number;

  /**
   * Mean `summaryLength` of the indexed results (`0` when empty).
   */
  readonly averageLength: number;
}

/**
 * The technique/length-bucket result index.
 *
 * See the module documentation for the full responsibility list. Every query
 * method returns *copies* of the indexed results (or arrays of copies) so
 * callers cannot mutate the index's internal state through the values they
 * receive.
 *
 * @example
 * ```ts
 * const index = new SummarizationIndex();
 * index.indexResult('doc:42', result);
 * index.findByTechnique('rolling');       // all rolling digests
 * index.findByLengthRange(0, 500);        // all summaries ≤ 500 chars
 * ```
 */
export class SummarizationIndex {
  /**
   * Key→indexed-result primary index.
   */
  private readonly byKey: Map<string, IndexedSummary> = new Map();

  /**
   * Technique→key-set secondary index.
   */
  private readonly byTechnique: Map<SummarizeTechnique, Set<string>> = new Map([
    ['extractive', new Set()],
    ['keyword', new Set()],
    ['rolling', new Set()],
  ]);

  /**
   * Length bucket→key-set secondary index.
   */
  private readonly byBucket: Map<string, Set<string>> = new Map();

  /**
   * Width in characters of each length bucket.
   */
  private readonly bucketWidth: number;

  /**
   * Construct a new index.
   *
   * @param options - optional bucket-width override
   */
  constructor(options: SummarizationIndexOptions = {}) {
    this.bucketWidth =
      options.bucketWidth !== undefined && options.bucketWidth > 0
        ? Math.floor(options.bucketWidth)
        : DEFAULT_BUCKET_WIDTH;
  }

  /**
   * Derive the secondary-index membership of a result.
   *
   * @param key - the cache key
   * @param result - the result to derive from
   * @returns a ready-to-store {@link IndexedSummary}
   */
  private derive(key: string, result: SummaryResult): IndexedSummary {
    return {
      key,
      result: { ...result },
      technique: result.technique,
      lengthBucket: lengthBucket(result.summaryLength, this.bucketWidth),
      length: result.summaryLength,
    };
  }

  /**
   * Move a key into the technique and bucket sets for the given values,
   * removing it from any previous buckets.
   *
   * @param key - the key to route
   * @param technique - the technique set to join
   * @param bucket - the length-bucket set to join
   */
  private route(key: string, technique: SummarizeTechnique, bucket: string): void {
    for (const set of this.byTechnique.values()) {
      set.delete(key);
    }
    this.byTechnique.get(technique)!.add(key);
    for (const set of this.byBucket.values()) {
      set.delete(key);
    }
    if (!this.byBucket.has(bucket)) {
      this.byBucket.set(bucket, new Set());
    }
    this.byBucket.get(bucket)!.add(key);
  }

  /**
   * Insert or update a result in the index.
   *
   * Replaces any existing entry for the same key, re-routes it into its
   * technique and length-bucket secondary indexes, and returns `true` on
   * success. Values are validated structurally via {@link isSummaryResult};
   * malformed inputs are ignored and `false` is returned.
   *
   * @param key - the cache key to index under
   * @param result - the result to index
   * @returns `true` when the result was accepted and indexed
   */
  indexResult(key: string, result: SummaryResult): boolean {
    if (!isSummaryResult(result)) {
      return false;
    }
    const indexed = this.derive(key, result);
    this.byKey.set(key, indexed);
    this.route(key, indexed.technique, indexed.lengthBucket);
    return true;
  }

  /**
   * Remove a result from every index.
   *
   * @param key - the cache key to remove
   * @returns `true` when the key was indexed and removed
   */
  removeResult(key: string): boolean {
    const removed = this.byKey.delete(key);
    if (removed) {
      for (const set of this.byTechnique.values()) {
        set.delete(key);
      }
      for (const set of this.byBucket.values()) {
        set.delete(key);
      }
    }
    return removed;
  }

  /**
   * Resolve a key's indexed result.
   *
   * @param key - the cache key to look up
   * @returns a copy of the indexed {@link SummaryResult}, or `undefined` when
   *   not indexed
   */
  get(key: string): SummaryResult | undefined {
    const indexed = this.byKey.get(key);
    return indexed ? { ...indexed.result } : undefined;
  }

  /**
   * Test whether a key is currently indexed.
   *
   * @param key - the cache key to test
   * @returns `true` when the key has an indexed result
   */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * The keys of every indexed result, in insertion order.
   *
   * @returns a fresh array of cache keys
   */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  /**
   * Every indexed result produced by a given technique.
   *
   * @param technique - the technique to filter by
   * @returns a fresh array of {@link SummaryResult} copies in insertion order
   */
  findByTechnique(technique: SummarizeTechnique): SummaryResult[] {
    const keys = this.byTechnique.get(technique);
    if (!keys) {
      return [];
    }
    const out: SummaryResult[] = [];
    for (const key of keys) {
      const indexed = this.byKey.get(key);
      if (indexed) {
        out.push({ ...indexed.result });
      }
    }
    return out;
  }

  /**
   * Every indexed *entry* produced by a given technique.
   *
   * Like {@link SummarizationIndex.findByTechnique} but returns the fuller
   * {@link IndexedSummary} shape (key, length bucket, length) for callers that
   * need the denormalised fields.
   *
   * @param technique - the technique to filter by
   * @returns a fresh array of {@link IndexedSummary} copies in insertion order
   */
  findEntriesByTechnique(technique: SummarizeTechnique): IndexedSummary[] {
    const keys = this.byTechnique.get(technique);
    if (!keys) {
      return [];
    }
    const out: IndexedSummary[] = [];
    for (const key of keys) {
      const indexed = this.byKey.get(key);
      if (indexed) {
        out.push(this.copyOf(indexed));
      }
    }
    return out;
  }

  /**
   * Every indexed result whose `summaryLength` fell into a given bucket.
   *
   * @param bucket - the bucket label (see {@link lengthBucket})
   * @returns a fresh array of {@link SummaryResult} copies in insertion order
   */
  findByLengthBucket(bucket: string): SummaryResult[] {
    const keys = this.byBucket.get(bucket);
    if (!keys) {
      return [];
    }
    const out: SummaryResult[] = [];
    for (const key of keys) {
      const indexed = this.byKey.get(key);
      if (indexed) {
        out.push({ ...indexed.result });
      }
    }
    return out;
  }

  /**
   * Every indexed result whose `summaryLength` lies in `[min, max]`.
   *
   * Narrowing happens in two stages: first the coarse length buckets whose
   * range can possibly overlap `[min, max]` are collected (buckets entirely
   * outside the window are skipped without examining their members), then each
   * candidate member's exact `summaryLength` is compared. A `max` of `0` means
   * *no upper bound*; a `min` of `0` means *no lower bound*.
   *
   * @param min - the minimum `summaryLength` (inclusive; `0` = unbounded)
   * @param max - the maximum `summaryLength` (inclusive; `0` = unbounded)
   * @returns a fresh array of matching {@link SummaryResult} copies
   */
  findByLengthRange(min: number, max: number): SummaryResult[] {
    const lower = clampLength(min);
    const upper = clampLength(max);
    const candidates = new Set<string>();
    for (const [bucket, keys] of this.byBucket) {
      if (this.bucketOverlaps(bucket, lower, upper)) {
        for (const key of keys) {
          candidates.add(key);
        }
      }
    }
    const out: SummaryResult[] = [];
    for (const key of candidates) {
      const indexed = this.byKey.get(key);
      if (!indexed) {
        continue;
      }
      const within =
        (lower === 0 || indexed.length >= lower) &&
        (upper === 0 || indexed.length <= upper);
      if (within) {
        out.push({ ...indexed.result });
      }
    }
    return out;
  }

  /**
   * Test whether a length bucket's character range overlaps a query window.
   *
   * The bucket label is parsed back into `[start, start + width - 1]`; an open
   * window (`lower` or `upper` of `0`) never excludes a bucket on that side.
   *
   * @param bucket - the bucket label to test
   * @param lower - the query's lower bound (`0` = open)
   * @param upper - the query's upper bound (`0` = open)
   * @returns `true` when the bucket range could contain a matching length
   */
  private bucketOverlaps(bucket: string, lower: number, upper: number): boolean {
    const start = Number.parseInt(bucket.split('-')[0] ?? '0', 10);
    if (!Number.isFinite(start)) {
      return false;
    }
    const end = start + this.bucketWidth - 1;
    if (upper > 0 && start > upper) {
      return false;
    }
    if (lower > 0 && end < lower) {
      return false;
    }
    return true;
  }

  /**
   * Every indexed result, in insertion order.
   *
   * @returns a fresh array of {@link SummaryResult} copies
   */
  values(): SummaryResult[] {
    return [...this.byKey.values()].map((indexed) => ({ ...indexed.result }));
  }

  /**
   * The length buckets currently in use, with their member counts.
   *
   * @returns a fresh array of `{ bucket, count }` in bucket order
   */
  buckets(): Array<{ bucket: string; count: number }> {
    const out: Array<{ bucket: string; count: number }> = [];
    for (const [bucket, keys] of this.byBucket) {
      if (keys.size > 0) {
        out.push({ bucket, count: keys.size });
      }
    }
    return out;
  }

  /**
   * The number of results currently indexed.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Rebuild the entire index from an iterable of `[key, result]` pairs.
   *
   * Atomically clears every existing index and repopulates it from `entries`.
   * Useful for mirroring a store snapshot, re-indexing after a restore, or
   * indexing a freshly-loaded serialised state. Invalid results in the source
   * are silently skipped.
   *
   * @param entries - the `[key, result]` pairs to index
   * @returns the number of results actually indexed
   */
  rebuild(entries: Iterable<readonly [string, SummaryResult]>): number {
    this.clear();
    let indexed = 0;
    for (const [key, result] of entries) {
      if (this.indexResult(key, result)) {
        indexed += 1;
      }
    }
    return indexed;
  }

  /**
   * Empty every index.
   */
  clear(): void {
    this.byKey.clear();
    for (const set of this.byTechnique.values()) {
      set.clear();
    }
    this.byBucket.clear();
  }

  /**
   * Snapshot the shape and health of the index.
   *
   * @returns a {@link SummarizationIndexStats} report
   */
  stats(): SummarizationIndexStats {
    const byTechnique: Record<SummarizeTechnique, number> = {
      extractive: this.byTechnique.get('extractive')!.size,
      keyword: this.byTechnique.get('keyword')!.size,
      rolling: this.byTechnique.get('rolling')!.size,
    };
    const byBucket: Record<string, number> = {};
    let totalLength = 0;
    for (const indexed of this.byKey.values()) {
      totalLength += indexed.length;
      byBucket[indexed.lengthBucket] = (byBucket[indexed.lengthBucket] ?? 0) + 1;
    }
    return {
      size: this.byKey.size,
      byTechnique,
      byBucket,
      totalLength,
      averageLength: this.byKey.size === 0 ? 0 : totalLength / this.byKey.size,
    };
  }

  /**
   * A shallow copy of an indexed entry.
   *
   * @param indexed - the entry to copy
   * @returns a copy with an isolated result object
   */
  private copyOf(indexed: IndexedSummary): IndexedSummary {
    return { ...indexed, result: { ...indexed.result } };
  }

  /**
   * Iterate over every indexed result in insertion order.
   */
  *[Symbol.iterator](): IterableIterator<SummaryResult> {
    for (const indexed of this.byKey.values()) {
      yield { ...indexed.result };
    }
  }

  /**
   * Build an index pre-populated from an iterable of `[key, result]` pairs.
   *
   * @param entries - the pairs to index
   * @param options - optional bucket-width override
   * @returns a populated {@link SummarizationIndex}
   */
  static from(
    entries: Iterable<readonly [string, SummaryResult]>,
    options: SummarizationIndexOptions = {},
  ): SummarizationIndex {
    const index = new SummarizationIndex(options);
    index.rebuild(entries);
    return index;
  }
}

/**
 * Narrow a value to {@link SummarizeTechnique} at the module boundary.
 *
 * Re-exported so callers of the index do not need to reach into `types.ts`
 * just to filter by technique.
 *
 * @param value - the value to test
 * @returns `true` when the value is one of the three techniques
 */
export function isIndexedTechnique(value: unknown): value is SummarizeTechnique {
  return isSummarizeTechnique(value);
}