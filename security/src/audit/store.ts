/**
 * store.ts
 *
 * `AuditStore` — the append-only, capacity-bounded in-memory log of audit
 * events.
 *
 * The store owns the canonical set of recorded {@link AuditEvent} records. It
 * provides:
 *
 *  - appending events (`append` / `record`) with automatic capacity eviction
 *  - point lookup (`get`, `has`) and filtered views (`getByType`,
 *    `getByActor`, `getByResult`, `getBySeverity`)
 *  - removal (`delete`, `clear`) and age-based pruning (`prune`)
 *  - statistics (`size`, `stats`) and serialization round-trips
 *    (`toJSON` / `fromJSON`)
 *
 * The store is intentionally synchronous and dependency-free (only
 * `node:events` for change notifications). It never throws on ordinary lookup
 * misses: `get`/`has`/`delete` return neutral values so callers can compose
 * them freely. Invalid input, however, is rejected loudly via the guards from
 * `types.ts`. Insertion order is preserved so that callers can rely on
 * `all()` being chronological; `append` over an existing id replaces the
 * record in place rather than reordering the log.
 *
 * @module audit/store
 */

import { EventEmitter } from 'node:events';
import {
  type AuditConfig,
  type AuditEvent,
  type AuditEventInput,
  type AuditResult,
  type AuditSeverity,
  type AuditStats,
  type AuditType,
  assertAuditEvent,
  createAuditEvent,
  createEmptyAuditStats,
  isAuditEvent,
  isAuditResult,
  isAuditSeverity,
  isAuditType,
  isValidId,
  nowMs,
  resolveAuditConfig,
} from './types.js';

/** Version tag embedded in {@link AuditStore.toJSON} output. */
export const AUDIT_STORE_SCHEMA_VERSION = 1;

/** Reason a batch of events was evicted from the store. */
export type AuditStorePruneReason = 'age' | 'capacity';

/**
 * Result of a store prune operation.
 */
export interface AuditStorePruneResult {
  /** Number of events evicted. */
  count: number;
  /** The evicted event records (for index sync and event fan-out). */
  events: AuditEvent[];
  /** Epoch ms when the prune ran. */
  at: number;
  /** Whether the eviction was age-based or capacity-based. */
  reason: AuditStorePruneReason;
}

/** Events emitted by {@link AuditStore}: `recorded`, `pruned`, `cleared`, `deleted`. */
export interface AuditStoreEvents {
  /** Emitted when an event is recorded; payload is the stored event. */
  recorded: AuditEvent;
  /** Emitted after any eviction; payload describes the prune. */
  pruned: AuditStorePruneResult;
  /** Emitted when the whole log is cleared. */
  cleared: { count: number; at: number };
  /** Emitted when a single event is deleted by id. */
  deleted: { id: string; event: AuditEvent };
}

/** Options accepted by the {@link AuditStore} constructor. */
export interface AuditStoreOptions {
  /** Configuration overrides merged over the defaults. */
  config?: Partial<AuditConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
  /** Initial events to seed the log with. */
  initial?: readonly AuditEvent[];
}

/** Serialized shape produced by {@link AuditStore.toJSON}. */
export interface AuditStoreSnapshot {
  schemaVersion: number;
  events: AuditEvent[];
}

/**
 * An append-only, capacity-bounded log of {@link AuditEvent} records.
 *
 * Responsibilities:
 *  - record events (`append`, `record`) with a hard capacity cap
 *  - point lookup (`get`, `has`) and filtered views
 *  - deletion (`delete`) and wholesale reset (`clear`)
 *  - age-based pruning (`prune`) and capacity trimming (`pruneToCapacity`)
 *  - statistics (`size`, `stats`)
 *  - persistence round-trip (`toJSON`, `fromJSON`)
 *
 * Change notifications are delivered through an {@link EventEmitter} so that
 * indexes, lifecycle components and the reporter can stay in sync without
 * polling.
 */
export class AuditStore {
  private readonly events: Map<string, AuditEvent> = new Map();
  private readonly order: string[] = [];
  private readonly emitter: EventEmitter;
  private readonly config: AuditConfig;
  private readonly now: () => number;
  private recorded: number;
  private pruned: number;
  private deleted: number;
  private lastPruneAt: number | undefined;

  /**
   * @param options Initialization options (config, clock, seed events).
   */
  constructor(options: AuditStoreOptions = {}) {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(0);
    this.config = resolveAuditConfig(options.config);
    this.now = options.now ?? nowMs;
    this.recorded = 0;
    this.pruned = 0;
    this.deleted = 0;
    if (options.initial) {
      for (const event of options.initial) {
        this.append(event);
      }
    }
  }

  /**
   * Subscribes to a store event. Returns an unsubscribe function for easy
   * cleanup with event-driven indexes and lifecycle components.
   *
   * @param event Event name (`recorded`, `pruned`, `cleared` or `deleted`).
   * @param listener Callback invoked with the event payload.
   * @returns A function that removes the listener when called.
   */
  on<K extends keyof AuditStoreEvents>(
    event: K,
    listener: (payload: AuditStoreEvents[K]) => void,
  ): () => void {
    this.emitter.on(event, listener);
    return () => {
      this.emitter.off(event, listener);
    };
  }

  /**
   * Appends an event to the log, normalizing partial inputs. If the event id
   * already exists, the prior record is replaced in place (its position in the
   * log is preserved). After insertion the log is trimmed back to its
   * configured capacity, evicting the oldest entries first.
   *
   * @param input A full event or a partial input to be normalized.
   * @returns The stored, frozen event.
   */
  append(input: AuditEvent | AuditEventInput): AuditEvent {
    const event = isAuditEvent(input) ? input : createAuditEvent(input);
    if (!isValidId(event.id)) {
      throw new TypeError('AuditEvent id must be a non-empty string');
    }
    if (!this.events.has(event.id)) {
      this.order.push(event.id);
    }
    this.events.set(event.id, event);
    this.recorded += 1;
    this.emitter.emit('recorded', event);
    this.pruneToCapacity();
    return event;
  }

  /**
   * Alias for {@link AuditStore.append} kept for ergonomics with the generic
   * "record" vocabulary used across the audit engine.
   *
   * @param input A full event or a partial input.
   * @returns The stored event.
   */
  record(input: AuditEvent | AuditEventInput): AuditEvent {
    return this.append(input);
  }

  /**
   * Fetches an event by id.
   *
   * @param id Event id.
   * @returns The stored event, or `undefined` when absent.
   */
  get(id: string): AuditEvent | undefined {
    if (!isValidId(id)) return undefined;
    return this.events.get(id);
  }

  /**
   * Returns whether an event id is present in the log.
   *
   * @param id Event id.
   * @returns `true` when the log contains the id.
   */
  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  /**
   * Lists every event of the given type, in insertion order.
   *
   * @param type Event type to filter by.
   * @returns Array of matching events (empty when none).
   */
  getByType(type: AuditType): AuditEvent[] {
    if (!isAuditType(type)) return [];
    const out: AuditEvent[] = [];
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event && event.type === type) out.push(event);
    }
    return out;
  }

  /**
   * Lists every event performed by the given actor, in insertion order.
   *
   * @param actor Actor label to match (exact, trimmed match).
   * @returns Array of matching events (empty when none).
   */
  getByActor(actor: string): AuditEvent[] {
    const normalized = typeof actor === 'string' ? actor.trim() : '';
    if (normalized.length === 0) return [];
    const out: AuditEvent[] = [];
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event && event.actor === normalized) out.push(event);
    }
    return out;
  }

  /**
   * Lists every event carrying the given outcome, in insertion order.
   *
   * @param result Outcome to filter by.
   * @returns Array of matching events (empty when none).
   */
  getByResult(result: AuditResult): AuditEvent[] {
    if (!isAuditResult(result)) return [];
    const out: AuditEvent[] = [];
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event && event.result === result) out.push(event);
    }
    return out;
  }

  /**
   * Lists every event carrying the given severity, in insertion order.
   *
   * @param severity Severity to filter by.
   * @returns Array of matching events (empty when none).
   */
  getBySeverity(severity: AuditSeverity): AuditEvent[] {
    if (!isAuditSeverity(severity)) return [];
    const out: AuditEvent[] = [];
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event && event.severity === severity) out.push(event);
    }
    return out;
  }

  /**
   * Removes a single event by id. Missing ids are a no-op returning `false`.
   * Emits `deleted` with the removed record when one existed.
   *
   * @param id Event id to remove.
   * @returns `true` when an event was actually removed.
   */
  delete(id: string): boolean {
    if (!isValidId(id)) return false;
    const event = this.events.get(id);
    if (!event) return false;
    this.events.delete(id);
    const index = this.order.indexOf(id);
    if (index >= 0) this.order.splice(index, 1);
    this.deleted += 1;
    this.emitter.emit('deleted', { id, event });
    return true;
  }

  /**
   * Clears every event from the log, emitting `cleared`.
   *
   * @returns The number of events removed.
   */
  clear(): number {
    const count = this.events.size;
    this.events.clear();
    this.order.length = 0;
    this.emitter.emit('cleared', { count, at: this.now() });
    return count;
  }

  /**
   * Returns the number of events currently retained in the log.
   *
   * @returns Log cardinality.
   */
  size(): number {
    return this.events.size;
  }

  /**
   * Returns the configured capacity (upper bound) of the log.
   *
   * @returns The value of `config.maxEvents`, or 0 when unbounded.
   */
  capacity(): number {
    return this.config.maxEvents ?? 0;
  }

  /**
   * Returns whether the log is currently empty.
   *
   * @returns `true` when no events are retained.
   */
  isEmpty(): boolean {
    return this.events.size === 0;
  }

  /**
   * Returns the oldest retained event, when any.
   *
   * @returns The first event in insertion order, or `undefined`.
   */
  oldest(): AuditEvent | undefined {
    const id = this.order[0];
    return id === undefined ? undefined : this.events.get(id);
  }

  /**
   * Returns the newest retained event, when any.
   *
   * @returns The last event in insertion order, or `undefined`.
   */
  newest(): AuditEvent | undefined {
    const id = this.order[this.order.length - 1];
    return id === undefined ? undefined : this.events.get(id);
  }

  /**
   * Evicts every event older than `olderThanMs` milliseconds. Each eviction is
   * reported in the returned result and a single aggregate `pruned` event is
   * emitted so subscribers can synchronize indexes in one pass.
   *
   * @param olderThanMs Age threshold in milliseconds.
   * @param at Reference time in epoch ms (defaults to the clock).
   * @returns An {@link AuditStorePruneResult} describing the sweep.
   */
  prune(olderThanMs: number, at: number = this.now()): AuditStorePruneResult {
    const threshold = Math.max(0, olderThanMs);
    const evicted: AuditEvent[] = [];
    const removedIds = new Set<string>();
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event && at - event.timestamp > threshold) {
        removedIds.add(id);
        evicted.push(event);
      }
    }
    for (const id of removedIds) {
      this.events.delete(id);
      this.deleted += 1;
    }
    if (removedIds.size > 0) {
      this.order.splice(0, this.order.length, ...this.order.filter((id) => !removedIds.has(id)));
    }
    this.pruned += evicted.length;
    this.lastPruneAt = at;
    const result: AuditStorePruneResult = { count: evicted.length, events: evicted, at, reason: 'age' };
    this.emitter.emit('pruned', result);
    return result;
  }

  /**
   * Trims the log back to its configured capacity by evicting the oldest
   * entries. Used internally by {@link AuditStore.append} and exposed so
   * callers can enforce the cap after bulk imports.
   *
   * @returns An {@link AuditStorePruneResult} describing the trim (a
   *   zero-count result when already within capacity or unbounded).
   */
  pruneToCapacity(): AuditStorePruneResult {
    const capacity = this.config.maxEvents;
    if (capacity === undefined || capacity < 0) {
      return { count: 0, events: [], at: this.now(), reason: 'capacity' };
    }
    const excess = this.events.size - capacity;
    if (excess <= 0) {
      return { count: 0, events: [], at: this.now(), reason: 'capacity' };
    }
    const evicted: AuditEvent[] = [];
    const removedIds = new Set<string>();
    let toRemove = excess;
    for (const id of this.order) {
      if (toRemove <= 0) break;
      const event = this.events.get(id);
      if (event) {
        removedIds.add(id);
        evicted.push(event);
        toRemove -= 1;
      }
    }
    for (const id of removedIds) {
      this.events.delete(id);
      this.deleted += 1;
    }
    if (removedIds.size > 0) {
      this.order.splice(0, this.order.length, ...this.order.filter((id) => !removedIds.has(id)));
    }
    this.pruned += evicted.length;
    this.lastPruneAt = this.now();
    const result: AuditStorePruneResult = { count: evicted.length, events: evicted, at: this.lastPruneAt, reason: 'capacity' };
    this.emitter.emit('pruned', result);
    return result;
  }

  /**
   * Returns all retained events in insertion order (chronological).
   *
   * @returns An array of stored events.
   */
  all(): AuditEvent[] {
    const out: AuditEvent[] = [];
    for (const id of this.order) {
      const event = this.events.get(id);
      if (event) out.push(event);
    }
    return out;
  }

  /**
   * Computes a snapshot of log health useful for metrics and dashboards.
   *
   * @param base Optional starting stats to merge into.
   * @returns A fresh {@link AuditStats} object describing this store.
   */
  stats(base: AuditStats = createEmptyAuditStats()): AuditStats {
    const byType = { ...base.byType } as Record<AuditType, number>;
    const byResult = { ...base.byResult } as Record<AuditResult, number>;
    const bySeverity = { ...base.bySeverity } as Record<AuditSeverity, number>;
    let oldestAt: number | undefined;
    let newestAt: number | undefined;
    for (const id of this.order) {
      const event = this.events.get(id);
      if (!event) continue;
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      byResult[event.result] = (byResult[event.result] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      if (oldestAt === undefined || event.timestamp < oldestAt) oldestAt = event.timestamp;
      if (newestAt === undefined || event.timestamp > newestAt) newestAt = event.timestamp;
    }
    const capacity = this.capacity();
    const usagePercent = capacity > 0 ? this.events.size / capacity : 0;
    return {
      ...base,
      total: this.events.size,
      recorded: this.recorded,
      pruned: this.pruned,
      deleted: this.deleted,
      capacity,
      usagePercent,
      oldestAt,
      newestAt,
      lastPruneAt: this.lastPruneAt,
      byType,
      byResult,
      bySeverity,
    };
  }

  /**
   * Serializes the full log to a versioned, JSON-safe snapshot. Events are
   * written as plain objects (frozen wrappers are stripped).
   *
   * @returns A plain snapshot object safe for `JSON.stringify`.
   */
  toJSON(): AuditStoreSnapshot {
    return {
      schemaVersion: AUDIT_STORE_SCHEMA_VERSION,
      events: this.all(),
    };
  }

  /**
   * Replaces the entire log with the contents of a snapshot produced by
   * {@link AuditStore.toJSON} (or any structurally compatible object). The
   * previous log is cleared first; each loaded event is validated and emitted
   * through the normal `recorded` channel so indexes stay in sync.
   *
   * @param snapshot Serialized log data.
   * @returns The number of events loaded.
   */
  fromJSON(snapshot: unknown): number {
    if (!isAuditStoreSnapshot(snapshot)) {
      throw new TypeError('Invalid audit store snapshot');
    }
    this.clear();
    let count = 0;
    for (const event of snapshot.events) {
      const validated = assertAuditEvent(event, 'snapshot event');
      this.append(validated);
      count += 1;
    }
    return count;
  }

  /**
   * Returns an iterable of all events for `for...of` consumption.
   *
   * @returns An iterator over stored events (chronological order).
   */
  [Symbol.iterator](): IterableIterator<AuditEvent> {
    return this.all()[Symbol.iterator]();
  }

  /**
   * Lifetime counters exposed for observability: number of events recorded,
   * pruned and deleted since construction (or the last {@link clear}).
   *
   * @returns An object of write counters.
   */
  counters(): { recorded: number; pruned: number; deleted: number } {
    return { recorded: this.recorded, pruned: this.pruned, deleted: this.deleted };
  }

  /**
   * Returns the resolved configuration in effect for this store.
   *
   * @returns A readonly view of the active {@link AuditConfig}.
   */
  getConfig(): Readonly<AuditConfig> {
    return this.config;
  }
}

/**
 * Structural guard for {@link AuditStoreSnapshot}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value looks like a serialized audit log.
 */
export function isAuditStoreSnapshot(value: unknown): value is AuditStoreSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== AUDIT_STORE_SCHEMA_VERSION) return false;
  if (!Array.isArray(candidate.events)) return false;
  return candidate.events.every((entry) => isAuditEvent(entry));
}

/**
 * Convenience factory for a store pre-seeded from a snapshot.
 *
 * @param snapshot Serialized log data.
 * @returns A configured {@link AuditStore}.
 */
export function storeFromJSON(snapshot: unknown): AuditStore {
  const store = new AuditStore();
  store.fromJSON(snapshot);
  return store;
}