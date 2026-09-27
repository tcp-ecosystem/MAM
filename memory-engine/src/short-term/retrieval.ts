/**
 * Retrieval strategies over short-term memory.
 *
 * {@link ShortTermRetriever} turns the raw contents of a
 * {@link ShortTermStore} into ordered, scored results. Each strategy answers a
 * different question about the working set:
 *
 * - {@link ShortTermRetriever.recent} — *what was most recently written?*
 *   (recency ordering, newest first).
 * - {@link ShortTermRetriever.frequent} — *what gets used the most?*
 *   (frequency ordering by `accessCount`).
 * - {@link ShortTermRetriever.tagged} — *what belongs to these tags?*
 *   (tag filtering via the {@link ShortTermIndex}).
 * - {@link ShortTermRetriever.scoped} — *what lives in this scope?*
 *   (scope filtering, again index-backed when available).
 * - {@link ShortTermRetriever.hybrid} — *what is most relevant to this
 *   context right now?* (a weighted blend of recency, frequency and text
 *   match, with optional tag/scope narrowing).
 *
 * All strategies return {@link ScoredEntry}s sorted in descending order of
 * `score`, with a human-readable `reason` attached to each hit so retrieval
 * decisions can be explained and debugged.
 *
 * ## Scoring model
 *
 * Scores are always normalised into `[0, 1]`:
 *
 * - **Recency** — `(createdAt - oldest) / (newest - oldest)`, where `oldest`
 *   and `newest` bound the candidate set; a single candidate scores `1`.
 * - **Frequency** — `accessCount / maxAccessCount` over the candidate set.
 * - **Text** — `1` when the query term appears in the entry's indexed text,
 *   otherwise `0`.
 *
 * `hybrid` combines these with caller-supplied weights
 * ({@link ShortTermRetrievalOptions.recencyWeight},
 * {@link ShortTermRetrievalOptions.frequencyWeight},
 * {@link ShortTermRetrievalOptions.textWeight}) and renormalises by the total
 * weight so the blended score stays in `[0, 1]`.
 *
 * @packageDocumentation
 * @module short-term/retrieval
 */

import type {
  ScoredEntry,
  SearchResult,
  ShortTermEntry,
  ShortTermScope,
  Timestamp,
} from './types.js';
import { ShortTermIndex } from './index.js';
import { ShortTermStore } from './store.js';

/**
 * Options accepted by {@link ShortTermRetriever.hybrid} and
 * {@link ShortTermRetriever.search}.
 *
 * Weights control how strongly each signal influences the blended score;
 * they should sum to `1` for a score that stays in `[0, 1]` (the retriever
 * renormalises by the total, so arbitrary weights are also safe).
 */
export interface ShortTermRetrievalOptions {
  /**
   * Maximum number of results to return. `0` means unbounded. Defaults to
   * `20`.
   */
  readonly limit?: number;

  /**
   * Weight applied to the recency signal (newest-first preference).
   * Defaults to `0.4`.
   */
  readonly recencyWeight?: number;

  /**
   * Weight applied to the frequency signal (most-accessed preference).
   * Defaults to `0.3`.
   */
  readonly frequencyWeight?: number;

  /**
   * Weight applied to the text-match signal (query term present in the
   * entry's indexed text). Defaults to `0.3`.
   */
  readonly textWeight?: number;

  /**
   * Optional narrowing: only entries carrying at least one of these tags are
   * considered. Requires the index when set.
   */
  readonly tags?: readonly string[];

  /**
   * Optional narrowing: only entries in this scope are considered.
   */
  readonly scope?: ShortTermScope;

  /**
   * Results with a blended score below this threshold are dropped. Defaults
   * to `0`.
   */
  readonly minScore?: number;
}

/**
 * Internal options carried through hybrid scoring.
 *
 * Extends the public {@link ShortTermRetrievalOptions} with the normalised
 * query text so downstream scoring helpers do not need to re-normalise it.
 */
export interface HybridOptions extends ShortTermRetrievalOptions {
  /**
   * The trimmed, lower-cased query text, or `''` when no query was supplied.
   */
  readonly queryText?: string;
}

/**
 * Compute a recency score in `[0, 1]` for a timestamp within a bounded range.
 *
 * `(createdAt - oldest) / (newest - oldest)`; when the range is degenerate
 * (newest equals oldest) the newest entry scores `1`. Out-of-range timestamps
 * are clamped.
 *
 * @param createdAt - the entry's creation timestamp
 * @param oldest - the oldest timestamp in the candidate range
 * @param newest - the newest timestamp in the candidate range
 * @returns a score in `[0, 1]`, `1` for the newest entry
 */
export function recencyScore(createdAt: Timestamp, oldest: Timestamp, newest: Timestamp): number {
  const span = newest - oldest;
  if (span <= 0) {
    return 1;
  }
  const raw = (createdAt - oldest) / span;
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
}

/**
 * Compute a frequency score in `[0, 1]` for an access count.
 *
 * `accessCount / maxAccessCount`; when no entry has been accessed the score is
 * `0`.
 *
 * @param accessCount - the entry's access count
 * @param maxAccessCount - the maximum access count in the candidate set
 * @returns a score in `[0, 1]`, `1` for the most-accessed entry
 */
export function frequencyScore(accessCount: number, maxAccessCount: number): number {
  if (maxAccessCount <= 0) {
    return 0;
  }
  const raw = accessCount / maxAccessCount;
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
}

/**
 * Compute a text-match score in `{0, 1}` for an entry against a term.
 *
 * When an index is available the entry's *indexed* text is consulted (this
 * includes string metadata values). Without an index, only a string value is
 * checked. Matching is case-insensitive.
 *
 * @param entry - the entry to test
 * @param term - the raw query term
 * @param index - the index to consult (optional)
 * @returns `1` when the term is present, otherwise `0`
 */
export function textMatchScore(
  entry: ShortTermEntry,
  term: string,
  index?: ShortTermIndex,
): number {
  const needle = term.trim().toLowerCase();
  if (!needle) {
    return 0;
  }
  const text = index?.textFor(entry.id) ?? '';
  if (text.includes(needle)) {
    return 1;
  }
  return typeof entry.value === 'string' && entry.value.toLowerCase().includes(needle) ? 1 : 0;
}

/**
 * Fully-capable retrieval engine over a short-term store.
 *
 * Construct with a {@link ShortTermStore} and (optionally) a
 * {@link ShortTermIndex} to enable tag/scope/text narrowing. All methods are
 * synchronous and read-only — retrieval never mutates the store.
 */
export class ShortTermRetriever {
  private readonly store: ShortTermStore;
  private readonly index?: ShortTermIndex;
  private readonly defaultLimit: number;

  /**
   * Construct a retriever over a store.
   *
   * @param store - the store to retrieve from
   * @param index - optional index enabling tag/scope/text narrowing
   * @param defaultLimit - limit applied when the caller omits one (default 20)
   */
  constructor(store: ShortTermStore, index?: ShortTermIndex, defaultLimit = 20) {
    this.store = store;
    this.index = index;
    this.defaultLimit = defaultLimit;
  }

  /**
   * Resolve the effective limit, treating `0`/negative as unbounded.
   *
   * @param limit - the caller-supplied limit, or `undefined`
   * @returns the positive limit to apply, or `undefined` for unbounded
   */
  private effectiveLimit(limit: number | undefined): number | undefined {
    const value = limit ?? this.defaultLimit;
    return value > 0 ? value : undefined;
  }

  /**
   * Cap a sorted result list at the effective limit.
   *
   * @param scored - the scored results, best first
   * @param limit - the raw limit request
   * @returns the capped list
   */
  private cap<T>(scored: T[], limit: number | undefined): T[] {
    const effective = this.effectiveLimit(limit);
    return effective === undefined ? scored : scored.slice(0, effective);
  }

  /**
   * The most recently written entries, newest first.
   *
   * Scores are pure recency normalised over the current entry set; the newest
   * entry scores `1`. Ties on `createdAt` are broken by id (stable order).
   *
   * @param limit - maximum results (default from the constructor; `0` = all)
   * @returns scored entries, newest first
   */
  recent(limit?: number): ScoredEntry[] {
    const entries = this.store.entries();
    if (entries.length === 0) {
      return [];
    }
    const oldest = Math.min(...entries.map((e) => e.createdAt));
    const newest = Math.max(...entries.map((e) => e.createdAt));
    const scored: ScoredEntry[] = entries
      .map((entry) => ({
        entry,
        score: recencyScore(entry.createdAt, oldest, newest),
        reason: `newest of ${entries.length} entries`,
      }))
      .sort((a, b) => b.score - a.score || (a.entry.id < b.entry.id ? 1 : -1));
    return this.cap(scored, limit);
  }

  /**
   * The most frequently accessed entries, most-used first.
   *
   * Scores are pure frequency (`accessCount / max`) normalised over the
   * current entry set; ties are broken by recency so that an equally-accessed
   * but fresher entry ranks higher.
   *
   * @param limit - maximum results (default from the constructor; `0` = all)
   * @returns scored entries, most frequent first
   */
  frequent(limit?: number): ScoredEntry[] {
    const entries = this.store.entries();
    if (entries.length === 0) {
      return [];
    }
    const maxAccess = Math.max(...entries.map((e) => e.accessCount));
    const scored: ScoredEntry[] = entries
      .map((entry) => ({
        entry,
        score: frequencyScore(entry.accessCount, maxAccess),
        reason: `accessed ${entry.accessCount} time(s), most of ${entries.length} entries`,
      }))
      .sort((a, b) => b.score - a.score || b.entry.createdAt - a.entry.createdAt);
    return this.cap(scored, limit);
  }

  /**
   * Entries carrying at least one of the given tags.
   *
   * Uses the index for an O(matched) lookup when available, otherwise falls
   * back to a linear filter over the store. Results are ordered by recency;
   * the score is `1` when every requested tag matched and proportionally less
   * when only a subset did.
   *
   * @param tags - the tags to match (union semantics)
   * @param limit - maximum results (default from the constructor; `0` = all)
   * @returns scored entries, best tag match first
   */
  tagged(tags: readonly string[], limit?: number): ScoredEntry[] {
    const normalised = tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
    if (normalised.length === 0) {
      return [];
    }
    const matched =
      this.index?.findByTag(normalised) ??
      this.store.entries().filter((e) => e.tags?.some((t) => normalised.includes(t)));
    const scored: ScoredEntry[] = matched
      .map((entry) => {
        const hits = (entry.tags ?? []).filter((t) => normalised.includes(t)).length;
        return {
          entry,
          score: hits / normalised.length,
          reason: `matched tag(s) ${(entry.tags ?? [])
            .filter((t) => normalised.includes(t))
            .join(', ')}`,
        };
      })
      .sort((a, b) => b.score - a.score || b.entry.createdAt - a.entry.createdAt);
    return this.cap(scored, limit);
  }

  /**
   * Entries belonging to a given scope.
   *
   * Uses the index for an O(matched) lookup when available, otherwise filters
   * the store linearly. Results are ordered by recency and scored by it, so
   * the freshest scoped entry ranks first.
   *
   * @param scope - the scope to match
   * @param limit - maximum results (default from the constructor; `0` = all)
   * @returns scored entries in the scope, newest first
   */
  scoped(scope: ShortTermScope, limit?: number): ScoredEntry[] {
    const matched =
      this.index?.findByScope(scope) ??
      this.store.entries().filter((e) => e.scope === scope);
    if (matched.length === 0) {
      return [];
    }
    const oldest = Math.min(...matched.map((e) => e.createdAt));
    const newest = Math.max(...matched.map((e) => e.createdAt));
    const scored: ScoredEntry[] = matched
      .map((entry) => ({
        entry,
        score: recencyScore(entry.createdAt, oldest, newest),
        reason: `in scope "${scope}" (${matched.length} entries)`,
      }))
      .sort((a, b) => b.score - a.score);
    return this.cap(scored, limit);
  }

  /**
   * Retrieve the candidate pool for hybrid scoring.
   *
   * When tag/scope narrowing is requested the index is used when available;
   * otherwise the pool is the full entry set (narrowing tags are then applied
   * as an extra text-like signal by the caller). Every candidate is the
   * store's *live* entry so frequency and recency are never stale.
   *
   * @param opts - the retrieval options
   * @returns the candidate entries, deduplicated, insertion-ordered
   */
  private candidatePool(opts: ShortTermRetrievalOptions): ShortTermEntry[] {
    const entries = this.store.entries();
    if (!opts.tags?.length && opts.scope === undefined) {
      return entries;
    }
    const seen = new Set<string>();
    const pool: ShortTermEntry[] = [];
    const byTag = opts.tags?.length
      ? (this.index?.findByTag(opts.tags) ?? entries.filter((e) => e.tags?.some((t) => opts.tags?.includes(t))))
      : [];
    const byScope = opts.scope !== undefined ? this.scopedEntries(opts.scope) : [];
    for (const entry of [...byTag, ...byScope]) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        pool.push(entry);
      }
    }
    return pool.length > 0 ? pool : entries;
  }

  /**
   * Scope-filtered entries, index-backed when possible.
   *
   * @param scope - the scope to match
   * @returns the matching entries
   */
  private scopedEntries(scope: ShortTermScope): ShortTermEntry[] {
    return (
      this.index?.findByScope(scope) ??
      this.store.entries().filter((e) => e.scope === scope)
    );
  }

  /**
   * Score a single candidate for hybrid retrieval.
   *
   * Blends recency, frequency and text match with the caller's weights and
   * renormalises by the total weight so the result stays in `[0, 1]`.
   *
   * @param entry - the candidate entry
   * @param opts - the retrieval options (weights and query)
   * @param oldest - oldest timestamp in the candidate pool
   * @param newest - newest timestamp in the candidate pool
   * @param maxAccess - maximum access count in the candidate pool
   * @returns the blended score in `[0, 1]`
   */
  private hybridScore(
    entry: ShortTermEntry,
    opts: HybridOptions,
    oldest: Timestamp,
    newest: Timestamp,
    maxAccess: number,
  ): { score: number; reason: string } {
    const recencyW = opts.recencyWeight ?? 0.4;
    const frequencyW = opts.frequencyWeight ?? 0.3;
    const textW = opts.textWeight ?? 0.3;
    const total = recencyW + frequencyW + textW;
    const recency = recencyScore(entry.createdAt, oldest, newest);
    const frequency = frequencyScore(entry.accessCount, maxAccess);
    const text = opts.queryText ? textMatchScore(entry, opts.queryText, this.index) : 0;
    const score = total === 0 ? 0 : (recency * recencyW + frequency * frequencyW + text * textW) / total;
    const parts: string[] = [];
    if (opts.queryText) {
      parts.push(text > 0 ? `text match "${opts.queryText}"` : 'no text match');
    }
    parts.push(`recency ${recency.toFixed(2)}`, `frequency ${frequency.toFixed(2)}`);
    return { score, reason: parts.join(' · ') };
  }

  /**
   * Hybrid retrieval: relevance-ranked entries for a current context.
   *
   * The candidate pool is narrowed by {@link ShortTermRetrievalOptions.tags}
   * and {@link ShortTermRetrievalOptions.scope} when supplied, then every
   * candidate is scored as a weighted blend of recency, frequency and text
   * match against `query`. Results below
   * {@link ShortTermRetrievalOptions.minScore} are dropped.
   *
   * @param query - the query text to match (optional; omitted scores recency
   *   + frequency only)
   * @param opts - weighting, narrowing and limit options
   * @returns scored entries, most relevant first
   */
  hybrid(query: string, opts: ShortTermRetrievalOptions = {}): ScoredEntry[] {
    const optsWithQuery: HybridOptions = {
      ...opts,
      queryText: query.trim().toLowerCase(),
    };
    const pool = this.candidatePool(optsWithQuery);
    if (pool.length === 0) {
      return [];
    }
    const oldest = Math.min(...pool.map((e) => e.createdAt));
    const newest = Math.max(...pool.map((e) => e.createdAt));
    const maxAccess = Math.max(...pool.map((e) => e.accessCount));
    const minScore = opts.minScore ?? 0;
    const scored: ScoredEntry[] = pool
      .map((entry) => {
        const { score, reason } = this.hybridScore(entry, optsWithQuery, oldest, newest, maxAccess);
        return { entry, score, reason };
      })
      .filter((s) => s.score >= minScore)
      .sort((a, b) => b.score - a.score || b.entry.createdAt - a.entry.createdAt);
    return this.cap(scored, opts.limit);
  }

  /**
   * Search the store for a term, returning a structured result.
   *
   * This is the entry point designed for the runtime adapter's
   * {@link ShortTermRuntimeAdapter.search}. It runs a hybrid retrieval with a
   * text-heavy weighting (recency `0.25`, frequency `0.25`, text `0.5`) and
   * wraps the outcome in a {@link SearchResult}.
   *
   * @param query - the text to search for
   * @param opts - optional retrieval options overriding the defaults
   * @returns a {@link SearchResult} with the scored matches
   */
  search(query: string, opts: ShortTermRetrievalOptions = {}): SearchResult {
    const results = this.hybrid(query, {
      limit: opts.limit ?? 20,
      recencyWeight: opts.recencyWeight ?? 0.25,
      frequencyWeight: opts.frequencyWeight ?? 0.25,
      textWeight: opts.textWeight ?? 0.5,
      tags: opts.tags,
      scope: opts.scope,
      minScore: opts.minScore ?? 0,
    });
    return {
      query: query.trim().toLowerCase(),
      total: results.length,
      results,
      timestamp: Date.now(),
    };
  }
}