/**
 * store.ts — `ConnectionStore`: the connection registry for the MAM MCP Client layer.
 *
 * The store is the authoritative holder of live {@link McpConnection} records. It provides
 * create/get/has/delete/keys/clear/size semantics, activity tracking via
 * {@link ConnectionStore.touch}, lifecycle advancement via
 * {@link ConnectionStore.markConnected}/{@link ConnectionStore.markClosed}, an LRU-style
 * overflow eviction policy, and lossless serialisation through
 * {@link ConnectionStore.toJSON}/{@link ConnectionStore.fromJSON}.
 *
 * The store extends Node's {@link EventEmitter} and emits lifecycle events so higher layers
 * (logging, metrics, the {@link ConnectionIndex} synchronisation layer, transport hooks)
 * can observe connections without polling. Connection ids default to random UUIDs but can
 * be supplied explicitly to support deterministic recovery from a persisted snapshot.
 *
 * @module client/store
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  McpConnection,
  ProtocolVersion,
  Implementation,
  ServerCapabilities,
  ConnectionStatus,
  LATEST_PROTOCOL_VERSION,
  createConnectionRecord,
  isMcpConnection,
  isConnectionStatus,
} from "./types.js";

/**
 * Event map emitted by {@link ConnectionStore}. Each key is an event name; the value is the
 * argument tuple emitted with it. Subscribe via `store.on(event, (...args) => ...)`.
 */
export interface ConnectionStoreEvents {
  /** Emitted when a connection is created. Args: the new connection. */
  connectionCreated: [connection: McpConnection];
  /** Emitted when a connection transitions to `connected`. Args: the connection. */
  connectionConnected: [connection: McpConnection];
  /** Emitted when a connection transitions to `closed`. Args: the connection. */
  connectionClosed: [connection: McpConnection];
  /** Emitted when a connection's activity timestamp is bumped. Args: the connection. */
  connectionTouched: [connection: McpConnection];
  /** Emitted when a connection is deleted. Args: connection id, the removed connection. */
  connectionDeleted: [id: string, connection: McpConnection];
  /** Emitted when the store is cleared. Args: the number of connections removed. */
  storeCleared: [removed: number];
}

/**
 * Typed wrapper around {@link ConnectionStore} events so listeners get compile-time
 * checking of their payloads.
 */
export type ConnectionStoreListener<K extends keyof ConnectionStoreEvents> = (
  ...args: ConnectionStoreEvents[K]
) => void;

/**
 * Snapshot of the store's bookkeeping, used by `stats()` and by the lifecycle facade when
 * aggregating {@link ClientStats}.
 */
export interface ConnectionStoreStats {
  /** Total connections ever created (including deleted/pruned ones). */
  totalCreated: number;
  /** Connections currently held. */
  active: number;
  /** Connections currently held that are `connected`. */
  connected: number;
  /** Connections currently held that are `connecting`. */
  connecting: number;
  /** Connections currently held that are `closed`. */
  closed: number;
  /** Connections deleted (including pruned) since construction. */
  totalDeleted: number;
  /** Connections evicted by overflow since construction. */
  totalPruned: number;
  /** Average lifetime of closed connections, in milliseconds. */
  averageLifetimeMs: number;
  /** Age of the oldest live connection, in milliseconds. */
  oldestConnectionAgeMs: number;
}

/**
 * Options controlling {@link ConnectionStore.create}.
 */
export interface CreateConnectionOptions {
  /** Explicit connection id; defaults to a fresh UUID. */
  id?: string;
  /** Protocol version for the new connection; defaults to the store's configured version. */
  protocolVersion?: ProtocolVersion;
  /** Optional server identity known ahead of the initialize handshake. */
  serverInfo?: Implementation;
  /** Optional server capabilities known ahead of the initialize handshake. */
  capabilities?: ServerCapabilities;
  /** Initial status; defaults to `connecting`. */
  status?: ConnectionStatus;
  /** Optional transport label. */
  transport?: string;
  /** Opaque tags attached to the connection. */
  meta?: Record<string, unknown>;
}

/**
 * Options controlling {@link ConnectionStore.prune}.
 */
export interface PruneOptions {
  /** Idle threshold in ms; connections idle longer than this are pruned. */
  idleTimeoutMs?: number;
  /** Hard cap; connections beyond this are evicted oldest-last-active-first. */
  maxConnections?: number;
  /** When true, connections are evicted to bring the count down to `maxConnections`. */
  enforceCapacity?: boolean;
}

/**
 * The on-disk / on-wire shape produced by {@link ConnectionStore.toJSON}. A version field
 * keeps the format forward-compatible.
 */
export interface ConnectionStoreSnapshot {
  version: 1;
  connections: McpConnection[];
}

/**
 * Default cap for the closed/history side of overflow eviction.
 */
const CLOSED_HISTORY_DEFAULT_CAP = 1024;

/**
 * Default idle timeout used by {@link ConnectionStore.prune} when the caller supplies none.
 * 30 minutes.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * ConnectionStore — an event-emitting registry of client-side MCP connections.
 *
 * The store owns connection identity and lifetime but not protocol semantics: the
 * initialize handshake (version negotiation, capability recording) is the job of the
 * {@link McpClient} facade. This keeps the store trivially testable and serialisable.
 */
export class ConnectionStore extends EventEmitter {
  /** Live connections keyed by id. */
  private readonly _connections: Map<string, McpConnection>;
  /** Insertion order of live connection ids (stable iteration). */
  private readonly _order: string[];
  /** Maximum number of concurrent live connections. */
  private readonly _maxConnections: number;
  /** Bounded history of closed connections, kept when tracking is enabled. */
  private readonly _closed: Map<string, McpConnection>;
  /** Number of connections ever created (monotonic counter). */
  private _totalCreated = 0;
  /** Number of connections ever deleted (monotonic counter). */
  private _totalDeleted = 0;
  /** Number of connections pruned (subset of deleted; monotonic counter). */
  private _totalPruned = 0;
  /** Epoch ms of the oldest live connection (recomputed lazily on prune). */
  private _oldestAgeMs = 0;

  /**
   * Construct a connection store.
   * @param options Optional capacity / tracking options.
   */
  constructor(options: {
    maxConnections?: number;
    trackClosed?: boolean;
    maxClosed?: number;
  } = {}) {
    super();
    this._connections = new Map<string, McpConnection>();
    this._closed = new Map<string, McpConnection>();
    this._order = [];
    this._maxConnections = options.maxConnections ?? Infinity;
  }

  /**
   * Maximum concurrent connections. Creating beyond this limit triggers eviction of the
   * least-recently-active connection (or throws when `strictCapacity` is set in meta).
   */
  get maxConnections(): number {
    return this._maxConnections;
  }

  /**
   * Number of live connections currently held.
   */
  get size(): number {
    return this._connections.size;
  }

  /**
   * Total connections ever created since construction.
   */
  get totalCreated(): number {
    return this._totalCreated;
  }

  /**
   * Total connections deleted (including pruned) since construction.
   */
  get totalDeleted(): number {
    return this._totalDeleted;
  }

  /**
   * Total connections pruned since construction.
   */
  get totalPruned(): number {
    return this._totalPruned;
  }

  /**
   * Generate a connection id. Prefers an explicit id from the caller but falls back to a
   * random UUID, ensuring the id is unique within this store.
   */
  private _makeId(explicit?: string): string {
    if (explicit !== undefined && explicit.length > 0) {
      if (this._connections.has(explicit) || this._closed.has(explicit)) {
        throw new Error(`ConnectionStore: connection id "${explicit}" is already in use`);
      }
      return explicit;
    }
    let id = randomUUID();
    while (this._connections.has(id) || this._closed.has(id)) {
      id = randomUUID();
    }
    return id;
  }

  /**
   * Create a new connection and register it. Emits `connectionCreated`.
   *
   * When the store is at capacity, the least-recently-active connection is evicted to make
   * room (documented as an LRU-style policy). If the connection meta carries
   * `strictCapacity: true` and the store is full, creation throws instead.
   *
   * @param options Creation options (id override, protocol version, status, meta tags).
   * @returns The registered connection record.
   */
  create(options: CreateConnectionOptions = {}): McpConnection {
    if (this._connections.size >= this._maxConnections) {
      if (options.meta && (options.meta as Record<string, unknown>).strictCapacity) {
        throw new Error(
          `ConnectionStore: maximum connection capacity (${this._maxConnections}) reached`,
        );
      }
      this._evictLeastActive();
    }

    const id = this._makeId(options.id);
    const connection = createConnectionRecord(id, {
      serverInfo: options.serverInfo,
      capabilities: options.capabilities,
      protocolVersion: options.protocolVersion ?? LATEST_PROTOCOL_VERSION,
      status: options.status,
      transport: options.transport,
      meta: options.meta,
    });

    this._connections.set(id, connection);
    this._order.push(id);
    this._totalCreated += 1;
    this._oldestAgeMs = Date.now() - connection.connectedAt;
    this.emit("connectionCreated", connection);
    return connection;
  }

  /**
   * Register an externally-constructed connection (e.g. restored from a snapshot). This is
   * the escape hatch used by {@link ConnectionStore.fromJSON} and hot-reload tooling; it
   * performs the same registry bookkeeping as {@link ConnectionStore.create} but does not
   * stamp a new id or reset timestamps.
   *
   * @param connection A fully-formed connection record.
   * @returns The registered connection.
   */
  register(connection: McpConnection): McpConnection {
    if (!isMcpConnection(connection)) {
      throw new TypeError("ConnectionStore.register: argument is not a valid McpConnection");
    }
    if (this._connections.has(connection.id)) {
      throw new Error(`ConnectionStore.register: connection "${connection.id}" already exists`);
    }
    this._connections.set(connection.id, connection);
    this._order.push(connection.id);
    this._totalCreated += 1;
    this.emit("connectionCreated", connection);
    return connection;
  }

  /**
   * Retrieve a live connection by id.
   * @returns The connection, or `undefined` when absent.
   */
  get(id: string): McpConnection | undefined {
    return this._connections.get(id);
  }

  /**
   * Retrieve a connection by id or throw a descriptive error. Useful in handler code where
   * a missing connection is a programming error rather than a lookup miss.
   */
  require(id: string): McpConnection {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      throw new Error(`ConnectionStore: no connection with id "${id}"`);
    }
    return connection;
  }

  /**
   * Whether a live connection with the given id exists.
   */
  has(id: string): boolean {
    return this._connections.has(id);
  }

  /**
   * Delete a live connection. When closed-tracking is enabled, the connection is moved to
   * the bounded history instead of being discarded. Emits `connectionDeleted`.
   *
   * @returns True when a connection was removed, false when the id was unknown.
   */
  delete(id: string): boolean {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return false;
    }
    this._connections.delete(id);
    const idx = this._order.indexOf(id);
    if (idx >= 0) {
      this._order.splice(idx, 1);
    }
    this._totalDeleted += 1;
    if (connection.status !== "closed") {
      this._setStatus(connection, "closed");
    }
    this._trackClosed(connection);
    this.emit("connectionDeleted", id, connection);
    return true;
  }

  /**
   * Advance a connection to `connected`. No-op when the connection is unknown or already
   * closed. Emits `connectionConnected`.
   *
   * @returns The updated connection, or `undefined`.
   */
  markConnected(id: string, at: number = Date.now()): McpConnection | undefined {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return undefined;
    }
    if (connection.status === "closed") {
      return connection;
    }
    connection.status = "connected";
    connection.lastActiveAt = at;
    this.emit("connectionConnected", connection);
    return connection;
  }

  /**
   * Advance a connection to `closed`. No-op when the connection is unknown. Emits
   * `connectionClosed`.
   *
   * @returns The updated connection, or `undefined`.
   */
  markClosed(id: string, at: number = Date.now()): McpConnection | undefined {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return undefined;
    }
    if (connection.status === "closed") {
      return connection;
    }
    connection.status = "closed";
    connection.lastActiveAt = at;
    this.emit("connectionClosed", connection);
    return connection;
  }

  /**
   * Set a connection's status to an arbitrary valid value (used internally and by the
   * index synchronisation layer).
   */
  setStatus(id: string, status: ConnectionStatus): McpConnection | undefined {
    if (!isConnectionStatus(status)) {
      throw new TypeError(`ConnectionStore.setStatus: invalid status "${String(status)}"`);
    }
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return undefined;
    }
    if (connection.status === status) {
      return connection;
    }
    this._setStatus(connection, status);
    return connection;
  }

  /**
   * Apply a status transition, emitting the appropriate event for `connected` / `closed`.
   */
  private _setStatus(connection: McpConnection, status: ConnectionStatus): void {
    connection.status = status;
    if (status === "connected") {
      this.emit("connectionConnected", connection);
    } else if (status === "closed") {
      this.emit("connectionClosed", connection);
    }
  }

  /**
   * Bump the activity timestamp of a connection. No-op when the connection is unknown.
   *
   * @returns The touched connection, or `undefined`.
   */
  touch(id: string, at: number = Date.now()): McpConnection | undefined {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return undefined;
    }
    connection.lastActiveAt = at;
    this.emit("connectionTouched", connection);
    return connection;
  }

  /**
   * Record server identity and capabilities on a connection after the initialize
   * handshake. No-op when the connection is unknown.
   *
   * @returns The updated connection, or `undefined`.
   */
  updateServerInfo(
    id: string,
    serverInfo: Implementation,
    capabilities: ServerCapabilities,
    protocolVersion?: ProtocolVersion,
  ): McpConnection | undefined {
    const connection = this._connections.get(id);
    if (connection === undefined) {
      return undefined;
    }
    connection.serverInfo = { ...serverInfo };
    connection.capabilities = { ...capabilities };
    if (protocolVersion !== undefined) {
      connection.protocolVersion = protocolVersion;
    }
    connection.lastActiveAt = Date.now();
    return connection;
  }

  /**
   * List every live connection that has completed the initialize handshake (status
   * `connected`).
   */
  listConnected(): McpConnection[] {
    const out: McpConnection[] = [];
    for (const id of this._order) {
      const connection = this._connections.get(id);
      if (connection !== undefined && connection.status === "connected") {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * List every live connection still awaiting initialization (status `connecting`).
   */
  listConnecting(): McpConnection[] {
    const out: McpConnection[] = [];
    for (const id of this._order) {
      const connection = this._connections.get(id);
      if (connection !== undefined && connection.status === "connecting") {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * Ids of all live connections, in insertion order.
   */
  keys(): string[] {
    return [...this._order];
  }

  /**
   * All live connections, in insertion order.
   */
  values(): McpConnection[] {
    const out: McpConnection[] = [];
    for (const id of this._order) {
      const connection = this._connections.get(id);
      if (connection !== undefined) {
        out.push(connection);
      }
    }
    return out;
  }

  /**
   * Iterable of `[id, connection]` pairs, in insertion order.
   */
  entries(): Array<[string, McpConnection]> {
    return this.values().map((connection) => [connection.id, connection]);
  }

  /**
   * Remove every live connection. Emits `storeCleared`. Closed-connection history is
   * preserved.
   *
   * @returns The number of connections removed.
   */
  clear(): number {
    const removed = this._connections.size;
    if (removed === 0) {
      return 0;
    }
    for (const id of [...this._order]) {
      const connection = this._connections.get(id);
      if (connection !== undefined) {
        this._totalDeleted += 1;
        this._trackClosed(connection);
        this.emit("connectionDeleted", id, connection);
      }
    }
    this._connections.clear();
    this._order.length = 0;
    this._oldestAgeMs = 0;
    this.emit("storeCleared", removed);
    return removed;
  }

  /**
   * Evict the least-recently-active connection to make room for new ones. Called
   * automatically on capacity overflow. Emits `connectionClosed` + `connectionDeleted`.
   */
  private _evictLeastActive(): void {
    let victim: McpConnection | undefined;
    let victimKey: string | undefined;
    let oldest = Infinity;
    for (const id of this._order) {
      const connection = this._connections.get(id);
      if (connection === undefined) {
        continue;
      }
      if (connection.lastActiveAt < oldest) {
        oldest = connection.lastActiveAt;
        victim = connection;
        victimKey = id;
      }
    }
    if (victim !== undefined && victimKey !== undefined) {
      this._connections.delete(victimKey);
      const idx = this._order.indexOf(victimKey);
      if (idx >= 0) {
        this._order.splice(idx, 1);
      }
      this._totalDeleted += 1;
      this._totalPruned += 1;
      if (victim.status !== "closed") {
        this._setStatus(victim, "closed");
      }
      this._trackClosed(victim);
      this.emit("connectionDeleted", victimKey, victim);
    }
  }

  /**
   * Move a closed connection into the bounded history, trimming the oldest entries once the
   * cap is exceeded.
   */
  private _trackClosed(connection: McpConnection): void {
    const cap = this._maxConnections === Infinity ? CLOSED_HISTORY_DEFAULT_CAP : this._maxConnections;
    if (this._closed.size >= cap) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [id, c] of this._closed) {
        if (c.lastActiveAt < oldestAt) {
          oldestAt = c.lastActiveAt;
          oldestKey = id;
        }
      }
      if (oldestKey !== undefined) {
        this._closed.delete(oldestKey);
      }
    }
    this._closed.set(connection.id, { ...connection });
  }

  /**
   * Prune idle connections and (optionally) enforce capacity. Connections idle longer than
   * the configured threshold are removed; when `enforceCapacity` is set, additional
   * connections beyond `maxConnections` are evicted oldest-last-active-first.
   *
   * @returns The number of connections pruned.
   */
  prune(options: PruneOptions = {}): number {
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const now = Date.now();
    let pruned = 0;

    for (const id of [...this._order]) {
      const connection = this._connections.get(id);
      if (connection === undefined) {
        continue;
      }
      const idleMs = now - connection.lastActiveAt;
      if (idleMs > idleTimeoutMs) {
        this._connections.delete(id);
        const idx = this._order.indexOf(id);
        if (idx >= 0) {
          this._order.splice(idx, 1);
        }
        this._totalDeleted += 1;
        this._totalPruned += 1;
        if (connection.status !== "closed") {
          this._setStatus(connection, "closed");
        }
        this._trackClosed(connection);
        this.emit("connectionDeleted", id, connection);
        pruned += 1;
      }
    }

    if (options.enforceCapacity && options.maxConnections !== undefined) {
      while (this._connections.size > options.maxConnections) {
        this._evictLeastActive();
        pruned += 1;
      }
    }

    this._recomputeOldestAge();
    return pruned;
  }

  /**
   * Recompute the age of the oldest live connection after mutations.
   */
  private _recomputeOldestAge(): void {
    let oldest = Infinity;
    for (const connection of this._connections.values()) {
      const age = Date.now() - connection.connectedAt;
      if (age < oldest) {
        oldest = age;
      }
    }
    this._oldestAgeMs = oldest === Infinity ? 0 : oldest;
  }

  /**
   * Compute operational statistics for this store.
   */
  stats(): ConnectionStoreStats {
    let connected = 0;
    let connecting = 0;
    let closed = 0;
    for (const connection of this._connections.values()) {
      if (connection.status === "connected") connected += 1;
      else if (connection.status === "connecting") connecting += 1;
      else closed += 1;
    }
    const lifetimeTotal = [...this._closed.values()].reduce(
      (acc, connection) => acc + Math.max(0, connection.lastActiveAt - connection.connectedAt),
      0,
    );
    const averageLifetimeMs =
      this._closed.size > 0 ? Math.round(lifetimeTotal / this._closed.size) : 0;

    return {
      totalCreated: this._totalCreated,
      active: this._connections.size,
      connected,
      connecting,
      closed,
      totalDeleted: this._totalDeleted,
      totalPruned: this._totalPruned,
      averageLifetimeMs,
      oldestConnectionAgeMs: this._oldestAgeMs,
    };
  }

  /**
   * Serialise the store to a plain JSON-safe snapshot. Live connections are copied so later
   * mutations cannot corrupt the snapshot.
   */
  toJSON(): ConnectionStoreSnapshot {
    return {
      version: 1,
      connections: this.values().map((connection) => ({ ...connection })),
    };
  }

  /**
   * Restore a snapshot produced by {@link ConnectionStore.toJSON}, replacing the current
   * contents. Invalid records are skipped and counted; the store is not left half-loaded.
   *
   * @returns The number of live connections restored.
   */
  fromJSON(snapshot: ConnectionStoreSnapshot): number {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new TypeError("ConnectionStore.fromJSON: expected a snapshot object");
    }
    this.clear();
    this._closed.clear();

    let restored = 0;
    for (const candidate of snapshot.connections ?? []) {
      if (!isMcpConnection(candidate)) {
        continue;
      }
      try {
        this.register({ ...candidate });
        restored += 1;
      } catch {
        // Skip id collisions silently; register throws only on duplicate ids.
      }
    }

    this._recomputeOldestAge();
    return restored;
  }
}

/**
 * Convenience factory mirroring the store's constructor with resolved options, useful for
 * quickly standing up a store in tests or transport adapters.
 */
export function createConnectionStore(options: {
  maxConnections?: number;
  trackClosed?: boolean;
  maxClosed?: number;
} = {}): ConnectionStore {
  return new ConnectionStore(options);
}