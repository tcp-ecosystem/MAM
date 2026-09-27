/**
 * TF-IDF vector index for semantic retrieval.
 *
 * {@link SemanticIndex} turns the free-text fields of {@link SemanticEntry}
 * into fixed-dimensional TF-IDF vectors so that entries can be located by
 * *meaning* rather than by literal substring match. It is the built-in
 * "embedding" engine of the semantic layer — no external vector database is
 * required.
 *
 * The pipeline is:
 *
 * 1. **Tokenise** the entry text (fact, triple fields, tags, source) with
 *    {@link tokenize}: unicode-normalise, lower-case, split on non-word
 *    characters, discard stop-words and single-character tokens.
 * 2. **Stem** each token with {@link stem}, a light Porter-style suffix
 *    stripper, so that `running`/`runs`/`run` collapse to one vocabulary term.
 * 3. **Weight** fields so that the fact text dominates the vector while tags
 *    and the source attribution contribute supporting signal
 *    (see {@link extractWeightedTerms}).
 * 4. **Score** each term with TF-IDF: term frequency within the document
 *    multiplied by the inverse document frequency across the collection, then
 *    L2-normalise the resulting vector so that cosine similarity reduces to a
 *    dot product (see {@link cosineSimilarity}).
 *
 * ## Design notes
 *
 * - The vocabulary is grown dynamically. When a new term appears it is added
 *   to the vocabulary, changing the dimensionality of every vector; cached
 *   vectors are invalidated via a monotonically increasing revision counter
 *   and recomputed lazily on the next read.
 * - The index stores only sparse term-frequency maps plus the shared
 *   vocabulary and document-frequency tables, so removing an entry is cheap and
 *   rebuilding from a store is always a valid recovery path.
 * - `computeVector(text)` lets callers embed arbitrary query text against the
 *   *current* vocabulary, which is exactly what the retriever uses for search.
 *
 * @packageDocumentation
 * @module semantic/index
 */

import type { SemanticEntry, SemanticEntryId } from './types.js';

/**
 * English stop-words removed during tokenisation.
 *
 * These words carry little discriminative meaning ("the", "and", "from") and
 * would otherwise dominate raw term frequencies. The list is deliberately
 * small and conservative; domain vocabulary is almost always more valuable.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'while', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do',
  'does', 'did', 'have', 'has', 'had', 'having', 'will', 'would', 'can',
  'could', 'should', 'may', 'might', 'must', 'shall', 'not', 'no', 'nor',
  'so', 'than', 'that', 'this', 'these', 'those', 'it', 'its', 'they',
  'them', 'he', 'she', 'we', 'you', 'i', 'from', 'into', 'onto', 'over',
  'under', 'between', 'which', 'who', 'whom', 'whose', 'what', 'there',
  'here', 'all', 'each', 'every', 'some', 'any', 'none', 'both', 'other',
  'such', 'only', 'own', 'same', 'too', 'very', 'just', 'also', 'then',
  'than', 'out', 'up', 'down', 'off', 'again', 'once', 'our', 'your',
  'their', 'my', 'his', 'her',
]);

/**
 * Field weights used when building the weighted term map of an entry.
 *
 * The fact text carries the full signal; triple fields are near-equal; tags
 * and source support less strongly so they nudge (but do not dominate) the
 * vector.
 */
export const FIELD_WEIGHTS = {
  fact: 1.0,
  subject: 0.9,
  predicate: 0.9,
  object: 0.9,
  tag: 0.6,
  source: 0.5,
} as const;

/**
 * Suffix rules for the light Porter-style stemmer.
 *
 * Each rule maps a suffix to its replacement, applied only when the surviving
 * stem still contains a vowel, which prevents e.g. `ant` from being stripped
 * out of `important` in the wrong place.
 */
const STEM_SUFFIX_RULES: ReadonlyArray<readonly [string, string]> = [
  ['ization', 'ize'],
  ['ational', 'ate'],
  ['fulness', 'ful'],
  ['ousness', 'ous'],
  ['iveness', 'ive'],
  ['biliti', 'ble'],
  ['tional', 'tion'],
  ['enci', 'ence'],
  ['anci', 'ance'],
  ['abli', 'able'],
  ['entli', 'ent'],
  ['izer', 'ize'],
  ['alli', 'al'],
  ['ousli', 'ous'],
  ['ation', 'ate'],
  ['ator', 'ate'],
  ['aliti', 'al'],
  ['iviti', 'ive'],
  ['logi', 'log'],
  ['icate', 'ic'],
  ['ative', ''],
  ['alize', 'al'],
  ['iciti', 'ic'],
  ['ical', 'ic'],
  ['ful', ''],
  ['ness', ''],
];

/**
 * Suffixes stripped outright in the final stemming pass.
 *
 * These are applied last, and only when the stem that remains is at least two
 * characters long and contains a vowel.
 */
const FINAL_SUFFIXES: ReadonlyArray<string> = [
  'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement', 'ment',
  'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize', 'ion',
];

/**
 * Tokenise free text into candidate vocabulary terms.
 *
 * The input is unicode-normalised, lower-cased, split on any run of
 * non-alphanumeric characters, stemmed, and filtered against the stop-word
 * list and a minimum length of two characters.
 *
 * @param text - the raw text to tokenise
 * @returns an array of stemmed, stop-word-free tokens (may be empty)
 */
export function tokenize(text: string): string[] {
  const normalized = String(text).normalize('NFKD').toLowerCase();
  const raw = normalized.split(/[^\p{L}\p{N}]+/u);
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 2) {
      continue;
    }
    const stemmed = stem(token);
    if (stemmed.length >= 2 && !STOPWORDS.has(stemmed)) {
      out.push(stemmed);
    }
  }
  return out;
}

/**
 * A light, deterministic Porter-style suffix stripper.
 *
 * The algorithm applies a fixed series of passes: plural/verb endings
 * (Step 1), common derivational suffixes with vowel guards (Steps 2-3), and a
 * final stripping pass. It is intentionally much smaller than the full Porter
 * algorithm but collapses the majority of English inflectional variants into a
 * single vocabulary term, which is all the TF-IDF index needs.
 *
 * @param word - the raw word to stem
 * @returns the stemmed form
 */
export function stem(word: string): string {
  let w = String(word).toLowerCase();
  if (w.length <= 2) {
    return w;
  }

  // Step 1a: plurals and third-person singular verb forms.
  if (w.endsWith('sses')) {
    w = w.slice(0, -2);
  } else if (w.endsWith('ies')) {
    w = w.slice(0, -2) + 'y';
  } else if (w.endsWith('ss')) {
    // keep "ss" endings intact.
  } else if (w.endsWith('s')) {
    w = w.slice(0, -1);
  }

  // Step 1b: "-eed"/"-ed"/"-ing" endings, with double-consonant cleanup.
  if (w.endsWith('eed')) {
    if (w.length > 4) {
      w = w.slice(0, -1);
    }
  } else if (/[aeiou].*(ed|ing)$/.test(w)) {
    const base = w.replace(/(ed|ing)$/, '');
    if (/(at|bl|iz)$/.test(base)) {
      w = base + 'e';
    } else if (/(bb|dd|ff|gg|mm|nn|pp|rr|tt)$/.test(base)) {
      w = base.slice(0, -1);
    } else if (w.length > 4) {
      w = base;
    }
  }

  // Step 1c: terminal "y" becomes "i" when preceded by a vowel context.
  if (w.endsWith('y') && w.length > 2 && /[aeiou]/.test(w.slice(0, -1))) {
    w = w.slice(0, -1) + 'i';
  }

  // Steps 2-3: derivational suffixes, applied only when the stem has a vowel.
  for (const [suffix, replacement] of STEM_SUFFIX_RULES) {
    if (!w.endsWith(suffix)) {
      continue;
    }
    const stemmed = w.slice(0, -suffix.length);
    if (stemmed.length > 0 && /[aeiou]/.test(stemmed)) {
      w = stemmed + replacement;
    }
    break;
  }

  // Step 4: final stripping of common nominal/adjectival suffixes.
  for (const suffix of FINAL_SUFFIXES) {
    if (!w.endsWith(suffix)) {
      continue;
    }
    const stemmed = w.slice(0, -suffix.length);
    if (stemmed.length > 1 && /[aeiou]/.test(stemmed)) {
      w = stemmed;
    }
    break;
  }

  return w;
}

/**
 * Count term frequencies in a token array.
 *
 * @param tokens - the tokens to count
 * @returns a map from token to its frequency in the input
 */
export function termFrequency(tokens: readonly string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/**
 * Build the weighted term map for a semantic entry.
 *
 * Each field of the entry is tokenised and its term frequencies are multiplied
 * by the field weight (see {@link FIELD_WEIGHTS}), so the fact text dominates
 * while tags and source contribute supporting signal. Repeated terms across
 * fields accumulate their weights.
 *
 * @param entry - the entry to read terms from
 * @returns a map from stemmed term to weighted frequency
 */
export function extractWeightedTerms(entry: SemanticEntry): Map<string, number> {
  const acc = new Map<string, number>();
  const add = (text: string, weight: number): void => {
    if (!text) {
      return;
    }
    for (const token of tokenize(text)) {
      acc.set(token, (acc.get(token) ?? 0) + weight);
    }
  };
  add(entry.fact, FIELD_WEIGHTS.fact);
  if (entry.subject) {
    add(entry.subject, FIELD_WEIGHTS.subject);
  }
  if (entry.predicate) {
    add(entry.predicate, FIELD_WEIGHTS.predicate);
  }
  if (entry.object) {
    add(entry.object, FIELD_WEIGHTS.object);
  }
  for (const tag of entry.tags ?? []) {
    add(tag, FIELD_WEIGHTS.tag);
  }
  if (entry.source) {
    add(entry.source, FIELD_WEIGHTS.source);
  }
  return acc;
}

/**
 * Cosine similarity between two non-empty numeric vectors.
 *
 * Returns `0` when either vector has zero magnitude (which includes the empty
 * vector). The implementation is numerically stable for the sizes encountered
 * in TF-IDF work.
 *
 * @param a - the first vector
 * @param b - the second vector
 * @returns cosine similarity in `[0, 1]`
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * L2 magnitude of a numeric vector.
 *
 * @param vector - the vector to measure
 * @returns the Euclidean norm (0 for the empty vector)
 */
export function magnitude(vector: readonly number[]): number {
  let sum = 0;
  for (const v of vector) {
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/**
 * Statistics describing the current state of a {@link SemanticIndex}.
 *
 * Distinct from {@link SemanticStats} (which describes the store): these counts
 * describe the index's internal tables, so they are useful for sizing and for
 * detecting index drift after a rebuild.
 */
export interface SemanticIndexStats {
  /** Number of documents (entries) currently indexed. */
  readonly documents: number;

  /** Number of distinct stemmed terms in the vocabulary. */
  readonly vocabulary: number;

  /** Total weighted term occurrences across all documents. */
  readonly totalTerms: number;

  /** Mean number of distinct terms per document (0 when empty). */
  readonly averageTermsPerDocument: number;

  /** Number of times the index has been structurally invalidated. */
  readonly revisions: number;
}

/**
 * A cached dense vector together with the revision it was computed at.
 *
 * The vector is only valid while `revision === index.revision`; once the
 * vocabulary or document frequencies change the cache entry is recomputed on
 * the next read.
 */
interface CachedVector {
  /** Revision at which the vector was computed. */
  readonly revision: number;
  /** The L2-normalised dense vector. */
  readonly vector: Float64Array;
}

/**
 * Maintains a TF-IDF vocabulary and dense vectors over a collection of
 * {@link SemanticEntry} documents.
 *
 * The index is a separate concern from {@link SemanticStore}: it can be fed
 * entries incrementally with {@link SemanticIndex.indexEntry}, or rebuilt
 * wholesale with {@link SemanticIndex.rebuild}. Because the store remains the
 * source of truth, discarding and rebuilding the index is always a valid
 * recovery path.
 */
export class SemanticIndex {
  /** Entry id -> sparse weighted term-frequency map. */
  private readonly documents = new Map<SemanticEntryId, Map<string, number>>();

  /** Term -> number of documents containing it (document frequency). */
  private readonly df = new Map<string, number>();

  /** Ordered vocabulary: term -> dense-vector column index. */
  private readonly vocab = new Map<string, number>();

  /** Entry id -> cached dense vector (lazily recomputed). */
  private readonly vectors = new Map<SemanticEntryId, CachedVector>();

  /** Structural revision counter used to invalidate cached vectors. */
  private revision = 0;

  /**
   * Construct an empty index.
   *
   * @param source - an optional collection of entries to index immediately
   */
  constructor(source?: readonly SemanticEntry[]) {
    if (source) {
      this.rebuild(source);
    }
  }

  /**
   * Add an entry to the index.
   *
   * If the entry is already indexed (same id), it is removed first so the
   * index never accumulates stale term data after an entry is re-stored.
   *
   * @param entry - the entry to index
   * @returns `this` for chaining
   */
  indexEntry(entry: SemanticEntry): this {
    if (this.documents.has(entry.id)) {
      this.removeEntry(entry.id);
    }
    const terms = extractWeightedTerms(entry);
    this.documents.set(entry.id, terms);
    let newTerms = 0;
    for (const term of terms.keys()) {
      const previous = this.df.get(term) ?? 0;
      if (previous === 0) {
        newTerms += 1;
      }
      this.df.set(term, previous + 1);
    }
    if (newTerms > 0) {
      this.rebuildVocabulary();
    }
    this.revision += 1;
    return this;
  }

  /**
   * Remove an entry from the index.
   *
   * Idempotent: removing an id that was never indexed is a no-op. Document
   * frequencies and the vocabulary are recomputed from the remaining
   * documents, so removal is slightly more expensive than insertion but always
   * leaves the index consistent.
   *
   * @param id - the entry id to un-index
   * @returns `true` when the entry was present and removed
   */
  removeEntry(id: SemanticEntryId): boolean {
    if (!this.documents.has(id)) {
      return false;
    }
    this.documents.delete(id);
    this.vectors.delete(id);
    this.df.clear();
    for (const terms of this.documents.values()) {
      for (const term of terms.keys()) {
        this.df.set(term, (this.df.get(term) ?? 0) + 1);
      }
    }
    this.rebuildVocabulary();
    this.revision += 1;
    return true;
  }

  /**
   * Rebuild the ordered vocabulary from the union of all indexed terms.
   *
   * Called whenever the set of terms in the collection changes. Reassigns
   * every term its column index and invalidates all cached vectors.
   */
  private rebuildVocabulary(): void {
    this.vocab.clear();
    for (const terms of this.documents.values()) {
      for (const term of terms.keys()) {
        if (!this.vocab.has(term)) {
          this.vocab.set(term, this.vocab.size);
        }
      }
    }
  }

  /**
   * Compute the L2-normalised TF-IDF dense vector for a weighted term map.
   *
   * The vector has one column per vocabulary term. For each term present in
   * the document the value is `weightedTermFrequency * idf`, where
   * `idf = log((N + 1) / (df + 1)) + 1` and `N` is the document count. Terms
   * absent from the vocabulary contribute zero. The result is L2-normalised so
   * that cosine similarity between vectors is a pure dot product.
   *
   * @param terms - the weighted term-frequency map to embed
   * @returns a normalised dense vector (all zeros for an empty document)
   */
  private computeDense(terms: Map<string, number>): Float64Array {
    const n = this.documents.size;
    const vector = new Float64Array(this.vocab.size);
    for (const [term, weight] of terms) {
      const column = this.vocab.get(term);
      if (column === undefined) {
        continue;
      }
      const df = this.df.get(term) ?? 0;
      const idf = Math.log((n + 1) / (df + 1)) + 1;
      vector[column] = weight * idf;
    }
    const norm = magnitude(Array.from(vector));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i += 1) {
        vector[i] /= norm;
      }
    }
    return vector;
  }

  /**
   * Return the current dense vector for an indexed entry.
   *
   * The vector is cached and only recomputed when the index revision changed
   * since it was built, so repeated reads are cheap while structural changes
   * (new terms, removals) are always reflected.
   *
   * @param id - the entry id to read the vector for
   * @returns the L2-normalised dense vector, or `undefined` when not indexed
   */
  vectorFor(id: SemanticEntryId): number[] | undefined {
    const terms = this.documents.get(id);
    if (!terms) {
      return undefined;
    }
    const cached = this.vectors.get(id);
    if (cached && cached.revision === this.revision) {
      return Array.from(cached.vector);
    }
    const dense = this.computeDense(terms);
    this.vectors.set(id, { revision: this.revision, vector: dense });
    return Array.from(dense);
  }

  /**
   * Compute a TF-IDF vector for arbitrary text against the current vocabulary.
   *
   * The text is tokenised, stemmed and term-frequency counted, then embedded
   * using the *current* document frequencies. This is the entry point the
   * retriever uses to embed query strings.
   *
   * @param text - the text to embed
   * @returns a dense vector aligned with the current vocabulary
   */
  computeVector(text: string): number[] {
    const terms = termFrequency(tokenize(text));
    return Array.from(this.computeDense(terms));
  }

  /**
   * The ordered list of vocabulary terms.
   *
   * The position of each term is the column index used by every dense vector
   * returned by this index.
   *
   * @returns a fresh array of stemmed terms
   */
  vocabulary(): string[] {
    return Array.from(this.vocab.keys());
  }

  /**
   * Alias of {@link SemanticIndex.vocabulary} kept for API compatibility.
   *
   * @returns a fresh array of stemmed terms
   */
  vocabularyTerms(): string[] {
    return this.vocabulary();
  }

  /**
   * The size of the current vocabulary (dense vector dimensionality).
   *
   * @returns the number of distinct stemmed terms
   */
  get terms(): number {
    return this.vocab.size;
  }

  /**
   * Rebuild the entire index from a collection of entries.
   *
   * All existing index state is discarded first, so calling `rebuild` after a
   * store mutation that bypassed the index always converges the index to the
   * collection's truth.
   *
   * @param source - the entries to index
   * @returns `this` for chaining
   */
  rebuild(source: readonly SemanticEntry[]): this {
    this.clear();
    for (const entry of source) {
      this.indexEntry(entry);
    }
    return this;
  }

  /**
   * Remove every document, term and cached vector from the index.
   */
  clear(): void {
    this.documents.clear();
    this.df.clear();
    this.vocab.clear();
    this.vectors.clear();
    this.revision += 1;
  }

  /**
   * Aggregate statistics describing the index's internal state.
   *
   * @returns a fresh {@link SemanticIndexStats} snapshot
   */
  stats(): SemanticIndexStats {
    let totalTerms = 0;
    for (const terms of this.documents.values()) {
      totalTerms += terms.size;
    }
    return {
      documents: this.documents.size,
      vocabulary: this.vocab.size,
      totalTerms,
      averageTermsPerDocument:
        this.documents.size === 0 ? 0 : totalTerms / this.documents.size,
      revisions: this.revision,
    };
  }
}

/**
 * Convenience factory: build and populate an index from a collection of
 * entries in one call.
 *
 * @param source - the entries to index
 * @returns a fully-built index
 */
export function createIndex(source?: readonly SemanticEntry[]): SemanticIndex {
  return new SemanticIndex(source);
}