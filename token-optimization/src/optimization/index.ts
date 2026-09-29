/**
 * @file index.ts
 * @module optimization/index
 *
 * {@link OptimizationIndex}: a derived, query-oriented view over cached
 * optimization results.
 *
 * While {@link OptimizationStore} is the authoritative cache, the index is
 * the *read model*: it classifies every indexed {@link OptimizeResult} by
 * three orthogonal dimensions and maintains reverse maps so callers can
 * answer questions such as:
 *
 *  - "which cached results used the compression strategy?" (`findByStrategy`);
 *  - "which results saved between 25% and 50%?" (`findBySavingsRange`);
 *  - "which results came from a 3-section prompt?" (`findBySectionCount`);
 *  - "what does the optimization history look like?" (`stats`);
 *
 * The index never mutates results; it is fed by {@link indexResult} and kept
 * in sync by whoever owns the store (the {@link OptimizationLifecycle} in
 * practice). Call {@link rebuild} to bulk-resync from a list of
 * `[key, result]` pairs, e.g. after deserialization.
 *
 * @packageDocumentation
 */

import type { OptimizeResult } from './types.js';

import { clampPercent, isOptimizeResult } from './types.js';

/* ------------------------------------------------------------------------ *
 * Savings buckets
 * ------------------------------------------------------------------------ */

/**
 * Discrete savings buckets used to classify results by `savedPercent`.
 *
 * - `'0-10'`:    saved up to 10% — a light pass.
 * - `'10-25'`:   saved 10%..25% — a moderate pass.
 * - `'25-50'`:   saved 25%..50% — a strong pass.
 * - `'50-100'`:  saved 50% or more — a heavy pass.
 */
export const SAVINGS_BUCKETS = ['0-10', '10-25', '25-50', '50-100'] as const;

/**
 * A union of the savings buckets ({@link SAVINGS_BUCKETS} as a type).
 */
export type SavingsBucket = (typeof SAVINGS_BUCKETS)[number];

/**
 * A savings bucket together with its numeric range.
 */
export interface SavingsBucketRange {
  /** The bucket label (one of {@link SAVINGS_BUCKETS}). */
  bucket: SavingsBucket;
  /** Inclusive lower bound of the bucket (a percentage). */
  min: number;
  /** Exclusive upper bound of the bucket (a percentage; 101 for the last). */
  max: number;
}

/**
 * Numeric ranges for each {@link SavingsBucket}, used by {@link bucketFor}
 * and {@link bucketRange}.
 */
export const SAVINGS_BUCKET_RANGES: Readonly<Record<SavingsBucket, SavingsBucketRange>> = {
  '0-10': { bucket: '0-10', min: 0, max: 10 },
  '10-25': { bucket: '10-25', min: 10, max: 25 },
  '25-50': { bucket: '25-50', min: 25, max: 50 },
  '50-100': { bucket: '50-100', min: 50, max: 101 },
} as const;

/**
 * Returns the {@link SavingsBucket} a `savedPercent` value falls into.
 * Values below `0` are clamped to `0`; values at or above `50` land in
 * `'50-100'`.
 */
export function bucketFor(savedPercent: number): SavingsBucket {
  const value = Number.isFinite(savedPercent) ? Math.max(0, Math.min(100, savedPercent)) : 0;
  if (value < 10) return '0-10';
  if (value < 25) return '10-25';
  if (value < 50) return '25-50';
  return '50-100';
}

/**
 * Returns the numeric range for a {@link SavingsBucket}.
 */
export function bucketRange(bucket: SavingsBucket): SavingsBucketRange {
  return SAVINGS_BUCKET_RANGES[bucket];
}

/**
 * Returns `true` when `value` is one of the valid {@link SavingsBucket}s.
 */
export function isSavingsBucket(value: unknown): value is SavingsBucket {
  return typeof value === 'string' && (SAVINGS_BUCKETS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------------ *
 * Index shapes
 * ------------------------------------------------------------------------ */

/**
 * An indexed optimization result plus its derived classifications.
 */
export interface IndexedOptimization {
  /** Cache key the result lives under in the store. */
  key: string;
  /** The indexed result (a stable reference, not a copy). */
  result: OptimizeResult;
  /** Derived savings bucket from `result.savedPercent`. */
  bucket: SavingsBucket;
  /** The strategy names present in `result.applied` (deduplicated). */
  strategies: string[];
  /** Number of sections in `result.sections`. */
  sectionCount: number;
  /** Epoch milliseconds when the result was indexed. */
  indexedAt: number;
}

/**
 * Plain-JSON shape produced by {@link OptimizationIndex.toJSON} and accepted
 * by {@link OptimizationIndex.fromJSON}.
 */
export interface OptimizationIndexJSON {
  /** Serialization version, currently always `1`. */
  version: 1;
  /** The indexed entries, in insertion order. */
  entries: IndexedOptimization[];
}

/**
 * Aggregate counts over the index's current distribution.
 */
export interface OptimizationIndexStats {
  /** Total number of indexed results. */
  total: number;
  /** Count of results per savings bucket. */
  buckets: Record<SavingsBucket, number>;
  /** Count of results per strategy name. */
  strategies: Record<string, number>;
  /** Distribution of results by section count (count -> number of results). */
  bySectionCount: Record<number, number>;
  /** Mean saved percent across all indexed results (0..100). */
  avgSavedPercent: number;
  /** Mean saved tokens across all indexed results. */
  avgSavedTokens: number;
  /** Mean section count across all indexed results. */
  avgSections: number;
  /** Sum of `savedTokens` across all indexed results. */
  totalSavedTokens: number;
  /** Sum of `originalTokens` across all indexed results. */
  totalOriginalTokens: number;
}

/**
 * Constructor options for {@link OptimizationIndex}. Currently unused but
 * retained so the constructor signature can evolve without breaking callers.
 */
export interface OptimizationIndexOptions {
  /** (Reserved) future tuning knobs for bucket boundaries. */
  bucketOverrides?: Partial<Record<SavingsBucket, [number, number]>>;
}

/* ------------------------------------------------------------------------ *
 * Index
 * ------------------------------------------------------------------------ */

/**
 * Query-oriented read model over cached optimization results.
 *
 * Maintains a forward map `key -> IndexedOptimization` plus reverse maps
 * `strategy -> keys`, `bucket -> keys` and `sectionCount -> keys` so every
 * query path is O(1) to enter and only linear over the matching set. All
 * lookups are read-only; mutation happens via {@link indexResult},
 * {@link removeResult} and {@link rebuild}.
 */
export class OptimizationIndex {
  /** Forward map: cache key -> indexed entry. */
  private readonly _entries: Map<string, IndexedOptimization>;
  /** Reverse map: strategy name -> set of cache keys. */
  private readonly _byStrategy: Map<string, Set<string>>;
  /** Reverse map: savings bucket -> set of cache keys. */
  private readonly _byBucket: Map<SavingsBucket, Set<string>>;
  /** Reverse map: section count -> set of cache keys. */
  private readonly _bySectionCount: Map<number, Set<string>>;

  /**
   * Creates an empty index.
   *
   * @param options - reserved tuning (see {@link OptimizationIndexOptions}).
   */
  constructor(_options: OptimizationIndexOptions = {}) {
    this._entries = new Map<string, IndexedOptimization>();
    this._byStrategy = new Map<string, Set<string>>();
    this._byBucket = new Map<SavingsBucket, Set<string>>();
    for (const bucket of SAVINGS_BUCKETS) {
      this._byBucket.set(bucket, new Set<string>());
    }
    this._bySectionCount = new Map<number, Set<string>>();
  }

  /* -------------------------------------------------------------------- *
   * Classification
   * -------------------------------------------------------------------- */

  /**
   * Classifies a result into an {@link IndexedOptimization} without touching
   * the index. Handy for previews and for computing a single entry's shape.
   */
  classify(key: string, result: OptimizeResult, indexedAt: number = Date.now()): IndexedOptimization {
    if (!isOptimizeResult(result)) {
      throw new TypeError(`Invalid OptimizeResult for key "${key}"`);
    }
    const strategies = Array.from(new Set(result.applied)).sort();
    return {
      key,
      result,
      bucket: bucketFor(result.savedPercent),
      strategies,
      sectionCount: Array.isArray(result.sections) ? result.sections.length : 0,
      indexedAt,
    };
  }

  /* -------------------------------------------------------------------- *
   * Mutation
   * -------------------------------------------------------------------- */

  /**
   * Inserts or replaces the indexed entry for a cache key.
   *
   * The three reverse maps are kept in sync: the key leaves any previous
   * buckets and joins the ones matching its current classification.
   *
   * @returns the indexed entry.
   */
  indexResult(key: string, result: OptimizeResult, indexedAt: number = Date.now()): IndexedOptimization {
    const entry = this.classify(key, result, indexedAt);
    const previous = this._entries.get(key);
    if (previous) {
      this._drop(previous);
    }
    this._entries.set(key, entry);
    for (const strategy of entry.strategies) {
      let set = this._byStrategy.get(strategy);
      if (!set) {
        set = new Set<string>();
        this._byStrategy.set(strategy, set);
      }
      set.add(key);
    }
    this._byBucket.get(entry.bucket)?.add(key);
    let countSet = this._bySectionCount.get(entry.sectionCount);
    if (!countSet) {
      countSet = new Set<string>();
      this._bySectionCount.set(entry.sectionCount, countSet);
    }
    countSet.add(key);
    return entry;
  }

  /**
   * Removes a cache key from the index entirely.
   *
   * @returns the removed entry, or `undefined` when the key was not indexed.
   */
  removeResult(key: string): IndexedOptimization | undefined {
    const entry = this._entries.get(key);
    if (!entry) return undefined;
    this._drop(entry);
    this._entries.delete(key);
    return entry;
  }

  /**
   * Clears the index completely.
   */
  clear(): void {
    this._entries.clear();
    this._byStrategy.clear();
    for (const set of this._byBucket.values()) set.clear();
    this._bySectionCount.clear();
  }

  /**
   * Replaces the entire index with freshly classified entries derived from
   * `pairs` of `[key, result]`.
   *
   * @returns the number of results actually indexed.
   */
  rebuild(pairs: Iterable<[string, OptimizeResult]>): number {
    this.clear();
    let indexed = 0;
    for (const [key, result] of pairs) {
      if (!isOptimizeResult(result)) continue;
      this.indexResult(key, result);
      indexed += 1;
    }
    return indexed;
  }

  /**
   * Replaces the entire index with already-shaped {@link IndexedOptimization}
   * entries (e.g. straight from {@link toJSON}). Invalid entries are skipped.
   *
   * @returns the number of entries actually indexed.
   */
  rebuildIndexed(entries: Iterable<unknown>): number {
    this.clear();
    let indexed = 0;
    for (const raw of entries) {
      if (typeof raw !== 'object' || raw === null) continue;
      const parsed = raw as Record<string, unknown>;
      if (typeof parsed['key'] !== 'string') continue;
      if (!isOptimizeResult(parsed['result'])) continue;
      const classified = this.indexResult(
        parsed['key'],
        parsed['result'] as OptimizeResult,
        typeof parsed['indexedAt'] === 'number' && Number.isFinite(parsed['indexedAt'])
          ? parsed['indexedAt']
          : Date.now(),
      );
      if (isSavingsBucket(parsed['bucket']) && classified.bucket !== parsed['bucket']) {
        this._moveBucket(classified.key, classified.bucket, parsed['bucket']);
      }
      indexed += 1;
    }
    return indexed;
  }

  /* -------------------------------------------------------------------- *
   * Read access
   * -------------------------------------------------------------------- */

  /**
   * Returns the indexed entry for `key`, or `undefined`.
   */
  get(key: string): IndexedOptimization | undefined {
    return this._entries.get(key);
  }

  /**
   * Returns `true` when `key` is currently indexed.
   */
  has(key: string): boolean {
    return this._entries.has(key);
  }

  /**
   * Number of indexed results.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * All indexed cache keys, in insertion order.
   */
  keys(): string[] {
    return Array.from(this._entries.keys());
  }

  /**
   * All indexed entries (stable references to the underlying results).
   */
  entries(): IndexedOptimization[] {
    return Array.from(this._entries.values());
  }

  /**
   * All indexed results (stable references, not copies).
   */
  results(): OptimizeResult[] {
    return Array.from(this._entries.values(), (entry) => entry.result);
  }

  /**
   * Returns every indexed result whose `applied` list includes `strategy`.
   */
  findByStrategy(strategy: string): OptimizeResult[] {
    const keys = this._byStrategy.get(strategy);
    if (!keys) return [];
    return Array.from(keys, (key) => this._entries.get(key)!.result);
  }

  /**
   * Returns every indexed result classified under `bucket`.
   */
  findBySavingsBucket(bucket: SavingsBucket): OptimizeResult[] {
    const keys = this._byBucket.get(bucket);
    if (!keys) return [];
    return Array.from(keys, (key) => this._entries.get(key)!.result);
  }

  /**
   * Returns every indexed result whose `savedPercent` lies in the inclusive
   * `[minPercent, maxPercent]` range.
   *
   * Ranges are matched against the raw saved percent, not the bucket labels.
   */
  findBySavingsRange(minPercent: number, maxPercent: number): OptimizeResult[] {
    const min = Number.isFinite(minPercent) ? Math.max(0, minPercent) : 0;
    const max = Number.isFinite(maxPercent) ? Math.min(100, maxPercent) : 100;
    const matches: OptimizeResult[] = [];
    for (const entry of this._entries.values()) {
      if (entry.result.savedPercent >= min && entry.result.savedPercent <= max) {
        matches.push(entry.result);
      }
    }
    return matches;
  }

  /**
   * Returns every indexed result that used any of `strategies`.
   */
  findByAnyStrategy(strategies: Iterable<string>): OptimizeResult[] {
    const seen = new Set<string>();
    const matches: OptimizeResult[] = [];
    for (const strategy of strategies) {
      const keys = this._byStrategy.get(strategy);
      if (!keys) continue;
      for (const key of keys) {
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push(this._entries.get(key)!.result);
      }
    }
    return matches;
  }

  /**
   * Returns every indexed result whose prompt had exactly `count` sections.
   */
  findBySectionCount(count: number): OptimizeResult[] {
    const keys = this._bySectionCount.get(Math.max(0, Math.floor(count)));
    if (!keys) return [];
    return Array.from(keys, (key) => this._entries.get(key)!.result);
  }

  /**
   * Returns every indexed result whose prompt had at most `count` sections.
   */
  findByMaxSections(count: number): OptimizeResult[] {
    const ceiling = Math.max(0, Math.floor(count));
    const matches: OptimizeResult[] = [];
    for (const entry of this._entries.values()) {
      if (entry.sectionCount <= ceiling) matches.push(entry.result);
    }
    return matches;
  }

  /**
   * Returns the top `n` indexed results by `savedPercent`, descending.
   */
  topSavings(n: number): Array<IndexedOptimization> {
    const limit = Math.max(0, Math.floor(n));
    const ranked = Array.from(this._entries.values()).sort(
      (a, b) => b.result.savedPercent - a.result.savedPercent,
    );
    return ranked.slice(0, limit);
  }

  /**
   * Returns the bottom `n` indexed results by `savedPercent`, ascending.
   */
  worstSavings(n: number): Array<IndexedOptimization> {
    const limit = Math.max(0, Math.floor(n));
    const ranked = Array.from(this._entries.values()).sort(
      (a, b) => a.result.savedPercent - b.result.savedPercent,
    );
    return ranked.slice(0, limit);
  }

  /* -------------------------------------------------------------------- *
   * Aggregates
   * -------------------------------------------------------------------- */

  /**
   * Computes distribution statistics over the current index.
   */
  stats(): OptimizationIndexStats {
    const buckets: Record<SavingsBucket, number> = {
      '0-10': 0,
      '10-25': 0,
      '25-50': 0,
      '50-100': 0,
    };
    for (const bucket of SAVINGS_BUCKETS) {
      buckets[bucket] = this._byBucket.get(bucket)?.size ?? 0;
    }
    const strategies: Record<string, number> = {};
    for (const [strategy, set] of this._byStrategy) {
      strategies[strategy] = set.size;
    }
    const bySectionCount: Record<number, number> = {};
    let savedPercentSum = 0;
    let savedTokensSum = 0;
    let sectionsSum = 0;
    for (const entry of this._entries.values()) {
      savedPercentSum += entry.result.savedPercent;
      savedTokensSum += entry.result.savedTokens;
      sectionsSum += entry.sectionCount;
      bySectionCount[entry.sectionCount] = (bySectionCount[entry.sectionCount] ?? 0) + 1;
    }
    const total = this._entries.size;
    return {
      total,
      buckets,
      strategies,
      bySectionCount,
      avgSavedPercent: total > 0 ? clampPercent(savedPercentSum / total) : 0,
      avgSavedTokens: total > 0 ? savedTokensSum / total : 0,
      avgSections: total > 0 ? sectionsSum / total : 0,
      totalSavedTokens: savedTokensSum,
      totalOriginalTokens: Array.from(
        this._entries.values(),
        (entry) => entry.result.originalTokens,
      ).reduce((sum, value) => sum + value, 0),
    };
  }

  /* -------------------------------------------------------------------- *
   * Serialization
   * -------------------------------------------------------------------- */

  /**
   * Serializes the index to a plain, JSON-friendly object.
   */
  toJSON(): OptimizationIndexJSON {
    return {
      version: 1,
      entries: Array.from(this._entries.values(), (entry) => ({
        key: entry.key,
        result: { ...entry.result, sections: entry.result.sections.map((s) => ({ ...s })) },
        bucket: entry.bucket,
        strategies: Array.from(entry.strategies),
        sectionCount: entry.sectionCount,
        indexedAt: entry.indexedAt,
      })),
    };
  }

  /**
   * Clears and reloads the index from `data`. Invalid entries are skipped.
   *
   * @returns `this` for chaining.
   */
  fromJSON(data: unknown): this {
    this.clear();
    if (typeof data !== 'object' || data === null) return this;
    const parsed = data as Record<string, unknown>;
    const list = parsed['entries'];
    if (Array.isArray(list)) {
      this.rebuildIndexed(list);
    }
    return this;
  }

  /**
   * Rehydrates a new index from a JSON payload (see {@link toJSON}).
   */
  static from(data: unknown): OptimizationIndex {
    const index = new OptimizationIndex();
    index.fromJSON(data);
    return index;
  }

  /**
   * Builds an index directly from `[key, result]` pairs.
   */
  static build(
    pairs: Iterable<[string, OptimizeResult]>,
    options: OptimizationIndexOptions = {},
  ): OptimizationIndex {
    const index = new OptimizationIndex(options);
    index.rebuild(pairs);
    return index;
  }

  /* -------------------------------------------------------------------- *
   * Internals
   * -------------------------------------------------------------------- */

  /**
   * Removes an entry from every reverse map it belongs to.
   */
  private _drop(entry: IndexedOptimization): void {
    for (const strategy of entry.strategies) {
      this._byStrategy.get(strategy)?.delete(entry.key);
    }
    this._byBucket.get(entry.bucket)?.delete(entry.key);
    const countSet = this._bySectionCount.get(entry.sectionCount);
    if (countSet) {
      countSet.delete(entry.key);
      if (countSet.size === 0) this._bySectionCount.delete(entry.sectionCount);
    }
  }

  /**
   * Moves a key between savings buckets, used when a deserialized entry
   * disagrees with the freshly computed classification.
   */
  private _moveBucket(key: string, from: SavingsBucket, to: SavingsBucket): void {
    this._byBucket.get(from)?.delete(key);
    this._byBucket.get(to)?.add(key);
    const entry = this._entries.get(key);
    if (entry) entry.bucket = to;
  }
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createOptimizationIndex(
  options: OptimizationIndexOptions = {},
): OptimizationIndex {
  return new OptimizationIndex(options);
}