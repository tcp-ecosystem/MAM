/**
 * @fileoverview
 * Core domain types for the Knowledge integration layer of the MAM
 * Intelligence engine.
 *
 * The integration layer is where knowledge from many sources becomes one
 * coherent body of facts.  Retrievers, scrapers, embeddings, and hand-written
 * corpora all produce statements about the world, and those statements arrive
 * in the same store with different words, different provenance, and different
 * degrees of confidence.  The integration layer's job is to turn that noisy
 * inflow into a *consolidated* set of entries:
 *
 *   - **Deduplication** — two sources asserting the same fact in slightly
 *     different words collapse to a single entry (the higher-confidence,
 *     higher-information survivor wins).
 *   - **Contradiction detection** — two *highly similar* entries that disagree
 *     (one says "yes", the other "no"; one says "increase", the other
 *     "decrease") are surfaced as a {@link Conflict} so a human or a
 *     downstream policy can resolve them.
 *   - **Merging / canonicalization** — compatible entries that cover the same
 *     ground are fused into one canonical form with unioned metadata and the
 *     maximum confidence of the parts.
 *   - **Confidence-weighted consolidation** — low-confidence entries are
 *     filtered out before consolidation, and confidence always survives a
 *     merge as the strongest signal present.
 *
 * This module owns the vocabulary for all of that.  The types here are the
 * only contract between the store ({@link KnowledgeStore}), the secondary
 * index ({@link KnowledgeIndex}), the consolidator ({@link Consolidator}), and
 * the lifecycle manager ({@link IntegrateLifecycle}):
 *
 *   - {@link KnowledgeEntry}   — one atomic unit of knowledge, its provenance,
 *     its precomputed tokens, its timestamp, and its confidence.
 *   - {@link ConsolidationResult} — the output of one consolidation run.
 *   - {@link Conflict}         — a detected disagreement between entries.
 *   - {@link IntegrateConfig} / {@link IntegrateOptions} / {@link MergeDecision}
 *     — the shared tuning knobs, their per-request overrides, and a preview of
 *     what the consolidator would do with a pair of entries.
 *   - {@link IntegrateStats}   — an aggregate snapshot of integration activity.
 *
 * In addition to the types this module exports the canonical defaults
 * ({@link DEFAULT_INTEGRATE_CONFIG}), hard input limits
 * ({@link INTEGRATE_LIMITS}), defensive runtime guards (`isKnowledgeEntry`,
 * `isConsolidationResult`, ...), assertion helpers that throw actionable
 * errors, normalizers that fold partial configuration into fully-populated
 * records, and factories for constructing valid values without hand-rolling
 * the required shape every time.
 *
 * @packageDocumentation
 */

/**
 * A single atomic unit of knowledge produced by any source.
 *
 * Entries are immutable by convention: every field is `readonly` and the
 * factories never mutate an existing entry.  The only hard requirements are a
 * stable `id` and some `content` text; `source`, `tokens`, `confidence`, and
 * `metadata` attach provenance and scoring signals that the consolidator and
 * the index consume when they are present.
 */
export interface KnowledgeEntry {
  /**
   * Stable, globally unique identifier for this entry within the calling
   * system.  Identifiers flow verbatim into merge records and conflict
   * reports, so they should be meaningful to downstream consumers (for
   * example `"kb-000129"` or `"docs/architecture.md#l42"`).  When a caller
   * cannot provide one, {@link createKnowledgeEntry} synthesizes a value from
   * the content.
   */
  readonly id: string;

  /**
   * The knowledge this entry carries, as raw text.  There is no length limit
   * imposed by the integration layer itself, but very long entries dilute
   * token-level similarity scoring; callers that chunk documents should aim
   * for sentence- or fact-sized units.
   */
  readonly content: string;

  /**
   * Optional provenance for the entry: a document path, table name, package
   * name, or URL.  Never used in scoring; it exists so consumers can
   * attribute a fact back to the source that asserted it.
   */
  readonly source?: string;

  /**
   * Optional precomputed, normalized tokens for `content`.  When present the
   * similarity scorer and the index use these directly, which both speeds up
   * consolidation and lets a caller that already has a tokenizer control the
   * exact vocabulary.  When absent, tokens are derived from `content` with
   * the integration layer's own tokenizer.
   */
  readonly tokens?: readonly string[];

  /**
   * Unix epoch milliseconds at which this entry was created (or first
   * observed).  Required, because merges must know which timestamp to keep
   * and the lifecycle needs a recency signal for garbage collection.
   */
  readonly timestamp: number;

  /**
   * Optional confidence in `[0, 1]` that this entry is true, as estimated by
   * the source.  The consolidator keeps the maximum confidence across a merge
   * and filters below the configured `minConfidence`.  When absent, a neutral
   * default ({@link DEFAULT_CONFIDENCE}) is assumed for scoring.
   */
  readonly confidence?: number;

  /**
   * Optional free-form key/value metadata attached by the calling layer (for
   * example `{ embeddingModel: "text-embedding-3", chunk: 4 }`).  Values are
   * JSON-safe.  Merges union the metadata, preferring the higher-confidence
   * contributor's value when both entries define the same key.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The output of one consolidation run.
 *
 * A result is deliberately additive: `kept` is what survives, `merged` counts
 * how many compatible entries were fused into canonical forms, `removed`
 * counts how many entries were dropped (near-duplicates, low-confidence
 * entries, or conflicts resolved away when `mergeConflicts` is enabled), and
 * `conflicts` is the audit trail of every detected disagreement.
 */
export interface ConsolidationResult {
  /**
   * The entries that survive consolidation, in descending quality order
   * (confidence first, then information content, then recency).  This is the
   * canonical knowledge set the caller should store.
   */
  readonly kept: readonly KnowledgeEntry[];

  /** Number of entries fused into canonical forms during this run. */
  readonly merged: number;

  /** Number of entries dropped (duplicates, low-confidence, or resolved conflicts). */
  readonly removed: number;

  /**
   * Every disagreement detected during this run.  Each entry records the two
   * (or more) conflicting ids and why they are believed to conflict.
   */
  readonly conflicts: readonly Conflict[];
}

/**
 * A detected disagreement between two or more knowledge entries.
 *
 * Conflicts are the integration layer's most important audit output: they are
 * the places where the knowledge base is not yet self-consistent.  A consumer
 * that surfaces knowledge to users should either resolve the conflict (via
 * `mergeConflicts`, or a human review loop) or present it explicitly rather
 * than silently picking one side.
 */
export interface Conflict {
  /**
   * The ids of the conflicting entries.  Exactly two ids for a pairwise
   * contradiction; kept small so consumers can look the entries up directly.
   */
  readonly entries: readonly string[];

  /**
   * A human-readable, machine-inspectable description of *why* the entries
   * conflict, for example `'opposite polarity terms "increase"/"decrease"'` or
   * `'negated term "supported" in one entry but asserted in the other'`.
   */
  readonly reason: string;

  /**
   * Optional token-level similarity between the conflicting entries in
   * `[0, 1]`.  Recorded so consumers can distinguish "barely related, but
   * contradictory" from "near-verbatim contradiction".
   */
  readonly similarity?: number;
}

/**
 * Shared tuning knobs for knowledge consolidation.
 *
 * These defaults apply to every consolidation run unless overridden per call
 * via {@link IntegrateOptions}.  The canonical defaults live in
 * {@link DEFAULT_INTEGRATE_CONFIG}; use {@link normalizeIntegrateConfig} to
 * fold a partial config into a complete one.
 */
export interface IntegrateConfig {
  /**
   * Token-level similarity in `[0, 1]` at or above which two entries are
   * considered near-duplicates.  Near-duplicates are collapsed by keeping the
   * higher-confidence / higher-information entry.  Defaults to `0.75`.
   */
  readonly dedupeThreshold?: number;

  /**
   * When `true`, detected contradictions are resolved by keeping the
   * higher-confidence entry (the loser counts as removed, and the conflict is
   * still recorded for the audit trail).  When `false` (the default) both
   * entries survive and the conflict is surfaced in `conflicts` for a human
   * or policy to resolve.
   */
  readonly mergeConflicts?: boolean;

  /**
   * Hard upper bound on how many entries a consolidation result may keep.
   * Kept sets beyond this are truncated (lowest-quality first), and the
   * dropped entries count as removed.  Defaults to `10_000`.
   */
  readonly maxEntries?: number;

  /**
   * Minimum effective confidence (inclusive) an entry needs to participate in
   * consolidation.  Entries below the bar are dropped immediately.  Defaults
   * to `0`, which admits everything.
   */
  readonly minConfidence?: number;
}

/**
 * Per-request overrides applied on top of the shared {@link IntegrateConfig}.
 *
 * Every field is optional; absent fields inherit the normalized config.  In
 * addition to the four config knobs, options carry two finer-grained
 * thresholds that the config deliberately keeps out of scope (`mergeThreshold`
 * and `conflictMinSimilarity`) plus a pre-consolidation input cap
 * (`maxInput`).
 */
export interface IntegrateOptions {
  /** Overrides {@link IntegrateConfig.dedupeThreshold} for this run only. */
  readonly dedupeThreshold?: number;

  /** Overrides {@link IntegrateConfig.mergeConflicts} for this run only. */
  readonly mergeConflicts?: boolean;

  /** Overrides {@link IntegrateConfig.maxEntries} for this run only. */
  readonly maxEntries?: number;

  /** Overrides {@link IntegrateConfig.minConfidence} for this run only. */
  readonly minConfidence?: number;

  /**
   * Token-level similarity in `[0, 1]` at or above which two compatible (not
   * contradictory) entries are merged into a canonical form.  Must be at or
   * below `dedupeThreshold`.  Defaults to {@link DEFAULT_MERGE_THRESHOLD}
   * (`0.45`).
   */
  readonly mergeThreshold?: number;

  /**
   * Token-level similarity in `[0, 1]` at or above which a pair of entries is
   * *checked* for contradiction.  Defaults to
   * {@link DEFAULT_CONFLICT_MIN_SIMILARITY} (`0.5`).
   */
  readonly conflictMinSimilarity?: number;

  /**
   * Upper bound on how many input entries are considered in one run.  Input
   * beyond the cap is dropped (and counts as removed) *before* any similarity
   * work happens, which keeps adversarial or degenerate batches cheap.
   * Defaults to `Infinity` (no cap).
   */
  readonly maxInput?: number;
}

/**
 * The fully-normalized, fully-populated option set produced by
 * {@link mergeIntegrateOptions}.
 *
 * Everything downstream reads from this shape, so nothing ever has to re-apply
 * `??` fallbacks.
 */
export interface EffectiveIntegrateOptions {
  /** Resolved near-duplicate threshold in `[0, 1]`. */
  readonly dedupeThreshold: number;

  /** Resolved contradiction-resolution switch. */
  readonly mergeConflicts: boolean;

  /** Resolved maximum number of kept entries. */
  readonly maxEntries: number;

  /** Resolved minimum effective confidence in `[0, 1]`. */
  readonly minConfidence: number;

  /** Resolved canonical-merge threshold in `[0, 1]`. */
  readonly mergeThreshold: number;

  /** Resolved contradiction-check threshold in `[0, 1]`. */
  readonly conflictMinSimilarity: number;

  /** Resolved maximum number of input entries considered. */
  readonly maxInput: number;
}

/**
 * An aggregate snapshot of integration activity.
 *
 * Produced by `stats()` on the store, the index, and the lifecycle manager.
 * Counters accumulate across all operations since the owning instance was
 * created (or last reset) and are safe to render on a dashboard or write into
 * a telemetry log line.
 */
export interface IntegrateStats {
  /** Number of entries currently resident in the store or index. */
  readonly entries: number;

  /** Number of distinct source labels currently represented. */
  readonly sources: number;

  /** Total number of merges performed (cumulative for the instance). */
  readonly merged: number;

  /** Total number of removals (cumulative for the instance). */
  readonly removed: number;

  /** Total number of conflicts detected (cumulative for the instance). */
  readonly conflicts: number;

  /** Mean effective confidence across resident entries (zero when none). */
  readonly meanConfidence: number;

  /** Total number of tokens across resident entries. */
  readonly totalTokens: number;

  /** Unix epoch milliseconds of the last time these stats were updated. */
  readonly lastUpdated: number;
}

/**
 * The kind of action the consolidator would take (or took) for a pair of
 * entries.  `keep` means no action; the other three kinds each explain what
 * happens to the lower-quality member of the pair.
 */
export type MergeDecisionKind = 'keep' | 'merge' | 'dedupe' | 'conflict';

/**
 * A preview (or a record) of what the consolidator decided about a pair of
 * entries.
 *
 * Produced by {@link Consolidator.decide} for consumers that want to inspect
 * the pairwise logic without mutating anything, and re-used internally to
 * record decisions during a consolidation run.
 */
export interface MergeDecision {
  /** What the consolidator does with this pair. */
  readonly kind: MergeDecisionKind;

  /**
   * The id of the entry that survives (the higher-confidence /
   * higher-information member).  For `kind === 'keep'` this is simply the
   * higher-quality member for reference.
   */
  readonly primary: string;

  /**
   * The id of the other member: the entry that gets merged, deduped away, or
   * flagged as a conflict.  Absent for `keep`.
   */
  readonly secondary?: string;

  /** Token-level similarity between the pair in `[0, 1]`, when computed. */
  readonly similarity?: number;

  /** A short human-readable explanation of the decision. */
  readonly reason: string;
}

/**
 * The canonical default integration configuration.
 *
 * These values are deliberately middle-of-the-road:
 *   - `dedupeThreshold = 0.75` — near-duplicates must overlap heavily before
 *     they collapse, so distinct-but-similar facts survive.
 *   - `mergeConflicts = false` — contradictions are surfaced, never silently
 *     resolved; a knowledge base should not decide which side of a
 *     contradiction is true on its own.
 *   - `maxEntries = 10_000` — a generous ceiling that still bounds memory.
 *   - `minConfidence = 0` — everything is admitted by default; confidence
 *     filtering is opt-in per call.
 */
export const DEFAULT_INTEGRATE_CONFIG: Readonly<Required<IntegrateConfig>> = {
  dedupeThreshold: 0.75,
  mergeConflicts: false,
  maxEntries: 10_000,
  minConfidence: 0,
} as const;

/**
 * The neutral confidence assumed for an entry that does not carry one.
 * Absence of a signal is not treated as doubt: it is treated as "unknown",
 * which scores higher than a confident `0`.
 */
export const DEFAULT_CONFIDENCE = 0.5;

/**
 * The default canonical-merge threshold: entries with at least this much
 * token overlap and no contradiction are fused into a canonical form.
 * Deliberately lower than the dedupe threshold so genuinely additive coverage
 * of the same topic still merges.
 */
export const DEFAULT_MERGE_THRESHOLD = 0.45;

/**
 * The default minimum similarity at which a pair of entries is checked for
 * contradiction.  Below this they do not share enough vocabulary for polarity
 * checks to be meaningful.
 */
export const DEFAULT_CONFLICT_MIN_SIMILARITY = 0.5;

/**
 * Hard bounds for integration inputs.
 *
 * These exist to keep the store, index, and consolidator predictable even when
 * fed hostile or degenerate input.  They are enforced by the store, the index,
 * and the factories.
 */
export const INTEGRATE_LIMITS = {
  /** Longest entry content (in characters) the integration layer will index. */
  MAX_CONTENT_LENGTH: 50_000,
  /** Maximum number of metadata keys on a single entry. */
  MAX_METADATA_KEYS: 256,
  /** Maximum number of tokens the tokenizer will emit for one entry. */
  MAX_TOKENS: 10_000,
  /** Smallest legal value for any `[0, 1]` threshold or confidence. */
  MIN_SCORE: 0,
  /** Largest legal value for any `[0, 1]` threshold or confidence. */
  MAX_SCORE: 1,
  /** Smallest legal `maxEntries`. */
  MIN_MAX_ENTRIES: 1,
  /** Largest legal `maxEntries`. */
  MAX_MAX_ENTRIES: 1_000_000,
  /** Smallest legal `maxInput`. */
  MIN_MAX_INPUT: 1,
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
 * Returns `true` when `value` is a JSON-safe plain record.
 *
 * Every value must be one of `null`, boolean, finite number, string, array of
 * JSON-safe values, or a nested JSON-safe record.  This keeps the metadata
 * round-trip safe through `JSON.stringify`/`JSON.parse` and a database column.
 */
export function isJsonSafe(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return true;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isJsonSafe(entry)) return false;
    }
    return true;
  }
  if (isRecord(value)) return isMetadata(value);
  return false;
}

/**
 * Returns `true` when `value` is a JSON-safe plain record suitable for
 * {@link KnowledgeEntry.metadata}.  Also enforces the
 * {@link INTEGRATE_LIMITS.MAX_METADATA_KEYS} bound so a hostile entry cannot
 * carry an unbounded metadata object.
 */
export function isMetadata(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) return false;
  if (Object.keys(value).length > INTEGRATE_LIMITS.MAX_METADATA_KEYS) return false;
  for (const key of Object.keys(value)) {
    if (!isJsonSafe(value[key])) return false;
  }
  return true;
}

/**
 * Runtime guard for {@link KnowledgeEntry}.
 *
 * A value is a valid entry when it is a record with a non-empty string `id`,
 * a string `content`, a finite numeric `timestamp`, and well-shaped optional
 * fields.  Malformed optional fields are treated as invalid rather than
 * silently coerced.
 */
export function isKnowledgeEntry(value: unknown): value is KnowledgeEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (typeof value.content !== 'string') return false;
  if (hasOwn(value, 'source') && value.source !== undefined && typeof value.source !== 'string') {
    return false;
  }
  if (hasOwn(value, 'tokens') && value.tokens !== undefined && !isStringArray(value.tokens)) {
    return false;
  }
  if (!isFiniteNumber(value.timestamp)) return false;
  if (
    hasOwn(value, 'confidence') &&
    value.confidence !== undefined &&
    !isFiniteInRange(value.confidence, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (hasOwn(value, 'metadata') && value.metadata !== undefined && !isMetadata(value.metadata)) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link Conflict}.
 */
export function isConflict(value: unknown): value is Conflict {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.entries) || value.entries.length < 2) return false;
  for (const id of value.entries) {
    if (!isNonEmptyString(id)) return false;
  }
  if (!isNonEmptyString(value.reason)) return false;
  if (
    hasOwn(value, 'similarity') &&
    value.similarity !== undefined &&
    !isFiniteInRange(value.similarity, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link ConsolidationResult}.
 */
export function isConsolidationResult(value: unknown): value is ConsolidationResult {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.kept)) return false;
  for (const entry of value.kept) {
    if (!isKnowledgeEntry(entry)) return false;
  }
  if (typeof value.merged !== 'number' || value.merged < 0) return false;
  if (typeof value.removed !== 'number' || value.removed < 0) return false;
  if (!Array.isArray(value.conflicts)) return false;
  for (const conflict of value.conflicts) {
    if (!isConflict(conflict)) return false;
  }
  return true;
}

/**
 * Runtime guard for {@link IntegrateConfig}.  Every present field is checked;
 * absent fields are allowed (they inherit defaults).
 */
export function isIntegrateConfig(value: unknown): value is IntegrateConfig {
  if (!isRecord(value)) return false;
  if (
    hasOwn(value, 'dedupeThreshold') &&
    !isFiniteInRange(value.dedupeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (hasOwn(value, 'mergeConflicts') && typeof value.mergeConflicts !== 'boolean') return false;
  if (
    hasOwn(value, 'maxEntries') &&
    !(isFiniteNumber(value.maxEntries) && value.maxEntries >= INTEGRATE_LIMITS.MIN_MAX_ENTRIES)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'minConfidence') &&
    !isFiniteInRange(value.minConfidence, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link IntegrateOptions}.
 */
export function isIntegrateOptions(value: unknown): value is IntegrateOptions {
  if (!isRecord(value)) return false;
  if (
    hasOwn(value, 'dedupeThreshold') &&
    !isFiniteInRange(value.dedupeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (hasOwn(value, 'mergeConflicts') && typeof value.mergeConflicts !== 'boolean') return false;
  if (
    hasOwn(value, 'maxEntries') &&
    !(isFiniteNumber(value.maxEntries) && value.maxEntries >= INTEGRATE_LIMITS.MIN_MAX_ENTRIES)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'minConfidence') &&
    !isFiniteInRange(value.minConfidence, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'mergeThreshold') &&
    !isFiniteInRange(value.mergeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (
    hasOwn(value, 'conflictMinSimilarity') &&
    !isFiniteInRange(value.conflictMinSimilarity, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (hasOwn(value, 'maxInput') && !(isFiniteNumber(value.maxInput) && value.maxInput >= INTEGRATE_LIMITS.MIN_MAX_INPUT)) {
    return false;
  }
  return true;
}

/**
 * Runtime guard for {@link MergeDecision}.
 */
export function isMergeDecision(value: unknown): value is MergeDecision {
  if (!isRecord(value)) return false;
  if (
    value.kind !== 'keep' &&
    value.kind !== 'merge' &&
    value.kind !== 'dedupe' &&
    value.kind !== 'conflict'
  ) {
    return false;
  }
  if (!isNonEmptyString(value.primary)) return false;
  if (hasOwn(value, 'secondary') && value.secondary !== undefined && !isNonEmptyString(value.secondary)) {
    return false;
  }
  if (
    hasOwn(value, 'similarity') &&
    value.similarity !== undefined &&
    !isFiniteInRange(value.similarity, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE)
  ) {
    return false;
  }
  if (!isNonEmptyString(value.reason)) return false;
  return true;
}

/**
 * Runtime guard for {@link IntegrateStats}.
 */
export function isIntegrateStats(value: unknown): value is IntegrateStats {
  if (!isRecord(value)) return false;
  if (typeof value.entries !== 'number') return false;
  if (typeof value.sources !== 'number') return false;
  if (typeof value.merged !== 'number') return false;
  if (typeof value.removed !== 'number') return false;
  if (typeof value.conflicts !== 'number') return false;
  if (!isFiniteNumber(value.meanConfidence)) return false;
  if (typeof value.totalTokens !== 'number') return false;
  if (typeof value.lastUpdated !== 'number') return false;
  return true;
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link KnowledgeEntry}.
 */
export function assertKnowledgeEntry(value: unknown, message = 'Expected a valid KnowledgeEntry'): asserts value is KnowledgeEntry {
  if (!isKnowledgeEntry(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link ConsolidationResult}.
 */
export function assertConsolidationResult(value: unknown, message = 'Expected a valid ConsolidationResult'): asserts value is ConsolidationResult {
  if (!isConsolidationResult(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link Conflict}.
 */
export function assertConflict(value: unknown, message = 'Expected a valid Conflict'): asserts value is Conflict {
  if (!isConflict(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link IntegrateOptions}.
 */
export function assertIntegrateOptions(value: unknown, message = 'Expected valid IntegrateOptions'): asserts value is IntegrateOptions {
  if (!isIntegrateOptions(value)) {
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
 * Returns the effective confidence of an entry in `[0, 1]`: the entry's own
 * `confidence` when present, otherwise {@link DEFAULT_CONFIDENCE}.  Absence of
 * a confidence signal scores as neutral rather than as doubt.
 */
export function confidenceOf(entry: KnowledgeEntry): number {
  if (entry.confidence !== undefined && Number.isFinite(entry.confidence)) {
    return Math.max(INTEGRATE_LIMITS.MIN_SCORE, Math.min(INTEGRATE_LIMITS.MAX_SCORE, entry.confidence));
  }
  return DEFAULT_CONFIDENCE;
}

/**
 * Clamps `value` into the closed interval `[0, 1]`.  Non-finite input yields
 * the `fallback`.
 */
export function clampScore(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(INTEGRATE_LIMITS.MIN_SCORE, Math.min(INTEGRATE_LIMITS.MAX_SCORE, value));
}

/**
 * Folds a partial {@link IntegrateConfig} into a fully-populated, `Required`
 * config.  Missing fields take their values from
 * {@link DEFAULT_INTEGRATE_CONFIG}.  Invalid present fields throw a
 * {@link RangeError} or {@link TypeError}, so the result is always usable
 * without further checks.
 */
export function normalizeIntegrateConfig(config?: IntegrateConfig): Required<IntegrateConfig> {
  if (config !== undefined && !isIntegrateConfig(config)) {
    throw new TypeError('config must be a valid IntegrateConfig object');
  }
  const dedupeThreshold = config?.dedupeThreshold ?? DEFAULT_INTEGRATE_CONFIG.dedupeThreshold;
  assertFiniteInRange(dedupeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateConfig.dedupeThreshold must be a finite number in [0, 1]');
  const mergeConflicts = config?.mergeConflicts ?? DEFAULT_INTEGRATE_CONFIG.mergeConflicts;
  const maxEntries = config?.maxEntries ?? DEFAULT_INTEGRATE_CONFIG.maxEntries;
  if (!isFiniteNumber(maxEntries) || maxEntries < INTEGRATE_LIMITS.MIN_MAX_ENTRIES || maxEntries > INTEGRATE_LIMITS.MAX_MAX_ENTRIES) {
    throw new RangeError(`IntegrateConfig.maxEntries must be a finite number in [${INTEGRATE_LIMITS.MIN_MAX_ENTRIES}, ${INTEGRATE_LIMITS.MAX_MAX_ENTRIES}]`);
  }
  const minConfidence = config?.minConfidence ?? DEFAULT_INTEGRATE_CONFIG.minConfidence;
  assertFiniteInRange(minConfidence, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateConfig.minConfidence must be a finite number in [0, 1]');
  return { dedupeThreshold, mergeConflicts, maxEntries, minConfidence };
}

/**
 * Folds per-call {@link IntegrateOptions} on top of a normalized
 * {@link IntegrateConfig}, producing a fully-populated
 * {@link EffectiveIntegrateOptions}.
 *
 * Resolution order (first match wins): explicit option, then the shared
 * config, then the module default.  `mergeThreshold` and
 * `conflictMinSimilarity` have no config-level counterpart and fall straight
 * back to their module defaults.
 */
export function mergeIntegrateOptions(
  config: Required<IntegrateConfig>,
  options?: IntegrateOptions,
): EffectiveIntegrateOptions {
  if (options !== undefined && !isIntegrateOptions(options)) {
    throw new TypeError('options must be a valid IntegrateOptions object');
  }

  const dedupeThreshold = options?.dedupeThreshold ?? config.dedupeThreshold;
  assertFiniteInRange(dedupeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateOptions.dedupeThreshold must be a finite number in [0, 1]');
  const mergeThreshold = options?.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD;
  assertFiniteInRange(mergeThreshold, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateOptions.mergeThreshold must be a finite number in [0, 1]');
  if (mergeThreshold > dedupeThreshold) {
    throw new RangeError('IntegrateOptions.mergeThreshold must be at or below dedupeThreshold');
  }
  const conflictMinSimilarity = options?.conflictMinSimilarity ?? DEFAULT_CONFLICT_MIN_SIMILARITY;
  assertFiniteInRange(conflictMinSimilarity, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateOptions.conflictMinSimilarity must be a finite number in [0, 1]');

  const mergeConflicts = options?.mergeConflicts ?? config.mergeConflicts;
  const maxEntries = options?.maxEntries ?? config.maxEntries;
  if (!isFiniteNumber(maxEntries) || maxEntries < INTEGRATE_LIMITS.MIN_MAX_ENTRIES || maxEntries > INTEGRATE_LIMITS.MAX_MAX_ENTRIES) {
    throw new RangeError(`IntegrateOptions.maxEntries must be a finite number in [${INTEGRATE_LIMITS.MIN_MAX_ENTRIES}, ${INTEGRATE_LIMITS.MAX_MAX_ENTRIES}]`);
  }
  const minConfidence = options?.minConfidence ?? config.minConfidence;
  assertFiniteInRange(minConfidence, INTEGRATE_LIMITS.MIN_SCORE, INTEGRATE_LIMITS.MAX_SCORE, 'IntegrateOptions.minConfidence must be a finite number in [0, 1]');
  const maxInput = options?.maxInput ?? Infinity;
  if (!(isFiniteNumber(maxInput) || maxInput === Infinity) || maxInput < INTEGRATE_LIMITS.MIN_MAX_INPUT) {
    throw new RangeError('IntegrateOptions.maxInput must be a finite number >= 1 or Infinity');
  }

  return {
    dedupeThreshold,
    mergeConflicts,
    maxEntries,
    minConfidence,
    mergeThreshold,
    conflictMinSimilarity,
    maxInput,
  };
}

/**
 * Constructs a fully-valid {@link KnowledgeEntry}.
 *
 * `id` defaults to a synthetic, collision-resistant identifier derived from
 * the content, so callers that do not manage their own identities can still
 * create usable entries.  `content` is trimmed, `timestamp` defaults to now,
 * and `confidence` is clamped to `[0, 1]`.  When provided, `tokens` and
 * `metadata` are validated and preserved as-is.
 */
export function createKnowledgeEntry(input: {
  id?: string;
  content: string;
  source?: string;
  tokens?: readonly string[];
  timestamp?: number;
  confidence?: number;
  metadata?: Readonly<Record<string, unknown>>;
}): KnowledgeEntry {
  if (typeof input.content !== 'string' || input.content.trim().length === 0) {
    throw new TypeError('KnowledgeEntry.content must be a non-empty string');
  }
  if (input.source !== undefined && typeof input.source !== 'string') {
    throw new TypeError('KnowledgeEntry.source must be a string when provided');
  }
  if (input.tokens !== undefined && !isStringArray(input.tokens)) {
    throw new TypeError('KnowledgeEntry.tokens must be an array of non-empty strings');
  }
  if (input.tokens !== undefined && input.tokens.length > INTEGRATE_LIMITS.MAX_TOKENS) {
    throw new RangeError(`KnowledgeEntry.tokens exceeds the ${INTEGRATE_LIMITS.MAX_TOKENS} token limit`);
  }
  const timestamp = input.timestamp ?? Date.now();
  if (!isFiniteNumber(timestamp)) {
    throw new TypeError('KnowledgeEntry.timestamp must be a finite number');
  }
  let confidence: number | undefined;
  if (input.confidence !== undefined) {
    confidence = clampScore(input.confidence);
    if (!Number.isFinite(input.confidence)) {
      throw new TypeError('KnowledgeEntry.confidence must be a finite number in [0, 1]');
    }
  }
  if (input.metadata !== undefined && !isMetadata(input.metadata)) {
    throw new TypeError('KnowledgeEntry.metadata must be a JSON-safe plain record');
  }
  const id = input.id ?? syntheticId(input.content);
  if (!isNonEmptyString(id)) {
    throw new TypeError('KnowledgeEntry.id must be a non-empty string');
  }
  return {
    id,
    content: input.content.trim(),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.tokens !== undefined ? { tokens: [...input.tokens] } : {}),
    timestamp,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(input.metadata !== undefined ? { metadata: { ...input.metadata } } : {}),
  } satisfies KnowledgeEntry;
}

/**
 * Constructs a fully-valid {@link Conflict}.  `entries` must contain at least
 * two ids; `similarity`, when provided, is clamped to `[0, 1]`.
 */
export function createConflict(input: {
  entries: readonly string[];
  reason: string;
  similarity?: number;
}): Conflict {
  if (!Array.isArray(input.entries) || input.entries.length < 2) {
    throw new TypeError('Conflict.entries must contain at least two ids');
  }
  for (const id of input.entries) {
    if (!isNonEmptyString(id)) {
      throw new TypeError('Conflict.entries must be non-empty strings');
    }
  }
  if (!isNonEmptyString(input.reason)) {
    throw new TypeError('Conflict.reason must be a non-empty string');
  }
  return {
    entries: [...input.entries],
    reason: input.reason,
    ...(input.similarity !== undefined ? { similarity: clampScore(input.similarity) } : {}),
  } satisfies Conflict;
}

/**
 * Constructs a fully-valid {@link MergeDecision}.
 */
export function createMergeDecision(input: {
  kind: MergeDecisionKind;
  primary: string;
  secondary?: string;
  similarity?: number;
  reason: string;
}): MergeDecision {
  if (!isNonEmptyString(input.primary)) {
    throw new TypeError('MergeDecision.primary must be a non-empty string');
  }
  if (input.secondary !== undefined && !isNonEmptyString(input.secondary)) {
    throw new TypeError('MergeDecision.secondary must be a non-empty string when provided');
  }
  if (!isNonEmptyString(input.reason)) {
    throw new TypeError('MergeDecision.reason must be a non-empty string');
  }
  return {
    kind: input.kind,
    primary: input.primary,
    ...(input.secondary !== undefined ? { secondary: input.secondary } : {}),
    ...(input.similarity !== undefined ? { similarity: clampScore(input.similarity) } : {}),
    reason: input.reason,
  } satisfies MergeDecision;
}

/**
 * Constructs a fully-populated {@link ConsolidationResult}, defaulting any
 * missing counter to zero and `conflicts`/`kept` to empty arrays.
 */
export function createConsolidationResult(partial?: Partial<ConsolidationResult>): ConsolidationResult {
  return {
    kept: partial?.kept ?? [],
    merged: partial?.merged ?? 0,
    removed: partial?.removed ?? 0,
    conflicts: partial?.conflicts ?? [],
  };
}

/**
 * Returns a zero-activity {@link ConsolidationResult}.  Useful as the stable
 * return value for degenerate inputs (an empty entry pool) so callers never
 * have to branch on emptiness.
 */
export function emptyConsolidationResult(): ConsolidationResult {
  return createConsolidationResult();
}

/**
 * Constructs a fully-populated {@link IntegrateStats} snapshot, defaulting any
 * missing counter to zero and `lastUpdated` to the current time.
 */
export function createIntegrateStats(partial?: Partial<IntegrateStats>): IntegrateStats {
  return {
    entries: partial?.entries ?? 0,
    sources: partial?.sources ?? 0,
    merged: partial?.merged ?? 0,
    removed: partial?.removed ?? 0,
    conflicts: partial?.conflicts ?? 0,
    meanConfidence: partial?.meanConfidence ?? 0,
    totalTokens: partial?.totalTokens ?? 0,
    lastUpdated: partial?.lastUpdated ?? Date.now(),
  };
}

/**
 * Synthesizes a stable, collision-resistant identifier from text content.
 *
 * Uses FNV-1a over the normalized content together with its length so that
 * two different contents cannot practically collide.  The output is URL-safe
 * and deterministic for identical input, which makes it suitable for
 * content-addressed storage and for synthesizing default entry ids.
 */
export function syntheticId(text: string): string {
  const normalized = text.normalize('NFKD').toLowerCase().trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `kb-${(hash >>> 0).toString(16)}-${normalized.length.toString(16)}`;
}