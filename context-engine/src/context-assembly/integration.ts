/**
 * ContextAssemblerAdapter, createContextAssembler and ContextPipeline — the
 * integration surface of the Context Assembly layer of the standalone MAM
 * Context Engine.
 *
 * The three lower files of this layer each solve one concern:
 *
 * - {@link ContextAssemblyStore} (see `store.ts`) is the flat part registry.
 * - {@link AssemblyIndex} (see `index.ts`) denormalises lookups over it.
 * - {@link ContextAssembler} (see `retrieval.ts`) orders, dedupes, budgets
 *   and renders the parts.
 * - {@link AssemblyLifecycle} (see `lifecycle.ts`) keeps the registry healthy
 *   and emits lifecycle events.
 *
 * This module is where those pieces meet:
 *
 * - **`ContextAssembler`** — the public interface consumers should code
 *   against. It narrows the concrete implementation to the four operations
 *   callers actually need (`assemble`, `buildPrompt`, `render`, `stats`).
 * - **`ContextAssemblerAdapter`** — a thin, interface-conforming wrapper
 *   around the {@link ContextAssembler} engine that also caches the most
 *   recent {@link AssembledContext} and can assemble straight from a store.
 * - **`createContextAssembler`** — the factory entry point; returns an
 *   adapter ready for immediate use.
 * - **`ContextPipeline`** — the fully-wired assembly pipeline. It owns a
 *   store, an index, an assembler and a lifecycle, and exposes `run(parts,
 *   options)` as the single high-level entry point that persists parts,
 *   assembles a prompt, touches the lifecycle and emits events in one call.
 *
 * @packageDocumentation
 * @module context-assembly/integration
 */

import type {
  AssembledContext,
  AssemblyConfig,
  AssemblyStats,
  AssembleOptions,
  ContextPart,
  PartId,
  PartInput,
} from './types.js';
import { estimateTokens } from './types.js';
import { ContextAssemblyStore } from './store.js';
import type { StoreStats } from './store.js';
import { AssemblyIndex } from './index.js';
import { ContextAssembler as CoreContextAssembler } from './retrieval.js';
import type { AssemblerTotals, BuildPromptOptions } from './retrieval.js';
import { AssemblyLifecycle } from './lifecycle.js';
import type { LifecycleConfig, LifecycleStats } from './lifecycle.js';

/**
 * The public contract every context assembler satisfies.
 *
 * Consumers that accept this interface can be handed a
 * {@link ContextAssemblerAdapter}, a {@link ContextPipeline} or any other
 * conforming implementation without changing their call sites. The four
 * operations mirror the four things a caller needs to build a prompt:
 * assemble the context, build the prompt string, render a single part and
 * inspect statistics.
 */
export interface ContextAssembler {
  /**
   * Assemble parts into an {@link AssembledContext}.
   *
   * @param options - the parts plus optional per-call overrides
   * @returns the assembled context
   */
  assemble(options?: AssembleOptions): AssembledContext;

  /**
   * Build a prompt string from parts.
   *
   * @param parts - the parts to render
   * @param options - optional rendering overrides
   * @returns the concatenated prompt string
   */
  buildPrompt(
    parts: readonly ContextPart[],
    options?: BuildPromptOptions,
  ): string;

  /**
   * Render a single part into its prompt fragment.
   *
   * @param part - the part to render
   * @returns the rendered fragment
   */
  render(part: ContextPart): string;

  /**
   * Statistics of the most recent assembly pass.
   *
   * @returns the last pass's stats (zero-filled when none has run)
   */
  stats(): AssemblyStats;
}

/**
 * An interface-conforming wrapper around the {@link ContextAssembler} engine.
 *
 * Delegates the four core operations to a {@link ContextAssembler} instance
 * and additionally:
 *
 * - caches the most recent {@link AssembledContext} for callers that want to
 *   re-read the last prompt without re-assembling;
 * - offers {@link assembleFromStore} to assemble a store's current contents
 *   (optionally merged with extra parts) in a single call.
 *
 * @example
 * ```ts
 * const assembler = createContextAssembler({ maxTokens: 1024 });
 * const result = assembler.assemble({
 *   parts: [{ id: 'u', role: 'user', content: 'Hi' }],
 * });
 * ```
 */
export class ContextAssemblerAdapter implements ContextAssembler {
  /**
   * The underlying engine this adapter delegates to.
   */
  private readonly core: CoreContextAssembler;

  /**
   * The most recent assembled context, or `null` before the first pass.
   */
  private lastAssembled: AssembledContext | null = null;

  /**
   * Construct an adapter around a new engine.
   *
   * @param config - optional construction-time configuration for the engine
   */
  constructor(config?: AssemblyConfig) {
    this.core = new CoreContextAssembler(config);
  }

  /**
   * Assemble parts into an {@link AssembledContext}.
   *
   * Delegates to the engine and caches the result for {@link lastResult}.
   *
   * @param options - the parts plus optional per-call overrides
   * @returns the assembled context
   */
  assemble(options: AssembleOptions = {}): AssembledContext {
    const result = this.core.assemble(options);
    this.lastAssembled = result;
    return result;
  }

  /**
   * Assemble the current contents of a store.
   *
   * When `options.parts` is also supplied, the store's parts are appended
   * after the caller's parts so the caller's explicit ordering wins.
   *
   * @param store - the store to source parts from
   * @param options - optional per-call overrides
   * @returns the assembled context
   */
  assembleFromStore(
    store: ContextAssemblyStore,
    options: AssembleOptions = {},
  ): AssembledContext {
    const parts = options.parts
      ? [...options.parts, ...store.all()]
      : store.all();
    return this.assemble({ ...options, parts });
  }

  /**
   * Build a prompt string from parts.
   *
   * @param parts - the parts to render
   * @param options - optional rendering overrides
   * @returns the concatenated prompt string
   */
  buildPrompt(
    parts: readonly ContextPart[],
    options: BuildPromptOptions = {},
  ): string {
    return this.core.buildPrompt(parts, options);
  }

  /**
   * Render a single part into its prompt fragment.
   *
   * @param part - the part to render
   * @returns the rendered fragment
   */
  render(part: ContextPart): string {
    return this.core.render(part);
  }

  /**
   * Statistics of the most recent assembly pass.
   *
   * @returns the last pass's stats (zero-filled when none has run)
   */
  stats(): AssemblyStats {
    return this.core.stats();
  }

  /**
   * Rolling aggregate counters for the underlying engine's lifetime.
   *
   * @returns the engine's {@link AssemblerTotals}
   */
  totals(): AssemblerTotals {
    return this.core.totals();
  }

  /**
   * The most recent assembled context, or `null` before the first pass.
   */
  get lastResult(): AssembledContext | null {
    return this.lastAssembled;
  }

  /**
   * Reset the cached result and the engine's rolling counters.
   */
  reset(): void {
    this.lastAssembled = null;
    this.core.clearStats();
  }
}

/**
 * Factory entry point for the context assembly layer.
 *
 * Builds a {@link ContextAssemblerAdapter} around a fresh
 * {@link ContextAssembler} engine configured with `config`.
 *
 * @param config - optional construction-time configuration
 * @returns an interface-conforming adapter
 */
export function createContextAssembler(
  config?: AssemblyConfig,
): ContextAssemblerAdapter {
  return new ContextAssemblerAdapter(config);
}

/**
 * Construction options for {@link ContextPipeline}.
 *
 * Every component is optional; when omitted the pipeline constructs a fresh
 * one, so `new ContextPipeline()` alone yields a fully-wired assembly
 * subsystem.
 */
export interface PipelineConfig {
  /**
   * The part registry. Defaults to a fresh {@link ContextAssemblyStore}.
   */
  readonly store?: ContextAssemblyStore;

  /**
   * The assembler engine. Defaults to a fresh adapter configured with
   * {@link PipelineConfig.assemblyConfig}.
   */
  readonly assembler?: ContextAssemblerAdapter;

  /**
   * The lifecycle. Defaults to a fresh {@link AssemblyLifecycle} wired to the
   * pipeline's store and configured with {@link PipelineConfig.lifecycleConfig}.
   */
  readonly lifecycle?: AssemblyLifecycle;

  /**
   * The lookup index. Defaults to a fresh {@link AssemblyIndex} seeded from
   * the pipeline's store.
   */
  readonly index?: AssemblyIndex;

  /**
   * Configuration for the default assembler (ignored when `assembler` is
   * supplied).
   */
  readonly assemblyConfig?: AssemblyConfig;

  /**
   * Configuration for the default lifecycle (ignored when `lifecycle` is
   * supplied).
   */
  readonly lifecycleConfig?: LifecycleConfig;
}

/**
 * The fully-wired context assembly pipeline.
 *
 * Owns a store (the part registry), an index (denormalised lookups), an
 * assembler (ordering/budgeting/rendering) and a lifecycle (TTL pruning and
 * events). The single high-level entry point is {@link run}: it persists the
 * given parts, assembles the context, touches the lifecycle and emits the
 * `'assembled'` event in one call.
 *
 * @example
 * ```ts
 * const pipeline = new ContextPipeline({ assemblyConfig: { maxTokens: 4096 } });
 * const result = pipeline.run([
 *   { id: 's', role: 'system', content: 'Be concise.' },
 *   { id: 'k', role: 'knowledge', content: 'Docs: v2 changes.', tags: ['docs'] },
 *   { id: 'u', role: 'user', content: 'Summarise.' },
 * ]);
 * console.log(result.prompt);
 * ```
 */
export class ContextPipeline {
  /**
   * The part registry backing the pipeline.
   */
  readonly store: ContextAssemblyStore;

  /**
   * The assembler engine (adapter).
   */
  readonly assembler: ContextAssemblerAdapter;

  /**
   * The lifecycle wiring (TTL pruning + events).
   */
  readonly lifecycle: AssemblyLifecycle;

  /**
   * The denormalised lookup index, kept in sync with the store.
   */
  readonly index: AssemblyIndex;

  /**
   * The most recent assembled context, or `null` before the first run.
   */
  private lastAssembled: AssembledContext | null = null;

  /**
   * Construct a pipeline, wiring together its four components.
   *
   * Supplied components are reused; missing ones are constructed. When the
   * store is supplied, the index is seeded from it so lookups are correct
   * from the first call.
   *
   * @param config - optional construction options
   */
  constructor(config: PipelineConfig = {}) {
    this.store = config.store ?? new ContextAssemblyStore();
    this.assembler =
      config.assembler ?? new ContextAssemblerAdapter(config.assemblyConfig);
    this.index = config.index ?? new AssemblyIndex();
    this.lifecycle =
      config.lifecycle ??
      new AssemblyLifecycle(this.store, config.lifecycleConfig);
    this.index.rebuild(this.store.all());
  }

  /**
   * Add a single part to the store, index and touch ledger.
   *
   * Keeps all four components in sync: the part is persisted, indexed, and
   * marked as recently touched so the lifecycle will not prune it.
   *
   * @param input - the part to add
   * @returns the canonical stored part
   */
  addPart(input: PartInput | ContextPart): ContextPart {
    const part = this.store.add(input);
    this.index.indexPart(part);
    this.lifecycle.refresh(part.id);
    return part;
  }

  /**
   * Add many parts in a single call.
   *
   * @param inputs - the parts to add
   * @returns the number of parts added
   */
  addParts(inputs: Iterable<PartInput | ContextPart>): number {
    let count = 0;
    for (const input of inputs) {
      this.addPart(input);
      count += 1;
    }
    return count;
  }

  /**
   * Remove a part from the store and the index.
   *
   * @param partId - the id of the part to remove
   * @returns `true` when a part was removed
   */
  removePart(partId: PartId): boolean {
    const removed = this.store.delete(partId);
    if (removed) {
      this.index.removePart(partId);
    }
    return removed;
  }

  /**
   * Assemble the pipeline's current state into an {@link AssembledContext}.
   *
   * Sources parts from `options.parts` when given, otherwise from the store's
   * current contents. After assembling, the lifecycle observes the result
   * (`'assembled'` event) and touches the surviving parts so they stay fresh.
   *
   * @param options - optional per-call overrides
   * @returns the assembled context
   */
  assemble(options: AssembleOptions = {}): AssembledContext {
    const parts = options.parts ? [...options.parts] : this.store.all();
    const result = this.assembler.assemble({ ...options, parts });
    this.lifecycle.trackAssembled(result);
    this.lifecycle.refreshMany(result.parts);
    this.lastAssembled = result;
    return result;
  }

  /**
   * The single high-level entry point: persist, assemble, observe.
   *
   * Adds `parts` to the store/index, then assembles (using `options.parts`
   * when provided, else the store's now-updated contents), then emits the
   * lifecycle `'assembled'` event and touches the surviving parts.
   *
   * @param parts - the parts to persist and assemble
   * @param options - optional per-call overrides
   * @returns the assembled context
   */
  run(
    parts: Iterable<PartInput | ContextPart>,
    options: AssembleOptions = {},
  ): AssembledContext {
    this.addParts(parts);
    return this.assemble(options);
  }

  /**
   * Build a prompt string from parts.
   *
   * @param parts - the parts to render
   * @param options - optional rendering overrides
   * @returns the concatenated prompt string
   */
  buildPrompt(
    parts: readonly ContextPart[],
    options: BuildPromptOptions = {},
  ): string {
    return this.assembler.buildPrompt(parts, options);
  }

  /**
   * Render a single part into its prompt fragment.
   *
   * @param part - the part to render
   * @returns the rendered fragment
   */
  render(part: ContextPart): string {
    return this.assembler.render(part);
  }

  /**
   * Statistics of the most recent assembly pass.
   *
   * @returns the last pass's stats (zero-filled when none has run)
   */
  stats(): AssemblyStats {
    return this.assembler.stats();
  }

  /**
   * Rolling aggregate counters for the assembler engine.
   *
   * @returns the engine's {@link AssemblerTotals}
   */
  totals(): AssemblerTotals {
    return this.assembler.totals();
  }

  /**
   * Statistics for the pipeline's store.
   *
   * @returns the store's {@link StoreStats}
   */
  storeStats(): StoreStats {
    return this.store.stats();
  }

  /**
   * Statistics for the pipeline's lifecycle.
   *
   * @returns the lifecycle's {@link LifecycleStats}
   */
  lifecycleStats(): LifecycleStats {
    return this.lifecycle.stats();
  }

  /**
   * Number of parts currently held by the pipeline's store.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * The most recent assembled context, or `null` before the first run.
   */
  get lastResult(): AssembledContext | null {
    return this.lastAssembled;
  }

  /**
   * Clear the store and the index while keeping the pipeline usable.
   *
   * Parts are removed from both the store and the index; the lifecycle is
   * left running (its touch ledger is re-initialised from the now-empty
   * store) and the assembler's counters are preserved.
   */
  clear(): void {
    this.store.clear();
    this.index.clear();
    this.lifecycle.reset();
    this.lastAssembled = null;
  }

  /**
   * Reset the entire pipeline to a pristine state.
   *
   * Clears the store, index and lifecycle, resets the assembler's rolling
   * counters and drops the cached result. The pipeline remains fully usable
   * afterwards.
   */
  reset(): void {
    this.clear();
    this.assembler.reset();
  }

  /**
   * Human-readable summary of the pipeline, for logging.
   *
   * @returns e.g. `"ContextPipeline(store=12, index=12, running=true)"`
   */
  inspect(): string {
    return `ContextPipeline(store=${this.store.size}, index=${this.index.size}, running=${this.lifecycle.running})`;
  }
}

/**
 * Estimate the token count of a rendered fragment, re-exported for callers
 * that want to size output without constructing a full pipeline.
 *
 * @param text - the text to estimate
 * @returns an estimated token count
 */
export function estimatePromptTokens(text: string | undefined): number {
  return estimateTokens(text);
}