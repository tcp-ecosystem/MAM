/**
 * Lifecycle management for the RAG layer.
 *
 * The {@link RagLifecycle} owns the *disposal* side of RAG memory: cached
 * contexts and results do not live forever. It provides:
 *
 * - **TTL sweeping** — {@link RagLifecycle.start} begins a periodic timer that
 *   evicts expired entries from the backing {@link ../store.RagStore};
 *   {@link RagLifecycle.stop} stops it. Sweeps are reported via `'sweep'`
 *   events.
 * - **Pruning** — {@link RagLifecycle.prune} reduces the store to at most
 *   `maxEntries` entries (least-recently-accessed first) and emits a
 *   `'prune'` event with the removed keys.
 * - **Query eviction** — {@link RagLifecycle.clearQuery} drops the cached
 *   context/result for one query from both the store and the index.
 * - **Reset** — {@link RagLifecycle.reset} clears the store, the index and all
 *   counters, emitting a `'reset'` event.
 * - **Assembly observation** — {@link RagLifecycle.assemble} delegates to the
 *   retriever's assembly routine and emits an `'assemble'` event carrying the
 *   assembled {@link ../types.RagContext}, so consumers can log or monitor what
 *   the generation step is actually fed.
 *
 * The lifecycle extends Node's `EventEmitter`, so consumers subscribe with
 * `lifecycle.on('prune', listener)` and friends.
 *
 * @packageDocumentation
 * @module rag/lifecycle
 */

import { EventEmitter } from 'node:events';

import {
  buildCacheKey,
  countTokens,
  normalizeText,
  uniqueSources,
  type RagContext,
  type RagEventType,
  type RagLifecycleEvent,
  type RagPiece,
  type RagStats,
} from './types.js';
import { RagIndex } from './index.js';
import { RagRetriever } from './retrieval.js';
import { RagStore, type RagStoreStats } from './store.js';

/**
 * Options accepted by the {@link RagLifecycle} constructor.
 */
export interface RagLifecycleOptions {
  /**
   * Time-to-live in milliseconds for cached entries, passed to the store.
   * Defaults to `60_000`.
   */
  readonly ttlMs?: number;

  /**
   * Interval in milliseconds between periodic TTL sweeps. Defaults to
   * `30_000`. `0` disables the periodic sweeper even after `start()`.
   */
  readonly sweepIntervalMs?: number;

  /**
   * Target entry ceiling enforced after each sweep. Defaults to `1000`.
   * `0` disables pruning.
   */
  readonly maxEntries?: number;

  /**
   * When `true`, the sweeper is started immediately upon construction.
   * Defaults to `false`.
   */
  readonly autoStart?: boolean;

  /**
   * Optional clock used instead of `Date.now()`.
   */
  readonly now?: () => number;
}

/**
 * Statistics specific to a {@link RagLifecycle}.
 *
 * Extends {@link RagStoreStats} with lifecycle-specific fields.
 */
export interface RagLifecycleStats extends RagStoreStats {
  /**
   * Number of TTL sweep passes performed.
   */
  readonly sweeps: number;

  /**
   * Number of entries removed by explicit `prune()` calls.
   */
  readonly prunedEntries: number;

  /**
   * `true` when the periodic sweeper is currently running.
   */
  readonly running: boolean;

  /**
   * The configured sweep interval in milliseconds.
   */
  readonly sweepIntervalMs: number;

  /**
   * The configured entry ceiling.
   */
  readonly maxEntries: number;
}

/**
 * Manages the disposal lifecycle of the RAG layer and reports on it.
 *
 * @example
 * ```ts
 * const store = new RagStore();
 * const lifecycle = new RagLifecycle(store, index, retriever, {
 *   ttlMs: 60_000,
 *   sweepIntervalMs: 30_000,
 * });
 * lifecycle.on('prune', ({ keys }) => log(`pruned ${keys.length} entries`));
 * lifecycle.start();
 * ```
 */
export class RagLifecycle extends EventEmitter {
  private readonly _store: RagStore;
  private readonly _index: RagIndex | undefined;
  private readonly _retriever: RagRetriever | undefined;
  private readonly _ttlMs: number;
  private readonly _sweepIntervalMs: number;
  private readonly _maxEntries: number;
  private readonly _now: () => number;
  private _timer: NodeJS.Timeout | null;
  private _sweeps: number;
  private _prunedEntries: number;

  /**
   * Construct a new lifecycle.
   *
   * @param store - the store to manage (created when omitted)
   * @param index - the index to manage (optional)
   * @param retriever - the retriever to delegate assembly to (optional)
   * @param options - TTL, sweep and pruning configuration
   */
  constructor(
    store?: RagStore,
    index?: RagIndex,
    retriever?: RagRetriever,
    options: RagLifecycleOptions = {},
  ) {
    super();
    this._store =
      store ?? new RagStore({ ttlMs: options.ttlMs, now: options.now });
    this._index = index;
    this._retriever = retriever;
    this._ttlMs = Math.max(0, Math.floor(options.ttlMs ?? 60_000));
    this._sweepIntervalMs = Math.max(
      0,
      Math.floor(options.sweepIntervalMs ?? 30_000),
    );
    this._maxEntries = Math.max(0, Math.floor(options.maxEntries ?? 1000));
    this._now = options.now ?? Date.now;
    this._timer = null;
    this._sweeps = 0;
    this._prunedEntries = 0;
    if (options.autoStart) {
      this.start();
    }
  }

  /**
   * The store this lifecycle manages.
   *
   * @returns the backing {@link RagStore}
   */
  get store(): RagStore {
    return this._store;
  }

  /**
   * The index this lifecycle manages, when one was provided.
   *
   * @returns the backing {@link RagIndex}, or `undefined`
   */
  get index(): RagIndex | undefined {
    return this._index;
  }

  /**
   * Whether the periodic sweeper is currently running.
   *
   * @returns `true` when the sweep timer is active
   */
  get running(): boolean {
    return this._timer !== null;
  }

  /**
   * Begin periodic TTL sweeping.
   *
   * Idempotent: calling `start()` while already running is a no-op. Emits a
   * `'start'` event. When `sweepIntervalMs` is `0`, start is a no-op.
   *
   * @returns the lifecycle, for chaining
   */
  start(): this {
    if (this._timer !== null || this._sweepIntervalMs <= 0) {
      return this;
    }
    this._timer = setInterval(() => {
      this._tick();
    }, this._sweepIntervalMs);
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
    this._emit('start', 1, [], undefined);
    return this;
  }

  /**
   * Stop periodic TTL sweeping.
   *
   * Emits a `'stop'` event. Safe to call when not running.
   */
  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
      this._emit('stop', 0, [], undefined);
    }
  }

  /**
   * Run a single sweep pass immediately.
   *
   * Expires TTL-stale entries, then enforces the `maxEntries` ceiling via
   * {@link RagLifecycle.prune}. Emits a `'sweep'` event with the total number
   * of entries removed.
   *
   * @returns the number of entries removed
   */
  sweep(): number {
    let removed = this._store.sweep();
    this._sweeps += 1;
    if (this._maxEntries > 0) {
      removed += this.prune(this._maxEntries);
    }
    this._emit('sweep', removed, [], undefined);
    return removed;
  }

  /**
   * Prune the store to at most `maxEntries` entries.
   *
   * Least-recently-accessed entries are evicted first. Emits a `'prune'` event
   * carrying the removed keys.
   *
   * @param maxEntries - the target entry ceiling
   * @returns the number of entries removed
   */
  prune(maxEntries: number): number {
    const before = this._store.size;
    const removed = this._store.prune(maxEntries);
    this._prunedEntries += removed;
    const keys = removed > 0 ? this._store.keys() : [];
    this._emit('prune', removed, keys.slice(0, removed), {
      before,
      after: before - removed,
      ceiling: Math.max(0, Math.floor(maxEntries)),
    });
    return removed;
  }

  /**
   * Evict the cached context/result for a single query.
   *
   * The query is normalised and keyed exactly as the retriever keys its cache,
   * so the matching store entry (and its owned pieces) is removed. The query's
   * association in the index is dropped as well.
   *
   * @param text - the raw query text
   * @returns `true` when a cached entry was removed
   */
  clearQuery(text: string): boolean {
    const key = buildCacheKey(text);
    const removed = this._store.delete(key);
    if (this._index) {
      this._index.removeQuery(text);
    }
    if (removed) {
      this._emit('prune', 1, [key], { reason: 'clearQuery' });
    }
    return removed;
  }

  /**
   * Reset the entire layer.
   *
   * Clears the store (all entries and pieces), the index (all pieces, terms and
   * query associations) and lifecycle counters. Emits a `'reset'` event.
   *
   * @returns the number of store entries cleared
   */
  reset(): number {
    const clearedStore = this._store.clear();
    const clearedIndex = this._index ? this._index.clear() : 0;
    this._sweeps = 0;
    this._prunedEntries = 0;
    this._emit('reset', clearedStore, [], {
      clearedIndex,
    });
    return clearedStore;
  }

  /**
   * Assemble pieces into a context, delegating to the retriever.
   *
   * When no retriever is configured, a minimal inline assembly is performed
   * using the same token accounting. Emits an `'assemble'` event carrying the
   * assembled context so downstream consumers can observe what the generation
   * step will actually receive.
   *
   * @param pieces - the candidate pieces
   * @param budgetTokens - the token ceiling
   * @param query - the query the pieces answer
   * @returns the assembled {@link RagContext}
   */
  assemble(
    pieces: readonly RagPiece[],
    budgetTokens: number,
    query = '',
  ): RagContext {
    let context: RagContext;
    if (this._retriever) {
      context = this._retriever.assemble(pieces, budgetTokens, query);
    } else {
      context = this._inlineAssemble(pieces, budgetTokens, query);
    }
    this._emit('assemble', context.pieces.length, [], context);
    return context;
  }

  /**
   * Aggregate statistics for the lifecycle.
   *
   * @returns a {@link RagLifecycleStats} snapshot
   */
  stats(): RagLifecycleStats {
    const base = this._store.stats();
    return {
      ...base,
      sweeps: this._sweeps,
      prunedEntries: this._prunedEntries,
      running: this.running,
      sweepIntervalMs: this._sweepIntervalMs,
      maxEntries: this._maxEntries,
    };
  }

  /**
   * Alias for {@link RagLifecycle.stop} that also clears the timer reference.
   */
  dispose(): void {
    this.stop();
  }

  /**
   * Perform one periodic sweep tick.
   */
  private _tick(): void {
    this.sweep();
  }

  /**
   * Emit a typed lifecycle event.
   *
   * @param type - the event discriminator
   * @param count - the number of entries affected
   * @param keys - the keys involved
   * @param detail - optional operation-specific payload
   */
  private _emit(
    type: RagEventType,
    count: number,
    keys: readonly string[],
    detail: unknown,
  ): void {
    const event: RagLifecycleEvent = {
      type,
      timestamp: this._now(),
      count,
      keys: keys.length > 0 ? keys : undefined,
      detail: detail ?? undefined,
    };
    this.emit(type, event);
  }

  /**
   * Perform a minimal inline assembly without a retriever.
   *
   * Sorts best-first and greedily fits pieces into the budget, allowing one
   * oversized piece so the context is never empty for a non-empty input.
   *
   * @param pieces - the candidate pieces
   * @param budgetTokens - the token ceiling
   * @param query - the query text
   * @returns an assembled {@link RagContext}
   */
  private _inlineAssemble(
    pieces: readonly RagPiece[],
    budgetTokens: number,
    query: string,
  ): RagContext {
    const budget = Math.max(0, Math.floor(budgetTokens));
    const ranked = [...pieces].sort((a, b) => b.score - a.score);
    const selected: RagPiece[] = [];
    let running = 0;
    for (const piece of ranked) {
      const tokens = countTokens(piece.text);
      if (running + tokens <= budget || selected.length === 0) {
        running += tokens;
        selected.push(piece);
        if (running >= budget) {
          break;
        }
      }
    }
    selected.forEach((piece, rank) => {
      (piece as { rank?: number }).rank = rank;
    });
    return {
      pieces: selected,
      budgetTokens: budget,
      totalTokens: running,
      query: normalizeText(query),
      sources: uniqueSources(selected),
    };
  }

  /**
   * Current timestamp via the configured clock.
   *
   * @returns epoch milliseconds
   */
  private _nowMs(): number {
    return this._now();
  }
}

/**
 * Convenience: build a lifecycle with all-default wiring.
 *
 * @param options - lifecycle options
 * @returns a fully-wired {@link RagLifecycle}
 */
export function createRagLifecycle(
  options: RagLifecycleOptions = {},
): RagLifecycle {
  const store = new RagStore({ ttlMs: options.ttlMs, now: options.now });
  return new RagLifecycle(store, undefined, undefined, options);
}

/**
 * Type guard: is the given stats object a {@link RagLifecycleStats}?
 *
 * @param stats - the stats to test
 * @returns `true` when the object carries lifecycle-specific fields
 */
export function isRagLifecycleStats(
  stats: RagStats | RagLifecycleStats,
): stats is RagLifecycleStats {
  return (
    typeof stats === 'object' &&
    stats !== null &&
    'sweeps' in stats &&
    'running' in stats
  );
}