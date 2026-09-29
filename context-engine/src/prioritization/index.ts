/**
 * Score-bucket / role index for the **Prioritization** layer of the standalone
 * MAM Context Engine.
 *
 * {@link PriorityIndex} answers the read-side questions the rest of the layer
 * keeps asking: *"which parts are critical right now?"*, *"show me everything
 * that is a user instruction"*, *"what scores fall inside `[0.4, 0.7]`?"*.
 * Rather than scanning every {@link PriorityScore} on each query, it maintains
 * a set of secondary indexes — one bucket per {@link PriorityBucket}, one set
 * per {@link PartRole}, plus a keyed primary index — and keeps them consistent
 * through explicit {@link PriorityIndex.indexEntry} /
 * {@link PriorityIndex.removeEntry} calls or a wholesale
 * {@link PriorityIndex.rebuild}.
 *
 * Responsibilities:
 *
 * - **Index** — {@link PriorityIndex.indexEntry} inserts or updates an entry
 *   and moves it to the correct score and role buckets;
 *   {@link PriorityIndex.removeEntry} evicts it from every index.
 * - **Query** — {@link PriorityIndex.findByRole} resolves entries by role;
 *   {@link PriorityIndex.findByScoreRange} resolves entries whose score falls
 *   inside `[min, max]`; {@link PriorityIndex.findByBucket} resolves a single
 *   {@link PriorityBucket}; {@link PriorityIndex.get} / {@link PriorityIndex
 *   .has} look up by part id.
 * - **Rebuild** — {@link PriorityIndex.rebuild} drops and re-populates the
 *   whole index from an arbitrary iterable of scores, which is how a
 *   {@link PriorityStore} snapshot gets mirrored into the index cheaply.
 * - **Reset** — {@link PriorityIndex.clear} empties every index at once.
 * - **Inspect** — {@link PriorityIndex.stats} exposes the shape and health of
 *   the index (per-role and per-bucket counts, min/max/average score).
 *
 * The index is deliberately **decoupled from {@link PriorityStore}**: it
 * indexes plain {@link PriorityScore} objects, so it can mirror the store's
 * live cache, index scores from a serialised snapshot, or even index a
 * hypothetical "what-if" ranking without touching the store at all.
 *
 * @module prioritization/index
 */

import { scoreBucket } from './types.js';
import type {
  PartRole,
  PriorityBucket,
  PriorityIndexStats,
  PriorityScore,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link PriorityIndex}.
 */
export interface PriorityIndexOptions {
  /**
   * Clock used for all timestamps. Injecting a clock makes the index
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Shape of the {@link PriorityIndex.findByScoreRange} / `findByRole` /
 * `findByBucket` results.
 */
export interface PriorityIndexEntry {
  /**
   * The indexed score itself.
   */
  readonly score: PriorityScore;

  /**
   * The part id of the indexed entry (aliases `score.partId` for ergonomics).
   */
  readonly partId: string;

  /**
   * The score bucket the entry currently occupies.
   */
  readonly bucket: PriorityBucket;

  /**
   * The role the entry is indexed under.
   */
  readonly role: PartRole;

  /**
   * Epoch-millisecond time the entry was (re)indexed.
   */
  readonly indexedAt: Timestamp;
}

/**
 * The score-bucket / role index.
 *
 * @example
 * ```ts
 * const index = new PriorityIndex();
 * index.indexEntry(score);
 * index.findByRole('user');          // all user-role parts
 * index.findByScoreRange(0.5, 1);    // everything at or above 0.5
 * index.findByBucket('critical');    // everything in the critical bucket
 * ```
 */
export class PriorityIndex {
  /** Part id → indexed entry. */
  private readonly _entries: Map<string, PriorityIndexEntry>;

  /** Role → set of part ids. */
  private readonly _byRole: Map<PartRole, Set<string>>;

  /** Bucket → set of part ids. */
  private readonly _byBucket: Map<PriorityBucket, Set<string>>;

  /** Clock used for `indexedAt` timestamps. */
  private readonly _now: () => Timestamp;

  /**
   * @param options - construction options
   */
  constructor(options: PriorityIndexOptions = {}) {
    this._entries = new Map<string, PriorityIndexEntry>();
    this._byRole = new Map<PartRole, Set<string>>();
    this._byBucket = new Map<PriorityBucket, Set<string>>();
    this._now = options.now ?? (() => Date.now());
  }

  /**
   * Number of entries currently indexed.
   */
  get size(): number {
    return this._entries.size;
  }

  /**
   * True when no entries are indexed.
   */
  get empty(): boolean {
    return this._entries.size === 0;
  }

  /**
   * Whether an entry is indexed for the given part id.
   *
   * @param partId - the part id to look up
   * @returns `true` when an entry exists
   */
  has(partId: string): boolean {
    return this._entries.has(partId);
  }

  /**
   * Retrieve the indexed entry for a part id.
   *
   * @param partId - the part id to look up
   * @returns the indexed entry, or `undefined` when absent
   */
  get(partId: string): PriorityIndexEntry | undefined {
    return this._entries.get(partId);
  }

  /**
   * Index (or re-index) a {@link PriorityScore}.
   *
   * Inserts or updates the primary entry and moves the part id into the
   * correct role and score-bucket sets, removing it from any previously held
   * buckets so counts stay exact. This is idempotent: re-indexing the same
   * score (or a changed score for the same part id) leaves exactly one entry
   * per part id.
   *
   * @param score - the score to index
   * @returns `true` when the entry was accepted and indexed
   */
  indexEntry(score: PriorityScore): boolean {
    if (typeof score?.partId !== 'string' || score.partId.length === 0) {
      return false;
    }
    const partId = score.partId;
    const role: PartRole = score.role ?? 'ambient';
    const bucket = scoreBucket(score.score);
    const entry: PriorityIndexEntry = {
      score,
      partId,
      bucket,
      role,
      indexedAt: this._now(),
    };

    const previous = this._entries.get(partId);
    if (previous) {
      this._removeFromSets(partId, previous.role, previous.bucket);
    }

    this._entries.set(partId, entry);
    this._addToSet(this._byRole, role, partId);
    this._addToSet(this._byBucket, bucket, partId);
    return true;
  }

  /**
   * Remove the indexed entry for a part id from every index.
   *
   * @param partId - the part id to evict
   * @returns `true` when an entry was removed
   */
  removeEntry(partId: string): boolean {
    const previous = this._entries.get(partId);
    if (!previous) return false;
    this._entries.delete(partId);
    this._removeFromSets(partId, previous.role, previous.bucket);
    return true;
  }

  /**
   * Resolve every entry whose role is `role`.
   *
   * @param role - the {@link PartRole} to filter by
   * @returns the matching entries in insertion order; empty when none
   */
  findByRole(role: PartRole): PriorityIndexEntry[] {
    const partIds = this._byRole.get(role);
    if (!partIds) return [];
    const out: PriorityIndexEntry[] = [];
    for (const partId of partIds) {
      const entry = this._entries.get(partId);
      if (entry) out.push(entry);
    }
    return out;
  }

  /**
   * Resolve every entry whose score falls inside `[min, max]` (inclusive on
   * both ends).
   *
   * Because the index is bucketed, this scans the *candidate buckets* that
   * intersect the range rather than the whole store — a cheap bounded sweep for
   * the common case.
   *
   * @param min - lower bound, clamped to `0`
   * @param max - upper bound, clamped to `1`
   * @returns matching entries sorted by score descending
   */
  findByScoreRange(min: number, max: number): PriorityIndexEntry[] {
    const lo = Math.max(0, min);
    const hi = Math.min(1, max);
    if (lo > hi) return [];

    const buckets = this._bucketsOverlapping(lo, hi);
    const seen = new Set<string>();
    const out: PriorityIndexEntry[] = [];
    for (const bucket of buckets) {
      const partIds = this._byBucket.get(bucket);
      if (!partIds) continue;
      for (const partId of partIds) {
        if (seen.has(partId)) continue;
        const entry = this._entries.get(partId);
        if (entry && entry.score.score >= lo && entry.score.score <= hi) {
          seen.add(partId);
          out.push(entry);
        }
      }
    }
    return out.sort((a, b) => b.score.score - a.score.score);
  }

  /**
   * Resolve every entry currently in a given score {@link PriorityBucket}.
   *
   * @param bucket - the bucket to resolve
   * @returns the matching entries in insertion order
   */
  findByBucket(bucket: PriorityBucket): PriorityIndexEntry[] {
    const partIds = this._byBucket.get(bucket);
    if (!partIds) return [];
    const out: PriorityIndexEntry[] = [];
    for (const partId of partIds) {
      const entry = this._entries.get(partId);
      if (entry) out.push(entry);
    }
    return out;
  }

  /**
   * Resolve the single highest-scoring entry.
   *
   * @returns the top entry, or `undefined` when empty
   */
  max(): PriorityIndexEntry | undefined {
    let best: PriorityIndexEntry | undefined;
    for (const entry of this._entries.values()) {
      if (!best || entry.score.score > best.score.score) best = entry;
    }
    return best;
  }

  /**
   * Resolve the single lowest-scoring entry.
   *
   * @returns the bottom entry, or `undefined` when empty
   */
  min(): PriorityIndexEntry | undefined {
    let worst: PriorityIndexEntry | undefined;
    for (const entry of this._entries.values()) {
      if (!worst || entry.score.score < worst.score.score) worst = entry;
    }
    return worst;
  }

  /**
   * Drop every index and rebuild it from the given scores.
   *
   * This is the recommended way to mirror a {@link PriorityStore} snapshot (or
   * any iterable of scores) into the index: it is `O(n)` and leaves the index
   * exactly consistent with its input.
   *
   * @param scores - the scores to index
   * @returns the number of entries indexed
   */
  rebuild(scores: Iterable<PriorityScore>): number {
    this.clear();
    let count = 0;
    for (const score of scores) {
      if (this.indexEntry(score)) count += 1;
    }
    return count;
  }

  /**
   * Empty every index at once.
   */
  clear(): void {
    this._entries.clear();
    this._byRole.clear();
    this._byBucket.clear();
  }

  /**
   * Roll the index up into a {@link PriorityIndexStats} report.
   *
   * @returns the aggregate statistics for the current index
   */
  stats(): PriorityIndexStats {
    const count = this._entries.size;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (const entry of this._entries.values()) {
      if (entry.score.score > max) max = entry.score.score;
      sum += entry.score.score;
    }
    const byBucket = (Object.keys(BUCKET_ORDER) as PriorityBucket[]).reduce(
      (acc, bucket) => {
        acc[bucket] = this._byBucket.get(bucket)?.size ?? 0;
        return acc;
      },
      {} as Record<PriorityBucket, number>,
    );
    const byRole: Partial<Record<PartRole, number>> = {};
    for (const [role, set] of this._byRole) {
      byRole[role] = set.size;
    }
    return {
      size: count,
      byBucket,
      byRole,
      maxScore: count > 0 ? max : 0,
      meanScore: count > 0 ? sum / count : 0,
    };
  }

  /**
   * The roles currently present in the index.
   *
   * @returns an array of distinct roles
   */
  roles(): PartRole[] {
    return Array.from(this._byRole.keys());
  }

  /**
   * The buckets currently present in the index.
   *
   * @returns an array of distinct buckets
   */
  buckets(): PriorityBucket[] {
    return Array.from(this._byBucket.keys());
  }

  /**
   * Add a part id to one of the secondary index maps, creating the set on
   * first use.
   *
   * @param map - the role or bucket map
   * @param key - the map key
   * @param partId - the part id to add
   */
  private _addToSet<K extends string>(
    map: Map<K, Set<string>>,
    key: K,
    partId: string,
  ): void {
    let set = map.get(key);
    if (!set) {
      set = new Set<string>();
      map.set(key, set);
    }
    set.add(partId);
  }

  /**
   * Remove a part id from the role and bucket sets, pruning now-empty sets so
   * `roles()` / `buckets()` never report stale keys.
   *
   * @param partId - the part id to remove
   * @param role - the role it currently occupies
   * @param bucket - the bucket it currently occupies
   */
  private _removeFromSets(
    partId: string,
    role: PartRole,
    bucket: PriorityBucket,
  ): void {
    const roleSet = this._byRole.get(role);
    if (roleSet) {
      roleSet.delete(partId);
      if (roleSet.size === 0) this._byRole.delete(role);
    }
    const bucketSet = this._byBucket.get(bucket);
    if (bucketSet) {
      bucketSet.delete(partId);
      if (bucketSet.size === 0) this._byBucket.delete(bucket);
    }
  }

  /**
   * Which buckets could contain scores inside `[lo, hi]`.
   *
   * Uses the fixed {@link DEFAULT_BUCKET_EDGES} semantics: `'low'` covers
   * `[0, 0.3)`, `'medium'` `[0.3, 0.6)`, `'high'` `[0.6, 0.8)` and
   * `'critical'` `[0.8, 1]`. A range that straddles an edge includes both
   * neighbouring buckets.
   *
   * @param lo - lower bound
   * @param hi - upper bound
   * @returns the candidate buckets in ascending score order
   */
  private _bucketsOverlapping(lo: number, hi: number): PriorityBucket[] {
    const out: PriorityBucket[] = [];
    if (hi >= 0 && lo < 0.3) out.push('low');
    if (hi >= 0.3 && lo < 0.6) out.push('medium');
    if (hi >= 0.6 && lo < 0.8) out.push('high');
    if (hi >= 0.8 && lo <= 1) out.push('critical');
    return out;
  }
}

/**
 * Canonical bucket ordering used by {@link PriorityIndex.stats}.
 */
const BUCKET_ORDER: Record<PriorityBucket, true> = {
  low: true,
  medium: true,
  high: true,
  critical: true,
};