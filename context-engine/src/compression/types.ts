/**
 * Shared domain types for the **Compression** layer of the standalone MAM
 * Context Engine.
 *
 * The Compression layer shrinks context text *deterministically* — no LLM
 * involved — so that a long prompt section can be made to fit a token budget
 * without losing the information a human or another layer still cares about.
 * It sits between **Context assembly** (which produces the raw `system`,
 * `user`, `tool`, `memory` and `knowledge` sections) and **generation** (which
 * consumes the flattened prompt), and is responsible for:
 *
 * 1. **Lossless shrinking** — collapsing runs of whitespace and removing
 *    duplicated blocks. These passes change *formatting* but not *content*:
 *    the semantics of the text are fully preserved.
 * 2. **Lossy shrinking** — stripping markdown syntax (keeping the words) and
 *    hard-truncating to a maximum length. These passes trade fidelity for
 *    size, so they are applied only when a hard limit demands it.
 * 3. **Keyword extraction** — distilling a section down to its most frequent,
 *    most distinctive words, which is useful for topic summaries and as a
 *    fallback when the section is too big to keep verbatim at all.
 * 4. **Tiered compression** — composing the above in a fixed, deterministic
 *    order (`lossless → lossy → truncate`) and reporting exactly what happened
 *    via a {@link CompressionResult} so callers know how much was saved and
 *    whether anything was dropped.
 * 5. **Caching & indexing** — remembering past results in a
 *    `context-engine/src/compression/store` keyed by content+options, and
 *    keeping an index by technique and compression ratio so the engine can
 *    answer "which sections were compressed most aggressively?" cheaply.
 *
 * The types in this module form the public contract shared by every other file
 * of the compression subsystem:
 *
 * - {@link CompressionTechnique} — the name of a single compression strategy.
 * - {@link CompressionConfig} — construction/behaviour options: which passes
 *   are enabled, whether code blocks survive markdown stripping, and the
 *   configured technique.
 * - {@link CompressOptions} — per-operation overrides for a single
 *   {@link TextCompressor.compress} call.
 * - {@link CompressionResult} — the outcome of one compression: the shrunken
 *   text plus the bookkeeping (lengths, ratio, tokens, technique) needed to
 *   log or react to it.
 * - {@link CompressionStats} — aggregate counters describing the subsystem.
 * - {@link RatioBucket} — the coarse "how aggressive was this compression"
 *   bands used by {@link CompressionIndex}.
 * - {@link CompressionState} — a serialisable snapshot of a
 *   {@link CompressionStore}, round-trippable through JSON.
 *
 * Every value is deliberately framework-agnostic and JSON-serialisable, and
 * the module exports the pure helpers the rest of the layer composes
 * ({@link estimateTokens}, {@link computeRatio}, {@link ratioBucket},
 * {@link defaultCompressionConfig}, {@link mergeCompressionConfig}, …) so the
 * compression logic stays deterministic and unit-testable.
 *
 * @packageDocumentation
 * @module compression/types
 */

/**
 * Identifier for a single compression strategy.
 *
 * - `'none'` — apply no transforms; only a configured `maxLength` truncation
 *   may still run. Used when a caller wants the text verbatim but size-capped.
 * - `'truncate'` — cut the text to `maxLength` at a word boundary.
 * - `'collapse'` — collapse whitespace runs to single separators.
 * - `'dedupe'` — remove duplicated blocks (paragraphs), keeping the first
 *   occurrence.
 * - `'strip-markdown'` — remove markdown syntax while keeping the words
 *   (optionally preserving fenced code blocks verbatim).
 * - `'keywords'` — replace the text with its top-N most significant keywords.
 * - `'tiered'` — apply the lossless passes first, then the lossy ones, then
 *   truncation; the default and most useful strategy.
 */
export type CompressionTechnique =
  | 'none'
  | 'truncate'
  | 'collapse'
  | 'dedupe'
  | 'strip-markdown'
  | 'keywords'
  | 'tiered';

/**
 * Coarse band describing how aggressive a compression result was, derived from
 * its {@link CompressionResult.ratio}.
 *
 * - `'none'` — the output is not smaller than the input (`ratio <= 0`).
 * - `'low'` — less than {@link DEFAULT_RATIO_EDGES}[0] saved.
 * - `'medium'` — between the first and second edge.
 * - `'high'` — between the second and third edge.
 * - `'extreme'` — at or above the third edge.
 *
 * {@link ratioBucket} derives a bucket from a ratio; the {@link CompressionIndex}
 * keeps results bucketed by it so "which sections were compressed hardest?"
 * is answerable without scanning every entry.
 */
export type RatioBucket = 'none' | 'low' | 'medium' | 'high' | 'extreme';

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the compression layer use epoch milliseconds so they
 * interoperate cleanly with `Date`, `performance.now()`-derived clocks and the
 * TTL/interval arithmetic in {@link CompressionLifecycle}.
 */
export type Timestamp = number;

/**
 * The outcome of a single compression operation.
 *
 * Returned by {@link TextCompressor.compress} and the integration facades
 * ({@link Compressor.run}, {@link Compressor.compressToMax}). The headline
 * relationship is `ratio = 1 - compressedLength / originalLength`: a `ratio`
 * of `0.5` means the output is half the size of the input, `0` means no
 * savings at all. `droppedBlocks` counts content that was *removed* rather
 * than merely resized (duplicated blocks deleted, markdown constructs
 * stripped, keywords discarded) so callers can judge how lossy a result was.
 *
 * @example
 * ```ts
 * const result: CompressionResult = {
 *   text: 'fitted output…',
 *   originalLength: 12_400,
 *   compressedLength: 6_200,
 *   ratio: 0.5,
 *   tokens: 1550,
 *   technique: 'tiered',
 *   droppedBlocks: 3,
 *   truncated: false,
 *   config: defaultCompressionConfig(),
 *   at: Date.now(),
 * };
 * ```
 */
export interface CompressionResult {
  /**
   * The compressed text. Always a non-empty-string-capable value whose length
   * never exceeds the effective `maxLength`.
   */
  readonly text: string;

  /**
   * Character length of the input text *before* compression.
   */
  readonly originalLength: number;

  /**
   * Character length of {@link CompressionResult.text}.
   */
  readonly compressedLength: number;

  /**
   * Fraction of the original text saved: `1 - compressedLength / originalLength`,
   * in `[0, 1]` (exactly `0` for an empty original). See {@link computeRatio}.
   */
  readonly ratio: number;

  /**
   * Heuristic token estimate of {@link CompressionResult.text}
   * (`Math.ceil(len / 4)`, see {@link estimateTokens}). Optional so callers
   * that do not need token math can omit it.
   */
  readonly tokens?: number;

  /**
   * The effective technique applied to produce this result.
   */
  readonly technique: CompressionTechnique;

  /**
   * Number of content blocks *removed* (not resized) by the compression:
   * duplicated paragraphs dropped by dedupe, markdown constructs stripped, or
   * keywords elided. `0` when nothing was dropped. Optional for results that
   * performed no removal.
   */
  readonly droppedBlocks?: number;

  /**
   * `true` when the text had to be truncated to the effective `maxLength`.
   */
  readonly truncated?: boolean;

  /**
   * The effective configuration this result was produced under, after merging
   * constructor config and per-call options. Useful for debugging and for
   * reproducing the result from its key.
   */
  readonly config?: CompressionConfig;

  /**
   * Epoch-millisecond time the result was produced.
   */
  readonly at?: Timestamp;
}

/**
 * Construction/behaviour options for the compression subsystem.
 *
 * A {@link CompressionConfig} may be supplied to {@link TextCompressor},
 * {@link Compressor}, {@link CompressionAdapter} and the lifecycle to tune
 * which passes run and what the hard size cap is. Every field has a sensible
 * default (see {@link defaultCompressionConfig}); callers override only what
 * they care about.
 *
 * @example
 * ```ts
 * const config: CompressionConfig = {
 *   maxLength: 16_000,
 *   collapseWhitespace: true,
 *   dedupeBlocks: true,
 *   stripMarkdown: true,
 *   preserveCodeBlocks: true,
 *   technique: 'tiered',
 * };
 * ```
 */
export interface CompressionConfig {
  /**
   * Hard cap (in characters) on the compressed output. When the compressed
   * text still exceeds this, it is truncated at a word boundary (see
   * {@link TextCompressor.truncate}). `undefined` disables the cap. Defaults
   * to {@link DEFAULT_MAX_LENGTH}.
   */
  readonly maxLength?: number;

  /**
   * When `true`, runs of whitespace are collapsed to single separators
   * (spaces, and paragraph breaks kept as double newlines). Defaults to
   * `true`.
   */
  readonly collapseWhitespace?: boolean;

  /**
   * When `true`, duplicated blocks (paragraphs) are removed, keeping the first
   * occurrence of each. Defaults to `true`.
   */
  readonly dedupeBlocks?: boolean;

  /**
   * When `true`, markdown syntax (headings, bold/italic, links, inline code,
   * lists, blockquotes) is stripped, leaving the words. Defaults to `false`
   * because it is lossy.
   */
  readonly stripMarkdown?: boolean;

  /**
   * When `true` (and `stripMarkdown` is enabled), fenced code blocks
   * (```…``` / ~~~…~~~) are left verbatim rather than having their inner
   * markdown stripped. Defaults to `true`.
   */
  readonly preserveCodeBlocks?: boolean;

  /**
   * The default technique applied when a call does not override it. Defaults
   * to {@link DEFAULT_TECHNIQUE} (`'tiered'`).
   */
  readonly technique?: CompressionTechnique;
}

/**
 * Per-operation overrides accepted by `compress` (and the integration facades).
 *
 * Every field is optional so a caller can override the configured behaviour
 * for a single call without disturbing the shared config — e.g. force
 * `stripMarkdown` for one section while the subsystem default keeps it off.
 * Field-for-field identical to {@link CompressionConfig} plus {@link topN}.
 */
export interface CompressOptions {
  /**
   * One-call override of {@link CompressionConfig.maxLength}.
   */
  readonly maxLength?: number;

  /**
   * One-call override of {@link CompressionConfig.collapseWhitespace}.
   */
  readonly collapseWhitespace?: boolean;

  /**
   * One-call override of {@link CompressionConfig.dedupeBlocks}.
   */
  readonly dedupeBlocks?: boolean;

  /**
   * One-call override of {@link CompressionConfig.stripMarkdown}.
   */
  readonly stripMarkdown?: boolean;

  /**
   * One-call override of {@link CompressionConfig.preserveCodeBlocks}.
   */
  readonly preserveCodeBlocks?: boolean;

  /**
   * One-call override of {@link CompressionConfig.technique}.
   */
  readonly technique?: CompressionTechnique;

  /**
   * Number of keywords to keep when the effective technique is `'keywords'`
   * (clamped to `[1, 50]`, default `10`). Ignored for other techniques.
   */
  readonly topN?: number;
}

/**
 * Aggregate counters describing the compression subsystem.
 *
 * Behaviour counters (`compressions`, `truncations`, `pruned`) increase
 * monotonically; state-derived values (`results`, `totalOriginal`,
 * `averageRatio`, `byTechnique`) are computed on demand from the cached
 * results, so `results` reflects the *current* store size.
 */
export interface CompressionStats {
  /**
   * Number of results currently cached.
   */
  readonly results: number;

  /**
   * Number of results *ever* written to the cache (monotonic).
   */
  readonly compressions: number;

  /**
   * Number of cached results whose `truncated` flag is set — i.e. how many
   * compressions had to hard-cut their text to fit the cap.
   */
  readonly truncations: number;

  /**
   * Sum of `originalLength` across cached results.
   */
  readonly totalOriginal: number;

  /**
   * Sum of `compressedLength` across cached results.
   */
  readonly totalCompressed: number;

  /**
   * `totalOriginal - totalCompressed`; how many characters were saved overall.
   */
  readonly totalSaved: number;

  /**
   * Mean {@link CompressionResult.ratio} across cached results (`0` when the
   * cache is empty).
   */
  readonly averageRatio: number;

  /**
   * Count of cached results per {@link CompressionTechnique}.
   */
  readonly byTechnique: Readonly<Record<CompressionTechnique, number>>;

  /**
   * Number of results removed by lifecycle pruning since construction.
   */
  readonly pruned: number;

  /**
   * Epoch-millisecond time the subsystem was created.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  readonly updatedAt: Timestamp;
}

/**
 * A serialisable snapshot of a {@link CompressionStore}.
 *
 * Returned by `CompressionStore.toJSON` and accepted by
 * `CompressionStore.fromJSON`, so a live result cache can be persisted and
 * restored verbatim. The payload carries no functions, classes or timers; each
 * entry pairs a cache key with the {@link CompressionResult} it maps to.
 */
export interface CompressionState {
  /**
   * The cached `[key, result]` pairs, in insertion order.
   */
  readonly entries: readonly Readonly<{ key: string; result: CompressionResult }>[];

  /**
   * Maximum entries the store retains before evicting the oldest (`0` =
   * unbounded).
   */
  readonly maxEntries: number;

  /**
   * Epoch-millisecond time the store was created.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  readonly updatedAt: Timestamp;
}

/**
 * The seven recognised compression techniques, in a stable order useful for
 * iteration, reporting and the {@link CompressionIndex}'s per-technique counts.
 */
export const TECHNIQUES: readonly CompressionTechnique[] = [
  'none',
  'truncate',
  'collapse',
  'dedupe',
  'strip-markdown',
  'keywords',
  'tiered',
];

/**
 * The five {@link RatioBucket} bands, in ascending order of aggressiveness.
 */
export const RATIO_BUCKETS: readonly RatioBucket[] = [
  'none',
  'low',
  'medium',
  'high',
  'extreme',
];

/**
 * Default number of characters per token used by {@link estimateTokens}.
 *
 * The well-known `len / 4` heuristic (GPT-family encoders approximate ~4
 * characters per token for typical English text) keeps the estimate cheap and
 * dependency-free.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Default maximum output length (characters) applied by the subsystem when a
 * caller does not specify one. 32k characters ≈ 8k tokens, comfortably inside
 * a standard 128k context window for a single section.
 */
export const DEFAULT_MAX_LENGTH = 32_000;

/**
 * Default technique applied when neither config nor options name one.
 */
export const DEFAULT_TECHNIQUE: CompressionTechnique = 'tiered';

/**
 * Boundaries between the {@link RatioBucket} bands.
 *
 * `ratio < edges[0]` → `'low'`, `< edges[1]` → `'medium'`,
 * `< edges[2]` → `'high'`, at or above → `'extreme'`. Tune these to make the
 * index's notion of "aggressive" stricter or looser.
 */
export const DEFAULT_RATIO_EDGES: readonly number[] = [0.3, 0.6, 0.85];

/**
 * Default maximum number of results a {@link CompressionStore} retains before
 * evicting the oldest entries.
 */
export const DEFAULT_MAX_ENTRIES = 256;

/**
 * Default number of keywords kept when the `'keywords'` technique is used and
 * no `topN` override is supplied.
 */
export const DEFAULT_KEYWORD_COUNT = 10;

/**
 * Lower bound for {@link CompressOptions.topN}; values below this clamp up.
 */
export const MIN_KEYWORDS = 1;

/**
 * Upper bound for {@link CompressOptions.topN}; values above this clamp down.
 */
export const MAX_KEYWORDS = 50;

/**
 * Clamp an arbitrary value into a valid character length: a non-negative
 * finite integer. Non-finite or negative inputs collapse to `0`, and fractional
 * values are floored.
 *
 * @param length - the raw length
 * @returns a safe, non-negative integer length
 */
export function clampLength(length: number): number {
  if (!Number.isFinite(length)) {
    return 0;
  }
  return Math.max(0, Math.floor(length));
}

/**
 * Clamp a keyword count into the legal `[MIN_KEYWORDS, MAX_KEYWORDS]` range.
 *
 * @param n - the raw keyword count
 * @returns a clamped integer in `[1, 50]` (defaulting to
 *   {@link DEFAULT_KEYWORD_COUNT} when the input is non-finite)
 */
export function clampKeywordCount(n: number): number {
  if (!Number.isFinite(n)) {
    return DEFAULT_KEYWORD_COUNT;
  }
  return Math.min(MAX_KEYWORDS, Math.max(MIN_KEYWORDS, Math.floor(n)));
}

/**
 * Heuristic token estimate for a piece of text.
 *
 * Uses the classic `Math.ceil(len / 4)` approximation — roughly four characters
 * per token for typical English prose. This is deliberately a *cheap estimate*
 * for budgeting decisions, not a tokenizer; callers that need exact counts
 * should substitute a real encoder via their own tooling.
 *
 * @param text - the text to estimate
 * @returns the estimated token count (`0` for empty input)
 */
export function estimateTokens(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Compute the compression ratio for a pair of lengths.
 *
 * `1 - compressed / original`, clamped into `[0, 1]`. An empty original yields
 * `0` (there is nothing to save); an output longer than the input is treated
 * as `0` (no savings) rather than a negative number, keeping downstream
 * aggregations sane.
 *
 * @param originalLength - length of the input text
 * @param compressedLength - length of the compressed text
 * @returns the saved fraction in `[0, 1]`
 */
export function computeRatio(
  originalLength: number,
  compressedLength: number,
): number {
  const original = clampLength(originalLength);
  const compressed = clampLength(compressedLength);
  if (original <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - compressed / original));
}

/**
 * Narrow a value to {@link CompressionTechnique}.
 *
 * @param value - the value to test
 * @returns `true` when the value is one of the seven recognised techniques
 */
export function isCompressionTechnique(value: unknown): value is CompressionTechnique {
  return typeof value === 'string' && (TECHNIQUES as readonly string[]).includes(value);
}

/**
 * Narrow a value to {@link RatioBucket}.
 *
 * @param value - the value to test
 * @returns `true` when the value is one of the five recognised buckets
 */
export function isRatioBucket(value: unknown): value is RatioBucket {
  return typeof value === 'string' && (RATIO_BUCKETS as readonly string[]).includes(value);
}

/**
 * Narrow a value to {@link CompressionResult} by structural inspection.
 *
 * Checks the five required fields: a string `text`, finite non-negative
 * `originalLength` / `compressedLength`, a finite `ratio` in `[0, 1]`, and a
 * recognised `technique`. Extra (optional) fields are ignored.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link CompressionResult}
 */
export function isCompressionResult(value: unknown): value is CompressionResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<CompressionResult>;
  return (
    typeof record.text === 'string' &&
    typeof record.originalLength === 'number' &&
    Number.isFinite(record.originalLength) &&
    record.originalLength >= 0 &&
    typeof record.compressedLength === 'number' &&
    Number.isFinite(record.compressedLength) &&
    record.compressedLength >= 0 &&
    typeof record.ratio === 'number' &&
    Number.isFinite(record.ratio) &&
    record.ratio >= 0 &&
    record.ratio <= 1 &&
    isCompressionTechnique(record.technique)
  );
}

/**
 * Derive a {@link RatioBucket} from a compression ratio.
 *
 * Buckets are bounded by the supplied edges (default
 * {@link DEFAULT_RATIO_EDGES}): `ratio <= 0` → `'none'`, then `'low'`,
 * `'medium'`, `'high'`, and finally `'extreme'` at or above the last edge.
 *
 * @param ratio - the compression ratio in `[0, 1]`
 * @param edges - optional custom bucket edges (3 ascending values)
 * @returns the derived {@link RatioBucket}
 */
export function ratioBucket(
  ratio: number,
  edges: readonly number[] = DEFAULT_RATIO_EDGES,
): RatioBucket {
  const value = clampLength(ratio * 1_000_000) / 1_000_000;
  if (value <= 0) {
    return 'none';
  }
  if (value < edges[0]) {
    return 'low';
  }
  if (value < edges[1]) {
    return 'medium';
  }
  if (value < edges[2]) {
    return 'high';
  }
  return 'extreme';
}

/**
 * Produce the canonical {@link CompressionConfig} defaults.
 *
 * Whitespace collapsing and block dedup (the lossless passes) default to `on`,
 * markdown stripping defaults to `off` (it is lossy), code blocks are
 * preserved, the cap defaults to {@link DEFAULT_MAX_LENGTH}, and the technique
 * defaults to `'tiered'`.
 *
 * @returns a complete configuration with every field populated by its default
 */
export function defaultCompressionConfig(): CompressionConfig {
  return {
    maxLength: DEFAULT_MAX_LENGTH,
    collapseWhitespace: true,
    dedupeBlocks: true,
    stripMarkdown: false,
    preserveCodeBlocks: true,
    technique: DEFAULT_TECHNIQUE,
  };
}

/**
 * Merge a partial {@link CompressionConfig} over the defaults.
 *
 * Only fields that are *explicitly defined* on the override replace the
 * default, so `{ maxLength: 1000 }` keeps every other default rather than
 * zeroing the boolean passes.
 *
 * @param config - the partial configuration, or `undefined`
 * @returns a complete, merged {@link CompressionConfig}
 */
export function mergeCompressionConfig(
  config: Partial<CompressionConfig> | undefined,
): CompressionConfig {
  const base = defaultCompressionConfig();
  if (!config) {
    return base;
  }
  return {
    maxLength: config.maxLength !== undefined ? config.maxLength : base.maxLength,
    collapseWhitespace:
      config.collapseWhitespace !== undefined
        ? config.collapseWhitespace
        : base.collapseWhitespace,
    dedupeBlocks:
      config.dedupeBlocks !== undefined ? config.dedupeBlocks : base.dedupeBlocks,
    stripMarkdown:
      config.stripMarkdown !== undefined ? config.stripMarkdown : base.stripMarkdown,
    preserveCodeBlocks:
      config.preserveCodeBlocks !== undefined
        ? config.preserveCodeBlocks
        : base.preserveCodeBlocks,
    technique: config.technique !== undefined ? config.technique : base.technique,
  };
}

/**
 * Resolve the effective options for a single operation by layering per-call
 * overrides over the defaults.
 *
 * Field-for-field identical to {@link mergeCompressionConfig} but accepts
 * {@link CompressOptions} (which may also carry `topN`). The `topN` field is
 * copied through untouched so callers can inspect what a `'keywords'`
 * compression would keep.
 *
 * @param options - the per-call overrides, or `undefined`
 * @returns a complete, merged {@link CompressionConfig}
 */
export function resolveCompressOptions(
  options: CompressOptions | undefined,
): CompressionConfig {
  const base = defaultCompressionConfig();
  if (!options) {
    return base;
  }
  return {
    maxLength: options.maxLength !== undefined ? options.maxLength : base.maxLength,
    collapseWhitespace:
      options.collapseWhitespace !== undefined
        ? options.collapseWhitespace
        : base.collapseWhitespace,
    dedupeBlocks:
      options.dedupeBlocks !== undefined ? options.dedupeBlocks : base.dedupeBlocks,
    stripMarkdown:
      options.stripMarkdown !== undefined ? options.stripMarkdown : base.stripMarkdown,
    preserveCodeBlocks:
      options.preserveCodeBlocks !== undefined
        ? options.preserveCodeBlocks
        : base.preserveCodeBlocks,
    technique: options.technique !== undefined ? options.technique : base.technique,
  };
}