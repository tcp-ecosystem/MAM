/**
 * @file types.ts
 * @module optimization/types
 *
 * Core domain types for the MAM Token Optimization **Optimization** layer.
 *
 * This layer orchestrates the full token-optimization pipeline. Given a
 * prompt (a list of {@link PromptSection}s), it:
 *
 *   1. **analyzes** the prompt — estimating the token cost of every section,
 *      computing the total, flagging sections that blow their budget and
 *      producing actionable {@link AnalysisResult.suggestions};
 *   2. **optimizes** the prompt — applying the configured strategies in a
 *      fixed order (reorder by priority, compress low-priority sections,
 *      dedupe repeated blocks, enforce a global token ceiling) and returning
 *      an {@link OptimizeResult} carrying the optimized text plus a savings
 *      report.
 *
 * This module is intentionally logic-free. It defines:
 *  - the shared data shapes ({@link PromptSection}, {@link AnalysisResult},
 *    {@link OptimizeResult}, {@link OptimizationConfig},
 *    {@link OptimizationStats}, {@link OptimizeOptions},
 *    {@link StrategyResult});
 *  - canonical constants ({@link SECTION_ROLES}, {@link STRATEGY_NAMES},
 *    {@link DEFAULT_OPTIMIZATION_CONFIG});
 *  - runtime type guards that validate untrusted input (JSON payloads,
 *    config files, plugin boundaries);
 *  - pure factories that construct well-formed instances with sane defaults;
 *  - pure helpers (priority normalization, budget resolution, strategy
 *    enablement) used by `store.ts`, `index.ts`, `retrieval.ts` and
 *    `lifecycle.ts` so every consumer agrees on the same vocabulary.
 *
 * @packageDocumentation
 */

/* ------------------------------------------------------------------------ *
 * Canonical vocabulary
 * ------------------------------------------------------------------------ */

/**
 * The canonical prompt-section roles the optimization engine understands.
 *
 * These mirror the usual chat-completion message roles plus the MAM-specific
 * memory and knowledge blocks. Custom roles are always accepted as plain
 * strings; the registry exists so guards and factories can reason about the
 * well-known ones.
 */
export const SECTION_ROLES = [
  'system',
  'user',
  'assistant',
  'tool',
  'memory',
  'knowledge',
] as const;

/**
 * A union of the canonical section roles. Plain `string` is accepted
 * everywhere so consumers can introduce custom roles without ceremony.
 */
export type SectionRole = (typeof SECTION_ROLES)[number];

/**
 * A `Set` view of {@link SECTION_ROLES} for O(1) membership checks.
 */
export const SECTION_ROLE_SET: ReadonlySet<string> = new Set(SECTION_ROLES);

/**
 * The strategies the optimizer can apply, in canonical application order.
 *
 * - `'reorder'`:  move high-priority sections (and the system directive)
 *                 to the front so the most important content lands first.
 * - `'compress'`: shrink low-priority sections by removing filler/hedge
 *                 language and redundant whitespace.
 * - `'dedupe'`:   drop repeated blocks of text across sections, keeping the
 *                 first occurrence.
 * - `'cache'`:    short-circuit the whole pipeline when an equivalent prompt
 *                 was already optimized (content-addressed lookup).
 */
export const STRATEGY_NAMES = ['compress', 'cache', 'reorder', 'dedupe'] as const;

/**
 * A union of the valid strategy names ({@link STRATEGY_NAMES} as a type).
 */
export type StrategyName = (typeof STRATEGY_NAMES)[number];

/**
 * A `Set` view of {@link STRATEGY_NAMES} for O(1) membership checks.
 */
export const STRATEGY_SET: ReadonlySet<string> = new Set(STRATEGY_NAMES);

/* ------------------------------------------------------------------------ *
 * Priority vocabulary
 * ------------------------------------------------------------------------ */

/**
 * Lowest valid priority value. Priority is on a 0..10 scale where higher
 * values mean "more important / more protected".
 */
export const PRIORITY_MIN = 0;

/**
 * Highest valid priority value. See {@link PRIORITY_MIN}.
 */
export const PRIORITY_MAX = 10;

/**
 * Priority assigned to a section that does not declare one. Neutral middle
 * ground: neither protected nor explicitly expendable.
 */
export const DEFAULT_PRIORITY = 5;

/**
 * Priority assigned (by convention) to the system directive. System
 * directives are protected from compression and truncation.
 */
export const SYSTEM_PRIORITY = 10;

/**
 * Priority assigned (by convention) to the user turn. User content is
 * important but slightly less protected than the system directive.
 */
export const USER_PRIORITY = 8;

/**
 * A human-readable label for a priority value. Helpful in reports and logs.
 */
export const PRIORITY_LABELS = ['minimum', 'low', 'normal', 'high', 'critical'] as const;

/**
 * A union of the human-readable priority labels ({@link PRIORITY_LABELS} as
 * a type).
 */
export type PriorityLabel = (typeof PRIORITY_LABELS)[number];

/**
 * Characters per token used by the default {@link OptimizeOptions.estimateTokens}
 * heuristic. ~4 characters per token is the de-facto industry estimate for
 * English prose; it is kept constant so estimates are reproducible.
 */
export const DEFAULT_CHARS_PER_TOKEN = 4;

/**
 * Separator used when joining optimized section content back into a single
 * prompt string.
 */
export const DEFAULT_SECTION_SEPARATOR = '\n\n';

/* ------------------------------------------------------------------------ *
 * Data shapes
 * ------------------------------------------------------------------------ */

/**
 * One logical part of a prompt.
 *
 * Sections are the unit of analysis and optimization: each carries a `role`
 * (system directive, user turn, tool result, memory block, ...), the actual
 * `content` text, an optional pre-computed `tokens` estimate and an optional
 * `priority` (0..10, higher = more important). An optional `id` makes a
 * section addressable inside per-section maps.
 */
export interface PromptSection {
  /** Optional stable identifier; used to key per-section accounting. */
  id?: string;
  /** The role of this section (canonical or custom). */
  role: string;
  /** The section's text content. */
  content: string;
  /**
   * Optional pre-computed token estimate. When present and valid, analysis
   * trusts it; otherwise the token count is estimated from `content`.
   */
  tokens?: number;
  /**
   * Importance on a 0..10 scale. Defaults to {@link DEFAULT_PRIORITY} when
   * absent. Higher priority sections are reordered earlier and protected
   * from compression/truncation.
   */
  priority?: number;
}

/**
 * Per-section budget limits, keyed by section `id` (or `role:index` when no
 * id is present). Each value is a token ceiling for that section.
 */
export type PerSectionBudget = Readonly<Record<string, number>>;

/**
 * Toggles for the four strategies. Absent entries inherit the defaults from
 * {@link DEFAULT_STRATEGY_CONFIG}.
 */
export interface StrategyConfig {
  /** Enable/disable content compression of low-priority sections. */
  compress?: boolean;
  /** Enable/disable content-addressed cache short-circuiting. */
  cache?: boolean;
  /** Enable/disable priority-based section reordering. */
  reorder?: boolean;
  /** Enable/disable removal of repeated blocks. */
  dedupe?: boolean;
}

/**
 * Immutable-by-convention configuration governing how optimization behaves.
 *
 * All fields are optional. Use {@link normalizeOptimizationConfig} to merge
 * a partial config over {@link DEFAULT_OPTIMIZATION_CONFIG}.
 */
export interface OptimizationConfig {
  /**
   * Global token ceiling across all sections combined. When set, the
   * optimizer truncates the lowest-priority content until the total fits.
   */
  maxTotalTokens?: number;
  /**
   * Per-section ceilings keyed by section `id` (or `role:index`). Sections
   * whose estimate exceeds their ceiling are flagged during analysis.
   */
  perSection?: PerSectionBudget;
  /** Per-strategy toggles; absent entries inherit the defaults. */
  strategies?: StrategyConfig;
  /**
   * Alias for `maxTotalTokens`. When both are present, `budget` wins. Kept
   * for callers that think in "budget" rather than "ceiling" terms.
   */
  budget?: number;
}

/**
 * The per-section token breakdown produced by {@link PromptOptimizer.analyze}.
 *
 * The object is keyed by the same keys used for `OptimizationConfig.perSection`
 * (`section.id`, or `role:index` for anonymous sections), so budgets and
 * measured usage align.
 */
export interface SectionUsageMap {
  /** Section key -> estimated (or trusted) token count. */
  [key: string]: number;
}

/**
 * Outcome of {@link PromptOptimizer.analyze}.
 *
 * Analysis is read-only: it estimates tokens, computes totals, flags
 * over-budget sections and produces suggestions, but never mutates the
 * input sections.
 */
export interface AnalysisResult {
  /** The analyzed sections, unchanged. */
  sections: PromptSection[];
  /** Sum of every section's token estimate. */
  totalTokens: number;
  /** Per-section token estimates keyed by section key. */
  perSection: SectionUsageMap;
  /**
   * Section keys whose estimate exceeds their budget ceiling. Absent when
   * nothing is over budget.
   */
  overBudget?: string[];
  /** Human-actionable suggestions derived from the analysis. */
  suggestions: string[];
}

/**
 * Outcome of {@link PromptOptimizer.optimize}.
 *
 * Carries the final optimized prompt text, the token accounting before and
 * after, the list of strategies that actually changed something, and the
 * post-optimization sections (so callers can re-serialize or re-analyze).
 */
export interface OptimizeResult {
  /** The fully optimized prompt, sections joined by a separator. */
  optimizedText: string;
  /** Total estimated tokens in the original input. */
  originalTokens: number;
  /** Total estimated tokens in the optimized output. */
  optimizedTokens: number;
  /** `originalTokens - optimizedTokens` (>= 0). */
  savedTokens: number;
  /** `savedTokens / originalTokens * 100`, clamped to 0..100. */
  savedPercent: number;
  /**
   * Names of the strategies that actually applied (subset of
   * {@link STRATEGY_NAMES}, plus `'truncate'` when the budget was enforced).
   */
  applied: string[];
  /** The post-optimization sections (reordered/compressed/deduped). */
  sections: PromptSection[];
  /**
   * Optional per-pass bookkeeping produced while optimizing. Present when
   * the optimizer is asked to retain it (see {@link OptimizeOptions.track}).
   */
  strategyDetails?: StrategyResult[];
}

/**
 * Per-strategy bookkeeping returned by the individual strategy passes.
 *
 * The optimizer accumulates one {@link StrategyResult} per enabled strategy
 * so callers can inspect exactly what each pass contributed (and what it
 * cost in tokens).
 */
export interface StrategyResult {
  /** The strategy name, e.g. `'compress'`. */
  name: string;
  /** `true` when this pass actually changed the sections. */
  applied: boolean;
  /** Estimated tokens in the sections before this pass. */
  originalTokens: number;
  /** Estimated tokens in the sections after this pass. */
  optimizedTokens: number;
  /** `originalTokens - optimizedTokens` for this pass alone. */
  savedTokens: number;
  /** Human-readable summary of what the pass did (or why it did nothing). */
  description: string;
}

/**
 * Options accepted by {@link PromptOptimizer.analyze} and
 * {@link PromptOptimizer.optimize}.
 *
 * Per-call overrides for the injectable estimator, budget and strategy
 * toggles. Everything is optional; the optimizer fills gaps from the
 * configured {@link OptimizationConfig}.
 */
export interface OptimizeOptions {
  /**
   * Injectable token estimator. Replaces the default characters-per-token
   * heuristic ({@link DEFAULT_CHARS_PER_TOKEN}). Useful for wiring a real
   * tokenizer (e.g. a model-specific BPE) behind the same pipeline.
   */
  estimateTokens?: (text: string) => number;
  /** Global token ceiling for this call (overrides config). */
  budget?: number;
  /** Alias for `budget` (overrides config's `maxTotalTokens`). */
  maxTotalTokens?: number;
  /** Per-strategy toggles for this call (merged over config). */
  strategies?: StrategyConfig;
  /**
   * Minimum token size a section must have before it is considered for
   * compression. Tiny sections are never worth rewriting.
   */
  compressMinTokens?: number;
  /**
   * Maximum priority a section may carry and still be compressed. Sections
   * above this priority are protected from compression.
   */
  compressMaxPriority?: number;
  /**
   * Minimum length (in characters) a repeated block must reach before it is
   * considered worth deduplicating.
   */
  dedupeMinBlockLength?: number;
  /**
   * Optional content-addressed cache. When provided and `cache` is enabled,
   * {@link PromptOptimizer.optimize} short-circuits on a cache hit.
   */
  cache?: { getFor(text: string): OptimizeResult | undefined };
  /** Separator used to join section content into the final prompt. */
  sectionSeparator?: string;
  /**
   * When `true`, {@link PromptOptimizer.optimize} attaches per-pass
   * {@link StrategyResult} bookkeeping to the result's `strategyDetails`.
   * Costs a little memory; off by default.
   */
  track?: boolean;
}

/**
 * Aggregate statistics over the optimizer's lifetime.
 *
 * Produced by {@link OptimizationLifecycle.stats} by combining the store's
 * cache counters with the optimizer's own counters.
 */
export interface OptimizationStats {
  /** Number of {@link PromptOptimizer.analyze} calls. */
  analyzed: number;
  /** Number of {@link PromptOptimizer.optimize} calls that ran in full. */
  optimized: number;
  /** Number of optimize calls short-circuited by the cache. */
  cached: number;
  /** Total original tokens seen across all optimizations. */
  totalOriginalTokens: number;
  /** Total optimized tokens produced. */
  totalOptimizedTokens: number;
  /** Total tokens saved (`totalOriginalTokens - totalOptimizedTokens`). */
  totalSavedTokens: number;
  /** Mean saved percent across all optimizations (0..100). */
  avgSavedPercent: number;
  /** Cache hits observed by the store. */
  cacheHits: number;
  /** Cache misses observed by the store. */
  cacheMisses: number;
}

/* ------------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------------ */

/**
 * Default per-strategy toggles. Every strategy starts enabled.
 */
export const DEFAULT_STRATEGY_CONFIG: Readonly<StrategyConfig> = {
  compress: true,
  cache: true,
  reorder: true,
  dedupe: true,
} as const;

/**
 * Default global token ceiling applied when nothing else is configured.
 */
export const DEFAULT_MAX_TOTAL_TOKENS = 8_192;

/**
 * Default per-section ceilings. The system directive and user turn get the
 * most headroom; memory is kept tightest because it is the most compressible.
 */
export const DEFAULT_PER_SECTION_BUDGET: Readonly<PerSectionBudget> = {
  system: 1024,
  tools: 1024,
  memory: 768,
  knowledge: 1024,
  user: 2048,
} as const;

/**
 * Canonical default configuration.
 *
 * All four strategies enabled, a global ceiling of
 * {@link DEFAULT_MAX_TOTAL_TOKENS} and per-section ceilings from
 * {@link DEFAULT_PER_SECTION_BUDGET}.
 */
export const DEFAULT_OPTIMIZATION_CONFIG: Readonly<OptimizationConfig> = {
  maxTotalTokens: DEFAULT_MAX_TOTAL_TOKENS,
  perSection: DEFAULT_PER_SECTION_BUDGET,
  strategies: DEFAULT_STRATEGY_CONFIG,
  budget: DEFAULT_MAX_TOTAL_TOKENS,
} as const;

/* ------------------------------------------------------------------------ *
 * Numeric helpers
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

/**
 * Clamps `value` into the inclusive `[min, max]` range, coercing NaN and
 * non-finite input to `min`.
 */
export function clampRange(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Clamps a percentage (0..100), coercing bad input to `0`.
 */
export function clampPercent(value: number): number {
  return clampRange(value, 0, 100);
}

/* ------------------------------------------------------------------------ *
 * Domain guards
 * ------------------------------------------------------------------------ */

/**
 * Returns `true` when `role` is a non-empty string. The canonical roles are
 * not required here so custom roles pass too.
 */
export function isSectionRole(role: unknown): role is string {
  return typeof role === 'string' && role.trim().length > 0;
}

/**
 * Returns `true` when `value` is a valid priority (finite, 0..10).
 */
export function isPriority(value: unknown): value is number {
  return isFiniteNumber(value) && value >= PRIORITY_MIN && value <= PRIORITY_MAX;
}

/**
 * Returns `true` when `value` is a well-formed {@link PromptSection}.
 */
export function isPromptSection(value: unknown): value is PromptSection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!isSectionRole(v['role'])) return false;
  if (typeof v['content'] !== 'string') return false;
  if (v['id'] !== undefined && (typeof v['id'] !== 'string' || v['id'].length === 0)) {
    return false;
  }
  if (v['tokens'] !== undefined && !isFiniteNonNegative(v['tokens'])) return false;
  if (v['priority'] !== undefined && !isPriority(v['priority'])) return false;
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link StrategyConfig}.
 */
export function isStrategyConfig(value: unknown): value is StrategyConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of STRATEGY_NAMES) {
    if (v[key] !== undefined && typeof v[key] !== 'boolean') return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a structurally valid {@link OptimizationConfig}.
 */
export function isOptimizationConfig(value: unknown): value is OptimizationConfig {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['maxTotalTokens'] !== undefined && !isFiniteNonNegative(v['maxTotalTokens'])) {
    return false;
  }
  if (v['budget'] !== undefined && !isFiniteNonNegative(v['budget'])) return false;
  if (v['perSection'] !== undefined) {
    if (typeof v['perSection'] !== 'object' || v['perSection'] === null) return false;
    for (const entry of Object.values(v['perSection'] as Record<string, unknown>)) {
      if (!isFiniteNonNegative(entry)) return false;
    }
  }
  if (v['strategies'] !== undefined && !isStrategyConfig(v['strategies'])) return false;
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link AnalysisResult}.
 */
export function isAnalysisResult(value: unknown): value is AnalysisResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v['sections'])) return false;
  if (!v['sections'].every((entry) => isPromptSection(entry))) return false;
  if (!isFiniteNonNegative(v['totalTokens'])) return false;
  if (typeof v['perSection'] !== 'object' || v['perSection'] === null) return false;
  for (const entry of Object.values(v['perSection'] as Record<string, unknown>)) {
    if (!isFiniteNonNegative(entry)) return false;
  }
  if (v['overBudget'] !== undefined && !Array.isArray(v['overBudget'])) return false;
  if (!Array.isArray(v['suggestions'])) return false;
  return v['suggestions'].every((entry) => typeof entry === 'string');
}

/**
 * Returns `true` when `value` is a well-formed {@link OptimizeResult}.
 */
export function isOptimizeResult(value: unknown): value is OptimizeResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['optimizedText'] !== 'string') return false;
  for (const key of ['originalTokens', 'optimizedTokens', 'savedTokens', 'savedPercent'] as const) {
    if (!isFiniteNonNegative(v[key])) return false;
  }
  if (!Array.isArray(v['applied'])) return false;
  if (!v['applied'].every((entry) => typeof entry === 'string')) return false;
  if (v['strategyDetails'] !== undefined && !Array.isArray(v['strategyDetails'])) return false;
  if (Array.isArray(v['strategyDetails']) && !v['strategyDetails'].every((entry) => isStrategyResult(entry))) {
    return false;
  }
  if (!Array.isArray(v['sections'])) return false;
  return v['sections'].every((entry) => isPromptSection(entry));
}

/**
 * Returns `true` when `value` is a well-formed {@link StrategyResult}.
 */
export function isStrategyResult(value: unknown): value is StrategyResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['name'] !== 'string') return false;
  if (typeof v['applied'] !== 'boolean') return false;
  if (!isFiniteNonNegative(v['originalTokens'])) return false;
  if (!isFiniteNonNegative(v['optimizedTokens'])) return false;
  if (!isFiniteNonNegative(v['savedTokens'])) return false;
  return typeof v['description'] === 'string';
}

/**
 * Returns `true` when `value` is a well-formed {@link OptimizationStats}.
 */
export function isOptimizationStats(value: unknown): value is OptimizationStats {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  for (const key of [
    'analyzed',
    'optimized',
    'cached',
    'totalOriginalTokens',
    'totalOptimizedTokens',
    'totalSavedTokens',
    'avgSavedPercent',
    'cacheHits',
    'cacheMisses',
  ] as const) {
    if (!isFiniteNonNegative(v[key])) return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a well-formed {@link OptimizeOptions}.
 */
export function isOptimizeOptions(value: unknown): value is OptimizeOptions {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['estimateTokens'] !== undefined && typeof v['estimateTokens'] !== 'function') {
    return false;
  }
  for (const key of ['budget', 'maxTotalTokens', 'compressMinTokens', 'dedupeMinBlockLength'] as const) {
    if (v[key] !== undefined && !isFiniteNonNegative(v[key])) return false;
  }
  if (v['compressMaxPriority'] !== undefined && !isPriority(v['compressMaxPriority'])) {
    return false;
  }
  if (v['strategies'] !== undefined && !isStrategyConfig(v['strategies'])) return false;
  if (v['sectionSeparator'] !== undefined && typeof v['sectionSeparator'] !== 'string') {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------------ *
 * Factories
 * ------------------------------------------------------------------------ */

/**
 * Builds a {@link PromptSection}, coercing priority into the valid 0..10
 * range and flooring any token estimate.
 */
export function createPromptSection(
  role: string,
  content: string,
  init: Partial<Pick<PromptSection, 'id' | 'tokens' | 'priority'>> = {},
): PromptSection {
  if (!isSectionRole(role)) {
    throw new TypeError(`Invalid section role: ${String(role)}`);
  }
  if (typeof content !== 'string') {
    throw new TypeError('Section content must be a string');
  }
  return {
    ...(init.id !== undefined ? { id: init.id } : {}),
    role,
    content,
    ...(init.tokens !== undefined ? { tokens: Math.max(0, Math.floor(init.tokens)) } : {}),
    ...(init.priority !== undefined ? { priority: normalizePriority(init.priority) } : {}),
  };
}

/**
 * Builds a {@link StrategyResult}, flooring negative token counts and
 * clamping `savedTokens` so it never goes below zero.
 */
export function createStrategyResult(
  init: Omit<StrategyResult, 'savedTokens'> & { savedTokens?: number },
): StrategyResult {
  return {
    name: init.name,
    applied: init.applied,
    originalTokens: Math.max(0, Math.floor(init.originalTokens)),
    optimizedTokens: Math.max(0, Math.floor(init.optimizedTokens)),
    savedTokens: Math.max(0, Math.floor(init.savedTokens ?? 0)),
    description: init.description,
  };
}

/**
 * Builds an {@link AnalysisResult}, clamping `totalTokens` and copying the
 * per-section map so later mutation of the input cannot leak in.
 */
export function createAnalysisResult(
  init: Omit<AnalysisResult, 'suggestions'> & { suggestions?: string[] },
): AnalysisResult {
  return {
    sections: init.sections.map((s) => ({ ...s })),
    totalTokens: Math.max(0, Math.floor(init.totalTokens)),
    perSection: { ...init.perSection },
    ...(init.overBudget !== undefined ? { overBudget: Array.from(init.overBudget) } : {}),
    suggestions: Array.from(init.suggestions ?? []),
  };
}

/**
 * Builds an {@link OptimizeResult} with mutually consistent savings fields.
 *
 * `savedTokens` and `savedPercent` are derived from `originalTokens` and
 * `optimizedTokens` so the three numbers can never disagree.
 */
export function createOptimizeResult(
  init: Omit<OptimizeResult, 'savedTokens' | 'savedPercent'>,
): OptimizeResult {
  const originalTokens = Math.max(0, Math.floor(init.originalTokens));
  const optimizedTokens = Math.max(0, Math.floor(init.optimizedTokens));
  const savedTokens = Math.max(0, originalTokens - optimizedTokens);
  const savedPercent = originalTokens > 0 ? clampPercent((savedTokens / originalTokens) * 100) : 0;
  return {
    optimizedText: init.optimizedText,
    originalTokens,
    optimizedTokens,
    savedTokens,
    savedPercent,
    applied: Array.from(init.applied),
    sections: init.sections.map((s) => ({ ...s })),
    ...(init.strategyDetails !== undefined
      ? { strategyDetails: init.strategyDetails.map((s) => ({ ...s })) }
      : {}),
  };
}

/**
 * Builds an {@link OptimizationStats} with all counters initialized to `0`
 * (or merged over the supplied `init`).
 */
export function createOptimizationStats(
  init: Partial<OptimizationStats> = {},
): OptimizationStats {
  return {
    analyzed: Math.max(0, init.analyzed ?? 0),
    optimized: Math.max(0, init.optimized ?? 0),
    cached: Math.max(0, init.cached ?? 0),
    totalOriginalTokens: Math.max(0, init.totalOriginalTokens ?? 0),
    totalOptimizedTokens: Math.max(0, init.totalOptimizedTokens ?? 0),
    totalSavedTokens: Math.max(0, init.totalSavedTokens ?? 0),
    avgSavedPercent: clampPercent(init.avgSavedPercent ?? 0),
    cacheHits: Math.max(0, init.cacheHits ?? 0),
    cacheMisses: Math.max(0, init.cacheMisses ?? 0),
  };
}

/**
 * An empty {@link AnalysisResult} for blank input: no sections, zero tokens,
 * no over-budget flags and a single informational suggestion.
 */
export function emptyAnalysisResult(): AnalysisResult {
  return {
    sections: [],
    totalTokens: 0,
    perSection: {},
    suggestions: ['Prompt contains no sections; nothing to analyze.'],
  };
}

/**
 * A zeroed {@link OptimizationStats} for a freshly constructed lifecycle.
 */
export function zeroedOptimizationStats(): OptimizationStats {
  return createOptimizationStats();
}

/* ------------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------------ */

/**
 * Coerces `priority` into the valid 0..10 range. Non-finite input falls back
 * to {@link DEFAULT_PRIORITY}.
 */
export function normalizePriority(priority: number): number {
  if (!Number.isFinite(priority)) return DEFAULT_PRIORITY;
  return clampRange(priority, PRIORITY_MIN, PRIORITY_MAX);
}

/**
 * Maps a priority to a human-readable {@link PriorityLabel}.
 *
 * - `10` -> `'critical'`
 * - `8`+ -> `'high'`
 * - `6`+ -> `'normal'`
 * - `3`+ -> `'low'`
 * - otherwise -> `'minimum'`
 */
export function priorityLabel(priority: number): PriorityLabel {
  const value = normalizePriority(priority);
  if (value >= SYSTEM_PRIORITY) return 'critical';
  if (value >= 8) return 'high';
  if (value >= 6) return 'normal';
  if (value >= 3) return 'low';
  return 'minimum';
}

/**
 * Returns the canonical key for a section: its `id` when present, otherwise
 * a `role:index` composite (anonymous sections stay addressable).
 */
export function sectionKey(section: PromptSection, index: number): string {
  if (section.id !== undefined && section.id.length > 0) return section.id;
  return `${section.role}:${index}`;
}

/**
 * Resolves the array index of the section that owns `key`, or `-1`.
 *
 * Used to map per-section budget/usage keys back to their section.
 */
export function indexOfSection(sections: Iterable<PromptSection>, key: string): number {
  let index = 0;
  for (const section of sections) {
    if (sectionKey(section, index) === key) return index;
    index += 1;
  }
  return -1;
}

/**
 * Sums the trusted-or-estimated token counts of every section.
 *
 * Uses `section.tokens` when it is a valid non-negative number, otherwise
 * falls back to the estimator. When no estimator is supplied the char-based
 * heuristic is used.
 */
export function totalTokens(
  sections: Iterable<PromptSection>,
  estimate: (text: string) => number = estimateFromText,
): number {
  let total = 0;
  let index = 0;
  for (const section of sections) {
    if (section.tokens !== undefined && isFiniteNonNegative(section.tokens)) {
      total += Math.floor(section.tokens);
    } else {
      total += Math.max(0, Math.floor(estimate(section.content)));
    }
    index += 1;
  }
  return total;
}

/**
 * Default char-based token estimator: `max(wordCount, ceil(chars / 4))`.
 * The word term is robust to long identifiers, the char term to
 * punctuation-heavy text.
 */
export function estimateFromText(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const byChars = Math.ceil(text.length / DEFAULT_CHARS_PER_TOKEN);
  return Math.max(words, byChars);
}

/**
 * Resolves the effective token ceiling for this call.
 *
 * Precedence: `options.budget`, `options.maxTotalTokens`, then
 * `config.budget`, then `config.maxTotalTokens`. Returns `undefined` when
 * nothing is configured (unbounded).
 */
export function resolveBudget(
  config: OptimizationConfig,
  options: OptimizeOptions = {},
): number | undefined {
  const candidate =
    options.budget ??
    options.maxTotalTokens ??
    config.budget ??
    config.maxTotalTokens;
  if (candidate === undefined) return undefined;
  return Math.max(0, Math.floor(candidate));
}

/**
 * Resolves whether strategy `name` is enabled, merging per-call options over
 * config over defaults. Returns `true` when nothing says otherwise.
 */
export function strategyEnabled(
  config: OptimizationConfig,
  options: OptimizeOptions,
  name: StrategyName,
): boolean {
  const fromOptions = options.strategies?.[name];
  if (fromOptions !== undefined) return fromOptions;
  const fromConfig = config.strategies?.[name];
  if (fromConfig !== undefined) return fromConfig;
  return DEFAULT_STRATEGY_CONFIG[name] ?? true;
}

/**
 * Merges a partial {@link OptimizationConfig} with
 * {@link DEFAULT_OPTIMIZATION_CONFIG}.
 *
 * Per-section ceilings and strategy toggles are merged shallowly, so a
 * caller that supplies one budget or toggle keeps every other default.
 */
export function normalizeOptimizationConfig(
  input: Partial<OptimizationConfig> = {},
): OptimizationConfig {
  return {
    maxTotalTokens:
      input.maxTotalTokens ?? input.budget ?? DEFAULT_OPTIMIZATION_CONFIG.maxTotalTokens,
    perSection: {
      ...DEFAULT_OPTIMIZATION_CONFIG.perSection,
      ...(input.perSection ?? {}),
    },
    strategies: {
      ...DEFAULT_OPTIMIZATION_CONFIG.strategies,
      ...(input.strategies ?? {}),
    },
    budget: input.budget ?? input.maxTotalTokens ?? DEFAULT_OPTIMIZATION_CONFIG.budget,
  };
}

/**
 * Resolves the effective ceiling for a section key under `config`.
 *
 * Precedence: an explicit `perSection` entry, else the global `budget` /
 * `maxTotalTokens` ceiling, else `undefined` (no per-section ceiling).
 */
export function sectionCeiling(config: OptimizationConfig, key: string): number | undefined {
  const explicit = config.perSection?.[key];
  if (explicit !== undefined && isFiniteNonNegative(explicit)) {
    return Math.floor(explicit);
  }
  return undefined;
}