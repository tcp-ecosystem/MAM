/**
 * Retriever for the RAG layer.
 *
 * The {@link RagRetriever} performs the three steps that turn a raw query into
 * a generation-ready context:
 *
 * 1. **Retrieve** — {@link RagRetriever.retrieve} collects top-K candidate
 *    pieces from an injectable source function (or from a {@link ../index.RagIndex}
 *    term-overlap fallback), filters and ranks them by score, and assembles a
 *    budget-bounded {@link ../types.RagContext}.
 * 2. **Assemble** — {@link RagRetriever.assemble} fits a set of pieces into a
 *    token budget using the configured {@link ../types.RagStrategy}: greedy
 *    score-first (`'sequential'`) or source-diverse round-robin (`'hybrid'`).
 * 3. **Prompt** — {@link RagRetriever.buildPrompt} formats the assembled
 *    context into a context-augmented prompt for the generation step.
 *
 * {@link RagRetriever.recall} is a convenience entry point that returns just the
 * single best piece's text — "tell me the most relevant thing you know about
 * X" — without building a full prompt.
 *
 * The retriever is caching-aware: when constructed with a
 * {@link ../store.RagStore} and caching is enabled, repeated queries are served
 * straight from the store instead of re-running the source function.
 *
 * @packageDocumentation
 * @module rag/retrieval
 */

import {
  averageScore,
  buildCacheKey,
  clamp,
  countTokens,
  mergeRagConfig,
  normalizeText,
  sortPiecesByScore,
  uniqueSources,
  type RagConfig,
  type RagContext,
  type RagOptions,
  type RagPiece,
  type RagSourceFn,
  type RagStats,
} from './types.js';
import { RagIndex } from './index.js';
import { RagStore } from './store.js';

/**
 * Statistics specific to a {@link RagRetriever}.
 *
 * Extends the shared counters with assembly- and caching-specific fields.
 */
export interface RagRetrieverStats extends RagStats {
  /**
   * Total number of candidate pieces collected since construction.
   */
  readonly collected: number;

  /**
   * Number of pieces dropped by filters (threshold/source/tag) since
   * construction.
   */
  readonly filtered: number;

  /**
   * Number of pieces placed into assembled contexts since construction.
   */
  readonly placed: number;

  /**
   * Total number of tokens placed into assembled contexts since construction.
   */
  readonly tokensPlaced: number;

  /**
   * Average number of pieces per assembled context.
   */
  readonly averageContextPieces: number;

  /**
   * Average proportion of the budget consumed per assembled context (`0..1`).
   */
  readonly averageBudgetUsage: number;
}

/**
 * Options accepted by the {@link RagRetriever} constructor.
 */
export interface RagRetrieverOptions {
  /**
   * Base configuration; defaults are applied via {@link mergeRagConfig}.
   */
  readonly config?: Partial<RagConfig>;

  /**
   * Cache to read/write assembled contexts. When omitted, caching is disabled.
   */
  readonly store?: RagStore;

  /**
   * Fallback index used when no source function is injected.
   */
  readonly index?: RagIndex;

  /**
   * Injectable candidate-piece source. When omitted, the index (if any) is
   * used as the fallback source.
   */
  readonly source?: RagSourceFn;
}

/**
 * The retriever of the RAG layer.
 *
 * @example
 * ```ts
 * const retriever = new RagRetriever({
 *   config: { topK: 8, budgetTokens: 400, strategy: 'hybrid' },
 *   source: async (query) => backend.search(query),
 * });
 * const context = await retriever.retrieve('how do I migrate?');
 * const prompt = retriever.buildPrompt('how do I migrate?', context);
 * ```
 */
export class RagRetriever {
  private readonly _config: RagConfig;
  private readonly _store: RagStore | undefined;
  private readonly _index: RagIndex | undefined;
  private _source: RagSourceFn | undefined;

  private _queries: number;
  private _cacheHits: number;
  private _cacheMisses: number;
  private _collected: number;
  private _filtered: number;
  private _placed: number;
  private _tokensPlaced: number;
  private _assemblyCount: number;
  private _budgetUsageSum: number;
  private readonly _createdAt: number;
  private _lastAccessAt: number | null;

  /**
   * Construct a new retriever.
   *
   * @param options - config, cache, fallback index and source function
   */
  constructor(options: RagRetrieverOptions = {}) {
    this._config = mergeRagConfig(options.config);
    this._store = options.store;
    this._index = options.index;
    this._source = options.source;
    this._queries = 0;
    this._cacheHits = 0;
    this._cacheMisses = 0;
    this._collected = 0;
    this._filtered = 0;
    this._placed = 0;
    this._tokensPlaced = 0;
    this._assemblyCount = 0;
    this._budgetUsageSum = 0;
    this._createdAt = this._now();
    this._lastAccessAt = null;
  }

  /**
   * Replace the injectable candidate-piece source.
   *
   * @param source - the new source function
   * @returns the retriever, for chaining
   */
  setSource(source: RagSourceFn): this {
    this._source = source;
    return this;
  }

  /**
   * The retriever's configured base config.
   *
   * @returns the resolved {@link RagConfig}
   */
  get config(): RagConfig {
    return this._config;
  }

  /**
   * Retrieve and assemble a context for a query.
   *
   * The pipeline is: normalise the query → serve from cache when possible →
   * collect candidates from the source (or fall back to the index) → filter by
   * threshold/source/tags → rank by score → truncate to `topK` → assemble into
   * a budget-bounded context → cache the result.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns a resolved, budget-bounded {@link RagContext}
   */
  async retrieve(
    query: string,
    options: RagOptions = {},
  ): Promise<RagContext> {
    const q = normalizeText(query);
    const opts = this._resolveOptions(options);
    this._queries += 1;
    this._lastAccessAt = this._now();

    if (!q) {
      return this._emptyContext(q, opts.budgetTokens ?? this._config.budgetTokens);
    }

    const cacheKey = buildCacheKey(q);
    const cacheEnabled =
      this._config.cacheResults !== false && opts.cache !== false && !!this._store;
    if (cacheEnabled) {
      const cached = this._store!.get<RagContext>(cacheKey);
      if (cached) {
        this._cacheHits += 1;
        return cached;
      }
      this._cacheMisses += 1;
    }

    const pieces = await this._collect(q, opts);
    const ranked = this._rankAndSelect(pieces, q, opts);
    const context = this.assemble(ranked, opts.budgetTokens ?? this._config.budgetTokens, q);

    if (cacheEnabled) {
      this._store!.put(cacheKey, context);
    }
    return context;
  }

  /**
   * Collect candidates for a query without assembling a context.
   *
   * Runs collection → filtering → ranking → top-K truncation and returns the
   * ranked candidate list. Used by higher-level components that want to drive
   * assembly (and its lifecycle events) themselves.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns the ranked, truncated candidate pieces
   */
  async retrievePieces(
    query: string,
    options: RagOptions = {},
  ): Promise<RagPiece[]> {
    const q = normalizeText(query);
    const opts = this._resolveOptions(options);
    if (!q) {
      return [];
    }
    const pieces = await this._collect(q, opts);
    return this._rankAndSelect(pieces, q, opts);
  }

  /**
   * Assemble pieces into a budget-bounded context.
   *
   * Pieces are ranked best-first and then fitted into the budget using the
   * configured strategy:
   *
   * - `'sequential'` — accept pieces in score order while the running token
   *   total stays within budget.
   * - `'hybrid'` — bucket by source, then round-robin across buckets so the
   *   window stays diverse while still preferring higher-scored pieces inside
   *   each source.
   *
   * A single oversized piece is always allowed when nothing else fits, so an
   * empty context is only produced when the input is empty.
   *
   * @param pieces - the candidate pieces
   * @param budgetTokens - the token ceiling
   * @param query - the query the pieces answer (defaults to `''`)
   * @returns an assembled {@link RagContext}
   */
  assemble(
    pieces: readonly RagPiece[],
    budgetTokens: number,
    query = '',
  ): RagContext {
    const budget = Math.max(0, Math.floor(budgetTokens));
    this._assemblyCount += 1;
    this._lastAccessAt = this._now();
    if (pieces.length === 0 || budget === 0) {
      return this._emptyContext(normalizeText(query), budget);
    }
    const strategy = this._config.strategy;
    const ranked = sortPiecesByScore(pieces);
    const selected =
      strategy === 'hybrid'
        ? this._assembleHybrid(ranked, budget)
        : this._assembleSequential(ranked, budget);
    let totalTokens = 0;
    for (const piece of selected) {
      totalTokens += countTokens(piece.text);
    }
    selected.forEach((piece, rank) => {
      (piece as { rank?: number }).rank = rank;
    });
    this._placed += selected.length;
    this._tokensPlaced += totalTokens;
    const usage = budget > 0 ? totalTokens / budget : 0;
    this._budgetUsageSum += usage;
    return {
      pieces: selected,
      budgetTokens: budget,
      totalTokens,
      query: normalizeText(query),
      sources: uniqueSources(selected),
    };
  }

  /**
   * Format a context-augmented prompt for a query.
   *
   * The prompt structure is:
   *
   * ```
   * <header>
   * Context:
   * [1] (source) piece text
   * [2] (source) piece text
   * ...
   * Question: <query>
   * <footer>
   * ```
   *
   * When the context holds no pieces, a minimal prompt with just the question
   * is produced. Per-call overrides for the header/footer are honoured.
   *
   * @param query - the raw query text
   * @param context - the assembled context
   * @param options - per-call prompt overrides
   * @returns the formatted prompt string
   */
  buildPrompt(
    query: string,
    context: RagContext,
    options: RagOptions = {},
  ): string {
    const header = options.promptHeader ?? this._config.promptHeader ?? '';
    const footer = options.promptFooter ?? this._config.promptFooter ?? '';
    const separator = this._config.promptSeparator ?? 'Question:';
    const includeScores = this._config.includeScores ?? true;
    const q = normalizeText(query);

    const lines: string[] = [];
    if (header) {
      lines.push(header);
    }
    if (context.pieces.length > 0) {
      lines.push('Context:');
      context.pieces.forEach((piece, i) => {
        const label = piece.source ?? piece.sourceId;
        const scoreTag = includeScores ? ` [score ${piece.score.toFixed(2)}]` : '';
        lines.push(`[${i + 1}] (${label})${scoreTag} ${piece.text}`);
      });
    }
    if (separator) {
      lines.push(separator);
    }
    lines.push(q || '(empty query)');
    if (footer) {
      lines.push(footer);
    }
    return lines.join('\n');
  }

  /**
   * Recall the single most relevant piece for a query.
   *
   * Convenience wrapper around {@link RagRetriever.retrieve} with `topK: 1`
   * and a small budget; returns the best piece's text, or `null` when nothing
   * matched.
   *
   * @param query - the raw query text
   * @returns the best piece's text, or `null`
   */
  async recall(query: string): Promise<string | null> {
    const context = await this.retrieve(query, {
      topK: 1,
      budgetTokens: Math.min(this._config.budgetTokens, 128),
    });
    const best = context.pieces[0];
    return best ? best.text : null;
  }

  /**
   * Aggregate statistics for the retriever.
   *
   * @returns a {@link RagRetrieverStats} snapshot
   */
  stats(): RagRetrieverStats {
    const lookups = this._cacheHits + this._cacheMisses;
    return {
      queries: this._queries,
      cacheHits: this._cacheHits,
      cacheMisses: this._cacheMisses,
      cached: this._cacheHits,
      assembled: this._assemblyCount,
      pruned: 0,
      evictions: 0,
      createdAt: this._createdAt,
      lastAccessAt: this._lastAccessAt,
      cachedRatio: lookups === 0 ? 0 : this._cacheHits / lookups,
      collected: this._collected,
      filtered: this._filtered,
      placed: this._placed,
      tokensPlaced: this._tokensPlaced,
      averageContextPieces:
        this._assemblyCount === 0 ? 0 : this._placed / this._assemblyCount,
      averageBudgetUsage:
        this._assemblyCount === 0 ? 0 : this._budgetUsageSum / this._assemblyCount,
    };
  }

  /**
   * The store backing this retriever, when one was provided.
   *
   * @returns the store, or `undefined`
   */
  get store(): RagStore | undefined {
    return this._store;
  }

  /**
   * Resolve per-call options against the base config.
   *
   * @param options - the caller's overrides
   * @returns a resolved options object with defaults filled in
   */
  private _resolveOptions(options: RagOptions): Required<RagOptions> {
    return {
      topK: options.topK ?? this._config.topK,
      budgetTokens: options.budgetTokens ?? this._config.budgetTokens,
      strategy: options.strategy ?? this._config.strategy,
      threshold: options.threshold ?? this._config.threshold ?? 0,
      sourceId: options.sourceId,
      tags: options.tags,
      cache: options.cache ?? this._config.cacheResults !== false,
      includePrompt: options.includePrompt ?? true,
      promptHeader: options.promptHeader ?? this._config.promptHeader,
      promptFooter: options.promptFooter ?? this._config.promptFooter,
    };
  }

  /**
   * Collect candidate pieces for a query.
   *
   * Delegates to the injected source function when present, otherwise falls
   * back to the index's term-overlap search. Handles both sync and async
   * sources.
   *
   * @param query - the normalised query
   * @param opts - resolved options
   * @returns the candidate pieces
   */
  private async _collect(query: string, opts: Required<RagOptions>): Promise<RagPiece[]> {
    let candidates: readonly RagPiece[];
    if (this._source) {
      const result = this._source(query, opts);
      candidates = await Promise.resolve(result);
    } else if (this._index) {
      candidates = this._index.findByQuery(query, opts.topK);
    } else {
      candidates = [];
    }
    this._collected += candidates.length;
    return [...candidates];
  }

  /**
   * Filter, rank and truncate candidate pieces.
   *
   * Applies threshold/source/tag filters, sorts by descending score (stable),
   * assigns ranks and truncates to `topK`.
   *
   * @param pieces - the candidates
   * @param query - the normalised query
   * @param opts - resolved options
   * @returns the ranked, truncated pieces
   */
  private _rankAndSelect(
    pieces: readonly RagPiece[],
    _query: string,
    opts: Required<RagOptions>,
  ): RagPiece[] {
    let kept: RagPiece[] = [];
    for (const piece of pieces) {
      if (piece.score < opts.threshold) {
        this._filtered += 1;
        continue;
      }
      if (opts.sourceId && piece.sourceId !== opts.sourceId) {
        this._filtered += 1;
        continue;
      }
      if (opts.tags && opts.tags.length > 0) {
        const pieceTags = piece.tags ?? [];
        if (!opts.tags.every((tag) => pieceTags.includes(tag))) {
          this._filtered += 1;
          continue;
        }
      }
      kept.push(piece);
    }
    kept = sortPiecesByScore(kept);
    kept.forEach((piece, rank) => {
      (piece as { rank?: number }).rank = rank;
    });
    if (opts.topK > 0 && kept.length > opts.topK) {
      kept = kept.slice(0, opts.topK);
    }
    return kept;
  }

  /**
   * Fit ranked pieces into a budget greedily, score-first.
   *
   * @param ranked - the score-sorted pieces
   * @param budget - the token ceiling
   * @returns the selected pieces
   */
  private _assembleSequential(ranked: readonly RagPiece[], budget: number): RagPiece[] {
    return this._fit(ranked, budget, false);
  }

  /**
   * Fit ranked pieces into a budget with source-diverse round-robin.
   *
   * @param ranked - the score-sorted pieces
   * @param budget - the token ceiling
   * @returns the selected pieces
   */
  private _assembleHybrid(ranked: readonly RagPiece[], budget: number): RagPiece[] {
    const buckets = new Map<string, RagPiece[]>();
    for (const piece of ranked) {
      let bucket = buckets.get(piece.sourceId);
      if (!bucket) {
        bucket = [];
        buckets.set(piece.sourceId, bucket);
      }
      bucket.push(piece);
    }
    const ordered = [...buckets.values()];
    const selected: RagPiece[] = [];
    let running = 0;
    let index = 0;
    let advanced = false;
    do {
      advanced = false;
      for (const bucket of ordered) {
        if (index < bucket.length) {
          const piece = bucket[index];
          const tokens = countTokens(piece.text);
          if (running + tokens <= budget || selected.length === 0) {
            running += tokens;
            selected.push(piece);
            advanced = true;
            if (running >= budget) {
              return selected;
            }
          }
        }
      }
      index += 1;
    } while (advanced && running < budget);
    return selected;
  }

  /**
   * Greedily fit ranked pieces into a budget.
   *
   * `allowOversizeFirst` permits a single piece that exceeds the budget alone
   * when nothing smaller fits yet, so a context never comes back empty for a
   * non-empty candidate set.
   *
   * @param ranked - the score-sorted pieces
   * @param budget - the token ceiling
   * @param _allowOversizeFirst - reserved for future strategy variants
   * @returns the selected pieces
   */
  private _fit(
    ranked: readonly RagPiece[],
    budget: number,
    _allowOversizeFirst: boolean,
  ): RagPiece[] {
    const selected: RagPiece[] = [];
    let running = 0;
    for (const piece of ranked) {
      const tokens = countTokens(piece.text);
      if (running + tokens <= budget) {
        running += tokens;
        selected.push(piece);
        continue;
      }
      if (selected.length === 0) {
        running += tokens;
        selected.push(piece);
        break;
      }
      if (running >= budget) {
        break;
      }
    }
    return selected;
  }

  /**
   * Build an empty context (no pieces).
   *
   * @param query - the normalised query
   * @param budgetTokens - the budget ceiling
   * @returns an empty-but-valid {@link RagContext}
   */
  private _emptyContext(query: string, budgetTokens: number): RagContext {
    return {
      pieces: [],
      budgetTokens: Math.max(0, Math.floor(budgetTokens)),
      totalTokens: 0,
      query,
      sources: [],
    };
  }

  /**
   * Current timestamp via the configured clock.
   *
   * @returns epoch milliseconds
   */
  private _now(): number {
    return (this._config.now ?? Date.now)();
  }
}

/**
 * Compute a context's coverage score for a query under a budget.
 *
 * Returns a `[averageScore, coverage]` pair: the mean piece relevance and the
 * proportion of the budget actually used, each in `[0, 1]`.
 *
 * @param context - the assembled context
 * @returns the average score and budget coverage
 */
export function contextCoverage(context: RagContext): {
  average: number;
  coverage: number;
} {
  const average = averageScore(context.pieces);
  const budget = Math.max(1, context.budgetTokens);
  const coverage = clamp(
    (context.totalTokens ?? 0) / budget,
    0,
    1,
  );
  return { average, coverage };
}

/**
 * Combine average relevance and budget coverage into a single `[0, 1]` score.
 *
 * The blend favours relevance but rewards contexts that actually fill the
 * available budget: `score = average * (0.7 + 0.3 * coverage)`.
 *
 * @param context - the assembled context
 * @returns the blended score in `[0, 1]`
 */
export function blendContextScore(context: RagContext): number {
  const { average, coverage } = contextCoverage(context);
  return clamp(average * (0.7 + 0.3 * coverage), 0, 1);
}