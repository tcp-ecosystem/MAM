/**
 * Integration layer: adapt the semantic subsystem to a uniform memory surface.
 *
 * The semantic store, index, retriever and lifecycle are individually useful,
 * but most consumers want a single object they can talk to. This module
 * provides three layers of integration:
 *
 * - {@link SemanticRuntimeAdapter} — implements the {@link RuntimeMemory}
 *   contract (`set`/`get`/`delete`/`has`/`keys`/`clear`/`stats`) so semantic
 *   memory can be dropped into any consumer that already speaks to working or
 *   episodic memory. It adds semantic-specific operations on top:
 *   {@link SemanticRuntimeAdapter.search} and
 *   {@link SemanticRuntimeAdapter.recall}.
 * - {@link createSemanticAdapter} — the factory that wires a store, index,
 *   retriever and lifecycle together and keeps them consistent. Every `put`
 *   is indexed, every delete is un-indexed, and the lifecycle is available for
 *   housekeeping.
 * - {@link KnowledgeBase} — a higher-level knowledge base exposing a friendly
 *   `put`/`get`/`search`/`topK` API over the same wiring, aimed at agents that
 *   want to accumulate and query facts without caring about the plumbing.
 *
 * ## Consistency guarantees
 *
 * The adapter keeps store and index in lock-step: `set` stores *and* indexes,
 * `delete` deletes *and* un-indexes. Because the {@link SemanticIndex} is
 * always rebuildable from the store, a missed index update is never fatal — a
 * call to `SemanticLifecycle.normalize` (or {@link KnowledgeBase.normalize})
 * converges it again.
 *
 * @packageDocumentation
 * @module semantic/integration
 */

import type {
  Confidence,
  RuntimeMemory,
  SemanticConfig,
  SemanticEntry,
  SemanticEntryId,
  SemanticEntryOptions,
  SemanticHit,
  SemanticMetadata,
  SemanticPatch,
  SemanticSnapshot,
  SemanticStats,
} from './types.js';
import { SemanticStore, toSemanticMetadata } from './store.js';
import { SemanticIndex } from './index.js';
import { SemanticRetriever, type SemanticRetrievalOptions } from './retrieval.js';
import {
  SemanticLifecycle,
  type SemanticLifecycleOptions,
  type SemanticLifecycleListener,
} from './lifecycle.js';

/**
 * Recall options accepted by {@link SemanticRuntimeAdapter.recall}.
 */
export interface SemanticRecallOptions {
  /**
   * Maximum number of results to return. Defaults to the store's
   * `defaultLimit`.
   */
  readonly limit?: number;

  /**
   * Minimum cosine similarity for a result to be returned. Defaults to the
   * store's configured threshold.
   */
  readonly threshold?: number;
}

/**
 * Coerce a runtime value into a fact string.
 *
 * Strings are used verbatim; objects carrying a `fact` field yield that field;
 * any other value is stringified. Used by {@link SemanticRuntimeAdapter.set}.
 *
 * @param value - the value to coerce
 * @returns the fact text
 */
export function toFact(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { fact?: unknown }).fact === 'string') {
    return (value as { fact: string }).fact;
  }
  return String(value);
}

/**
 * Read entry options out of a metadata bag.
 *
 * Maps the conventional keys `tags`, `source`, `confidence`, `subject`,
 * `predicate`, `object`, `embedding` and `id` onto {@link SemanticEntryOptions}.
 * Unknown keys are ignored, keeping the metadata contract permissive.
 *
 * @param metadata - the metadata bag from the runtime contract
 * @returns entry options to pass to `SemanticStore.put`
 */
export function optionsFromMetadata(metadata: SemanticMetadata | undefined): SemanticEntryOptions {
  if (!metadata) {
    return {};
  }
  const out: {
    id?: SemanticEntryId;
    subject?: string;
    predicate?: string;
    object?: string;
    embedding?: number[];
    tags?: string[];
    source?: string;
    confidence?: Confidence;
  } = {};
  if (typeof metadata.id === 'string') {
    out.id = metadata.id as SemanticEntryId;
  }
  if (typeof metadata.subject === 'string') {
    out.subject = metadata.subject;
  }
  if (typeof metadata.predicate === 'string') {
    out.predicate = metadata.predicate;
  }
  if (typeof metadata.object === 'string') {
    out.object = metadata.object;
  }
  if (Array.isArray(metadata.embedding) && metadata.embedding.every((v) => typeof v === 'number')) {
    out.embedding = metadata.embedding as number[];
  }
  if (Array.isArray(metadata.tags)) {
    out.tags = metadata.tags.filter((v) => typeof v === 'string') as string[];
  }
  if (typeof metadata.source === 'string') {
    out.source = metadata.source;
  }
  if (typeof metadata.confidence === 'number') {
    out.confidence = metadata.confidence as Confidence;
  }
  return out;
}

/**
 * A fully-wired semantic memory exposing the {@link RuntimeMemory} contract.
 *
 * The adapter wraps a {@link SemanticStore}, {@link SemanticIndex},
 * {@link SemanticRetriever} and optional {@link SemanticLifecycle}. Its
 * asynchronous key/value methods mirror working and episodic memory so that
 * the same consumer can be pointed at any of the three; its `search` and
 * `recall` methods expose the semantic superpowers.
 */
export class SemanticRuntimeAdapter implements RuntimeMemory {
  private readonly store: SemanticStore;
  private readonly index: SemanticIndex;
  private readonly retriever: SemanticRetriever;
  private readonly lifecycle: SemanticLifecycle | undefined;

  /**
   * Construct an adapter from pre-built components.
   *
   * Prefer {@link createSemanticAdapter} unless you need to share the store,
   * index or retriever with other code.
   *
   * @param components - the wired components
   */
  constructor(components: {
    store: SemanticStore;
    index: SemanticIndex;
    retriever: SemanticRetriever;
    lifecycle?: SemanticLifecycle;
  }) {
    this.store = components.store;
    this.index = components.index;
    this.retriever = components.retriever;
    this.lifecycle = components.lifecycle;
  }

  /**
   * Store a value under a key, indexing it for semantic search.
   *
   * The value is coerced to a fact with {@link toFact}; metadata may supply
   * tags, source, confidence, triple fields or an embedding (see
   * {@link optionsFromMetadata}). If the key already holds an entry it is
   * overwritten and re-indexed.
   *
   * @param key - the entry id to store under
   * @param value - the fact value to store
   * @param metadata - optional metadata mapped to entry options
   */
  async set(key: string, value: unknown, metadata?: SemanticMetadata): Promise<void> {
    const fact = toFact(value);
    const options = optionsFromMetadata(metadata);
    if (this.store.has(key)) {
      this.index.removeEntry(key);
    }
    const entry = this.store.put(fact, { ...options, id: key });
    this.index.indexEntry(entry);
  }

  /**
   * Retrieve the entry stored under a key.
   *
   * @param key - the entry id to look up
   * @returns the stored {@link SemanticEntry}, or `undefined` when absent
   */
  async get(key: string): Promise<SemanticEntry | undefined> {
    return this.store.get(key);
  }

  /**
   * Remove the entry stored under a key, un-indexing it.
   *
   * @param key - the entry id to delete
   * @returns `true` when an entry existed and was removed
   */
  async delete(key: string): Promise<boolean> {
    const existed = this.store.delete(key);
    if (existed) {
      this.index.removeEntry(key);
    }
    return existed;
  }

  /**
   * Whether a key currently holds an entry.
   *
   * @param key - the entry id to test
   * @returns `true` when present
   */
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /**
   * All currently-stored entry ids.
   *
   * @returns an array of entry ids
   */
  async keys(): Promise<string[]> {
    return this.store.keys();
  }

  /**
   * Remove every entry and index state.
   */
  async clear(): Promise<void> {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Aggregate statistics about the current contents.
   *
   * @returns a fresh {@link SemanticStats} snapshot
   */
  async stats(): Promise<SemanticStats> {
    return this.store.stats();
  }

  /**
   * Search stored knowledge for entries semantically similar to a query.
   *
   * @param query - the query text to search for
   * @param limit - maximum number of results (or an options object)
   * @returns ranked {@link SemanticHit}s above the threshold
   */
  search(query: string, limit?: number | SemanticRetrievalOptions): SemanticHit[] {
    return this.retriever.search(query, limit);
  }

  /**
   * Recall knowledge relevant to a piece of context.
   *
   * `context` may be a single string or an array of strings. When it is an
   * array, the vectors of every element are averaged into a single query
   * vector, which lets callers recall against a bundle of recent context
   * (messages, tool outputs) rather than one phrase.
   *
   * @param context - the context string (or array of strings) to recall against
   * @param options - optional limit and threshold
   * @returns ranked {@link SemanticHit}s
   */
  recall(
    context: string | readonly string[],
    options?: SemanticRecallOptions,
  ): SemanticHit[] {
    const contexts = Array.isArray(context) ? context : [context];
    const vectors = contexts
      .map((text) => this.index.computeVector(text))
      .filter((vector) => vector.length > 0);
    if (vectors.length === 0) {
      return [];
    }
    const dim = vectors[0]?.length ?? 0;
    if (dim === 0) {
      return [];
    }
    const averaged = new Array<number>(dim).fill(0);
    for (const vector of vectors) {
      for (let i = 0; i < averaged.length; i += 1) {
        averaged[i] = (averaged[i] ?? 0) + (vector[i] ?? 0);
      }
    }
    for (let i = 0; i < averaged.length; i += 1) {
      averaged[i] = (averaged[i] ?? 0) / vectors.length;
    }
    return this.retriever.searchWithin(averaged, options);
  }

  /**
   * Expose the underlying lifecycle for housekeeping.
   *
   * @returns the lifecycle, or `undefined` when this adapter was built without
   * one
   */
  get lifecycleInstance(): SemanticLifecycle | undefined {
    return this.lifecycle;
  }

  /**
   * Subscribe to lifecycle events, when a lifecycle is attached.
   *
   * @param type - the event type to subscribe to
   * @param listener - the callback to invoke
   * @returns `this` for chaining, or `this` unchanged when no lifecycle exists
   */
  on(type: 'prune' | 'dedupe' | 'decay' | 'normalize', listener: SemanticLifecycleListener): this {
    this.lifecycle?.on(type, listener);
    return this;
  }

  /**
   * Run a lifecycle prune over the adapter's store.
   *
   * @param maxEntries - the target maximum entry count
   * @returns the prune result
   */
  prune(maxEntries: number) {
    return this.lifecycle?.prune(maxEntries);
  }

  /**
   * Deduplicate the adapter's store.
   *
   * @returns the dedupe result
   */
  dedupe() {
    return this.lifecycle?.dedupe();
  }

  /**
   * Decay stale knowledge in the adapter's store.
   *
   * @param olderThanMs - minimum age in milliseconds
   * @returns the decay result
   */
  decayStale(olderThanMs: number) {
    return this.lifecycle?.decayStale(olderThanMs);
  }

  /**
   * Normalise (recompute) the index from the adapter's store.
   *
   * @returns the normalise result
   */
  normalize() {
    return this.lifecycle?.normalize();
  }
}

/**
 * Build a fully-wired semantic adapter from a {@link SemanticConfig}.
 *
 * Creates a store, TF-IDF index, retriever and lifecycle, indexes any entries
 * already present in the store, and returns a ready-to-use
 * {@link SemanticRuntimeAdapter}.
 *
 * @param config - optional semantic configuration
 * @returns a wired adapter
 */
export function createSemanticAdapter(config?: SemanticConfig): SemanticRuntimeAdapter {
  const store = new SemanticStore(config);
  const index = new SemanticIndex();
  const retriever = new SemanticRetriever(store, index);
  const lifecycle = new SemanticLifecycle(store, index);
  index.rebuild(store.getAll());
  return new SemanticRuntimeAdapter({ store, index, retriever, lifecycle });
}

/**
 * A higher-level semantic knowledge base.
 *
 * {@link KnowledgeBase} is the friendly surface for agents that want to
 * accumulate facts over time and query them by meaning. It wraps the same
 * store/index/retriever/lifecycle wiring as the runtime adapter but exposes a
 * more domain-oriented API: `put` facts, `search` by meaning, `topK` for the
 * best matches, and lifecycle housekeeping via `prune`/`dedupe`/`decayStale`/
 * `normalize`.
 */
export class KnowledgeBase {
  private readonly store: SemanticStore;
  private readonly index: SemanticIndex;
  private readonly retriever: SemanticRetriever;
  private readonly lifecycle: SemanticLifecycle;

  /**
   * Construct a knowledge base from components.
   *
   * @param components - the wired components
   */
  constructor(components: {
    store: SemanticStore;
    index: SemanticIndex;
    retriever: SemanticRetriever;
    lifecycle: SemanticLifecycle;
  }) {
    this.store = components.store;
    this.index = components.index;
    this.retriever = components.retriever;
    this.lifecycle = components.lifecycle;
  }

  /**
   * Store a fact in the knowledge base.
   *
   * The entry is persisted and immediately indexed, so it is searchable by the
   * next query. See {@link SemanticStore.put} for the semantics of `opts`.
   *
   * @param fact - the fact text to store
   * @param opts - optional entry options
   * @returns the canonical stored entry
   */
  put(fact: string, opts?: SemanticEntryOptions): SemanticEntry {
    const entry = this.store.put(fact, opts);
    this.index.indexEntry(entry);
    return entry;
  }

  /**
   * Retrieve an entry by id.
   *
   * @param id - the entry id to look up
   * @returns the stored entry, or `undefined` when absent
   */
  get(id: SemanticEntryId): SemanticEntry | undefined {
    return this.store.get(id);
  }

  /**
   * Delete an entry by id, un-indexing it.
   *
   * @param id - the entry id to delete
   * @returns `true` when an entry existed and was removed
   */
  delete(id: SemanticEntryId): boolean {
    const existed = this.store.delete(id);
    if (existed) {
      this.index.removeEntry(id);
    }
    return existed;
  }

  /**
   * Whether an entry id is stored.
   *
   * @param id - the entry id to test
   * @returns `true` when present
   */
  has(id: SemanticEntryId): boolean {
    return this.store.has(id);
  }

  /**
   * All currently-stored entry ids.
   *
   * @returns an array of entry ids
   */
  keys(): SemanticEntryId[] {
    return this.store.keys();
  }

  /**
   * Update a stored entry.
   *
   * @param id - the entry id to update
   * @param patch - the fields to change
   * @returns the updated entry
   * @throws {Error} when the entry does not exist
   */
  update(id: SemanticEntryId, patch: SemanticPatch): SemanticEntry {
    const entry = this.store.update(id, patch);
    this.index.removeEntry(id);
    this.index.indexEntry(entry);
    return entry;
  }

  /**
   * Search the knowledge base by meaning.
   *
   * @param query - the query text
   * @param limit - maximum number of results (or an options object)
   * @returns ranked {@link SemanticHit}s above the threshold
   */
  search(query: string, limit?: number | SemanticRetrievalOptions): SemanticHit[] {
    return this.retriever.search(query, limit);
  }

  /**
   * Return the top `k` best matches for a query.
   *
   * @param query - the query text
   * @param k - the maximum number of results
   * @returns the top `k` ranked {@link SemanticHit}s
   */
  topK(query: string, k: number): SemanticHit[] {
    return this.retriever.topK(query, k);
  }

  /**
   * Entries most similar to a stored entry.
   *
   * @param id - the entry id to compare against
   * @param limit - maximum number of results (or an options object)
   * @returns ranked {@link SemanticHit}s
   */
  similarTo(id: SemanticEntryId, limit?: number | SemanticRetrievalOptions): SemanticHit[] {
    return this.retriever.similarTo(id, limit);
  }

  /**
   * Entries carrying a given tag.
   *
   * @param tags - the tags to match
   * @returns matching entries
   */
  byTag(tags: readonly string[]) {
    return this.retriever.byTag(tags);
  }

  /**
   * Entries with a given triple subject.
   *
   * @param subject - the subject to match
   * @returns matching entries
   */
  bySubject(subject: string) {
    return this.retriever.bySubject(subject);
  }

  /**
   * Entries whose confidence is at least `min`.
   *
   * @param min - minimum confidence in `[0, 1]`
   * @returns matching entries, best-confidence first
   */
  byConfidence(min: Confidence) {
    return this.retriever.byConfidence(min);
  }

  /**
   * All entries currently stored.
   *
   * @returns an array of entries
   */
  facts(): SemanticEntry[] {
    return this.store.getAll();
  }

  /**
   * Number of facts stored.
   *
   * @returns the entry count
   */
  size(): number {
    return this.store.size();
  }

  /**
   * Aggregate statistics about the knowledge base.
   *
   * @returns a fresh {@link SemanticStats} snapshot
   */
  stats(): SemanticStats {
    return this.store.stats();
  }

  /**
   * Remove every fact.
   */
  clear(): void {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Prune the knowledge base to at most `maxEntries` facts.
   *
   * @param maxEntries - the target maximum entry count
   * @returns the prune result
   */
  prune(maxEntries: number) {
    return this.lifecycle.prune(maxEntries);
  }

  /**
   * Deduplicate identical facts.
   *
   * @returns the dedupe result
   */
  dedupe() {
    return this.lifecycle.dedupe();
  }

  /**
   * Decay stale facts.
   *
   * @param olderThanMs - minimum age in milliseconds
   * @returns the decay result
   */
  decayStale(olderThanMs: number) {
    return this.lifecycle.decayStale(olderThanMs);
  }

  /**
   * Recompute all TF-IDF vectors.
   *
   * @returns the normalise result
   */
  normalize() {
    return this.lifecycle.normalize();
  }

  /**
   * Subscribe to lifecycle events.
   *
   * @param type - the event type
   * @param listener - the callback
   * @returns `this` for chaining
   */
  on(type: 'prune' | 'dedupe' | 'decay' | 'normalize', listener: SemanticLifecycleListener): this {
    this.lifecycle.on(type, listener);
    return this;
  }

  /**
   * Serialise the knowledge base contents to a JSON snapshot.
   *
   * @returns a snapshot suitable for `JSON.stringify`
   */
  toJSON() {
    return this.store.toJSON();
  }

  /**
   * Restore the knowledge base from a JSON snapshot.
   *
   * @param snapshot - the snapshot to load
   * @returns the number of entries restored
   */
  fromJSON(snapshot: string | SemanticSnapshot): number {
    const count = this.store.fromJSON(snapshot);
    this.index.rebuild(this.store.getAll());
    return count;
  }

  /**
   * Build a knowledge base from a config.
   *
   * @param config - optional semantic configuration
   * @returns a ready-to-use knowledge base
   */
  static create(config?: SemanticConfig): KnowledgeBase {
    const store = new SemanticStore(config);
    const index = new SemanticIndex(store.getAll());
    const retriever = new SemanticRetriever(store, index);
    const lifecycle = new SemanticLifecycle(store, index);
    return new KnowledgeBase({ store, index, retriever, lifecycle });
  }
}

/**
 * Convenience factory: build a knowledge base from a config.
 *
 * Equivalent to {@link KnowledgeBase.create}.
 *
 * @param config - optional semantic configuration
 * @returns a ready-to-use knowledge base
 */
export function createKnowledgeBase(config?: SemanticConfig): KnowledgeBase {
  return KnowledgeBase.create(config);
}