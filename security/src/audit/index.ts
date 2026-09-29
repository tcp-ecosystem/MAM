/**
 * index.ts
 *
 * `AuditIndex` — an in-memory query index over {@link AuditEvent} records.
 *
 * While {@link ../store} owns the canonical append-only log, the index exists
 * to answer high-frequency structural questions cheaply:
 *
 *  - "which events are of type `auth`?"
 *  - "which events were performed by actor `alice`?"
 *  - "which events were denied or carried critical severity?"
 *
 * Every secondary index (by type, by actor, by result, by severity) is a
 * multi-map maintained eagerly on write: {@link AuditIndex.indexEvent} inserts
 * the event id into each relevant bucket, and {@link AuditIndex.removeEvent}
 * deletes it from every bucket it previously occupied. A caller that prefers a
 * single bulk pass can rebuild the entire index wholesale with
 * {@link AuditIndex.rebuild}.
 *
 * The index is kept fully serializable so warm-start scenarios can hydrate it
 * from disk via {@link AuditIndex.fromJSON}.
 *
 * @module audit/index
 */

import {
  type AuditEvent,
  type AuditResult,
  type AuditSeverity,
  type AuditType,
  assertAuditEvent,
  isAuditEvent,
  isAuditResult,
  isAuditSeverity,
  isAuditType,
  isValidId,
} from './types.js';

/** Version tag embedded in {@link AuditIndex.toJSON} output. */
export const AUDIT_INDEX_SCHEMA_VERSION = 1;

/** Serialized shape produced by {@link AuditIndex.toJSON}. */
export interface AuditIndexSnapshot {
  schemaVersion: number;
  events: AuditEvent[];
}

/**
 * Per-secondary-index counters surfaced by {@link AuditIndex.stats}.
 */
export interface AuditIndexStats {
  /** Total distinct events indexed. */
  events: number;
  /** Distinct event types present in the type index. */
  types: number;
  /** Distinct actors present in the actor index. */
  actors: number;
  /** Distinct results present in the result index. */
  results: number;
  /** Distinct severities present in the severity index. */
  severities: number;
  /** Total entries across all four secondary indexes. */
  entries: number;
}

/**
 * An eager multi-map index for audit events.
 *
 * Structures:
 *  - `events`:    canonical store of indexed event records (id → event).
 *  - `byType`:    event type → bucket of events.
 *  - `byActor`:   actor label → bucket of events.
 *  - `byResult`:  outcome → bucket of events.
 *  - `bySeverity`: severity → bucket of events.
 *
 * Each bucket preserves insertion order. Lookups are O(1) to O(k) (k = fan-out
 * of the queried key); no linear scans are performed for the named accessors.
 */
export class AuditIndex {
  private readonly events: Map<string, AuditEvent> = new Map();
  private readonly byType: Map<AuditType, Map<string, AuditEvent>> = new Map();
  private readonly byActor: Map<string, Map<string, AuditEvent>> = new Map();
  private readonly byResult: Map<AuditResult, Map<string, AuditEvent>> = new Map();
  private readonly bySeverity: Map<AuditSeverity, Map<string, AuditEvent>> = new Map();

  /**
   * @param options Optional initial events to index eagerly.
   */
  constructor(options: { initial?: readonly AuditEvent[] } = {}) {
    if (options.initial) {
      for (const event of options.initial) {
        this.indexEvent(event);
      }
    }
  }

  /**
   * Indexes an event, inserting it into the master map and every relevant
   * secondary bucket. Re-indexing an existing id replaces its prior record and
   * prunes stale buckets from the previous event's facets.
   *
   * @param event Event record to index.
   */
  indexEvent(event: AuditEvent): void {
    if (!isAuditEvent(event) || !isValidId(event.id)) {
      throw new TypeError('Cannot index an invalid audit event');
    }
    const previous = this.events.get(event.id);
    if (previous) {
      this.removeEvent(event.id);
    }
    this.events.set(event.id, event);
    this.addToBucket(this.byType, event.type, event);
    if (event.actor !== undefined) this.addToBucket(this.byActor, event.actor, event);
    this.addToBucket(this.byResult, event.result, event);
    this.addToBucket(this.bySeverity, event.severity, event);
  }

  /**
   * Removes an event from the index by id, pruning it from every bucket it
   * occupied. Returns the removed event so callers can chain synchronization.
   *
   * @param id Event id to unindex.
   * @returns The removed event, or `undefined` when absent.
   */
  removeEvent(id: string): AuditEvent | undefined {
    if (!isValidId(id)) return undefined;
    const event = this.events.get(id);
    if (!event) return undefined;
    this.events.delete(id);
    this.removeFromBucket(this.byType, event.type, id);
    if (event.actor !== undefined) this.removeFromBucket(this.byActor, event.actor, id);
    this.removeFromBucket(this.byResult, event.result, id);
    this.removeFromBucket(this.bySeverity, event.severity, id);
    return event;
  }

  /**
   * Returns whether an event id is currently indexed.
   *
   * @param id Event id to check.
   * @returns `true` when present.
   */
  has(id: string): boolean {
    return isValidId(id) && this.events.has(id);
  }

  /**
   * Looks up an event record by id.
   *
   * @param id Event id.
   * @returns The event, or `undefined`.
   */
  get(id: string): AuditEvent | undefined {
    return isValidId(id) ? this.events.get(id) : undefined;
  }

  /**
   * Lists every indexed event of the given type, in insertion order.
   *
   * @param type Event type to match.
   * @returns Array of matching events (empty when none).
   */
  findByType(type: AuditType): AuditEvent[] {
    if (!isAuditType(type)) return [];
    return this.collect(this.byType, type);
  }

  /**
   * Lists every indexed event performed by the given actor, in insertion order.
   *
   * @param actor Actor label (exact, trimmed match).
   * @returns Array of matching events (empty when none).
   */
  findByActor(actor: string): AuditEvent[] {
    const normalized = typeof actor === 'string' ? actor.trim() : '';
    if (normalized.length === 0) return [];
    return this.collect(this.byActor, normalized);
  }

  /**
   * Lists every indexed event carrying the given severity, in insertion order.
   *
   * @param severity Severity to match.
   * @returns Array of matching events (empty when none).
   */
  findBySeverity(severity: AuditSeverity): AuditEvent[] {
    if (!isAuditSeverity(severity)) return [];
    return this.collect(this.bySeverity, severity);
  }

  /**
   * Lists every indexed event carrying the given outcome, in insertion order.
   *
   * @param result Outcome to match.
   * @returns Array of matching events (empty when none).
   */
  findByResult(result: AuditResult): AuditEvent[] {
    if (!isAuditResult(result)) return [];
    return this.collect(this.byResult, result);
  }

  /**
   * Counts how many distinct events carry the given type.
   *
   * @param type Event type.
   * @returns Fan-out count for the type (0 when unknown).
   */
  countByType(type: AuditType): number {
    if (!isAuditType(type)) return 0;
    return this.byType.get(type)?.size ?? 0;
  }

  /**
   * Counts how many distinct events reference the given actor.
   *
   * @param actor Actor label.
   * @returns Fan-out count for the actor (0 when unknown).
   */
  countByActor(actor: string): number {
    const normalized = typeof actor === 'string' ? actor.trim() : '';
    if (normalized.length === 0) return 0;
    return this.byActor.get(normalized)?.size ?? 0;
  }

  /**
   * Counts how many distinct events carry the given severity.
   *
   * @param severity Severity.
   * @returns Fan-out count for the severity (0 when unknown).
   */
  countBySeverity(severity: AuditSeverity): number {
    if (!isAuditSeverity(severity)) return 0;
    return this.bySeverity.get(severity)?.size ?? 0;
  }

  /**
   * Counts how many distinct events carry the given outcome.
   *
   * @param result Outcome.
   * @returns Fan-out count for the result (0 when unknown).
   */
  countByResult(result: AuditResult): number {
    if (!isAuditResult(result)) return 0;
    return this.byResult.get(result)?.size ?? 0;
  }

  /**
   * Returns all unique actor labels currently indexed.
   *
   * @returns Array of actor labels.
   */
  actorNames(): string[] {
    return Array.from(this.byActor.keys());
  }

  /**
   * Returns all unique event types currently indexed.
   *
   * @returns Array of event types.
   */
  typeKeys(): AuditType[] {
    return Array.from(this.byType.keys());
  }

  /**
   * Returns all unique outcomes currently indexed.
   *
   * @returns Array of outcomes.
   */
  resultKeys(): AuditResult[] {
    return Array.from(this.byResult.keys());
  }

  /**
   * Returns all unique severities currently indexed.
   *
   * @returns Array of severities.
   */
  severityKeys(): AuditSeverity[] {
    return Array.from(this.bySeverity.keys());
  }

  /**
   * Rebuilds the entire index from an authoritative array of events. All prior
   * index state is discarded first. Call this after loading a snapshot or
   * bulk-importing data to guarantee consistency.
   *
   * @param events Authoritative event records.
   * @returns The number of events indexed.
   */
  rebuild(events: readonly AuditEvent[]): number {
    this.clear();
    for (const event of events) {
      this.indexEvent(event);
    }
    return events.length;
  }

  /**
   * Clears every index structure without touching any external store.
   *
   * @returns The number of events removed.
   */
  clear(): number {
    const count = this.events.size;
    this.events.clear();
    this.byType.clear();
    this.byActor.clear();
    this.byResult.clear();
    this.bySeverity.clear();
    return count;
  }

  /**
   * Returns the number of events currently indexed.
   *
   * @returns Index cardinality.
   */
  size(): number {
    return this.events.size;
  }

  /**
   * Produces structural statistics for the index.
   *
   * @returns {@link AuditIndexStats} describing the current index state.
   */
  stats(): AuditIndexStats {
    let entries = 0;
    for (const bucket of this.byType.values()) entries += bucket.size;
    for (const bucket of this.byActor.values()) entries += bucket.size;
    for (const bucket of this.byResult.values()) entries += bucket.size;
    for (const bucket of this.bySeverity.values()) entries += bucket.size;
    return {
      events: this.events.size,
      types: this.byType.size,
      actors: this.byActor.size,
      results: this.byResult.size,
      severities: this.bySeverity.size,
      entries,
    };
  }

  /**
   * Returns the ids of every event currently indexed.
   *
   * @returns Array of event ids.
   */
  ids(): string[] {
    return Array.from(this.events.keys());
  }

  /**
   * Serializes the index to a versioned snapshot safe for persistence.
   *
   * @returns A plain snapshot object.
   */
  toJSON(): AuditIndexSnapshot {
    return {
      schemaVersion: AUDIT_INDEX_SCHEMA_VERSION,
      events: Array.from(this.events.values()),
    };
  }

  /**
   * Replaces the entire index with the contents of a snapshot produced by
   * {@link AuditIndex.toJSON} (or a structurally compatible object).
   *
   * @param snapshot Serialized index data.
   * @returns The number of events loaded.
   */
  fromJSON(snapshot: unknown): number {
    if (!isAuditIndexSnapshot(snapshot)) {
      throw new TypeError('Invalid audit index snapshot');
    }
    this.clear();
    for (const event of snapshot.events) {
      this.indexEvent(assertAuditEvent(event, 'snapshot event'));
    }
    return snapshot.events.length;
  }

  /**
   * Returns an iterator over all indexed event records.
   *
   * @returns An iterator over events (insertion order).
   */
  [Symbol.iterator](): IterableIterator<AuditEvent> {
    return this.events.values();
  }

  /**
   * Collects the contents of a named bucket, preserving insertion order.
   *
   * @param bucketMap The multi-map to read from.
   * @param key The bucket key.
   * @returns Array of events in the bucket (empty when absent).
   */
  private collect<K extends string>(
    bucketMap: Map<K, Map<string, AuditEvent>>,
    key: K,
  ): AuditEvent[] {
    const bucket = bucketMap.get(key);
    if (!bucket) return [];
    const out: AuditEvent[] = [];
    for (const event of bucket.values()) out.push(event);
    return out;
  }

  /**
   * Inserts an event into a bucket, creating the bucket when absent.
   *
   * @param bucketMap The multi-map to write to.
   * @param key The bucket key.
   * @param event The event to store.
   */
  private addToBucket<K extends string>(
    bucketMap: Map<K, Map<string, AuditEvent>>,
    key: K,
    event: AuditEvent,
  ): void {
    let bucket = bucketMap.get(key);
    if (!bucket) {
      bucket = new Map();
      bucketMap.set(key, bucket);
    }
    bucket.set(event.id, event);
  }

  /**
   * Removes an event id from a bucket, dropping the bucket when it empties.
   *
   * @param bucketMap The multi-map to write to.
   * @param key The bucket key.
   * @param id The event id to remove.
   */
  private removeFromBucket<K extends string>(
    bucketMap: Map<K, Map<string, AuditEvent>>,
    key: K,
    id: string,
  ): void {
    const bucket = bucketMap.get(key);
    if (!bucket) return;
    bucket.delete(id);
    if (bucket.size === 0) bucketMap.delete(key);
  }
}

/**
 * Structural guard for {@link AuditIndexSnapshot}.
 *
 * @param value Any runtime value.
 * @returns `true` when the value looks like a serialized audit index.
 */
export function isAuditIndexSnapshot(value: unknown): value is AuditIndexSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== AUDIT_INDEX_SCHEMA_VERSION) return false;
  if (!Array.isArray(candidate.events)) return false;
  return true;
}

/**
 * Convenience factory for an index hydrated from a snapshot.
 *
 * @param snapshot Serialized index data.
 * @returns A configured {@link AuditIndex}.
 */
export function indexFromJSON(snapshot: unknown): AuditIndex {
  const index = new AuditIndex();
  index.fromJSON(snapshot);
  return index;
}