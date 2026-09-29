/**
 * index.ts — `ConnectionIndex`: query-oriented secondary indexes over client connections.
 *
 * The {@link ConnectionStore} owns the authoritative connection records; the
 * {@link ConnectionIndex} provides fast lookups by id, by lifecycle status and by
 * negotiated protocol version, plus aggregate statistics over those dimensions. Keeping the
 * indexes separate from the store lets the lifecycle layer re-index from a restored
 * snapshot (or a foreign store) without giving the store query responsibilities.
 *
 * The index is maintained incrementally via {@link ConnectionIndex.indexConnection} /
 * {@link ConnectionIndex.removeConnection} and can be bulk-rebuilt with
 * {@link ConnectionIndex.rebuild}. All internal bookkeeping is synchronous and O(1) per
 * operation apart from ordering, which is O(n) only on removal.
 *
 * @module client/index
 */

import {
  McpConnection,
  ProtocolVersion,
  ConnectionStatus,
  isMcpConnection,
} from "./types.js";

/**
 * Aggregate statistics over the indexed connection population.
 */
export interface ConnectionIndexStats {
  /** Total connections indexed. */
  total: number;
  /** Connections currently in the `connected` state. */
  connected: number;
  /** Connections currently in the `connecting` state. */
  connecting: number;
  /** Connections currently in the `closed` state. */
  closed: number;
  /** Connections grouped by status. */
  byStatus: Record<string, number>;
  /** Number of distinct protocol versions present in the index. */
  protocolVersionCount: number;
  /** Connections grouped by protocol version. */
  byProtocolVersion: Record<string, number>;
}

/**
 * ConnectionIndex — secondary indexes over {@link McpConnection} records.
 *
 * Four views are maintained:
 *  - `_byId`: exact connection lookup (mirrors the store's map but stays in sync here).
 *  - `_byStatus`: ids grouped by lifecycle status.
 *  - `_byProtocolVersion`: ids grouped by negotiated protocol version.
 *  - `_order`: insertion order so iteration is deterministic and stable.
 */
export class ConnectionIndex {
  /** Exact lookup by connection id. */
  private readonly _byId: Map<string, McpConnection>;
  /** Ids grouped by lifecycle status. */
  private readonly _byStatus: Map<ConnectionStatus, Set<string>>;
  /** Ids grouped by protocol version. */
  private readonly _byProtocolVersion: Map<ProtocolVersion, Set<string>>;
  /** Insertion order of ids. */
  private readonly _order: string[];

  /**
   * Construct an empty index, optionally seeding it from an iterable of connections.
   * @param seed Optional connections to index immediately.
   */
  constructor(seed?: Iterable<McpConnection>) {
    this._byId = new Map<string, McpConnection>();
    this._byStatus = new Map<ConnectionStatus, Set<string>>();
    this._byProtocolVersion = new Map<ProtocolVersion, Set<string>>();
    this._order = [];
    if (seed !== undefined) {
      for (const connection of seed) {
        this.indexConnection(connection);
      }
    }
  }

  /**
   * Number of connections currently indexed.
   */
  get size(): number {
    return this._byId.size;
  }

  /**
   * Index (or re-index) a connection. When the connection is already present, its previous
   * status bucket and protocol-version bucket are corrected so the index never drifts from
   * the source of truth.
   *
   * @returns The number of new connections added (0 when this was an update).
   */
  indexConnection(connection: McpConnection): number {
    if (!isMcpConnection(connection)) {
      throw new TypeError("ConnectionIndex.indexConnection: argument is not a valid McpConnection");
    }

    const previous = this._byId.get(connection.id);
    if (previous === undefined) {
      this._byId.set(connection.id, connection);
      this._order.push(connection.id);
    } else {
      // Correct the status bucket if the status changed.
      if (previous.status !== connection.status) {
        this._removeFromStatusBucket(previous.status, connection.id);
      }
      // Correct the protocol-version bucket if the version changed.
      if (previous.protocolVersion !== connection.protocolVersion) {
        this._removeFromVersionBucket(previous.protocolVersion, connection.id);
      }
      this._byId.set(connection.id, connection);
    }

    this._statusBucketFor(connection.status).add(connection.id);
    this._versionBucketFor(connection.protocolVersion).add(connection.id);

    return previous === undefined ? 1 : 0;
  }

  /**
   * Ensure the index entry for a connection matches the connection's current state. This is
   * a no-op wrapper around {@link ConnectionIndex.indexConnection} that always treats the
   * connection as an update and never throws for already-present ids.
   */
  update(connection: McpConnection): void {
    this.indexConnection(connection);
  }

  /**
   * Remove a connection from every index by id.
   *
   * @returns True when a connection was removed.
   */
  removeConnection(id: string): boolean {
    const connection = this._byId.get(id);
    if (connection === undefined) {
      return false;
    }
    this._removeFromStatusBucket(connection.status, id);
    this._removeFromVersionBucket(connection.protocolVersion, id);
    this._byId.delete(id);
    const idx = this._order.indexOf(id);
    if (idx >= 0) {
      this._order.splice(idx, 1);
    }
    return true;
  }

  /**
   * Drop an id from a status bucket, deleting the bucket when it becomes empty.
   */
  private _removeFromStatusBucket(status: ConnectionStatus, id: string): void {
    const bucket = this._byStatus.get(status);
    if (bucket !== undefined) {
      bucket.delete(id);
      if (bucket.size === 0) {
        this._byStatus.delete(status);
      }
    }
  }

  /**
   * Drop an id from a protocol-version bucket, deleting the bucket when it becomes empty.
   */
  private _removeFromVersionBucket(version: ProtocolVersion, id: string): void {
    const bucket = this._byProtocolVersion.get(version);
    if (bucket !== undefined) {
      bucket.delete(id);
      if (bucket.size === 0) {
        this._byProtocolVersion.delete(version);
      }
    }
  }

  /**
   * Fetch the id-set for a status, creating it lazily.
   */
  private _statusBucketFor(status: ConnectionStatus): Set<string> {
    let bucket = this._byStatus.get(status);
    if (bucket === undefined) {
      bucket = new Set<string>();
      this._byStatus.set(status, bucket);
    }
    return bucket;
  }

  /**
   * Fetch the id-set for a protocol version, creating it lazily.
   */
  private _versionBucketFor(version: ProtocolVersion): Set<string> {
    let bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      bucket = new Set<string>();
      this._byProtocolVersion.set(version, bucket);
    }
    return bucket;
  }

  /**
   * Look up a connection by id.
   */
  get(id: string): McpConnection | undefined {
    return this._byId.get(id);
  }

  /**
   * Whether a connection with the given id is indexed.
   */
  has(id: string): boolean {
    return this._byId.has(id);
  }

  /**
   * Whether the indexed connection with the given id is in a particular status.
   */
  hasStatus(id: string, status: ConnectionStatus): boolean {
    const bucket = this._byStatus.get(status);
    return bucket !== undefined && bucket.has(id);
  }

  /**
   * All connections indexed, in insertion order.
   */
  all(): McpConnection[] {
    const out: McpConnection[] = [];
    for (const id of this._order) {
      const connection = this._byId.get(id);
      if (connection !== undefined) {
        out.push(connection);
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
   * Find every connection currently in the given status.
   */
  findByStatus(status: ConnectionStatus): McpConnection[] {
    const bucket = this._byStatus.get(status);
    if (bucket === undefined) {
      return [];
    }
    const out: McpConnection[] = [];
    for (const id of bucket) {
      const connection = this._byId.get(id);
      if (connection !== undefined) {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * Ids of every connection in the given status.
   */
  idsByStatus(status: ConnectionStatus): string[] {
    const bucket = this._byStatus.get(status);
    return bucket === undefined ? [] : [...bucket];
  }

  /**
   * Find every connection that negotiated the given protocol version.
   */
  findByProtocolVersion(version: ProtocolVersion): McpConnection[] {
    const bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      return [];
    }
    const out: McpConnection[] = [];
    for (const id of bucket) {
      const connection = this._byId.get(id);
      if (connection !== undefined) {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * Ids of every connection that negotiated the given protocol version.
   */
  idsByProtocolVersion(version: ProtocolVersion): string[] {
    const bucket = this._byProtocolVersion.get(version);
    return bucket === undefined ? [] : [...bucket];
  }

  /**
   * Every status currently represented in the index.
   */
  statuses(): ConnectionStatus[] {
    return [...this._byStatus.keys()];
  }

  /**
   * Every protocol version currently represented in the index.
   */
  protocolVersions(): ProtocolVersion[] {
    return [...this._byProtocolVersion.keys()];
  }

  /**
   * Find every connection in the `connected` state.
   */
  findConnected(): McpConnection[] {
    return this.findByStatus("connected");
  }

  /**
   * Find every connection in the `connecting` state.
   */
  findConnecting(): McpConnection[] {
    return this.findByStatus("connecting");
  }

  /**
   * Find every connection in the `closed` state.
   */
  findClosed(): McpConnection[] {
    return this.findByStatus("closed");
  }

  /**
   * Rebuild the entire index from an iterable of connections. The index is cleared first;
   * stale entries cannot survive a rebuild.
   *
   * @returns The number of connections indexed.
   */
  rebuild(connections: Iterable<McpConnection>): number {
    this.clear();
    let count = 0;
    for (const connection of connections) {
      this.indexConnection(connection);
      count += 1;
    }
    return count;
  }

  /**
   * Remove every entry from the index.
   */
  clear(): void {
    this._byId.clear();
    this._byStatus.clear();
    this._byProtocolVersion.clear();
    this._order.length = 0;
  }

  /**
   * Compute aggregate statistics over the indexed population.
   */
  stats(): ConnectionIndexStats {
    const byStatus: Record<string, number> = {};
    for (const [status, ids] of this._byStatus) {
      byStatus[status] = ids.size;
    }
    const byProtocolVersion: Record<string, number> = {};
    for (const [version, ids] of this._byProtocolVersion) {
      byProtocolVersion[version] = ids.size;
    }
    return {
      total: this._byId.size,
      connected: byStatus.connected ?? 0,
      connecting: byStatus.connecting ?? 0,
      closed: byStatus.closed ?? 0,
      byStatus,
      protocolVersionCount: this._byProtocolVersion.size,
      byProtocolVersion,
    };
  }

  /**
   * Copy the index contents as a plain array of connection records. Useful for snapshots
   * and for feeding {@link ConnectionIndex.rebuild} on another instance.
   */
  toJSON(): McpConnection[] {
    return this.all().map((connection) => ({ ...connection }));
  }

  /**
   * Replace the index contents from a serialised array of connection records (the inverse
   * of {@link ConnectionIndex.toJSON}).
   *
   * @returns The number of connections indexed.
   */
  fromJSON(connections: Iterable<McpConnection>): number {
    return this.rebuild(connections);
  }

  /**
   * Find connections whose activity timestamp is older than a threshold. Useful for
   * sweeping idle connections without mutating the index.
   */
  findStale(idleThresholdMs: number, now: number = Date.now()): McpConnection[] {
    const out: McpConnection[] = [];
    for (const connection of this._byId.values()) {
      if (now - connection.lastActiveAt > idleThresholdMs) {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * Convenience predicate: is there at least one `connected` connection that speaks the
   * given protocol version?
   */
  hasConnectedForVersion(version: ProtocolVersion): boolean {
    const bucket = this._byProtocolVersion.get(version);
    if (bucket === undefined) {
      return false;
    }
    const connectedBucket = this._byStatus.get("connected");
    if (connectedBucket === undefined) {
      return false;
    }
    for (const id of bucket) {
      if (connectedBucket.has(id)) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Convenience factory for building an index seeded from a connection iterable.
 */
export function createConnectionIndex(seed?: Iterable<McpConnection>): ConnectionIndex {
  return new ConnectionIndex(seed);
}