/**
 * retrieval.ts — `RequestCorrelator`: correlates outgoing requests with incoming responses.
 *
 * MCP is a JSON-RPC 2.0 protocol: every request carries an `id`, and the peer echoes that
 * `id` back on the response. The {@link RequestCorrelator} is the client-side bookkeeping
 * core that maps those ids to the promises awaiting the results:
 *
 *  - {@link RequestCorrelator.send} registers a pending entry (keyed by id) and returns a
 *    promise that settles exactly once — either when {@link RequestCorrelator.resolve} is
 *    called with the response value, or when {@link RequestCorrelator.reject} is called
 *    with the failure.
 *  - {@link RequestCorrelator.timeoutPending} sweeps entries whose age exceeds a threshold
 *    and rejects them, so stale requests can never hang forever.
 *  - {@link RequestCorrelator.clear} settles every outstanding entry with a cancellation
 *    error and empties the map (used on connection close).
 *
 * Each entry also carries an optional per-request timeout that arms a real timer; the
 * `timeoutPending` sweep is the belt-and-braces fallback for entries that were registered
 * without a timer (or whose timer was missed). Settling a promise more than once is
 * impossible: resolve/reject are idempotent and guarded by the map membership check.
 *
 * @module client/retrieval
 */

import {
  JsonRpcErrorCode,
  McpClientError,
} from "./types.js";

/**
 * A request id as used by JSON-RPC. The correlator accepts numbers and strings; `null` ids
 * are reserved for error responses and never registered as pending.
 */
export type RequestId = number | string;

/**
 * The input shape accepted by {@link RequestCorrelator.send}.
 */
export interface PendingRequest {
  /** The unique request id to key the pending entry by. */
  id: RequestId;
  /** The JSON-RPC method this request targets (for stats and error context). */
  method: string;
  /** Optional request parameters retained for diagnostics. */
  params?: unknown;
  /** Optional per-request timeout in ms; arms a real timer that auto-rejects. */
  timeoutMs?: number;
}

/**
 * The stored bookkeeping record behind a pending request.
 */
export interface PendingEntry {
  /** The request id. */
  id: RequestId;
  /** The JSON-RPC method the request targets. */
  method: string;
  /** Optional request parameters. */
  params?: unknown;
  /** Epoch ms at which the request was registered. */
  sentAt: number;
  /** Optional per-request timeout in ms. */
  timeoutMs?: number;
  /** The promise that settles when the response (or failure) arrives. */
  promise: Promise<unknown>;
  /** The resolve function of {@link PendingEntry.promise}. */
  resolve: (value: unknown) => void;
  /** The reject function of {@link PendingEntry.promise}. */
  reject: (reason: Error) => void;
  /** Real timer handle armed for the per-request timeout, when configured. */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * A read-only view of a pending entry, safe to hand to observability code.
 */
export interface PendingEntryView {
  id: RequestId;
  method: string;
  params?: unknown;
  sentAt: number;
  timeoutMs?: number;
  /** Milliseconds the entry has been pending as of the snapshot. */
  ageMs: number;
}

/**
 * Aggregate statistics for the correlator.
 */
export interface RequestCorrelatorStats {
  /** Total requests ever registered via `send`. */
  totalSent: number;
  /** Total requests settled via `resolve`. */
  totalResolved: number;
  /** Total requests settled via `reject`. */
  totalRejected: number;
  /** Total requests auto-rejected by their per-request timer or `timeoutPending`. */
  totalTimedOut: number;
  /** Total requests cancelled by {@link RequestCorrelator.clear}. */
  totalCancelled: number;
  /** Requests currently pending a response. */
  pending: number;
  /** Ids of currently pending requests, oldest-first. */
  pendingIds: RequestId[];
  /** Epoch ms the correlator was constructed. */
  createdAt: number;
  /** Epoch ms of the most recent activity. */
  lastActivityAt: number;
  /** Average age (ms) of currently pending requests. */
  averagePendingAgeMs: number;
}

/**
 * RequestCorrelator — id-keyed registry of in-flight JSON-RPC requests and their promises.
 */
export class RequestCorrelator {
  /** Pending entries keyed by request id. */
  private readonly _pending: Map<string, PendingEntry>;
  /** Total requests registered. */
  private _totalSent = 0;
  /** Total requests resolved. */
  private _totalResolved = 0;
  /** Total requests rejected. */
  private _totalRejected = 0;
  /** Total requests timed out. */
  private _totalTimedOut = 0;
  /** Total requests cancelled by clear(). */
  private _totalCancelled = 0;
  /** Epoch ms the correlator was constructed. */
  private readonly _createdAt: number;
  /** Epoch ms of the most recent activity. */
  private _lastActivityAt = 0;

  /**
   * Construct an empty correlator.
   */
  constructor() {
    this._pending = new Map<string, PendingEntry>();
    this._createdAt = Date.now();
  }

  /**
   * The string key used internally for a request id. Numbers and strings are namespaced so
   * `1` and `"1"` can never collide.
   */
  private _key(id: RequestId): string {
    return `${typeof id === "number" ? "n" : "s"}:${id}`;
  }

  /**
   * Number of requests currently pending a response.
   */
  get size(): number {
    return this._pending.size;
  }

  /**
   * Total requests registered since construction.
   */
  get totalSent(): number {
    return this._totalSent;
  }

  /**
   * Whether a request id currently has a pending entry.
   */
  has(id: RequestId): boolean {
    return this._pending.has(this._key(id));
  }

  /**
   * Register a pending request and return a promise that settles when the matching response
   * arrives (via {@link RequestCorrelator.resolve}) or fails (via
   * {@link RequestCorrelator.reject} / timeout / {@link RequestCorrelator.clear}).
   *
   * A per-request `timeoutMs` arms a real timer: when it fires and the entry is still
   * pending, the promise is rejected with a timeout {@link McpClientError}. Registering the
   * same id twice throws, since the correlation contract is one-to-one.
   *
   * @param request The pending request descriptor.
   * @returns A promise for the eventual response value.
   */
  send(request: PendingRequest): Promise<unknown> {
    if (request === null || typeof request !== "object") {
      throw new TypeError("RequestCorrelator.send: expected a pending request object");
    }
    const id = request.id;
    if (id === null || id === undefined) {
      throw new TypeError("RequestCorrelator.send: request id must be a number or string");
    }
    if (typeof request.method !== "string" || request.method.length === 0) {
      throw new TypeError("RequestCorrelator.send: method must be a non-empty string");
    }
    const key = this._key(id);
    if (this._pending.has(key)) {
      throw new Error(`RequestCorrelator.send: request id "${id}" is already pending`);
    }

    const sentAt = Date.now();
    let resolveFn: (value: unknown) => void = () => undefined;
    let rejectFn: (reason: Error) => void = () => undefined;
    const promise = new Promise<unknown>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
    });

    const entry: PendingEntry = {
      id,
      method: request.method,
      params: request.params,
      sentAt,
      timeoutMs: request.timeoutMs,
      promise,
      resolve: resolveFn,
      reject: rejectFn,
    };

    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      entry.timer = setTimeout(() => {
        this.timeoutEntry(id, request.timeoutMs as number);
      }, request.timeoutMs);
      if (typeof (entry.timer as ReturnType<typeof setTimeout>).unref === "function") {
        (entry.timer as ReturnType<typeof setTimeout>).unref?.();
      }
    }

    this._pending.set(key, entry);
    this._totalSent += 1;
    this._lastActivityAt = sentAt;
    return promise;
  }

  /**
   * Settle a pending request with a successful result.
   *
   * @param id The request id.
   * @param result The response value.
   * @returns True when a pending entry existed and was settled.
   */
  resolve(id: RequestId, result: unknown): boolean {
    const entry = this._pending.get(this._key(id));
    if (entry === undefined) {
      return false;
    }
    this._settle(entry, () => entry.resolve(result), "resolved");
    return true;
  }

  /**
   * Settle a pending request with a failure.
   *
   * @param id The request id.
   * @param error The failure to reject with. Accepts `Error`-like objects or plain values.
   * @returns True when a pending entry existed and was settled.
   */
  reject(id: RequestId, error: unknown): boolean {
    const entry = this._pending.get(this._key(id));
    if (entry === undefined) {
      return false;
    }
    this._settle(entry, () => entry.reject(this._toError(error, entry)), "rejected");
    return true;
  }

  /**
   * Reject a single pending entry for exceeding its timeout. Used both by the per-request
   * timer and by the {@link RequestCorrelator.timeoutPending} sweep.
   *
   * @param id The request id.
   * @param timeoutMs The timeout that was exceeded (for diagnostics).
   * @returns True when a pending entry existed and was timed out.
   */
  timeoutEntry(id: RequestId, timeoutMs: number): boolean {
    const entry = this._pending.get(this._key(id));
    if (entry === undefined) {
      return false;
    }
    this._settle(
      entry,
      () =>
        entry.reject(
          new McpClientError(
            JsonRpcErrorCode.InternalError,
            `RequestCorrelator: request "${entry.method}" (id ${id}) timed out after ${timeoutMs}ms`,
            { method: entry.method },
          ),
        ),
      "timedOut",
    );
    return true;
  }

  /**
   * Settle an entry exactly once: remove it from the map, clear its timer, bump the
   * relevant counter and touch the activity timestamp.
   */
  private _settle(
    entry: PendingEntry,
    settle: () => void,
    kind: "resolved" | "rejected" | "timedOut" | "cancelled",
  ): void {
    this._pending.delete(this._key(entry.id));
    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }
    if (kind === "resolved") this._totalResolved += 1;
    else if (kind === "rejected") this._totalRejected += 1;
    else if (kind === "timedOut") this._totalTimedOut += 1;
    else this._totalCancelled += 1;
    settle();
    this._lastActivityAt = Date.now();
  }

  /**
   * Normalise an arbitrary thrown value into an `Error`. JSON-RPC error objects are
   * upgraded to a descriptive {@link McpClientError}; `Error` instances pass through.
   */
  private _toError(value: unknown, entry: PendingEntry): Error {
    if (value instanceof Error) {
      return value;
    }
    if (value !== null && typeof value === "object") {
      const v = value as { code?: unknown; message?: unknown; data?: unknown };
      if (typeof v.code === "number" && typeof v.message === "string") {
        return new McpClientError(v.code, v.message, {
          data: v.data,
          method: entry.method,
        });
      }
    }
    return new McpClientError(
      JsonRpcErrorCode.InternalError,
      `RequestCorrelator: request "${entry.method}" (id ${entry.id}) failed: ${String(value)}`,
      { method: entry.method },
    );
  }

  /**
   * Read a pending entry by id without settling it.
   *
   * @returns A snapshot view of the entry, or `undefined`.
   */
  get(id: RequestId): PendingEntryView | undefined {
    const entry = this._pending.get(this._key(id));
    if (entry === undefined) {
      return undefined;
    }
    const view: PendingEntryView = {
      id: entry.id,
      method: entry.method,
      params: entry.params,
      sentAt: entry.sentAt,
      timeoutMs: entry.timeoutMs,
      ageMs: Date.now() - entry.sentAt,
    };
    return view;
  }

  /**
   * The current pending request ids, oldest-first.
   */
  ids(): RequestId[] {
    const out: RequestId[] = [];
    for (const entry of this._pending.values()) {
      out.push(entry.id);
    }
    return out;
  }

  /**
   * Snapshot of every pending entry, oldest-first.
   */
  all(): PendingEntryView[] {
    const out: PendingEntryView[] = [];
    const now = Date.now();
    for (const entry of this._pending.values()) {
      out.push({
        id: entry.id,
        method: entry.method,
        params: entry.params,
        sentAt: entry.sentAt,
        timeoutMs: entry.timeoutMs,
        ageMs: now - entry.sentAt,
      });
    }
    return out;
  }

  /**
   * A summary of the pending set: the count and the ids, oldest-first. This is the primary
   * observability surface for "is anything stuck?" checks.
   */
  pending(): { count: number; ids: RequestId[] } {
    return { count: this._pending.size, ids: this.ids() };
  }

  /**
   * Reject every pending entry older than the given timeout. This is the sweep fallback for
   * entries that may have missed their per-request timer (for example because the timeout
   * was configured at the client level rather than per-request).
   *
   * @param timeoutMs Entries older than this many milliseconds are rejected.
   * @returns The number of entries timed out by the sweep.
   */
  timeoutPending(timeoutMs: number): number {
    if (typeof timeoutMs !== "number" || timeoutMs < 0) {
      throw new TypeError("RequestCorrelator.timeoutPending: timeoutMs must be a non-negative number");
    }
    const now = Date.now();
    let timedOut = 0;
    for (const entry of [...this._pending.values()]) {
      if (now - entry.sentAt > timeoutMs) {
        if (this.timeoutEntry(entry.id, timeoutMs)) {
          timedOut += 1;
        }
      }
    }
    return timedOut;
  }

  /**
   * Reject every pending entry with a cancellation error and empty the map. Called by the
   * lifecycle facade on connection close so no caller is left hanging.
   *
   * @returns The number of entries cancelled.
   */
  clear(): number {
    const cancelled = this._pending.size;
    for (const entry of [...this._pending.values()]) {
      this._settle(
        entry,
        () =>
          entry.reject(
            new McpClientError(
              JsonRpcErrorCode.InvalidRequest,
              `RequestCorrelator: request "${entry.method}" (id ${entry.id}) cancelled — connection closed`,
              { method: entry.method },
            ),
          ),
        "cancelled",
      );
    }
    return cancelled;
  }

  /**
   * Aggregate statistics for this correlator.
   */
  stats(): RequestCorrelatorStats {
    const now = Date.now();
    let ageTotal = 0;
    for (const entry of this._pending.values()) {
      ageTotal += now - entry.sentAt;
    }
    const averagePendingAgeMs =
      this._pending.size > 0 ? Math.round(ageTotal / this._pending.size) : 0;
    return {
      totalSent: this._totalSent,
      totalResolved: this._totalResolved,
      totalRejected: this._totalRejected,
      totalTimedOut: this._totalTimedOut,
      totalCancelled: this._totalCancelled,
      pending: this._pending.size,
      pendingIds: this.ids(),
      createdAt: this._createdAt,
      lastActivityAt: this._lastActivityAt,
      averagePendingAgeMs,
    };
  }
}

/**
 * Convenience factory for building an empty correlator.
 */
export function createRequestCorrelator(): RequestCorrelator {
  return new RequestCorrelator();
}