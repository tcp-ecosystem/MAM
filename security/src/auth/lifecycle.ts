/**
 * lifecycle.ts
 *
 * `AuthLifecycle` — the operational heartbeat of the MAM auth engine.
 *
 * The lifecycle component owns everything that happens to credentials after
 * issuance and before authentication:
 *
 *  - periodic expiry sweeping (`pruneExpired`) that evicts stale tokens and
 *    API keys on a configurable interval
 *  - targeted revocation of a single token or a whole identity's credentials
 *  - full reset when an identity store is swapped or the engine is torn down
 *  - an `EventEmitter` fan-out for `issued`, `revoked`, `expired`, `pruned`,
 *    `start`, `stop` and `reset` so callers can wire audit logs, metrics and
 *    cross-cutting caches without coupling to internals
 *
 * The lifecycle coordinates three collaborating objects: the
 * {@link CredentialVerifier} (owns digests), the {@link IdentityStore} (owns
 * identities) and the {@link AuthIndex} (owns query structures). It also
 * manages an interval timer that is created lazily by {@link AuthLifecycle.start}
 * and always created `unref()`'d so it never keeps the Node process alive.
 *
 * @module auth/lifecycle
 */

import { EventEmitter } from 'node:events';
import {
  type AuthConfig,
  type AuthStats,
  createEmptyStats,
  nowMs,
  resolveConfig,
} from './types.js';
import { type CredentialVerifier, type CredentialVerifierEvents } from './retrieval.js';
import { type IdentityStore } from './store.js';
import { type AuthIndex } from './index.js';

/** Result of a single {@link AuthLifecycle.pruneExpired} sweep. */
export interface PruneResult {
  /** Number of expired tokens evicted. */
  tokens: number;
  /** Number of expired API keys evicted. */
  apiKeys: number;
  /** Epoch ms when the sweep ran. */
  at: number;
}

/** Result of {@link AuthLifecycle.revokeAll}. */
export interface RevokeAllResult {
  /** Number of tokens revoked. */
  tokens: number;
  /** Number of API keys revoked. */
  apiKeys: number;
  /** Whether the identity itself still exists afterwards. */
  identityExists: boolean;
}

/** Payloads emitted through the lifecycle {@link EventEmitter}. */
export interface AuthLifecycleEvents {
  /** A credential was issued (re-emitted from the verifier). */
  issued: CredentialVerifierEvents['issued'];
  /** A credential was revoked (re-emitted from the verifier). */
  revoked: CredentialVerifierEvents['revoked'];
  /** A token was evicted by an expiry sweep. */
  expired: { kind: 'token' | 'apiKey'; identityId: string; id: string; at: number };
  /** An expiry sweep completed. */
  pruned: PruneResult;
  /** The periodic sweeper started. */
  start: { intervalMs: number };
  /** The periodic sweeper stopped. */
  stop: {};
  /** All auth state was cleared. */
  reset: { at: number };
}

/** Constructor options for {@link AuthLifecycle}. */
export interface AuthLifecycleOptions {
  /** The credential verifier this lifecycle supervises. */
  verifier: CredentialVerifier;
  /** Optional identity store kept in sync on revokeAll/reset. */
  store?: IdentityStore;
  /** Optional auth index kept in sync on revoke/reset. */
  index?: AuthIndex;
  /** Configuration overrides (interval, pepper, defaults). */
  config?: Partial<AuthConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
}

/**
 * Coordinates revocation, expiry sweeping and lifecycle events across the
 * verifier, store and index.
 *
 * Typical usage:
 *
 * ```ts
 * const lifecycle = new AuthLifecycle({ verifier, store, index });
 * lifecycle.on('expired', (e) => audit.log('token expired', e));
 * lifecycle.start(); // begins the periodic sweep
 * lifecycle.revokeAll(identityId); // suspend a principal
 * lifecycle.stop();
 * ```
 */
export class AuthLifecycle {
  private readonly verifier: CredentialVerifier;
  private readonly store: IdentityStore | undefined;
  private readonly index: AuthIndex | undefined;
  private readonly config: AuthConfig;
  private readonly now: () => number;
  private readonly events: EventEmitter;
  private timer: NodeJS.Timeout | undefined;
  private running: boolean;
  private lastPruneAt: number | undefined;
  private readonly cleanup: Array<() => void> = [];

  /**
   * @param options Verifier plus optional collaborating store/index and config.
   */
  constructor(options: AuthLifecycleOptions) {
    this.verifier = options.verifier;
    this.store = options.store;
    this.index = options.index;
    this.config = resolveConfig(options.config);
    this.now = options.now ?? nowMs;
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.running = false;
    this.cleanup.push(this.verifier.on('issued', (payload) => this.events.emit('issued', payload)));
    this.cleanup.push(this.verifier.on('revoked', (payload) => this.events.emit('revoked', payload)));
  }

  /**
   * Subscribes to a lifecycle event. Returns an unsubscribe function.
   *
   * @param event Event name.
   * @param listener Event callback.
   * @returns Function that removes the listener.
   */
  on<K extends keyof AuthLifecycleEvents>(
    event: K,
    listener: (payload: AuthLifecycleEvents[K]) => void,
  ): () => void {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
    };
  }

  /**
   * Returns whether the periodic sweeper is currently running.
   *
   * @returns `true` when {@link AuthLifecycle.start} has been called without a
   *   matching {@link AuthLifecycle.stop}.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Performs an immediate sweep of expired tokens and API keys. Every expired
   * credential emits an `expired` event; the aggregate result is emitted as
   * `pruned` and recorded as the new `lastPruneAt`.
   *
   * @param at Reference time (defaults to the clock).
   * @returns A {@link PruneResult} describing the sweep.
   */
  pruneExpired(at: number = this.now()): PruneResult {
    const removed = this.verifier.pruneExpired(at);
    for (const token of removed.expiredTokens) {
      if (this.index) this.index.removeToken(token.id);
      this.events.emit('expired', { kind: 'token', identityId: token.identityId, id: token.id, at });
    }
    for (const key of removed.expiredApiKeys) {
      this.events.emit('expired', { kind: 'apiKey', identityId: key.identityId, id: key.hash, at });
    }
    this.lastPruneAt = at;
    const result: PruneResult = { tokens: removed.tokens, apiKeys: removed.apiKeys, at };
    this.events.emit('pruned', result);
    return result;
  }

  /**
   * Revokes a single token by id, keeping the index in sync.
   *
   * @param tokenId Token id to revoke.
   * @returns `true` when a token was revoked.
   */
  revokeToken(tokenId: string): boolean {
    const revoked = this.verifier.revokeToken(tokenId);
    if (revoked && this.index) {
      this.index.removeToken(tokenId);
    }
    return revoked;
  }

  /**
   * Revokes every token and API key belonging to an identity, then (when a
   * store is configured) deactivates the identity so it can no longer
   * authenticate with any credential.
   *
   * @param identityId Owning identity id.
   * @returns A {@link RevokeAllResult} summary.
   */
  revokeAll(identityId: string): RevokeAllResult {
    const tokens = this.verifier.revokeTokensForIdentity(identityId);
    const apiKeys = this.verifier.revokeApiKeysForIdentity(identityId);
    if (this.index) {
      for (const token of this.index.findTokensByIdentity(identityId)) {
        this.index.removeToken(token.id);
      }
    }
    if (this.store) {
      const identity = this.store.get(identityId);
      if (identity) this.store.deactivate(identityId);
    }
    return {
      tokens,
      apiKeys,
      identityExists: this.store ? this.store.has(identityId) : true,
    };
  }

  /**
   * Deactivates an identity without removing its credentials (a soft
   * suspension). Existing tokens remain stored but will be rejected at
   * verification time because the identity is inactive.
   *
   * @param identityId Identity id to suspend.
   * @returns `true` when the identity was found and deactivated.
   */
  suspendIdentity(identityId: string): boolean {
    if (!this.store) return false;
    return this.store.deactivate(identityId) !== undefined;
  }

  /**
   * Clears every credential, identity and index entry, then emits `reset`.
   *
   * @returns The total number of records cleared (tokens + API keys +
   *   identities + index entries).
   */
  reset(): number {
    let count = this.verifier.clear();
    if (this.store) count += this.store.clear();
    if (this.index) count += this.index.clear();
    this.lastPruneAt = undefined;
    this.events.emit('reset', { at: this.now() });
    return count;
  }

  /**
   * Begins the periodic expiry sweep. The interval timer is `unref()`'d so the
   * process can exit naturally. Safe to call more than once; subsequent calls
   * are ignored while running.
   *
   * @returns `true` when the sweeper was started (or was already running).
   */
  start(): boolean {
    if (this.running) return true;
    const intervalMs = this.config.pruneIntervalMs ?? 60_000;
    this.timer = setInterval(() => {
      try {
        this.pruneExpired();
      } catch {
        // A failed sweep must never crash the host process; the next tick
        // will retry. Subscribers may hook 'pruned' for observability.
      }
    }, intervalMs);
    this.timer.unref();
    this.running = true;
    this.events.emit('start', { intervalMs });
    return true;
  }

  /**
   * Stops the periodic sweeper and clears the pending timer.
   *
   * @returns `true` when a running sweeper was stopped.
   */
  stop(): boolean {
    if (!this.running) return false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.running = false;
    this.events.emit('stop', {});
    return true;
  }

  /**
   * Returns the epoch ms of the most recent sweep (or `undefined`).
   *
   * @returns Last prune timestamp, or `undefined`.
   */
  getLastPruneAt(): number | undefined {
    return this.lastPruneAt;
  }

  /**
   * Computes an {@link AuthStats} snapshot, folding in the store/index counts
   * when those collaborators are present.
   *
   * @param base Optional starting stats.
   * @returns A fresh stats object with `lastPruneAt` populated.
   */
  stats(base: AuthStats = createEmptyStats()): AuthStats {
    let stats: AuthStats = { ...base, lastPruneAt: this.lastPruneAt };
    stats = this.verifier.stats(stats);
    if (this.store) stats = this.store.stats(stats);
    if (this.index) stats = this.index.stats(stats);
    return stats;
  }

  /**
   * Tears down the lifecycle: stops the sweeper and detaches all verifier
   * listeners. Safe to call multiple times.
   */
  dispose(): void {
    this.stop();
    for (const unsubscribe of this.cleanup) unsubscribe();
    this.cleanup.length = 0;
  }
}