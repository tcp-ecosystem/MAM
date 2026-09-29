/**
 * index.ts
 *
 * In-memory index over the MCP protocol message log.
 *
 * While the {@link MessageStore} records *every* frame in arrival order, the
 * {@link MethodIndex} trades memory for lookup speed: it maintains three
 * inverted maps so that consumers can answer the common protocol questions in
 * near-constant time:
 *
 *   - *by sequence*   — direct lookup of a message by its store sequence,
 *   - *by method*     — all requests/notifications for a given MCP method,
 *   - *by id*         — a request and every frame correlated to that id,
 *   - *by type*       — buckets per {@link MessageType}.
 *
 * The index is designed to stay in lock-step with a store: the lifecycle layer
 * calls {@link MethodIndex.indexMessage} on append and
 * {@link MethodIndex.removeMessage} on prune. When a snapshot is restored,
 * {@link MethodIndex.rebuild} reconstructs all structures in a single pass.
 *
 * This module depends only on the shared `types.ts`, keeping it embeddable in
 * servers, clients, proxies and test harnesses alike.
 *
 * @module protocol/index
 */

import {
  MESSAGE_TYPES,
  messageId,
  messageMethod,
  type MessageType,
  type ProtocolMessage,
  type RequestId,
} from './types.js';

/**
 * A message together with the sequence number it was indexed under. This is
 * the unit consumed by {@link MethodIndex.rebuild}.
 */
export interface IndexedEntry {
  /** The store sequence number of the message. */
  readonly seq: number;
  /** The message to index. */
  readonly message: ProtocolMessage;
}

/**
 * Aggregate counters describing the current contents of an index.
 */
export interface MethodIndexStats {
  /** Total number of indexed messages. */
  readonly total: number;
  /** Number of indexed request frames. */
  readonly requests: number;
  /** Number of indexed success-response frames. */
  readonly responses: number;
  /** Number of indexed notification frames. */
  readonly notifications: number;
  /** Number of indexed error-response frames. */
  readonly errors: number;
  /** Number of distinct method names present in the index. */
  readonly uniqueMethods: number;
  /** Number of distinct request ids present in the index. */
  readonly uniqueIds: number;
  /** Per-method occurrence counts (methods with at least one message). */
  readonly byMethod: Readonly<Record<string, number>>;
  /** Per-type occurrence counts. */
  readonly byType: Readonly<Record<MessageType, number>>;
}

/**
 * Fast lookup index over protocol messages.
 *
 * Internally every structure maps a key to a `Set<number>` of sequence
 * numbers. All query methods return messages ordered by ascending sequence,
 * matching the store's arrival order so callers never see a shuffled result.
 */
export class MethodIndex {
  /** Sequence -> message. The authoritative record for every indexed frame. */
  private readonly _bySeq = new Map<number, ProtocolMessage>();
  /** Method name -> sequence numbers of matching requests/notifications. */
  private readonly _byMethod = new Map<string, Set<number>>();
  /** Request id -> sequence numbers of every correlated frame. */
  private readonly _byId = new Map<RequestId, Set<number>>();
  /** Message type -> sequence numbers of matching frames. */
  private readonly _byType = new Map<MessageType, Set<number>>();

  /**
   * Index a single message under a sequence number. Any previous entry for the
   * same sequence is replaced (all inverted maps are cleaned up first).
   *
   * @param seq - the store sequence number.
   * @param message - the message to index.
   * @returns `this` for chaining.
   */
  indexMessage(seq: number, message: ProtocolMessage): this {
    if (!Number.isInteger(seq) || seq < 1) {
      throw new TypeError(`MethodIndex: seq must be a positive integer, got ${String(seq)}`);
    }
    if (this._bySeq.has(seq)) {
      this.removeMessage(seq);
    }
    this._bySeq.set(seq, message);

    const method = messageMethod(message);
    if (method !== undefined) {
      this._addToSet(this._byMethod, method, seq);
    }

    const id = messageId(message);
    if (id !== undefined) {
      this._addToSet(this._byId, id, seq);
    }

    this._addToSet(this._byType, message.type, seq);
    return this;
  }

  /**
   * Remove the entry indexed under a sequence number. Silently does nothing
   * when the sequence is not present.
   *
   * @param seq - the store sequence number to evict.
   * @returns `true` when an entry was actually removed.
   */
  removeMessage(seq: number): boolean {
    const message = this._bySeq.get(seq);
    if (message === undefined) {
      return false;
    }

    const method = messageMethod(message);
    if (method !== undefined) {
      this._removeFromSet(this._byMethod, method, seq);
    }

    const id = messageId(message);
    if (id !== undefined) {
      this._removeFromSet(this._byId, id, seq);
    }

    this._removeFromSet(this._byType, message.type, seq);
    this._bySeq.delete(seq);
    return true;
  }

  /**
   * Look up the message indexed under a sequence number.
   *
   * @param seq - the store sequence number.
   * @returns the indexed message, or `undefined` when absent.
   */
  get(seq: number): ProtocolMessage | undefined {
    return this._bySeq.get(seq);
  }

  /**
   * Whether a sequence number is currently indexed.
   *
   * @param seq - the store sequence number.
   * @returns `true` when the sequence is present.
   */
  has(seq: number): boolean {
    return this._bySeq.has(seq);
  }

  /**
   * Return every message for a given method name, ordered by sequence.
   *
   * @param method - the method name (e.g. `'tools/list'`).
   * @returns matching messages, oldest first.
   */
  findByMethod(method: string): ProtocolMessage[] {
    const seqs = this._byMethod.get(method);
    return this._messagesForSequences(seqs);
  }

  /**
   * Return every message correlated to a given request id: the original
   * request plus any response or error response carrying the same id.
   *
   * @param id - the request id to search for.
   * @returns correlated messages, oldest first.
   */
  findById(id: RequestId): ProtocolMessage[] {
    const seqs = this._byId.get(id);
    return this._messagesForSequences(seqs);
  }

  /**
   * Return every message of a given type, ordered by sequence.
   *
   * @param type - the {@link MessageType} to filter by.
   * @returns matching messages, oldest first.
   */
  findByType(type: MessageType): ProtocolMessage[] {
    const seqs = this._byType.get(type);
    return this._messagesForSequences(seqs);
  }

  /**
   * Convenience: every indexed request.
   *
   * @returns request messages, oldest first.
   */
  findRequests(): ProtocolMessage[] {
    return this.findByType('request');
  }

  /**
   * Convenience: every indexed success response.
   *
   * @returns response messages, oldest first.
   */
  findResponses(): ProtocolMessage[] {
    return this.findByType('response');
  }

  /**
   * Convenience: every indexed notification.
   *
   * @returns notification messages, oldest first.
   */
  findNotifications(): ProtocolMessage[] {
    return this.findByType('notification');
  }

  /**
   * Convenience: every indexed error response.
   *
   * @returns error messages, oldest first.
   */
  findErrors(): ProtocolMessage[] {
    return this.findByType('error');
  }

  /**
   * Find the *first* request in the index for a given method. This is the
   * canonical lookup used to correlate a response back to its originating
   * request when only the method is known.
   *
   * @param method - the method name.
   * @returns the oldest matching request message, or `undefined`.
   */
  findRequestByMethod(method: string): ProtocolMessage | undefined {
    return this.findByMethod(method).find((message) => message.type === 'request');
  }

  /**
   * Find the *first* response/error correlated to a given request id. Returns
   * the oldest terminal frame (success or failure) for the id.
   *
   * @param id - the request id.
   * @returns the oldest terminal message for the id, or `undefined`.
   */
  findAnswerById(id: RequestId): ProtocolMessage | undefined {
    const correlated = this.findById(id);
    return correlated.find((message) => message.type === 'response' || message.type === 'error');
  }

  /**
   * Rebuild the whole index from an iterable of entries, discarding whatever
   * was indexed before. This is the O(n) restore path used after a store
   * snapshot is loaded or a prune rewinds the log.
   *
   * @param entries - the entries to index, in any order.
   * @returns `this` for chaining.
   */
  rebuild(entries: Iterable<IndexedEntry>): this {
    this.clear();
    for (const entry of entries) {
      this.indexMessage(entry.seq, entry.message);
    }
    return this;
  }

  /**
   * Drop every indexed entry.
   */
  clear(): void {
    this._bySeq.clear();
    this._byMethod.clear();
    this._byId.clear();
    this._byType.clear();
  }

  /**
   * Number of currently indexed messages.
   *
   * @returns the index size.
   */
  size(): number {
    return this._bySeq.size;
  }

  /**
   * All sequence numbers currently indexed, sorted ascending.
   *
   * @returns an array of sequence numbers.
   */
  keys(): number[] {
    return [...this._bySeq.keys()].sort((a, b) => a - b);
  }

  /**
   * Every distinct method name present in the index.
   *
   * @returns an array of method names.
   */
  methods(): string[] {
    return [...this._byMethod.keys()];
  }

  /**
   * Every distinct request id present in the index.
   *
   * @returns an array of request ids.
   */
  ids(): RequestId[] {
    return [...this._byId.keys()];
  }

  /**
   * Compute aggregate statistics about the index contents.
   *
   * @returns a {@link MethodIndexStats} snapshot.
   */
  stats(): MethodIndexStats {
    let requests = 0;
    let responses = 0;
    let notifications = 0;
    let errors = 0;
    const byType: Record<MessageType, number> = { request: 0, response: 0, notification: 0, error: 0 };
    for (const message of this._bySeq.values()) {
      switch (message.type) {
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
      byType[message.type] += 1;
    }
    const byMethod: Record<string, number> = {};
    for (const [method, seqs] of this._byMethod.entries()) {
      byMethod[method] = seqs.size;
    }
    return {
      total: this._bySeq.size,
      requests,
      responses,
      notifications,
      errors,
      uniqueMethods: this._byMethod.size,
      uniqueIds: this._byId.size,
      byMethod,
      byType,
    };
  }

  /**
   * Serialize the index into a plain, JSON-serializable snapshot.
   *
   * @returns a snapshot with the indexed entries, ordered by sequence.
   */
  toJSON(): { entries: IndexedEntry[] } {
    const entries: IndexedEntry[] = [];
    for (const seq of this.keys()) {
      const message = this._bySeq.get(seq);
      if (message !== undefined) {
        entries.push({ seq, message });
      }
    }
    return { entries };
  }

  /**
   * Reconstruct an index from a snapshot produced by {@link MethodIndex.toJSON}.
   *
   * @param snapshot - the snapshot to restore.
   * @returns a new index seeded with the snapshot's entries.
   */
  static fromJSON(snapshot: { entries: readonly IndexedEntry[] }): MethodIndex {
    const index = new MethodIndex();
    index.rebuild(snapshot.entries);
    return index;
  }

  /**
   * Internal helper: resolve a `Set<number>` of sequences into ordered messages.
   *
   * @param seqs - the sequence set, or `undefined` when the key is absent.
   * @returns matching messages ordered by ascending sequence.
   */
  private _messagesForSequences(seqs: Set<number> | undefined): ProtocolMessage[] {
    if (seqs === undefined || seqs.size === 0) {
      return [];
    }
    const sorted = [...seqs].sort((a, b) => a - b);
    const out: ProtocolMessage[] = [];
    for (const seq of sorted) {
      const message = this._bySeq.get(seq);
      if (message !== undefined) {
        out.push(message);
      }
    }
    return out;
  }

  /**
   * Internal helper: insert a sequence into a keyed set, creating the set on
   * first use.
   *
   * @param map - the inverted map to mutate.
   * @param key - the lookup key.
   * @param seq - the sequence number to insert.
   */
  private _addToSet<K>(map: Map<K, Set<number>>, key: K, seq: number): void {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set<number>();
      map.set(key, set);
    }
    set.add(seq);
  }

  /**
   * Internal helper: remove a sequence from a keyed set, dropping the set when
   * it becomes empty.
   *
   * @param map - the inverted map to mutate.
   * @param key - the lookup key.
   * @param seq - the sequence number to remove.
   */
  private _removeFromSet<K>(map: Map<K, Set<number>>, key: K, seq: number): void {
    const set = map.get(key);
    if (set === undefined) {
      return;
    }
    set.delete(seq);
    if (set.size === 0) {
      map.delete(key);
    }
  }
}

/**
 * Helper: wrap a plain message into an {@link IndexedEntry} with a sequence.
 * Useful when indexing messages one at a time without a store at hand.
 *
 * @param seq - the sequence number to use.
 * @param message - the message to wrap.
 * @returns a complete indexed entry.
 */
export function toIndexedEntry(seq: number, message: ProtocolMessage): IndexedEntry {
  return { seq, message };
}

/**
 * Validate a message type string, returning `true` when it is one of the four
 * protocol message types. Useful for parsing index statistics payloads.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is a valid {@link MessageType}.
 */
export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && MESSAGE_TYPES.indexOf(value as MessageType) !== -1;
}

/**
 * Compute the per-method counts of an index without materializing a full
 * {@link MethodIndexStats} object. Convenience for lightweight reporting.
 *
 * @param index - the index to inspect.
 * @returns a plain `method -> count` map.
 */
export function countByMethod(index: MethodIndex): Record<string, number> {
  return index.stats().byMethod as Record<string, number>;
}