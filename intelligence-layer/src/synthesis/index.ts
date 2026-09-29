/**
 * @fileoverview
 * In-memory secondary index over synthesized answers.
 *
 * The {@link SynthesisIndex} complements the {@link SynthesisStore}: where the
 * store answers "have we seen this question before?" by content hash, the
 * index answers navigation questions like "which answers cite this source?",
 * "which answers mention this query term?", and "which answers are
 * high/medium/low confidence?".
 *
 * A synthesis pipeline typically produces many answers per session, and
 * consumers rarely want to scan them linearly:
 *
 *   - a reviewer wants every answer that cites `docs/api.md` so it can verify
 *     that the claims about the API are all backed by the same document;
 *   - an operator wants every low-confidence answer so it can be flagged for
 *     human review;
 *   - a tuning loop wants answers whose confidence falls in a band so it can
 *     calibrate the {@link SynthesisConfig.minScore}.
 *
 * The index keeps four structures in sync:
 *
 *   1. `byKey`          — the canonical answer store (keyed by the same
 *      content hashes the store uses).
 *   2. `bySource`       — source label -> keys.  An answer is indexed under a
 *      source when any of its parts carry it, or when an explicit source hint
 *      was supplied at index time.
 *   3. `byTerm`         — normalized query term -> keys, for term lookups
 *      over the query text (and, when requested, the answer prose).
 *   4. `byConfidence`   — confidence bucket -> keys, for instant
 *      high/medium/low scans.
 *
 * Every mutating operation keeps all four consistent, so queries never return
 * results that were removed or references to answers that were never added.
 *
 * @packageDocumentation
 */

import {
  type Answer,
  type SynthesisStats,
  assertAnswer,
  createSynthesisStats,
} from './types.js';
import { SynthesisStore } from './store.js';

/**
 * The confidence buckets used by the index.
 *
 * Bucketing turns a continuous `[0, 1]` confidence into three reviewable
 * classes so operators can reason about "how many answers are risky" without
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
 * The summary shape returned by {@link SynthesisIndex.stats}.
 */
export interface IndexStats {
  /** Total number of indexed answers. */
  readonly answers: number;

  /** Number of distinct source labels in the index. */
  readonly sources: number;

  /** Number of distinct query terms in the term index. */
  readonly terms: number;

  /** Number of high-confidence answers. */
  readonly high: number;

  /** Number of medium-confidence answers. */
  readonly medium: number;

  /** Number of low-confidence answers. */
  readonly low: number;

  /** Semantic synthesis stats rolled up across indexed answers. */
  readonly synthesis: SynthesisStats;
}

/**
 * An in-memory secondary index over synthesized answers.
 *
 * Keys are content hashes produced by {@link SynthesisStore.hashText} over
 * the answer's assembled text, so re-indexing the same answer is idempotent
 * and keys align with the store's content addressing.  Use the index alongside
 * a store, or standalone when answers only need to be queried, not cached.
 */
export class SynthesisIndex {
  /** Canonical answer store: content-hash key -> answer. */
  private readonly byKey = new Map<string, Answer>();

  /** Source label -> set of keys that carry that source. */
  private readonly bySource = new Map<string, Set<string>>();

  /** Normalized term -> set of keys whose query (or prose) contains the term. */
  private readonly byTerm = new Map<string, Set<string>>();

  /** Confidence bucket -> set of keys, partitioned by bucketed confidence. */
  private readonly byConfidence = new Map<ConfidenceBucket, Set<string>>();

  /**
   * Indexes an answer under the given key.
   *
   * When `key` is omitted it is derived with {@link SynthesisStore.hashText}
   * from the answer's assembled text, which makes re-indexing the same answer
   * idempotent.  `sources` is an optional list of source labels to attach in
   * addition to the sources already derived from the answer's parts; this is
   * useful when the calling layer knows provenance the parts do not express.
   *
   * If a different answer already lives at `key`, it is replaced: the old
   * answer's index rows are removed first, so no stale rows survive.
   */
  indexAnswer(answer: Answer, key?: string, sources?: readonly string[]): string {
    assertAnswer(answer);
    const resolvedKey = key ?? SynthesisStore.hashText(answer.text);

    if (this.byKey.has(resolvedKey)) {
      this.removeAnswer(resolvedKey);
    }

    this.byKey.set(resolvedKey, answer);
    this.indexByConfidence(resolvedKey, answer);
    this.indexByTerms(resolvedKey, answer);
    for (const source of SynthesisIndex.sourcesOf(answer, sources)) {
      SynthesisIndex.addToSet(this.bySource, source, resolvedKey);
    }
    return resolvedKey;
  }

  /**
   * Indexes many answers, returning the number indexed.  Each answer is
   * indexed under its content-derived key.
   */
  indexMany(answers: readonly Answer[]): number {
    let count = 0;
    for (const answer of answers) {
      this.indexAnswer(answer);
      count += 1;
    }
    return count;
  }

  /**
   * Removes an answer by its key.
   *
   * @returns `true` when the key was indexed and has been removed.
   */
  removeAnswer(key: string): boolean {
    const answer = this.byKey.get(key);
    if (answer === undefined) return false;

    this.byKey.delete(key);

    const bucket = this.bucketOf(answer.confidence);
    const bucketSet = this.byConfidence.get(bucket);
    bucketSet?.delete(key);
    if (bucketSet !== undefined && bucketSet.size === 0) this.byConfidence.delete(bucket);

    const terms = this.termsOf(answer);
    for (const term of terms) {
      const termSet = this.byTerm.get(term);
      termSet?.delete(key);
      if (termSet !== undefined && termSet.size === 0) this.byTerm.delete(term);
    }

    const sources = SynthesisIndex.sourcesOf(answer);
    for (const source of sources) {
      const sourceSet = this.bySource.get(source);
      sourceSet?.delete(key);
      if (sourceSet !== undefined && sourceSet.size === 0) this.bySource.delete(source);
    }

    return true;
  }

  /**
   * Removes every answer that carries `source`.
   *
   * @returns The number of answers removed.
   */
  removeBySource(source: string): number {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return 0;
    const keys = [...bucket];
    for (const key of keys) this.removeAnswer(key);
    return keys.length;
  }

  /**
   * Returns every answer that carries `source`, ordered by confidence
   * descending so the most trustworthy answers come first.
   */
  findBySource(source: string): Answer[] {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return [];
    const answers: Answer[] = [];
    for (const key of bucket) {
      const answer = this.byKey.get(key);
      if (answer !== undefined) answers.push(answer);
    }
    return answers.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Returns answers whose query (or assembled prose, when `includeProse` is
   * `true`) contains the normalized `term`.  Matching is substring-based over
   * lowercased text, so partial terms like `"api"` match `"the api
   * gateway"`.  Ordered by confidence descending.
   */
  findByTerm(term: string, includeProse = false): Answer[] {
    const normalized = SynthesisIndex.normalizeTerm(term);
    if (normalized.length === 0) return [];
    const answers: Answer[] = [];
    for (const answer of this.byKey.values()) {
      if (this.matchesTerm(answer, normalized, includeProse)) {
        answers.push(answer);
      }
    }
    return answers.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Returns answers whose confidence falls in the given bucket, ordered by
   * confidence descending.
   */
  findByConfidenceBucket(bucket: ConfidenceBucket): Answer[] {
    const set = this.byConfidence.get(bucket);
    if (set === undefined) return [];
    const answers: Answer[] = [];
    for (const key of set) {
      const answer = this.byKey.get(key);
      if (answer !== undefined) answers.push(answer);
    }
    return answers.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Returns every answer in the low-confidence bucket, the set operators want
   * to flag for review.  Convenience alias over
   * {@link findByConfidenceBucket}.
   */
  findLowConfidence(): Answer[] {
    return this.findByConfidenceBucket('low');
  }

  /**
   * Returns answers whose confidence falls in `[min, max]` (inclusive),
   * ordered by confidence descending.  Useful for threshold calibration and
   * for pulling "borderline" answers into a review queue.
   */
  findByConfidenceRange(min: number, max: number = 1): Answer[] {
    const answers: Answer[] = [];
    for (const answer of this.byKey.values()) {
      if (answer.confidence >= min && answer.confidence <= max) {
        answers.push(answer);
      }
    }
    return answers.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Returns the answer stored at `key`, or `undefined`.
   */
  get(key: string): Answer | undefined {
    return this.byKey.get(key);
  }

  /**
   * Returns whether `key` is currently indexed.
   */
  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /**
   * Returns every indexed key, in insertion order.
   */
  keys(): string[] {
    return [...this.byKey.keys()];
  }

  /**
   * Returns every indexed answer, in insertion order.
   */
  values(): Answer[] {
    return [...this.byKey.values()];
  }

  /**
   * Returns every distinct source label currently represented in the index.
   */
  sources(): string[] {
    return [...this.bySource.keys()];
  }

  /**
   * Returns the number of indexed answers.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Drops every indexed answer and clears all secondary structures.
   */
  clear(): void {
    this.byKey.clear();
    this.bySource.clear();
    this.byTerm.clear();
    this.byConfidence.clear();
  }

  /**
   * Replaces the entire index contents with `answers`.
   *
   * This is strictly cheaper than `clear()` + `indexMany()` for bulk loads:
   * it clears first, then indexes every answer under its content-derived key.
   *
   * @returns The number of answers indexed.
   */
  rebuild(answers: readonly Answer[]): number {
    this.clear();
    return this.indexMany(answers);
  }

  /**
   * Computes index shape statistics plus semantic synthesis stats rolled up
   * across every indexed answer.
   */
  stats(): IndexStats {
    let answers = 0;
    let parts = 0;
    let citations = 0;
    let grounded = 0;
    let ungrounded = 0;
    let confidenceTotal = 0;

    for (const answer of this.byKey.values()) {
      answers += 1;
      parts += answer.parts.length;
      citations += answer.citations.length;
      if (answer.grounded) grounded += 1;
      else ungrounded += 1;
      confidenceTotal += answer.confidence;
    }

    const synthesis = createSynthesisStats({
      requests: answers,
      answers,
      parts,
      citations,
      grounded,
      ungrounded,
      meanConfidence: answers > 0 ? confidenceTotal / answers : 0,
      lastUpdated: Date.now(),
    });

    return {
      answers: this.byKey.size,
      sources: this.bySource.size,
      terms: this.byTerm.size,
      high: this.byConfidence.get('high')?.size ?? 0,
      medium: this.byConfidence.get('medium')?.size ?? 0,
      low: this.byConfidence.get('low')?.size ?? 0,
      synthesis,
    };
  }

  /**
   * Returns the index contents as a plain, JSON-friendly snapshot.
   */
  toJSON(): { version: 1; entries: Array<{ key: string; answer: Answer }> } {
    const entries: Array<{ key: string; answer: Answer }> = [];
    for (const [key, answer] of this.byKey) entries.push({ key, answer });
    return { version: 1, entries };
  }

  /**
   * Restores the index from a snapshot produced by {@link toJSON},
   * replacing all current contents.  Every entry is validated on the way in.
   */
  fromJSON(snapshot: { version: 1; entries: Array<{ key: string; answer: Answer }> }): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported SynthesisIndex snapshot version ${snapshot.version}`);
    }
    const next = new Map<string, Answer>();
    for (const { key, answer } of snapshot.entries) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('Snapshot contains an entry with an invalid key');
      }
      assertAnswer(answer);
      next.set(key, answer);
    }
    this.clear();
    for (const [key, answer] of next) {
      this.indexAnswer(answer, key);
    }
  }

  /**
   * Returns whether `answer` matches the normalized term, optionally scanning
   * the assembled prose in addition to the query text carried by the parts.
   */
  private matchesTerm(answer: Answer, normalized: string, includeProse: boolean): boolean {
    for (const part of answer.parts) {
      if (part.text.toLowerCase().includes(normalized)) return true;
    }
    if (includeProse && answer.text.toLowerCase().includes(normalized)) return true;
    return false;
  }

  /** Registers the confidence bucket partition for `key`. */
  private indexByConfidence(key: string, answer: Answer): void {
    SynthesisIndex.addToSet(this.byConfidence, this.bucketOf(answer.confidence), key);
  }

  /** Registers every normalized term from the answer's parts for `key`. */
  private indexByTerms(key: string, answer: Answer): void {
    for (const term of this.termsOf(answer)) {
      SynthesisIndex.addToSet(this.byTerm, term, key);
    }
  }

  /**
   * Returns the normalized, de-duplicated terms for `answer`: the union of
   * every part's text (the parts carry the query-derived prose, so this is
   * the closest stable proxy for the original query in the index).
   */
  private termsOf(answer: Answer): string[] {
    const seen = new Set<string>();
    for (const part of answer.parts) {
      for (const word of part.text.toLowerCase().split(/[^a-z0-9']+/)) {
        if (word.length > 0 && !seen.has(word)) seen.add(word);
      }
    }
    return [...seen];
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
   * Derives the source labels for an answer: the union of its parts' sources
   * and any explicit hints.
   */
  private static sourcesOf(
    answer: Answer,
    hints?: readonly string[],
  ): string[] {
    const sources = new Set<string>();
    for (const part of answer.parts) {
      if (part.source !== undefined && part.source.length > 0) {
        sources.add(part.source);
      }
    }
    for (const hint of hints ?? []) {
      if (hint.length > 0) sources.add(hint);
    }
    return [...sources];
  }

  /** Lowercases and trims a term for index normalization. */
  private static normalizeTerm(term: string): string {
    return term.toLowerCase().trim();
  }
}