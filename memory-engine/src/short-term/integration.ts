/**
 * Runtime integration for short-term memory.
 *
 * This module adapts the short-term subsystem to the shape a host runtime
 * actually consumes. It exposes three things:
 *
 * - {@link ShortTermRuntimeAdapter} — a full `RuntimeMemory` implementation
 *   (set/get/delete/has/keys/clear/stats) plus retrieval (`search`,
 *   `recall`) and maintenance (`prune`, `touch`, `peek`). It keeps the
 *   {@link ShortTermIndex} synchronised with every store mutation, so it can
 *   be dropped straight into a runtime in place of a semantic or working-
 *   memory store.
 * - {@link createShortTermAdapter} — a factory that assembles a wired
 *   store + index + retriever (+ optional lifecycle) behind a single adapter.
 * - {@link ShortTermSession} — a per-session, namespaced view of short-term
 *   memory. Each session owns its own key namespace and scope, so concurrent
 *   sessions (users, agents, tool invocations) never collide even when they
 *   share an underlying store.
 *
 * The adapter's methods are asynchronous because the `RuntimeMemory` contract
 * is designed for runtimes that may eventually back the store with disk or a
 * database; the in-memory implementation simply resolves immediately. The
 * session is intentionally synchronous for lightweight in-process use.
 *
 * @packageDocumentation
 * @module short-term/integration
 */

import type {
  PruneResult,
  RuntimeMemory,
  ScoredEntry,
  SearchResult,
  ShortTermConfig,
  ShortTermEntry,
  ShortTermEntryOptions,
  ShortTermScope,
  ShortTermStats,
} from './types.js';
import { ShortTermIndex } from './index.js';
import { ShortTermLifecycle } from './lifecycle.js';
import { ShortTermRetriever } from './retrieval.js';
import type { ShortTermRetrievalOptions } from './retrieval.js';
import { ShortTermStore } from './store.js';

/**
 * Options accepted by {@link createShortTermAdapter}.
 *
 * Controls whether an automatic-prune lifecycle is attached to the adapter and
 * how the store/index/retriever are assembled.
 */
export interface ShortTermAdapterOptions {
  /**
   * When set (default `false`), a {@link ShortTermLifecycle} is attached to
   * the adapter and started with the given config. This enables automatic
   * TTL pruning; without it, expiry is still enforced lazily on reads and
   * manually via {@link ShortTermRuntimeAdapter.prune}.
   */
  readonly lifecycle?: boolean | ShortTermConfig;

  /**
   * Optional pre-existing store to wrap instead of constructing a new one.
   */
  readonly store?: ShortTermStore;

  /**
   * Optional pre-existing index to wrap instead of constructing a new one.
   */
  readonly index?: ShortTermIndex;
}

/**
 * Runtime-facing adapter implementing the uniform `RuntimeMemory` contract.
 *
 * See the module documentation for the data flow. All mutations synchronise
 * the index automatically, so `search`/`recall` (and any index-backed
 * retrieval) see a faithful view of the store.
 */
export class ShortTermRuntimeAdapter implements RuntimeMemory {
  private readonly store: ShortTermStore;
  private readonly index: ShortTermIndex;
  private readonly retriever: ShortTermRetriever;
  private readonly lifecycle?: ShortTermLifecycle;

  /**
   * Construct an adapter around a store and index.
   *
   * @param store - the store to wrap (defaults to a fresh one)
   * @param index - the index to keep synchronised (defaults to a fresh one)
   * @param lifecycle - optional lifecycle attached to the adapter
   */
  constructor(
    store: ShortTermStore = new ShortTermStore(),
    index: ShortTermIndex = new ShortTermIndex(),
    lifecycle?: ShortTermLifecycle,
  ) {
    this.store = store;
    this.index = index;
    this.retriever = new ShortTermRetriever(store, index);
    this.lifecycle = lifecycle;
  }

  /**
   * The underlying store, for callers that need direct access.
   */
  get storeView(): ShortTermStore {
    return this.store;
  }

  /**
   * The underlying index, for callers that need direct access.
   */
  get indexView(): ShortTermIndex {
    return this.index;
  }

  /**
   * The attached lifecycle, when one was supplied.
   */
  get lifecycleView(): ShortTermLifecycle | undefined {
    return this.lifecycle;
  }

  /**
   * Store a value under a key, indexing it for later retrieval.
   *
   * @param key - the identifier to store under
   * @param value - the payload to store
   * @param options - optional per-write tuning (TTL, tags, scope, metadata)
   */
  async set(key: string, value: unknown, options?: ShortTermEntryOptions): Promise<void> {
    const entry = this.store.put({ id: key, value, options });
    this.index.indexEntry(entry);
  }

  /**
   * Retrieve the value stored under a key.
   *
   * A successful read counts as an access (bumping the entry's frequency and
   * sliding its TTL when retention is `'sliding'`); expired entries resolve to
   * `undefined`.
   *
   * @param key - the identifier to read
   * @returns the stored value, or `undefined` when absent or expired
   */
  async get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  /**
   * Remove the value stored under a key.
   *
   * @param key - the identifier to remove
   * @returns `true` when a value existed and was removed
   */
  async delete(key: string): Promise<boolean> {
    const existed = this.store.delete(key);
    if (existed) {
      this.index.removeEntry(key);
    }
    return existed;
  }

  /**
   * Whether a key currently holds a live (non-expired) value.
   *
   * @param key - the identifier to test
   * @returns `true` when a live value exists
   */
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /**
   * All live keys currently held.
   *
   * @returns the live keys, in insertion order
   */
  async keys(): Promise<string[]> {
    return this.store.keys();
  }

  /**
   * Remove every value and clear the index.
   */
  async clear(): Promise<void> {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Aggregate statistics about the current contents.
   *
   * @returns a {@link ShortTermStats} snapshot
   */
  async stats(): Promise<ShortTermStats> {
    return this.store.stats();
  }

  /**
   * Search the store for a term.
   *
   * Runs a text-weighted hybrid retrieval and returns a structured
   * {@link SearchResult}. See {@link ShortTermRetriever.search}.
   *
   * @param query - the text to search for
   * @param opts - optional retrieval options (limit, weights, narrowing)
   * @returns the scored matches
   */
  async search(query: string, opts?: ShortTermRetrievalOptions): Promise<SearchResult> {
    return this.retriever.search(query, opts);
  }

  /**
   * Recall entries relevant to a context.
   *
   * Runs a hybrid retrieval blending recency, frequency and text match against
   * the supplied context. See {@link ShortTermRetriever.hybrid}.
   *
   * @param context - the current context text to match against
   * @param opts - optional retrieval options
   * @returns the scored, relevance-ordered entries
   */
  async recall(context: string, opts?: ShortTermRetrievalOptions): Promise<ScoredEntry[]> {
    return this.retriever.hybrid(context, opts);
  }

  /**
   * Inspect a key without recording an access.
   *
   * @param key - the identifier to inspect
   * @returns the stored entry, or `undefined` when absent or expired
   */
  async peek(key: string): Promise<ShortTermEntry | undefined> {
    return this.store.peek(key);
  }

  /**
   * Record an access against a key without reading its value.
   *
   * Useful for keeping a sliding TTL alive for keys consumed outside the
   * store.
   *
   * @param key - the identifier to touch
   * @returns the touched entry, or `undefined` when absent or expired
   */
  async touch(key: string): Promise<ShortTermEntry | undefined> {
    const touched = this.store.touch(key);
    if (touched) {
      this.index.indexEntry(touched);
    }
    return touched;
  }

  /**
   * Expire expired entries and enforce the maximum-entry bound.
   *
   * Synchronises the index for every removed entry. When a lifecycle is
   * attached, prefer letting it run; this method is for explicit, on-demand
   * maintenance.
   *
   * @returns the {@link PruneResult} of the pass
   */
  async prune(): Promise<PruneResult> {
    const result = this.store.prune();
    for (const id of result.removedIds) {
      this.index.removeEntry(id);
    }
    return result;
  }

  /**
   * Wipe the store and index, then return how many entries were discarded.
   *
   * @returns the number of entries discarded
   */
  async reset(): Promise<number> {
    const removed = this.store.size();
    await this.clear();
    return removed;
  }
}

/**
 * Factory for a fully-wired short-term runtime adapter.
 *
 * Assembles a store, index, retriever and (optionally) a started lifecycle
 * into a single {@link ShortTermRuntimeAdapter}. When `options.lifecycle` is
 * set, automatic TTL pruning runs on the supplied config's
 * `pruneIntervalMs`.
 *
 * @param config - store configuration (capacity, defaults, scope)
 * @param options - assembly options (lifecycle, existing store/index)
 * @returns a ready-to-use adapter
 */
export function createShortTermAdapter(
  config?: ShortTermConfig,
  options: ShortTermAdapterOptions = {},
): ShortTermRuntimeAdapter {
  const store = options.store ?? new ShortTermStore(config);
  const index = options.index ?? new ShortTermIndex();
  index.rebuild(store.entries());
  let lifecycle: ShortTermLifecycle | undefined;
  if (options.lifecycle) {
    const lifecycleConfig: ShortTermConfig =
      options.lifecycle === true ? config ?? {} : options.lifecycle;
    lifecycle = new ShortTermLifecycle(store, index).start(lifecycleConfig);
  }
  return new ShortTermRuntimeAdapter(store, index, lifecycle);
}

/**
 * Monotonic counter used to generate default session ids.
 */
let sessionCounter = 0;

/**
 * Generate a unique, human-readable session id.
 *
 * Combines a monotonic counter with a timestamp suffix so ids are unique
 * within a process and roughly ordered by creation time.
 *
 * @returns a fresh session id
 */
export function generateSessionId(): string {
  sessionCounter += 1;
  return `session-${sessionCounter}-${Date.now().toString(36)}`;
}

/**
 * Options accepted by the {@link ShortTermSession} constructor.
 */
export interface ShortTermSessionOptions {
  /**
   * Explicit session id. Defaults to a generated one (see
   * {@link generateSessionId}).
   */
  readonly sessionId?: string;

  /**
   * Namespace prefix for the session's keys. Defaults to `'session'`.
   */
  readonly namespace?: string;

  /**
   * Store configuration for the session's backing store (used when no shared
   * store is supplied).
   */
  readonly config?: ShortTermConfig;

  /**
   * Shared store to back this session with (enables cheap multi-session
   * isolation over one store — the key namespace prevents collisions).
   */
  readonly store?: ShortTermStore;

  /**
   * Shared index to back this session with.
   */
  readonly index?: ShortTermIndex;

  /**
   * When `true` (default `false`), attach and start a
   * {@link ShortTermLifecycle} so TTL pruning runs automatically for this
   * session.
   */
  readonly startLifecycle?: boolean;

  /**
   * Prune interval in milliseconds used when `startLifecycle` is enabled.
   * Defaults to `30_000`.
   */
  readonly pruneIntervalMs?: number;
}

/**
 * A per-session, namespaced view of short-term memory.
 *
 * Each session scopes every write under its own key namespace and scope tag,
 * so two sessions backed by the *same* store never observe each other's keys.
 * This makes it safe to hold one store for a whole process while giving each
 * session (user, agent, tool call) a private working set.
 *
 * Unlike the asynchronous {@link ShortTermRuntimeAdapter}, session methods are
 * synchronous — the session is a lightweight, in-process convenience.
 */
export class ShortTermSession {
  readonly sessionId: string;
  readonly namespace: string;
  readonly scope: ShortTermScope;

  private readonly store: ShortTermStore;
  private readonly index: ShortTermIndex;
  private readonly retriever: ShortTermRetriever;
  private readonly lifecycle?: ShortTermLifecycle;
  private ended = false;

  /**
   * Construct a session.
   *
   * @param options - session identity and backing options
   */
  constructor(options: ShortTermSessionOptions = {}) {
    this.sessionId = options.sessionId ?? generateSessionId();
    this.namespace = options.namespace ?? 'session';
    this.scope = `${this.namespace}:${this.sessionId}`;
    this.store = options.store ?? new ShortTermStore(options.config);
    this.index = options.index ?? new ShortTermIndex();
    this.retriever = new ShortTermRetriever(this.store, this.index);
    if (options.startLifecycle) {
      this.lifecycle = new ShortTermLifecycle(this.store, this.index).start({
        ...options.config,
        pruneIntervalMs: options.pruneIntervalMs ?? 30_000,
      });
    }
  }

  /**
   * The key namespace this session writes under.
   *
   * @param key - the caller-facing key
   * @returns the fully namespaced storage key
   */
  private namespaced(key: string): string {
    return `${this.scope}:${key}`;
  }

  /**
   * Strip the session's namespace from a storage key.
   *
   * @param key - a storage key (namespaced or not)
   * @returns the caller-facing key, or the input unchanged when it does not
   *   belong to this session
   */
  private denamespace(key: string): string {
    const prefix = `${this.scope}:`;
    return key.startsWith(prefix) ? key.slice(prefix.length) : key;
  }

  /**
   * Guard against use after {@link ShortTermSession.end}.
   */
  private assertActive(): void {
    if (this.ended) {
      throw new Error(`ShortTermSession "${this.sessionId}" has ended`);
    }
  }

  /**
   * Store a value in this session's working set.
   *
   * @param key - the session-local identifier
   * @param value - the payload to store
   * @param options - optional per-write tuning (scope defaults to the session)
   * @returns the stored {@link ShortTermEntry}
   */
  set(key: string, value: unknown, options?: ShortTermEntryOptions): ShortTermEntry {
    this.assertActive();
    const entry = this.store.put({
      id: this.namespaced(key),
      value,
      options: { ...options, scope: options?.scope ?? this.scope },
    });
    this.index.indexEntry(entry);
    return entry;
  }

  /**
   * Retrieve a value from this session's working set.
   *
   * @param key - the session-local identifier
   * @returns the stored value, or `undefined` when absent or expired
   */
  get(key: string): unknown {
    this.assertActive();
    return this.store.get(this.namespaced(key));
  }

  /**
   * Remove a value from this session's working set.
   *
   * @param key - the session-local identifier
   * @returns `true` when a value existed and was removed
   */
  delete(key: string): boolean {
    this.assertActive();
    const existed = this.store.delete(this.namespaced(key));
    if (existed) {
      this.index.removeEntry(this.namespaced(key));
    }
    return existed;
  }

  /**
   * Whether this session holds a live value under a key.
   *
   * @param key - the session-local identifier
   * @returns `true` when a live value exists
   */
  has(key: string): boolean {
    this.assertActive();
    return this.store.has(this.namespaced(key));
  }

  /**
   * All live keys in this session, namespace stripped.
   *
   * @returns the session-local keys, in insertion order
   */
  keys(): string[] {
    this.assertActive();
    return this.store
      .keys()
      .filter((k) => k.startsWith(`${this.scope}:`))
      .map((k) => this.denamespace(k));
  }

  /**
   * The number of live entries in this session.
   *
   * @returns the session entry count
   */
  size(): number {
    return this.store.size();
  }

  /**
   * Remove every value from this session's working set.
   */
  clear(): void {
    this.assertActive();
    for (const key of this.keys()) {
      this.delete(key);
    }
  }

  /**
   * Aggregate statistics for the session's backing store.
   *
   * @returns a {@link ShortTermStats} snapshot
   */
  stats(): ShortTermStats {
    return this.store.stats();
  }

  /**
   * Search this session's working set for a term.
   *
   * @param query - the text to search for
   * @param opts - optional retrieval options
   * @returns the scored matches
   */
  search(query: string, opts?: ShortTermRetrievalOptions): SearchResult {
    this.assertActive();
    return this.retriever.search(query, opts);
  }

  /**
   * Recall entries relevant to a context from this session's working set.
   *
   * @param context - the context text to match against
   * @param opts - optional retrieval options
   * @returns the scored, relevance-ordered entries
   */
  recall(context: string, opts?: ShortTermRetrievalOptions): ScoredEntry[] {
    this.assertActive();
    return this.retriever.hybrid(context, opts);
  }

  /**
   * Serialise this session's working set to a JSON snapshot.
   *
   * Only this session's entries are exported; shared-store entries from other
   * sessions are excluded.
   *
   * @returns a JSON-safe snapshot object
   */
  toJSON(): unknown {
    const entries = this.store
      .entries()
      .filter((e) => e.scope === this.scope)
      .map((e) => ({ ...e }));
    return { sessionId: this.sessionId, scope: this.scope, entries };
  }

  /**
   * End the session and reclaim its resources.
   *
   * Stops any lifecycle timer, removes every session entry from the store and
   * index, and marks the session inactive so further method calls throw.
   */
  end(): void {
    if (this.ended) {
      return;
    }
    this.lifecycle?.dispose();
    for (const key of this.keys()) {
      this.store.delete(this.namespaced(key));
      this.index.removeEntry(this.namespaced(key));
    }
    this.ended = true;
  }
}

/**
 * Create a short-term runtime adapter configured like a classic working-memory
 * store: bounded, sliding TTL by default, and automatic pruning enabled.
 *
 * @param ttlMs - default TTL in milliseconds for entries
 * @param maxEntries - maximum number of entries to retain
 * @param pruneIntervalMs - automatic prune cadence in milliseconds
 * @returns a wired, pruning {@link ShortTermRuntimeAdapter}
 */
export function createWorkingMemory(
  ttlMs: number,
  maxEntries = 1000,
  pruneIntervalMs = 30_000,
): ShortTermRuntimeAdapter {
  return createShortTermAdapter(
    {
      defaultTtlMs: ttlMs,
      maxEntries,
      pruneIntervalMs,
      retention: 'sliding',
    },
    { lifecycle: true },
  );
}