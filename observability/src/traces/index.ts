/**
 * @fileoverview
 * Secondary indexes over the spans held by a `TraceStore`.
 *
 * While `TraceStore` answers "what spans belong to trace X" in O(1), many
 * observability queries are cross-cutting: "which spans were recorded by the
 * auth service?", "which spans errored in the last hour?", "which operations
 * are named `sql.query`?". `TraceIndex` answers exactly those questions by
 * maintaining inverted maps keyed by trace id, service, name and status.
 *
 * Design notes:
 *
 *  - Every index maps a key to a `Set` of composite span keys of the form
 *    `"traceId:spanId"`. Composite keys avoid id collisions across traces and
 *    allow O(1) removal.
 *  - The index is an *observer* of the store: it is fed spans via
 *    `indexSpan` / `indexTrace` and kept coherent by callers (typically the
 *    `TraceAdapter`, or `TraceLifecycle` during prune). It also supports a
 *    one-shot `rebuild(store)` that re-synchronizes with a store's contents.
 *  - Lookups return `TraceSpan` objects by resolving composite keys against
 *    the source store, so the index never duplicates span payloads (which
 *    keeps memory bounded) — it only stores the keys.
 *  - `removeSpan` / `removeTrace` remove a span/trace from every inverted map
 *    at once, so pruning stays efficient.
 */

import type { SpanStatus, TraceConfig, TraceSpan } from './types.js';
import { isSpanStatus, resolveTraceConfig } from './types.js';
import type { Trace } from './types.js';
import type { TraceStore } from './store.js';

/**
 * The maximum number of results returned by index lookup methods when the
 * caller does not supply an explicit limit.
 */
export const DEFAULT_INDEX_LIMIT = 1000;

/**
 * A span entry retained by the index. Resolution against the source store is
 * deferred so that the index only stores lightweight composite keys.
 */
interface IndexedSpan {
  /** Composite key `"traceId:spanId"`. */
  key: string;
  /** Trace id the span belongs to. */
  traceId: string;
  /** Span id. */
  spanId: string;
}

/**
 * Per-field index statistics surfaced by `TraceIndex.stats()`.
 */
export interface TraceIndexStats {
  /** Number of spans currently indexed. */
  indexedSpans: number;
  /** Number of distinct traces represented in the index. */
  indexedTraces: number;
  /** Number of distinct service names indexed. */
  serviceCount: number;
  /** Number of distinct operation names indexed. */
  nameCount: number;
  /** Per-status span counts for the indexed set. */
  byStatus: Record<SpanStatus, number>;
  /** Number of spans indexed as roots (no parent). */
  rootSpans: number;
  /** Total number of inverted-map entries across all dimensions. */
  totalIndexEntries: number;
  /** Whether the index is currently out of sync with its source store. */
  dirty: boolean;
  /** Epoch ms of the most recent index mutation. */
  lastIndexedAt: number;
}

/**
 * A multi-dimensional inverted index over spans.
 *
 * `TraceIndex` sits beside a {@link TraceStore} and accelerates the
 * service/status/name/trace queries that the retrieval layer relies on. It is
 * write-friendly (O(1) per indexed span) and keeps only composite keys, not
 * span payloads, so its memory footprint stays small relative to the store.
 */
export class TraceIndex {
  /** Composite key -> span metadata. */
  readonly #entries: Map<string, IndexedSpan>;
  /** traceId -> set of composite keys. */
  readonly #byTraceId: Map<string, Set<string>>;
  /** service -> set of composite keys. */
  readonly #byService: Map<string, Set<string>>;
  /** operation name -> set of composite keys. */
  readonly #byName: Map<string, Set<string>>;
  /** status -> set of composite keys. */
  readonly #byStatus: Map<SpanStatus, Set<string>>;
  /** The store this index resolves span payloads against. */
  readonly #store: TraceStore;
  /** Effective config (used for nothing yet but kept for symmetry/extension). */
  readonly #config: TraceConfig;
  /** Epoch ms of the most recent mutation. */
  #lastIndexedAt: number;
  /** Set to `true` when the index believes it may be missing store writes. */
  #dirty: boolean;

  /**
   * Create an index bound to a store.
   *
   * @param store - the store to resolve indexed span payloads from.
   * @param config - optional partial configuration.
   */
  constructor(store: TraceStore, config?: Partial<TraceConfig>) {
    this.#entries = new Map<string, IndexedSpan>();
    this.#byTraceId = new Map<string, Set<string>>();
    this.#byService = new Map<string, Set<string>>();
    this.#byName = new Map<string, Set<string>>();
    this.#byStatus = new Map<SpanStatus, Set<string>>();
    this.#store = store;
    this.#config = resolveTraceConfig(config);
    this.#lastIndexedAt = 0;
    this.#dirty = true;
  }

  /**
   * The effective configuration of this index.
   */
  get config(): TraceConfig {
    return this.#config;
  }

  /**
   * Number of spans currently indexed.
   */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * Whether the index has pending work (spans recorded to the store since the
   * last index mutation). Rebuilding or indexing resets the flag.
   */
  get dirty(): boolean {
    return this.#dirty;
  }

  /**
   * Build the composite key for a span.
   *
   * @param traceId - trace id.
   * @param spanId - span id.
   * @returns `"traceId:spanId"`.
   */
  #key(traceId: string, spanId: string): string {
    return `${traceId}:${spanId}`;
  }

  /**
   * Add a span to one inverted map under a key.
   *
   * @param map - the inverted map to mutate.
   * @param key - the primary key (service name, status, ...).
   * @param composite - the composite span key to add.
   */
  #addToMap(map: Map<string, Set<string>>, key: string, composite: string): void {
    let bucket = map.get(key);
    if (bucket === undefined) {
      bucket = new Set<string>();
      map.set(key, bucket);
    }
    bucket.add(composite);
  }

  /**
   * Remove a composite span key from one inverted map.
   *
   * @param map - the inverted map to mutate.
   * @param key - the primary key the span was stored under.
   * @param composite - the composite span key to remove.
   */
  #removeFromMap(map: Map<string, Set<string>>, key: string, composite: string): void {
    const bucket = map.get(key);
    if (bucket === undefined) {
      return;
    }
    bucket.delete(composite);
    if (bucket.size === 0) {
      map.delete(key);
    }
  }

  /**
   * Index a single span across every dimension. Idempotent: re-indexing a span
   * that is already present refreshes its entries in place.
   *
   * @param span - the span to index.
   * @returns `true` when the span was newly added, `false` when it was already
   * indexed (and merely refreshed).
   */
  indexSpan(span: TraceSpan): boolean {
    if (!span || typeof span.traceId !== 'string' || typeof span.id !== 'string') {
      return false;
    }
    const composite = this.#key(span.traceId, span.id);
    const status = isSpanStatus(span.status) ? span.status : 'incomplete';
    const existed = this.#entries.has(composite);
    this.#entries.set(composite, { key: composite, traceId: span.traceId, spanId: span.id });
    this.#addToMap(this.#byTraceId, span.traceId, composite);
    this.#addToMap(this.#byStatus, status, composite);
    if (span.service !== undefined) {
      this.#addToMap(this.#byService, span.service, composite);
    }
    if (span.name.length > 0) {
      this.#addToMap(this.#byName, span.name, composite);
    }
    this.#lastIndexedAt = Date.now();
    this.#dirty = false;
    return !existed;
  }

  /**
   * Index every span of a trace aggregate in one call.
   *
   * @param trace - the trace whose spans should be indexed.
   * @returns the number of spans newly added to the index.
   */
  indexTrace(trace: Trace): number {
    let added = 0;
    for (const span of trace.spans) {
      if (this.indexSpan(span)) {
        added += 1;
      }
    }
    return added;
  }

  /**
   * Remove a span from every index dimension.
   *
   * @param spanId - span id to remove.
   * @param traceId - trace id the span belongs to (required for O(1) removal).
   * @returns `true` when a span was removed.
   */
  removeSpan(spanId: string, traceId: string): boolean {
    const composite = this.#key(traceId, spanId);
    const entry = this.#entries.get(composite);
    if (entry === undefined) {
      return false;
    }
    const span = this.#store.getSpan(spanId, traceId);
    const status = span !== undefined && isSpanStatus(span.status) ? span.status : 'incomplete';
    this.#entries.delete(composite);
    this.#removeFromMap(this.#byTraceId, traceId, composite);
    this.#removeFromMap(this.#byStatus, status, composite);
    if (span?.service !== undefined) {
      this.#removeFromMap(this.#byService, span.service, composite);
    }
    if (span?.name !== undefined && span.name.length > 0) {
      this.#removeFromMap(this.#byName, span.name, composite);
    }
    if (this.#byTraceId.get(traceId) === undefined || this.#byTraceId.get(traceId)?.size === 0) {
      this.#byTraceId.delete(traceId);
    }
    this.#lastIndexedAt = Date.now();
    return true;
  }

  /**
   * Remove every span belonging to a trace from the index.
   *
   * @param traceId - trace id to remove.
   * @returns the number of spans removed.
   */
  removeTrace(traceId: string): number {
    const composites = Array.from(this.#byTraceId.get(traceId) ?? []);
    let removed = 0;
    for (const composite of composites) {
      const entry = this.#entries.get(composite);
      if (entry !== undefined) {
        this.removeSpan(entry.spanId, entry.traceId);
        removed += 1;
      }
    }
    this.#byTraceId.delete(traceId);
    this.#lastIndexedAt = Date.now();
    return removed;
  }

  /**
   * Whether the index contains a given span.
   *
   * @param spanId - span id.
   * @param traceId - trace id (required).
   * @returns `true` when the span is indexed.
   */
  has(spanId: string, traceId: string): boolean {
    return this.#entries.has(this.#key(traceId, spanId));
  }

  /**
   * Resolve a composite key back to a span payload from the source store.
   *
   * @param composite - `"traceId:spanId"` key.
   * @returns the span, or `undefined` when the store no longer holds it.
   */
  #resolve(composite: string): TraceSpan | undefined {
    const entry = this.#entries.get(composite);
    if (entry === undefined) {
      return undefined;
    }
    return this.#store.getSpan(entry.spanId, entry.traceId);
  }

  /**
   * Fetch the span with the given id, if indexed.
   *
   * @param spanId - span id.
   * @param traceId - trace id.
   * @returns the span payload or `undefined`.
   */
  getSpan(spanId: string, traceId: string): TraceSpan | undefined {
    return this.#resolve(this.#key(traceId, spanId));
  }

  /**
   * Every indexed span that belongs to a trace, in index insertion order.
   *
   * @param traceId - trace id to search.
   * @returns an array of spans (empty when none are indexed).
   */
  findByTraceId(traceId: string): TraceSpan[] {
    const composites = Array.from(this.#byTraceId.get(traceId) ?? []);
    const result: TraceSpan[] = [];
    for (const composite of composites) {
      const span = this.#resolve(composite);
      if (span !== undefined) {
        result.push(span);
      }
    }
    return result;
  }

  /**
   * Every indexed span recorded by a given service.
   *
   * @param service - service name to search.
   * @param limit - maximum results (defaults to `DEFAULT_INDEX_LIMIT`).
   * @returns an array of matching spans.
   */
  findByService(service: string, limit: number = DEFAULT_INDEX_LIMIT): TraceSpan[] {
    const composites = Array.from(this.#byService.get(service) ?? []);
    const result: TraceSpan[] = [];
    for (const composite of composites) {
      if (result.length >= limit) {
        break;
      }
      const span = this.#resolve(composite);
      if (span !== undefined) {
        result.push(span);
      }
    }
    return result;
  }

  /**
   * Every indexed span currently in the requested status.
   *
   * @param status - status to search (`ok` | `error` | `incomplete`).
   * @param limit - maximum results.
   * @returns an array of matching spans.
   */
  findByStatus(status: SpanStatus, limit: number = DEFAULT_INDEX_LIMIT): TraceSpan[] {
    const composites = Array.from(this.#byStatus.get(status) ?? []);
    const result: TraceSpan[] = [];
    for (const composite of composites) {
      if (result.length >= limit) {
        break;
      }
      const span = this.#resolve(composite);
      if (span !== undefined) {
        result.push(span);
      }
    }
    return result;
  }

  /**
   * Every indexed span whose operation name equals the supplied name.
   *
   * @param name - operation name to search.
   * @param limit - maximum results.
   * @returns an array of matching spans.
   */
  findByName(name: string, limit: number = DEFAULT_INDEX_LIMIT): TraceSpan[] {
    const composites = Array.from(this.#byName.get(name) ?? []);
    const result: TraceSpan[] = [];
    for (const composite of composites) {
      if (result.length >= limit) {
        break;
      }
      const span = this.#resolve(composite);
      if (span !== undefined) {
        result.push(span);
      }
    }
    return result;
  }

  /**
   * Remove all indexed entries.
   *
   * @returns the number of spans that were indexed before clearing.
   */
  clear(): number {
    const removed = this.#entries.size;
    this.#entries.clear();
    this.#byTraceId.clear();
    this.#byService.clear();
    this.#byName.clear();
    this.#byStatus.clear();
    this.#lastIndexedAt = Date.now();
    return removed;
  }

  /**
   * Rebuild the entire index from a store's current contents. Any existing
   * entries are discarded first so the result is a faithful snapshot of the
   * store, not a union with stale data.
   *
   * @param store - the store to synchronize from. Defaults to the store the
   * index was constructed with.
   * @returns the number of spans indexed.
   */
  rebuild(store?: TraceStore): number {
    const source = store ?? this.#store;
    this.#entries.clear();
    this.#byTraceId.clear();
    this.#byService.clear();
    this.#byName.clear();
    this.#byStatus.clear();
    let indexed = 0;
    source.forEachSpan((span) => {
      this.indexSpan(span);
      indexed += 1;
    });
    this.#dirty = false;
    this.#lastIndexedAt = Date.now();
    return indexed;
  }

  /**
   * Iterate the distinct trace ids currently represented in the index.
   *
   * @returns an array of trace ids.
   */
  traceIds(): string[] {
    return Array.from(this.#byTraceId.keys());
  }

  /**
   * Iterate the distinct service names currently represented in the index.
   *
   * @returns an array of service names.
   */
  services(): string[] {
    return Array.from(this.#byService.keys());
  }

  /**
   * Iterate the distinct operation names currently represented in the index.
   *
   * @returns an array of operation names.
   */
  names(): string[] {
    return Array.from(this.#byName.keys());
  }

  /**
   * Aggregate statistics describing the current index state.
   *
   * @returns a populated {@link TraceIndexStats} object.
   */
  stats(): TraceIndexStats {
    const byStatus: Record<SpanStatus, number> = { ok: 0, error: 0, incomplete: 0 };
    let rootSpans = 0;
    let indexedTraces = 0;
    for (const [traceId, bucket] of this.#byTraceId) {
      if (bucket.size > 0) {
        indexedTraces += 1;
      }
    }
    for (const composite of this.#entries.keys()) {
      const span = this.#resolve(composite);
      if (span !== undefined) {
        byStatus[span.status] = (byStatus[span.status] ?? 0) + 1;
        if (span.parentId === undefined) {
          rootSpans += 1;
        }
      }
    }
    let totalIndexEntries = 0;
    for (const map of [this.#byTraceId, this.#byService, this.#byName, this.#byStatus]) {
      for (const bucket of map.values()) {
        totalIndexEntries += bucket.size;
      }
    }
    return {
      indexedSpans: this.#entries.size,
      indexedTraces,
      serviceCount: this.#byService.size,
      nameCount: this.#byName.size,
      byStatus,
      rootSpans,
      totalIndexEntries,
      dirty: this.#dirty,
      lastIndexedAt: this.#lastIndexedAt,
    };
  }

  /**
   * Serialize the composite key index to a JSON-friendly structure for
   * debugging and tests. Payload spans are resolved against the store so the
   * snapshot is fully self-contained.
   *
   * @returns an array of indexed span payloads.
   */
  toJSON(): TraceSpan[] {
    const result: TraceSpan[] = [];
    for (const composite of this.#entries.keys()) {
      const span = this.#resolve(composite);
      if (span !== undefined) {
        result.push(span);
      }
    }
    return result;
  }
}