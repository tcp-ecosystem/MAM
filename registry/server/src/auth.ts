/**
 * MAM Auth Manager
 * 
 * Authentication and authorization for the registry.
 */

import { randomBytes, createHash } from 'node:crypto';

// ============================================================================
// Types
// ============================================================================

export interface AuthToken {
  /** Token value */
  token: string;
  /** Username */
  username: string;
  /** Expiration timestamp */
  expiresAt: number;
  /** Token scope */
  scope: string[];
}

export interface UserInfo {
  /** Username */
  username: string;
  /** Email */
  email: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last login */
  lastLogin: string;
}

// ============================================================================
// Auth Manager
// ============================================================================

export class AuthManager {
  private users: Map<string, UserRecord> = new Map();
  private tokens: Map<string, AuthToken> = new Map();

  constructor() {
    // Initialize with admin user
    this.users.set('admin', {
      username: 'admin',
      email: 'admin@mam.dev',
      passwordHash: this.hashPassword('admin123'),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    });
  }

  /**
   * Authenticate user
   */
  async authenticate(username: string, password: string): Promise<string | null> {
    const user = this.users.get(username);
    if (!user) {
      return null;
    }

    const hash = this.hashPassword(password);
    if (user.passwordHash !== hash) {
      return null;
    }

    // Update last login
    user.lastLogin = new Date().toISOString();

    // Generate token
    const token = this.generateToken(username);
    this.tokens.set(token.token, token);

    return token.token;
  }

  /**
   * Verify token
   */
  async verifyToken(token: string): Promise<UserInfo | null> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return null;
    }

    // Check expiration
    if (Date.now() > tokenData.expiresAt) {
      this.tokens.delete(token);
      return null;
    }

    const user = this.users.get(tokenData.username);
    if (!user) {
      return null;
    }

    return {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    };
  }

  /**
   * Register new user
   */
  async register(username: string, email: string, password: string): Promise<UserInfo> {
    if (this.users.has(username)) {
      throw new Error('Username already exists');
    }

    const user: UserRecord = {
      username,
      email,
      passwordHash: this.hashPassword(password),
      createdAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
    };

    this.users.set(username, user);

    return {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    };
  }

  /**
   * Revoke token
   */
  async revokeToken(token: string): Promise<boolean> {
    return this.tokens.delete(token);
  }

  /**
   * Get user
   */
  async getUser(username: string): Promise<UserInfo | null> {
    const user = this.users.get(username);
    if (!user) {
      return null;
    }

    return {
      username: user.username,
      email: user.email,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin,
    };
  }

  /**
   * Change password
   */
  async changePassword(username: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const user = this.users.get(username);
    if (!user) {
      return false;
    }

    if (user.passwordHash !== this.hashPassword(oldPassword)) {
      return false;
    }

    user.passwordHash = this.hashPassword(newPassword);
    return true;
  }

  private generateToken(username: string): AuthToken {
    const tokenBytes = randomBytes(32);
    const token = tokenBytes.toString('hex');

    return {
      token,
      username,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      scope: ['read', 'write'],
    };
  }

  private hashPassword(password: string): string {
    return createHash('sha256').update(password).digest('hex');
  }
}

interface UserRecord {
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  lastLogin: string;
}