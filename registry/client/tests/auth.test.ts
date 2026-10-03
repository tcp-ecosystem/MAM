import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryAuth, type AuthConfig } from '../src/auth.js';
import { RegistryError } from '../src/errors.js';

// ============================================================================
// Helpers
// ============================================================================

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(handler) as unknown as typeof globalThis.fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    baseUrl: 'https://registry.example.com',
    ...overrides,
  };
}

function makeToken(expiryInSecondsFromNow: number): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiryInSecondsFromNow, sub: 'user1' }),
  );
  const sig = 'sig';
  return `${header}.${payload}.${sig}`;
}

/** Build a JWT whose payload is base64url *without* `=` padding */
function makeUnpaddedToken(payload: Record<string, unknown>): string {
  const base64url = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `header.${base64url}.sig`;
}

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const storage = {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); },
  };
  return { store, storage };
}

/** Number of times the fake fetch was invoked */
function callCount(fetch: unknown): number {
  return vi.mocked(fetch as never).mock.calls.length;
}

/** An error that looks like the one Node 18 / undici throw on timeout */
function timeoutError(): Error {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}


// ============================================================================
// Tests
// ============================================================================

describe('RegistryAuth', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('creates instance with defaults', () => {
      const auth = new RegistryAuth(makeConfig());
      expect(auth).toBeDefined();
    });

    it('stores initial token', () => {
      const auth = new RegistryAuth(makeConfig({ token: 'init-tok' }));
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('recognises API key as authenticated', () => {
      const auth = new RegistryAuth(makeConfig({ apiKey: 'key-123' }));
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('rejects an empty baseUrl with a clear error', () => {
      expect(() => new RegistryAuth(makeConfig({ baseUrl: '' }))).toThrow(/baseUrl/);
    });

    it('rejects a whitespace-only baseUrl with a clear error', () => {
      expect(() => new RegistryAuth(makeConfig({ baseUrl: '   ' }))).toThrow(/baseUrl/);
    });

    it('rejects a missing baseUrl with a clear error', () => {
      expect(() => new RegistryAuth({} as AuthConfig)).toThrow(/baseUrl/);
    });

    it('never throws a TypeError from deep inside the request path', () => {
      try {
        // eslint-disable-next-line no-new
        new RegistryAuth(makeConfig({ baseUrl: '' }));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(RegistryError);
        expect((err as Error).message).not.toMatch(/replace/);
      }
    });

    it('trims and de-duplicates the baseUrl', async () => {
      const fetch = fakeFetch((url) => {
        expect(url).toBe('https://registry.example.com/auth/profile');
        return jsonResponse({ username: 'alice' });
      });
      const auth = new RegistryAuth(
        makeConfig({ baseUrl: '  https://registry.example.com///  ', fetch, token: 'tok' }),
      );

      const profile = await auth.getProfile();
      expect(profile.username).toBe('alice');
    });
  });

  // -------------------------------------------------------------------------
  // login
  // -------------------------------------------------------------------------

  describe('login', () => {
    it('sends POST /auth/login and stores token', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string);
        expect(body.username).toBe('alice');
        expect(body.password).toBe('s3cret');
        return jsonResponse({ token: 'tok-abc', refreshToken: 'ref-1' });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));

      const result = await auth.login('alice', 's3cret');
      expect(result.token).toBe('tok-abc');
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('throws RegistryError on 401', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'Invalid credentials' }, 401));
      const auth = new RegistryAuth(makeConfig({ fetch }));

      await expect(auth.login('alice', 'bad')).rejects.toThrow(RegistryError);
    });

    it('throws RegistryError on network failure', async () => {
      const fetch = fakeFetch(() => {
        throw new TypeError('Failed to fetch');
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));

      await expect(auth.login('a', 'b')).rejects.toThrow(RegistryError);
    });
  });

  // -------------------------------------------------------------------------
  // logout
  // -------------------------------------------------------------------------

  describe('logout', () => {
    it('calls POST /auth/logout and clears tokens', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('POST');
        return jsonResponse({ ok: true });
      });
      const auth = new RegistryAuth(makeConfig({ fetch, token: 'tok' }));

      await auth.logout();
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('clears tokens even if server request fails', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'fail' }, 500));
      const auth = new RegistryAuth(makeConfig({ fetch, token: 'tok' }));

      await auth.logout();
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // refreshToken
  // -------------------------------------------------------------------------

  describe('refreshToken', () => {
    it('POSTs refresh token and updates stored token', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        const body = JSON.parse(init.body as string);
        expect(body.refreshToken).toBe('ref-1');
        return jsonResponse({ token: 'new-tok', refreshToken: 'ref-2' });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken('old-tok', 'ref-1');

      const newToken = await auth.refreshToken();
      expect(newToken).toBe('new-tok');
    });

    it('throws when no refresh token is available', async () => {
      const auth = new RegistryAuth(makeConfig({ fetch: fakeFetch(() => jsonResponse({})) }));
      await expect(auth.refreshToken()).rejects.toThrow('No refresh token');
    });

    it('clears the session when the server rejects the refresh token', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'Invalid refresh token' }, 401));
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(-5), 'ref-1');

      await expect(auth.refreshToken()).rejects.toThrow(RegistryError);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('canRefresh reflects whether a refresh token is held', async () => {
      const auth = new RegistryAuth(makeConfig({ fetch: fakeFetch(() => jsonResponse({})) }));
      expect(auth.canRefresh()).toBe(false);

      await auth.setToken('tok', 'ref-1');
      expect(auth.canRefresh()).toBe(true);

      await auth.clearTokens();
      expect(auth.canRefresh()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Concurrent refresh
  // -------------------------------------------------------------------------

  describe('concurrent refresh', () => {
    it('collapses concurrent refreshes into a single request', async () => {
      const fresh = makeToken(3600);
      const fetch = fakeFetch(async (url) => {
        expect(url).toContain('/auth/refresh');
        // give the second caller time to join the in-flight request
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponse({ token: fresh });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(-5), 'ref-1');

      const [first, second] = await Promise.all([auth.getAuthHeaders(), auth.getAuthHeaders()]);

      expect(callCount(fetch)).toBe(1);
      expect(first).toEqual(second);
      expect(first['Authorization']).toBe(`Bearer ${fresh}`);
    });

    it('shares the lock between three parallel callers', async () => {
      const fresh = makeToken(3600);
      const fetch = fakeFetch(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponse({ token: fresh });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(-5), 'ref-1');

      const headers = await Promise.all([
        auth.getAuthHeaders(),
        auth.getAuthHeaders(),
        auth.getAuthHeaders(),
      ]);

      expect(callCount(fetch)).toBe(1);
      expect(headers.every((h) => h['Authorization'] === `Bearer ${fresh}`)).toBe(true);
    });

    it('releases the lock after a failed refresh so the next call retries', async () => {
      const stale = makeToken(-5);
      const fresh = makeToken(3600);
      let refreshCalls = 0;
      const fetch = fakeFetch(() => {
        refreshCalls++;
        if (refreshCalls === 1) throw new TypeError('Failed to fetch');
        return jsonResponse({ token: fresh });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(stale, 'ref-1');

      // the failed refresh is swallowed – the stale token is still returned
      const first = await auth.getAuthHeaders();
      expect(first['Authorization']).toBe(`Bearer ${stale}`);
      expect(refreshCalls).toBe(1);

      // the next call must be allowed to refresh again
      const second = await auth.getAuthHeaders();
      expect(second['Authorization']).toBe(`Bearer ${fresh}`);
      expect(refreshCalls).toBe(2);
    });

    it('releases the lock after a timeout', async () => {
      const fresh = makeToken(3600);
      let refreshCalls = 0;
      const fetch = fakeFetch(() => {
        refreshCalls++;
        if (refreshCalls === 1) throw timeoutError();
        return jsonResponse({ token: fresh });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(-5), 'ref-1');

      await auth.getAuthHeaders();
      expect(refreshCalls).toBe(1);

      const second = await auth.getAuthHeaders();
      expect(second['Authorization']).toBe(`Bearer ${fresh}`);
      expect(refreshCalls).toBe(2);
    });

    it('rejects a shared refresh failure for every waiter', async () => {
      const fetch = fakeFetch(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return jsonResponse({ error: 'nope' }, 401);
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(-5), 'ref-1');

      const results = await Promise.allSettled([auth.refreshToken(), auth.refreshToken()]);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(callCount(fetch)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getProfile
  // -------------------------------------------------------------------------

  describe('getProfile', () => {
    it('returns user profile', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('GET');
        return jsonResponse({ username: 'alice', email: 'a@b.com', roles: ['admin'] });
      });
      const auth = new RegistryAuth(makeConfig({ fetch, token: 'tok' }));

      const profile = await auth.getProfile();
      expect(profile.username).toBe('alice');
      expect(profile.roles).toContain('admin');
    });
  });

  // -------------------------------------------------------------------------
  // changePassword
  // -------------------------------------------------------------------------

  describe('changePassword', () => {
    it('POSTs old and new passwords', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string);
        expect(body.oldPassword).toBe('old');
        expect(body.newPassword).toBe('new');
        return jsonResponse({ ok: true });
      });
      const auth = new RegistryAuth(makeConfig({ fetch, token: 'tok' }));

      await expect(auth.changePassword('old', 'new')).resolves.toBeUndefined();
    });

    it('throws on failure', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'Weak password' }, 400));
      const auth = new RegistryAuth(makeConfig({ fetch, token: 'tok' }));

      await expect(auth.changePassword('old', '1')).rejects.toThrow(RegistryError);
    });
  });

  // -------------------------------------------------------------------------
  // getAuthHeaders
  // -------------------------------------------------------------------------

  describe('getAuthHeaders', () => {
    it('returns ApiKey header when apiKey is set', async () => {
      const auth = new RegistryAuth(makeConfig({ apiKey: 'key-123' }));
      const headers = await auth.getAuthHeaders();
      expect(headers['Authorization']).toBe('ApiKey key-123');
    });

    it('returns Bearer header when token is set', async () => {
      const auth = new RegistryAuth(makeConfig({ token: 'my-jwt' }));
      const headers = await auth.getAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer my-jwt');
    });

    it('returns empty when unauthenticated', async () => {
      const auth = new RegistryAuth(makeConfig({}));
      const headers = await auth.getAuthHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // isAuthenticated / getTokenExpiration
  // -------------------------------------------------------------------------

  describe('isAuthenticated', () => {
    it('returns false when no token and no apiKey', () => {
      const auth = new RegistryAuth(makeConfig({}));
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('returns true with valid token', () => {
      const auth = new RegistryAuth(makeConfig({ token: makeToken(3600) }));
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('returns false with expired token', () => {
      const auth = new RegistryAuth(makeConfig({ token: makeToken(-10) }));
      expect(auth.isAuthenticated()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Opaque (non-JWT) token policy
  // -------------------------------------------------------------------------

  describe('opaque tokens', () => {
    it('treats an opaque token as neither expired nor expiring', () => {
      const auth = new RegistryAuth(makeConfig({ token: 'opaque-token' }));
      expect(auth.isExpiring()).toBe(false);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('never attempts a refresh for an opaque token', async () => {
      const fetch = fakeFetch(() => jsonResponse({ token: 'other' }));
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken('opaque-token', 'ref-1');

      const headers = await auth.getAuthHeaders();

      expect(headers['Authorization']).toBe('Bearer opaque-token');
      expect(callCount(fetch)).toBe(0);
    });

    it('does not refresh an opaque token on repeated calls', async () => {
      const fetch = fakeFetch(() => jsonResponse({ token: 'other' }));
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken('opaque-token', 'ref-1');

      await auth.getAuthHeaders();
      await auth.getAuthHeaders();
      await auth.getAuthHeaders();

      expect(callCount(fetch)).toBe(0);
    });

    it('agrees with isAuthenticated for a token inside the refresh buffer', () => {
      const auth = new RegistryAuth(makeConfig({ token: makeToken(10) }));
      // expiring (within the 30 s buffer) but not yet expired
      expect(auth.isExpiring()).toBe(true);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('refreshes a JWT inside the refresh buffer', async () => {
      const fresh = makeToken(3600);
      const fetch = fakeFetch((url) => {
        expect(url).toContain('/auth/refresh');
        return jsonResponse({ token: fresh });
      });
      const auth = new RegistryAuth(makeConfig({ fetch }));
      await auth.setToken(makeToken(10), 'ref-1');

      const headers = await auth.getAuthHeaders();

      expect(headers['Authorization']).toBe(`Bearer ${fresh}`);
      expect(callCount(fetch)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Token decoding
  // -------------------------------------------------------------------------

  describe('token decoding', () => {
    it('decodes unpadded base64url payloads', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const token = makeUnpaddedToken({ exp, sub: 'alice' });
      const payload = token.split('.')[1];
      // guard: the fixture really is missing its base64 padding
      expect(payload).not.toContain('=');
      expect(payload.length % 4).not.toBe(0);

      const auth = new RegistryAuth(makeConfig({ token }));
      expect(auth.getTokenExpiration()?.getTime()).toBe(exp * 1000);
    });

    it('decodes unpadded base64url so the token is not mistaken for opaque', () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const auth = new RegistryAuth(makeConfig({ token: makeUnpaddedToken({ exp, sub: 'bob' }) }));
      expect(auth.isExpiring()).toBe(false);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('decodes an unpadded base64url payload written in the url-safe alphabet', () => {
      const exp = Math.floor(Date.now() / 1000) - 60;
      const token = makeUnpaddedToken({ exp, sub: '~~~???' });
      // the base64url encoding carries no '+' / '/'
      expect(token.split('.')[1]).not.toMatch(/[+/=]/);

      const auth = new RegistryAuth(makeConfig({ token }));
      expect(auth.getTokenExpiration()?.getTime()).toBe(exp * 1000);
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('still returns null for garbage', () => {
      const auth = new RegistryAuth(makeConfig({ token: 'a.b.c' }));
      expect(auth.getTokenExpiration()).toBeNull();
      expect(auth.isAuthenticated()).toBe(true);
    });
  });

  describe('getTokenExpiration', () => {
    it('returns Date for valid JWT', () => {
      const auth = new RegistryAuth(makeConfig({ token: makeToken(3600) }));
      const exp = auth.getTokenExpiration();
      expect(exp).toBeInstanceOf(Date);
      expect(exp!.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns null for non-JWT', () => {
      const auth = new RegistryAuth(makeConfig({ token: 'not-a-jwt' }));
      expect(auth.getTokenExpiration()).toBeNull();
    });

    it('returns null when no token', () => {
      const auth = new RegistryAuth(makeConfig({}));
      expect(auth.getTokenExpiration()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Token storage
  // -------------------------------------------------------------------------

  describe('tokenStorage', () => {
    it('persists tokens to provided storage', async () => {
      const store = new Map<string, string>();
      const storage = {
        getItem: async (k: string) => store.get(k) ?? null,
        setItem: async (k: string, v: string) => { store.set(k, v); },
        removeItem: async (k: string) => { store.delete(k); },
      };

      const fetch = fakeFetch(() => jsonResponse({ token: 'tok-1', refreshToken: 'ref-1' }));
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      await auth.login('a', 'b');
      expect(store.get('mam_auth_token')).toBe('tok-1');
      expect(store.get('mam_refresh_token')).toBe('ref-1');
    });

    it('clearTokens removes from storage', async () => {
      const store = new Map<string, string>();
      store.set('mam_auth_token', 'tok');
      const storage = {
        getItem: async (k: string) => store.get(k) ?? null,
        setItem: async (k: string, v: string) => { store.set(k, v); },
        removeItem: async (k: string) => { store.delete(k); },
      };

      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage } as any));
      await auth.clearTokens();
      expect(store.has('mam_auth_token')).toBe(false);
    });

    it('removes a stale refresh token when login returns none', async () => {
      const { store, storage } = makeStorage({ mam_refresh_token: 'stale-ref' });
      const fetch = fakeFetch(() => jsonResponse({ token: 'tok-1' }));
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      await auth.login('a', 'b');

      expect(store.get('mam_auth_token')).toBe('tok-1');
      expect(store.has('mam_refresh_token')).toBe(false);
      expect(auth.canRefresh()).toBe(false);
    });

    it('removes the stored refresh token when setToken is given null', async () => {
      const { store, storage } = makeStorage({
        mam_auth_token: 'old-tok',
        mam_refresh_token: 'old-ref',
      });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.setToken('new-tok', null);

      expect(store.get('mam_auth_token')).toBe('new-tok');
      expect(store.has('mam_refresh_token')).toBe(false);
      expect(auth.canRefresh()).toBe(false);
    });

    it('removes the stored refresh token when setToken is given none', async () => {
      const { store, storage } = makeStorage({ mam_refresh_token: 'old-ref' });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.setToken('new-tok');

      expect(store.has('mam_refresh_token')).toBe(false);
    });

    it('keeps the stored refresh token across a refresh that omits one', async () => {
      const { store, storage } = makeStorage();
      const fetch = fakeFetch(() => jsonResponse({ token: 'new-tok' }));
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));
      await auth.setToken('old-tok', 'ref-1');

      await auth.refreshToken();

      expect(store.get('mam_auth_token')).toBe('new-tok');
      expect(store.get('mam_refresh_token')).toBe('ref-1');
    });
  });

  // -------------------------------------------------------------------------
  // Hydration on construction
  // -------------------------------------------------------------------------

  describe('restoring a session from storage', () => {
    it('exposes a token written by a previous process', async () => {
      const token = makeToken(3600);
      const { store, storage } = makeStorage();

      // first process logs in and writes to storage
      const first = new RegistryAuth(makeConfig({ tokenStorage: storage }));
      await first.setToken(token, 'ref-1');
      expect(store.get('mam_auth_token')).toBe(token);

      // second process constructs over the same storage
      const second = new RegistryAuth(makeConfig({ tokenStorage: storage }));
      await second.restore();

      expect(second.isAuthenticated()).toBe(true);
      expect(second.canRefresh()).toBe(true);
      const headers = await second.getAuthHeaders();
      expect(headers['Authorization']).toBe(`Bearer ${token}`);
    });

    it('restores the refresh token as well, so a lapsed access token recovers', async () => {
      const fresh = makeToken(3600);
      const { storage } = makeStorage({
        mam_auth_token: makeToken(10),
        mam_refresh_token: 'ref-1',
      });
      const fetch = fakeFetch(() => jsonResponse({ token: fresh, refreshToken: 'ref-2' }));
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      // the request path awaits hydration by itself, no explicit restore()
      const headers = await auth.getAuthHeaders();

      expect(headers['Authorization']).toBe(`Bearer ${fresh}`);
      expect(auth.canRefresh()).toBe(true);
    });

    it('sends the restored token on the first request after construction', async () => {
      const token = makeToken(3600);
      const { storage } = makeStorage({ mam_auth_token: token });
      const fetch = fakeFetch(async (_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe(`Bearer ${token}`);
        return jsonResponse({ username: 'alice' });
      });
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      const profile = await auth.getProfile();

      expect(profile.username).toBe('alice');
    });

    it('is authenticated only after restore() when the caller polls synchronously', async () => {
      const { storage } = makeStorage({ mam_auth_token: makeToken(3600) });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(true);
    });

    it('is not authenticated when storage is empty', async () => {
      const { storage } = makeStorage();
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.canRefresh()).toBe(false);
      const headers = await auth.getAuthHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('restores the token expiration from the JWT claim', async () => {
      const token = makeToken(3600);
      const { storage } = makeStorage({ mam_auth_token: token });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.getTokenExpiration()?.getTime()).toBe(
        Math.floor(Date.now() / 1000) * 1000 + 3600 * 1000,
      );
      expect(auth.isExpiring()).toBe(false);
    });

    it('keeps a refresh token found in storage so the client can recover', async () => {
      const { storage } = makeStorage({ mam_refresh_token: 'ref-1' });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.canRefresh()).toBe(true);
    });

    it('logs out the restored session rather than the anonymous client', async () => {
      const token = makeToken(3600);
      const { storage } = makeStorage({ mam_auth_token: token, mam_refresh_token: 'ref-1' });
      const fetch = fakeFetch(async (_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe(`Bearer ${token}`);
        return jsonResponse({ ok: true });
      });
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      await auth.logout();

      expect(auth.isAuthenticated()).toBe(false);
      expect(await storage.getItem('mam_auth_token')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Hydration safety
  // -------------------------------------------------------------------------

  describe('restoring a session from storage safely', () => {
    it('discards a token that expired while the process was down', async () => {
      const { store, storage } = makeStorage({ mam_auth_token: makeToken(-3600) });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
      expect(auth.canRefresh()).toBe(false);
      const headers = await auth.getAuthHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
      // and it is not left behind to be rejected again on the next start
      expect(store.has('mam_auth_token')).toBe(false);
    });

    it('keeps the refresh token when the access token has expired', async () => {
      const { store, storage } = makeStorage({
        mam_auth_token: makeToken(-3600),
        mam_refresh_token: 'ref-1',
      });
      const fresh = makeToken(3600);
      const fetch = fakeFetch(() => jsonResponse({ token: fresh, refreshToken: 'ref-2' }));
      const auth = new RegistryAuth(makeConfig({ fetch, tokenStorage: storage }));

      const token = await auth.refreshToken();

      expect(token).toBe(fresh);
      expect(store.get('mam_auth_token')).toBe(fresh);
    });

    it('does not clobber a token supplied to the constructor', async () => {
      const { store, storage } = makeStorage({
        mam_auth_token: makeToken(3600),
        mam_refresh_token: 'ref-stored',
      });
      const auth = new RegistryAuth(makeConfig({ token: 'explicit-token', tokenStorage: storage }));

      await auth.restore();

      const headers = await auth.getAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer explicit-token');
      expect(auth.canRefresh()).toBe(false);
      // storage is left as the caller had it
      expect(store.get('mam_auth_token')).not.toBe('explicit-token');
    });

    it('does not clobber an apiKey supplied to the constructor', async () => {
      const { storage } = makeStorage({ mam_auth_token: makeToken(3600) });
      const auth = new RegistryAuth(makeConfig({ apiKey: 'key-123', tokenStorage: storage }));

      await auth.restore();

      const headers = await auth.getAuthHeaders();
      expect(headers['Authorization']).toBe('ApiKey key-123');
    });

    it('does not clobber a token set while the storage read was in flight', async () => {
      const { storage } = makeStorage({ mam_auth_token: 'stored-tok' });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      // a deliberate login wins, whatever storage happens to hold
      await auth.setToken('fresh-tok', 'ref-fresh');
      await auth.restore();

      const headers = await auth.getAuthHeaders();
      expect(headers['Authorization']).toBe('Bearer fresh-tok');
    });

    it('does not resurrect a token that was cleared while the read was in flight', async () => {
      const { storage } = makeStorage({ mam_auth_token: 'stored-tok' });
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.clearTokens();
      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
    });

    it('survives a storage backend that throws on read', async () => {
      const storage = {
        getItem: async () => { throw new Error('storage is unavailable'); },
        setItem: async () => { throw new Error('storage is unavailable'); },
        removeItem: async () => { throw new Error('storage is unavailable'); },
      };

      let auth!: RegistryAuth;
      expect(() => { auth = new RegistryAuth(makeConfig({ tokenStorage: storage })); }).not.toThrow();

      await expect(auth.restore()).resolves.toBeUndefined();
      expect(auth.isAuthenticated()).toBe(false);
      const headers = await auth.getAuthHeaders();
      expect(Object.keys(headers)).toHaveLength(0);
    });

    it('survives a storage backend that throws on the removal of an expired token', async () => {
      const { store, storage } = makeStorage({ mam_auth_token: makeToken(-3600) });
      const throwing = {
        getItem: storage.getItem,
        setItem: storage.setItem,
        removeItem: async () => { throw new Error('quota exceeded'); },
      };
      const auth = new RegistryAuth(makeConfig({ tokenStorage: throwing }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
      expect(store.has('mam_auth_token')).toBe(true);
    });

    it('survives a storage backend that returns a non-string', async () => {
      const storage = {
        getItem: async () => undefined as unknown as string | null,
        setItem: async () => undefined,
        removeItem: async () => undefined,
      };
      const auth = new RegistryAuth(makeConfig({ tokenStorage: storage }));

      await auth.restore();

      expect(auth.isAuthenticated()).toBe(false);
    });

    it('is a no-op when no storage is configured', async () => {
      const auth = new RegistryAuth(makeConfig({ token: 'tok' }));

      await expect(auth.restore()).resolves.toBeUndefined();
      expect(auth.isAuthenticated()).toBe(true);
    });
  });
});
