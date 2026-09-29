/**
 * Integration surface for the Summarization layer of the standalone MAM
 * Context Engine.
 *
 * This module is how the rest of the context engine consumes Summarization. It
 * exposes three pieces:
 *
 * 1. **{@link SummarizerInterface}** — the contract every summarization facade
 *    implements, so consumers can depend on the interface rather than a
 *    concrete class.
 * 2. **{@link Summarizer}** — the high-level facade. It composes a
 *    {@link TextSummarizer} (the ranking engine), a {@link SummarizationStore}
 *    (the result cache), a {@link SummarizationIndex} (the secondary index over
 *    the cache) and a {@link SummarizationLifecycle} (bounded, periodically
 *    pruned housekeeping) into one object whose headline operation
 *    {@link Summarizer.run} summarises *and caches* in a single call.
 * 3. **{@link SummarizationAdapter}** — an alternate {@link SummarizerInterface}
 *    implementation that adapts an *already-existing* summarizer + store +
 *    index (perhaps shared with other consumers) into the same contract,
 *    without building its own lifecycle.
 *
 * The module also provides the factory {@link createSummarizer}, which assembles
 * the default wiring so callers do not need to know the constructor order.
 *
 * The headline operations of the layer live here in their most ergonomic form:
 *
 * - {@link Summarizer.run} — produce a deterministic summary of a text and
 *   cache it keyed by a hash of the text plus the effective options, so the
 *   same document is only ever summarised once per option set.
 * - {@link Summarizer.summarizeToLength} — a best-effort routine that tries
 *   progressively tighter extractive summaries, then a rolling digest, and
 *   finally a word-boundary clip, to produce a summary that fits a hard
 *   character budget.
 *
 * @module summarization/integration
 */

import { SummarizationIndex } from './index.js';
import { SummarizationLifecycle } from './lifecycle.js';
import { TextSummarizer } from './retrieval.js';
import { SummarizationStore } from './store.js';
import {
  clampLength,
  createSummaryResult,
  hashString,
  mergeSummarizationConfig,
  resolveMaxSentences,
} from './types.js';
import type {
  KeyPoint,
  SummarizationConfig,
  SummarizationStats,
  SummarizeOptions,
  SummaryResult,
  Timestamp,
} from './types.js';

/**
 * The contract every summarization facade implements.
 *
 * Consumers that want to stay decoupled from the concrete facade (for testing,
 * for swapping between {@link Summarizer} and {@link SummarizationAdapter}, or
 * for sharing one cached summarizer across modules) should type against this
 * interface.
 */
export interface SummarizerInterface {
  /**
   * Summarise a text deterministically and (when caching is enabled) cache the
   * result.
   */
  run(text: string, options?: SummarizeOptions): SummaryResult;

  /**
   * Produce a summary that fits within `maxLength` characters, shrinking
   * progressively until it does.
   */
  summarizeToLength(text: string, maxLength: number): SummaryResult;

  /**
   * Extract the document's most salient keywords.
   */
  keywords(text: string, topN?: number): string[];

  /**
   * Extract the document's top key points.
   */
  keyPoints(text: string, n?: number): KeyPoint[];

  /**
   * Aggregate counters describing the summarization subsystem.
   */
  stats(): SummarizationStats;
}

/**
 * Construction options for a {@link Summarizer}.
 */
export interface SummarizerOptions {
  /**
   * When `true` (default), a {@link SummarizationLifecycle} is created and
   * started alongside the store so the cache is pruned periodically. Set to
   * `false` for short-lived or externally-managed processes.
   */
  readonly lifecycle?: boolean;

  /**
   * Maximum number of cached results the lifecycle keeps before pruning (see
   * `SummarizationLifecycleOptions.maxEntries`). Ignored when `lifecycle` is
   * `false`.
   */
  readonly maxEntries?: number;

  /**
   * Interval in milliseconds between automatic lifecycle prune passes. Ignored
   * when `lifecycle` is `false`.
   */
  readonly intervalMs?: number;

  /**
   * When `true` (default), {@link Summarizer.run} and
   * {@link Summarizer.summarizeToLength} cache their results keyed by a hash
   * of the text plus the effective options. Set to `false` for one-shot,
   * stateless summarization.
   */
  readonly cache?: boolean;

  /**
   * A pre-built store to cache into. When omitted, a fresh store is
   * constructed.
   */
  readonly store?: SummarizationStore;

  /**
   * Clock used for all timestamps. Injecting a clock makes the facade
   * deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * The default effective configuration for a summarizer built without
 * arguments. Pre-merged once so {@link createSummarizer} and
 * {@link SummarizationAdapter} share identical defaults.
 */
const DEFAULT_CONFIG: SummarizationConfig = mergeSummarizationConfig(undefined);

/**
 * Derive a deterministic cache key for a summarization call.
 *
 * Combines a stable hash of the normalised text with the effective options that
 * influence the output (technique, sentence budget, length target, minimum
 * score), so two calls that would produce different summaries never share a
 * cache entry while two identical calls always do.
 *
 * @param text - the source text
 * @param options - the per-call options
 * @param summarizer - the summarizer whose config supplies defaults
 * @returns a stable cache key string
 */
export function summarizationCacheKey(
  text: string,
  options: SummarizeOptions | undefined,
  summarizer: TextSummarizer,
): string {
  const digest = hashString(summarizer.normalize(text));
  const technique = options?.technique ?? summarizer.config.technique;
  const maxSentences =
    options?.maxSentences ?? summarizer.config.maxSentences;
  const maxLength = options?.maxLength ?? summarizer.config.maxLength;
  const minScore = options?.minScore ?? summarizer.config.minScore;
  return `${digest}:${technique}:${maxSentences}:${maxLength}:${minScore}`;
}

/**
 * The high-level Summarization facade.
 *
 * {@link Summarizer} is the object most consumers should construct. It wires
 * the whole layer together — ranking engine, result cache, secondary index and
 * (by default) lifecycle — and adds the two ergonomic operations the layer
 * exists to serve: {@link Summarizer.run} (summarise + cache) and
 * {@link Summarizer.summarizeToLength} (fit a hard character budget).
 *
 * @example
 * ```ts
 * const summarizer = createSummarizer({ maxSentences: 4 });
 * const digest = summarizer.run(longKnowledgeDump);
 * const fitted = summarizer.summarizeToLength(longKnowledgeDump, 512);
 * const terms = summarizer.keywords(longKnowledgeDump, 10);
 * ```
 */
export class Summarizer implements SummarizerInterface {
  /**
   * The underlying deterministic ranking engine.
   */
  readonly summarizer: TextSummarizer;

  /**
   * The underlying result cache.
   */
  readonly store: SummarizationStore;

  /**
   * The underlying secondary index over the cache.
   */
  readonly index: SummarizationIndex;

  /**
   * The lifecycle (housekeeping), or `null` when disabled.
   */
  readonly lifecycle: SummarizationLifecycle | null;

  /**
   * Whether {@link Summarizer.run} caches its results.
   */
  readonly cacheEnabled: boolean;

  /**
   * Construct a summarizer.
   *
   * @param config - partial configuration, merged over the defaults
   * @param options - construction options (lifecycle toggle, cache toggle,
   *   store override, clock)
   */
  constructor(
    config: Partial<SummarizationConfig> | undefined = undefined,
    options: SummarizerOptions = {},
  ) {
    this.summarizer = new TextSummarizer({ config, now: options.now });
    this.store = options.store ?? new SummarizationStore({ now: options.now });
    this.index = new SummarizationIndex();
    this.cacheEnabled = options.cache !== false;
    this.lifecycle =
      options.lifecycle === false
        ? null
        : new SummarizationLifecycle(this.store, {
            maxEntries: options.maxEntries,
            intervalMs: options.intervalMs,
            now: options.now,
          });
    this.lifecycle?.start();
  }

  /**
   * Summarise a text deterministically, caching the result.
   *
   * When caching is enabled, the cache key is derived from the normalised text
   * plus the effective options (see {@link summarizationCacheKey}); a hit
   * returns the stored digest (and refreshes its recency), a miss summarises,
   * stores and indexes the result. Deterministic: the same input always yields
   * the same {@link SummaryResult}.
   *
   * @param text - the source text
   * @param options - per-call overrides (technique, sentence budget, length
   *   target, minimum score)
   * @returns the produced {@link SummaryResult}
   */
  run(text: string, options: SummarizeOptions = {}): SummaryResult {
    if (this.cacheEnabled) {
      const key = summarizationCacheKey(text, options, this.summarizer);
      const cached = this.store.get(key);
      if (cached) {
        return cached;
      }
      const result = this.summarizer.summarize(text, options);
      const stored = this.store.put(key, result);
      if (stored) {
        this.index.indexResult(key, stored);
      }
      return result;
    }
    return this.summarizer.summarize(text, options);
  }

  /**
   * Produce a summary that fits within `maxLength` characters.
   *
   * The strategy is progressive and deterministic:
   *
   * 1. If the source already fits, it is returned verbatim.
   * 2. Extractive summaries are tried with `maxSentences`, `maxSentences − 1`,
   *    … down to `1`; the first that fits is returned.
   * 3. A rolling digest targeted at `maxLength` is tried.
   * 4. As a last resort, the one-sentence extractive summary is clipped at a
   *    word boundary and marked `'rolling'` (the progressive-shortening
   *    family).
   *
   * @param text - the source text
   * @param maxLength - the hard output length in characters
   * @returns a {@link SummaryResult} whose `summaryLength` is `<= maxLength`
   */
  summarizeToLength(text: string, maxLength: number): SummaryResult {
    const target = clampLength(maxLength);
    if (target <= 0) {
      return this.run(text, { maxSentences: 1 });
    }
    if (text.length <= target) {
      return createSummaryResult(
        text,
        this.summarizer.config.technique,
        text.length,
      );
    }
    if (this.cacheEnabled) {
      const key = `${summarizationCacheKey(text, undefined, this.summarizer)}:len:${target}`;
      const cached = this.store.get(key);
      if (cached) {
        return cached;
      }
      const result = this.fitToLength(text, target);
      const stored = this.store.put(key, result);
      if (stored) {
        this.index.indexResult(key, stored);
      }
      return result;
    }
    return this.fitToLength(text, target);
  }

  /**
   * The shared shrinking routine behind {@link Summarizer.summarizeToLength}.
   *
   * @param text - the source text
   * @param target - the hard output length
   * @returns a {@link SummaryResult} whose `summaryLength` is `<= target`
   */
  private fitToLength(text: string, target: number): SummaryResult {
    const maximum = resolveMaxSentences(this.summarizer.config.maxSentences);
    for (let sentences = maximum; sentences >= 1; sentences -= 1) {
      const result = this.summarizer.extractive(text, sentences);
      if (result.summaryLength <= target) {
        return result;
      }
      if (sentences === 1) {
        break;
      }
    }
    const rolling = this.summarizer.rolling(text, Math.max(200, target), {
      maxLength: target,
    });
    if (rolling.summaryLength <= target) {
      return rolling;
    }
    const single = this.summarizer.extractive(text, 1);
    const clipped = clipToWordBoundary(single.summary, target);
    const keyPoints = this.summarizer.keyPoints(
      text,
      resolveMaxSentences(this.summarizer.config.maxSentences),
    );
    return createSummaryResult(clipped, 'rolling', text.length, keyPoints);
  }

  /**
   * Extract the document's most salient keywords.
   *
   * @param text - the source text
   * @param topN - how many keywords to return
   * @returns the top keywords, most salient first
   */
  keywords(text: string, topN?: number): string[] {
    return this.summarizer.keywords(text, topN);
  }

  /**
   * Extract the document's top key points.
   *
   * @param text - the source text
   * @param n - how many key points to extract
   * @returns the top key points, most salient first
   */
  keyPoints(text: string, n?: number): KeyPoint[] {
    return this.summarizer.keyPoints(text, n);
  }

  /**
   * Aggregate counters for the summarization subsystem.
   *
   * When a lifecycle is attached, its `pruned` count is folded over the
   * store's counters.
   *
   * @returns a {@link SummarizationStats} snapshot
   */
  stats(): SummarizationStats {
    const storeStats = this.store.stats();
    if (this.lifecycle) {
      return {
        ...storeStats,
        pruned: this.lifecycle.stats().pruned,
      };
    }
    return storeStats;
  }

  /**
   * Stop the lifecycle timer, if one is running.
   *
   * Idempotent; safe to call on summarizers built with `lifecycle: false`.
   */
  dispose(): void {
    this.lifecycle?.stop();
  }
}

/**
 * Construction options for a {@link SummarizationAdapter}.
 */
export interface SummarizationAdapterOptions {
  /**
   * A pre-built ranking engine to adapt. When omitted, a fresh engine is
   * constructed from the configuration.
   */
  readonly summarizer?: TextSummarizer;

  /**
   * A pre-built result cache to adapt. When omitted, a fresh store is
   * constructed.
   */
  readonly store?: SummarizationStore;

  /**
   * A pre-built secondary index to adapt. When omitted, a fresh index is
   * constructed (and populated from the store's entries).
   */
  readonly index?: SummarizationIndex;

  /**
   * When `true` (default), {@link SummarizationAdapter.run} caches its results
   * into the adapted store.
   */
  readonly cache?: boolean;
}

/**
 * An alternate {@link SummarizerInterface} implementation that adapts existing
 * components.
 *
 * {@link SummarizationAdapter} is for callers who already hold a
 * {@link TextSummarizer}, a {@link SummarizationStore} and/or a
 * {@link SummarizationIndex} (shared with a lifecycle, say) and want to expose
 * the {@link SummarizerInterface} contract over them without constructing a
 * second, competing set of components. It implements the same interface as
 * {@link Summarizer} — `run`, `summarizeToLength`, `keywords`, `keyPoints`,
 * `stats` — so the two can be swapped freely.
 *
 * @example
 * ```ts
 * const sharedStore = new SummarizationStore();
 * const adapter = new SummarizationAdapter({ store: sharedStore });
 * const digest = adapter.run(someText);
 * adapter.stats();            // includes the shared store's counters
 * ```
 */
export class SummarizationAdapter implements SummarizerInterface {
  /**
   * The adapted ranking engine.
   */
  readonly summarizer: TextSummarizer;

  /**
   * The adapted result cache.
   */
  readonly store: SummarizationStore;

  /**
   * The adapted secondary index.
   */
  readonly index: SummarizationIndex;

  /**
   * Whether {@link SummarizationAdapter.run} caches its results.
   */
  readonly cacheEnabled: boolean;

  /**
   * Construct an adapter.
   *
   * @param options - construction options (component overrides, cache toggle)
   * @param config - partial configuration used to build components when none is
   *   supplied
   */
  constructor(
    options: SummarizationAdapterOptions = {},
    config: Partial<SummarizationConfig> | undefined = undefined,
  ) {
    this.summarizer = options.summarizer ?? new TextSummarizer({ config });
    this.store = options.store ?? new SummarizationStore();
    this.index =
      options.index ?? SummarizationIndex.from(this.store.entries().map((entry) => [entry.key, entry.result]));
    this.cacheEnabled = options.cache !== false;
  }

  /**
   * Summarise a text deterministically, caching into the adapted store.
   *
   * @param text - the source text
   * @param options - per-call overrides
   * @returns the produced {@link SummaryResult}
   */
  run(text: string, options: SummarizeOptions = {}): SummaryResult {
    if (this.cacheEnabled) {
      const key = summarizationCacheKey(text, options, this.summarizer);
      const cached = this.store.get(key);
      if (cached) {
        return cached;
      }
      const result = this.summarizer.summarize(text, options);
      const stored = this.store.put(key, result);
      if (stored) {
        this.index.indexResult(key, stored);
      }
      return result;
    }
    return this.summarizer.summarize(text, options);
  }

  /**
   * Produce a summary that fits within `maxLength` characters.
   *
   * Shares the progressive strategy of {@link Summarizer.summarizeToLength}.
   *
   * @param text - the source text
   * @param maxLength - the hard output length in characters
   * @returns a {@link SummaryResult} whose `summaryLength` is `<= maxLength`
   */
  summarizeToLength(text: string, maxLength: number): SummaryResult {
    const target = clampLength(maxLength);
    if (target <= 0) {
      return this.run(text, { maxSentences: 1 });
    }
    if (text.length <= target) {
      return createSummaryResult(
        text,
        this.summarizer.config.technique,
        text.length,
      );
    }
    if (this.cacheEnabled) {
      const key = `${summarizationCacheKey(text, undefined, this.summarizer)}:len:${target}`;
      const cached = this.store.get(key);
      if (cached) {
        return cached;
      }
      const result = this.fitToLength(text, target);
      const stored = this.store.put(key, result);
      if (stored) {
        this.index.indexResult(key, stored);
      }
      return result;
    }
    return this.fitToLength(text, target);
  }

  /**
   * The shared shrinking routine behind
   * {@link SummarizationAdapter.summarizeToLength}.
   *
   * @param text - the source text
   * @param target - the hard output length
   * @returns a {@link SummaryResult} whose `summaryLength` is `<= target`
   */
  private fitToLength(text: string, target: number): SummaryResult {
    const maximum = resolveMaxSentences(this.summarizer.config.maxSentences);
    for (let sentences = maximum; sentences >= 1; sentences -= 1) {
      const result = this.summarizer.extractive(text, sentences);
      if (result.summaryLength <= target) {
        return result;
      }
      if (sentences === 1) {
        break;
      }
    }
    const rolling = this.summarizer.rolling(text, Math.max(200, target), {
      maxLength: target,
    });
    if (rolling.summaryLength <= target) {
      return rolling;
    }
    const single = this.summarizer.extractive(text, 1);
    const clipped = clipToWordBoundary(single.summary, target);
    const keyPoints = this.summarizer.keyPoints(
      text,
      resolveMaxSentences(this.summarizer.config.maxSentences),
    );
    return createSummaryResult(clipped, 'rolling', text.length, keyPoints);
  }

  /**
   * Extract the document's most salient keywords.
   *
   * @param text - the source text
   * @param topN - how many keywords to return
   * @returns the top keywords, most salient first
   */
  keywords(text: string, topN?: number): string[] {
    return this.summarizer.keywords(text, topN);
  }

  /**
   * Extract the document's top key points.
   *
   * @param text - the source text
   * @param n - how many key points to extract
   * @returns the top key points, most salient first
   */
  keyPoints(text: string, n?: number): KeyPoint[] {
    return this.summarizer.keyPoints(text, n);
  }

  /**
   * Aggregate counters for the adapted store.
   *
   * @returns a {@link SummarizationStats} snapshot
   */
  stats(): SummarizationStats {
    return this.store.stats();
  }
}

/**
 * Clip text to a maximum length at a word boundary.
 *
 * Cuts at the last space within the first `maxLength − 1` characters (when one
 * exists reasonably close to the cut) and appends `…`, guaranteeing the result
 * never exceeds `maxLength` characters. The last-resort step of
 * {@link Summarizer.summarizeToLength} and {@link SummarizationAdapter
 * .summarizeToLength}.
 *
 * @param text - the text to clip
 * @param maxLength - the maximum output length in characters
 * @returns the clipped text
 */
function clipToWordBoundary(text: string, maxLength: number): string {
  const target = clampLength(maxLength);
  if (target <= 0 || text.length <= target) {
    return text;
  }
  let cut = text.slice(0, target - 1);
  const boundary = cut.lastIndexOf(' ');
  if (boundary > target * 0.6) {
    cut = cut.slice(0, boundary);
  }
  return `${cut}…`;
}

/**
 * Assemble a high-level {@link Summarizer} with default wiring.
 *
 * Creates a fresh ranking engine + result cache + secondary index + (started)
 * lifecycle. Pass a partial config to tune the technique, sentence budget,
 * length target and minimum score, and options to toggle lifecycle/caching.
 *
 * @param config - partial configuration, merged over the defaults
 * @param options - construction options (lifecycle toggle, cache toggle, store
 *   override, clock)
 * @returns a ready-to-use {@link Summarizer}
 */
export function createSummarizer(
  config: Partial<SummarizationConfig> | undefined = undefined,
  options: SummarizerOptions = {},
): Summarizer {
  const resolved: SummarizationConfig = config
    ? mergeSummarizationConfig(config)
    : DEFAULT_CONFIG;
  return new Summarizer(resolved, options);
}

/**
 * Assemble a {@link SummarizationAdapter} over default (or supplied) wiring.
 *
 * @param config - partial configuration used when no components are supplied
 * @param options - construction options (component overrides, cache toggle)
 * @returns a ready-to-use {@link SummarizationAdapter}
 */
export function createSummarizationAdapter(
  config: Partial<SummarizationConfig> | undefined = undefined,
  options: SummarizationAdapterOptions = {},
): SummarizationAdapter {
  const resolved: SummarizationConfig = config
    ? mergeSummarizationConfig(config)
    : DEFAULT_CONFIG;
  return new SummarizationAdapter(options, resolved);
}

/**
 * The layer's timestamp type, re-exported for consumers that type against the
 * integration surface alone.
 */
export type { Timestamp };