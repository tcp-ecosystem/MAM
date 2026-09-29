/**
 * @fileoverview
 * Core domain types for the Answer synthesis layer of the MAM Intelligence
 * engine.
 *
 * The synthesis layer sits between retrieval and delivery: a retriever has
 * produced a ranked pool of {@link EvidencePart} chunks, and the answer
 * synthesizer must turn those chunks into one coherent, citable, confidence-
 * scored {@link Answer}.  That transformation is the only place in the
 * pipeline where raw evidence becomes prose, so this module's vocabulary is
 * deliberately small and stable:
 *
 *   - {@link EvidencePart}  — a single retrievable unit of text handed to the
 *     synthesizer.  This is deliberately shaped like the grounding layer's
 *     `EvidenceChunk` so the two layers can share provenance without coupling.
 *   - {@link AnswerRequest} — the input to a synthesis run: a query and the
 *     evidence pool it should be answered from, plus optional per-request
 *     length and style hints.
 *   - {@link SynthesisPart} — one sentence (or sentence fragment) that was
 *     actually used in the final answer, together with the evidence it came
 *     from, its per-sentence score, and its rendered citation.
 *   - {@link Answer}        — the finished product: assembled text, the parts
 *     it was built from, the citation set, a confidence score, and a
 *     `grounded` flag that downstream modules can branch on.
 *   - {@link SynthesisConfig} / {@link SynthesizeOptions} — the shared tuning
 *     knobs and their per-request overrides.
 *   - {@link SynthesisStats} — an aggregate snapshot of synthesis activity.
 *   - {@link SentenceScore}  — the intermediate "show your work" record for a
 *     single candidate sentence.
 *
 * In addition to the types this module exports the canonical defaults
 * ({@link DEFAULT_SYNTHESIS_CONFIG}), hard input limits
 * ({@link SYNTHESIS_LIMITS}), defensive runtime guards (`isEvidencePart`,
 * `isAnswer`, ...), assertion helpers that throw actionable errors,
 * normalizers that fold partial configuration into fully-populated records,
 * and factories for constructing valid values (or sensible empty ones) without
 * hand-rolling the required shape every time.
 *
 * @packageDocumentation
 */

/**
 * The rhetorical length an answer should target.
 *
 * The style is a *target*, not a guarantee: the synthesizer maps each style to
 * a maximum length and a per-evidence sentence budget (see
 * {@link DEFAULT_STYLE_LIMITS}), but the available evidence and the configured
 * {@link SynthesisConfig.maxLength} still govern the final result.  Styles
 * exist so a chat path and a report path can share one synthesizer instance
 * without reconfiguring it.
 */
export type AnswerStyle = 'concise' | 'balanced' | 'detailed';

/**
 * A single retrievable unit of text handed to the synthesizer.
 *
 * Evidence parts are source-agnostic: they may come from a document retriever,
 * a knowledge graph, a code index, or a hand-built corpus.  The only hard
 * requirements are a stable identity and some amount of text.  The optional
 * `source` and `score` fields attach provenance and a retrieval-time relevance
 * estimate without the synthesis layer needing to know anything about the
 * retrieval backend that produced them.
 */
export interface EvidencePart {
  /**
   * Stable, globally unique identifier for this part within the calling
   * system.  Identifiers flow verbatim into citations, so they should be
   * URL-safe and meaningful to downstream consumers (for example
   * `"docs/architecture.md#l42"` or `"kb-000129"`).  If the caller cannot
   * provide one, {@link createEvidencePart} synthesizes a value.
   */
  readonly id: string;

  /**
   * The raw text of the part.  There is no length limit imposed by the
   * synthesis layer itself, but very long parts dilute term-overlap scoring
   * and waste the answer's length budget; callers that chunk large documents
   * should aim for sentence- or paragraph-sized units (roughly 20–150 words).
   */
  readonly text: string;

  /**
   * Optional provenance for the part: a document path, table name, package
   * name, or URL.  It is never used in scoring; it exists so consumers can
   * attribute a sentence back to the document it came from.
   */
  readonly source?: string;

  /**
   * Optional retrieval-time relevance score in the range `[0, 1]`.  The
   * synthesizer blends this with its own query-overlap score when ranking
   * evidence, so a retriever that has real relevance signals can steer the
   * answer; when absent, a neutral default is assumed.
   */
  readonly score?: number;
}

/**
 * One sentence (or sentence fragment) that was selected into a synthesized
 * answer, together with everything needed to attribute it.
 *
 * Parts are the atomic units of an {@link Answer}.  Consumers that render an
 * answer sentence-by-sentence (hover-highlighting, per-sentence citations,
 * a side-by-side "why this answer" panel) should read `parts`; consumers that
 * just want prose should read {@link Answer.text}.
 */
export interface SynthesisPart {
  /**
   * Identifier of the evidence part this sentence was extracted from.  This
   * is the value consumers use to look the raw evidence up again.
   */
  readonly id: string;

  /**
   * The extracted sentence text as it appears (possibly lightly fused) in the
   * final answer.
   */
  readonly text: string;

  /**
   * Optional provenance copied from the source evidence part.
   */
  readonly source?: string;

  /**
   * Optional per-sentence relevance score in `[0, 1]` computed against the
   * query.  This is the sentence-level counterpart to the answer-level
   * confidence.
   */
  readonly score?: number;

  /**
   * Optional rendered citation string for this sentence (for example
   * `"[docs/api.md: kb-7]"` or a markdown link).  When citation rendering is
   * disabled this is omitted and the sentence simply carries its `id`.
   */
  readonly citation?: string;
}

/**
 * A finished, synthesized answer.
 *
 * Answers are immutable by convention: every field is `readonly` and the
 * factories never mutate an existing answer.  The `text` field is the
 * human-facing prose; `parts` is the structured record of how that prose was
 * assembled; `citations` is the de-duplicated citation set; `confidence` is
 * the weighted mean of the evidence scores that actually contributed;
 * `grounded` is the boolean consumers should branch on when deciding whether
 * the answer is safe to surface as fact.
 */
export interface Answer {
  /**
   * The assembled, human-facing prose.  This is what a chat UI would render
   * in the message bubble.  When no evidence clears the bar, this holds a
   * short fallback message and `grounded` is `false`.
   */
  readonly text: string;

  /**
   * The structured parts the answer was built from, in assembly order.  May
   * be empty when synthesis produced no usable sentences.
   */
  readonly parts: readonly SynthesisPart[];

  /**
   * The de-duplicated, in-order citation set for the whole answer.  Each
   * entry is the rendered citation of one contributing evidence part.
   */
  readonly citations: readonly string[];

  /**
   * Answer-level confidence in `[0, 1]`, computed as the weighted mean of the
   * relevance scores of the evidence that actually contributed sentences.
   * Zero when nothing was used.
   */
  readonly confidence: number;

  /**
   * Optional identifier of the synthesis model or strategy that produced this
   * answer (for example `"extractive-fusion-v1"` or an LLM checkpoint name).
   * Purely informational; recorded so consumers can audit which strategy
   * produced which answer.
   */
  readonly model?: string;

  /**
   * Whether the answer cleared the configured minimum score.  This is the
   * flag downstream modules should branch on; `confidence` is the continuous
   * signal.
   */
  readonly grounded: boolean;
}

/**
 * The primary input to the answer synthesizer.
 *
 * A request is a natural-language query plus the evidence pool retrieved for
 * it.  The evidence list is treated as a candidate pool: the synthesizer
 * ranks it, so callers should pass everything the retriever returned and let
 * the synthesizer decide what actually belongs in the answer.
 */
export interface AnswerRequest {
  /**
   * The question the answer should address.  Used for sentence scoring (term
   * overlap) and for evidence ranking.  Must be a non-empty string.
   */
  readonly query: string;

  /**
   * The candidate evidence pool.  May be empty; an empty pool produces an
   * ungrounded fallback answer with confidence `0`.  Must not contain null
   * entries.
   */
  readonly evidence: readonly EvidencePart[];

  /**
   * Optional hard cap on the final answer length in characters.  When absent,
   * the style- and config-derived default applies.
   */
  readonly maxLength?: number;

  /**
   * Optional rhetorical style target (`"concise"`, `"balanced"`, or
   * `"detailed"`).  When absent, the config default applies.
   */
  readonly style?: AnswerStyle;
}

/**
 * Shared tuning knobs for answer synthesis.
 *
 * These defaults apply to every synthesis run unless overridden per request
 * via {@link SynthesizeOptions}.  The canonical defaults live in
 * {@link DEFAULT_SYNTHESIS_CONFIG}; use {@link normalizeSynthesisConfig} to
 * fold a partial config into a complete one.
 */
export interface SynthesisConfig {
  /**
   * Hard cap on answer length in characters.  Must be a positive number in
   * `[MIN, MAX]` (see {@link SYNTHESIS_LIMITS}).  Defaults to `1200`.
   */
  readonly maxLength?: number;

  /**
   * Minimum relevance score (inclusive) an evidence part must reach to be
   * eligible for inclusion.  Must be in `[0, 1]`.  Defaults to `0.35`.
   *
   * Raising this produces tighter, higher-confidence answers at the cost of
   * coverage; lowering it lets weakly-relevant evidence contribute.
   */
  readonly minScore?: number;

  /**
   * When `true`, near-duplicate sentences (sentences that overlap heavily with
   * an already-selected sentence) are dropped during assembly.  Defaults to
   * `true`.
   */
  readonly dedupeSentences?: boolean;

  /**
   * When `true`, rendered citations are attached to parts and the answer.
   * When `false`, parts still carry their `id` but no citation strings are
   * rendered.  Defaults to `true`.
   */
  readonly includeCitations?: boolean;
}

/**
 * An aggregate snapshot of synthesis activity.
 *
 * Produced by `stats()` on the store, the index, and the lifecycle manager.
 * Counters accumulate across all operations since the owning instance was
 * created (or last reset) and are safe to render on a dashboard or write into
 * a telemetry log line.
 */
export interface SynthesisStats {
  /** Total number of synthesis requests (or answers cached/indexed) observed. */
  readonly requests: number;

  /** Number of answers produced (or resident, for the store). */
  readonly answers: number;

  /** Total number of synthesis parts across all answers. */
  readonly parts: number;

  /** Total number of citations attached across all answers. */
  readonly citations: number;

  /** Number of answers whose `grounded` flag is `true`. */
  readonly grounded: number;

  /** Number of answers whose `grounded` flag is `false`. */
  readonly ungrounded: number;

  /** Mean confidence across all answers (zero when none). */
  readonly meanConfidence: number;

  /** Unix epoch milliseconds of the last time these stats were updated. */
  readonly lastUpdated: number;
}

/**
 * Per-request overrides applied on top of the shared {@link SynthesisConfig}.
 *
 * Every field is optional; absent fields inherit the normalized config (and,
 * for the length/sentence-budget fields, the per-style defaults).  Callers
 * that want per-call strictness (for example, a compliance path that demands a
 * far higher bar than the default chat path) should pass `minScore` here
 * rather than mutating the shared config.
 */
export interface SynthesizeOptions {
  /** Overrides {@link SynthesisConfig.maxLength} for this request only. */
  readonly maxLength?: number;

  /** Overrides {@link SynthesisConfig.minScore} for this request only. */
  readonly minScore?: number;

  /** Overrides {@link SynthesisConfig.dedupeSentences} for this request only. */
  readonly dedupeSentences?: boolean;

  /** Overrides {@link SynthesisConfig.includeCitations} for this request only. */
  readonly includeCitations?: boolean;

  /** Overrides {@link AnswerRequest.style} for this request only. */
  readonly style?: AnswerStyle;

  /**
   * Upper bound on how many evidence parts are considered for one answer.
   * Parts are ranked before this cap is applied.  Defaults to `12`; pass
   * `Infinity` to disable the cap.
   */
  readonly maxEvidence?: number;

  /**
   * Upper bound on how many sentences are taken from each contributing
   * evidence part.  Defaults per style (see {@link DEFAULT_STYLE_LIMITS}).
   */
  readonly maxSentencesPerPart?: number;

  /**
   * Similarity threshold in `[0, 1]` above which two sentences are considered
   * duplicates during deduplication.  Defaults to `0.6`.
   */
  readonly dedupeThreshold?: number;

  /**
   * Optional identifier recorded on the produced {@link Answer.model}.
   */
  readonly model?: string;
}

/**
 * The fully-normalized, fully-populated option set produced by
 * {@link mergeSynthesizeOptions}.
 *
 * Everything downstream reads from this shape, so nothing ever has to re-apply
 * `?? ` fallbacks.  It is the intersection of the shared config, the
 * per-request overrides, and the per-style defaults.
 */
export interface EffectiveSynthesisOptions {
  /** Resolved rhetorical style. */
  readonly style: AnswerStyle;

  /** Resolved maximum answer length in characters. */
  readonly maxLength: number;

  /** Resolved minimum evidence score in `[0, 1]`. */
  readonly minScore: number;

  /** Resolved deduplication switch. */
  readonly dedupeSentences: boolean;

  /** Resolved citation rendering switch. */
  readonly includeCitations: boolean;

  /** Resolved maximum number of evidence parts considered. */
  readonly maxEvidence: number;

  /** Resolved maximum sentences taken per contributing evidence part. */
  readonly maxSentencesPerPart: number;

  /** Resolved near-duplicate similarity threshold in `[0, 1]`. */
  readonly dedupeThreshold: number;

  /** Optional model label recorded on the answer. */
  readonly model?: string;
}

/**
 * A single candidate sentence together with its score against the query.
 *
 * This is the "show your work" record of extractive assembly: each entry says
 * which sentence was considered, how well it matched the query, which evidence
 * part it came from, and which query terms it actually covered.  It is the
 * input to deduplication and the raw material for {@link SynthesisPart}s.
 */
export interface SentenceScore {
  /** The candidate sentence text. */
  readonly sentence: string;

  /** Relevance score in `[0, 1]` computed against the query. */
  readonly score: number;

  /** Identifier of the {@link EvidencePart} this sentence came from. */
  readonly evidenceId: string;

  /** Optional provenance of the source evidence part. */
  readonly source?: string;

  /** Query terms (normalized) that this sentence actually contained. */
  readonly terms: readonly string[];
}

/**
 * The canonical default synthesis configuration.
 *
 * These values are deliberately middle-of-the-road:
 *   - `maxLength = 1200` — long enough for a substantive answer, short enough
 *     for a chat bubble.
 *   - `minScore = 0.35`   — evidence with only weak query overlap still has a
 *     chance to contribute, keeping answers inclusive.
 *   - `dedupeSentences = true` — near-duplicate sentences are the most common
 *     failure mode when several evidence parts cover the same ground.
 *   - `includeCitations = true` — attribution is on by default.
 */
export const DEFAULT_SYNTHESIS_CONFIG: Readonly<Required<SynthesisConfig>> = {
  maxLength: 1200,
  minScore: 0.35,
  dedupeSentences: true,
  includeCitations: true,
} as const;

/**
 * Per-style length and sentence-budget defaults.
 *
 * `maxLength` here is the default applied when neither the request nor the
 * config specifies a length; `maxSentencesPerPart` is the default sentence
 * budget applied when the request does not override it.  `concise` answers
 * pull one sentence from a few parts; `detailed` answers spend more of the
 * budget on more parts.
 */
export const DEFAULT_STYLE_LIMITS: Readonly<
  Record<AnswerStyle, { readonly maxLength: number; readonly maxSentencesPerPart: number }>
> = {
  concise: { maxLength: 400, maxSentencesPerPart: 1 },
  balanced: { maxLength: 900, maxSentencesPerPart: 2 },
  detailed: { maxLength: 1600, maxSentencesPerPart: 4 },
} as const;

/**
 * Hard bounds for synthesis inputs.
 *
 * These exist to keep the synthesizer predictable even when fed hostile or
 * degenerate input.  They are enforced by the synthesizer, the store, and the
 * factories.
 */
export const SYNTHESIS_LIMITS = {
  /** Longest query (in characters) the synthesizer will score against. */
  MAX_QUERY_LENGTH: 2000,
  /** Longest evidence part (in characters) the synthesizer will sentence-split. */
  MAX_PART_LENGTH: 20_000,
  /** Maximum number of evidence parts considered before ranking applies. */
  MAX_EVIDENCE_PARTS: 200,
  /** Smallest legal `maxLength`. */
  MIN_MAX_LENGTH: 100,
  /** Largest legal `maxLength`. */
  MAX_MAX_LENGTH: 40_000,
  /** Smallest legal value for any `[0, 1]` threshold or score. */
  MIN_SCORE: 0,
  /** Largest legal value for any `[0, 1]` threshold or score. */
  MAX_SCORE: 1,
} as const;

/**
 * Returns `true` when `value` is a plain object (a non-null object that is
 * not an array).  Internal helper used by every public guard.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns `true` when `obj` has its own enumerable property named `key`.
 * Uses `Object.prototype.hasOwnProperty` defensively so a hostile object with
 * an overridden `hasOwnProperty` cannot break the check.
 */
export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Returns `true` when `value` is a finite number.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns `true` when `value` is a finite number in the closed interval
 * `[min, max]`.
 */
export function isFiniteInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/**
 * Returns `true` when `value` is a string with at least one non-whitespace
 * character.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns `true` when `value` is an array of non-empty strings.
 */
export function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!isNonEmptyString(entry)) return false;
  }
  return true;
}

/**
 * Runtime guard for {@link EvidencePart}.
 *
 * A value is a valid part when it is a record, has a non-empty string `id`,
 * has a string `text`, and any `source` / `score` fields have the right
 * shapes.  Malformed optional fields are treated as invalid rather than
 * silently coerced.
 */
export function isEvidencePart(value: unknown): value is EvidencePart {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.text !== 'string') return false;
  if (hasOwn(value, 'source') && value.source !== undefined && typeof value.source !== 'string') {
    return false;
  }
  if (hasOwn(value, 'score') && value.score !== undefined && !isFiniteInRange(value.score, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link SynthesisPart}.
 */
export function isSynthesisPart(value: unknown): value is SynthesisPart {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.text !== 'string') return false;
  if (hasOwn(value, 'source') && value.source !== undefined && typeof value.source !== 'string') {
    return false;
  }
  if (hasOwn(value, 'score') && value.score !== undefined && !isFiniteInRange(value.score, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  if (hasOwn(value, 'citation') && value.citation !== undefined && typeof value.citation !== 'string') {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link Answer}.
 */
export function isAnswer(value: unknown): value is Answer {
  if (!isRecord(value)) return false;
  if (typeof value.text !== 'string') return false;
  if (!Array.isArray(value.parts)) return false;
  for (const part of value.parts) {
    if (!isSynthesisPart(part)) return false;
  }
  if (!isStringArray(value.citations)) return false;
  if (!isFiniteInRange(value.confidence, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  if (hasOwn(value, 'model') && value.model !== undefined && typeof value.model !== 'string') {
    return false;
  }
  if (typeof value.grounded !== 'boolean') return false;
  return true;
}

/**
 * Runtime guard for {@link AnswerRequest}.
 *
 * The query must be a non-empty string and `evidence` must be an array whose
 * every element passes {@link isEvidencePart}.  An empty evidence array is
 * legal (it yields an ungrounded fallback answer); a malformed element is not.
 */
export function isAnswerRequest(value: unknown): value is AnswerRequest {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.query)) return false;
  if (!Array.isArray(value.evidence)) return false;
  for (const part of value.evidence) {
    if (!isEvidencePart(part)) return false;
  }
  if (hasOwn(value, 'maxLength') && !(isFiniteNumber(value.maxLength) && value.maxLength >= SYNTHESIS_LIMITS.MIN_MAX_LENGTH)) {
    return false;
  }
  if (
    hasOwn(value, 'style') &&
    value.style !== 'concise' &&
    value.style !== 'balanced' &&
    value.style !== 'detailed'
  ) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link SynthesisConfig}.  Every present field is checked;
 * absent fields are allowed (they inherit defaults).
 */
export function isSynthesisConfig(value: unknown): value is SynthesisConfig {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'maxLength') && !(isFiniteNumber(value.maxLength) && value.maxLength >= SYNTHESIS_LIMITS.MIN_MAX_LENGTH)) {
    return false;
  }
  if (hasOwn(value, 'minScore') && !isFiniteInRange(value.minScore, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  if (hasOwn(value, 'dedupeSentences') && typeof value.dedupeSentences !== 'boolean') return false;
  if (hasOwn(value, 'includeCitations') && typeof value.includeCitations !== 'boolean') return false;
  return true;
}

/**
 * Runtime guard for {@link SynthesizeOptions}.
 */
export function isSynthesizeOptions(value: unknown): value is SynthesizeOptions {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'maxLength') && !(isFiniteNumber(value.maxLength) && value.maxLength >= SYNTHESIS_LIMITS.MIN_MAX_LENGTH)) {
    return false;
  }
  if (hasOwn(value, 'minScore') && !isFiniteInRange(value.minScore, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  if (hasOwn(value, 'dedupeSentences') && typeof value.dedupeSentences !== 'boolean') return false;
  if (hasOwn(value, 'includeCitations') && typeof value.includeCitations !== 'boolean') return false;
  if (
    hasOwn(value, 'style') &&
    value.style !== 'concise' &&
    value.style !== 'balanced' &&
    value.style !== 'detailed'
  ) {
    return false;
  }
  if (hasOwn(value, 'maxEvidence') && !(isFiniteNumber(value.maxEvidence) && value.maxEvidence > 0)) return false;
  if (hasOwn(value, 'maxSentencesPerPart') && !(isFiniteNumber(value.maxSentencesPerPart) && value.maxSentencesPerPart > 0)) {
    return false;
  }
  if (hasOwn(value, 'dedupeThreshold') && !isFiniteInRange(value.dedupeThreshold, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    return false;
  }
  if (hasOwn(value, 'model') && value.model !== undefined && typeof value.model !== 'string') return false;
  return true;
}

/**
 * Runtime guard for {@link SentenceScore}.
 */
export function isSentenceScore(value: unknown): value is SentenceScore {
  if (!isRecord(value)) return false;
  if (typeof value.sentence !== 'string') return false;
  if (!isFiniteInRange(value.score, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) return false;
  if (!isNonEmptyString(value.evidenceId)) return false;
  if (hasOwn(value, 'source') && value.source !== undefined && typeof value.source !== 'string') return false;
  if (!isStringArray(value.terms)) return false;
  return true;
}

/**
 * Runtime guard for {@link SynthesisStats}.
 */
export function isSynthesisStats(value: unknown): value is SynthesisStats {
  if (!isRecord(value)) return false;
  if (typeof value.requests !== 'number') return false;
  if (typeof value.answers !== 'number') return false;
  if (typeof value.parts !== 'number') return false;
  if (typeof value.citations !== 'number') return false;
  if (typeof value.grounded !== 'number') return false;
  if (typeof value.ungrounded !== 'number') return false;
  if (!isFiniteNumber(value.meanConfidence)) return false;
  if (typeof value.lastUpdated !== 'number') return false;
  return true;
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link EvidencePart}.
 */
export function assertEvidencePart(value: unknown, message = 'Expected a valid EvidencePart'): asserts value is EvidencePart {
  if (!isEvidencePart(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link SynthesisPart}.
 */
export function assertSynthesisPart(value: unknown, message = 'Expected a valid SynthesisPart'): asserts value is SynthesisPart {
  if (!isSynthesisPart(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link Answer}.
 */
export function assertAnswer(value: unknown, message = 'Expected a valid Answer'): asserts value is Answer {
  if (!isAnswer(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link AnswerRequest}.
 */
export function assertAnswerRequest(value: unknown, message = 'Expected a valid AnswerRequest'): asserts value is AnswerRequest {
  if (!isAnswerRequest(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link SentenceScore}.
 */
export function assertSentenceScore(value: unknown, message = 'Expected a valid SentenceScore'): asserts value is SentenceScore {
  if (!isSentenceScore(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link RangeError} with `message` when `value` is not a finite
 * number inside the closed interval `[min, max]`.
 */
export function assertFiniteInRange(value: unknown, min: number, max: number, message: string): asserts value is number {
  if (!isFiniteInRange(value, min, max)) {
    throw new RangeError(message);
  }
}

/**
 * Folds a partial {@link SynthesisConfig} into a fully-populated,
 * `Required` config.  Missing fields take their values from
 * {@link DEFAULT_SYNTHESIS_CONFIG}.  Invalid present fields throw a
 * {@link RangeError}, so the result is always usable without further checks.
 */
export function normalizeSynthesisConfig(config?: SynthesisConfig): Required<SynthesisConfig> {
  if (config === undefined) {
    return { ...DEFAULT_SYNTHESIS_CONFIG };
  }
  const maxLength = config.maxLength ?? DEFAULT_SYNTHESIS_CONFIG.maxLength;
  if (!isFiniteNumber(maxLength) || maxLength < SYNTHESIS_LIMITS.MIN_MAX_LENGTH || maxLength > SYNTHESIS_LIMITS.MAX_MAX_LENGTH) {
    throw new RangeError(`SynthesisConfig.maxLength must be a finite number in [${SYNTHESIS_LIMITS.MIN_MAX_LENGTH}, ${SYNTHESIS_LIMITS.MAX_MAX_LENGTH}]`);
  }
  const minScore = config.minScore ?? DEFAULT_SYNTHESIS_CONFIG.minScore;
  assertFiniteInRange(minScore, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE, 'SynthesisConfig.minScore must be a finite number in [0, 1]');
  const dedupeSentences = config.dedupeSentences ?? DEFAULT_SYNTHESIS_CONFIG.dedupeSentences;
  if (typeof dedupeSentences !== 'boolean') {
    throw new TypeError('SynthesisConfig.dedupeSentences must be a boolean');
  }
  const includeCitations = config.includeCitations ?? DEFAULT_SYNTHESIS_CONFIG.includeCitations;
  if (typeof includeCitations !== 'boolean') {
    throw new TypeError('SynthesisConfig.includeCitations must be a boolean');
  }
  return { maxLength, minScore, dedupeSentences, includeCitations };
}

/**
 * Folds per-request {@link SynthesizeOptions} on top of a normalized
 * {@link SynthesisConfig} and the per-style defaults, producing a fully
 * populated {@link EffectiveSynthesisOptions}.
 *
 * Resolution order (first match wins): explicit request override, then the
 * shared config, then the per-style default.  Length and sentence budget only
 * fall back to the style default when the request and config both omit them.
 */
export function mergeSynthesizeOptions(
  config: Required<SynthesisConfig>,
  options?: SynthesizeOptions,
): EffectiveSynthesisOptions {
  if (options !== undefined && !isSynthesizeOptions(options)) {
    throw new TypeError('options must be a valid SynthesizeOptions object');
  }

  const style = options?.style ?? 'balanced';
  const styleLimit = DEFAULT_STYLE_LIMITS[style];

  const maxLength =
    options?.maxLength ?? config.maxLength ?? styleLimit.maxLength;
  if (!isFiniteNumber(maxLength) || maxLength < SYNTHESIS_LIMITS.MIN_MAX_LENGTH || maxLength > SYNTHESIS_LIMITS.MAX_MAX_LENGTH) {
    throw new RangeError(`SynthesizeOptions.maxLength must be a finite number in [${SYNTHESIS_LIMITS.MIN_MAX_LENGTH}, ${SYNTHESIS_LIMITS.MAX_MAX_LENGTH}]`);
  }

  const minScore = options?.minScore ?? config.minScore;
  assertFiniteInRange(minScore, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE, 'SynthesizeOptions.minScore must be a finite number in [0, 1]');

  const dedupeSentences = options?.dedupeSentences ?? config.dedupeSentences;
  const includeCitations = options?.includeCitations ?? config.includeCitations;

  const maxEvidence = options?.maxEvidence ?? 12;
  if (!(isFiniteNumber(maxEvidence) && maxEvidence > 0)) {
    throw new RangeError('SynthesizeOptions.maxEvidence must be a positive finite number');
  }

  const maxSentencesPerPart = options?.maxSentencesPerPart ?? styleLimit.maxSentencesPerPart;
  if (!(isFiniteNumber(maxSentencesPerPart) && maxSentencesPerPart > 0)) {
    throw new RangeError('SynthesizeOptions.maxSentencesPerPart must be a positive finite number');
  }

  const dedupeThreshold = options?.dedupeThreshold ?? 0.6;
  assertFiniteInRange(dedupeThreshold, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE, 'SynthesizeOptions.dedupeThreshold must be a finite number in [0, 1]');

  return {
    style,
    maxLength,
    minScore,
    dedupeSentences,
    includeCitations,
    maxEvidence,
    maxSentencesPerPart,
    dedupeThreshold,
    ...(options?.model !== undefined ? { model: options.model } : {}),
  };
}

/**
 * Constructs a fully-valid {@link EvidencePart}.
 *
 * `id` defaults to a synthetic, collision-resistant identifier derived from
 * the text, so callers that do not manage their own identities can still
 * create usable parts.  When `id` is provided it is validated and preserved.
 */
export function createEvidencePart(
  input: {
    text: string;
    id?: string;
    source?: string;
    score?: number;
  },
): EvidencePart {
  if (typeof input.text !== 'string') {
    throw new TypeError('EvidencePart.text must be a string');
  }
  if (input.source !== undefined && typeof input.source !== 'string') {
    throw new TypeError('EvidencePart.source must be a string when provided');
  }
  if (input.score !== undefined && !isFiniteInRange(input.score, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    throw new RangeError('EvidencePart.score must be a finite number in [0, 1]');
  }
  const id = input.id ?? syntheticId(input.text);
  if (!isNonEmptyString(id)) {
    throw new TypeError('EvidencePart.id must be a non-empty string');
  }
  return {
    id,
    text: input.text,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
  } satisfies EvidencePart;
}

/**
 * Constructs a fully-valid {@link SynthesisPart} from its parts, defaulting
 * optional fields to absent.
 */
export function createSynthesisPart(input: {
  id: string;
  text: string;
  source?: string;
  score?: number;
  citation?: string;
}): SynthesisPart {
  if (!isNonEmptyString(input.id)) {
    throw new TypeError('SynthesisPart.id must be a non-empty string');
  }
  if (typeof input.text !== 'string') {
    throw new TypeError('SynthesisPart.text must be a string');
  }
  if (input.source !== undefined && typeof input.source !== 'string') {
    throw new TypeError('SynthesisPart.source must be a string when provided');
  }
  if (input.score !== undefined && !isFiniteInRange(input.score, SYNTHESIS_LIMITS.MIN_SCORE, SYNTHESIS_LIMITS.MAX_SCORE)) {
    throw new RangeError('SynthesisPart.score must be a finite number in [0, 1]');
  }
  if (input.citation !== undefined && typeof input.citation !== 'string') {
    throw new TypeError('SynthesisPart.citation must be a string when provided');
  }
  return {
    id: input.id,
    text: input.text,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.citation !== undefined ? { citation: input.citation } : {}),
  } satisfies SynthesisPart;
}

/**
 * Constructs a fully-valid {@link Answer} from its parts.
 *
 * `confidence` is validated and clamped to `[0, 1]`.  When `grounded` is not
 * provided it is derived by comparing `confidence` against
 * {@link DEFAULT_SYNTHESIS_CONFIG.minScore}.  This is the factory used by
 * {@link AnswerSynthesizer.buildAnswer} and by {@link emptyAnswer}.
 */
export function createAnswer(input: {
  text: string;
  parts?: readonly SynthesisPart[];
  citations?: readonly string[];
  confidence?: number;
  model?: string;
  grounded?: boolean;
}): Answer {
  const confidence = Math.max(
    SYNTHESIS_LIMITS.MIN_SCORE,
    Math.min(SYNTHESIS_LIMITS.MAX_SCORE, input.confidence ?? 0),
  );
  const grounded =
    input.grounded ?? confidence >= DEFAULT_SYNTHESIS_CONFIG.minScore;
  return {
    text: input.text,
    parts: input.parts ?? [],
    citations: input.citations ?? [],
    confidence,
    ...(input.model !== undefined ? { model: input.model } : {}),
    grounded,
  } satisfies Answer;
}

/**
 * Returns a zero-activity {@link Answer}.  Useful as the stable return value
 * for degenerate inputs (an empty evidence pool, a malformed request) so
 * callers never have to branch on emptiness.
 */
export function emptyAnswer(reason = 'No usable evidence was available'): Answer {
  return createAnswer({
    text: reason,
    confidence: 0,
    grounded: false,
  });
}

/**
 * Constructs a fully-populated {@link SynthesisStats} snapshot, defaulting any
 * missing counter to zero and `lastUpdated` to the current time.
 */
export function createSynthesisStats(partial?: Partial<SynthesisStats>): SynthesisStats {
  return {
    requests: partial?.requests ?? 0,
    answers: partial?.answers ?? 0,
    parts: partial?.parts ?? 0,
    citations: partial?.citations ?? 0,
    grounded: partial?.grounded ?? 0,
    ungrounded: partial?.ungrounded ?? 0,
    meanConfidence: partial?.meanConfidence ?? 0,
    lastUpdated: partial?.lastUpdated ?? Date.now(),
  };
}

/**
 * Synthesizes a stable, collision-resistant identifier from text content.
 *
 * Uses FNV-1a over the normalized text together with its length so that two
 * different texts cannot practically collide.  The output is URL-safe and
 * deterministic for identical input, which makes it suitable for
 * content-addressed caching and for synthesizing default evidence ids.
 */
export function syntheticId(text: string): string {
  const normalized = text.normalize('NFKD').toLowerCase().trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `syn-${(hash >>> 0).toString(16)}-${normalized.length.toString(16)}`;
}