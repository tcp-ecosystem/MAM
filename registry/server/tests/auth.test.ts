import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AuthManager,
  AuthError,
  ValidationError,
  sha256,
  AUTH_STATE_FILE,
  AUTH_STATE_VERSION,
} from '../src/auth.js';
import type { AuthManagerOptions } from '../src/auth.js';

// ============================================================================
// Helpers
// ============================================================================

/** Satisfies the default policy: 12+ chars with upper, lower and digit. */
const STRONG = 'CorrectHorse42';
const STRONG_ALT = 'AnotherPass99';
const BOOTSTRAP = { username: 'admin', email: 'admin@mam.dev', password: STRONG };

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A manager with the bootstrap admin seeded. No default account exists. */
async function makeAuth(
  options: Partial<ConstructorParameters<typeof AuthManager>[0]> = {},
  policy = {},
): Promise<AuthManager> {
  const auth = new AuthManager({ bootstrapAdmin: BOOTSTRAP, ...options }, policy);
  await auth.init();
  return auth;
}

/** A manager with no users at all, i.e. an unauthenticated fresh deploy. */
function makeBare(options: ConstructorParameters<typeof AuthManager>[0] = {}): AuthManager {
  return new AuthManager(options);
}

/** Resolves with the rejection reason so code, status and message can all be asserted. */
async function rejection(promise: Promise<unknown>): Promise<AuthError> {
  try {
    await promise;
  } catch (error) {
    return error as AuthError;
  }
  throw new Error('expected the promise to reject, but it resolved');
}

async function registerUser(auth: AuthManager, username = 'alice'): Promise<void> {
  await auth.register(username, `${username}@example.com`, STRONG);
}

// ============================================================================
// Tests
// ============================================================================

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(async () => {
    auth = await makeAuth();
  });

  // -------------------------------------------------------------------------
  // Bootstrap admin
  // -------------------------------------------------------------------------

  describe('init()', () => {
    it('creates no account when no bootstrap admin is configured', async () => {
      const bare = makeBare();
      await bare.init();
      expect(await bare.listUsers()).toEqual([]);
      expect(await bare.authenticate('admin', 'admin123')).toBeNull();
    });

    it('creates the configured bootstrap admin', async () => {
      const user = await auth.getUser('admin');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
      expect(user!.email).toBe('admin@mam.dev');
      expect(user!.roles).toContain('admin');
    });

    it('is idempotent and does not duplicate the admin', async () => {
      await auth.init();
      await auth.init();
      const users = await auth.listUsers();
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('admin');
    });

    it('does not overwrite an existing admin, even after a password change', async () => {
      expect(await auth.changePassword('admin', STRONG, STRONG_ALT)).toBe(true);

      await auth.init();

      expect(await auth.authenticate('admin', STRONG)).toBeNull();
      expect(await auth.authenticate('admin', STRONG_ALT)).toBeTypeOf('string');
      expect((await auth.getUser('admin'))!.email).toBe('admin@mam.dev');
      expect(await auth.listUsers()).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Password hashing
  // -------------------------------------------------------------------------

  describe('hashPassword()', () => {
    it('produces a scrypt hash with a salt and a digest', async () => {
      const hash = await auth.hashPassword(STRONG);
      const [scheme, salt, digest] = hash.split('$');
      expect(scheme).toBe('scrypt');
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
      expect(digest).toMatch(/^[0-9a-f]+$/);
    });

    it('salts every hash, so the same password hashes differently each time', async () => {
      const a = await auth.hashPassword(STRONG);
      const b = await auth.hashPassword(STRONG);
      expect(a).not.toBe(b);
      expect(a.split('$')[1]).not.toBe(b.split('$')[1]);
    });
  });

  describe('register()', () => {
    it('creates a new user', async () => {
      const user = await auth.register('alice', 'alice@example.com', STRONG);
      expect(user.username).toBe('alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.createdAt).toBeDefined();
      expect(user.lastLogin).toBeDefined();
      expect(user.roles).toEqual(['user']);
    });

    it('gives two users with the same password different stored hashes, and both verify', async () => {
      await auth.register('alice', 'alice@example.com', STRONG);
      await auth.register('bob', 'bob@example.com', STRONG);

      // The records are distinct entries, so the salted hashes cannot collide.
      const users = (auth as unknown as { users: Map<string, { passwordHash: string }> }).users;
      const aliceHash = users.get('alice')!.passwordHash;
      const bobHash = users.get('bob')!.passwordHash;
      expect(aliceHash).not.toBe(bobHash);
      expect(aliceHash.split('$')[1]).not.toBe(bobHash.split('$')[1]);

      expect(await auth.authenticate('alice', STRONG)).toBeTypeOf('string');
      expect(await auth.authenticate('bob', STRONG)).toBeTypeOf('string');
    });

    it('rejects a password shorter than the policy minimum', async () => {
      const error = await rejection(auth.register('dave', 'dave@example.com', 'Pass1'));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('validation_failed');
      expect(error.statusCode).toBe(400);
      expect(error.message).toContain('must be at least 12 characters');
    });

    it('rejects a password with no uppercase letter', async () => {
      const error = await rejection(auth.register('dave', 'dave@example.com', 'correcthorse42'));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('must contain an uppercase letter');
    });

    it('rejects a password with no digit', async () => {
      const error = await rejection(auth.register('dave', 'dave@example.com', 'CorrectHorseXY'));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('must contain a digit');
    });

    it('reports every unmet requirement at once', async () => {
      const error = await rejection(auth.register('dave', 'dave@example.com', 'pass'));
      expect(error.message).toContain('must be at least 12 characters');
      expect(error.message).toContain('must contain an uppercase letter');
      expect(error.message).toContain('must contain a digit');
      // Lowercase is the only rule this password satisfies.
      expect(error.message).not.toContain('must contain a lowercase letter');
    });

    it('does not create the user when the password is rejected', async () => {
      await rejection(auth.register('dave', 'dave@example.com', 'pass'));
      expect(await auth.getUser('dave')).toBeNull();
    });

    it.each([
      ['too short', 'a'],
      ['leading punctuation', '_alice'],
      ['illegal characters', 'ali ce'],
      ['an email address', 'alice@example.com'],
      ['too long', 'a'.repeat(65)],
    ])('rejects a username that is %s', async (_label, username) => {
      const error = await rejection(auth.register(username, 'someone@example.com', STRONG));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe('validation_failed');
    });

    it.each(['not-an-email', 'missing@domain', 'missing domain@', '@example.com'])(
      'rejects the invalid email %s',
      async (email) => {
        const error = await rejection(auth.register('alice', email, STRONG));
        expect(error).toBeInstanceOf(ValidationError);
        expect(error.code).toBe('validation_failed');
      },
    );

    it('rejects a duplicate username with username_taken', async () => {
      await auth.register('bob', 'bob@example.com', STRONG);
      const error = await rejection(auth.register('bob', 'bob2@example.com', STRONG_ALT));
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe('username_taken');
      expect(error.statusCode).toBe(409);
      // The original record is untouched.
      expect((await auth.getUser('bob'))!.email).toBe('bob@example.com');
    });

    it('rejects a duplicate email with email_taken, case-insensitively', async () => {
      await auth.register('bob', 'bob@example.com', STRONG);
      const error = await rejection(auth.register('carol', 'BOB@EXAMPLE.COM', STRONG_ALT));
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe('email_taken');
      expect(error.statusCode).toBe(409);
      expect(await auth.getUser('carol')).toBeNull();
    });

    it('rejects the bootstrap admin email as already taken', async () => {
      const error = await rejection(auth.register('carol', 'admin@mam.dev', STRONG));
      expect(error.code).toBe('email_taken');
    });
  });

  describe('validatePassword()', () => {
    it('returns no problems for a compliant password', () => {
      expect(auth.validatePassword(STRONG)).toEqual([]);
    });

    it('reports a password that is too short', () => {
      expect(auth.validatePassword('Pass1')).toEqual(['must be at least 12 characters']);
    });

    it('reports a missing uppercase letter', () => {
      expect(auth.validatePassword('correcthorse42')).toEqual(['must contain an uppercase letter']);
    });

    it('reports a missing lowercase letter', () => {
      expect(auth.validatePassword('CORRECTHORSE42')).toEqual(['must contain a lowercase letter']);
    });

    it('reports a missing digit', () => {
      expect(auth.validatePassword('CorrectHorseXY')).toEqual(['must contain a digit']);
    });

    it('reports every unmet rule together', () => {
      expect(auth.validatePassword('PASSWORD1')).toEqual([
        'must be at least 12 characters',
        'must contain a lowercase letter',
      ]);
      expect(auth.validatePassword('lowercaseonly')).toEqual([
        'must contain an uppercase letter',
        'must contain a digit',
      ]);
    });

    it('does not require a symbol by default', () => {
      expect(auth.validatePassword('CorrectHorse42!')).toEqual([]);
    });

    it('honours a custom policy', () => {
      const relaxed = new AuthManager({}, { minLength: 8, requireDigit: false });
      expect(relaxed.validatePassword('Passw0rd')).toEqual([]);

      const strict = new AuthManager({}, { requireSymbol: true });
      expect(strict.validatePassword(STRONG)).toEqual(['must contain a symbol']);
    });
  });

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  describe('authenticate()', () => {
    it('returns a token for valid credentials', async () => {
      const token = await auth.authenticate('admin', STRONG);
      expect(token).toBeTypeOf('string');
      expect(token!.length).toBeGreaterThan(0);
    });

    it('returns null for the wrong password', async () => {
      expect(await auth.authenticate('admin', 'WrongHorse42')).toBeNull();
    });

    it('returns null for a missing user', async () => {
      expect(await auth.authenticate('nonexistent', STRONG)).toBeNull();
    });

    it('does not authenticate against the old default credentials', async () => {
      expect(await auth.authenticate('admin', 'admin123')).toBeNull();
    });
  });

  describe('verifyToken()', () => {
    it('returns user info for a valid token', async () => {
      const token = await auth.authenticate('admin', STRONG);
      const user = await auth.verifyToken(token!);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
      expect(user!.email).toBe('admin@mam.dev');
      expect(user!.roles).toEqual(['admin']);
    });

    it('returns null for an invalid token', async () => {
      expect(await auth.verifyToken('invalid-token-string')).toBeNull();
    });

    it('returns null once the token is revoked', async () => {
      const token = await auth.authenticate('admin', STRONG);
      await auth.revokeToken(token!);
      expect(await auth.verifyToken(token!)).toBeNull();
    });

    it('returns null for an expired token', async () => {
      const shortLived = await makeAuth({ tokenTtlMs: 20 });
      const token = await shortLived.authenticate('admin', STRONG);
      expect(await shortLived.verifyToken(token!)).not.toBeNull();

      await sleep(40);

      expect(await shortLived.verifyToken(token!)).toBeNull();
    });

    it('returns null when the user behind the token is deleted', async () => {
      await registerUser(auth);
      const token = await auth.authenticate('alice', STRONG);
      expect(await auth.deleteUser('alice')).toBe(true);
      expect(await auth.verifyToken(token!)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Scopes
  // -------------------------------------------------------------------------

  describe('scopes', () => {
    it('gives an admin token the admin scope and a user token only read/write', async () => {
      await registerUser(auth);
      const adminToken = (await auth.authenticate('admin', STRONG))!;
      const userToken = (await auth.authenticate('alice', STRONG))!;

      expect(auth.hasScope(adminToken, 'admin')).toBe(true);
      expect(auth.hasScope(adminToken, 'read')).toBe(true);
      expect(auth.hasScope(adminToken, 'write')).toBe(true);

      expect(auth.hasScope(userToken, 'read')).toBe(true);
      expect(auth.hasScope(userToken, 'write')).toBe(true);
      expect(auth.hasScope(userToken, 'admin')).toBe(false);
    });

    it('hasScope is false for an unknown token', () => {
      expect(auth.hasScope('nonexistent-token', 'read')).toBe(false);
    });

    it('verifyTokenWithScope resolves a token that carries the scope', async () => {
      await registerUser(auth);
      const token = (await auth.authenticate('admin', STRONG))!;
      const user = await auth.verifyTokenWithScope(token, 'admin');
      expect(user!.username).toBe('admin');
    });

    it('verifyTokenWithScope rejects a token missing the scope', async () => {
      await registerUser(auth);
      const token = (await auth.authenticate('alice', STRONG))!;
      expect(await auth.verifyTokenWithScope(token, 'admin')).toBeNull();
      expect((await auth.verifyTokenWithScope(token, 'read'))!.username).toBe('alice');
    });

    it('verifyTokenWithScope rejects an unknown token', async () => {
      expect(await auth.verifyTokenWithScope('nonexistent-token', 'read')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Revocation
  // -------------------------------------------------------------------------

  describe('revokeToken()', () => {
    it('removes the token so it can no longer be verified', async () => {
      const token = await auth.authenticate('admin', STRONG);
      expect(await auth.revokeToken(token!)).toBe(true);
      expect(await auth.verifyToken(token!)).toBeNull();
    });

    it('returns false for a non-existent token', async () => {
      expect(await auth.revokeToken('nonexistent-token')).toBe(false);
    });
  });

  describe('revokeAllTokens()', () => {
    it('removes every token for one user and leaves other users alone', async () => {
      await registerUser(auth);
      await registerUser(auth, 'bob');
      const alice1 = (await auth.authenticate('alice', STRONG))!;
      const alice2 = (await auth.authenticate('alice', STRONG))!;
      const adminToken = (await auth.authenticate('admin', STRONG))!;

      expect(await auth.revokeAllTokens('alice')).toBe(2);
      expect(await auth.verifyToken(alice1)).toBeNull();
      expect(await auth.verifyToken(alice2)).toBeNull();
      expect(await auth.verifyToken(adminToken)).not.toBeNull();

      expect(await auth.revokeAllTokens('nonexistent')).toBe(0);
    });
  });

  describe('pruneExpiredTokens()', () => {
    it('removes expired tokens and keeps live ones', async () => {
      const shortLived = await makeAuth({ tokenTtlMs: 30 });
      const live = (await shortLived.authenticate('admin', STRONG))!;
      expect(shortLived.pruneExpiredTokens()).toBe(0);
      expect(shortLived.getStats().activeTokens).toBe(1);

      await sleep(50);

      expect(shortLived.pruneExpiredTokens()).toBe(1);
      expect(shortLived.pruneExpiredTokens()).toBe(0);
      expect(shortLived.getStats().activeTokens).toBe(0);
      expect(await shortLived.verifyToken(live)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Password changes
  // -------------------------------------------------------------------------

  describe('changePassword()', () => {
    it('works with the correct old password', async () => {
      expect(await auth.changePassword('admin', STRONG, STRONG_ALT)).toBe(true);

      expect(await auth.authenticate('admin', STRONG)).toBeNull();
      expect(await auth.authenticate('admin', STRONG_ALT)).toBeTypeOf('string');
    });

    it('fails with the wrong old password and keeps the original', async () => {
      expect(await auth.changePassword('admin', 'WrongHorse42', STRONG_ALT)).toBe(false);
      expect(await auth.authenticate('admin', STRONG)).toBeTypeOf('string');
    });

    it('rejects a new password that does not meet the policy', async () => {
      const error = await rejection(auth.changePassword('admin', STRONG, 'pass123'));
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain('must be at least 12 characters');
      // The old password still works because the change never landed.
      expect(await auth.authenticate('admin', STRONG)).toBeTypeOf('string');
    });

    it('returns false for unknown user', async () => {
      expect(await auth.changePassword('nonexistent', STRONG, STRONG_ALT)).toBe(false);
    });

    it('kills every existing token for the user', async () => {
      const first = (await auth.authenticate('admin', STRONG))!;
      const second = (await auth.authenticate('admin', STRONG))!;
      expect(await auth.verifyToken(first)).not.toBeNull();

      expect(await auth.changePassword('admin', STRONG, STRONG_ALT)).toBe(true);

      expect(await auth.verifyToken(first)).toBeNull();
      expect(await auth.verifyToken(second)).toBeNull();
      expect(auth.getStats().activeTokens).toBe(0);

      // A token minted after the change is valid, with a new credential version.
      const third = (await auth.authenticate('admin', STRONG_ALT))!;
      expect((await auth.verifyToken(third))!.username).toBe('admin');
      expect(third).not.toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // User management
  // -------------------------------------------------------------------------

  describe('getUser()', () => {
    it('returns user info for the bootstrap admin', async () => {
      const user = await auth.getUser('admin');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
      expect(user!.email).toBe('admin@mam.dev');
    });

    it('returns null for an unknown user', async () => {
      expect(await auth.getUser('nonexistent')).toBeNull();
    });

    it('returns info for a registered user', async () => {
      await auth.register('charlie', 'charlie@example.com', STRONG);
      const user = await auth.getUser('charlie');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('charlie');
      expect(user!.email).toBe('charlie@example.com');
      expect(user!.roles).toEqual(['user']);
    });
  });

  describe('listUsers()', () => {
    it('returns every user sorted by username', async () => {
      await auth.register('carol', 'carol@example.com', STRONG);
      await auth.register('alice', 'alice@example.com', STRONG);

      const users = await auth.listUsers();
      expect(users.map((u) => u.username)).toEqual(['admin', 'alice', 'carol']);
    });

    it('returns copies that cannot mutate stored roles', async () => {
      await registerUser(auth);
      const users = await auth.listUsers();
      users[0].roles.push('admin');
      users[0].email = 'tampered@example.com';

      const fresh = await auth.listUsers();
      expect(fresh[0].roles).toEqual(['admin']);
      expect(fresh[0].email).toBe('admin@mam.dev');
    });
  });

  describe('deleteUser()', () => {
    it('removes the user and every token they hold', async () => {
      await registerUser(auth);
      await registerUser(auth, 'bob');
      const aliceToken = (await auth.authenticate('alice', STRONG))!;
      const bobToken = (await auth.authenticate('bob', STRONG))!;

      expect(await auth.deleteUser('alice')).toBe(true);
      expect(await auth.getUser('alice')).toBeNull();
      expect(await auth.authenticate('alice', STRONG)).toBeNull();
      expect(await auth.verifyToken(aliceToken)).toBeNull();
      expect(await auth.verifyToken(bobToken)).not.toBeNull();
    });

    it('returns false for an unknown user', async () => {
      expect(await auth.deleteUser('nonexistent')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Brute force protection
  // -------------------------------------------------------------------------

  describe('lockout', () => {
    it('locks the account after the maximum number of failures', async () => {
      for (let attempt = 1; attempt <= 4; attempt++) {
        expect(await auth.authenticate('admin', 'WrongHorse42')).toBeNull();
      }
      expect(auth.getStats().lockedAccounts).toBe(0);

      expect(await auth.authenticate('admin', 'WrongHorse42')).toBeNull();

      const error = await rejection(auth.authenticate('admin', STRONG));
      expect(error).toBeInstanceOf(AuthError);
      expect(error.code).toBe('account_locked');
      expect(error.statusCode).toBe(429);
      expect(error.message).toContain('Too many failed attempts');
      expect(auth.getStats().lockedAccounts).toBe(1);
    });

    it('locks per account, leaving other users able to log in', async () => {
      await registerUser(auth);
      for (let attempt = 0; attempt < 5; attempt++) {
        await auth.authenticate('admin', 'WrongHorse42');
      }

      expect(await auth.authenticate('alice', STRONG)).toBeTypeOf('string');
    });

    it('clears the failure counter after a successful login', async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        await auth.authenticate('admin', 'WrongHorse42');
      }
      expect(await auth.authenticate('admin', STRONG)).toBeTypeOf('string');

      // The counter restarted: four more failures must not lock the account.
      for (let attempt = 0; attempt < 4; attempt++) {
        expect(await auth.authenticate('admin', 'WrongHorse42')).toBeNull();
      }
      expect(auth.getStats().lockedAccounts).toBe(0);
      expect(await auth.authenticate('admin', STRONG)).toBeTypeOf('string');
    });

    it('counts a wrong old password on changePassword as a failure', async () => {
      const impatient = await makeAuth({ maxFailedAttempts: 2 });
      expect(await impatient.changePassword('admin', 'WrongHorse42', STRONG_ALT)).toBe(false);
      expect(await impatient.changePassword('admin', 'WrongHorse42', STRONG_ALT)).toBe(false);

      const error = await rejection(impatient.authenticate('admin', STRONG));
      expect(error.code).toBe('account_locked');
    });

    it('unlocks once the lockout window expires', async () => {
      const brief = await makeAuth({ lockoutMs: 30 });
      for (let attempt = 0; attempt < 5; attempt++) {
        await brief.authenticate('admin', 'WrongHorse42');
      }
      await expect(brief.authenticate('admin', STRONG)).rejects.toThrow(/Too many failed attempts/);

      await sleep(50);

      expect(brief.getStats().lockedAccounts).toBe(0);
      expect(await brief.authenticate('admin', STRONG)).toBeTypeOf('string');
    });
  });

  // -------------------------------------------------------------------------
  // Diagnostics
  // -------------------------------------------------------------------------

  describe('getStats()', () => {
    it('counts users, tokens and locked accounts', async () => {
      expect(auth.getStats()).toEqual({ users: 1, activeTokens: 0, lockedAccounts: 0 });

      await registerUser(auth);
      await auth.authenticate('admin', STRONG);
      await auth.authenticate('alice', STRONG);
      expect(auth.getStats()).toEqual({ users: 2, activeTokens: 2, lockedAccounts: 0 });

      await auth.revokeToken((await auth.authenticate('alice', STRONG))!);
      expect(auth.getStats().activeTokens).toBe(2);

      for (let attempt = 0; attempt < 5; attempt++) {
        await auth.authenticate('admin', 'WrongHorse42');
      }
      expect(auth.getStats().lockedAccounts).toBe(1);

      expect(JSON.stringify(auth.getStats())).not.toContain(STRONG);
    });
  });
});

describe('sha256()', () => {
  it('produces a stable hex digest', () => {
    expect(sha256('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('changes with the input and is deterministic', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
    expect(sha256('abc')).not.toBe(sha256('abd'));
    expect(sha256('abc')).toHaveLength(64);
  });
});

// ============================================================================
// Persistence
// ============================================================================

describe('AuthManager persistence', () => {
  let tmpDir: string;
  /** Everything onStateError saw, so a test can assert state was surfaced. */
  let reported: string[];

  /**
   * scrypt dominates this suite's runtime, and each persistent instance pays
   * for one hash of the bootstrap admin. A short derived key keeps the restart
   * tests cheap; the production default stays where it is.
   */
  const FAST: AuthManagerOptions = { keyLength: 16 };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-auth-test-'));
    reported = [];
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** A fresh manager over the same data directory, i.e. a process restart. */
  async function open(options: AuthManagerOptions = {}): Promise<AuthManager> {
    const auth = new AuthManager(
      {
        dataDir: tmpDir,
        bootstrapAdmin: BOOTSTRAP,
        onStateError: (message) => reported.push(message),
        ...FAST,
        ...options,
      },
      {},
    );
    await auth.init();
    return auth;
  }

  /** A restart with no bootstrap admin configured, for corrupt-state tests. */
  async function openBare(options: AuthManagerOptions = {}): Promise<AuthManager> {
    const auth = new AuthManager(
      { dataDir: tmpDir, onStateError: (message) => reported.push(message), ...FAST, ...options },
      {},
    );
    await auth.init();
    return auth;
  }

  const stateFile = (): string => join(tmpDir, AUTH_STATE_FILE);
  const readState = async (): Promise<Record<string, any>> =>
    JSON.parse(await readFile(stateFile(), 'utf-8'));

  async function pathExists(path: string): Promise<boolean> {
    return (await import('node:fs/promises')).access(path).then(
      () => true,
      () => false,
    );
  }

  const messages = (): string => reported.join(' | ');

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  describe('users', () => {
    it('keeps a registered user across a restart, and it still authenticates', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      expect(await first.authenticate('alice', STRONG)).toBeTypeOf('string');

      const second = await open();

      expect((await second.getUser('alice'))!.email).toBe('alice@example.com');
      expect((await second.getUser('alice'))!.roles).toEqual(['user']);
      expect(await second.authenticate('alice', STRONG)).toBeTypeOf('string');
      expect(await second.authenticate('alice', 'WrongHorse42')).toBeNull();
      expect(await second.listUsers()).toHaveLength(2);
    });

    it('restores the bootstrap admin without recreating it', async () => {
      const first = await open();
      const createdAt = (await first.getUser('admin'))!.createdAt;

      const second = await open();

      expect(await second.listUsers()).toHaveLength(1);
      expect((await second.getUser('admin'))!.email).toBe('admin@mam.dev');
      // Same record, not a fresh one: a recreated admin would reset any
      // password change made since the last deploy.
      expect((await second.getUser('admin'))!.createdAt).toBe(createdAt);
      expect(await second.authenticate('admin', STRONG)).toBeTypeOf('string');
    });

    it('does not undo a password change on restart', async () => {
      const first = await open();
      expect(await first.changePassword('admin', STRONG, STRONG_ALT)).toBe(true);

      const second = await open();

      expect(await second.authenticate('admin', STRONG)).toBeNull();
      expect(await second.authenticate('admin', STRONG_ALT)).toBeTypeOf('string');
      expect(await second.listUsers()).toHaveLength(1);
    });

    it('keeps a deleted user deleted across a restart', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      const aliceToken = (await first.authenticate('alice', STRONG))!;
      expect(await first.deleteUser('alice')).toBe(true);

      const second = await open();

      expect(await second.getUser('alice')).toBeNull();
      expect(await second.authenticate('alice', STRONG)).toBeNull();
      expect(await second.verifyToken(aliceToken)).toBeNull();
    });

    it('enforces uniqueness rules against the restored roster', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);

      const second = await open();

      const error = await rejection(second.register('alice', 'other@example.com', STRONG_ALT));
      expect(error.code).toBe('username_taken');
      const byEmail = await rejection(
        second.register('bob', 'ALICE@EXAMPLE.COM', STRONG_ALT),
      );
      expect(byEmail.code).toBe('email_taken');
    });

    it('verifies a restored account even if the key length changed', async () => {
      // The key length is read back from the stored hash, so raising it in a
      // later deploy does not lock every existing account out of the registry.
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);

      const second = await open({ keyLength: 64 });

      expect(await second.authenticate('alice', STRONG)).toBeTypeOf('string');
    });
  });

  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  describe('tokens', () => {
    it('keeps a session alive across a restart', async () => {
      const first = await open();
      const token = (await first.authenticate('admin', STRONG))!;
      expect((await first.verifyToken(token))!.username).toBe('admin');

      const second = await open();

      expect((await second.verifyToken(token))!.username).toBe('admin');
      expect(second.hasScope(token, 'admin')).toBe(true);
      expect(second.getStats().activeTokens).toBe(1);
    });

    it('keeps the scope of a restored user token', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      const userToken = (await first.authenticate('alice', STRONG))!;

      const second = await open();

      expect(second.hasScope(userToken, 'read')).toBe(true);
      expect(second.hasScope(userToken, 'admin')).toBe(false);
      expect(await second.verifyTokenWithScope(userToken, 'admin')).toBeNull();
      expect((await second.verifyTokenWithScope(userToken, 'read'))!.username).toBe('alice');
    });

  it('rejects a token that expired while the process was down', async () => {
    // 250ms, not 40: `authenticate` runs scrypt, and under a loaded suite that
    // alone can exceed a 40ms TTL, so the token was already dead before the
    // first assertion and the test failed for the wrong reason.
    const first = await open({ tokenTtlMs: 250 });
    const token = (await first.authenticate('admin', STRONG))!;
    expect((await first.verifyToken(token))!.username).toBe('admin');

    await sleep(400);


      const second = await open();

      // The TTL is authoritative and is applied at load, so a restart cannot
      // resurrect a session that ran out while the registry was down.
      expect(await second.verifyToken(token)).toBeNull();
      expect(second.getStats().activeTokens).toBe(0);
      expect(messages()).toMatch(/expired token/);
    });

    it('keeps a revoked token revoked across a restart', async () => {
      const first = await open();
      const token = (await first.authenticate('admin', STRONG))!;
      expect(await first.revokeToken(token)).toBe(true);

      const second = await open();

      expect(await second.verifyToken(token)).toBeNull();
      expect(second.getStats().activeTokens).toBe(0);
    });

    it('keeps revokeAllTokens across a restart, leaving other users alone', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      const aliceToken = (await first.authenticate('alice', STRONG))!;
      const adminToken = (await first.authenticate('admin', STRONG))!;
      expect(await first.revokeAllTokens('alice')).toBe(1);

      const second = await open();

      expect(await second.verifyToken(aliceToken)).toBeNull();
      expect((await second.verifyToken(adminToken))!.username).toBe('admin');
    });

    it('rejects a token minted before a password change, even after a restart', async () => {
      const first = await open();
      const token = (await first.authenticate('admin', STRONG))!;
      expect(await first.changePassword('admin', STRONG, STRONG_ALT)).toBe(true);

      const second = await open();

      expect(await second.verifyToken(token)).toBeNull();
      // A token minted under the new credential is fine.
      expect((await second.verifyToken((await second.authenticate('admin', STRONG_ALT))!))!.username)
        .toBe('admin');
    });

    it('clears every persisted token, so a restart cannot hand them back', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      const adminToken = (await first.authenticate('admin', STRONG))!;
      const aliceToken = (await first.authenticate('alice', STRONG))!;

      expect(await first.clearAllTokens()).toBe(2);

      const second = await open();
      expect(second.getStats().activeTokens).toBe(0);
      expect(await second.verifyToken(adminToken)).toBeNull();
      expect(await second.verifyToken(aliceToken)).toBeNull();
    });

    it('clearAllTokens is a no-op when there is nothing to clear', async () => {
      const auth = await open();
      expect(await auth.clearAllTokens()).toBe(0);
      expect(await pathExists(stateFile())).toBe(true);
      expect(auth.lastStateError).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // On-disk format
  // ---------------------------------------------------------------------------

  describe('the state file', () => {
    it('is versioned and holds the whole roster', async () => {
      const auth = await open();
      await auth.register('alice', 'alice@example.com', STRONG);

      const state = await readState();
      expect(state.version).toBe(AUTH_STATE_VERSION);
      expect(state.savedAt).toBeTypeOf('string');
      expect(Object.keys(state.users).sort()).toEqual(['admin', 'alice']);
      expect(Object.keys(state.tokens)).toHaveLength(0);
    });

    it('never contains a plaintext password', async () => {
      const auth = await open();
      await auth.register('alice', 'alice@example.com', STRONG);
      await auth.authenticate('alice', STRONG);

      const raw = await readFile(stateFile(), 'utf-8');
      expect(raw).not.toContain(STRONG);
      const state = JSON.parse(raw);
      expect(state.users.alice.passwordHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{32}$/);
    });

    it('stays parseable through a burst of concurrent mutations', async () => {
      const auth = await open();
      const parseErrors: string[] = [];
      let reading = true;
      const reader = (async () => {
        while (reading) {
          try {
            const state = JSON.parse(await readFile(stateFile(), 'utf-8'));
            if (state.version !== AUTH_STATE_VERSION) parseErrors.push('wrong version');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') parseErrors.push(String(error));
          }
          await sleep(1);
        }
      })();

      await Promise.all([
        ...['alice', 'bob', 'carol'].map((name) =>
          auth.register(name, `${name}@example.com`, STRONG),
        ),
        ...Array.from({ length: 4 }, () => auth.authenticate('admin', STRONG)),
        ...Array.from({ length: 2 }, () => auth.revokeAllTokens('admin')),
      ]);
      reading = false;
      await reader;

      expect(parseErrors).toEqual([]);
      expect(await auth.listUsers()).toHaveLength(4);
    });

    it('is not written at all when no dataDir is configured', async () => {
      // The default stays in memory: the existing suite constructs a manager
      // with no options, and that must keep touching no filesystem.
      const auth = await makeAuth();
      await registerUser(auth);
      await auth.authenticate('admin', STRONG);

      expect(auth.isPersistent).toBe(false);
      expect(auth.statePath).toBeNull();
      expect(auth.lastStateError).toBeNull();

      const other = await makeAuth();
      expect(await other.getUser('alice')).toBeNull();
      expect(await other.authenticate('admin', STRONG)).toBeTypeOf('string');
    });

    it('reports a state directory it cannot write to instead of throwing', async () => {
      const blocker = join(tmpDir, 'not-a-directory');
      await writeFile(blocker, 'x', 'utf-8');
      const auth = new AuthManager(
        { dataDir: blocker, onStateError: (message) => reported.push(message), ...FAST },
        {},
      );

      await expect(auth.init()).resolves.toBeUndefined();
      // A registry on a full or read-only disk must still authenticate traffic.
      await expect(auth.register('alice', 'alice@example.com', STRONG)).resolves.toBeTruthy();
      expect(await auth.authenticate('alice', STRONG)).toBeTypeOf('string');
      expect(messages()).toMatch(/could not be written/);
    });
  });

  // ---------------------------------------------------------------------------
  // init() idempotence
  // ---------------------------------------------------------------------------

  describe('init()', () => {
    it('does not duplicate the admin when called repeatedly', async () => {
      const auth = await open();
      await auth.init();
      await auth.init();
      await auth.init();

      expect(await auth.listUsers()).toHaveLength(1);
      expect((await readState()).version).toBe(AUTH_STATE_VERSION);
    });

    it('does not duplicate the admin across concurrent calls', async () => {
      const auth = new AuthManager(
        {
          dataDir: tmpDir,
          bootstrapAdmin: BOOTSTRAP,
          onStateError: (message) => reported.push(message),
          ...FAST,
        },
        {},
      );
      await Promise.all([auth.init(), auth.init(), auth.init()]);

      expect(await auth.listUsers()).toHaveLength(1);
      expect(Object.keys((await readState()).users)).toEqual(['admin']);
    });

    it('does not reset accounts registered before the second call', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);

      await first.init();
      await first.init();

      expect(await first.listUsers()).toHaveLength(2);
      expect(await first.authenticate('alice', STRONG)).toBeTypeOf('string');
    });

    it('leaves a corrupt file alone until there is a clean load to write', async () => {
      await writeFile(stateFile(), 'not json at all', 'utf-8');
      const auth = await openBare();
      expect(await auth.listUsers()).toEqual([]);

      // Nothing to save yet, so the quarantined copy is the only thing on disk.
      expect(await pathExists(stateFile())).toBe(false);

      await auth.register('alice', 'alice@example.com', STRONG);

      expect(Object.keys((await readState()).users)).toEqual(['alice']);
      expect(await readFile(join(tmpDir, `${AUTH_STATE_FILE}.corrupt-1`), 'utf-8')).toBe(
        'not json at all',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Damaged state
  // ---------------------------------------------------------------------------

  describe('damaged state', () => {
    it('starts empty and reports a file that is not valid JSON', async () => {
      await writeFile(stateFile(), '{"version": 1, "users": {', 'utf-8');

      const auth = await openBare();

      expect(await auth.listUsers()).toEqual([]);
      expect(auth.lastStateError).toMatch(/not valid JSON/);
      expect(messages()).toMatch(/not valid JSON/);
      // Preserved, not deleted: it may be the only copy of real accounts.
      expect(await readFile(join(tmpDir, `${AUTH_STATE_FILE}.corrupt-1`), 'utf-8')).toBe(
        '{"version": 1, "users": {',
      );
    });

    it('starts empty for an empty file', async () => {
      await writeFile(stateFile(), '', 'utf-8');

      const auth = await openBare();

      expect(await auth.listUsers()).toEqual([]);
      expect(auth.lastStateError).toMatch(/not valid JSON/);
    });

    it('treats a missing state file as a fresh deploy and re-seeds the admin', async () => {
      const first = await open();
      await first.register('alice', 'alice@example.com', STRONG);
      await rm(stateFile());

      const second = await open();

      expect(await second.listUsers()).toHaveLength(1);
      expect((await second.getUser('admin'))!.email).toBe('admin@mam.dev');
      expect(await second.getUser('alice')).toBeNull();
      // No file is not damage, so nothing is reported.
      expect(second.lastStateError).toBeNull();
    });

    it('refuses to guess at a format version it does not know', async () => {
      const seeded = {
        version: AUTH_STATE_VERSION + 99,
        savedAt: new Date().toISOString(),
        users: { admin: { username: 'admin', email: 'a@b.dev', passwordHash: 'scrypt$s$00' } },
        tokens: {},
      };
      await writeFile(stateFile(), JSON.stringify(seeded), 'utf-8');

      const auth = await openBare();

      expect(await auth.listUsers()).toEqual([]);
      expect(auth.lastStateError).toMatch(/not a supported format/);
      // Quarantined rather than interpreted: a future field layout must not be
      // read against today's assumptions.
      expect(await pathExists(join(tmpDir, `${AUTH_STATE_FILE}.corrupt-1`))).toBe(true);
    });

    it('refuses a file with no version at all', async () => {
      await writeFile(stateFile(), JSON.stringify({ users: {}, tokens: {} }), 'utf-8');

      const auth = await openBare();

      expect(auth.lastStateError).toMatch(/not a supported format/);
      expect(await auth.listUsers()).toEqual([]);
    });

    it('keeps the entries it can use and drops the ones it cannot', async () => {
      const now = Date.now();
      await writeFile(
        stateFile(),
        JSON.stringify({
          version: AUTH_STATE_VERSION,
          savedAt: new Date().toISOString(),
          users: {
            admin: {
              username: 'admin',
              email: 'admin@mam.dev',
              // Any well-formed hash will do: this test is about the loader.
              passwordHash: `scrypt$${'a'.repeat(32)}${'b'.repeat(32)}`,
              createdAt: 'then',
              lastLogin: 'then',
              roles: ['admin'],
              credentialVersion: 1,
            },
            malformed: { username: 'malformed' },
          },
          tokens: {
            // Token ids end in the credential version, so a realistic fixture
            // has to as well: `live` alone would never pass the version check.
            aa0001: {
              token: 'aa0001',
              username: 'admin',
              expiresAt: now + 60_000,
              scope: ['read', 'write', 'admin'],
            },
            bb0001: { token: 'bb0001', username: 'admin', expiresAt: now - 1, scope: ['read'] },
            garbage: { nope: true },
          },
        }),
        'utf-8',
      );

      const auth = await openBare();

      expect((await auth.listUsers()).map((u) => u.username)).toEqual(['admin']);
      expect((await auth.verifyToken('aa0001'))!.username).toBe('admin');
      expect(await auth.verifyToken('bb0001')).toBeNull();
      expect(await auth.verifyToken('garbage')).toBeNull();
      expect(auth.getStats().activeTokens).toBe(1);
      expect(messages()).toMatch(/expired token/);
      expect(messages()).toMatch(/unusable entr/);
    });

    it('recovers and works normally once a good file is written', async () => {
      await writeFile(stateFile(), '}{', 'utf-8');
      const first = await openBare();
      await first.register('alice', 'alice@example.com', STRONG);

      const second = await openBare();
      await second.register('bob', 'bob@example.com', STRONG);

      expect((await second.listUsers()).map((u) => u.username)).toEqual(['alice', 'bob']);
      expect(await second.authenticate('bob', STRONG)).toBeTypeOf('string');
    });
  });
});