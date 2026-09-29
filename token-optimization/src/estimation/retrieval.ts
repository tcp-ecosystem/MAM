/**
 * @fileoverview Heuristic token estimation engine for the Estimation layer.
 *
 * {@link TokenEstimator} is the public entry point of the Estimation layer. It
 * converts raw text into a {@link TokenEstimate} using cheap, deterministic
 * heuristics rather than a real tokenizer:
 *
 *   - **chars-per-token** (primary): divide the character count by a
 *     model-family ratio from {@link ./types.js} `MODEL_PROFILES` (or a ratio
 *     refined through calibration).
 *   - **word-based** (fallback): divide the word count by a per-model
 *     words-per-token figure when no character ratio is available.
 *   - **exact**: passthrough for callers that already know the true token
 *     count (e.g. from a real tokenizer run) and just want it wrapped.
 *   - **calibrated**: like chars-per-token, but the ratio comes from
 *     measured {@link CalibrationSample}s instead of factory defaults.
 *
 * The estimator also implements optional **length-based calibration**: ratios
 * can be scaled for very short or very long inputs (where BPE tokenizers
 * systematically deviate from a flat characters-per-token curve), and the
 * `calibrate` method lets callers teach the estimator the *true* ratio for a
 * model by feeding it `(text, actualTokens)` pairs.
 *
 * When configured with a {@link ./store.js} `EstimateStore`, the estimator
 * consults and populates the cache on every call (subject to
 * `config.cacheEstimates` and per-call `useCache`), so repeated estimation of
 * identical text is O(1). When configured with an {@link ./index.js}
 * `EstimateIndex`, fresh estimates are indexed automatically.
 *
 * @module estimation/retrieval
 */

import type { EstimateStore } from './store.js';
import type { EstimateIndex } from './index.js';
import type {
  CalibrationSample,
  EstimationConfig,
  EstimateOptions,
  ModelProfile,
  TokenEstimate,
  TokenEstimationMethod,
} from './types.js';
import {
  CONFIDENT_MIN_CHARS,
  DEFAULT_CHARS_PER_TOKEN,
  MODEL_PROFILES,
  createCalibrationSample,
  createTokenEstimate,
  normalizeEstimationConfig,
  resolveModelProfile,
} from './types.js';

/**
 * Confidence floor applied to every heuristic estimate. Heuristics are never
 * treated as exact, so `confidence` stays strictly below 1 for non-exact
 * methods regardless of input length.
 */
export const HEURISTIC_CONFIDENCE_FLOOR = 0.5;

/**
 * Confidence multiplier granted to long inputs. Combined with
 * {@link CONFIDENT_MIN_CHARS} to raise confidence for inputs long enough that
 * the law of large numbers kicks in (individual token-edge effects wash out).
 */
export const LONG_TEXT_CONFIDENCE_BONUS = 0.2;

/**
 * Maximum number of calibration samples retained per model family. New samples
 * push out the oldest so the estimator tracks the *recent* behavior of the
 * tokenizer rather than a permanently stale average.
 */
export const MAX_CALIBRATION_SAMPLES_PER_MODEL = 32;

/**
 * Options accepted by the {@link TokenEstimator} constructor. All fields are
 * optional; defaults mirror {@link ./types.js} `DEFAULT_ESTIMATION_CONFIG`.
 */
export interface TokenEstimatorOptions {
  /** Estimation configuration (see {@link EstimationConfig}). */
  readonly config?: Readonly<EstimationConfig>;
  /**
   * Profile table (model id → profile) to use instead of the built-in
   * {@link ./types.js} `MODEL_PROFILES`. Entries are merged over the built-ins.
   */
  readonly profiles?: Readonly<Record<string, Readonly<ModelProfile>>>;
  /** Optional cache the estimator reads from and writes to. */
  readonly store?: EstimateStore;
  /** Optional index that fresh estimates are written into. */
  readonly index?: EstimateIndex;
  /**
   * Pre-seeded calibration history (model id → samples). Useful when restoring
   * an estimator from a persisted lifecycle snapshot.
   */
  readonly calibration?: Readonly<Record<string, readonly CalibrationSample[]>>;
}

/**
 * Per-model calibration state: a capped, time-ordered list of measured
 * samples plus a cached average ratio.
 */
interface CalibrationState {
  /** Measured samples, oldest first. */
  readonly samples: CalibrationSample[];
  /** Rolling average of `chars / actualTokens` over `samples`. */
  ratio: number;
  /** `true` once at least one sample has been recorded. */
  calibrated: boolean;
}

/**
 * Deterministic heuristic token estimator.
 *
 * Instances are cheap to construct and safe to share: the estimator keeps no
 * per-call mutable state (cache / index are injected), so a single instance
 * can serve an entire process.
 *
 * @example
 * ```ts
 * const estimator = new TokenEstimator();
 * const est = estimator.estimate('The quick brown fox', { model: 'gpt-4' });
 * estimator.calibrate('gpt-4', sampleText, realTokenCount);
 * ```
 */
export class TokenEstimator {
  /** Normalized configuration. */
  readonly config: EstimationConfig;

  /** Resolved profile table (built-ins merged with caller overrides). */
  readonly profiles: Readonly<Record<string, Readonly<ModelProfile>>>;

  /** Optional backing cache. */
  readonly store?: EstimateStore;

  /** Optional index receiving fresh estimates. */
  readonly index?: EstimateIndex;

  /** Per-model calibration state. */
  private readonly calibrationByModel: Map<string, CalibrationState> = new Map();

  /** Lifetime counters for diagnostics. */
  private readonly counters = {
    estimates: 0,
    cacheHits: 0,
    calibrations: 0,
  };

  /**
   * @param options - Tuning options (see {@link TokenEstimatorOptions}).
   */
  constructor(options: Readonly<TokenEstimatorOptions> = {}) {
    this.config = normalizeEstimationConfig(options.config);
    this.store = options.store;
    this.index = options.index;
    this.profiles = this.buildProfiles(options.profiles);
    if (options.calibration) {
      for (const [model, samples] of Object.entries(options.calibration)) {
        for (const sample of samples) this.recordCalibrationSample(model, sample);
      }
    }
  }

  /**
   * Merge the built-in {@link ./types.js} `MODEL_PROFILES` with any caller
   * overrides. Overrides win key-for-key.
   *
   * @param overrides - Optional caller-supplied profiles.
   * @returns A frozen merged profile table.
   */
  private buildProfiles(
    overrides?: Readonly<Record<string, Readonly<ModelProfile>>>,
  ): Readonly<Record<string, Readonly<ModelProfile>>> {
    const merged: Record<string, Readonly<ModelProfile>> = {};
    for (const [id, profile] of Object.entries(MODEL_PROFILES)) {
      merged[id] = profile;
    }
    if (overrides) {
      for (const [id, profile] of Object.entries(overrides)) {
        merged[id] = Object.freeze({ ...profile, id: profile.id ?? id });
      }
    }
    return Object.freeze(merged);
  }

  /**
   * Number of characters in a text. Pure JS string length (UTF-16 code units),
   * which matches how tokenizer-independent heuristics count characters and is
   * consistent with `text.length`. Exposed publicly so callers can reuse the
   * estimator's definition everywhere.
   *
   * @param text - The text to measure.
   * @returns The character count (0 for empty input).
   */
  countChars(text: string): number {
    return typeof text === 'string' ? text.length : 0;
  }

  /**
   * Number of words in a text, defined as whitespace-separated runs of
   * non-whitespace. Handles tabs / newlines and repeated spaces without
   * relying on a regex engine that backtracks. Empty and whitespace-only text
   * yield 0.
   *
   * @param text - The text to tokenize into words.
   * @returns The word count (>= 0).
   */
  countWords(text: string): number {
    if (typeof text !== 'string' || text.trim().length === 0) return 0;
    let words = 0;
    let inWord = false;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      const isSpace =
        code === 0x20 || // space
        code === 0x09 || // tab
        code === 0x0a || // newline
        code === 0x0d || // carriage return
        code === 0x0b || // vertical tab
        code === 0x0c || // form feed
        code === 0xa0; // non-breaking space
      if (isSpace) {
        inWord = false;
      } else if (!inWord) {
        inWord = true;
        words += 1;
      }
    }
    return words;
  }

  /**
   * Resolve the effective model family for a call. Priority: per-call option →
   * config default → built-in default. Always returns a non-empty id.
   *
   * @param requested - Model from the call options (optional).
   * @returns The canonical model id to use.
   */
  modelFor(requested?: string): string {
    const id = requested ?? this.config.defaultModel;
    return id && id !== 'default' ? id : (this.config.defaultModel ?? 'default');
  }

  /**
   * Return the characters-per-token ratio the estimator would currently use for
   * a model: a calibration average when available, otherwise the profile ratio,
   * otherwise the config default. Useful for callers who want to reason about
   * ratios without running a full estimation.
   *
   * @param model - Model id (defaults to the estimator's default model).
   * @returns A positive ratio.
   */
  charsPerToken(model?: string): number {
    const id = this.modelFor(model);
    const calibrated = this.calibrationByModel.get(id);
    if (calibrated?.calibrated) return calibrated.ratio;
    const profile = this.profiles[id];
    return profile?.charsPerToken ?? this.config.defaultCharsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  }

  /**
   * Return the effective words-per-token figure for a model: the profile's
   * `tokensPerWord`, else the inverse of `wordsPerToken`, else a sane default.
   *
   * @param model - Model id (defaults to the estimator's default model).
   * @returns A positive tokens-per-word figure.
   */
  tokensPerWord(model?: string): number {
    const id = this.modelFor(model);
    const profile = this.profiles[id];
    if (profile?.tokensPerWord !== undefined) return profile.tokensPerWord;
    if (profile?.wordsPerToken !== undefined) return 1 / profile.wordsPerToken;
    return 4 / 3;
  }

  /**
   * The model profile the estimator would resolve for a model id. Falls back to
   * the generic default profile for unknown ids, so this never returns
   * `undefined`.
   *
   * @param model - Model id (defaults to the estimator's default model).
   * @returns The resolved (frozen) profile.
   */
  profileFor(model?: string): Readonly<ModelProfile> {
    const id = this.modelFor(model);
    return this.profiles[id] ?? resolveModelProfile(undefined);
  }

  /**
   * Estimate the token count for a single piece of text.
   *
   * Behavior in detail:
   *   - If caching is enabled and a cached estimate exists for
   *     `(text, model)`, the cache hit is returned immediately (method and
   *     confidence are preserved from the cached estimate).
   *   - Otherwise the estimate is computed from the resolved model profile,
   *     with a per-model calibration ratio overriding the factory ratio when
   *     samples exist.
   *   - `method: 'exact'` in options requires `exactTokens`; an `Error` is
   *     thrown otherwise.
   *   - Fresh estimates are written to the cache and index when configured.
   *
   * @param text - The text to estimate.
   * @param options - Per-call overrides (see {@link EstimateOptions}).
   * @returns A frozen {@link TokenEstimate}.
   */
  estimate(text: string, options: Readonly<EstimateOptions> = {}): TokenEstimate {
    if (typeof text !== 'string') {
      throw new TypeError('TokenEstimator#estimate: `text` must be a string');
    }
    const model = this.modelFor(options.model);
    const useCache = this.config.cacheEstimates !== false && options.useCache !== false;

    if (useCache && this.store) {
      const cached = this.store.getFor(text, model);
      if (cached) {
        this.counters.cacheHits += 1;
        return cached;
      }
    }

    let estimate: TokenEstimate;

    if (options.method === 'exact') {
      if (!Number.isInteger(options.exactTokens) || (options.exactTokens ?? 0) < 0) {
        throw new RangeError(
          "TokenEstimator#estimate: `method: 'exact'` requires a non-negative integer `exactTokens`",
        );
      }
      estimate = this.buildExactEstimate(text, options.exactTokens as number, model, options);
    } else {
      estimate = this.computeHeuristic(text, model, options);
    }

    this.counters.estimates += 1;

    if (useCache && this.store) {
      this.store.put(estimate);
    }
    if (this.index) {
      this.index.indexEstimate(estimate);
    }
    return estimate;
  }

  /**
   * Estimate many texts in one call. Equivalent to repeated {@link estimate}
   * but shares one batch id across all results, so downstream tooling can group
   * them. Individual failures do not abort the batch: per-text results are
   * returned in the same order as the input.
   *
   * @param texts - The texts to estimate.
   * @param options - Per-call overrides; `batchId` defaults to a time-based id
   *   when not supplied.
   * @returns An estimate for every input text (same length and order).
   */
  estimateMany(texts: Iterable<string>, options: Readonly<EstimateOptions> = {}): TokenEstimate[] {
    const batchId =
      options.batchId ?? `batch-${Date.now().toString(36)}-${this.counters.estimates.toString(36)}`;
    const out: TokenEstimate[] = [];
    for (const text of texts) {
      out.push(this.estimate(text, { ...options, batchId }));
    }
    return out;
  }

  /**
   * Teach the estimator the *true* characters-per-token ratio for a model.
   *
   * `calibrate` records a {@link CalibrationSample} derived from
   * `(model, sampleText, actualTokens)` and updates the model's rolling ratio.
   * From then on, {@link estimate} uses the calibrated ratio for that model
   * (method becomes `calibrated`). Prior cached estimates for the model are
   * left intact (they are still valid measurements), but all *future* calls
   * use the refined ratio.
   *
   * @param model - Canonical model id.
   * @param sampleText - The sample text that was tokenized.
   * @param actualTokens - Ground-truth token count from the real tokenizer.
   * @param label - Optional content-type label recorded on the sample.
   * @returns The frozen {@link CalibrationSample} that was recorded.
   */
  calibrate(
    model: string,
    sampleText: string,
    actualTokens: number,
    label?: string,
  ): CalibrationSample {
    if (typeof model !== 'string' || model.length === 0) {
      throw new TypeError('TokenEstimator#calibrate: `model` must be a non-empty string');
    }
    if (typeof sampleText !== 'string') {
      throw new TypeError('TokenEstimator#calibrate: `sampleText` must be a string');
    }
    if (!Number.isInteger(actualTokens) || actualTokens < 0) {
      throw new RangeError('TokenEstimator#calibrate: `actualTokens` must be a non-negative integer');
    }
    const sample = createCalibrationSample(model, sampleText, actualTokens, label);
    this.recordCalibrationSample(model, sample);
    this.counters.calibrations += 1;
    return sample;
  }

  /**
   * All calibration samples recorded for a model, oldest first. Empty array
   * when the model has never been calibrated.
   *
   * @param model - Canonical model id.
   */
  calibrationSamples(model: string): readonly CalibrationSample[] {
    return this.calibrationByModel.get(model)?.samples ?? [];
  }

  /**
   * Snapshot of the entire calibration table, keyed by model id.
   */
  calibrationSnapshot(): Readonly<Record<string, readonly CalibrationSample[]>> {
    const out: Record<string, readonly CalibrationSample[]> = {};
    for (const [model, state] of this.calibrationByModel) {
      out[model] = [...state.samples];
    }
    return out;
  }

  /**
   * Clear all calibration for a model, reverting it to factory defaults.
   *
   * @param model - Canonical model id.
   * @returns The number of samples that were removed.
   */
  resetCalibration(model: string): number {
    const state = this.calibrationByModel.get(model);
    if (!state) return 0;
    const removed = state.samples.length;
    this.calibrationByModel.delete(model);
    return removed;
  }

  /**
   * Lifetime counters for diagnostics.
   */
  countersSnapshot(): {
    estimates: number;
    cacheHits: number;
    calibrations: number;
  } {
    return { ...this.counters };
  }

  /**
   * Record a sample into a model's calibration state, applying the per-model
   * cap and recomputing the rolling average ratio.
   */
  private recordCalibrationSample(model: string, sample: CalibrationSample): void {
    let state = this.calibrationByModel.get(model);
    if (!state) {
      state = { samples: [], ratio: DEFAULT_CHARS_PER_TOKEN, calibrated: false };
      this.calibrationByModel.set(model, state);
    }
    const samples = state.samples;
    samples.push(sample);
    while (samples.length > MAX_CALIBRATION_SAMPLES_PER_MODEL) samples.shift();
    let sum = 0;
    for (const item of samples) sum += item.ratio;
    state.ratio = sum / samples.length;
    state.calibrated = true;
  }

  /**
   * Build a `TokenEstimate` for the exact-method path.
   */
  private buildExactEstimate(
    text: string,
    exactTokens: number,
    model: string,
    options: Readonly<EstimateOptions>,
  ): TokenEstimate {
    return createTokenEstimate(text, exactTokens, 'exact', {
      model,
      confidence: 1,
      batchId: options.batchId,
      source: options.source ?? 'exact',
    });
  }

  /**
   * Compute a heuristic estimate for a text using the resolved profile for the
   * model. Chooses chars-per-token when a character ratio is available and the
   * text is non-empty, otherwise falls back to the word-based heuristic.
   */
  private computeHeuristic(
    text: string,
    model: string,
    options: Readonly<EstimateOptions>,
  ): TokenEstimate {
    const chars = this.countChars(text);
    const words = this.countWords(text);

    if (options.method && options.method !== 'chars-per-token' && options.method !== 'word-based') {
      throw new TypeError(`TokenEstimator#estimate: unsupported heuristic method \`${options.method}\``);
    }

    const forceWordBased = options.method === 'word-based';
    const ratio = this.charsPerToken(model);
    const calibrated = this.calibrationByModel.get(model)?.calibrated === true;

    if (!forceWordBased && chars > 0 && ratio > 0) {
      const adjustedRatio = this.applyLengthCalibration(chars, ratio, model);
      const tokens = Math.max(1, Math.round(chars / adjustedRatio));
      const method: TokenEstimationMethod = calibrated ? 'calibrated' : 'chars-per-token';
      return createTokenEstimate(text, tokens, method, {
        model,
        confidence: this.confidenceFor(method, chars),
        batchId: options.batchId,
        source: calibrated ? `calibrated:${model}` : 'chars-per-token',
      });
    }

    const tokensPerWord = this.tokensPerWord(model);
    const tokens = Math.max(1, Math.round(words * tokensPerWord));
    return createTokenEstimate(text, tokens, 'word-based', {
      model,
      confidence: this.confidenceFor('word-based', chars),
      batchId: options.batchId,
      source: 'word-based',
    });
  }

  /**
   * Apply optional length-based calibration to a base ratio for a given
   * character count. Uses the config-level calibration anchors when present;
   * interpolates linearly between anchors when `interpolate` is enabled.
   */
  private applyLengthCalibration(chars: number, baseRatio: number, model: string): number {
    const calibration = this.config.calibration;
    if (!calibration) return baseRatio;
    const hasShort =
      calibration.shortTextRatio !== undefined && calibration.shortTextChars !== undefined;
    const hasLong =
      calibration.longTextRatio !== undefined && calibration.longTextChars !== undefined;
    if (!hasShort && !hasLong) return baseRatio;

    const interpolate = calibration.interpolate !== false;

    if (hasShort && chars <= (calibration.shortTextChars as number)) {
      const shortRatio = calibration.shortTextRatio as number;
      if (!hasLong || !interpolate) return shortRatio;
      const shortAt = calibration.shortTextChars as number;
      const longAt = calibration.longTextChars as number;
      if (longAt <= shortAt) return shortRatio;
      const t = Math.max(0, Math.min(1, (chars - shortAt) / (longAt - shortAt)));
      return shortRatio + (baseRatio - shortRatio) * t;
    }

    if (hasLong && chars >= (calibration.longTextChars as number)) {
      const longRatio = calibration.longTextRatio as number;
      if (!hasShort || !interpolate) return longRatio;
      const shortAt = calibration.shortTextChars as number;
      const longAt = calibration.longTextChars as number;
      if (longAt <= shortAt) return longRatio;
      const t = Math.max(0, Math.min(1, (chars - shortAt) / (longAt - shortAt)));
      return baseRatio + (longRatio - baseRatio) * t;
    }

    if (interpolate && hasShort && hasLong) {
      const shortAt = calibration.shortTextChars as number;
      const longAt = calibration.longTextChars as number;
      if (longAt <= shortAt) return baseRatio;
      const t = Math.max(0, Math.min(1, (chars - shortAt) / (longAt - shortAt)));
      const shortRatio = calibration.shortTextRatio as number;
      const longRatio = calibration.longTextRatio as number;
      if (chars <= shortAt) return shortRatio;
      if (chars >= longAt) return longRatio;
      const segment = t < 0.5
        ? shortRatio + (baseRatio - shortRatio) * (t / 0.5)
        : baseRatio + (longRatio - baseRatio) * ((t - 0.5) / 0.5);
      return segment;
    }

    return baseRatio;
  }

  /**
   * Derive a confidence value in [0, 1] from an estimation method and the input
   * length. Exact is 1; heuristics start at {@link HEURISTIC_CONFIDENCE_FLOOR}
   * and rise toward a ceiling as input length grows past
   * {@link CONFIDENT_MIN_CHARS}. Calibrated estimates get a small bonus over
   * factory-ratio estimates since their ratio is measured.
   */
  private confidenceFor(method: TokenEstimationMethod, chars: number): number {
    if (method === 'exact') return 1;
    let confidence = HEURISTIC_CONFIDENCE_FLOOR;
    if (chars >= CONFIDENT_MIN_CHARS) {
      confidence += LONG_TEXT_CONFIDENCE_BONUS;
    } else if (chars > 0) {
      confidence += LONG_TEXT_CONFIDENCE_BONUS * (chars / CONFIDENT_MIN_CHARS);
    }
    if (method === 'calibrated') confidence = Math.min(0.95, confidence + 0.05);
    return Math.min(0.9, confidence);
  }

  /**
   * Number of distinct model families known to this estimator (built-ins plus
   * overrides plus any model that has been calibrated but has no profile).
   */
  knownModels(): string[] {
    const ids = new Set<string>([...Object.keys(this.profiles), ...this.calibrationByModel.keys()]);
    return [...ids].sort();
  }

  /**
   * Serialize everything needed to restore this estimator's calibration state.
   * Profiles are NOT serialized (they are config, not runtime state).
   */
  toJSON(): {
    version: 1;
    defaultModel: string;
    calibration: Readonly<Record<string, readonly CalibrationSample[]>>;
  } {
    return {
      version: 1,
      defaultModel: this.config.defaultModel ?? 'default',
      calibration: this.calibrationSnapshot(),
    };
  }
}