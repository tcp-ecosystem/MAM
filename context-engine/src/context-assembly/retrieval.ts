/**
 * ContextAssembler — the ordering and budgeting engine of the Context Assembly
 * layer of the standalone MAM Context Engine.
 *
 * This class turns an unordered pile of {@link ContextPart}s into one
 * {@link AssembledContext}: a deduplicated, ordered, budget-aware list of
 * parts plus the final prompt string. It is the pure "brain" of the layer —
 * it holds no state of its own beyond its configuration and its rolling
 * counters, so it is trivially testable and reusable across stores.
 *
 * The assembly pipeline, in order:
 *
 * 1. **Collect** — the caller's parts (raw {@link PartInput}s or canonical
 *    {@link ContextPart}s) are gathered and canonicalised.
 * 2. **Filter** — parts whose role is excluded by `includeRoles` are dropped.
 * 3. **Dedupe** — parts whose {@link partHash} collides are collapsed to their
 *    first occurrence, so the same memory or tool result never appears twice.
 * 4. **Order** — parts are sorted by role priority (system first, examples,
 *    knowledge, memory, then the live turns) with explicit per-part `order`
 *    values as tie-breakers. See {@link AssemblyConfig.ordering}.
 * 5. **Budget** — when `maxTokens` is set and the ordered parts overflow it,
 *    the lowest-retention parts (memory, then tool results) are trimmed first
 *    while protected roles (system by default) are always kept.
 * 6. **Render** — the survivors are concatenated into a prompt string with
 *    role markers (`<|system|>`, `<|user|>`, ...) via {@link render}.
 *
 * Every step is configurable per-call through {@link AssembleOptions}, which
 * override the constructor-time {@link AssemblyConfig} for a single pass.
 *
 * @packageDocumentation
 * @module context-assembly/retrieval
 */

import {
  DEFAULT_SEPARATOR,
  ROLE_MARKERS,
  createPart,
  emptyRoleCounts,
  estimateTokens,
  mergeConfig,
  partHash,
  resolveRetention,
  resolveRolePriority,
} from './types.js';
import type {
  AssembledContext,
  AssemblyConfig,
  AssemblyStats,
  AssembleOptions,
  ContextPart,
  ContextRole,
  PartId,
  PartInput,
  Timestamp,
} from './types.js';

/**
 * Options accepted by {@link ContextAssembler.buildPrompt}.
 *
 * These affect only prompt string construction, not the part selection that
 * `assemble` performs.
 */
export interface BuildPromptOptions {
  /**
   * Separator placed between rendered parts. Defaults to the configured
   * `separator` (which defaults to `'\n\n'`).
   */
  readonly separator?: string;

  /**
   * Optional custom per-part renderer. When set, it replaces the default
   * marker-based {@link ContextAssembler.render}.
   */
  readonly labeler?: (part: ContextPart) => string;
}

/**
 * Rolling aggregate counters describing an assembler's lifetime behaviour.
 *
 * Returned by {@link ContextAssembler.totals}. These accumulate across every
 * `assemble` call and are useful for monitoring, evals and diagnostics.
 */
export interface AssemblerTotals {
  /**
   * Number of `assemble` passes executed.
   */
  readonly passes: number;

  /**
   * Total candidate parts supplied across all passes (before dedupe/trim).
   */
  readonly parts: number;

  /**
   * Total parts removed by deduplication across all passes.
   */
  readonly deduped: number;

  /**
   * Total parts removed by budget trimming across all passes.
   */
  readonly trimmed: number;

  /**
   * Epoch-ms time of the most recent pass, or `null` if none has run.
   */
  readonly lastAssembledAt: Timestamp | null;

  /**
   * Duration in ms of the most recent pass, or `null` if none has run.
   */
  readonly lastTookMs: number | null;
}

/**
 * The canonical context assembler.
 *
 * Construct with an optional {@link AssemblyConfig}, then call
 * {@link assemble} with a batch of parts. The class is immutable with respect
 * to its configuration (per-call overrides never mutate the instance).
 *
 * @example
 * ```ts
 * const assembler = new ContextAssembler({ maxTokens: 2048 });
 * const result = assembler.assemble({
 *   parts: [
 *     { id: 's', role: 'system', content: 'Be concise.' },
 *     { id: 'm1', role: 'memory', content: 'User prefers bullet points.' },
 *     { id: 'u', role: 'user', content: 'List the changes.' },
 *   ],
 * });
 * console.log(result.prompt);
 * // <|system|>
 * // Be concise.
 * // ...
 * ```
 */
export class ContextAssembler {
  /**
   * Effective configuration (constructor config merged over defaults).
   */
  private readonly config: AssemblyConfig;

  /**
   * Clock used for timestamps; injectable for deterministic tests.
   */
  private readonly now: () => Timestamp;

  /**
   * Rolling counters for {@link totals}. Mutable internally; exposed as a
   * fresh copy through {@link totals}.
   */
  private readonly counters: {
    passes: number;
    parts: number;
    deduped: number;
    trimmed: number;
    lastAssembledAt: Timestamp | null;
    lastTookMs: number | null;
  } = {
    passes: 0,
    parts: 0,
    deduped: 0,
    trimmed: 0,
    lastAssembledAt: null,
    lastTookMs: null,
  };

  /**
   * The most recent pass's statistics, for {@link stats}.
   */
  private lastStats: AssemblyStats | null = null;

  /**
   * Construct an assembler.
   *
   * @param config - optional construction-time configuration. Every field is
   *   optional; sensible defaults produce an ordered, deduped, unbounded
   *   prompt from any input.
   */
  constructor(config: AssemblyConfig = {}) {
    this.config = mergeConfig(config);
    this.now = this.config.now ?? (() => Date.now());
  }

  /**
   * Assemble a batch of parts into an {@link AssembledContext}.
   *
   * Runs the full pipeline: collect → canonicalise → role-filter → dedupe →
   * sort → budget-trim → render. Per-call {@link AssembleOptions} override
   * the constructor configuration for this pass only.
   *
   * @param options - the parts to assemble plus optional per-call overrides
   * @returns the assembled context (parts, tokens, prompt, stats)
   */
  assemble(options: AssembleOptions = {}): AssembledContext {
    const started = this.now();
    const effective = mergeConfig(this.config, this.toConfig(options));
    const parts = this.collect(options.parts ?? []);
    let candidates = parts.length;

    let kept = parts;
    const includeRoles = effective.includeRoles;
    if (includeRoles && includeRoles.length > 0) {
      const allowed = new Set(includeRoles);
      kept = kept.filter((part) => allowed.has(part.role));
    }

    let deduped = 0;
    if (effective.dedupe !== false) {
      const before = kept.length;
      kept = this.dedupe(kept);
      deduped = before - kept.length;
    }

    kept = this.sortParts(kept);

    let trimmed = 0;
    const maxTokens = effective.maxTokens ?? 0;
    if (maxTokens > 0) {
      const before = kept.length;
      kept = this.trimToBudget(kept, maxTokens, effective.protectRoles ?? []);
      trimmed = before - kept.length;
    }

    const tokens = kept.reduce((sum, part) => sum + this.tokens(part), 0);
    const roleCounts = emptyRoleCounts();
    for (const part of kept) {
      roleCounts[part.role] += 1;
    }

    let prompt: string | undefined;
    let promptTokens = 0;
    if (options.buildPrompt !== false) {
      prompt = this.buildPrompt(kept, {
        separator: effective.separator,
        labeler: effective.labeler,
      });
      promptTokens = estimateTokens(prompt);
    }

    const at = this.now();
    const stats: AssemblyStats = {
      parts: kept.length,
      candidates,
      totalTokens: tokens,
      promptTokens,
      deduped,
      trimmed,
      roleCounts,
      at,
      tookMs: at - started,
    };

    this.counters.passes += 1;
    this.counters.parts += candidates;
    this.counters.deduped += deduped;
    this.counters.trimmed += trimmed;
    this.counters.lastAssembledAt = at;
    this.counters.lastTookMs = stats.tookMs;
    this.lastStats = stats;

    return { parts: kept, tokens, prompt, stats };
  }

  /**
   * Build a prompt string from a set of parts.
   *
   * Concatenates each part's rendered fragment (marker + content, or the
   * configured `labeler` output) joined by the configured separator.
   *
   * @param parts - the parts to render
   * @param options - optional per-call rendering overrides
   * @returns the concatenated prompt string
   */
  buildPrompt(
    parts: readonly ContextPart[],
    options: BuildPromptOptions = {},
  ): string {
    const separator = options.separator ?? this.config.separator ?? DEFAULT_SEPARATOR;
    const labeler = options.labeler ?? this.config.labeler;
    const fragments = parts.map((part) =>
      labeler ? labeler(part) : this.render(part),
    );
    return fragments.join(separator);
  }

  /**
   * Render a single part into its prompt fragment.
   *
   * Prefixes the content with the role's marker (`<|system|>`, `<|user|>`, ...)
   * followed by a newline, and trims trailing whitespace from the content so
   * stray newlines never inflate the token count.
   *
   * @param part - the part to render
   * @returns the rendered fragment
   */
  render(part: ContextPart): string {
    const marker = ROLE_MARKERS[part.role];
    return `${marker}\n${part.content.trimEnd()}`;
  }

  /**
   * Remove duplicate parts by content hash.
   *
   * Parts are compared via {@link partHash} — the hash of their normalised
   * content plus role — so two parts that differ only in whitespace layout
   * collapse, while same-content parts of different roles stay distinct. The
   * first occurrence in input order wins.
   *
   * @param parts - the parts to deduplicate
   * @returns a new array with duplicates removed, order preserved
   */
  dedupe(parts: readonly ContextPart[]): ContextPart[] {
    const seen = new Set<string>();
    const out: ContextPart[] = [];
    for (const part of parts) {
      const hash = partHash(part);
      if (seen.has(hash)) {
        continue;
      }
      seen.add(hash);
      out.push(part);
    }
    return out;
  }

  /**
   * Sort parts according to the configured ordering strategy.
   *
   * - `'priority'` (default) — role priority first ({@link resolveRolePriority}),
   *   then explicit `order` (ascending, parts without an order last), then the
   *   original insertion index to keep the sort stable.
   * - `'explicit'` — only the per-part `order` value; ties keep input order.
   * - `'none'` — input order verbatim.
   *
   * @param parts - the parts to sort
   * @returns a new array in sorted order
   */
  sortParts(parts: readonly ContextPart[]): ContextPart[] {
    const strategy = this.config.ordering ?? 'priority';
    if (strategy === 'none') {
      return [...parts];
    }
    if (strategy === 'explicit') {
      return parts
        .map((part, index) => ({ part, index }))
        .sort(
          (a, b) =>
            this.orderOf(a.part) - this.orderOf(b.part) || a.index - b.index,
        )
        .map((entry) => entry.part);
    }
    const priority = resolveRolePriority(this.config);
    return parts
      .map((part, index) => ({ part, index }))
      .sort(
        (a, b) =>
          priority[a.part.role] - priority[b.part.role] ||
          this.orderOf(a.part) - this.orderOf(b.part) ||
          a.index - b.index,
      )
      .map((entry) => entry.part);
  }

  /**
   * Estimate the token count of a part.
   *
   * Uses the part's stored `tokens` when present, otherwise derives an
   * estimate via {@link estimateTokens}.
   *
   * @param part - the part to measure
   * @returns the estimated token count
   */
  tokens(part: ContextPart): number {
    return part.tokens ?? estimateTokens(part.content);
  }

  /**
   * Rolling aggregate counters for the assembler's lifetime.
   *
   * @returns the {@link AssemblerTotals} summary
   */
  totals(): AssemblerTotals {
    return { ...this.counters };
  }

  /**
   * Statistics of the most recent assembly pass.
   *
   * Returns a zero-filled {@link AssemblyStats} when no pass has run yet.
   *
   * @returns the last pass's stats
   */
  stats(): AssemblyStats {
    if (this.lastStats) {
      return { ...this.lastStats, roleCounts: { ...this.lastStats.roleCounts } };
    }
    const at = this.now();
    return {
      parts: 0,
      candidates: 0,
      totalTokens: 0,
      promptTokens: 0,
      deduped: 0,
      trimmed: 0,
      roleCounts: emptyRoleCounts(),
      at,
      tookMs: 0,
    };
  }

  /**
   * Reset the rolling counters and the stored last-pass statistics.
   */
  clearStats(): void {
    this.counters.passes = 0;
    this.counters.parts = 0;
    this.counters.deduped = 0;
    this.counters.trimmed = 0;
    this.counters.lastAssembledAt = null;
    this.counters.lastTookMs = null;
    this.lastStats = null;
  }

  /**
   * Collect and canonicalise an iterable of part inputs.
   *
   * Fully-formed {@link ContextPart}s pass through {@link createPart} too, so
   * every collected part is a canonical copy with tags/metadata arrays
   * isolated from the caller's mutable objects.
   *
   * @param inputs - the raw parts
   * @returns canonical parts, in input order
   */
  private collect(inputs: Iterable<ContextPart | PartInput>): ContextPart[] {
    const out: ContextPart[] = [];
    for (const input of inputs) {
      out.push(createPart(input));
    }
    return out;
  }

  /**
   * Trim parts to a token budget, dropping the lowest-retention parts first.
   *
   * Protected roles (system by default) are never dropped, even when they
   * alone exceed the budget. Expendable parts are ranked by descending
   * retention priority ({@link resolveRetention}) so memory and tool results
   * disappear before examples and knowledge; ties drop later parts first.
   *
   * @param parts - the sorted parts to trim
   * @param maxTokens - the hard token budget
   * @param protectRoles - roles that must never be trimmed
   * @returns the parts that fit the budget, in their original order
   */
  private trimToBudget(
    parts: readonly ContextPart[],
    maxTokens: number,
    protectRoles: readonly ContextRole[],
  ): ContextPart[] {
    const protectSet = new Set(protectRoles);
    const protectedParts = parts.filter((part) => protectSet.has(part.role));
    const expendable = parts.filter((part) => !protectSet.has(part.role));

    const retention = resolveRetention(this.config);
    const droppable = [...expendable].sort((a, b) => {
      const ra = retention[a.role] ?? 0;
      const rb = retention[b.role] ?? 0;
      if (ra !== rb) {
        return rb - ra;
      }
      return this.orderOf(b) - this.orderOf(a);
    });

    let used = protectedParts.reduce((sum, part) => sum + this.tokens(part), 0);
    const dropIds = new Set<PartId>();
    for (const part of droppable) {
      const tokenCount = this.tokens(part);
      if (used + tokenCount > maxTokens) {
        dropIds.add(part.id);
        continue;
      }
      used += tokenCount;
    }

    if (dropIds.size === 0) {
      return [...parts];
    }
    return parts.filter((part) => !dropIds.has(part.id));
  }

  /**
   * Project {@link AssembleOptions} onto an {@link AssemblyConfig} shape.
   *
   * Only the fields that `assemble` honours per-call are projected, so
   * {@link mergeConfig} can layer them over the constructor configuration.
   *
   * @param options - the per-call options
   * @returns a partial configuration
   */
  private toConfig(options: AssembleOptions): AssemblyConfig {
    return {
      maxTokens: options.maxTokens,
      dedupe: options.dedupe,
      includeRoles: options.includeRoles,
      ordering: options.ordering,
      protectRoles: options.protectRoles,
      separator: options.separator,
      labeler: options.labeler,
      rolePriority: options.rolePriority,
      retention: options.retention,
      now: options.now,
    };
  }

  /**
   * Resolve a part's explicit order, defaulting to a large sentinel so
   * un-ordered parts sort after ordered ones.
   *
   * @param part - the part to inspect
   * @returns the part's order (or a large default)
   */
  private orderOf(part: ContextPart): number {
    return part.order ?? Number.MAX_SAFE_INTEGER;
  }
}

/**
 * Default token estimate, re-exported from the types module for callers that
 * want to size parts before handing them to an assembler.
 *
 * @param text - the text to estimate
 * @returns an estimated token count
 */
export function estimatePartTokens(text: string | undefined): number {
  return estimateTokens(text);
}

/**
 * Convenience factory: build an assembler from a partial configuration.
 *
 * Equivalent to `new ContextAssembler(config)`.
 *
 * @param config - optional construction-time configuration
 * @returns a configured {@link ContextAssembler}
 */
export function createAssembler(config: AssemblyConfig = {}): ContextAssembler {
  return new ContextAssembler(config);
}