/**
 * integration.ts
 *
 * The high-level facade of the Invocation layer: `ToolInvoker`.
 *
 * The individual components — store, index, executor and lifecycle — are
 * designed to be usable in isolation and composable in any arrangement. For
 * the common case, though, you want a single object that wires them together
 * with sensible defaults and exposes the operations end users actually need:
 *
 *   invoke / invokeWithCache          — execution with timeout, retry,
 *                                       internal cache and mock resolution
 *   mock / unmock / mockTool          — deterministic stand-in results
 *   setTimeout / setRetryPolicy       — baseline tuning
 *   enableCache / disableCache        — internal result cache toggles
 *   getExecutionHistory / getStats    — observability
 *   start / stop                      — periodic history GC
 *
 * `ToolInvoker` is that object. It owns an {@link InvocationStore}, an
 * {@link InvocationIndex}, a {@link ToolExecutor} and an
 * {@link InvocationLifecycle}, and delegates to them. It also exposes an
 * `adapter` property: an {@link InvocationAdapter} implementing the stable
 * {@link ToolExecutor} interface from `types.ts`, so that consumer code
 * written against a generic executor can talk to the invoker without
 * coupling to implementation details.
 *
 * Feature map against the reference runtime tool engine:
 *
 *   - `invoke`              → `execute` with timeout + retry + recording
 *   - `setTimeout(ms)`      → per-attempt timeout baseline
 *   - `setRetry(policy)`    → retry policy baseline
 *   - `enableCache/disableCache` → internal result cache
 *   - `mockTool(tool, result)`    → mock-mode stand-ins
 *   - `getExecutionHistory` → history records
 *   - `getStats`            → aggregate + per-tool statistics
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events` is used transitively through the lifecycle).
 */

import {
  type ExecutionRecord,
  type InvocationConfig,
  type InvocationContext,
  type InvocationEmitter,
  type InvocationRequest,
  type InvocationResult,
  type InvocationStats,
  type InvokeOptions,
  type RetryPolicy,
  type ResultCache,
  type ToolExecutor,
  type ToolHandler,
  type ToolStats,
  cacheKeyFor,
  createInvocationResult,
  resolveInvocationConfig,
} from './types.js';
import { InvocationStore } from './store.js';
import { InvocationIndex } from './index.js';
import { ToolExecutor as Executor } from './retrieval.js';
import { INVOCATION_EVENTS, type InvocationEventPayload, InvocationLifecycle } from './lifecycle.js';

/**
 * Options accepted by the {@link ToolInvoker} constructor. Every field is
 * optional; sensible defaults are applied for the rest.
 */
export interface ToolInvokerOptions {
  /** Baseline configuration (timeout, retry, cache TTL, toggles). */
  config?: Partial<InvocationConfig>;

  /** Store to record into. A fresh one is created when absent. */
  store?: InvocationStore;

  /** Index to query indexed results with. A fresh one is created when absent. */
  index?: InvocationIndex;

  /** Event emitter shared by the executor and lifecycle. */
  emitter?: InvocationEmitter;

  /** Pre-built executor to delegate execution to. */
  executor?: ToolExecutor;

  /** Maximum history records retained by the periodic GC. Defaults to `1000`. */
  maxRecords?: number;

  /** Interval of the periodic GC pass, in ms. Defaults to `60_000`. */
  gcIntervalMs?: number;

  /** Whether periodic GC runs. Defaults to `true`. */
  autoGc?: boolean;
}

/**
 * A single internal cache entry: the cached result plus its expiry.
 */
interface CacheEntry {
  /** The cached result. */
  value: InvocationResult;

  /** Epoch ms after which the entry is considered stale. */
  expiresAt: number;
}

/**
 * The high-level Invocation facade.
 *
 * Wires a store, an index, an executor and a lifecycle into a single
 * coherent object. Construct with {@link ToolInvoker.constructor} or the
 * {@link createToolInvoker} factory.
 *
 * @example
 * const invoker = createToolInvoker({ config: { timeoutMs: 1000 } });
 *
 * const result = await invoker.invoke(
 *   { tool: 'math.add', params: { a: 1, b: 2 } },
 *   async ({ a, b }) => a + b,
 * );
 * if (result.ok) console.log(result.value); // 3
 *
 * invoker.setTimeout(500);
 * invoker.setRetry({ maxRetries: 3, backoffMs: 50 });
 * invoker.enableCache();
 * invoker.mockTool('flaky', 'stubbed');
 * const history = invoker.getExecutionHistory();
 * const stats = invoker.getStats();
 */
export class ToolInvoker {
  /** The underlying store. Exposed for advanced consumers. */
  readonly store: InvocationStore;

  /** The underlying index. Exposed for advanced consumers. */
  readonly index: InvocationIndex;

  /** The execution engine. Exposed for advanced consumers. */
  readonly executor: ToolExecutor;

  /** The lifecycle manager bounding history and owning the event emitter. */
  readonly lifecycle: InvocationLifecycle;

  /** Resolved baseline configuration. */
  readonly config: InvocationConfig;

  /**
   * A read-only adapter implementing the {@link ToolExecutor} interface,
   * safe to hand to consumers that only need to run tools.
   */
  readonly adapter: ToolExecutor;

  /** Registered mock results keyed by tool name. */
  private readonly mockRegistry = new Map<string, unknown>();

  /** Internal result cache (used when `cacheEnabled` is true). */
  private readonly internalCache = new Map<string, CacheEntry>();

  /** Whether the internal cache is currently consulted. */
  private cacheEnabled: boolean;

  /** Whether mocks are currently honoured. */
  private mockEnabled: boolean;

  /** Current per-attempt timeout baseline, in ms. */
  private timeoutMs: number;

  /** Current retry policy baseline. */
  private retryPolicy: RetryPolicy;

  /** Current internal cache TTL, in ms. */
  private cacheTtlMs: number;

  /**
   * Creates an invocation facade.
   *
   * @param options optional config, components and tuning; see
   *   {@link ToolInvokerOptions}.
   */
  constructor(options: ToolInvokerOptions = {}) {
    this.config = resolveInvocationConfig(options.config);
    this.store = options.store ?? new InvocationStore();
    this.index = options.index ?? new InvocationIndex();
    this.lifecycle = new InvocationLifecycle(this.store, this.index, {
      emitter: options.emitter,
      maxRecords: options.maxRecords,
      gcIntervalMs: options.gcIntervalMs,
      autoGc: options.autoGc,
    });
    this.executor =
      options.executor ??
      new Executor({
        store: this.store,
        index: this.index,
        emitter: this.lifecycle.emitter,
        defaultTimeoutMs: this.config.timeoutMs,
        defaultRetryPolicy: this.config.retryPolicy,
      });
    this.adapter = new InvocationAdapter(this);

    this.cacheEnabled = this.config.cacheEnabled;
    this.mockEnabled = this.config.mockEnabled;
    this.timeoutMs = this.config.timeoutMs;
    this.retryPolicy = { ...this.config.retryPolicy };
    this.cacheTtlMs = this.config.cacheTtlMs;
  }

  /* ------------------------------------------------------------------ *
   * Invocation
   * ------------------------------------------------------------------ */

  /**
   * Invokes a tool handler for a request, returning a settled
   * {@link InvocationResult}. Never throws.
   *
   * Resolution order, mirroring the runtime tool engine:
   *
   *   1. **Mock** — if mock mode is enabled (config or `options.mock`) and a
   *      mock is registered for `request.tool`, the mock value is returned
   *      immediately as a `mock: true` result (still recorded).
   *   2. **Internal cache** — if caching is enabled (config or
   *      `options.cache`) and a fresh entry exists for the serialised
   *      tool+params key, it is returned as a `cached: true` result.
   *   3. **Execute** — otherwise the request is delegated to the executor,
   *      which applies timeout, retry and full recording.
   *
   * @param request what to invoke.
   * @param handler the tool implementation (ignored on mock hits).
   * @param options per-call overrides.
   * @returns a settled result. Never rejects.
   */
  async invoke(
    request: InvocationRequest,
    handler: ToolHandler,
    options: InvokeOptions = {},
  ): Promise<InvocationResult> {
    if (typeof request?.tool !== 'string' || request.tool.length === 0) {
      throw new TypeError(
        'ToolInvoker.invoke: request must reference a tool with a non-empty name.',
      );
    }

    const resolveMock = options.mock ?? this.mockEnabled;
    if (resolveMock && this.mockRegistry.has(request.tool)) {
      return this.recordMock(request, this.mockRegistry.get(request.tool));
    }

    const useCache = options.cache ?? this.cacheEnabled;
    if (useCache) {
      const key = cacheKeyFor(request.tool, request.params);
      const cached = this.lookupCache(key);
      if (cached !== undefined) {
        this.store.recordCacheHit(request.tool);
        const result: InvocationResult = {
          ...cached,
          cached: true,
          timestamp: Date.now(),
        };
        return result;
      }
      this.store.recordCacheMiss(request.tool);
      const result = await this.executor.execute(request, handler, options);
      this.internalCache.set(key, {
        value: result,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return result;
    }

    return this.executor.execute(request, handler, options);
  }

  /**
   * Invokes a tool with result-caching backed by an external
   * {@link ResultCache}, keyed by the serialised tool+params.
   *
   * Unlike the internal cache, this path is explicit: caching always applies
   * for this call, the supplied cache object is authoritative, and a hit is
   * returned without consulting mock mode or the internal cache.
   *
   * @param request what to invoke.
   * @param handler the tool implementation.
   * @param cache the cache to read from and write into.
   * @param options per-call overrides passed through to execution.
   * @returns a settled result; `cached: true` when served from `cache`.
   */
  async invokeWithCache(
    request: InvocationRequest,
    handler: ToolHandler,
    cache: ResultCache,
    options: InvokeOptions = {},
  ): Promise<InvocationResult> {
    const key = cacheKeyFor(request.tool, request.params);
    const hit = cache.get(key);
    if (hit !== undefined) {
      this.store.recordCacheHit(request.tool);
      return { ...hit, cached: true, timestamp: Date.now() };
    }
    this.store.recordCacheMiss(request.tool);
    const result = await this.invoke(request, handler, options);
    cache.set(key, result);
    return result;
  }

  /**
   * Runs a bare handler with a timeout, bypassing recording, mock and cache.
   * Throws on failure or timeout. Delegates to the underlying executor.
   *
   * @param handler the tool implementation.
   * @param params the parameters forwarded to the handler.
   * @param timeoutMs the per-attempt deadline in ms.
   * @param context optional execution context.
   * @returns the handler's value.
   */
  executeWithTimeout(
    handler: ToolHandler,
    params: unknown,
    timeoutMs: number,
    context?: InvocationContext,
  ): Promise<unknown> {
    return this.executor.executeWithTimeout(handler, params, timeoutMs, context);
  }

  /**
   * Runs `fn` with the current retry policy, re-invoking on failure.
   * Throws after retries are exhausted. Delegates to the underlying executor.
   *
   * @param fn the operation to run.
   * @param retryPolicy optional per-call policy override.
   * @returns the first successful value.
   */
  retry<T>(fn: () => Promise<T>, retryPolicy?: Partial<RetryPolicy>): Promise<T> {
    return this.executor.retry(fn, retryPolicy ?? this.retryPolicy);
  }

  /* ------------------------------------------------------------------ *
   * Mock mode
   * ------------------------------------------------------------------ */

  /**
   * Registers a mock result for a tool. While mock mode is enabled, calls to
   * {@link ToolInvoker.invoke} for this tool return the mock value instead of
   * running the handler.
   *
   * @param tool the tool name to stub.
   * @param result the value to return; any JSON-serialisable value.
   * @returns `this` for chaining.
   */
  mock(tool: string, result: unknown): this {
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new TypeError(
        'ToolInvoker.mock: tool must be a non-empty string.',
      );
    }
    this.mockRegistry.set(tool, result);
    return this;
  }

  /**
   * Alias of {@link ToolInvoker.mock} matching the runtime tool engine
   * vocabulary.
   *
   * @param tool the tool name to stub.
   * @param result the value to return.
   * @returns `this` for chaining.
   */
  mockTool(tool: string, result: unknown): this {
    return this.mock(tool, result);
  }

  /**
   * Removes a registered mock.
   *
   * @param tool the tool name to unstub.
   * @returns `true` when a mock was removed.
   */
  unmock(tool: string): boolean {
    return this.mockRegistry.delete(tool);
  }

  /**
   * Returns `true` when a mock is registered for `tool`.
   *
   * @param tool the tool name to probe.
   */
  isMocked(tool: string): boolean {
    return this.mockRegistry.has(tool);
  }

  /**
   * Enables mock-mode resolution (unless a call opts out via `options.mock`).
   *
   * @returns `this` for chaining.
   */
  enableMock(): this {
    this.mockEnabled = true;
    return this;
  }

  /**
   * Disables mock-mode resolution.
   *
   * @returns `this` for chaining.
   */
  disableMock(): this {
    this.mockEnabled = false;
    return this;
  }

  /**
   * Returns `true` when mock mode is currently enabled.
   */
  isMockEnabled(): boolean {
    return this.mockEnabled;
  }

  /* ------------------------------------------------------------------ *
   * Baseline tuning
   * ------------------------------------------------------------------ */

  /**
   * Sets the baseline per-attempt timeout in ms.
   *
   * @param ms a positive timeout.
   * @returns `this` for chaining.
   * @throws {TypeError} when `ms` is not a positive number.
   */
  setTimeoutMs(ms: number): this {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new TypeError(
        'ToolInvoker.setTimeoutMs: timeout must be a positive number.',
      );
    }
    this.timeoutMs = ms;
    return this;
  }

  /**
   * Alias of {@link ToolInvoker.setTimeoutMs} matching the runtime tool
   * engine vocabulary.
   *
   * @param ms a positive timeout.
   * @returns `this` for chaining.
   */
  setTimeout(ms: number): this {
    return this.setTimeoutMs(ms);
  }

  /**
   * Returns the baseline per-attempt timeout in ms.
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Sets the baseline retry policy.
   *
   * @param policy a partial policy; missing fields keep current values.
   * @returns `this` for chaining.
   */
  setRetryPolicy(policy: Partial<RetryPolicy>): this {
    this.retryPolicy = { ...this.retryPolicy, ...policy };
    return this;
  }

  /**
   * Alias of {@link ToolInvoker.setRetryPolicy} matching the runtime tool
   * engine vocabulary.
   *
   * @param policy a partial retry policy.
   * @returns `this` for chaining.
   */
  setRetry(policy: Partial<RetryPolicy>): this {
    return this.setRetryPolicy(policy);
  }

  /**
   * Returns a copy of the baseline retry policy.
   */
  getRetryPolicy(): RetryPolicy {
    return { ...this.retryPolicy };
  }

  /* ------------------------------------------------------------------ *
   * Internal cache controls
   * ------------------------------------------------------------------ */

  /**
   * Enables the internal result cache (unless a call opts out via
   * `options.cache`).
   *
   * @returns `this` for chaining.
   */
  enableCache(): this {
    this.cacheEnabled = true;
    return this;
  }

  /**
   * Disables the internal result cache and drops all cached entries.
   *
   * @returns `this` for chaining.
   */
  disableCache(): this {
    this.cacheEnabled = false;
    this.internalCache.clear();
    return this;
  }

  /**
   * Returns `true` when the internal cache is currently enabled.
   */
  isCacheEnabled(): boolean {
    return this.cacheEnabled;
  }

  /**
   * Sets the internal cache TTL in ms. Existing entries are re-checked
   * against the new TTL on next read.
   *
   * @param ms a positive TTL.
   * @returns `this` for chaining.
   */
  setCacheTtlMs(ms: number): this {
    if (!Number.isFinite(ms) || ms <= 0) {
      throw new TypeError(
        'ToolInvoker.setCacheTtlMs: TTL must be a positive number.',
      );
    }
    this.cacheTtlMs = ms;
    return this;
  }

  /**
   * Removes every entry from the internal cache.
   *
   * @returns `this` for chaining.
   */
  clearCache(): this {
    this.internalCache.clear();
    return this;
  }

  /**
   * Returns the number of live (non-expired) internal cache entries.
   */
  cacheSize(): number {
    const now = Date.now();
    let live = 0;
    for (const entry of this.internalCache.values()) {
      if (entry.expiresAt > now) {
        live += 1;
      }
    }
    return live;
  }

  /* ------------------------------------------------------------------ *
   * Observability
   * ------------------------------------------------------------------ */

  /**
   * Returns every recorded history record, oldest first.
   */
  getExecutionHistory(): readonly ExecutionRecord[] {
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
   * Returns aggregate {@link InvocationStats} across every recorded tool.
   */
  getStats(): InvocationStats {
    return this.store.getStats();
  }

  /**
   * Returns cumulative {@link ToolStats} for a single tool.
   *
   * @param tool the tool name to inspect.
   */
  statsFor(tool: string): ToolStats {
    return this.store.statsFor(tool);
  }

  /**
   * Removes every recorded and indexed entry for a tool.
   *
   * @param tool the tool name to purge.
   * @returns the number of history records removed.
   */
  clearToolHistory(tool: string): number {
    return this.executor.clearToolHistory(tool);
  }

  /**
   * Removes every recorded and indexed entry across all tools.
   *
   * @returns the number of history records removed.
   */
  clearHistory(): number {
    return this.lifecycle.clearHistory();
  }

  /**
   * Resets cumulative statistics to zero while keeping history intact.
   *
   * @returns the number of tools whose stats were reset.
   */
  resetStats(): number {
    return this.lifecycle.resetStats();
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle controls & events
   * ------------------------------------------------------------------ */

  /**
   * Starts the periodic history GC.
   *
   * @returns `true` when a timer was started.
   */
  start(): boolean {
    return this.lifecycle.start();
  }

  /**
   * Stops the periodic history GC.
   *
   * @returns `true` when a timer was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns `true` when the periodic history GC is running.
   */
  isRunning(): boolean {
    return this.lifecycle.isRunning();
  }

  /**
   * Subscribes to invocation and lifecycle events. See
   * {@link INVOCATION_EVENTS} for names.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: InvocationEventPayload) => void,
  ): this {
    this.lifecycle.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener added via {@link ToolInvoker.on}.
   */
  off(
    event: string,
    listener: (payload: InvocationEventPayload) => void,
  ): this {
    this.lifecycle.off(event, listener);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Looks up the internal cache for a key, honouring TTL. Expired entries are
   * dropped eagerly so stale values never leak back out.
   */
  private lookupCache(key: string): InvocationResult | undefined {
    const entry = this.internalCache.get(key);
    if (entry === undefined) {
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.internalCache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Records and returns a mock-served result for a request.
   */
  private recordMock(request: InvocationRequest, value: unknown): InvocationResult {
    const result = createInvocationResult({
      tool: request.tool,
      ok: true,
      value,
      durationMs: 0,
      attempt: 0,
      cached: false,
      mock: true,
      timestamp: Date.now(),
      traceId: request.traceId,
    });
    const record = this.store.record(result);
    if (record.id !== undefined) {
      this.index.indexRecord(result, record.id);
    } else {
      this.index.indexRecord(result);
    }
    this.lifecycle.emitter.emit(INVOCATION_EVENTS.succeeded, {
      type: 'succeeded',
      result,
    } satisfies InvocationEventPayload);
    return result;
  }
}

/**
 * A read-only adapter presenting a {@link ToolInvoker} through the stable
 * {@link ToolExecutor} interface. Holds no state of its own — every method
 * delegates to the invoker (and its underlying executor).
 */
export class InvocationAdapter implements ToolExecutor {
  /** The invoker backing this adapter. */
  private readonly invoker: ToolInvoker;

  /**
   * Creates an adapter around an invoker.
   *
   * @param invoker the invoker to delegate to.
   */
  constructor(invoker: ToolInvoker) {
    this.invoker = invoker;
  }

  /** @inheritdoc */
  execute(
    request: InvocationRequest,
    handler: ToolHandler,
    options?: InvokeOptions,
  ): Promise<InvocationResult> {
    return this.invoker.invoke(request, handler, options);
  }

  /** @inheritdoc */
  executeWithTimeout(
    handler: ToolHandler,
    params: unknown,
    timeoutMs: number,
    context?: InvocationContext,
  ): Promise<unknown> {
    return this.invoker.executeWithTimeout(handler, params, timeoutMs, context);
  }

  /** @inheritdoc */
  retry<T>(fn: () => Promise<T>, retryPolicy?: Partial<RetryPolicy>): Promise<T> {
    return this.invoker.retry(fn, retryPolicy);
  }

  /** @inheritdoc */
  clearToolHistory(tool: string): number {
    return this.invoker.clearToolHistory(tool);
  }

  /** @inheritdoc */
  clearHistory(): number {
    return this.invoker.clearHistory();
  }

  /** @inheritdoc */
  statsFor(tool: string): ToolStats {
    return this.invoker.statsFor(tool);
  }

  /** @inheritdoc */
  stats(): InvocationStats {
    return this.invoker.getStats();
  }

  /** @inheritdoc */
  historyFor(tool: string): ExecutionRecord[] {
    return this.invoker.historyFor(tool);
  }

  /** @inheritdoc */
  history(): readonly ExecutionRecord[] {
    return this.invoker.getExecutionHistory();
  }
}

/**
 * Convenience factory for a fully wired {@link ToolInvoker}.
 *
 * @param options optional config and component wiring.
 * @returns a ready-to-use invocation facade.
 */
export function createToolInvoker(options?: ToolInvokerOptions): ToolInvoker {
  return new ToolInvoker(options);
}

/**
 * Default exported factory mirroring {@link createToolInvoker}, so both
 * `import invoker from './integration.js'` and named imports work.
 */
export default createToolInvoker;