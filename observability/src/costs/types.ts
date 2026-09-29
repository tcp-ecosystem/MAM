/**
 * types.ts
 *
 * Core type definitions and shared runtime helpers for the MAM Costs layer.
 *
 * The Costs layer is a standalone, dependency-free observability engine that
 * accounts for the monetary cost of every model call. This module is the
 * foundation of the layer: it declares the canonical shapes used by the rest
 * of the pipeline (`CostStore`, `CostIndex`, `CostQuery`, `CostLifecycle`,
 * `CostCalculator`, `CostTracker` and `CostAdapter`) and provides the small
 * set of pure functions those components rely on (currency handling, token
 * arithmetic, rounding, validation and date bucketing).
 *
 * Design principles:
 *  - Every monetary value is expressed in a fixed currency (default USD) and
 *    stored as a number so it can be summed/aggregated cheaply.
 *  - Token counts are whole, non-negative integers. Negative or fractional
 *    token counts are rejected by the validation helpers exported here.
 *  - A {@link CostRecord} is the atomic unit. It is fully denormalized: it
 *    carries the rates that were applied so that historical records stay
 *    meaningful even when the pricing table later changes.
 *  - All numeric helpers are total/functional: they never mutate their
 *    inputs and never throw on degenerate input (they clamp instead).
 *
 * @packageDocumentation
 */

/**
 * ISO 4217 currency codes supported by the Costs layer.
 *
 * New codes can be added to {@link SUPPORTED_CURRENCIES} and
 * {@link CURRENCY_SYMBOLS} without breaking any consumer because all
 * components treat currency as an optional, mostly cosmetic attribute.
 */
export type CostCurrency =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'CNY'
  | 'CAD'
  | 'AUD'
  | 'CHF'
  | 'INR'
  | 'KRW';

/**
 * The set of currency codes the formatter and validation helpers recognize.
 * Kept as a frozen tuple so the union `CostCurrency` stays in sync.
 */
export const SUPPORTED_CURRENCIES: readonly CostCurrency[] = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'CAD',
  'AUD',
  'CHF',
  'INR',
  'KRW',
] as const;

/**
 * Currency symbols used by {@link formatCost}. USD is rendered with `$`, EUR
 * with `€`, etc. Unknown/unsupported codes fall back to an empty prefix.
 */
export const CURRENCY_SYMBOLS: Readonly<Record<CostCurrency, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  CAD: 'C$',
  AUD: 'A$',
  CHF: 'Fr.',
  INR: '₹',
  KRW: '₩',
};

/**
 * Default currency applied whenever a record, config or option does not
 * declare one. All aggregations assume a single currency per store; storing
 * records with mixed currencies is allowed but the totals will be ambiguous.
 */
export const DEFAULT_CURRENCY: CostCurrency = 'USD';

/**
 * Tight runtime guard for {@link CostCurrency}. Accepts any string that is
 * present in {@link SUPPORTED_CURRENCIES}.
 *
 * @param value - Value to test.
 * @returns True when `value` is a supported currency code.
 */
export function isCurrency(value: unknown): value is CostCurrency {
  return typeof value === 'string' && (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

/**
 * Sentinel representing "no money". Used to avoid scattering raw `0` literals.
 */
export const ZERO_COST = 0;

/**
 * Default rounding precision for computed/aggregated costs (6 decimal places
 * keeps sub-cent accuracy while remaining JSON-safe).
 */
export const DEFAULT_PRECISION = 6;

/**
 * A provider is an opaque string identifier (e.g. `"openai"`, `"anthropic"`,
 * `"azure"`). Free-form by design so the layer never needs to enumerate every
 * LLM vendor on the planet.
 */
export type CostProvider = string;

/**
 * A model is an opaque string identifier (e.g. `"gpt-4o"`, `"claude-3-5-sonnet"`).
 */
export type CostModel = string;

/**
 * A session groups many calls together (e.g. one interactive conversation or
 * one batch job). Optional on every record.
 */
export type CostSessionId = string;

/**
 * A call uniquely identifies one individual model invocation. Optional on
 * records; the store generates one when absent.
 */
export type CostCallId = string;

/**
 * Provider label used when a record has no explicit provider. This keeps
 * provider aggregations total (every record falls into exactly one bucket).
 */
export const UNKNOWN_PROVIDER: CostProvider = 'unknown';

/**
 * A pricing entry describes the per-1k-token rates for one model in one
 * currency. Rates are stored in the record at ingestion time so historical
 * data never needs the live pricing table to be interpreted.
 */
export interface PricingEntry {
  /**
   * Cost per 1,000 input (prompt) tokens.
   */
  inputCostPer1k: number;
  /**
   * Cost per 1,000 output (completion) tokens.
   */
  outputCostPer1k: number;
  /**
   * Currency the rates are expressed in. Defaults to {@link DEFAULT_CURRENCY}.
   */
  currency?: CostCurrency;
  /**
   * Optional provider this entry belongs to (used for billing/rollup).
   */
  provider?: CostProvider;
  /**
   * Free-form provenance string, e.g. `"vendor-price-page v2024-06-01"`.
   */
  source?: string;
  /**
   * Unix epoch (ms) when this entry was last observed/updated.
   */
  updatedAt?: number;
  /**
   * Arbitrary extra metadata (prompt caching rates, batch discounts, etc.).
   */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A pricing table maps model identifiers to their pricing entries. Lookups are
 * O(1) Map-style dictionary lookups; the {@link CostCalculator} consults this
 * structure to turn token counts into money.
 */
export interface PricingTable {
  [model: string]: PricingEntry;
}

/**
 * Runtime guard for {@link PricingEntry}. A valid entry must have finite,
 * non-negative numeric input/output rates (zero is legal — free models).
 *
 * @param value - Value to test.
 * @returns True when `value` is a structurally valid pricing entry.
 */
export function isPricingEntry(value: unknown): value is PricingEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PricingEntry>;
  return (
    typeof v.inputCostPer1k === 'number' &&
    Number.isFinite(v.inputCostPer1k) &&
    v.inputCostPer1k >= 0 &&
    typeof v.outputCostPer1k === 'number' &&
    Number.isFinite(v.outputCostPer1k) &&
    v.outputCostPer1k >= 0
  );
}

/**
 * Runtime guard for {@link PricingTable}. Accepts any plain object whose
 * values all pass {@link isPricingEntry}.
 *
 * @param value - Value to test.
 * @returns True when `value` is a pricing table.
 */
export function isPricingTable(value: unknown): value is PricingTable {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => isPricingEntry(entry));
}

/**
 * The canonical, denormalized unit of the Costs layer.
 *
 * A `CostRecord` represents one charged model call. It stores everything
 * needed to reason about money: the token split, the rates that were applied,
 * the resulting cost and the temporal/grouping attributes. Records are
 * immutable in practice — components treat them as value objects.
 */
export interface CostRecord {
  /**
   * Unique identifier. Generated by the store when absent at ingestion.
   */
  id: string;
  /**
   * Model identifier (e.g. `"gpt-4o"`).
   */
  model: string;
  /**
   * Provider identifier. Optional; defaults to {@link UNKNOWN_PROVIDER}.
   */
  provider?: CostProvider;
  /**
   * Number of input (prompt) tokens. Non-negative integer.
   */
  tokensIn: number;
  /**
   * Number of output (completion) tokens. Non-negative integer.
   */
  tokensOut: number;
  /**
   * Input rate applied, per 1k tokens. Stored so the record is self-describing.
   */
  inputCostPer1k?: number;
  /**
   * Output rate applied, per 1k tokens.
   */
  outputCostPer1k?: number;
  /**
   * Total monetary cost of the call, in {@link CostRecord.currency}.
   */
  cost: number;
  /**
   * Currency of {@link CostRecord.cost}. Defaults to {@link DEFAULT_CURRENCY}.
   */
  currency?: CostCurrency;
  /**
   * Unix epoch (ms) the call was recorded.
   */
  timestamp: number;
  /**
   * Optional session the call belongs to.
   */
  sessionId?: CostSessionId;
  /**
   * Optional call identifier (dedupe/trace correlation).
   */
  callId?: CostCallId;
  /**
   * Arbitrary extra metadata attached at ingestion.
   */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The ingest shape accepted by stores and trackers. Everything is optional
 * except `model`, `tokensIn` and `tokensOut`; the layer fills the rest.
 */
export interface CostRecordInput {
  /**
   * Optional explicit id. A UUID is generated when omitted.
   */
  id?: string;
  /**
   * Model identifier. Required.
   */
  model: string;
  /**
   * Provider identifier. Optional.
   */
  provider?: CostProvider;
  /**
   * Input (prompt) tokens. Required, non-negative integer.
   */
  tokensIn: number;
  /**
   * Output (completion) tokens. Required, non-negative integer.
   */
  tokensOut: number;
  /**
   * Explicit input rate per 1k tokens. When omitted together with `cost`,
   * cost is computed from the pricing table at the tracker layer.
   */
  inputCostPer1k?: number;
  /**
   * Explicit output rate per 1k tokens.
   */
  outputCostPer1k?: number;
  /**
   * Explicit total cost. When provided it wins over any computation.
   */
  cost?: number;
  /**
   * Currency for the record. Defaults to the store/config default.
   */
  currency?: CostCurrency;
  /**
   * Timestamp; defaults to `Date.now()`.
   */
  timestamp?: number;
  /**
   * Optional session grouping.
   */
  sessionId?: CostSessionId;
  /**
   * Optional call identifier.
   */
  callId?: CostCallId;
  /**
   * Arbitrary metadata.
   */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Structural guard for {@link CostRecord}. Enforces the required fields and
 * that numeric fields are finite (token counts must also be non-negative).
 *
 * @param value - Value to test.
 * @returns True when `value` is a structurally valid record.
 */
export function isCostRecord(value: unknown): value is CostRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CostRecord>;
  return (
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.model === 'string' &&
    v.model.length > 0 &&
    typeof v.tokensIn === 'number' &&
    Number.isFinite(v.tokensIn) &&
    v.tokensIn >= 0 &&
    typeof v.tokensOut === 'number' &&
    Number.isFinite(v.tokensOut) &&
    v.tokensOut >= 0 &&
    typeof v.cost === 'number' &&
    Number.isFinite(v.cost) &&
    typeof v.timestamp === 'number' &&
    Number.isFinite(v.timestamp)
  );
}

/**
 * Structural guard for {@link CostRecordInput}.
 *
 * @param value - Value to test.
 * @returns True when `value` is a structurally valid ingest shape.
 */
export function isCostRecordInput(value: unknown): value is CostRecordInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<CostRecordInput>;
  return (
    typeof v.model === 'string' &&
    v.model.length > 0 &&
    typeof v.tokensIn === 'number' &&
    Number.isFinite(v.tokensIn) &&
    v.tokensIn >= 0 &&
    typeof v.tokensOut === 'number' &&
    Number.isFinite(v.tokensOut) &&
    v.tokensOut >= 0
  );
}

/**
 * Global configuration for the Costs layer. Consumed by the calculator,
 * tracker and adapter factories to keep pricing and display consistent.
 */
export interface CostConfig {
  /**
   * Initial pricing table, keyed by model.
   */
  pricing?: PricingTable;
  /**
   * Default currency for computed costs.
   */
  currency?: CostCurrency;
  /**
   * Rounding precision (decimal places) applied to computed costs.
   */
  precision?: number;
  /**
   * Master switch. When `false`, calculators return `0` cost for everything.
   */
  enabled?: boolean;
  /**
   * Model-name alias map (e.g. `{ "gpt4": "gpt-4o" }`) applied before lookups.
   */
  providerAliases?: Readonly<Record<string, string>>;
  /**
   * Provider stamped onto records that do not declare one.
   */
  defaultProvider?: CostProvider;
  /**
   * Whether stores/trackers auto-generate ids for records missing them.
   */
  autoId?: boolean;
}

/**
 * Defaults for every {@link CostConfig} field. Consumers spread this and
 * override selectively.
 */
export const DEFAULT_CONFIG: CostConfig = {
  currency: DEFAULT_CURRENCY,
  precision: DEFAULT_PRECISION,
  enabled: true,
  autoId: true,
  pricing: {},
  providerAliases: {},
};

/**
 * Construction options for a {@link CostStore}. Tuned per-store rather than
 * globally because different stores have different retention needs.
 */
export interface CostOptions {
  /**
   * Prefix for auto-generated ids (e.g. `"cost"` yields `cost_<uuid>`).
   */
  idPrefix?: string;
  /**
   * Default currency for records without one.
   */
  currency?: CostCurrency;
  /**
   * Rounding precision for normalized costs.
   */
  precision?: number;
  /**
   * Optional hard cap on stored records.
   */
  maxRecords?: number;
  /**
   * Behaviour when {@link CostOptions.maxRecords} is reached:
   * `"oldest"` evicts the oldest record, `"error"` throws, `"ignore"` drops
   * the incoming record. Defaults to `"oldest"`.
   */
  evictionPolicy?: 'oldest' | 'error' | 'ignore';
  /**
   * Whether ingestion validates inputs. Defaults to `true`.
   */
  validate?: boolean;
  /**
   * Whether invalid inputs throw (`true`) or are silently dropped (`false`).
   */
  throwOnInvalid?: boolean;
}

/**
 * A grouped aggregation bucket. Produced by `byModel`, `byProvider` and
 * `bySession` queries so a single shape serves every grouping dimension.
 */
export interface CostAggregate {
  /**
   * Group key (model name, provider name or session id).
   */
  key: string;
  /**
   * Number of records in the bucket.
   */
  count: number;
  /**
   * Sum of `cost` across the bucket.
   */
  totalCost: number;
  /**
   * Sum of input tokens across the bucket.
   */
  totalTokensIn: number;
  /**
   * Sum of output tokens across the bucket.
   */
  totalTokensOut: number;
  /**
   * `totalCost / count` (0 for empty buckets).
   */
  averageCost: number;
  /**
   * Smallest single-call cost in the bucket.
   */
  minCost: number;
  /**
   * Largest single-call cost in the bucket.
   */
  maxCost: number;
  /**
   * Currency the cost figures are expressed in.
   */
  currency: CostCurrency;
  /**
   * Earliest record timestamp in the bucket, or `null` when empty.
   */
  firstTimestamp: number | null;
  /**
   * Latest record timestamp in the bucket, or `null` when empty.
   */
  lastTimestamp: number | null;
}

/**
 * A full statistical snapshot of a store, produced by `CostStore.stats()` and
 * consumed by dashboards, the lifecycle rollup and persistence layers.
 */
export interface CostStats {
  /**
   * Total number of records.
   */
  recordCount: number;
  /**
   * Sum of all record costs.
   */
  totalCost: number;
  /**
   * Sum of all input tokens.
   */
  totalTokensIn: number;
  /**
   * Sum of all output tokens.
   */
  totalTokensOut: number;
  /**
   * Mean cost per recorded call.
   */
  averageCostPerCall: number;
  /**
   * Number of distinct models present.
   */
  models: number;
  /**
   * Number of distinct providers present.
   */
  providers: number;
  /**
   * Number of distinct sessions present.
   */
  sessions: number;
  /**
   * Smallest single-record cost, or 0 when empty.
   */
  minCost: number;
  /**
   * Largest single-record cost, or 0 when empty.
   */
  maxCost: number;
  /**
   * Currency of all cost figures.
   */
  currency: CostCurrency;
  /**
   * Timestamp of the oldest record, or `null` when empty.
   */
  oldestRecord: number | null;
  /**
   * Timestamp of the newest record, or `null` when empty.
   */
  newestRecord: number | null;
}

/**
 * Bounds a number to `[min, max]`. Used to defend arithmetic against
 * degenerate (negative/NaN/Infinity) input without throwing.
 *
 * @param value - Input value.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns Clamped finite value.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return max >= 0 ? max : min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Rounds a monetary value to `precision` decimal places using fixed-point
 * rounding (avoids float drift from naive `toFixed` on repeated accumulation).
 *
 * @param value - Value to round.
 * @param precision - Number of decimal places (default {@link DEFAULT_PRECISION}).
 * @returns Rounded value.
 */
export function roundCost(value: number, precision: number = DEFAULT_PRECISION): number {
  if (!Number.isFinite(value)) return ZERO_COST;
  const factor = Math.pow(10, precision);
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Computes the monetary cost of a call from token counts and per-1k rates:
 *
 * ```
 * cost = tokensIn * inputRate / 1000 + tokensOut * outputRate / 1000
 * ```
 *
 * All inputs are clamped to non-negative, so this is safe on partial data.
 *
 * @param tokensIn - Input tokens.
 * @param tokensOut - Output tokens.
 * @param inputCostPer1k - Input rate per 1k tokens.
 * @param outputCostPer1k - Output rate per 1k tokens.
 * @param precision - Rounding precision.
 * @returns Computed, rounded cost.
 */
export function computeTokenCost(
  tokensIn: number,
  tokensOut: number,
  inputCostPer1k: number,
  outputCostPer1k: number,
  precision: number = DEFAULT_PRECISION,
): number {
  const inputCost = (clamp(tokensIn, 0, Number.MAX_SAFE_INTEGER) * clamp(inputCostPer1k, 0, Number.MAX_SAFE_INTEGER)) / 1000;
  const outputCost = (clamp(tokensOut, 0, Number.MAX_SAFE_INTEGER) * clamp(outputCostPer1k, 0, Number.MAX_SAFE_INTEGER)) / 1000;
  return roundCost(inputCost + outputCost, precision);
}

/**
 * Convenience: derives the stored cost of a record, defaulting to the record's
 * own `cost` field but recomputing from stored rates when it is missing/zero.
 *
 * @param record - The record to inspect.
 * @returns A non-negative cost figure.
 */
export function costFromRecord(record: CostRecord): number {
  if (typeof record.cost === 'number' && Number.isFinite(record.cost) && record.cost > 0) {
    return record.cost;
  }
  if (
    typeof record.inputCostPer1k === 'number' &&
    typeof record.outputCostPer1k === 'number' &&
    Number.isFinite(record.inputCostPer1k) &&
    Number.isFinite(record.outputCostPer1k)
  ) {
    return computeTokenCost(record.tokensIn, record.tokensOut, record.inputCostPer1k, record.outputCostPer1k);
  }
  return ZERO_COST;
}

/**
 * Formats a monetary value as a human-readable string with its currency
 * symbol and fixed decimals, e.g. `"$1.23"`.
 *
 * @param value - Value to format.
 * @param currency - Currency to prefix with its symbol.
 * @param precision - Decimal places (default 2 for display).
 * @returns Formatted string.
 */
export function formatCost(value: number, currency: CostCurrency = DEFAULT_CURRENCY, precision = 2): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const numeric = roundCost(value, precision).toFixed(precision);
  return `${symbol}${numeric}`;
}

/**
 * Converts a timestamp into a UTC calendar-day bucket key of the form
 * `YYYY-MM-DD`. Used by the date index and retention pruning.
 *
 * @param timestamp - Unix epoch (ms).
 * @returns Calendar-day key, e.g. `"2026-09-28"`.
 */
export function dateKey(timestamp: number): string {
  const d = new Date(timestamp);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the calendar-day key for "now" (or an explicit reference time).
 *
 * @param now - Reference time in ms (defaults to `Date.now()`).
 * @returns Calendar-day key.
 */
export function todayKey(now: number = Date.now()): string {
  return dateKey(now);
}

/**
 * Validates that a value is a usable timestamp (finite, >= 0). Used by stores
 * before persisting records.
 *
 * @param value - Value to test.
 * @returns True when the value is a plausible timestamp.
 */
export function isValidTimestamp(value: number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validates a token count: must be a non-negative integer. Throws
 * {@link CostError} (message `ERR_INVALID_TOKEN_COUNT`) when invalid.
 *
 * @param value - Token count to validate.
 * @param name - Field name used in the error message.
 * @throws CostError when the value is not a non-negative integer.
 */
export function assertValidTokenCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new CostError('ERR_INVALID_TOKEN_COUNT', `${name} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Stable ordering for records: ascending timestamp, tie-broken by id so the
 * sort is total and deterministic across runs.
 *
 * @param a - First record.
 * @param b - Second record.
 * @returns Negative/zero/positive as in a comparator.
 */
export function compareCostRecords(a: CostRecord, b: CostRecord): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id.localeCompare(b.id);
}

/**
 * CostError is the single error type thrown by the Costs layer. Every instance
 * carries a stable machine-readable `code` (e.g. `ERR_INVALID_TOKEN_COUNT`,
 * `ERR_MAX_RECORDS`, `ERR_INVALID_PRICING`) in addition to a human message.
 */
export class CostError extends Error {
  /**
   * Stable machine-readable error code.
   */
  readonly code: string;

  /**
   * @param code - Stable error code.
   * @param message - Human-readable description.
   * @param options - Standard Error options (e.g. `{ cause }`).
   */
  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CostError';
    this.code = code;
  }
}