/**
 * store.ts — `SessionStore`: the session registry for the MAM MCP Server layer.
 *
 * The store is the authoritative holder of live {@link McpSession} records. It provides
 * create/get/has/delete/clear/size/keys semantics, activity tracking via
 * {@link SessionStore.touch}, lifecycle advancement via {@link SessionStore.setInitialized},
 * idle-based eviction via {@link SessionStore.prune}, an LRU-style overflow eviction policy,
 * and lossless serialisation through {@link SessionStore.toJSON}/{@link SessionStore.fromJSON}.
 *
 * The store extends Node's {@link EventEmitter} and emits lifecycle events so higher layers
 * (logging, metrics, the {@link SessionIndex} synchronisation layer, transport hooks) can
 * observe sessions without polling. Session ids default to random UUIDs but can be supplied
 * explicitly to support deterministic recovery from a persisted snapshot.
 *
 * @module server/store
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  McpSession,
  SessionConfig,
  Implementation,
  ClientCapabilities,
  ProtocolVersion,
  LATEST_PROTOCOL_VERSION,
  createSessionConfig,
  createSessionRecord,
  isMcpSession,
} from "./types.js";

/**
 * Event map emitted by {@link SessionStore}. Each key is an event name; the value is the
 * argument tuple emitted with it. Subscribe via `store.on(event, (...args) => ...)`.
 */
export interface SessionStoreEvents {
  /** Emitted when a session is created. Args: the new session. */
  sessionCreated: [session: McpSession];
  /** Emitted when a session completes the initialize handshake. Args: the session. */
  sessionInitialized: [session: McpSession];
  /** Emitted when a session's activity timestamp is bumped. Args: the session. */
  sessionTouched: [session: McpSession];
  /** Emitted when a session is deleted. Args: session id, the removed session. */
  sessionDeleted: [id: string, session: McpSession];
  /** Emitted when a session is pruned for inactivity/overflow. Args: id, session. */
  sessionPruned: [id: string, session: McpSession];
  /** Emitted when the store is cleared. Args: the number of sessions removed. */
  storeCleared: [removed: number];
}

/**
 * Typed wrapper around {@link SessionStore} events so listeners get compile-time checking
 * of their payloads.
 */
export type SessionStoreListener<K extends keyof SessionStoreEvents> = (
  ...args: SessionStoreEvents[K]
) => void;

/**
 * Snapshot of the store's bookkeeping, used by `stats()` and by the lifecycle facade when
 * aggregating {@link ServerStats}.
 */
export interface SessionStoreStats {
  /** Total sessions ever created (including deleted/pruned ones). */
  totalCreated: number;
  /** Total sessions currently held. */
  active: number;
  /** Sessions currently held that have completed initialization. */
  initialized: number;
  /** Sessions currently held awaiting initialization. */
  pending: number;
  /** Sessions deleted (including pruned) since construction. */
  totalDeleted: number;
  /** Sessions evicted by {@link SessionStore.prune} since construction. */
  totalPruned: number;
  /** Average lifetime of closed sessions, in milliseconds. */
  averageLifetimeMs: number;
  /** Age of the oldest live session, in milliseconds. */
  oldestSessionAgeMs: number;
}

/**
 * Options controlling {@link SessionStore.create}.
 */
export interface CreateSessionOptions {
  /** Explicit session id; defaults to a fresh UUID. */
  id?: string;
  /** Protocol version for the new session; defaults to the store's configured version. */
  protocolVersion?: ProtocolVersion;
  /** Opaque tags attached to the session. */
  meta?: Record<string, unknown>;
}

/**
 * Options controlling {@link SessionStore.prune}.
 */
export interface PruneOptions {
  /** Idle threshold in ms; sessions idle longer than this are pruned. Defaults to the
   * configured `sessionIdleTimeoutMs` (which defaults to 30 minutes). */
  idleTimeoutMs?: number;
  /** Hard cap; sessions beyond this are evicted oldest-last-active-first. */
  maxSessions?: number;
  /** When true, sessions are evicted to bring the count down to `maxSessions`. */
  enforceCapacity?: boolean;
}

/**
 * The on-disk / on-wire shape produced by {@link SessionStore.toJSON}. A version field
 * keeps the format forward-compatible.
 */
export interface SessionStoreSnapshot {
  version: 1;
  config: SessionConfig;
  sessions: McpSession[];
  closed: McpSession[];
}

/**
 * SessionStore — an event-emitting registry of MCP sessions.
 *
 * The store owns session identity and lifetime but not protocol semantics: initializing a
 * session (version negotiation, capability recording) is the job of the higher layers.
 * This keeps the store trivially testable and serialisable.
 */
export class SessionStore extends EventEmitter {
  /** Live sessions keyed by id. */
  private readonly _sessions: Map<string, McpSession>;
  /** Insertion order of live session ids (stable iteration). */
  private readonly _order: string[];
  /** Bounded history of closed sessions, kept when `trackClosedSessions` is enabled. */
  private readonly _closed: Map<string, McpSession>;
  /** Resolved session configuration. */
  private readonly _config: SessionConfig;
  /** Number of sessions ever created (monotonic counter). */
  private _totalCreated = 0;
  /** Number of sessions ever deleted (monotonic counter). */
  private _totalDeleted = 0;
  /** Number of sessions pruned (subset of deleted; monotonic counter). */
  private _totalPruned = 0;
  /** Epoch ms of the oldest live session (recomputed lazily on prune). */
  private _oldestAgeMs = 0;

  /**
   * Construct a session store.
   * @param config Optional session configuration (max sessions, protocol version, server info).
   */
  constructor(config: SessionConfig = {}) {
    super();
    this._sessions = new Map<string, McpSession>();
    this._closed = new Map<string, McpSession>();
    this._order = [];
    this._config = createSessionConfig(config);
  }

  /**
   * The resolved configuration this store operates under.
   */
  get config(): SessionConfig {
    return { ...this._config, serverInfo: this._config.serverInfo ? { ...this._config.serverInfo } : undefined };
  }

  /**
   * Maximum concurrent sessions. Creating beyond this limit triggers eviction of the
   * least-recently-active session (or throws when {@link SessionStore.create} is called
   * with `strictCapacity`).
   */
  get maxSessions(): number {
    return this._config.maxSessions ?? Infinity;
  }

  /**
   * Number of live sessions currently held.
   */
  get size(): number {
    return this._sessions.size;
  }

  /**
   * Total sessions ever created since construction.
   */
  get totalCreated(): number {
    return this._totalCreated;
  }

  /**
   * Total sessions deleted (including pruned) since construction.
   */
  get totalDeleted(): number {
    return this._totalDeleted;
  }

  /**
   * Total sessions pruned since construction.
   */
  get totalPruned(): number {
    return this._totalPruned;
  }

  /**
   * Generate a session id. Prefers an explicit id from the caller but falls back to a
   * random UUID, ensuring the id is unique within this store.
   */
  private _makeId(explicit?: string): string {
    if (explicit !== undefined && explicit.length > 0) {
      if (this._sessions.has(explicit) || this._closed.has(explicit)) {
        throw new Error(`SessionStore: session id "${explicit}" is already in use`);
      }
      return explicit;
    }
    let id = randomUUID();
    while (this._sessions.has(id) || this._closed.has(id)) {
      id = randomUUID();
    }
    return id;
  }

  /**
   * Create a new session and register it. Emits `sessionCreated`.
   *
   * When the store is at capacity, the least-recently-active session is evicted to make
   * room (documented as an LRU-style policy). If `strictCapacity` is true and the store is
   * full, creation throws instead.
   *
   * @param clientInfo Optional client identity reported by the client.
   * @param capabilities Optional client capabilities.
   * @param options Creation options (id override, protocol version, meta tags).
   * @returns The registered session record.
   */
  create(
    clientInfo?: Implementation,
    capabilities?: ClientCapabilities,
    options: CreateSessionOptions = {},
  ): McpSession {
    if (this._sessions.size >= this.maxSessions) {
      if (options.meta && (options.meta as Record<string, unknown>).strictCapacity) {
        throw new Error(`SessionStore: maximum session capacity (${this.maxSessions}) reached`);
      }
      this._evictLeastActive();
    }

    const id = this._makeId(options.id);
    const session = createSessionRecord(
      id,
      clientInfo,
      capabilities,
      options.protocolVersion ?? this._config.protocolVersion ?? LATEST_PROTOCOL_VERSION,
    );
    if (options.meta) {
      session.meta = { ...options.meta };
    }

    this._sessions.set(id, session);
    this._order.push(id);
    this._totalCreated += 1;
    this._oldestAgeMs = Date.now() - session.connectedAt;
    this.emit("sessionCreated", session);
    return session;
  }

  /**
   * Register an externally-constructed session (e.g. restored from a snapshot). This is
   * the escape hatch used by {@link SessionStore.fromJSON} and hot-reload tooling; it
   * performs the same registry bookkeeping as {@link SessionStore.create} but does not
   * stamp a new id or reset timestamps.
   *
   * @param session A fully-formed session record.
   * @returns The registered session.
   */
  register(session: McpSession): McpSession {
    if (!isMcpSession(session)) {
      throw new TypeError("SessionStore.register: argument is not a valid McpSession");
    }
    if (this._sessions.has(session.id)) {
      throw new Error(`SessionStore.register: session "${session.id}" already exists`);
    }
    this._sessions.set(session.id, session);
    this._order.push(session.id);
    this._totalCreated += 1;
    this.emit("sessionCreated", session);
    return session;
  }

  /**
   * Retrieve a live session by id.
   * @returns The session, or `undefined` when absent.
   */
  get(id: string): McpSession | undefined {
    return this._sessions.get(id);
  }

  /**
   * Retrieve a session by id or throw a descriptive error. Useful in handler code where a
   * missing session is a programming error rather than a lookup miss.
   */
  require(id: string): McpSession {
    const session = this._sessions.get(id);
    if (session === undefined) {
      throw new Error(`SessionStore: no session with id "${id}"`);
    }
    return session;
  }

  /**
   * Whether a live session with the given id exists.
   */
  has(id: string): boolean {
    return this._sessions.has(id);
  }

  /**
   * Delete a live session. When closed-session tracking is enabled, the session is moved
   * to the bounded history instead of being discarded. Emits `sessionDeleted`.
   *
   * @returns True when a session was removed, false when the id was unknown.
   */
  delete(id: string): boolean {
    const session = this._sessions.get(id);
    if (session === undefined) {
      return false;
    }
    this._sessions.delete(id);
    const idx = this._order.indexOf(id);
    if (idx >= 0) {
      this._order.splice(idx, 1);
    }
    this._totalDeleted += 1;
    this._trackClosed(session);
    this.emit("sessionDeleted", id, session);
    return true;
  }

  /**
   * Bump the activity timestamp of a session. No-op when the session is unknown.
   *
   * @returns The touched session, or `undefined`.
   */
  touch(id: string, at: number = Date.now()): McpSession | undefined {
    const session = this._sessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    session.lastActiveAt = at;
    this.emit("sessionTouched", session);
    return session;
  }

  /**
   * Mark a session as initialized, optionally recording client capabilities and the raw
   * initialize parameters. Emits `sessionInitialized`.
   *
   * @returns The updated session, or `undefined` when the session is unknown.
   */
  setInitialized(
    id: string,
    capabilities?: ClientCapabilities,
    initializeParams?: unknown,
  ): McpSession | undefined {
    const session = this._sessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    session.initialized = true;
    if (capabilities !== undefined) {
      session.capabilities = capabilities;
    }
    if (initializeParams !== undefined) {
      session.initializeParams = initializeParams;
    }
    session.lastActiveAt = Date.now();
    this.emit("sessionInitialized", session);
    return session;
  }

  /**
   * List all live sessions that have completed the initialize handshake.
   */
  listInitialized(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      const session = this._sessions.get(id);
      if (session !== undefined && session.initialized) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * List all live sessions that have NOT completed the initialize handshake.
   */
  listPending(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      const session = this._sessions.get(id);
      if (session !== undefined && !session.initialized) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * Ids of all live sessions, in insertion order.
   */
  keys(): string[] {
    return [...this._order];
  }

  /**
   * All live sessions, in insertion order.
   */
  values(): McpSession[] {
    const out: McpSession[] = [];
    for (const id of this._order) {
      const session = this._sessions.get(id);
      if (session !== undefined) {
        out.push(session);
      }
    }
    return out;
  }

  /**
   * Iterable of `[id, session]` pairs, in insertion order.
   */
  entries(): Array<[string, McpSession]> {
    return this.values().map((session) => [session.id, session]);
  }

  /**
   * Remove every live session. Emits `storeCleared`. Closed-session history is preserved.
   *
   * @returns The number of sessions removed.
   */
  clear(): number {
    const removed = this._sessions.size;
    if (removed === 0) {
      return 0;
    }
    for (const id of [...this._order]) {
      const session = this._sessions.get(id);
      if (session !== undefined) {
        this._totalDeleted += 1;
        this._trackClosed(session);
        this.emit("sessionDeleted", id, session);
      }
    }
    this._sessions.clear();
    this._order.length = 0;
    this._oldestAgeMs = 0;
    this.emit("storeCleared", removed);
    return removed;
  }

  /**
   * Evict the least-recently-active session to make room for new ones. Called
   * automatically on capacity overflow. Emits `sessionPruned` + `sessionDeleted`.
   */
  private _evictLeastActive(): void {
    let victim: McpSession | undefined;
    let victimKey: string | undefined;
    let oldest = Infinity;
    for (const id of this._order) {
      const session = this._sessions.get(id);
      if (session === undefined) {
        continue;
      }
      if (session.lastActiveAt < oldest) {
        oldest = session.lastActiveAt;
        victim = session;
        victimKey = id;
      }
    }
    if (victim !== undefined && victimKey !== undefined) {
      this._sessions.delete(victimKey);
      const idx = this._order.indexOf(victimKey);
      if (idx >= 0) {
        this._order.splice(idx, 1);
      }
      this._totalDeleted += 1;
      this._totalPruned += 1;
      this._trackClosed(victim);
      this.emit("sessionPruned", victimKey, victim);
      this.emit("sessionDeleted", victimKey, victim);
    }
  }

  /**
   * Move a closed session into the bounded history, trimming the oldest entries once the
   * cap is exceeded.
   */
  private _trackClosed(session: McpSession): void {
    const cap = this._config.maxSessions ?? CLOSED_HISTORY_DEFAULT_CAP;
    if (this._closed.size >= cap) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [id, s] of this._closed) {
        if (s.lastActiveAt < oldestAt) {
          oldestAt = s.lastActiveAt;
          oldestKey = id;
        }
      }
      if (oldestKey !== undefined) {
        this._closed.delete(oldestKey);
      }
    }
    this._closed.set(session.id, { ...session });
  }

  /**
   * Prune idle sessions and (optionally) enforce capacity. Sessions idle longer than the
   * configured threshold are removed; when `enforceCapacity` is set, additional sessions
   * beyond `maxSessions` are evicted oldest-last-active-first.
   *
   * @returns The number of sessions pruned.
   */
  prune(options: PruneOptions = {}): number {
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    const now = Date.now();
    let pruned = 0;

    for (const id of [...this._order]) {
      const session = this._sessions.get(id);
      if (session === undefined) {
        continue;
      }
      const idleMs = now - session.lastActiveAt;
      if (idleMs > idleTimeoutMs) {
        this._sessions.delete(id);
        const idx = this._order.indexOf(id);
        if (idx >= 0) {
          this._order.splice(idx, 1);
        }
        this._totalDeleted += 1;
        this._totalPruned += 1;
        this._trackClosed(session);
        this.emit("sessionPruned", id, session);
        this.emit("sessionDeleted", id, session);
        pruned += 1;
      }
    }

    if (options.enforceCapacity && options.maxSessions !== undefined) {
      while (this._sessions.size > options.maxSessions) {
        this._evictLeastActive();
        pruned += 1;
      }
    }

    this._recomputeOldestAge();
    return pruned;
  }

  /**
   * Recompute the age of the oldest live session after mutations.
   */
  private _recomputeOldestAge(): void {
    let oldest = Infinity;
    for (const session of this._sessions.values()) {
      const age = Date.now() - session.connectedAt;
      if (age < oldest) {
        oldest = age;
      }
    }
    this._oldestAgeMs = oldest === Infinity ? 0 : oldest;
  }

  /**
   * Compute operational statistics for this store.
   */
  stats(): SessionStoreStats {
    let initialized = 0;
    for (const session of this._sessions.values()) {
      if (session.initialized) {
        initialized += 1;
      }
    }
    const lifetimeTotal = [...this._closed.values()].reduce(
      (acc, session) => acc + Math.max(0, session.lastActiveAt - session.connectedAt),
      0,
    );
    const averageLifetimeMs =
      this._closed.size > 0 ? Math.round(lifetimeTotal / this._closed.size) : 0;

    return {
      totalCreated: this._totalCreated,
      active: this._sessions.size,
      initialized,
      pending: this._sessions.size - initialized,
      totalDeleted: this._totalDeleted,
      totalPruned: this._totalPruned,
      averageLifetimeMs,
      oldestSessionAgeMs: this._oldestAgeMs,
    };
  }

  /**
   * Serialise the store to a plain JSON-safe snapshot. Live sessions are copied so later
   * mutations cannot corrupt the snapshot.
   */
  toJSON(): SessionStoreSnapshot {
    return {
      version: 1,
      config: this.config,
      sessions: this.values().map((session) => ({ ...session })),
      closed: [...this._closed.values()].map((session) => ({ ...session })),
    };
  }

  /**
   * Restore a snapshot produced by {@link SessionStore.toJSON}, replacing the current
   * contents. Invalid records are skipped and counted; the store is not left half-loaded.
   *
   * @returns The number of live sessions restored.
   */
  fromJSON(snapshot: SessionStoreSnapshot): number {
    if (snapshot === null || typeof snapshot !== "object") {
      throw new TypeError("SessionStore.fromJSON: expected a snapshot object");
    }
    this.clear();
    this._closed.clear();

    let restored = 0;
    for (const candidate of snapshot.sessions ?? []) {
      if (!isMcpSession(candidate)) {
        continue;
      }
      try {
        this.register({ ...candidate });
        restored += 1;
      } catch {
        // Skip id collisions silently; register throws only on duplicate ids.
      }
    }

    for (const candidate of snapshot.closed ?? []) {
      if (isMcpSession(candidate)) {
        this._closed.set(candidate.id, { ...candidate });
      }
    }

    this._recomputeOldestAge();
    return restored;
  }
}

/**
 * Default idle timeout used by {@link SessionStore.prune} when the caller supplies none
 * and the store's config carries no sessionIdleTimeoutMs. 30 minutes.
 */
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Default cap for the closed-session history when no maxSessions is configured.
 */
const CLOSED_HISTORY_DEFAULT_CAP = 1024;

/**
 * Convenience factory mirroring the store's constructor with a resolved configuration,
 * useful for quickly standing up a store in tests or transport adapters.
 */
export function createSessionStore(config: SessionConfig = {}): SessionStore {
  return new SessionStore(config);
}