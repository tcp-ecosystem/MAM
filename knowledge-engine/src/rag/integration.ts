/**
 * High-level integration for the RAG layer.
 *
 * This module is the *front door* of the RAG layer. It wires the building
 * blocks — {@link ../store.RagStore}, {@link ../index.RagIndex},
 * {@link ../retrieval.RagRetriever} and {@link ../lifecycle.RagLifecycle} —
 * into a single, easy-to-use facade:
 *
 * - {@link RagEngine} — the full pipeline: `retrieveAndGenerate(query)` =
 *   retrieve (collect + rank) → assemble (budget-bounded context) → buildPrompt
 *   (context-augmented prompt), returning a {@link ../types.RagResult}.
 * - {@link Rag} — the minimal interface every consumer-facing component
 *   implements, so engines and adapters are interchangeable.
 * - {@link RagAdapter} — wraps a `Rag` (or a partial one) and fills any missing
 *   methods with sensible derivations, so partial implementations still present
 *   a complete surface.
 * - {@link createRagEngine} — a factory that builds a fully-wired engine from a
 *   {@link ../types.RagConfig} and an optional source function.
 *
 * @packageDocumentation
 * @module rag/integration
 */

import {
  buildCacheKey,
  clampScore,
  mergeRagConfig,
  normalizeText,
  type RagConfig,
  type RagContext,
  type RagOptions,
  type RagPiece,
  type RagResult,
  type RagSourceFn,
  type RagStats,
} from './types.js';
import { RagIndex, type RagIndexStats } from './index.js';
import { RagStore, type RagStoreStats } from './store.js';
import {
  blendContextScore,
  RagRetriever,
  type RagRetrieverStats,
} from './retrieval.js';
import { RagLifecycle, type RagLifecycleStats } from './lifecycle.js';

/**
 * The consumer-facing contract of the RAG layer.
 *
 * Any component that can retrieve, generate and manage a RAG pipeline
 * implements this interface. It is deliberately small so that engines,
 * adapters and mocks are interchangeable.
 */
export interface Rag {
  /**
   * Run the full pipeline: retrieve + assemble + buildPrompt.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns a {@link RagResult} with the assembled context and optional prompt
   */
  retrieveAndGenerate(query: string, options?: RagOptions): Promise<RagResult>;

  /**
   * Retrieve and assemble a context without generating a prompt.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns the assembled {@link RagContext}
   */
  retrieve(query: string, options?: RagOptions): Promise<RagContext>;

  /**
   * Generate a context-augmented prompt for a query.
   *
   * @param query - the raw query text
   * @param context - the assembled context
   * @returns the formatted prompt string
   */
  generate(query: string, context: RagContext): string;

  /**
   * Aggregate statistics for the component.
   *
   * @returns a {@link RagStats} snapshot
   */
  stats(): RagStats;

  /**
   * Clear all cached state.
   */
  clear(): void;

  /**
   * Release any timers or resources held by the component.
   */
  dispose(): void;
}

/**
 * Aggregate statistics for a full {@link RagEngine}.
 *
 * Extends the retriever stats with store, index and lifecycle views plus
 * engine-level generation counters.
 */
export interface RagEngineStats extends RagRetrieverStats {
  /**
   * Number of `retrieveAndGenerate` calls completed since construction.
   */
  readonly generated: number;

  /**
   * Number of cached results served by `retrieveAndGenerate` since
   * construction.
   */
  readonly generatedFromCache: number;

  /**
   * Total number of prompt characters generated since construction.
   */
  readonly promptCharacters: number;

  /**
   * The store's current view.
   */
  readonly store: RagStoreStats;

  /**
   * The index's current view.
   */
  readonly index: RagIndexStats;

  /**
   * The lifecycle's current view.
   */
  readonly lifecycle: RagLifecycleStats;
}

/**
 * Options accepted by the {@link RagEngine} constructor.
 */
export interface RagEngineOptions {
  /**
   * Base configuration; defaults are applied via {@link mergeRagConfig}.
   */
  readonly config?: Partial<RagConfig>;

  /**
   * Injectable candidate-piece source. When omitted, the internal index is the
   * fallback source.
   */
  readonly source?: RagSourceFn;

  /**
   * Pre-built store. When omitted, one is created from the config.
   */
  readonly store?: RagStore;

  /**
   * Pre-built index. When omitted, one is created.
   */
  readonly index?: RagIndex;

  /**
   * When `true`, the lifecycle sweeper starts immediately. Defaults to
   * `false`.
   */
  readonly autoStart?: boolean;
}

/**
 * Result of a `retrieveAndGenerate` cache check.
 */
interface CachedResult {
  readonly result: RagResult;
  readonly cached: boolean;
}

/**
 * The high-level facade of the RAG layer.
 *
 * `RagEngine` wires the store, index, retriever and lifecycle into a single
 * pipeline. `retrieveAndGenerate` runs the canonical three-step flow:
 *
 * 1. **retrieve** — collect candidates (via the injected source or the index),
 *    filter and rank them;
 * 2. **assemble** — fit the ranked pieces into a budget-bounded context
 *    (through the lifecycle, so `'assemble'` events fire);
 * 3. **buildPrompt** — format the context into a context-augmented prompt.
 *
 * The resulting {@link RagResult} is cached (keyed by the normalised query) so
 * repeated questions are answered from the store.
 *
 * @example
 * ```ts
 * const engine = createRagEngine(
 *   { topK: 8, budgetTokens: 400, strategy: 'hybrid' },
 *   async (query) => corpus.search(query),
 * );
 * const result = await engine.retrieveAndGenerate('how do I migrate?');
 * console.log(result.prompt);
 * ```
 */
export class RagEngine implements Rag {
  private readonly _config: RagConfig;
  private readonly _store: RagStore;
  private readonly _index: RagIndex;
  private readonly _retriever: RagRetriever;
  private readonly _lifecycle: RagLifecycle;

  private _generated: number;
  private _generatedFromCache: number;
  private _promptCharacters: number;

  /**
   * Construct a fully-wired engine.
   *
   * @param options - config, source and pre-built components
   */
  constructor(options: RagEngineOptions = {}) {
    this._config = mergeRagConfig(options.config);
    this._store =
      options.store ??
      new RagStore({
        capacity: this._config.maxCacheSize,
        ttlMs: this._config.ttlMs,
        now: this._config.now,
      });
    this._index = options.index ?? new RagIndex({ now: this._config.now });
    this._retriever = new RagRetriever({
      config: this._config,
      store: this._store,
      index: this._index,
      source: options.source,
    });
    this._lifecycle = new RagLifecycle(
      this._store,
      this._index,
      this._retriever,
      {
        ttlMs: this._config.ttlMs,
        sweepIntervalMs: this._config.sweepIntervalMs,
        maxEntries: this._config.maxCacheSize,
        autoStart: options.autoStart,
        now: this._config.now,
      },
    );
    this._generated = 0;
    this._generatedFromCache = 0;
    this._promptCharacters = 0;
  }

  /**
   * The resolved base config.
   *
   * @returns the engine's {@link RagConfig}
   */
  get config(): RagConfig {
    return this._config;
  }

  /**
   * The engine's store.
   *
   * @returns the backing {@link RagStore}
   */
  get store(): RagStore {
    return this._store;
  }

  /**
   * The engine's index.
   *
   * @returns the backing {@link RagIndex}
   */
  get index(): RagIndex {
    return this._index;
  }

  /**
   * The engine's retriever.
   *
   * @returns the backing {@link RagRetriever}
   */
  get retriever(): RagRetriever {
    return this._retriever;
  }

  /**
   * The engine's lifecycle.
   *
   * @returns the backing {@link RagLifecycle}
   */
  get lifecycle(): RagLifecycle {
    return this._lifecycle;
  }

  /**
   * Replace the injectable candidate-piece source.
   *
   * @param source - the new source function
   * @returns the engine, for chaining
   */
  setSource(source: RagSourceFn): this {
    this._retriever.setSource(source);
    return this;
  }

  /**
   * Index a single piece so the internal index can serve as a fallback source.
   *
   * @param piece - the piece to index
   * @returns the engine, for chaining
   */
  indexPiece(piece: RagPiece): this {
    this._index.indexPiece(piece);
    return this;
  }

  /**
   * Index a batch of pieces.
   *
   * @param pieces - the pieces to index
   * @returns the engine, for chaining
   */
  indexPieces(pieces: readonly RagPiece[]): this {
    this._index.rebuild(pieces);
    return this;
  }

  /**
   * Record which sources were cited for a query.
   *
   * @param query - the raw query text
   * @param sources - the source ids cited
   * @returns the engine, for chaining
   */
  indexQuery(query: string, sources: readonly string[]): this {
    this._index.indexQuery(query, sources);
    return this;
  }

  /**
   * Retrieve and assemble a context for a query.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns the assembled {@link RagContext}
   */
  async retrieve(query: string, options: RagOptions = {}): Promise<RagContext> {
    return this._retriever.retrieve(query, options);
  }

  /**
   * Generate a context-augmented prompt for a query.
   *
   * @param query - the raw query text
   * @param context - the assembled context
   * @returns the formatted prompt string
   */
  generate(query: string, context: RagContext): string {
    return this._retriever.buildPrompt(query, context);
  }

  /**
   * Run the full RAG pipeline: retrieve + assemble + buildPrompt.
   *
   * Serves from the result cache when the same query has been answered and
   * caching is enabled. On a miss, the flow is:
   *
   * 1. Collect + rank candidates via {@link RagRetriever.retrievePieces};
   * 2. Assemble a budget-bounded context via
   *    {@link RagLifecycle.assemble} (which fires `'assemble'` events);
   * 3. Build the prompt via {@link RagRetriever.buildPrompt};
   * 4. Score the result with {@link blendContextScore};
   * 5. Cache the {@link RagResult} and return it.
   *
   * @param query - the raw query text
   * @param options - per-call overrides
   * @returns a {@link RagResult} with context, optional prompt and score
   */
  async retrieveAndGenerate(
    query: string,
    options: RagOptions = {},
  ): Promise<RagResult> {
    const q = normalizeText(query);
    if (q) {
      const cached = this._peekCachedResult(q, options);
      if (cached.cached) {
        this._generatedFromCache += 1;
        return cached.result;
      }
    }

    const resolved = this._resolveOptions(options);
    const pieces = await this._retriever.retrievePieces(q, options);
    const context = this._lifecycle.assemble(
      pieces,
      resolved.budgetTokens,
      q,
    );
    const prompt = this._retriever.buildPrompt(q, context, resolved);
    const score = blendContextScore(context);
    const result: RagResult = {
      context,
      prompt,
      sources: context.sources,
      score,
      cached: false,
    };
    this._generated += 1;
    this._promptCharacters += prompt.length;

    if (resolved.includePrompt === false) {
      return { ...result, prompt: undefined };
    }
    if (q && this._config.cacheResults !== false && resolved.cache !== false) {
      const key = this._resultKey(q);
      this._store.put(key, result);
    }
    return result;
  }

  /**
   * Aggregate statistics for the whole engine.
   *
   * @returns a {@link RagEngineStats} snapshot
   */
  stats(): RagEngineStats {
    const retriever = this._retriever.stats();
    return {
      ...retriever,
      generated: this._generated,
      generatedFromCache: this._generatedFromCache,
      promptCharacters: this._promptCharacters,
      store: this._store.stats(),
      index: this._index.stats(),
      lifecycle: this._lifecycle.stats(),
    };
  }

  /**
   * Clear all cached state (store entries, pieces and query associations).
   *
   * @returns the number of store entries cleared
   */
  clear(): number {
    return this._lifecycle.reset();
  }

  /**
   * Prune the result cache to at most `maxEntries` entries.
   *
   * @param maxEntries - the target entry ceiling
   * @returns the number of entries removed
   */
  prune(maxEntries: number): number {
    return this._lifecycle.prune(maxEntries);
  }

  /**
   * Evict the cached context/result for a single query.
   *
   * @param query - the raw query text
   * @returns `true` when a cached entry was removed
   */
  clearQuery(query: string): boolean {
    return this._lifecycle.clearQuery(query);
  }

  /**
   * Release timers held by the lifecycle sweeper.
   */
  dispose(): void {
    this._lifecycle.dispose();
  }

  /**
   * Subscribe to lifecycle events (`'prune'`, `'assemble'`, `'sweep'`,
   * `'reset'`, `'start'`, `'stop'`).
   *
   * @param event - the event name
   * @param listener - the listener receiving a {@link ../types.RagLifecycleEvent}
   * @returns the engine, for chaining
   */
  on(event: string, listener: (...args: unknown[]) => void): this {
    this._lifecycle.on(event, listener);
    return this;
  }

  /**
   * Peek at a cached result for a query.
   *
   * @param query - the normalised query
   * @param options - per-call overrides (honours `cache: false`)
   * @returns the cached result and whether it was served from cache
   */
  private _peekCachedResult(
    query: string,
    options: RagOptions,
  ): CachedResult {
    if (this._config.cacheResults === false || options.cache === false) {
      return { result: undefined as unknown as RagResult, cached: false };
    }
    const cached = this._store.get<RagResult>(this._resultKey(query));
    if (!cached) {
      return { result: undefined as unknown as RagResult, cached: false };
    }
    return { result: { ...cached, cached: true }, cached: true };
  }

  /**
   * Resolve per-call options against the base config.
   *
   * @param options - the caller's overrides
   * @returns a resolved options object
   */
  private _resolveOptions(options: RagOptions): Required<RagOptions> {
    return {
      topK: options.topK ?? this._config.topK,
      budgetTokens: options.budgetTokens ?? this._config.budgetTokens,
      strategy: options.strategy ?? this._config.strategy,
      threshold: options.threshold ?? this._config.threshold ?? 0,
      sourceId: options.sourceId,
      tags: options.tags,
      cache: options.cache ?? this._config.cacheResults !== false,
      includePrompt: options.includePrompt ?? true,
      promptHeader: options.promptHeader ?? this._config.promptHeader,
      promptFooter: options.promptFooter ?? this._config.promptFooter,
    };
  }

  /**
   * Build the result cache key for a query.
   *
   * Distinct from the retriever's context cache key so result caching and
   * context caching coexist in the same store.
   *
   * @param query - the normalised query
   * @returns the result cache key
   */
  private _resultKey(query: string): string {
    return `${buildCacheKey(query)}:result`;
  }
}

/**
 * Adapter that presents any `Rag` (or partial) as a complete {@link Rag}.
 *
 * Missing methods are filled with sensible derivations:
 *
 * - a missing `retrieveAndGenerate` is composed from `retrieve` + `generate`;
 * - a missing `retrieve` is derived by running `retrieveAndGenerate` and
 *   extracting the context;
 * - a missing `generate` is derived by joining the context pieces into a
 *   plain-text block;
 * - missing `stats`/`clear`/`dispose` become safe no-ops.
 *
 * @example
 * ```ts
 * const minimal = { generate: (q, c) => render(c) };
 * const adapter = new RagAdapter(minimal);
 * const result = await adapter.retrieveAndGenerate('q'); // uses derive()
 * ```
 */
export class RagAdapter implements Rag {
  private readonly _delegate: Rag;

  /**
   * Construct an adapter over a (possibly partial) implementation.
   *
   * @param delegate - the implementation to adapt
   */
  constructor(delegate: Rag | Partial<Rag>) {
    this._delegate = completeRag(delegate);
  }

  /**
   * @inheritdoc
   */
  retrieveAndGenerate(query: string, options?: RagOptions): Promise<RagResult> {
    return this._delegate.retrieveAndGenerate(query, options);
  }

  /**
   * @inheritdoc
   */
  retrieve(query: string, options?: RagOptions): Promise<RagContext> {
    return this._delegate.retrieve(query, options);
  }

  /**
   * @inheritdoc
   */
  generate(query: string, context: RagContext): string {
    return this._delegate.generate(query, context);
  }

  /**
   * @inheritdoc
   */
  stats(): RagStats {
    return this._delegate.stats();
  }

  /**
   * @inheritdoc
   */
  clear(): void {
    this._delegate.clear();
  }

  /**
   * @inheritdoc
   */
  dispose(): void {
    this._delegate.dispose();
  }

  /**
   * The underlying adapted implementation.
   *
   * @returns the complete {@link Rag}
   */
  get delegate(): Rag {
    return this._delegate;
  }
}

/**
 * Fill a partial {@link Rag} into a complete one with derived defaults.
 *
 * @param partial - the partial implementation
 * @returns a complete {@link Rag}
 */
export function completeRag(partial: Partial<Rag>): Rag {
  const hasFull = (p: Partial<Rag>): p is Rag =>
    typeof p.retrieveAndGenerate === 'function' &&
    typeof p.retrieve === 'function' &&
    typeof p.generate === 'function';
  if (hasFull(partial)) {
    return partial;
  }

  const generate =
    partial.generate ??
    ((_query: string, context: RagContext): string =>
      context.pieces.map((p) => p.text).join('\n'));

  const retrieveAndGenerate =
    partial.retrieveAndGenerate ??
    (async (query: string, options?: RagOptions): Promise<RagResult> => {
      const context = await (partial.retrieve
        ? partial.retrieve(query, options)
        : emptyContext(query, options));
      const prompt = generate(query, context);
      return {
        context,
        prompt,
        sources: context.sources,
        score: blendContextScore(context),
      };
    });

  const retrieve =
    partial.retrieve ??
    (async (query: string, options?: RagOptions): Promise<RagContext> => {
      const result = await retrieveAndGenerate(query, options);
      return result.context;
    });

  const stats =
    partial.stats ??
    ((): RagStats => ({
      queries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cached: 0,
      assembled: 0,
      pruned: 0,
      evictions: 0,
      createdAt: Date.now(),
      lastAccessAt: null,
      cachedRatio: 0,
    }));

  const clear = partial.clear ?? ((): void => undefined);
  const dispose = partial.dispose ?? ((): void => undefined);

  return {
    retrieveAndGenerate,
    retrieve,
    generate,
    stats,
    clear,
    dispose,
  };
}

/**
 * Build a canonical empty context for a query.
 *
 * @param query - the raw query text
 * @param options - optional budget override
 * @returns an empty-but-valid {@link RagContext}
 */
function emptyContext(
  query: string,
  options?: RagOptions,
): RagContext {
  const budget = Math.max(
    0,
    Math.floor(options?.budgetTokens ?? 512),
  );
  return {
    pieces: [],
    budgetTokens: budget,
    totalTokens: 0,
    query: normalizeText(query),
    sources: [],
  };
}

/**
 * Factory: build a fully-wired {@link RagEngine}.
 *
 * Applies safe defaults, creates the store/index/retriever/lifecycle and wires
 * them together. The optional `source` injects the candidate-piece provider;
 * when omitted the engine's internal index (populated via
 * {@link RagEngine.indexPieces}) serves as the fallback source.
 *
 * @param config - base configuration (optional)
 * @param source - candidate-piece source function (optional)
 * @param options - additional engine options (optional)
 * @returns a ready-to-use {@link RagEngine}
 */
export function createRagEngine(
  config?: Partial<RagConfig>,
  source?: RagSourceFn,
  options: Omit<RagEngineOptions, 'config' | 'source'> = {},
): RagEngine {
  const engine = new RagEngine({ config, source, ...options });
  return engine;
}

/**
 * Convenience: create an engine pre-populated with an indexed corpus.
 *
 * @param pieces - the pieces to index into the engine's fallback index
 * @param config - base configuration (optional)
 * @param options - additional engine options (optional)
 * @returns a ready-to-use {@link RagEngine} whose index serves the corpus
 */
export function createCorpusEngine(
  pieces: readonly RagPiece[],
  config?: Partial<RagConfig>,
  options: Omit<RagEngineOptions, 'config'> = {},
): RagEngine {
  const engine = new RagEngine({ config, ...options });
  engine.indexPieces(pieces);
  return engine;
}

/**
 * Normalise a final score into `[0, 1]` with the shared clamp.
 *
 * @param score - the raw score
 * @returns the clamped score
 */
export function normalizeScore(score: number): number {
  return clampScore(score);
}