/**
 * @fileoverview Core type definitions, constants, guards and factories for the
 * Estimation layer of the standalone MAM Token Optimization engine.
 *
 * The Estimation layer is responsible for counting / estimating the number of
 * tokens a piece of text will consume inside a given model family's tokenizer.
 * Real tokenizers are model-specific and expensive, so this layer relies on
 * cheap heuristics (chars-per-token ratios, word / space heuristics and
 * optional length-based calibration) to produce a `TokenEstimate` that is
 * "good enough" for budgeting, truncation and prompt-packing decisions.
 *
 * This module contains ONLY the shared vocabulary used by the other four
 * modules in this directory:
 *   - {@link ./store.js}  - content-addressed estimate cache (`EstimateStore`)
 *   - {@link ./index.js}  - queryable index over estimates (`EstimateIndex`)
 *   - {@link ./retrieval.js} - heuristic engine (`TokenEstimator`)
 *   - {@link ./lifecycle.js} - cache GC + event orchestration (`EstimationLifecycle`)
 *
 * Everything here is pure: no I/O, no state, no side effects. All functions
 * are deterministic so they can be safely shared between the synchronous
 * retrieval path and any future asynchronous pipeline.
 *
 * @module estimation/types
 */

/**
 * The strategy that produced a given {@link TokenEstimate}.
 *
 * `chars-per-token` is the primary heuristic: we divide the character count of
 * the input by a model-family specific constant. `word-based` is a fallback
 * used when a profile has no character ratio configured (or the text is very
 * short). `exact` marks an estimate that came from a real tokenizer (injected
 * through calibration or a trusted upstream source). `calibrated` marks an
 * estimate computed from a model-specific ratio that was refined via
 * {@link CalibrationSample}s rather than the stock factory default.
 */
export type TokenEstimationMethod =
  | 'chars-per-token'
  | 'word-based'
  | 'exact'
  | 'calibrated';

/**
 * Every estimation method, as a frozen tuple, useful for iterating over all
 * supported strategies when building indexes or stats.
 */
export const ESTIMATION_METHODS: readonly TokenEstimationMethod[] = Object.freeze([
  'chars-per-token',
  'word-based',
  'exact',
  'calibrated',
]);

/**
 * Default characters-per-token ratio used when a model profile does not
 * declare its own and no calibration data is available. This is roughly the
 * industry average for English text across modern BPE tokenizers (≈3.5–4.5
 * chars per token). We pick a conservative middle value.
 */
export const DEFAULT_CHARS_PER_TOKEN = 4.0;

/**
 * Default number of words assumed per token. Used only by the word-based
 * fallback heuristic. English prose averages roughly 1.33 tokens per word,
 * which is equivalent to ~0.75 words per token.
 */
export const DEFAULT_WORDS_PER_TOKEN = 0.75;

/**
 * Inverse of {@link DEFAULT_WORDS_PER_TOKEN}; provided for callers that prefer
 * to think in tokens-per-word (≈1.33).
 */
export const DEFAULT_TOKENS_PER_WORD = 1 / DEFAULT_WORDS_PER_TOKEN;

/**
 * Bounds used to reject nonsensical profile ratios. A ratio below this floor
 * (more than ~8 characters per token) or above this ceiling (fewer than ~1.6
 * characters per token) almost certainly indicates bad calibration input, so
 * guards in this module will reject it.
 */
export const MIN_CHARS_PER_TOKEN = 1.6;
export const MAX_CHARS_PER_TOKEN = 8.0;

/**
 * Minimum number of characters a text must have before the chars-per-token
 * heuristic is trusted with full confidence. Very short inputs (a handful of
 * characters) are dominated by single-token effects (spaces, punctuation
 * merges), so their estimates are systematically less reliable.
 */
export const CONFIDENT_MIN_CHARS = 64;

/**
 * The width of each token-length bucket used by the {@link ./index.js}
 * `EstimateIndex`. Buckets are inclusive on their lower bound and exclusive on
 * their upper bound: bucket 0 covers [0, 500) tokens, bucket 1 covers
 * [500, 1000), etc.
 */
export const LENGTH_BUCKET_SIZE = 500;

/**
 * A single measurement of the *true* token count for a sample of text on a
 * given model family. Produced by {@link ./retrieval.js} `TokenEstimator#calibrate`.
 * Keeping a history of samples (rather than just a running average) lets the
 * retrieval layer detect drift and lets callers persist calibration state.
 */
export interface CalibrationSample {
  /** Canonical model identifier this sample applies to (e.g. `gpt-4`). */
  readonly model: string;
  /** The sample text that was tokenized. */
  readonly text: string;
  /** The ground-truth token count reported by the real tokenizer / upstream. */
  readonly actualTokens: number;
  /** The number of characters in {@link text} at calibration time. */
  readonly chars: number;
  /** Derived ratio: `chars / actualTokens`. */
  readonly ratio: number;
  /** Monotonic timestamp (ms since epoch) of when this sample was recorded. */
  readonly timestamp: number;
  /**
   * Optional label describing the sample domain (e.g. `'code'`, `'prose'`,
   * `'json'`). Useful if the caller later wants to bucket calibration by
   * content type. Absent when the caller did not supply one.
   */
  readonly label?: string;
}

/**
 * The result of counting or estimating tokens for a single piece of text.
 *
 * The `input` field carries the original text so estimates are self-describing
 * and can be persisted / cached without losing context. `tokens` is always a
 * non-negative integer (never fractional), and `confidence` is an optional
 * 0–1 value indicating how much the estimate should be trusted.
 */
export interface TokenEstimate {
  /** Estimated (or exact) number of tokens consumed by `input`. */
  readonly tokens: number;
  /** The text that was estimated. */
  readonly input: string;
  /**
   * Canonical model family the estimate is for. Optional because some callers
   * estimate without pinning a model (falling back to the default profile).
   */
  readonly model?: string;
  /** Which heuristic (or ground truth) produced this estimate. */
  readonly method: TokenEstimationMethod;
  /**
   * Approximate confidence in [0, 1]. Higher is better. `1` typically means
   * the estimate was `exact` (real tokenizer). Absent when the caller supplied
   * an estimate directly rather than via the estimator.
   */
  readonly confidence?: number;
  /**
   * Optional nonce for the estimator run that produced this estimate. Useful
   * when callers need to correlate batches produced by `estimateMany`.
   */
  readonly batchId?: string;
  /**
   * Optional marker so downstream tools can show *why* a specific ratio was
   * chosen (e.g. `'factory'` vs `'calibrated:gpt-4'`). Absent for direct
   * estimates.
   */
  readonly source?: string;
}

/**
 * A model-family profile describing how text maps to tokens for that family.
 *
 * At least one of `charsPerToken` or `wordsPerToken` should be present;
 * `charsPerToken` is preferred by the estimator when both are set.
 */
export interface ModelProfile {
  /** Canonical, stable identifier for this model family (e.g. `gpt-4`). */
  readonly id: string;
  /** Characters consumed per token for this family (the primary heuristic). */
  readonly charsPerToken?: number;
  /** Words consumed per token for this family (word-based fallback). */
  readonly wordsPerToken?: number;
  /** Tokens consumed per word (inverse of {@link wordsPerToken}). */
  readonly tokensPerWord?: number;
  /**
   * Human-readable vendor / family label used in logs and tooltips
   * (e.g. `'OpenAI GPT-4'`). Optional.
   */
  readonly label?: string;
  /** Base context-window size in tokens for this family, if known. */
  readonly contextWindow?: number;
}

/**
 * Length-based calibration: optional configuration that lets the retrieval
 * layer scale the base chars-per-token ratio for very short or very long
 * inputs. Ratios are interpolated linearly between the configured anchors.
 */
export interface LengthCalibrationConfig {
  /**
   * Ratio applied to inputs at or below `shortTextChars` characters. If
   * omitted, the profile's `charsPerToken` is used directly for short text.
   */
  readonly shortTextRatio?: number;
  /** Character length at (and below) which the short-text ratio applies. */
  readonly shortTextChars?: number;
  /**
   * Ratio applied to inputs at or above `longTextChars` characters. If
   * omitted, the profile's `charsPerToken` is used for long text.
   */
  readonly longTextRatio?: number;
  /** Character length at (and above) which the long-text ratio applies. */
  readonly longTextChars?: number;
  /**
   * When `true`, ratios are interpolated linearly between the short anchor and
   * the base ratio (and between base and long anchor). When `false`, the
   * nearest anchor is used as a step function. Defaults to `true`.
   */
  readonly interpolate?: boolean;
}

/**
 * Configuration object accepted by {@link ./retrieval.js} `TokenEstimator` and
 * {@link ./lifecycle.js} `EstimationLifecycle`. Every field is optional so a
 * fully-configured estimator can be built from a handful of overrides.
 */
export interface EstimationConfig {
  /**
   * Global default chars-per-token ratio, used only when a resolved model
   * profile has no `charsPerToken`. Defaults to {@link DEFAULT_CHARS_PER_TOKEN}.
   */
  readonly defaultCharsPerToken?: number;
  /**
   * Model family used when the caller does not specify one. Defaults to
   * `gpt-4` (a representative modern BPE tokenizer).
   */
  readonly defaultModel?: string;
  /**
   * When `true` (the default) the estimator consults {@link ./store.js}
   * `EstimateStore` and stores fresh estimates in it. Set `false` for
   * stateless / one-shot estimation where cache bookkeeping is unwanted.
   */
  readonly cacheEstimates?: boolean;
  /**
   * Length-based calibration overrides merged on top of per-model profiles.
   * Only used when the corresponding profile fields are absent.
   */
  readonly calibration?: LengthCalibrationConfig;
  /**
   * Maximum number of entries the estimate cache may hold before LRU eviction
   * kicks in. Defaults to `10_000`. Mirrored by `EstimateStore` when the store
   * is created through the estimator.
   */
  readonly maxCacheEntries?: number;
}

/**
 * Options accepted by the per-call estimation entry points
 * ({@link ./retrieval.js} `TokenEstimator#estimate` and `#estimateMany`).
 */
export interface EstimateOptions {
  /** Override the model family for this call (ignores `config.defaultModel`). */
  readonly model?: string;
  /**
   * Force a specific estimation method. When set, the heuristic corresponding
   * to `method` is used even if another would normally be preferred. `exact`
   * is only honored when the caller also supplies `exactTokens`; otherwise an
   * `Error` is thrown.
   */
  readonly method?: TokenEstimationMethod;
  /**
   * Ground-truth token count, supplied by the caller. When present together
   * with `method: 'exact'`, produces a `TokenEstimate` with `method: 'exact'`
   * and `confidence: 1`.
   */
  readonly exactTokens?: number;
  /**
   * Set `false` to bypass the estimate cache for this specific call, forcing a
   * fresh heuristic computation.
   */
  readonly useCache?: boolean;
  /**
   * Optional batch identifier stamped onto every estimate produced by an
   * `estimateMany` call so results can be correlated with the request.
   */
  readonly batchId?: string;
  /** Optional source label (e.g. `'prompt-builder'`) recorded on estimates. */
  readonly source?: string;
}

/**
 * Aggregated counters describing the health of an {@link ./store.js}
 * `EstimateStore`. Returned by `EstimateStore#stats()`.
 */
export interface EstimationStats {
  /** Number of entries currently resident in the cache. */
  readonly entries: number;
  /** Total `put` operations performed over the store's lifetime. */
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
   * Approximate resident memory footprint of cached inputs + tokens in bytes.
   * Best-effort; does not account for object overhead.
   */
  readonly approxBytes: number;
}

/**
 * Serialized snapshot shape produced by `EstimateStore#toJSON()` and consumed
 * by `EstimateStore#fromJSON()`. The version field allows future migrations.
 */
export interface StoreSnapshot {
  /** Schema version; currently always `1`. */
  readonly version: 1;
  /** The maximum entries the store was configured with at snapshot time. */
  readonly maxEntries: number;
  /** Flat list of all estimates resident in the cache. */
  readonly estimates: readonly TokenEstimate[];
  /** `true` when an LRU clock (per-entry access order) was captured. */
  readonly lru: boolean;
}

/**
 * Built-in factory defaults for common model families.
 *
 * The ratios below are engineering approximations for English-dominant text
 * (pessimistic by a few percent to stay on the safe side of a context window).
 * They are NOT guaranteed to match any specific released tokenizer and should
 * be replaced or refined via {@link ./retrieval.js} `TokenEstimator#calibrate`
 * when exact budgets matter.
 */
export const MODEL_PROFILES: Readonly<Record<string, Readonly<ModelProfile>>> =
  Object.freeze({
    gpt4: Object.freeze({
      id: 'gpt-4',
      charsPerToken: 4.0,
      wordsPerToken: 0.75,
      tokensPerWord: 4 / 3,
      label: 'OpenAI GPT-4',
      contextWindow: 8192,
    }),
    gpt35: Object.freeze({
      id: 'gpt-3.5',
      charsPerToken: 3.9,
      wordsPerToken: 0.77,
      tokensPerWord: 1.3,
      label: 'OpenAI GPT-3.5',
      contextWindow: 16384,
    }),
    claude3: Object.freeze({
      id: 'claude-3',
      charsPerToken: 3.7,
      wordsPerToken: 0.71,
      tokensPerWord: 1.41,
      label: 'Anthropic Claude 3',
      contextWindow: 200000,
    }),
    claude35: Object.freeze({
      id: 'claude-3.5',
      charsPerToken: 3.6,
      wordsPerToken: 0.7,
      tokensPerWord: 1.43,
      label: 'Anthropic Claude 3.5',
      contextWindow: 200000,
    }),
    llama3: Object.freeze({
      id: 'llama-3',
      charsPerToken: 4.1,
      wordsPerToken: 0.78,
      tokensPerWord: 1.28,
      label: 'Meta Llama 3',
      contextWindow: 8192,
    }),
    mistral: Object.freeze({
      id: 'mistral-7b',
      charsPerToken: 4.2,
      wordsPerToken: 0.8,
      tokensPerWord: 1.25,
      label: 'Mistral 7B',
      contextWindow: 32768,
    }),
    gemini: Object.freeze({
      id: 'gemini-pro',
      charsPerToken: 4.0,
      wordsPerToken: 0.76,
      tokensPerWord: 1.32,
      label: 'Google Gemini Pro',
      contextWindow: 32768,
    }),
    default: Object.freeze({
      id: 'default',
      charsPerToken: DEFAULT_CHARS_PER_TOKEN,
      wordsPerToken: DEFAULT_WORDS_PER_TOKEN,
      tokensPerWord: DEFAULT_TOKENS_PER_WORD,
      label: 'Generic BPE tokenizer',
    }),
  });

/**
 * Default model family used when neither the call options nor the config
 * specify one. Alias into {@link MODEL_PROFILES}.
 */
export const DEFAULT_MODEL_ID = 'gpt-4';

/**
 * Default estimation configuration. Overrides the "generic BPE" default ratio
 * with the `gpt-4` profile ratio and enables the estimate cache.
 */
export const DEFAULT_ESTIMATION_CONFIG: Readonly<EstimationConfig> = Object.freeze({
  defaultCharsPerToken: DEFAULT_CHARS_PER_TOKEN,
  defaultModel: DEFAULT_MODEL_ID,
  cacheEstimates: true,
  maxCacheEntries: 10_000,
});

/**
 * The {@link MODEL_PROFILES} map flattened into a sorted array of profiles.
 * Guaranteed to include the `default` profile last, so callers that iterate
 * over "real" models can slice it off. Useful when bootstrapping an
 * {@link ./index.js} `EstimateIndex` or persisting profiles.
 */
export const DEFAULT_MODEL_PROFILES: readonly ModelProfile[] = Object.freeze(
  Object.values(MODEL_PROFILES),
);

/**
 * Narrow `unknown` to {@link TokenEstimationMethod}. Type guard used by the
 * config normalizers and by callers deserializing untrusted JSON.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is one of the four supported methods.
 */
export function isEstimationMethod(value: unknown): value is TokenEstimationMethod {
  return (
    typeof value === 'string' &&
    (ESTIMATION_METHODS as readonly string[]).includes(value)
  );
}

/**
 * Shape guard for {@link ModelProfile}. Performs a structural check so
 * untrusted input (JSON, plugin config) can be validated before being merged
 * into the estimator's profile table.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is a structurally valid model profile.
 */
export function isModelProfile(value: unknown): value is ModelProfile {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return false;
  if (candidate.charsPerToken !== undefined && typeof candidate.charsPerToken !== 'number') return false;
  if (candidate.wordsPerToken !== undefined && typeof candidate.wordsPerToken !== 'number') return false;
  if (candidate.tokensPerWord !== undefined && typeof candidate.tokensPerWord !== 'number') return false;
  if (candidate.charsPerToken !== undefined) {
    const ratio = candidate.charsPerToken as number;
    if (Number.isNaN(ratio) || ratio < MIN_CHARS_PER_TOKEN || ratio > MAX_CHARS_PER_TOKEN) return false;
  }
  return true;
}

/**
 * Shape guard for {@link TokenEstimate}. Validates the required fields
 * (`tokens`, `input`, `method`) and sanity-checks the token count.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` is a structurally valid estimate.
 */
export function isTokenEstimate(value: unknown): value is TokenEstimate {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.input !== 'string') return false;
  if (typeof candidate.tokens !== 'number' || !Number.isInteger(candidate.tokens) || candidate.tokens < 0) {
    return false;
  }
  if (!isEstimationMethod(candidate.method)) return false;
  if (candidate.model !== undefined && typeof candidate.model !== 'string') return false;
  return true;
}

/**
 * Shape guard for {@link EstimateOptions}. Lenient: any object is accepted as
 * long as it does not carry clearly-invalid method / exact-token combinations.
 *
 * @param value - Arbitrary value to test.
 * @returns `true` when `value` looks like a usable options bag.
 */
export function isEstimateOptions(value: unknown): value is EstimateOptions {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.model !== undefined && typeof candidate.model !== 'string') return false;
  if (candidate.method !== undefined && !isEstimationMethod(candidate.method)) return false;
  if (candidate.exactTokens !== undefined && typeof candidate.exactTokens !== 'number') return false;
  return true;
}

/**
 * Factory: build an immutable {@link ModelProfile} from partial input, filling
 * missing fields from the provided `base` profile (or sane defaults).
 *
 * @param id - Canonical model identifier.
 * @param partial - Optional overrides.
 * @param base - Optional profile to inherit defaults from. When omitted the
 *   generic `default` profile is used as the base.
 * @returns A frozen, complete profile.
 */
export function createModelProfile(
  id: string,
  partial: Readonly<Partial<ModelProfile>> = {},
  base: Readonly<ModelProfile> = MODEL_PROFILES.default,
): ModelProfile {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('createModelProfile: `id` must be a non-empty string');
  }
  return Object.freeze({
    id,
    charsPerToken: partial.charsPerToken ?? base.charsPerToken,
    wordsPerToken: partial.wordsPerToken ?? base.wordsPerToken,
    tokensPerWord: partial.tokensPerWord ?? base.tokensPerWord,
    label: partial.label ?? base.label,
    contextWindow: partial.contextWindow ?? base.contextWindow,
  });
}

/**
 * Factory: construct a {@link TokenEstimate}. This is the single sanctioned
 * way to build estimates so that required fields are always present and
 * invariants (non-negative integer tokens, known method) are enforced.
 *
 * @param input - The text the estimate refers to.
 * @param tokens - Estimated token count (will be rounded to a non-negative int).
 * @param method - The method that produced the estimate.
 * @param extras - Optional `model`, `confidence`, `batchId` and `source`.
 * @returns A frozen {@link TokenEstimate}.
 */
export function createTokenEstimate(
  input: string,
  tokens: number,
  method: TokenEstimationMethod,
  extras: Readonly<{
    model?: string;
    confidence?: number;
    batchId?: string;
    source?: string;
  }> = {},
): TokenEstimate {
  if (typeof input !== 'string') throw new TypeError('createTokenEstimate: `input` must be a string');
  if (!Number.isFinite(tokens) || tokens < 0) {
    throw new RangeError('createTokenEstimate: `tokens` must be a non-negative finite number');
  }
  if (!isEstimationMethod(method)) {
    throw new TypeError(`createTokenEstimate: unknown method \`${String(method)}\``);
  }
  const rounded = Math.max(0, Math.round(tokens));
  const estimate: TokenEstimate = { tokens: rounded, input, method };
  if (extras.model !== undefined) (estimate as { model?: string }).model = extras.model;
  if (extras.confidence !== undefined) {
    const confidence = Math.min(1, Math.max(0, extras.confidence));
    (estimate as { confidence?: number }).confidence = confidence;
  }
  if (extras.batchId !== undefined) (estimate as { batchId?: string }).batchId = extras.batchId;
  if (extras.source !== undefined) (estimate as { source?: string }).source = extras.source;
  return Object.freeze(estimate);
}

/**
 * Factory: build a {@link CalibrationSample} from raw measurement data,
 * computing the `chars` and `ratio` fields so callers never compute them by
 * hand.
 *
 * @param model - Canonical model identifier.
 * @param text - The sample text that was tokenized.
 * @param actualTokens - Ground-truth token count from the real tokenizer.
 * @param label - Optional content-type label (e.g. `'code'`).
 * @returns A frozen {@link CalibrationSample}.
 */
export function createCalibrationSample(
  model: string,
  text: string,
  actualTokens: number,
  label?: string,
): CalibrationSample {
  if (typeof model !== 'string' || model.length === 0) throw new TypeError('createCalibrationSample: model required');
  if (typeof text !== 'string') throw new TypeError('createCalibrationSample: text must be a string');
  if (!Number.isInteger(actualTokens) || actualTokens < 0) {
    throw new RangeError('createCalibrationSample: actualTokens must be a non-negative integer');
  }
  const chars = text.length;
  const ratio = actualTokens === 0 ? DEFAULT_CHARS_PER_TOKEN : chars / actualTokens;
  const sample: CalibrationSample = {
    model,
    text,
    actualTokens,
    chars,
    ratio,
    timestamp: Date.now(),
  };
  if (label !== undefined && label.length > 0) (sample as { label?: string }).label = label;
  return Object.freeze(sample);
}

/**
 * Normalize an arbitrary config bag into a fully-populated {@link EstimationConfig},
 * filling every optional field from {@link DEFAULT_ESTIMATION_CONFIG}.
 *
 * @param config - Optional partial configuration. `null` / `undefined` yields
 *   the full defaults.
 * @returns A frozen, complete {@link EstimationConfig}.
 */
export function normalizeEstimationConfig(
  config?: Readonly<Partial<EstimationConfig>> | null,
): EstimationConfig {
  const merged: EstimationConfig = {
    defaultCharsPerToken:
      config?.defaultCharsPerToken ?? DEFAULT_ESTIMATION_CONFIG.defaultCharsPerToken,
    defaultModel: config?.defaultModel ?? DEFAULT_ESTIMATION_CONFIG.defaultModel,
    cacheEstimates:
      config?.cacheEstimates ?? DEFAULT_ESTIMATION_CONFIG.cacheEstimates,
    maxCacheEntries:
      config?.maxCacheEntries ?? DEFAULT_ESTIMATION_CONFIG.maxCacheEntries,
    calibration: config?.calibration ? { ...config.calibration } : undefined,
  };
  return Object.freeze(merged);
}

/**
 * Resolve a model identifier against the known {@link MODEL_PROFILES} table,
 * falling back to the default profile for unknown ids. This keeps the
 * estimator resilient when callers pass a model id that has no registered
 * profile: they still get a deterministic, working ratio.
 *
 * @param model - The model id to resolve, or `undefined` / `'default'`.
 * @returns The canonical profile for the model (never `undefined`).
 */
export function resolveModelProfile(
  model: string | undefined,
): Readonly<ModelProfile> {
  if (model === undefined || model === 'default' || model === '') {
    return MODEL_PROFILES[model === 'default' ? 'default' : 'default'];
  }
  return MODEL_PROFILES[model] ?? MODEL_PROFILES.default;
}

/**
 * Deterministically derive the length-bucket index for a token count using
 * {@link LENGTH_BUCKET_SIZE}. Buckets are `[0,500)`, `[500,1000)`, …
 *
 * @param tokens - A non-negative token count.
 * @returns The zero-based bucket index.
 */
export function lengthBucketFor(tokens: number): number {
  const safe = Number.isFinite(tokens) && tokens >= 0 ? tokens : 0;
  return Math.floor(safe / LENGTH_BUCKET_SIZE);
}