/**
 * Hybrid scoring and ranking engine for the Ranking layer of the standalone
 * MAM Knowledge Engine.
 *
 * {@link KnowledgeRanker} turns a pool of {@link ChunkCandidate}s into an
 * ordered, explainable list of {@link RankedChunk}s. It is the heart of the
 * Ranking layer and blends four signals per chunk:
 *
 * 1. **Lexical** — BM25-style term weighting (idf × saturated term
 *    frequency, with length normalisation) blended 50/50 with the Dice
 *    coefficient of literal token overlap. This is the "BM25-ish + lexical
 *    overlap" part of the mandate.
 * 2. **Vector** — cosine similarity. When the caller supplies a query
 *    embedding ({@link RankOptions.queryVector}) and the chunk carries an
 *    embedding, dense cosine is used; otherwise TF-IDF term-vector cosine is
 *    computed against the internal {@link RankIndex}.
 * 3. **Recency** — exponential half-life decay of the chunk's `updatedAt`
 *    timestamp, so fresh evidence outranks stale evidence when the caller
 *    weights it.
 * 4. **Authority** — the chunk's authority metadata value scaled into
 *    `[0, 1]`, so trusted sources are preferred when the caller weights it.
 *
 * The four components are merged by the configured {@link RankingWeights}
 * (normalised by total weight) and clamped to `[0, 1]`. Every call to
 * {@link KnowledgeRanker.score} returns a {@link RankScore} with a full
 * {@link ScoreBreakdown} and human-readable `reasons`, so ranking decisions
 * are auditable and explainable.
 *
 * The ranker also exposes the pure primitives it is built from for callers
 * that want to compose their own pipelines: {@link KnowledgeRanker.bm25},
 * {@link KnowledgeRanker.cosine} and {@link KnowledgeRanker.lexicalOverlap}.
 *
 * @module ranking/retrieval
 */

import { RankIndex } from './index.js';
import {
  DEFAULT_TOP_K,
  DEFAULT_THRESHOLD,
  EPSILON,
  authorityOf,
  buildTermVector,
  clampScore,
  cosineEmbedding,
  cosineSimilarity,
  mergeRankingConfig,
  normalizeText,
  timestampOf,
  tokenize,
} from './types.js';
import type {
  Bm25Context,
  ChunkCandidate,
  DocumentVector,
  RankOptions,
  RankScore,
  RankedChunk,
  RankingConfig,
  RankingQuery,
  RankingStats,
  RankingWeights,
  ScoreBreakdown,
  TermVectorLike,
  Timestamp,
  TokenizeOptions,
} from './types.js';

/**
 * The hybrid scoring/ranking engine described in the module documentation.
 *
 * Construct with an optional partial {@link RankingConfig} and an optional
 * {@link RankIndex}. When no index is supplied, a private one is created and
 * can be populated via {@link KnowledgeRanker.registerChunk} /
 * {@link KnowledgeRanker.registerChunks} so TF-IDF cosine and BM25 benefit
 * from real corpus statistics; without a corpus, scoring degrades gracefully
 * to a per-chunk term-frequency model.
 *
 * @example
 * ```ts
 * const ranker = new KnowledgeRanker();
 * ranker.registerChunks(candidates);
 * const ranked = ranker.rank(candidates, { text: 'how does MCP work?', topK: 5 });
 * for (const chunk of ranked) console.log(chunk.rank, chunk.score, chunk.reasons);
 * ```
 */
export class KnowledgeRanker {
  private readonly _config: RankingConfig;
  private readonly _index: RankIndex;
  private readonly _createdAt: Timestamp;
  private _queries = 0;
  private _ranked = 0;
  private _scoreSum = 0;
  private _topScore = 0;
  private _lastQueryAt: Timestamp | null = null;

  /**
   * Construct a ranker.
   *
   * @param config - partial {@link RankingConfig}; omitted fields use the
   *   defaults from {@link mergeRankingConfig}
   * @param index - an optional pre-built {@link RankIndex}; a private one is
   *   created when omitted
   */
  constructor(config?: Partial<RankingConfig>, index?: RankIndex) {
    this._config = mergeRankingConfig(config);
    this._index = index ?? new RankIndex();
    this._createdAt = this._config.now();
  }

  /**
   * The resolved configuration.
   */
  get config(): Readonly<RankingConfig> {
    return this._config;
  }

  /**
   * The backing {@link RankIndex}.
   */
  get index(): RankIndex {
    return this._index;
  }

  /**
   * The effective default weight blend.
   *
   * @returns a defensive copy of the configured {@link RankingWeights}
   */
  weights(): RankingWeights {
    return { ...this._config.weights };
  }

  /**
   * Index a single chunk so the corpus statistics reflect it.
   *
   * @param chunk - the chunk whose text should be indexed
   */
  registerChunk(chunk: ChunkCandidate): void {
    const tokens = this._tokens(chunk.text);
    this._index.indexDocument(chunk.chunkId, tokens);
  }

  /**
   * Index many chunks in one pass.
   *
   * @param chunks - the chunks to index
   * @returns the total number of terms indexed
   */
  registerChunks(chunks: readonly ChunkCandidate[]): number {
    let total = 0;
    for (const chunk of chunks) {
      this.registerChunk(chunk);
      total += this._index.documentLength(chunk.chunkId);
    }
    return total;
  }

  /**
   * Score a single chunk against a query.
   *
   * Produces the blended score from the four weighted components (lexical,
   * vector, recency, authority) plus a full {@link ScoreBreakdown} and the
   * human-readable `reasons`. This is a pure computation: it never mutates the
   * chunk or the index.
   *
   * @param chunk - the candidate chunk to score
   * @param query - the query to score against
   * @param options - per-call overrides (weights, query embedding, clock, …)
   * @returns the {@link RankScore} for the chunk
   */
  score(chunk: ChunkCandidate, query: RankingQuery, options: RankOptions = {}): RankScore {
    const now = options.now ?? this._config.now();
    const weights = { ...this._config.weights, ...options.weights };

    const queryTokens = this._tokens(
      normalizeText(query?.text),
      options.context ? normalizeText(options.context) : undefined,
    );
    const chunkTokens = this._tokens(chunk.text);

    const chunkVector = buildTermVector(chunkTokens);
    const queryVector = buildTermVector(queryTokens);

    // 1. Lexical: BM25-style term weighting, blended 50/50 with Dice overlap.
    const corpus = this._index.bm25Context();
    const bm25Raw = this._bm25Score(queryTokens, chunkVector, corpus);
    const bm25Norm = clampScore(1 - Math.exp(-bm25Raw));
    const overlap = this._dice(queryTokens, chunkTokens);
    const lexical = clampScore(0.5 * bm25Norm + 0.5 * overlap);

    // 2. Vector: embedding cosine when available, else TF-IDF term cosine.
    let vector: number;
    if (
      options.queryVector &&
      chunk.vector &&
      chunk.vector.length > 0 &&
      options.queryVector.length === chunk.vector.length
    ) {
      vector = clampScore(cosineEmbedding(options.queryVector, chunk.vector));
    } else {
      const qVec = this._idfWeighted(queryVector);
      const cVec = this._idfWeighted(chunkVector);
      vector = clampScore(cosineSimilarity(qVec, cVec));
    }

    // 3. Recency: exponential half-life decay of the chunk's updatedAt.
    const updatedAt = timestampOf(chunk.metadata, this._config.recencyField);
    const recency =
      updatedAt === null
        ? 0.5
        : clampScore(Math.exp(-Math.max(0, now - updatedAt) / this._config.recencyHalfLifeMs));

    // 4. Authority: raw authority scaled into [0, 1].
    const authorityRaw = authorityOf(
      chunk.metadata,
      this._config.authorityField,
      this._config.defaultAuthority,
    );
    const authority = clampScore(authorityRaw / this._config.authorityScale);

    const totalWeight =
      weights.lexical + weights.vector + weights.recency + weights.authority;
    const total = clampScore(
      (lexical * weights.lexical +
        vector * weights.vector +
        recency * weights.recency +
        authority * weights.authority) /
        (totalWeight || EPSILON),
    );

    const breakdown: ScoreBreakdown = {
      lexical,
      vector,
      recency,
      authority,
      bm25: bm25Norm,
      overlap,
      total,
    };

    return { score: total, breakdown, reasons: this._buildReasons(breakdown, weights) };
  }

  /**
   * Score and order a pool of chunks against a query.
   *
   * Applies optional source/tag filters from the query, scores every survivor,
   * drops anything below `threshold`, sorts best-first (ties broken by
   * `chunkId` for determinism), assigns one-based `rank`s and truncates to
   * `topK`. Returns a fresh array; the input chunks are never mutated.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param options - per-call overrides (weights, topK, threshold, reasons, …)
   * @returns the ranked chunks, best first
   */
  rank(chunks: readonly ChunkCandidate[], query: RankingQuery, options: RankOptions = {}): RankedChunk[] {
    this._queries += 1;
    this._lastQueryAt = this._config.now();

    const threshold = options.threshold ?? this._config.defaultThreshold;
    const topK = options.topK ?? query?.topK ?? this._config.defaultTopK;
    const includeReasons = options.includeReasons ?? true;

    const candidates = this._filter(chunks, query);
    const scored: RankedChunk[] = [];

    for (const chunk of candidates) {
      const { score, reasons } = this.score(chunk, query, options);
      this._ranked += 1;
      this._scoreSum += score;
      this._topScore = Math.max(this._topScore, score);
      if (score < threshold) {
        continue;
      }
      scored.push({
        ...chunk,
        score,
        rank: undefined,
        reasons: includeReasons ? [...reasons] : undefined,
      });
    }

    scored.sort(
      (a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
    );

    const limited = topK > 0 ? scored.slice(0, topK) : scored;
    return limited.map((chunk, index) => ({ ...chunk, rank: index + 1 }));
  }

  /**
   * Return only the top `topK` results for a query.
   *
   * A thin convenience over {@link KnowledgeRanker.rank} that makes the
   * truncation explicit.
   *
   * @param chunks - the candidate pool
   * @param query - the query to rank against
   * @param topK - the maximum number of results (defaults to the configured
   *   {@link RankingConfig.defaultTopK})
   * @param options - per-call overrides
   * @returns the best `topK` chunks, best first
   */
  best(
    chunks: readonly ChunkCandidate[],
    query: RankingQuery,
    topK?: number,
    options: RankOptions = {},
  ): RankedChunk[] {
    return this.rank(chunks, query, {
      ...options,
      topK: topK ?? options.topK ?? query?.topK ?? this._config.defaultTopK,
    });
  }

  /**
   * The BM25 contribution of a single term against a document.
   *
   * Implements the standard BM25 formula:
   * `idf × (tf·(k1+1)) / (tf + k1·(1 − b + b·dl/avgdl))` with
   * `idf = ln((N − df + 0.5) / (df + 0.5) + 1)`. `k1` and `b` come from the
   * ranker's configuration. This is a pure function usable outside the ranker.
   *
   * @param term - the query term
   * @param doc - the document's term-frequency vector
   * @param corpus - the corpus-level statistics (N, df, avgdl)
   * @returns the BM25 score for the term against the document (≥ 0)
   */
  bm25(term: string, doc: DocumentVector, corpus: Bm25Context): number {
    const tf = doc[term] ?? 0;
    if (tf === 0) {
      return 0;
    }
    const df = corpus.documentFrequency(term);
    const idf = Math.log((corpus.documentCount - df + 0.5) / (df + 0.5) + 1);
    const dl = this._docLength(doc);
    const average = corpus.avgDocumentLength > 0 ? corpus.avgDocumentLength : dl;
    const denominator =
      tf + this._config.bm25K1 * (1 - this._config.bm25B + this._config.bm25B * (dl / average));
    return idf * ((tf * (this._config.bm25K1 + 1)) / (denominator || EPSILON));
  }

  /**
   * Cosine similarity between two term vectors.
   *
   * Delegates to {@link cosineSimilarity}; accepts sparse records or `Map`s.
   *
   * @param a - the first vector
   * @param b - the second vector
   * @returns cosine similarity in `[0, 1]`
   */
  cosine(a: TermVectorLike, b: TermVectorLike): number {
    return cosineSimilarity(a, b);
  }

  /**
   * Literal lexical overlap (Dice coefficient) between two token sets.
   *
   * `2·|A∩B| / (|A| + |B|)`. Returns `0` when either side is empty. This is
   * the pure "lexical overlap" signal blended into the lexical component.
   *
   * @param a - the first token set
   * @param b - the second token set
   * @returns the Dice coefficient in `[0, 1]`
   */
  lexicalOverlap(a: readonly string[], b: readonly string[]): number {
    return this._dice(a, b);
  }

  /**
   * Aggregate statistics for the ranker and its backing index.
   *
   * @returns a {@link RankingStats} snapshot
   */
  stats(): RankingStats {
    const indexStats = this._index.stats();
    return {
      chunks: indexStats.documents,
      documents: indexStats.documents,
      distinctTerms: indexStats.distinctTerms,
      totalTerms: indexStats.totalTokens,
      averageDocumentLength: indexStats.averageDocumentLength,
      cachedQueries: 0,
      queries: this._queries,
      cacheHits: 0,
      cacheMisses: 0,
      ranked: this._ranked,
      pruned: 0,
      swept: 0,
      averageScore: this._ranked === 0 ? 0 : this._scoreSum / this._ranked,
      topScore: this._topScore,
      lastQueryAt: this._lastQueryAt,
      createdAt: this._createdAt,
    };
  }

  /**
   * Apply source/tag filters from a query to a candidate pool.
   *
   * @param chunks - the candidate pool
   * @param query - the query whose filters are applied
   * @returns the surviving candidates
   */
  private _filter(chunks: readonly ChunkCandidate[], query: RankingQuery): ChunkCandidate[] {
    const sourceId = query?.sourceId;
    const tags = query?.tags;
    const mode = query?.tagMode ?? 'all';
    return chunks.filter((chunk) => {
      if (sourceId && chunk.sourceId !== sourceId) {
        return false;
      }
      if (tags && tags.length > 0) {
        const chunkTags = chunk.tags ?? [];
        const hit =
          mode === 'any'
            ? tags.some((tag) => chunkTags.includes(tag))
            : tags.every((tag) => chunkTags.includes(tag));
        if (!hit) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Sum BM25 over the distinct query terms against a document.
   *
   * @param queryTokens - the distinct query terms
   * @param doc - the document's term-frequency vector
   * @param corpus - the corpus-level statistics
   * @returns the aggregate BM25 score (≥ 0)
   */
  private _bm25Score(
    queryTokens: readonly string[],
    doc: DocumentVector,
    corpus: Bm25Context,
  ): number {
    const seen = new Set<string>();
    let score = 0;
    for (const term of queryTokens) {
      if (seen.has(term)) {
        continue;
      }
      seen.add(term);
      score += this.bm25(term, doc, corpus);
    }
    return score;
  }

  /**
   * The Dice coefficient of two token sets.
   *
   * @param a - the first token set
   * @param b - the second token set
   * @returns the coefficient in `[0, 1]`, or `0` when either side is empty
   */
  private _dice(a: readonly string[], b: readonly string[]): number {
    if (a.length === 0 || b.length === 0) {
      return 0;
    }
    const setB = new Set(b);
    let common = 0;
    for (const term of a) {
      if (setB.has(term)) {
        common += 1;
      }
    }
    return (2 * common) / (a.length + b.length);
  }

  /**
   * Re-weight a term-frequency vector by IDF.
   *
   * @param vector - the raw term-frequency vector
   * @returns the TF-IDF-weighted vector
   */
  private _idfWeighted(vector: DocumentVector): DocumentVector {
    const weighted: Record<string, number> = {};
    for (const term of Object.keys(vector)) {
      weighted[term] = vector[term] * this._index.inverseDocumentFrequency(term, this._config.idfSmoothing);
    }
    return weighted;
  }

  /**
   * The total token count of a term-frequency vector.
   *
   * @param doc - the vector to measure
   * @returns the total count
   */
  private _docLength(doc: DocumentVector): number {
    let total = 0;
    for (const term of Object.keys(doc)) {
      total += doc[term];
    }
    return total;
  }

  /**
   * Compose the human-readable explanation lines for a score.
   *
   * @param breakdown - the component breakdown
   * @param weights - the effective weights applied
   * @returns the ordered reason lines
   */
  private _buildReasons(breakdown: ScoreBreakdown, weights: RankingWeights): string[] {
    const line = (label: string, value: number, weight: number): string =>
      `${label}=${value.toFixed(3)} w=${weight}`;
    return [
      line('lexical', breakdown.lexical, weights.lexical) +
        ` (bm25=${breakdown.bm25.toFixed(3)}, overlap=${breakdown.overlap.toFixed(3)})`,
      line('vector', breakdown.vector, weights.vector),
      line('recency', breakdown.recency, weights.recency),
      line('authority', breakdown.authority, weights.authority),
      `total=${breakdown.total.toFixed(3)}`,
    ];
  }

  /**
   * Tokenize a piece of text with the ranker's configured options.
   *
   * @param text - the raw text
   * @param extra - optional additional text whose tokens are appended
   * @returns the distinct normalised terms
   */
  private _tokens(text: string | undefined, extra?: string): string[] {
    const options = this._tokenizeOptions();
    const base = tokenize(text, options);
    if (!extra) {
      return base;
    }
    return [...base, ...tokenize(extra, options)];
  }

  /**
   * The tokenization options derived from the ranker configuration.
   *
   * @returns a {@link TokenizeOptions} bound to this configuration
   */
  private _tokenizeOptions(): TokenizeOptions {
    return {
      stopWords: this._config.stopWords,
      minTokenLength: this._config.minTokenLength,
      caseSensitive: this._config.caseSensitive,
      maxTokens: this._config.maxTokensPerDocument,
    };
  }
}