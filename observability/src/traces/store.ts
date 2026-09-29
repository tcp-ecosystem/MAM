/**
 * @fileoverview
 * In-memory storage engine for the MAM Observability Traces layer.
 *
 * `TraceStore` owns the canonical copy of every recorded span and trace. It is
 * a single-writer, single-reader structure backed by plain `Map`s so that
 * lookups are O(1) and iteration order is insertion order. All mutation goes
 * through `recordSpan` / `recordTrace`, which enforce the bounds described by
 * {@link TraceConfig} (max spans per trace, attribute/tag caps) and keep the
 * derived trace aggregates in sync with the raw span sets.
 *
 * Design notes:
 *
 *  - Spans are stored in a two-level map keyed by `traceId -> spanId`, which
 *    makes "give me every span for this trace" a single map lookup plus an
 *    `Array.from`.
 *  - Trace aggregates are recomputed lazily on first read when a span was
 *    recorded directly (bypassing the aggregate), and eagerly for aggregate
 *    reads so that `getTrace` always reflects the latest span set.
 *  - `toJSON` / `fromJSON` provide a versioned, lossless serialization format
 *    used for persistence, hot backup and tests.
 *  - Statistics are computed with a single linear scan (`stats()`), which is
 *    the correct trade-off for an in-memory observability buffer.
 *
 * The store deliberately does NOT prune old data; retention is the job of
 * `TraceLifecycle` so that the store can remain a dumb, predictable container.
 */

import type { SpanOptions, TraceConfig, TraceEvent, TraceSpan, TraceStats } from './types.js';
import {
  buildTraceAggregate,
  computeDurationMs,
  createEmptyStats,
  createSpanId,
  isSpanStatus,
  normalizeAttributeValue,
  resolveTraceConfig,
  truncate,
} from './types.js';
import type { Trace } from './types.js';
import type { SerializedTraceStore } from './types.js';

/**
 * Sorting modes supported by {@link TraceStore.listTraces}.
 */
export type TraceListSort = 'startTime' | 'endTime' | 'durationMs' | 'spanCount' | 'name';

/**
 * Filtering / pagination options for {@link TraceStore.listTraces} and
 * {@link TraceStore.listSpans}.
 */
export interface ListOptions {
  /** Maximum number of entries to return. */
  limit?: number;
  /** Number of entries to skip before collecting results. */
  offset?: number;
  /** Field used to order results. Defaults to `startTime`. */
  sortBy?: TraceListSort;
  /** Direction of the sort. Defaults to `desc`. */
  order?: 'asc' | 'desc';
}

/**
 * The default maximum number of entries returned by list methods when no
 * `limit` is supplied.
 */
export const DEFAULT_LIST_LIMIT = 100;

/**
 * Sentinel used internally when a looked-up span does not exist. Kept private
 * so callers cannot confuse it with a real span id.
 */
const MISSING = '__mam_trace_missing__';

/**
 * Structural overhead (in bytes) attributed to each stored span when producing
 * the `memoryBytesEstimate` statistic. A rough constant; good enough for
 * capacity planning and health dashboards.
 */
const BYTES_PER_SPAN = 512;

/**
 * A fully owned, in-memory collection of spans and trace aggregates.
 *
 * `TraceStore` is the persistence layer of the traces subsystem. It accepts
 * spans recorded by a `Tracer`, keeps per-trace aggregates coherent, exposes
 * typed query helpers, and can be serialized to plain JSON for backup or
 * transfer between processes.
 */
export class TraceStore {
  /** Span storage: `traceId -> spanId -> span`. */
  readonly #spansByTrace: Map<string, Map<string, TraceSpan>>;
  /** Derived trace aggregates keyed by trace id. */
  readonly #traces: Map<string, Trace>;
  /** Trace ids in insertion order (used by listTraces / recent). */
  readonly #order: string[];
  /** Effective configuration for this store instance. */
  readonly #config: TraceConfig;

  /**
   * Create a store.
   *
   * @param config - optional partial configuration; merged over the defaults.
   */
  constructor(config?: Partial<TraceConfig>) {
    this.#spansByTrace = new Map<string, Map<string, TraceSpan>>();
    this.#traces = new Map<string, Trace>();
    this.#order = [];
    this.#config = resolveTraceConfig(config);
  }

  /**
   * The effective configuration applied to this store.
   */
  get config(): TraceConfig {
    return this.#config;
  }

  /**
   * Number of traces currently stored. Counted from the span-bucket map, which
   * is kept in sync on every mutation, so the value is accurate even before a
   * trace aggregate has been lazily materialized by `getTrace`.
   */
  get size(): number {
    return this.#spansByTrace.size;
  }

  /**
   * Total number of spans currently stored across all traces.
   */
  get spanCount(): number {
    let total = 0;
    for (const spans of this.#spansByTrace.values()) {
      total += spans.size;
    }
    return total;
  }

  /**
   * Whether a trace with the given id exists.
   *
   * @param traceId - trace id to look up.
   * @returns `true` when the trace is present.
   */
  hasTrace(traceId: string): boolean {
    return this.#traces.has(traceId);
  }

  /**
   * Whether a span with the given id exists. When `traceId` is supplied the
   * check is scoped to that trace; otherwise every trace is scanned.
   *
   * @param spanId - span id to look up.
   * @param traceId - optional scope; skips a scan when provided.
   * @returns `true` when the span is present.
   */
  hasSpan(spanId: string, traceId?: string): boolean {
    if (traceId !== undefined) {
      const bucket = this.#spansByTrace.get(traceId);
      return bucket !== undefined && bucket.has(spanId);
    }
    for (const bucket of this.#spansByTrace.values()) {
      if (bucket.has(spanId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Every trace id currently held by the store.
   *
   * @returns an array of trace ids in insertion order.
   */
  keys(): string[] {
    return Array.from(this.#order);
  }

  /**
   * Every `"traceId:spanId"` composite key currently held by the store.
   *
   * @returns an array of composite keys in insertion order.
   */
  spanKeys(): string[] {
    const keys: string[] = [];
    for (const [traceId, bucket] of this.#spansByTrace) {
      for (const spanId of bucket.keys()) {
        keys.push(`${traceId}:${spanId}`);
      }
    }
    return keys;
  }

  /**
   * Look up a single span. Scoped to `traceId` when provided for O(1) access.
   *
   * @param spanId - span id to fetch.
   * @param traceId - optional trace scope.
   * @returns the span, or `undefined` when it does not exist.
   */
  getSpan(spanId: string, traceId?: string): TraceSpan | undefined {
    if (traceId !== undefined) {
      return this.#spansByTrace.get(traceId)?.get(spanId);
    }
    for (const bucket of this.#spansByTrace.values()) {
      const found = bucket.get(spanId);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }

  /**
   * Every span belonging to one trace.
   *
   * @param traceId - trace id to fetch spans for.
   * @returns the span array, or an empty array when the trace is unknown.
   */
  getTraceSpans(traceId: string): TraceSpan[] {
    const bucket = this.#spansByTrace.get(traceId);
    return bucket === undefined ? [] : Array.from(bucket.values());
  }

  /**
   * Look up a trace aggregate. When the aggregate is missing or stale the
   * value is rebuilt from the raw span set before returning.
   *
   * @param traceId - trace id to fetch.
   * @returns the trace, or `undefined` when no spans exist for the id.
   */
  getTrace(traceId: string): Trace | undefined {
    const cached = this.#traces.get(traceId);
    if (cached !== undefined) {
      return cached;
    }
    const spans = this.getTraceSpans(traceId);
    if (spans.length === 0) {
      return undefined;
    }
    const aggregate = buildTraceAggregate(traceId, spans);
    this.#traces.set(traceId, aggregate);
    return aggregate;
  }

  /**
   * Normalize an arbitrary incoming span, applying config bounds. Produces a
   * fresh object so callers can never mutate store-held state through aliasing.
   *
   * @param span - raw span to normalize.
   * @returns a cleaned, complete span ready for storage.
   */
  #normalizeSpan(span: TraceSpan): TraceSpan {
    const attributes = this.#normalizeAttributes(span.attributes);
    const tags = this.#normalizeTags(span.tags);
    const endTime =
      typeof span.endTime === 'number' && Number.isFinite(span.endTime) ? span.endTime : undefined;
    const durationMs =
      endTime !== undefined ? computeDurationMs(span.startTime, endTime) : span.durationMs;
    return {
      id: truncate(span.id, this.#config.idLength * 4, createSpanId(this.#config.idLength)),
      traceId: truncate(span.traceId, this.#config.idLength * 4, createSpanId(this.#config.idLength)),
      parentId: span.parentId === undefined ? undefined : truncate(span.parentId, this.#config.idLength * 4, ''),
      name: truncate(span.name, 512, 'unnamed'),
      status: isSpanStatus(span.status) ? span.status : 'incomplete',
      startTime: Number.isFinite(span.startTime) ? span.startTime : Date.now(),
      endTime,
      durationMs,
      attributes,
      service: span.service === undefined ? undefined : truncate(span.service, 128, 'unknown'),
      tags,
    };
  }

  /**
   * Apply the attribute map bound to an attribute record.
   *
   * @param attributes - raw attribute record.
   * @returns a bounded copy, or `undefined` when the input was empty.
   */
  #normalizeAttributes(attributes?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (attributes === undefined) {
      return undefined;
    }
    const bounded: Record<string, unknown> = {};
    let count = 0;
    for (const [key, value] of Object.entries(attributes)) {
      if (count >= this.#config.maxAttributesPerSpan) {
        break;
      }
      bounded[truncate(key, 128, '')] = normalizeAttributeValue(value, this.#config.maxAttributeValueLength);
      count += 1;
    }
    return count === 0 ? undefined : bounded;
  }

  /**
   * Apply the tag array bound to a tag list.
   *
   * @param tags - raw tag array.
   * @returns a bounded copy, or `undefined` when the input was empty.
   */
  #normalizeTags(tags?: string[]): string[] | undefined {
    if (tags === undefined || tags.length === 0) {
      return undefined;
    }
    const bounded: string[] = [];
    for (let i = 0; i < tags.length && bounded.length < this.#config.maxTagsPerSpan; i += 1) {
      const tag = truncate(tags[i] ?? '', this.#config.maxTagLength, '');
      if (tag.length > 0 && !bounded.includes(tag)) {
        bounded.push(tag);
      }
    }
    return bounded.length === 0 ? undefined : bounded;
  }

  /**
   * Record a single span. Enforces the per-trace span cap, updates (or creates)
   * the containing trace aggregate, and returns the stored normalized copy.
   *
   * @param span - the span to record.
   * @returns the normalized stored span, or `undefined` when the trace exceeded
   * `maxSpansPerTrace` and the span was dropped.
   */
  recordSpan(span: TraceSpan): TraceSpan | undefined {
    if (!span || typeof span.traceId !== 'string' || typeof span.id !== 'string') {
      return undefined;
    }
    const normalized = this.#normalizeSpan(span);
    let bucket = this.#spansByTrace.get(normalized.traceId);
    if (bucket === undefined) {
      bucket = new Map<string, TraceSpan>();
      this.#spansByTrace.set(normalized.traceId, bucket);
      this.#order.push(normalized.traceId);
    }
    if (bucket.has(normalized.id)) {
      bucket.set(normalized.id, normalized);
    } else if (bucket.size >= this.#config.maxSpansPerTrace) {
      return undefined;
    } else {
      bucket.set(normalized.id, normalized);
    }
    this.#traces.delete(normalized.traceId);
    return normalized;
  }

  /**
   * Record an already-aggregated trace. All of its spans are written to the
   * span tables and the aggregate is refreshed to reflect the incoming spans.
   *
   * @param trace - the trace aggregate to record.
   * @returns the stored aggregate.
   */
  recordTrace(trace: Trace): Trace {
    if (!this.#spansByTrace.has(trace.traceId)) {
      this.#order.push(trace.traceId);
      this.#spansByTrace.set(trace.traceId, new Map<string, TraceSpan>());
    }
    const bucket = this.#spansByTrace.get(trace.traceId)!;
    for (const span of trace.spans) {
      const normalized = this.#normalizeSpan(span);
      if (bucket.has(normalized.id) || bucket.size < this.#config.maxSpansPerTrace) {
        bucket.set(normalized.id, normalized);
      }
    }
    const aggregate = buildTraceAggregate(trace.traceId, Array.from(bucket.values()));
    this.#traces.set(trace.traceId, aggregate);
    return aggregate;
  }

  /**
   * Convenience method that builds a span from {@link SpanOptions} and records
   * it in one call. The span id defaults to a freshly generated id.
   *
   * @param traceId - trace the span belongs to.
   * @param name - operation name for the span.
   * @param options - optional span attributes / parent / timing.
   * @returns the recorded span, or `undefined` if it was dropped by the cap.
   */
  startSpan(traceId: string, name: string, options: SpanOptions = {}): TraceSpan | undefined {
    const id = createSpanId(this.#config.idLength);
    const startTime = options.startTime ?? Date.now();
    const endTime = options.endTime;
    const span: TraceSpan = {
      id,
      traceId,
      parentId: options.parentId,
      name,
      status: isSpanStatus(options.status)
        ? options.status
        : endTime !== undefined
          ? 'ok'
          : 'incomplete',
      startTime,
      endTime,
      durationMs:
        endTime !== undefined ? computeDurationMs(startTime, endTime) : options.durationMs,
      attributes: options.attributes,
      service: options.service,
      tags: options.tags,
    };
    return this.recordSpan(span);
  }

  /**
   * Mark a previously recorded span as complete, updating its `endTime`,
   * `durationMs` and status in place.
   *
   * @param spanId - id of the span to complete.
   * @param options - completion details (endTime, status).
   * @returns the updated span, or `undefined` when the span was not found.
   */
  completeSpan(
    spanId: string,
    options: { endTime?: number; status?: 'ok' | 'error' } = {},
  ): TraceSpan | undefined {
    const existing = this.getSpan(spanId);
    if (existing === undefined) {
      return undefined;
    }
    const endTime = options.endTime ?? Date.now();
    const updated: TraceSpan = {
      ...existing,
      endTime,
      durationMs: computeDurationMs(existing.startTime, endTime),
      status: options.status ?? 'ok',
    };
    return this.recordSpan(updated);
  }

  /**
   * Remove one span. When it is the last span of its trace the trace and its
   * order slot are removed too.
   *
   * @param spanId - span id to remove.
   * @param traceId - optional trace scope for O(1) lookup.
   * @returns `true` when a span was removed.
   */
  deleteSpan(spanId: string, traceId?: string): boolean {
    const found = this.getSpan(spanId, traceId);
    if (found === undefined) {
      return false;
    }
    const bucket = this.#spansByTrace.get(found.traceId);
    bucket?.delete(spanId);
    if (bucket !== undefined && bucket.size === 0) {
      this.#spansByTrace.delete(found.traceId);
      this.#traces.delete(found.traceId);
      const index = this.#order.indexOf(found.traceId);
      if (index >= 0) {
        this.#order.splice(index, 1);
      }
    } else {
      this.#traces.delete(found.traceId);
    }
    return true;
  }

  /**
   * Remove an entire trace and every span it contains.
   *
   * @param traceId - trace id to remove.
   * @returns `true` when a trace was removed.
   */
  deleteTrace(traceId: string): boolean {
    if (!this.#spansByTrace.delete(traceId)) {
      return false;
    }
    this.#traces.delete(traceId);
    const index = this.#order.indexOf(traceId);
    if (index >= 0) {
      this.#order.splice(index, 1);
    }
    return true;
  }

  /**
   * Remove every span and trace in the store.
   *
   * @returns the number of traces removed.
   */
  clear(): number {
    const removed = this.#spansByTrace.size;
    this.#spansByTrace.clear();
    this.#traces.clear();
    this.#order.length = 0;
    return removed;
  }

  /**
   * List trace aggregates with optional sorting and pagination.
   *
   * @param options - limit / offset / sort controls.
   * @returns an array of traces matching the criteria.
   */
  listTraces(options: ListOptions = {}): Trace[] {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options.offset ?? 0;
    const sortBy = options.sortBy ?? 'startTime';
    const order = options.order ?? 'desc';
    let traces = this.#order.map((id) => this.getTrace(id)).filter((t): t is Trace => t !== undefined);
    traces = traces.sort((a, b) => this.#compare(a, b, sortBy));
    if (order === 'desc') {
      traces = traces.reverse();
    }
    return traces.slice(offset, offset + limit);
  }

  /**
   * List spans with optional per-trace filtering and pagination.
   *
   * @param options - limit / offset / sort controls plus an optional trace scope.
   * @returns an array of spans matching the criteria.
   */
  listSpans(options: ListOptions & { traceId?: string } = {}): TraceSpan[] {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const offset = options.offset ?? 0;
    const sortBy = options.sortBy ?? 'startTime';
    const order = options.order ?? 'desc';
    let spans: TraceSpan[] = [];
    if (options.traceId !== undefined) {
      spans = this.getTraceSpans(options.traceId);
    } else {
      for (const bucket of this.#spansByTrace.values()) {
        spans = spans.concat(Array.from(bucket.values()));
      }
    }
    spans = spans.sort((a, b) => {
      const av = a[sortBy] ?? 0;
      const bv = b[sortBy] ?? 0;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    if (order === 'desc') {
      spans = spans.reverse();
    }
    return spans.slice(offset, offset + limit);
  }

  /**
   * Compare two traces by a sortable field.
   *
   * @param a - first trace.
   * @param b - second trace.
   * @param sortBy - the field to compare.
   * @returns a sort comparator result.
   */
  #compare(a: Trace, b: Trace, sortBy: TraceListSort): number {
    if (sortBy === 'name') {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    }
    const av = a[sortBy] ?? 0;
    const bv = b[sortBy] ?? 0;
    return av < bv ? -1 : av > bv ? 1 : 0;
  }

  /**
   * Compute aggregate statistics over every stored span. The scan is linear in
   * the number of spans; percentile values are approximated using the
   * nearest-rank method over the sorted duration list.
   *
   * @returns a populated {@link TraceStats} object.
   */
  stats(): TraceStats {
    const stats = createEmptyStats();
    stats.totalTraces = this.#spansByTrace.size;
    const durations: number[] = [];
    let durationSum = 0;
    for (const bucket of this.#spansByTrace.values()) {
      for (const span of bucket.values()) {
        stats.totalSpans += 1;
        stats.byStatus[span.status] = (stats.byStatus[span.status] ?? 0) + 1;
        if (span.status === 'ok') {
          stats.okSpans += 1;
        } else if (span.status === 'error') {
          stats.errorSpans += 1;
        } else {
          stats.incompleteSpans += 1;
        }
        if (span.parentId === undefined) {
          stats.rootSpans += 1;
        }
        if (span.service !== undefined) {
          stats.services[span.service] = (stats.services[span.service] ?? 0) + 1;
        }
        if (stats.oldestTraceTimestamp === 0 || span.startTime < stats.oldestTraceTimestamp) {
          stats.oldestTraceTimestamp = span.startTime;
        }
        if (span.startTime > stats.newestTraceTimestamp) {
          stats.newestTraceTimestamp = span.startTime;
        }
        if (span.durationMs !== undefined) {
          durations.push(span.durationMs);
          durationSum += span.durationMs;
        }
      }
    }
    if (durations.length > 0) {
      durations.sort((a, b) => a - b);
      stats.avgDurationMs = durationSum / durations.length;
      stats.minDurationMs = durations[0] ?? 0;
      stats.maxDurationMs = durations[durations.length - 1] ?? 0;
      stats.p50 = this.#percentile(durations, 0.5);
      stats.p95 = this.#percentile(durations, 0.95);
      stats.p99 = this.#percentile(durations, 0.99);
    }
    stats.memoryBytesEstimate = stats.totalSpans * BYTES_PER_SPAN;
    return stats;
  }

  /**
   * Nearest-rank percentile over a sorted ascending duration array.
   *
   * @param sorted - ascending-sorted durations.
   * @param q - quantile between 0 and 1.
   * @returns the value at the requested percentile.
   */
  #percentile(sorted: number[], q: number): number {
    if (sorted.length === 0) {
      return 0;
    }
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[index] ?? 0;
  }

  /**
   * Serialize the full store contents to a versioned JSON structure.
   *
   * @returns a {@link SerializedTraceStore} snapshot of all spans and traces.
   */
  toJSON(): SerializedTraceStore {
    const spans: TraceSpan[] = [];
    for (const bucket of this.#spansByTrace.values()) {
      for (const span of bucket.values()) {
        spans.push(span);
      }
    }
    const traces: Trace[] = [];
    for (const id of this.#order) {
      const trace = this.getTrace(id);
      if (trace !== undefined) {
        traces.push(trace);
      }
    }
    return {
      version: 1,
      exportedAt: Date.now(),
      spans,
      traces,
    };
  }

  /**
   * Restore store contents from a {@link SerializedTraceStore} produced by
   * `toJSON()`. Existing contents are replaced, not merged.
   *
   * @param data - the serialized snapshot to import.
   * @throws when `data` has an unsupported version.
   */
  fromJSON(data: SerializedTraceStore): void {
    if (typeof data !== 'object' || data === null || data.version !== 1) {
      throw new Error(`Unsupported serialized store version: ${String((data as { version?: unknown })?.version)}`);
    }
    this.#spansByTrace.clear();
    this.#traces.clear();
    this.#order.length = 0;
    for (const span of data.spans) {
      const bucket = this.#spansByTrace.get(span.traceId) ?? new Map<string, TraceSpan>();
      bucket.set(span.id, span);
      this.#spansByTrace.set(span.traceId, bucket);
    }
    for (const id of this.#spansByTrace.keys()) {
      if (!this.#order.includes(id)) {
        this.#order.push(id);
      }
    }
    for (const trace of data.traces) {
      this.#traces.set(trace.traceId, trace);
    }
  }

  /**
   * Iterate over every span in insertion order. Useful for feeding an index or
   * a prune pass without building intermediate arrays.
   *
   * @param visit - callback invoked once per span.
   */
  forEachSpan(visit: (span: TraceSpan) => void): void {
    for (const bucket of this.#spansByTrace.values()) {
      for (const span of bucket.values()) {
        visit(span);
      }
    }
  }

  /**
   * Remove spans older than a cutoff from the store, skipping traces that are
   * still considered in-flight (no endTime on any span is NOT sufficient —
   * traces with at least one completed span older than the cutoff are pruned).
   *
   * This is the primitive used by `TraceLifecycle.prune`. Returns the number of
   * spans removed so callers can build richer {@link PruneResult} objects.
   *
   * @param cutoff - epoch ms; spans/traces strictly older are removed.
   * @returns the number of spans removed.
   */
  pruneOlderThan(cutoff: number): number {
    const doomed: string[] = [];
    for (const [traceId, bucket] of this.#spansByTrace) {
      let traceStart = Number.POSITIVE_INFINITY;
      for (const span of bucket.values()) {
        if (span.startTime < traceStart) {
          traceStart = span.startTime;
        }
      }
      if (Number.isFinite(traceStart) && traceStart < cutoff) {
        doomed.push(traceId);
      }
    }
    let removed = 0;
    for (const traceId of doomed) {
      removed += this.#spansByTrace.get(traceId)?.size ?? 0;
      this.deleteTrace(traceId);
    }
    return removed;
  }
}