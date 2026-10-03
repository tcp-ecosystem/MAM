/**
 * MAM Auth Manager
 *
 * Authentication and authorization for the registry.
 *
 * Passwords are stored as scrypt hashes with a per-user random salt and
 * compared in constant time. Tokens are opaque random strings, so a leaked
 * token reveals nothing about the credential that minted it.
 *
 * State is in memory by default, which is right for a test and wrong for a
 * deployment: a restart would lose every account, including the bootstrap
 * admin, and invalidate every outstanding session. Passing `dataDir` opts into
 * a single versioned JSON file that fixes both.
 */

import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, rename, access } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from './store.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

// ============================================================================
// Types
// ============================================================================

export type TokenScope = 'read' | 'write' | 'admin';

export interface AuthToken {
  token: string;
  username: string;
  /** Absolute expiry, epoch milliseconds. */
  expiresAt: number;
  scope: TokenScope[];
}

export interface UserInfo {
  username: string;
  email: string;
  createdAt: string;
  lastLogin: string;
  roles: string[];
}

export interface UserRecord {
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  lastLogin: string;
  roles: string[];
  /** Serial of the credential in force, so a password change invalidates tokens. */
  credentialVersion: number;
}

export interface AuthManagerOptions {
  /** Token lifetime in ms. Default 24 hours. */
  tokenTtlMs?: number;
  /** scrypt derived-key length in bytes. Default 64. */
  keyLength?: number;
  /**
   * Seed the bootstrap admin. Off by default: a hardcoded default password
   * hands anyone who deploys the registry a known administrator.
   */
  bootstrapAdmin?: { username: string; email: string; password: string };
  /** Lock an account for this long after repeated failures. Default 60s. */
  lockoutMs?: number;
  /** Failures allowed before lockout. Default 5. */
  maxFailedAttempts?: number;
  /**
   * Directory holding the persisted state file. Opt-in: omit it and the
   * manager is purely in memory and touches no filesystem at all.
   *
   * Set it in a deployment, or a restart drops every account and every session.
   */
  dataDir?: string;
  /**
   * Called when persisted state cannot be read or written, and when it is
   * quarantined. Defaults to logging on stderr.
   */
  onStateError?: (message: string, error?: unknown) => void;
}

// ============================================================================
// Persisted state
// ============================================================================

/**
 * On-disk format version.
 *
 * Bump this whenever the shape below changes and add a case to the migration
 * switch, so an older file is rewritten into the current shape instead of being
 * parsed on a guess about what its fields mean.
 */
export const AUTH_STATE_VERSION = 1;

/** Name of the state file inside `dataDir`. */
export const AUTH_STATE_FILE = 'auth.json';

/**
 * Everything that has to outlive a restart, in one file.
 *
 * Tokens are stored deliberately. Re-authenticating every client on every
 * deploy defeats the point of issuing a session token at all, and a token here
 * is already worthless without the process that issued it. Their `expiresAt` is
 * authoritative: an expired token is dropped at load time and re-checked on every
 * use, so a restart cannot extend a session's life.
 */
export interface AuthStateFile {
  version: number;
  savedAt: string;
  users: Record<string, UserRecord>;
  tokens: Record<string, AuthToken>;
}


export interface PasswordPolicy {
  minLength?: number;
  requireUpper?: boolean;
  requireLower?: boolean;
  requireDigit?: boolean;
  requireSymbol?: boolean;
}

export class AuthError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, message: string, statusCode = 401) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class ValidationError extends AuthError {
  constructor(message: string) {
    super('validation_failed', message, 400);
    this.name = 'ValidationError';
  }
}

const DEFAULT_PASSWORD_POLICY: Required<PasswordPolicy> = {
  minLength: 12,
  requireUpper: true,
  requireLower: true,
  requireDigit: true,
  requireSymbol: false,
};

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TOKEN_SCOPES: TokenScope[] = ['read', 'write', 'admin'];

function isTokenScope(value: unknown): value is TokenScope {
  return TOKEN_SCOPES.includes(value as TokenScope);
}

function isUserRecord(value: unknown): value is UserRecord {
  if (typeof value !== 'object' || value === null) return false;
  const user = value as Record<string, unknown>;
  return (
    typeof user.username === 'string' &&
    typeof user.email === 'string' &&
    typeof user.passwordHash === 'string' &&
    user.passwordHash.startsWith('scrypt$') &&
    typeof user.createdAt === 'string' &&
    typeof user.lastLogin === 'string' &&
    Array.isArray(user.roles) &&
    user.roles.every((role) => typeof role === 'string') &&
    typeof user.credentialVersion === 'number'
  );
}

function isAuthToken(value: unknown): value is AuthToken {
  if (typeof value !== 'object' || value === null) return false;
  const token = value as Record<string, unknown>;
  return (
    typeof token.token === 'string' &&
    typeof token.username === 'string' &&
    typeof token.expiresAt === 'number' &&
    Array.isArray(token.scope) &&
    token.scope.every(isTokenScope)
  );
}

/** Node's ENOENT, without pulling in an error-code import for one check. */
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

// ============================================================================
// Auth Manager
// ============================================================================

export class AuthManager {
  private users: Map<string, UserRecord> = new Map();
  private tokens: Map<string, AuthToken> = new Map();
  private failures: Map<string, { count: number; lockedUntil: number }> = new Map();
  private options: {
    tokenTtlMs: number;
    keyLength: number;
    lockoutMs: number;
    maxFailedAttempts: number;
    bootstrapAdmin?: AuthManagerOptions['bootstrapAdmin'];
    dataDir: string | null;
    onStateError: (message: string, error?: unknown) => void;
  };
  private policy: Required<PasswordPolicy>;

  /**
   * The running `init`, so repeat and concurrent calls share one load instead of
   * racing each other into two bootstrap admins.
   */
  private initPromise: Promise<void> | null = null;
  /** Set when persisted state could not be used, so a host can surface it. */
  lastStateError: string | null = null;
  /** Set while a coalesced save is in flight or still wanted. */
  private saveRequested = false;
  private saveRunning: Promise<void> | null = null;

  constructor(options: AuthManagerOptions = {}, policy: PasswordPolicy = {}) {
    this.options = {
      tokenTtlMs: options.tokenTtlMs ?? 24 * 60 * 60 * 1000,
      keyLength: options.keyLength ?? 64,
      lockoutMs: options.lockoutMs ?? 60_000,
      maxFailedAttempts: options.maxFailedAttempts ?? 5,
      dataDir: options.dataDir ?? null,
      onStateError:
        options.onStateError ??
        ((message, error) => {
          if (error === undefined) console.error(`[mam-registry] ${message}`);
          else console.error(`[mam-registry] ${message}`, error);
        }),
      ...(options.bootstrapAdmin ? { bootstrapAdmin: options.bootstrapAdmin } : {}),
    };
    this.policy = { ...DEFAULT_PASSWORD_POLICY, ...policy };
  }

  /** Absolute path of the state file, or null when running in memory. */
  get statePath(): string | null {
    return this.options.dataDir ? join(this.options.dataDir, AUTH_STATE_FILE) : null;
  }

  /** True when this manager persists its state to disk. */
  get isPersistent(): boolean {
    return this.options.dataDir !== null;
  }

  /**
   * Creates the bootstrap admin if one was configured. Await before use.
   *
   * Idempotent, including under concurrency: the first call's work is memoised
   * and every later call joins it. A second `init()` after a `register` reloads
   * nothing and resets nothing, and an admin that already exists is never
   * replaced, so a restart with a changed bootstrap password does not undo a
   * real password change.
   */
  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.runInit().catch((error) => {
        // A failed init should be retryable, not cached forever.
        this.initPromise = null;
        throw error;
      });
    }
    return this.initPromise;
  }

  private async runInit(): Promise<void> {
    if (this.isPersistent) {
      await this.loadState();
    }

    const admin = this.options.bootstrapAdmin;
    if (!admin || this.users.has(admin.username)) return;

    this.users.set(admin.username, {
      username: admin.username,
      email: admin.email,
      passwordHash: await this.hashPassword(admin.password),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      roles: ['admin'],
      credentialVersion: 1,
    });
    if (this.isPersistent) await this.save();
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private reportStateError(message: string, error?: unknown): void {
    this.lastStateError = message;
    this.options.onStateError(message, error);
  }

  /**
   * Reads persisted state, falling back to empty rather than throwing.
   *
   * A registry that cannot parse its account file must still start, or a single
   * bad byte takes the process down and nobody can log in to fix it. The file
   * itself is moved aside rather than deleted, so whatever is in it can still be
   * inspected.
   */
  private async loadState(): Promise<void> {
    const file = this.statePath!;
    let raw: string;
    try {
      raw = await readFile(file, 'utf-8');
    } catch (error) {
      if (isNotFound(error)) return; // First run on a fresh data directory.
      this.reportStateError(`Auth state at ${file} could not be read; starting empty`, error);
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await this.quarantineState(`Auth state at ${file} is not valid JSON`, error);
      return;
    }

    const state = this.migrateState(parsed);
    if (!state) {
      await this.quarantineState(
        `Auth state at ${file} is not a supported format and was not loaded`,
      );
      return;
    }

    let rejected = 0;
    for (const [username, record] of Object.entries(state.users)) {
      if (isUserRecord(record) && record.username === username) {
        this.users.set(username, record);
      } else {
        rejected++;
      }
    }

    // The TTL is authoritative, checked against the clock at load rather than
    // at mint. A token that expired while the process was down never comes back.
    const now = Date.now();
    let expired = 0;
    for (const [token, data] of Object.entries(state.tokens)) {
      if (!isAuthToken(data) || data.token !== token) {
        rejected++;
      } else if (!(data.expiresAt > now)) {
        expired++;
      } else {
        this.tokens.set(token, data);
      }
    }

    if (expired > 0 || rejected > 0) {
      this.reportStateError(
        `Auth state at ${file} loaded with ${expired} expired token(s) and ${rejected} unusable entr(ies) dropped`,
      );
    }
  }

  /**
   * Brings a parsed state file up to the current shape.
   *
   * A version this build does not know about returns null rather than being
   * interpreted on a guess, which is the whole reason the version is on disk.
   */
  private migrateState(parsed: unknown): AuthStateFile | null {
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Partial<AuthStateFile>;
    switch (candidate.version) {
      case AUTH_STATE_VERSION:
        return {
          version: AUTH_STATE_VERSION,
          savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : '',
          users:
            typeof candidate.users === 'object' && candidate.users !== null ? candidate.users : {},
          tokens:
            typeof candidate.tokens === 'object' && candidate.tokens !== null
              ? candidate.tokens
              : {},
        };
      default:
        return null;
    }
  }

  /**
   * Moves an unreadable state file aside and reports it.
   *
   * Preserved rather than deleted: a file the process cannot parse may still be
   * the only copy of the accounts in it, and quietly overwriting it with an
   * empty one destroys the evidence and the chance of a manual recovery.
   */
  private async quarantineState(message: string, error?: unknown): Promise<void> {
    const file = this.statePath!;
    let target = `${file}.corrupt-1`;
    for (let n = 2; await this.pathExists(target); n++) {
      target = `${file}.corrupt-${n}`;
    }
    try {
      await rename(file, target);
      this.reportStateError(`${message}; moved it to ${target} and started empty`, error);
    } catch (moveError) {
      // Could not even move it. Still do not throw, but say so plainly: the
      // next save will overwrite it.
      this.reportStateError(`${message}; leaving it in place at ${file}`, moveError);
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Serialises the current state to the state file.
   *
   * A write failure is reported rather than thrown: a registry on a full or
   * read-only disk should keep serving authenticated traffic, it just cannot
   * promise the change survives a restart.
   */
  private async save(): Promise<void> {
    const dir = this.options.dataDir;
    const file = this.statePath;
    if (!dir || !file) return;

    const state: AuthStateFile = {
      version: AUTH_STATE_VERSION,
      savedAt: new Date().toISOString(),
      users: Object.fromEntries(this.users),
      tokens: Object.fromEntries(this.tokens),
    };

    try {
      await mkdir(dir, { recursive: true });
      await writeFileAtomic(file, JSON.stringify(state, null, 2));
    } catch (error) {
      this.reportStateError(`Auth state could not be written to ${file}`, error);
    }
  }

  /**
   * Queues a save and resolves once the queue has drained.
   *
   * Bursts of mutations collapse into one write, and no two writes overlap, so
   * the file never has to win a race against itself.
   */
  private saveSoon(): Promise<void> {
    this.saveRequested = true;
    if (!this.saveRunning) {
      this.saveRunning = this.drainSaves().finally(() => {
        this.saveRunning = null;
        if (this.saveRequested) void this.saveSoon();
      });
    }
    return this.saveRunning;
  }

  private async drainSaves(): Promise<void> {
    while (this.saveRequested) {
      this.saveRequested = false;
      await this.save();
    }
  }


  // --------------------------------------------------------------------------
  // Credentials
  // --------------------------------------------------------------------------

  /**
   * Verifies a password against its stored hash.
   *
   * The comparison is constant time, and a user with no stored record still
   * pays for a hash so a missing username is not distinguishable by timing.
   */
  private async verifyPassword(user: UserRecord | undefined, password: string): Promise<boolean> {
    const parts = user?.passwordHash.split('$') ?? [];
    const salt = parts[1] ?? 'absent';
    const stored = user?.passwordHash ?? `scrypt$${'absent'}${'0'.repeat(this.options.keyLength * 2)}`;
    // The key length comes from the stored hash rather than the local config:
    // once hashes are persisted, a deploy that raises or lowers `keyLength`
    // would otherwise lock every existing account out of its own registry.
    const storedKeyLength = Math.floor((parts[2]?.length ?? 0) / 2);
    const derived = await scryptAsync(
      password,
      salt,
      storedKeyLength > 0 ? storedKeyLength : this.options.keyLength,
    );
    const expected = Buffer.from(stored.split('$')[2] ?? '', 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  }

  /**
   * Derives a salted scrypt hash, encoded as `scrypt$<salt>$<hash>`.
   *
   * A per-user random salt means identical passwords do not share a hash, so
   * one cracked value does not reveal the rest.
   */
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const derived = await scryptAsync(password, salt, this.options.keyLength);
    return `scrypt$${salt}$${derived.toString('hex')}`;
  }

  /** Validates a password against the configured policy. Throws with reasons. */
  validatePassword(password: string): string[] {
    const problems: string[] = [];
    if (password.length < this.policy.minLength) {
      problems.push(`must be at least ${this.policy.minLength} characters`);
    }
    if (this.policy.requireUpper && !/[A-Z]/.test(password)) problems.push('must contain an uppercase letter');
    if (this.policy.requireLower && !/[a-z]/.test(password)) problems.push('must contain a lowercase letter');
    if (this.policy.requireDigit && !/[0-9]/.test(password)) problems.push('must contain a digit');
    if (this.policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) problems.push('must contain a symbol');
    return problems;
  }

  private assertUsername(username: string): void {
    if (!USERNAME_PATTERN.test(username)) {
      throw new ValidationError(
        `Invalid username "${username}": use 2-64 characters, letters or digits, then . _ or -`,
      );
    }
  }

  private assertEmail(email: string): void {
    if (!EMAIL_PATTERN.test(email)) {
      throw new ValidationError(`Invalid email "${email}"`);
    }
  }

  // --------------------------------------------------------------------------
  // Brute force protection
  // --------------------------------------------------------------------------

  private assertNotLocked(username: string): void {
    const record = this.failures.get(username);
    if (record && record.lockedUntil > Date.now()) {
      const seconds = Math.ceil((record.lockedUntil - Date.now()) / 1000);
      throw new AuthError('account_locked', `Too many failed attempts. Try again in ${seconds}s`, 429);
    }
  }

  private recordFailure(username: string): void {
    const now = Date.now();
    const record = this.failures.get(username) ?? { count: 0, lockedUntil: 0 };
    record.count++;
    if (record.count >= this.options.maxFailedAttempts) {
      record.lockedUntil = now + this.options.lockoutMs;
      record.count = 0;
    }
    this.failures.set(username, record);
  }

  private clearFailures(username: string): void {
    this.failures.delete(username);
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Verifies credentials and issues a token.
   *
   * Returns null for bad credentials so the caller can respond generically, but
   * throws `account_locked` when the account is being brute forced, because
   * that is a condition a client should back off from rather than retry.
   */
  async authenticate(username: string, password: string): Promise<string | null> {
    this.assertNotLocked(username);

    const user = this.users.get(username);
    const ok = await this.verifyPassword(user, password);

    if (!user || !ok) {
      this.recordFailure(username);
      return null;
    }

    this.clearFailures(username);
    user.lastLogin = new Date().toISOString();

    const token = this.generateToken(username, user.roles);
    this.tokens.set(token.token, token);
    this.pruneExpiredTokens();
    await this.saveSoon();
    return token.token;
  }

  /** Resolves a token to its user, or null when absent, expired or revoked. */
  async verifyToken(token: string): Promise<UserInfo | null> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) return null;

    if (Date.now() >= tokenData.expiresAt) {
      this.tokens.delete(token);
      // Deliberately not awaited: verifying a token happens on every request,
      // and the only thing worth writing is the removal of this dead entry.
      void this.saveSoon();
      return null;
    }

    const user = this.users.get(tokenData.username);
    if (!user) return null;

    // A password change bumps the credential version, which retires every
    // token minted before it.
    if (!this.isTokenCurrent(tokenData, user)) {
      this.tokens.delete(token);
      void this.saveSoon();
      return null;
    }

    return this.toUserInfo(user);
  }

  /**
   * Verifies a token and that it carries a required scope.
   *
   * Tokens are minted with `read` and `write`; `admin` is required for
   * operations that act on other users' modules.
   */
  async verifyTokenWithScope(token: string, scope: TokenScope): Promise<UserInfo | null> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) return null;
    if (!tokenData.scope.includes(scope)) return null;
    return this.verifyToken(token);
  }

  /** True when a token exists and carries the given scope. */
  hasScope(token: string, scope: TokenScope): boolean {
    return this.tokens.get(token)?.scope.includes(scope) ?? false;
  }

  private isTokenCurrent(token: AuthToken, user: UserRecord): boolean {
    // The version is carried in the scope-free part of the token id, so no
    // extra field is exposed to clients.
    const version = parseInt(token.token.slice(-4), 16);
    return Number.isFinite(version) && version === user.credentialVersion;
  }

  private toUserInfo(user: UserRecord): UserInfo {
    return {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
      roles: [...user.roles],
    };
  }

  /** Creates a user. Rejects duplicates and policy violations. */
  async register(username: string, email: string, password: string): Promise<UserInfo> {
    this.assertUsername(username);
    this.assertEmail(email);

    if (this.users.has(username)) {
      throw new AuthError('username_taken', `Username "${username}" already exists`, 409);
    }
    if ([...this.users.values()].some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new AuthError('email_taken', `Email "${email}" is already registered`, 409);
    }

    const problems = this.validatePassword(password);
    if (problems.length > 0) {
      throw new ValidationError(`Password ${problems.join(', ')}`);
    }

    const user: UserRecord = {
      username,
      email,
      passwordHash: await this.hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      roles: ['user'],
      credentialVersion: 1,
    };
    this.users.set(username, user);
    await this.saveSoon();
    return this.toUserInfo(user);
  }

  /** Deletes a single token. */
  async revokeToken(token: string): Promise<boolean> {
    const removed = this.tokens.delete(token);
    if (removed) await this.saveSoon();
    return removed;
  }

  /** Deletes every token belonging to a user. */
  async revokeAllTokens(username: string): Promise<number> {
    let removed = 0;
    for (const [key, value] of this.tokens) {
      if (value.username === username) {
        this.tokens.delete(key);
        removed++;
      }
    }
    if (removed > 0) await this.saveSoon();
    return removed;
  }

  /**
   * Drops every token for every user, e.g. after a suspected compromise.
   *
   * Persisted, so the clear survives a restart; without that, a redeploy would
   * quietly hand every outstanding session back to its holder.
   */
  async clearAllTokens(): Promise<number> {
    const removed = this.tokens.size;
    if (removed === 0) return 0;
    this.tokens.clear();
    await this.saveSoon();
    return removed;
  }

  async getUser(username: string): Promise<UserInfo | null> {
    const user = this.users.get(username);
    return user ? this.toUserInfo(user) : null;
  }

  /** Every registered user, sorted by username. */
  async listUsers(): Promise<UserInfo[]> {
    return [...this.users.values()]
      .sort((a, b) => a.username.localeCompare(b.username))
      .map((u) => this.toUserInfo(u));
  }

  /**
   * Changes a password, then retires every existing token for that user.
   *
   * Without the revocation a token stolen before the change stays valid for the
   * remainder of its 24 hour life.
   */
  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const user = this.users.get(username);
    if (!user) return false;

    if (!(await this.verifyPassword(user, oldPassword))) {
      this.recordFailure(username);
      return false;
    }

    const problems = this.validatePassword(newPassword);
    if (problems.length > 0) {
      throw new ValidationError(`Password ${problems.join(', ')}`);
    }

    user.passwordHash = await this.hashPassword(newPassword);
    user.credentialVersion++;
    await this.revokeAllTokens(username);
    await this.saveSoon();
    return true;
  }

  /** Removes a user and every token they hold. */
  async deleteUser(username: string): Promise<boolean> {
    const removed = this.users.delete(username);
    if (removed) {
      await this.revokeAllTokens(username);
      await this.saveSoon();
    }
    return removed;
  }

  /** Drops expired tokens. Returns how many were removed. */
  pruneExpiredTokens(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, value] of this.tokens) {
      if (now >= value.expiresAt) {
        this.tokens.delete(key);
        removed++;
      }
    }
    // Synchronous by contract, so the write is queued rather than awaited.
    if (removed > 0) void this.saveSoon();
    return removed;
  }

  /** Token and user counts, for diagnostics. Never returns any secret. */
  getStats(): { users: number; activeTokens: number; lockedAccounts: number } {
    const now = Date.now();
    return {
      users: this.users.size,
      activeTokens: this.tokens.size,
      lockedAccounts: [...this.failures.values()].filter((f) => f.lockedUntil > now).length,
    };
  }

  private generateToken(username: string, roles: string[]): AuthToken {
    const user = this.users.get(username);
    const version = ((user?.credentialVersion ?? 1) & 0xffff)
      .toString(16)
      .padStart(4, '0');
    // Opaque random value; the trailing version lets a rotated credential
    // invalidate the token without exposing anything about the password.
    const token = randomBytes(32).toString('hex') + version;
    const scope: TokenScope[] = ['read', 'write'];
    if (roles.includes('admin')) scope.push('admin');
    return { token, username, expiresAt: Date.now() + this.options.tokenTtlMs, scope };
  }
}

/** SHA-256 digest, exposed for the store's integrity hashes. */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
