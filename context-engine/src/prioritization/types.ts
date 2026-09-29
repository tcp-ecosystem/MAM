/**
 * Shared domain types for the **Prioritization** layer of the standalone MAM
 * Context Engine.
 *
 * The Prioritization layer decides *what matters most*. Given a bag of context
 * parts — memories, tool results, knowledge snippets, prior assistant turns,
 * user messages — it assigns each a numeric importance score and orders the
 * parts so the engine can hand the strongest candidates to the next stage
 * (assembly, compression, token budgeting) first.
 *
 * It is responsible for:
 *
 * 1. **Scoring** — {@link PriorityScorer.scorePart} turns one part into a
 *    {@link PriorityScore} by combining four independent signals:
 *
 *    - **Recency** — how fresh the part is. A part that is minutes old is
 *      usually more actionable than one from a month ago, so the score decays
 *      exponentially with age according to {@link PrioritizationConfig
 *      .decayHours}.
 *    - **Relevance** — how well the part's text matches an active query.
 *      Keyword overlap is measured against {@link PrioritizationConfig
 *      .boostKeywords} and against terms extracted from the query itself.
 *    - **Role weight** — how much the *type* of the part counts. A direct
 *      user instruction outranks ambient background knowledge, so each part
 *      role carries a configurable multiplier.
 *    - **Size** — how big the part is. Very large parts cost tokens, so size
 *      exerts a mild dampening pressure; very small parts carry little signal,
 *      so they are dampened too, peaking around a sweet spot.
 *
 * 2. **Selection** — {@link PriorityScorer.topK} picks the best `K` parts;
 *    {@link PriorityScorer.withinBudget} keeps picking the best parts until a
 *    token budget is exhausted. Both operate on ranked {@link PriorityScore}s.
 *
 * 3. **Caching & indexing** — {@link PriorityStore} remembers scores so
 *    re-scoring an unchanged part is skipped, and {@link PriorityIndex} keeps
 *    score-bucket and role indexes so "show me everything scored above 0.8" or
 *    "show me everything that is a user instruction" are answered without a
 *    full scan.
 *
 * 4. **Lifecycle** — {@link PriorityLifecycle} prunes the score cache when it
 *    grows too large, forgets parts that have been dropped from the context,
 *    and drives periodic housekeeping on a timer.
 *
 * The types in this module are the public contract shared by every other file
 * of the subsystem:
 *
 * - {@link PartRole} — the enumerated role of a context part.
 * - {@link ContextPart} — the minimal shape of a part the layer can score.
 * - {@link PriorityScore} — one scored, optionally ranked part.
 * - {@link PrioritizationConfig} — weights and knobs that tune scoring.
 * - {@link PrioritizeOptions} — per-call overrides for a single run.
 * - {@link PriorityEntry} — a scored part paired with its score (what the
 *   integration facade returns to callers).
 * - {@link PrioritizationStats} — aggregate counters describing the layer.
 * - {@link PriorityBucket} — the coarse "how important is this" bands used by
 *   {@link PriorityIndex}.
 * - {@link PriorityState} — a serialisable snapshot of a
 *   {@link PriorityStore}, round-trippable through JSON.
 *
 * Every value is deliberately framework-agnostic and JSON-serialisable, and the
 * module exports the pure helpers the rest of the layer composes
 * ({@link defaultPrioritizationConfig}, {@link mergePrioritizationConfig},
 * {@link scoreBucket}, {@link clampScore}, {@link estimateTokens}, …) so the
 * scoring logic stays deterministic and unit-testable.
 *
 * @packageDocumentation
 * @module prioritization/types
 */

/**
 * Enumerated role of a context part.
 *
 * Roles drive two behaviours in the layer:
 *
 * - {@link PrioritizationConfig.roleWeights} maps each role to a multiplier,
 *   so `'user'` parts (direct instructions) outrank `'ambient'` parts.
 * - The role is indexed by {@link PriorityIndex} so callers can query "all
 *   tool results" cheaply.
 *
 * @remarks
 * The ordering of the union members is *not* semantically meaningful — do not
 * rely on it for ranking. Ranking comes from the configured role weights.
 */
export type PartRole =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'memory'
  | 'knowledge'
  | 'system'
  | 'ambient';

/**
 * Coarse band describing how important a {@link PriorityScore} is, derived from
 * its `score` field.
 *
 * - `'critical'` — at or above {@link DEFAULT_BUCKET_EDGES}[2] (`0.8`).
 * - `'high'` — at or above {@link DEFAULT_BUCKET_EDGES}[1] (`0.6`).
 * - `'medium'` — at or above {@link DEFAULT_BUCKET_EDGES}[0] (`0.3`).
 * - `'low'` — anything below.
 *
 * {@link scoreBucket} derives a bucket from a score; the {@link PriorityIndex}
 * keeps entries bucketed by it so "what is critical right now?" is answerable
 * without scanning every entry.
 */
export type PriorityBucket = 'critical' | 'high' | 'medium' | 'low';

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the prioritization layer use epoch milliseconds so
 * they interoperate cleanly with `Date.now()`, injected clocks and the
 * decay arithmetic in {@link PriorityScorer}.
 */
export type Timestamp = number;

/**
 * The result of scoring a single context part.
 *
 * A {@link PriorityScore} is immutable by convention: consumers treat `score`
 * and `reasons` as read-only. The `rank` field is optional because a score may
 * exist in a {@link PriorityStore} before any ranking pass has assigned it a
 * position — ranking is a *selection-time* concern, not a *scoring-time* one.
 *
 * @example
 * ```ts
 * const score: PriorityScore = {
 *   partId: 'mem:onboarding-notes',
 *   score: 0.83,
 *   reasons: [
 *     'role user weights ×1.5',
 *     'relevance: matched 3 query terms',
 *   ],
 *   rank: 1,
 * };
 * ```
 */
export interface PriorityScore {
  /**
   * Unique identifier of the scored context part.
   *
   * This is the same value as {@link ContextPart.partId}; the duplication is
   * deliberate so a {@link PriorityScore} stands alone without needing the part
   * object it was derived from.
   */
  readonly partId: string;

  /**
   * Normalised importance score in `[0, 1]`.
   *
   * Derived by {@link PriorityScorer.scorePart} from the weighted recency,
   * relevance, role and size signals. Higher is more important. The value is
   * clamped so it can always be compared across parts and across runs.
   */
  readonly score: number;

  /**
   * Human-readable explanations of how the score was built, most significant
   * first. Used for logging, debugging and auditing "why did this part rank
   * first?" without having to re-derive the arithmetic.
   */
  readonly reasons: string[];

  /**
   * 1-based position in the last ranking pass, if one ran.
   *
   * Assigned by {@link PriorityScorer.prioritize} / `topK` / `withinBudget`;
   * left `undefined` for scores that are stored but never ranked.
   */
  readonly rank?: number;

  /**
   * The {@link PartRole} of the scored part, echoed from the source
   * {@link ContextPart} so the {@link PriorityIndex} can answer per-role
   * queries without re-joining scores to parts.
   *
   * Optional for callers that construct scores by hand; the scorer and the
   * integration facades always populate it.
   */
  readonly role?: PartRole;
}

/**
 * A minimal context part that the Prioritization layer can score.
 *
 * The layer deliberately depends on a *structural* shape rather than a concrete
 * class, so any object with `partId`, `content`, `role` and `createdAt` can be
 * prioritised — including the richer part objects produced by the other layers
 * of the MAM Context Engine (assembly, memory, knowledge). Extra fields are
 * allowed and ignored by the scoring arithmetic.
 *
 * @remarks
 * `createdAt` drives the recency signal. If it is missing or `0`, the part is
 * treated as maximally old (recency weight contributes nothing) rather than
 * crashing the scorer.
 */
export interface ContextPart {
  /**
   * Unique identifier of the part, stable across scoring runs so
   * {@link PriorityStore} can cache the score keyed by it.
   */
  readonly partId: string;

  /**
   * The textual payload of the part. Scored against queries and keywords;
   * its length feeds the size signal.
   */
  readonly content: string;

  /**
   * The role of the part, used to look up its weight in
   * {@link PrioritizationConfig.roleWeights}.
   */
  readonly role: PartRole;

  /**
   * Epoch-millisecond creation timestamp. `0` or `undefined` means "age
   * unknown" (treated as maximally old).
   */
  readonly createdAt?: Timestamp;
}

/**
 * Tuning knobs that shape every score the layer produces.
 *
 * The four weights are *relative* to each other, not absolute: only the ratios
 * matter. The defaults in {@link defaultPrioritizationConfig} favour recency
 * and relevance, temper role bias, and apply gentle size dampening, which is a
 * sensible generic baseline for chat-style context.
 *
 * Every field is optional and individually overrideable at run time via
 * {@link PrioritizeOptions.overrides} or wholesale via
 * {@link mergePrioritizationConfig}.
 */
export interface PrioritizationConfig {
  /**
   * Weight of the recency signal. Default {@link DEFAULT_RECENCY_WEIGHT}.
   *
   * Controls how steeply the recency term grows with freshness. Combined with
   * {@link PrioritizationConfig.decayHours} it defines the exponential decay
   * curve `recency = exp(-ageHours / decayHours)`.
   */
  readonly recencyWeight?: number;

  /**
   * Weight of the keyword-relevance signal. Default
   * {@link DEFAULT_RELEVANCE_WEIGHT}.
   *
   * The relevance term is the fraction of query / boost-keyword terms that
   * appear in the part's content, so `1` means "matched every keyword".
   */
  readonly relevanceWeight?: number;

  /**
   * Weight of the role signal. Default {@link DEFAULT_ROLE_WEIGHT}.
   *
   * The role term is the configured weight of {@link ContextPart.role}
   * normalised against the maximum configured role weight, so it always lands
   * in `(0, 1]`.
   */
  readonly roleWeight?: number;

  /**
   * Weight of the size signal. Default {@link DEFAULT_SIZE_WEIGHT}.
   *
   * The size term peaks at {@link DEFAULT_IDEAL_TOKENS} tokens and trails off
   * on both sides: tiny parts carry little signal, huge parts cost too many
   * tokens.
   */
  readonly sizeWeight?: number;

  /**
   * Keywords that always count toward relevance, regardless of the query.
   *
   * Useful for domain terms ("deadline", "customer", "contract") that should
   * make a part stand out even when the current query is unrelated. Matched as
   * lowercase substrings. Optional — when omitted, only query terms matter.
   */
  readonly boostKeywords?: readonly string[];

  /**
   * Characteristic decay half-scale for the recency curve, in hours.
   * Default {@link DEFAULT_DECAY_HOURS}.
   *
   * After `decayHours` hours a part retains `e^-1 ≈ 0.368` of its maximum
   * recency; after `2 × decayHours` it retains `e^-2 ≈ 0.135`. Smaller values
   * make the engine more myopic; larger values let older parts stay relevant.
   */
  readonly decayHours?: number;

  /**
   * Per-role score multipliers. Defaults in
   * {@link defaultPrioritizationConfig.roleWeights}.
   *
   * `'user'` parts outrank `'assistant'` parts, which outrank background
   * `'ambient'` parts. Roles absent from the map get the {@link DEFAULT_ROLE}
   * fallback weight.
   */
  readonly roleWeights?: Readonly<Partial<Record<PartRole, number>>>;
}

/**
 * Per-call options for a single scoring / selection operation.
 *
 * Everything is optional. Passing nothing uses the merged defaults
 * ({@link defaultPrioritizationConfig}); passing {@link PrioritizeOptions
 * .overrides} shallow-merges on top; {@link PrioritizeOptions.query} adds
 * query terms to the relevance signal for this run only.
 */
export interface PrioritizeOptions {
  /**
   * The active query to score parts against. Terms are extracted by
   * {@link extractQueryTerms}; parts matching more of them score higher.
   * Optional — when omitted, relevance comes purely from
   * {@link PrioritizationConfig.boostKeywords}.
   */
  readonly query?: string;

  /**
   * Field-level overrides of the base {@link PrioritizationConfig}. Merged
   * over the defaults (or the config passed to the scorer) for this call only.
   */
  readonly overrides?: Partial<PrioritizationConfig>;

  /**
   * Extra boost keywords for this call only, merged with
   * {@link PrioritizationConfig.boostKeywords}.
   */
  readonly keywords?: readonly string[];

  /**
   * Clock used for recency. Defaults to `Date.now`. Injecting a clock makes
   * recency deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * A scored context part, as returned by the high-level integration facades.
 *
 * This is the pairing of the *part itself* with its {@link PriorityScore} —
 * what {@link Prioritizer.run} / `best` / `fitBudget` hand back so callers
 * never have to re-join scores with parts.
 */
export interface PriorityEntry {
  /**
   * The scored context part.
   */
  readonly part: ContextPart;

  /**
   * The score derived for the part.
   */
  readonly score: PriorityScore;
}

/**
 * Aggregate counters describing the health and shape of the Prioritization
 * layer, produced by {@link PriorityStore.stats} and the {@link Prioritizer}
 * facade.
 */
export interface PrioritizationStats {
  /**
   * Number of scored parts currently cached in the store.
   */
  readonly cached: number;

  /**
   * Number of score-buckets currently occupied in the index.
   */
  readonly buckets: number;

  /**
   * Number of distinct roles currently occupied in the index.
   */
  readonly roles: number;

  /**
   * Mean score of the cached scores, or `0` when empty.
   */
  readonly meanScore: number;

  /**
   * Highest cached score, or `0` when empty.
   */
  readonly maxScore: number;

  /**
   * Lowest cached score, or `0` when empty.
   */
  readonly minScore: number;

  /**
   * Total number of scoring operations this store has performed since it was
   * created or last {@link PriorityStore.clear}ed.
   */
  readonly totalScored: number;

  /**
   * Total number of parts evicted by eviction / pruning.
   */
  readonly totalEvicted: number;

  /**
   * Mean age (ms) of the cached parts, or `0` when empty.
   */
  readonly meanAgeMs: number;
}

/**
 * Shape of the {@link PriorityIndex.stats} report.
 */
export interface PriorityIndexStats {
  /**
   * Total number of entries indexed.
   */
  readonly size: number;

  /**
   * Number of entries in each score {@link PriorityBucket}.
   */
  readonly byBucket: Readonly<Record<PriorityBucket, number>>;

  /**
   * Number of entries in each {@link PartRole}.
   */
  readonly byRole: Readonly<Partial<Record<PartRole, number>>>;

  /**
   * Highest score indexed, or `0` when empty.
   */
  readonly maxScore: number;

  /**
   * Mean score indexed, or `0` when empty.
   */
  readonly meanScore: number;
}

/**
 * Serialisable snapshot of a {@link PriorityStore}.
 *
 * Round-trips through {@link PriorityStore.toJSON} /
 * {@link PriorityStore.fromJSON} so the score cache can be persisted and
 * restored without re-scoring every part.
 */
export interface PriorityState {
  /**
   * Version marker for the serialised shape. Bump when the schema changes.
   */
  readonly version: 1;

  /**
   * The cached scores, keyed by {@link PriorityScore.partId}.
   */
  readonly scores: Readonly<Record<string, PriorityScore>>;

  /**
   * Epoch-millisecond time the snapshot was taken.
   */
  readonly savedAt: Timestamp;
}

/**
 * Default decay half-scale in hours ({@link PrioritizationConfig.decayHours}).
 */
export const DEFAULT_DECAY_HOURS = 24;

/**
 * Default recency weight ({@link PrioritizationConfig.recencyWeight}).
 */
export const DEFAULT_RECENCY_WEIGHT = 0.35;

/**
 * Default relevance weight ({@link PrioritizationConfig.relevanceWeight}).
 */
export const DEFAULT_RELEVANCE_WEIGHT = 0.3;

/**
 * Default role weight ({@link PrioritizationConfig.roleWeight}).
 */
export const DEFAULT_ROLE_WEIGHT = 0.2;

/**
 * Default size weight ({@link PrioritizationConfig.sizeWeight}).
 */
export const DEFAULT_SIZE_WEIGHT = 0.15;

/**
 * Default role multiplier used for roles absent from
 * {@link PrioritizationConfig.roleWeights}.
 */
export const DEFAULT_ROLE = 0.5;

/**
 * Built-in default per-role multipliers.
 *
 * - `'user'` — direct instruction, highest priority.
 * - `'assistant'` — prior assistant turns, still relevant.
 * - `'tool'` — fresh tool output, often factual and actionable.
 * - `'memory'` — long-term facts, contextually useful.
 * - `'knowledge'` — knowledge snippets, helpful background.
 * - `'system'` — system prompts, always in play.
 * - `'ambient'` — background noise, lowest priority.
 */
export const DEFAULT_ROLE_WEIGHTS: Readonly<Record<PartRole, number>> = {
  user: 1.0,
  assistant: 0.8,
  tool: 0.7,
  memory: 0.6,
  knowledge: 0.55,
  system: 0.5,
  ambient: 0.3,
};

/**
 * Approximate tokens-per-character ratio used by {@link estimateTokens}.
 *
 * English-ish text averages roughly four characters per token. This constant
 * keeps size arithmetic cheap and deterministic.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Token count the size signal treats as "ideal" ({@link estimateTokens}).
 *
 * Parts whose estimated size lands near this value receive the maximum size
 * term; smaller and larger parts are dampened on either side.
 */
export const DEFAULT_IDEAL_TOKENS = 256;

/**
 * Boundaries between the {@link PriorityBucket} bands, in ascending score
 * order. Defaults to `[0.3, 0.6, 0.8]`.
 */
export const DEFAULT_BUCKET_EDGES: readonly number[] = [0.3, 0.6, 0.8];

/**
 * Default maximum number of entries a {@link PriorityStore} retains before the
 * lowest-scoring entries are evicted.
 */
export const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Build the default {@link PrioritizationConfig}.
 *
 * The defaults sum the four weights to exactly `1.0` so the combined score is
 * naturally bounded in `[0, 1]`. Recency and relevance dominate; role bias is
 * tempered; size exerts gentle dampening.
 *
 * @returns a fresh, immutable-by-convention default config
 */
export function defaultPrioritizationConfig(): PrioritizationConfig {
  return {
    recencyWeight: DEFAULT_RECENCY_WEIGHT,
    relevanceWeight: DEFAULT_RELEVANCE_WEIGHT,
    roleWeight: DEFAULT_ROLE_WEIGHT,
    sizeWeight: DEFAULT_SIZE_WEIGHT,
    decayHours: DEFAULT_DECAY_HOURS,
    roleWeights: { ...DEFAULT_ROLE_WEIGHTS },
  };
}

/**
 * Merge two {@link PrioritizationConfig}s, `base` first, `override` winning on
 * every field it specifies.
 *
 * `roleWeights` are merged per-role rather than replaced wholesale, so a caller
 * who only wants to change the `'user'` weight keeps the other role defaults.
 *
 * @param base - the config being overridden (defaults if omitted)
 * @param override - the config whose present fields win
 * @returns a new config object; the inputs are never mutated
 */
export function mergePrioritizationConfig(
  base: PrioritizationConfig = defaultPrioritizationConfig(),
  override: PrioritizationConfig = {},
): PrioritizationConfig {
  return {
    recencyWeight:
      override.recencyWeight ?? base.recencyWeight ?? DEFAULT_RECENCY_WEIGHT,
    relevanceWeight:
      override.relevanceWeight ??
      base.relevanceWeight ??
      DEFAULT_RELEVANCE_WEIGHT,
    roleWeight: override.roleWeight ?? base.roleWeight ?? DEFAULT_ROLE_WEIGHT,
    sizeWeight: override.sizeWeight ?? base.sizeWeight ?? DEFAULT_SIZE_WEIGHT,
    decayHours: override.decayHours ?? base.decayHours ?? DEFAULT_DECAY_HOURS,
    roleWeights: {
      ...(base.roleWeights ?? DEFAULT_ROLE_WEIGHTS),
      ...(override.roleWeights ?? {}),
    },
  };
}

/**
 * Resolve a per-call {@link PrioritizeOptions} into a concrete
 * {@link PrioritizationConfig} by applying `options.overrides` on top of the
 * given base config.
 *
 * @param base - the resolved config to build on
 * @param options - per-call options whose `overrides` field wins
 * @returns a new config for this call
 */
export function configFromOptions(
  base: PrioritizationConfig,
  options: PrioritizeOptions = {},
): PrioritizationConfig {
  return mergePrioritizationConfig(base, options.overrides ?? {});
}

/**
 * Map a numeric score to its coarse {@link PriorityBucket}.
 *
 * Uses {@link DEFAULT_BUCKET_EDGES} in ascending order: scores at or above the
 * last edge are `'critical'`, at or above the middle edge are `'high'`, at or
 * above the first edge are `'medium'`, everything else is `'low'`.
 *
 * @param score - a normalised score in `[0, 1]`
 * @returns the bucket the score falls into
 */
export function scoreBucket(score: number): PriorityBucket {
  const edges = DEFAULT_BUCKET_EDGES;
  if (score >= edges[2]) return 'critical';
  if (score >= edges[1]) return 'high';
  if (score >= edges[0]) return 'medium';
  return 'low';
}

/**
 * Clamp a raw score into the normalised `[0, 1]` range.
 *
 * Guards against `NaN` and negative values from degenerate inputs (e.g. a
 * negative role weight), so downstream consumers can always trust the range.
 *
 * @param value - raw score, possibly un-normalised
 * @returns the clamped, finite score
 */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Estimate the token count of a piece of text.
 *
 * Uses the fixed {@link CHARS_PER_TOKEN} ratio (`chars / 4`), which is
 * accurate enough for *relative* size comparisons between parts and is fully
 * deterministic — the Prioritization layer never claims to be a true tokenizer.
 *
 * @param text - the text to estimate
 * @returns an estimated token count, `>= 0`
 */
export function estimateTokens(text: string): number {
  const len = text ? text.length : 0;
  return Math.max(0, Math.ceil(len / CHARS_PER_TOKEN));
}

/**
 * Normalise a role weight so it can participate in the `[0, 1]` score space.
 *
 * The configured weight is divided by the maximum configured weight, so the
 * strongest role always contributes exactly `1.0` and every other role a
 * fraction of it. Absent roles fall back to {@link DEFAULT_ROLE}.
 *
 * @param role - the part's role
 * @param roleWeights - the configured per-role weights
 * @returns the normalised role term in `(0, 1]`
 */
export function roleTerm(
  role: PartRole,
  roleWeights: Readonly<Partial<Record<PartRole, number>>>,
): number {
  const weights = roleWeights ?? DEFAULT_ROLE_WEIGHTS;
  const max = Math.max(
    DEFAULT_ROLE,
    ...Object.values(weights).filter((w) => typeof w === 'number' && w > 0),
  );
  const mine = weights[role] ?? DEFAULT_ROLE;
  if (mine <= 0 || max <= 0) return DEFAULT_ROLE;
  return Math.min(1, mine / max);
}

/**
 * Extract lowercase, de-duplicated search terms from a query string.
 *
 * Terms are alphanumeric runs of length `>= 2`; the query is normalised to
 * lowercase and split on non-alphanumeric characters. Frequencies are
 * discarded — presence is what matters for the relevance term.
 *
 * @param query - the raw query, possibly empty
 * @returns the extracted terms, de-duplicated, in order of first appearance
 */
export function extractQueryTerms(query: string | undefined): string[] {
  if (!query) return [];
  const terms = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    const term = raw.trim();
    if (term.length >= 2) terms.add(term);
  }
  return Array.from(terms);
}

/**
 * A lightweight predicate that reports whether a {@link PriorityScore} is
 * structurally valid enough to cache and index.
 *
 * Used by {@link PriorityStore.put} and {@link PriorityIndex.indexEntry} as a
 * defensive guard against malformed payloads (e.g. from a deserialised JSON
 * snapshot).
 *
 * @param value - value to test
 * @returns `true` when the value looks like a usable score
 */
export function isPriorityScore(value: unknown): value is PriorityScore {
  if (typeof value !== 'object' || value === null) return false;
  const score = value as Record<string, unknown>;
  return (
    typeof score.partId === 'string' &&
    score.partId.length > 0 &&
    typeof score.score === 'number' &&
    Number.isFinite(score.score) &&
    Array.isArray(score.reasons) &&
    score.reasons.every((r) => typeof r === 'string')
  );
}

/**
 * A deterministic FNV-1a (32-bit) string hash, formatted as 8 lowercase hex
 * digits.
 *
 * Used wherever the layer needs a stable, dependency-free digest from an
 * arbitrary string (e.g. bucketing part IDs for consistent grouping).
 *
 * @param input - the string to hash
 * @returns an 8-character lowercase hex hash
 */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * A stable hash of a {@link ContextPart.partId}, useful as a group key.
 *
 * @param partId - the part identifier to hash
 * @returns the FNV-1a digest of the part id
 */
export function partHash(partId: string): string {
  return fnv1a(partId);
}