/**
 * types.ts
 *
 * Core type definitions, type guards, factories and default values for the MAM
 * Auth layer. Every entity that flows through the authentication pipeline
 * (identities, API keys, bearer tokens, sessions, credentials) is described
 * here so that the store, index, verifier, lifecycle and integration layers
 * share one canonical shape.
 *
 * This module is deliberately dependency-free (only `node:crypto` for entropy
 * based id generation) and acts as the single source of truth for validation
 * logic. Guards follow the "narrow before use" philosophy: callers may rely on
 * the returned predicates to reduce an `unknown` payload to a fully typed
 * entity without casting.
 *
 * @module auth/types
 */

import { randomUUID, createHash } from 'node:crypto';

/**
 * The set of identity categories understood by the MAM auth engine.
 *
 * - `user`:    a human account (developer, operator, end user).
 * - `agent`:   an autonomous or semi-autonomous AI/software agent.
 * - `service`: a long-lived non-interactive service principal.
 * - `system`:  the platform itself / trusted bootstrap identities.
 */
export const IDENTITY_TYPES = ['user', 'agent', 'service', 'system'] as const;

/**
 * The `IdentityType` union. Kept as a string literal union so that switch
 * statements and index keys remain exhaustively checkable at compile time.
 */
export type IdentityType = (typeof IDENTITY_TYPES)[number];

/**
 * Normalized hash algorithm identifiers accepted by the credential verifier.
 *
 * - `sha256`: fast single-round salted SHA-256 (only suitable for high-entropy
 *   generated secrets such as API keys and bearer tokens).
 * - `scrypt`: memory-hard password KDF (suitable for human-chosen passwords).
 */
export type HashAlgorithm = 'sha256' | 'scrypt';

/**
 * The kind of credential being described by a {@link Credential} record.
 */
export type CredentialKind = 'apiKey' | 'token' | 'password';

/**
 * A principal that may be authenticated by the MAM auth engine.
 *
 * An identity is the stable subject of every auth decision. It carries a
 * stable `id`, a display `name`, a coarse `type`, a set of `roles` used for
 * coarse-grained authorization, a liveness flag and arbitrary `metadata`.
 */
export interface Identity {
  /** Stable, globally unique identity identifier (opaque, non-sequential). */
  readonly id: string;
  /** Optional human/display name for the identity. */
  readonly name?: string;
  /** The coarse category of principal (`user`, `agent`, `service`, `system`). */
  readonly type: IdentityType;
  /** Ordered list of role labels attached to the identity (may be empty). */
  readonly roles: readonly string[];
  /** Whether the identity is currently permitted to authenticate. */
  readonly active?: boolean;
  /** Free-form application metadata attached to the identity. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Creation timestamp in epoch milliseconds (when the identity was born). */
  readonly createdAt: number;
}

/**
 * Input shape accepted by identity factory functions. Every field except `id`
 * is optional at construction time; sensible defaults are applied so that
 * callers never need to know the full identity shape up front.
 */
export interface IdentityInput {
  /** Optional explicit identity id; a random id is generated when omitted. */
  id?: string;
  /** Display name. */
  name?: string;
  /** Identity category; defaults to `user`. */
  type?: IdentityType;
  /** Initial roles; defaults to an empty array. */
  roles?: readonly string[];
  /** Liveness flag; defaults to `true`. */
  active?: boolean;
  /** Application metadata; defaults to an empty object. */
  metadata?: Readonly<Record<string, unknown>>;
  /** Creation timestamp; defaults to the current wall clock. */
  createdAt?: number;
}

/**
 * A long-lived API key credential bound to a single identity.
 *
 * The raw `key` value is only ever materialized inside this process at
 * creation time. Downstream stores persist only the `hash` plus bookkeeping
 * fields; the secret itself is returned exactly once to the caller.
 */
export interface ApiKey {
  /** The raw key secret (only populated by creation / successful issue). */
  readonly key: string;
  /** Deterministic hash of the raw key secret (what is actually stored). */
  readonly hash: string;
  /** Identity this key authenticates on behalf of. */
  readonly identityId: string;
  /** Optional scope labels constraining what this key may do. */
  readonly scopes?: readonly string[];
  /** Epoch ms creation timestamp. */
  readonly createdAt: number;
  /** Epoch ms expiry timestamp; undefined means the key never expires. */
  readonly expiresAt?: number;
  /** Whether the key is currently permitted to authenticate. */
  readonly enabled: boolean;
  /** Human label for operational purposes (e.g. "ci-robot"). */
  readonly label?: string;
}

/**
 * A short-lived bearer token issued to an identity.
 *
 * Like {@link ApiKey}, only the `secretHash` is stored; the raw token value is
 * returned once by the issuing call and must be transported to the client.
 */
export interface AuthToken {
  /** Stable token identifier (referenced by revocation calls and sessions). */
  readonly id: string;
  /** Identity the token was issued to. */
  readonly identityId: string;
  /** Hash of the raw token secret. */
  readonly secretHash: string;
  /** Epoch ms expiry; undefined means the token never expires. */
  readonly expiresAt?: number;
  /** Optional scopes constraining what the token may do. */
  readonly scopes?: readonly string[];
  /** Epoch ms creation timestamp. */
  readonly createdAt: number;
  /** Whether the token has been explicitly revoked. */
  readonly revoked: boolean;
  /** Epoch ms timestamp of the last successful verification. */
  readonly lastUsedAt?: number;
  /** Issuer label recorded on the token (from AuthConfig.issuer). */
  readonly issuer?: string;
}

/**
 * An interactive session binding an identity to a live token.
 *
 * Sessions give the integration layer a higher-level view of "who is signed
 * in right now" without having to reason about raw token hashes.
 */
export interface Session {
  /** Stable session identifier. */
  readonly id: string;
  /** Identity that owns the session. */
  readonly identityId: string;
  /** AuthToken id backing this session. */
  readonly tokenId: string;
  /** Epoch ms creation timestamp. */
  readonly createdAt: number;
  /** Epoch ms expiry; undefined means the session does not expire. */
  readonly expiresAt?: number;
  /** Epoch ms of last activity observed on this session. */
  readonly lastUsedAt?: number;
  /** Whether the session has been terminated. */
  readonly revoked: boolean;
  /** Application metadata attached to the session. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A generic credential envelope produced by the verifier layer.
 *
 * Useful when a single component must reason about different credential kinds
 * (API key, token, password) through one uniform shape.
 */
export interface Credential {
  /** The secret value (only present immediately after generation). */
  readonly secret: string;
  /** The stored digest. */
  readonly hash: string;
  /** Algorithm used to produce `hash`. */
  readonly algorithm: HashAlgorithm;
  /** Owning identity. */
  readonly identityId: string;
  /** Credential category. */
  readonly kind: CredentialKind;
  /** Epoch ms creation timestamp. */
  readonly createdAt: number;
  /** Epoch ms expiry; undefined means never expires. */
  readonly expiresAt?: number;
  /** Optional scopes carried by the credential. */
  readonly scopes?: readonly string[];
}

/**
 * Tuning knobs for the whole auth engine.
 *
 * Values are intentionally conservative by default so that a fresh
 * `createAuthenticator()` is safe to drop into any Node process.
 */
export interface AuthConfig {
  /** Application-specific secret mixed into every digest (optional hardening). */
  pepper?: string;
  /** Default hash algorithm for generated secrets. */
  hashAlgorithm?: HashAlgorithm;
  /** scrypt cost parameters (only used when algorithm is `scrypt`). */
  scrypt?: {
    /** CPU/memory cost parameter N (power of two). */
    N?: number;
    /** Block size r. */
    r?: number;
    /** Parallelization p. */
    p?: number;
    /** Maximum memory (bytes) scrypt may use. */
    maxmem?: number;
    /** Salt length in bytes. */
    saltBytes?: number;
    /** Derived key length in bytes. */
    keylen?: number;
  };
  /** Default lifetime of issued tokens in milliseconds (default 24h). */
  tokenTtlMs?: number;
  /** Default lifetime of issued API keys in milliseconds (default 90d). */
  apiKeyTtlMs?: number;
  /** Interval (ms) between automatic expiry sweeps (default 60s). */
  pruneIntervalMs?: number;
  /** Upper bound of concurrent sessions per identity (default 16). */
  maxSessionsPerIdentity?: number;
  /** Label recorded as the token `issuer`. */
  issuer?: string;
  /** Prefix used for generated API keys (default `mam_ak_`). */
  apiKeyPrefix?: string;
  /** Prefix used for generated bearer tokens (default `mam_tk_`). */
  tokenPrefix?: string;
  /** Random bytes drawn for generated secrets (default 32). */
  secretBytes?: number;
}

/**
 * Aggregate counters describing the health and activity of the auth engine.
 *
 * `AuthStats` is produced by `stats()` on stores, indexes and the composite
 * authenticator, and is safe to serialize for metrics endpoints.
 */
export interface AuthStats {
  /** Total number of registered identities. */
  identities: number;
  /** Identities currently flagged active. */
  activeIdentities: number;
  /** Total stored API key digests. */
  apiKeys: number;
  /** API keys currently enabled and unexpired. */
  activeApiKeys: number;
  /** Total stored token digests. */
  tokens: number;
  /** Tokens currently unrevoked and unexpired. */
  activeTokens: number;
  /** Total active sessions. */
  sessions: number;
  /** Sessions currently live (unrevoked and unexpired). */
  activeSessions: number;
  /** Epoch ms of the last expiry sweep (undefined before first sweep). */
  lastPruneAt?: number;
  /** Lifetime count of successfully issued tokens. */
  issuedTokens: number;
  /** Lifetime count of revoked tokens. */
  revokedTokens: number;
  /** Lifetime count of successful authentications. */
  successfulAuths: number;
  /** Lifetime count of failed authentications. */
  failedAuths: number;
}

/**
 * Construction options accepted by the composite {@link Authenticator}.
 *
 * All fields are optional; defaults come from {@link DEFAULT_AUTH_CONFIG} and
 * the real system clock.
 */
export interface AuthOptions {
  /** Configuration overrides merged over the defaults. */
  config?: Partial<AuthConfig>;
  /** Clock provider (injectable for deterministic tests). */
  now?: () => number;
  /** Entropy provider for secret generation (injectable for tests). */
  randomBytes?: (size: number) => Buffer;
}

/** Result shape returned when an authentication attempt succeeds. */
export interface AuthResult {
  /** The authenticated identity. */
  identity: Identity;
  /** The credential used (API key or token; no secret material exposed). */
  credential: ApiKey | AuthToken;
  /** Session established by the attempt, when the provider creates one. */
  session?: Session;
}

/** Reason a verification attempt failed, useful for auditing. */
export type AuthFailureReason =
  | 'unknown-key'
  | 'unknown-token'
  | 'expired'
  | 'revoked'
  | 'disabled'
  | 'inactive-identity'
  | 'malformed'
  | 'hash-mismatch';

/**
 * Immutable default configuration. A shallow freeze prevents accidental
 * mutation of shared defaults; per-instance configs are merged copies.
 */
export const DEFAULT_AUTH_CONFIG: Readonly<AuthConfig> = Object.freeze({
  hashAlgorithm: 'sha256',
  scrypt: Object.freeze({
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
    saltBytes: 16,
    keylen: 32,
  }),
  tokenTtlMs: 24 * 60 * 60 * 1000,
  apiKeyTtlMs: 90 * 24 * 60 * 60 * 1000,
  pruneIntervalMs: 60 * 1000,
  maxSessionsPerIdentity: 16,
  issuer: 'mam',
  apiKeyPrefix: 'mam_ak_',
  tokenPrefix: 'mam_tk_',
  secretBytes: 32,
});

/** Factory for the zero-value statistics object used by every `stats()`. */
export function createEmptyStats(): AuthStats {
  return {
    identities: 0,
    activeIdentities: 0,
    apiKeys: 0,
    activeApiKeys: 0,
    tokens: 0,
    activeTokens: 0,
    sessions: 0,
    activeSessions: 0,
    issuedTokens: 0,
    revokedTokens: 0,
    successfulAuths: 0,
    failedAuths: 0,
  };
}

/**
 * Returns the current wall-clock time in epoch milliseconds. Injectable clock
 * is applied at the authenticator level; this helper is the default source.
 */
export function nowMs(): number {
  return Date.now();
}

/**
 * Generates a random, opaque identifier using a cryptographically strong RNG.
 *
 * @returns A 128-bit random UUID string, e.g. `"8a1f...-...-...-..."`.
 */
export function createId(): string {
  return randomUUID();
}

/**
 * Generates a random hex digest used as a salt when no salt is supplied.
 *
 * @param bytes Number of salt bytes to generate.
 * @returns Lower-case hex string of `2 * bytes` characters.
 */
export function createSalt(bytes = 16): string {
  return createHash('sha256').update(randomUUID() + randomUUID() + nowMs()).digest('hex').slice(0, bytes * 2);
}

/**
 * Checks whether a value is a member of the {@link IdentityType} union.
 *
 * @param value Any runtime value.
 * @returns `true` when the value equals one of the four identity types.
 */
export function isIdentityType(value: unknown): value is IdentityType {
  return (IDENTITY_TYPES as readonly unknown[]).includes(value);
}

/** Returns `true` when `value` is a non-null object (not array, not null). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Runtime type guard for {@link Identity}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `Identity`.
 */
export function isIdentity(value: unknown): value is Identity {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (!isIdentityType(value.type)) return false;
  if (value.roles !== undefined && !Array.isArray(value.roles)) return false;
  if (value.active !== undefined && typeof value.active !== 'boolean') return false;
  if (value.createdAt !== undefined && typeof value.createdAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link ApiKey}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `ApiKey`.
 */
export function isApiKey(value: unknown): value is ApiKey {
  if (!isRecord(value)) return false;
  if (typeof value.key !== 'string' || typeof value.hash !== 'string') return false;
  if (typeof value.identityId !== 'string') return false;
  if (typeof value.createdAt !== 'number') return false;
  if (typeof value.enabled !== 'boolean') return false;
  return true;
}

/**
 * Runtime type guard for {@link AuthToken}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `AuthToken`.
 */
export function isAuthToken(value: unknown): value is AuthToken {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.identityId !== 'string') return false;
  if (typeof value.secretHash !== 'string') return false;
  if (typeof value.createdAt !== 'number') return false;
  if (value.revoked !== undefined && typeof value.revoked !== 'boolean') return false;
  return true;
}

/**
 * Runtime type guard for {@link Session}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `Session`.
 */
export function isSession(value: unknown): value is Session {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.length === 0) return false;
  if (typeof value.identityId !== 'string') return false;
  if (typeof value.tokenId !== 'string') return false;
  if (typeof value.createdAt !== 'number') return false;
  return true;
}

/**
 * Runtime type guard for {@link Credential}.
 *
 * @param value Any value.
 * @returns `true` when the value structurally satisfies `Credential`.
 */
export function isCredential(value: unknown): value is Credential {
  if (!isRecord(value)) return false;
  if (typeof value.secret !== 'string' || typeof value.hash !== 'string') return false;
  if (value.algorithm !== 'sha256' && value.algorithm !== 'scrypt') return false;
  if (typeof value.identityId !== 'string') return false;
  if (value.kind !== 'apiKey' && value.kind !== 'token' && value.kind !== 'password') return false;
  return true;
}

/**
 * Normalizes a loosely-typed input into a fully-formed {@link Identity}.
 *
 * Missing fields receive defaults: `type` becomes `user`, `active` becomes
 * `true`, `roles` becomes an empty array and `createdAt` becomes the current
 * wall clock. An explicit `id` is preserved; otherwise one is generated.
 *
 * @param input Partial identity description.
 * @returns A complete, validated identity object.
 */
export function createIdentity(input: IdentityInput = {}): Identity {
  return Object.freeze({
    id: input.id ?? createId(),
    name: input.name,
    type: input.type ?? 'user',
    roles: Array.from(input.roles ?? []),
    active: input.active ?? true,
    metadata: input.metadata ? { ...input.metadata } : undefined,
    createdAt: input.createdAt ?? nowMs(),
  });
}

/**
 * Builds an {@link ApiKey} record. The `key` passed in is the freshly
 * generated secret; `hash` is its digest. The returned object is what callers
 * may persist (dropping the `key` field) and what gets handed to the client
 * exactly once.
 *
 * @param identityId Owning identity.
 * @param key Raw secret (generated by the caller via the verifier).
 * @param hash Stored digest of `key`.
 * @param extra Optional bookkeeping fields.
 * @returns A frozen {@link ApiKey} record.
 */
export function createApiKey(
  identityId: string,
  key: string,
  hash: string,
  extra: {
    scopes?: readonly string[];
    expiresAt?: number;
    enabled?: boolean;
    label?: string;
    createdAt?: number;
  } = {},
): ApiKey {
  return Object.freeze({
    key,
    hash,
    identityId,
    scopes: extra.scopes ? Array.from(extra.scopes) : undefined,
    createdAt: extra.createdAt ?? nowMs(),
    expiresAt: extra.expiresAt,
    enabled: extra.enabled ?? true,
    label: extra.label,
  });
}

/**
 * Builds an {@link AuthToken} record from its constituents.
 *
 * @param identityId Owning identity.
 * @param secretHash Stored digest of the raw token secret.
 * @param extra Optional bookkeeping fields (expiry, scopes, issuer, timestamps).
 * @returns A frozen {@link AuthToken} record.
 */
export function createAuthToken(
  identityId: string,
  secretHash: string,
  extra: {
    id?: string;
    expiresAt?: number;
    scopes?: readonly string[];
    createdAt?: number;
    revoked?: boolean;
    issuer?: string;
  } = {},
): AuthToken {
  return Object.freeze({
    id: extra.id ?? createId(),
    identityId,
    secretHash,
    expiresAt: extra.expiresAt,
    scopes: extra.scopes ? Array.from(extra.scopes) : undefined,
    createdAt: extra.createdAt ?? nowMs(),
    revoked: extra.revoked ?? false,
    issuer: extra.issuer,
  });
}

/**
 * Builds a {@link Session} record linking an identity to a live token.
 *
 * @param identityId Owning identity.
 * @param tokenId Backing token identifier.
 * @param extra Optional fields (expiry, metadata, timestamps).
 * @returns A frozen {@link Session} record.
 */
export function createSession(
  identityId: string,
  tokenId: string,
  extra: {
    id?: string;
    expiresAt?: number;
    lastUsedAt?: number;
    revoked?: boolean;
    metadata?: Readonly<Record<string, unknown>>;
    createdAt?: number;
  } = {},
): Session {
  return Object.freeze({
    id: extra.id ?? createId(),
    identityId,
    tokenId,
    createdAt: extra.createdAt ?? nowMs(),
    expiresAt: extra.expiresAt,
    lastUsedAt: extra.lastUsedAt ?? extra.createdAt ?? nowMs(),
    revoked: extra.revoked ?? false,
    metadata: extra.metadata ? { ...extra.metadata } : undefined,
  });
}

/**
 * Builds a generic {@link Credential} envelope.
 *
 * @param identityId Owning identity.
 * @param kind Credential category.
 * @param algorithm Hashing algorithm used.
 * @param secret The raw secret (present only immediately after generation).
 * @param hash The stored digest.
 * @param extra Optional fields (expiry, scopes, timestamp).
 * @returns A frozen {@link Credential} record.
 */
export function createCredential(
  identityId: string,
  kind: CredentialKind,
  algorithm: HashAlgorithm,
  secret: string,
  hash: string,
  extra: { expiresAt?: number; scopes?: readonly string[]; createdAt?: number } = {},
): Credential {
  return Object.freeze({
    secret,
    hash,
    algorithm,
    identityId,
    kind,
    createdAt: extra.createdAt ?? nowMs(),
    expiresAt: extra.expiresAt,
    scopes: extra.scopes ? Array.from(extra.scopes) : undefined,
  });
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid identity.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link Identity}.
 */
export function assertIdentity(value: unknown, label = 'identity'): Identity {
  if (!isIdentity(value)) {
    throw new TypeError(`${label} is not a valid Identity object`);
  }
  return value;
}

/**
 * Throws a descriptive {@link TypeError} unless `value` is a valid token.
 *
 * @param value Value to validate.
 * @param label Contextual label used in the error message.
 * @returns The value re-typed as {@link AuthToken}.
 */
export function assertAuthToken(value: unknown, label = 'authToken'): AuthToken {
  if (!isAuthToken(value)) {
    throw new TypeError(`${label} is not a valid AuthToken object`);
  }
  return value;
}

/**
 * Validates a candidate identity id. Accepts non-empty, non-whitespace strings.
 *
 * @param id Candidate id.
 * @returns `true` when the id is usable.
 */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Deduplicates and strips empty role strings while preserving order.
 *
 * @param roles Raw role list (may contain duplicates or blanks).
 * @returns A de-duplicated array of non-empty roles.
 */
export function normalizeRoles(roles: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(roles)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const role of roles) {
    if (typeof role === 'string' && role.trim().length > 0) {
      const normalized = role.trim();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        out.push(normalized);
      }
    }
  }
  return out;
}

/**
 * Deep-clones plain-object metadata so callers cannot mutate stored records
 * through a shared reference. Non-plain values (functions, class instances)
 * are passed through by reference as-is.
 *
 * @param metadata Source metadata object.
 * @returns A shallow-deep cloned copy, or `undefined` when omitted.
 */
export function cloneMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = cloneMetadata(value as Readonly<Record<string, unknown>>) ?? {};
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Returns `true` when a token/API key carrying `scopes` grants all of the
 * requested `required` scopes. An empty or undefined scope list on the
 * credential grants every request (unrestricted credential).
 *
 * @param scopes Scopes attached to the credential (may be undefined).
 * @param required Scopes the caller demands.
 * @returns Whether the credential satisfies the requested scopes.
 */
export function hasScope(scopes: readonly string[] | undefined, required: readonly string[]): boolean {
  if (!required || required.length === 0) return true;
  if (!scopes || scopes.length === 0) return true;
  const owned = new Set(scopes);
  return required.every((scope) => owned.has(scope));
}

/**
 * Evaluates whether an expiry timestamp has passed, honouring `undefined` as
 * "never expires".
 *
 * @param expiresAt Epoch ms expiry (may be undefined).
 * @param at Reference time in epoch ms (defaults to now).
 * @returns `true` when expired or undefined/never-expiring.
 */
export function isExpired(expiresAt: number | undefined, at: number = nowMs()): boolean {
  if (expiresAt === undefined) return false;
  return at > expiresAt;
}

/**
 * Convenience predicate for "identity is usable": registered, active and (when
 * an id is supplied) matches.
 *
 * @param identity The identity record.
 * @returns `true` when the identity exists and is active.
 */
export function identityUsable(identity: Identity | undefined): identity is Identity {
  return identity !== undefined && identity.active !== false;
}

/**
 * Merges a partial configuration over the frozen defaults and returns a
 * plain, fully-populated configuration object safe for downstream mutation.
 *
 * @param overrides Partial configuration (may be empty).
 * @returns A complete, non-frozen {@link AuthConfig}.
 */
export function resolveConfig(overrides: Partial<AuthConfig> | undefined = {}): AuthConfig {
  const scrypt = { ...(DEFAULT_AUTH_CONFIG.scrypt ?? {}), ...(overrides.scrypt ?? {}) };
  return {
    ...DEFAULT_AUTH_CONFIG,
    ...overrides,
    scrypt,
  };
}