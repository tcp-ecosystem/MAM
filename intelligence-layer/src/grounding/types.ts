/**
 * @fileoverview
 * Core domain types for the Grounding layer of the MAM Intelligence engine.
 *
 * The Grounding layer answers a deceptively simple question: given a claim that
 * a downstream module (a report writer, an answer synthesizer, a compliance
 * checker) is about to emit, is that claim actually supported by the evidence
 * we retrieved for it?  A claim that cannot be tied back to evidence is
 * "ungrounded": it may be a hallucination, a stale paraphrase, or an
 * unsupported generalization, and any consumer that relies on it risks
 * propagating incorrect information.
 *
 * This module defines the vocabulary used across the whole layer:
 *
 *   - {@link EvidenceChunk}   — a single retrievable unit of text.
 *   - {@link GroundingRequest} — a claim together with the evidence it should
 *     be judged against.
 *   - {@link GroundedClaim}   — the verdict for a single claim.
 *   - {@link GroundingResult} — a bundle of verdicts plus roll-up statistics.
 *   - {@link GroundingConfig} — tuning knobs shared across scoring runs.
 *   - {@link GroundingStats}  — an aggregate snapshot of grounding activity.
 *   - {@link GroundOptions}   — per-request overrides for a scoring pass.
 *
 * In addition to the types themselves this module exports the shared defaults
 * ({@link DEFAULT_GROUNDING_CONFIG}), a set of defensive runtime guards
 * (`isEvidenceChunk`, `isGroundingResult`, ...), assertion helpers that throw
 * actionable errors, normalizers that fold caller-supplied configuration into
 * fully-populated records, and small factories that let callers construct
 * valid values (or sensible empty ones) without hand-rolling the required
 * shape every time.
 *
 * @packageDocumentation
 */

/**
 * A single unit of text that can be cited as evidence for a claim.
 *
 * Evidence chunks are intentionally source-agnostic: they may come from a
 * document retriever, a knowledge-graph lookup, a code index, or even a
 * hard-coded corpus shipped with the engine.  The only requirements are that a
 * chunk has a stable identity and carries some amount of plain text.  The
 * optional `source` and `score` fields let callers attach provenance and a
 * retrieval-time relevance estimate without the grounding layer needing to
 * know anything about the retrieval backend.
 */
export interface EvidenceChunk {
  /**
   * Stable, globally unique identifier for this chunk within the calling
   * system.  Identifiers are used verbatim as the basis for citations, so
   * they should be URL-safe and meaningful to downstream consumers (for
   * example `"docs/architecture.md#l42"` or `"kb-000129"`).  If the caller
   * cannot provide one, {@link createEvidenceChunk} will synthesize a value.
   */
  readonly id: string;

  /**
   * The raw text of the chunk.  This is the text that the scorer tokenizes
   * and compares against the claim.  There is no length limit imposed by the
   * grounding layer itself, but very large chunks dilute lexical overlap and
   * are therefore less useful; callers that chunk large documents should aim
   * for sentence- or paragraph-sized units (roughly 20–150 words).
   */
  readonly text: string;

  /**
   * Optional provenance for the chunk.  This is a free-form label such as a
   * document path, a database table, a package name, or a URL.  It is never
   * used in scoring; it exists purely so that consumers can attribute a
   * grounded claim back to where its evidence came from.
   */
  readonly source?: string;

  /**
   * Optional retrieval-time relevance score in the range `[0, 1]`.  This is
   * informational only: the grounding scorer never trusts it, but it is
   * preserved on the chunk so that consumers can compare "how relevant did the
   * retriever think this was" against "how well did it actually ground the
   * claim".
   */
  readonly score?: number;
}

/**
 * A single claim together with the evidence it should be judged against.
 *
 * This is the primary input shape for the grounding scorer.  A claim is a
 * natural-language assertion ("The API returns 204 on success") and the
 * evidence list is everything retrieved that might support or contradict it.
 * The grounding layer treats the evidence as a candidate pool; it does not
 * require that all evidence be relevant.
 */
export interface GroundingRequest {
  /**
   * The assertion to evaluate.  Should be a single, focused proposition:
   * short claims score more reliably because the lexical-overlap machinery
   * works best when the claim is a sentence fragment rather than a paragraph.
   */
  readonly claim: string;

  /**
   * The candidate evidence pool.  May be empty; an empty pool yields an
   * unsupported claim with a score of zero and every claim token reported as
   * unmatched.  Must not contain null entries.
   */
  readonly evidence: readonly EvidenceChunk[];
}

/**
 * The grounding verdict for a single claim.
 *
 * Instances are immutable by convention: all fields are `readonly` and the
 * factory functions never mutate an existing verdict.  A `supported` claim is
 * one whose score meets the configured {@link GroundingConfig.minScore};
 * `citations` names the evidence that actually carried the claim, and
 * `unmatchedTerms` names the claim vocabulary that no evidence chunk touched.
 */
export interface GroundedClaim {
  /** The exact claim text that was evaluated. */
  readonly claim: string;

  /**
   * Whether the claim met the configured minimum score.  This is the boolean
   * consumers should branch on; `score` is the continuous confidence signal.
   */
  readonly supported: boolean;

  /**
   * Groundedness score in `[0, 1]` where `1` means every claim token was
   * found in at least one evidence chunk.  The score is a blend of the best
   * per-chunk lexical overlap and the coverage of the claim's vocabulary.
   */
  readonly score: number;

  /**
   * Identifiers (and where configured, source labels) of the evidence chunks
   * whose overlap with the claim met the {@link GroundingConfig.overlapThreshold}.
   * Empty when no chunk reached the threshold.  Formatted according to
   * {@link GroundingConfig.citationFormat}.
   */
  readonly citations: readonly string[];

  /**
   * Claim tokens that appeared in no evidence chunk, in first-occurrence
   * order and with duplicates removed.  A large unmatched list is a strong
   * signal that the claim introduces vocabulary absent from the evidence.
   */
  readonly unmatchedTerms: readonly string[];
}

/**
 * The roll-up of one grounding run over one or more claims.
 *
 * Combines every per-claim verdict with aggregate statistics so that callers
 * can make one decision about an entire answer, report, or document rather
 * than reasoning about individual claims.
 */
export interface GroundingResult {
  /**
   * The per-claim verdicts, in the same order the claims were presented.
   */
  readonly claims: readonly GroundedClaim[];

  /**
   * Mean of the individual claim scores.  Zero when `claims` is empty, in
   * which case {@link GroundingResult.ratio} is also zero.
   */
  readonly overallScore: number;

  /**
   * Number of claims whose `supported` flag is `true`.
   */
  readonly supportedCount: number;

  /**
   * `supportedCount / claims.length`; zero when there are no claims.  This is
   * the headline "how grounded is this output" number.
   */
  readonly ratio: number;

  /**
   * A human-readable one-line summary of the run, suitable for logs, dashboards,
   * or the `summary` line of a groundedness report.
   */
  readonly summary: string;
}

/**
 * Shared tuning knobs for grounding scoring.
 *
 * These defaults apply to every scoring run unless overridden per request via
 * {@link GroundOptions}.  The canonical defaults live in
 * {@link DEFAULT_GROUNDING_CONFIG}; use {@link normalizeGroundingConfig} to
 * fold a partial config into a complete one.
 */
export interface GroundingConfig {
  /**
   * The score threshold (inclusive) at or above which a claim is considered
   * supported.  Must be in `[0, 1]`.  Defaults to `0.55`.
   *
   * Raising this makes the engine stricter (fewer false "supported" verdicts
   * but more ungrounded detections); lowering it makes it more permissive.
   */
  readonly minScore?: number;

  /**
   * The per-chunk overlap threshold (inclusive) at which an evidence chunk
   * earns a citation.  Must be in `[0, 1]`.  Defaults to `0.35`.
   *
   * This can be lower than `minScore`: a chunk that contributes only some of
   * its terms can still be cited even when the overall claim is not
   * supported, which is useful for surfacing "partial evidence".
   */
  readonly overlapThreshold?: number;

  /**
   * How citation strings are rendered.
   *
   *   - `"text"`     — `[id]` or `[source: id]` fragments (default).
   *   - `"json"`     — a JSON array string of `{ id, source }` objects.
   *   - `"markdown"` — markdown link fragments like `[id](source)`.
   */
  readonly citationFormat?: 'text' | 'json' | 'markdown';
}

/**
 * An aggregate snapshot of grounding activity.
 *
 * Produced by `stats()` on the store, the index, and the lifecycle manager.
 * Counters accumulate across all operations since the owning instance was
 * created (or last reset) and are therefore safe to render on a dashboard or
 * write into a telemetry log line.
 */
export interface GroundingStats {
  /** Total number of grounding requests (or results indexed) observed. */
  readonly requests: number;

  /** Number of claims that were marked supported. */
  readonly supported: number;

  /** Number of claims that were marked unsupported. */
  readonly unsupported: number;

  /** Total number of individual claims evaluated across all requests. */
  readonly totalClaims: number;

  /** Total number of citations attached to grounded claims. */
  readonly citations: number;

  /** Total number of unmatched claim terms recorded. */
  readonly unmatchedTerms: number;

  /** Mean score across every evaluated claim (zero when none). */
  readonly meanScore: number;

  /** Unix epoch milliseconds of the last time these stats were updated. */
  readonly lastUpdated: number;
}

/**
 * Per-request overrides applied on top of the shared {@link GroundingConfig}.
 *
 * Every field is optional; absent fields inherit the normalized config.
 * Callers that want per-call strictness (for example, a compliance path that
 * demands a much higher bar than the default chat path) should pass
 * `minScore` here rather than mutating the shared config.
 */
export interface GroundOptions {
  /** Overrides {@link GroundingConfig.minScore} for this request only. */
  readonly minScore?: number;

  /** Overrides {@link GroundingConfig.overlapThreshold} for this request only. */
  readonly overlapThreshold?: number;

  /** Overrides {@link GroundingConfig.citationFormat} for this request only. */
  readonly citationFormat?: 'text' | 'json' | 'markdown';

  /**
   * Tokenizer flavor.  `"simple"` splits on any non-alphanumeric character;
   * `"alphabetic"` additionally requires each token to start with a letter or
   * digit and keeps apostrophes inside words.  Defaults to `"alphabetic"`.
   */
  readonly tokenizer?: 'simple' | 'alphabetic';

  /**
   * When `true`, high-frequency English stop words (the, of, and, ...) are
   * dropped before scoring.  This usually improves the signal for short
   * claims.  Defaults to `true`.
   */
  readonly stripStopwords?: boolean;

  /**
   * When `false`, the scorer skips computing and attaching unmatched claim
   * terms, which is marginally faster for high-throughput batch jobs that
   * only need the score.  Defaults to `true`.
   */
  readonly includeUnmatchedTerms?: boolean;

  /**
   * Upper bound on how many evidence chunks are considered for one claim.
   * Chunks are ranked by their raw overlap before this cap is applied.
   * Defaults to `20`; pass `Infinity` to disable the cap.
   */
  readonly maxEvidence?: number;
}

/**
 * The canonical default grounding configuration.
 *
 * These values are deliberately conservative:
 *   - `minScore = 0.55` — a claim must show real overlap to be supported.
 *   - `overlapThreshold = 0.35` — chunks that contribute partial evidence
 *     still earn a citation, so readers can inspect "weak but present"
 *     support.
 *   - `citationFormat = "text"` — the most portable rendering.
 */
export const DEFAULT_GROUNDING_CONFIG: Readonly<Required<GroundingConfig>> = {
  minScore: 0.55,
  overlapThreshold: 0.35,
  citationFormat: 'text',
} as const;

/**
 * Hard bounds for grounding inputs.
 *
 * These exist to keep the scorer predictable even when fed hostile or
 * degenerate input.  They are enforced by the scorer and the factories.
 */
export const GROUNDING_LIMITS = {
  /** Longest claim (in characters) the scorer will tokenize. */
  MAX_CLAIM_LENGTH: 2000,
  /** Longest evidence chunk (in characters) the scorer will tokenize. */
  MAX_CHUNK_LENGTH: 20_000,
  /** Maximum number of evidence chunks considered per claim. */
  MAX_EVIDENCE_CHUNKS: 50,
  /** Smallest legal value for any `[0,1]` threshold. */
  MIN_THRESHOLD: 0,
  /** Largest legal value for any `[0,1]` threshold. */
  MAX_THRESHOLD: 1,
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
 * Runtime guard for {@link EvidenceChunk}.
 *
 * A value is a valid chunk when it is a record, has a non-empty string `id`,
 * has a string `text`, and any `source` / `score` fields have the right
 * shapes.  Malformed optional fields (for example a numeric `source`) are
 * treated as invalid rather than silently coerced.
 */
export function isEvidenceChunk(value: unknown): value is EvidenceChunk {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.text !== 'string') return false;
  if (hasOwn(value, 'source') && value.source !== undefined && typeof value.source !== 'string') {
    return false;
  }
  if (hasOwn(value, 'score') && value.score !== undefined && !isFiniteNumber(value.score)) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link GroundingRequest}.
 *
 * The claim must be a non-empty string and `evidence` must be an array whose
 * every element passes {@link isEvidenceChunk}.  An empty evidence array is
 * legal (it yields an unsupported verdict); a malformed element is not.
 */
export function isGroundingRequest(value: unknown): value is GroundingRequest {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.claim)) return false;
  if (!Array.isArray(value.evidence)) return false;
  for (const chunk of value.evidence) {
    if (!isEvidenceChunk(chunk)) return false;
  }
  return true;
}

/**
 * Runtime guard for {@link GroundedClaim}.
 */
export function isGroundedClaim(value: unknown): value is GroundedClaim {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.claim)) return false;
  if (typeof value.supported !== 'boolean') return false;
  if (!isFiniteInRange(value.score, GROUNDING_LIMITS.MIN_THRESHOLD, GROUNDING_LIMITS.MAX_THRESHOLD)) {
    return false;
  }
  if (!isStringArray(value.citations)) return false;
  if (!isStringArray(value.unmatchedTerms)) return false;
  return true;
}

/**
 * Runtime guard for {@link GroundingResult}.
 */
export function isGroundingResult(value: unknown): value is GroundingResult {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.claims)) return false;
  for (const claim of value.claims) {
    if (!isGroundedClaim(claim)) return false;
  }
  if (!isFiniteInRange(value.overallScore, GROUNDING_LIMITS.MIN_THRESHOLD, GROUNDING_LIMITS.MAX_THRESHOLD)) {
    return false;
  }
  if (typeof value.supportedCount !== 'number' || !Number.isInteger(value.supportedCount)) {
    return false;
  }
  if (!isFiniteInRange(value.ratio, GROUNDING_LIMITS.MIN_THRESHOLD, GROUNDING_LIMITS.MAX_THRESHOLD)) {
    return false;
  }
  if (typeof value.summary !== 'string') return false;
  return true;
}

/**
 * Runtime guard for {@link GroundingConfig}.  Every present field is checked;
 * absent fields are allowed (they inherit defaults).
 */
export function isGroundingConfig(value: unknown): value is GroundingConfig {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'minScore') && !isFiniteInRange(value.minScore, 0, 1)) return false;
  if (hasOwn(value, 'overlapThreshold') && !isFiniteInRange(value.overlapThreshold, 0, 1)) return false;
  if (
    hasOwn(value, 'citationFormat') &&
    value.citationFormat !== 'text' &&
    value.citationFormat !== 'json' &&
    value.citationFormat !== 'markdown'
  ) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link GroundingStats}.
 */
export function isGroundingStats(value: unknown): value is GroundingStats {
  if (!isRecord(value)) return false;
  if (typeof value.requests !== 'number') return false;
  if (typeof value.supported !== 'number') return false;
  if (typeof value.unsupported !== 'number') return false;
  if (typeof value.totalClaims !== 'number') return false;
  if (typeof value.citations !== 'number') return false;
  if (typeof value.unmatchedTerms !== 'number') return false;
  if (!isFiniteNumber(value.meanScore)) return false;
  if (typeof value.lastUpdated !== 'number') return false;
  return true;
}

/**
 * Runtime guard for {@link GroundOptions}.
 */
export function isGroundOptions(value: unknown): value is GroundOptions {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'minScore') && !isFiniteInRange(value.minScore, 0, 1)) return false;
  if (hasOwn(value, 'overlapThreshold') && !isFiniteInRange(value.overlapThreshold, 0, 1)) return false;
  if (
    hasOwn(value, 'citationFormat') &&
    value.citationFormat !== 'text' &&
    value.citationFormat !== 'json' &&
    value.citationFormat !== 'markdown'
  ) {
    return false;
  }
  if (hasOwn(value, 'tokenizer') && value.tokenizer !== 'simple' && value.tokenizer !== 'alphabetic') {
    return false;
  }
  if (hasOwn(value, 'stripStopwords') && typeof value.stripStopwords !== 'boolean') return false;
  if (hasOwn(value, 'includeUnmatchedTerms') && typeof value.includeUnmatchedTerms !== 'boolean') return false;
  if (hasOwn(value, 'maxEvidence') && !(isFiniteNumber(value.maxEvidence) && value.maxEvidence > 0)) return false;
  return true;
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link EvidenceChunk}.
 */
export function assertEvidenceChunk(value: unknown, message = 'Expected a valid EvidenceChunk'): asserts value is EvidenceChunk {
  if (!isEvidenceChunk(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link GroundingRequest}.
 */
export function assertGroundingRequest(value: unknown, message = 'Expected a valid GroundingRequest'): asserts value is GroundingRequest {
  if (!isGroundingRequest(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link GroundingResult}.
 */
export function assertGroundingResult(value: unknown, message = 'Expected a valid GroundingResult'): asserts value is GroundingResult {
  if (!isGroundingResult(value)) {
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
 * Folds a partial {@link GroundingConfig} into a fully-populated,
 * `Required` config.  Missing fields take their values from
 * {@link DEFAULT_GROUNDING_CONFIG}.  Invalid present fields throw a
 * {@link RangeError}, so the result is always usable without further checks.
 */
export function normalizeGroundingConfig(config?: GroundingConfig): Required<GroundingConfig> {
  if (config === undefined) {
    return { ...DEFAULT_GROUNDING_CONFIG };
  }
  assertFiniteInRange(
    config.minScore ?? DEFAULT_GROUNDING_CONFIG.minScore,
    GROUNDING_LIMITS.MIN_THRESHOLD,
    GROUNDING_LIMITS.MAX_THRESHOLD,
    'GroundingConfig.minScore must be a finite number in [0, 1]',
  );
  assertFiniteInRange(
    config.overlapThreshold ?? DEFAULT_GROUNDING_CONFIG.overlapThreshold,
    GROUNDING_LIMITS.MIN_THRESHOLD,
    GROUNDING_LIMITS.MAX_THRESHOLD,
    'GroundingConfig.overlapThreshold must be a finite number in [0, 1]',
  );
  const citationFormat =
    config.citationFormat ?? DEFAULT_GROUNDING_CONFIG.citationFormat;
  if (citationFormat !== 'text' && citationFormat !== 'json' && citationFormat !== 'markdown') {
    throw new RangeError('GroundingConfig.citationFormat must be "text", "json", or "markdown"');
  }
  return {
    minScore: config.minScore ?? DEFAULT_GROUNDING_CONFIG.minScore,
    overlapThreshold: config.overlapThreshold ?? DEFAULT_GROUNDING_CONFIG.overlapThreshold,
    citationFormat,
  };
}

/**
 * Folds per-request {@link GroundOptions} on top of a normalized
 * {@link GroundingConfig}.  The returned object is fully populated and can be
 * read without any `?? ` fallbacks downstream.
 */
export function mergeGroundOptions(
  config: Required<GroundingConfig>,
  options?: GroundOptions,
): Required<GroundingConfig> & {
  tokenizer: 'simple' | 'alphabetic';
  stripStopwords: boolean;
  includeUnmatchedTerms: boolean;
  maxEvidence: number;
} {
  if (options !== undefined && !isGroundOptions(options)) {
    throw new TypeError('options must be a valid GroundOptions object');
  }
  return {
    minScore: options?.minScore ?? config.minScore,
    overlapThreshold: options?.overlapThreshold ?? config.overlapThreshold,
    citationFormat: options?.citationFormat ?? config.citationFormat,
    tokenizer: options?.tokenizer ?? 'alphabetic',
    stripStopwords: options?.stripStopwords ?? true,
    includeUnmatchedTerms: options?.includeUnmatchedTerms ?? true,
    maxEvidence: options?.maxEvidence ?? 20,
  };
}

/**
 * Constructs a fully-valid {@link EvidenceChunk}.
 *
 * `id` defaults to a synthetic, collision-resistant identifier derived from
 * the text, so callers that do not manage their own identities can still
 * create usable chunks.  When `id` is provided it is validated and preserved.
 */
export function createEvidenceChunk(
  input: {
    text: string;
    id?: string;
    source?: string;
    score?: number;
  },
): EvidenceChunk {
  if (typeof input.text !== 'string') {
    throw new TypeError('EvidenceChunk.text must be a string');
  }
  if (input.source !== undefined && typeof input.source !== 'string') {
    throw new TypeError('EvidenceChunk.source must be a string when provided');
  }
  if (input.score !== undefined && !isFiniteInRange(input.score, 0, 1)) {
    throw new RangeError('EvidenceChunk.score must be a finite number in [0, 1]');
  }
  const id = input.id ?? syntheticId(input.text);
  if (!isNonEmptyString(id)) {
    throw new TypeError('EvidenceChunk.id must be a non-empty string');
  }
  return {
    id,
    text: input.text,
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.score !== undefined ? { score: input.score } : {}),
  } satisfies EvidenceChunk;
}

/**
 * Constructs a {@link GroundedClaim} from its parts, defaulting optional
 * arrays to empty arrays.
 */
export function createGroundedClaim(input: {
  claim: string;
  supported: boolean;
  score: number;
  citations?: readonly string[];
  unmatchedTerms?: readonly string[];
}): GroundedClaim {
  assertFiniteInRange(input.score, 0, 1, 'GroundedClaim.score must be in [0, 1]');
  return {
    claim: input.claim,
    supported: input.supported,
    score: input.score,
    citations: input.citations ?? [],
    unmatchedTerms: input.unmatchedTerms ?? [],
  };
}

/**
 * Constructs a {@link GroundingResult} from an array of {@link GroundedClaim}
 * verdicts, recomputing the roll-up statistics.  This is the factory used by
 * the scorer's `checkMany` and by the lifecycle's `record`.
 */
export function createGroundingResult(claims: readonly GroundedClaim[]): GroundingResult {
  if (claims.length === 0) {
    return emptyGroundingResult('No claims were evaluated');
  }
  let supportedCount = 0;
  let scoreTotal = 0;
  for (const claim of claims) {
    if (claim.supported) supportedCount += 1;
    scoreTotal += claim.score;
  }
  const overallScore = scoreTotal / claims.length;
  const ratio = supportedCount / claims.length;
  const supported = supportedCount > 0 ? `${supportedCount}/${claims.length}` : 'none';
  return {
    claims,
    overallScore,
    supportedCount,
    ratio,
    summary: `Grounded ${supported} claims; mean score ${overallScore.toFixed(3)}; ratio ${ratio.toFixed(3)}`,
  };
}

/**
 * Returns a zero-activity {@link GroundingResult}.  Useful as the stable
 * return value for empty inputs (an empty claim list, or an evidence pool
 * that yields no verdicts) so callers never have to branch on emptiness.
 */
export function emptyGroundingResult(reason = 'No evidence was evaluated'): GroundingResult {
  return {
    claims: [],
    overallScore: 0,
    supportedCount: 0,
    ratio: 0,
    summary: reason,
  };
}

/**
 * Constructs a fully-populated {@link GroundingStats} snapshot, defaulting any
 * missing counter to zero and `lastUpdated` to the current time.
 */
export function createGroundingStats(partial?: Partial<GroundingStats>): GroundingStats {
  return {
    requests: partial?.requests ?? 0,
    supported: partial?.supported ?? 0,
    unsupported: partial?.unsupported ?? 0,
    totalClaims: partial?.totalClaims ?? 0,
    citations: partial?.citations ?? 0,
    unmatchedTerms: partial?.unmatchedTerms ?? 0,
    meanScore: partial?.meanScore ?? 0,
    lastUpdated: partial?.lastUpdated ?? Date.now(),
  };
}

/**
 * Synthesizes a stable, collision-resistant identifier from text content.
 *
 * Uses FNV-1a over the normalized text together with its length so that two
 * different texts cannot practically collide.  The output is URL-safe and
 * deterministic for identical input, which makes it suitable for
 * content-addressed caching.
 */
export function syntheticId(text: string): string {
  const normalized = text.normalize('NFKD').toLowerCase().trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `gnd-${(hash >>> 0).toString(16)}-${normalized.length.toString(16)}`;
}