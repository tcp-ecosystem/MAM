/**
 * MAM Registry Authentication
 *
 * Handles login, logout, token refresh, API-key auth and JWT expiry checks.
 * Tokens are kept in memory and delegated to a pluggable TokenStorage backend,
 * so a session can survive a process restart: they are written on every change
 * and read back during construction (see {@link RegistryAuth.restore}).
 *
 * Expiry policy: only a token whose JWT `exp` can be read is refreshed
 * proactively. An opaque token is treated as non-expiring, because guessing
 * would cost a network round-trip per request; such a token is renewed
 * reactively by the HTTP layer when the registry answers 401.
 */

import { RegistryError, isTimeoutError } from './errors.js';

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

/**
 * Reject a missing / empty baseUrl up front. Without this the failure only
 * surfaces as `TypeError: Cannot read properties of undefined (reading 'replace')`
 * from deep inside the request pipeline.
 */
function validateBaseUrl(baseUrl: unknown): string {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new RegistryError(
      'RegistryAuth: `baseUrl` is required and must be a non-empty URL, e.g. "https://registry.example.com"',
    );
  }
  return baseUrl.trim();
}

// ============================================================================
// RegistryAuth
// ============================================================================

export class RegistryAuth {
  private config: AuthConfig;
  private _token: string | null = null;
  private _refreshToken: string | null = null;
  private _tokenExpiry: number | null = null;
  private _fetch: typeof globalThis.fetch;
  /** baseUrl with surrounding whitespace and trailing slashes removed */
  private _baseUrl: string;
  /** shared by concurrent callers so only one refresh is ever in flight */
  private _refreshInFlight: Promise<string> | null = null;
  /**
   * In-flight read of `tokenStorage`, started by the constructor.
   *
   * Hydration is kicked off in the background rather than awaited inline
   * because the constructor cannot be `async` without breaking every existing
   * caller (`new RegistryAuth(...)` is used as an expression in `RegistryClient`
   * and in application code). Everything on the request path awaits
   * {@link RegistryAuth.ready} first, so a request made immediately after
   * construction still carries the restored token; `restore()` exposes the same
   * promise to callers that need to observe hydration without a request, such
   * as the synchronous `isAuthenticated()`.
   */
  private _hydration: Promise<void> | null = null;
  /**
   * Bumped by every deliberate credential change (`setTokens`, `clearTokens`).
   *
   * Hydration reads storage asynchronously, so a `login()` or `logout()` can
   * land while the read is in flight. The epoch lets the read notice that the
   * in-memory state is no longer the one it started from, and stand down
   * rather than resurrect a token the caller has just discarded.
   */
  private _credentialEpoch = 0;

  constructor(config: AuthConfig) {
    this.config = { ...config, baseUrl: validateBaseUrl(config.baseUrl) };
    this._baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    this._fetch = config.fetch ?? globalThis.fetch;
    this._token = config.token ?? null;
    if (this._token) {
      this._tokenExpiry = this.extractExpiry(this._token);
    }
    if (this.config.tokenStorage && !this._token && !this.config.apiKey) {
      this._hydration = this.hydrate();
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
    // hydrate first, so a restored session is the one actually invalidated
    await this.ready();
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
   *
   * Concurrent callers share a single in-flight request: registries commonly
   * invalidate a refresh token the moment it is used, so two parallel refreshes
   * would leave one of them holding a dead token. The lock is released as soon
   * as the request settles, so a failed refresh can be retried.
   */
  async refreshToken(): Promise<string> {
    // a restored refresh token is only useful if the read has landed
    await this.ready();

    const inFlight = this._refreshInFlight;
    if (inFlight) return inFlight;

    const pending = this.performRefresh().finally(() => {
      if (this._refreshInFlight === pending) {
        this._refreshInFlight = null;
      }
    });
    this._refreshInFlight = pending;
    return pending;
  }

  /**
   * True when a refresh token is held, i.e. when `refreshToken()` can succeed.
   */
  canRefresh(): boolean {
    return this._refreshToken !== null;
  }

  /**
   * Resolves once any background hydration from `tokenStorage` has settled.
   *
   * Every method on the request path awaits this for you, so an ordinary
   * `getProfile()` issued right after `new RegistryAuth({ tokenStorage })`
   * already carries the restored token. Call it directly when you need the
   * *synchronous* accessors to reflect storage: `isAuthenticated()`,
   * `canRefresh()`, `isExpiring()` and `getTokenExpiration()` cannot await, so
   * they read the in-memory state as it is at the moment they are called.
   *
   * Idempotent, and a no-op when there is nothing to hydrate.
   */
  async restore(): Promise<void> {
    await this.ready();
  }

  /**
   * Retrieve the authenticated user's profile.
   */
  async getProfile(): Promise<UserProfile> {
    await this.ready();
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
    await this.ready();
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
   *
   * Opaque (non-JWT) tokens carry no `exp` claim: the client cannot know when
   * they lapse, so they are treated as non-expiring and never proactively
   * refreshed. Such a token is renewed reactively by the HTTP layer on a 401.
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    await this.ready();

    if (this.config.apiKey) {
      return { Authorization: `ApiKey ${this.config.apiKey}` };
    }

    if (this._token) {
      if (this.canRefresh() && this.isTokenExpiring()) {
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
   * True when the token expires within the refresh buffer.
   * Opaque tokens (no readable `exp`) are never considered expiring, which
   * keeps this consistent with {@link isAuthenticated}.
   */
  isExpiring(): boolean {
    if (!this._token) return false;
    return this.isTokenExpiring();
  }

  /**
   * Manually set a token (useful when restoring from storage).
   * Omitting `refreshToken` (or passing `null`) clears any stored refresh token.
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
    this._refreshInFlight = null;
    this._credentialEpoch++;
    const storage = this.config.tokenStorage;
    if (storage) {
      await storage.removeItem(TOKEN_KEY);
      await storage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Waits for background hydration to finish, at most once.
   *
   * The pending promise is cleared on settle so a long-lived client does not
   * keep an await alive on every request, and a re-entrant call from inside
   * hydration cannot deadlock on itself.
   */
  private async ready(): Promise<void> {
    const hydration = this._hydration;
    if (!hydration) return;
    try {
      await hydration;
    } finally {
      if (this._hydration === hydration) {
        this._hydration = null;
      }
    }
  }

  /**
   * Restores a persisted session from `tokenStorage`.
   *
   * The read is deliberately forgiving, because a storage backend is the part
   * of this client most likely to be a `localStorage` wrapper in a private
   * browser mode, a `sessionStorage` that another tab has already cleared, or
   * a cookie jar that has expired. None of those is a reason to fail
   * construction; the worst case is a client that is simply not authenticated.
   */
  private async hydrate(): Promise<void> {
    const storage = this.config.tokenStorage;
    if (!storage) return;

    const epoch = this._credentialEpoch;

    let token: string | null = null;
    let refreshToken: string | null = null;
    try {
      [token, refreshToken] = await Promise.all([
        storage.getItem(TOKEN_KEY),
        storage.getItem(REFRESH_TOKEN_KEY),
      ]);
    } catch {
      // a backend that throws means "no session", not "broken client"
      return;
    }

    // A credential supplied explicitly is never overwritten, and a login or
    // logout that raced the read owns the outcome.
    if (this._credentialEpoch !== epoch || this._token || this.config.apiKey) {
      return;
    }

    if (!token) {
      // Nothing usable in storage. A refresh token on its own is kept, so a
      // client that missed the access token can still renew itself.
      this._refreshToken = refreshToken || null;
      return;
    }

    const expiry = this.extractExpiry(token);
    if (expiry !== null && Date.now() >= expiry) {
      // The process was down for longer than the token lived. Restoring it
      // would hand the caller a session the registry is bound to reject, so it
      // is dropped – and taken out of storage, otherwise the next start
      // repeats the same pointless round-trip.
      try {
        await storage.removeItem(TOKEN_KEY);
      } catch {
        // nothing to do: the token is already ignored in memory
      }
      if (refreshToken) {
        this._refreshToken = refreshToken;
      }
      return;
    }

    this._token = token;
    this._refreshToken = refreshToken;
    this._tokenExpiry = expiry;
  }

  private async performRefresh(): Promise<string> {
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

  private async setTokens(token: string, refreshToken: string | null): Promise<void> {
    this._token = token;
    this._refreshToken = refreshToken;
    this._tokenExpiry = this.extractExpiry(token);
    this._credentialEpoch++;

    const storage = this.config.tokenStorage;
    if (!storage) return;

    await storage.setItem(TOKEN_KEY, token);
    if (refreshToken) {
      await storage.setItem(REFRESH_TOKEN_KEY, refreshToken);
    } else {
      // this session has no refresh token – drop any stale one so that memory
      // and storage cannot disagree
      await storage.removeItem(REFRESH_TOKEN_KEY);
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

  /** An opaque token has no readable `exp`, so it is never considered expired. */
  private isTokenExpired(): boolean {
    if (this._tokenExpiry === null) return false;
    return Date.now() >= this._tokenExpiry;
  }

  /**
   * An opaque token has no readable `exp`, so the client cannot know when it
   * lapses and must not guess – it is never proactively refreshed.
   */
  private isTokenExpiring(): boolean {
    if (this._tokenExpiry === null) return false;
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
      const base64url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      // `atob` rejects unpadded base64, so restore the '=' padding first
      const padded = base64url.padEnd(Math.ceil(base64url.length / 4) * 4, '=');
      const json = atob(padded);
      return JSON.parse(json) as DecodedJWT;
    } catch {
      return null;
    }
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const url = `${this._baseUrl}${path}`;
    try {
      return await this._fetch(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new RegistryError(`Network error: ${message}`, {
        isNetworkError: true,
        isTimeout: isTimeoutError(err, init.signal),
      });
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
