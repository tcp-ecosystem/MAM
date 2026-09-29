/**
 * lifecycle.ts
 *
 * Lifecycle management for the MCP protocol message pipeline.
 *
 * The {@link ProtocolLifecycle} class ties together the message store and the
 * method index with operational concerns: it records every frame as it is sent
 * or received, keeps the index in lock-step, emits typed events for
 * observability, and runs an optional periodic garbage-collection timer that
 * prunes the message log so long-running servers and clients do not leak
 * memory.
 *
 * Typical usage:
 *
 * ```ts
 * const lifecycle = new ProtocolLifecycle({ maxMessages: 1000, gcIntervalMs: 60_000 });
 * lifecycle.onSent((message, stored) => logger.debug('sent', stored.seq));
 * lifecycle.onError((error) => logger.error(error.message));
 * lifecycle.send(createRequestMessage(codec.newRequestId(), MCP_METHODS.ping));
 * lifecycle.stop();
 * ```
 *
 * Events are emitted on the standard Node `EventEmitter` surface, but typed
 * convenience hooks (`onSent`, `onReceived`, `onError`, `onPruned`, `onStart`,
 * `onStop`) are provided so consumers do not need stringly-typed listeners.
 *
 * @module protocol/lifecycle
 */

import { EventEmitter } from 'node:events';
import {
  MESSAGE_TYPES,
  type MessageType,
  type ProtocolMessage,
  type RequestId,
} from './types.js';
import { MessageStore, type MessageStoreStats, type StoredMessage } from './store.js';
import { MethodIndex, type IndexedEntry, type MethodIndexStats } from './index.js';

/**
 * The event names emitted by {@link ProtocolLifecycle}.
 */
export type ProtocolLifecycleEvent = 'sent' | 'received' | 'error' | 'pruned' | 'start' | 'stop';

/**
 * Configuration options for {@link ProtocolLifecycle}.
 */
export interface ProtocolLifecycleOptions {
  /**
   * Maximum number of messages retained by the message log before pruning
   * kicks in (via {@link ProtocolLifecycle.prune}). Defaults to `1000`.
   */
  readonly maxMessages?: number;
  /**
   * Interval (milliseconds) between periodic GC passes. Pass `0` to disable
   * the timer entirely; pruning can still be triggered manually. Defaults to
   * `30_000`.
   */
  readonly gcIntervalMs?: number;
  /**
   * Start the periodic GC timer immediately upon construction. Defaults to
   * `false`; call {@link ProtocolLifecycle.start} explicitly.
   */
  readonly autoStart?: boolean;
  /**
   * Optional pre-built store to adopt instead of creating a fresh one.
   */
  readonly store?: MessageStore;
  /**
   * Optional pre-built index to adopt instead of creating a fresh one.
   */
  readonly index?: MethodIndex;
}

/**
 * A point-in-time snapshot of the lifecycle's operational state.
 */
export interface ProtocolLifecycleStats {
  /** Whether the periodic GC timer is currently running. */
  readonly running: boolean;
  /** Epoch ms at which the lifecycle was constructed. */
  readonly createdAt: number;
  /** Epoch ms of the most recent `start()`, or `undefined` when never started. */
  readonly startedAt?: number;
  /** Epoch ms of the most recent `stop()`, or `undefined` when never stopped. */
  readonly stoppedAt?: number;
  /** Number of times the lifecycle has been started. */
  readonly startCount: number;
  /** Number of times `prune()` removed entries. */
  readonly pruneCount: number;
  /** Total number of entries removed by pruning. */
  readonly prunedTotal: number;
  /** The configured GC interval, in milliseconds. */
  readonly gcIntervalMs: number;
  /** The configured message-retention cap. */
  readonly maxMessages: number;
  /** Store statistics. */
  readonly store: MessageStoreStats;
  /** Index statistics. */
  readonly index: MethodIndexStats;
}

/**
 * Manages the message store, the method index, periodic GC and typed events
 * for one side of an MCP connection.
 *
 * The class extends `EventEmitter` and is safe to `stop()` and re-`start()`
 * repeatedly. It is designed to be the single owner of store/index mutation:
 * external code should go through `send`/`receive`/`prune`/`clear` so that the
 * index and events always stay consistent.
 */
export class ProtocolLifecycle extends EventEmitter {
  /** The underlying message log. */
  private readonly _store: MessageStore;
  /** The lookup index kept in lock-step with the log. */
  private readonly _index: MethodIndex;
  /** Retention cap for automatic pruning. */
  private readonly _maxMessages: number;
  /** Periodic GC interval, milliseconds. `0` disables the timer. */
  private readonly _gcIntervalMs: number;

  /** Timer handle for the periodic GC pass, when running. */
  private _timer: ReturnType<typeof setInterval> | undefined;
  /** Whether the periodic GC is active. */
  private _running = false;
  /** Creation timestamp. */
  private readonly _createdAt: number;
  /** Timestamp of the most recent `start()`. */
  private _startedAt: number | undefined;
  /** Timestamp of the most recent `stop()`. */
  private _stoppedAt: number | undefined;
  /** Number of `start()` calls. */
  private _startCount = 0;
  /** Number of pruning passes that actually removed entries. */
  private _pruneCount = 0;
  /** Total entries removed by pruning. */
  private _prunedTotal = 0;

  /**
   * Create a lifecycle, optionally adopting an existing store/index and
   * starting the periodic GC timer immediately.
   *
   * @param options - configuration; see {@link ProtocolLifecycleOptions}.
   */
  constructor(options: ProtocolLifecycleOptions = {}) {
    super();
    this._store = options.store ?? new MessageStore();
    this._index = options.index ?? new MethodIndex();
    this._maxMessages = options.maxMessages ?? 1000;
    this._gcIntervalMs = options.gcIntervalMs ?? 30_000;
    this._createdAt = Date.now();

    if (this._store.size() > 0) {
      this._rebuildIndexFromStore();
    }
    if (options.autoStart === true) {
      this.start();
    }
  }

  /**
   * The underlying {@link MessageStore}.
   *
   * @returns the store.
   */
  get store(): MessageStore {
    return this._store;
  }

  /**
   * The underlying {@link MethodIndex}.
   *
   * @returns the index.
   */
  get index(): MethodIndex {
    return this._index;
  }

  /**
   * Whether the periodic GC timer is currently running.
   *
   * @returns `true` when running.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * Start the periodic GC timer (no-op when already running, or when
   * `gcIntervalMs` is `0`). Emits the `start` event.
   *
   * @returns `this` for chaining.
   */
  start(): this {
    if (this._running) {
      return this;
    }
    this._running = true;
    this._startCount += 1;
    this._startedAt = Date.now();
    if (this._gcIntervalMs > 0) {
      const timer = setInterval(() => {
        this.prune();
      }, this._gcIntervalMs);
      if (typeof timer === 'object' && typeof timer.unref === 'function') {
        timer.unref();
      }
      this._timer = timer;
    }
    this.emit('start');
    return this;
  }

  /**
   * Stop the periodic GC timer (no-op when not running). Emits the `stop`
   * event.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (!this._running) {
      return this;
    }
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    this._running = false;
    this._stoppedAt = Date.now();
    this.emit('stop');
    return this;
  }

  /**
   * Record a frame as *sent* by this side: append it to the store, index it,
   * and emit the `sent` event.
   *
   * @param message - the normalized protocol message.
   * @returns the stored entry.
   */
  send(message: ProtocolMessage): StoredMessage {
    const stored = this._store.append(message, 'sent');
    this._index.indexMessage(stored.seq, message);
    this.emit('sent', message, stored);
    return stored;
  }

  /**
   * Record a frame as *received* from the peer: append it to the store, index
   * it, and emit the `received` event.
   *
   * @param message - the normalized protocol message.
   * @returns the stored entry.
   */
  receive(message: ProtocolMessage): StoredMessage {
    const stored = this._store.append(message, 'received');
    this._index.indexMessage(stored.seq, message);
    this.emit('received', message, stored);
    return stored;
  }

  /**
   * Record a frame with an explicit direction. Convenience wrapper over
   * {@link ProtocolLifecycle.send} / {@link ProtocolLifecycle.receive}.
   *
   * @param direction - the direction of travel.
   * @param message - the normalized protocol message.
   * @returns the stored entry.
   */
  record(direction: 'sent' | 'received', message: ProtocolMessage): StoredMessage {
    return direction === 'sent' ? this.send(message) : this.receive(message);
  }

  /**
   * Report a protocol error. Emits the `error` event with the failure (and,
   * when known, the message it relates to). Note that `error` follows Node's
   * special semantics: when no `error` listener is attached, the event will
   * throw.
   *
   * @param error - the failure to report.
   * @param message - optional related protocol message.
   * @returns `this` for chaining.
   */
  fail(error: Error, message?: ProtocolMessage): this {
    this.emit('error', error, message);
    return this;
  }

  /**
   * Prune the message log so that at most `maxMessages` entries remain. Keeps
   * the index consistent by evicting the pruned sequences, and emits the
   * `pruned` event when entries were removed.
   *
   * @param maxMessages - the retention cap; defaults to the configured
   *   `maxMessages`.
   * @returns the number of removed entries.
   */
  prune(maxMessages?: number): number {
    const cap = maxMessages ?? this._maxMessages;
    const before = this._store.size();
    const pruned = this._store.prune(cap);
    if (pruned > 0) {
      const survivors = this._store.getAll();
      this._index.rebuild(survivors.map((entry): IndexedEntry => ({ seq: entry.seq, message: entry.message })));
      this._pruneCount += 1;
      this._prunedTotal += pruned;
      this.emit('pruned', pruned, this._store.size());
    }
    void before;
    return pruned;
  }

  /**
   * Clear the message log and the index. Sequence numbers are not reset
   * (monotonicity is preserved), and no events are emitted.
   */
  clear(): void {
    this._store.clear();
    this._index.clear();
  }

  /**
   * Full reset: clear the log/index and re-seed from an optional set of
   * entries. Equivalent to calling {@link ProtocolLifecycle.clear} followed by
   * re-indexing.
   *
   * @param entries - optional entries to seed the reset log with.
   */
  reset(entries?: Iterable<IndexedEntry>): void {
    this._store.clear();
    this._index.clear();
    if (entries !== undefined) {
      for (const entry of entries) {
        this._store.append(entry.message, 'received');
        this._index.indexMessage(entry.seq, entry.message);
      }
    }
  }

  /**
   * Count of outstanding request ids (requests without a matching
   * response/error).
   *
   * @returns the number of pending requests.
   */
  pendingCount(): number {
    return this._store.pendingCount();
  }

  /**
   * The outstanding request ids, in the order their requests were logged.
   *
   * @returns the pending request ids.
   */
  pendingRequests(): RequestId[] {
    return this._store.pendingRequests();
  }

  /**
   * Aggregate operational statistics.
   *
   * @returns a {@link ProtocolLifecycleStats} snapshot.
   */
  stats(): ProtocolLifecycleStats {
    return {
      running: this._running,
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      stoppedAt: this._stoppedAt,
      startCount: this._startCount,
      pruneCount: this._pruneCount,
      prunedTotal: this._prunedTotal,
      gcIntervalMs: this._gcIntervalMs,
      maxMessages: this._maxMessages,
      store: this._store.stats(),
      index: this._index.stats(),
    };
  }

  /**
   * Tear the lifecycle down: stop the timer and clear all state. Equivalent to
   * `stop()` followed by {@link ProtocolLifecycle.clear}.
   */
  dispose(): void {
    this.stop();
    this.clear();
  }

  /**
   * Rebuild the method index from the current store contents. Called once in
   * the constructor when a pre-populated store is adopted.
   */
  private _rebuildIndexFromStore(): void {
    const entries: IndexedEntry[] = [];
    for (const stored of this._store) {
      entries.push({ seq: stored.seq, message: stored.message });
    }
    this._index.rebuild(entries);
  }

  /**
   * Typed hook for the `sent` event.
   *
   * @param listener - callback receiving the message and its stored entry.
   * @returns `this` for chaining.
   */
  onSent(listener: (message: ProtocolMessage, stored: StoredMessage) => void): this {
    return this.on('sent', listener);
  }

  /**
   * Typed hook for the `received` event.
   *
   * @param listener - callback receiving the message and its stored entry.
   * @returns `this` for chaining.
   */
  onReceived(listener: (message: ProtocolMessage, stored: StoredMessage) => void): this {
    return this.on('received', listener);
  }

  /**
   * Typed hook for the `error` event.
   *
   * @param listener - callback receiving the failure and, when known, the
   *   related message.
   * @returns `this` for chaining.
   */
  onError(listener: (error: Error, message?: ProtocolMessage) => void): this {
    return this.on('error', listener);
  }

  /**
   * Typed hook for the `pruned` event.
   *
   * @param listener - callback receiving the removed count and the remaining
   *   count.
   * @returns `this` for chaining.
   */
  onPruned(listener: (removed: number, remaining: number) => void): this {
    return this.on('pruned', listener);
  }

  /**
   * Typed hook for the `start` event.
   *
   * @param listener - callback invoked when the periodic GC starts.
   * @returns `this` for chaining.
   */
  onStart(listener: () => void): this {
    return this.on('start', listener);
  }

  /**
   * Typed hook for the `stop` event.
   *
   * @param listener - callback invoked when the periodic GC stops.
   * @returns `this` for chaining.
   */
  onStop(listener: () => void): this {
    return this.on('stop', listener);
  }

  // ---- Typed EventEmitter overloads --------------------------------------

  /**
   * Register a listener for a lifecycle event.
   *
   * @param event - the event name.
   * @param listener - the callback.
   * @returns `this` for chaining.
   */
  override on(
    event: 'sent',
    listener: (message: ProtocolMessage, stored: StoredMessage) => void,
  ): this;
  override on(
    event: 'received',
    listener: (message: ProtocolMessage, stored: StoredMessage) => void,
  ): this;
  override on(
    event: 'error',
    listener: (error: Error, message?: ProtocolMessage) => void,
  ): this;
  override on(
    event: 'pruned',
    listener: (removed: number, remaining: number) => void,
  ): this;
  override on(event: 'start' | 'stop', listener: () => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Emit a lifecycle event.
   *
   * @param event - the event name.
   * @param args - event payload arguments.
   * @returns `true` when the event had listeners.
   */
  override emit(event: 'sent', message: ProtocolMessage, stored: StoredMessage): boolean;
  override emit(event: 'received', message: ProtocolMessage, stored: StoredMessage): boolean;
  override emit(event: 'error', error: Error, message?: ProtocolMessage): boolean;
  override emit(event: 'pruned', removed: number, remaining: number): boolean;
  override emit(event: 'start' | 'stop'): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Validate a lifecycle event name.
 *
 * @param value - the event name to validate.
 * @returns `true` when `value` is a known lifecycle event.
 */
export function isLifecycleEvent(value: unknown): value is ProtocolLifecycleEvent {
  return (
    typeof value === 'string' &&
    (value === 'sent' ||
      value === 'received' ||
      value === 'error' ||
      value === 'pruned' ||
      value === 'start' ||
      value === 'stop')
  );
}

/**
 * Validate a {@link MessageType} label (re-exported for lifecycle consumers
 * that inspect store/index buckets).
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is a valid message type.
 */
export function isValidMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && MESSAGE_TYPES.indexOf(value as MessageType) !== -1;
}