/**
 * integration.ts
 *
 * The integration façade of the Costs layer: {@link CostCalculator},
 * {@link CostTracker}, {@link CostAdapter} and the factory functions that wire
 * them together.
 *
 * This module is what an application actually imports. It exposes three
 * increasingly rich entry points:
 *
 *  - **CostCalculator** — the pure "money math" engine. Turns `(model,
 *    tokensIn, tokensOut)` into a cost using a {@link PricingTable}, and turns
 *    raw inputs into fully-populated {@link CostRecord} objects.
 *  - **CostTracker** — the "record a call" helper. Sits on top of a
 *    calculator, tracks individual calls (including timed begin/end sessions)
 *    and fans records out to any number of {@link CostCollector} sinks.
 *  - **CostAdapter** — the "observability engine" entry point. Composes a
 *    store, an index and a lifecycle into a single object that also satisfies
 *    the {@link CostCollector} interface, so it can be attached to a tracker.
 *
 * Two factories, `createCostTracker` and `createCostAdapter`, provide
 * zero-configuration construction for the common case.
 *
 * @packageDocumentation
 */

import {
  type CostAggregate,
  type CostConfig,
  type CostCurrency,
  type CostOptions,
  type CostRecord,
  type CostRecordInput,
  type CostStats,
  type PricingEntry,
  type PricingTable,
  CostError,
  DEFAULT_CONFIG,
  DEFAULT_CURRENCY,
  DEFAULT_PRECISION,
  UNKNOWN_PROVIDER,
  clamp,
  computeTokenCost,
  isPricingEntry,
  isPricingTable,
  roundCost,
} from './types.js';
import { CostStore } from './store.js';
import { CostIndex } from './index.js';
import { CostLifecycle, type CostLifecycleOptions } from './lifecycle.js';
import { CostQuery } from './retrieval.js';

/**
 * A sink that accepts cost records. Implement this to persist, stream or
 * aggregate records; the {@link CostTracker} dispatches every recorded call to
 * all attached collectors.
 */
export interface CostCollector {
  /**
   * Receives one fully-populated record. May return the (possibly transformed)
   * record or `void` for fire-and-forget sinks.
   *
   * @param record - The record to collect.
   * @returns Optional transformed record.
   */
  collect(record: CostRecord): CostRecord | void;
  /**
   * Optional: force any buffered records out to the backing sink.
   */
  flush?(): CostRecord[] | void;
  /**
   * Optional: release any resources held by the collector.
   */
  close?(): void;
  /**
   * Optional: current number of buffered/held records.
   */
  size?: number;
}

/**
 * The result of a detailed cost estimation, breaking a total cost into its
 * input/output components.
 */
export interface CostEstimate {
  /**
   * The model the estimate applies to.
   */
  model: string;
  /**
   * Provider derived for the estimate, when known.
   */
  provider: string;
  /**
   * Total estimated cost.
   */
  cost: number;
  /**
   * Cost attributable to input tokens alone.
   */
  inputCost: number;
  /**
   * Cost attributable to output tokens alone.
   */
  outputCost: number;
  /**
   * Input rate used, per 1k tokens (`0` when no rate was found).
   */
  inputCostPer1k: number;
  /**
   * Output rate used, per 1k tokens (`0` when no rate was found).
   */
  outputCostPer1k: number;
  /**
   * Currency the estimate is denominated in.
   */
  currency: CostCurrency;
  /**
   * `true` when a real pricing entry was applied; `false` when the model had
   * no rate (cost therefore 0).
   */
  applied: boolean;
}

/**
 * Options for a single {@link CostTracker.record} call.
 */
export interface TrackCallOptions {
  /**
   * Provider for this call.
   */
  provider?: string;
  /**
   * Session this call belongs to.
   */
  sessionId?: string;
  /**
   * Explicit call id.
   */
  callId?: string;
  /**
   * Timestamp for the record (defaults to now).
   */
  timestamp?: number;
  /**
   * Arbitrary metadata.
   */
  metadata?: Readonly<Record<string, unknown>>;
  /**
   * Explicit cost override; skips estimation when provided.
   */
  cost?: number;
}

/**
 * A handle returned by {@link CostTracker.begin}, closed by `end`.
 */
export interface TrackerHandle {
  /**
   * Unique id of this tracked invocation.
   */
  id: string;
  /**
   * Model being invoked.
   */
  model: string;
  /**
   * Epoch ms the invocation started.
   */
  startedAt: number;
  /**
   * Options captured at begin time.
   */
  options: TrackCallOptions;
}

/**
 * Options for constructing a {@link CostTracker}.
 */
export interface CostTrackerOptions {
  /**
   * Collectors to attach immediately.
   */
  collectors?: CostCollector[];
  /**
   * Whether to keep records in an internal buffer. Defaults to `true`.
   */
  buffer?: boolean;
}

/**
 * CostCalculator
 *
 * The pure pricing engine. Given a pricing table it converts token counts
 * into money and normalizes raw inputs into complete records. It never
 * persists anything — it only computes. All methods are side-effect free and
 * safe to call from any context.
 */
export class CostCalculator {
  /** Live pricing table, keyed by model. */
  private pricing: PricingTable;

  /** Default currency for estimates. */
  private readonly currency: CostCurrency;

  /** Rounding precision for computed costs. */
  private readonly precision: number;

  /** Master switch; when disabled every estimate costs 0. */
  private enabled: boolean;

  /** Model alias map applied before lookups. */
  private readonly aliases: Readonly<Record<string, string>>;

  /** Provider stamped on records that don't declare one. */
  private readonly defaultProvider: string | undefined;

  /**
   * @param config - Global configuration (see {@link CostConfig}).
   */
  constructor(config: CostConfig = {}) {
    this.pricing = { ...(config.pricing ?? {}) };
    this.currency = config.currency ?? DEFAULT_CONFIG.currency ?? DEFAULT_CURRENCY;
    this.precision = config.precision ?? DEFAULT_CONFIG.precision ?? DEFAULT_PRECISION;
    this.enabled = config.enabled ?? DEFAULT_CONFIG.enabled ?? true;
    this.aliases = config.providerAliases ?? DEFAULT_CONFIG.providerAliases ?? {};
    this.defaultProvider = config.defaultProvider;
  }

  /**
   * Whether cost computation is enabled.
   */
  get isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Toggles the master switch. When disabled, every estimate returns 0.
   *
   * @param enabled - New state.
   * @returns This calculator, for chaining.
   */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    return this;
  }

  /**
   * Applies the alias map to a model name, returning the canonical key to
   * look up in the pricing table.
   *
   * @param model - Raw model name.
   * @returns Canonical model name.
   */
  normalizeModel(model: string): string {
    return this.aliases[model] ?? model;
  }

  /**
   * Looks up the pricing entry for a model, applying aliases.
   *
   * @param model - Model name.
   * @returns The pricing entry, or `undefined` when unknown.
   */
  rateFor(model: string): PricingEntry | undefined {
    const entry = this.pricing[this.normalizeModel(model)];
    return isPricingEntry(entry) ? entry : undefined;
  }

  /**
   * Computes the total cost of a call from token counts. Returns 0 when the
   * calculator is disabled or no rate is known for the model.
   *
   * @param model - Model name.
   * @param tokensIn - Input tokens.
   * @param tokensOut - Output tokens.
   * @returns Estimated cost.
   */
  estimate(model: string, tokensIn: number, tokensOut: number): number {
    if (!this.enabled) return 0;
    const entry = this.rateFor(model);
    if (entry === undefined) return 0;
    return computeTokenCost(tokensIn, tokensOut, entry.inputCostPer1k, entry.outputCostPer1k, this.precision);
  }

  /**
   * Detailed estimate breaking cost into input/output components. Always
   * returns a structure (even for unknown models, where everything is 0 and
   * `applied` is `false`).
   *
   * @param model - Model name.
   * @param tokensIn - Input tokens.
   * @param tokensOut - Output tokens.
   * @returns A {@link CostEstimate}.
   */
  estimateDetailed(model: string, tokensIn: number, tokensOut: number): CostEstimate {
    const entry = this.enabled ? this.rateFor(model) : undefined;
    if (entry === undefined) {
      return {
        model,
        provider: this.defaultProvider ?? UNKNOWN_PROVIDER,
        cost: 0,
        inputCost: 0,
        outputCost: 0,
        inputCostPer1k: 0,
        outputCostPer1k: 0,
        currency: this.currency,
        applied: false,
      };
    }
    const safeIn = clamp(tokensIn, 0, Number.MAX_SAFE_INTEGER);
    const safeOut = clamp(tokensOut, 0, Number.MAX_SAFE_INTEGER);
    const inputCost = roundCost((safeIn * entry.inputCostPer1k) / 1000, this.precision);
    const outputCost = roundCost((safeOut * entry.outputCostPer1k) / 1000, this.precision);
    return {
      model,
      provider: entry.provider ?? this.defaultProvider ?? UNKNOWN_PROVIDER,
      cost: roundCost(inputCost + outputCost, this.precision),
      inputCost,
      outputCost,
      inputCostPer1k: entry.inputCostPer1k,
      outputCostPer1k: entry.outputCostPer1k,
      currency: entry.currency ?? this.currency,
      applied: true,
    };
  }

  /**
   * Normalizes a raw {@link CostRecordInput} into a complete {@link CostRecord},
   * estimating cost from the pricing table when the input carries no explicit
   * cost or rates.
   *
   * @param input - Raw ingest shape.
   * @returns A complete, normalized record.
   */
  fromRecord(input: CostRecordInput): CostRecord {
    const model = input.model.trim();
    const entry = this.rateFor(model);
    const hasExplicitCost = input.cost !== undefined;
    const hasRates = input.inputCostPer1k !== undefined && input.outputCostPer1k !== undefined;
    const appliedRate = hasRates
      ? { inputCostPer1k: input.inputCostPer1k as number, outputCostPer1k: input.outputCostPer1k as number }
      : entry !== undefined
        ? { inputCostPer1k: entry.inputCostPer1k, outputCostPer1k: entry.outputCostPer1k }
        : undefined;
    const cost = hasExplicitCost
      ? (input.cost as number)
      : appliedRate !== undefined && this.enabled
        ? computeTokenCost(input.tokensIn, input.tokensOut, appliedRate.inputCostPer1k, appliedRate.outputCostPer1k, this.precision)
        : 0;
    const currency = input.currency ?? entry?.currency ?? this.currency;
    return {
      id: input.id ?? `cost_${Math.random().toString(36).slice(2)}`,
      model,
      provider: input.provider ?? entry?.provider ?? this.defaultProvider ?? UNKNOWN_PROVIDER,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      inputCostPer1k: appliedRate?.inputCostPer1k ?? input.inputCostPer1k,
      outputCostPer1k: appliedRate?.outputCostPer1k ?? input.outputCostPer1k,
      cost: roundCost(cost, this.precision),
      currency,
      timestamp: input.timestamp ?? Date.now(),
      sessionId: input.sessionId,
      callId: input.callId,
      metadata: input.metadata,
    };
  }

  /**
   * Replaces the pricing table wholesale.
   *
   * @param table - New table. Validated when non-empty.
   * @returns This calculator, for chaining.
   * @throws CostError when the table is structurally invalid.
   */
  setPricing(table: PricingTable): this {
    if (!isPricingTable(table)) {
      throw new CostError('ERR_INVALID_PRICING', 'pricing table must map model names to valid pricing entries');
    }
    this.pricing = { ...table };
    return this;
  }

  /**
   * Merges entries into the existing table (later entries win per model).
   *
   * @param table - Entries to merge.
   * @returns This calculator, for chaining.
   */
  mergePricing(table: PricingTable): this {
    for (const [model, entry] of Object.entries(table)) {
      if (isPricingEntry(entry)) this.pricing[model] = entry;
    }
    return this;
  }

  /**
   * Snapshot of the current pricing table.
   *
   * @returns A shallow copy of the table.
   */
  getPricing(): PricingTable {
    return { ...this.pricing };
  }

  /**
   * Adds or updates a single model's pricing entry.
   *
   * @param model - Model name.
   * @param entry - Pricing entry.
   * @returns This calculator, for chaining.
   */
  setRate(model: string, entry: PricingEntry): this {
    this.pricing[model] = entry;
    return this;
  }

  /**
   * Removes a model from the pricing table.
   *
   * @param model - Model name.
   * @returns `true` when a rate was removed.
   */
  unsetRate(model: string): boolean {
    const had = model in this.pricing;
    delete this.pricing[model];
    return had;
  }
}

/**
 * CostTracker
 *
 * The "record a call" entry point. Combines a {@link CostCalculator} with a
 * dispatch mechanism: every recorded call is costed automatically and pushed
 * to every attached {@link CostCollector}. Supports both one-shot `record`
 * calls and timed `begin`/`end` sessions for latency + cost correlation.
 */
export class CostTracker {
  /** The calculator used for costing. */
  readonly calculator: CostCalculator;

  /** Attached collectors. */
  private readonly collectors: Set<CostCollector> = new Set();

  /** Optional internal buffer of records. */
  private readonly buffer: CostRecord[];

  /** Whether the buffer is active. */
  private readonly buffering: boolean;

  /** Live begin/end handles keyed by handle id. */
  private readonly sessions: Map<string, TrackerHandle> = new Map();

  /** Sequence for generating handle ids. */
  private seq = 0;

  /**
   * @param config - Global cost configuration.
   * @param options - Tracker tuning (see {@link CostTrackerOptions}).
   */
  constructor(config: CostConfig = {}, options: CostTrackerOptions = {}) {
    this.calculator = new CostCalculator(config);
    this.buffering = options.buffer ?? true;
    this.buffer = [];
    for (const collector of options.collectors ?? []) this.attach(collector);
  }

  /**
   * Number of records held in the internal buffer.
   */
  get size(): number {
    return this.buffer.length;
  }

  /**
   * Number of active begin/end sessions.
   */
  get activeSessions(): number {
    return this.sessions.size;
  }

  /**
   * Records a completed call, computing cost automatically from the pricing
   * table unless an explicit cost/rates are supplied.
   *
   * @param model - Model name.
   * @param tokensIn - Input tokens.
   * @param tokensOut - Output tokens.
   * @param options - Per-call options (see {@link TrackCallOptions}).
   * @returns The fully-populated record.
   */
  record(model: string, tokensIn: number, tokensOut: number, options: TrackCallOptions = {}): CostRecord {
    const record = this.calculator.fromRecord({
      model,
      tokensIn,
      tokensOut,
      provider: options.provider,
      sessionId: options.sessionId,
      callId: options.callId,
      timestamp: options.timestamp,
      metadata: options.metadata,
      cost: options.cost,
    });
    if (this.buffering) this.buffer.push(record);
    this.dispatch(record);
    return record;
  }

  /**
   * Records many calls in one batch.
   *
   * @param calls - Array of `{ model, tokensIn, tokensOut, options }` tuples.
   * @returns The recorded records.
   */
  recordMany(
    calls: ReadonlyArray<
      { model: string; tokensIn: number; tokensOut: number } & TrackCallOptions
    >,
  ): CostRecord[] {
    return calls.map((call) =>
      this.record(call.model, call.tokensIn, call.tokensOut, {
        provider: call.provider,
        sessionId: call.sessionId,
        callId: call.callId,
        timestamp: call.timestamp,
        metadata: call.metadata,
        cost: call.cost,
      }),
    );
  }

  /**
   * Begins a timed invocation. Returns a handle that must be closed with
   * {@link CostTracker.end}. Useful when token counts are only known after
   * the model responds.
   *
   * @param model - Model name.
   * @param options - Per-call options captured for the eventual record.
   * @returns A handle for the invocation.
   */
  begin(model: string, options: TrackCallOptions = {}): TrackerHandle {
    const id = `call_${++this.seq}_${Date.now().toString(36)}`;
    const handle: TrackerHandle = {
      id,
      model,
      startedAt: Date.now(),
      options: { ...options },
    };
    this.sessions.set(id, handle);
    return handle;
  }

  /**
   * Closes a timed invocation and records it with the tokens that were
   * measured during the call.
   *
   * @param handle - The handle returned by {@link CostTracker.begin}.
   * @param tokensIn - Input tokens measured.
   * @param tokensOut - Output tokens measured.
   * @returns The recorded record.
   * @throws CostError when the handle is unknown or already closed.
   */
  end(handle: TrackerHandle, tokensIn: number, tokensOut: number): CostRecord {
    if (!this.sessions.delete(handle.id)) {
      throw new CostError('ERR_UNKNOWN_SESSION', `no active tracked call for handle "${handle.id}"`);
    }
    return this.record(handle.model, tokensIn, tokensOut, {
      ...handle.options,
      timestamp: handle.options.timestamp ?? handle.startedAt,
    });
  }

  /**
   * Cancels a timed invocation without recording anything.
   *
   * @param handle - The handle to cancel.
   * @returns `true` when a session was cancelled.
   */
  cancel(handle: TrackerHandle): boolean {
    return this.sessions.delete(handle.id);
  }

  /**
   * Attaches a collector; every subsequently recorded call is dispatched to
   * it.
   *
   * @param collector - Collector to attach.
   * @returns A detach function.
   */
  attach(collector: CostCollector): () => void {
    this.collectors.add(collector);
    return () => this.collectors.delete(collector);
  }

  /**
   * Detaches a collector.
   *
   * @param collector - Collector to detach.
   * @returns `true` when it was attached.
   */
  detach(collector: CostCollector): boolean {
    return this.collectors.delete(collector);
  }

  /**
   * Number of attached collectors.
   */
  get collectorCount(): number {
    return this.collectors.size;
  }

  /**
   * Dispatches a record to every attached collector.
   *
   * @param record - Record to fan out.
   */
  private dispatch(record: CostRecord): void {
    for (const collector of this.collectors) {
      try {
        collector.collect(record);
      } catch {
        // Sinks must never break the caller; the tracker keeps going.
      }
    }
  }

  /**
   * All records currently held in the internal buffer, in insertion order.
   *
   * @returns Buffered records.
   */
  records(): CostRecord[] {
    return [...this.buffer];
  }

  /**
   * Total cost of buffered records.
   *
   * @returns Rounded sum.
   */
  total(): number {
    return roundCost(this.buffer.reduce((sum, record) => sum + record.cost, 0));
  }

  /**
   * Flushes the internal buffer to every attached collector and clears it.
   *
   * @returns The records that were flushed.
   */
  flush(): CostRecord[] {
    const flushed = [...this.buffer];
    this.buffer.length = 0;
    for (const collector of this.collectors) {
      try {
        collector.flush?.();
      } catch {
        // Best-effort.
      }
    }
    return flushed;
  }

  /**
   * Clears the internal buffer without dispatching.
   */
  clear(): void {
    this.buffer.length = 0;
    this.sessions.clear();
  }

  /**
   * Closes every attached collector.
   */
  close(): void {
    for (const collector of this.collectors) {
      try {
        collector.close?.();
      } catch {
        // Best-effort.
      }
    }
    this.collectors.clear();
  }
}

/**
 * Options for constructing a {@link CostAdapter}.
 */
export interface CostAdapterOptions extends CostLifecycleOptions {
  /**
   * Store construction options when the store is created internally.
   */
  storeOptions?: CostOptions;
  /**
   * A pre-built lifecycle to own the store/index. When omitted the adapter
   * constructs one internally.
   */
  lifecycle?: CostLifecycle;
}

/**
 * CostAdapter
 *
 * The full observability engine in one object. Composes a {@link CostStore},
 * a {@link CostIndex} and a {@link CostLifecycle}, and implements the
 * {@link CostCollector} interface so it can be attached directly to a
 * {@link CostTracker}. Exposes both write (`collect`) and read (`query`,
 * `stats`, `total`, `byModel`, ...) paths.
 */
export class CostAdapter implements CostCollector {
  /** Underlying store. */
  readonly store: CostStore;

  /** Underlying secondary index. */
  readonly index: CostIndex;

  /** Underlying lifecycle (retention + rollup). */
  readonly lifecycle: CostLifecycle;

  /** The pricing/estimate engine. */
  readonly calculator: CostCalculator;

  /**
   * @param config - Global cost configuration.
   * @param options - Adapter/lifecycle options.
   */
  constructor(config: CostConfig = {}, options: CostAdapterOptions = {}) {
    this.store = options.store ?? new CostStore(options.storeOptions);
    this.index = options.index ?? new CostIndex();
    this.lifecycle = options.lifecycle ?? new CostLifecycle({ store: this.store, index: this.index, useIndex: true });
    this.calculator = new CostCalculator(config);
  }

  /**
   * Number of stored records.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Collects a record: estimates any missing cost and persists it through the
   * lifecycle (which keeps the index in sync and emits events). Satisfies the
   * {@link CostCollector} contract.
   *
   * @param record - Record to collect.
   * @returns The persisted, normalized record.
   */
  collect(record: CostRecord): CostRecord {
    return this.lifecycle.addRecord(this.calculator.fromRecord(record));
  }

  /**
   * Collects many records at once.
   *
   * @param records - Records to collect.
   * @returns The persisted records.
   */
  collectMany(records: readonly CostRecordInput[]): CostRecord[] {
    return this.lifecycle.addRecords(records);
  }

  /**
   * Flushes by returning a sorted snapshot of all stored records.
   *
   * @returns All stored records.
   */
  flush(): CostRecord[] {
    return this.store.values();
  }

  /**
   * Releases lifecycle resources (stops timers, removes listeners).
   */
  close(): void {
    this.lifecycle.dispose();
  }

  /**
   * Builds a {@link CostQuery} over the adapter's store.
   *
   * @returns A query view.
   */
  query(): CostQuery {
    return new CostQuery(this.store, this.store.defaultCurrency);
  }

  /**
   * Full statistical snapshot.
   *
   * @returns Current store statistics.
   */
  stats(): CostStats {
    return this.store.stats();
  }

  /**
   * Total spend across all stored records.
   *
   * @returns Rounded sum.
   */
  total(): number {
    return this.store.getTotal();
  }

  /**
   * Per-model aggregates.
   *
   * @returns Aggregates sorted by total cost descending.
   */
  byModel(): CostAggregate[] {
    return this.store.getModelAggregates();
  }

  /**
   * Per-provider aggregates.
   *
   * @returns Aggregates sorted by total cost descending.
   */
  byProvider(): CostAggregate[] {
    return this.store.getProviderAggregates();
  }

  /**
   * Total cost of one session.
   *
   * @param sessionId - Session id.
   * @returns Rounded sum.
   */
  sessionCost(sessionId: string): number {
    return this.store.getSessionTotal(sessionId);
  }

  /**
   * Prunes records older than a retention window.
   *
   * @param olderThanMs - Retention window in ms.
   * @returns The removed records.
   */
  prune(olderThanMs: number): CostRecord[] {
    return this.lifecycle.prune(olderThanMs);
  }

  /**
   * Serializes the adapter's data.
   *
   * @returns A JSON-safe store snapshot.
   */
  toJSON(): ReturnType<CostStore['toJSON']> {
    return this.store.toJSON();
  }

  /**
   * Loads a store snapshot.
   *
   * @param snapshot - Snapshot produced by {@link CostAdapter.toJSON}.
   * @returns This adapter, for chaining.
   */
  fromJSON(snapshot: ReturnType<CostStore['toJSON']>): this {
    this.store.fromJSON(snapshot);
    this.index.clear();
    this.index.addBatch(this.store.values());
    return this;
  }
}

/**
 * Zero-configuration factory for a {@link CostTracker}.
 *
 * @param config - Global cost configuration.
 * @param options - Tracker options.
 * @returns A ready-to-use tracker.
 */
export function createCostTracker(config: CostConfig = {}, options: CostTrackerOptions = {}): CostTracker {
  return new CostTracker(config, options);
}

/**
 * Zero-configuration factory for a {@link CostAdapter}.
 *
 * @param config - Global cost configuration.
 * @param options - Adapter options.
 * @returns A ready-to-use adapter.
 */
export function createCostAdapter(config: CostConfig = {}, options: CostAdapterOptions = {}): CostAdapter {
  return new CostAdapter(config, options);
}

/**
 * Convenience: creates a tracker already wired to an adapter, so the tracker's
 * records flow straight into a full observability engine.
 *
 * @param config - Global cost configuration.
 * @param adapterOptions - Options passed to the underlying adapter.
 * @returns `{ tracker, adapter }` — the wired pair.
 */
export function createCostPipeline(
  config: CostConfig = {},
  adapterOptions: CostAdapterOptions = {},
): { tracker: CostTracker; adapter: CostAdapter } {
  const adapter = createCostAdapter(config, adapterOptions);
  const tracker = createCostTracker(config, { collectors: [adapter], buffer: true });
  return { tracker, adapter };
}