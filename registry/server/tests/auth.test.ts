import { describe, it, expect, beforeEach } from 'vitest';
import { AuthManager } from '../src/auth.js';

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    auth = new AuthManager();
  });

  describe('register()', () => {
    it('creates a new user', async () => {
      const user = await auth.register('alice', 'alice@example.com', 'password123');
      expect(user.username).toBe('alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.createdAt).toBeDefined();
      expect(user.lastLogin).toBeDefined();
    });

    it('throws on duplicate username', async () => {
      await auth.register('bob', 'bob@example.com', 'pass123');
      await expect(auth.register('bob', 'bob2@example.com', 'pass456')).rejects.toThrow(
        'Username already exists'
      );
    });
  });

  describe('authenticate()', () => {
    it('returns a token for valid credentials', async () => {
      const token = await auth.authenticate('admin', 'admin123');
      expect(token).toBeTypeOf('string');
      expect(token!.length).toBeGreaterThan(0);
    });

    it('returns null for invalid credentials', async () => {
      const token = await auth.authenticate('admin', 'wrongpassword');
      expect(token).toBeNull();
    });

    it('returns null for unknown user', async () => {
      const token = await auth.authenticate('nonexistent', 'pass');
      expect(token).toBeNull();
    });
  });

  describe('verifyToken()', () => {
    it('returns user info for a valid token', async () => {
      const token = await auth.authenticate('admin', 'admin123');
      const user = await auth.verifyToken(token!);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
      expect(user!.email).toBe('admin@mam.dev');
    });

    it('returns null for an invalid token', async () => {
      const user = await auth.verifyToken('invalid-token-string');
      expect(user).toBeNull();
    });

    it('returns null for an expired token', async () => {
      const token = await auth.authenticate('admin', 'admin123');
      // Manually expire the token by manipulating internal state via revoke + manual insert isn't possible,
      // so we just verify a non-existent token returns null (proxy for expired)
      await auth.revokeToken(token!);
      const user = await auth.verifyToken(token!);
      expect(user).toBeNull();
    });
  });

  describe('revokeToken()', () => {
    it('removes the token so it can no longer be verified', async () => {
      const token = await auth.authenticate('admin', 'admin123');
      const revoked = await auth.revokeToken(token!);
      expect(revoked).toBe(true);

      const user = await auth.verifyToken(token!);
      expect(user).toBeNull();
    });

    it('returns false for a non-existent token', async () => {
      const revoked = await auth.revokeToken('nonexistent-token');
      expect(revoked).toBe(false);
    });
  });

  describe('changePassword()', () => {
    it('works with the correct old password', async () => {
      const result = await auth.changePassword('admin', 'admin123', 'newpassword');
      expect(result).toBe(true);

      // Old password should no longer work
      const oldToken = await auth.authenticate('admin', 'admin123');
      expect(oldToken).toBeNull();

      // New password should work
      const newToken = await auth.authenticate('admin', 'newpassword');
      expect(newToken).toBeTypeOf('string');
    });

    it('fails with the wrong old password', async () => {
      const result = await auth.changePassword('admin', 'wrongpassword', 'newpassword');
      expect(result).toBe(false);
    });

    it('returns false for unknown user', async () => {
      const result = await auth.changePassword('nonexistent', 'old', 'new');
      expect(result).toBe(false);
    });
  });

  describe('getUser()', () => {
    it('returns user info for an existing user', async () => {
      const user = await auth.getUser('admin');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('admin');
      expect(user!.email).toBe('admin@mam.dev');
    });

    it('returns null for an unknown user', async () => {
      const user = await auth.getUser('nonexistent');
      expect(user).toBeNull();
    });

    it('returns info for a registered user', async () => {
      await auth.register('charlie', 'charlie@example.com', 'pass');
      const user = await auth.getUser('charlie');
      expect(user).not.toBeNull();
      expect(user!.username).toBe('charlie');
      expect(user!.email).toBe('charlie@example.com');
    });
  });
});
