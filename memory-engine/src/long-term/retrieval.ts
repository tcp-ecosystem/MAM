/**
 * @fileOverview High-level retrieval over the long-term store.
 *
 * {@link LongTermRetriever} layers ergonomic, production-oriented query APIs on
 * top of a {@link LongTermStore} (and optionally a {@link LongTermIndex}):
 *
 *   - `recent`, `important`, `tagged`, `source`, `dateRange` – simple ranked
 *     slices of the store.
 *   - `hybrid` – a weighted scorer that combines importance, recency, and
 *     lexical/tag match into a single normalised relevance score, returning
 *     `ScoredLongTermResult` entries with a score breakdown for tuning.
 *
 * The hybrid scorer is deliberately dependency-free: it tokenises both the
 * query and the entries, applies a small stop-word list, computes
 * term-frequency overlap, and blends three components:
 *
 *   score = importanceWeight * importance
 *         + recencyWeight  * recency(entry, halfLife)
 *         + tagWeight      * match(query, entry)
 *
 * All weights default to sensible values and can be overridden per call.
 */

import {
  LongTermEntry,
  LongTermEntryOptions,
  ScoredLongTermResult,
  entryAgeMs,
  filterArchived,
  normalizeImportance,
  normalizeTags,
  sortByImportance,
  sortByNewest,
} from './types.js';

import type { LongTermStore } from './store.js';
import type { LongTermIndex } from './index.js';

/** Retrieval filters shared by every retriever method. */
export interface LongTermRetrievalOptions {
  /** Maximum number of results (default 20). */
  limit?: number;
  /** Skip the first N ranked results (default 0). */
  offset?: number;
  /** Include archived entries in the results (default false). */
  includeArchived?: boolean;
  /** Only return entries with importance at least this value. */
  minImportance?: number;
}

/** Options specific to the hybrid weighted scorer. */
export interface HybridRetrievalOptions extends LongTermRetrievalOptions {
  /** Weight of the importance component (default 0.4). */
  importanceWeight?: number;
  /** Weight of the recency component (default 0.3). */
  recencyWeight?: number;
  /** Weight of the lexical + tag match component (default 0.3). */
  tagWeight?: number;
  /**
   * Half-life in milliseconds for the recency decay.  After this much time an
   * entry's recency component halves.  Default 30 days.
   */
  recencyHalfLifeMs?: number;
  /** When true, only entries matching the query lexically are returned. */
  mustMatch?: boolean;
  /** When true, tags are allowed to match the query terms (default true). */
  matchTags?: boolean;
  /** Maximum bytes of an entry's serialised value that are scanned (default 8 KB). */
  maxScanBytes?: number;
}

/** Default scoring weights used when a call does not override them. */
const DEFAULT_WEIGHTS = {
  importanceWeight: 0.4,
  recencyWeight: 0.3,
  tagWeight: 0.3,
  recencyHalfLifeMs: 30 * 24 * 60 * 60 * 1000,
} as const;

/** Default result limit when a call does not specify one. */
const DEFAULT_LIMIT = 20;

/** Stop words excluded from token matching. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has',
  'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to',
  'was', 'were', 'will', 'with', 'this', 'these', 'those', 'not', 'but',
  'have', 'had', 'do', 'does', 'did', 'we', 'you', 'they', 'them', 'i',
  'our', 'their', 'my', 'your', 'what', 'which', 'who', 'when', 'where',
  'how', 'all', 'each', 'about', 'into', 'over', 'than', 'too', 'can',
  'get', 'just', 'like', 'more', 'most', 'other', 'some', 'such', 'only',
]);

/** A single normalised query term with its raw form retained. */
interface Token {
  /** Lower-cased, stop-word-filtered term. */
  normalized: string;
}

/** Bundled dependencies the retriever reads from. */
export interface LongTermRetrieverDeps {
  /** Source of entries. */
  store: LongTermStore;
  /** Optional index used to accelerate tag / source / date lookups. */
  index?: LongTermIndex;
}

/**
 * Reads and ranks entries from a {@link LongTermStore}, optionally using a
 * {@link LongTermIndex} to speed up constrained lookups.
 *
 * @example
 * ```ts
 * const retriever = new LongTermRetriever({ store, index });
 * const hits = retriever.hybrid('bug in parser', { limit: 5 });
 * ```
 */
export class LongTermRetriever {
  private readonly deps: LongTermRetrieverDeps;

  /** Creates a retriever bound to a store (and, optionally, an index). */
  constructor(deps: LongTermRetrieverDeps) {
    this.deps = deps;
  }

  /* ------------------------------------------------------------------ *
   * Simple ranked retrievals
   * ------------------------------------------------------------------ */

  /**
   * Returns the most recently created / updated live entries, newest first.
   */
  recent(options?: LongTermRetrievalOptions): LongTermEntry[] {
    return this.slice(this.rankedNewest(this.sourceEntries()), options);
  }

  /**
   * Returns the most recently *accessed* live entries (recency by
   * `lastAccessAt`), useful for "recently used memories".
   */
  recentlyAccessed(options?: LongTermRetrievalOptions): LongTermEntry[] {
    const entries = this.rankedRecency(this.sourceEntries());
    return this.slice(entries, options);
  }

  /**
   * Returns the highest-importance live entries, highest first.  Entries with
   * no importance score rank last.
   */
  important(options?: LongTermRetrievalOptions): LongTermEntry[] {
    let entries = this.rankedByImportance(this.sourceEntries());
    const min = options?.minImportance;
    if (min !== undefined) {
      entries = entries.filter(
        (entry) => normalizeImportance(entry.importance) >= normalizeImportance(min),
      );
    }
    return this.slice(entries, options);
  }

  /**
   * Returns live entries carrying **all** of the requested tags, newest first.
   * Delegates to the index when one is available; falls back to the store's
   * `getByTag` otherwise.
   */
  tagged(
    tags: string | string[],
    options?: LongTermRetrievalOptions,
  ): LongTermEntry[] {
    const entries = this.deps.index
      ? this.deps.index.findByTags(tags, {
          includeArchived: options?.includeArchived,
        })
      : this.deps.store.getByTag(tags, {
          includeArchived: options?.includeArchived,
        });
    return this.slice(entries, options);
  }

  /**
   * Returns live entries that carry **any** of the requested tags, newest
   * first, de-duplicated.
   */
  taggedAny(
    tags: string | string[],
    options?: LongTermRetrievalOptions,
  ): LongTermEntry[] {
    const wanted = normalizeTags(tags);
    const seen = new Map<string, LongTermEntry>();
    for (const tag of wanted) {
      for (const entry of this.tagged(tag, options)) {
        seen.set(entry.id, entry);
      }
    }
    return this.slice(sortByNewest([...seen.values()]), options);
  }

  /**
   * Returns live entries from a specific `source`, newest first.
   */
  source(
    source: string,
    options?: LongTermRetrievalOptions,
  ): LongTermEntry[] {
    const entries = this.deps.index
      ? this.deps.index.findBySource(source, {
          includeArchived: options?.includeArchived,
        })
      : this.deps.store
          .getAll({ includeArchived: options?.includeArchived })
          .filter((entry) => entry.source === source);
    return this.slice(entries, options);
  }

  /**
   * Returns live entries created inside the inclusive `[from, to]` millisecond
   * window, newest first.  Delegates to the index's ordered date index when
   * available.
   */
  dateRange(
    from: number,
    to: number,
    options?: LongTermRetrievalOptions,
  ): LongTermEntry[] {
    const entries = this.deps.index
      ? this.deps.index.findByDateRange(from, to)
      : this.deps.store
          .getAll({ includeArchived: options?.includeArchived })
          .filter(
            (entry) => entry.createdAt >= from && entry.createdAt <= to,
          );
    return this.slice(entries, options);
  }

  /* ------------------------------------------------------------------ *
   * Hybrid weighted scoring
   * ------------------------------------------------------------------ */

  /**
   * Ranked retrieval that blends importance, recency, and lexical/tag match.
   *
   * The query is tokenised and scored against each entry's `value` (string or
   * JSON-serialised), tags, source, and metadata.  Each entry receives a
   * normalised score in [0, 1] whose components are reported in
   * {@link ScoredLongTermResult.breakdown} for debugging.
   *
   * @param query  Free-text query to match against.
   * @param opts   Scoring weights and filters (see
   *               {@link HybridRetrievalOptions}).
   * @returns Ranked hits with score breakdown, filtered by `opts.limit`.
   */
  hybrid(
    query: string,
    opts?: HybridRetrievalOptions,
  ): ScoredLongTermResult[] {
    const options = this.mergeHybridOptions(opts);
    const terms = this.tokenize(query);
    const candidates = this.candidatePool(options);
    const scored: ScoredLongTermResult[] = [];

    for (const entry of candidates) {
      if (this.excluded(entry, options)) {
        continue;
      }
      const match = this.matchScore(entry, terms, options);
      if (options.mustMatch === true && match <= 0) {
        continue;
      }
      const importance = normalizeImportance(entry.importance);
      const recency = this.recencyScore(entry, options.recencyHalfLifeMs);
      const score = this.blend(importance, recency, match, options);
      scored.push({
        entry,
        score,
        breakdown: {
          importance,
          recency,
          match,
        },
      });
    }

    scored.sort((a, b) => b.score - a.score);
    const start = options.offset ?? 0;
    return scored.slice(start, start + (options.limit ?? DEFAULT_LIMIT));
  }

  /**
   * Convenience wrapper around {@link LongTermRetriever.hybrid} that returns
   * plain entries (scores discarded).
   */
  search(
    query: string,
    opts?: HybridRetrievalOptions,
  ): LongTermEntry[] {
    return this.hybrid(query, opts).map((hit) => hit.entry);
  }

  /* ------------------------------------------------------------------ *
   * Internal machinery
   * ------------------------------------------------------------------ */

  /** Returns the pool of entries the hybrid scorer scans. */
  private candidatePool(options: HybridRetrievalOptions): LongTermEntry[] {
    const entries = this.deps.index
      ? this.deps.index.all()
      : this.deps.store.getAll({ includeArchived: true });
    return filterArchived(entries, options.includeArchived === true);
  }

  /** Returns the raw source entries for non-indexed simple queries. */
  private sourceEntries(): LongTermEntry[] {
    return this.deps.index
      ? this.deps.index.all()
      : this.deps.store.getAll({ includeArchived: true });
  }

  /** Applies offset/limit + archived filter to a ranked list. */
  private slice(
    entries: LongTermEntry[],
    options?: LongTermRetrievalOptions,
  ): LongTermEntry[] {
    const includeArchived = options?.includeArchived ?? false;
    const filtered = filterArchived(entries, includeArchived);
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? DEFAULT_LIMIT;
    return filtered.slice(offset, offset + limit);
  }

  /** Sorts a list newest-first using the shared comparator. */
  private rankedNewest(entries: LongTermEntry[]): LongTermEntry[] {
    return sortByNewest(entries);
  }

  /** Sorts a list by `lastAccessAt` descending. */
  private rankedRecency(entries: LongTermEntry[]): LongTermEntry[] {
    return [...entries].sort(
      (a, b) => (b.lastAccessAt ?? b.createdAt) - (a.lastAccessAt ?? a.createdAt),
    );
  }

  /** Sorts a list by importance descending using the shared comparator. */
  private rankedByImportance(entries: LongTermEntry[]): LongTermEntry[] {
    return sortByImportance(entries);
  }

  /** Applies query-level filters that short-circuit scoring. */
  private excluded(
    entry: LongTermEntry,
    options: Required<Pick<HybridRetrievalOptions, 'minImportance'>> &
      HybridRetrievalOptions,
  ): boolean {
    if (entry.archived === true && options.includeArchived !== true) {
      return true;
    }
    if (options.minImportance !== undefined) {
      const min = normalizeImportance(options.minImportance);
      if (normalizeImportance(entry.importance) < min) {
        return true;
      }
    }
    return false;
  }

  /** Merges caller weights with the defaults into a fully-typed options bag. */
  private mergeHybridOptions(
    opts?: HybridRetrievalOptions,
  ): Required<Pick<HybridRetrievalOptions, 'limit' | 'offset' | 'includeArchived' | 'minImportance' | 'importanceWeight' | 'recencyWeight' | 'tagWeight' | 'recencyHalfLifeMs' | 'mustMatch' | 'matchTags' | 'maxScanBytes'>> {
    return {
      limit: opts?.limit ?? DEFAULT_LIMIT,
      offset: opts?.offset ?? 0,
      includeArchived: opts?.includeArchived ?? false,
      minImportance: opts?.minImportance,
      importanceWeight: opts?.importanceWeight ?? DEFAULT_WEIGHTS.importanceWeight,
      recencyWeight: opts?.recencyWeight ?? DEFAULT_WEIGHTS.recencyWeight,
      tagWeight: opts?.tagWeight ?? DEFAULT_WEIGHTS.tagWeight,
      recencyHalfLifeMs:
        opts?.recencyHalfLifeMs ?? DEFAULT_WEIGHTS.recencyHalfLifeMs,
      mustMatch: opts?.mustMatch ?? false,
      matchTags: opts?.matchTags ?? true,
      maxScanBytes: opts?.maxScanBytes ?? 8 * 1024,
    };
  }

  /** Blends the three normalised components into a single score. */
  private blend(
    importance: number,
    recency: number,
    match: number,
    options: {
      importanceWeight: number;
      recencyWeight: number;
      tagWeight: number;
    },
  ): number {
    const totalWeight =
      options.importanceWeight + options.recencyWeight + options.tagWeight;
    const weighted =
      importance * options.importanceWeight +
      recency * options.recencyWeight +
      match * options.tagWeight;
    return totalWeight > 0 ? weighted / totalWeight : 0;
  }

  /**
   * Exponential-decay recency score in [0, 1].  An entry touched now scores 1;
   * after one half-life it scores 0.5; after five half-lives it is ~0.03.
   */
  private recencyScore(entry: LongTermEntry, halfLifeMs: number): number {
    const age = entryAgeMs(entry);
    if (halfLifeMs <= 0 || age <= 0) {
      return age <= 0 ? 1 : 0;
    }
    return Math.pow(0.5, age / halfLifeMs);
  }

  /**
   * Computes the lexical + tag match component in [0, 1] for an entry against
   * the query tokens.  The score is a Jaccard-style overlap of token sets,
   * boosted slightly when a query term appears verbatim in the entry's tags.
   */
  private matchScore(
    entry: LongTermEntry,
    terms: Token[],
    options: {
      matchTags: boolean;
      maxScanBytes: number;
    },
  ): number {
    if (terms.length === 0) {
      return 0;
    }
    const haystackTerms = this.entryTerms(entry, options);
    if (haystackTerms.size === 0) {
      return 0;
    }
    let overlap = 0;
    for (const term of terms) {
      if (haystackTerms.has(term.normalized)) {
        overlap += 1;
      }
    }
    const jaccard = overlap / terms.length;
    if (options.matchTags && this.tagHit(entry, terms)) {
      return Math.min(1, jaccard + 0.15);
    }
    return jaccard;
  }

  /** Returns true when any query term matches one of the entry's tags. */
  private tagHit(entry: LongTermEntry, terms: Token[]): boolean {
    const tags = new Set(normalizeTags(entry.tags));
    for (const term of terms) {
      if (tags.has(term.normalized)) {
        return true;
      }
    }
    return false;
  }

  /** Extracts the token set of an entry, respecting the scan byte cap. */
  private entryTerms(
    entry: LongTermEntry,
    options: { maxScanBytes: number },
  ): Set<string> {
    const text = this.entryText(entry, options.maxScanBytes);
    const out = new Set<string>();
    for (const token of this.tokenize(text)) {
      out.add(token.normalized);
    }
    if (options.maxScanBytes >= 0) {
      for (const tag of normalizeTags(entry.tags)) {
        out.add(tag);
      }
    }
    return out;
  }

  /** Renders an entry's searchable text, truncated to `maxScanBytes`. */
  private entryText(entry: LongTermEntry, maxScanBytes: number): string {
    let text = '';
    const value = entry.value;
    if (typeof value === 'string') {
      text = value;
    } else if (value !== null && typeof value === 'object') {
      try {
        text = JSON.stringify(value);
      } catch {
        text = '';
      }
    } else if (value !== undefined) {
      text = String(value);
    }
    if (maxScanBytes > 0 && Buffer.byteLength(text, 'utf8') > maxScanBytes) {
      text = text.slice(0, maxScanBytes);
    }
    return text;
  }

  /** Splits free text into lower-cased, stop-word-filtered terms. */
  private tokenize(text: string): Token[] {
    const parts = text.toLowerCase().match(/[a-z0-9_]+/g);
    if (!parts) {
      return [];
    }
    const seen = new Set<string>();
    const tokens: Token[] = [];
    for (const part of parts) {
      if (STOP_WORDS.has(part) || part.length === 1 || seen.has(part)) {
        continue;
      }
      seen.add(part);
      tokens.push({ normalized: part });
    }
    return tokens;
  }
}

/**
 * Re-exported convenience that builds a retriever over a store and an
 * optional index, mirroring the factory style used across the layer.
 */
export function createLongTermRetriever(
  store: LongTermStore,
  index?: LongTermIndex,
): LongTermRetriever {
  return new LongTermRetriever({ store, index });
}

/**
 * Typed helper describing the shape of a "recall" context handed to the
 * integration layer.  A context can be free text, a structured object, or a
 * set of hint tags.
 */
export interface RecallContext {
  /** Free-text query describing what to remember. */
  query?: string;
  /** Tags that must be present on recalled entries. */
  tags?: string[];
  /** Restrict recall to a single source. */
  source?: string;
  /** Minimum importance filter for recalled entries. */
  minImportance?: number;
  /** Maximum number of entries to recall (default 10). */
  limit?: number;
  /** Options forwarded to the hybrid scorer. */
  hybrid?: HybridRetrievalOptions;
  /** Entry write options used when persisting a re-memory note. */
  entry?: LongTermEntryOptions;
}