/**
 * RetrievalIndex — tokenizer, TF-IDF vector builder and inverted term index for
 * the Retrieval layer of the standalone MAM Knowledge Engine.
 *
 * This module is where the corpus becomes *searchable*. It is responsible for
 * the three mechanical operations that every retriever depends on:
 *
 * 1. **Tokenization** — turning free text into a list of clean, comparable
 *    terms: lower-casing (unless case matters), stripping punctuation,
 *    discarding stop-words and dropping tokens shorter than a configurable
 *    minimum length.
 * 2. **Vector building** — converting a document (or a query) into a sparse
 *    term→count {@link DocumentVector}, optionally with sub-linear TF
 *    normalisation, and combining that with IDF weights to produce TF-IDF
 *    vectors for cosine scoring.
 * 3. **The inverted index** — a term→{document→frequency} postings map so
 *    {@link KnowledgeRetriever} can look up which chunks contain which terms
 *    without scanning every document, compute document frequencies for IDF,
 *    and rebuild or clear the corpus in bulk.
 *
 * The class is fully deterministic given the same configuration and input:
 * the same text always yields the same vector, and the same corpus always
 * yields the same vocabulary and document frequencies. That property makes it
 * trivial to snapshot (via `toJSON`) and restore (via `fromJSON`) a complete
 * index.
 *
 * Score maths used throughout:
 *
 * - Sub-linear TF (when enabled): `tf = 1 + ln(rawCount)`.
 * - Smoothed IDF: `idf(term) = ln(1 + N / (1 + df))` where `N` is the number
 *   of indexed documents and `df` the number containing the term.
 * - Cosine similarity between weighted vectors:
 *   `dot(a, b) / (|a| · |b|)`.
 *
 * @packageDocumentation
 * @module retrieval/index
 */

import { normalizeText } from './types.js';
import type {
  DocumentVector,
  RetrievalConfig,
  Timestamp,
} from './types.js';

/**
 * The built-in English stop-word list used when the caller supplies none.
 *
 * Keeping this list deliberately small and common-word focused means genuine
 * corpus terms are never accidentally dropped; it only removes the words that
 * carry essentially no retrieval signal in English-language prose.
 */
export const DEFAULT_STOP_WORDS: readonly string[] = [
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'when',
  'while',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'by',
  'at',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'he',
  'she',
  'we',
  'they',
  'them',
  'his',
  'her',
  'their',
  'our',
  'your',
  'my',
  'me',
  'us',
  'not',
  'no',
  'so',
  'too',
  'very',
  'can',
  'will',
  'just',
  'do',
  'does',
  'did',
  'had',
  'has',
  'have',
  'what',
  'which',
  'who',
  'whom',
  'about',
  'into',
  'over',
  'under',
  'again',
  'more',
  'most',
  'some',
  'any',
  'such',
  'only',
  'own',
  'same',
  'than',
  'up',
  'down',
  'out',
  'off',
  'also',
  'like',
  'each',
  'both',
];

/**
 * Default minimum token length in code units (shorter tokens are dropped).
 */
export const DEFAULT_MIN_TOKEN_LENGTH = 2;

/**
 * Description of a document to index.
 *
 * Either `text` or `vector` (or both) may be supplied. When `text` is given
 * the tokenizer derives the term counts; when only `vector` is given those
 * counts are used verbatim.
 */
export interface IndexEntryInput {
  /** Document/chunk identifier used as the index key. */
  readonly id: string;
  /** Optional free text to tokenize into term counts. */
  readonly text?: string;
  /** Optional precomputed term→count vector. */
  readonly vector?: DocumentVector;
}

/**
 * On-demand statistics describing the current index state.
 */
export interface IndexStats {
  /** Number of documents currently indexed. */
  readonly documents: number;
  /** Number of distinct terms in the corpus vocabulary. */
  readonly distinctTerms: number;
  /** Total number of term occurrences across all indexed documents. */
  readonly totalTerms: number;
  /** Mean document length (term count) across the corpus. */
  readonly averageDocumentLength: number;
  /** Minimum token length configured for the tokenizer. */
  readonly minTokenLength: number;
  /** Whether sub-linear TF normalisation is enabled. */
  readonly sublinearTf: boolean;
  /** Epoch-ms time the index was constructed. */
  readonly createdAt: Timestamp;
}

/**
 * A JSON-safe snapshot of the whole index, for persistence and restore.
 */
export interface IndexSnapshot {
  /** Snapshot format version. */
  readonly version: number;
  /** Epoch-ms time the snapshot was taken. */
  readonly createdAt: Timestamp;
  /** Per-document raw term counts (id → vector). */
  readonly documents: Readonly<Record<string, DocumentVector>>;
}

/**
 * Tokenizer + TF-IDF vector builder + inverted term index.
 *
 * Owns no chunks — only term statistics — so it can be shared by multiple
 * retrievers or rebuilt independently of the chunk store.
 *
 * @example
 * ```ts
 * const index = new RetrievalIndex();
 * index.indexText('doc-1', 'Always back up before migrating.');
 * index.indexText('doc-2', 'Migrate after a full backup.');
 * index.idf('backup'); // > 0, appears in both docs
 * index.vocabulary();  // ['backup', 'migrating', 'migrate', ...]
 * index.computeVector('backup').backup; // 1
 * ```
 */
export class RetrievalIndex {
  /** Per-document raw term counts: id → {@link DocumentVector}. */
  private readonly documents = new Map<string, DocumentVector>();

  /**
   * Inverted index: term → (document id → term frequency).
   *
   * This is the classic postings structure that makes term lookup O(1) per
   * term instead of a full corpus scan.
   */
  private readonly postings = new Map<string, Map<string, number>>();

  /** Total term count per document: id → total terms. */
  private readonly docLengths = new Map<string, number>();

  /** Sub-linear TF normalisation (`1 + ln(tf)`), default `true`. */
  private readonly sublinearTf: boolean;

  /** Case-sensitive tokenization, default `false`. */
  private readonly caseSensitive: boolean;

  /** Stop-words removed during tokenization. */
  private readonly stopWords: ReadonlySet<string>;

  /** Minimum token length in code units, default `2`. */
  private readonly minTokenLength: number;

  /** Maximum tokens kept per document; `0` disables the cap. */
  private readonly maxTokensPerDocument: number;

  /** Epoch-ms time the index was constructed. */
  private readonly createdAt: Timestamp;

  /**
   * Construct an index with the given configuration.
   *
   * @param config - tokenizer/scoring options (all optional; see
   *   {@link RetrievalConfig})
   */
  constructor(config: RetrievalConfig = {}) {
    this.sublinearTf = config.sublinearTf !== false;
    this.caseSensitive = config.caseSensitive === true;
    this.stopWords = new Set(
      config.stopWords ?? DEFAULT_STOP_WORDS,
    );
    this.minTokenLength = config.minTokenLength ?? DEFAULT_MIN_TOKEN_LENGTH;
    this.maxTokensPerDocument = config.maxTokensPerDocument ?? 0;
    this.createdAt = config.now?.() ?? Date.now();
  }

  /**
   * Tokenize free text into a list of comparable terms.
   *
   * The pipeline is: normalise whitespace → (optionally) lower-case → split on
   * non-alphanumeric runs → drop stop-words → drop tokens shorter than
   * {@link RetrievalConfig.minTokenLength} → (optionally) cap the count.
   *
   * @param text - the raw text
   * @returns the surviving terms, in order of appearance
   */
  tokenize(text: string): string[] {
    if (!text) {
      return [];
    }
    const source = this.caseSensitive ? text : normalizeText(text, true);
    const terms = source
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 0)
      .filter((token) => !this.stopWords.has(token))
      .filter((token) => token.length >= this.minTokenLength);
    if (this.maxTokensPerDocument > 0 && terms.length > this.maxTokensPerDocument) {
      return terms.slice(0, this.maxTokensPerDocument);
    }
    return terms;
  }

  /**
   * Build a raw term→count {@link DocumentVector} from free text.
   *
   * Values are raw frequencies (the documented contract of
   * {@link DocumentVector}); sub-linear/IDF weighting is applied at scoring
   * time via {@link RetrievalIndex.weightedVector}.
   *
   * @param text - the text to count terms for
   * @returns a sparse term→count map
   */
  computeVector(text: string): DocumentVector {
    const vector: Record<string, number> = {};
    for (const term of this.tokenize(text)) {
      vector[term] = (vector[term] ?? 0) + 1;
    }
    return vector;
  }

  /**
   * Document frequency of a term: how many indexed documents contain it.
   *
   * @param term - the term to look up
   * @returns the number of documents containing the term (0 when unknown)
   */
  docFrequency(term: string): number {
    return this.postings.get(term)?.size ?? 0;
  }

  /**
   * Inverse document frequency for a term.
   *
   * Uses smoothed IDF `ln(1 + N / (1 + df))` so terms present in every
   * document still get a small (never infinite) value.
   *
   * @param term - the term to score
   * @returns `0` when the term is unknown, otherwise `ln(1 + N/(1 + df))`
   */
  idf(term: string): number {
    const df = this.docFrequency(term);
    if (df === 0) {
      return 0;
    }
    const n = this.documents.size;
    return Math.log(1 + n / (1 + df));
  }

  /**
   * Apply TF-IDF weighting to a raw {@link DocumentVector}.
   *
   * Each term's raw count becomes `tf(count) * idf(term)` where `tf` uses
   * sub-linear `1 + ln(count)` when enabled.
   *
   * @param vector - the raw term→count vector
   * @returns a new weighted term→weight map (sparse)
   */
  weightedVector(vector: DocumentVector): Map<string, number> {
    const weighted = new Map<string, number>();
    for (const [term, count] of Object.entries(vector)) {
      const tf = this.sublinearTf ? 1 + Math.log(count) : count;
      weighted.set(term, tf * this.idf(term));
    }
    return weighted;
  }

  /**
   * Compute the TF-IDF vector of free text as a plain term→weight map.
   *
   * Convenience wrapper around {@link RetrievalIndex.computeVector} +
   * {@link RetrievalIndex.weightedVector} for query scoring.
   *
   * @param text - the text to score
   * @returns the weighted term→weight map
   */
  computeTfidf(text: string): Map<string, number> {
    return this.weightedVector(this.computeVector(text));
  }

  /**
   * Compute the TF-IDF vector of an *indexed* document.
   *
   * @param id - the document's index key
   * @returns the weighted map, or `undefined` when the id is unknown
   */
  computeTfidfFor(id: string): Map<string, number> | undefined {
    const vector = this.documents.get(id);
    return vector ? this.weightedVector(vector) : undefined;
  }

  /**
   * Cosine similarity between two raw {@link DocumentVector}s.
   *
   * Both vectors are TF-IDF weighted internally before the dot product, so
   * this is a real TF-IDF cosine score in `[0, 1]`.
   *
   * @param a - the first raw vector
   * @param b - the second raw vector
   * @returns cosine similarity (`0` when either vector is empty)
   */
  similarity(a: DocumentVector, b: DocumentVector): number {
    const wa = this.weightedVector(a);
    const wb = this.weightedVector(b);
    return RetrievalIndex.cosine(wa, wb);
  }

  /**
   * Cosine similarity between a query vector and an indexed document.
   *
   * @param queryVector - a raw term→count query vector
   * @param docId - an indexed document's id
   * @returns the cosine similarity, or `0` when the id is unknown
   */
  cosineWithDocument(queryVector: DocumentVector, docId: string): number {
    const docVector = this.documents.get(docId);
    if (!docVector) {
      return 0;
    }
    return this.similarity(queryVector, docVector);
  }

  /**
   * Static cosine similarity between two sparse term→weight maps.
   *
   * @param a - first weighted vector
   * @param b - second weighted vector
   * @returns the cosine similarity in `[0, 1]`
   */
  static cosine(
    a: Map<string, number>,
    b: Map<string, number>,
  ): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (const value of a.values()) {
      normA += value * value;
    }
    for (const value of b.values()) {
      normB += value * value;
    }
    if (normA === 0 || normB === 0) {
      return 0;
    }
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const [term, value] of small) {
      const other = large.get(term);
      if (other !== undefined) {
        dot += value * other;
      }
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Index a document from free text.
   *
   * Tokenizes `text`, records the raw term counts under `id`, updates the
   * inverted index and the document-length table.
   *
   * @param id - the document's index key
   * @param text - the document's text
   * @returns the raw {@link DocumentVector} that was stored
   */
  indexText(id: string, text: string): DocumentVector {
    const vector = this.computeVector(text);
    return this.indexVector(id, vector);
  }

  /**
   * Index a document described by an {@link IndexEntryInput}.
   *
   * When only a `vector` is supplied, that vector is used verbatim.
   *
   * @param input - the document to index
   * @returns the raw {@link DocumentVector} that was stored
   */
  indexEntry(input: IndexEntryInput): DocumentVector {
    const vector = input.vector ?? this.computeVector(input.text ?? '');
    return this.indexVector(input.id, vector);
  }

  /**
   * Internal: store a vector under `id` and rebuild its postings.
   *
   * @param id - the document's index key
   * @param vector - the raw term→count vector
   * @returns the same vector, for chaining
   */
  private indexVector(id: string, vector: DocumentVector): DocumentVector {
    const previous = this.documents.get(id);
    if (previous) {
      for (const term of Object.keys(previous)) {
        const bucket = this.postings.get(term);
        if (bucket) {
          bucket.delete(id);
          if (bucket.size === 0) {
            this.postings.delete(term);
          }
        }
      }
    }
    let total = 0;
    for (const [term, count] of Object.entries(vector)) {
      let bucket = this.postings.get(term);
      if (!bucket) {
        bucket = new Map<string, number>();
        this.postings.set(term, bucket);
      }
      bucket.set(id, count);
      total += count;
    }
    this.documents.set(id, vector);
    this.docLengths.set(id, total);
    return vector;
  }

  /**
   * Remove a document (and all of its postings) from the index.
   *
   * @param id - the document's index key
   * @returns `true` when a document was removed
   */
  removeEntry(id: string): boolean {
    const vector = this.documents.get(id);
    if (!vector) {
      return false;
    }
    for (const term of Object.keys(vector)) {
      const bucket = this.postings.get(term);
      if (bucket) {
        bucket.delete(id);
        if (bucket.size === 0) {
          this.postings.delete(term);
        }
      }
    }
    this.documents.delete(id);
    this.docLengths.delete(id);
    return true;
  }

  /**
   * Test whether a document id is indexed.
   *
   * @param id - the document's index key
   * @returns `true` when indexed
   */
  has(id: string): boolean {
    return this.documents.has(id);
  }

  /**
   * Fetch an indexed document's raw vector.
   *
   * @param id - the document's index key
   * @returns the raw term→count vector, or `undefined`
   */
  getVector(id: string): DocumentVector | undefined {
    return this.documents.get(id);
  }

  /**
   * Term frequency of a term within an indexed document.
   *
   * @param id - the document's index key
   * @param term - the term to look up
   * @returns the raw frequency (`0` when absent)
   */
  termFrequency(id: string, term: string): number {
    return this.documents.get(id)?.[term] ?? 0;
  }

  /**
   * Number of documents currently indexed.
   */
  get size(): number {
    return this.documents.size;
  }

  /**
   * The corpus vocabulary: every distinct indexed term.
   *
   * @returns a fresh, unordered array of terms
   */
  vocabulary(): string[] {
    return [...this.postings.keys()];
  }

  /**
   * Replace the entire index contents with the given documents.
   *
   * @param entries - the documents to index (existing content is discarded)
   * @returns the number of documents indexed
   */
  rebuild(entries: Iterable<IndexEntryInput>): number {
    this.clear();
    let count = 0;
    for (const entry of entries) {
      this.indexEntry(entry);
      count += 1;
    }
    return count;
  }

  /**
   * Remove every document from the index.
   */
  clear(): void {
    this.documents.clear();
    this.postings.clear();
    this.docLengths.clear();
  }

  /**
   * Compute on-demand statistics about the index.
   *
   * @returns an {@link IndexStats} summary
   */
  stats(): IndexStats {
    let totalTerms = 0;
    for (const length of this.docLengths.values()) {
      totalTerms += length;
    }
    const count = this.documents.size;
    return {
      documents: count,
      distinctTerms: this.postings.size,
      totalTerms,
      averageDocumentLength: count > 0 ? totalTerms / count : 0,
      minTokenLength: this.minTokenLength,
      sublinearTf: this.sublinearTf,
      createdAt: this.createdAt,
    };
  }

  /**
   * Serialise the index into a JSON-safe {@link IndexSnapshot}.
   *
   * @returns the index's snapshot
   */
  toJSON(): IndexSnapshot {
    const documents: Record<string, DocumentVector> = {};
    for (const [id, vector] of this.documents) {
      documents[id] = { ...vector };
    }
    return {
      version: 1,
      createdAt: this.createdAt,
      documents,
    };
  }

  /**
   * Restore an index from an {@link IndexSnapshot}.
   *
   * @param snapshot - a snapshot produced by {@link RetrievalIndex.toJSON}
   * @param config - optional configuration for the restored index
   * @returns a new index populated with the snapshot's documents
   */
  static fromJSON(
    snapshot: IndexSnapshot,
    config: RetrievalConfig = {},
  ): RetrievalIndex {
    const index = new RetrievalIndex(config);
    for (const [id, vector] of Object.entries(snapshot.documents)) {
      index.indexEntry({ id, vector });
    }
    return index;
  }

  /**
   * Human-readable summary of the index, for logging.
   *
   * @returns e.g. `"RetrievalIndex(documents=12, terms=87)"`
   */
  inspect(): string {
    return `RetrievalIndex(documents=${this.documents.size}, terms=${
      this.postings.size
    })`;
  }
}