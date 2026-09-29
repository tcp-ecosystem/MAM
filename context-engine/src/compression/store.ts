/**
 * Result cache for the **Compression** layer of the standalone MAM Context
 * Engine.
 *
 * {@link CompressionStore} is the mutable heart of the layer: a keyed registry
 * of {@link CompressionResult}s — the output of every successful compression —
 * that answers the read-side questions ("did we already compress this text?",
 * "how much have we saved in total?") and applies every state change through a
 * single, well-guarded API.
 *
 * Responsibilities:
 *
 * - **Cache** — {@link CompressionStore.put} / {@link CompressionStore.get} /
 *   {@link CompressionStore.getByKey} / {@link CompressionStore.has} /
 *   {@link CompressionStore.delete} / {@link CompressionStore.keys} /
 *   {@link CompressionStore.clear} / {@link CompressionStore.size} manage which
 *   results are retained at all.
 * - **Batch** — {@link CompressionStore.putMany} writes a batch of results in
 *   one call, which is how a serialised snapshot or an index rebuild repopulates
 *   the cache cheaply.
 * - **Evict** — when {@link CompressionStoreOptions.maxEntries} is set, an
 *   over-full cache evicts its *oldest* entries first (insertion order), so a
 *   long-running process stays bounded.
 * - **Inspect** — {@link CompressionStore.stats} rolls the cache up into a
 *   {@link CompressionStats} report (totals, savings, per-technique counts).
 * - **Persist** — {@link CompressionStore.toJSON} / {@link CompressionStore
 *   .fromJSON} round-trip the whole cache through plain JSON.
 *
 * Keys are derived deterministically from the input text *and* the options it
 * was compressed with (see {@link compressionKey}), so re-compressing identical
 * content with identical options reuses the same key and the same cached
 * result. Callers are free to supply their own keys instead.
 *
 * The store extends `node:events`' `EventEmitter` and emits `'put'`, `'delete'`,
 * `'clear'` and `'prune'` events carrying lightweight payloads, which lets
 * {@link CompressionLifecycle} and the integration facades observe and react
 * without polling.
 *
 * @module compression/store
 */

import { EventEmitter } from 'node:events';

import { DEFAULT_MAX_ENTRIES } from './types.js';
import {
  clampLength,
  computeRatio,
  estimateTokens,
  isCompressionResult,
  ratioBucket,
} from './types.js';
import type {
  CompressOptions,
  CompressionResult,
  CompressionState,
  CompressionStats,
  CompressionTechnique,
  RatioBucket,
  Timestamp,
} from './types.js';

/**
 * A minimal event payload shared by every event the store emits.
 */
export interface CompressionStoreEvent {
  /**
   * The cache key the event concerns (`'*'` for whole-store events).
   */
  readonly key: string;

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly timestamp: Timestamp;
}

/**
 * Payload emitted by the store's `'put'` event.
 */
export interface CompressionStorePutEvent extends CompressionStoreEvent {
  /**
   * The technique of the stored result.
   */
  readonly technique: CompressionTechnique;

  /**
   * The compression ratio of the stored result.
   */
  readonly ratio: number;
}

/**
 * Payload emitted by the store's `'prune'` event.
 */
export interface CompressionStorePruneEvent extends CompressionStoreEvent {
  /**
   * Number of entries evicted by this prune.
   */
  readonly removed: number;
}

/**
 * Construction options for a {@link CompressionStore}.
 */
export interface CompressionStoreOptions {
  /**
   * Maximum number of results retained before the oldest entries are evicted.
   * `0` disables the cap entirely. Defaults to {@link DEFAULT_MAX_ENTRIES}.
   */
  readonly maxEntries?: number;

  /**
   * Clock used for all timestamps. Injecting a clock makes the store
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Derive a deterministic cache key for a compression request.
 *
 * The key hashes the input text together with the *sorted* keys of the options
 * object, so two requests that differ only in the property order of their
 * options map to the same key, while a genuinely different technique, cap or
 * flag yields a different key. Uses FNV-1a (32-bit) — fast, deterministic,
 * dependency-free — formatted as 8 lowercase hex digits.
 *
 * @param text - the text to be compressed
 * @param options - the options the text will be compressed with
 * @returns a stable cache key for this request
 */
export function compressionKey(
  text: string,
  options: CompressOptions = {},
): string {
  const ordered: Record<string, unknown> = {};
  for (const name of Object.keys(options).sort()) {
    ordered[name] = (options as Record<string, unknown>)[name];
  }
  const canonical = JSON.stringify({ t: text, o: ordered });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The keyed result cache.
 *
 * See the module documentation for the full responsibility list. Every query
 * method returns *copies* of the stored results so callers cannot mutate the
 * cache's internal state through the values they receive.
 *
 * @example
 * ```ts
 * const store = new CompressionStore({ maxEntries: 128 });
 * store.put('doc-a', someResult);
 * store.getByKey('doc-a');        // → the stored result (a copy)
 * store.stats().totalSaved;       // → characters saved so far
 * ```
 */
export class CompressionStore extends EventEmitter {
  /**
   * The key→result registry, in insertion order.
   */
  private readonly results: Map<string, CompressionResult> = new Map();

  /**
   * Maximum number of results retained before eviction (`0` = unbounded).
   */
  readonly maxEntries: number;

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  private updatedAt: Timestamp;

  /**
   * Number of results ever written (monotonic; survives eviction/clear).
   */
  private writeCount = 0;

  /**
   * Number of results removed by automatic eviction since construction.
   */
  private evictedCount = 0;

  /**
   * Number of successful `get`/`getByKey` lookups since construction.
   */
  private hitCount = 0;

  /**
   * Number of `get`/`getByKey` lookups that missed since construction.
   */
  private missCount = 0;

  /**
   * Clock used for all timestamps.
   */
  private readonly now: () => Timestamp;

  /**
   * Construct a new result cache.
   *
   * @param options - construction options (entry cap, clock)
   */
  constructor(options: CompressionStoreOptions = {}) {
    super();
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? (() => Date.now());
    this.createdAt = this.now();
    this.updatedAt = this.createdAt;
  }

  /**
   * Record a state change: bump the write counter and `updatedAt`.
   */
  private touch(): void {
    this.updatedAt = this.now();
  }

  /**
   * Enforce the entry cap after a write.
   *
   * When the cache exceeds {@link CompressionStore.maxEntries}, the oldest
   * entries (first inserted) are evicted until it fits again. Emits a `'prune'`
   * event when anything was removed. A cap of `0` is a no-op.
   *
   * @returns the number of entries evicted
   */
  private enforceCap(): number {
    const cap = clampLength(this.maxEntries);
    if (cap <= 0 || this.results.size <= cap) {
      return 0;
    }
    const excess = this.results.size - cap;
    const doomed = [...this.results.keys()].slice(0, excess);
    for (const key of doomed) {
      this.results.delete(key);
    }
    this.evictedCount += doomed.length;
    const at = this.now();
    this.emit(
      'prune',
      { key: '*', timestamp: at, removed: doomed.length } satisfies CompressionStorePruneEvent,
    );
    return doomed.length;
  }

  /**
   * Insert or replace a result in the cache.
   *
   * The result is validated structurally via {@link isCompressionResult} and
   * stored as a defensive copy. Replacing an existing key updates its value and
   * moves it to the *end* of the insertion order (i.e. "recently written").
   * Emits a `'put'` event carrying the technique and ratio.
   *
   * @param key - the cache key to store under
   * @param result - the compression result to store
   * @returns the stored result copy
   */
  put(key: string, result: CompressionResult): CompressionResult {
    if (!isCompressionResult(result)) {
      throw new TypeError(
        `CompressionStore.put: value for key "${key}" is not a valid CompressionResult`,
      );
    }
    const stored = this.copyResult(result);
    this.results.delete(key);
    this.results.set(key, stored);
    this.writeCount += 1;
    this.touch();
    const at = this.updatedAt;
    this.emit(
      'put',
      {
        key,
        timestamp: at,
        technique: stored.technique,
        ratio: stored.ratio,
      } satisfies CompressionStorePutEvent,
    );
    this.enforceCap();
    return this.copyResult(stored);
  }

  /**
   * Write a batch of results in one call.
   *
   * Iterates the supplied `[key, result]` pairs through {@link CompressionStore
   * .put}, so validation, copy-on-write and cap enforcement all apply uniformly.
   * Invalid entries throw immediately (the batch is atomic).
   *
   * @param entries - the entries to write
   * @returns the number of entries written
   */
  putMany(entries: Iterable<readonly [string, CompressionResult]>): number {
    let written = 0;
    for (const [key, result] of entries) {
      this.put(key, result);
      written += 1;
    }
    return written;
  }

  /**
   * Fetch a stored result by key.
   *
   * A miss returns `undefined` without throwing. Returns a defensive copy so
   * callers cannot mutate internal state.
   *
   * @param key - the cache key to look up
   * @returns a copy of the stored result, or `undefined`
   */
  get(key: string): CompressionResult | undefined {
    const found = this.results.get(key);
    if (found) {
      this.hitCount += 1;
      return this.copyResult(found);
    }
    this.missCount += 1;
    return undefined;
  }

  /**
   * Fetch a stored result by key.
   *
   * Identical to {@link CompressionStore.get}; the extra name exists so callers
   * that think of the cache as key-addressable can read naturally.
   *
   * @param key - the cache key to look up
   * @returns a copy of the stored result, or `undefined`
   */
  getByKey(key: string): CompressionResult | undefined {
    return this.get(key);
  }

  /**
   * Test whether a key currently has a stored result.
   *
   * @param key - the cache key to test
   * @returns `true` when the key is present
   */
  has(key: string): boolean {
    return this.results.has(key);
  }

  /**
   * Remove a stored result by key.
   *
   * Emits a `'delete'` event when an entry was actually removed.
   *
   * @param key - the cache key to remove
   * @returns `true` when an entry existed and was removed
   */
  delete(key: string): boolean {
    const removed = this.results.delete(key);
    if (removed) {
      this.touch();
      this.emit(
        'delete',
        { key, timestamp: this.updatedAt } satisfies CompressionStoreEvent,
      );
    }
    return removed;
  }

  /**
   * The keys of every cached result, in insertion order.
   *
   * @returns a fresh array of cache keys
   */
  keys(): string[] {
    return [...this.results.keys()];
  }

  /**
   * Every cached result, in insertion order.
   *
   * @returns a fresh array of result copies
   */
  values(): CompressionResult[] {
    return [...this.results.values()].map((result) => this.copyResult(result));
  }

  /**
   * Every `[key, result]` pair, in insertion order.
   *
   * @returns a fresh array of entries (results as copies)
   */
  entries(): Array<[string, CompressionResult]> {
    return [...this.results.entries()].map(([key, result]) => [
      key,
      this.copyResult(result),
    ]);
  }

  /**
   * Remove every cached result, returning the store to an empty cache.
   *
   * Counter history (`writeCount`, `evictedCount`) is retained so
   * {@link CompressionStore.stats} stays meaningful. Emits a `'clear'` event.
   */
  clear(): void {
    this.results.clear();
    this.touch();
    this.emit(
      'clear',
      { key: '*', timestamp: this.updatedAt } satisfies CompressionStoreEvent,
    );
  }

  /**
   * The number of results currently cached.
   */
  get size(): number {
    return this.results.size;
  }

  /**
   * Aggregate counters for this store.
   *
   * Behaviour counters (`compressions`, `pruned`) are monotonic since
   * construction; state-derived fields (`results`, `totalOriginal`, …) are
   * computed on demand from the current cache contents.
   *
   * @returns a {@link CompressionStats} snapshot
   */
  stats(): CompressionStats {
    const byTechnique = {} as Record<CompressionTechnique, number>;
    for (const technique of TECHNIQUE_LIST) {
      byTechnique[technique] = 0;
    }
    let totalOriginal = 0;
    let totalCompressed = 0;
    let truncations = 0;
    for (const result of this.results.values()) {
      totalOriginal += result.originalLength;
      totalCompressed += result.compressedLength;
      byTechnique[result.technique] += 1;
      if (result.truncated) {
        truncations += 1;
      }
    }
    const totalSaved = totalOriginal - totalCompressed;
    return {
      results: this.results.size,
      compressions: this.writeCount,
      truncations,
      totalOriginal,
      totalCompressed,
      totalSaved,
      averageRatio:
        this.results.size > 0
          ? totalOriginal > 0
            ? computeRatio(totalOriginal, totalCompressed)
            : 0
          : 0,
      byTechnique,
      pruned: this.evictedCount,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Serialise the whole cache.
   *
   * @returns a JSON-safe {@link CompressionState} snapshot
   */
  toJSON(): CompressionState {
    const entries = [...this.results.entries()].map(([key, result]) => ({
      key,
      result: this.copyResult(result),
    }));
    return {
      entries,
      maxEntries: this.maxEntries,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  /**
   * Restore a previously-serialised cache.
   *
   * Existing entries are replaced wholesale; keys absent from `state` are
   * dropped. Entries are re-validated through {@link CompressionStore.put}, so
   * malformed results are rejected just as on the live write path.
   *
   * @param state - a {@link CompressionState} produced by
   *   {@link CompressionStore.toJSON}
   * @returns the number of entries restored
   */
  fromJSON(state: CompressionState): number {
    this.results.clear();
    let restored = 0;
    for (const entry of state.entries) {
      this.put(entry.key, entry.result);
      restored += 1;
    }
    return restored;
  }

  /**
   * Build a store from a serialised {@link CompressionState}.
   *
   * @param state - the serialised state to restore
   * @param options - construction options (notably the clock)
   * @returns a configured, populated {@link CompressionStore}
   */
  static fromJSON(
    state: CompressionState,
    options: CompressionStoreOptions = {},
  ): CompressionStore {
    const store = new CompressionStore({
      maxEntries: state.maxEntries,
      ...options,
    });
    store.fromJSON(state);
    return store;
  }

  /**
   * Deep-copy a result for safe external exposure.
   *
   * @param result - the result to copy
   * @returns a shallow copy with the optional payload fields preserved
   */
  private copyResult(result: CompressionResult): CompressionResult {
    return { ...result };
  }

  /**
   * Compute the {@link RatioBucket} band of a stored result.
   *
   * Delegates to {@link ratioBucket} so callers and the index agree on
   * bucketing without re-implementing the edges.
   *
   * @param key - the cache key to classify
   * @returns the derived {@link RatioBucket}, or `undefined` when the key is
   *   absent
   */
  bucketOf(key: string): RatioBucket | undefined {
    const result = this.results.get(key);
    return result ? ratioBucket(result.ratio) : undefined;
  }

  /**
   * Roll up how many tokens the whole cache represents.
   *
   * A cheap aggregate for callers that reason about context in tokens rather
   * than characters.
   *
   * @returns the estimated total tokens of every cached `text`
   */
  totalTokens(): number {
    let total = 0;
    for (const result of this.results.values()) {
      total += estimateTokens(result.text);
    }
    return total;
  }
}

/**
 * Internal: the stable technique list used to initialise `byTechnique` counts.
 */
const TECHNIQUE_LIST: readonly CompressionTechnique[] = [
  'none',
  'truncate',
  'collapse',
  'dedupe',
  'strip-markdown',
  'keywords',
  'tiered',
];