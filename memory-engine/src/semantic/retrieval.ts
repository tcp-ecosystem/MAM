/**
 * Retrieval layer for the semantic memory subsystem.
 *
 * {@link SemanticRetriever} answers the questions an agent asks of its stored
 * knowledge. It sits on top of a {@link SemanticStore} (the source of truth)
 * and a {@link SemanticIndex} (the TF-IDF vector engine) and provides:
 *
 * - **Meaning-based search** — {@link SemanticRetriever.search} embeds a query
 *   string against the current vocabulary and returns the entries with the
 *   highest TF-IDF cosine similarity.
 * - **Nearest neighbours** — {@link SemanticRetriever.similarTo} finds entries
 *   whose vectors are closest to a *stored* entry, enabling clustering and
 *   "related facts" queries.
 * - **Faceted filtering** — {@link SemanticRetriever.byTag},
 *   {@link SemanticRetriever.bySubject} and {@link SemanticRetriever.byConfidence}
 *   answer structural questions without any vector math.
 * - **Top-K convenience** — {@link SemanticRetriever.topK} is the bounded
 *   variant of `search` used by higher layers such as {@link KnowledgeBase}.
 *
 * ## Scoring model
 *
 * `search` and `similarTo` score candidates with
 * {@link cosineSimilarity} over L2-normalised TF-IDF vectors, so scores lie in
 * `[0, 1]` and are comparable across queries for a fixed vocabulary. The
 * {@link SemanticConfig.similarityThreshold} (default `0.1`) is applied before
 * ranking; candidates below it are discarded rather than returned at the tail.
 *
 * When an entry carries an explicit {@link SemanticEntry.embedding}, retrieval
 * honours it directly by comparing the *query vector* against the stored
 * embedding instead of the index-derived vector, which lets callers blend
 * real model embeddings with the built-in TF-IDF engine.
 *
 * @packageDocumentation
 * @module semantic/retrieval
 */

import type {
  Confidence,
  SemanticEntry,
  SemanticEntryId,
  SemanticHit,
  SemanticStats,
} from './types.js';
import { SemanticIndex, cosineSimilarity } from './index.js';
import { normalizeTags, type SemanticStore } from './store.js';

/**
 * Options accepted by the retrieval entry points.
 *
 * {@link SemanticRetriever.search} and {@link SemanticRetriever.similarTo}
 * accept either a bare limit number (shorthand for `{ limit }`) or a rich
 * options object. A `limit` of `0` means "no limit".
 */
export interface SemanticRetrievalOptions {
  /**
   * Maximum number of results to return. `0` means unbounded. Defaults to the
   * store's `defaultLimit`.
   */
  readonly limit?: number;

  /**
   * Minimum cosine similarity (in `[0, 1]`) a candidate must reach to be
   * returned. When omitted the store's configured
   * {@link SemanticConfig.similarityThreshold} is used.
   */
  readonly threshold?: number;

  /**
   * When `true`, entries with an explicit embedding are compared against the
   * query vector via cosine similarity over the raw embedding rather than the
   * index-derived TF-IDF vector. When `false` (default) the index vector is
   * used, falling back to the explicit embedding only for entries the index
   * does not know about.
   */
  readonly preferEmbeddings?: boolean;
}

/**
 * A candidate entry paired with the score that will be used for ranking.
 *
 * Internal intermediate type used while assembling results; the public return
 * shape is {@link SemanticHit}.
 */
interface ScoredCandidate {
  readonly entry: SemanticEntry;
  readonly score: number;
}

/**
 * Normalise the variadic limit/options argument of the retrieval methods.
 *
 * @param store - the store whose defaults should apply
 * @param arg - a limit number, an options object, or `undefined`
 * @returns a fully-resolved options object
 */
function resolveOptions(
  store: SemanticStore,
  arg: number | SemanticRetrievalOptions | undefined,
): Required<Pick<SemanticRetrievalOptions, 'limit' | 'threshold' | 'preferEmbeddings'>> {
  if (typeof arg === 'number') {
    return {
      limit: arg > 0 ? arg : 0,
      threshold: store.configSnapshot.similarityThreshold ?? 0.1,
      preferEmbeddings: false,
    };
  }
  return {
    limit: arg?.limit ?? store.configSnapshot.defaultLimit ?? 20,
    threshold: arg?.threshold ?? store.configSnapshot.similarityThreshold ?? 0.1,
    preferEmbeddings: arg?.preferEmbeddings ?? false,
  };
}

/**
 * Score every candidate entry against a query vector and return the hits that
 * clear the threshold, ranked best-first.
 *
 * Entries with an explicit embedding are compared against the raw embedding
 * when `preferEmbeddings` is set, otherwise (and always when no explicit
 * embedding exists) against the index-derived TF-IDF vector.
 *
 * @param store - the store to pull entries from
 * @param index - the index to pull TF-IDF vectors from
 * @param query - the dense query vector to score against
 * @param opts - resolved options (limit, threshold, preferEmbeddings)
 * @param exclude - entry ids to skip (used by `similarTo`)
 * @returns ranked hits
 */
function scoreAgainstVector(
  store: SemanticStore,
  index: SemanticIndex,
  query: readonly number[],
  opts: Required<Pick<SemanticRetrievalOptions, 'limit' | 'threshold' | 'preferEmbeddings'>>,
  exclude: ReadonlySet<SemanticEntryId> = new Set(),
): SemanticHit[] {
  const candidates: ScoredCandidate[] = [];
  for (const id of store.keys()) {
    if (exclude.has(id)) {
      continue;
    }
    const entry = store.get(id);
    if (!entry) {
      continue;
    }
    const vector = opts.preferEmbeddings && entry.embedding
      ? [...entry.embedding]
      : (index.vectorFor(id) ?? (entry.embedding ? [...entry.embedding] : undefined));
    if (!vector || vector.length === 0) {
      continue;
    }
    const score = cosineSimilarity(query, vector);
    if (score < opts.threshold) {
      continue;
    }
    candidates.push({ entry, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const limited = opts.limit > 0 ? candidates.slice(0, opts.limit) : candidates;
  return limited.map((candidate) => ({ entry: candidate.entry, score: candidate.score }));
}

/**
 * High-level retrieval facade over a semantic store and its TF-IDF index.
 *
 * Construct with the store and index you want to query (see
 * {@link createSemanticAdapter} for a factory that wires everything together).
 * The retriever holds no state of its own beyond the threshold default, so it
 * is safe to construct one per query or share one for the lifetime of the
 * store.
 */
export class SemanticRetriever {
  private readonly store: SemanticStore;
  private readonly index: SemanticIndex;

  /**
   * Construct a retriever over a store and index.
   *
   * @param store - the store holding the entries
   * @param index - the TF-IDF index built over the same store
   */
  constructor(store: SemanticStore, index: SemanticIndex) {
    this.store = store;
    this.index = index;
  }

  /**
   * Search the store for entries semantically similar to a query.
   *
   * The query is embedded against the current vocabulary via
   * {@link SemanticIndex.computeVector}, every entry is scored with cosine
   * similarity, candidates below the threshold are discarded, and the rest are
   * returned best-first.
   *
   * @param query - the query text to search for
   * @param limit - maximum number of results (or an options object)
   * @returns ranked {@link SemanticHit}s above the threshold
   *
   * @example
   * ```ts
   * const hits = retriever.search('what version of postgres runs on prod', 5);
   * for (const hit of hits) console.log(hit.score, hit.entry.fact);
   * ```
   */
  search(query: string, limit?: number | SemanticRetrievalOptions): SemanticHit[] {
    const queryVector = this.index.computeVector(query);
    if (queryVector.length === 0) {
      return [];
    }
    return scoreAgainstVector(this.store, this.index, queryVector, resolveOptions(this.store, limit));
  }

  /**
   * Find the entries most similar to a stored entry.
   *
   * The entry's own vector is embedded (or its explicit embedding used) and
   * used as the query; the entry itself is excluded from the results.
   *
   * @param id - the entry id to compare against
   * @param limit - maximum number of results (or an options object)
   * @returns ranked {@link SemanticHit}s above the threshold
   * @throws {Error} when the entry does not exist
   */
  similarTo(id: SemanticEntryId, limit?: number | SemanticRetrievalOptions): SemanticHit[] {
    const entry = this.store.requireEntry(id);
    const query = entry.embedding
      ? [...entry.embedding]
      : this.index.vectorFor(id) ?? [];
    if (query.length === 0) {
      return [];
    }
    return scoreAgainstVector(
      this.store,
      this.index,
      query,
      resolveOptions(this.store, limit),
      new Set([id]),
    );
  }

  /**
   * Return the entries that carry at least one of the given tags.
   *
   * Tag values are normalised (lower-cased) before matching, mirroring store
   * normalisation. Results are ordered most-recently-created first for
   * determinism.
   *
   * @param tags - the tags to match
   * @param mode - `'any'` (default) requires one tag; `'all'` requires every
   * @returns matching entries (no scoring involved)
   */
  byTag(tags: readonly string[], mode: 'any' | 'all' = 'any'): SemanticEntry[] {
    const wanted = normalizeTags(tags, true);
    if (wanted.length === 0) {
      return [];
    }
    const out: SemanticEntry[] = [];
    for (const entry of this.store.getAll()) {
      const present = normalizeTags(entry.tags, true);
      const hit = mode === 'all'
        ? wanted.every((tag) => present.includes(tag))
        : wanted.some((tag) => present.includes(tag));
      if (hit) {
        out.push(entry);
      }
    }
    out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }

  /**
   * Return the entries whose triple subject matches a value.
   *
   * Matching is case-insensitive after trimming. Use {@link bySubjectExact} for
   * a case-sensitive lookup.
   *
   * @param subject - the subject to match
   * @returns matching entries
   */
  bySubject(subject: string): SemanticEntry[] {
    const wanted = String(subject).trim().toLowerCase();
    if (wanted.length === 0) {
      return [];
    }
    return this.store
      .getAll()
      .filter((entry) => entry.subject !== undefined && entry.subject.toLowerCase() === wanted);
  }

  /**
   * Return the entries whose triple subject matches a value exactly.
   *
   * Unlike {@link bySubject} this is case-sensitive, which matters when
   * subjects are identifiers (e.g. `"ACME-42"`).
   *
   * @param subject - the subject to match
   * @returns matching entries
   */
  bySubjectExact(subject: string): SemanticEntry[] {
    return this.store.getAll().filter((entry) => entry.subject === subject);
  }

  /**
   * Return the entries whose confidence is at least `min`.
   *
   * Results are ordered highest-confidence first; ties are broken by most
   * recently updated. Useful for surfacing only the knowledge the system is
   * reasonably sure about.
   *
   * @param min - minimum confidence in `[0, 1]`
   * @returns matching entries, best-confidence first
   */
  byConfidence(min: Confidence): SemanticEntry[] {
    const floor = Math.min(1, Math.max(0, min));
    return this.store
      .getAll()
      .filter((entry) => (entry.confidence ?? 0) >= floor)
      .sort(
        (a, b) =>
          (b.confidence ?? 0) - (a.confidence ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
  }

  /**
   * Top-K variant of {@link SemanticRetriever.search}.
   *
   * Returns at most `k` results, best-first. When `k <= 0` an empty array is
   * returned. This is the entry point higher layers such as
   * {@link KnowledgeBase} use for bounded retrieval.
   *
   * @param query - the query text to search for
   * @param k - the maximum number of results to return
   * @returns the top `k` ranked {@link SemanticHit}s
   */
  topK(query: string, k: number): SemanticHit[] {
    if (k <= 0) {
      return [];
    }
    return this.search(query, { limit: k });
  }

  /**
   * Score every stored entry against an already-embedded query vector.
   *
   * This is the low-level sibling of {@link SemanticRetriever.search} for
   * callers that have built a query vector themselves — for example by
   * averaging the vectors of several context strings (see
   * `SemanticRuntimeAdapter.recall`). The vector must be aligned with the
   * index's current vocabulary; the usual way to produce one is
   * {@link SemanticIndex.computeVector}.
   *
   * @param queryVector - the dense query vector to score against
   * @param options - limit/threshold options (or a bare limit number)
   * @returns ranked {@link SemanticHit}s above the threshold
   */
  searchWithin(queryVector: readonly number[], options?: number | SemanticRetrievalOptions): SemanticHit[] {
    if (queryVector.length === 0) {
      return [];
    }
    return scoreAgainstVector(
      this.store,
      this.index,
      queryVector,
      resolveOptions(this.store, options),
    );
  }

  /**
   * Return the single best match for a query, if any clears the threshold.
   *
   * @param query - the query text to search for
   * @returns the best {@link SemanticHit}, or `undefined` when nothing matches
   */
  best(query: string): SemanticHit | undefined {
    return this.search(query, { limit: 1 })[0];
  }

  /**
   * Combine several structural filters and return entries matching all of
   * them.
   *
   * Useful for "knowledge about this subject, tagged deploy, confidence >= 0.7"
   * style queries without chaining method calls.
   *
   * @param filters - the filters to apply; each is optional
   * @returns matching entries
   */
  filterBy(filters: {
    readonly subject?: string;
    readonly tags?: readonly string[];
    readonly minConfidence?: Confidence;
    readonly source?: string;
  }): SemanticEntry[] {
    let result = this.store.getAll();
    if (filters.subject !== undefined) {
      result = result.filter(
        (entry) =>
          entry.subject !== undefined &&
          entry.subject.toLowerCase() === String(filters.subject).trim().toLowerCase(),
      );
    }
    if (filters.tags !== undefined && filters.tags.length > 0) {
      const wanted = normalizeTags(filters.tags, true);
      result = result.filter((entry) =>
        wanted.every((tag) => normalizeTags(entry.tags, true).includes(tag)),
      );
    }
    if (filters.minConfidence !== undefined) {
      result = result.filter((entry) => (entry.confidence ?? 0) >= filters.minConfidence!);
    }
    if (filters.source !== undefined) {
      result = result.filter((entry) => entry.source === filters.source);
    }
    return result;
  }

  /**
   * Aggregate statistics about the underlying store.
   *
   * Delegates to {@link SemanticStore.stats}; the retriever itself holds no
   * state worth counting.
   *
   * @returns a fresh {@link SemanticStats} snapshot
   */
  stats(): SemanticStats {
    return this.store.stats();
  }
}

/**
 * Convenience factory: build a retriever over a store and index.
 *
 * @param store - the store holding the entries
 * @param index - the TF-IDF index built over the same store
 * @returns a configured retriever
 */
export function createRetriever(store: SemanticStore, index: SemanticIndex): SemanticRetriever {
  return new SemanticRetriever(store, index);
}