/**
 * Integration surface for the **Compression** layer of the standalone MAM
 * Context Engine.
 *
 * This module is how the rest of the context engine consumes Compression. It
 * exposes three pieces:
 *
 * 1. **{@link CompressorInterface}** — the contract every compression facade
 *    implements, so consumers can depend on the interface rather than a
 *    concrete class.
 * 2. **{@link Compressor}** — the high-level facade. It composes a
 *    {@link TextCompressor} (algorithms), a {@link CompressionStore} (result
 *    cache), a {@link CompressionIndex} (ratio/technique index) and a
 *    {@link CompressionLifecycle} (bounded housekeeping) into one object that
 *    can *run* a compression, *force* a maximum length, and report what the
 *    subsystem has saved.
 * 3. **{@link CompressionAdapter}** — an alternate {@link CompressorInterface}
 *    implementation that adapts *already-existing* components (perhaps shared
 *    with other consumers) into the same contract, without building its own
 *    store or lifecycle.
 *
 * The module also provides the factory {@link createCompressor}, which
 * assembles the default wiring so callers do not need to know the constructor
 * order.
 *
 * The headline operations of the layer live here in their most ergonomic form:
 *
 * - {@link Compressor.run} — compress text (respecting the cache), store and
 *   index the result, and return it.
 * - {@link Compressor.compressToMax} — guarantee the output fits a character
 *   cap, no matter what.
 * - {@link Compressor.estimate} — heuristic token count (`Math.ceil(len/4)`).
 *
 * @module compression/integration
 */

import { EventEmitter } from 'node:events';

import { CompressionIndex } from './index.js';
import type { CompressionIndexStats } from './index.js';
import { CompressionLifecycle } from './lifecycle.js';
import { TextCompressor } from './retrieval.js';
import { CompressionStore, compressionKey } from './store.js';
import { computeRatio, estimateTokens, mergeCompressionConfig } from './types.js';
import type {
  CompressionConfig,
  CompressionResult,
  CompressionStats,
  CompressOptions,
  Timestamp,
} from './types.js';

/**
 * The contract every compression facade implements.
 *
 * Consumers that want to stay decoupled from the concrete compressor/adapter
 * should type against this interface.
 */
export interface CompressorInterface {
  /**
   * Compress a piece of text, caching and indexing the result.
   */
  run(text: string, options?: CompressOptions): CompressionResult;

  /**
   * Compress a piece of text so the output is guaranteed to fit `maxLength`.
   */
  compressToMax(text: string, maxLength: number): CompressionResult;

  /**
   * Heuristic token count for a piece of text (`Math.ceil(len / 4)`).
   */
  estimate(text: string): number;

  /**
   * The store backing this facade (for lower-level access).
   */
  readonly store: CompressionStore;

  /**
   * Aggregate counters for the compression subsystem.
   */
  stats(): CompressionStats;
}

/**
 * Construction options for a {@link Compressor}.
 */
export interface CompressorOptions {
  /**
   * When `true` (default), identical text+options reuses a cached result
   * instead of re-running the algorithms. Deterministic anyway; the cache
   * exists to make hot loops cheaper.
   */
  readonly useCache?: boolean;

  /**
   * When `true` (default), a {@link CompressionLifecycle} is created and
   * started alongside the store so the cache is pruned periodically. Set to
   * `false` for short-lived or externally-managed processes.
   */
  readonly lifecycle?: boolean;

  /**
   * Maximum number of results the lifecycle (and store) keep before pruning.
   * Ignored when `lifecycle` is `false`.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic lifecycle prune passes. Ignored
   * when `lifecycle` is `false`.
   */
  readonly intervalMs?: number;

  /**
   * A pre-built store to drive. When omitted, a fresh store is constructed.
   */
  readonly store?: CompressionStore;

  /**
   * A pre-built index to drive. When omitted, a fresh index is constructed and
   * mirrored from the store.
   */
  readonly index?: CompressionIndex;

  /**
   * A pre-built compressor to use. When omitted, a fresh one is constructed
   * from the configuration.
   */
  readonly compressor?: TextCompressor;
}

/**
 * Payload emitted by the compressor's `'compressed'` / `'cached'` events.
 */
export interface CompressionEventPayload {
  /**
   * The cache key the result was stored under.
   */
  readonly key: string;

  /**
   * The compressed result.
   */
  readonly result: CompressionResult;

  /**
   * Epoch-millisecond time the event was emitted.
   */
  readonly at: Timestamp;
}

/**
 * The high-level Compression facade.
 *
 * {@link Compressor} is the object most consumers should construct. It wires
 * the whole layer together — algorithms, cache, index, lifecycle — and adds the
 * two conveniences the layer exists to serve: {@link Compressor.run} (compress
 * with caching) and {@link Compressor.compressToMax} (guaranteed fit).
 *
 * @example
 * ```ts
 * const compressor = createCompressor({ stripMarkdown: true, maxLength: 8000 });
 * const result = compressor.run(longToolOutput);
 * if (result.truncated) { /* fell back to lossy *\/ }
 * const fitted = compressor.compressToMax(entireKnowledgeSection, 10_000);
 * ```
 */
export class Compressor extends EventEmitter implements CompressorInterface {
  /**
   * The algorithm worker.
   */
  readonly compressor: TextCompressor;

  /**
   * The result cache.
   */
  readonly store: CompressionStore;

  /**
   * The ratio/technique index, kept in sync with the store.
   */
  readonly index: CompressionIndex;

  /**
   * The lifecycle (housekeeping), or `null` when disabled.
   */
  readonly lifecycle: CompressionLifecycle | null;

  /**
   * The effective configuration (merged over defaults).
   */
  readonly config: CompressionConfig;

  /**
   * Whether identical text+options reuses a cached result.
   */
  readonly useCache: boolean;

  /**
   * Number of cache hits since construction.
   */
  private cacheHits = 0;

  /**
   * Number of cache misses (and therefore actual compressions) since
   * construction.
   */
  private cacheMisses = 0;

  /**
   * Construct a compressor.
   *
   * @param config - partial configuration, merged over the defaults
   * @param options - construction options (cache toggle, lifecycle toggle,
   *   component overrides)
   */
  constructor(
    config: Partial<CompressionConfig> | undefined = undefined,
    options: CompressorOptions = {},
  ) {
    super();
    this.config = mergeCompressionConfig(config);
    this.useCache = options.useCache !== false;
    this.compressor = options.compressor ?? new TextCompressor(this.config);
    this.store = options.store ?? new CompressionStore({ maxEntries: options.maxEntries });
    this.index = options.index ?? new CompressionIndex();
    if (options.index) {
      this.reindexStore();
    } else {
      this.index.rebuild(this.store.entries());
    }
    this.lifecycle =
      options.lifecycle === false
        ? null
        : new CompressionLifecycle(this.store, {
            maxEntries: options.maxEntries,
            intervalMs: options.intervalMs,
          });
    this.lifecycle?.start();
  }

  /**
   * Mirror the store into the index when a pre-built store is supplied.
   *
   * The index is rebuilt from the store's current entries so the two never
   * disagree, even when the store already held results before the compressor
   * was built.
   */
  private reindexStore(): void {
    this.index.rebuild(this.store.entries());
  }

  /**
   * Compress a piece of text, caching and indexing the result.
   *
   * When {@link Compressor.useCache} is enabled and the same text+options were
   * compressed before, the cached result is returned without re-running the
   * algorithms (emitting a `'cached'` event). Otherwise the text is compressed
   * deterministically via the {@link TextCompressor}, stored under its derived
   * key, indexed, and returned (emitting a `'compressed'` event).
   *
   * @param text - the text to compress
   * @param options - per-call overrides on top of the configured behaviour
   * @returns a {@link CompressionResult} describing the compression
   */
  run(text: string, options: CompressOptions = {}): CompressionResult {
    const key = compressionKey(text, options);
    if (this.useCache) {
      const cached = this.store.getByKey(key);
      if (cached) {
        this.cacheHits += 1;
        const at = Date.now();
        this.emit('cached', { key, result: cached, at } satisfies CompressionEventPayload);
        return cached;
      }
    }
    const result = this.compressor.compress(text, options);
    this.store.put(key, result);
    this.index.indexResult(key, result);
    this.cacheMisses += 1;
    const at = Date.now();
    this.emit('compressed', { key, result, at } satisfies CompressionEventPayload);
    return result;
  }

  /**
   * Compress a piece of text (alias of {@link Compressor.run}).
   *
   * @param text - the text to compress
   * @param options - per-call overrides
   * @returns a {@link CompressionResult}
   */
  compress(text: string, options: CompressOptions = {}): CompressionResult {
    return this.run(text, options);
  }

  /**
   * Compress a piece of text so the output is guaranteed to fit `maxLength`.
   *
   * Runs the `'tiered'` pipeline with the cap set, which always returns text at
   * or under the limit (the compressor truncates as a final pass). As a
   * belt-and-braces guarantee the result is re-checked and, in the impossible
   * case the cap was still exceeded, hard-cut to it.
   *
   * @param text - the text to compress
   * @param maxLength - the maximum character length the output may have
   * @returns a {@link CompressionResult} whose `text.length <= maxLength`
   */
  compressToMax(text: string, maxLength: number): CompressionResult {
    const result = this.run(text, { maxLength, technique: 'tiered' });
    if (result.text.length <= maxLength) {
      return result;
    }
    const cut = result.text.slice(0, maxLength);
    return {
      ...result,
      text: cut,
      compressedLength: cut.length,
      ratio: computeRatio(result.originalLength, cut.length),
      tokens: estimateTokens(cut),
      truncated: true,
    };
  }

  /**
   * Heuristic token count for a piece of text.
   *
   * @param text - the text to estimate
   * @returns the estimated token count
   */
  estimate(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Aggregate counters for the compression subsystem.
   *
   * @returns a {@link CompressionStats} snapshot
   */
  stats(): CompressionStats {
    return this.store.stats();
  }

  /**
   * Cache-hit accounting since construction.
   *
   * @returns the number of cached-result returns
   */
  hits(): number {
    return this.cacheHits;
  }

  /**
   * Cache-miss (i.e. actual compression) accounting since construction.
   *
   * @returns the number of compressions actually performed
   */
  misses(): number {
    return this.cacheMisses;
  }

  /**
   * Snapshot the ratio/technique index.
   *
   * @returns a {@link CompressionIndexStats} report
   */
  indexStats(): CompressionIndexStats {
    return this.index.stats();
  }

  /**
   * Stop the lifecycle timer, if one is running.
   *
   * Idempotent; safe to call on compressors built with `lifecycle: false`.
   */
  dispose(): void {
    this.lifecycle?.stop();
  }
}

/**
 * Construction options for a {@link CompressionAdapter}.
 */
export interface CompressionAdapterOptions {
  /**
   * A pre-built store to adapt. When omitted, a fresh store is constructed
   * from the configuration.
   */
  readonly store?: CompressionStore;

  /**
   * A pre-built index to adapt. When omitted, a fresh index is constructed and
   * mirrored from the store.
   */
  readonly index?: CompressionIndex;

  /**
   * A pre-built compressor to adapt. When omitted, a fresh one is constructed
   * from the configuration.
   */
  readonly compressor?: TextCompressor;

  /**
   * When `true` (default), a {@link CompressionLifecycle} is attached (but not
   * started — call {@link CompressionAdapter.lifecycle} to start it).
   */
  readonly lifecycle?: boolean;

  /**
   * Maximum number of results the lifecycle keeps before pruning.
   */
  readonly maxEntries?: number;
}

/**
 * An alternate {@link CompressorInterface} implementation that adapts existing
 * components.
 *
 * {@link CompressionAdapter} is for callers who already hold a
 * {@link CompressionStore} (shared with the index or the lifecycle, say) and
 * want to expose the {@link CompressorInterface} contract over it without
 * constructing a second, competing store. It implements the same interface as
 * {@link Compressor} — `run`, `compressToMax`, `estimate`, `stats` — so the two
 * can be swapped freely.
 *
 * @example
 * ```ts
 * const store = new CompressionStore({ maxEntries: 64 });
 * const adapter = new CompressionAdapter({ store, lifecycle: true });
 * adapter.lifecycle.start();
 * const fitted = adapter.compressToMax(someText, 4000);
 * ```
 */
export class CompressionAdapter implements CompressorInterface {
  /**
   * The adapted store.
   */
  readonly store: CompressionStore;

  /**
   * The adapted index.
   */
  readonly index: CompressionIndex;

  /**
   * The adapted algorithm worker.
   */
  readonly compressor: TextCompressor;

  /**
   * An attached lifecycle (not started), or `null` when disabled.
   */
  readonly lifecycle: CompressionLifecycle | null;

  /**
   * The internal facade used to share the run/cache logic.
   */
  private readonly inner: Compressor;

  /**
   * Construct an adapter.
   *
   * @param options - construction options (component overrides, lifecycle
   *   toggle)
   * @param config - partial configuration used to build components when none
   *   is supplied
   */
  constructor(
    options: CompressionAdapterOptions = {},
    config: Partial<CompressionConfig> | undefined = undefined,
  ) {
    const resolved = mergeCompressionConfig(config);
    this.store = options.store ?? new CompressionStore({ maxEntries: options.maxEntries });
    this.index = options.index ?? new CompressionIndex();
    this.compressor = options.compressor ?? new TextCompressor(resolved);
    if (options.index) {
      this.index.rebuild(this.store.entries());
    } else {
      this.index.rebuild(this.store.entries());
    }
    this.lifecycle =
      options.lifecycle === false
        ? null
        : new CompressionLifecycle(this.store, { maxEntries: options.maxEntries });
    this.inner = new Compressor(resolved, {
      useCache: true,
      lifecycle: false,
      store: this.store,
      index: this.index,
      compressor: this.compressor,
    });
  }

  /**
   * Compress a piece of text, caching and indexing the result.
   *
   * @param text - the text to compress
   * @param options - per-call overrides
   * @returns a {@link CompressionResult}
   */
  run(text: string, options: CompressOptions = {}): CompressionResult {
    return this.inner.run(text, options);
  }

  /**
   * Compress a piece of text so the output is guaranteed to fit `maxLength`.
   *
   * @param text - the text to compress
   * @param maxLength - the maximum character length the output may have
   * @returns a {@link CompressionResult} whose `text.length <= maxLength`
   */
  compressToMax(text: string, maxLength: number): CompressionResult {
    return this.inner.compressToMax(text, maxLength);
  }

  /**
   * Heuristic token count for a piece of text.
   *
   * @param text - the text to estimate
   * @returns the estimated token count
   */
  estimate(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Aggregate counters for the compression subsystem.
   *
   * @returns a {@link CompressionStats} snapshot
   */
  stats(): CompressionStats {
    return this.store.stats();
  }

  /**
   * Snapshot the ratio/technique index.
   *
   * @returns a {@link CompressionIndexStats} report
   */
  indexStats(): CompressionIndexStats {
    return this.index.stats();
  }
}

/**
 * The default effective configuration for a compressor built without arguments.
 *
 * Pre-merged once so {@link createCompressor} and {@link CompressionAdapter}
 * share identical defaults.
 */
const DEFAULT_CONFIG: CompressionConfig = mergeCompressionConfig(undefined);

/**
 * Assemble a high-level {@link Compressor} with default wiring.
 *
 * Creates a fresh store + index + compressor + (started) lifecycle. Pass a
 * partial config to tune which passes run and the size cap.
 *
 * @param config - partial configuration, merged over the defaults
 * @param options - construction options (cache toggle, lifecycle toggle,
 *   component overrides)
 * @returns a ready-to-use {@link Compressor}
 */
export function createCompressor(
  config: Partial<CompressionConfig> | undefined = undefined,
  options: CompressorOptions = {},
): Compressor {
  const resolved: CompressionConfig = config
    ? mergeCompressionConfig(config)
    : DEFAULT_CONFIG;
  return new Compressor(resolved, options);
}