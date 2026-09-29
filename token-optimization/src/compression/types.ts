/**
 * @fileoverview Core type definitions, constants, guards and factories for the
 * Compression layer of the standalone MAM Token Optimization engine.
 *
 * The Compression layer reduces the token footprint of prompt text *without*
 * calling an LLM. Every technique is a deterministic, dependency-free
 * transformation:
 *
 *   - **collapse-whitespace** — collapse runs of whitespace into a single
 *     space and trim sentence edges. Cheap, lossless for prose, and usually
 *     the single biggest win on messy machine-generated text.
 *   - **dedupe-blocks** — remove repeated paragraph / line blocks (headers,
 *     signatures, boilerplate) while keeping the *first* occurrence.
 *   - **trim-stopwords** — drop common filler words (`the`, `a`, `of`,
 *     `please`) at sentence edges where they carry no information.
 *   - **abbreviate** — replace a fixed set of common words / phrases with
 *     shorter equivalents (`because` → `b/c`, `please` → `pls`).
 *   - **truncate** — cut the text at a word boundary once a hard token budget
 *     (`CompressConfig.maxTokens`) is exceeded, appending an ellipsis.
 *
 * Each technique reports its own token savings, and a {@link CompressionResult}
 * aggregates them so callers can see *what* was removed and *how much* it saved.
 *
 * This module contains ONLY the shared vocabulary used by the other four
 * modules in this directory:
 *   - {@link ./store.js}     — content-addressed result cache (`CompressionStore`)
 *   - {@link ./index.js}     — queryable index over results (`CompressionIndex`)
 *   - {@link ./retrieval.js} — the deterministic engine (`TokenCompressor`)
 *   - {@link ./lifecycle.js} — cache GC + event orchestration (`CompressionLifecycle`)
 *
 * Everything here is pure: no I/O, no state, no side effects. The one exception
 * is {@link TokenCounter}, which is an *injected* function so callers can plug
 * in a real tokenizer; it never lives in this module.
 *
 * @module compression/types
 */

/**
 * The identifier of a single deterministic compression technique.
 *
 * Techniques are applied in the order declared by {@link TECHNIQUES} so the
 * output of one technique is the input of the next and the result is fully
 * deterministic across runs and processes.
 */
export type CompressionTechnique =
  | 'collapse-whitespace'
  | 'dedupe-blocks'
  | 'trim-stopwords'
  | 'abbreviate'
  | 'truncate';

/**
 * Every technique, as a frozen tuple, in application order. Used by the
 * compressor to sequence techniques and by {@link ./index.js} `CompressionIndex`
 * and {@link ./lifecycle.js} `CompressionLifecycle` to iterate the technique
 * space uniformly.
 */
export const TECHNIQUES: readonly CompressionTechnique[] = Object.freeze([
  'collapse-whitespace',
  'dedupe-blocks',
  'trim-stopwords',
  'abbreviate',
  'truncate',
]);

/**
 * Result of running a *single* technique over a piece of text.
 *
 * The compressor produces one of these per enabled technique so that callers
 * can attribute token savings to individual transformations. When a technique
 * does not change the text (`applied === false`), `charsAfter` equals
 * `charsBefore` and `savedTokens` is 0.
 */
export interface TechniqueResult {
  /** Which technique produced this result. */
  readonly technique: CompressionTechnique;
  /** `true` when the technique actually changed the text. */
  readonly applied: boolean;
  /** Character count of the input to the technique. */
  readonly charsBefore: number;
  /** Character count of the output of the technique. */
  readonly charsAfter: number;
  /**
   * Token-equivalent savings for this technique: `tokens(before) -
   * tokens(after)`. Computed with the same {@link TokenCounter} the caller
   * injected (or the built-in heuristic default), so it is always non-negative.
   */
  readonly savedTokens: number;
  /**
   * Short human-readable explanation of what happened (e.g. `"removed 12
   * repeated blocks"`). Absent when the technique did not apply.
   */
  readonly note?: string;
}

/**
 * The aggregate output of {@link ./retrieval.js} `TokenCompressor#compress`.
 *
 * A result is self-describing: it carries the *original* text (when the caller
 * opts in), the compressed text, the token counts on both sides, the aggregate
 * savings, and the ordered list of techniques that were actually applied.
 */
export interface CompressionResult {
  /** The compressed text. Safe to use directly in a downstream prompt. */
  readonly text: string;
  /**
   * Estimated token count of the *original* input, measured with the resolved
   * {@link TokenCounter}. Absent when the caller passed an explicit count via
   * {@link CompressOptions.originalTokens}.
   */
  readonly originalTokens?: number;
  /** Estimated token count of {@link text} after compression. */
  readonly compressedTokens?: number;
  /**
   * `originalTokens - compressedTokens`, clamped to >= 0. The headline number
   * most callers care about.
   */
  readonly savedTokens: number;
  /**
   * Savings as a percentage of the original: `savedTokens / originalTokens *
   * 100`, clamped to [0, 100]. 0 when the original had no tokens.
   */
  readonly savedPercent: number;
  /**
   * Ordered list of technique names that were enabled *and* actually changed
   * the text. Empty when no technique applied.
   */
  readonly techniques: readonly string[];
  /**
   * The untouched input text. Present only when
   * {@link CompressOptions.includeOriginalText} is `true`. Useful for
   * debugging and for `CompressionStore` content-addressing.
   */
  readonly originalText?: string;
  /**
   * Per-technique breakdown, present when {@link CompressOptions.saveTechniqueResults}
   * is `true`. One entry per *enabled* technique (applied or not).
   */
  readonly techniqueResults?: readonly TechniqueResult[];
  /** Monotonic timestamp (ms) when compression ran. */
  readonly timestamp: number;
}

/**
 * Persistent configuration controlling which techniques {@link ./retrieval.js}
 * `TokenCompressor` applies and how.
 *
 * Every field is optional; `normalizeCompressConfig` fills the gaps from
 * {@link DEFAULT_COMPRESS_CONFIG}. Configuration objects are deliberately
 * immutable-friendly so they can be safely shared across many compress calls.
 */
export interface CompressConfig {
  /**
   * Hard token ceiling for the *output*. When set, the `truncate` technique
   * is applied (even if `truncate` is `false`) once the accumulated text still
   * exceeds this budget. Absent = no truncation.
   */
  readonly maxTokens?: number;
  /**
   * Enable `collapse-whitespace`. Defaults to `true`. Set `false` to preserve
   * intentional whitespace (e.g. indentation-sensitive text) verbatim.
   */
  readonly collapseWhitespace?: boolean;
  /**
   * Enable `dedupe-blocks` (repeated paragraph / line removal). Defaults to
   * `true`. Blocks shorter than {@link minBlockLength} are never deduplicated.
   */
  readonly dedupeBlocks?: boolean;
  /**
   * Enable `trim-stopwords` (filler-word removal at sentence edges). Defaults
   * to `false` because it is the only technique that can subtly change
   * meaning; enable deliberately.
   */
  readonly trimStopwords?: boolean;
  /**
   * Enable `abbreviate` (common-phrase shortening). Defaults to `false`;
   * abbreviations trade a little formality for tokens.
   */
  readonly abbreviate?: boolean;
  /**
   * Enable `truncate` when `maxTokens` is set. Defaults to `true`; when the
   * input already fits the budget no truncation happens regardless.
   */
  readonly truncate?: boolean;
  /**
   * When `true`, fenced code blocks (```` ``` ````) are treated as opaque:
   * whitespace inside them is preserved and block-dedup / stopword trimming
   * never spans a fence. Defaults to `true`.
   */
  readonly preserveCode?: boolean;
  /**
   * Minimum block length (in characters) a paragraph / line must have before
   * it is eligible for `dedupe-blocks`. Prevents trivially-short repeated
   * lines (blank lines, `---`, list bullets) from being collapsed. Defaults
   * to {@link DEFAULT_MIN_BLOCK_LENGTH}.
   */
  readonly minBlockLength?: number;
}

/**
 * Per-call options accepted by {@link ./retrieval.js} `TokenCompressor#compress`.
 * These augment (but never replace) the instance-level {@link CompressConfig}.
 */
export interface CompressOptions {
  /**
   * A {@link TokenCounter} override for this call only. When absent the
   * compressor falls back to the instance-level counter, then to the built-in
   * heuristic default.
   */
  readonly counter?: TokenCounter;
  /**
   * Ground-truth token count of the *input*, known by the caller (e.g. from a
   * real tokenizer). When present it is recorded as `originalTokens` and used
   * as the baseline for savings; it never affects the deterministic text
   * transformations themselves.
   */
  readonly originalTokens?: number;
  /**
   * When `true`, {@link CompressionResult.originalText} is included so results
   * are self-describing and cacheable. Defaults to `false` to save memory.
   */
  readonly includeOriginalText?: boolean;
  /**
   * When `true`, the per-technique breakdown
   * ({@link CompressionResult.techniqueResults}) is populated. Defaults to
   * `false`; enabling it costs a little time and memory.
   */
  readonly saveTechniqueResults?: boolean;
  /**
   * When `false`, {@link ./store.js} `CompressionStore` is bypassed for this
   * call (no lookup, no write-back). Defaults to `true` when a store is
   * configured.
   */
  readonly useCache?: boolean;
  /** Optional label describing the source of the text (e.g. `'prompt'`). */
  readonly source?: string;
}

/**
 * Aggregated counters describing the health of a {@link ./store.js}
 * `CompressionStore`, returned by `CompressionStore#stats()`.
 */
export interface CompressionStats {
  /** Number of results currently resident in the cache. */
  readonly entries: number;
  /** Total `put` / `putMany` operations performed over the store's lifetime. */
  readonly puts: number;
  /** Total successful cache lookups (hits). */
  readonly hits: number;
  /** Total cache lookups that missed. */
  readonly misses: number;
  /** Total LRU evictions performed. */
  readonly evictions: number;
  /** Total cache clears. */
  readonly clears: number;
  /** Hit rate in [0, 1] (0 when no lookups have occurred). */
  readonly hitRate: number;
  /**
   * Best-effort resident memory footprint of cached texts + counts in bytes.
   * Approximate: does not account for JS object overhead.
   */
  readonly approxBytes: number;
  /** Cumulative `savedTokens` across every result currently resident. */
  readonly savedTokensTotal: number;
  /** Mean `savedPercent` across resident results (0 when empty). */
  readonly avgSavedPercent: number;
}

/**
 * A token-counting function, injectable so the Compression layer can use a
 * real tokenizer when one is available while remaining dependency-free by
 * default.
 *
 * Must be deterministic and must return a non-negative finite number for any
 * string input.
 *
 * @example
 * ```ts
 * const counter: TokenCounter = (text) => Math.max(1, Math.round(text.length / 4));
 * ```
 */
export type TokenCounter = (text: string) => number;

/**
 * Default minimum block length (characters) for `dedupe-blocks`. Lines or
 * paragraphs shorter than this are never treated as duplicates, which keeps
 * list bullets, separators and single-word asides intact.
 */
export const DEFAULT_MIN_BLOCK_LENGTH = 12;

/**
 * Default hard token ceiling used by {@link DEFAULT_COMPRESS_CONFIG}. Only
 * meaningful when the caller actually sets `maxTokens`; this value is a sane
 * stand-in for "roughly a modern default context budget".
 */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Fallback characters-per-token ratio used when no {@link TokenCounter} is
 * supplied and text must be scored heuristically. Mirrors the Estimation
 * layer's generic BPE default (≈4 chars per token for English prose).
 */
export const DEFAULT_CHARS_PER_TOKEN = 4.0;

/**
 * Fallback words-per-token ratio used by the built-in heuristic counter when
 * no real counter is injected. English prose averages ~1.33 tokens per word.
 */
export const DEFAULT_WORDS_PER_TOKEN = 0.75;

/**
 * Width (in saved-tokens) of each savings bucket used by
 * {@link ./index.js} `CompressionIndex`. Bucket 0 covers [0, 20) saved
 * tokens, bucket 1 [20, 40), etc.
 */
export const SAVINGS_BUCKET_SIZE = 20;

/**
 * Default compression configuration. Conservative by design: whitespace
 * collapse and block dedup are always-on (lossless for prose), while the two
 * meaning-altering techniques (`trim-stopwords`, `abbreviate`) are off until
 * the caller opts in. `truncate` is enabled but inert without `maxTokens`.
 */
export const DEFAULT_COMPRESS_CONFIG: Readonly<CompressConfig> = Object.freeze({
  collapseWhitespace: true,
  dedupeBlocks: true,
  trimStopwords: false,
  abbreviate: false,
  truncate: true,
  preserveCode: true,
  minBlockLength: DEFAULT_MIN_BLOCK_LENGTH,
});

/**
 * Narrow `unknown` to {@link CompressionTechnique}. Type guard used by the
 * config normalizers and by callers deserializing untrusted JSON.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is one of the five supported techniques.
 */
export function isCompressionTechnique(value: unknown): value is CompressionTechnique {
  return (
    typeof value === 'string' &&
    (TECHNIQUES as readonly string[]).includes(value)
  );
}

/**
 * Structural guard for {@link TechniqueResult}. Validates the required fields
 * and sanity-checks that the character counts are non-negative numbers.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is a structurally valid technique result.
 */
export function isTechniqueResult(value: unknown): value is TechniqueResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isCompressionTechnique(candidate.technique)) return false;
  if (typeof candidate.applied !== 'boolean') return false;
  if (
    typeof candidate.charsBefore !== 'number' ||
    typeof candidate.charsAfter !== 'number' ||
    candidate.charsBefore < 0 ||
    candidate.charsAfter < 0
  ) {
    return false;
  }
  if (typeof candidate.savedTokens !== 'number' || candidate.savedTokens < 0) return false;
  return true;
}

/**
 * Structural guard for {@link CompressionResult}. Validates the required
 * fields and cross-checks the token arithmetic where possible.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is a structurally valid compression result.
 */
export function isCompressionResult(value: unknown): value is CompressionResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.text !== 'string') return false;
  if (typeof candidate.savedTokens !== 'number' || candidate.savedTokens < 0) return false;
  if (typeof candidate.savedPercent !== 'number' || Number.isNaN(candidate.savedPercent)) return false;
  if (candidate.originalTokens !== undefined) {
    if (typeof candidate.originalTokens !== 'number' || candidate.originalTokens < 0) return false;
  }
  if (candidate.compressedTokens !== undefined) {
    if (typeof candidate.compressedTokens !== 'number' || candidate.compressedTokens < 0) return false;
  }
  if (candidate.techniques !== undefined && !Array.isArray(candidate.techniques)) return false;
  if (candidate.techniqueResults !== undefined) {
    if (!Array.isArray(candidate.techniqueResults)) return false;
    for (const item of candidate.techniqueResults) {
      if (!isTechniqueResult(item)) return false;
    }
  }
  return true;
}

/**
 * Structural guard for {@link CompressConfig}. Lenient: any object whose
 * boolean fields are booleans (when present) and whose numeric fields are
 * non-negative numbers (when present) is accepted.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` looks like a usable configuration bag.
 */
export function isCompressConfig(value: unknown): value is CompressConfig {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of ['collapseWhitespace', 'dedupeBlocks', 'trimStopwords', 'abbreviate', 'truncate', 'preserveCode'] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'boolean') return false;
  }
  for (const key of ['maxTokens', 'minBlockLength'] as const) {
    if (candidate[key] !== undefined && (typeof candidate[key] !== 'number' || candidate[key] < 0)) {
      return false;
    }
  }
  return true;
}

/**
 * Structural guard for {@link CompressOptions}. Lenient: accepts any object
 * unless a present field has an obviously wrong type.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` looks like a usable options bag.
 */
export function isCompressOptions(value: unknown): value is CompressOptions {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.counter !== undefined && typeof candidate.counter !== 'function') return false;
  if (candidate.originalTokens !== undefined && typeof candidate.originalTokens !== 'number') return false;
  for (const key of ['includeOriginalText', 'saveTechniqueResults', 'useCache'] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== 'boolean') return false;
  }
  if (candidate.source !== undefined && typeof candidate.source !== 'string') return false;
  return true;
}

/**
 * Guard for {@link TokenCounter}: accepts any function.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is a function (i.e. callable as a counter).
 */
export function isTokenCounter(value: unknown): value is TokenCounter {
  return typeof value === 'function';
}

/**
 * Factory: build an immutable {@link TechniqueResult}. Centralizes the
 * invariant enforcement (non-negative character counts and savings, known
 * technique id) so retrieval never hand-builds result objects.
 *
 * @param technique - The technique that produced the result.
 * @param charsBefore - Character count of the technique's input.
 * @param charsAfter - Character count of the technique's output.
 * @param savedTokens - Token-equivalent savings (non-negative).
 * @param note - Optional human-readable explanation.
 * @returns A frozen {@link TechniqueResult}.
 */
export function createTechniqueResult(
  technique: CompressionTechnique,
  charsBefore: number,
  charsAfter: number,
  savedTokens: number,
  note?: string,
): TechniqueResult {
  if (!isCompressionTechnique(technique)) {
    throw new TypeError(`createTechniqueResult: unknown technique \`${String(technique)}\``);
  }
  if (!Number.isFinite(charsBefore) || charsBefore < 0) {
    throw new RangeError('createTechniqueResult: charsBefore must be a non-negative number');
  }
  if (!Number.isFinite(charsAfter) || charsAfter < 0) {
    throw new RangeError('createTechniqueResult: charsAfter must be a non-negative number');
  }
  const safeSaved = Number.isFinite(savedTokens) && savedTokens >= 0 ? savedTokens : 0;
  const applied = charsBefore !== charsAfter;
  const result: TechniqueResult = {
    technique,
    applied,
    charsBefore,
    charsAfter,
    savedTokens: safeSaved,
  };
  if (note !== undefined && note.length > 0) (result as { note?: string }).note = note;
  return Object.freeze(result);
}

/**
 * Factory: build an immutable {@link CompressionResult} from measured inputs.
 * All token arithmetic (`savedTokens`, `savedPercent`) is computed here so the
 * caller cannot produce inconsistent results.
 *
 * @param text - The compressed text.
 * @param originalTokens - Estimated token count of the input.
 * @param compressedTokens - Estimated token count of `text`.
 * @param techniques - Ordered list of applied technique names.
 * @param extras - Optional `originalText`, `techniqueResults`, `timestamp`.
 * @returns A frozen {@link CompressionResult}.
 */
export function createCompressionResult(
  text: string,
  originalTokens: number,
  compressedTokens: number,
  techniques: readonly string[],
  extras: Readonly<{
    originalText?: string;
    techniqueResults?: readonly TechniqueResult[];
    timestamp?: number;
  }> = {},
): CompressionResult {
  if (typeof text !== 'string') throw new TypeError('createCompressionResult: `text` must be a string');
  if (!Number.isFinite(originalTokens) || originalTokens < 0) {
    throw new RangeError('createCompressionResult: originalTokens must be a non-negative number');
  }
  if (!Number.isFinite(compressedTokens) || compressedTokens < 0) {
    throw new RangeError('createCompressionResult: compressedTokens must be a non-negative number');
  }
  const savedTokens = Math.max(0, Math.round(originalTokens - compressedTokens));
  const savedPercent =
    originalTokens <= 0 ? 0 : Math.min(100, (savedTokens / originalTokens) * 100);
  const result: CompressionResult = {
    text,
    savedTokens,
    savedPercent,
    techniques: Object.freeze([...techniques]),
    timestamp: extras.timestamp ?? Date.now(),
  };
  if (extras.originalText !== undefined) (result as { originalText?: string }).originalText = extras.originalText;
  if (extras.techniqueResults !== undefined) {
    (result as { techniqueResults?: readonly TechniqueResult[] }).techniqueResults = Object.freeze(
      extras.techniqueResults.map((item) => Object.freeze({ ...item })),
    );
  }
  (result as { originalTokens?: number }).originalTokens = Math.round(originalTokens);
  (result as { compressedTokens?: number }).compressedTokens = Math.round(compressedTokens);
  return Object.freeze(result);
}

/**
 * Normalize an arbitrary config bag into a fully-populated {@link CompressConfig},
 * filling every optional field from {@link DEFAULT_COMPRESS_CONFIG}. Invalid
 * inputs are coerced rather than thrown so callers can pass partially-built
 * config objects from JSON safely.
 *
 * @param config - Optional partial configuration. `null` / `undefined` yields
 *   the full defaults.
 * @returns A frozen, complete {@link CompressConfig}.
 */
export function normalizeCompressConfig(
  config?: Readonly<Partial<CompressConfig>> | null,
): CompressConfig {
  const base = DEFAULT_COMPRESS_CONFIG;
  const rawMax = config?.maxTokens;
  const rawBlock = config?.minBlockLength;
  const normalized: Partial<Record<keyof CompressConfig, unknown>> = {
    collapseWhitespace: config?.collapseWhitespace ?? base.collapseWhitespace,
    dedupeBlocks: config?.dedupeBlocks ?? base.dedupeBlocks,
    trimStopwords: config?.trimStopwords ?? base.trimStopwords,
    abbreviate: config?.abbreviate ?? base.abbreviate,
    truncate: config?.truncate ?? base.truncate,
    preserveCode: config?.preserveCode ?? base.preserveCode,
    minBlockLength:
      rawBlock !== undefined && Number.isFinite(rawBlock) && rawBlock >= 1
        ? Math.floor(rawBlock)
        : base.minBlockLength,
  };
  if (rawMax !== undefined && Number.isFinite(rawMax) && rawMax >= 1) {
    normalized.maxTokens = Math.floor(rawMax);
  }
  return Object.freeze(normalized as CompressConfig);
}

/**
 * Deterministically derive the savings-bucket index for a token-savings count
 * using {@link SAVINGS_BUCKET_SIZE}. Buckets are `[0,20)`, `[20,40)`, …
 *
 * @param savedTokens - A non-negative saved-token count.
 * @returns The zero-based bucket index.
 */
export function savingsBucketFor(savedTokens: number): number {
  const safe = Number.isFinite(savedTokens) && savedTokens >= 0 ? savedTokens : 0;
  return Math.floor(safe / SAVINGS_BUCKET_SIZE);
}

/**
 * Built-in heuristic {@link TokenCounter}, used when the caller injects
 * neither a per-call counter nor an instance-level counter. It mixes a
 * characters-per-token estimate with a words-per-token estimate and takes the
 * larger (more pessimistic) value, mirroring the Estimation layer's default
 * behavior for English prose.
 *
 * The result is always at least 1 token for non-empty text.
 *
 * @param text - Text to score.
 * @returns A non-negative integer token estimate.
 */
export function defaultTokenCounter(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const chars = text.length;
  const byChars = Math.ceil(chars / DEFAULT_CHARS_PER_TOKEN);
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0).length;
  const byWords = Math.ceil(words / DEFAULT_WORDS_PER_TOKEN);
  return Math.max(1, Math.max(byChars, byWords));
}