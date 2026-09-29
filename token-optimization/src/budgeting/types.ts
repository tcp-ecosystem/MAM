/**
 * @file types.ts
 * @module budgeting/types
 *
 * Core domain types for the MAM Token Optimization **Budgeting** layer.
 *
 * The budgeting layer is responsible for deciding *how many tokens each
 * prompt section may consume*. A "section" is one logical part of a prompt
 * (e.g. the system directive, the user turn, the tool result corpus, the
 * episodic memory block or the knowledge-graph context). Every section gets
 * an {@link SectionAllocation} describing its ceiling (`limit`), how much of
 * it is currently in flight (`used`) and how much headroom is deliberately
 * kept free (`reserved`).
 *
 * This module is intentionally free of mutable logic. It defines:
 *  - the shared data shapes ({@link SectionAllocation}, {@link BudgetConfig},
 *    {@link AllocationResult}, {@link BudgetSnapshot}, {@link BudgetStats},
 *    {@link AllocateOptions}, {@link FitResult});
 *  - canonical constants ({@link CANONICAL_SECTIONS},
 *    {@link DEFAULT_BUDGET_CONFIG});
 *  - runtime type guards that let callers validate untrusted input (from
 *    JSON, from a config file, or from a plugin boundary);
 *  - pure factories that construct well-formed instances with sane defaults.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------------ *
 * Canonical section registry
 * ------------------------------------------------------------------------ */

/**
 * The canonical prompt sections the budgeting engine understands.
 *
 * These are ordered by prompt position: a serialized prompt is usually
 * assembled as system -> tools -> memory -> knowledge -> user. Keeping a
 * single ordered registry means every consumer (store, index, allocator,
 * lifecycle) agrees on the vocabulary of section names.
 */
export const CANONICAL_SECTIONS: readonly string[] = [
  'system',
  'tools',
  'memory',
  'knowledge',
  'user',
] as const;

/**
 * A union of the canonical section names. Use this for strongly-typed
 * parameters; plain `string` is accepted everywhere as well so that
 * consumers can introduce custom sections without ceremony.
 */
export type CanonicalSection = (typeof CANONICAL_SECTIONS)[number];

/**
 * A `Set` view of {@link CANONICAL_SECTIONS} for O(1) membership checks.
 * Useful for guards and for validating section names at runtime.
 */
export const CANONICAL_SECTION_SET: ReadonlySet<string> = new Set(
  CANONICAL_SECTIONS,
);

/* ------------------------------------------------------------------------ *
 * Overrun & fit vocabulary
 * ------------------------------------------------------------------------ */

/**
 * The three overrun policies a {@link BudgetConfig} can declare.
 *
 * - `'trim'`:   the allocator grants only as much as fits and reports the
 *               shortfall through `exceeded: true`. The request itself is
 *               not rejected — it is truncated to the available capacity.
 * - `'reject'`: the allocator grants nothing when the request would push a
 *               section (or the global total) past its ceiling.
 * - `'allow'`:  the allocator grants the full request even if that
 *               overshoots a ceiling; `exceeded: true` is set so callers can
 *               observe and compensate afterwards.
 */
export const OVERRUN_POLICIES = ['trim', 'reject', 'allow'] as const;

/**
 * The valid overrun policy strings ({@link OVERRUN_POLICIES} as a type).
 */
export type OverrunPolicy = (typeof OVERRUN_POLICIES)[number];

/**
 * Outcomes reported by {@link FitResult.status}.
 *
 * - `'full'`:    the source text fit inside the budget untouched.
 * - `'trimmed'`: the source text was truncated (an ellipsis was appended).
 * - `'empty'`:   the source text produced no output (blank input or a zero
 *                budget).
 */
export const FIT_STATUSES = ['full', 'trimmed', 'empty'] as const;

/**
 * The valid fit outcomes ({@link FIT_STATUSES} as a type).
 */
export type FitStatus = (typeof FIT_STATUSES)[number];

/* ------------------------------------------------------------------------ *
 * Data shapes
 * ------------------------------------------------------------------------ */

/**
 * Per-section token accounting.
 *
 * A single prompt section's ceiling and consumption. `used` may legally
 * exceed `limit` when the governing config declares `overrun: 'allow'` —
 * the excess is then observable so downstream stages can react.
 */
export interface SectionAllocation {
  /** Logical section name (canonical or custom). */
  section: string;
  /** Hard token ceiling for this section (>= 0). */
  limit: number;
  /** Tokens currently consumed by this section (>= 0). */
  used: number;
  /**
   * Tokens deliberately held in reserve for this section.
   *
   * Reserved headroom is *not* available for allocation and is excluded
   * from "remaining" calculations, giving priority sections (e.g. the
   * system directive) a guaranteed floor.
   */
  reserved?: number;
}

/**
 * Immutable-by-convention configuration governing how budgets behave.
 *
 * All fields are optional except `overrun`. Use {@link DEFAULT_BUDGET_CONFIG}
 * as a base and {@link normalizeBudgetConfig} to merge partial user config
 * with the defaults.
 */
export interface BudgetConfig {
  /**
   * Fallback ceiling applied to any section without an explicit entry in
   * `perSection`. Defaults to {@link DEFAULT_LIMIT}.
   */
  defaultLimit?: number;
  /**
   * Per-section ceilings, keyed by section name. Entries override
   * `defaultLimit` for that section only.
   */
  perSection?: Readonly<Record<string, number>>;
  /**
   * Global ceiling across *all* sections combined. When set, the allocator
   * refuses (or trims) requests that would push the summed usage above this
   * value.
   */
  maxTotal?: number;
  /**
   * Behaviour when a request would exceed a section or global ceiling.
   * See {@link OverrunPolicy}.
   */
  overrun: OverrunPolicy;
}

/**
 * Options accepted by the allocator's `allocate(...)` call.
 */
export interface AllocateOptions {
  /**
   * Free-form human-readable reason for the allocation (e.g. `"tool result
   * corpus"`). Surfaced in snapshots and audit logs; never interpreted.
   */
  reason?: string;
  /**
   * When `true` (default), a `'trim'` overrun grants the *partial* amount
   * that fits. When `false`, an overrun grants nothing at all even under a
   * `'trim'` policy (same observable result as `'reject'` for that call).
   */
  allowPartial?: boolean;
  /**
   * Relative priority of the request (higher wins under contention). Stored
   * for observability; the current allocator is single-request so this is
   * advisory.
   */
  priority?: number;
  /**
   * Number of tokens to hold in reserve for this section after the
   * allocation lands (see {@link SectionAllocation.reserved}).
   */
  reserved?: number;
}

/**
 * Outcome of a single allocation attempt.
 *
 * `allowed` is the authoritative field: the number of tokens actually
 * granted by the call. The other fields describe the post-condition of the
 * section so callers can inspect state without a second round-trip.
 */
export interface AllocationResult {
  /** Section the allocation targeted. */
  section: string;
  /** Tokens actually granted by this call (>= 0). */
  allowed: number;
  /** Section usage after the allocation (if the section exists). */
  used?: number;
  /** Section headroom after the allocation (limit - used - reserved). */
  remaining?: number;
  /**
   * `true` when the request could not be satisfied within the configured
   * ceiling and the policy had to trim or reject.
   */
  exceeded?: boolean;
  /** Echo of {@link AllocateOptions.reason} for auditability. */
  reason?: string;
}

/**
 * A point-in-time dump of the entire budget state.
 *
 * Produced by {@link BudgetingLifecycle.start | periodic snapshots} and by
 * the allocator's `snapshot()` method. Snapshots are immutable copies so
 * they are safe to hand to loggers, metrics collectors or network peers.
 */
export interface BudgetSnapshot {
  /** Epoch milliseconds when the snapshot was captured. */
  timestamp: number;
  /** Sum of every section's ceiling (0 when no sections exist). */
  totalLimit: number;
  /** Sum of every section's consumption (may exceed `totalLimit`). */
  totalUsed: number;
  /** Sum of every section's reserved headroom. */
  totalReserved: number;
  /** Headroom left: `totalLimit - totalUsed - totalReserved` (>= 0). */
  remaining: number;
  /** Deep copies of each section allocation, in insertion order. */
  sections: SectionAllocation[];
}

/**
 * Aggregate statistics over the current allocation set.
 *
 * Unlike {@link BudgetSnapshot} this is a cheap derived summary; it is
 * recomputed on demand rather than cached.
 */
export interface BudgetStats {
  /** Number of tracked sections. */
  sections: number;
  /** Sum of section ceilings. */
  totalLimit: number;
  /** Sum of section consumption. */
  totalUsed: number;
  /** Sum of section reserves. */
  totalReserved: number;
  /** `totalLimit - totalUsed - totalReserved` (>= 0). */
  remaining: number;
  /**
   * `totalUsed / totalLimit` when any ceiling exists, else `0`.
   * Values above `1` indicate over-limit usage.
   */
  utilization: number;
  /** Count of sections currently above their ceiling. */
  overLimit: number;
  /** Count of sections currently at or below their ceiling. */
  underLimit: number;
}

/**
 * Outcome of a text-trimming operation (`fit`).
 */
export interface FitResult {
  /** Section whose budget governed the trim. */
  section: string;
  /** The (possibly truncated) text. */
  text: string;
  /** `true` when `text` was altered from the input. */
  truncated: boolean;
  /** Fit outcome, see {@link FitStatus}. */
  status: FitStatus;
  /** The ceiling the trim was performed against. */
  limit: number;
  /** Estimated tokens in the returned `text`. */
  usedTokens: number;
  /** Headroom left after the returned `text` was placed. */
  remaining: number;
  /** Length (in code units) of the original input text. */
  originalLength: number;
  /** Length (in code units) of the returned `text`. */
  resultLength: number;
}

/* ------------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------------ */

/** Default per-section ceiling when nothing else is configured. */
export const DEFAULT_LIMIT = 2000;

/** Default global ceiling across all sections. */
export const DEFAULT_MAX_TOTAL = 12_000;

/**
 * Canonical default configuration.
 *
 * The system directive gets the most headroom per section (smallest limit
 * meaning it is the most protected), the user turn gets the largest. The
 * default overrun policy is `'trim'`: never fail a request outright, always
 * truncate to fit.
 */
export const DEFAULT_BUDGET_CONFIG: Readonly<BudgetConfig> = {
  defaultLimit: DEFAULT_LIMIT,
  perSection: {
    system: 1000,
    tools: 1500,
    memory: 800,
    knowledge: 1200,
    user: 4000,
  },
  maxTotal: DEFAULT_MAX_TOTAL,
  overrun: 'trim',
} as const;

/* ------------------------------------------------------------------------ *
 * Number helpers
 * ------------------------------------------------------------------------ */

/**
 * Returns `true` when `value` is a finite `number` (not NaN, not Infinity).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns `true` when `value` is a finite, non-negative number.
 */
export function isFiniteNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

/**
 * Returns `true` when `value` is a non-negative integer token count.
 * Fractions are rejected because token accounting is whole-number based.
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

/* ------------------------------------------------------------------------ *
 * Domain guards
 * ------------------------------------------------------------------------ */

/**
 * Returns `true` when `section` is a non-empty string.
 * The canonical names are not required here so custom sections pass too.
 */
export function isSectionName(section: unknown): section is string {
  return typeof section === 'string' && section.trim().length > 0;
}

/**
 * Returns `true` when `policy` is one of the valid overrun policies.
 */
export function isOverrunPolicy(policy: unknown): policy is OverrunPolicy {
  return (
    typeof policy === 'string' &&
    (OVERRUN_POLICIES as readonly string[]).includes(policy)
  );
}

/**
 * Returns `true` when `value` is a well-formed {@link SectionAllocation}.
 */
export function isSectionAllocation(value: unknown): value is SectionAllocation {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSectionName(v['section'])) return false;
  if (!isFiniteNonNegative(v['limit'])) return false;
  if (!isFiniteNonNegative(v['used'])) return false;
  if (v['reserved'] !== undefined && !isFiniteNonNegative(v['reserved'])) {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a structurally valid {@link BudgetConfig}.
 * Only `overrun` is mandatory; every other field is validated when present.
 */
export function isBudgetConfig(value: unknown): value is BudgetConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['overrun'] !== undefined && !isOverrunPolicy(v['overrun'])) {
    return false;
  }
  if (v['defaultLimit'] !== undefined && !isFiniteNonNegative(v['defaultLimit'])) {
    return false;
  }
  if (v['maxTotal'] !== undefined && !isFiniteNonNegative(v['maxTotal'])) {
    return false;
  }
  if (v['perSection'] !== undefined) {
    if (typeof v['perSection'] !== 'object' || v['perSection'] === null) {
      return false;
    }
    for (const value of Object.values(v['perSection'] as Record<string, unknown>)) {
      if (!isFiniteNonNegative(value)) return false;
    }
  }
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link AllocationResult}.
 */
export function isAllocationResult(value: unknown): value is AllocationResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSectionName(v['section'])) return false;
  if (!isFiniteNonNegative(v['allowed'])) return false;
  if (v['used'] !== undefined && !isFiniteNonNegative(v['used'])) return false;
  if (v['remaining'] !== undefined && !isFiniteNonNegative(v['remaining'])) {
    return false;
  }
  if (v['exceeded'] !== undefined && typeof v['exceeded'] !== 'boolean') {
    return false;
  }
  if (v['reason'] !== undefined && typeof v['reason'] !== 'string') {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link BudgetSnapshot}.
 */
export function isBudgetSnapshot(value: unknown): value is BudgetSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['timestamp'] !== 'number' || !Number.isFinite(v['timestamp'])) {
    return false;
  }
  for (const key of ['totalLimit', 'totalUsed', 'totalReserved', 'remaining'] as const) {
    if (!isFiniteNonNegative(v[key])) return false;
  }
  if (!Array.isArray(v['sections'])) return false;
  return v['sections'].every((entry) => isSectionAllocation(entry));
}

/**
 * Returns `true` when `value` is a well-formed {@link BudgetStats}.
 */
export function isBudgetStats(value: unknown): value is BudgetStats {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of ['sections', 'totalLimit', 'totalUsed', 'totalReserved', 'remaining'] as const) {
    if (!isFiniteNonNegative(v[key])) return false;
  }
  if (typeof v['utilization'] !== 'number' || !Number.isFinite(v['utilization'])) {
    return false;
  }
  return typeof v['overLimit'] === 'number' && typeof v['underLimit'] === 'number';
}

/**
 * Returns `true` when `value` is a well-formed {@link AllocateOptions}.
 */
export function isAllocateOptions(value: unknown): value is AllocateOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['reason'] !== undefined && typeof v['reason'] !== 'string') return false;
  if (v['allowPartial'] !== undefined && typeof v['allowPartial'] !== 'boolean') {
    return false;
  }
  if (v['priority'] !== undefined && !isFiniteNumber(v['priority'])) return false;
  if (v['reserved'] !== undefined && !isFiniteNonNegative(v['reserved'])) return false;
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link FitResult}.
 */
export function isFitResult(value: unknown): value is FitResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSectionName(v['section'])) return false;
  if (typeof v['text'] !== 'string') return false;
  if (typeof v['truncated'] !== 'boolean') return false;
  if (!isFiniteNonNegative(v['limit'])) return false;
  if (!isFiniteNonNegative(v['usedTokens'])) return false;
  if (!isFiniteNonNegative(v['remaining'])) return false;
  return isFiniteNonNegative(v['originalLength']) && isFiniteNonNegative(v['resultLength']);
}

/* ------------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------------ */

/**
 * Builds a {@link SectionAllocation} for `section`, flooring fractional
 * input and coercing negative values to zero. The allocation starts unused.
 */
export function createSectionAllocation(
  section: string,
  limit: number,
  init: Partial<Pick<SectionAllocation, 'used' | 'reserved'>> = {},
): SectionAllocation {
  if (!isSectionName(section)) {
    throw new TypeError(`Invalid section name: ${String(section)}`);
  }
  const safeLimit = Math.max(0, Math.floor(limit));
  const used = Math.max(0, Math.floor(init.used ?? 0));
  const reserved =
    init.reserved !== undefined ? Math.max(0, Math.floor(init.reserved)) : undefined;
  return { section, limit: safeLimit, used, ...(reserved !== undefined ? { reserved } : {}) };
}

/**
 * Builds an {@link AllocationResult} for `section`, coercing the granted
 * amount to a non-negative integer.
 */
export function createAllocationResult(
  section: string,
  allowed: number,
  init: Partial<Pick<AllocationResult, 'used' | 'remaining' | 'exceeded' | 'reason'>> = {},
): AllocationResult {
  return {
    section,
    allowed: Math.max(0, Math.floor(allowed)),
    ...(init.used !== undefined ? { used: Math.max(0, Math.floor(init.used)) } : {}),
    ...(init.remaining !== undefined ? { remaining: Math.max(0, Math.floor(init.remaining)) } : {}),
    ...(init.exceeded !== undefined ? { exceeded: init.exceeded } : {}),
    ...(init.reason !== undefined ? { reason: init.reason } : {}),
  };
}

/**
 * Builds a {@link BudgetSnapshot} with the current timestamp.
 */
export function createBudgetSnapshot(
  init: Omit<BudgetSnapshot, 'timestamp'>,
): BudgetSnapshot {
  return {
    timestamp: Date.now(),
    totalLimit: Math.max(0, init.totalLimit),
    totalUsed: Math.max(0, init.totalUsed),
    totalReserved: Math.max(0, init.totalReserved),
    remaining: Math.max(0, init.remaining),
    sections: init.sections.map((s) => ({ ...s })),
  };
}

/**
 * Builds a {@link FitResult} with mutually consistent length fields.
 */
export function createFitResult(
  init: Omit<FitResult, 'originalLength' | 'resultLength'> & {
    text: string;
    sourceText: string;
  },
): FitResult {
  return {
    section: init.section,
    text: init.text,
    truncated: init.truncated,
    status: init.status,
    limit: init.limit,
    usedTokens: init.usedTokens,
    remaining: init.remaining,
    originalLength: init.sourceText.length,
    resultLength: init.text.length,
  };
}

/**
 * Builds an "empty" {@link FitResult}: blank output for a section with no
 * room (or blank input).
 */
export function emptyFitResult(section: string, limit: number, sourceText: string): FitResult {
  return {
    section,
    text: '',
    truncated: sourceText.length > 0,
    status: sourceText.length === 0 ? 'empty' : 'trimmed',
    limit,
    usedTokens: 0,
    remaining: limit,
    originalLength: sourceText.length,
    resultLength: 0,
  };
}

/* ------------------------------------------------------------------------ *
 * Config normalization
 * ------------------------------------------------------------------------ */

/**
 * Merges a partial {@link BudgetConfig} with {@link DEFAULT_BUDGET_CONFIG}.
 *
 * The result is a fully-populated config that is always structurally valid.
 * Per-section ceilings are merged shallowly: an explicit `perSection` in the
 * input is layered over the defaults, so unlisted sections still fall back
 * to the default ceiling.
 */
export function normalizeBudgetConfig(
  input: Partial<BudgetConfig> = {},
): BudgetConfig {
  const mergedPerSection: Record<string, number> = {
    ...DEFAULT_BUDGET_CONFIG.perSection,
    ...(input.perSection ?? {}),
  };
  return {
    defaultLimit: input.defaultLimit ?? DEFAULT_BUDGET_CONFIG.defaultLimit!,
    perSection: mergedPerSection,
    maxTotal: input.maxTotal ?? DEFAULT_BUDGET_CONFIG.maxTotal,
    overrun: input.overrun ?? DEFAULT_BUDGET_CONFIG.overrun,
  };
}

/**
 * Resolves the effective ceiling for `section` under `config`.
 *
 * Precedence: an explicit `perSection` entry wins, then `defaultLimit`,
 * then the module-wide {@link DEFAULT_LIMIT}.
 */
export function sectionLimit(config: BudgetConfig, section: string): number {
  const explicit = config.perSection?.[section];
  if (explicit !== undefined && isFiniteNonNegative(explicit)) {
    return Math.floor(explicit);
  }
  if (config.defaultLimit !== undefined) {
    return Math.max(0, Math.floor(config.defaultLimit));
  }
  return DEFAULT_LIMIT;
}

/**
 * Resolves the global ceiling under `config`, or `Infinity` when unset.
 */
export function totalLimit(config: BudgetConfig): number {
  return config.maxTotal !== undefined ? Math.max(0, Math.floor(config.maxTotal)) : Infinity;
}

/**
 * Sums the `used` field of an iterable of allocations.
 */
export function sumUsed(allocations: Iterable<SectionAllocation>): number {
  let total = 0;
  for (const allocation of allocations) total += allocation.used;
  return total;
}

/**
 * Sums the `limit` field of an iterable of allocations.
 */
export function sumLimits(allocations: Iterable<SectionAllocation>): number {
  let total = 0;
  for (const allocation of allocations) total += allocation.limit;
  return total;
}

/**
 * Sums the `reserved` field of an iterable of allocations.
 */
export function sumReserved(allocations: Iterable<SectionAllocation>): number {
  let total = 0;
  for (const allocation of allocations) total += allocation.reserved ?? 0;
  return total;
}