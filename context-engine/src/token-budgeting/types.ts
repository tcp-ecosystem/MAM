/**
 * Shared domain types for the **Token budgeting** layer of the standalone MAM
 * Context Engine.
 *
 * The Token budgeting layer answers a question every prompt-assembly pipeline
 * must eventually confront: *"how much of my model's context window does each
 * section of the prompt actually get to use, and what happens when a section
 * tries to take more than its fair share?"* It sits between the **Context
 * assembly** side (which produces text for the `system`, `user`, `tool`,
 * `memory` and `knowledge` sections) and the **generation** side (which
 * consumes a single flattened prompt), and is responsible for:
 *
 * 1. **Budgeting** — declaring a per-section token limit plus a configurable
 *    overrun policy (`'trim' | 'reject' | 'allow'`) that decides how a request
 *    which exceeds its section's remaining capacity is handled.
 * 2. **Accounting** — tracking `used` and `reserved` token counts per section
 *    as the engine allocates and releases tokens, so at any instant a caller
 *    can ask "how many tokens are left in `knowledge`?".
 * 3. **Indexing** — answering status queries over the whole budget set (which
 *    sections are *ok*, *warn*, *critical* or *over* their limit) cheaply,
 *    without scanning every section on each call.
 * 4. **Lifecycle** — pruning, resetting and periodically garbage-collecting
 *    budgets so the layer stays bounded under long-running processes.
 * 5. **Integration** — high-level facades that combine budgeting with a
 *    heuristic `estimate(text)` token counter and a `fit(text, section)`
 *    truncator that physically trims a piece of text down to what its section
 *    can still afford.
 *
 * The types in this module form the public contract shared by every other file
 * of the token-budgeting subsystem:
 *
 * - {@link SectionBudget} — one section's budget: its limit, used and reserved
 *   token counts.
 * - {@link TokenBudgetConfig} — construction/behaviour options: default limit,
 *   per-section overrides, an optional global cap and the overrun policy.
 * - {@link BudgetAllocation} — the outcome of a single `allocate` call.
 * - {@link BudgetCheck} — the answer to a dry-run `check` call.
 * - {@link BudgetState} — a serialisable snapshot of the whole budget set.
 * - {@link BudgetStats} — aggregate counters describing the subsystem.
 * - {@link BudgetOptions} — per-operation overrides passed to allocate/check.
 * - {@link BudgetAvailability} — how many tokens remain, globally and per
 *   section.
 *
 * Every value here is deliberately framework-agnostic and JSON-serialisable:
 * {@link BudgetState} and {@link SectionBudget} round-trip through
 * `JSON.stringify`/`JSON.parse` without loss, so a live budget table can be
 * persisted and restored across restarts. The module also exports the pure
 * helpers the rest of the layer composes ({@link estimateTokens},
 * {@link computeStatus}, {@link clampTokens}, the default/merge factories, …)
 * so the budgeting logic stays deterministic and unit-testable.
 *
 * @packageDocumentation
 * @module token-budgeting/types
 */

/**
 * Identifier for a context section.
 *
 * The five canonical MAM sections are `system`, `user`, `tool`, `memory` and
 * `knowledge` (see {@link CANONICAL_SECTIONS}). Because downstream engines are
 * free to introduce their own compartments, the type widens to *any* string:
 * a section named `"router"`, `"scratch"` or `"my-plugin"` is perfectly
 * legal. The widest form is `string & {}` so that autocomplete still suggests
 * the canonical names while accepting arbitrary values.
 */
export type SectionName =
  | 'system'
  | 'user'
  | 'tool'
  | 'memory'
  | 'knowledge'
  | (string & {});

/**
 * The policy applied when an allocation request would exceed a section's
 * remaining capacity.
 *
 * - `'trim'` — grant only as many tokens as actually fit. The caller is told
 *   how many were denied and is expected to shrink the payload to match.
 * - `'reject'` — deny the allocation outright when it would exceed the limit.
 *   Nothing is granted; the caller must free tokens first.
 * - `'allow'` — grant the full request even if it pushes the section over its
 *   limit. Used for hard-priority sections where correctness beats limits.
 */
export type OverrunPolicy = 'trim' | 'reject' | 'allow';

/**
 * A section's utilisation bucket, derived from its `used`/`limit` ratio.
 *
 * - `'ok'` — comfortably under the limit (below the warn threshold).
 * - `'warn'` — approaching the limit (at or above {@link WARN_THRESHOLD}).
 * - `'critical'` — nearly exhausted (at or above {@link CRITICAL_THRESHOLD}).
 * - `'over'` — over the limit (used exceeds limit).
 *
 * {@link computeStatus} derives this bucket and the {@link BudgetIndex} keeps
 * sections bucketed by it so callers can ask "which sections are overloaded?"
 * in O(1)-ish time rather than scanning every budget.
 */
export type BudgetStatus = 'ok' | 'warn' | 'critical' | 'over';

/**
 * A single section's budget: how many tokens it may use and how many it has
 * actually consumed or reserved.
 *
 * `used` counts tokens that have been allocated and not yet released. `limit`
 * is the section's cap; a `used` greater than `limit` is only possible when
 * the overrun policy is `'allow'` (or a partial grant under `'trim'` was
 * later topped up). `reserved` is the count of tokens held aside for work that
 * has not started yet — a convenient way to *pre-commit* headroom so a later
 * burst allocation does not blow the budget.
 *
 * @example
 * ```ts
 * const budget: SectionBudget = {
 *   section: 'system',
 *   limit: 2000,
 *   used: 640,
 *   reserved: 120,
 * };
 * ```
 */
export interface SectionBudget {
  /**
   * The section this budget governs. See {@link SectionName}.
   */
  readonly section: SectionName;

  /**
   * Maximum number of tokens the section may consume. Always a non-negative
   * finite integer.
   */
  readonly limit: number;

  /**
   * Number of tokens currently allocated to (and not yet released by) the
   * section. Never negative; may transiently exceed `limit` under the
   * `'allow'` policy.
   */
  readonly used: number;

  /**
   * Number of tokens reserved for future work within the section. `reserved`
   * counts against the section's available headroom (see
   * {@link remainingTokens}) but is not part of `used`.
   */
  readonly reserved: number;
}

/**
 * Construction/behaviour options for the whole token-budgeting subsystem.
 *
 * A {@link TokenBudgetConfig} may be supplied to {@link TokenBudgetStore},
 * {@link BudgetManager}, {@link TokenBudgetLifecycle}, {@link TokenBudgeter}
 * and {@link BudgetAdapter} to tune per-section limits, the global cap and the
 * overrun policy. Every field has a sensible default (see
 * {@link defaultTokenBudgetConfig}); callers only override what they care
 * about.
 *
 * @example
 * ```ts
 * const config: TokenBudgetConfig = {
 *   defaultLimit: 8000,
 *   perSection: { system: 2000, user: 12000 },
 *   maxTotal: 128_000,
 *   overrunPolicy: 'trim',
 * };
 * ```
 */
export interface TokenBudgetConfig {
  /**
   * The token limit applied to any section without an explicit entry in
   * {@link TokenBudgetConfig.perSection}. Defaults to
   * {@link DEFAULT_SECTION_LIMIT} (`8000`).
   */
  readonly defaultLimit: number;

  /**
   * Per-section limit overrides keyed by {@link SectionName}. A section named
   * here uses its own limit instead of `defaultLimit`; sections absent from
   * this map fall back to `defaultLimit`. Defaults to `{}`.
   */
  readonly perSection?: Readonly<Partial<Record<SectionName, number>>>;

  /**
   * Optional cap on the sum of `used` across *all* sections. When non-zero and
   * an allocation would push the global total past it, the allocation is
   * treated as an overrun regardless of the per-section headroom. `0` (the
   * default) disables the global cap.
   */
  readonly maxTotal?: number;

  /**
   * Policy applied when an allocation would exceed a section's remaining
   * capacity (or the global {@link TokenBudgetConfig.maxTotal}). Defaults to
   * `'trim'`.
   */
  readonly overrunPolicy: OverrunPolicy;
}

/**
 * Per-operation overrides accepted by `allocate`, `check` and friends.
 *
 * Every field is optional so a caller can override the configured
 * {@link TokenBudgetConfig.overrunPolicy} for a single call without
 * disturbing the shared config — e.g. force-`'allow'` an urgent system prompt
 * even though the layer normally rejects overruns.
 */
export interface BudgetOptions {
  /**
   * One-call override of the configured overrun policy. When omitted the
   * config-level policy applies.
   */
  readonly policy?: OverrunPolicy;

  /**
   * When `true`, the requested tokens are added to `reserved` instead of
   * `used`. Reserving pre-commits headroom without claiming the tokens. Used
   * by callers that want to hold a place for a planned write.
   */
  readonly reserve?: boolean;

  /**
   * Clock override used as "now" for the allocation's `at` timestamp. Defaults
   * to the store's configured clock.
   */
  readonly now?: Timestamp;
}

/**
 * The outcome of a single `allocate` (or `reserve`) call.
 *
 * The key relationship is `requested = granted + denied`. Under the `'trim'`
 * policy `denied` is non-zero exactly when the request exceeds headroom;
 * under `'reject'` a would-be overrun yields `granted = 0` and
 * `denied = requested`; under `'allow'` the full request is granted and the
 * section may finish *over* its limit (`ok` becomes `false` only when
 * `status === 'over'`).
 */
export interface BudgetAllocation {
  /**
   * The section the allocation targeted.
   */
  readonly section: SectionName;

  /**
   * Number of tokens the caller asked for.
   */
  readonly requested: number;

  /**
   * Number of tokens actually granted (added to the section's `used` or
   * `reserved`).
   */
  readonly granted: number;

  /**
   * Number of tokens refused by the policy (`requested - granted`).
   */
  readonly denied: number;

  /**
   * The section's `used` total after the allocation.
   */
  readonly used: number;

  /**
   * The section's `used + reserved` total after the allocation.
   */
  readonly committed: number;

  /**
   * The section's remaining headroom (`limit - used - reserved`) after the
   * allocation, clamped at `0`.
   */
  readonly remaining: number;

  /**
   * The section's token limit.
   */
  readonly limit: number;

  /**
   * The section's utilisation bucket after the allocation.
   */
  readonly status: BudgetStatus;

  /**
   * The effective overrun policy applied to this call.
   */
  readonly policy: OverrunPolicy;

  /**
   * `true` when the full `requested` amount was granted and the section is
   * still within its limit.
   */
  readonly ok: boolean;

  /**
   * Epoch-millisecond time at which the allocation was recorded.
   */
  readonly at: Timestamp;
}

/**
 * The answer to a dry-run `check` — "would allocating `tokens` to `section`
 * exceed its budget?".
 *
 * `check` never mutates state; it is the mechanism callers use to decide
 * *before* committing whether a piece of content fits. `wouldExceed` is the
 * headline flag; `projected` and `deficit` quantify by how much.
 */
export interface BudgetCheck {
  /**
   * The section that was checked.
   */
  readonly section: SectionName;

  /**
   * Number of tokens the caller was considering allocating.
   */
  readonly requested: number;

  /**
   * The section's `used` total at the time of the check.
   */
  readonly used: number;

  /**
   * The section's remaining headroom (`limit - used - reserved`) at the time
   * of the check, clamped at `0`.
   */
  readonly remaining: number;

  /**
   * The section's token limit.
   */
  readonly limit: number;

  /**
   * `true` when granting `requested` would push `used` past the limit (or,
   * with a global cap, past `maxTotal`).
   */
  readonly wouldExceed: boolean;

  /**
   * The section's projected `used` after granting the full request.
   */
  readonly projected: number;

  /**
   * How many tokens the request is short by, `max(0, requested - remaining)`.
   * `0` means the full request fits.
   */
  readonly deficit: number;

  /**
   * The section's utilisation bucket if the full request were granted.
   */
  readonly status: BudgetStatus;
}

/**
 * A serialisable snapshot of the whole budget table.
 *
 * Returned by {@link TokenBudgetStore.toJSON} and accepted by
 * {@link TokenBudgetStore.fromJSON}, so a live budget set can be persisted and
 * restored verbatim. All numbers are plain integers; the payload carries no
 * functions, classes or timers.
 */
export interface BudgetState {
  /**
   * Every section's budget, in the store's insertion order.
   */
  readonly sections: readonly SectionBudget[];

  /**
   * The configured global cap (`0` = disabled). Mirrors
   * {@link TokenBudgetConfig.maxTotal}.
   */
  readonly maxTotal: number;

  /**
   * Sum of every section's `limit`.
   */
  readonly totalLimit: number;

  /**
   * Sum of every section's `used`.
   */
  readonly totalUsed: number;

  /**
   * Sum of every section's remaining headroom (`totalLimit - totalUsed`),
   * clamped at `0`.
   */
  readonly totalRemaining: number;

  /**
   * The overrun policy in force when the snapshot was taken.
   */
  readonly overrunPolicy: OverrunPolicy;

  /**
   * Epoch-millisecond time the budget table was first created.
   */
  readonly createdAt: Timestamp;

  /**
   * Epoch-millisecond time the budget table was last modified.
   */
  readonly updatedAt: Timestamp;
}

/**
 * Aggregate counters describing the token-budgeting subsystem.
 *
 * Behaviour counters (`allocations`, `releases`, `rejections`, …) increase
 * monotonically from construction; state-derived values (`sections`,
 * `peakUsed`) are computed on demand.
 */
export interface BudgetStats {
  /**
   * Number of sections currently tracked.
   */
  readonly sections: number;

  /**
   * Total number of tokens currently used across all sections.
   */
  readonly totalUsed: number;

  /**
   * Total number of tokens currently reserved across all sections.
   */
  readonly totalReserved: number;

  /**
   * Sum of every section's limit.
   */
  readonly totalLimit: number;

  /**
   * Sum of every section's remaining headroom, clamped at `0`.
   */
  readonly totalRemaining: number;

  /**
   * Number of successful `allocate` calls since construction.
   */
  readonly allocations: number;

  /**
   * Number of `release` calls since construction.
   */
  readonly releases: number;

  /**
   * Number of `allocate` calls denied by the `'reject'` policy since
   * construction.
   */
  readonly rejections: number;

  /**
   * Number of allocations that pushed a section over its limit (only possible
   * under the `'allow'` policy) since construction.
   */
  readonly overruns: number;

  /**
   * Number of allocations partially denied by the `'trim'` policy since
   * construction.
   */
  readonly trims: number;

  /**
   * Number of budget-table resets since construction.
   */
  readonly resets: number;

  /**
   * Number of sections removed by lifecycle pruning since construction.
   */
  readonly pruned: number;

  /**
   * Highest `totalUsed` value observed since construction.
   */
  readonly peakUsed: number;

  /**
   * Total number of tokens requested across every `allocate` call since
   * construction.
   */
  readonly totalRequested: number;

  /**
   * Total number of tokens actually granted since construction.
   */
  readonly totalGranted: number;

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
 * How many tokens remain available, globally and per section.
 *
 * Returned by {@link BudgetManager.available} and surfaced by the
 * integration facades. `perSection` maps every tracked section to its own
 * remaining headroom (`limit - used - reserved`, clamped at `0`).
 */
export interface BudgetAvailability {
  /**
   * Total remaining headroom across all sections (the global `maxTotal` cap,
   * when configured, is *not* subtracted — it is a separate limit).
   */
  readonly total: number;

  /**
   * Per-section remaining headroom, keyed by {@link SectionName}.
   */
  readonly perSection: Readonly<Record<string, number>>;
}

/**
 * The result of {@link TokenBudgeter.fit} (and {@link BudgetAdapter.fit}).
 *
 * Combines the (possibly truncated) text with enough bookkeeping for the
 * caller to log or react: how many tokens the original text was estimated at,
 * how many the fitted text is estimated at, and whether truncation occurred.
 */
export interface FitResult {
  /**
   * The fitted text: the original when it fits, otherwise a prefix trimmed to
   * the section's remaining budget.
   */
  readonly text: string;

  /**
   * Estimated token count of {@link FitResult.text}.
   */
  readonly tokens: number;

  /**
   * Estimated token count of the original (unfitted) text.
   */
  readonly originalTokens: number;

  /**
   * `true` when the text had to be truncated to fit the section's budget.
   */
  readonly truncated: boolean;

  /**
   * Remaining headroom in the target section after the fit, clamped at `0`.
   */
  readonly remaining: number;

  /**
   * The section the text was fitted against.
   */
  readonly section: SectionName;
}

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the token-budgeting layer use epoch milliseconds so
 * they interoperate cleanly with `Date`, `performance.now()`-derived clocks and
 * TTL arithmetic in {@link TokenBudgetLifecycle}.
 */
export type Timestamp = number;

/**
 * The five canonical MAM context sections, in their natural prompt order.
 *
 * `system` carries the model's role and rules; `user` the user's request;
 * `tool` the results of tool calls; `memory` the retrieved episodic/semantic
 * context; `knowledge` the retrieved evidence chunks.
 */
export const CANONICAL_SECTIONS: readonly SectionName[] = [
  'system',
  'user',
  'tool',
  'memory',
  'knowledge',
];

/**
 * The default token limit applied to any section without a per-section
 * override. Picked to leave room for the user message and generated reply
 * inside a typical 128k context window: 5 sections × 8k ≈ 40k of budgeted
 * context.
 */
export const DEFAULT_SECTION_LIMIT = 8000;

/**
 * Sensible per-section defaults for a typical 128k-window model.
 *
 * The system prompt gets the tightest cap (it should be short and stable),
 * while `user` gets the most headroom because it carries the actual request.
 */
export const DEFAULT_PER_SECTION_LIMITS: Readonly<Record<SectionName, number>> = {
  system: 2000,
  user: 12_000,
  tool: 8000,
  memory: 6000,
  knowledge: 10_000,
};

/**
 * Default overrun policy: trim payloads that do not fit rather than dropping
 * them outright.
 */
export const DEFAULT_OVERRUN_POLICY: OverrunPolicy = 'trim';

/**
 * Utilisation ratio at which a section moves from `'ok'` to `'warn'`.
 */
export const WARN_THRESHOLD = 0.8;

/**
 * Utilisation ratio at which a section moves from `'warn'` to `'critical'`.
 */
export const CRITICAL_THRESHOLD = 0.95;

/**
 * Default number of characters per token used by {@link estimateTokens}.
 *
 * The well-known `len / 4` heuristic (GPT-family encoders approximate ~4
 * characters per token for typical English text) keeps the estimate cheap and
 * dependency-free.
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Default interval (ms) between automatic GC passes in
 * {@link TokenBudgetLifecycle}.
 */
export const DEFAULT_GC_INTERVAL_MS = 60_000;

/**
 * Default maximum number of sections a {@link TokenBudgetLifecycle} keeps
 * alive before it starts pruning the least-used ones.
 */
export const DEFAULT_MAX_SECTIONS = 64;

/**
 * Clamp an arbitrary number into a valid token count: a non-negative finite
 * integer. Non-finite or negative inputs collapse to `0`.
 *
 * @param tokens - the raw token count
 * @returns a safe, non-negative integer token count
 */
export function clampTokens(tokens: number): number {
  if (!Number.isFinite(tokens)) {
    return 0;
  }
  return Math.max(0, Math.floor(tokens));
}

/**
 * Narrow a value to {@link SectionName} by structural inspection.
 *
 * @param value - the value to test
 * @returns `true` when the value is a non-empty string
 */
export function isSectionName(value: unknown): value is SectionName {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Narrow a value to {@link OverrunPolicy}.
 *
 * @param value - the value to test
 * @returns `true` when the value is `'trim'`, `'reject'` or `'allow'`
 */
export function isOverrunPolicy(value: unknown): value is OverrunPolicy {
  return value === 'trim' || value === 'reject' || value === 'allow';
}

/**
 * Narrow a value to {@link SectionBudget} by structural inspection.
 *
 * Checks the four required fields with finite non-negative numbers.
 *
 * @param value - the value to test
 * @returns `true` when the value looks like a {@link SectionBudget}
 */
export function isSectionBudget(value: unknown): value is SectionBudget {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<SectionBudget>;
  return (
    typeof record.section === 'string' &&
    record.section.length > 0 &&
    typeof record.limit === 'number' &&
    Number.isFinite(record.limit) &&
    record.limit >= 0 &&
    typeof record.used === 'number' &&
    Number.isFinite(record.used) &&
    record.used >= 0 &&
    typeof record.reserved === 'number' &&
    Number.isFinite(record.reserved) &&
    record.reserved >= 0
  );
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
 * Compute a section's remaining headroom: `limit - used - reserved`, clamped
 * at `0`.
 *
 * @param budget - the section budget to measure
 * @returns the remaining token count (`0` when the section is exhausted or
 *   over its limit)
 */
export function remainingTokens(budget: SectionBudget): number {
  return Math.max(0, budget.limit - budget.used - budget.reserved);
}

/**
 * Compute a section's utilisation ratio: `used / limit`.
 *
 * Returns `1` when the limit is `0` (an empty budget is treated as fully
 * consumed) so {@link computeStatus} never divides by zero.
 *
 * @param budget - the section budget to measure
 * @returns the utilisation ratio in `[0, ∞)`
 */
export function budgetUtilization(budget: SectionBudget): number {
  if (budget.limit <= 0) {
    return budget.used > 0 ? Number.POSITIVE_INFINITY : 1;
  }
  return budget.used / budget.limit;
}

/**
 * Derive a section's {@link BudgetStatus} bucket from its current utilisation.
 *
 * `'over'` wins whenever `used > limit`; otherwise the ratio is compared
 * against {@link CRITICAL_THRESHOLD} and {@link WARN_THRESHOLD}.
 *
 * @param budget - the section budget to classify
 * @returns the derived {@link BudgetStatus}
 */
export function computeStatus(budget: SectionBudget): BudgetStatus {
  if (budget.used > budget.limit) {
    return 'over';
  }
  const ratio = budgetUtilization(budget);
  if (ratio >= CRITICAL_THRESHOLD) {
    return 'critical';
  }
  if (ratio >= WARN_THRESHOLD) {
    return 'warn';
  }
  return 'ok';
}

/**
 * Create a fully-populated {@link SectionBudget}.
 *
 * @param section - the section name
 * @param limit - the section's token limit (clamped to a non-negative integer)
 * @param used - the initial used count (default `0`)
 * @param reserved - the initial reserved count (default `0`)
 * @returns a validated {@link SectionBudget}
 */
export function createSectionBudget(
  section: SectionName,
  limit: number,
  used = 0,
  reserved = 0,
): SectionBudget {
  return {
    section,
    limit: clampTokens(limit),
    used: clampTokens(used),
    reserved: clampTokens(reserved),
  };
}

/**
 * Produce the canonical {@link TokenBudgetConfig} defaults.
 *
 * The default limit is {@link DEFAULT_SECTION_LIMIT}; per-section overrides
 * default to {@link DEFAULT_PER_SECTION_LIMITS} so the five canonical sections
 * each get a purpose-tuned cap out of the box; the global cap defaults to
 * disabled (`0`) and the policy to `'trim'`.
 *
 * @returns a complete configuration with every field populated by its default
 */
export function defaultTokenBudgetConfig(): TokenBudgetConfig {
  return {
    defaultLimit: DEFAULT_SECTION_LIMIT,
    perSection: { ...DEFAULT_PER_SECTION_LIMITS },
    maxTotal: 0,
    overrunPolicy: DEFAULT_OVERRUN_POLICY,
  };
}

/**
 * Merge a partial {@link TokenBudgetConfig} over the defaults.
 *
 * `perSection` is merged shallowly, so a caller can override just
 * `perSection.system` without losing the rest of the per-section table.
 *
 * @param config - the partial configuration, or `undefined`
 * @returns a complete, merged {@link TokenBudgetConfig}
 */
export function mergeTokenBudgetConfig(
  config: Partial<TokenBudgetConfig> | undefined,
): TokenBudgetConfig {
  const base = defaultTokenBudgetConfig();
  if (!config) {
    return base;
  }
  return {
    ...base,
    ...config,
    perSection: config.perSection
      ? { ...base.perSection, ...config.perSection }
      : base.perSection,
  };
}

/**
 * Resolve the effective limit for a section from a config.
 *
 * Prefers the per-section override, then the config's default limit, then
 * {@link DEFAULT_SECTION_LIMIT} as a final fallback. Always returns a
 * non-negative finite integer.
 *
 * @param config - the configuration to resolve against
 * @param section - the section to resolve a limit for
 * @returns the section's effective limit
 */
export function effectiveLimit(
  config: TokenBudgetConfig,
  section: SectionName,
): number {
  const per = config.perSection?.[section];
  if (typeof per === 'number' && Number.isFinite(per) && per >= 0) {
    return Math.floor(per);
  }
  return clampTokens(config.defaultLimit);
}

/**
 * Sum the token columns of a list of section budgets.
 *
 * @param budgets - the budgets to total
 * @returns `{ totalLimit, totalUsed, totalReserved, totalRemaining }` with
 *   `totalRemaining` clamped at `0`
 */
export function budgetTotals(
  budgets: Iterable<SectionBudget>,
): {
  readonly totalLimit: number;
  readonly totalUsed: number;
  readonly totalReserved: number;
  readonly totalRemaining: number;
} {
  let totalLimit = 0;
  let totalUsed = 0;
  let totalReserved = 0;
  for (const budget of budgets) {
    totalLimit += budget.limit;
    totalUsed += budget.used;
    totalReserved += budget.reserved;
  }
  return {
    totalLimit,
    totalUsed,
    totalReserved,
    totalRemaining: Math.max(0, totalLimit - totalUsed),
  };
}