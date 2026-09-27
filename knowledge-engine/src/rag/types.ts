/**
 * Shared domain types for the RAG (Retrieval-Augmented Generation) layer of the
 * standalone MAM Knowledge Engine.
 *
 * The RAG layer is the bridge between *retrieval* and *generation*: it takes
 * the ranked chunks produced by a retrieval step, assembles them into a
 * token-budget bounded context window, and formats that context into a prompt
 * the generation step can consume. It answers the question a generation
 * pipeline actually asks: *"given this query and this budget, which evidence
 * should the model see, and in what order?"*
 *
 * The layer is built from five cooperating pieces:
 *
 * 1. **Types** (this module) — the public contract shared by every other file.
 * 2. **Store** ({@link ../store.RagStore}) — a bounded, TTL-aware cache of RAG
 *    results and context pieces so repeated queries do not re-run the pipeline.
 * 3. **Index** ({@link ../index.RagIndex}) — a source-to-context index that maps
 *    piece ids, owning sources and query-to-source associations.
 * 4. **Retriever** ({@link ../retrieval.RagRetriever}) — collects candidate
 *    pieces, ranks them, assembles a budget-bounded context and formats a
 *    context-augmented prompt.
 * 5. **Lifecycle** ({@link ../lifecycle.RagLifecycle}) — TTL sweeping, pruning,
 *    query eviction and lifecycle events.
 * 6. **Engine** ({@link ../integration.RagEngine}) — the high-level facade that
 *    wires all of the above into `retrieveAndGenerate`.
 *
 * The types in this module form the contract those pieces share:
 *
 * - {@link RagPiece} — a single unit of evidence with a relevance score.
 * - {@link RagContext} — an assembled, budget-bounded set of pieces.
 * - {@link RagConfig} — construction/behaviour options for the whole layer.
 * - {@link RagOptions} — per-call overrides accepted by every entry point.
 * - {@link RagResult} — a complete RAG answer: context plus optional prompt.
 * - {@link RagStats} — aggregate counters describing a store, index, retriever,
 *   lifecycle or engine.
 *
 * Every value in this module is deliberately framework-agnostic and
 * JSON-serialisable: an assembled {@link RagContext} or {@link RagResult} can
 * round-trip through `JSON.stringify`/`JSON.parse` without loss, so a result
 * produced in one process can be persisted and replayed by another.
 *
 * @packageDocumentation
 * @module rag/types
 */

/**
 * Assembly strategy used when fitting pieces into a token budget.
 *
 * - `'sequential'` — pieces are taken strictly in score order (highest first)
 *   until the budget is exhausted. This maximises per-piece relevance but can
 *   concentrate the window on a single source.
 * - `'hybrid'` — pieces are bucketed by source and then merged in a
 *   round-robin, score-aware fashion so the context window stays diverse across
 *   sources while still favouring higher-scoring evidence inside each source.
 */
export type RagStrategy = 'sequential' | 'hybrid';

/**
 * Discriminator for lifecycle events emitted by
 * {@link ../lifecycle.RagLifecycle}.
 */
export type RagEventType =
  | 'prune'
  | 'assemble'
  | 'sweep'
  | 'reset'
  | 'start'
  | 'stop';

/**
 * A single unit of evidence selected for (or eligible for) a RAG context.
 *
 * A {@link RagPiece} is the currency of the RAG layer. It wraps the raw
 * evidence `text`, the provenance handles (`id`, `sourceId`, optional
 * `source`), and a `score` in `[0, 1]` describing relevance to the query that
 * produced it. Optional fields — `tags`, `vector`, `metadata`, `reason` —
 * travel along for downstream consumers that need to explain or re-rank
 * without re-fetching the original chunk.
 *
 * @example
 * ```ts
 * const piece: RagPiece = {
 *   id: 'manual/3',
 *   sourceId: 'manual',
 *   text: 'Always back up before migrating.',
 *   score: 0.87,
 *   rank: 1,
 *   source: 'operations-manual.md',
 *   tags: ['backup', 'migration'],
 * };
 * ```
 */
export interface RagPiece {
  /**
   * Unique identifier of the piece. Opaque to the RAG layer — used only as a
   * map key and a correlation handle.
   */
  readonly id: string;

  /**
   * Identifier of the source document the piece was carved from. Grouping by
   * this field powers source filtering and hybrid (diverse) assembly.
   */
  readonly sourceId: string;

  /**
   * The piece's textual content. This is the evidence the generation step will
   * actually see, so it is preserved verbatim.
   */
  readonly text: string;

  /**
   * Relevance score in `[0, 1]`. `1` is a perfect match; `0` means the piece
   * survived only as fallback filler.
   */
  readonly score: number;

  /**
   * Zero-based position of this piece within its context window, assigned at
   * assembly time. `undefined` until the piece has been placed.
   */
  readonly rank?: number;

  /**
   * Human-readable provenance label for the owning source (e.g. a file name).
   */
  readonly source?: string;

  /**
   * Optional set of tags associated with the piece, used for filtering.
   */
  readonly tags?: readonly string[];

  /**
   * Optional dense embedding vector, when the caller supplies one.
   */
  readonly vector?: readonly number[];

  /**
   * Caller-owned structured metadata preserved verbatim. The RAG layer never
   * interprets it.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;

  /**
   * Human-readable explanation of *why* this piece scored as it did (e.g.
   * `"term overlap 3/5"`). Useful for debugging retrieval decisions.
   */
  readonly reason?: string;
}

/**
 * An injectable source of candidate pieces.
 *
 * The retriever does not own the corpus; it asks an injected function for
 * candidate pieces. The function may return synchronously or asynchronously,
 * and may return an empty array to signal "no candidates". This keeps the RAG
 * layer decoupled from any particular embedding or scoring backend.
 */
export type RagSourceFn = (
  query: string,
  options: Readonly<RagOptions>,
) => readonly RagPiece[] | Promise<readonly RagPiece[]>;

/**
 * An assembled, budget-bounded context window.
 *
 * Produced by {@link ../retrieval.RagRetriever.assemble} and consumed by
 * {@link ../retrieval.RagRetriever.buildPrompt}. The `pieces` array is the
 * subset of candidates that actually fit inside `budgetTokens`; `totalTokens`
 * records how many tokens they consumed; `sources` lists the distinct source
 * ids (or labels) represented.
 */
export interface RagContext {
  /**
   * The pieces selected for the window, in assembly order (best first).
   */
  readonly pieces: readonly RagPiece[];

  /**
   * The token ceiling the assembly was asked to respect.
   */
  readonly budgetTokens: number;

  /**
   * The number of tokens the selected pieces actually consume. `undefined`
   * until assembly has run.
   */
  readonly totalTokens?: number;

  /**
   * The normalised query text this context answers.
   */
  readonly query: string;

  /**
   * Distinct source ids (or labels) represented by `pieces`, in first-appearance
   * order. Drives attribution in generated prompts.
   */
  readonly sources: readonly string[];
}

/**
 * Construction/behaviour options for the RAG layer.
 *
 * The three required fields form the core contract: how many candidates are
 * considered (`topK`), how many tokens the context window may hold
 * (`budgetTokens`), and how pieces are fitted into that window (`strategy`).
 * Every other field is optional and tunes caching, filtering, prompting and
 * lifecycle behaviour. Defaults are produced by {@link defaultRagConfig}.
 */
export interface RagConfig {
  /**
   * Maximum number of candidate pieces collected and ranked for a query.
   * Defaults to `10`.
   */
  readonly topK: number;

  /**
   * Token ceiling for an assembled context window. Defaults to `512`.
   */
  readonly budgetTokens: number;

  /**
   * Assembly strategy. See {@link RagStrategy}. Defaults to `'sequential'`.
   */
  readonly strategy: RagStrategy;

  /**
   * Minimum score a piece must reach to enter the context. Defaults to `0`.
   */
  readonly threshold?: number;

  /**
   * When `true` (default), results and contexts are cached so repeated queries
   * hit the store instead of re-running retrieval.
   */
  readonly cacheResults?: boolean;

  /**
   * Time-to-live in milliseconds for cached entries before the lifecycle
   * sweeps them. Defaults to `60_000` (one minute).
   */
  readonly ttlMs?: number;

  /**
   * Maximum number of cached entries retained by the store. Defaults to `1000`.
   */
  readonly maxCacheSize?: number;

  /**
   * Interval in milliseconds between lifecycle TTL sweeps. Defaults to `30_000`.
   */
  readonly sweepIntervalMs?: number;

  /**
   * Header line placed at the top of a generated prompt.
   */
  readonly promptHeader?: string;

  /**
   * Footer line placed at the bottom of a generated prompt.
   */
  readonly promptFooter?: string;

  /**
   * Separator used between the context block and the question in a prompt.
   */
  readonly promptSeparator?: string;

  /**
   * When `true` (default), each piece's score is shown in the generated prompt.
   */
  readonly includeScores?: boolean;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps. Injecting
   * a clock makes the layer deterministic under test.
   */
  readonly now?: () => number;
}

/**
 * Per-call overrides for a single RAG operation.
 *
 * These values override the constructor-time {@link RagConfig} for one
 * invocation only. They are deliberately optional — every entry point falls
 * back to its configured defaults for anything the caller omits.
 */
export interface RagOptions {
  /**
   * Maximum number of candidate pieces to consider. Overrides
   * {@link RagConfig.topK}.
   */
  readonly topK?: number;

  /**
   * Token ceiling for the assembled context. Overrides
   * {@link RagConfig.budgetTokens}.
   */
  readonly budgetTokens?: number;

  /**
   * Assembly strategy for this call. Overrides {@link RagConfig.strategy}.
   */
  readonly strategy?: RagStrategy;

  /**
   * Minimum score floor. Overrides {@link RagConfig.threshold}.
   */
  readonly threshold?: number;

  /**
   * Scoping to a single source: only pieces whose `sourceId` equals this value
   * are eligible.
   */
  readonly sourceId?: string;

  /**
   * Tag filter: only pieces carrying all of these tags are eligible.
   */
  readonly tags?: readonly string[];

  /**
   * When `false`, the assembled context is not written to the store cache.
   */
  readonly cache?: boolean;

  /**
   * When `true`, the generated prompt is included in the returned
   * {@link RagResult}.
   */
  readonly includePrompt?: boolean;

  /**
   * Overrides {@link RagConfig.promptHeader} for this call.
   */
  readonly promptHeader?: string;

  /**
   * Overrides {@link RagConfig.promptFooter} for this call.
   */
  readonly promptFooter?: string;
}

/**
 * A complete answer from the RAG layer.
 *
 * Wraps the assembled {@link RagContext} with the optional generated `prompt`
 * (when the caller requested one), the distinct `sources` cited, and an
 * aggregate `score` in `[0, 1]` describing how well the context covers the
 * query under the given budget.
 */
export interface RagResult {
  /**
   * The assembled, budget-bounded context window.
   */
  readonly context: RagContext;

  /**
   * The context-augmented prompt, when the caller requested one.
   */
  readonly prompt?: string;

  /**
   * Distinct source ids (or labels) cited by the context, in first-appearance
   * order.
   */
  readonly sources: readonly string[];

  /**
   * Aggregate score in `[0, 1]` — a blend of average piece relevance and how
   * much of the budget the context actually used. `0` when the context is
   * empty.
   */
  readonly score: number;

  /**
   * `true` when this result was served from the cache rather than recomputed.
   */
  readonly cached?: boolean;
}

/**
 * Aggregate statistics describing a RAG store, index, retriever, lifecycle or
 * engine.
 *
 * Counter fields are monotonically increasing from construction; derived
 * fields (`cachedRatio`, `lastAccessAt`) are computed on demand. Concrete
 * components extend this shape with component-specific fields.
 */
export interface RagStats {
  /**
   * Total number of queries processed since construction.
   */
  readonly queries: number;

  /**
   * Number of cache hits (a cached value was served) since construction.
   */
  readonly cacheHits: number;

  /**
   * Number of cache misses (a value was computed from scratch) since
   * construction.
   */
  readonly cacheMisses: number;

  /**
   * Number of cached/assembled contexts served since construction.
   */
  readonly cached: number;

  /**
   * Number of context assemblies performed since construction.
   */
  readonly assembled: number;

  /**
   * Number of entries pruned/expired by the lifecycle since construction.
   */
  readonly pruned: number;

  /**
   * Number of entries evicted by capacity pressure since construction.
   */
  readonly evictions: number;

  /**
   * Epoch-millisecond time the component was constructed.
   */
  readonly createdAt: number;

  /**
   * Epoch-millisecond time of the most recent access, or `null` if none.
   */
  readonly lastAccessAt: number | null;

  /**
   * Ratio of cache hits to total cache lookups (`0..1`). `0` when no lookups
   * have happened yet.
   */
  readonly cachedRatio: number;
}

/**
 * Payload emitted by the {@link ../lifecycle.RagLifecycle} event emitter.
 *
 * Every event carries the discriminator, a timestamp and an operation-specific
 * payload. `'prune'` fires when entries are removed, `'assemble'` fires when a
 * context window is assembled, `'sweep'` fires after a TTL sweep pass,
 * `'reset'` fires when the lifecycle is reset, and `'start'`/`'stop'` fire when
 * the periodic sweeper is started or stopped.
 */
export interface RagLifecycleEvent {
  /**
   * The lifecycle operation that fired.
   */
  readonly type: RagEventType;

  /**
   * Epoch-millisecond time at which the event was emitted.
   */
  readonly timestamp: number;

  /**
   * Number of entries affected by the operation.
   */
  readonly count: number;

  /**
   * Keys or piece ids involved in the operation, when applicable.
   */
  readonly keys?: readonly string[];

  /**
   * Operation-specific detail (e.g. the assembled {@link RagContext} for an
   * `'assemble'` event).
   */
  readonly detail?: unknown;
}

/**
 * A canonical descriptor of a cited source, used when rendering attribution.
 */
export interface RagSourceDescriptor {
  /**
   * The source id (or label).
   */
  readonly sourceId: string;

  /**
   * Number of pieces citing this source within the context.
   */
  readonly pieceCount: number;

  /**
   * Best score achieved by any piece of this source in the context.
   */
  readonly bestScore: number;
}

/**
 * Anything the {@link ../store.RagStore} can cache: a single piece, an
 * assembled context, or a complete result.
 */
export type RagStoreValue = RagPiece | RagContext | RagResult;

/**
 * Default maximum number of candidate pieces considered per query.
 */
export const DEFAULT_TOP_K = 10;

/**
 * Default token ceiling for an assembled context window.
 */
export const DEFAULT_BUDGET_TOKENS = 512;

/**
 * Default assembly strategy.
 */
export const DEFAULT_STRATEGY: RagStrategy = 'sequential';

/**
 * Default minimum score a piece must reach to enter the context.
 */
export const DEFAULT_THRESHOLD = 0;

/**
 * Default time-to-live (ms) for cached RAG entries.
 */
export const DEFAULT_TTL_MS = 60_000;

/**
 * Default maximum number of cached entries retained by the store.
 */
export const DEFAULT_MAX_CACHE_SIZE = 1000;

/**
 * Default interval (ms) between lifecycle TTL sweeps.
 */
export const DEFAULT_SWEEP_INTERVAL_MS = 30_000;

/**
 * Default prompt header line.
 */
export const DEFAULT_PROMPT_HEADER = 'Answer the question using ONLY the following context.';

/**
 * Default prompt footer line.
 */
export const DEFAULT_PROMPT_FOOTER = 'If the context does not contain the answer, say so clearly.';

/**
 * Default separator placed between the context block and the question.
 */
export const DEFAULT_PROMPT_SEPARATOR = 'Question:';

/**
 * Normalise free text for comparison, hashing and tokenization.
 *
 * Trims surrounding whitespace and collapses internal runs of whitespace to a
 * single space. Optionally lower-cases the result.
 *
 * @param text - the raw text to normalise
 * @param lower - when `true` (default), the result is lower-cased
 * @returns the normalised text, or `''` when `text` is falsy
 */
export function normalizeText(text: string | undefined, lower = true): string {
  if (!text) {
    return '';
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return lower ? collapsed.toLowerCase() : collapsed;
}

/**
 * Count the tokens in a string using a whitespace-aware scan.
 *
 * This is a cheap, dependency-free approximation of tokenization intended for
 * budget accounting. A "token" is any maximal run of non-whitespace code
 * units. It is deliberately close to what `split(/\s+/)` would produce while
 * avoiding the intermediate array allocation.
 *
 * @param text - the text to count
 * @returns the number of whitespace-delimited tokens, `0` for empty text
 */
export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }
  let count = 0;
  let inToken = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isWhitespace =
      code === 32 || (code >= 9 && code <= 13) || code === 160;
    if (isWhitespace) {
      inToken = false;
    } else if (!inToken) {
      inToken = true;
      count += 1;
    }
  }
  return count;
}

/**
 * Estimate the token count of a string with the `chars / 4` heuristic.
 *
 * Useful when the caller only has character counts (e.g. pre-computed piece
 * lengths) and wants a cheaper, meaner estimate than {@link countTokens}.
 *
 * @param text - the text to estimate
 * @returns an estimate of the token count, at least `1` for non-empty text
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Clamp a number into `[min, max]`.
 *
 * @param value - the value to clamp
 * @param min - inclusive lower bound
 * @param max - inclusive upper bound
 * @returns the clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Clamp a score into the canonical `[0, 1]` range.
 *
 * Repairs floating-point drift and rejects negative or super-unity inputs.
 *
 * @param score - the raw score
 * @returns the clamped score, or `0` when the input is not finite
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return clamp(score, 0, 1);
}

/**
 * Hash a string with the FNV-1a 32-bit algorithm.
 *
 * Produces a stable, collision-resistant-enough hex digest used to build cache
 * keys from normalised query text. Deterministic across processes and
 * platforms — ideal for persistence via {@link ../store.RagStore.toJSON}.
 *
 * @param input - the string to hash
 * @returns an 8-character lowercase hex digest
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a canonical cache key for a query string.
 *
 * Normalises the query, hashes it and prefixes the result so RAG cache keys
 * share a recognisable namespace.
 *
 * @param query - the raw query text
 * @returns a stable cache key for the query
 */
export function buildCacheKey(query: string): string {
  return `rag:${hashString(normalizeText(query))}`;
}

/**
 * Narrow a value to {@link RagPiece} by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link RagPiece}
 */
export function isRagPiece(value: unknown): value is RagPiece {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<RagPiece>;
  return (
    typeof record.id === 'string' &&
    typeof record.sourceId === 'string' &&
    typeof record.text === 'string' &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score)
  );
}

/**
 * Narrow a value to {@link RagContext} by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link RagContext}
 */
export function isRagContext(value: unknown): value is RagContext {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<RagContext>;
  return (
    Array.isArray(record.pieces) &&
    record.pieces.every(isRagPiece) &&
    typeof record.budgetTokens === 'number' &&
    typeof record.query === 'string' &&
    Array.isArray(record.sources)
  );
}

/**
 * Narrow a value to {@link RagResult} by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link RagResult}
 */
export function isRagResult(value: unknown): value is RagResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<RagResult>;
  return (
    isRagContext(record.context) &&
    Array.isArray(record.sources) &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score)
  );
}

/**
 * Sort pieces by score, highest first, with a stable comparator.
 *
 * Returns a new array; the input is not mutated. Stability matters so that
 * ties resolve in insertion order.
 *
 * @param pieces - the pieces to sort
 * @returns a new array sorted by descending score
 */
export function sortPiecesByScore(
  pieces: readonly RagPiece[],
): RagPiece[] {
  return [...pieces].sort((a, b) => b.score - a.score);
}

/**
 * Collect the distinct source ids of a set of pieces, in first-appearance
 * order.
 *
 * @param pieces - the pieces to inspect
 * @returns the distinct source ids, or the `source` labels when ids repeat
 */
export function uniqueSources(pieces: readonly RagPiece[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of pieces) {
    const key = piece.sourceId;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Compute the mean score of a set of pieces.
 *
 * @param pieces - the pieces to average
 * @returns the mean score in `[0, 1]`, or `0` for an empty set
 */
export function averageScore(pieces: readonly RagPiece[]): number {
  if (pieces.length === 0) {
    return 0;
  }
  let total = 0;
  for (const piece of pieces) {
    total += piece.score;
  }
  return total / pieces.length;
}

/**
 * Produce a {@link RagConfig} with safe defaults for general knowledge use.
 *
 * @param overrides - optional values to overlay on the defaults
 * @returns a fully-populated {@link RagConfig}
 */
export function defaultRagConfig(overrides?: Partial<RagConfig>): RagConfig {
  return {
    topK: overrides?.topK ?? DEFAULT_TOP_K,
    budgetTokens: overrides?.budgetTokens ?? DEFAULT_BUDGET_TOKENS,
    strategy: overrides?.strategy ?? DEFAULT_STRATEGY,
    threshold: overrides?.threshold ?? DEFAULT_THRESHOLD,
    cacheResults: overrides?.cacheResults ?? true,
    ttlMs: overrides?.ttlMs ?? DEFAULT_TTL_MS,
    maxCacheSize: overrides?.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE,
    sweepIntervalMs:
      overrides?.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
    promptHeader: overrides?.promptHeader ?? DEFAULT_PROMPT_HEADER,
    promptFooter: overrides?.promptFooter ?? DEFAULT_PROMPT_FOOTER,
    promptSeparator:
      overrides?.promptSeparator ?? DEFAULT_PROMPT_SEPARATOR,
    includeScores: overrides?.includeScores ?? true,
    now: overrides?.now,
  };
}

/**
 * Merge multiple partial configs, later entries winning.
 *
 * @param configs - configs to merge, in increasing precedence
 * @returns the merged config over {@link defaultRagConfig}
 */
export function mergeRagConfig(
  ...configs: ReadonlyArray<Partial<RagConfig> | undefined>
): RagConfig {
  const merged: Partial<RagConfig> = {};
  for (const config of configs) {
    if (!config) {
      continue;
    }
    Object.assign(merged, config);
  }
  return defaultRagConfig(merged);
}

/**
 * Build a base {@link RagStats} with zeroed counters.
 *
 * @param now - optional clock; defaults to `Date.now`
 * @returns an empty-but-valid {@link RagStats}
 */
export function emptyRagStats(now: () => number = Date.now): RagStats {
  return {
    queries: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cached: 0,
    assembled: 0,
    pruned: 0,
    evictions: 0,
    createdAt: now(),
    lastAccessAt: null,
    cachedRatio: 0,
  };
}