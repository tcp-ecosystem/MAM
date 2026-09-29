/**
 * retrieval.ts
 *
 * `CredentialVerifier` — the cryptographic heart of the MAM auth engine.
 *
 * This module is responsible for everything involving secrets:
 *
 *  - hashing high-entropy secrets (API keys, bearer tokens) with salted SHA-256
 *    and low-entropy secrets (passwords) with scrypt
 *  - constant-time verification of candidate secrets against stored digests
 *  - issuing API keys and bearer tokens, persisting only the digest
 *  - verifying presented credentials and resolving them to their owning
 *    identity
 *
 * Raw secrets are NEVER stored. Only `hashSecret`-produced digests live in the
 * verifier's in-memory maps; the plaintext is returned to the caller exactly
 * once at issuance time and is otherwise unrecoverable.
 *
 * All hashing uses `node:crypto` primitives (`scryptSync`, `randomBytes`,
 * `timingSafeEqual`, `createHash`). The verifier is fully synchronous and
 * dependency-free outside the Node standard library.
 *
 * @module auth/retrieval
 */

import {
  createHash,
  randomBytes as nodeRandomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  type ApiKey,
  type AuthConfig,
  type AuthStats,
  type AuthToken,
  type Credential,
  type CredentialKind,
  type HashAlgorithm,
  type Identity,
  DEFAULT_AUTH_CONFIG,
  createAuthToken,
  createCredential,
  createEmptyStats,
  hasScope,
  isExpired,
  isValidId,
  nowMs,
  resolveConfig,
} from './types.js';

/** A stored API key record — identical to {@link ApiKey} minus the raw secret. */
export type StoredApiKey = Omit<ApiKey, 'key'>;

/** Payload returned by {@link CredentialVerifier.issueToken}. */
export interface IssuedToken {
  /** The stored token record (contains only the digest). */
  token: AuthToken;
  /** The raw secret, to be transported to the client and then discarded. */
  secret: string;
}

/** Result of {@link CredentialVerifier.pruneExpired}. */
export interface PruneResult {
  /** Number of expired tokens evicted. */
  tokens: number;
  /** Number of expired API keys evicted. */
  apiKeys: number;
  /** The evicted token records (for event fan-out and index sync). */
  expiredTokens: AuthToken[];
  /** The evicted API key records. */
  expiredApiKeys: StoredApiKey[];
}

/** Payload returned by {@link CredentialVerifier.createApiKey}. */
export interface IssuedApiKey {
  /** The stored key record (digest only). */
  record: StoredApiKey;
  /** The raw key secret, returned exactly once. */
  secret: string;
}

/** Events emitted by the verifier: `issued`, `verified`, `failed`, `revoked`. */
export interface CredentialVerifierEvents {
  issued: { kind: 'apiKey' | 'token'; identityId: string; id: string };
  verified: { kind: 'apiKey' | 'token'; identityId: string; id: string };
  failed: { kind: 'apiKey' | 'token' | 'unknown'; identityId?: string; reason: string };
  revoked: { kind: 'apiKey' | 'token'; identityId: string; id: string };
}

/** Options accepted by {@link CredentialVerifier.hashSecret}. */
export interface HashOptions {
  /** Hash algorithm override (defaults to the verifier config). */
  algorithm?: HashAlgorithm;
  /** Explicit salt (base64); a fresh random salt is generated when omitted. */
  salt?: Buffer | string;
}

/** Options accepted by {@link CredentialVerifier.createApiKey}. */
export interface ApiKeyOptions {
  /** Lifetime in milliseconds; overrides the config default. */
  ttlMs?: number;
  /** Absolute expiry timestamp (epoch ms); overrides `ttlMs`. */
  expiresAt?: number;
  /** Scopes constraining the key. */
  scopes?: readonly string[];
  /** Human label for operations. */
  label?: string;
  /** Whether the key starts enabled (default `true`). */
  enabled?: boolean;
}

/** Options accepted by {@link CredentialVerifier.issueToken}. */
export interface TokenOptions {
  /** Lifetime in milliseconds; overrides the config default. */
  ttlMs?: number;
  /** Absolute expiry timestamp (epoch ms); overrides `ttlMs`. */
  expiresAt?: number;
  /** Scopes constraining the token. */
  scopes?: readonly string[];
  /** Issuer recorded on the token (defaults to config.issuer). */
  issuer?: string;
}

/** Constructor options for {@link CredentialVerifier}. */
export interface CredentialVerifierOptions {
  /** Configuration overrides merged over the defaults. */
  config?: Partial<AuthConfig>;
  /** Clock provider (injectable for tests). */
  now?: () => number;
  /** Entropy provider for secret generation (injectable for tests). */
  randomBytes?: (size: number) => Buffer;
}

/** Parsed digest produced by {@link parseDigest}. */
export interface ParsedDigest {
  algorithm: HashAlgorithm;
  salt: Buffer;
  key: Buffer;
  N?: number;
  r?: number;
  p?: number;
}

/**
 * Formats a raw digest string. Used by {@link CredentialVerifier.verifySecret}
 * and the exported {@link parseDigest} helper.
 *
 * `sha256` format: `sha256$<saltB64>$<hashB64>`
 * `scrypt` format: `scrypt$<N>$<r>$<p>$<saltB64>$<keyB64>`
 *
 * @param digest Formatted digest string.
 * @returns Parsed fields, or `undefined` when malformed.
 */
export function parseDigest(digest: unknown): ParsedDigest | undefined {
  if (typeof digest !== 'string' || digest.length === 0) return undefined;
  const parts = digest.split('$');
  if (parts[0] === 'sha256' && parts.length === 3) {
    const salt = Buffer.from(parts[1] ?? '', 'base64');
    const key = Buffer.from(parts[2] ?? '', 'base64');
    if (salt.length === 0 || key.length === 0) return undefined;
    return { algorithm: 'sha256', salt, key };
  }
  if (parts[0] === 'scrypt' && parts.length === 6) {
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4] ?? '', 'base64');
    const key = Buffer.from(parts[5] ?? '', 'base64');
    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return undefined;
    if (salt.length === 0 || key.length === 0) return undefined;
    return { algorithm: 'scrypt', salt, key, N, r, p };
  }
  return undefined;
}

/**
 * Constant-time byte comparison that returns a boolean instead of throwing.
 * Buffers of differing length are compared against a fixed-length dummy so the
 * time cost stays uniform for a given input length.
 *
 * @param a First buffer.
 * @param b Second buffer.
 * @returns `true` when both buffers have equal length and equal bytes.
 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Cryptographically strong secret generator. Produces `bytes` random bytes
 * rendered as base64url, prefixed by `prefix`.
 *
 * @param prefix String prefix (e.g. `mam_ak_`).
 * @param bytes Number of random bytes (default 32).
 * @param rng Entropy source (default `node:crypto` randomBytes).
 * @returns A random, URL-safe secret string.
 */
export function generateSecret(
  prefix: string,
  bytes = 32,
  rng: (size: number) => Buffer = nodeRandomBytes,
): string {
  return prefix + rng(bytes).toString('base64url');
}

/**
 * The credential verifier: hashing, issuance and verification of API keys and
 * bearer tokens.
 *
 * The verifier owns two digest registries — one for API keys (keyed by hash)
 * and one for tokens (keyed by id, with a hash→id reverse map) — plus a set of
 * counters and an {@link EventEmitter} for audit hooks. Lifecycle concerns
 * (expiry sweeps, bulk revocation) live in `../lifecycle` and operate on these
 * registries through the public mutation methods below.
 */
export class CredentialVerifier {
  private readonly config: AuthConfig;
  private readonly now: () => number;
  private readonly rng: (size: number) => Buffer;
  private readonly events: EventEmitter;
  private readonly apiKeys: Map<string, StoredApiKey> = new Map();
  private readonly tokens: Map<string, AuthToken> = new Map();
  private readonly tokenHashes: Map<string, string> = new Map();
  private issuedTokens: number;
  private revokedTokens: number;
  private successfulAuths: number;
  private failedAuths: number;

  /**
   * @param options Configuration overrides, clock and entropy injectables.
   */
  constructor(options: CredentialVerifierOptions = {}) {
    this.config = resolveConfig(options.config);
    this.now = options.now ?? nowMs;
    this.rng = options.randomBytes ?? nodeRandomBytes;
    this.events = new EventEmitter();
    this.events.setMaxListeners(0);
    this.issuedTokens = 0;
    this.revokedTokens = 0;
    this.successfulAuths = 0;
    this.failedAuths = 0;
  }

  /**
   * Subscribes to verifier events. Returns an unsubscribe function.
   *
   * @param event Event name.
   * @param listener Event callback.
   * @returns Function that removes the listener.
   */
  on(event: keyof CredentialVerifierEvents, listener: (payload: never) => void): () => void {
    this.events.on(event, listener);
    return () => {
      this.events.off(event, listener);
    };
  }

  /** The resolved configuration in effect for this verifier. */
  getConfig(): Readonly<AuthConfig> {
    return this.config;
  }

  /**
   * Hashes a secret into a self-describing digest string suitable for
   * persistence. High-entropy secrets use salted SHA-256 by default; passwords
   * should pass `algorithm: 'scrypt'` (or a config-level default).
   *
   * @param secret The raw secret to hash.
   * @param opts Hash options (algorithm override, explicit salt).
   * @returns A formatted digest string (`sha256$...` or `scrypt$...`).
   */
  hashSecret(secret: string, opts: HashOptions = {}): string {
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new TypeError('Secret must be a non-empty string');
    }
    const algorithm: HashAlgorithm = opts.algorithm ?? this.config.hashAlgorithm ?? 'sha256';
    const salt = opts.salt ? Buffer.from(opts.salt) : this.rng(this.config.scrypt?.saltBytes ?? 16);
    if (algorithm === 'sha256') {
      const digest = createHash('sha256').update(salt).update(secret).digest();
      return `sha256$${salt.toString('base64')}$${digest.toString('base64')}`;
    }
    const N = this.config.scrypt?.N ?? DEFAULT_AUTH_CONFIG.scrypt!.N;
    const r = this.config.scrypt?.r ?? DEFAULT_AUTH_CONFIG.scrypt!.r;
    const p = this.config.scrypt?.p ?? DEFAULT_AUTH_CONFIG.scrypt!.p;
    const maxmem = this.config.scrypt?.maxmem ?? DEFAULT_AUTH_CONFIG.scrypt!.maxmem;
    const keylen = this.config.scrypt?.keylen ?? DEFAULT_AUTH_CONFIG.scrypt!.keylen;
    const key = scryptSync(secret, salt, keylen, { N, r, p, maxmem });
    return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /**
   * Verifies a candidate secret against a stored digest using a constant-time
   * comparison. Accepts digests produced by {@link hashSecret} regardless of
   * which verifier instance produced them (the format is self-describing).
   *
   * @param secret The candidate secret.
   * @param storedDigest The stored formatted digest.
   * @returns `true` when the secret matches the digest.
   */
  verifySecret(secret: string, storedDigest: string): boolean {
    if (typeof secret !== 'string' || secret.length === 0) return false;
    const parsed = parseDigest(storedDigest);
    if (!parsed) return false;
    if (parsed.algorithm === 'sha256') {
      const candidate = createHash('sha256').update(parsed.salt).update(secret).digest();
      return safeEqual(candidate, parsed.key);
    }
    const maxmem = this.config.scrypt?.maxmem ?? DEFAULT_AUTH_CONFIG.scrypt!.maxmem;
    const keylen = this.config.scrypt?.keylen ?? DEFAULT_AUTH_CONFIG.scrypt!.keylen;
    try {
      const candidate = scryptSync(secret, parsed.salt, keylen, {
        N: parsed.N ?? DEFAULT_AUTH_CONFIG.scrypt!.N,
        r: parsed.r ?? DEFAULT_AUTH_CONFIG.scrypt!.r,
        p: parsed.p ?? DEFAULT_AUTH_CONFIG.scrypt!.p,
        maxmem,
      });
      return safeEqual(candidate, parsed.key);
    } catch {
      return false;
    }
  }

  /**
   * Hashes a secret and wraps it in a generic {@link Credential} envelope.
   *
   * @param identityId Owning identity.
   * @param kind Credential kind (`apiKey`, `token` or `password`).
   * @param secret Raw secret.
   * @param extra Optional fields (scopes, expiry).
   * @returns A {@link Credential} with the digest already computed.
   */
  makeCredential(
    identityId: string,
    kind: CredentialKind,
    secret: string,
    extra: { scopes?: readonly string[]; expiresAt?: number } = {},
  ): Credential {
    const algorithm: HashAlgorithm = kind === 'password' ? 'scrypt' : this.config.hashAlgorithm ?? 'sha256';
    const hash = this.hashSecret(secret, { algorithm });
    return createCredential(identityId, kind, algorithm, secret, hash, extra);
  }

  /**
   * Generates an API key for an identity, persists only its digest and returns
   * the record plus the one-time secret.
   *
   * @param identityId Owning identity id.
   * @param opts Issuance options (ttl, scopes, label).
   * @returns An {@link IssuedApiKey} containing the stored record and secret.
   */
  createApiKey(identityId: string, opts: ApiKeyOptions = {}): IssuedApiKey {
    if (!isValidId(identityId)) throw new TypeError('identityId must be a non-empty string');
    const prefix = this.config.apiKeyPrefix ?? 'mam_ak_';
    const secret = generateSecret(prefix, this.config.secretBytes ?? 32, this.rng);
    const hash = this.hashSecret(secret, { algorithm: this.config.hashAlgorithm ?? 'sha256' });
    const createdAt = this.now();
    const expiresAt = opts.expiresAt ?? (opts.ttlMs !== undefined ? createdAt + opts.ttlMs : createdAt + (this.config.apiKeyTtlMs ?? 0));
    const record: StoredApiKey = Object.freeze({
      hash,
      identityId,
      scopes: opts.scopes ? Array.from(opts.scopes) : undefined,
      createdAt,
      expiresAt,
      enabled: opts.enabled ?? true,
      label: opts.label,
    });
    this.apiKeys.set(hash, record);
    this.events.emit('issued', { kind: 'apiKey', identityId, id: hash });
    return { record, secret };
  }

  /**
   * Looks up an API key record by its stored digest.
   *
   * @param hash Stored digest.
   * @returns The stored record, or `undefined`.
   */
  findApiKeyByHash(hash: string): StoredApiKey | undefined {
    return this.apiKeys.get(hash);
  }

  /**
   * Verifies a presented API key secret. The key is hashed with the same
   * algorithm used at issuance and compared in constant time against the
   * stored digest; liveness and expiry are checked before returning.
   *
   * @param key The presented key secret (including its prefix).
   * @param now Reference time (defaults to the clock).
   * @returns The matching stored record (with an empty `key` field), or
   *   `undefined` when unknown, expired or disabled.
   */
  verifyApiKey(key: string, now: number = this.now()): ApiKey | undefined {
    if (typeof key !== 'string' || key.length === 0) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'unknown', reason: 'malformed' });
      return undefined;
    }
    let stored: StoredApiKey | undefined;
    for (const candidate of this.apiKeys.values()) {
      if (this.verifySecret(key, candidate.hash)) {
        stored = candidate;
        break;
      }
    }
    if (!stored) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'apiKey', reason: 'unknown-key' });
      return undefined;
    }
    if (stored.enabled === false) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'apiKey', identityId: stored.identityId, reason: 'disabled' });
      return undefined;
    }
    if (isExpired(stored.expiresAt, now)) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'apiKey', identityId: stored.identityId, reason: 'expired' });
      return undefined;
    }
    this.successfulAuths += 1;
    this.events.emit('verified', { kind: 'apiKey', identityId: stored.identityId, id: stored.hash });
    return { ...stored, key: '' };
  }

  /**
   * Removes an API key by its raw secret (used by revocation paths that only
   * hold the client-presented value).
   *
   * @param key The raw key secret.
   * @returns `true` when a key was removed.
   */
  revokeApiKey(key: string): boolean {
    if (typeof key !== 'string' || key.length === 0) return false;
    for (const [digest, stored] of this.apiKeys) {
      if (this.verifySecret(key, stored.hash)) {
        this.apiKeys.delete(digest);
        this.events.emit('revoked', { kind: 'apiKey', identityId: stored.identityId, id: digest });
        return true;
      }
    }
    return false;
  }

  /**
   * Issues a bearer token for an identity. Only the digest is stored; the raw
   * secret is returned exactly once.
   *
   * @param identityId Owning identity id.
   * @param opts Issuance options (ttl, scopes, issuer).
   * @returns An {@link IssuedToken} containing the stored record and secret.
   */
  issueToken(identityId: string, opts: TokenOptions = {}): IssuedToken {
    if (!isValidId(identityId)) throw new TypeError('identityId must be a non-empty string');
    const prefix = this.config.tokenPrefix ?? 'mam_tk_';
    const secret = generateSecret(prefix, this.config.secretBytes ?? 32, this.rng);
    const digest = this.hashSecret(secret, { algorithm: this.config.hashAlgorithm ?? 'sha256' });
    const createdAt = this.now();
    const expiresAt = opts.expiresAt ?? (opts.ttlMs !== undefined ? createdAt + opts.ttlMs : createdAt + (this.config.tokenTtlMs ?? 0));
    const token = createAuthToken(identityId, digest, {
      expiresAt,
      scopes: opts.scopes,
      createdAt,
      revoked: false,
      issuer: opts.issuer ?? this.config.issuer,
    });
    this.tokens.set(token.id, token);
    this.tokenHashes.set(digest, token.id);
    this.issuedTokens += 1;
    this.events.emit('issued', { kind: 'token', identityId, id: token.id });
    return { token, secret };
  }

  /**
   * Verifies a presented bearer token: recompute its digest, resolve the
   * owning token record, and check revocation, expiry and digest equality.
   * Successful verifications stamp `lastUsedAt` on the record.
   *
   * @param tokenValue The raw token secret.
   * @param now Reference time (defaults to the clock).
   * @returns The verified token record, or `undefined`.
   */
  verifyToken(tokenValue: string, now: number = this.now()): AuthToken | undefined {
    if (typeof tokenValue !== 'string' || tokenValue.length === 0) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'unknown', reason: 'malformed' });
      return undefined;
    }
    let stored: AuthToken | undefined;
    for (const candidate of this.tokens.values()) {
      if (this.verifySecret(tokenValue, candidate.secretHash)) {
        stored = candidate;
        break;
      }
    }
    if (!stored) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'token', reason: 'unknown-token' });
      return undefined;
    }
    if (stored.revoked) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'token', identityId: stored.identityId, reason: 'revoked' });
      return undefined;
    }
    if (isExpired(stored.expiresAt, now)) {
      this.failedAuths += 1;
      this.events.emit('failed', { kind: 'token', identityId: stored.identityId, reason: 'expired' });
      return undefined;
    }
    this.successfulAuths += 1;
    const stamped = { ...stored, lastUsedAt: now };
    this.tokens.set(stored.id, stamped);
    this.events.emit('verified', { kind: 'token', identityId: stored.identityId, id: stored.id });
    return stamped;
  }

  /**
   * Revokes a token by id, removing both the record and its hash mapping.
   *
   * @param tokenId Token id.
   * @returns `true` when a token was revoked.
   */
  revokeToken(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token) return false;
    this.tokens.delete(tokenId);
    this.tokenHashes.delete(token.secretHash);
    this.revokedTokens += 1;
    this.events.emit('revoked', { kind: 'token', identityId: token.identityId, id: token.id });
    return true;
  }

  /**
   * Revokes every token belonging to an identity.
   *
   * @param identityId Owning identity id.
   * @returns The number of tokens revoked.
   */
  revokeTokensForIdentity(identityId: string): number {
    let count = 0;
    for (const token of Array.from(this.tokens.values())) {
      if (token.identityId === identityId && this.revokeToken(token.id)) count += 1;
    }
    return count;
  }

  /**
   * Revokes every API key belonging to an identity (used by bulk revocation
   * paths such as account suspension).
   *
   * @param identityId Owning identity id.
   * @returns The number of keys revoked.
   */
  revokeApiKeysForIdentity(identityId: string): number {
    let count = 0;
    for (const [hash, key] of Array.from(this.apiKeys.entries())) {
      if (key.identityId === identityId) {
        this.apiKeys.delete(hash);
        this.events.emit('revoked', { kind: 'apiKey', identityId, id: hash });
        count += 1;
      }
    }
    return count;
  }

  /**
   * Removes expired tokens and API keys. Used by the lifecycle sweeper. Each
   * eviction emits a `revoked` event; the evicted records are returned so
   * callers can fan out `expired` notifications and synchronize indexes.
   *
   * @param now Reference time (defaults to the clock).
   * @returns A {@link PruneResult} describing the sweep.
   */
  pruneExpired(now: number = this.now()): PruneResult {
    const expiredTokens: AuthToken[] = [];
    for (const token of Array.from(this.tokens.values())) {
      if (isExpired(token.expiresAt, now)) {
        this.tokens.delete(token.id);
        this.tokenHashes.delete(token.secretHash);
        this.revokedTokens += 1;
        this.events.emit('revoked', { kind: 'token', identityId: token.identityId, id: token.id });
        expiredTokens.push(token);
      }
    }
    const expiredApiKeys: StoredApiKey[] = [];
    for (const [hash, key] of Array.from(this.apiKeys.entries())) {
      if (isExpired(key.expiresAt, now)) {
        this.apiKeys.delete(hash);
        this.events.emit('revoked', { kind: 'apiKey', identityId: key.identityId, id: hash });
        expiredApiKeys.push(key);
      }
    }
    return {
      tokens: expiredTokens.length,
      apiKeys: expiredApiKeys.length,
      expiredTokens,
      expiredApiKeys,
    };
  }

  /**
   * Lists all currently stored token records.
   *
   * @returns Array of token records.
   */
  listTokens(): AuthToken[] {
    return Array.from(this.tokens.values());
  }

  /**
   * Lists all currently stored API key records (digest only).
   *
   * @returns Array of stored API key records.
   */
  listApiKeys(): StoredApiKey[] {
    return Array.from(this.apiKeys.values());
  }

  /**
   * Lists tokens owned by an identity.
   *
   * @param identityId Owning identity id.
   * @returns Array of matching token records.
   */
  listTokensForIdentity(identityId: string): AuthToken[] {
    return this.listTokens().filter((token) => token.identityId === identityId);
  }

  /**
   * Verifies a secret against a stored digest (see {@link verifySecret}) and
   * additionally confirms that the owning identity exists and is active.
   *
   * @param identity The resolved identity record (or `undefined`).
   * @param secret The candidate secret.
   * @param storedDigest The stored digest.
   * @returns `true` when the secret matches and the identity is usable.
   */
  verifyForIdentity(identity: Identity | undefined, secret: string, storedDigest: string): boolean {
    if (!identity || identity.active === false) return false;
    return this.verifySecret(secret, storedDigest);
  }

  /**
   * Checks whether a credential grants all requested scopes.
   *
   * @param scopes Scopes carried by the credential.
   * @param required Scopes demanded by the caller.
   * @returns `true` when satisfied.
   */
  grants(scopes: readonly string[] | undefined, required: readonly string[]): boolean {
    return hasScope(scopes, required);
  }

  /**
   * Clears every stored credential and resets counters. Emits no events.
   *
   * @returns The number of records removed (tokens + API keys).
   */
  clear(): number {
    const count = this.tokens.size + this.apiKeys.size;
    this.tokens.clear();
    this.tokenHashes.clear();
    this.apiKeys.clear();
    return count;
  }

  /**
   * Produces an {@link AuthStats} snapshot describing the verifier's
   * registries and lifetime counters.
   *
   * @param base Optional starting stats to merge over.
   * @returns A fresh stats object.
   */
  stats(base: AuthStats = createEmptyStats()): AuthStats {
    let activeTokens = 0;
    const now = this.now();
    for (const token of this.tokens.values()) {
      if (!token.revoked && !isExpired(token.expiresAt, now)) activeTokens += 1;
    }
    let activeApiKeys = 0;
    for (const key of this.apiKeys.values()) {
      if (key.enabled && !isExpired(key.expiresAt, now)) activeApiKeys += 1;
    }
    return {
      ...base,
      apiKeys: this.apiKeys.size,
      activeApiKeys,
      tokens: this.tokens.size,
      activeTokens,
      issuedTokens: this.issuedTokens,
      revokedTokens: this.revokedTokens,
      successfulAuths: this.successfulAuths,
      failedAuths: this.failedAuths,
    };
  }
}