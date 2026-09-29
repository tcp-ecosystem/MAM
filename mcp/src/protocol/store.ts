/**
 * store.ts
 *
 * Append-only message log for the standalone MAM MCP protocol layer.
 *
 * The {@link MessageStore} records every frame that a client or server sends
 * and receives, in arrival order, together with bookkeeping metadata (a
 * monotonic sequence number, the direction of travel, a wall-clock timestamp
 * and the extracted request id / method). Downstream layers build on top of it:
 *
 *   - the {@link MethodIndex} derives its search structures from store entries,
 *   - the {@link ProtocolLifecycle} prunes and resets the store,
 *   - transports can snapshot the log via {@link MessageStore.toJSON} for
 *     debugging, replay or crash recovery.
 *
 * The store is deliberately dependency-light (only the shared `types.ts`
 * module) so it can be embedded in servers, clients or proxies without pulling
 * in any transport or I/O code.
 *
 * @module protocol/store
 */

import {
  DIRECTIONS,
  MESSAGE_TYPES,
  messageId,
  messageMethod,
  type Direction,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type MessageType,
  type ProtocolMessage,
  type RequestId,
} from './types.js';

/**
 * The version tag written into {@link MessageStoreJSON} payloads. Bump this
 * whenever the serialized shape changes so older snapshots can be migrated.
 */
export const STORE_JSON_VERSION = 1 as const;

/**
 * A single logged frame together with its bookkeeping metadata.
 *
 * The `message` field holds the normalized {@link ProtocolMessage}; `id` and
 * `method` are denormalized for cheap filtering without unwrapping the union.
 */
export interface StoredMessage {
  /** Monotonic sequence number; unique within the store and stable forever. */
  readonly seq: number;
  /** Whether this frame was sent by us or received from the peer. */
  readonly direction: Direction;
  /** Wall-clock timestamp at append time, in epoch milliseconds. */
  readonly timestamp: number;
  /** The normalized protocol message. */
  readonly message: ProtocolMessage;
  /** Denormalized request id (requests/responses/errors only). */
  readonly id?: RequestId;
  /** Denormalized method name (requests/notifications only). */
  readonly method?: string;
}

/**
 * Aggregate counters describing the current contents of a store.
 */
export interface MessageStoreStats {
  /** Total number of logged frames. */
  readonly total: number;
  /** Number of request frames. */
  readonly requests: number;
  /** Number of success-response frames. */
  readonly responses: number;
  /** Number of notification frames. */
  readonly notifications: number;
  /** Number of error-response frames. */
  readonly errors: number;
  /** Number of frames sent by us. */
  readonly sent: number;
  /** Number of frames received from the peer. */
  readonly received: number;
  /** Number of request ids still awaiting a matching response/error. */
  readonly pending: number;
  /** Approximate serialized size of the log, in bytes. */
  readonly approximateBytes: number;
  /** Timestamp of the oldest frame, or `undefined` when empty. */
  readonly oldest?: number;
  /** Timestamp of the newest frame, or `undefined` when empty. */
  readonly newest?: number;
}

/**
 * Serializable snapshot of a store, produced by {@link MessageStore.toJSON}
 * and consumed by {@link MessageStore.fromJSON}.
 */
export interface MessageStoreJSON {
  /** Schema version of this snapshot. */
  readonly version: typeof STORE_JSON_VERSION;
  /** The next sequence number to hand out after a restore. */
  readonly nextSeq: number;
  /** The logged frames, oldest first. */
  readonly messages: readonly StoredMessage[];
}

/**
 * Build a fully denormalized {@link StoredMessage} from a protocol message.
 * Internal helper shared by every append path.
 *
 * @param seq - the sequence number to assign.
 * @param direction - whether the frame was sent or received.
 * @param message - the normalized protocol message.
 * @returns a complete stored entry.
 */
export function toStoredMessage(seq: number, direction: Direction, message: ProtocolMessage): StoredMessage {
  const id = messageId(message);
  const method = messageMethod(message);
  const base: StoredMessage = {
    seq,
    direction,
    timestamp: Date.now(),
    message,
  };
  if (id !== undefined && method !== undefined) {
    return { ...base, id, method };
  }
  if (id !== undefined) {
    return { ...base, id };
  }
  if (method !== undefined) {
    return { ...base, method };
  }
  return base;
}

/**
 * Approximate the serialized byte size of a stored message. Used for
 * coarse-grained memory accounting; exact JSON length is not guaranteed.
 *
 * @param stored - the stored entry.
 * @returns an upper-bound byte estimate.
 */
export function estimateStoredMessageBytes(stored: StoredMessage): number {
  let bytes = 0;
  bytes += String(stored.seq).length + String(stored.timestamp).length + stored.direction.length;
  if (stored.id !== undefined) {
    bytes += String(stored.id).length;
  }
  if (stored.method !== undefined) {
    bytes += stored.method.length;
  }
  const frame = JSON.stringify(stored.message);
  if (frame !== undefined) {
    bytes += frame.length;
  }
  return bytes + 64;
}

/**
 * Append-only, in-memory message log for MCP protocol frames.
 *
 * Messages are never mutated or reordered after being appended: `seq` strictly
 * increases, and the backing array is only ever appended to or truncated from
 * the front (pruning). This gives deterministic replay semantics for
 * debugging, test fixtures and transport snapshots.
 */
export class MessageStore {
  /** Backing array of stored entries, oldest first. */
  private readonly _messages: StoredMessage[] = [];
  /** Next sequence number to hand out. */
  private _nextSeq = 1;

  /**
   * Create a message store, optionally seeding it from existing entries or a
   * previous snapshot.
   *
   * @param initial - either an iterable of stored entries (e.g. from another
   *   store) or a full {@link MessageStoreJSON} snapshot. When omitted the
   *   store starts empty.
   */
  constructor(initial?: Iterable<StoredMessage> | MessageStoreJSON) {
    if (initial === undefined) {
      return;
    }
    if (isMessageStoreJSON(initial)) {
      const { nextSeq, messages } = initial;
      if (!Number.isInteger(nextSeq) || nextSeq < 1) {
        throw new TypeError('MessageStore: snapshot nextSeq must be a positive integer');
      }
      this._nextSeq = nextSeq;
      for (const entry of messages) {
        if (!isStoredMessage(entry)) {
          throw new TypeError('MessageStore: snapshot contains an invalid StoredMessage');
        }
        this._messages.push(entry);
      }
      this._assertSequential();
      return;
    }
    for (const entry of initial) {
      if (!isStoredMessage(entry)) {
        throw new TypeError('MessageStore: seed entries must be StoredMessage objects');
      }
      this._messages.push(entry);
      if (entry.seq >= this._nextSeq) {
        this._nextSeq = entry.seq + 1;
      }
    }
    this._assertSequential();
  }

  /**
   * Append a protocol message to the log.
   *
   * @param message - the normalized frame to record.
   * @param direction - whether it was sent or received.
   * @returns the newly created stored entry (with its assigned sequence).
   */
  append(message: ProtocolMessage, direction: Direction): StoredMessage {
    if (DIRECTIONS.indexOf(direction) === -1) {
      throw new TypeError(`MessageStore: unknown direction "${String(direction)}"`);
    }
    const stored = toStoredMessage(this._nextSeq, direction, message);
    this._nextSeq += 1;
    this._messages.push(stored);
    return stored;
  }

  /**
   * Convenience: append a frame as `sent`.
   *
   * @param message - the normalized frame to record.
   * @returns the newly created stored entry.
   */
  appendSent(message: ProtocolMessage): StoredMessage {
    return this.append(message, 'sent');
  }

  /**
   * Convenience: append a frame as `received`.
   *
   * @param message - the normalized frame to record.
   * @returns the newly created stored entry.
   */
  appendReceived(message: ProtocolMessage): StoredMessage {
    return this.append(message, 'received');
  }

  /**
   * Return the stored entry at a zero-based position, or `undefined` when the
   * index is out of range.
   *
   * @param index - zero-based position in the log.
   * @returns the stored entry or `undefined`.
   */
  get(index: number): StoredMessage | undefined {
    return this._messages[index];
  }

  /**
   * Return the stored entry with a given sequence number, or `undefined`.
   *
   * @param seq - the sequence number to look up.
   * @returns the stored entry or `undefined`.
   */
  getBySeq(seq: number): StoredMessage | undefined {
    const index = seq - this._messages[0]?.seq;
    if (index === undefined || index < 0 || index >= this._messages.length) {
      return undefined;
    }
    const candidate = this._messages[index];
    return candidate !== undefined && candidate.seq === seq ? candidate : undefined;
  }

  /**
   * Return the last logged entry, or `undefined` when the log is empty.
   *
   * @returns the newest stored entry or `undefined`.
   */
  last(): StoredMessage | undefined {
    const length = this._messages.length;
    return length === 0 ? undefined : this._messages[length - 1];
  }

  /**
   * Return a defensive copy of every stored entry, oldest first.
   *
   * @returns an array of all stored entries.
   */
  getAll(): StoredMessage[] {
    return this._messages.slice();
  }

  /**
   * Return every entry whose message matches the given type.
   *
   * @param type - the {@link MessageType} to filter by.
   * @returns entries of that type, oldest first.
   */
  getByType(type: MessageType): StoredMessage[] {
    if (MESSAGE_TYPES.indexOf(type) === -1) {
      throw new TypeError(`MessageStore: unknown message type "${String(type)}"`);
    }
    const out: StoredMessage[] = [];
    for (const entry of this._messages) {
      if (entry.message.type === type) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Convenience: return every request entry.
   *
   * @returns request entries, oldest first.
   */
  getRequests(): StoredMessage[] {
    return this.getByType('request');
  }

  /**
   * Convenience: return every success-response entry.
   *
   * @returns response entries, oldest first.
   */
  getResponses(): StoredMessage[] {
    return this.getByType('response');
  }

  /**
   * Convenience: return every notification entry.
   *
   * @returns notification entries, oldest first.
   */
  getNotifications(): StoredMessage[] {
    return this.getByType('notification');
  }

  /**
   * Convenience: return every error-response entry.
   *
   * @returns error entries, oldest first.
   */
  getErrors(): StoredMessage[] {
    return this.getByType('error');
  }

  /**
   * Return every entry with the given direction.
   *
   * @param direction - `'sent'` or `'received'`.
   * @returns matching entries, oldest first.
   */
  getByDirection(direction: Direction): StoredMessage[] {
    const out: StoredMessage[] = [];
    for (const entry of this._messages) {
      if (entry.direction === direction) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Return every entry referencing a given request id (request, its matching
   * response or error response).
   *
   * @param id - the request id to search for.
   * @returns matching entries, oldest first.
   */
  findById(id: RequestId): StoredMessage[] {
    const out: StoredMessage[] = [];
    for (const entry of this._messages) {
      if (entry.id === id) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Return every entry carrying a given method name (requests and
   * notifications only).
   *
   * @param method - the method name to search for.
   * @returns matching entries, oldest first.
   */
  findByMethod(method: string): StoredMessage[] {
    const out: StoredMessage[] = [];
    for (const entry of this._messages) {
      if (entry.method === method) {
        out.push(entry);
      }
    }
    return out;
  }

  /**
   * Compute the set of request ids that have not yet been answered.
   *
   * A request is considered answered when a response or error-response frame
   * carrying the same id appears anywhere in the log. Ids are returned in the
   * order their requests were first logged.
   *
   * @returns the list of outstanding request ids.
   */
  pendingRequests(): RequestId[] {
    const outstanding: RequestId[] = [];
    const answered = new Set<RequestId>();
    for (const entry of this._messages) {
      const id = entry.id;
      if (id === undefined) {
        continue;
      }
      switch (entry.message.type) {
        case 'request':
          if (!answered.has(id)) {
            outstanding.push(id);
          }
          break;
        case 'response':
        case 'error':
          answered.add(id);
          break;
        case 'notification':
          break;
      }
    }
    const pending: RequestId[] = [];
    for (const id of outstanding) {
      if (!answered.has(id)) {
        pending.push(id);
      }
    }
    return pending;
  }

  /**
   * Convenience: number of outstanding request ids.
   *
   * @returns the count of pending requests.
   */
  pendingCount(): number {
    return this.pendingRequests().length;
  }

  /**
   * Current number of logged entries.
   *
   * @returns the log length.
   */
  size(): number {
    return this._messages.length;
  }

  /**
   * Whether the log is empty.
   *
   * @returns `true` when no entries have been logged.
   */
  isEmpty(): boolean {
    return this._messages.length === 0;
  }

  /**
   * Drop every logged entry. Sequence numbers are NOT reset, so the sequence
   * remains monotonic across a clear (important for id correlation).
   */
  clear(): void {
    this._messages.length = 0;
  }

  /**
   * Drop the oldest entries so that at most `maxMessages` remain. Entries are
   * never reordered; only the front of the log is truncated.
   *
   * @param maxMessages - the maximum number of entries to keep.
   * @returns the number of removed entries.
   */
  prune(maxMessages: number): number {
    if (!Number.isInteger(maxMessages) || maxMessages < 0) {
      throw new TypeError('MessageStore: prune limit must be a non-negative integer');
    }
    const excess = this._messages.length - maxMessages;
    if (excess <= 0) {
      return 0;
    }
    this._messages.splice(0, excess);
    return excess;
  }

  /**
   * Compute aggregate statistics about the log contents.
   *
   * @returns a {@link MessageStoreStats} snapshot.
   */
  stats(): MessageStoreStats {
    let requests = 0;
    let responses = 0;
    let notifications = 0;
    let errors = 0;
    let sent = 0;
    let received = 0;
    let approximateBytes = 0;
    let oldest: number | undefined;
    let newest: number | undefined;
    for (const entry of this._messages) {
      switch (entry.message.type) {
        case 'request':
          requests += 1;
          break;
        case 'response':
          responses += 1;
          break;
        case 'notification':
          notifications += 1;
          break;
        case 'error':
          errors += 1;
          break;
      }
      if (entry.direction === 'sent') {
        sent += 1;
      } else {
        received += 1;
      }
      approximateBytes += estimateStoredMessageBytes(entry);
      if (oldest === undefined || entry.timestamp < oldest) {
        oldest = entry.timestamp;
      }
      if (newest === undefined || entry.timestamp > newest) {
        newest = entry.timestamp;
      }
    }
    return {
      total: this._messages.length,
      requests,
      responses,
      notifications,
      errors,
      sent,
      received,
      pending: this.pendingCount(),
      approximateBytes,
      oldest,
      newest,
    };
  }

  /**
   * Serialize the store into a plain, JSON-serializable snapshot.
   *
   * @returns the snapshot object.
   */
  toJSON(): MessageStoreJSON {
    return {
      version: STORE_JSON_VERSION,
      nextSeq: this._nextSeq,
      messages: this._messages.slice(),
    };
  }

  /**
   * Reconstruct a store from a snapshot produced by {@link MessageStore.toJSON}.
   *
   * @param json - the snapshot to restore.
   * @returns a new store seeded with the snapshot's entries.
   */
  static fromJSON(json: MessageStoreJSON): MessageStore {
    return new MessageStore(json);
  }

  /**
   * Reconstruct a store from a JSON string snapshot.
   *
   * @param text - the serialized snapshot.
   * @returns a new store seeded with the snapshot's entries.
   * @throws on invalid JSON or a malformed snapshot shape.
   */
  static fromJSONString(text: string): MessageStore {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new TypeError(`MessageStore: invalid snapshot JSON: ${(err as Error).message}`);
    }
    if (!isMessageStoreJSON(parsed)) {
      throw new TypeError('MessageStore: snapshot does not match the expected shape');
    }
    return new MessageStore(parsed);
  }

  /**
   * Serialize the store to a compact JSON string (see {@link MessageStore.toJSON}).
   *
   * @returns the serialized snapshot string.
   */
  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  /**
   * Create an iterable view over all entries, oldest first.
   *
   * @returns an iterator over the stored entries.
   */
  [Symbol.iterator](): Iterator<StoredMessage> {
    return this._messages[Symbol.iterator]();
  }

  /**
   * Internal invariant check: sequence numbers must be strictly increasing.
   * Throws when a snapshot/seed violates ordering guarantees.
   */
  private _assertSequential(): void {
    let previous = 0;
    for (const entry of this._messages) {
      if (entry.seq <= previous) {
        throw new TypeError('MessageStore: sequence numbers must be strictly increasing');
      }
      previous = entry.seq;
    }
  }
}

/**
 * Internal guard: does `value` satisfy the {@link StoredMessage} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a stored entry.
 */
function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['seq'] !== 'number' || !Number.isInteger(record['seq'])) {
    return false;
  }
  if (record['direction'] !== 'sent' && record['direction'] !== 'received') {
    return false;
  }
  if (typeof record['timestamp'] !== 'number') {
    return false;
  }
  if (!isProtocolMessageLike(record['message'])) {
    return false;
  }
  return true;
}

/**
 * Internal guard: does `value` satisfy the {@link MessageStoreJSON} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a store snapshot.
 */
function isMessageStoreJSON(value: unknown): value is MessageStoreJSON {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record['version'] === STORE_JSON_VERSION &&
    typeof record['nextSeq'] === 'number' &&
    Array.isArray(record['messages'])
  );
}

/**
 * Internal structural check for a normalized {@link ProtocolMessage} that is
 * deliberately tolerant of legacy snapshots (missing optional `jsonrpc` field).
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value carries one of the four message discriminants.
 */
function isProtocolMessageLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  switch (record['type']) {
    case 'request':
      return isJsonRpcRequestLike(record['request']);
    case 'response':
      return isJsonRpcResponseLike(record['response']);
    case 'error':
      return isJsonRpcErrorResponseLike(record['error']);
    case 'notification':
      return isJsonRpcNotificationLike(record['notification']);
    default:
      return false;
  }
}

/**
 * Internal guard for the raw {@link JsonRpcRequest} frame shape.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a JSON-RPC request.
 */
function isJsonRpcRequestLike(value: unknown): value is JsonRpcRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const idOk =
    typeof record['id'] === 'string' ||
    (typeof record['id'] === 'number' && Number.isFinite(record['id']));
  return idOk && typeof record['method'] === 'string' && record['method'].length > 0;
}

/**
 * Internal guard for the raw {@link JsonRpcResponse} frame shape.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a JSON-RPC response.
 */
function isJsonRpcResponseLike(value: unknown): value is JsonRpcResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const idOk =
    typeof record['id'] === 'string' ||
    (typeof record['id'] === 'number' && Number.isFinite(record['id']));
  return idOk && 'result' in record;
}

/**
 * Internal guard for the raw {@link JsonRpcErrorResponse} frame shape.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a JSON-RPC error response.
 */
function isJsonRpcErrorResponseLike(value: unknown): value is JsonRpcErrorResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['error'] === 'object' &&
    record['error'] !== null &&
    typeof (record['error'] as Record<string, unknown>)['code'] === 'number'
  );
}

/**
 * Internal guard for the raw {@link JsonRpcNotification} frame shape.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a JSON-RPC notification.
 */
function isJsonRpcNotificationLike(value: unknown): value is JsonRpcNotification {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record['method'] === 'string' && record['method'].length > 0;
}