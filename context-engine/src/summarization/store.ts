/**
 * Result cache for the Summarization layer of the standalone MAM Context
 * Engine.
 *
 * {@link SummarizationStore} is the mutable heart of the layer: a keyed
 * registry of {@link SummaryResult}s that answers every caching question —
 * *"have we already summarised this document?"* — and applies every state
 * change — *"store this digest, drop that one"* — through a single,
 * well-guarded API.
 *
 * Responsibilities:
 *
 * - **Registry** — {@link SummarizationStore.put} / {@link SummarizationStore
 *   .get} / {@link SummarizationStore.has} / {@link SummarizationStore.delete}
 *   / {@link SummarizationStore.keys} / {@link SummarizationStore.clear} /
 *   {@link SummarizationStore.size} manage which results are cached at all.
 * - **Batch** — {@link SummarizationStore.putMany} stores many results in one
 *   call (returning the count written), and {@link SummarizationStore
 *   .getByKey} resolves a stored entry with its bookkeeping timestamps.
 * - **Inspect** — {@link SummarizationStore.entries} /
 *   {@link SummarizationStore.values} / {@link SummarizationStore.forEach} /
 *   {@link SummarizationStore.stats} expose live state without mutating it.
 * - **Recency** — {@link SummarizationStore.touch} and the LRU semantics of
 *   {@link SummarizationStore.get} give the lifecycle a deterministic
 *   eviction signal: entries move to the end of the internal map when read or
 *   written, so the *oldest* entries are the least-recently-used.
 * - **Persist** — {@link SummarizationStore.toJSON} /
 *   {@link SummarizationStore.fromJSON} round-trip the whole cache through
 *   plain JSON, so a live cache survives restarts.
 *
 * The store extends `node:events`' `EventEmitter` and emits `'put'`, `'hit'`,
 * `'delete'`, `'clear'` and `'restore'` events carrying lightweight payloads,
 * which lets {@link SummarizationLifecycle} observe and react without polling.
 *
 * Keys are arbitrary strings supplied by the caller; the integration layer
 * derives them from a hash of the source text plus the effective options (see
 * `hashString` in `types.ts`), but the store itself never guesses keys.
 *
 * @module summarization/store
 */

import { EventEmitter } from 'node:events';

import {
  clampLength,
  emptySummarizationStats,
  isSummaryResult,
} from './types.js';
import type {
  KeyPoint,
  SummarizationStats,
  SummarizeTechnique,
  SummaryResult,
  Timestamp,
} from './types.js';

/**
 * A single cache entry: the result plus its bookkeeping timestamps.
 *
 * Returned by {@link SummarizationStore.getByKey} and
 * {@link SummarizationStore.entries} so callers that need to reason about
 * age (lifecycle pruning, eviction, debugging) can do so without guessing.
 */
export interface SummarizationStoreEntry {
  /**
   * The key the entry was stored under.
   */
  readonly key: string;

  /**
   * The stored {@link SummaryResult}.
   */
  readonly result: SummaryResult;

  /**
   * Epoch-millisecond time the entry was first stored.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time the entry was last stored or touched.
   */
  readonly updatedAt: Timestamp;
}

/**
 * A serialisable snapshot of the whole result cache.
 *
 * Returned by {@link SummarizationStore.toJSON} and accepted by
 * {@link SummarizationStore.fromJSON}, so a live cache can be persisted and
 * restored verbatim. All numbers are plain integers; the payload carries no
 * functions, classes or timers.
 */
export interface SummarizationStoreState {
  /**
   * Every cached entry, in recency order (oldest first).
   */
  readonly entries: readonly SummarizationStoreEntry[];

  /**
   * Epoch-millisecond time the cache was first created.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time the cache was last modified.
   */
  readonly updatedAt: Timestamp;
}

/**
 * Construction options for a {@link SummarizationStore}.
 */
export interface SummarizationStoreOptions {
  /**
   * Clock used for all timestamps. Injecting a clock makes the store
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * A minimal event payload shared by every event this store emits.
 */
export interface SummarizationEventPayload {
  /**
   * The key the event concerns (`'*'` for whole-cache events).
   */
  readonly key: string;

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly timestamp: Timestamp;
}

/**
 * The keyed result cache.
 *
 * See the module documentation for the full responsibility list. The store
 * combines the raw {@link SummaryResult} registry with the LRU recency
 * ordering, the monotonic behaviour counters and the JSON persistence, so
 * every layer above it can assume results are always consistent: keys are
 * unique, timestamps are non-decreasing, and counters never regress.
 *
 * @example
 * ```ts
 * const store = new SummarizationStore();
 * store.put('doc:42', result);
 * store.get('doc:42');        // the cached summary, or undefined
 * store.stats().hits;         // 1
 * ```
 */
export class SummarizationStore extends EventEmitter {
  /**
   * Key→entry registry, in recency order (oldest first).
   */
  private readonly registry: Map<string, SummarizationStoreEntry> = new Map();

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  private updatedAt: Timestamp;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * Number of `put`/`putMany` operations since construction.
   */
  private putCount = 0;

  /**
   * Number of `get`/`getByKey` operations since construction.
   */
  private getCount = 0;

  /**
   * Number of `get`/`getByKey` operations that hit since construction.
   */
  private hitCount = 0;

  /**
   * Number of `get`/`getByKey` operations that missed since construction.
   */
  private missCount = 0;

  /**
   * Number of `delete` operations since construction.
   */
  private deleteCount = 0;

  /**
   * Number of `clear` operations since construction.
   */
  private clearCount = 0;

  /**
   * Construct a new result cache.
   *
   * @param options - construction options (notably the clock)
   */
  constructor(options: SummarizationStoreOptions = {}) {
    super();
    this.now = options.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.updatedAt = this.createdAt;
  }

  /**
   * Record a state change: bump `updatedAt` to now.
   *
   * @param at - the epoch-millisecond time to stamp
   */
  private recordChange(at: Timestamp): void {
    this.updatedAt = at;
  }

  /**
   * Insert or replace a cached result under a key.
   *
   * Values are validated structurally via {@link isSummaryResult}; malformed
   * inputs are rejected with `undefined` returned and `false` signalled to the
   * caller. A fresh entry gets both `createdAt` and `updatedAt` set to now; a
   * replaced entry keeps its original `createdAt`. Emits a `'put'` event.
   *
   * @param key - the cache key
   * @param result - the result to store
   * @returns the stored result (normalised), or `undefined` when rejected
   */
  put(key: string, result: SummaryResult): SummaryResult | undefined {
    if (!isSummaryResult(result)) {
      return undefined;
    }
    const at = this.now();
    const existing = this.registry.get(key);
    const entry: SummarizationStoreEntry = {
      key,
      result: {
        summary: result.summary,
        technique: result.technique,
        originalLength: clampLength(result.originalLength),
        summaryLength: clampLength(result.summaryLength),
        ratio: result.ratio,
        ...(result.keyPoints && result.keyPoints.length > 0
          ? { keyPoints: result.keyPoints.map((kp) => ({ ...kp })) }
          : {}),
      },
      createdAt: existing ? existing.createdAt : at,
      updatedAt: at,
    };
    this.registry.set(key, entry);
    this.putCount += 1;
    this.recordChange(at);
    this.emit('put', { key, timestamp: at } satisfies SummarizationEventPayload);
    return entry.result;
  }

  /**
   * Store many results in a single call.
   *
   * Equivalent to calling {@link SummarizationStore.put} for each pair; the
   * batch is applied in iterable order and each accepted pair emits its own
   * `'put'` event. Invalid results are skipped.
   *
   * @param batch - an iterable of `[key, result]` pairs
   * @returns the number of results actually stored
   */
  putMany(batch: Iterable<readonly [string, SummaryResult]>): number {
    let stored = 0;
    for (const [key, result] of batch) {
      if (this.put(key, result) !== undefined) {
        stored += 1;
      }
    }
    return stored;
  }

  /**
   * Fetch a cached result without exposing internal bookkeeping.
   *
   * A successful read counts as a *use*: the entry is moved to the end of the
   * internal map (LRU recency) so lifecycle pruning can evict the oldest —
   * least-recently-used — entries first. Returns a copy of the result to
   * prevent callers from mutating internal state.
   *
   * @param key - the cache key
   * @returns a copy of the cached {@link SummaryResult}, or `undefined` on a
   *   miss
   */
  get(key: string): SummaryResult | undefined {
    const found = this.getByKey(key);
    return found ? { ...found.result } : undefined;
  }

  /**
   * Test whether a key is currently cached.
   *
   * Unlike {@link SummarizationStore.get}, `has` is a pure registry lookup —
   * it does not update recency and is not counted as a hit/miss.
   *
   * @param key - the cache key
   * @returns `true` when the key has an entry
   */
  has(key: string): boolean {
    return this.registry.has(key);
  }

  /**
   * Remove a cached result entirely.
   *
   * Emits a `'delete'` event only when an entry existed and was removed.
   *
   * @param key - the cache key
   * @returns `true` when an entry existed and was removed
   */
  delete(key: string): boolean {
    const removed = this.registry.delete(key);
    if (removed) {
      this.deleteCount += 1;
      const at = this.now();
      this.recordChange(at);
      this.emit('delete', { key, timestamp: at } satisfies SummarizationEventPayload);
    }
    return removed;
  }

  /**
   * The keys of every cached result, in recency order (oldest first).
   *
   * @returns a fresh array of cache keys
   */
  keys(): string[] {
    return [...this.registry.keys()];
  }

  /**
   * Remove every cached result, returning the store to an empty cache.
   *
   * Behaviour counters are retained (so `stats().puts` is still meaningful),
   * but all entries are dropped. Emits a `'clear'` event.
   */
  clear(): void {
    this.registry.clear();
    this.clearCount += 1;
    const at = this.now();
    this.recordChange(at);
    this.emit('clear', { key: '*', timestamp: at } satisfies SummarizationEventPayload);
  }

  /**
   * The number of results currently cached.
   */
  get size(): number {
    return this.registry.size;
  }

  /**
   * Fetch a cached entry including its bookkeeping timestamps.
   *
   * Like {@link SummarizationStore.get}, a hit counts as a *use* (LRU recency
   * update) and is counted against `gets`/`hits`. Returns a shallow copy of
   * the entry so callers cannot mutate internal state through it.
   *
   * @param key - the cache key
   * @returns a copy of the {@link SummarizationStoreEntry}, or `undefined` on
   *   a miss
   */
  getByKey(key: string): SummarizationStoreEntry | undefined {
    this.getCount += 1;
    const entry = this.registry.get(key);
    if (!entry) {
      this.missCount += 1;
      return undefined;
    }
    this.hitCount += 1;
    this.registry.delete(key);
    this.registry.set(key, entry);
    const at = this.now();
    const refreshed: SummarizationStoreEntry = { ...entry, updatedAt: at };
    this.registry.set(key, refreshed);
    this.recordChange(at);
    this.emit('hit', { key, timestamp: at } satisfies SummarizationEventPayload);
    return { ...refreshed, result: { ...refreshed.result } };
  }

  /**
   * Every cached entry, in recency order (oldest first).
   *
   * @returns a fresh array of {@link SummarizationStoreEntry} copies
   */
  entries(): SummarizationStoreEntry[] {
    return [...this.registry.values()].map((entry) => ({
      key: entry.key,
      result: { ...entry.result },
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }));
  }

  /**
   * Every cached result, in recency order (oldest first).
   *
   * @returns a fresh array of {@link SummaryResult} copies
   */
  values(): SummaryResult[] {
    return [...this.registry.values()].map((entry) => ({ ...entry.result }));
  }

  /**
   * Visit every entry in recency order.
   *
   * @param callback - invoked with `(result, key, entry)` per entry
   */
  forEach(
    callback: (
      result: SummaryResult,
      key: string,
      entry: SummarizationStoreEntry,
    ) => void,
  ): void {
    for (const [key, entry] of this.registry) {
      callback({ ...entry.result }, key, { ...entry, result: { ...entry.result } });
    }
  }

  /**
   * Mark a key as recently-used without reading its value.
   *
   * Moves the entry to the end of the recency order and refreshes its
   * `updatedAt`. Useful for callers that reference a summary's key without
   * wanting the full {@link SummarizationStore.get} semantics.
   *
   * @param key - the cache key
   * @returns `true` when the key existed and was touched
   */
  touch(key: string): boolean {
    const entry = this.registry.get(key);
    if (!entry) {
      return false;
    }
    this.registry.delete(key);
    const at = this.now();
    const refreshed: SummarizationStoreEntry = { ...entry, updatedAt: at };
    this.registry.set(key, refreshed);
    this.recordChange(at);
    return true;
  }

  /**
   * Aggregate counters for this store.
   *
   * Behaviour counters are monotonic since construction; state-derived fields
   * (`results`, `byTechnique`, the character totals, `averageRatio`) are
   * computed on demand from the live cache.
   *
   * @returns a {@link SummarizationStats} snapshot
   */
  stats(): SummarizationStats {
    const stats = emptySummarizationStats(this.updatedAt);
    const byTechnique: Record<SummarizeTechnique, number> = {
      extractive: 0,
      keyword: 0,
      rolling: 0,
    };
    let totalOriginal = 0;
    let totalSummary = 0;
    for (const entry of this.registry.values()) {
      byTechnique[entry.result.technique] += 1;
      totalOriginal += entry.result.originalLength;
      totalSummary += entry.result.summaryLength;
    }
    return {
      ...stats,
      results: this.registry.size,
      byTechnique,
      totalOriginalChars: totalOriginal,
      totalSummaryChars: totalSummary,
      averageRatio:
        this.registry.size === 0
          ? 0
          : Math.round((totalSummary / Math.max(1, totalOriginal)) * 1000) /
            1000,
      puts: this.putCount,
      gets: this.getCount,
      hits: this.hitCount,
      misses: this.missCount,
      deletes: this.deleteCount,
      clears: this.clearCount,
      pruned: 0,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Serialise the whole result cache.
   *
   * @returns a JSON-safe {@link SummarizationStoreState} snapshot
   */
  toJSON(): SummarizationStoreState {
    return {
      entries: this.entries(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Restore a previously-serialised cache.
   *
   * Existing entries are replaced wholesale; keys absent from `state` are
   * dropped. Emits a `'restore'` event.
   *
   * @param state - a {@link SummarizationStoreState} produced by
   *   {@link SummarizationStore.toJSON}
   */
  fromJSON(state: SummarizationStoreState): void {
    this.registry.clear();
    const now = this.now();
    for (const entry of state.entries) {
      const result: SummaryResult = {
        summary: entry.result.summary,
        technique: entry.result.technique,
        originalLength: clampLength(entry.result.originalLength),
        summaryLength: clampLength(entry.result.summaryLength),
        ratio: entry.result.ratio,
        ...(entry.result.keyPoints && entry.result.keyPoints.length > 0
          ? {
              keyPoints: entry.result.keyPoints.map((kp: KeyPoint) => ({ ...kp })),
            }
          : {}),
      };
      this.registry.set(entry.key, {
        key: entry.key,
        result,
        createdAt:
          typeof entry.createdAt === 'number' ? entry.createdAt : now,
        updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
      });
    }
    this.updatedAt = now;
    this.emit('restore', { key: '*', timestamp: now } satisfies SummarizationEventPayload);
  }

  /**
   * Build a store from a serialised {@link SummarizationStoreState}.
   *
   * @param state - the serialised state to restore
   * @param options - construction options (notably the clock)
   * @returns a populated {@link SummarizationStore}
   */
  static fromJSON(
    state: SummarizationStoreState,
    options: SummarizationStoreOptions = {},
  ): SummarizationStore {
    const store = new SummarizationStore(options);
    store.fromJSON(state);
    return store;
  }
}