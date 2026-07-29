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

      const auth = new RegistryAuth(makeConfig({ storage } as any));
      await auth.clearTokens();
      expect(store.has('mam_auth_token')).toBe(false);
    });
  });
});
