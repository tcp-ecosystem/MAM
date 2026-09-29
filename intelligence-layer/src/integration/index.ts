/**
 * @fileoverview
 * In-memory secondary index over consolidated knowledge.
 *
 * The {@link KnowledgeIndex} complements the {@link KnowledgeStore}: where
 * the store answers "what entry lives at this id?" by identity, the index
 * answers navigation questions like "which entries cite this source?", "which
 * entries mention these tokens?", and "which entries fall in this confidence
 * band?".
 *
 * A knowledge base typically holds thousands of entries, and consumers rarely
 * want to scan them linearly:
 *
 *   - a reviewer wants every entry sourced from `docs/api.md` so it can verify
 *     the claims about the API are all backed by the same document;
 *   - an operator wants every low-confidence entry so it can be flagged for
 *     human review;
 *   - a calibration loop wants entries whose confidence falls in a band so it
 *     can tune the {@link IntegrateConfig.minConfidence}.
 *
 * The index keeps four structures in sync:
 *
 *   1. `byKey`       — the canonical entry store (keyed by entry `id`).
 *   2. `bySource`    — source label -> ids.
 *   3. `byToken`     — normalized token -> ids, plus a per-entry token count
 *      so "how informative is this entry" is an O(1) lookup.
 *   4. `byConfidence` — confidence bucket -> ids, for instant
 *      high/medium/low scans.
 *
 * Every mutating operation keeps all four consistent, so queries never return
 * results that were removed or references to entries that were never added.
 *
 * @packageDocumentation
 */

import {
  type IntegrateStats,
  type KnowledgeEntry,
  assertKnowledgeEntry,
  confidenceOf,
  createIntegrateStats,
} from './types.js';
import { entryTokens } from './retrieval.js';

/**
 * The confidence buckets used by the index.
 *
 * Bucketing turns a continuous `[0, 1]` confidence into three reviewable
 * classes so operators can reason about "how many entries are risky" without
 * staring at floats.  The thresholds are inclusive on the lower edge:
 * `high` is `[0.70, 1]`, `medium` is `[0.40, 0.70)`, and `low` is
 * `[0, 0.40)`.
 */
export type ConfidenceBucket = 'high' | 'medium' | 'low';

/**
 * The lower bound (inclusive) at which a confidence value enters each bucket.
 */
export const CONFIDENCE_BUCKET_FLOORS: Readonly<Record<ConfidenceBucket, number>> = {
  high: 0.7,
  medium: 0.4,
  low: 0,
} as const;

/** The buckets, ordered from strictest to loosest for threshold sweeps. */
export const CONFIDENCE_BUCKETS: readonly ConfidenceBucket[] = ['high', 'medium', 'low'];

/**
 * The default effective confidence assumed by the index when an entry carries
 * no explicit confidence.  Re-exported from the types module for convenience.
 */
export { DEFAULT_CONFIDENCE } from './types.js';

/**
 * The summary shape returned by {@link KnowledgeIndex.stats}.
 *
 * Extends the shared {@link IntegrateStats} contract with the token index
 * shape and the per-bucket population counts.
 */
export interface IndexStats extends IntegrateStats {
  /** Number of distinct tokens in the token index. */
  readonly tokens: number;

  /** Number of distinct source labels in the index. */
  readonly sources: number;

  /** Number of high-confidence entries. */
  readonly high: number;

  /** Number of medium-confidence entries. */
  readonly medium: number;

  /** Number of low-confidence entries. */
  readonly low: number;
}

/**
 * The snapshot shape produced by {@link KnowledgeIndex.toJSON} and consumed
 * by {@link KnowledgeIndex.fromJSON}.
 */
export interface KnowledgeIndexSnapshot {
  /** Index version; used by `fromJSON` to reject incompatible snapshots. */
  readonly version: 1;
  /** The indexed entries. */
  readonly entries: readonly KnowledgeEntry[];
}

/**
 * An in-memory secondary index over consolidated knowledge.
 *
 * Keys are the entries' own `id` values, so the index aligns naturally with
 * the {@link KnowledgeStore} and re-indexing the same id is idempotent.  Use
 * the index alongside a store, or standalone when entries only need to be
 * queried, not stored.
 */
export class KnowledgeIndex {
  /** Canonical entry store: id -> entry. */
  private readonly byKey = new Map<string, KnowledgeEntry>();

  /** Source label -> set of ids that carry that source. */
  private readonly bySource = new Map<string, Set<string>>();

  /** Normalized token -> set of ids whose entry contains the token. */
  private readonly byToken = new Map<string, Set<string>>();

  /** Confidence bucket -> set of ids, partitioned by bucketed confidence. */
  private readonly byConfidence = new Map<ConfidenceBucket, Set<string>>();

  /** id -> token count (the entry's information-content signal). */
  private readonly tokenCounts = new Map<string, number>();

  /**
   * Indexes an entry under its `id`.
   *
   * If a different entry already lives at `id`, it is replaced: the old
   * entry's index rows are removed first, so no stale rows survive.  Tokens
   * come from the entry's precomputed `tokens` field when present, otherwise
   * from a fresh tokenization of its content.
   *
   * @returns The id under which the entry was indexed.
   */
  indexEntry(entry: KnowledgeEntry): string {
    assertKnowledgeEntry(entry);

    if (this.byKey.has(entry.id)) {
      this.removeEntry(entry.id);
    }

    this.byKey.set(entry.id, entry);
    this.tokenCounts.set(entry.id, entryTokens(entry).length);
    this.indexByConfidence(entry.id, entry);
    this.indexByTokens(entry.id, entry);
    for (const source of KnowledgeIndex.sourcesOf(entry)) {
      KnowledgeIndex.addToSet(this.bySource, source, entry.id);
    }
    return entry.id;
  }

  /**
   * Indexes many entries, returning the number indexed.  Each entry is
   * indexed under its own id.
   */
  indexMany(entries: readonly KnowledgeEntry[]): number {
    let count = 0;
    for (const entry of entries) {
      this.indexEntry(entry);
      count += 1;
    }
    return count;
  }

  /**
   * Removes an entry by id.
   *
   * @returns `true` when the id was indexed and has been removed.
   */
  removeEntry(id: string): boolean {
    const entry = this.byKey.get(id);
    if (entry === undefined) return false;

    this.byKey.delete(id);
    this.tokenCounts.delete(id);

    const bucket = this.bucketOf(confidenceOf(entry));
    const bucketSet = this.byConfidence.get(bucket);
    bucketSet?.delete(id);
    if (bucketSet !== undefined && bucketSet.size === 0) this.byConfidence.delete(bucket);

    for (const token of entryTokens(entry)) {
      const tokenSet = this.byToken.get(token);
      tokenSet?.delete(id);
      if (tokenSet !== undefined && tokenSet.size === 0) this.byToken.delete(token);
    }

    for (const source of KnowledgeIndex.sourcesOf(entry)) {
      const sourceSet = this.bySource.get(source);
      sourceSet?.delete(id);
      if (sourceSet !== undefined && sourceSet.size === 0) this.bySource.delete(source);
    }

    return true;
  }

  /**
   * Removes every entry that carries `source`.
   *
   * @returns The number of entries removed.
   */
  removeBySource(source: string): number {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return 0;
    const ids = [...bucket];
    for (const id of ids) this.removeEntry(id);
    return ids.length;
  }

  /**
   * Returns every entry that carries `source`, ordered by confidence
   * descending so the most trustworthy entries come first.
   */
  findBySource(source: string): KnowledgeEntry[] {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return [];
    return KnowledgeIndex.resolvedSorted(bucket, this.byKey);
  }

  /**
   * Returns every entry whose token set contains `token`, ordered by
   * confidence descending.  The token is normalized (lowercased) before the
   * lookup.
   */
  findByToken(token: string): KnowledgeEntry[] {
    const normalized = token.normalize('NFKD').toLowerCase();
    if (normalized.length === 0) return [];
    const bucket = this.byToken.get(normalized);
    if (bucket === undefined) return [];
    return KnowledgeIndex.resolvedSorted(bucket, this.byKey);
  }

  /**
   * Returns entries matching the given tokens.
   *
   * When `mode` is `'all'` an entry must contain **every** token (AND
   * semantics — useful for narrowing a topic); when `'any'` it must contain
   * at least one (OR semantics — useful for recall-oriented topic scans).
   * Results are ordered by confidence descending.
   */
  findByTokens(tokens: readonly string[], mode: 'all' | 'any' = 'all'): KnowledgeEntry[] {
    const normalized = tokens
      .map((token) => token.normalize('NFKD').toLowerCase())
      .filter((token) => token.length > 0);
    if (normalized.length === 0) return [];

    if (mode === 'any') {
      const seen = new Set<string>();
      for (const token of normalized) {
        const bucket = this.byToken.get(token);
        if (bucket !== undefined) {
          for (const id of bucket) seen.add(id);
        }
      }
      return KnowledgeIndex.resolvedSorted(seen, this.byKey);
    }

    let candidate: Set<string> | undefined;
    for (const token of normalized) {
      const bucket = this.byToken.get(token);
      if (bucket === undefined) return [];
      if (candidate === undefined) {
        candidate = new Set(bucket);
      } else {
        const next = new Set<string>();
        for (const id of candidate) {
          if (bucket.has(id)) next.add(id);
        }
        candidate = next;
        if (candidate.size === 0) return [];
      }
    }
    return candidate === undefined ? [] : KnowledgeIndex.resolvedSorted(candidate, this.byKey);
  }

  /**
   * Returns entries whose confidence falls in the given bucket, ordered by
   * confidence descending.
   */
  findByConfidenceBucket(bucket: ConfidenceBucket): KnowledgeEntry[] {
    const set = this.byConfidence.get(bucket);
    if (set === undefined) return [];
    return KnowledgeIndex.resolvedSorted(set, this.byKey);
  }

  /**
   * Returns every entry in the low-confidence bucket, the set operators want
   * to flag for review.  Convenience alias over
   * {@link findByConfidenceBucket}.
   */
  findLowConfidence(): KnowledgeEntry[] {
    return this.findByConfidenceBucket('low');
  }

  /**
   * Returns entries whose effective confidence falls in `[min, max]`
   * (inclusive), ordered by confidence descending.  Useful for threshold
   * calibration and for pulling "borderline" entries into a review queue.
   */
  findByConfidenceRange(min: number, max: number = 1): KnowledgeEntry[] {
    const entries: KnowledgeEntry[] = [];
    for (const entry of this.byKey.values()) {
      const confidence = confidenceOf(entry);
      if (confidence >= min && confidence <= max) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => confidenceOf(b) - confidenceOf(a));
  }

  /**
   * Returns the entry stored at `id`, or `undefined`.
   */
  get(id: string): KnowledgeEntry | undefined {
    return this.byKey.get(id);
  }

  /**
   * Returns whether `id` is currently indexed.
   */
  has(id: string): boolean {
    return this.byKey.has(id);
  }

  /**
   * Returns every indexed id, in insertion order.
   */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  /**
   * Returns every indexed entry, in insertion order.
   */
  values(): KnowledgeEntry[] {
    return [...this.byKey.values()];
  }

  /**
   * Returns every distinct source label currently represented in the index.
   */
  sources(): string[] {
    return [...this.bySource.keys()];
  }

  /**
   * Returns every distinct token currently represented in the token index.
   */
  tokens(): string[] {
    return [...this.byToken.keys()];
  }

  /**
   * Returns the token count recorded for `id` (its information-content
   * signal), or `undefined` when the id is not indexed.
   */
  tokenCountOf(id: string): number | undefined {
    return this.tokenCounts.get(id);
  }

  /**
   * Returns the number of indexed entries.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Drops every indexed entry and clears all secondary structures.
   */
  clear(): void {
    this.byKey.clear();
    this.bySource.clear();
    this.byToken.clear();
    this.byConfidence.clear();
    this.tokenCounts.clear();
  }

  /**
   * Replaces the entire index contents with `entries`.
   *
   * This is strictly cheaper than `clear()` + `indexMany()` for bulk loads:
   * it clears first, then indexes every entry under its own id.
   *
   * @returns The number of entries indexed.
   */
  rebuild(entries: readonly KnowledgeEntry[]): number {
    this.clear();
    return this.indexMany(entries);
  }

  /**
   * Computes index shape statistics plus semantic integration stats rolled up
   * across every indexed entry.
   */
  stats(): IndexStats {
    let confidenceTotal = 0;
    let tokenTotal = 0;
    const sources = new Set<string>();
    for (const entry of this.byKey.values()) {
      confidenceTotal += confidenceOf(entry);
      tokenTotal += this.tokenCounts.get(entry.id) ?? entryTokens(entry).length;
      for (const source of KnowledgeIndex.sourcesOf(entry)) sources.add(source);
    }
    const size = this.byKey.size;
    const base = createIntegrateStats({
      entries: size,
      sources: sources.size,
      meanConfidence: size > 0 ? confidenceTotal / size : 0,
      totalTokens: tokenTotal,
      lastUpdated: Date.now(),
    });
    return {
      ...base,
      tokens: this.byToken.size,
      sources: sources.size,
      high: this.byConfidence.get('high')?.size ?? 0,
      medium: this.byConfidence.get('medium')?.size ?? 0,
      low: this.byConfidence.get('low')?.size ?? 0,
    };
  }

  /**
   * Returns the index contents as a plain, JSON-friendly snapshot.
   */
  toJSON(): KnowledgeIndexSnapshot {
    return { version: 1, entries: [...this.byKey.values()] };
  }

  /**
   * Restores the index from a snapshot produced by {@link toJSON},
   * replacing all current contents.  Every entry is validated on the way in.
   */
  fromJSON(snapshot: KnowledgeIndexSnapshot): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported KnowledgeIndex snapshot version ${snapshot.version}`);
    }
    for (const entry of snapshot.entries) {
      assertKnowledgeEntry(entry);
    }
    this.rebuild(snapshot.entries);
  }

  /**
   * Maps a confidence value to its bucket using
   * {@link CONFIDENCE_BUCKET_FLOORS}.  Values below the lowest floor still
   * resolve to `low` via the `low` floor of `0`.
   */
  bucketOf(confidence: number): ConfidenceBucket {
    if (confidence >= CONFIDENCE_BUCKET_FLOORS.high) return 'high';
    if (confidence >= CONFIDENCE_BUCKET_FLOORS.medium) return 'medium';
    return 'low';
  }

  /** Registers the confidence bucket partition for `id`. */
  private indexByConfidence(id: string, entry: KnowledgeEntry): void {
    KnowledgeIndex.addToSet(this.byConfidence, this.bucketOf(confidenceOf(entry)), id);
  }

  /** Registers every normalized token from the entry for `id`. */
  private indexByTokens(id: string, entry: KnowledgeEntry): void {
    for (const token of entryTokens(entry)) {
      KnowledgeIndex.addToSet(this.byToken, token, id);
    }
  }

  /**
   * Resolves an id set to entries in the canonical store, ordered by
   * confidence descending.
   */
  private static resolvedSorted(
    ids: ReadonlySet<string>,
    byKey: ReadonlyMap<string, KnowledgeEntry>,
  ): KnowledgeEntry[] {
    const entries: KnowledgeEntry[] = [];
    for (const id of ids) {
      const entry = byKey.get(id);
      if (entry !== undefined) entries.push(entry);
    }
    return entries.sort((a, b) => confidenceOf(b) - confidenceOf(a));
  }

  /** Adds `value` to the set under `key` in `map`, creating it if needed. */
  private static addToSet<T>(map: Map<T, Set<string>>, key: T, value: string): void {
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      map.set(key, bucket);
    }
    bucket.add(value);
  }

  /**
   * Derives the source labels for an entry: its `source` field when present.
   * Kept as a static helper so the index and the removal path share exactly
   * one notion of "which sources does this entry carry".
   */
  private static sourcesOf(entry: KnowledgeEntry): string[] {
    if (entry.source !== undefined && entry.source.length > 0) {
      return [entry.source];
    }
    return [];
  }
}