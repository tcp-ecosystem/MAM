/**
 * @fileoverview
 * Read-oriented query layer over a `TraceStore` and (optionally) a
 * `TraceIndex`.
 *
 * The store answers raw, key-based lookups; `TraceQuery` is the layer that
 * answers the *questions* operators actually ask:
 *
 *  - "Reconstruct the full execution tree for trace X"  -> `getTrace`
 *  - "What happened recently?"                           -> `recent`
 *  - "What did service Y do?"                            -> `byService`
 *  - "What failed?"                                      -> `errors` / `byStatus`
 *  - "What is slow?"                                     -> `slowest`
 *
 * Design notes:
 *
 *  - `getTrace` rebuilds a complete, tree-aware trace from raw spans: it orders
 *    spans by start time, reconnects parent/child relationships, computes the
 *    root, and rolls status/timing up into a fresh {@link Trace} aggregate.
 *    It never mutates store state.
 *  - Where an index is available the query layer routes cross-cutting lookups
 *    through it first and then falls back to linear scans of the store, so the
 *    same query API works whether or not the caller chose to maintain indexes.
 *  - Every `limit` is clamped to a non-negative integer so callers cannot
 *    accidentally request unbounded result sets.
 *  - Results are always returned newest-first / most-relevant-first so that
 *    dashboards can render them without extra sorting.
 */

import type { SpanStatus, Trace, TraceConfig, TraceSpan } from './types.js';
import { buildTraceAggregate, isSpanStatus, resolveTraceConfig } from './types.js';
import type { TraceStore } from './store.js';
import type { TraceIndex } from './index.js';

/**
 * Default result count used when a query method is called without a `limit`.
 */
export const DEFAULT_QUERY_LIMIT = 50;

/**
 * Clamp an arbitrary limit to a non-negative safe integer.
 *
 * @param limit - the requested limit (may be negative / NaN / Infinity).
 * @param fallback - value to use when the input is not usable.
 * @returns a non-negative integer bounded by `Number.MAX_SAFE_INTEGER`.
 */
function normalizeLimit(limit: number, fallback: number): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  const clamped = Math.max(0, Math.floor(limit));
  return Math.min(clamped, Number.MAX_SAFE_INTEGER);
}

/**
 * Compare two spans primarily by start time, then by id for stable ordering.
 *
 * @param a - first span.
 * @param b - second span.
 * @returns a comparator result.
 */
function compareByStart(a: TraceSpan, b: TraceSpan): number {
  if (a.startTime !== b.startTime) {
    return a.startTime < b.startTime ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Options accepted by {@link TraceQuery.getTrace} that control how the full
 * trace view is assembled.
 */
export interface TraceRebuildOptions {
  /**
   * When `true`, the rebuilt trace is enriched with a `spansById` map and a
   * `children` map on the returned object (see {@link TraceTree}).
   */
  buildTree?: boolean;
  /**
   * When `true`, incomplete spans (no `endTime`) are still included in the
   * rebuilt trace. Defaults to `true`; set to `false` to only surface complete
   * spans.
   */
  includeIncomplete?: boolean;
}

/**
 * A tree-enriched view of a trace produced by `getTrace` when `buildTree` is
 * enabled. Extends the flat {@link Trace} aggregate with navigational maps.
 */
export interface TraceTree extends Trace {
  /** Composite `"traceId:spanId"` -> span lookup map. */
  spansById: Map<string, TraceSpan>;
  /** Composite span key -> array of direct child spans. */
  children: Map<string, TraceSpan[]>;
  /** Depth (0-based) of each composite span key in the tree. */
  depth: Map<string, number>;
}

/**
 * The query/read layer of the traces subsystem.
 *
 * `TraceQuery` wraps a {@link TraceStore} and an optional {@link TraceIndex}.
 * It is immutable with respect to the data it queries — all methods are pure
 * reads — and therefore safe to share across consumers.
 */
export class TraceQuery {
  /** The store this query reads from. */
  readonly #store: TraceStore;
  /** Optional secondary index used to accelerate cross-cutting lookups. */
  readonly #index: TraceIndex | undefined;
  /** Effective config. */
  readonly #config: TraceConfig;

  /**
   * Create a query view over a store.
   *
   * @param store - the store to query.
   * @param index - optional index used to accelerate service/status/name finds.
   * @param config - optional partial configuration.
   */
  constructor(store: TraceStore, index?: TraceIndex, config?: Partial<TraceConfig>) {
    this.#store = store;
    this.#index = index;
    this.#config = resolveTraceConfig(config);
  }

  /**
   * The store this query reads from.
   */
  get store(): TraceStore {
    return this.#store;
  }

  /**
   * The effective configuration of this query layer.
   */
  get config(): TraceConfig {
    return this.#config;
  }

  /**
   * Fetch a single span.
   *
   * @param spanId - span id to fetch.
   * @param traceId - optional trace scope for O(1) lookup.
   * @returns the span, or `undefined` when it does not exist.
   */
  getSpan(spanId: string, traceId?: string): TraceSpan | undefined {
    return this.#store.getSpan(spanId, traceId);
  }

  /**
   * Rebuild the full trace for a trace id from its raw spans.
   *
   * The rebuild sorts spans by start time, reconnects parent/child chains,
   * determines the root span, and rolls the span set up into a fresh
   * {@link Trace} aggregate. When `buildTree` is set, the returned value is a
   * {@link TraceTree} with `spansById`, `children` and `depth` navigation maps.
   *
   * @param traceId - the trace id to rebuild.
   * @param options - rebuild controls.
   * @returns the rebuilt trace, or `null` when no spans exist for the id.
   */
  getTrace(traceId: string, options: TraceRebuildOptions = {}): Trace | TraceTree | null {
    const spans = this.#store.getTraceSpans(traceId);
    if (spans.length === 0) {
      return null;
    }
    let ordered = spans.slice().sort(compareByStart);
    if (options.includeIncomplete === false) {
      ordered = ordered.filter((span) => span.endTime !== undefined);
      if (ordered.length === 0) {
        return null;
      }
    }
    const aggregate = buildTraceAggregate(traceId, ordered);
    if (options.buildTree !== true) {
      return aggregate;
    }
    return this.#buildTree(aggregate, ordered);
  }

  /**
   * Assemble the tree navigation maps for a rebuilt trace.
   *
   * @param aggregate - the flat trace aggregate.
   * @param ordered - spans ordered by start time.
   * @returns a {@link TraceTree} enriched with parent/child navigation.
   */
  #buildTree(aggregate: Trace, ordered: TraceSpan[]): TraceTree {
    const spansById = new Map<string, TraceSpan>();
    const children = new Map<string, TraceSpan[]>();
    const depth = new Map<string, number>();
    for (const span of ordered) {
      spansById.set(`${span.traceId}:${span.id}`, span);
    }
    for (const span of ordered) {
      const parentKey = span.parentId !== undefined ? `${span.traceId}:${span.parentId}` : undefined;
      if (parentKey !== undefined && spansById.has(parentKey)) {
        const siblings = children.get(parentKey) ?? [];
        siblings.push(span);
        children.set(parentKey, siblings);
        const parentDepth = depth.get(parentKey) ?? 0;
        depth.set(`${span.traceId}:${span.id}`, parentDepth + 1);
      } else {
        depth.set(`${span.traceId}:${span.id}`, 0);
      }
    }
    for (const span of ordered) {
      const key = `${span.traceId}:${span.id}`;
      const ownDepth = depth.get(key) ?? 0;
      for (const child of children.get(key) ?? []) {
        depth.set(`${child.traceId}:${child.id}`, ownDepth + 1);
      }
    }
    return { ...aggregate, spansById, children, depth };
  }

  /**
   * Return the most recently started traces, newest first.
   *
   * @param limit - maximum number of traces (defaults to `DEFAULT_QUERY_LIMIT`).
   * @returns an array of traces ordered by descending start time.
   */
  recent(limit: number = DEFAULT_QUERY_LIMIT): Trace[] {
    const wanted = normalizeLimit(limit, DEFAULT_QUERY_LIMIT);
    const traces: Trace[] = [];
    for (const trace of this.#store.listTraces({ limit: wanted, sortBy: 'startTime', order: 'desc' })) {
      traces.push(trace);
    }
    return traces;
  }

  /**
   * Return traces whose root span belongs to the given service.
   *
   * When an index is available, candidate traces are discovered through the
   * index's service map; otherwise the store is scanned. Results are ordered by
   * descending start time.
   *
   * @param service - the service name to filter on.
   * @param limit - maximum number of traces.
   * @returns an array of matching traces.
   */
  byService(service: string, limit: number = DEFAULT_QUERY_LIMIT): Trace[] {
    const wanted = normalizeLimit(limit, DEFAULT_QUERY_LIMIT);
    const traceIds = this.#candidateTraceIdsByService(service);
    return this.#tracesFromIds(traceIds, wanted);
  }

  /**
   * Return traces whose rolled-up status equals the requested status.
   *
   * @param status - the status to filter on.
   * @param limit - maximum number of traces.
   * @returns an array of matching traces ordered by descending start time.
   */
  byStatus(status: SpanStatus, limit: number = DEFAULT_QUERY_LIMIT): Trace[] {
    const wanted = normalizeLimit(limit, DEFAULT_QUERY_LIMIT);
    if (!isSpanStatus(status)) {
      return [];
    }
    const traceIds = this.#candidateTraceIdsByStatus(status);
    return this.#tracesFromIds(traceIds, wanted);
  }

  /**
   * Return the slowest completed traces by total duration, slowest first.
   *
   * @param limit - maximum number of traces.
   * @returns an array of traces ordered by descending duration.
   */
  slowest(limit: number = DEFAULT_QUERY_LIMIT): Trace[] {
    const wanted = normalizeLimit(limit, DEFAULT_QUERY_LIMIT);
    const traces: Trace[] = [];
    for (const trace of this.#store.listTraces({ limit: Number.MAX_SAFE_INTEGER, sortBy: 'durationMs', order: 'desc' })) {
      if (trace.durationMs !== undefined) {
        traces.push(trace);
      }
    }
    return traces.slice(0, wanted);
  }

  /**
   * Return traces that contain at least one errored span, newest first.
   *
   * @param limit - maximum number of traces.
   * @returns an array of erroring traces ordered by descending start time.
   */
  errors(limit: number = DEFAULT_QUERY_LIMIT): Trace[] {
    return this.byStatus('error', limit);
  }

  /**
   * Return every span that belongs to the given trace, ordered by start time.
   *
   * @param traceId - the trace id.
   * @returns a chronologically ordered span array (empty when unknown).
   */
  spansForTrace(traceId: string): TraceSpan[] {
    return this.#store.getTraceSpans(traceId).slice().sort(compareByStart);
  }

  /**
   * Search spans by an arbitrary predicate.
   *
   * @param predicate - matcher invoked per span.
   * @param limit - maximum number of spans to return.
   * @returns matching spans ordered by start time.
   */
  search(predicate: (span: TraceSpan) => boolean, limit: number = DEFAULT_QUERY_LIMIT): TraceSpan[] {
    const wanted = normalizeLimit(limit, DEFAULT_QUERY_LIMIT);
    const matches: TraceSpan[] = [];
    this.#store.forEachSpan((span) => {
      if (matches.length >= wanted) {
        return;
      }
      if (predicate(span)) {
        matches.push(span);
      }
    });
    return matches.sort(compareByStart);
  }

  /**
   * Discover candidate trace ids that contain a span from a service. Uses the
   * index when available, else scans the store.
   *
   * @param service - the service name.
   * @returns a deduplicated array of trace ids.
   */
  #candidateTraceIdsByService(service: string): string[] {
    const ids = new Set<string>();
    if (this.#index !== undefined) {
      for (const span of this.#index.findByService(service)) {
        ids.add(span.traceId);
      }
      return Array.from(ids);
    }
    this.#store.forEachSpan((span) => {
      if (span.service === service) {
        ids.add(span.traceId);
      }
    });
    return Array.from(ids);
  }

  /**
   * Discover candidate trace ids that contain a span with the given status.
   *
   * @param status - the status to match.
   * @returns a deduplicated array of trace ids.
   */
  #candidateTraceIdsByStatus(status: SpanStatus): string[] {
    const ids = new Set<string>();
    if (this.#index !== undefined) {
      for (const span of this.#index.findByStatus(status)) {
        ids.add(span.traceId);
      }
      return Array.from(ids);
    }
    this.#store.forEachSpan((span) => {
      if (span.status === status) {
        ids.add(span.traceId);
      }
    });
    return Array.from(ids);
  }

  /**
   * Convert a set of candidate trace ids into trace aggregates ordered by
   * descending start time, bounded by `limit`.
   *
   * @param traceIds - candidate trace ids.
   * @param limit - maximum number of traces to return.
   * @returns an ordered array of trace aggregates.
   */
  #tracesFromIds(traceIds: string[], limit: number): Trace[] {
    const result: Trace[] = [];
    for (const traceId of traceIds) {
      const trace = this.#store.getTrace(traceId);
      if (trace !== undefined) {
        result.push(trace);
      }
    }
    result.sort((a, b) => b.startTime - a.startTime);
    return result.slice(0, limit);
  }

  /**
   * Convenience: compute the number of spans per trace id.
   *
   * @returns a map of trace id to span count for every trace in the store.
   */
  spanCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    this.#store.forEachSpan((span) => {
      counts.set(span.traceId, (counts.get(span.traceId) ?? 0) + 1);
    });
    return counts;
  }

  /**
   * Produce a human-readable summary of a rebuilt trace for logging and
   * debugging.
   *
   * @param traceId - the trace id.
   * @returns a one-line summary string, or `"<unknown trace>"` when absent.
   */
  describe(traceId: string): string {
    const trace = this.getTrace(traceId);
    if (trace === null) {
      return `<unknown trace ${traceId}>`;
    }
    const completed = trace.spans.filter((s) => s.endTime !== undefined).length;
    const errors = trace.spans.filter((s) => s.status === 'error').length;
    return (
      `trace=${trace.traceId} name=${trace.name} status=${trace.status} ` +
      `spans=${trace.spanCount} completed=${completed} errors=${errors} ` +
      `duration=${trace.durationMs !== undefined ? `${trace.durationMs}ms` : 'n/a'}`
    );
  }
}