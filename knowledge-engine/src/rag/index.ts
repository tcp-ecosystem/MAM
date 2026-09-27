/**
 * Source-to-context index for the RAG layer.
 *
 * The {@link RagIndex} answers provenance questions the RAG layer needs to ask
 * cheaply and repeatedly:
 *
 * - *"which pieces belong to this source?"* — {@link RagIndex.findBySource}.
 * - *"which pieces overlap this query?"* — {@link RagIndex.findByQuery}, a
 *   lightweight term-overlap scorer used when no external source function is
 *   injected into the retriever.
 * - *"which sources were seen for this query before?"* —
 *   {@link RagIndex.indexQuery}, which records query→source associations so a
 *   repeated query can be answered from a narrow, previously-cited set.
 *
 * The index is an inverted structure: pieces are stored by id, cross-indexed by
 * source, and tokenized into a term→piece-id inverted map. It is fully
 * incremental ({@link RagIndex.indexPiece} adds a single piece) or bulk
 * ({@link RagIndex.rebuild} swaps the whole corpus), and it is JSON-free by
 * design — it holds only in-memory references, so it never serialises.
 *
 * @packageDocumentation
 * @module rag/index
 */

import {
  countTokens,
  normalizeText,
  sortPiecesByScore,
  type RagPiece,
} from './types.js';

/**
 * Statistics specific to a {@link RagIndex}.
 *
 * Extends the shared counters with corpus-derived shape descriptors.
 */
export interface RagIndexStats {
  /**
   * Number of pieces currently indexed.
   */
  readonly pieces: number;

  /**
   * Number of distinct source ids represented by the pieces.
   */
  readonly sources: number;

  /**
   * Number of distinct terms in the inverted vocabulary.
   */
  readonly distinctTerms: number;

  /**
   * Total number of terms across all indexed pieces.
   */
  readonly totalTerms: number;

  /**
   * Average piece text length in code units.
   */
  readonly averagePieceLength: number;

  /**
   * Number of query→source associations recorded via
   * {@link RagIndex.indexQuery}.
   */
  readonly queries: number;

  /**
   * Epoch-millisecond time the index was constructed.
   */
  readonly createdAt: number;
}

/**
 * Options accepted by the {@link RagIndex} constructor.
 */
export interface RagIndexOptions {
  /**
   * Optional clock used instead of `Date.now()` for the creation timestamp.
   */
  readonly now?: () => number;
}

/**
 * A scored hit returned by {@link RagIndex.findByQuery}.
 */
export interface RagIndexHit {
  /**
   * The matching piece.
   */
  readonly piece: RagPiece;

  /**
   * Number of distinct query terms found in the piece's text.
   */
  readonly overlap: number;
}

/**
 * Minimum token length for a term to enter the inverted index. Guards against
 * single-character noise terms.
 */
export const MIN_TERM_LENGTH = 2;

/**
 * A small default stop-word list removed during tokenization. Supplying your
 * own list via {@link RagIndexOptions} is not supported — this list is tuned
 * for general English knowledge text and is deliberately conservative.
 */
export const DEFAULT_STOP_WORDS: readonly string[] = [
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'on',
  'at',
  'to',
  'for',
  'with',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'as',
  'by',
  'from',
  'into',
  'what',
  'which',
  'who',
  'whom',
  'how',
  'when',
  'where',
  'why',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'can',
  'could',
  'will',
  'would',
  'should',
  'may',
  'might',
  'must',
];

/**
 * A source-to-context index.
 *
 * @example
 * ```ts
 * const index = new RagIndex();
 * index.indexPiece(pieceA);
 * index.indexPiece(pieceB);
 * index.indexQuery('how do I migrate?', ['manual', 'faq']);
 * const fromManual = index.findBySource('manual');
 * const candidates = index.findByQuery('how do I migrate?');
 * ```
 */
export class RagIndex {
  private readonly _pieces: Map<string, RagPiece>;
  private readonly _bySource: Map<string, Set<string>>;
  private readonly _terms: Map<string, Set<string>>;
  private readonly _querySources: Map<string, Set<string>>;
  private readonly _stopWords: ReadonlySet<string>;
  private readonly _now: () => number;
  private readonly _createdAt: number;
  private _queries: number;
  private _totalTerms: number;

  /**
   * Construct a new, empty index.
   *
   * @param options - clock and stop-word configuration
   */
  constructor(options: RagIndexOptions = {}) {
    this._now = options.now ?? Date.now;
    this._createdAt = this._now();
    this._pieces = new Map();
    this._bySource = new Map();
    this._terms = new Map();
    this._querySources = new Map();
    this._stopWords = new Set(DEFAULT_STOP_WORDS);
    this._queries = 0;
    this._totalTerms = 0;
  }

  /**
   * Index a single piece.
   *
   * Re-indexing a piece with an existing id replaces the previous record
   * wholesale: its source mapping and term entries are removed first, then the
   * piece is inserted fresh. This keeps the inverted structures consistent
   * even when a piece's text or source changes.
   *
   * @param piece - the piece to index
   * @returns the index, for chaining
   */
  indexPiece(piece: RagPiece): this {
    if (this._pieces.has(piece.id)) {
      this._removePieceId(piece.id);
    }
    this._pieces.set(piece.id, piece);
    this._addToSource(piece.sourceId, piece.id);
    const terms = this._tokenize(piece.text);
    for (const term of terms) {
      this._addTerm(term, piece.id);
      this._totalTerms += 1;
    }
    return this;
  }

  /**
   * Record which sources were cited for a query.
   *
   * The query is normalised and stored under its canonical key; future calls
   * to {@link RagIndex.findByQuery} with the same text can use the association
   * to boost (or narrow to) the previously-cited sources.
   *
   * @param query - the raw query text
   * @param sources - the source ids cited for that query
   * @returns the index, for chaining
   */
  indexQuery(query: string, sources: readonly string[]): this {
    if (!query || sources.length === 0) {
      return this;
    }
    const key = normalizeText(query);
    let entry = this._querySources.get(key);
    if (!entry) {
      entry = new Set();
      this._querySources.set(key, entry);
      this._queries += 1;
    }
    for (const source of sources) {
      entry.add(source);
    }
    return this;
  }

  /**
   * Remove a query→source association.
   *
   * @param query - the raw query text whose association should be dropped
   * @returns `true` when an association existed and was removed
   */
  removeQuery(query: string): boolean {
    const key = normalizeText(query);
    if (!this._querySources.has(key)) {
      return false;
    }
    this._querySources.delete(key);
    this._queries = Math.max(0, this._queries - 1);
    return true;
  }

  /**
   * Find all pieces belonging to a source, best-first.
   *
   * @param sourceId - the source id to look up
   * @returns the source's pieces sorted by descending score
   */
  findBySource(sourceId: string): RagPiece[] {
    const ids = this._bySource.get(sourceId);
    if (!ids || ids.size === 0) {
      return [];
    }
    const pieces: RagPiece[] = [];
    for (const id of ids) {
      const piece = this._pieces.get(id);
      if (piece) {
        pieces.push(piece);
      }
    }
    return sortPiecesByScore(pieces);
  }

  /**
   * Find pieces that overlap a query, best-first.
   *
   * Tokenizes the query and scores each indexed piece by the number of distinct
   * query terms its text contains. Pieces whose source was previously
   * associated with this query (via {@link RagIndex.indexQuery}) get a small
   * boost to their effective overlap, favouring historically-cited sources.
   *
   * @param query - the raw query text
   * @param limit - maximum number of hits to return; `0`/absent is unbounded
   * @returns the matching pieces sorted by descending overlap
   */
  findByQuery(query: string, limit = 0): RagPiece[] {
    const terms = this._tokenize(query);
    if (terms.length === 0) {
      return [];
    }
    const scores = new Map<string, number>();
    for (const term of terms) {
      const ids = this._terms.get(term);
      if (!ids) {
        continue;
      }
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }
    const boostSources = this._querySources.get(normalizeText(query));
    if (boostSources && boostSources.size > 0) {
      for (const sourceId of boostSources) {
        const ids = this._bySource.get(sourceId);
        if (!ids) {
          continue;
        }
        for (const id of ids) {
          if (scores.has(id)) {
            scores.set(id, (scores.get(id) ?? 0) + 0.5);
          }
        }
      }
    }
    const hits: RagIndexHit[] = [];
    for (const [id, overlap] of scores) {
      const piece = this._pieces.get(id);
      if (piece) {
        hits.push({ piece, overlap });
      }
    }
    hits.sort((a, b) => b.overlap - a.overlap);
    if (limit > 0) {
      return hits.slice(0, limit).map((hit) => hit.piece);
    }
    return hits.map((hit) => hit.piece);
  }

  /**
   * Return the full overlap scoring for a query (diagnostics).
   *
   * @param query - the raw query text
   * @returns scored hits, best-first
   */
  scoreQuery(query: string): RagIndexHit[] {
    const terms = this._tokenize(query);
    const scores = new Map<string, number>();
    for (const term of terms) {
      const ids = this._terms.get(term);
      if (!ids) {
        continue;
      }
      for (const id of ids) {
        scores.set(id, (scores.get(id) ?? 0) + 1);
      }
    }
    const hits: RagIndexHit[] = [];
    for (const [id, overlap] of scores) {
      const piece = this._pieces.get(id);
      if (piece) {
        hits.push({ piece, overlap });
      }
    }
    hits.sort((a, b) => b.overlap - a.overlap);
    return hits;
  }

  /**
   * Replace the entire index with a new piece corpus.
   *
   * @param pieces - the pieces to index
   * @returns the number of pieces indexed
   */
  rebuild(pieces: readonly RagPiece[]): number {
    this.clear();
    for (const piece of pieces) {
      this.indexPiece(piece);
    }
    return pieces.length;
  }

  /**
   * Remove a single piece from the index.
   *
   * @param id - the piece id to remove
   * @returns `true` when the piece was present and removed
   */
  removePiece(id: string): boolean {
    if (!this._pieces.has(id)) {
      return false;
    }
    this._removePieceId(id);
    return true;
  }

  /**
   * Test whether a piece id is indexed.
   *
   * @param id - the piece id
   * @returns `true` when the piece is present
   */
  has(id: string): boolean {
    return this._pieces.has(id);
  }

  /**
   * Fetch a piece by id.
   *
   * @param id - the piece id
   * @returns the piece, or `undefined`
   */
  piece(id: string): RagPiece | undefined {
    return this._pieces.get(id);
  }

  /**
   * Distinct source ids represented by the indexed pieces.
   *
   * @returns the source ids
   */
  sources(): string[] {
    return [...this._bySource.keys()];
  }

  /**
   * Remove every piece, term entry and query association.
   *
   * @returns the number of pieces cleared
   */
  clear(): number {
    const cleared = this._pieces.size;
    this._pieces.clear();
    this._bySource.clear();
    this._terms.clear();
    this._querySources.clear();
    this._queries = 0;
    this._totalTerms = 0;
    return cleared;
  }

  /**
   * Aggregate statistics for the index.
   *
   * @returns a {@link RagIndexStats} snapshot
   */
  stats(): RagIndexStats {
    const pieceCount = this._pieces.size;
    let totalLength = 0;
    for (const piece of this._pieces.values()) {
      totalLength += piece.text.length;
    }
    return {
      pieces: pieceCount,
      sources: this._bySource.size,
      distinctTerms: this._terms.size,
      totalTerms: this._totalTerms,
      averagePieceLength: pieceCount === 0 ? 0 : totalLength / pieceCount,
      queries: this._queries,
      createdAt: this._createdAt,
    };
  }

  /**
   * Tokenize text into normalised, stop-word-filtered terms.
   *
   * Terms are lower-cased, collapsed, trimmed, filtered to a minimum length
   * and stop-word-free, and de-duplicated.
   *
   * @param text - the raw text
   * @returns the distinct terms
   */
  private _tokenize(text: string): string[] {
    const normalised = normalizeText(text);
    if (!normalised) {
      return [];
    }
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const raw of normalised.split(/\s+/)) {
      if (raw.length < MIN_TERM_LENGTH || this._stopWords.has(raw)) {
        continue;
      }
      if (!seen.has(raw)) {
        seen.add(raw);
        terms.push(raw);
      }
    }
    return terms;
  }

  /**
   * Add a piece id to a source bucket.
   *
   * @param sourceId - the source id
   * @param pieceId - the piece id
   */
  private _addToSource(sourceId: string, pieceId: string): void {
    let bucket = this._bySource.get(sourceId);
    if (!bucket) {
      bucket = new Set();
      this._bySource.set(sourceId, bucket);
    }
    bucket.add(pieceId);
  }

  /**
   * Add a piece id to a term's posting list.
   *
   * @param term - the normalised term
   * @param pieceId - the piece id
   */
  private _addTerm(term: string, pieceId: string): void {
    let postings = this._terms.get(term);
    if (!postings) {
      postings = new Set();
      this._terms.set(term, postings);
    }
    postings.add(pieceId);
  }

  /**
   * Fully detach a piece id from every inverted structure.
   *
   * Used when a piece is re-indexed or removed. Also removes the source bucket
   * once it becomes empty, so `sources()` never reports ghost sources.
   *
   * @param pieceId - the piece id to detach
   */
  private _removePieceId(pieceId: string): void {
    const piece = this._pieces.get(pieceId);
    this._pieces.delete(pieceId);
    if (piece) {
      const bucket = this._bySource.get(piece.sourceId);
      if (bucket) {
        bucket.delete(pieceId);
        if (bucket.size === 0) {
          this._bySource.delete(piece.sourceId);
        }
      }
      const terms = this._tokenize(piece.text);
      for (const term of terms) {
        const postings = this._terms.get(term);
        if (postings) {
          postings.delete(pieceId);
          this._totalTerms = Math.max(0, this._totalTerms - 1);
          if (postings.size === 0) {
            this._terms.delete(term);
          }
        }
      }
    }
  }

  /**
   * Total term count across all indexed pieces (diagnostics).
   *
   * @returns the sum of {@link countTokens} over indexed pieces
   */
  tokenFootprint(): number {
    let total = 0;
    for (const piece of this._pieces.values()) {
      total += countTokens(piece.text);
    }
    return total;
  }

  /**
   * Describe the index in one line (useful for logs).
   *
   * @returns a short human-readable description
   */
  describe(): string {
    const s = this.stats();
    return (
      `RagIndex{pieces=${s.pieces}, sources=${s.sources}, ` +
      `terms=${s.distinctTerms}, queries=${s.queries}}`
    );
  }
}