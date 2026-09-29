/**
 * @file retrieval.ts
 * @module optimization/retrieval
 *
 * {@link PromptOptimizer}: the orchestration engine of the Optimization
 * layer.
 *
 * Where {@link OptimizationStore} is a neutral result cache and
 * {@link OptimizationIndex} is a read model, the optimizer owns the full
 * token-optimization pipeline:
 *
 *  - {@link analyze} — estimate every section's token cost (via an injectable
 *    estimator), compute the total, flag over-budget sections and produce
 *    actionable suggestions;
 *  - {@link optimize} — apply the enabled strategies in canonical order:
 *    **reorder** sections by priority (system first), **compress**
 *    low-priority sections, **dedupe** repeated blocks across sections, then
 *    **enforce** the global token ceiling by truncating the least-important
 *    content. The result carries the optimized text, the token accounting
 *    before/after, and the list of strategies that actually applied;
 *  - {@link estimateTokens} — the default characters-per-token heuristic;
 *  - {@link reorderSections} — pure priority ordering (priority desc, system
 *    first);
 *  - {@link savingsReport} — a human-readable summary string of a result.
 *
 * The optimizer is stateless (apart from its frozen configuration) and
 * performs no I/O; long-lived supervision and cache wiring live in the
 * {@link OptimizationLifecycle} (`lifecycle.ts`).
 *
 * @packageDocumentation
 */

import type {
  AnalysisResult,
  OptimizeOptions,
  OptimizeResult,
  OptimizationConfig,
  PromptSection,
  SectionUsageMap,
  StrategyResult,
} from './types.js';

import {
  DEFAULT_PRIORITY,
  DEFAULT_SECTION_SEPARATOR,
  DEFAULT_STRATEGY_CONFIG,
  USER_PRIORITY,
  clampPercent,
  createAnalysisResult,
  createOptimizeResult,
  createStrategyResult,
  createPromptSection,
  emptyAnalysisResult,
  estimateFromText,
  isFiniteNonNegative,
  isPriority,
  isPromptSection,
  normalizeOptimizationConfig,
  normalizePriority,
  resolveBudget,
  sectionCeiling,
  sectionKey,
  strategyEnabled,
} from './types.js';

/* ------------------------------------------------------------------------ *
 * Constants & estimation
 * ------------------------------------------------------------------------ */

/**
 * Characters per token used by the default {@link PromptOptimizer.estimateTokens}
 * heuristic (~4 chars per English token).
 */
export const CHARS_PER_TOKEN = 4;

/**
 * Default minimum token size a section must reach before compression will
 * consider rewriting it. Tiny sections are not worth the effort or risk.
 */
export const DEFAULT_COMPRESS_MIN_TOKENS = 48;

/**
 * Default maximum priority a section may carry and still be compressed.
 * Sections at or above {@link USER_PRIORITY} are protected.
 */
export const DEFAULT_COMPRESS_MAX_PRIORITY = USER_PRIORITY;

/**
 * Default minimum length (in characters) a repeated block must reach before
 * deduplication will drop later occurrences.
 */
export const DEFAULT_DEDUPE_MIN_BLOCK_LENGTH = 24;

/**
 * Filler / hedge words removed by the compression pass. The list is
 * deliberately conservative: each word is a common low-information filler
 * whose removal rarely changes meaning.
 */
export const FILLER_WORDS: readonly string[] = [
  'actually',
  'basically',
  'literally',
  'honestly',
  'frankly',
  'simply',
  'quite',
  'really',
  'very',
  'just',
  'obviously',
  'clearly',
  'definitely',
  'certainly',
  'essentially',
  'generally',
  'overall',
  'merely',
  'purely',
  'surely',
  'sort of',
  'kind of',
  'kinda',
  'sorta',
] as const;

/**
 * Token-estimation heuristic used by the optimizer.
 *
 * Without a real tokenizer (this library has no external dependencies) we
 * estimate with `max(wordCount, ceil(charCount / 4))`. The word term makes
 * the estimate robust to long unbroken identifiers; the character term makes
 * it robust to heavily-punctuated text.
 *
 * @param text - the text to estimate.
 * @returns a non-negative integer token estimate.
 */
export function estimateTokens(text: string): number {
  return estimateFromText(text);
}

/* ------------------------------------------------------------------------ *
 * Section ordering
 * ------------------------------------------------------------------------ */

/**
 * Returns a stable signature of a section list's *order*.
 *
 * Two lists have the same signature iff every section (role + priority +
 * content) appears in the same sequence. Used to detect whether a reorder
 * pass actually changed anything.
 */
function orderSignature(sections: readonly PromptSection[]): string {
  return sections
    .map((section) => {
      const priority = normalizePriority(section.priority ?? DEFAULT_PRIORITY);
      return `${section.role}\u0000${priority}\u0000${section.content}`;
    })
    .join('\u0001');
}

/**
 * Ranks a section for ordering: `0` for the system directive, `1` for the
 * user turn, `2` for everything else. Combined with priority this puts the
 * most important, most-protected sections first.
 */
function rankByRole(section: PromptSection): number {
  if (section.role === 'system') return 0;
  if (section.role === 'user') return 1;
  return 2;
}

/**
 * Sorts sections by priority descending, then by role (system first, then
 * user). The sort is stable, so sections with equal priority and role keep
 * their relative order.
 *
 * The input array is copied; the original is never mutated.
 */
export function reorderSections(sections: readonly PromptSection[]): PromptSection[] {
  const copy = Array.from(sections);
  return copy.sort((a, b) => {
    const byPriority = normalizePriority(b.priority ?? DEFAULT_PRIORITY) - normalizePriority(a.priority ?? DEFAULT_PRIORITY);
    if (byPriority !== 0) return byPriority;
    return rankByRole(a) - rankByRole(b);
  });
}

/* ------------------------------------------------------------------------ *
 * Text helpers
 * ------------------------------------------------------------------------ */

/**
 * Splits `text` into sentence-ish blocks (terminated by `.`, `!`, `?` or a
 * line break). Used by deduplication and truncation to operate on
 * meaning-bearing units rather than raw character slices.
 */
export function splitSentences(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const matches = text.match(/[^.!?\n]+[.!?]+(?:['")\]]+)?|[^.!?\n]+$/g);
  return matches ?? [text];
}

/**
 * Joins section content into a single prompt string.
 */
export function joinSections(
  sections: readonly PromptSection[],
  separator: string = DEFAULT_SECTION_SEPARATOR,
): string {
  return sections
    .map((section) => section.content)
    .filter((content) => content.length > 0)
    .join(separator);
}

/**
 * Sums the estimated tokens of every section, always using the estimator
 * (never trusting a possibly-stale `section.tokens`).
 */
function sumTokens(sections: readonly PromptSection[], estimate: (text: string) => number): number {
  let total = 0;
  for (const section of sections) {
    total += Math.max(0, Math.floor(estimate(section.content)));
  }
  return total;
}

/**
 * Escapes regex metacharacters in a plain string so it can be embedded in a
 * `new RegExp(...)` safely.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ------------------------------------------------------------------------ *
 * Optimizer
 * ------------------------------------------------------------------------ */

/**
 * Configuration for the optimizer's estimation defaults.
 */
export interface OptimizerOptions {
  /**
   * Characters-per-token factor used by the default estimator when the
   * caller does not inject one. Defaults to {@link CHARS_PER_TOKEN}.
   */
  charsPerToken?: number;
}

/**
 * The orchestration engine of the token-optimization pipeline.
 *
 * Construct with a partial {@link OptimizationConfig}; the remainder is
 * filled from the defaults. The instance is safe to share across the prompt
 * assembly pipeline because it holds no mutable state beyond its frozen
 * configuration.
 */
export class PromptOptimizer {
  /** Normalized (fully-populated) configuration. */
  private readonly _config: OptimizationConfig;
  /** Characters per token for the default estimator. */
  private readonly _charsPerToken: number;

  /**
   * Creates an optimizer.
   *
   * @param config - partial optimization config; merged over the defaults.
   * @param options - estimator tuning ({@link OptimizerOptions}).
   */
  constructor(config: Partial<OptimizationConfig> = {}, options: OptimizerOptions = {}) {
    this._config = normalizeOptimizationConfig(config);
    const factor = options.charsPerToken ?? CHARS_PER_TOKEN;
    this._charsPerToken = Number.isFinite(factor) && factor > 0 ? factor : CHARS_PER_TOKEN;
  }

  /* -------------------------------------------------------------------- *
   * Accessors
   * -------------------------------------------------------------------- */

  /**
   * The normalized configuration in force.
   */
  get config(): OptimizationConfig {
    return this._config;
  }

  /**
   * The characters-per-token factor used by the default estimator.
   */
  get charsPerToken(): number {
    return this._charsPerToken;
  }

  /* -------------------------------------------------------------------- *
   * Estimation
   * -------------------------------------------------------------------- */

  /**
   * Default token-estimation heuristic (chars-per-token).
   *
   * `max(wordCount, ceil(chars / charsPerToken))`. This is the estimator
   * used when the caller does not inject one via {@link OptimizeOptions}.
   *
   * @param text - the text to estimate.
   * @returns a non-negative integer token estimate.
   */
  estimateTokens(text: string): number {
    if (typeof text !== 'string' || text.length === 0) return 0;
    const words = text.split(/\s+/).filter(Boolean).length;
    const byChars = Math.ceil(text.length / this._charsPerToken);
    return Math.max(words, byChars);
  }

  /* -------------------------------------------------------------------- *
   * Analysis
   * -------------------------------------------------------------------- */

  /**
   * Analyzes a prompt without mutating anything.
   *
   * Every section's token cost is estimated with the injectable estimator
   * (falling back to {@link estimateTokens}); totals are summed; sections
   * whose estimate exceeds their per-section ceiling are flagged in
   * `overBudget`; and a list of actionable suggestions is generated.
   *
   * @param sections - the prompt sections to analyze.
   * @param options - per-call overrides ({@link OptimizeOptions}).
   * @returns an {@link AnalysisResult}.
   */
  analyze(sections: readonly PromptSection[], options: OptimizeOptions = {}): AnalysisResult {
    const estimate = options.estimateTokens ?? ((text: string): number => this.estimateTokens(text));
    const source = Array.from(sections).filter((section) => isPromptSection(section));
    if (source.length === 0) return emptyAnalysisResult();

    const perSection: SectionUsageMap = {};
    const overBudget: string[] = [];
    let totalTokens = 0;

    source.forEach((section, index) => {
      const tokens = Math.max(0, Math.floor(estimate(section.content)));
      const key = sectionKey(section, index);
      perSection[key] = tokens;
      totalTokens += tokens;
      const ceiling = sectionCeiling(this._config, key);
      if (ceiling !== undefined && tokens > ceiling) overBudget.push(key);
    });

    return createAnalysisResult({
      sections: source,
      totalTokens,
      perSection,
      overBudget: overBudget.length > 0 ? overBudget : undefined,
      suggestions: this.generateSuggestions({
        sections: source,
        totalTokens,
        perSection,
        overBudget: overBudget.length > 0 ? overBudget : undefined,
        suggestions: [],
      }),
    });
  }

  /* -------------------------------------------------------------------- *
   * Optimization
   * -------------------------------------------------------------------- */

  /**
   * Optimizes a prompt by applying the enabled strategies in canonical
   * order:
   *
   * 1. **cache** — when enabled and a cache is supplied, a content-addressed
   *    lookup short-circuits the pipeline entirely;
   * 2. **reorder** — sections are sorted by priority (system first);
   * 3. **compress** — low-priority sections above `compressMinTokens` have
   *    filler words, duplicated whitespace and redundant punctuation
   *    removed;
   * 4. **dedupe** — repeated sentence blocks across sections are dropped,
   *    keeping the first occurrence;
   * 5. **truncate** — when a global ceiling is configured, the
   *    lowest-priority content is trimmed at word boundaries until the total
   *    fits.
   *
   * `applied` reports which strategies actually changed something.
   *
   * @param sections - the prompt sections to optimize.
   * @param options - per-call overrides ({@link OptimizeOptions}).
   * @returns an {@link OptimizeResult} with the optimized text and savings.
   */
  optimize(sections: readonly PromptSection[], options: OptimizeOptions = {}): OptimizeResult {
    const estimate = options.estimateTokens ?? ((text: string): number => this.estimateTokens(text));
    const separator = options.sectionSeparator ?? DEFAULT_SECTION_SEPARATOR;
    const track = options.track === true;
    const source = Array.from(sections).filter((section) => isPromptSection(section));
    const originalTokens = sumTokens(source, estimate);

    if (source.length === 0 || originalTokens === 0) {
      return createOptimizeResult({
        optimizedText: '',
        originalTokens,
        optimizedTokens: 0,
        applied: [],
        sections: [],
      });
    }

    const strategyResults: StrategyResult[] = [];

    // 1. Content-addressed cache short-circuit.
    if (strategyEnabled(this._config, options, 'cache') && options.cache) {
      const probe = joinSections(source, separator);
      const cached = options.cache.getFor(probe);
      if (cached && isOptimizeResultLike(cached)) {
        const applied = cached.applied.includes('cache') ? cached.applied : ['cache', ...cached.applied];
        return { ...cached, applied };
      }
    }

    // Work on copies; drop any stale pre-computed token counts so the
    // estimator stays authoritative.
    let working: PromptSection[] = source.map((section) => {
      const { tokens: _stale, ...rest } = section;
      return rest;
    });
    const applied: string[] = [];

    // 2. Reorder by priority (system first).
    if (strategyEnabled(this._config, options, 'reorder')) {
      const beforeSignature = orderSignature(working);
      const beforeTokens = sumTokens(working, estimate);
      const reordered = reorderSections(working);
      const changed = orderSignature(reordered) !== beforeSignature;
      if (track) {
        strategyResults.push(
          createStrategyResult({
            name: 'reorder',
            applied: changed,
            originalTokens: beforeTokens,
            optimizedTokens: beforeTokens,
            description: changed
              ? 'Reordered sections by priority (system first).'
              : 'Section order already optimal; nothing to reorder.',
          }),
        );
      }
      if (changed) {
        working = reordered;
        applied.push('reorder');
      }
    }

    // 3. Compress low-priority sections.
    if (strategyEnabled(this._config, options, 'compress')) {
      const minTokens = options.compressMinTokens ?? DEFAULT_COMPRESS_MIN_TOKENS;
      const maxPriority = options.compressMaxPriority ?? DEFAULT_COMPRESS_MAX_PRIORITY;
      const beforeTokens = sumTokens(working, estimate);
      const compressed = this._compressSections(working, estimate, minTokens, maxPriority);
      const afterTokens = sumTokens(compressed, estimate);
      const removed = beforeTokens - afterTokens;
      const changed = removed > 0;
      if (track) {
        strategyResults.push(
          createStrategyResult({
            name: 'compress',
            applied: changed,
            originalTokens: beforeTokens,
            optimizedTokens: afterTokens,
            savedTokens: removed,
            description: changed
              ? `Removed ~${removed} tokens of filler words and redundant whitespace.`
              : 'No compressible content found under the thresholds.',
          }),
        );
      }
      if (changed) {
        working = compressed;
        applied.push('compress');
      }
    }

    // 4. Dedupe repeated blocks across sections.
    if (strategyEnabled(this._config, options, 'dedupe')) {
      const minBlockLength = options.dedupeMinBlockLength ?? DEFAULT_DEDUPE_MIN_BLOCK_LENGTH;
      const beforeTokens = sumTokens(working, estimate);
      const deduped = this._dedupeSections(working, minBlockLength);
      const afterTokens = sumTokens(deduped, estimate);
      const removed = beforeTokens - afterTokens;
      const changed = removed > 0;
      if (track) {
        strategyResults.push(
          createStrategyResult({
            name: 'dedupe',
            applied: changed,
            originalTokens: beforeTokens,
            optimizedTokens: afterTokens,
            savedTokens: removed,
            description: changed
              ? `Dropped ~${removed} tokens of duplicated content.`
              : 'No repeated blocks found; nothing to deduplicate.',
          }),
        );
      }
      if (changed) {
        working = deduped;
        applied.push('dedupe');
      }
    }

    // 5. Enforce the global token ceiling via truncation.
    const budget = resolveBudget(this._config, options);
    if (budget !== undefined) {
      const beforeTokens = sumTokens(working, estimate);
      const bounded = this._enforceBudget(working, budget, estimate);
      const afterTokens = sumTokens(bounded, estimate);
      const removed = beforeTokens - afterTokens;
      const changed = afterTokens < beforeTokens;
      if (track) {
        strategyResults.push(
          createStrategyResult({
            name: 'truncate',
            applied: changed,
            originalTokens: beforeTokens,
            optimizedTokens: afterTokens,
            savedTokens: removed,
            description: changed
              ? `Truncated low-priority content to fit the ${budget}-token ceiling.`
              : 'Prompt already within the global token ceiling.',
          }),
        );
      }
      if (changed) {
        working = bounded;
        applied.push('truncate');
      }
    }

    const optimizedTokens = sumTokens(working, estimate);
    const result = createOptimizeResult({
      optimizedText: joinSections(working, separator),
      originalTokens,
      optimizedTokens,
      applied,
      sections: working,
    });
    if (track && strategyResults.length > 0) {
      result.strategyDetails = strategyResults;
    }
    return result;
  }

  /* -------------------------------------------------------------------- *
   * Suggestions
   * -------------------------------------------------------------------- */

  /**
   * Generates actionable, human-readable suggestions from an
   * {@link AnalysisResult}.
   *
   * The suggestions are heuristic but grounded in the analysis numbers:
   * over-budget sections, an over-ceiling total, an abundance of sections
   * (dedupe opportunity) and low average priority (reorder opportunity).
   *
   * @param analysis - the analysis to advise on.
   * @returns a list of suggestion strings (may be empty).
   */
  generateSuggestions(analysis: AnalysisResult): string[] {
    const suggestions: string[] = [];
    const overBudget = analysis.overBudget ?? [];

    if (overBudget.length > 0) {
      suggestions.push(
        `Section${overBudget.length > 1 ? 's' : ''} ${overBudget
          .map((key) => `"${key}"`)
          .join(', ')} exceed${overBudget.length > 1 ? '' : 's'} its budget; consider compressing it or raising its per-section ceiling.`,
      );
    }

    const ceiling = resolveBudget(this._config, {});
    if (ceiling !== undefined && analysis.totalTokens > ceiling) {
      suggestions.push(
        `Total ${analysis.totalTokens} tokens exceeds the ${ceiling}-token ceiling; enable compression and dedupe, or reduce input size.`,
      );
    }

    if (analysis.sections.length >= 4) {
      suggestions.push(
        `Prompt has ${analysis.sections.length} sections; enable deduplication to drop repeated blocks across them.`,
      );
    }

    const averagePriority =
      analysis.sections.length > 0
        ? analysis.sections.reduce(
            (sum, section) => sum + normalizePriority(section.priority ?? DEFAULT_PRIORITY),
            0,
          ) / analysis.sections.length
        : DEFAULT_PRIORITY;
    if (averagePriority < DEFAULT_PRIORITY && analysis.sections.length > 1) {
      suggestions.push(
        'Sections skew low-priority on average; reordering by priority (system first) will place the important content early.',
      );
    }

    if (analysis.totalTokens > 0 && analysis.totalTokens < 128) {
      suggestions.push('Prompt is small; further optimization is unlikely to yield meaningful savings.');
    }

    return suggestions;
  }

  /* -------------------------------------------------------------------- *
   * Report
   * -------------------------------------------------------------------- */

  /**
   * Produces a human-readable summary string of an {@link OptimizeResult}.
   *
   * @example
   * ```text
   * Optimization Report
   * ==================
   * Original:      8,192 tokens
   * Optimized:     4,096 tokens
   * Saved:         4,096 tokens (50.0%)
   * Applied:       reorder, compress, dedupe
   * Sections:      5
   * ```
   */
  savingsReport(result: OptimizeResult): string {
    const applied = result.applied.length > 0 ? result.applied.join(', ') : 'none';
    const lines = [
      'Optimization Report',
      '==================',
      `Original:      ${result.originalTokens.toLocaleString('en-US')} tokens`,
      `Optimized:     ${result.optimizedTokens.toLocaleString('en-US')} tokens`,
      `Saved:         ${result.savedTokens.toLocaleString('en-US')} tokens (${result.savedPercent.toFixed(1)}%)`,
      `Applied:       ${applied}`,
      `Sections:      ${result.sections.length}`,
    ];
    if (result.strategyDetails && result.strategyDetails.length > 0) {
      lines.push('');
      lines.push('Per-strategy:');
      for (const detail of result.strategyDetails) {
        lines.push(`  - ${detail.name}: ${detail.applied ? 'applied' : 'skipped'} (${detail.savedTokens} tokens saved) — ${detail.description}`);
      }
    }
    return lines.join('\n');
  }

  /* -------------------------------------------------------------------- *
   * Strategy passes (internal)
   * -------------------------------------------------------------------- */

  /**
   * Compresses every section that is large enough (`>= minTokens`) and
   * expendable enough (`priority <= maxPriority`).
   *
   * The compressor removes filler words, collapses redundant whitespace and
   * normalizes duplicated punctuation. Sections that end up identical to
   * their input are returned untouched.
   */
  private _compressSections(
    sections: readonly PromptSection[],
    estimate: (text: string) => number,
    minTokens: number,
    maxPriority: number,
  ): PromptSection[] {
    const compressible = Math.max(0, Math.floor(minTokens));
    return sections.map((section) => {
      const tokens = estimate(section.content);
      const priority = normalizePriority(section.priority ?? DEFAULT_PRIORITY);
      if (tokens < compressible) return section;
      if (isPriority(priority) && priority > maxPriority) return section;
      const compressed = this._compressText(section.content);
      if (compressed === section.content) return section;
      return { ...section, content: compressed };
    });
  }

  /**
   * Removes filler words, collapses whitespace runs and normalizes
   * punctuation. Returns the transformed text (identical to input when
   * nothing changed).
   */
  private _compressText(text: string): string {
    let out = text;
    for (const word of FILLER_WORDS) {
      out = out.replace(new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi'), '');
    }
    out = out.replace(/[ \t]+/g, ' ');
    out = out.replace(/\n{3,}/g, '\n\n');
    out = out.replace(/ *\n */g, '\n');
    out = out.replace(/([!?.,;:])\1+/g, '$1');
    out = out.replace(/\s+([,.!?;:])/g, '$1');
    out = out.trim();
    return out;
  }

  /**
   * Removes repeated sentence blocks across sections, keeping the first
   * occurrence. Blocks shorter than `minBlockLength` characters are never
   * considered (too risky to deduplicate).
   */
  private _dedupeSections(
    sections: readonly PromptSection[],
    minBlockLength: number,
  ): PromptSection[] {
    const threshold = Math.max(1, Math.floor(minBlockLength));
    const seen = new Set<string>();
    return sections.map((section) => {
      const blocks = splitSentences(section.content);
      const kept: string[] = [];
      for (const block of blocks) {
        const normalized = block.trim().replace(/\s+/g, ' ');
        if (normalized.length >= threshold) {
          if (seen.has(normalized)) continue;
          seen.add(normalized);
        }
        kept.push(block);
      }
      const content = kept.join('');
      if (content === section.content) return section;
      return { ...section, content };
    });
  }

  /**
   * Truncates the lowest-priority content until the combined token total
   * fits within `budget`.
   *
   * Truncation is iterative: each pass removes (up to) `excess * charsPerToken`
   * characters from the single lowest-priority non-empty section, cutting at
   * a word boundary and appending an ellipsis. Sections that cannot yield
   * further savings are emptied to guarantee progress.
   */
  private _enforceBudget(
    sections: readonly PromptSection[],
    budget: number,
    estimate: (text: string) => number,
  ): PromptSection[] {
    const ceiling = Math.max(0, Math.floor(budget));
    const working = sections.map((section) => ({ ...section }));
    let total = sumTokens(working, estimate);
    if (total <= ceiling) return working;

    let guard = 0;
    while (total > ceiling && guard < 4096) {
      guard += 1;
      const target = this._lowestPriorityIndex(working);
      if (target === -1) break;
      const section = working[target];
      if (!section || section.content.length === 0) break;

      const beforeTokens = Math.max(0, Math.floor(estimate(section.content)));
      const excess = total - ceiling;
      const maxChars = Math.max(1, Math.ceil(excess * this._charsPerToken));
      const kept = this._truncateAtBoundary(section.content, maxChars);
      const afterTokens = Math.max(0, Math.floor(estimate(kept)));
      const delta = beforeTokens - afterTokens;
      section.content = kept;
      total = Math.max(0, total - delta);

      if (delta <= 0) {
        // The section yielded nothing (e.g. a single unbreakable word).
        // Empty it outright to guarantee forward progress.
        total = Math.max(0, total - beforeTokens);
        section.content = '';
      }
    }
    return working;
  }

  /**
   * Truncates `text` to at most `maxChars` code units, cutting at the last
   * whitespace boundary strictly below `maxChars` and appending an ellipsis
   * when content remains.
   */
  private _truncateAtBoundary(text: string, maxChars: number): string {
    const safeMax = Math.max(0, Math.floor(maxChars));
    if (text.length <= safeMax) return text;
    if (safeMax === 0) return '';
    let cut = safeMax;
    while (cut > 0 && !/\s/.test(text[cut - 1]!)) cut -= 1;
    if (cut === 0) cut = safeMax;
    const kept = text.slice(0, cut).trimEnd();
    return kept.length > 0 ? `${kept}…` : '';
  }

  /**
   * Returns the index of the lowest-priority section with non-empty content,
   * or `-1` when every section is empty.
   */
  private _lowestPriorityIndex(sections: readonly PromptSection[]): number {
    let lowest = -1;
    let lowestPriority = Infinity;
    sections.forEach((section, index) => {
      if (section.content.length === 0) return;
      const priority = normalizePriority(section.priority ?? DEFAULT_PRIORITY);
      if (priority < lowestPriority) {
        lowestPriority = priority;
        lowest = index;
      }
    });
    return lowest;
  }
}

/* ------------------------------------------------------------------------ *
 * Module-level helpers & factories
 * ------------------------------------------------------------------------ */

/**
 * Structural sanity check for a cache hit: the cached object must look like
 * an {@link OptimizeResult} (has the expected scalar fields). Used to guard
 * against a cache returning junk.
 */
function isOptimizeResultLike(value: unknown): value is OptimizeResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['optimizedText'] === 'string' &&
    isFiniteNonNegative(v['originalTokens']) &&
    isFiniteNonNegative(v['optimizedTokens']) &&
    Array.isArray(v['applied']) &&
    Array.isArray(v['sections'])
  );
}

/**
 * Convenience factory mirroring the constructor for fluent one-liners.
 */
export function createOptimizer(
  config: Partial<OptimizationConfig> = {},
  options: OptimizerOptions = {},
): PromptOptimizer {
  return new PromptOptimizer(config, options);
}

/**
 * Convenience: builds a single {@link PromptSection} for a one-off analysis
 * or optimization without importing the factory directly.
 */
export function section(
  role: string,
  content: string,
  init: Partial<Pick<PromptSection, 'id' | 'tokens' | 'priority'>> = {},
): PromptSection {
  return createPromptSection(role, content, init);
}