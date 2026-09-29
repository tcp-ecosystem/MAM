/**
 * index.ts — `SessionIndex`: query-oriented secondary indexes over sessions.
 *
 * The {@link SessionStore} owns the authoritative session records; the
 * {@link SessionIndex} provides fast lookups by id, by negotiated protocol version and by
 * initialization state, plus aggregate statistics over those dimensions. Keeping the
 * indexes separate from the store lets the lifecycle layer re-index from a restored
 * snapshot (or a foreign store) without giving the store query responsibilities.
 *
 * The index is maintained incrementally via {@link SessionIndex.indexSession} /
 * {@link SessionIndex.removeSession} and can be bulk-rebuilt with
 * {@link SessionIndex.rebuild}. All internal bookkeeping is synchronous and O(1) per
 * operation apart from ordering, which is O(n) only on removal.
 *
 * @module server/index
 */

import {
  McpSession,
  ProtocolVersion,
} from "./types.js";

/**
 * Aggregate statistics over the indexed session population.
 */
export interface SessionIndexStats {
  /** Total sessions indexed. */
  total: number;
  /** Sessions that completed the initialize handshake. */
  initialized: number;
  /** Sessions awaiting initialization. */
  pending: number;
  /** Number of distinct protocol versions present in the index. */
  protocolVersionCount: number;
  /** Sessions grouped by protocol version. */
  byProtocolVersion: Record<string, number>;
}

/**
 * SessionIndex — secondary indexes over {@link McpSession} records.
 *
 * Three views are maintained:
 *  - `_byId`: exact session lookup (mirrors the store's map but stays in sync here).
 *  - `_byProtocolVersion`: ids grouped by negotiated protocol version.
 *  - `_initializedIds`: the set of ids that have completed initialization.
 *
 * Insertion order is tracked so iteration is deterministic and stable.
 */
export class SessionIndex {
  /** Exact lookup by session id. */
  private readonly _byId: Map<string, McpSession>;
  /** Ids grouped by protocol version. */
  private readonly _byProtocolVersion: Map<ProtocolVersion, Set<string>>;
  /** Ids that have completed the initialize handshake. */
  private readonly _initializedIds: Set<string>;
  /** Insertion order of ids. */
  private readonly _order: string[];

  /**
   * Construct an empty index, optionally seeding it from an iterable of sessions.
   * @param seed Optional sessions to index immediately.
   */
  constructor(seed?: Iterable<McpSession>) {
    this._byId = new Map<string, McpSession>();
    this._byProtocolVersion = new Map<ProtocolVersion, Set<string>>();
    this._initializedIds = new Set<string>();
    this._order = [];
    if (seed !== undefined) {
      for (const session of seed) {
        this.indexSession(session);
      }
    }
  }

  /**
   * Number of sessions currently indexed.
   */
  get size(): number {
    return this._byId.size;
  }

  /**
   * Index (or re-index) a session. When the session is already present, its previous
   * protocol-version bucket and initialization state are corrected so the index never
   * drifts from the source of truth.
   *
   * @returns The number of new sessions added (0 when this was an update).
   */
  indexSession(session: McpSession): number {
    if (typeof session?.id !== "string") {
      throw new TypeError("SessionIndex.indexSession: session must carry a string id");
    }

    const previous = this._byId.get(session.id);
    if (previous === undefined) {
      this._byId.set(session.id, session);
      this._order.push(session.id);
    } else {
      // Correct the protocol-version bucket if the version changed.
      if (previous.protocolVersion !== session.protocolVersion) {
        this._removeFromVersionBucket(previous);
      }
      this._byId.set(session.id, session);
    }

    const bucket = this._bucketFor(session.protocolVersion);
    bucket.add(session.id);

    if (session.initialized) {
      this._initializedIds.add(session.id);
    } else {
      this._initializedIds.delete(session.id);
    }

    return previous === undefined ? 1 : 0;
  }

  /**
   * Ensure the index entry for a session matches the session's current state. This is a
   * no-op wrapper around {@link SessionIndex.indexSession} that always treats the session
   * as an update and never throws for already-present ids.
   */
  update(session: McpSession): void {
    this.indexSession(session);
  }

  /**
   * Remove a session from every index by id.
   *
   * @returns True when a session was removed.
   */
  removeSession(id: string): boolean {
    const session = this._byId.get(id);
    if (session === undefined) {
      return false;
    }
    this._removeFromVersionBucket(session);
    this._initializedIds.delete(id);
    this._byId.delete(id);
    const idx = this._order.indexOf(id);
    if (idx >= 0) {
      this._order.splice(idx, 1);
    }
    return true;
  }

  /**
   * Drop a session from its protocol-version bucket (keeping the bucket itself alive even
   * when it becomes empty, so version counts stay stable).
   */
  private _removeFromVersionBucket(session: McpSession): void {
    const bucket = this._byProtocolVersion.get(session.protocolVersion);
    if (bucket !== undefined) {
      bucket.delete(session.id);
    }
  }

  /**
   * Fetch the id-set for a protocol version, creating it lazily.
   */
  private _bucketFor(version: ProtocolVersion): Set<string> {
    let bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      bucket = new Set<string>();
      this._byProtocolVersion.set(version, bucket);
    }
    return bucket;
  }

  /**
   * Look up a session by id.
   */
  get(id: string): McpSession | undefined {
    return this._byId.get(id);
  }

  /**
   * Whether a session with the given id is indexed.
   */
  has(id: string): boolean {
    return this._byId.has(id);
  }

  /**
   * Whether the indexed session with the given id has completed initialization.
   */
  isInitialized(id: string): boolean {
    return this._initializedIds.has(id);
  }

  /**
   * All sessions indexed, in insertion order.
   */
  all(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      const session = this._byId.get(id);
      if (session !== undefined) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * All indexed ids, in insertion order.
   */
  keys(): string[] {
    return [...this._order];
  }

  /**
   * Find every session that negotiated the given protocol version.
   */
  findByProtocolVersion(version: ProtocolVersion): McpSession[] {
    const bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      return [];
    }
    const out: McpSession[] = [];
    for (const id of bucket) {
      const session = this._byId.get(id);
      if (session !== undefined) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * Ids of every session that negotiated the given protocol version.
   */
  idsByProtocolVersion(version: ProtocolVersion): string[] {
    const bucket = this._byProtocolVersion.get(version);
    return bucket === undefined ? [] : [...bucket];
  }

  /**
   * Every protocol version currently represented in the index.
   */
  protocolVersions(): ProtocolVersion[] {
    return [...this._byProtocolVersion.keys()];
  }

  /**
   * Find every session that has completed the initialize handshake.
   */
  findInitialized(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      if (this._initializedIds.has(id)) {
        const session = this._byId.get(id);
        if (session !== undefined) {
          out.push(session);
        }
      }
    }
    return out;
  }

  /**
   * Find every session that has NOT completed the initialize handshake.
   */
  findPending(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      if (!this._initializedIds.has(id)) {
        const session = this._byId.get(id);
        if (session !== undefined) {
          out.push(session);
        }
      }
    }
    return out;
  }

  /**
   * Rebuild the entire index from an iterable of sessions. The index is cleared first;
   * stale entries cannot survive a rebuild.
   *
   * @returns The number of sessions indexed.
   */
  rebuild(sessions: Iterable<McpSession>): number {
    this.clear();
    let count = 0;
    for (const session of sessions) {
      this.indexSession(session);
      count += 1;
    }
    return count;
  }

  /**
   * Remove every entry from the index.
   */
  clear(): void {
    this._byId.clear();
    this._byProtocolVersion.clear();
    this._initializedIds.clear();
    this._order.length = 0;
  }

  /**
   * Compute aggregate statistics over the indexed population.
   */
  stats(): SessionIndexStats {
    const byProtocolVersion: Record<string, number> = {};
    for (const [version, ids] of this._byProtocolVersion) {
      byProtocolVersion[version] = ids.size;
    }
    return {
      total: this._byId.size,
      initialized: this._initializedIds.size,
      pending: this._byId.size - this._initializedIds.size,
      protocolVersionCount: this._byProtocolVersion.size,
      byProtocolVersion,
    };
  }

  /**
   * Copy the index contents as a plain array of session records. Useful for snapshots and
   * for feeding {@link SessionIndex.rebuild} on another instance.
   */
  toJSON(): McpSession[] {
    return this.all().map((session) => ({ ...session }));
  }

  /**
   * Replace the index contents from a serialised array of session records (the inverse of
   * {@link SessionIndex.toJSON}).
   *
   * @returns The number of sessions indexed.
   */
  fromJSON(sessions: Iterable<McpSession>): number {
    return this.rebuild(sessions);
  }

  /**
   * Find sessions whose activity timestamp is older than a threshold. Useful for sweeping
   * idle sessions without mutating the index.
   */
  findStale(idleThresholdMs: number, now: number = Date.now()): McpSession[] {
    const out: McpSession[] = [];
    for (const session of this._byId.values()) {
      if (now - session.lastActiveAt > idleThresholdMs) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * Convenience predicate: is there at least one initialized session that speaks the given
   * protocol version?
   */
  hasInitializedForVersion(version: ProtocolVersion): boolean {
    const bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      return false;
    }
    for (const id of bucket) {
      if (this._initializedIds.has(id)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Convenience factory for building an index seeded from a session iterable.
 */
export function createSessionIndex(seed?: Iterable<McpSession>): SessionIndex {
  return new SessionIndex(seed);
}