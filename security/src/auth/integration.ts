/**
 * integration.ts
 *
 * `Authenticator` — the high-level, composite facade over the MAM auth engine.
 *
 * This module wires the four lower layers together into a single, ergonomic
 * entry point:
 *
 *  - {@link IdentityStore}  — canonical identity registry
 *  - {@link AuthIndex}      — query index over identities and tokens
 *  - {@link CredentialVerifier} — hashing, issuance, verification
 *  - {@link AuthLifecycle}  — expiry sweeps, revocation, events
 *
 * It exposes the operations most applications need (`registerIdentity`,
 * `authenticateApiKey`, `authenticateToken`, `login`, `logout`, `current`,
 * `stats`) and additionally satisfies the {@link AuthProvider} contract so it
 * can be dropped behind an interface. {@link AuthAdapter} is a thin adapter
 * that implements {@link AuthProvider} by delegating to an `Authenticator`,
 * useful when a component only wants the interface subset.
 *
 * @module auth/integration
 */

import {
  type ApiKey,
  type AuthConfig,
  type AuthOptions,
  type AuthResult,
  type AuthStats,
  type AuthToken,
  type Identity,
  type IdentityInput,
  type Session,
  createEmptyStats,
  createIdentity,
  createSession,
  isExpired,
  isValidId,
  nowMs,
  resolveConfig,
} from './types.js';
import { type IssuedToken, type CredentialVerifier, CredentialVerifier as VerifierImpl } from './retrieval.js';
import { IdentityStore } from './store.js';
import { AuthIndex } from './index.js';
import { AuthLifecycle, type AuthLifecycleEvents, type PruneResult } from './lifecycle.js';

/**
 * The provider contract satisfied by both {@link Authenticator} and
 * {@link AuthAdapter}. Defines the minimal surface required to plug an auth
 * implementation into a host application.
 */
export interface AuthProvider {
  /** Registers a new identity (or replaces an existing one). */
  register(identity: IdentityInput): Identity;
  /** Removes an identity by id. Returns `false` when absent. */
  unregister(identityId: string): boolean;
  /** Authenticates an API key, resolving the owning identity on success. */
  authenticateApiKey(key: string): AuthResult | null;
  /** Authenticates a bearer token, resolving the owning identity on success. */
  authenticateToken(token: string): AuthResult | null;
  /** Verifies a bearer token and returns its AuthResult (alias). */
  verify(token: string): AuthResult | null;
  /** Returns engine-wide statistics. */
  stats(): AuthStats;
}

/** Result of {@link Authenticator.login}. */
export interface LoginResult {
  /** The stored token record (digest only). */
  token: AuthToken;
  /** The raw token secret to hand to the client exactly once. */
  secret: string;
  /** The session established by the login. */
  session: Session;
  /** The identity that logged in. */
  identity: Identity;
}

/** Result of {@link Authenticator.current}. */
export interface CurrentAuth {
  /** Identity currently authenticated. */
  identity: Identity;
  /** Live sessions belonging to the identity. */
  sessions: Session[];
  /** Live tokens belonging to the identity. */
  tokens: AuthToken[];
}

/** Options accepted by {@link Authenticator.login}. */
export interface LoginOptions {
  /** Token lifetime in milliseconds (overrides config). */
  ttlMs?: number;
  /** Absolute token expiry (epoch ms; overrides `ttlMs`). */
  expiresAt?: number;
  /** Scopes carried by the token. */
  scopes?: readonly string[];
  /** Session metadata attached to the created session. */
  metadata?: Readonly<Record<string, unknown>>;
  /** Explicit session lifetime in milliseconds (defaults to token ttl). */
  sessionTtlMs?: number;
}

/** Constructor options for {@link Authenticator}. */
export interface AuthenticatorOptions extends AuthOptions {
  /** Pre-built verifier (advanced use; defaults to a fresh one). */
  verifier?: CredentialVerifier;
}

/**
 * The composite authenticator: registration, authentication, sessions and
 * lifecycle in one class.
 *
 * ```ts
 * const auth = createAuthenticator({ config: { tokenTtlMs: 3600_000 } });
 * auth.start();
 * const alice = auth.registerIdentity({ name: 'alice', roles: ['admin'] });
 * const login = auth.login(alice.id);
 * // → give login.secret to the client, keep login.token in the DB
 * const result = auth.authenticateToken(login.secret);
 * ```
 */
export class Authenticator implements AuthProvider {
  private readonly store: IdentityStore;
  private readonly index: AuthIndex;
  private readonly verifier: CredentialVerifier;
  private readonly lifecycle: AuthLifecycle;
  private readonly config: AuthConfig;
  private readonly now: () => number;
  private readonly sessions: Map<string, Session> = new Map();
  private readonly sessionByToken: Map<string, string> = new Map();
  private readonly sessionByIdentity: Map<string, Set<string>> = new Map();

  /**
   * @param options Configuration, clock/entropy injectables and optional
   *   pre-built verifier.
   */
  constructor(options: AuthenticatorOptions = {}) {
    this.config = resolveConfig(options.config);
    this.now = options.now ?? nowMs;
    this.verifier = options.verifier ?? new VerifierImpl({ config: this.config, now: this.now, randomBytes: options.randomBytes });
    this.store = new IdentityStore({ now: this.now });
    this.index = new AuthIndex();
    this.lifecycle = new AuthLifecycle({
      verifier: this.verifier,
      store: this.store,
      index: this.index,
      config: this.config,
      now: this.now,
    });
    this.lifecycle.on('issued', () => {});
  }

  /**
   * Registers an identity, index it and make it available for authentication.
   *
   * @param input Identity or partial input to register.
   * @returns The stored, normalized identity.
   */
  registerIdentity(input: Identity | IdentityInput): Identity {
    const identity = this.store.registerIdentity(input);
    this.index.indexIdentity(identity);
    return identity;
  }

  /**
   * Removes an identity and revokes every credential and session tied to it.
   *
   * @param identityId Identity id to remove.
   * @returns `true` when the identity existed and was removed.
   */
  unregisterIdentity(identityId: string): boolean {
    if (!this.store.has(identityId)) return false;
    this.revokeAllSessions(identityId);
    this.verifier.revokeTokensForIdentity(identityId);
    this.verifier.revokeApiKeysForIdentity(identityId);
    this.index.removeIdentity(identityId);
    return this.store.removeIdentity(identityId);
  }

  /** Implementation of {@link AuthProvider.register}. */
  register(identity: IdentityInput): Identity {
    return this.registerIdentity(identity);
  }

  /** Implementation of {@link AuthProvider.unregister}. */
  unregister(identityId: string): boolean {
    return this.unregisterIdentity(identityId);
  }

  /**
   * Authenticates a presented API key. On success the owning identity is
   * resolved (and must be active); on any failure `null` is returned.
   *
   * @param key The raw API key secret.
   * @returns An {@link AuthResult}, or `null`.
   */
  authenticateApiKey(key: string): AuthResult | null {
    const apiKey = this.verifier.verifyApiKey(key);
    if (!apiKey) return null;
    const identity = this.store.get(apiKey.identityId);
    if (!identity || identity.active === false) return null;
    return { identity, credential: apiKey };
  }

  /**
   * Authenticates a presented bearer token. Successful verification resolves
   * the owning identity and any live session bound to the token.
   *
   * @param token The raw bearer token secret.
   * @returns An {@link AuthResult} (with `session` when one exists), or `null`.
   */
  authenticateToken(token: string): AuthResult | null {
    const verified = this.verifier.verifyToken(token);
    if (!verified) return null;
    const identity = this.store.get(verified.identityId);
    if (!identity || identity.active === false) return null;
    const sessionId = this.sessionByToken.get(verified.id);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (session && isExpired(session.expiresAt, this.now())) {
      this.endSession(session.id);
      return null;
    }
    return { identity, credential: verified, session: session && !session.revoked ? session : undefined };
  }

  /** Implementation of {@link AuthProvider.authenticateToken}. */
  verify(token: string): AuthResult | null {
    return this.authenticateToken(token);
  }

  /**
   * Performs an interactive login: issues a token, creates a session and
   * returns the one-time secret alongside the stored records.
   *
   * @param identityId Identity id to log in as.
   * @param opts Login options (ttl, scopes, session metadata).
   * @returns A {@link LoginResult}, or `null` when the identity is unknown or
   *   inactive.
   */
  login(identityId: string, opts: LoginOptions = {}): LoginResult | null {
    const identity = this.store.get(identityId);
    if (!identity || identity.active === false) return null;
    this.enforceSessionLimit(identityId);
    const issued: IssuedToken = this.verifier.issueToken(identityId, {
      ttlMs: opts.ttlMs,
      expiresAt: opts.expiresAt,
      scopes: opts.scopes,
    });
    const tokenExpiresAt = issued.token.expiresAt;
    const sessionTtlMs = opts.sessionTtlMs ?? (tokenExpiresAt ? tokenExpiresAt - issued.token.createdAt : undefined);
    const session = createSession(identityId, issued.token.id, {
      expiresAt: sessionTtlMs !== undefined ? this.now() + sessionTtlMs : undefined,
      metadata: opts.metadata,
    });
    this.sessions.set(session.id, session);
    this.sessionByToken.set(issued.token.id, session.id);
    this.addSessionToIdentity(identityId, session.id);
    this.index.indexToken(issued.token);
    return { token: issued.token, secret: issued.secret, session, identity };
  }

  /**
   * Logs out a token value, session id or token id: revokes the underlying
   * token and terminates any bound session.
   *
   * @param tokenOrSessionId Raw token secret, session id or token id.
   * @returns `true` when something was revoked.
   */
  logout(tokenOrSessionId: string): boolean {
    let revoked = false;
    if (this.sessions.has(tokenOrSessionId)) {
      revoked = this.endSession(tokenOrSessionId) || revoked;
    }
    const tokenId = this.sessionByToken.get(tokenOrSessionId);
    if (tokenId) {
      revoked = this.endSession(tokenId) || revoked;
    }
    if (this.verifier.revokeToken(tokenOrSessionId)) {
      this.index.removeToken(tokenOrSessionId);
      revoked = true;
    }
    const tokenByHash = this.index.findToken(tokenOrSessionId);
    if (tokenByHash) {
      this.index.removeToken(tokenByHash.id);
      revoked = this.verifier.revokeToken(tokenByHash.id) || revoked;
    }
    return revoked;
  }

  /**
   * Returns the current authentication state of an identity: its record, live
   * sessions and live tokens.
   *
   * @param identityId Identity id.
   * @returns A {@link CurrentAuth} summary, or `null` when the identity is
   *   unknown.
   */
  current(identityId: string): CurrentAuth | null {
    const identity = this.store.get(identityId);
    if (!identity) return null;
    const now = this.now();
    const sessions = Array.from(this.sessions.values()).filter(
      (session) => session.identityId === identityId && !session.revoked && !isExpired(session.expiresAt, now),
    );
    const tokens = this.verifier.listTokensForIdentity(identityId).filter(
      (token) => !token.revoked && !isExpired(token.expiresAt, now),
    );
    return { identity, sessions, tokens };
  }

  /**
   * Looks up the identity owning a given token (by id or raw value).
   *
   * @param tokenIdOrValue Token id or raw secret.
   * @returns The owning identity, or `undefined`.
   */
  identityForToken(tokenIdOrValue: string): Identity | undefined {
    const byId = this.index.findToken(tokenIdOrValue);
    if (byId) return this.store.get(byId.identityId);
    const verified = this.verifier.verifyToken(tokenIdOrValue);
    return verified ? this.store.get(verified.identityId) : undefined;
  }

  /**
   * Deactivates an identity (soft suspension) and revokes all its credentials.
   *
   * @param identityId Identity id to suspend.
   * @returns `true` when the identity was found and suspended.
   */
  suspend(identityId: string): boolean {
    if (!this.store.has(identityId)) return false;
    this.revokeAllSessions(identityId);
    this.verifier.revokeTokensForIdentity(identityId);
    this.verifier.revokeApiKeysForIdentity(identityId);
    this.store.deactivate(identityId);
    return true;
  }

  /**
   * Creates an API key for an identity. The raw secret is returned exactly
   * once (in `secret`); only the digest is stored.
   *
   * @param identityId Owning identity id.
   * @param options Key options (ttl, scopes, label).
   * @returns The stored record plus the one-time secret, or `null` when the
   *   identity is unknown.
   */
  createApiKey(
    identityId: string,
    options: { ttlMs?: number; expiresAt?: number; scopes?: readonly string[]; label?: string } = {},
  ): { record: Omit<ApiKey, 'key'>; secret: string } | null {
    if (!this.store.has(identityId)) return null;
    return this.verifier.createApiKey(identityId, options);
  }

  /**
   * Runs an immediate expiry sweep through the lifecycle.
   *
   * @returns A {@link PruneResult} describing the sweep.
   */
  prune(): PruneResult {
    return this.lifecycle.pruneExpired();
  }

  /** Subscribes to lifecycle events (see {@link AuthLifecycle}). */
  on<K extends keyof AuthLifecycleEvents>(
    event: K,
    listener: (payload: AuthLifecycleEvents[K]) => void,
  ): () => void {
    return this.lifecycle.on(event, listener);
  }

  /**
   * Starts the periodic expiry sweep.
   *
   * @returns `true` when started (or already running).
   */
  start(): boolean {
    return this.lifecycle.start();
  }

  /**
   * Stops the periodic expiry sweep.
   *
   * @returns `true` when a running sweep was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns `true` when the periodic sweeper is running.
   */
  isRunning(): boolean {
    return this.lifecycle.isRunning();
  }

  /**
   * Computes engine-wide {@link AuthStats}, merging session counts from the
   * authenticator's session registry.
   *
   * @returns A fresh stats object.
   */
  stats(): AuthStats {
    const now = this.now();
    const activeSessions = Array.from(this.sessions.values()).filter(
      (session) => !session.revoked && !isExpired(session.expiresAt, now),
    ).length;
    return this.lifecycle.stats({ ...createEmptyStats(), sessions: this.sessions.size, activeSessions });
  }

  /**
   * Accessors for advanced composition: returns the underlying store, index,
   * verifier and lifecycle instances.
   */
  internals(): {
    store: IdentityStore;
    index: AuthIndex;
    verifier: CredentialVerifier;
    lifecycle: AuthLifecycle;
  } {
    return { store: this.store, index: this.index, verifier: this.verifier, lifecycle: this.lifecycle };
  }

  private addSessionToIdentity(identityId: string, sessionId: string): void {
    let set = this.sessionByIdentity.get(identityId);
    if (!set) {
      set = new Set();
      this.sessionByIdentity.set(identityId, set);
    }
    set.add(sessionId);
  }

  private endSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.sessions.delete(sessionId);
    this.sessionByToken.delete(session.tokenId);
    const set = this.sessionByIdentity.get(session.identityId);
    if (set) {
      set.delete(sessionId);
      if (set.size === 0) this.sessionByIdentity.delete(session.identityId);
    }
    this.verifier.revokeToken(session.tokenId);
    this.index.removeToken(session.tokenId);
    return true;
  }

  private revokeAllSessions(identityId: string): void {
    const set = this.sessionByIdentity.get(identityId);
    if (!set) return;
    for (const sessionId of Array.from(set)) this.endSession(sessionId);
  }

  private enforceSessionLimit(identityId: string): void {
    const max = this.config.maxSessionsPerIdentity ?? 16;
    const set = this.sessionByIdentity.get(identityId);
    if (!set) return;
    while (set.size >= max) {
      const oldest = set.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.endSession(oldest);
    }
  }
}

/**
 * Factory for a ready-to-use {@link Authenticator} with merged defaults.
 *
 * @param config Configuration overrides (may be empty).
 * @param options Additional construction options (clock, entropy).
 * @returns A configured authenticator (not yet started).
 */
export function createAuthenticator(config?: Partial<AuthConfig>, options: AuthOptions = {}): Authenticator {
  return new Authenticator({ config, ...options });
}

/**
 * A minimal adapter that implements {@link AuthProvider} by delegating to an
 * {@link Authenticator}. Use it when a consumer only needs the provider
 * surface and should not touch sessions or lifecycle directly.
 */
export class AuthAdapter implements AuthProvider {
  private readonly auth: Authenticator;

  /**
   * @param auth The authenticator to delegate to (defaults to a fresh one).
   */
  constructor(auth?: Authenticator) {
    this.auth = auth ?? createAuthenticator();
  }

  /** Delegates to {@link Authenticator.registerIdentity}. */
  register(identity: IdentityInput): Identity {
    return this.auth.registerIdentity(identity);
  }

  /** Delegates to {@link Authenticator.unregisterIdentity}. */
  unregister(identityId: string): boolean {
    return this.auth.unregisterIdentity(identityId);
  }

  /** Delegates to {@link Authenticator.authenticateApiKey}. */
  authenticateApiKey(key: string): AuthResult | null {
    return this.auth.authenticateApiKey(key);
  }

  /** Delegates to {@link Authenticator.authenticateToken}. */
  authenticateToken(token: string): AuthResult | null {
    return this.auth.authenticateToken(token);
  }

  /** Delegates to {@link Authenticator.verify}. */
  verify(token: string): AuthResult | null {
    return this.auth.verify(token);
  }

  /** Delegates to {@link Authenticator.stats}. */
  stats(): AuthStats {
    return this.auth.stats();
  }

  /**
   * Exposes the wrapped authenticator for callers that need session-level
   * operations (login/logout/current) beyond the provider contract.
   *
   * @returns The wrapped {@link Authenticator}.
   */
  unwrap(): Authenticator {
    return this.auth;
  }
}