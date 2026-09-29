/**
 * retrieval.ts
 *
 * The `ToolExecutor` — the execution engine of the Invocation layer.
 *
 * This module turns a {@link ToolHandler} plus an {@link InvocationRequest}
 * into a settled {@link InvocationResult}. It is responsible for the parts of
 * invocation that are cross-cutting and safety-critical:
 *
 *   1. **Timeout** — every attempt races the handler against a wall-clock
 *      deadline via `Promise.race`. On timeout the attempt rejects with a
 *      {@link TimeoutError} and the attempt's `AbortSignal` is aborted so
 *      cooperative handlers can cancel early.
 *   2. **Retry** — failed attempts are re-invoked up to
 *      `retryPolicy.maxRetries` times with exponential backoff
 *      (`backoffMs * factor^attempt`). Abort-style errors (the caller asked
 *      to cancel) are never retried.
 *   3. **Recording** — every settled invocation is pushed through the
 *      {@link InvocationStore} (history + stats) and the
 *      {@link InvocationIndex}, and `invoked` / `retried` / `succeeded` /
 *      `failed` events are emitted on the injected emitter (see
 *      {@link INVOCATION_EVENTS} in `lifecycle.ts`).
 *
 * The public contract matches the {@link ToolExecutor} interface from
 * `types.ts`, so the class is swappable behind the interface and the
 * read-only {@link InvocationAdapter} in `integration.ts`.
 *
 * `execute` never throws: every failure mode — handler throw, timeout,
 * retry exhaustion — is folded into the returned result. The lower-level
 * `executeWithTimeout` and `retry` helpers DO throw, for callers that want
 * exceptions instead of result objects.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events` is used transitively through the emitter).
 */

import {
  type ExecutionRecord,
  type InvocationContext,
  type InvocationEmitter,
  type InvocationRequest,
  type InvocationResult,
  type InvocationStats,
  type InvokeOptions,
  type RetryPolicy,
  type ToolExecutor as ToolExecutorContract,
  type ToolHandler,
  type ToolStats,
  InvocationError,
  TimeoutError,
  computeBackoffMs,
  createInvocationResult,
  errorMessage,
  isAbortError,
  isRecord,
  newTraceId,
  resolveInvokeOptions,
  resolveRetryPolicy,
} from './types.js';
import { InvocationStore } from './store.js';
import { InvocationIndex } from './index.js';
import { INVOCATION_EVENTS } from './lifecycle.js';

/**
 * Options accepted by the {@link ToolExecutor} constructor. The executor
 * creates its own store and index when none are supplied, and uses the
 * injected emitter (if any) to publish invocation events.
 */
export interface ToolExecutorOptions {
  /** Store to record history/stats into. A fresh one is created when absent. */
  store?: InvocationStore;

  /** Index to query indexed results with. A fresh one is created when absent. */
  index?: InvocationIndex;

  /** Event emitter for `invoked` / `retried` / `succeeded` / `failed`. */
  emitter?: InvocationEmitter;

  /** Baseline per-attempt timeout in ms; defaults to `5000`. */
  defaultTimeoutMs?: number;

  /** Baseline retry policy; defaults to {@link DEFAULT_RETRY_POLICY}. */
  defaultRetryPolicy?: Partial<RetryPolicy>;
}

/**
 * Sleeps for `ms` milliseconds. Used for backoff between retries.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Executes tool handlers with timeout, retry and full recording.
 *
 * @example
 * const executor = new ToolExecutor();
 * const result = await executor.execute(
 *   { tool: 'math.add', params: { a: 1, b: 2 } },
 *   async ({ a, b }) => a + b,
 *   { timeoutMs: 1000, retry: { maxRetries: 2 } },
 * );
 * if (result.ok) console.log(result.value); // 3
 */
export class ToolExecutor implements ToolExecutorContract {
  /** The store this executor records into. */
  readonly store: InvocationStore;

  /** The index this executor updates. */
  readonly index: InvocationIndex;

  /** The event emitter invocation events are published to (may be absent). */
  readonly emitter?: InvocationEmitter;

  /** Baseline per-attempt timeout in ms. */
  private defaultTimeoutMs: number;

  /** Baseline retry policy. */
  private defaultRetryPolicy: RetryPolicy;

  /**
   * Creates an executor.
   *
   * @param options optional store/index/emitter and execution defaults.
   */
  constructor(options: ToolExecutorOptions = {}) {
    this.store = options.store ?? new InvocationStore();
    this.index = options.index ?? new InvocationIndex();
    this.emitter = options.emitter;
    this.defaultTimeoutMs =
      typeof options.defaultTimeoutMs === 'number' &&
      options.defaultTimeoutMs > 0
        ? options.defaultTimeoutMs
        : 5_000;
    this.defaultRetryPolicy = resolveRetryPolicy(options.defaultRetryPolicy);
  }

  /* ------------------------------------------------------------------ *
   * Baseline configuration
   * ------------------------------------------------------------------ */

  /**
   * Returns the baseline per-attempt timeout in ms.
   */
  getTimeoutMs(): number {
    return this.defaultTimeoutMs;
  }

  /**
   * Sets the baseline per-attempt timeout in ms.
   *
   * @param ms a positive timeout.
   * @returns `this` for chaining.
   * @throws {TypeError} when `ms` is not a positive finite number.
   */
  setTimeoutMs(ms: number): this {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new TypeError(
        'ToolExecutor.setTimeoutMs: timeout must be a positive number.',
      );
    }
    this.defaultTimeoutMs = ms;
    return this;
  }

  /**
   * Alias of {@link ToolExecutor.setTimeoutMs} matching the runtime tool
   * engine vocabulary.
   *
   * @param ms a positive timeout.
   * @returns `this` for chaining.
   */
  setTimeout(ms: number): this {
    return this.setTimeoutMs(ms);
  }

  /**
   * Returns the baseline retry policy.
   */
  getRetryPolicy(): RetryPolicy {
    return { ...this.defaultRetryPolicy };
  }

  /**
   * Sets the baseline retry policy.
   *
   * @param policy a partial policy; missing fields keep current values.
   * @returns `this` for chaining.
   */
  setRetryPolicy(policy: Partial<RetryPolicy>): this {
    this.defaultRetryPolicy = resolveRetryPolicy({
      ...this.defaultRetryPolicy,
      ...policy,
    });
    return this;
  }

  /**
   * Alias of {@link ToolExecutor.setRetryPolicy} matching the runtime tool
   * engine vocabulary.
   *
   * @param policy a partial retry policy.
   * @returns `this` for chaining.
   */
  setRetry(policy: Partial<RetryPolicy>): this {
    return this.setRetryPolicy(policy);
  }

  /* ------------------------------------------------------------------ *
   * Execution
   * ------------------------------------------------------------------ */

  /**
   * Executes `handler` for `request`, applying timeout and retry, then
   * records the outcome and returns an {@link InvocationResult}.
   *
   * This method NEVER throws. Handler failures, timeouts and retry
   * exhaustion all surface as `ok: false` results whose `error` field
   * carries a human-readable message and whose `attempt` field records how
   * many attempts were made. Duration covers the whole attempt sequence,
   * including backoff sleeps.
   *
   * Events are emitted per attempt (`invoked`), between attempts (`retried`)
   * and once at the end (`succeeded` or `failed`).
   *
   * @param request what to invoke.
   * @param handler the tool implementation.
   * @param options per-call overrides (timeout, retry, traceId, signal).
   * @returns a settled result. Never rejects.
   */
  async execute(
    request: InvocationRequest,
    handler: ToolHandler,
    options: InvokeOptions = {},
  ): Promise<InvocationResult> {
    if (typeof request?.tool !== 'string' || request.tool.length === 0) {
      throw new TypeError(
        'ToolExecutor.execute: request must reference a tool with a non-empty name.',
      );
    }
    if (typeof handler !== 'function') {
      throw new TypeError(
        'ToolExecutor.execute: handler must be a function.',
      );
    }

    const resolved = resolveInvokeOptions(options);
    const traceId = request.traceId ?? resolved.traceId;
    const startedAt = Date.now();
    const baseContext = isRecord(request.context) ? request.context : {};
    const callerSignal =
      resolved.signal ?? (baseContext as { signal?: AbortSignal }).signal;

    let attempt = 0;
    let lastError: unknown;
    let value: unknown;
    let ok = false;

    for (;;) {
      attempt += 1;
      const context: InvocationContext = {
        ...baseContext,
        traceId,
        tool: request.tool,
        attempt,
        signal: callerSignal,
      };

      this.emit(INVOCATION_EVENTS.invoked, {
        type: 'invoked',
        tool: request.tool,
        traceId,
        attempt,
        startedAt: Date.now(),
      });

      try {
        value = await this.executeWithTimeout(
          handler,
          request.params,
          resolved.timeoutMs,
          context,
        );
        ok = true;
        break;
      } catch (error) {
        lastError = error;
        if (isAbortError(error)) {
          break; // caller asked to cancel — never retry
        }
        if (attempt > resolved.retry.maxRetries) {
          break;
        }
        const delayMs = computeBackoffMs(attempt, resolved.retry);
        this.emit(INVOCATION_EVENTS.retried, {
          type: 'retried',
          tool: request.tool,
          attempt,
          error: errorMessage(error),
          nextAttempt: attempt + 1,
          delayMs,
        });
        await sleep(delayMs);
      }
    }

    const result = createInvocationResult({
      tool: request.tool,
      ok,
      value: ok ? value : undefined,
      error: ok ? undefined : errorMessage(lastError, 'Invocation failed'),
      durationMs: Date.now() - startedAt,
      attempt,
      cached: false,
      mock: false,
      timestamp: Date.now(),
      traceId,
    });

    const record = this.store.record(result);
    if (record.id !== undefined) {
      this.index.indexRecord(result, record.id);
    } else {
      this.index.indexRecord(result);
    }
    this.emit(
      ok ? INVOCATION_EVENTS.succeeded : INVOCATION_EVENTS.failed,
      { type: ok ? 'succeeded' : 'failed', result },
    );
    return result;
  }

  /**
   * Runs `handler(params, context)` and rejects with a {@link TimeoutError}
   * when it does not settle within `timeoutMs`.
   *
   * The handler's context receives an `AbortSignal` that is aborted when the
   * timeout fires or when a caller-supplied signal aborts. Synchronous
   * throws from the handler are converted into rejections.
   *
   * This is the primitive underneath `execute`; unlike `execute` it THROWS on
   * failure.
   *
   * @param handler the tool implementation.
   * @param params the parameters forwarded to the handler.
   * @param timeoutMs the per-attempt deadline, in ms.
   * @param context optional execution context (merged before the handler
   *   runs; `signal` is overridden by the attempt's signal).
   * @returns the handler's value.
   * @throws {TypeError} for invalid arguments.
   * @throws {TimeoutError} when the attempt exceeds `timeoutMs`.
   * @throws {AbortError} when a caller-supplied signal aborts first.
   */
  async executeWithTimeout(
    handler: ToolHandler,
    params: unknown,
    timeoutMs: number,
    context: InvocationContext = {},
  ): Promise<unknown> {
    if (typeof handler !== 'function') {
      throw new TypeError(
        'ToolExecutor.executeWithTimeout: handler must be a function.',
      );
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new TypeError(
        'ToolExecutor.executeWithTimeout: timeoutMs must be a positive number.',
      );
    }

    const controller = new AbortController();
    const callerSignal =
      context.signal ?? (context as { signal?: AbortSignal }).signal;
    const onCallerAbort = (): void => {
      controller.abort();
    };
    if (callerSignal !== undefined) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TimeoutError(context.tool ?? '', timeoutMs));
      }, timeoutMs);
    });

    const attemptContext: InvocationContext = {
      ...context,
      signal: controller.signal,
    };

    try {
      const work = Promise.resolve().then(() => handler(params, attemptContext));
      return await Promise.race([work, timeoutPromise]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (callerSignal !== undefined) {
        callerSignal.removeEventListener('abort', onCallerAbort);
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Retry
   * ------------------------------------------------------------------ */

  /**
   * Runs `fn`, re-invoking it on failure up to `retryPolicy.maxRetries` times
   * with exponential backoff.
   *
   * Unlike {@link ToolExecutor.execute}, this helper THROWS: it resolves with
   * the first successful value or rethrows the last error once retries are
   * exhausted. Abort-style errors are never retried.
   *
   * @param fn the operation to run (a fresh invocation each call).
   * @param retryPolicy the retry policy; defaults to the executor baseline.
   * @returns the first successful value.
   * @throws {TypeError} when `fn` is not a function.
   * @throws the last failure when retries are exhausted.
   */
  async retry<T>(
    fn: () => Promise<T>,
    retryPolicy?: Partial<RetryPolicy>,
  ): Promise<T> {
    if (typeof fn !== 'function') {
      throw new TypeError('ToolExecutor.retry: fn must be a function.');
    }
    const policy = resolveRetryPolicy({
      ...this.defaultRetryPolicy,
      ...(retryPolicy ?? {}),
    });

    let lastError: unknown;
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (isAbortError(error) || attempt > policy.maxRetries) {
          break;
        }
        await sleep(computeBackoffMs(attempt, policy));
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }
    throw new InvocationError(
      errorMessage(lastError, 'Unknown retry failure'),
      '<retry>',
      attempt,
      lastError,
    );
  }

  /* ------------------------------------------------------------------ *
   * History & statistics
   * ------------------------------------------------------------------ */

  /**
   * Returns every recorded history record, oldest first.
   */
  history(): readonly ExecutionRecord[] {
    return this.store.getHistory();
  }

  /**
   * Returns the history records for a single tool.
   *
   * @param tool the tool name to filter by.
   */
  historyFor(tool: string): ExecutionRecord[] {
    return this.store.historyFor(tool);
  }

  /**
   * Removes every recorded and indexed entry for a tool.
   *
   * Note: cumulative statistics are NOT reset by this call — use
   * {@link ToolExecutor.resetStatsFor} for that.
   *
   * @param tool the tool name to purge.
   * @returns the number of history records removed.
   */
  clearToolHistory(tool: string): number {
    const removed = this.store.removeHistoryFor(tool);
    this.index.removeTool(tool);
    return removed;
  }

  /**
   * Removes every recorded and indexed entry across all tools.
   *
   * @returns the number of history records removed.
   */
  clearHistory(): number {
    const removed = this.store.clearHistory();
    this.index.clear();
    return removed;
  }

  /**
   * Resets the cumulative statistics of a single tool.
   *
   * @param tool the tool name to reset.
   * @returns `true` when the tool had statistics that were reset.
   */
  resetStatsFor(tool: string): boolean {
    return this.store.resetStatsFor(tool);
  }

  /**
   * Returns cumulative statistics for a single tool.
   *
   * @param tool the tool name to inspect.
   */
  statsFor(tool: string): ToolStats {
    return this.store.statsFor(tool);
  }

  /**
   * Returns aggregate statistics across every recorded tool.
   */
  stats(): InvocationStats {
    return this.store.getStats();
  }

  /**
   * Resets every statistic while leaving history intact.
   *
   * @returns the number of tools whose stats were reset.
   */
  resetStats(): number {
    return this.store.resetStats();
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to invocation events (`invoked`, `retried`, `succeeded`,
   * `failed`). See {@link INVOCATION_EVENTS} in `lifecycle.ts`.
   *
   * @param event the event name.
   * @param listener the callback receiving the event payload.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: unknown) => void,
  ): this {
    this.emitter?.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener previously added via {@link ToolExecutor.on}.
   *
   * @param event the event name.
   * @param listener the callback to remove.
   * @returns `this` for chaining.
   */
  off(
    event: string,
    listener: (payload: unknown) => void,
  ): this {
    this.emitter?.off(event, listener);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Publishes an event payload to the injected emitter, if any. Payloads are
   * plain objects so they survive `EventEmitter` without coercion.
   */
  private emit(event: string, payload: unknown): void {
    this.emitter?.emit(event, payload);
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param options executor options.
 * @returns a new {@link ToolExecutor}.
 */
export default function createExecutor(
  options: ToolExecutorOptions = {},
): ToolExecutor {
  return new ToolExecutor(options);
}