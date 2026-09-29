/**
 * @fileoverview Public integration surface for the Token usage layer.
 *
 * This module is the single entry point for application code that wants to
 * track token consumption. It exposes three cooperating pieces:
 *
 * - {@link TokenUsageTracker}: a session-scoped facade over the store, index,
 *   lifecycle, and query engines, providing the ergonomic
 *   `record(model, input, output, opts?)` API.
 * - {@link TokenUsageAdapter}: a {@link TokenUsageCollector} implementation
 *   that buffers records and flushes them into a destination store, suitable
 *   for wiring telemetry pipelines or plugin boundaries.
 * - Factory helpers {@link createTokenUsageAdapter} and
 *   {@link createTokenUsageTracker} that assemble fully-wired instances with
 *   sensible defaults.
 *
 * Everything in this module is dependency-free apart from the rest of the
 * Token usage layer and `node:events`.
 *
 * @packageDocumentation
 */

import {
  DEFAULT_TOKEN_USAGE_CONFIG,
  type TokenUsageConfig,
  type TokenUsageOptions,
  type TokenUsageRecord,
} from './types.js';
import { TokenUsageStore } from './store.js';
import { TokenUsageIndex } from './index.js';
import { TokenUsageQuery } from './retrieval.js';
import { TokenUsageLifecycle } from './lifecycle.js';

/**
 * The contract implemented by collectors that receive token usage records.
 *
 * A collector is a push-style sink: callers hand records to {@link collect},
 * and the collector is responsible for persisting, aggregating, or forwarding
 * them. {@link flush} drains any internally buffered records and returns them,
 * giving the collector a chance to batch writes.
 */
export interface TokenUsageCollector {
  /**
   * Receives a token usage record for processing.
   *
   * @param record - The record to collect. Implementations must not mutate it.
   */
  collect(record: TokenUsageRecord): void;

  /**
   * Flushes any buffered records and returns them.
   *
   * @returns The records that were flushed. An empty array when nothing was
   * buffered.
   */
  flush(): TokenUsageRecord[];

  /**
   * Number of records currently buffered (not yet flushed).
   *
   * @returns The buffered record count.
   */
  bufferedCount(): number;

  /**
   * Total number of records collected over the collector's lifetime.
   *
   * @returns The lifetime record count.
   */
  totalCollected(): number;
}

/**
 * The active session handle returned by {@link TokenUsageTracker.beginSession}.
 *
 * Each handle carries its own session id and a query engine scoped to that
 * session, so callers can query per-session usage while the session is live.
 */
export interface TokenUsageSession {
  /**
   * The session identifier.
   */
  readonly sessionId: string;

  /**
   * Epoch milliseconds at which the session began.
   */
  readonly startedAt: number;

  /**
   * Query engine pre-scoped to this session. Only records bound to
   * `sessionId` are aggregated.
   */
  readonly query: TokenUsageQuery;

  /**
   * Total number of records recorded in this session so far.
   */
  readonly recordCount: number;
}

/**
 * A high-level facade that tracks token usage across a single application
 * process.
 *
 * The tracker owns a {@link TokenUsageStore}, {@link TokenUsageIndex},
 * {@link TokenUsageQuery}, and {@link TokenUsageLifecycle}, wiring them
 * together so that every call to {@link record} is stored, indexed, and
 * announced in one place. It supports session-scoped tracking: call
 * {@link beginSession} to obtain a scoped handle, then end it with
 * {@link endSession}.
 *
 * @example
 * ```ts
 * const tracker = createTokenUsageTracker();
 * const session = tracker.beginSession('chat-1');
 * tracker.record('gpt-4o', 120, 34, { sessionId: session.sessionId });
 * tracker.sessionSummary('chat-1').totalTokens; // 154
 * tracker.stop();
 * ```
 */
export class TokenUsageTracker {
  /** The lifecycle manager owning the data. */
  private readonly lifecycle: TokenUsageLifecycle;

  /** The store, exposed read-only through helpers. */
  private readonly store: TokenUsageStore;

  /** The index kept in sync by the lifecycle. */
  private readonly index: TokenUsageIndex;

  /** The configuration in effect. */
  private readonly config: TokenUsageConfig;

  /** Active sessions keyed by session id. */
  private readonly sessions = new Map<string, TokenUsageSession>();

  /** Session id of the most recently begun session, or `null`. */
  private currentSessionId: string | null = null;

  /**
   * Creates a tracker around an optional lifecycle.
   *
   * @param lifecycle - Optional lifecycle to own. A fresh one is created when
   * omitted.
   * @param config - Optional configuration overrides used when no lifecycle is
   * supplied.
   */
  constructor(lifecycle?: TokenUsageLifecycle, config?: Partial<TokenUsageConfig>) {
    this.config = { ...DEFAULT_TOKEN_USAGE_CONFIG, ...config };
    this.lifecycle = lifecycle ?? new TokenUsageLifecycle(undefined, undefined, this.config);
    this.store = this.lifecycle.getStore();
    this.index = this.lifecycle.getIndex();
  }

  /**
   * Records token usage for a model call.
   *
   * @param model - The model identifier.
   * @param inputTokens - Number of input tokens.
   * @param outputTokens - Number of output tokens.
   * @param opts - Optional per-call overrides. When `opts.sessionId` is
   * omitted and a session is active via {@link beginSession}, the active
   * session id is attached automatically.
   * @returns The stored, normalized record.
   */
  record(model: string, inputTokens: number, outputTokens: number, opts?: TokenUsageOptions): TokenUsageRecord {
    const effective: TokenUsageOptions = {
      ...opts,
      sessionId:
        opts?.sessionId ??
        (this.currentSessionId !== null ? this.currentSessionId : undefined),
    };
    const record = this.lifecycle.add(model, inputTokens, outputTokens, effective);
    const session = effective.sessionId ? this.sessions.get(effective.sessionId) : undefined;
    if (session) {
      (session as TokenUsageSession & { recordCount: number }).recordCount += 1;
    }
    return record;
  }

  /**
   * Begins a new tracked session and returns a scoped handle.
   *
   * The handle's query engine aggregates only records bound to the session
   * id. Beginning a new session does not end the previous one; it becomes the
   * new active session for {@link record} calls that omit `sessionId`.
   *
   * @param sessionId - The session identifier. Defaults to a generated id.
   * @returns The new session handle. Beginning a session id that already
   * exists returns the existing handle.
   */
  beginSession(sessionId?: string): TokenUsageSession {
    const id = sessionId ?? `session-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const existing = this.sessions.get(id);
    if (existing) {
      this.currentSessionId = id;
      return existing;
    }
    const session: TokenUsageSession = {
      sessionId: id,
      startedAt: Date.now(),
      query: new TokenUsageQuery(this.store, this.config),
      recordCount: 0,
    };
    this.sessions.set(id, session);
    this.currentSessionId = id;
    return session;
  }

  /**
   * Ends the given session (or the active one when no id is supplied) and
   * removes it from the active set.
   *
   * The underlying records are kept in the store; only the scoped handle is
   * discarded. After ending the active session, {@link record} calls without
   * an explicit `sessionId` are no longer attributed to it.
   *
   * @param sessionId - The session to end. Defaults to the active session.
   * @returns `true` when a session was ended.
   */
  endSession(sessionId?: string): boolean {
    const id = sessionId ?? this.currentSessionId;
    if (id === null || !this.sessions.delete(id)) {
      return false;
    }
    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }
    return true;
  }

  /**
   * Returns the session handle for a session id, if still active.
   *
   * @param sessionId - The session identifier.
   * @returns The handle, or `undefined` when the session is not active.
   */
  getSession(sessionId: string): TokenUsageSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Returns a query engine scoped to a single session, regardless of whether
   * the session is currently active.
   *
   * @param sessionId - The session identifier.
   * @returns A query engine that aggregates only that session's records.
   */
  sessionQuery(sessionId: string): TokenUsageQuery {
    return new TokenUsageQuery(this.scopedRecords(sessionId), this.config);
  }

  /**
   * Computes a summary of token usage for a single session.
   *
   * @param sessionId - The session identifier.
   * @returns The session's totals, or an empty total set when the session has
   * no records.
   */
  sessionSummary(sessionId: string): ReturnType<TokenUsageQuery['sessionUsage']> {
    return this.sessionQuery(sessionId).sessionUsage(sessionId);
  }

  /**
   * Returns an overall summary of token usage across every record.
   *
   * @returns The grand total and per-model totals.
   */
  summary(): { grandTotal: ReturnType<TokenUsageQuery['grandTotal']>; byModel: ReturnType<TokenUsageQuery['totalsByModel']> } {
    const query = this.lifecycle.getQuery();
    return { grandTotal: query.grandTotal(), byModel: query.totalsByModel() };
  }

  /**
   * Serializes the entire store to a JSON string.
   *
   * @param space - Optional pretty-print indentation.
   * @returns The JSON snapshot string.
   */
  toJSONString(space?: number): string {
    return this.store.toJSONString(space);
  }

  /**
   * Loads records from a JSON snapshot produced by {@link toJSONString},
   * merging into the current store.
   *
   * @param json - The snapshot payload.
   * @returns The number of records loaded.
   */
  loadJSON(json: string): number {
    const snapshot = JSON.parse(json) as { records?: TokenUsageRecord[] };
    let count = 0;
    for (const record of snapshot.records ?? []) {
      this.lifecycle.record(record);
      count += 1;
    }
    return count;
  }

  /**
   * Prunes records older than the retention window.
   *
   * @param olderThanMs - Optional age override; defaults to the configured
   * retention window.
   * @returns The prune result.
   */
  prune(olderThanMs?: number): ReturnType<TokenUsageLifecycle['prune']> {
    return this.lifecycle.prune(olderThanMs);
  }

  /**
   * Starts the periodic rollup interval.
   *
   * @returns `this` for chaining.
   */
  start(): this {
    this.lifecycle.start();
    return this;
  }

  /**
   * Stops the periodic rollup interval.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    this.lifecycle.stop();
    return this;
  }

  /**
   * Removes every record and session from the tracker.
   */
  reset(): void {
    this.lifecycle.reset();
    this.sessions.clear();
    this.currentSessionId = null;
  }

  /**
   * Returns the underlying store for advanced usage.
   *
   * @returns The store instance.
   */
  getStore(): TokenUsageStore {
    return this.store;
  }

  /**
   * Returns the underlying index for advanced usage.
   *
   * @returns The index instance.
   */
  getIndex(): TokenUsageIndex {
    return this.index;
  }

  /**
   * Returns the lifecycle manager, exposing typed events.
   *
   * @returns The lifecycle instance.
   */
  getLifecycle(): TokenUsageLifecycle {
    return this.lifecycle;
  }

  /**
   * Returns the ids of all sessions ever begun (active or ended).
   *
   * @returns An array of session ids.
   */
  sessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Returns the records bound to a session by scanning the store.
   *
   * @param sessionId - The session identifier.
   * @returns A new array of matching records.
   */
  private scopedRecords(sessionId: string): TokenUsageRecord[] {
    const matches: TokenUsageRecord[] = [];
    for (const record of this.store.values()) {
      if (record.sessionId === sessionId) {
        matches.push(record);
      }
    }
    return matches;
  }
}

/**
 * A buffering {@link TokenUsageCollector} that forwards records to a sink.
 *
 * Records handed to {@link collect} are queued in an internal buffer and only
 * forwarded when {@link flush} is called or when the buffer reaches its
 * {@link flushThreshold} watermark. This allows high-frequency telemetry to be
 * batched into coarse-grained writes without losing data.
 */
export class TokenUsageAdapter implements TokenUsageCollector {
  /** Internal buffer of records awaiting flush. */
  private readonly buffer: TokenUsageRecord[] = [];

  /** Sink that receives flushed records. */
  private readonly sink: (records: TokenUsageRecord[]) => void;

  /** Maximum buffered records before an automatic flush is triggered. */
  private readonly flushThreshold: number;

  /** Lifetime count of records collected. */
  private collected = 0;

  /** Total number of flushes performed. */
  private flushes = 0;

  /**
   * Creates an adapter.
   *
   * @param sink - Function invoked with the drained buffer on each flush.
   * @param options - Optional threshold control. `flushThreshold` defaults to
   * 100 records.
   */
  constructor(
    sink: (records: TokenUsageRecord[]) => void,
    options: { flushThreshold?: number } = {},
  ) {
    this.sink = sink;
    this.flushThreshold = Math.max(1, options.flushThreshold ?? 100);
  }

  /**
   * Buffers a record, auto-flushing when the buffer reaches its watermark.
   *
   * @param record - The record to collect.
   */
  collect(record: TokenUsageRecord): void {
    this.buffer.push(record);
    this.collected += 1;
    if (this.buffer.length >= this.flushThreshold) {
      this.flush();
    }
  }

  /**
   * Drains the buffer into the sink and returns the flushed records.
   *
   * @returns The records that were flushed.
   */
  flush(): TokenUsageRecord[] {
    if (this.buffer.length === 0) {
      return [];
    }
    const drained = this.buffer.splice(0, this.buffer.length);
    this.flushes += 1;
    this.sink(drained);
    return drained;
  }

  /**
   * Returns the number of records currently buffered.
   *
   * @returns The buffered count.
   */
  bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Returns the number of records collected over the adapter's lifetime.
   *
   * @returns The lifetime count.
   */
  totalCollected(): number {
    return this.collected;
  }

  /**
   * Returns the number of flushes performed.
   *
   * @returns The flush count.
   */
  flushCount(): number {
    return this.flushes;
  }
}

/**
 * Assembles a fully-wired {@link TokenUsageAdapter} that flushes into a fresh
 * {@link TokenUsageStore}.
 *
 * @param config - Optional configuration for the destination store.
 * @returns An object with the adapter and its destination store.
 */
export function createTokenUsageAdapter(
  config?: Partial<TokenUsageConfig>,
): { adapter: TokenUsageAdapter; store: TokenUsageStore } {
  const store = new TokenUsageStore(config);
  const adapter = new TokenUsageAdapter((records) => {
    for (const record of records) {
      store.record(record);
    }
  });
  return { adapter, store };
}

/**
 * Assembles a fully-wired {@link TokenUsageTracker} with an optional lifecycle
 * and configuration.
 *
 * @param config - Optional configuration overrides.
 * @param lifecycle - Optional lifecycle to own.
 * @returns A ready-to-use tracker.
 */
export function createTokenUsageTracker(
  config?: Partial<TokenUsageConfig>,
  lifecycle?: TokenUsageLifecycle,
): TokenUsageTracker {
  return new TokenUsageTracker(lifecycle, config);
}

/**
 * Re-export of the default config so integration consumers can spread it when
 * composing custom configurations.
 */
export { DEFAULT_TOKEN_USAGE_CONFIG };