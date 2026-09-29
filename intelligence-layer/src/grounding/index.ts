/**
 * @fileoverview
 * In-memory secondary index over grounding results.
 *
 * The {@link GroundingIndex} complements the {@link GroundingStore}: where the
 * store answers "have we seen this claim before?" by content hash, the index
 * answers navigation questions like "which results cite this source?", "which
 * results are unsupported?", and "which results mention this claim term?".
 *
 * A grounding pipeline typically produces hundreds or thousands of results
 * per batch, and consumers rarely want to scan them linearly:
 *
 *   - a report writer wants every result that cites `docs/api.md` so it can
 *     decide whether the API section has enough backing;
 *   - a reviewer wants every unsupported result so it can flag them for
 *     human inspection;
 *   - a QA loop wants results whose score falls in a band so it can tune the
 *     {@link GroundingConfig.minScore}.
 *
 * The index keeps four structures in sync:
 *
 *   1. `byKey`       — the canonical result store (keyed by content hash).
 *   2. `bySource`    — source label -> keys.  A result is indexed under a
 *      source when any of its claims cite it, or when an explicit source hint
 *      was supplied at index time.
 *   3. `bySupported` — `true`/`false` -> keys, for instant unsupported scans.
 *   4. `byTerm`      — normalized claim term -> keys, for term lookups.
 *
 * Every mutating operation keeps all four consistent, so queries never return
 * results that were removed or references to results that were never added.
 *
 * @packageDocumentation
 */

import {
  type GroundingResult,
  type GroundingStats,
  assertGroundingResult,
  createGroundingStats,
} from './types.js';
import { GroundingStore } from './store.js';

/**
 * The summary shape returned by {@link GroundingIndex.stats}.
 */
export interface IndexStats {
  /** Total number of indexed results. */
  readonly results: number;

  /** Number of distinct source labels in the index. */
  readonly sources: number;

  /** Number of supported results. */
  readonly supported: number;

  /** Number of unsupported results. */
  readonly unsupported: number;

  /** Number of distinct claim terms in the term index. */
  readonly terms: number;

  /** Semantic grounding stats rolled up across indexed results. */
  readonly grounding: GroundingStats;
}

/**
 * An in-memory secondary index over grounding results.
 *
 * Keys are content hashes produced by {@link GroundingStore.hashText} over
 * the result's primary claim, so the same claim always maps to the same key
 * and re-indexing a result is idempotent.  Use the index alongside a store,
 * or standalone when results only need to be queried, not cached.
 */
export class GroundingIndex {
  /** Canonical result store: content-hash key -> result. */
  private readonly byKey = new Map<string, GroundingResult>();

  /** Source label -> set of keys that cite (or were hinted for) that source. */
  private readonly bySource = new Map<string, Set<string>>();

  /** `true`/`false` -> set of keys, partitioned by the supported flag. */
  private readonly bySupported = new Map<boolean, Set<string>>();

  /** Normalized claim term -> set of keys whose claim contains the term. */
  private readonly byTerm = new Map<string, Set<string>>();

  /**
   * Indexes a result under the given key.
   *
   * When `key` is omitted it is derived with
   * {@link GroundingStore.hashText} from the result's primary claim, which
   * makes re-indexing the same claim idempotent.  `sources` is an optional
   * list of source labels to attach in addition to the sources already
   * derived from the result's citations; this is useful when the calling
   * layer knows provenance the citations do not express.
   *
   * If a different result already lives at `key`, it is replaced: the old
   * result's index rows are removed first, so no stale rows survive.
   */
  indexResult(result: GroundingResult, key?: string, sources?: readonly string[]): string {
    assertGroundingResult(result);
    const resolvedKey = key ?? GroundingStore.hashText(result.claims[0]?.claim ?? '');

    if (this.byKey.has(resolvedKey)) {
      this.removeResult(resolvedKey);
    }

    this.byKey.set(resolvedKey, result);
    this.indexBySupported(resolvedKey, result);
    this.indexByTerms(resolvedKey, result);
    for (const source of GroundingIndex.sourcesOf(result, sources)) {
      GroundingIndex.addToSet(this.bySource, source, resolvedKey);
    }
    return resolvedKey;
  }

  /**
   * Indexes many results, returning the number indexed.  Each result is
   * indexed under its content-derived key.
   */
  indexMany(results: readonly GroundingResult[]): number {
    let count = 0;
    for (const result of results) {
      this.indexResult(result);
      count += 1;
    }
    return count;
  }

  /**
   * Removes a result by its key.
   *
   * @returns `true` when the key was indexed and has been removed.
   */
  removeResult(key: string): boolean {
    const result = this.byKey.get(key);
    if (result === undefined) return false;

    this.byKey.delete(key);

    const supported = this.bySupported.get(result.claims.some((claim) => claim.supported));
    supported?.delete(key);

    const terms = this.termsOf(result);
    for (const term of terms) {
      const bucket = this.byTerm.get(term);
      bucket?.delete(key);
      if (bucket !== undefined && bucket.size === 0) this.byTerm.delete(term);
    }

    const sources = GroundingIndex.sourcesOf(result);
    for (const source of sources) {
      const bucket = this.bySource.get(source);
      bucket?.delete(key);
      if (bucket !== undefined && bucket.size === 0) this.bySource.delete(source);
    }

    return true;
  }

  /**
   * Removes every result that cites (or was hinted for) `source`.
   *
   * @returns The number of results removed.
   */
  removeBySource(source: string): number {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return 0;
    const keys = [...bucket];
    for (const key of keys) this.removeResult(key);
    return keys.length;
  }

  /**
   * Returns every result that cites (or was hinted for) `source`, ordered by
   * overall score descending so the best-supported results come first.
   */
  findBySource(source: string): GroundingResult[] {
    const bucket = this.bySource.get(source);
    if (bucket === undefined) return [];
    const results: GroundingResult[] = [];
    for (const key of bucket) {
      const result = this.byKey.get(key);
      if (result !== undefined) results.push(result);
    }
    return results.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Returns every result with no supported claims, ordered by overall score
   * ascending (the least grounded first) so the worst offenders surface
   * first for review.
   */
  findUnsupported(): GroundingResult[] {
    return this.findBySupported(false).sort((a, b) => a.overallScore - b.overallScore);
  }

  /**
   * Returns every result with at least one supported claim, ordered by
   * overall score descending.
   */
  findSupported(): GroundingResult[] {
    return this.findBySupported(true).sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Returns results whose overall score falls in `[min, max]` (inclusive),
   * ordered by score descending.  Useful for tuning thresholds and for
   * pulling "borderline" results into a review queue.
   */
  findByScore(min: number, max: number = 1): GroundingResult[] {
    const results: GroundingResult[] = [];
    for (const result of this.byKey.values()) {
      if (result.overallScore >= min && result.overallScore <= max) {
        results.push(result);
      }
    }
    return results.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Returns results whose primary claim contains the normalized `term`.
   * Matching is substring-based over the lowercased claim text, so partial
   * terms like `"api"` match `"the api gateway"`.  Ordered by score
   * descending.
   */
  findByClaimTerm(term: string): GroundingResult[] {
    const normalized = GroundingIndex.normalizeTerm(term);
    if (normalized.length === 0) return [];
    const results: GroundingResult[] = [];
    for (const result of this.byKey.values()) {
      if (result.claims[0]?.claim.toLowerCase().includes(normalized)) {
        results.push(result);
      }
    }
    return results.sort((a, b) => b.overallScore - a.overallScore);
  }

  /**
   * Returns the result stored at `key`, or `undefined`.
   */
  get(key: string): GroundingResult | undefined {
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
   * Returns every indexed result, in insertion order.
   */
  values(): GroundingResult[] {
    return [...this.byKey.values()];
  }

  /**
   * Returns every distinct source label currently represented in the index.
   */
  sources(): string[] {
    return [...this.bySource.keys()];
  }

  /**
   * Returns the number of indexed results.
   */
  get size(): number {
    return this.byKey.size;
  }

  /**
   * Drops every indexed result and clears all secondary structures.
   */
  clear(): void {
    this.byKey.clear();
    this.bySource.clear();
    this.bySupported.clear();
    this.byTerm.clear();
  }

  /**
   * Replaces the entire index contents with `results`.
   *
   * This is strictly cheaper than `clear()` + `indexMany()` for bulk loads:
   * it clears first, then indexes every result under its content-derived key.
   *
   * @returns The number of results indexed.
   */
  rebuild(results: readonly GroundingResult[]): number {
    this.clear();
    return this.indexMany(results);
  }

  /**
   * Computes index shape statistics plus semantic grounding stats rolled up
   * across every indexed result.
   */
  stats(): IndexStats {
    let requests = 0;
    let supported = 0;
    let unsupported = 0;
    let totalClaims = 0;
    let citations = 0;
    let unmatchedTerms = 0;
    let scoreTotal = 0;

    for (const result of this.byKey.values()) {
      requests += 1;
      for (const claim of result.claims) {
        totalClaims += 1;
        if (claim.supported) supported += 1;
        else unsupported += 1;
        citations += claim.citations.length;
        unmatchedTerms += claim.unmatchedTerms.length;
        scoreTotal += claim.score;
      }
    }

    const grounding = createGroundingStats({
      requests,
      supported,
      unsupported,
      totalClaims,
      citations,
      unmatchedTerms,
      meanScore: totalClaims > 0 ? scoreTotal / totalClaims : 0,
      lastUpdated: Date.now(),
    });

    return {
      results: this.byKey.size,
      sources: this.bySource.size,
      supported: this.bySupported.get(true)?.size ?? 0,
      unsupported: this.bySupported.get(false)?.size ?? 0,
      terms: this.byTerm.size,
      grounding,
    };
  }

  /**
   * Returns the index contents as a plain, JSON-friendly snapshot.
   */
  toJSON(): { version: 1; entries: Array<{ key: string; result: GroundingResult }> } {
    const entries: Array<{ key: string; result: GroundingResult }> = [];
    for (const [key, result] of this.byKey) entries.push({ key, result });
    return { version: 1, entries };
  }

  /**
   * Restores the index from a snapshot produced by {@link toJSON},
   * replacing all current contents.  Every entry is validated on the way in.
   */
  fromJSON(snapshot: { version: 1; entries: Array<{ key: string; result: GroundingResult }> }): void {
    if (snapshot.version !== 1) {
      throw new TypeError(`Unsupported GroundingIndex snapshot version ${snapshot.version}`);
    }
    const next = new Map<string, GroundingResult>();
    for (const { key, result } of snapshot.entries) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('Snapshot contains an entry with an invalid key');
      }
      assertGroundingResult(result);
      next.set(key, result);
    }
    this.clear();
    for (const [key, result] of next) {
      this.indexResult(result, key);
    }
  }

  /**
   * Returns the keys of every result whose supported flag matches `flag`.
   */
  private findBySupported(flag: boolean): GroundingResult[] {
    const bucket = this.bySupported.get(flag);
    if (bucket === undefined) return [];
    const results: GroundingResult[] = [];
    for (const key of bucket) {
      const result = this.byKey.get(key);
      if (result !== undefined) results.push(result);
    }
    return results;
  }

  /** Registers the supported/unsupported partition for `key`. */
  private indexBySupported(key: string, result: GroundingResult): void {
    const flag = result.claims.some((claim) => claim.supported);
    GroundingIndex.addToSet(this.bySupported, flag, key);
  }

  /** Registers every normalized claim term for `key`. */
  private indexByTerms(key: string, result: GroundingResult): void {
    for (const term of this.termsOf(result)) {
      GroundingIndex.addToSet(this.byTerm, term, key);
    }
  }

  /** Returns the normalized, de-duplicated claim terms for `result`. */
  private termsOf(result: GroundingResult): string[] {
    const seen = new Set<string>();
    for (const claim of result.claims) {
      for (const word of claim.claim.toLowerCase().split(/[^a-z0-9']+/)) {
        if (word.length > 0 && !seen.has(word)) seen.add(word);
      }
    }
    return [...seen];
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
   * Derives the source labels for a result: the union of its citations and
   * any explicit hints.  Citations are treated as source identifiers because
   * they name the evidence chunks (and, when configured, their sources) that
   * carried the claim.
   */
  private static sourcesOf(
    result: GroundingResult,
    hints?: readonly string[],
  ): string[] {
    const sources = new Set<string>();
    for (const claim of result.claims) {
      for (const citation of claim.citations) {
        if (citation.length > 0) sources.add(citation);
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