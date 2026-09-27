/**
 * The source retriever: fast, weighted lookup over a store and index.
 *
 * `SourceRetriever` answers the everyday questions a knowledge consumer asks of
 * the Sources layer *before* chunking begins:
 *
 * - **`recent`** — what was ingested/touched most recently?
 * - **`byKind`** — all the files? all the URLs?
 * - **`byTags`** — everything tagged `runbook`?
 * - **`search`** — free-text relevance against source name and content, with
 *   configurable component weights;
 * - **`random`** — a reproducible or unpredictable sample for testing and
 *   exploration.
 *
 * `search` implements a small, dependency-free scoring model: query terms are
 * matched against the source name, the content, the tag set and recency, and
 * the four components are blended with caller-controlled weights. The returned
 * {@link SourceSearchResult} carries per-source {@link ScoredSource} records so
 * callers can explain or re-rank without re-scanning.
 *
 * @packageDocumentation
 * @module sources/retrieval
 */

import type {
  KnowledgeSource,
  SourceId,
  SourceKind,
  SourceTag,
  Timestamp,
} from './types.js';
import { clamp, normalizeTags, normalizeText } from './types.js';
import type { KnowledgeSourceStore } from './store.js';
import { SourceIndex } from './index.js';
import type { TagMatchMode } from './index.js';

/**
 * A single scored search hit.
 */
export interface ScoredSource {
  /** The matching source. */
  readonly source: KnowledgeSource;
  /** Blended relevance score in `[0, 1]`. */
  readonly score: number;
  /** Human-readable breakdown of how the score was produced. */
  readonly reasons: readonly string[];
}

/**
 * The complete answer to a {@link SourceRetriever.search} call.
 */
export interface SourceSearchResult {
  /** The (normalised) query text. */
  readonly query: string;
  /** The scored hits, best first. */
  readonly results: readonly ScoredSource[];
  /** Number of candidate sources scored before truncation. */
  readonly candidates: number;
  /** Number of results returned. */
  readonly returned: number;
  /** Wall-clock duration of the search in milliseconds. */
  readonly tookMs: number;
  /** Epoch-millisecond time at which the search ran. */
  readonly at: Timestamp;
}

/**
 * Per-call overrides for {@link SourceRetriever.search}.
 */
export interface SearchOptions {
  /**
   * Weight of the name-match component. Defaults to `1`.
   */
  readonly nameWeight?: number;

  /**
   * Weight of the content-match component. Defaults to `1`.
   */
  readonly contentWeight?: number;

  /**
   * Weight of the tag-match component. Defaults to `0.5`.
   */
  readonly tagWeight?: number;

  /**
   * Weight of the recency component. Defaults to `0.25`.
   */
  readonly recencyWeight?: number;

  /**
   * Minimum blended score a source must reach to be returned. Defaults to `0`.
   */
  readonly threshold?: number;

  /**
   * When `true`, matching is case-sensitive. Defaults to `false`.
   */
  readonly caseSensitive?: boolean;

  /**
   * Restrict search to a single {@link SourceKind}.
   */
  readonly kind?: SourceKind;
}

/**
 * Construction options for {@link SourceRetriever}.
 */
export interface SourceRetrieverOptions {
  /**
   * Optional pre-built index. When omitted, the retriever builds a private
   * index from the store's current contents.
   */
  readonly index?: SourceIndex;

  /**
   * Default result limit used when the caller omits one. Defaults to
   * {@link DEFAULT_RETRIEVER_LIMIT}.
   */
  readonly defaultLimit?: number;

  /**
   * Default {@link SearchOptions} applied to every search.
   */
  readonly defaults?: SearchOptions;

  /**
   * Optional clock used instead of `Date.now()`.
   */
  readonly now?: () => Timestamp;
}

/**
 * Default result limit for retriever calls when none is supplied.
 */
export const DEFAULT_RETRIEVER_LIMIT = 25;

/**
 * Default component weights for {@link SourceRetriever.search}.
 */
export const DEFAULT_SEARCH_WEIGHTS: Readonly<
  Required<Pick<SearchOptions, 'nameWeight' | 'contentWeight' | 'tagWeight' | 'recencyWeight'>>
> = {
  nameWeight: 1,
  contentWeight: 1,
  tagWeight: 0.5,
  recencyWeight: 0.25,
};

/**
 * Fast, weighted lookup over a {@link KnowledgeSourceStore} (and its optional
 * {@link SourceIndex}).
 *
 * @example
 * ```ts
 * const retriever = new SourceRetriever(store, index);
 * const recent = retriever.recent(10);
 * const runbooks = retriever.byTags(['runbook'], 20);
 * const hits = retriever.search('migrate database', 5);
 * ```
 */
export class SourceRetriever {
  /** The underlying store. */
  private readonly store: KnowledgeSourceStore;

  /** The index used for axis lookups. */
  private readonly index: SourceIndex;

  /** Defaults applied to every call. */
  private readonly options: Required<
    Pick<SourceRetrieverOptions, 'defaultLimit'>
  > &
    Pick<SourceRetrieverOptions, 'defaults'> & {
      now: () => Timestamp;
    };

  /** Behaviour counters. */
  private counters = { searches: 0, randomDraws: 0, listed: 0 };

  /** Epoch-millisecond construction time. */
  private readonly createdAt: Timestamp;

  /**
   * Construct a retriever.
   *
   * @param store - the source store to read from
   * @param index - optional pre-built index
   * @param options - construction options
   */
  constructor(
    store: KnowledgeSourceStore,
    index?: SourceIndex,
    options: SourceRetrieverOptions = {},
  ) {
    this.store = store;
    this.index = index ?? new SourceIndex(store.values());
    const now = options.now ?? (() => Date.now());
    this.options = {
      defaultLimit: options.defaultLimit ?? DEFAULT_RETRIEVER_LIMIT,
      defaults: options.defaults,
      now,
    };
    this.createdAt = now();
  }

  /**
   * The sources the retriever reads from.
   *
   * @returns the underlying store
   */
  get storeRef(): KnowledgeSourceStore {
    return this.store;
  }

  /**
   * The index backing axis lookups.
   *
   * @returns the underlying index
   */
  get indexRef(): SourceIndex {
    return this.index;
  }

  /**
   * Return the most recently touched sources.
   *
   * Sources are ranked by `updatedAt ?? createdAt`, descending, with
   * `createdAt` as a secondary tie-breaker.
   *
   * @param limit - maximum results (defaults to the configured limit)
   * @returns the recent sources, newest first
   */
  recent(limit?: number): KnowledgeSource[] {
    const cap = this.limit(limit);
    const sorted = this.store
      .values()
      .sort((a, b) => {
        const au = a.updatedAt ?? a.createdAt;
        const bu = b.updatedAt ?? b.createdAt;
        if (au !== bu) {
          return bu - au;
        }
        return b.createdAt - a.createdAt;
      })
      .slice(0, cap);
    this.counters.listed += 1;
    return sorted;
  }

  /**
   * Return sources of a given kind.
   *
   * @param kind - the {@link SourceKind} to filter by
   * @param limit - maximum results (defaults to the configured limit)
   * @returns the matching sources
   */
  byKind(kind: SourceKind, limit?: number): KnowledgeSource[] {
    const cap = this.limit(limit);
    const found = this.index.findByKind(kind).slice(0, cap);
    this.counters.listed += 1;
    return found;
  }

  /**
   * Return sources carrying given tags.
   *
   * @param tags - the tags to match
   * @param limit - maximum results (defaults to the configured limit)
   * @param mode - `'all'` (default) or `'any'`
   * @returns the matching sources
   */
  byTags(
    tags: readonly SourceTag[],
    limit?: number,
    mode: TagMatchMode = 'all',
  ): KnowledgeSource[] {
    const cap = this.limit(limit);
    const found = this.index.findByTags(tags, mode).slice(0, cap);
    this.counters.listed += 1;
    return found;
  }

  /**
   * Search sources by weighted relevance to a free-text query.
   *
   * The query is split into terms. For each candidate source the retriever
   * computes four sub-scores in `[0, 1]`:
   *
   * - **name** — the fraction of query terms appearing in the (normalised)
   *   source name;
   * - **content** — the fraction appearing in the content, dampened so that
   *   longer content does not dominate;
   * - **tags** — the fraction appearing in the tag set;
   * - **recency** — where the source's last touch falls within the corpus's
   *   touch-time span.
   *
   * Sub-scores are blended with the configured weights, normalised, clamped to
   * `[0, 1]` and filtered by the optional threshold.
   *
   * @param query - the free-text query
   * @param limit - maximum results (defaults to the configured limit)
   * @param options - per-call weight/threshold overrides
   * @returns a {@link SourceSearchResult}
   */
  search(query: string, limit?: number, options: SearchOptions = {}): SourceSearchResult {
    const started = this.options.now();
    const cap = this.limit(limit);
    const caseSensitive = options.caseSensitive ?? false;
    const terms = this.tokenize(query, caseSensitive);
    const weights = this.weights(options);
    const kind = options.kind;

    const candidates =
      kind !== undefined
        ? this.index.findByKind(kind)
        : this.store.values();

    const scored: ScoredSource[] = [];
    const now = this.options.now();

    for (const source of candidates) {
      const parts = this.scoreSource(source, terms, weights, now, caseSensitive);
      if (parts.score < (options.threshold ?? 0)) {
        continue;
      }
      scored.push({
        source,
        score: clamp(parts.score, 0, 1),
        reasons: parts.reasons,
      });
    }

    scored.sort((a, b) => b.score - a.score || b.source.updatedAt - a.source.updatedAt);
    const results = scored.slice(0, cap);
    this.counters.searches += 1;

    return {
      query: normalizeText(query, !caseSensitive),
      results,
      candidates: candidates.length,
      returned: results.length,
      tookMs: this.options.now() - started,
      at: started,
    };
  }

  /**
   * Return a random sample of sources.
   *
   * Uses a partial Fisher–Yates shuffle. When `seed` is provided a deterministic
   * PRNG (mulberry32) is used so samples are reproducible; otherwise
   * `Math.random` provides true non-determinism.
   *
   * @param limit - maximum results (defaults to the configured limit)
   * @param seed - optional PRNG seed for reproducible draws
   * @returns the sampled sources
   */
  random(limit?: number, seed?: number): KnowledgeSource[] {
    const cap = this.limit(limit);
    const pool = this.store.values();
    const rng = seed === undefined ? Math.random : seededRandom(seed);
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    this.counters.randomDraws += 1;
    return pool.slice(0, cap);
  }

  /**
   * Aggregate statistics about retriever behaviour.
   *
   * @returns a stats snapshot
   */
  stats(): {
    sources: number;
    searches: number;
    randomDraws: number;
    listed: number;
    createdAt: Timestamp;
  } {
    return {
      sources: this.store.size,
      searches: this.counters.searches,
      randomDraws: this.counters.randomDraws,
      listed: this.counters.listed,
      createdAt: this.createdAt,
    };
  }

  /**
   * Re-derive the internal index from the store's current contents.
   *
   * Call after bulk mutations to the store that bypassed the index.
   *
   * @returns the number of sources indexed
   */
  rebuildIndex(): number {
    const replacement = new SourceIndex(this.store.values());
    for (const source of replacement.values()) {
      this.index.indexSource(source);
    }
    return replacement.size;
  }

  /**
   * Resolve the effective limit for a call.
   *
   * @param limit - the caller-supplied limit
   * @returns the clamped limit
   */
  private limit(limit: number | undefined): number {
    if (limit === undefined) {
      return this.options.defaultLimit;
    }
    return clamp(Math.floor(limit), 1, 10_000);
  }

  /**
   * Resolve effective weights by merging call overrides over defaults.
   *
   * @param options - per-call overrides
   * @returns the effective weights
   */
  private weights(options: SearchOptions): Required<
    Pick<SearchOptions, 'nameWeight' | 'contentWeight' | 'tagWeight' | 'recencyWeight'>
  > {
    const base = this.options.defaults ?? {};
    return {
      nameWeight: Math.max(0, options.nameWeight ?? base.nameWeight ?? DEFAULT_SEARCH_WEIGHTS.nameWeight),
      contentWeight: Math.max(0, options.contentWeight ?? base.contentWeight ?? DEFAULT_SEARCH_WEIGHTS.contentWeight),
      tagWeight: Math.max(0, options.tagWeight ?? base.tagWeight ?? DEFAULT_SEARCH_WEIGHTS.tagWeight),
      recencyWeight: Math.max(0, options.recencyWeight ?? base.recencyWeight ?? DEFAULT_SEARCH_WEIGHTS.recencyWeight),
    };
  }

  /**
   * Tokenise a query into a de-duplicated term list.
   *
   * @param text - the raw query
   * @param caseSensitive - whether case is preserved
   * @returns the terms
   */
  private tokenize(text: string, caseSensitive: boolean): string[] {
    const normalized = normalizeText(text, !caseSensitive);
    if (!normalized) {
      return [];
    }
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const term of normalized.split(/\s+/)) {
      if (term && !seen.has(term)) {
        seen.add(term);
        terms.push(term);
      }
    }
    return terms;
  }

  /**
   * Score a single source against a set of query terms.
   *
   * @param source - the source to score
   * @param terms - the query terms
   * @param weights - the effective weights
   * @param now - the current clock time
   * @param caseSensitive - case sensitivity flag
   * @returns the blended score and its component reasons
   */
  private scoreSource(
    source: KnowledgeSource,
    terms: string[],
    weights: Required<
      Pick<SearchOptions, 'nameWeight' | 'contentWeight' | 'tagWeight' | 'recencyWeight'>
    >,
    now: Timestamp,
    caseSensitive: boolean,
  ): { score: number; reasons: string[] } {
    const reasons: string[] = [];
    if (terms.length === 0) {
      return { score: 0, reasons: ['no-terms'] };
    }

    const nameScore = this.matchFraction(source.name, terms, caseSensitive);
    if (nameScore > 0) {
      reasons.push(`name ${nameScore.toFixed(2)}`);
    }

    const contentScore = source.content
      ? this.matchFraction(source.content, terms, caseSensitive)
      : 0;
    if (contentScore > 0) {
      reasons.push(`content ${contentScore.toFixed(2)}`);
    }

    const tagScore = this.matchFraction((source.tags ?? []).join(' '), terms, caseSensitive);
    if (tagScore > 0) {
      reasons.push(`tags ${tagScore.toFixed(2)}`);
    }

    const recencyScore = this.recencyScore(now);
    if (recencyScore > 0) {
      reasons.push(`recency ${recencyScore.toFixed(2)}`);
    }

    const totalWeight =
      weights.nameWeight + weights.contentWeight + weights.tagWeight + weights.recencyWeight;
    const blended =
      totalWeight === 0
        ? 0
        : (nameScore * weights.nameWeight +
            contentScore * weights.contentWeight +
            tagScore * weights.tagWeight +
            recencyScore * weights.recencyWeight) /
          totalWeight;

    return { score: clamp(blended, 0, 1), reasons };
  }

  /**
   * Compute the fraction of query terms present in a haystack.
   *
   * @param haystack - the text to search
   * @param terms - the query terms
   * @param caseSensitive - case sensitivity flag
   * @returns the fraction in `[0, 1]`
   */
  private matchFraction(haystack: string, terms: string[], caseSensitive: boolean): number {
    const normalized = normalizeText(haystack, !caseSensitive);
    if (!normalized || terms.length === 0) {
      return 0;
    }
    let hits = 0;
    for (const term of terms) {
      if (normalized.includes(term)) {
        hits += 1;
      }
    }
    return hits / terms.length;
  }

  /**
   * Compute a normalised recency score relative to the corpus's touch-time span.
   *
   * @param now - the current clock time
   * @returns a value in `[0, 1]`
   */
  private recencyScore(now: Timestamp): number {
    const all = this.store.values();
    if (all.length === 0) {
      return 0;
    }
    let oldest = Infinity;
    let newest = -Infinity;
    for (const source of all) {
      const touch = source.updatedAt ?? source.createdAt;
      if (touch < oldest) {
        oldest = touch;
      }
      if (touch > newest) {
        newest = touch;
      }
    }
    if (newest <= oldest) {
      return 1;
    }
    return clamp((now - oldest) / (newest - oldest), 0, 1);
  }
}

/**
 * Deterministic mulberry32 PRNG.
 *
 * @param seed - the 32-bit seed
 * @returns a function producing values in `[0, 1)`
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Merge several search results into a single ranked list (cross-adapter use).
 *
 * @param results - the individual results
 * @param limit - maximum total results
 * @returns the merged, re-ranked hits
 */
export function mergeSearchResults(
  results: readonly SourceSearchResult[],
  limit?: number,
): ScoredSource[] {
  const merged = new Map<SourceId, ScoredSource>();
  for (const result of results) {
    for (const hit of result.results) {
      const existing = merged.get(hit.source.id);
      if (!existing || hit.score > existing.score) {
        merged.set(hit.source.id, hit);
      }
    }
  }
  const list = [...merged.values()].sort(
    (a, b) => b.score - a.score || b.source.updatedAt - a.source.updatedAt,
  );
  const cap = limit === undefined ? list.length : clamp(Math.floor(limit), 1, 10_000);
  return list.slice(0, cap);
}

/**
 * Guard for a source-kind filter value.
 *
 * @param kind - the value to test
 * @returns `true` when `kind` is a recognised source kind
 */
export function isKindFilter(kind: unknown): kind is SourceKind {
  return (
    typeof kind === 'string' &&
    (kind === 'text' || kind === 'file' || kind === 'url' || kind === 'memory')
  );
}