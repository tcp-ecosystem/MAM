/**
 * @fileoverview
 * Core type definitions and tiny runtime helpers for the MAM Observability
 * Traces layer.
 *
 * This module is intentionally dependency-free (aside from the Node.js crypto
 * built-in) and is imported by every other module in `observability/src/traces/`.
 * It defines the canonical shapes for spans, traces, configuration, statistics,
 * span creation options, and the event objects emitted by the lifecycle engine.
 *
 * The design principles behind these types:
 *
 *  - **Spans are the atomic unit of recording.** A `TraceSpan` is immutable once
 *    it is handed to a `TraceStore`; updates happen by recording a new revision
 *    of the span with the same id, never by mutating the original object.
 *  - **Traces are derived aggregates.** A `Trace` is a convenience view built
 *    from the spans that share a trace id. The `store.ts` module maintains these
 *    aggregates incrementally, while `retrieval.ts` can rebuild them on demand.
 *  - **Timestamps are epoch milliseconds.** All `startTime` / `endTime` values
 *    are POSIX epoch milliseconds (the output of `Date.now()`). Durations are
 *    computed, never stored redundantly, to keep invariants simple.
 *  - **Cardinality is bounded by config.** `TraceConfig` exists so callers can
 *    cap the number of spans per trace and the size of attribute maps / tag
 *    arrays, protecting the store from unbounded memory growth in production.
 *
 * The runtime helpers at the bottom of this file (guards, factories, id
 * generation) are shared by every other module so that invariants around
 * validation and normalization live in exactly one place.
 */

import { randomUUID } from 'node:crypto';

/**
 * The lifecycle state of a single span.
 *
 * - `ok`: the span ended successfully and recorded an `endTime`.
 * - `error`: the span ended unsuccessfully; `attributes` often carry an
 *   `error.message` / `error.type` pair describing the failure.
 * - `incomplete`: the span was started but never ended (for example the
 *   process crashed or the operation timed out before completion).
 */
export type SpanStatus = 'ok' | 'error' | 'incomplete';

/**
 * Every span status value that is considered a valid entry point for the
 * `isSpanStatus` type guard. Kept in sync with {@link SpanStatus}.
 */
export const SPAN_STATUSES: readonly SpanStatus[] = ['ok', 'error', 'incomplete'];

/**
 * A single recorded unit of work inside a distributed trace.
 *
 * A span represents one operation (a database query, an HTTP call, a unit of
 * CPU-bound work) and belongs to exactly one trace. Spans may optionally point
 * at a parent span, which lets consumers reconstruct a tree-shaped execution
 * graph for the whole trace.
 */
export interface TraceSpan {
  /**
   * Unique identifier for this span. Unique across all traces; conventionally
   * a 128-bit hex string produced by {@link createSpanId}.
   */
  id: string;
  /**
   * Identifier of the trace this span belongs to. All spans of one logical
   * operation share the same trace id.
   */
  traceId: string;
  /**
   * Optional identifier of the parent span. Omitted for root spans. A span
   * with no parent is the root of its trace; there should normally be exactly
   * one root per trace.
   */
  parentId?: string;
  /**
   * Human readable operation name, for example `"http.get /api/users"` or
   * `"sql.query SELECT * FROM orders"`. Used by the index for lookups and for
   * aggregating traces that share an operation.
   */
  name: string;
  /**
   * Terminal state of the span: `ok`, `error` or `incomplete`.
   */
  status: SpanStatus;
  /**
   * Epoch milliseconds at which the operation started.
   */
  startTime: number;
  /**
   * Epoch milliseconds at which the operation ended. Absent while the span is
   * still in-flight (status `incomplete`).
   */
  endTime?: number;
  /**
   * Computed duration in milliseconds (`endTime - startTime`). Always present
   * once the span has an `endTime`; re-derived by `computeDurationMs`.
   */
  durationMs?: number;
  /**
   * Free-form key/value attributes attached to the span, e.g. `{ method: "GET",
   * statusCode: 200, "http.url": "/api" }`. Keys are strings; values may be any
   * JSON-serialisable value. Bounded in size by {@link TraceConfig}.
   */
  attributes?: Record<string, unknown>;
  /**
   * Logical service or component that produced the span, e.g. `"auth-service"`.
   * Indexed by {@link TraceIndex} for cross-service filtering.
   */
  service?: string;
  /**
   * Optional classification tags such as `["db", "slow", "retry"]`. Bounded in
   * length by {@link TraceConfig}.
   */
  tags?: string[];
}

/**
 * A convenience aggregate describing one complete distributed trace.
 *
 * Instances are maintained incrementally by `TraceStore` as spans are recorded
 * and can be rebuilt from raw spans at any time by `TraceQuery.getTrace`. The
 * aggregate surfaces the root span, span count, overall status, and timing
 * envelope so that callers do not have to scan every span to render a trace
 * summary.
 */
export interface Trace {
  /**
   * Identifier shared by every span in this trace.
   */
  traceId: string;
  /**
   * Identifier of the root span (the span with no `parentId`). Empty string if
   * the trace has no root, which happens for orphaned span sets.
   */
  rootSpanId: string;
  /**
   * Spans belonging to this trace. The array is not guaranteed to be ordered;
   * use `TraceQuery.getTrace` for a deterministic, tree-shaped view.
   */
  spans: TraceSpan[];
  /**
   * Human readable name of the trace, derived from the root span's name (or
   * the first recorded span when there is no root).
   */
  name: string;
  /**
   * Service that owns the root span, if any.
   */
  service?: string;
  /**
   * Epoch milliseconds when the trace began (earliest span `startTime`).
   */
  startTime: number;
  /**
   * Epoch milliseconds when the trace ended (latest span `endTime`), if every
   * span has completed.
   */
  endTime?: number;
  /**
   * Total wall-clock duration of the trace (`endTime - startTime`), present
   * once the trace has fully completed.
   */
  durationMs?: number;
  /**
   * Rolled-up status: `error` if any span errored, `incomplete` if any span is
   * incomplete, otherwise `ok`.
   */
  status: SpanStatus;
  /**
   * Aggregated attributes hoisted from the root span (useful for indexing the
   * trace itself without scanning child spans).
   */
  attributes?: Record<string, unknown>;
  /**
   * Aggregated tags hoisted from the root span.
   */
  tags?: string[];
  /**
   * Number of spans currently recorded for this trace.
   */
  spanCount: number;
}

/**
 * Configuration knobs that bound memory usage and shape the behaviour of the
 * traces layer. Every field has a sane default (see
 * {@link DEFAULT_TRACE_CONFIG}); pass a partial config object to the
 * `TraceStore` / `TraceAdapter` constructors to override individual values.
 */
export interface TraceConfig {
  /**
   * Maximum number of spans a single trace may hold. Recording a span that
   * would exceed this limit is a no-op (the span is dropped) and a warning is
   * surfaced through the adapter's onDroppedSpan hook when provided.
   */
  maxSpansPerTrace: number;
  /**
   * Maximum number of entries allowed in a span's `attributes` map. Extra
   * entries are silently dropped on record.
   */
  maxAttributesPerSpan: number;
  /**
   * Maximum number of entries allowed in a span's `tags` array. Extra entries
   * are dropped on record.
   */
  maxTagsPerSpan: number;
  /**
   * Maximum character length for a single tag value. Longer tags are
   * truncated at this length.
   */
  maxTagLength: number;
  /**
   * Maximum character length for attribute string values. Longer values are
   * truncated to avoid storing huge blobs inside attribute maps.
   */
  maxAttributeValueLength: number;
  /**
   * Length in characters of generated span ids / trace ids.
   */
  idLength: number;
  /**
   * Interval in milliseconds between periodic prune passes when the lifecycle
   * engine is running.
   */
  pruneIntervalMs: number;
  /**
   * Default retention window in milliseconds used when a prune runs without an
   * explicit `olderThanMs` argument.
   */
  defaultRetentionMs: number;
}

/**
 * The default configuration applied when no overrides are supplied.
 */
export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  maxSpansPerTrace: 10_000,
  maxAttributesPerSpan: 64,
  maxTagsPerSpan: 32,
  maxTagLength: 128,
  maxAttributeValueLength: 2048,
  idLength: 16,
  pruneIntervalMs: 60_000,
  defaultRetentionMs: 60 * 60 * 1000,
};

/**
 * Aggregated statistics across every span and trace currently held in a
 * `TraceStore`. Produced by `TraceStore.stats()` and consumed by dashboards,
 * health checks, and the `TraceAdapter.stats()` surface.
 */
export interface TraceStats {
  /** Total number of spans stored across all traces. */
  totalSpans: number;
  /** Total number of traces stored. */
  totalTraces: number;
  /** Number of spans with status `ok`. */
  okSpans: number;
  /** Number of spans with status `error`. */
  errorSpans: number;
  /** Number of spans that never completed (status `incomplete`). */
  incompleteSpans: number;
  /** Number of spans that act as a root (have no parent). */
  rootSpans: number;
  /** Arithmetic mean duration in milliseconds over completed spans. */
  avgDurationMs: number;
  /** Median (50th percentile) duration in milliseconds over completed spans. */
  p50: number;
  /** 95th percentile duration in milliseconds over completed spans. */
  p95: number;
  /** 99th percentile duration in milliseconds over completed spans. */
  p99: number;
  /** Longest completed span duration in milliseconds. */
  maxDurationMs: number;
  /** Shortest completed span duration in milliseconds. */
  minDurationMs: number;
  /** Map of service name to number of spans recorded for that service. */
  services: Record<string, number>;
  /** Map of span status to number of spans in that status. */
  byStatus: Record<SpanStatus, number>;
  /**
   * Rough estimate of retained memory in bytes, derived from the number of
   * spans and a per-span structural overhead constant.
   */
  memoryBytesEstimate: number;
  /** Epoch milliseconds of the oldest recorded span. Zero when empty. */
  oldestTraceTimestamp: number;
  /** Epoch milliseconds of the most recently recorded span. Zero when empty. */
  newestTraceTimestamp: number;
}

/**
 * Options accepted by `TraceRecorder.startSpan` / `Tracer.startSpan`. Lets
 * callers attach a parent, start a span at a specific clock time, pre-populate
 * attributes / tags / service, or even record a span that is already complete.
 */
export interface SpanOptions {
  /**
   * Identifier of the trace this span belongs to. When omitted, a fresh trace
   * id is generated by the recorder / tracer.
   */
  traceId?: string;
  /**
   * Identifier of the parent span, creating a child relationship. Omit for a
   * root span.
   */
  parentId?: string;
  /**
   * Free-form attributes attached to the span at creation time.
   */
  attributes?: Record<string, unknown>;
  /**
   * Service or component name producing the span.
   */
  service?: string;
  /**
   * Classification tags attached at creation time.
   */
  tags?: string[];
  /**
   * Epoch milliseconds to use as the span start time. Defaults to `Date.now()`.
   */
  startTime?: number;
  /**
   * Initial status. Defaults to `incomplete` so that an un-ended span is
   * distinguishable from a completed one.
   */
  status?: SpanStatus;
  /**
   * Pre-computed duration in milliseconds. When supplied together with
   * `endTime`, the store trusts the explicit `endTime`.
   */
  durationMs?: number;
  /**
   * Epoch milliseconds at which the span is considered ended. When supplied
   * the span is recorded as complete immediately.
   */
  endTime?: number;
}

/**
 * Discriminating union of every event emitted by the traces layer. Events are
 * produced by `TraceLifecycle` (span completion, prune passes, start/stop) and
 * can be forwarded by `TraceAdapter` to external subscribers.
 */
export interface TraceEvent {
  /**
   * Discriminator identifying the kind of event. See {@link TraceEventType}.
   */
  type: TraceEventType;
  /** Epoch milliseconds at which the event was emitted. */
  timestamp: number;
  /** Trace id the event relates to, when applicable. */
  traceId?: string;
  /** Span id the event relates to, when applicable. */
  spanId?: string;
  /** The span that triggered the event (spanComplete / span-recorded). */
  span?: TraceSpan;
  /** The trace that triggered the event (trace-recorded). */
  trace?: Trace;
  /** Number of entries removed by a prune / clear pass. */
  pruned?: number;
  /** Number of entries remaining after a prune / clear pass. */
  remaining?: number;
  /** Human-readable reason, e.g. `"retention"` for a timed prune. */
  reason?: string;
  /** Arbitrary extra context attached to the event. */
  detail?: Record<string, unknown>;
}

/**
 * The set of event type discriminators understood by the traces layer.
 */
export type TraceEventType =
  | 'span-recorded'
  | 'trace-recorded'
  | 'span-completed'
  | 'trace-pruned'
  | 'store-cleared'
  | 'index-rebuilt'
  | 'lifecycle-started'
  | 'lifecycle-stopped'
  | 'lifecycle-reset';

/**
 * Sorting options accepted by store / query list methods.
 */
export type TraceSortOrder = 'asc' | 'desc';

/**
 * The serialisable shape produced by `TraceStore.toJSON()` and accepted by
 * `TraceStore.fromJSON()`. Versioned so that future format changes remain
 * detectable on import.
 */
export interface SerializedTraceStore {
  /** Format version; currently always `1`. */
  version: number;
  /** Epoch milliseconds at which the snapshot was exported. */
  exportedAt: number;
  /** Every span contained in the store. */
  spans: TraceSpan[];
  /** Every trace aggregate contained in the store. */
  traces: Trace[];
}

/**
 * Result of a prune pass, returned by `TraceLifecycle.prune`.
 */
export interface PruneResult {
  /** Number of spans removed. */
  prunedSpans: number;
  /** Number of traces removed. */
  prunedTraces: number;
  /** Number of spans remaining after the prune. */
  remainingSpans: number;
  /** Number of traces remaining after the prune. */
  remainingTraces: number;
  /** Epoch milliseconds at which the prune started. */
  at: number;
  /** Epoch millisecond cutoff used to decide what is "old". */
  cutoff: number;
}

/**
 * Type guard narrowing an arbitrary value to a {@link SpanStatus}.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is one of `"ok" | "error" | "incomplete"`.
 */
export function isSpanStatus(value: unknown): value is SpanStatus {
  return typeof value === 'string' && (SPAN_STATUSES as readonly string[]).includes(value);
}

/**
 * Type guard narrowing an arbitrary value to a {@link TraceSpan}.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` looks like a well-formed span.
 */
export function isTraceSpan(value: unknown): value is TraceSpan {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<TraceSpan>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.traceId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.startTime === 'number' &&
    isSpanStatus(candidate.status)
  );
}

/**
 * Type guard narrowing an arbitrary value to a {@link Trace} aggregate.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` looks like a well-formed trace aggregate.
 */
export function isTrace(value: unknown): value is Trace {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Trace>;
  return (
    typeof candidate.traceId === 'string' &&
    typeof candidate.startTime === 'number' &&
    Array.isArray(candidate.spans) &&
    typeof candidate.spanCount === 'number'
  );
}

/**
 * Current epoch time in milliseconds.
 *
 * @returns `Date.now()`.
 */
export function now(): number {
  return Date.now();
}

/**
 * Compute the duration in milliseconds between two timestamps, clamping to
 * zero when the window is empty or inverted.
 *
 * @param startTime - inclusive start timestamp (epoch ms).
 * @param endTime - inclusive end timestamp (epoch ms).
 * @returns `endTime - startTime`, never negative.
 */
export function computeDurationMs(startTime: number, endTime: number): number {
  const delta = endTime - startTime;
  return Number.isFinite(delta) && delta >= 0 ? delta : 0;
}

/**
 * Generate a random hexadecimal id of the requested length. Backed by the
 * Node.js crypto random source so ids are suitable for distributed tracing.
 *
 * @param length - desired character length (defaults to the config default).
 * @returns a lowercase hex string of exactly `length` characters.
 */
export function createSpanId(length: number = DEFAULT_TRACE_CONFIG.idLength): string {
  return randomUUID().replace(/-/g, '').slice(0, Math.max(1, length));
}

/**
 * Roll a set of spans up into a {@link Trace} aggregate. The aggregate derives
 * its root span id, name, service, envelope timing and rolled-up status from
 * the supplied spans without mutating them.
 *
 * @param traceId - trace identifier the spans belong to.
 * @param spans - the spans to aggregate.
 * @returns a freshly computed {@link Trace} object.
 */
export function buildTraceAggregate(traceId: string, spans: TraceSpan[]): Trace {
  let rootSpanId = '';
  let name = 'unknown';
  let service: string | undefined;
  let attributes: Record<string, unknown> | undefined;
  let tags: string[] | undefined;
  let startTime = Number.POSITIVE_INFINITY;
  let endTime = Number.NEGATIVE_INFINITY;
  let status: SpanStatus = 'ok';

  for (const span of spans) {
    if (!span.parentId && rootSpanId === '') {
      rootSpanId = span.id;
    }
    if (startTime > span.startTime) {
      startTime = span.startTime;
      if (span.parentId === undefined) {
        name = span.name;
        service = span.service;
        attributes = span.attributes;
        tags = span.tags;
      }
    }
    if (span.endTime !== undefined && endTime < span.endTime) {
      endTime = span.endTime;
    }
    if (span.status === 'error') {
      status = 'error';
    } else if (span.status === 'incomplete' && status !== 'error') {
      status = 'incomplete';
    }
  }

  const hasCompleteWindow = Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime;

  return {
    traceId,
    rootSpanId,
    spans,
    name,
    service,
    startTime,
    endTime: hasCompleteWindow ? endTime : undefined,
    durationMs: hasCompleteWindow ? computeDurationMs(startTime, endTime) : undefined,
    status,
    attributes,
    tags,
    spanCount: spans.length,
  };
}

/**
 * Create an all-zero {@link TraceStats} record. Useful for seeding dashboards
 * before any data has been recorded and as the base object that `TraceStore`
 * increments while scanning its spans.
 *
 * @returns a zeroed stats object with empty service/status maps.
 */
export function createEmptyStats(): TraceStats {
  return {
    totalSpans: 0,
    totalTraces: 0,
    okSpans: 0,
    errorSpans: 0,
    incompleteSpans: 0,
    rootSpans: 0,
    avgDurationMs: 0,
    p50: 0,
    p95: 0,
    p99: 0,
    maxDurationMs: 0,
    minDurationMs: 0,
    services: {},
    byStatus: { ok: 0, error: 0, incomplete: 0 },
    memoryBytesEstimate: 0,
    oldestTraceTimestamp: 0,
    newestTraceTimestamp: 0,
  };
}

/**
 * Merge a partial configuration over the defaults, producing a fully-populated
 * {@link TraceConfig}. Every missing field falls back to its documented
 * default value; unknown fields are ignored.
 *
 * @param overrides - optional partial configuration.
 * @returns a complete, frozen config object.
 */
export function resolveTraceConfig(overrides?: Partial<TraceConfig>): TraceConfig {
  const resolved: TraceConfig = {
    maxSpansPerTrace: overrides?.maxSpansPerTrace ?? DEFAULT_TRACE_CONFIG.maxSpansPerTrace,
    maxAttributesPerSpan: overrides?.maxAttributesPerSpan ?? DEFAULT_TRACE_CONFIG.maxAttributesPerSpan,
    maxTagsPerSpan: overrides?.maxTagsPerSpan ?? DEFAULT_TRACE_CONFIG.maxTagsPerSpan,
    maxTagLength: overrides?.maxTagLength ?? DEFAULT_TRACE_CONFIG.maxTagLength,
    maxAttributeValueLength:
      overrides?.maxAttributeValueLength ?? DEFAULT_TRACE_CONFIG.maxAttributeValueLength,
    idLength: overrides?.idLength ?? DEFAULT_TRACE_CONFIG.idLength,
    pruneIntervalMs: overrides?.pruneIntervalMs ?? DEFAULT_TRACE_CONFIG.pruneIntervalMs,
    defaultRetentionMs: overrides?.defaultRetentionMs ?? DEFAULT_TRACE_CONFIG.defaultRetentionMs,
  };
  return Object.freeze(resolved);
}

/**
 * Bounds-check and normalize a string value so that spans never carry values
 * beyond the configured limits.
 *
 * @param value - raw value.
 * @param maxLength - maximum permitted length.
 * @param fallback - value to return when `value` is empty or not a string.
 * @returns the trimmed, length-bounded string.
 */
export function truncate(value: string, maxLength: number, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/**
 * Humanize an arbitrary value for storage inside a span attribute. Strings are
 * truncated to `maxLength`; other JSON-safe values pass through unchanged;
 * objects are serialised and truncated; unsupported values fall back to their
 * string representation.
 *
 * @param value - attribute value to normalize.
 * @param maxLength - maximum character length for string representations.
 * @returns a JSON-serialisable normalized value.
 */
export function normalizeAttributeValue(value: unknown, maxLength: number): unknown {
  if (typeof value === 'string') {
    return truncate(value, maxLength, '');
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'boolean' || value === null) {
    return value;
  }
  if (typeof value === 'bigint') {
    return truncate(value.toString(), maxLength, '');
  }
  if (typeof value === 'object') {
    try {
      const serialized = JSON.stringify(value);
      return serialized !== undefined ? truncate(serialized, maxLength, '') : '';
    } catch {
      return truncate(String(value), maxLength, '');
    }
  }
  return truncate(String(value), maxLength, '');
}