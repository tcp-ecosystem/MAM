/**
 * Term-frequency / document-frequency index for the Ranking layer of the
 * standalone MAM Knowledge Engine.
 *
 * {@link RankIndex} is the lightweight inverted index that powers the
 * corpus-wide statistics the scoring layer needs:
 *
 * - **Term frequency** — how often a term occurs inside a given document
 *   ({@link RankIndex.termFrequency}).
 * - **Document frequency** — in how many documents a term appears
 *   ({@link RankIndex.documentFrequency}), the raw material of IDF.
 * - **Inverse document frequency** — the rarity-adjusted weight of a term
 *   ({@link RankIndex.inverseDocumentFrequency}).
 * - **Length statistics** — per-document token counts, total tokens and the
 *   average document length ({@link RankIndex.avgDocumentLength}) required by
 *   BM25's length normalisation.
 * - **Vectors** — {@link RankIndex.vectorize} turns a document into a sparse
 *   TF-IDF vector suitable for cosine similarity.
 * - **Context** — {@link RankIndex.bm25Context} packages the corpus-level
 *   numbers BM25 needs into a {@link Bm25Context} value object.
 *
 * The index is a *postings list*: a map from term → (docId → term frequency).
 * Insertion is incremental via {@link RankIndex.indexTerm} (the primitive) or
 * {@link RankIndex.indexDocument} (a convenience that tokenizes on demand).
 * The whole corpus can be replaced atomically with {@link RankIndex.rebuild},
 * cleared with {@link RankIndex.clear}, snapshotted with
 * {@link RankIndex.toJSON} / {@link RankIndex.fromJSON} and inspected with
 * {@link RankIndex.stats}.
 *
 * The implementation is deliberately dependency-free and deterministic:
 * identical input documents always produce an identical index, which keeps
 * scoring reproducible across processes. All lookups are O(1)-ish map reads
 * once built, making repeated scoring passes cheap.
 *
 * @module ranking/index
 */

import {
  EPSILON,
  tokenize,
} from './types.js';
import type {
  Bm25Context,
  DocumentVector,
  TokenizeOptions,
} from './types.js';

/**
 * A document ready for indexing.
 *
 * Supply either pre-tokenized `terms` or raw `text` (which is tokenized on
 * ingestion using `tokenizeOptions`). `docId` is the document's unique
 * identifier — typically the chunk id.
 */
export interface IndexedDocument {
  /**
   * Unique identifier of the document (usually the chunk id).
   */
  readonly docId: string;

  /**
   * Pre-tokenized terms. When supplied, `text` is ignored.
   */
  readonly terms?: readonly string[];

  /**
   * Raw text, tokenized on ingestion when `terms` is absent.
   */
  readonly text?: string;

  /**
   * Tokenization options used when `text` is provided.
   */
  readonly tokenizeOptions?: TokenizeOptions;
}

/**
 * Live statistics describing a {@link RankIndex}.
 */
export interface RankIndexStats {
  /**
   * Number of documents in the index.
   */
  readonly documents: number;

  /**
   * Number of distinct terms in the vocabulary.
   */
  readonly distinctTerms: number;

  /**
   * Total number of term occurrences across all documents.
   */
  readonly totalTokens: number;

  /**
   * Mean document length (in tokens).
   */
  readonly averageDocumentLength: number;

  /**
   * Shortest document (in tokens).
   */
  readonly minDocumentLength: number;

  /**
   * Longest document (in tokens).
   */
  readonly maxDocumentLength: number;

  /**
   * Median document length (in tokens).
   */
  readonly medianDocumentLength: number;

  /**
   * A small sample of the vocabulary, useful for debugging and health checks.
   */
  readonly vocabularySample: readonly string[];
}

/**
 * JSON-serialisable snapshot of a {@link RankIndex} produced by
 * {@link RankIndex.toJSON} and consumed by {@link RankIndex.fromJSON}.
 */
export interface RankIndexJSON {
  /**
   * Format version for forward-compatible migrations.
   */
  readonly version: number;

  /**
   * The postings list: term → [(docId, termFrequency)].
   */
  readonly postings: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, number]>]>;

  /**
   * Per-document token counts: (docId, length).
   */
  readonly docLengths: ReadonlyArray<readonly [string, number]>;

  /**
   * Total number of term occurrences across the corpus.
   */
  readonly totalTokens: number;
}

/**
 * A lightweight inverted index of term and document statistics.
 *
 * See the module documentation for a full walkthrough. The index is a pure
 * data structure: it never scores queries, it just answers statistical
 * questions about the corpus so that {@link KnowledgeRanker} can compute
 * BM25, IDF and cosine components.
 *
 * @example
 * ```ts
 * const index = new RankIndex();
 * index.indexDocument('doc-a', 'the quick brown fox jumps');
 * index.indexTerm('fox', 'doc-b');
 * index.documentFrequency('fox'); // 2
 * index.inverseDocumentFrequency('fox'); // ~0.69 for N=2, df=2
 * index.avgDocumentLength(); // 2.5
 * ```
 */
export class RankIndex {
  /** term → (docId → termFrequency). */
  private readonly _postings: Map<string, Map<string, number>> = new Map();

  /** docId → total token count. */
  private readonly _docLengths: Map<string, number> = new Map();

  /** The set of known document ids. */
  private readonly _documents: Set<string> = new Set();

  /** Total term occurrences across the corpus. */
  private _totalTokens = 0;

  /** Epoch-millisecond time the index was constructed. */
  private readonly _createdAt = Date.now();

  /**
   * Index a single term occurrence against a document.
   *
   * This is the primitive every other ingestion path builds on: it increments
   * the term's frequency for `docId`, records the document as known, bumps the
   * document's length and the corpus token count. Repeated calls with the same
   * `(term, docId)` pair accumulate frequency.
   *
   * @param term - the normalised term
   * @param docId - the document (usually chunk) identifier
   * @returns the new term frequency for `docId`
   */
  indexTerm(term: string, docId: string): number {
    if (!term) {
      return 0;
    }
    let postings = this._postings.get(term);
    if (!postings) {
      postings = new Map();
      this._postings.set(term, postings);
    }
    const tf = (postings.get(docId) ?? 0) + 1;
    postings.set(docId, tf);
    this._documents.add(docId);
    this._docLengths.set(docId, (this._docLengths.get(docId) ?? 0) + 1);
    this._totalTokens += 1;
    return tf;
  }

  /**
   * Index a whole document in one call.
   *
   * Accepts pre-tokenized terms or raw text (tokenized on ingestion). Returns
   * the number of terms indexed.
   *
   * @param docId - the document identifier
   * @param termsOrText - pre-tokenized terms, or raw text to tokenize
   * @param options - tokenization options used when text is supplied
   * @returns the number of terms indexed
   */
  indexDocument(
    docId: string,
    termsOrText: readonly string[] | string,
    options?: TokenizeOptions,
  ): number {
    const terms =
      typeof termsOrText === 'string' ? tokenize(termsOrText, options) : termsOrText;
    for (const term of terms) {
      this.indexTerm(term, docId);
    }
    return terms.length;
  }

  /**
   * The raw term frequency of `term` inside `docId`.
   *
   * @param term - the term to look up
   * @param docId - the document to look up
   * @returns the raw frequency, or `0` when absent
   */
  termFrequency(term: string, docId: string): number {
    return this._postings.get(term)?.get(docId) ?? 0;
  }

  /**
   * The number of documents containing `term`.
   *
   * @param term - the term to look up
   * @returns the document frequency, or `0` when the term is unseen
   */
  documentFrequency(term: string): number {
    return this._postings.get(term)?.size ?? 0;
  }

  /**
   * The inverse document frequency of `term`.
   *
   * Uses the BM25-style IDF variant:
   * `ln((N − df + smoothing) / (df + smoothing) + 1)`, which stays positive for
   * every `df < N` and converges to `0` as a term becomes ubiquitous.
   *
   * @param term - the term to weight
   * @param smoothing - the smoothing applied to both sides of the ratio
   *   (defaults to `0.5`, i.e. the standard BM25 floor)
   * @returns the IDF weight, or `ln(N + 1)` for an unseen term
   */
  inverseDocumentFrequency(term: string, smoothing = 0.5): number {
    const n = this._documents.size;
    const df = this.documentFrequency(term);
    return Math.log((n - df + smoothing) / (df + smoothing) + 1);
  }

  /**
   * The number of documents currently indexed.
   *
   * @returns the document count
   */
  documentCount(): number {
    return this._documents.size;
  }

  /**
   * The total number of term occurrences across the corpus.
   *
   * @returns the corpus token total
   */
  totalTokens(): number {
    return this._totalTokens;
  }

  /**
   * The token length of a single document.
   *
   * @param docId - the document to measure
   * @returns the length, or `0` for an unknown document
   */
  documentLength(docId: string): number {
    return this._docLengths.get(docId) ?? 0;
  }

  /**
   * The mean document length in tokens.
   *
   * @returns the average length, or `0` for an empty corpus
   */
  avgDocumentLength(): number {
    const n = this._documents.size;
    return n === 0 ? 0 : this._totalTokens / n;
  }

  /**
   * Alias of {@link RankIndex.avgDocumentLength} with a longer, unambiguous
   * name.
   *
   * @returns the mean document length in tokens
   */
  averageDocumentLength(): number {
    return this.avgDocumentLength();
  }

  /**
   * All document ids currently indexed.
   *
   * @returns the document ids, in insertion order
   */
  documents(): string[] {
    return [...this._documents];
  }

  /**
   * All terms in the vocabulary.
   *
   * @returns the terms, in insertion order
   */
  terms(): string[] {
    return [...this._postings.keys()];
  }

  /**
   * Alias of {@link RankIndex.terms}.
   *
   * @returns the terms, in insertion order
   */
  vocabulary(): string[] {
    return this.terms();
  }

  /**
   * The TF-IDF weight of `term` in `docId`.
   *
   * @param term - the term to weight
   * @param docId - the document to weight within
   * @returns `tf × idf`, or `0` when the term is absent from the document
   */
  tfidf(term: string, docId: string): number {
    const tf = this.termFrequency(term, docId);
    if (tf === 0) {
      return 0;
    }
    return tf * this.inverseDocumentFrequency(term);
  }

  /**
   * Build the sparse TF-IDF vector for a document.
   *
   * Every term present in the document contributes `tf × idf`, so common terms
   * are down-weighted and rare, distinctive terms dominate. The result is
   * directly consumable by {@link cosineSimilarity}.
   *
   * @param docId - the document to vectorize
   * @returns the TF-IDF term vector (empty for unknown documents)
   */
  vectorize(docId: string): DocumentVector {
    const vector: Record<string, number> = {};
    for (const [term, postings] of this._postings) {
      const tf = postings.get(docId);
      if (tf) {
        vector[term] = tf * this.inverseDocumentFrequency(term);
      }
    }
    return vector;
  }

  /**
   * Cosine similarity between two indexed documents.
   *
   * Convenience wrapper over {@link vectorize} + {@link cosineSimilarity}.
   *
   * @param a - the first document id
   * @param b - the second document id
   * @returns cosine similarity in `[0, 1]`
   */
  similarity(a: string, b: string): number {
    const va = this.vectorize(a);
    const vb = this.vectorize(b);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const term of Object.keys(va)) {
      const w = va[term];
      normA += w * w;
      const other = vb[term];
      if (other !== undefined) {
        dot += w * other;
      }
    }
    for (const term of Object.keys(vb)) {
      normB += vb[term] * vb[term];
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Atomically replace the entire index with a new document set.
   *
   * Accepts an array of {@link IndexedDocument}s or a `Map` of
   * `docId → text|terms`. The previous contents are dropped first, so a call
   * to `rebuild` is the standard way to re-index a changed corpus.
   *
   * @param documents - the new corpus
   */
  rebuild(
    documents: readonly IndexedDocument[] | ReadonlyMap<string, string | readonly string[]>,
  ): void {
    this.clear();
    if (documents instanceof Map) {
      for (const [docId, value] of documents) {
        this.indexDocument(docId, value);
      }
      return;
    }
    const docs = documents as readonly IndexedDocument[];
    for (const doc of docs) {
      if (doc.terms) {
        this.indexDocument(doc.docId, doc.terms, doc.tokenizeOptions);
      } else if (doc.text !== undefined) {
        this.indexDocument(doc.docId, doc.text, doc.tokenizeOptions);
      }
    }
  }

  /**
   * Remove every term, document and counter from the index.
   */
  clear(): void {
    this._postings.clear();
    this._docLengths.clear();
    this._documents.clear();
    this._totalTokens = 0;
  }

  /**
   * Package the corpus-level statistics BM25 needs into a {@link Bm25Context}.
   *
   * The returned context captures the *current* document count and average
   * length, and closes over this index so `documentFrequency` always reflects
   * live state.
   *
   * @returns a BM25 context bound to this index
   */
  bm25Context(): Bm25Context {
    const index = this;
    return {
      documentCount: index.documentCount(),
      documentFrequency: (term: string) => index.documentFrequency(term),
      avgDocumentLength: index.avgDocumentLength(),
    };
  }

  /**
   * Compute live statistics for the index.
   *
   * @returns a {@link RankIndexStats} snapshot
   */
  stats(): RankIndexStats {
    const lengths = [...this._docLengths.values()].sort((a, b) => a - b);
    const n = lengths.length;
    const total = lengths.reduce((sum, value) => sum + value, 0);
    const median =
      n === 0
        ? 0
        : n % 2 === 1
          ? lengths[(n - 1) / 2]
          : (lengths[n / 2 - 1] + lengths[n / 2]) / 2;
    return {
      documents: n,
      distinctTerms: this._postings.size,
      totalTokens: this._totalTokens,
      averageDocumentLength: n === 0 ? 0 : total / n,
      minDocumentLength: n === 0 ? 0 : lengths[0],
      maxDocumentLength: n === 0 ? 0 : lengths[n - 1],
      medianDocumentLength: median,
      vocabularySample: [...this._postings.keys()].slice(0, 25),
    };
  }

  /**
   * Serialise the index to plain JSON.
   *
   * Postings and per-document lengths are flattened into tuple arrays that
   * round-trip through {@link RankIndex.fromJSON} without loss.
   *
   * @returns a JSON-serialisable snapshot
   */
  toJSON(): RankIndexJSON {
    const postings: Array<RankIndexJSON['postings'][number]> = [];
    for (const [term, docMap] of this._postings) {
      postings.push([term, [...docMap.entries()]]);
    }
    return {
      version: 1,
      postings,
      docLengths: [...this._docLengths.entries()],
      totalTokens: this._totalTokens,
    };
  }

  /**
   * Restore an index from a {@link RankIndexJSON} snapshot.
   *
   * @param json - the snapshot produced by {@link RankIndex.toJSON}
   * @returns a new index populated with the snapshot's data
   */
  static fromJSON(json: RankIndexJSON): RankIndex {
    const index = new RankIndex();
    index.load(json);
    return index;
  }

  /**
   * Load a snapshot into this index, replacing its current contents.
   *
   * @param json - the snapshot produced by {@link RankIndex.toJSON}
   */
  load(json: RankIndexJSON): void {
    this.clear();
    for (const [term, pairs] of json?.postings ?? []) {
      const docMap = new Map<string, number>(pairs);
      this._postings.set(term, docMap);
      for (const [docId] of pairs) {
        this._documents.add(docId);
      }
    }
    for (const [docId, length] of json?.docLengths ?? []) {
      this._docLengths.set(docId, length);
    }
    this._totalTokens = json?.totalTokens ?? 0;
  }

  /**
   * The largest IDF-weighted cosine the index can attribute to a term —
   * exposed for callers that want to normalise raw TF-IDF cosine scores.
   *
   * @returns a conservative upper bound estimate, or {@link EPSILON} when the
   *   corpus is empty
   */
  maxIdfEstimate(): number {
    const n = this._documents.size;
    if (n === 0) {
      return EPSILON;
    }
    return Math.log(n + 1);
  }
}