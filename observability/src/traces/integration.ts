/**
 * @fileoverview
 * Integration surface for the MAM Observability Traces layer.
 *
 * This module is the public entry point of the traces subsystem. It exposes
 * three things:
 *
 *  - **`TraceRecorder`** — a narrow, framework-agnostic contract describing
 *    the operations any tracing backend must support (`record`, `startSpan`,
 *    `endSpan`, `query`, `stats`). Adapters for OpenTelemetry, Zipkin, or a
 *    remote collector can implement this interface behind the same API.
 *  - **`TraceAdapter`** — the bundled in-memory implementation of
 *    `TraceRecorder`. It wires the store, index, query and lifecycle engines
 *    together so that a single object owns the whole pipeline and keeps every
 *    component coherent on every write.
 *  - **`Tracer`** — a high-level instrumentation helper layered on top of any
 *    `TraceRecorder`. It manages trace ids, span ids and parent links for you,
 *    exposes `startSpan` / `endSpan`, a declarative `trace(fn)` helper that
 *    records success and failure automatically, and an `attributes` helper for
 *    attaching metadata to in-flight spans.
 *
 * The factory functions `createTraceAdapter(config?)` and `createTracer(config?)`
 * are the recommended way to instantiate the layer; they apply defaults, wire
 * internal components, and return fully usable objects.
 */

import type { SpanOptions, Trace, TraceConfig, TraceEvent, TraceSpan, TraceStats } from './types.js';
import { createSpanId, resolveTraceConfig } from './types.js';
import { TraceStore } from './store.js';
import { TraceIndex } from './index.js';
import { TraceQuery } from './retrieval.js';
import { TraceLifecycle } from './lifecycle.js';
import type { PruneResult } from './types.js';
import type { TraceEventHandler } from './lifecycle.js';

/**
 * Error thrown when a `Tracer` operation references a span that no longer
 * exists in the underlying recorder. Lets callers distinguish programmer error
 * from legitimate miss handling.
 */
export class SpanNotFoundError extends Error {
  /** The span id that could not be resolved. */
  readonly spanId: string;

  /**
   * @param spanId - the unresolved span id.
   */
  constructor(spanId: string) {
    super(`No span with id "${spanId}" exists in the trace recorder`);
    this.name = 'SpanNotFoundError';
    this.spanId = spanId;
  }
}

/**
 * A narrow contract for any tracing backend. Implementations must accept raw
 * span payloads, expose span lifecycle helpers, and provide read access to the
 * stored data. All methods are synchronous to keep the interface usable from
 * hot paths without promise churn.
 */
export interface TraceRecorder {
  /**
   * Record a fully-formed span, returning the normalized stored copy.
   *
   * @param span - the span to record.
   * @returns the stored span, or `undefined` when it was dropped (e.g. the
   * per-trace span cap was exceeded).
   */
  record(span: TraceSpan): TraceSpan | undefined;

  /**
   * Begin a new span, generating ids as needed.
   *
   * @param name - the operation name.
   * @param options - trace / parent / attributes / timing controls.
   * @returns the started span (status `incomplete` until ended).
   */
  startSpan(name: string, options?: SpanOptions): TraceSpan | undefined;

  /**
   * Finish a span, computing duration and status.
   *
   * @param spanOrId - the span object or its id.
   * @param options - completion status / end time.
   * @returns the finished span, or `undefined` when unknown.
   */
  endSpan(spanOrId: TraceSpan | string, options?: { status?: 'ok' | 'error'; endTime?: number }): TraceSpan | undefined;

  /**
   * Access the read/query layer for the recorded data.
   *
   * @returns a {@link TraceQuery} bound to this recorder's data.
   */
  query(): TraceQuery;

  /**
   * Aggregate statistics over the recorded data.
   *
   * @returns a {@link TraceStats} object.
   */
  stats(): TraceStats;
}

/**
 * Options accepted by {@link TraceAdapter} for every component it owns.
 */
export interface TraceAdapterOptions {
  /**
   * Partial configuration merged over {@link DEFAULT_TRACE_CONFIG}.
   */
  config?: Partial<TraceConfig>;
  /**
   * Invoked whenever a span is dropped (per-trace cap exceeded). Defaults to a
   * no-op. Receives the span that was rejected.
   */
  onDroppedSpan?: (span: TraceSpan) => void;
  /**
   * When `true`, the lifecycle engine is started (scheduled pruning) as soon
   * as the adapter is constructed. Defaults to `false`.
   */
  autoStartLifecycle?: boolean;
}

/**
 * The bundled in-memory `TraceRecorder`. Owns and keeps coherent the store,
 * index, query and lifecycle components.
 */
export class TraceAdapter implements TraceRecorder {
  /** Storage engine. */
  readonly #store: TraceStore;
  /** Secondary index. */
  readonly #index: TraceIndex;
  /** Query layer. */
  readonly #query: TraceQuery;
  /** Lifecycle / retention engine. */
  readonly #lifecycle: TraceLifecycle;
  /** Effective config. */
  readonly #config: TraceConfig;
  /** Drop hook invoked when a span cannot be stored. */
  readonly #onDroppedSpan: (span: TraceSpan) => void;

  /**
   * Create an adapter.
   *
   * @param options - optional config / hooks / lifecycle autostart.
   */
  constructor(options: TraceAdapterOptions = {}) {
    this.#config = resolveTraceConfig(options.config);
    this.#onDroppedSpan = options.onDroppedSpan ?? (() => undefined);
    this.#store = new TraceStore(this.#config);
    this.#index = new TraceIndex(this.#store, this.#config);
    this.#query = new TraceQuery(this.#store, this.#index, this.#config);
    this.#lifecycle = new TraceLifecycle(this.#store, this.#index, this.#config);
    if (options.autoStartLifecycle === true) {
      this.#lifecycle.start();
    }
  }

  /**
   * The store this adapter owns.
   */
  get store(): TraceStore {
    return this.#store;
  }

  /**
   * The index this adapter maintains.
   */
  get index(): TraceIndex {
    return this.#index;
  }

  /**
   * The lifecycle engine this adapter runs.
   */
  get lifecycle(): TraceLifecycle {
    return this.#lifecycle;
  }

  /**
   * The effective configuration.
   */
  get config(): TraceConfig {
    return this.#config;
  }

  /**
   * Whether the adapter has active scheduled pruning.
   */
  get running(): boolean {
    return this.#lifecycle.running;
  }

  /**
   * Record a fully-formed span: writes it to the store, indexes it, and (when
   * the span is complete) notifies the lifecycle. Returns the stored copy.
   *
   * @param span - the span to record.
   * @returns the stored span or `undefined` when dropped.
   */
  record(span: TraceSpan): TraceSpan | undefined {
    const stored = this.#store.recordSpan(span);
    if (stored === undefined) {
      this.#onDroppedSpan(span);
      return undefined;
    }
    this.#index.indexSpan(stored);
    return stored;
  }

  /**
   * Begin a span. A trace id is generated when none is supplied; a span id is
   * always generated. The resulting span is recorded immediately as
   * `incomplete` so it is visible to queries even before it ends.
   *
   * @param name - the operation name.
   * @param options - optional trace / parent / attributes / start time.
   * @returns the started span, or `undefined` when dropped.
   */
  startSpan(name: string, options: SpanOptions = {}): TraceSpan | undefined {
    const traceId = options.traceId ?? createSpanId(this.#config.idLength);
    const id = createSpanId(this.#config.idLength);
    const startTime = options.startTime ?? Date.now();
    const span: TraceSpan = {
      id,
      traceId,
      parentId: options.parentId,
      name,
      status: options.status ?? 'incomplete',
      startTime,
      attributes: options.attributes,
      service: options.service,
      tags: options.tags,
    };
    if (options.endTime !== undefined) {
      span.endTime = options.endTime;
      span.durationMs = Math.max(0, options.endTime - startTime);
      span.status = options.status ?? 'ok';
    }
    return this.record(span);
  }

  /**
   * Finish a span referenced by object or id. Delegates to the lifecycle so a
   * `spanComplete` event is emitted.
   *
   * @param spanOrId - the span object or its id.
   * @param options - status / end time overrides.
   * @returns the finished span, or `undefined` when unknown.
   */
  endSpan(spanOrId: TraceSpan | string, options: { status?: 'ok' | 'error'; endTime?: number } = {}): TraceSpan | undefined {
    const spanId = typeof spanOrId === 'string' ? spanOrId : spanOrId?.id;
    if (typeof spanId !== 'string') {
      return undefined;
    }
    return this.#lifecycle.completeSpan(spanId, {
      endTime: options.endTime,
      status: options.status,
    });
  }

  /**
   * Attach additional attributes to an in-flight span.
   *
   * @param spanOrId - the span object or its id.
   * @param attributes - the attributes to merge in.
   * @returns the updated span, or `undefined` when unknown.
   */
  addAttributes(spanOrId: TraceSpan | string, attributes: Record<string, unknown>): TraceSpan | undefined {
    const spanId = typeof spanOrId === 'string' ? spanOrId : spanOrId?.id;
    const current = typeof spanOrId === 'string' ? this.#store.getSpan(spanOrId) : spanOrId;
    if (current === undefined || typeof spanId !== 'string') {
      return undefined;
    }
    const merged: TraceSpan = {
      ...current,
      attributes: { ...current.attributes, ...attributes },
    };
    return this.record(merged);
  }

  /**
   * Read access to the recorded data.
   *
   * @returns the shared {@link TraceQuery}.
   */
  query(): TraceQuery {
    return this.#query;
  }

  /**
   * Aggregate statistics over the recorded data.
   *
   * @returns a {@link TraceStats} object.
   */
  stats(): TraceStats {
    return this.#store.stats();
  }

  /**
   * Fetch a trace aggregate by id.
   *
   * @param traceId - trace id to fetch.
   * @returns the trace or `undefined`.
   */
  getTrace(traceId: string): Trace | undefined {
    return this.#store.getTrace(traceId);
  }

  /**
   * Run a prune pass with the default (or explicit) retention window.
   *
   * @param olderThanMs - retention window; defaults to config.
   * @returns a {@link PruneResult}.
   */
  prune(olderThanMs?: number): PruneResult {
    return this.#lifecycle.prune(olderThanMs);
  }

  /**
   * Start scheduled pruning.
   *
   * @param options - interval / retention / immediate overrides.
   * @returns `true` when a timer was created.
   */
  startLifecycle(options?: { pruneIntervalMs?: number; retentionMs?: number; immediate?: boolean }): boolean {
    return this.#lifecycle.start(options);
  }

  /**
   * Stop scheduled pruning.
   *
   * @returns `true` when a timer was stopped.
   */
  stopLifecycle(): boolean {
    return this.#lifecycle.stop();
  }

  /**
   * Reset all stored data and counters.
   *
   * @returns the number of traces removed.
   */
  reset(): number {
    return this.#lifecycle.reset();
  }

  /**
   * Subscribe to a lifecycle event.
   *
   * @param event - the event name.
   * @param handler - the event handler.
   * @returns this adapter for chaining.
   */
  on(event: string, handler: TraceEventHandler): this {
    this.#lifecycle.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Serialize the adapter's full contents to JSON.
   *
   * @returns the serialized store snapshot.
   */
  toJSON(): unknown {
    return this.#store.toJSON();
  }

  /**
   * Dispose of the adapter: stop timers and release listeners.
   */
  destroy(): void {
    this.#lifecycle.dispose();
  }
}

/**
 * High-level instrumentation helper layered over any {@link TraceRecorder}.
 *
 * `Tracer` is what application code actually touches. It manages id generation
 * and parent links so callers can write:
 *
 * ```ts
 * const tracer = createTracer();
 * const span = tracer.startSpan('handle.request');
 * try { ... } finally { tracer.endSpan(span); }
 * ```
 *
 * or, for the common case, rely on `trace(fn)` which records success/failure
 * automatically:
 *
 * ```ts
 * const result = await tracer.trace(async () => fetchData(), 'db.fetch');
 * ```
 */
export class Tracer {
  /** The underlying recorder. */
  readonly #recorder: TraceRecorder;

  /**
   * Create a tracer over a recorder.
   *
   * @param recorder - any {@link TraceRecorder} implementation.
   */
  constructor(recorder: TraceRecorder) {
    this.#recorder = recorder;
  }

  /**
   * The underlying recorder.
   */
  get recorder(): TraceRecorder {
    return this.#recorder;
  }

  /**
   * Record a raw span directly.
   *
   * @param span - the span to record.
   * @returns the stored span or `undefined`.
   */
  record(span: TraceSpan): TraceSpan | undefined {
    return this.#recorder.record(span);
  }

  /**
   * Start a new span. Trace and span ids are generated automatically; when a
   * parent span is passed (by object or id) the parent link is set and the new
   * span inherits the parent's trace id.
   *
   * @param name - the operation name.
   * @param options - optional span controls.
   * @returns the started span, or `undefined` when dropped.
   */
  startSpan(name: string, options: SpanOptions = {}): TraceSpan | undefined {
    const resolved = this.#resolveParent(options);
    return this.#recorder.startSpan(name, resolved);
  }

  /**
   * End a span, marking it ok or error.
   *
   * @param spanOrId - the span or its id.
   * @param options - status / end time overrides.
   * @returns the finished span, or `undefined` when unknown.
   */
  endSpan(spanOrId: TraceSpan | string, options: { status?: 'ok' | 'error'; endTime?: number } = {}): TraceSpan | undefined {
    return this.#recorder.endSpan(spanOrId, options);
  }

  /**
   * Run an async function inside a span and end the span automatically.
   *
   * Success ends the span as `ok`; a thrown/rejected error ends it as `error`
   * (capturing `error.message` in attributes) and is rethrown to the caller.
   *
   * @param fn - the async work to instrument.
   * @param name - the operation name.
   * @param options - optional span controls.
   * @returns the promise result of `fn`.
   */
  async trace<T>(fn: () => Promise<T> | T, name: string, options: SpanOptions = {}): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn();
      if (span !== undefined) {
        this.endSpan(span);
      }
      return result;
    } catch (error) {
      if (span !== undefined) {
        const attributes: Record<string, unknown> = {
          ...(span.attributes ?? {}),
          'error.message': error instanceof Error ? error.message : String(error),
          'error.type': error instanceof Error ? error.name : typeof error,
        };
        this.record({ ...span, attributes, status: 'error' });
        this.endSpan(span, { status: 'error' });
      }
      throw error;
    }
  }

  /**
   * Run a synchronous function inside a span and end the span automatically.
   *
   * @param fn - the synchronous work to instrument.
   * @param name - the operation name.
   * @param options - optional span controls.
   * @returns the result of `fn`.
   */
  traceSync<T>(fn: () => T, name: string, options: SpanOptions = {}): T {
    const span = this.startSpan(name, options);
    try {
      const result = fn();
      if (span !== undefined) {
        this.endSpan(span);
      }
      return result;
    } catch (error) {
      if (span !== undefined) {
        this.record({
          ...span,
          attributes: {
            ...(span.attributes ?? {}),
            'error.message': error instanceof Error ? error.message : String(error),
          },
          status: 'error',
        });
        this.endSpan(span, { status: 'error' });
      }
      throw error;
    }
  }

  /**
   * Attach attributes to an in-flight span and return a chaining handle so
   * callers can record metadata incrementally.
   *
   * @param spanOrId - the span or its id.
   * @param attributes - attributes to attach.
   * @returns a {@link Tracer} handle for further calls.
   */
  attributes(spanOrId: TraceSpan | string, attributes: Record<string, unknown>): this {
    if (this.#recorder instanceof TraceAdapter) {
      this.#recorder.addAttributes(spanOrId, attributes);
    } else {
      const spanId = typeof spanOrId === 'string' ? spanOrId : spanOrId?.id;
      const existing = typeof spanOrId === 'string' ? undefined : spanOrId;
      if (existing !== undefined) {
        this.#recorder.record({ ...existing, attributes: { ...existing.attributes, ...attributes } });
      } else if (typeof spanId === 'string') {
        const span = this.query().getSpan(spanId);
        if (span !== undefined) {
          this.#recorder.record({ ...span, attributes: { ...span.attributes, ...attributes } });
        }
      }
    }
    return this;
  }

  /**
   * Resolve parent / trace options from an optional parent reference in
   * `SpanOptions`. When `options.parentId` is set the trace id is inherited
   * from the parent span when it can be found in the recorder.
   *
   * @param options - the raw span options.
   * @returns resolved options with inherited trace id.
   */
  #resolveParent(options: SpanOptions): SpanOptions {
    if (options.parentId === undefined) {
      return options;
    }
    const parent = this.query().getSpan(options.parentId);
    if (parent === undefined) {
      return options;
    }
    return { ...options, traceId: options.traceId ?? parent.traceId };
  }

  /**
   * Access the query layer of the underlying recorder.
   *
   * @returns a {@link TraceQuery}.
   */
  query(): TraceQuery {
    return this.#recorder.query();
  }

  /**
   * Aggregate statistics from the underlying recorder.
   *
   * @returns a {@link TraceStats}.
   */
  stats(): TraceStats {
    return this.#recorder.stats();
  }

  /**
   * Build a child span of the given parent, inheriting its trace id.
   *
   * @param parent - the parent span object.
   * @param name - the child operation name.
   * @param options - additional child span controls.
   * @returns the child span.
   */
  childSpan(parent: TraceSpan, name: string, options: SpanOptions = {}): TraceSpan | undefined {
    return this.startSpan(name, { ...options, parentId: parent.id, traceId: parent.traceId });
  }
}

/**
 * Factory: create a fully-wired in-memory {@link TraceAdapter}.
 *
 * @param options - optional adapter configuration.
 * @returns a ready-to-use {@link TraceAdapter}.
 */
export function createTraceAdapter(options?: TraceAdapterOptions): TraceAdapter {
  return new TraceAdapter(options);
}

/**
 * Factory: create a {@link Tracer} backed by a fresh in-memory adapter.
 *
 * @param options - optional adapter configuration passed to the underlying
 * adapter.
 * @returns a ready-to-use {@link Tracer}.
 */
export function createTracer(options?: TraceAdapterOptions): Tracer {
  const adapter = createTraceAdapter(options);
  return new Tracer(adapter);
}