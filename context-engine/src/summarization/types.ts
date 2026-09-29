/**
 * Shared domain types for the **Summarization** layer of the standalone MAM
 * Context Engine.
 *
 * The Summarization layer is what a prompt-assembly pipeline reaches for when
 * a piece of context is *too long to read, but too important to drop*. Unlike
 * a token budget (which simply refuses or trims), summarization *preserves
 * meaning*: it distils a large block of text down to its most informative
 * sentences, its most salient keywords, or a progressively-shortened rolling
 * digest, so the rest of the engine can include a condensed version of the
 * source instead of either bloating the prompt or losing the signal.
 *
 * Everything here is **deterministic** — there is deliberately no LLM in the
 * loop. The layer ranks content with classical, reproducible heuristics:
 *
 * - **Extractive** — every sentence is scored from term frequency (with an
 *   optional IDF-ish correction), its position in the document, and its
 *   length; the highest-scoring sentences are picked and re-ordered into
 *   their original sequence.
 * - **Keyword** — the document's tokens are counted, stopwords are discarded,
 *   and the most salient terms are reported with their computed salience.
 * - **Rolling** — the text is chopped into sentence-aligned chunks which are
 *   summarised extractively, joined, and *summarised again* until the digest
 *   stops shrinking (a "summary of summaries").
 *
 * The layer is organised around the same five-part shape as its siblings
 * (`token-budgeting`, `context-assembly`):
 *
 * 1. **Types** — the public contract below, plus the pure factories and
 *    guards every other file composes.
 * 2. **Store** — {@link SummarizationStore}, a keyed result cache that also
 *    records per-technique counters and round-trips through JSON.
 * 3. **Index** — {@link SummarizationIndex}, a secondary index over the cache
 *    keyed by technique and by summary-length bucket.
 * 4. **Retrieval** — {@link TextSummarizer}, the deterministic ranking engine.
 * 5. **Lifecycle** — {@link SummarizationLifecycle}, which prunes the cache to
 *    a bounded size and re-emits store events.
 * 6. **Integration** — {@link Summarizer} and friends, the ergonomic facades.
 *
 * The types in this module form the contract shared by every file of the
 * subsystem:
 *
 * - {@link SummaryResult} — one produced summary: the text plus the
 *   bookkeeping (technique, original/summary lengths, compression ratio,
 *   optional key points) every consumer needs to log or react.
 * - {@link SummarizationConfig} — construction/behaviour options: how many
 *   sentences to keep, an optional maximum output length, the default
 *   technique and a minimum sentence score.
 * - {@link SummarizeOptions} — per-call overrides layered over the config.
 * - {@link SummarizationStats} — aggregate counters describing the layer.
 * - {@link KeyPoint} — a single extracted key point with its rank and score.
 * - {@link Timestamp} — the epoch-millisecond clock the whole layer uses.
 *
 * Every value is JSON-serialisable and framework-agnostic, and the pure
 * helpers ({@link createSummaryResult}, {@link mergeSummarizationConfig},
 * {@link lengthBucket}, {@link hashString}, …) keep the deterministic core
 * unit-testable without any runtime machinery.
 *
 * @packageDocumentation
 * @module summarization/types
 */

/**
 * The deterministic technique a {@link SummaryResult} was produced with.
 *
 * - `'extractive'` — the default: the highest-scoring sentences of the source
 *   are selected verbatim and re-ordered into their original sequence. The
 *   summary is always a subset of the source's own sentences.
 * - `'keyword'` — the output is not a fluent passage but the document's most
 *   salient terms (or short phrases), ranked by computed salience.
 * - `'rolling'` — the source is chunked, each chunk summarised extractively,
 *   the chunk summaries joined and re-summarised, until the digest stops
 *   shrinking or reaches a length target ("summary of summaries").
 *
 * {@link isSummarizeTechnique} narrows arbitrary values to this set.
 */
export type SummarizeTechnique = 'extractive' | 'keyword' | 'rolling';

/**
 * A single extracted key point.
 *
 * Key points are the sentence-level "take-aways" of a document — the few
 * sentences a reader should remember even if they skip everything else. They
 * are produced by {@link TextSummarizer.keyPoints} and surfaced (optionally)
 * on {@link SummaryResult.keyPoints}.
 *
 * `rank` is 1-based and ordered by descending `score`, so a KeyPoint with
 * `rank: 1` is the document's single most salient sentence.
 */
export interface KeyPoint {
  /**
   * The key point's text: a single source sentence, trimmed.
   */
  readonly text: string;

  /**
   * 1-based rank, ordered by descending {@link KeyPoint.score}. `1` is the
   * most salient key point.
   */
  readonly rank: number;

  /**
   * The deterministic salience score that produced this rank. Higher is more
   * salient; the scale is internal and only meaningful relative to the other
   * key points of the same document.
   */
  readonly score: number;
}

/**
 * The outcome of a single summarization operation.
 *
 * Every method of {@link TextSummarizer} (and the integration facades built on
 * it) returns one of these. Beyond the summary text itself it carries the
 * bookkeeping a caller needs to decide what to do next:
 *
 * - `originalLength` / `summaryLength` — plain character counts of the input
 *   and output, so the caller can compare with token budgets.
 * - `ratio` — `summaryLength / originalLength`, the compression factor. A
 *   ratio near `1` means little was removed; a ratio near `0` means heavy
 *   compression.
 * - `keyPoints` — optional, the document's top take-aways (see
 *   {@link KeyPoint}).
 *
 * @example
 * ```ts
 * const result: SummaryResult = {
 *   summary: 'MAM is a deterministic context engine.',
 *   technique: 'extractive',
 *   originalLength: 340,
 *   summaryLength: 38,
 *   ratio: 0.11,
 * };
 * ```
 */
export interface SummaryResult {
  /**
   * The produced summary text.
   */
  readonly summary: string;

  /**
   * The technique used to produce it (see {@link SummarizeTechnique}).
   */
  readonly technique: SummarizeTechnique;

  /**
   * Character length of the original (unnormalised) input text.
   */
  readonly originalLength: number;

  /**
   * Character length of {@link SummaryResult.summary}.
   */
  readonly summaryLength: number;

  /**
   * Compression ratio: `summaryLength / originalLength`, clamped to `[0, 1]`
   * (or `0` when the original is empty). See {@link ratioFor}.
   */
  readonly ratio: number;

  /**
   * Optional key points extracted alongside the summary. Present when the
   * producing call asked for them (e.g. `summarize` always includes them when
   * the technique is extractive or rolling).
   */
  readonly keyPoints?: readonly KeyPoint[];
}

/**
 * Construction/behaviour options for the summarization subsystem.
 *
 * A {@link SummarizationConfig} may be supplied to {@link TextSummarizer},
 * {@link Summarizer} and {@link createSummarizer} to tune the default
 * technique, how many sentences extractive summaries keep, an optional
 * maximum output length, a minimum sentence score, and an optional custom
 * stopword list for keyword extraction. Every field has a sensible default
 * (see {@link defaultSummarizationConfig}); callers override only what they
 * care about.
 *
 * @example
 * ```ts
 * const config: SummarizationConfig = {
 *   technique: 'extractive',
 *   maxSentences: 4,
 *   maxLength: 512,
 *   minScore: 0.1,
 * };
 * ```
 */
export interface SummarizationConfig {
  /**
   * The default technique used when a call does not override it. Defaults to
   * {@link DEFAULT_TECHNIQUE} (`'extractive'`).
   */
  readonly technique: SummarizeTechnique;

  /**
   * Maximum number of sentences an extractive summary keeps. Defaults to
   * {@link DEFAULT_MAX_SENTENCES} (`5`). A value of `0` is treated as the
   * default (see {@link resolveMaxSentences}).
   */
  readonly maxSentences: number;

  /**
   * Optional maximum output length in characters. `0` (the default) means
   * unbounded — extractive summaries are limited purely by sentence count and
   * rolling summaries by their own convergence. When non-zero, extraction
   * favours shorter sentences and {@link TextSummarizer.summarize} clips the
   * result at the nearest word boundary.
   */
  readonly maxLength: number;

  /**
   * Minimum sentence score (in `[0, 1]`) for a sentence to be eligible for an
   * extractive summary. Defaults to {@link DEFAULT_MIN_SCORE} (`0` — every
   * non-empty sentence is eligible). Raising it makes summaries stricter and
   * shorter.
   */
  readonly minScore: number;

  /**
   * Optional custom stopword list used by keyword extraction. When provided it
   * *replaces* the built-in English stopword list (see
   * `DEFAULT_STOPWORDS` in `retrieval.ts`) rather than extending it, so
   * callers can tune extraction for a domain (e.g. drop "feature", "version"
   * for a product changelog).
   */
  readonly stopwords?: readonly string[];

  /**
   * Clock used for all timestamps. Injecting a clock makes the layer
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Per-call overrides accepted by {@link TextSummarizer.summarize} and the
 * integration facades.
 *
 * Every field is optional, so a caller can override the configured
 * {@link SummarizationConfig.technique} or {@link SummarizationConfig
 * .maxSentences} for a single invocation without disturbing the shared
 * config — e.g. "give me a 3-sentence extractive summary of *this* doc even
 * though the layer normally defaults to 5".
 */
export interface SummarizeOptions {
  /**
   * One-call override of the configured technique.
   */
  readonly technique?: SummarizeTechnique;

  /**
   * One-call override of the configured maximum sentence count.
   */
  readonly maxSentences?: number;

  /**
   * One-call override of the configured maximum output length.
   */
  readonly maxLength?: number;

  /**
   * One-call override of the configured minimum sentence score.
   */
  readonly minScore?: number;

  /**
   * When `false`, the produced summary is returned without an attached
   * {@link SummaryResult.keyPoints} list (cheaper for callers that only need
   * the text). Defaults to `true` for extractive/rolling techniques.
   */
  readonly withKeyPoints?: boolean;

  /**
   * One-call override of the clock used for timestamps.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate counters describing the summarization subsystem.
 *
 * Returned by {@link SummarizationStore.stats} (and extended by the lifecycle's
 * own stats). Behaviour counters (`puts`, `gets`, `hits`, `misses`, `deletes`,
 * `clears`, `pruned`) increase monotonically from construction; state-derived
 * values (`results`, `byTechnique`, the character totals, `averageRatio`) are
 * computed on demand from the live cache.
 */
export interface SummarizationStats {
  /**
   * Number of results currently stored in the cache.
   */
  readonly results: number;

  /**
   * How many of the stored results fall in each technique bucket.
   */
  readonly byTechnique: Readonly<Record<SummarizeTechnique, number>>;

  /**
   * Sum of `originalLength` across all stored results.
   */
  readonly totalOriginalChars: number;

  /**
   * Sum of `summaryLength` across all stored results.
   */
  readonly totalSummaryChars: number;

  /**
   * Mean `ratio` across all stored results (`0` when the cache is empty).
   */
  readonly averageRatio: number;

  /**
   * Number of `put`/`putMany` operations since construction.
   */
  readonly puts: number;

  /**
   * Number of `get`/`getByKey` operations since construction.
   */
  readonly gets: number;

  /**
   * Number of `get` operations that found a cached result since construction.
   */
  readonly hits: number;

  /**
   * Number of `get` operations that found nothing since construction.
   */
  readonly misses: number;

  /**
   * Number of `delete` operations since construction.
   */
  readonly deletes: number;

  /**
   * Number of `clear` operations since construction.
   */
  readonly clears: number;

  /**
   * Number of results evicted by lifecycle pruning since construction.
   */
  readonly pruned: number;

  /**
   * Epoch-millisecond time the store was constructed.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time of the most recent state change.
   */
  readonly updatedAt: Timestamp;
}

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the summarization layer use epoch milliseconds so
 * they interoperate cleanly with `Date`, `performance.now()`-derived clocks and
 * the lifecycle's interval arithmetic.
 */
export type Timestamp = number;

/**
 * The three deterministic techniques, in canonical order. Iterated by the
 * index and the stats factories.
 */
export const TECHNIQUES: readonly SummarizeTechnique[] = [
  'extractive',
  'keyword',
  'rolling',
];

/**
 * Default technique applied when a call does not override it.
 */
export const DEFAULT_TECHNIQUE: SummarizeTechnique = 'extractive';

/**
 * Default maximum number of sentences an extractive summary keeps.
 */
export const DEFAULT_MAX_SENTENCES = 5;

/**
 * Default maximum output length in characters (`0` = unbounded).
 */
export const DEFAULT_MAX_LENGTH = 0;

/**
 * Default minimum sentence score (`0` = every non-empty sentence eligible).
 */
export const DEFAULT_MIN_SCORE = 0;

/**
 * Default width in characters of a length bucket used by
 * {@link lengthBucket} and the summarization index. Buckets of 200 characters
 * keep the secondary index small even for very long documents (a 10k-char
 * document lands in bucket `9800-9999`, not in a bucket per character).
 */
export const DEFAULT_BUCKET_WIDTH = 200;

/**
 * Clamp a raw score into a valid `[0, 1]` score. Non-finite values collapse
 * to `0`.
 *
 * @param score - the raw score
 * @returns a score in `[0, 1]`
 */
export function clampScore(score: number): number {
  if (!Number.isFinite(score)) {
    return 0;
  }
  return Math.min(1, Math.max(0, score));
}

/**
 * Clamp an arbitrary number into a valid sentence count: a non-negative finite
 * integer. Non-finite or negative inputs collapse to `0`.
 *
 * @param sentences - the raw sentence count
 * @returns a safe, non-negative integer count
 */
export function clampSentences(sentences: number): number {
  if (!Number.isFinite(sentences)) {
    return 0;
  }
  return Math.max(0, Math.floor(sentences));
}

/**
 * Clamp an arbitrary number into a valid character length: a non-negative
 * finite integer. Non-finite or negative inputs collapse to `0`.
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
 * Resolve the effective maximum sentence count for an operation.
 *
 * A configured/requested count of `0` or less is treated as the default
 * {@link DEFAULT_MAX_SENTENCES}, so an explicit "0 sentences" cannot produce a
 * degenerate empty summary.
 *
 * @param requested - the requested count (from options or config)
 * @returns the effective count, always `>= 1`
 */
export function resolveMaxSentences(requested: number): number {
  return requested > 0 ? Math.floor(requested) : DEFAULT_MAX_SENTENCES;
}

/**
 * Compute the compression ratio of a summary: `summaryLength / originalLength`.
 *
 * Returns `0` when the original is empty (nothing to measure), and clamps to
 * `[0, 1]` so a summary that somehow grew past its source cannot report a
 * ratio above `1`.
 *
 * @param originalLength - character length of the source
 * @param summaryLength - character length of the summary
 * @returns the ratio in `[0, 1]`
 */
export function ratioFor(originalLength: number, summaryLength: number): number {
  const original = clampLength(originalLength);
  const summary = clampLength(summaryLength);
  if (original <= 0) {
    return 0;
  }
  return Math.min(1, summary / original);
}

/**
 * Bucket a character length into a range label like `"0-199"` or `"800-999"`.
 *
 * Used by {@link SummarizationIndex} to keep a coarse secondary index over
 * summary sizes without tracking every distinct length. Buckets are
 * `[start, start + width)`; a bucket for a length of exactly `n * width` lands
 * in the bucket starting at `n * width`.
 *
 * @param length - the character length to bucket
 * @param width - the bucket width (defaults to {@link DEFAULT_BUCKET_WIDTH})
 * @returns a label of the form `"{start}-{end}"`
 */
export function lengthBucket(
  length: number,
  width: number = DEFAULT_BUCKET_WIDTH,
): string {
  const bucketWidth = clampLength(width) || DEFAULT_BUCKET_WIDTH;
  const start = Math.floor(clampLength(length) / bucketWidth) * bucketWidth;
  return `${start}-${start + bucketWidth - 1}`;
}

/**
 * Compute a deterministic string hash of a piece of text.
 *
 * Implements the FNV-1a 32-bit hash, rendered in base-36 and prefixed with
 * `"h"` so it can be used safely as part of a cache key. Deterministic across
 * runs and platforms — summarization is a deterministic layer, so keys derived
 * from it must be stable too. **Not** a cryptographic hash; it is used only for
 * cache-key derivation, never for security.
 *
 * @param text - the text to hash
 * @returns a stable, short hash string (e.g. `"h1k3x9z"`)
 */
export function hashString(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(36)}`;
}

/**
 * Narrow a value to {@link SummarizeTechnique}.
 *
 * @param value - the value to test
 * @returns `true` when the value is one of the three techniques
 */
export function isSummarizeTechnique(value: unknown): value is SummarizeTechnique {
  return (
    value === 'extractive' || value === 'keyword' || value === 'rolling'
  );
}

/**
 * Narrow a value to {@link KeyPoint} by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link KeyPoint}
 */
export function isKeyPoint(value: unknown): value is KeyPoint {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<KeyPoint>;
  return (
    typeof record.text === 'string' &&
    typeof record.rank === 'number' &&
    Number.isFinite(record.rank) &&
    record.rank >= 1 &&
    typeof record.score === 'number' &&
    Number.isFinite(record.score)
  );
}

/**
 * Narrow a value to {@link SummaryResult} by structural inspection.
 *
 * Checks the five required fields; `keyPoints`, when present, must be a list
 * of {@link KeyPoint} objects.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link SummaryResult}
 */
export function isSummaryResult(value: unknown): value is SummaryResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SummaryResult>;
  return (
    typeof record.summary === 'string' &&
    isSummarizeTechnique(record.technique) &&
    typeof record.originalLength === 'number' &&
    Number.isFinite(record.originalLength) &&
    record.originalLength >= 0 &&
    typeof record.summaryLength === 'number' &&
    Number.isFinite(record.summaryLength) &&
    record.summaryLength >= 0 &&
    typeof record.ratio === 'number' &&
    Number.isFinite(record.ratio) &&
    (record.keyPoints === undefined ||
      (Array.isArray(record.keyPoints) &&
        record.keyPoints.every(isKeyPoint)))
  );
}

/**
 * A fresh, zeroed technique counter map.
 *
 * @returns `{ extractive: 0, keyword: 0, rolling: 0 }`
 */
export function emptyTechniqueCounts(): Record<SummarizeTechnique, number> {
  return { extractive: 0, keyword: 0, rolling: 0 };
}

/**
 * Produce the canonical {@link SummarizationConfig} defaults.
 *
 * Extractive, 5 sentences, unbounded length, minimum score `0`, no custom
 * stopwords, and a wall-clock timestamp source.
 *
 * @returns a complete configuration with every field populated by its default
 */
export function defaultSummarizationConfig(): SummarizationConfig {
  return {
    technique: DEFAULT_TECHNIQUE,
    maxSentences: DEFAULT_MAX_SENTENCES,
    maxLength: DEFAULT_MAX_LENGTH,
    minScore: DEFAULT_MIN_SCORE,
  };
}

/**
 * Merge a partial {@link SummarizationConfig} over the defaults.
 *
 * Every explicitly-provided field wins; absent fields keep their defaults.
 * `stopwords`, when provided, is copied so later mutation of the caller's
 * array cannot leak into the config.
 *
 * @param config - the partial configuration, or `undefined`
 * @returns a complete, merged {@link SummarizationConfig}
 */
export function mergeSummarizationConfig(
  config: Partial<SummarizationConfig> | undefined,
): SummarizationConfig {
  const base = defaultSummarizationConfig();
  if (!config) {
    return base;
  }
  return {
    ...base,
    ...config,
    technique: config.technique ?? base.technique,
    maxSentences:
      config.maxSentences !== undefined && config.maxSentences > 0
        ? Math.floor(config.maxSentences)
        : base.maxSentences,
    maxLength:
      config.maxLength !== undefined && config.maxLength > 0
        ? Math.floor(config.maxLength)
        : base.maxLength,
    minScore: clampScore(config.minScore ?? base.minScore),
    stopwords: config.stopwords ? [...config.stopwords] : base.stopwords,
  };
}

/**
 * Build a fully-populated {@link SummaryResult}.
 *
 * The canonical way to construct results: computes `summaryLength` and `ratio`
 * from the inputs so no caller can accidentally ship an inconsistent triple.
 *
 * @param summary - the summary text
 * @param technique - the technique that produced it
 * @param originalLength - character length of the source
 * @param keyPoints - optional key points to attach
 * @returns a consistent {@link SummaryResult}
 */
export function createSummaryResult(
  summary: string,
  technique: SummarizeTechnique,
  originalLength: number,
  keyPoints?: readonly KeyPoint[],
): SummaryResult {
  const original = clampLength(originalLength);
  const summaryLength = summary.length;
  return {
    summary,
    technique,
    originalLength: original,
    summaryLength,
    ratio: ratioFor(original, summaryLength),
    ...(keyPoints && keyPoints.length > 0 ? { keyPoints } : {}),
  };
}

/**
 * A zeroed {@link SummarizationStats} snapshot for a freshly-constructed
 * store.
 *
 * @param now - the epoch-millisecond time to stamp as both `createdAt` and
 *   `updatedAt`
 * @returns a {@link SummarizationStats} with all counters at `0`
 */
export function emptySummarizationStats(now: Timestamp): SummarizationStats {
  return {
    results: 0,
    byTechnique: emptyTechniqueCounts(),
    totalOriginalChars: 0,
    totalSummaryChars: 0,
    averageRatio: 0,
    puts: 0,
    gets: 0,
    hits: 0,
    misses: 0,
    deletes: 0,
    clears: 0,
    pruned: 0,
    createdAt: now,
    updatedAt: now,
  };
}