/**
 * Scoring & selection engine for the **Prioritization** layer of the standalone
 * MAM Context Engine.
 *
 * {@link PriorityScorer} turns a bag of {@link ContextPart}s into an ordered,
 * ranked list of {@link PriorityScore}s. It is the pure core of the layer —
 * it holds no mutable state and performs no I/O, which makes every method
 * trivially deterministic (given a fixed clock) and unit-testable.
 *
 * ## The score
 *
 * {@link PriorityScorer.scorePart} combines four independent signals into a
 * single normalised `[0, 1]` score:
 *
 * 1. **Recency** — `exp(-ageHours / decayHours)`. A part that is minutes old
 *    scores ~1; a part that is several {@link PrioritizationConfig.decayHours}
 *    old decays toward 0. The decay is configured per scorer.
 * 2. **Relevance** — the fraction of active query terms and configured boost
 *    keywords that appear in the part's content. Matching *more* of the query
 *    makes a part sharply more important.
 * 3. **Role** — the configured weight of the part's {@link PartRole},
 *    normalised against the strongest configured role, so a `'user'` part
 *    outranks an `'ambient'` one regardless of the absolute weights.
 * 4. **Size** — peaks at {@link DEFAULT_IDEAL_TOKENS} estimated tokens and
 *    trails off on both sides, so a one-token part carries little signal and a
 *    10 000-token part is penalised for its cost.
 *
 * Each signal is multiplied by its configured weight (which sum to 1 by
 * default) and the weighted sum is clamped into `[0, 1]`.
 *
 * ## Selection
 *
 * - {@link PriorityScorer.prioritize} — score *all* parts, sort descending,
 *   assign 1-based ranks.
 * - {@link PriorityScorer.topK} — keep the best `K` ranked parts.
 * - {@link PriorityScorer.withinBudget} — greedily keep the best parts until a
 *   token budget is exhausted, which is how the layer feeds the
 *   token-budgeting stage.
 *
 * The scorer is query-agnostic when no query is supplied: relevance then
 * reduces to the configured boost keywords, so a caller can pre-score a corpus
 * once and refine with queries later (caching that precomputed score is the
 * job of {@link PriorityStore} and {@link Prioritizer}).
 *
 * @module prioritization/retrieval
 */

import {
  clampScore,
  configFromOptions,
  defaultPrioritizationConfig,
  estimateTokens,
  extractQueryTerms,
  mergePrioritizationConfig,
  roleTerm,
} from './types.js';
import type {
  ContextPart,
  PrioritizationConfig,
  PrioritizeOptions,
  PriorityScore,
  Timestamp,
} from './types.js';

/**
 * Construction options for a {@link PriorityScorer}.
 */
export interface PriorityScorerOptions {
  /**
   * Base {@link PrioritizationConfig} the scorer uses for every call. Defaults
   * to {@link defaultPrioritizationConfig} when omitted. Per-call
   * {@link PrioritizeOptions.overrides} are merged on top at call time.
   */
  readonly config?: PrioritizationConfig;
}

/**
 * A token budget selector result.
 *
 * Returned by {@link PriorityScorer.withinBudget}; pairs the selected parts
 * with the budget bookkeeping so callers know exactly how much headroom was
 * used and how much remains.
 */
export interface BudgetSelection<T extends ContextPart> {
  /**
   * The selected parts, ranked best-first, paired with their scores.
   */
  readonly selected: ReadonlyArray<{ part: T; score: PriorityScore }>;

  /**
   * Parts that were ranked but not selected because the budget ran out.
   */
  readonly skipped: ReadonlyArray<{ part: T; score: PriorityScore }>;

  /**
   * Total estimated tokens consumed by `selected`.
   */
  readonly usedTokens: number;

  /**
   * Tokens remaining in the budget after selection (`>= 0`).
   */
  readonly remainingTokens: number;

  /**
   * Fraction of the budget that was consumed, in `[0, 1]`.
   */
  readonly utilization: number;
}

/**
 * The pure scoring engine.
 *
 * @example
 * ```ts
 * const scorer = new PriorityScorer();
 * const ranked = scorer.prioritize(parts, { query: 'onboarding deadline' });
 * const top3 = scorer.topK(parts, 3, { query: 'onboarding deadline' });
 * const fitted = scorer.withinBudget(parts, 2048, { query: 'onboarding' });
 * ```
 */
export class PriorityScorer {
  /** Base config merged with per-call overrides. */
  private readonly _config: PrioritizationConfig;

  /**
   * @param options - construction options
   */
  constructor(options: PriorityScorerOptions = {}) {
    this._config = mergePrioritizationConfig(
      defaultPrioritizationConfig(),
      options.config ?? {},
    );
  }

  /**
   * The base config the scorer uses when no overrides are supplied.
   */
  get config(): PrioritizationConfig {
    return this._config;
  }

  /**
   * Score a single {@link ContextPart}.
   *
   * Combines the recency, relevance, role and size signals described in the
   * module docs, weighted by the resolved config, and returns a
   * {@link PriorityScore} carrying both the numeric score and human-readable
   * `reasons` explaining how it was built.
   *
   * @param part - the part to score
   * @param query - optional active query; terms are extracted and matched
   * @param options - per-call overrides (weights, keywords, clock)
   * @returns the scored, unranked result
   */
  scorePart(
    part: ContextPart,
    query?: string,
    options: PrioritizeOptions = {},
  ): PriorityScore {
    const config = configFromOptions(this._config, options);
    const now = options.now ? options.now() : Date.now();

    const terms = extractQueryTerms(query);
    const boost = this._collectKeywords(config, options);
    const reasons: string[] = [];

    const recency = this._recencyTerm(part, now, config, reasons);
    const relevance = this._relevanceTerm(part, terms, boost, reasons);
    const role = roleTerm(part.role, config.roleWeights ?? {});
    reasons.push(
      `role ${part.role} weights ×${(config.roleWeights?.[part.role] ?? 1).toFixed(2)} (term ${role.toFixed(2)})`,
    );
    const size = this._sizeTerm(part, reasons);

    const raw =
      (config.recencyWeight ?? 0) * recency +
      (config.relevanceWeight ?? 0) * relevance +
      (config.roleWeight ?? 0) * role +
      (config.sizeWeight ?? 0) * size;
    const score = clampScore(raw);
    reasons.push(
      `weighted sum = ${raw.toFixed(4)} clamped to ${score.toFixed(4)}`,
    );

    return {
      partId: part.partId,
      role: part.role,
      score,
      reasons,
    };
  }

  /**
   * Score a batch of parts and return them ranked best-first.
   *
   * Every part is scored, the results are sorted by `score` descending (ties
   * broken by part id for stability), and a 1-based `rank` is stamped onto
   * each score.
   *
   * @param parts - the parts to score
   * @param options - per-call overrides (query, keywords, weights, clock)
   * @returns the ranked scores, best first
   */
  prioritize<T extends ContextPart>(
    parts: readonly T[],
    options: PrioritizeOptions = {},
  ): PriorityScore[] {
    const scored = parts.map((part) => this.scorePart(part, options.query, options));
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0;
    });
    for (let i = 0; i < scored.length; i += 1) {
      scored[i] = { ...scored[i], rank: i + 1 };
    }
    return scored;
  }

  /**
   * Score a batch and keep only the best `k` parts.
   *
   * Equivalent to {@link PriorityScorer.prioritize} followed by a slice, but
   * documented separately because it is the most common entry point for
   * "give me the strongest handful of memories for this turn".
   *
   * @param parts - the parts to score
   * @param k - maximum number to return; `<= 0` returns an empty list
   * @param options - per-call overrides
   * @returns the best `k` ranked scores
   */
  topK<T extends ContextPart>(
    parts: readonly T[],
    k: number,
    options: PrioritizeOptions = {},
  ): PriorityScore[] {
    const ranked = this.prioritize(parts, options);
    return k <= 0 ? [] : ranked.slice(0, k);
  }

  /**
   * Select the best parts until a token budget is exhausted.
   *
   * Scores all parts, sorts them best-first, then greedily takes each part
   * (estimating its tokens via {@link estimateTokens}) as long as doing so does
   * not exceed the budget. A part that alone exceeds the remaining headroom is
   * skipped rather than partially included, keeping the contract that
   * `usedTokens <= budget`.
   *
   * @param parts - the parts to consider
   * @param budgetTokens - the hard token ceiling
   * @param options - per-call overrides
   * @returns the budget selection (selected, skipped, and bookkeeping)
   */
  withinBudget<T extends ContextPart>(
    parts: readonly T[],
    budgetTokens: number,
    options: PrioritizeOptions = {},
  ): BudgetSelection<T> {
    const ranked = this.prioritize(parts, options);
    const byId = new Map<string, T>();
    for (const part of parts) byId.set(part.partId, part);

    const selected: Array<{ part: T; score: PriorityScore }> = [];
    const skipped: Array<{ part: T; score: PriorityScore }> = [];
    let used = 0;
    const budget = Math.max(0, budgetTokens);

    for (const score of ranked) {
      const part = byId.get(score.partId);
      if (!part) continue;
      const tokens = estimateTokens(part.content);
      if (used + tokens <= budget) {
        selected.push({ part, score });
        used += tokens;
      } else {
        skipped.push({ part, score });
      }
    }

    const remaining = Math.max(0, budget - used);
    return {
      selected,
      skipped,
      usedTokens: used,
      remainingTokens: remaining,
      utilization: budget > 0 ? used / budget : 0,
    };
  }

  /**
   * Build the merged keyword list for a call: config boost keywords plus any
   * per-call `options.keywords`, normalised to lowercase and de-duplicated.
   *
   * @param config - the resolved per-call config
   * @param options - the per-call options
   * @returns the de-duplicated, lowercased keyword list
   */
  private _collectKeywords(
    config: PrioritizationConfig,
    options: PrioritizeOptions,
  ): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...(config.boostKeywords ?? []), ...(options.keywords ?? [])]) {
      const k = raw.trim().toLowerCase();
      if (k.length > 0 && !seen.has(k)) {
        seen.add(k);
        merged.push(k);
      }
    }
    return merged;
  }

  /**
   * Compute the recency term for a part.
   *
   * `recency = exp(-ageHours / decayHours)`, where `ageHours` is measured from
   * `part.createdAt` to `now`. Parts with a missing or non-positive
   * `createdAt` are treated as maximally old (`0`), and a non-positive
   * `decayHours` is guarded to a tiny positive epsilon so the term never
   * divides by zero.
   *
   * @param part - the part being scored
   * @param now - the current timestamp
   * @param config - the resolved per-call config
   * @param reasons - the accumulating reason list
   * @returns the recency term in `[0, 1]`
   */
  private _recencyTerm(
    part: ContextPart,
    now: Timestamp,
    config: PrioritizationConfig,
    reasons: string[],
  ): number {
    const decayHours = Math.max(1e-9, config.decayHours ?? 24);
    const createdAt = part.createdAt && part.createdAt > 0 ? part.createdAt : now;
    const ageMs = Math.max(0, now - createdAt);
    const ageHours = ageMs / 3_600_000;
    const term = Math.exp(-ageHours / decayHours);
    reasons.push(
      `recency age ${ageHours.toFixed(2)}h over decay ${decayHours}h → ${term.toFixed(3)}`,
    );
    return term;
  }

  /**
   * Compute the relevance term for a part.
   *
   * `relevance = matched / total`, where `total` is the combined set of query
   * terms and boost keywords. A term counts as matched when it appears as a
   * lowercase substring of the part's content. When there are no terms at all
   * the term is `0` (no signal).
   *
   * @param part - the part being scored
   * @param terms - the extracted query terms
   * @param boost - the merged boost keywords
   * @param reasons - the accumulating reason list
   * @returns the relevance term in `[0, 1]`
   */
  private _relevanceTerm(
    part: ContextPart,
    terms: string[],
    boost: string[],
    reasons: string[],
  ): number {
    const all = new Set<string>([...terms, ...boost]);
    if (all.size === 0) {
      reasons.push('relevance no query terms or keywords → 0');
      return 0;
    }
    const content = part.content.toLowerCase();
    let matched = 0;
    for (const term of all) {
      if (content.includes(term)) matched += 1;
    }
    const term = matched / all.size;
    reasons.push(
      `relevance matched ${matched}/${all.size} terms → ${term.toFixed(3)}`,
    );
    return term;
  }

  /**
   * Compute the size term for a part.
   *
   * `size = tokens <= ideal ? tokens/ideal : ideal/tokens`, peaking at `1`
   * exactly at {@link DEFAULT_IDEAL_TOKENS} estimated tokens and trailing off
   * to `0` on both sides. A tiny part is rewarded proportionally to its
   * content, a huge part is dampened by how many times it overshoots the ideal.
   *
   * @param part - the part being scored
   * @param reasons - the accumulating reason list
   * @returns the size term in `[0, 1]`
   */
  private _sizeTerm(part: ContextPart, reasons: string[]): number {
    const ideal = 256;
    const tokens = estimateTokens(part.content);
    const term = tokens <= ideal ? tokens / ideal : ideal / tokens;
    reasons.push(
      `size ${tokens} tokens vs ideal ${ideal} → ${term.toFixed(3)}`,
    );
    return term;
  }
}

/**
 * A convenience factory for a {@link PriorityScorer} configured from a partial
 * config.
 *
 * @param config - partial config; merged over the defaults
 * @returns a configured scorer
 */
export function createScorer(config: PrioritizationConfig = {}): PriorityScorer {
  return new PriorityScorer({ config });
}