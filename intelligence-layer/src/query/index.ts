/**
 * Inverted index over {@link QueryAnalysis} objects for the Query
 * understanding layer.
 *
 * {@link QueryIndex} answers two questions quickly, without scanning every
 * cached analysis:
 *
 * - **"Which queries were about intent X?"** — answered by the `byIntent`
 *   map, an inverted index from {@link QueryIntent} to analysis ids.
 * - **"Which queries mentioned term Y?"** — answered by the `byTerm` map, an
 *   inverted index from normalised terms to analysis ids.
 *
 * The index is the discovery companion to {@link QueryStore}: the store holds
 * the *canonical* analyses and guarantees bounded memory, while the index holds
 * lightweight *pointers* (ids) plus term-frequency counters that let consumers
 * find and rank relevant past analyses. Because the index stores ids, not
 * analyses, it stays cheap even when analyses are large; lookups resolve ids
 * through an optional backing store or through the analyses registered with the
 * index itself.
 *
 * ## Consistency model
 *
 * The index maintains its own authoritative `analyses` map. When it is bound to
 * a {@link QueryStore}, {@link QueryIndex.sync} reconciles the index with the
 * store's current contents (adding new analyses, removing stale ones), so the
 * two structures can drift only between explicit syncs. Without a store, the
 * index is standalone: `indexAnalysis` / `removeAnalysis` are the only way in.
 *
 * ## Scoring
 *
 * {@link QueryIndex.findByTerm} scores hits by how often the term appears in an
 * analysis's `terms` (and `expanded` set), blended with the analysis's
 * classification confidence, so more relevant analyses rank higher.
 *
 * @packageDocumentation
 * @module query/index
 */

import type { QueryStore } from './store.js';
import {
  QUERY_INTENTS,
  assertQueryIntent,
  dedupeStrings,
  type AnalysisStats,
  type QueryAnalysis,
  type QueryIntent,
} from './types.js';

/**
 * Configuration for a {@link QueryIndex}.
 *
 * All fields are optional; the defaults are safe for general use.
 */
export interface QueryIndexConfig {
  /**
   * Optional backing {@link QueryStore} whose contents the index can reconcile
   * with via {@link QueryIndex.sync}.
   */
  readonly store?: QueryStore;

  /**
   * When `true` (default `true`), {@link QueryIndex.indexAnalysis} also indexes
   * the analysis's `expanded` terms, making lookup by synonym productive. When
   * `false`, only the base `terms` are indexed.
   */
  readonly indexExpanded?: boolean;

  /**
   * Optional clock used for statistics timestamps.
   */
  readonly now?: () => number;
}

/**
 * Default configuration applied when the caller supplies none.
 */
export const DEFAULT_QUERY_INDEX_CONFIG: Required<Pick<QueryIndexConfig, 'indexExpanded'>> = {
  indexExpanded: true,
};

/**
 * A single hit returned by {@link QueryIndex.findByIntent} or
 * {@link QueryIndex.findByTerm}.
 */
export interface QueryIndexHit {
  /**
   * The matched analysis.
   */
  readonly analysis: QueryAnalysis;

  /**
   * Relevance score in `[0, 1]`. Higher is more relevant. For intent lookups
   * the score is the analysis's classification confidence; for term lookups it
   * blends term frequency with confidence.
   */
  readonly score: number;

  /**
   * Human-readable description of why the analysis matched, useful for
   * debugging and for explaining results.
   */
  readonly reason: string;
}

/**
 * Options accepted by the lookup entry points of {@link QueryIndex}.
 */
export interface QueryIndexQueryOptions {
  /**
   * Maximum number of hits to return. `0` (default) means unbounded.
   */
  readonly limit?: number;

  /**
   * When `true`, the returned analyses are deep-cloned. Defaults to `true`
   * to protect the index's internal copies.
   */
  readonly clone?: boolean;
}

/**
 * Detailed statistics for {@link QueryIndex.stats}.
 */
export interface QueryIndexStats extends AnalysisStats {
  /**
   * Number of analyses that carry at least one `expanded` term beyond the base
   * term set.
   */
  readonly expandedAnalyses: number;

  /**
   * The `n` most frequent indexed terms with their postings counts, ordered by
   * descending frequency.
   */
  readonly topTerms: readonly { readonly term: string; readonly count: number }[];

  /**
   * Number of distinct expanded terms indexed (when expansion indexing is on).
   */
  readonly distinctExpandedTerms: number;
}

/**
 * Canonical serialisable shape produced by {@link QueryIndex.toJSON}.
 */
export interface QueryIndexSnapshot {
  /**
   * Format version. Bumped whenever the serialised layout changes.
   */
  readonly version: 1;

  /**
   * The analyses the index currently holds, keyed by id.
   */
  readonly analyses: Record<string, QueryAnalysis>;

  /**
   * Wall-clock time at which the snapshot was created.
   */
  readonly savedAt: number;
}

/**
 * A standalone inverted index over query analyses.
 *
 * See the module documentation for a high-level overview. All methods are
 * synchronous; the index imposes no persistence and is trivially embeddable.
 */
export class QueryIndex {
  /** Authoritative analyses held by the index, keyed by id. */
  private readonly analyses = new Map<string, QueryAnalysis>();

  /** Inverted index: intent -> set of analysis ids. */
  private readonly byIntent = new Map<QueryIntent, Set<string>>();

  /** Inverted index: normalised term -> set of analysis ids. */
  private readonly byTerm = new Map<string, Set<string>>();

  /** Postings count per normalised term (number of analyses mentioning it). */
  private readonly termFrequency = new Map<string, number>();

  /** Configuration captured at construction time. */
  private readonly config: Required<Pick<QueryIndexConfig, 'indexExpanded'>> & {
    store?: QueryStore;
    now: () => number;
  };

  /**
   * Construct an empty index.
   *
   * @param config - optional tuning knobs; see {@link QueryIndexConfig}
   */
  constructor(config?: QueryIndexConfig) {
    this.config = {
      indexExpanded: config?.indexExpanded ?? DEFAULT_QUERY_INDEX_CONFIG.indexExpanded,
      store: config?.store,
      now: config?.now ?? (() => Date.now()),
    };
  }

  /**
   * Index a single analysis.
   *
   * Adding an analysis registers it under its intent and under every indexed
   * term. If an analysis with the same id is already indexed, it is first
   * removed so postings counts stay accurate (re-indexing is idempotent).
   *
   * @param analysis - the analysis to index
   * @returns `true` when newly indexed, `false` when it replaced an existing id
   */
  indexAnalysis(analysis: QueryAnalysis): boolean {
    const replaced = this.analyses.has(analysis.id);
    this.removeAnalysis(analysis.id);
    this.analyses.set(analysis.id, analysis);
    this.addToIntent(analysis.intent, analysis.id);
    for (const term of this.indexedTerms(analysis)) {
      this.addToTerm(term, analysis.id);
    }
    return !replaced;
  }

  /**
   * Index several analyses in one call.
   *
   * @param analyses - the analyses to index
   * @returns the number of analyses newly indexed
   */
  indexMany(analyses: readonly QueryAnalysis[]): number {
    let added = 0;
    for (const analysis of analyses) {
      if (this.indexAnalysis(analysis)) {
        added += 1;
      }
    }
    return added;
  }

  /**
   * Remove an analysis from the index by id.
   *
   * All inverted pointers (intent postings, term postings) and the term
   * frequency counters are cleaned up consistently.
   *
   * @param id - the analysis id to remove
   * @returns `true` when an analysis was removed, `false` when it was not indexed
   */
  removeAnalysis(id: string): boolean {
    const analysis = this.analyses.get(id);
    if (!analysis) {
      return false;
    }
    this.analyses.delete(id);
    this.removeFromIntent(analysis.intent, id);
    for (const term of this.indexedTerms(analysis)) {
      this.removeFromTerm(term, id);
    }
    return true;
  }

  /**
   * Whether an analysis id is currently indexed.
   *
   * @param id - the analysis id
   * @returns `true` when present
   */
  has(id: string): boolean {
    return this.analyses.has(id);
  }

  /**
   * Retrieve the indexed analysis with the given id.
   *
   * @param id - the analysis id
   * @returns the indexed analysis, or `undefined` when absent
   */
  get(id: string): QueryAnalysis | undefined {
    return this.analyses.get(id);
  }

  /**
   * Reconcile the index with its backing store's current contents.
   *
   * When the index was constructed with a `store`, this brings the index in
   * line with the store: analyses present in the store but absent from the
   * index are indexed, and analyses present in the index but absent from the
   * store are removed. When no store is bound, this is a no-op returning `0`.
   *
   * @returns the net number of index changes applied
   */
  sync(): number {
    if (!this.config.store) {
      return 0;
    }
    let changes = 0;
    const storeIds = new Set(this.config.store.keys());
    for (const id of this.analyses.keys()) {
      if (!storeIds.has(id)) {
        this.removeAnalysis(id);
        changes += 1;
      }
    }
    for (const analysis of this.config.store.values()) {
      if (!this.analyses.has(analysis.id)) {
        this.indexAnalysis(analysis);
        changes += 1;
      }
    }
    return changes;
  }

  /**
   * Find analyses classified with the given intent.
   *
   * Hits are scored by the analysis's own classification confidence, so a
   * high-confidence match ranks above a borderline one.
   *
   * @param intent - the intent to search for
   * @param opts - pagination / cloning options
   * @returns matching {@link QueryIndexHit}s, highest confidence first
   */
  findByIntent(
    intent: QueryIntent,
    opts?: QueryIndexQueryOptions,
  ): QueryIndexHit[] {
    assertQueryIntent(intent, 'intent');
    const ids = this.byIntent.get(intent);
    if (!ids || ids.size === 0) {
      return [];
    }
    const hits: QueryIndexHit[] = [];
    for (const id of ids) {
      const analysis = this.analyses.get(id);
      if (!analysis) {
        continue;
      }
      hits.push({
        analysis,
        score: analysis.confidence,
        reason: `classified as intent "${intent}"`,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return this.finish(hits, opts);
  }

  /**
   * Find analyses whose indexed terms include the given term.
   *
   * The term is normalised (lowercased, trimmed) before lookup, so callers may
   * pass raw user text. Scoring blends how frequently the term appears in the
   * analysis with the analysis's confidence.
   *
   * @param term - the term to search for (raw or normalised)
   * @param opts - pagination / cloning options
   * @returns matching {@link QueryIndexHit}s, best match first
   */
  findByTerm(term: string, opts?: QueryIndexQueryOptions): QueryIndexHit[] {
    const key = normalizeIndexTerm(term);
    const ids = this.byTerm.get(key);
    if (!ids || ids.size === 0) {
      return [];
    }
    const hits: QueryIndexHit[] = [];
    for (const id of ids) {
      const analysis = this.analyses.get(id);
      if (!analysis) {
        continue;
      }
      const frequency = this.termFrequencyIn(analysis, key);
      const score = clampScore(frequency / 3) * (0.5 + analysis.confidence * 0.5);
      hits.push({
        analysis,
        score,
        reason: `mentions term "${key}" (${frequency}×)`,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return this.finish(hits, opts);
  }

  /**
   * Find analyses matching any of several terms, ranked by coverage.
   *
   * Each hit is scored by the fraction of query terms it covers, weighted by
   * per-term frequency and the analysis's confidence. This is the workhorse
   * used to surface "similar past queries".
   *
   * @param terms - the terms to search for (raw, will be normalised)
   * @param opts - pagination / cloning options
   * @returns matching {@link QueryIndexHit}s, best match first
   */
  findByTerms(terms: readonly string[], opts?: QueryIndexQueryOptions): QueryIndexHit[] {
    const keys = dedupeStrings(terms.map((term) => normalizeIndexTerm(term))).filter(
      (term) => term.length > 0,
    );
    if (keys.length === 0) {
      return [];
    }
    const scores = new Map<string, { score: number; covered: number; freqs: string[] }>();
    for (const key of keys) {
      const ids = this.byTerm.get(key);
      if (!ids) {
        continue;
      }
      for (const id of ids) {
        const entry = scores.get(id) ?? { score: 0, covered: 0, freqs: [] };
        entry.covered += 1;
        const frequency = this.termFrequencyIn(this.analyses.get(id), key);
        entry.freqs.push(`${key}×${frequency}`);
        entry.score += Math.min(1, frequency / 3);
        scores.set(id, entry);
      }
    }
    const hits: QueryIndexHit[] = [];
    for (const [id, entry] of scores) {
      const analysis = this.analyses.get(id);
      if (!analysis) {
        continue;
      }
      const coverage = entry.covered / keys.length;
      hits.push({
        analysis,
        score: clampScore((entry.score / keys.length) * (0.5 + coverage * 0.5) * (0.5 + analysis.confidence * 0.5)),
        reason: `covers ${entry.covered}/${keys.length} terms [${entry.freqs.join(', ')}]`,
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return this.finish(hits, opts);
  }

  /**
   * List every analysis id currently indexed, in insertion order.
   *
   * @returns a fresh array of ids
   */
  keys(): string[] {
    return Array.from(this.analyses.keys());
  }

  /**
   * List every analysis currently indexed, in insertion order.
   *
   * @returns a fresh array of analyses
   */
  values(): QueryAnalysis[] {
    return Array.from(this.analyses.values());
  }

  /**
   * Number of analyses currently indexed.
   *
   * @returns the analysis count
   */
  size(): number {
    return this.analyses.size;
  }

  /**
   * The distinct intents observed, with their analysis counts.
   *
   * @returns intent → count, in {@link QUERY_INTENTS} order
   */
  intents(): Readonly<Record<QueryIntent, number>> {
    const counts: Record<QueryIntent, number> = {
      factoid: 0,
      howto: 0,
      comparison: 0,
      exploration: 0,
      summarization: 0,
      unknown: 0,
    };
    for (const intent of QUERY_INTENTS) {
      counts[intent] = this.byIntent.get(intent)?.size ?? 0;
    }
    return counts;
  }

  /**
   * The distinct indexed terms, with their postings counts.
   *
   * @returns an array of `{ term, count }`, ordered by descending frequency
   */
  terms(): { readonly term: string; readonly count: number }[] {
    return Array.from(this.termFrequency.entries())
      .map(([term, count]) => ({ term, count }))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  }

  /**
   * Rebuild the index from scratch.
   *
   * Clears all state and re-indexes the supplied analyses. This is the
   * canonical repair path after bulk-loading a {@link QueryStore} snapshot.
   *
   * @param analyses - the analyses to index
   * @returns the number of analyses indexed
   */
  rebuild(analyses: readonly QueryAnalysis[]): number {
    this.clear();
    return this.indexMany(analyses);
  }

  /**
   * Remove every analysis and every inverted pointer from the index.
   *
   * Configuration (including any bound store) is preserved.
   */
  clear(): void {
    this.analyses.clear();
    this.byIntent.clear();
    this.byTerm.clear();
    this.termFrequency.clear();
  }

  /**
   * Compute aggregate statistics over the indexed analyses.
   *
   * Includes the {@link AnalysisStats} shape (histograms, averages) plus
   * index-specific fields such as top terms.
   *
   * @param topN - how many top terms to include (default 10)
   * @returns a fresh {@link QueryIndexStats} snapshot
   */
  stats(topN = 10): QueryIndexStats {
    const entries = Array.from(this.analyses.values());
    const intentCounts: Partial<Record<QueryIntent, number>> = {};
    let classified = 0;
    let decomposed = 0;
    let expandedAnalyses = 0;
    let totalTerms = 0;
    let distinctExpanded = 0;
    const baseTerms = new Set<string>();
    const expandedTerms = new Set<string>();
    let confidenceSum = 0;
    let durationSum = 0;

    for (const analysis of entries) {
      intentCounts[analysis.intent] = (intentCounts[analysis.intent] ?? 0) + 1;
      if (analysis.intent !== 'unknown') {
        classified += 1;
      }
      if (analysis.subQueries && analysis.subQueries.length > 1) {
        decomposed += 1;
      }
      if (analysis.expanded && analysis.expanded.length > analysis.terms.length) {
        expandedAnalyses += 1;
      }
      totalTerms += analysis.terms.length;
      for (const term of analysis.terms) {
        baseTerms.add(term);
      }
      for (const term of analysis.expanded ?? []) {
        expandedTerms.add(term);
      }
      confidenceSum += analysis.confidence;
      durationSum += analysis.durationMs;
    }
    distinctExpanded = expandedTerms.size;
    for (const term of expandedTerms) {
      if (!baseTerms.has(term)) {
        distinctExpanded -= 1;
      }
    }

    const topTerms = this.terms().slice(0, Math.max(0, topN));
    return {
      analyses: entries.length,
      classified,
      decomposed,
      intentCounts,
      totalTerms,
      distinctTerms: baseTerms.size,
      avgConfidence: entries.length === 0 ? 0 : confidenceSum / entries.length,
      avgDurationMs: entries.length === 0 ? 0 : durationSum / entries.length,
      expandedAnalyses,
      topTerms,
      distinctExpandedTerms: distinctExpanded,
    };
  }

  /**
   * Serialise the index to a JSON-safe snapshot.
   *
   * @returns a {@link QueryIndexSnapshot} suitable for `JSON.stringify`
   */
  toJSON(): QueryIndexSnapshot {
    return {
      version: 1,
      analyses: Object.fromEntries(this.analyses),
      savedAt: this.config.now(),
    };
  }

  /**
   * Restore the index from a previously-produced snapshot.
   *
   * Existing contents are replaced wholesale and all inverted indexes are
   * rebuilt from the restored analyses.
   *
   * @param snapshot - the snapshot to load (object or JSON string)
   * @returns the number of analyses restored
   * @throws {Error} when the snapshot is malformed or has an unsupported version
   */
  fromJSON(snapshot: QueryIndexSnapshot | string): number {
    const parsed: QueryIndexSnapshot =
      typeof snapshot === 'string' ? (JSON.parse(snapshot) as QueryIndexSnapshot) : snapshot;
    if (!parsed || parsed.version !== 1 || !parsed.analyses) {
      throw new Error(
        `QueryIndex.fromJSON: unsupported or malformed snapshot (version=${parsed?.version ?? '<missing>'})`,
      );
    }
    const analyses = Object.values(parsed.analyses);
    this.rebuild(analyses);
    return this.analyses.size;
  }

  /**
   * Create an index whose contents are populated from a JSON string.
   *
   * @param json - a JSON snapshot string as produced by {@link toJSON}
   * @param config - optional index configuration
   * @returns a configured, populated index
   */
  static fromJSON(json: string, config?: QueryIndexConfig): QueryIndex {
    const index = new QueryIndex(config);
    index.fromJSON(json);
    return index;
  }

  /**
   * The set of terms to index for an analysis, honouring `indexExpanded`.
   *
   * @param analysis - the analysis whose terms to collect
   * @returns the deduplicated, ordered terms to index
   */
  private indexedTerms(analysis: QueryAnalysis): string[] {
    const terms = [...analysis.terms];
    if (this.config.indexExpanded && analysis.expanded) {
      terms.push(...analysis.expanded);
    }
    return dedupeStrings(terms);
  }

  /**
   * Register an analysis id under an intent's postings list.
   *
   * @param intent - the intent bucket
   * @param id - the analysis id
   */
  private addToIntent(intent: QueryIntent, id: string): void {
    let set = this.byIntent.get(intent);
    if (!set) {
      set = new Set<string>();
      this.byIntent.set(intent, set);
    }
    set.add(id);
  }

  /**
   * Remove an analysis id from an intent's postings list.
   *
   * @param intent - the intent bucket
   * @param id - the analysis id
   */
  private removeFromIntent(intent: QueryIntent, id: string): void {
    const set = this.byIntent.get(intent);
    if (!set) {
      return;
    }
    set.delete(id);
    if (set.size === 0) {
      this.byIntent.delete(intent);
    }
  }

  /**
   * Register an analysis id under a term's postings list and bump its count.
   *
   * @param term - the normalised term
   * @param id - the analysis id
   */
  private addToTerm(term: string, id: string): void {
    let set = this.byTerm.get(term);
    if (!set) {
      set = new Set<string>();
      this.byTerm.set(term, set);
    }
    set.add(id);
    this.termFrequency.set(term, (this.termFrequency.get(term) ?? 0) + 1);
  }

  /**
   * Remove an analysis id from a term's postings list and decrement its count.
   *
   * @param term - the normalised term
   * @param id - the analysis id
   */
  private removeFromTerm(term: string, id: string): void {
    const set = this.byTerm.get(term);
    if (!set) {
      return;
    }
    if (!set.has(id)) {
      return;
    }
    set.delete(id);
    const next = (this.termFrequency.get(term) ?? 1) - 1;
    if (next <= 0) {
      this.termFrequency.delete(term);
    } else {
      this.termFrequency.set(term, next);
    }
    if (set.size === 0) {
      this.byTerm.delete(term);
    }
  }

  /**
   * Count how many times a normalised term appears in an analysis's indexed
   * term set.
   *
   * @param analysis - the analysis to inspect
   * @param term - the normalised term
   * @returns the occurrence count (0 when the analysis is absent or termless)
   */
  private termFrequencyIn(analysis: QueryAnalysis | undefined, term: string): number {
    if (!analysis) {
      return 0;
    }
    let count = 0;
    for (const indexed of this.indexedTerms(analysis)) {
      if (indexed === term) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Apply post-processing to a hit list: optional clone and limit.
   *
   * @param hits - the computed hits, already scored and sorted
   * @param opts - the caller's options
   * @returns the final hit list
   */
  private finish(hits: QueryIndexHit[], opts?: QueryIndexQueryOptions): QueryIndexHit[] {
    const clone = opts?.clone ?? true;
    const limited = opts?.limit && opts.limit > 0 ? hits.slice(0, opts.limit) : hits;
    if (!clone) {
      return limited;
    }
    return limited.map((hit) => ({ ...hit, analysis: structuredClone(hit.analysis) }));
  }
}

/**
 * Clamp a score into the inclusive `[0, 1]` range.
 *
 * @param value - the raw score
 * @returns the clamped score
 */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalise a raw term for index lookup.
 *
 * Lowercases, trims and collapses internal whitespace. Deferred to a dedicated
 * function so the index stays decoupled from the analyzer's normalisation
 * pipeline while remaining consistent with it.
 *
 * @param term - the raw term
 * @returns the normalised term
 */
export function normalizeIndexTerm(term: string): string {
  return String(term ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}