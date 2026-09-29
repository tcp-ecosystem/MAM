/**
 * types.ts
 *
 * Core type definitions, guards, factories and defaults for the Invocation
 * layer of the standalone MAM Tool Engine.
 *
 * The Invocation layer executes tool handlers with timeout, retry, caching
 * and mock-mode support, and records execution history plus statistics for
 * every invocation that passes through it.
 *
 * The reference model this layer implements comes straight from the MAM
 * runtime tool engine:
 *
 *     ToolHandler = (params, context?) => Promise<unknown>
 *
 * and the operations built on top of it:
 *
 *     executeWithTimeout, setTimeout, setRetryPolicy,
 *     enableCache / disableCache, mockTool,
 *     getExecutionHistory, getStats
 *
 * This module is the single source of truth for the shapes that travel
 * through the recording store (`store.ts`), the query index (`index.ts`),
 * the execution engine (`retrieval.ts`), the lifecycle manager
 * (`lifecycle.ts`) and the high-level facade (`integration.ts`).
 *
 * Design notes:
 *
 *   - Every *data* shape is a plain, JSON-friendly interface so that
 *     `toJSON` / `fromJSON` round-trips and structured logging work without
 *     surprises. Optional fields are optional everywhere so partial results
 *     (for example a result that errored before producing a value) remain
 *     representable.
 *   - Functions are kept in separate, explicitly-typed slots (`ToolHandler`,
 *     `ToolExecutor`) so the data model stays serialisable.
 *   - Guards (`isRetryPolicy`, `isInvocationResult`, ...) let consumers
 *     validate untrusted input — for example results loaded back from disk —
 *     before trusting them.
 *   - Factories (`createInvocationResult`, `createExecutionRecord`,
 *     `createEmptyToolStats`) guarantee the invariants that recording and
 *     statistics code rely on.
 *   - Defaults (`DEFAULT_RETRY_POLICY`, `DEFAULT_INVOCATION_CONFIG`) and
 *     resolvers (`resolveRetryPolicy`, `resolveInvocationConfig`,
 *     `resolveInvokeOptions`) make partial configuration safe everywhere.
 */

import type { EventEmitter } from 'node:events';

/* -------------------------------------------------------------------------- *
 * Tool handler & invocation context
 * -------------------------------------------------------------------------- */

/**
 * The callable implementation of a tool.
 *
 * This is the reference model of the MAM runtime tool engine, widened
 * slightly so that both synchronous handlers (`() => value`) and
 * asynchronous handlers (`async () => value`) type-check. The executor
 * normalises the return value through `Promise.resolve`, so the two forms
 * behave identically at runtime.
 *
 * @param params the invocation parameters supplied by the caller. Shape is
 *   defined by the tool itself; this layer treats it as opaque.
 * @param context optional execution context — see {@link InvocationContext}.
 * @returns the tool result, or a promise resolving to it.
 */
export type ToolHandler = (
  params: unknown,
  context?: unknown,
) => unknown | Promise<unknown>;

/**
 * The execution context handed to a {@link ToolHandler} on every attempt.
 *
 * Context is intentionally schema-light: the tool may read `traceId`,
 * `tool`, `attempt` and `signal`, and may also receive arbitrary application
 * fields copied from `InvocationRequest.context`.
 */
export interface InvocationContext {
  /** Correlation id propagated from the request / invocation options. */
  traceId?: string;

  /** The name of the tool currently being invoked. */
  tool?: string;

  /** The current attempt number, 1-based. Re-set before every retry. */
  attempt?: number;

  /**
   * An `AbortSignal` that is aborted when the per-attempt timeout fires or
   * when a caller-supplied signal aborts. Cooperative handlers should listen
   * to this signal and bail out early.
   */
  signal?: AbortSignal;

  /** Arbitrary application fields forwarded from the request context. */
  [key: string]: unknown;
}

/* -------------------------------------------------------------------------- *
 * Request / result / record
 * -------------------------------------------------------------------------- */

/**
 * A single request to execute a tool.
 *
 * `tool` identifies which handler to run, `params` is the opaque payload
 * passed to it, and `context` carries application-scoped execution data that
 * is merged into the handler's {@link InvocationContext}.
 */
export interface InvocationRequest {
  /** Unique, stable tool name, e.g. `"http.get"`. */
  tool: string;

  /** Opaque parameters forwarded verbatim to the tool handler. */
  params: unknown;

  /** Optional application context merged into the handler context. */
  context?: unknown;

  /** Optional correlation id for tracing; a new one is minted when absent. */
  traceId?: string;
}

/**
 * The outcome of a single invocation.
 *
 * A result is produced for *every* invocation, whether it succeeded, failed
 * after retries, was served from cache or was served by a mock. `ok`
 * distinguishes success from failure; `value` and `error` are mutually
 * exclusive in practice.
 */
export interface InvocationResult {
  /** The tool that was invoked. */
  tool: string;

  /** `true` when the handler produced a value, `false` after exhaustion. */
  ok: boolean;

  /** The handler's return value. Present exactly when `ok` is `true`. */
  value?: unknown;

  /** Human-readable failure message. Present exactly when `ok` is `false`. */
  error?: string;

  /** Total wall-clock duration of the invocation, including retries, in ms. */
  durationMs: number;

  /**
   * The number of attempts made. `1` for a first-try success; for a failure
   * it equals the total attempts performed. `0` when the result came from
   * cache or a mock without running the handler.
   */
  attempt?: number;

  /** `true` when the result was served from a cache rather than executed. */
  cached?: boolean;

  /** `true` when the result was served by a registered mock. */
  mock?: boolean;

  /** Epoch ms when the invocation finished (or the cache/mock was hit). */
  timestamp: number;

  /** Correlation id propagated through the invocation. */
  traceId?: string;
}

/**
 * A persistent, historical record of one execution.
 *
 * Records are what {@link InvocationStore} retains in its history buffer.
 * They are derived from an {@link InvocationResult} plus the originating
 * parameters, and are enriched with an internal `id` for index linkage.
 */
export interface ExecutionRecord {
  /** Monotonic id assigned by the store; links history and index entries. */
  id?: number;

  /** The tool that was invoked. */
  tool: string;

  /** Epoch ms when the invocation started. */
  startedAt: number;

  /** Epoch ms when the invocation finished. */
  finishedAt: number;

  /** Total duration in ms (`finishedAt - startedAt`). */
  durationMs: number;

  /** Whether the invocation ultimately succeeded. */
  ok: boolean;

  /** Human-readable failure message, present when `ok` is `false`. */
  error?: string;

  /** The parameters the handler was invoked with (copied by reference). */
  params?: unknown;

  /** The value produced, present when `ok` is `true`. */
  result?: unknown;

  /** Number of attempts performed (see {@link InvocationResult.attempt}). */
  attempt?: number;

  /** Whether the record describes a cache-served result. */
  cached?: boolean;

  /** Whether the record describes a mock-served result. */
  mock?: boolean;

  /** Correlation id propagated through the invocation. */
  traceId?: string;
}

/* -------------------------------------------------------------------------- *
 * Retry policy
 * -------------------------------------------------------------------------- */

/**
 * Controls how many times a failing invocation is retried and how long the
 * executor waits between attempts.
 */
export interface RetryPolicy {
  /**
   * Number of *retries* after the first attempt. `0` means a single attempt
   * and no retry. Total attempts are `maxRetries + 1`.
   */
  maxRetries: number;

  /**
   * Base delay in ms before the first retry. Defaults to `100`. Subsequent
   * delays grow by {@link RetryPolicy.factor}.
   */
  backoffMs?: number;

  /**
   * Exponential backoff multiplier applied to each successive retry.
   * Defaults to `2`. A factor of `1` makes every delay equal to `backoffMs`.
   */
  factor?: number;
}

/* -------------------------------------------------------------------------- *
 * Configuration
 * -------------------------------------------------------------------------- */

/**
 * Resolved configuration for the invocation layer.
 *
 * Unlike {@link InvokeOptions} (which is per-call), this is the baseline
 * configuration applied by the executor and the high-level facade unless a
 * call overrides it.
 */
export interface InvocationConfig {
  /**
   * Per-attempt timeout in ms. An attempt that does not settle within this
   * window rejects with a {@link TimeoutError}. Defaults to `5000`.
   */
  timeoutMs: number;

  /** Baseline retry policy. Defaults to {@link DEFAULT_RETRY_POLICY}. */
  retryPolicy: RetryPolicy;

  /** Lifetime of internal cache entries, in ms. Defaults to `30_000`. */
  cacheTtlMs: number;

  /**
   * Whether the internal result cache is consulted by {@link ToolInvoker}
   * unless a call opts out. Defaults to `false`.
   */
  cacheEnabled: boolean;

  /**
   * Whether registered mocks are honoured by {@link ToolInvoker} unless a
   * call opts out. Defaults to `false`.
   */
  mockEnabled: boolean;
}

/**
 * Per-call knobs accepted by `execute` / `invoke`.
 *
 * Every field is optional; `undefined` means "use the baseline". Fields
 * override the corresponding baseline on a per-call basis.
 */
export interface InvokeOptions {
  /** Overrides the per-attempt timeout for this invocation only. */
  timeoutMs?: number;

  /** Overrides the retry policy for this invocation only. */
  retry?: Partial<RetryPolicy>;

  /** Opts this call into or out of the internal cache. */
  cache?: boolean;

  /** Opts this call into or out of mock-mode resolution. */
  mock?: boolean;

  /** Correlation id for this invocation; overrides `request.traceId`. */
  traceId?: string;

  /**
   * External abort signal. When aborted, in-flight attempts reject promptly
   * and are not retried.
   */
  signal?: AbortSignal;
}

/* -------------------------------------------------------------------------- *
 * Statistics
 * -------------------------------------------------------------------------- */

/**
 * Cumulative statistics for a single tool.
 *
 * These numbers are maintained by {@link InvocationStore} and are monotonic:
 * clearing history does *not* reset them (see `resetStats`).
 */
export interface ToolStats {
  /** Total executions of the tool (mock executions included). */
  totalExecutions: number;

  /** Executions that ended with `ok: true`. */
  successCount: number;

  /** Executions that ended with `ok: false`. */
  failureCount: number;

  /** Rolling average execution duration in ms. */
  averageDurationMs: number;

  /** Epoch ms of the most recent execution. */
  lastExecutedAt?: number;

  /** Number of cache hits served for this tool. */
  cacheHits: number;

  /** Number of cache misses recorded for this tool. */
  cacheMisses: number;

  /** Executions served by a registered mock. */
  mockExecutions: number;
}

/**
 * Aggregate statistics across every tool recorded by the store.
 */
export interface InvocationStats {
  /** Total executions across all tools. */
  totalExecutions: number;

  /** Total successful executions. */
  successCount: number;

  /** Total failed executions. */
  failureCount: number;

  /** Average execution duration across all executions, in ms. */
  averageDurationMs: number;

  /** Total cache hits across all tools. */
  cacheHits: number;

  /** Total cache misses across all tools. */
  cacheMisses: number;

  /** Total mock executions across all tools. */
  mockExecutions: number;

  /** Epoch ms of the most recent execution. */
  lastExecutedAt?: number;

  /** Distinct tools seen so far, in first-execution order. */
  tools: string[];

  /** Per-tool breakdown keyed by tool name. */
  toolStats: Record<string, ToolStats>;
}

/**
 * Per-tool counters maintained by {@link InvocationIndex}.
 */
export interface ToolCounts {
  /** Total indexed records for the tool. */
  total: number;

  /** Indexed records where `ok` is `true`. */
  okCount: number;

  /** Indexed records where `ok` is `false`. */
  errorCount: number;

  /** Indexed records served from cache. */
  cachedCount: number;

  /** Indexed records served by a mock. */
  mockCount: number;
}

/**
 * A point-in-time snapshot of the invocation index.
 */
export interface InvocationIndexStats {
  /** Total indexed records. */
  total: number;

  /** Records with `ok: true`. */
  okCount: number;

  /** Records with `ok: false`. */
  errorCount: number;

  /** Records served from cache. */
  cachedCount: number;

  /** Records served by a mock. */
  mockCount: number;

  /** Number of distinct tools present in the index. */
  distinctTools: number;

  /** Per-tool counters keyed by tool name. */
  byTool: Record<string, ToolCounts>;
}

/* -------------------------------------------------------------------------- *
 * Result cache
 * -------------------------------------------------------------------------- */

/**
 * Minimal cache contract accepted by {@link ToolInvoker.invokeWithCache}.
 *
 * Any Map-compatible object (or a wrapper with TTL/eviction semantics) can be
 * supplied; the invoker only needs synchronous `get`/`set`/`has`.
 */
export interface ResultCache {
  /**
   * Returns the cached result for `key`, or `undefined` when absent.
   */
  get(key: string): InvocationResult | undefined;

  /**
   * Stores `value` under `key`. Implementations may enforce TTL or capacity
   * limits as they see fit.
   */
  set(key: string, value: InvocationResult): void;

  /**
   * Returns `true` when a value is stored under `key`.
   */
  has(key: string): boolean;

  /** Removes the entry for `key`; returns `true` when one was removed. */
  delete?(key: string): boolean;

  /** Removes every entry from the cache. */
  clear?(): void;
}

/* -------------------------------------------------------------------------- *
 * Emitter & executor contract
 * -------------------------------------------------------------------------- */

/**
 * Structural type of the event emitter used by the invocation layer.
 *
 * Kept minimal so any `EventEmitter`-like object can be injected — useful for
 * tests that want to capture events without a real emitter.
 */
export type InvocationEmitter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

/**
 * The stable execution contract implemented by both the low-level
 * {@link ToolExecutor} class (`retrieval.ts`) and the read-only
 * {@link InvocationAdapter} (`integration.ts`).
 *
 * Consumers that only need to *run* tools can depend on this interface and
 * remain decoupled from which implementation backs them.
 */
export interface ToolExecutor {
  /**
   * Runs `handler` for `request` with timeout and retry, records the outcome
   * and returns an {@link InvocationResult}. Never throws.
   */
  execute(
    request: InvocationRequest,
    handler: ToolHandler,
    options?: InvokeOptions,
  ): Promise<InvocationResult>;

  /**
   * Runs `handler(params, context)` and rejects with a {@link TimeoutError}
   * when it does not settle within `timeoutMs`. Throws on failure.
   */
  executeWithTimeout(
    handler: ToolHandler,
    params: unknown,
    timeoutMs: number,
    context?: InvocationContext,
  ): Promise<unknown>;

  /**
   * Runs `fn`, re-invoking it on failure up to `retryPolicy.maxRetries`
   * times with exponential backoff. Resolves with the first success or
   * rethrows the last error after exhaustion.
   */
  retry<T>(fn: () => Promise<T>, retryPolicy?: Partial<RetryPolicy>): Promise<T>;

  /**
   * Removes every recorded and indexed entry for `tool`.
   * @returns the number of history records removed.
   */
  clearToolHistory(tool: string): number;

  /**
   * Removes every recorded and indexed entry across all tools.
   * @returns the number of history records removed.
   */
  clearHistory(): number;

  /** Returns cumulative statistics for a single tool. */
  statsFor(tool: string): ToolStats;

  /** Returns aggregate statistics across all tools. */
  stats(): InvocationStats;

  /** Returns the history records for a single tool, newest last. */
  historyFor(tool: string): ExecutionRecord[];

  /** Returns every history record, oldest first. */
  history(): readonly ExecutionRecord[];
}

/* -------------------------------------------------------------------------- *
 * Errors
 * -------------------------------------------------------------------------- */

/**
 * Error thrown by invocation machinery (as opposed to errors thrown by the
 * tool handler itself). Carries the tool name and attempt number so that
 * failure paths can be attributed precisely.
 */
export class InvocationError extends Error {
  /** The tool being invoked when the error occurred. */
  readonly tool: string;

  /** The attempt number at which the error occurred. */
  readonly attempt: number;

  /** The underlying cause, when one exists. */
  readonly cause?: unknown;

  /**
   * Creates an invocation error.
   *
   * @param message human-readable description.
   * @param tool the tool name involved.
   * @param attempt the attempt number, 1-based.
   * @param cause the underlying error, if any.
   */
  constructor(message: string, tool: string, attempt = 0, cause?: unknown) {
    super(message);
    this.name = 'InvocationError';
    this.tool = tool;
    this.attempt = attempt;
    this.cause = cause;
  }
}

/**
 * Error raised when an attempt does not settle within its allotted timeout.
 *
 * Instances are produced by `executeWithTimeout` and are NOT retried when the
 * abort signal is involved — a timeout is a hard per-attempt failure.
 */
export class TimeoutError extends Error {
  /** The tool being invoked when the timeout fired. */
  readonly tool: string;

  /** The timeout that was exceeded, in ms. */
  readonly timeoutMs: number;

  /**
   * Creates a timeout error.
   *
   * @param tool the tool name, or `''` when unknown.
   * @param timeoutMs the per-attempt timeout that was exceeded.
   */
  constructor(tool: string, timeoutMs: number) {
    super(
      `Invocation timed out after ${timeoutMs}ms` +
        (tool.length === 0 ? '' : ` for tool "${tool}"`),
    );
    this.name = 'TimeoutError';
    this.tool = tool;
    this.timeoutMs = timeoutMs;
  }
}

/* -------------------------------------------------------------------------- *
 * Guards & predicates
 * -------------------------------------------------------------------------- */

/**
 * Returns `true` when `value` is a non-null object.
 *
 * @param value the value to test.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns `true` when `value` is an `Error` (or a subclass, duck-typed so
 * cross-realm errors also match).
 */
export function isErrorObject(value: unknown): value is Error {
  if (value instanceof Error) {
    return true;
  }
  return (
    isRecord(value) &&
    typeof value.message === 'string' &&
    (typeof value.name === 'string' || value.name === undefined)
  );
}

/**
 * Returns `true` when `value` is an abort-style error. Used by the executor
 * to decide that a failed attempt must NOT be retried (the caller asked to
 * cancel).
 */
export function isAbortError(value: unknown): boolean {
  if (!isErrorObject(value)) {
    return false;
  }
  return (
    value.name === 'AbortError' || /abort(ed|ing)?/i.test(value.message)
  );
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link RetryPolicy}.
 */
export function isRetryPolicy(value: unknown): value is RetryPolicy {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.maxRetries !== 'number' || value.maxRetries < 0) {
    return false;
  }
  if (value.backoffMs !== undefined && typeof value.backoffMs !== 'number') {
    return false;
  }
  if (value.factor !== undefined && typeof value.factor !== 'number') {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` satisfies the shape of an
 * {@link InvocationConfig} — note that only `timeoutMs` is strictly checked;
 * the rest are optional in the config-input position.
 */
export function isInvocationConfig(value: unknown): value is InvocationConfig {
  if (!isRecord(value)) {
    return false;
  }
  if (value.timeoutMs !== undefined && typeof value.timeoutMs !== 'number') {
    return false;
  }
  if (
    value.retryPolicy !== undefined &&
    !isRetryPolicy(value.retryPolicy)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` satisfies the shape of an
 * {@link InvocationRequest}.
 */
export function isInvocationRequest(value: unknown): value is InvocationRequest {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.tool === 'string' && value.tool.length > 0;
}

/**
 * Returns `true` when `value` satisfies the shape of an
 * {@link InvocationResult}.
 */
export function isInvocationResult(value: unknown): value is InvocationResult {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tool === 'string' &&
    typeof value.ok === 'boolean' &&
    typeof value.durationMs === 'number' &&
    typeof value.timestamp === 'number'
  );
}

/**
 * Returns `true` when `value` satisfies the shape of an {@link ExecutionRecord}.
 */
export function isExecutionRecord(value: unknown): value is ExecutionRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tool === 'string' &&
    typeof value.ok === 'boolean' &&
    typeof value.startedAt === 'number' &&
    typeof value.finishedAt === 'number' &&
    typeof value.durationMs === 'number'
  );
}

/* -------------------------------------------------------------------------- *
 * Normalisation helpers
 * -------------------------------------------------------------------------- */

/**
 * Fills in defaults for a {@link RetryPolicy}, returning a new fully-populated
 * policy. Missing fields take the {@link DEFAULT_RETRY_POLICY} values.
 */
export function normalizeRetryPolicy(policy: Partial<RetryPolicy>): RetryPolicy {
  const base = DEFAULT_RETRY_POLICY;
  return {
    maxRetries:
      typeof policy.maxRetries === 'number' && policy.maxRetries >= 0
        ? Math.floor(policy.maxRetries)
        : base.maxRetries,
    backoffMs:
      typeof policy.backoffMs === 'number' && policy.backoffMs >= 0
        ? policy.backoffMs
        : base.backoffMs,
    factor:
      typeof policy.factor === 'number' && policy.factor > 0
        ? policy.factor
        : base.factor,
  };
}

/**
 * Fills in defaults for an {@link InvocationConfig}, returning a new
 * fully-populated config.
 */
export function normalizeInvocationConfig(
  config: Partial<InvocationConfig>,
): InvocationConfig {
  const base = DEFAULT_INVOCATION_CONFIG;
  return {
    timeoutMs:
      typeof config.timeoutMs === 'number' && config.timeoutMs > 0
        ? config.timeoutMs
        : base.timeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy),
    cacheTtlMs:
      typeof config.cacheTtlMs === 'number' && config.cacheTtlMs > 0
        ? config.cacheTtlMs
        : base.cacheTtlMs,
    cacheEnabled: config.cacheEnabled ?? base.cacheEnabled,
    mockEnabled: config.mockEnabled ?? base.mockEnabled,
  };
}

/* -------------------------------------------------------------------------- *
 * Defaults & resolvers
 * -------------------------------------------------------------------------- */

/**
 * Default retry policy: one retry, 100ms base delay, doubling each time.
 */
export const DEFAULT_RETRY_POLICY: Readonly<RetryPolicy> = Object.freeze({
  maxRetries: 1,
  backoffMs: 100,
  factor: 2,
} as RetryPolicy);

/**
 * Default invocation configuration applied by every component unless the
 * caller overrides individual fields.
 */
export const DEFAULT_INVOCATION_CONFIG: Readonly<InvocationConfig> =
  Object.freeze({
    timeoutMs: 5_000,
    retryPolicy: DEFAULT_RETRY_POLICY,
    cacheTtlMs: 30_000,
    cacheEnabled: false,
    mockEnabled: false,
  } as InvocationConfig);

/**
 * Upper bound for computed backoff delays, protecting retry loops from
 * unbounded sleep times even with very large factors.
 */
export const MAX_BACKOFF_MS = 30_000;

/**
 * Resolves a possibly-partial {@link RetryPolicy} against the default,
 * returning a complete policy.
 */
export function resolveRetryPolicy(
  policy?: Partial<RetryPolicy>,
): RetryPolicy {
  return normalizeRetryPolicy(policy ?? {});
}

/**
 * Resolves a possibly-partial {@link InvocationConfig} against the default,
 * returning a complete config.
 */
export function resolveInvocationConfig(
  overrides?: Partial<InvocationConfig>,
): InvocationConfig {
  return normalizeInvocationConfig(overrides ?? {});
}

/**
 * Resolves per-call {@link InvokeOptions} into concrete values that execution
 * can act on: an absolute timeout, a complete retry policy, cache/mock
 * opt-in/out flags (or `undefined` for "inherit baseline") and a trace id.
 */
export function resolveInvokeOptions(options?: InvokeOptions): {
  timeoutMs: number;
  retry: RetryPolicy;
  cache: boolean | undefined;
  mock: boolean | undefined;
  traceId: string;
  signal?: AbortSignal;
} {
  const merged = options ?? {};
  const retry = resolveRetryPolicy(merged.retry);
  const timeoutMs =
    typeof merged.timeoutMs === 'number' && merged.timeoutMs > 0
      ? merged.timeoutMs
      : DEFAULT_INVOCATION_CONFIG.timeoutMs;
  return {
    timeoutMs,
    retry,
    cache: merged.cache,
    mock: merged.mock,
    traceId: merged.traceId ?? newTraceId(),
    signal: merged.signal,
  };
}

/* -------------------------------------------------------------------------- *
 * Factories
 * -------------------------------------------------------------------------- */

/**
 * Creates a zeroed {@link ToolStats} object — safe to use as the starting
 * point for a tool that has never been executed.
 */
export function createEmptyToolStats(): ToolStats {
  return {
    totalExecutions: 0,
    successCount: 0,
    failureCount: 0,
    averageDurationMs: 0,
    lastExecutedAt: undefined,
    cacheHits: 0,
    cacheMisses: 0,
    mockExecutions: 0,
  };
}

/**
 * Creates a fully-formed {@link ToolStats} from a partial, merging over an
 * empty baseline so no field is ever `undefined`.
 */
export function createToolStats(partial?: Partial<ToolStats>): ToolStats {
  return { ...createEmptyToolStats(), ...(partial ?? {}) };
}

/**
 * Creates an {@link InvocationResult} from its parts, normalising optional
 * fields (`attempt`, `cached`, `mock`, `timestamp`, `traceId`) so the result
 * is always well-formed.
 */
export function createInvocationResult(parts: {
  tool: string;
  ok: boolean;
  value?: unknown;
  error?: string;
  durationMs?: number;
  attempt?: number;
  cached?: boolean;
  mock?: boolean;
  timestamp?: number;
  traceId?: string;
}): InvocationResult {
  return {
    tool: parts.tool,
    ok: parts.ok,
    value: parts.ok ? parts.value : undefined,
    error: parts.ok ? undefined : (parts.error ?? 'Invocation failed'),
    durationMs: parts.durationMs ?? 0,
    attempt: parts.attempt ?? (parts.ok ? 1 : 0),
    cached: parts.cached ?? false,
    mock: parts.mock ?? false,
    timestamp: parts.timestamp ?? Date.now(),
    traceId: parts.traceId,
  };
}

/**
 * Derives an {@link ExecutionRecord} from an {@link InvocationResult}.
 *
 * `startedAt` is reconstructed as `timestamp - durationMs` and the record
 * carries the result value/error so history can be audited without the
 * original params.
 */
export function createExecutionRecord(
  result: InvocationResult,
  params?: unknown,
): ExecutionRecord {
  const timestamp = result.timestamp;
  return {
    tool: result.tool,
    startedAt: timestamp - result.durationMs,
    finishedAt: timestamp,
    durationMs: result.durationMs,
    ok: result.ok,
    error: result.error,
    params,
    result: result.value,
    attempt: result.attempt,
    cached: result.cached,
    mock: result.mock,
    traceId: result.traceId,
  };
}

/* -------------------------------------------------------------------------- *
 * Shared helpers
 * -------------------------------------------------------------------------- */

/**
 * Produces a stable, human-readable message for an unknown thrown value.
 * Errors use `error.message`; everything else is stringified defensively.
 */
export function errorMessage(
  error: unknown,
  fallback = 'Unknown invocation error',
): string {
  if (isErrorObject(error)) {
    return error.message || fallback;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error) ?? fallback;
  } catch {
    return String(error);
  }
}

/**
 * Mints a fresh trace id. Not cryptographically unique, but unique enough for
 * correlation purposes across a single process.
 */
export function newTraceId(): string {
  return (
    `trc_${Date.now().toString(36)}_` +
    `${Math.random().toString(36).slice(2, 10)}` +
    `${Math.random().toString(36).slice(2, 8)}`
  );
}

/**
 * Serialises an arbitrary value into a stable, order-independent string.
 *
 * Object keys are sorted recursively so that `{a:1, b:2}` and `{b:2, a:1}`
 * hash identically — exactly what a parameter-based cache key needs. Cyclic
 * structures throw a `TypeError`; functions, symbols and bigints are rendered
 * as their `String()` form.
 *
 * @param value the value to serialise.
 * @throws {TypeError} when the value contains a circular reference.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  const visit = (node: unknown): unknown => {
    if (node === null || typeof node !== 'object') {
      if (typeof node === 'function' || typeof node === 'symbol') {
        return `[${String(node)}]`;
      }
      if (typeof node === 'bigint') {
        return `${node.toString()}n`;
      }
      if (typeof node === 'number' && !Number.isFinite(node)) {
        return 'null';
      }
      return node;
    }
    if (seen.has(node)) {
      throw new TypeError('stableStringify: circular reference detected');
    }
    seen.add(node);
    let serialized: unknown;
    if (Array.isArray(node)) {
      serialized = node.map(visit);
    } else {
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        const field = (node as Record<string, unknown>)[key];
        if (field === undefined) {
          continue;
        }
        output[key] = visit(field);
      }
      serialized = output;
    }
    seen.delete(node);
    return serialized;
  };
  return JSON.stringify(visit(value) ?? null) ?? 'null';
}

/**
 * Builds a deterministic cache key from a tool name and its parameters.
 * Equal parameter objects (up to key order) always produce equal keys.
 */
export function cacheKeyFor(tool: string, params: unknown): string {
  return `invoke:${tool}:${stableStringify(params ?? null)}`;
}

/**
 * Computes the delay to wait before retrying attempt `attempt`.
 *
 * The first retry (attempt `1`) waits `backoffMs`; each subsequent retry
 * multiplies by `factor`, capped at {@link MAX_BACKOFF_MS}.
 */
export function computeBackoffMs(
  attempt: number,
  retryPolicy: RetryPolicy,
): number {
  const base = Math.max(0, retryPolicy.backoffMs ?? 100);
  const factor = retryPolicy.factor ?? 2;
  if (attempt <= 1 || factor <= 1) {
    return Math.min(base, MAX_BACKOFF_MS);
  }
  return Math.min(base * Math.pow(factor, attempt - 1), MAX_BACKOFF_MS);
}