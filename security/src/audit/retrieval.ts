/**
 * retrieval.ts
 *
 * `AuditQuery` — the read-side facade for interrogating the audit log.
 *
 * The query layer answers the questions security operators actually ask:
 *
 *  - "what happened recently?"                       → {@link AuditQuery.recent}
 *  - "what did this actor do?"                       → {@link AuditQuery.byActor}
 *  - "how many events of each type were recorded?"   → {@link AuditQuery.counts}
 *  - "is the denied ratio trending up?"              → {@link AuditQuery.summary}
 *
 * Every query is expressed against a backing {@link AuditStore} (the canonical
 * log) with an optional {@link AuditIndex} used to accelerate facet lookups.
 * When an index is present, facet queries (`byType`, `byActor`, `bySeverity`,
 * `byResult`) short-circuit to the corresponding bucket; otherwise they fall
 * back to a linear scan of the store. Results that imply "most recent first"
 * (`recent`, `byType`, `byActor`, ...) are returned in descending timestamp
 * order so callers can take a leading slice without re-sorting.
 *
 * The query object is a pure reader: it never mutates the store or the index
 * and is safe to share across concurrent consumers.
 *
 * @module audit/retrieval
 */

import {
  type AuditEvent,
  type AuditResult,
  type AuditSeverity,
  type AuditStats,
  type AuditType,
  isAuditResult,
  isAuditSeverity,
  isAuditType,
  isValidId,
  nowMs,
} from './types.js';
import { type AuditStore } from './store.js';
import { type AuditIndex } from './index.js';

/** Default number of results returned by limit-taking queries. */
export const DEFAULT_QUERY_LIMIT = 100;

/** Per-facet tallies produced by {@link AuditQuery.counts}. */
export interface AuditCounts {
  /** Total events in the queried scope. */
  total: number;
  /** Event count per {@link AuditType}. */
  byType: Record<AuditType, number>;
  /** Event count per {@link AuditResult}. */
  byResult: Record<AuditResult, number>;
  /** Event count per {@link AuditSeverity}. */
  bySeverity: Record<AuditSeverity, number>;
  /** Event count per actor label. */
  byActor: Record<string, number>;
}

/** One row of the top-actor / top-action tallies in {@link AuditSummary}. */
export interface AuditTallyRow {
  /** The grouped value (actor label or action verb). */
  key: string;
  /** Number of events in the group. */
  count: number;
}

/**
 * Aggregate summary produced by {@link AuditQuery.summary}. A single object
 * that answers "what is the shape of the current audit log?" — volumes,
 * denial and critical ratios, and the leading actors/actions.
 */
export interface AuditSummary {
  /** Total events in the queried scope. */
  total: number;
  /** Epoch ms of the oldest event, when any. */
  oldestAt?: number;
  /** Epoch ms of the newest event, when any. */
  newestAt?: number;
  /** Count of `allowed` events. */
  allowed: number;
  /** Count of `denied` events. */
  denied: number;
  /** Count of `error` events. */
  errors: number;
  /** Count of `info` events (result == `info`). */
  infos: number;
  /** Count of `warn`-severity events. */
  warn: number;
  /** Count of `critical`-severity events. */
  critical: number;
  /** `denied / total` (0 when no events). */
  deniedRatio: number;
  /** `critical / total` (0 when no events). */
  criticalRatio: number;
  /** Leading actors by event count (descending). */
  topActors: readonly AuditTallyRow[];
  /** Leading actions by event count (descending). */
  topActions: readonly AuditTallyRow[];
  /** Event count per {@link AuditType}. */
  perType: Record<AuditType, number>;
}

/** Options accepted by the {@link AuditQuery} constructor. */
export interface AuditQueryOptions {
  /** The canonical audit log to read from. */
  store: AuditStore;
  /** Optional acceleration index; facet lookups short-circuit when present. */
  index?: AuditIndex;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
  /** Default limit applied by limit-taking queries (default 100). */
  limit?: number;
}

/**
 * The read-side facade for interrogating the audit log.
 *
 * ```ts
 * const query = new AuditQuery({ store, index });
 * const recentDenied = query.denied(20);
 * const summary = query.summary();
 * const tally = query.counts();
 * ```
 */
export class AuditQuery {
  private readonly store: AuditStore;
  private readonly index: AuditIndex | undefined;
  private readonly now: () => number;
  private readonly defaultLimit: number;

  /**
   * @param options Backing store, optional index, clock and default limit.
   */
  constructor(options: AuditQueryOptions) {
    this.store = options.store;
    this.index = options.index;
    this.now = options.now ?? nowMs;
    this.defaultLimit = options.limit ?? DEFAULT_QUERY_LIMIT;
  }

  /**
   * Returns the backing store this query reads from.
   *
   * @returns The canonical {@link AuditStore}.
   */
  storeRef(): AuditStore {
    return this.store;
  }

  /**
   * Returns the acceleration index in use, when one was supplied.
   *
   * @returns The {@link AuditIndex}, or `undefined`.
   */
  indexRef(): AuditIndex | undefined {
    return this.index;
  }

  /**
   * Returns the most recent `limit` events, newest first.
   *
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of events sorted by descending timestamp.
   */
  recent(limit: number = this.defaultLimit): AuditEvent[] {
    return this.sliceDescending(this.store.all(), limit);
  }

  /**
   * Returns the most recent `limit` events of the given type, newest first.
   * Accelerated by the index when one is present.
   *
   * @param type Event type to filter by.
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  byType(type: AuditType, limit: number = this.defaultLimit): AuditEvent[] {
    if (!isAuditType(type)) return [];
    const source = this.index ? this.index.findByType(type) : this.store.getByType(type);
    return this.sliceDescending(source, limit);
  }

  /**
   * Returns the most recent `limit` events performed by the given actor,
   * newest first. Accelerated by the index when one is present.
   *
   * @param actor Actor label (exact, trimmed match).
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  byActor(actor: string, limit: number = this.defaultLimit): AuditEvent[] {
    const normalized = typeof actor === 'string' ? actor.trim() : '';
    if (normalized.length === 0) return [];
    const source = this.index ? this.index.findByActor(normalized) : this.store.getByActor(normalized);
    return this.sliceDescending(source, limit);
  }

  /**
   * Returns the most recent `limit` events carrying the given severity, newest
   * first. Accelerated by the index when one is present.
   *
   * @param severity Severity to filter by.
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  bySeverity(severity: AuditSeverity, limit: number = this.defaultLimit): AuditEvent[] {
    if (!isAuditSeverity(severity)) return [];
    const source = this.index ? this.index.findBySeverity(severity) : this.store.getBySeverity(severity);
    return this.sliceDescending(source, limit);
  }

  /**
   * Returns the most recent `limit` events carrying the given outcome, newest
   * first. Accelerated by the index when one is present.
   *
   * @param result Outcome to filter by.
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  byResult(result: AuditResult, limit: number = this.defaultLimit): AuditEvent[] {
    if (!isAuditResult(result)) return [];
    const source = this.index ? this.index.findByResult(result) : this.store.getByResult(result);
    return this.sliceDescending(source, limit);
  }

  /**
   * Returns the most recent `limit` denied events, newest first. The primary
   * signal for security review.
   *
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of `denied` events sorted by descending timestamp.
   */
  denied(limit: number = this.defaultLimit): AuditEvent[] {
    return this.byResult('denied', limit);
  }

  /**
   * Returns the most recent `limit` allowed events, newest first.
   *
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of `allowed` events sorted by descending timestamp.
   */
  allowed(limit: number = this.defaultLimit): AuditEvent[] {
    return this.byResult('allowed', limit);
  }

  /**
   * Returns the most recent `limit` errored events, newest first.
   *
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of `error` events sorted by descending timestamp.
   */
  errors(limit: number = this.defaultLimit): AuditEvent[] {
    return this.byResult('error', limit);
  }

  /**
   * Returns the most recent `limit` critical-severity events, newest first.
   *
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of `critical` events sorted by descending timestamp.
   */
  critical(limit: number = this.defaultLimit): AuditEvent[] {
    return this.bySeverity('critical', limit);
  }

  /**
   * Returns every event whose timestamp falls within `[from, to]` (inclusive),
   * in chronological order. An omitted bound is treated as unbounded.
   *
   * @param from Inclusive lower bound in epoch ms (optional).
   * @param to Inclusive upper bound in epoch ms (optional).
   * @returns An array of events sorted by ascending timestamp.
   */
  range(from?: number, to?: number): AuditEvent[] {
    const lower = from === undefined ? Number.NEGATIVE_INFINITY : from;
    const upper = to === undefined ? Number.POSITIVE_INFINITY : to;
    const out: AuditEvent[] = [];
    for (const event of this.store.all()) {
      if (event.timestamp >= lower && event.timestamp <= upper) out.push(event);
    }
    return out;
  }

  /**
   * Returns every event at or after `timestamp`, newest first.
   *
   * @param timestamp Inclusive lower bound in epoch ms.
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  after(timestamp: number, limit: number = this.defaultLimit): AuditEvent[] {
    const out: AuditEvent[] = [];
    for (const event of this.store.all()) {
      if (event.timestamp >= timestamp) out.push(event);
    }
    return this.sliceDescending(out, limit);
  }

  /**
   * Returns every event at or before `timestamp`, newest first.
   *
   * @param timestamp Inclusive upper bound in epoch ms.
   * @param limit Maximum number of events to return (default 100).
   * @returns An array of matching events sorted by descending timestamp.
   */
  before(timestamp: number, limit: number = this.defaultLimit): AuditEvent[] {
    const out: AuditEvent[] = [];
    for (const event of this.store.all()) {
      if (event.timestamp <= timestamp) out.push(event);
    }
    return this.sliceDescending(out, limit);
  }

  /**
   * Looks up a single event by id.
   *
   * @param id Event id.
   * @returns The event, or `undefined`.
   */
  get(id: string): AuditEvent | undefined {
    if (!isValidId(id)) return undefined;
    return this.store.get(id);
  }

  /**
   * Returns the total number of events currently in the log.
   *
   * @returns Log cardinality.
   */
  size(): number {
    return this.store.size();
  }

  /**
   * Computes per-facet tallies across the whole log: counts per type, result,
   * severity and actor.
   *
   * @returns An {@link AuditCounts} snapshot.
   */
  counts(): AuditCounts {
    const byType = {} as Record<AuditType, number>;
    const byResult = {} as Record<AuditResult, number>;
    const bySeverity = {} as Record<AuditSeverity, number>;
    const byActor: Record<string, number> = {};
    let total = 0;
    for (const event of this.store.all()) {
      total += 1;
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      byResult[event.result] = (byResult[event.result] ?? 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
      if (event.actor !== undefined) byActor[event.actor] = (byActor[event.actor] ?? 0) + 1;
    }
    return { total, byType, byResult, bySeverity, byActor };
  }

  /**
   * Produces an aggregate security summary: volumes, denial and critical
   * ratios, plus the leading actors and actions.
   *
   * @param limit Number of rows to include in the top-actor / top-action
   *   tallies (default 10).
   * @returns An {@link AuditSummary} describing the current log.
   */
  summary(limit: number = 10): AuditSummary {
    const tallies = this.counts();
    const rowLimit = Math.max(1, Math.floor(limit));
    const oldestAt = this.store.oldest()?.timestamp;
    const newestAt = this.store.newest()?.timestamp;
    const denied = tallies.byResult.denied ?? 0;
    const critical = tallies.bySeverity.critical ?? 0;
    const total = tallies.total;
    return {
      total,
      oldestAt,
      newestAt,
      allowed: tallies.byResult.allowed ?? 0,
      denied,
      errors: tallies.byResult.error ?? 0,
      infos: tallies.byResult.info ?? 0,
      warn: tallies.bySeverity.warn ?? 0,
      critical,
      deniedRatio: total > 0 ? denied / total : 0,
      criticalRatio: total > 0 ? critical / total : 0,
      topActors: this.topRows(tallies.byActor, rowLimit),
      topActions: this.topRows(this.tallyActions(tallies.total), rowLimit),
      perType: tallies.byType,
    };
  }

  /**
   * Computes an {@link AuditStats} snapshot by delegating to the backing
   * store, so callers can report on the log through a single read surface.
   *
   * @returns A fresh stats object.
   */
  stats(): AuditStats {
    return this.store.stats();
  }

  /**
   * Sorts an event array by descending timestamp and trims it to `limit`.
   *
   * @param source Events to sort.
   * @param limit Maximum length of the result.
   * @returns A new, sorted, trimmed array.
   */
  private sliceDescending(source: readonly AuditEvent[], limit: number): AuditEvent[] {
    const resolved = Math.max(0, Math.floor(limit));
    const sorted = Array.from(source).sort((a, b) => b.timestamp - a.timestamp);
    return resolved > 0 ? sorted.slice(0, resolved) : [];
  }

  /**
   * Tally of action verbs across the whole log.
   *
   * @param _total Total event count (reserved for future windowed tallies).
   * @returns A map of action → count.
   */
  private tallyActions(_total: number): Record<string, number> {
    const byAction: Record<string, number> = {};
    for (const event of this.store.all()) {
      byAction[event.action] = (byAction[event.action] ?? 0) + 1;
    }
    return byAction;
  }

  /**
   * Converts a key → count tally into a sorted, top-`limit` row array.
   *
   * @param tally The raw tally.
   * @param limit Maximum rows to return.
   * @returns Rows sorted by descending count (ties broken by key).
   */
  private topRows(tally: Record<string, number>, limit: number): AuditTallyRow[] {
    return Object.entries(tally)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .slice(0, limit);
  }
}