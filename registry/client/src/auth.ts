/**
 * MAM Registry Authentication
 *
 * Handles login, logout, token refresh, API-key auth and JWT expiry checks.
 * Tokens are kept in memory and optionally delegated to a pluggable
 * TokenStorage backend so the caller can persist them across restarts.
 */

import { RegistryError } from './errors.js';

// ============================================================================
// Types
// ============================================================================

export interface AuthConfig {
  /** Base URL of the registry (used for auth endpoints) */
  baseUrl: string;
  /** Static API key – takes precedence over bearer token when set */
  apiKey?: string;
  /** Pre-existing bearer token */
  token?: string;
  /** Optional pluggable storage for persisting tokens across restarts */
  tokenStorage?: TokenStorage;
  /** Fetch implementation override (for testing) */
  fetch?: typeof globalThis.fetch;
}

export interface TokenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LoginResponse {
  token: string;
  refreshToken?: string;
  user?: { username: string; email?: string };
}

export interface UserProfile {
  username: string;
  email?: string;
  roles?: string[];
}

interface DecodedJWT {
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

// ============================================================================
// Constants
// ============================================================================

const TOKEN_KEY = 'mam_auth_token';
const REFRESH_TOKEN_KEY = 'mam_refresh_token';
const EXPIRY_BUFFER_MS = 30_000; // refresh 30 s before actual expiry

// ============================================================================
// RegistryAuth
// ============================================================================

export class RegistryAuth {
  private config: AuthConfig;
  private _token: string | null = null;
  private _refreshToken: string | null = null;
  private _tokenExpiry: number | null = null;
  private _fetch: typeof globalThis.fetch;

  constructor(config: AuthConfig) {
    this.config = config;
    this._fetch = config.fetch ?? globalThis.fetch;
    this._token = config.token ?? null;
    if (this._token) {
      this._tokenExpiry = this.extractExpiry(this._token);
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Authenticate with username / password.
   * On success the returned token is persisted (in-memory + optional storage)
   * and can be retrieved via `getAuthHeaders()`.
   */
  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await this.rawFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const body = await this.parseBody(res);
    if (!res.ok) {
      throw new RegistryError(
        (body as { error?: string } | null)?.error ?? 'Login failed',
        { statusCode: res.status, body },
      );
    }

    const data = body as LoginResponse;
    await this.setTokens(data.token, data.refreshToken ?? null);
    return data;
  }

  /**
   * Invalidate the current session on the server and discard local tokens.
   */
  async logout(): Promise<void> {
    try {
      await this.rawFetch('/auth/logout', {
        method: 'POST',
        headers: this.buildHeaders(),
      });
    } finally {
      await this.clearTokens();
    }
  }

  /**
   * Exchange the current refresh token for a new access token.
   */
  async refreshToken(): Promise<string> {
    if (!this._refreshToken) {
      throw new RegistryError('No refresh token available', { statusCode: 401 });
    }

    const res = await this.rawFetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: this._refreshToken }),
    });

    const body = await this.parseBody(res);
    if (!res.ok) {
      await this.clearTokens();
      throw new RegistryError(
        (body as { error?: string } | null)?.error ?? 'Token refresh failed',
        { statusCode: res.status, body },
      );
    }

    const data = body as { token: string; refreshToken?: string };
    await this.setTokens(data.token, data.refreshToken ?? this._refreshToken);
    return data.token;
  }

  /**
   * Retrieve the authenticated user's profile.
   */
  async getProfile(): Promise<UserProfile> {
    const res = await this.rawFetch('/auth/profile', {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    const body = await this.parseBody(res);
    if (!res.ok) {
      throw new RegistryError(
        (body as { error?: string } | null)?.error ?? 'Failed to fetch profile',
        { statusCode: res.status, body },
      );
    }

    return body as UserProfile;
  }

  /**
   * Change the authenticated user's password.
   */
  async changePassword(oldPassword: string, newPassword: string): Promise<void> {
    const res = await this.rawFetch('/auth/password', {
      method: 'POST',
      headers: { ...this.buildHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    });

    const body = await this.parseBody(res);
    if (!res.ok) {
      throw new RegistryError(
        (body as { error?: string } | null)?.error ?? 'Password change failed',
        { statusCode: res.status, body },
      );
    }
  }

  /**
   * Build the headers needed for an authenticated request.
   * API key takes precedence; otherwise the bearer token is used.
   * If the token is about to expire a background refresh is triggered.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.config.apiKey) {
      return { Authorization: `ApiKey ${this.config.apiKey}` };
    }

    if (this._token) {
      if (this.isTokenExpiring() && this._refreshToken) {
        try {
          await this.refreshToken();
        } catch {
          // let the caller handle 401 – we still return the (possibly stale) token
        }
      }
      return { Authorization: `Bearer ${this._token}` };
    }

    return {};
  }

  /**
   * Returns true when a valid (non-expired) token is held.
   */
  isAuthenticated(): boolean {
    if (this.config.apiKey) return true;
    if (!this._token) return false;
    return !this.isTokenExpired();
  }

  /**
   * Decode the JWT and return its `exp` claim as a Date, or null when
   * the token is absent / not a valid JWT.
   */
  getTokenExpiration(): Date | null {
    const decoded = this.decodeToken();
    if (!decoded?.exp) return null;
    return new Date(decoded.exp * 1000);
  }

  /**
   * Manually set a token (useful when restoring from storage).
   */
  async setToken(token: string, refreshToken?: string | null): Promise<void> {
    await this.setTokens(token, refreshToken ?? null);
  }

  /**
   * Drop all in-memory and persisted tokens.
   */
  async clearTokens(): Promise<void> {
    this._token = null;
    this._refreshToken = null;
    this._tokenExpiry = null;
    const storage = this.config.tokenStorage;
    if (storage) {
      await storage.removeItem(TOKEN_KEY);
      await storage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async setTokens(token: string, refreshToken: string | null): Promise<void> {
    this._token = token;
    this._refreshToken = refreshToken;
    this._tokenExpiry = this.extractExpiry(token);

    const storage = this.config.tokenStorage;
    if (storage) {
      await storage.setItem(TOKEN_KEY, token);
      if (refreshToken) {
        await storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
      }
    }
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.config.apiKey) {
      headers['Authorization'] = `ApiKey ${this.config.apiKey}`;
    } else if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`;
    }
    return headers;
  }

  private isTokenExpired(): boolean {
    if (this._tokenExpiry === null) return false;
    return Date.now() >= this._tokenExpiry;
  }

  private isTokenExpiring(): boolean {
    if (this._tokenExpiry === null) return true;
    return Date.now() >= this._tokenExpiry - EXPIRY_BUFFER_MS;
  }

  private extractExpiry(token: string): number | null {
    const decoded = this.safeDecode(token);
    return decoded?.exp ? decoded.exp * 1000 : null;
  }

  private decodeToken(): DecodedJWT | null {
    return this.safeDecode(this._token);
  }

  private safeDecode(token: string | null): DecodedJWT | null {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const json = atob(payload);
      return JSON.parse(json) as DecodedJWT;
    } catch {
      return null;
    }
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
    try {
      return await this._fetch(url, init);
    } catch (err) {
      throw new RegistryError(
        `Network error: ${(err as Error).message}`,
        { isNetworkError: true },
      );
    }
  }

  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
