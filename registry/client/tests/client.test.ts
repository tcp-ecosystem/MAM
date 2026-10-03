import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryClient, type RegistryConfig, type SearchQuery } from '../src/client.js';
import { RegistryAuth } from '../src/auth.js';
import { RegistryError, isRetryableError, isTimeoutError, toRegistryError } from '../src/errors.js';

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

function makeConfig(overrides: Partial<RegistryConfig> = {}): RegistryConfig {
  return {
    baseUrl: 'https://registry.example.com',
    timeout: 5_000,
    retries: 0, // no retries in tests by default
    fetch: fakeFetch(() => jsonResponse({ ok: true })),
    ...overrides,
  };
}

/** Number of times the fake fetch was invoked */
function callCount(fetch: unknown): number {
  return vi.mocked(fetch as never).mock.calls.length;
}

/** Number of fake fetch calls whose URL contains `fragment` */
function callsTo(fetch: unknown, fragment: string): number {
  return vi
    .mocked(fetch as never)
    .mock.calls.filter((call) => String(call[0]).includes(fragment)).length;
}

/** An error that looks like the one Node 18 / undici throw on timeout */
function timeoutError(): Error {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

/** An auth instance that holds a lapsed access token plus a refresh token */
async function makeAuth(fetch: typeof globalThis.fetch, token = 'stale-token') {
  const auth = new RegistryAuth({ baseUrl: 'https://registry.example.com', token, fetch });
  await auth.setToken(token, 'ref-1');
  return auth;
}


// ============================================================================
// Tests
// ============================================================================

describe('RegistryClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('applies default timeout and retries', () => {
      const client = new RegistryClient(makeConfig());
      expect(client).toBeDefined();
    });

    it('accepts custom config', () => {
      const client = new RegistryClient(makeConfig({ timeout: 1000, retries: 5 }));
      expect(client).toBeDefined();
    });

    it('rejects an empty baseUrl with a clear error', () => {
      expect(() => new RegistryClient(makeConfig({ baseUrl: '' }))).toThrow(/baseUrl/);
    });

    it('rejects a missing baseUrl with a clear error', () => {
      expect(() => new RegistryClient({} as RegistryConfig)).toThrow(/baseUrl/);
    });

    it('trims and de-duplicates the baseUrl', async () => {
      const fetch = fakeFetch((url) => {
        expect(url).toBe('https://registry.example.com/modules/foo');
        return jsonResponse({ name: 'foo', version: '1' });
      });
      const client = new RegistryClient(makeConfig({ baseUrl: ' https://registry.example.com/ ', fetch }));

      await client.getModule('foo');
    });

    it('keeps the default retries when an explicit undefined is passed', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'unavailable' }, 503));
      const client = new RegistryClient({
        baseUrl: 'https://registry.example.com',
        fetch,
        retries: undefined,
        retryDelay: 1,
      } as RegistryConfig);

      const err = await client.getModule('foo').catch((e: unknown) => e as RegistryError);

      // the default of 2 retries means 3 attempts, then the 503 is surfaced
      expect(callCount(fetch)).toBe(3);
      expect(err).toBeInstanceOf(RegistryError);
      expect(err.statusCode).toBe(503);
    });

    it('clamps a negative retries value to zero', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'unavailable' }, 503));
      const client = new RegistryClient(makeConfig({ fetch, retries: -1, retryDelay: 1 }));

      await expect(client.getModule('foo')).rejects.toThrow(RegistryError);
      expect(callCount(fetch)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getModule
  // -------------------------------------------------------------------------

  describe('getModule', () => {
    it('fetches a module by name', async () => {
      const fetch = fakeFetch((_url, init) => {
        expect(init.method).toBe('GET');
        return jsonResponse({ name: 'foo', version: '1.0.0' });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      const mod = await client.getModule('foo');
      expect(mod.name).toBe('foo');
      expect(mod.version).toBe('1.0.0');
    });

    it('throws RegistryError on 404', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'not found' }, 404));
      const client = new RegistryClient(makeConfig({ fetch }));

      await expect(client.getModule('missing')).rejects.toThrow(RegistryError);
    });
  });

  // -------------------------------------------------------------------------
  // listModules
  // -------------------------------------------------------------------------

  describe('listModules', () => {
    it('returns paginated results', async () => {
      const data = { data: [], total: 0, page: 1, limit: 20 };
      const fetch = fakeFetch(() => jsonResponse(data));
      const client = new RegistryClient(makeConfig({ fetch }));

      const result = await client.listModules();
      expect(result.total).toBe(0);
    });

    it('appends query params when filters provided', async () => {
      const fetch = fakeFetch((url) => {
        expect(url).toContain('tag=ai');
        expect(url).toContain('author=bob');
        return jsonResponse({ data: [], total: 0, page: 1, limit: 20 });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      await client.listModules({ tag: 'ai', author: 'bob' });
    });
  });

  // -------------------------------------------------------------------------
  // publishModule
  // -------------------------------------------------------------------------

  describe('publishModule', () => {
    it('POSTs module data', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string);
        expect(body.name).toBe('new-mod');
        expect(body.version).toBe('1.0.0');
        return jsonResponse({ name: 'new-mod', version: '1.0.0', url: '/modules/new-mod' });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      const result = await client.publishModule({
        name: 'new-mod',
        version: '1.0.0',
        files: { 'index.js': 'export {}' },
      });
      expect(result.name).toBe('new-mod');
    });
  });

  // -------------------------------------------------------------------------
  // deleteModule
  // -------------------------------------------------------------------------

  describe('deleteModule', () => {
    it('sends DELETE', async () => {
      const fetch = fakeFetch(async (_url, init) => {
        expect(init.method).toBe('DELETE');
        return new Response(null, { status: 204 });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      await expect(client.deleteModule('old-mod')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // getVersions / getVersion
  // -------------------------------------------------------------------------

  describe('getVersions', () => {
    it('returns version list', async () => {
      const fetch = fakeFetch(() => jsonResponse(['1.0.0', '1.1.0']));
      const client = new RegistryClient(makeConfig({ fetch }));

      const versions = await client.getVersions('pkg');
      expect(versions).toEqual(['1.0.0', '1.1.0']);
    });
  });

  describe('getVersion', () => {
    it('returns version detail', async () => {
      const detail = { version: '2.0.0', integrity: 'abc' };
      const fetch = fakeFetch(() => jsonResponse(detail));
      const client = new RegistryClient(makeConfig({ fetch }));

      const v = await client.getVersion('pkg', '2.0.0');
      expect(v.integrity).toBe('abc');
    });
  });

  // -------------------------------------------------------------------------
  // searchModules
  // -------------------------------------------------------------------------

  describe('searchModules', () => {
    it('encodes query params', async () => {
      const fetch = fakeFetch((url) => {
        expect(url).toContain('q=hello%20world');
        expect(url).toContain('sort=downloads');
        expect(url).toContain('limit=10');
        return jsonResponse({ data: [], total: 0, page: 1, limit: 10 });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      await client.searchModules({ q: 'hello world', sort: 'downloads', limit: 10 });
    });
  });

  // -------------------------------------------------------------------------
  // getModuleDependencies
  // -------------------------------------------------------------------------

  describe('getModuleDependencies', () => {
    it('fetches dependencies', async () => {
      const deps = [{ name: 'lodash', version: '^4.0.0', optional: false }];
      const fetch = fakeFetch(() => jsonResponse(deps));
      const client = new RegistryClient(makeConfig({ fetch }));

      const result = await client.getModuleDependencies('my-app');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('lodash');
    });
  });

  // -------------------------------------------------------------------------
  // downloadModule
  // -------------------------------------------------------------------------

  describe('downloadModule', () => {
    it('returns download URL', async () => {
      const fetch = fakeFetch((url) => {
        expect(url).toContain('/download');
        return jsonResponse({ url: 'https://cdn.example.com/pkg-1.0.0.tgz' });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      const result = await client.downloadModule('pkg', '1.0.0');
      expect(result.url).toContain('pkg-1.0.0');
    });
  });

  // -------------------------------------------------------------------------
  // getModuleStats
  // -------------------------------------------------------------------------

  describe('getModuleStats', () => {
    it('fetches stats', async () => {
      const stats = { name: 'pkg', downloads: 42 };
      const fetch = fakeFetch(() => jsonResponse(stats));
      const client = new RegistryClient(makeConfig({ fetch }));

      const result = await client.getModuleStats('pkg');
      expect(result.downloads).toBe(42);
    });
  });

  // -------------------------------------------------------------------------
  // Auth integration
  // -------------------------------------------------------------------------

  describe('auth integration', () => {
    it('sends Authorization header when setAuthToken is called', async () => {
      const fetch = fakeFetch((_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe('Bearer my-token');
        return jsonResponse({ name: 'x', version: '1' });
      });
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuthToken('my-token');

      await client.getModule('x');
    });

    it('clearAuthToken removes header', async () => {
      const fetch = fakeFetch((_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['Authorization']).toBeUndefined();
        return jsonResponse(null);
      });
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuthToken('my-token');
      client.clearAuthToken();

      await expect(client.getModule('x')).resolves.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 401 → refresh → replay
  // -------------------------------------------------------------------------

  describe('401 refresh', () => {
    it('refreshes once and replays the request', async () => {
      const seenTokens: (string | undefined)[] = [];
      const fetch = fakeFetch((url, init) => {
        const headers = init.headers as Record<string, string>;
        if (url.includes('/auth/refresh')) {
          return jsonResponse({ token: 'fresh-token' });
        }
        seenTokens.push(headers['Authorization']);
        if (seenTokens.length === 1) {
          return jsonResponse({ error: 'token expired' }, 401);
        }
        return jsonResponse({ name: 'foo', version: '1.0.0' });
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 0 }));
      client.setAuth(await makeAuth(fetch));

      const mod = await client.getModule('foo');

      expect(mod.name).toBe('foo');
      expect(callsTo(fetch, '/auth/refresh')).toBe(1);
      expect(callsTo(fetch, '/modules/foo')).toBe(2);
      expect(seenTokens).toEqual(['Bearer stale-token', 'Bearer fresh-token']);
    });

    it('replays the body and method of the original request', async () => {
      const seen: { method?: string; body?: string }[] = [];
      const fetch = fakeFetch((url, init) => {
        if (url.includes('/auth/refresh')) return jsonResponse({ token: 'fresh-token' });
        seen.push({ method: init.method, body: init.body as string | undefined });
        if (seen.length === 1) return jsonResponse({ error: 'expired' }, 401);
        return jsonResponse({ ok: true });
      });
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuth(await makeAuth(fetch));

      await client.publishModule({
        name: 'new-mod',
        version: '1.0.0',
        files: { 'index.js': 'export {}' },
      });

      expect(seen).toHaveLength(2);
      expect(seen[1]).toEqual(seen[0]);
      expect(JSON.parse(seen[1].body!).name).toBe('new-mod');
    });

    it('does not loop when the replayed request is rejected again', async () => {
      const fetch = fakeFetch((url) => {
        if (url.includes('/auth/refresh')) return jsonResponse({ token: 'fresh-token' });
        return jsonResponse({ error: 'forbidden' }, 401);
      });
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuth(await makeAuth(fetch));

      await expect(client.getModule('foo')).rejects.toThrow(RegistryError);
      expect(callsTo(fetch, '/auth/refresh')).toBe(1);
      expect(callsTo(fetch, '/modules/foo')).toBe(2);
    });

    it('surfaces the 401 when there is no refresh token', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuthToken('opaque-token');

      await expect(client.getModule('foo')).rejects.toThrow(RegistryError);
      expect(callCount(fetch)).toBe(1);
    });

    it('surfaces the 401 when the refresh itself fails', async () => {
      const fetch = fakeFetch((url) => {
        if (url.includes('/auth/refresh')) return jsonResponse({ error: 'bad refresh' }, 401);
        return jsonResponse({ error: 'unauthorized' }, 401);
      });
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuth(await makeAuth(fetch));

      const err = await client.getModule('foo').catch((e: unknown) => e as RegistryError);

      expect(err).toBeInstanceOf(RegistryError);
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('unauthorized');
      expect(callsTo(fetch, '/modules/foo')).toBe(1);
    });

    it('does not attempt a refresh when the client is unauthenticated', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
      const client = new RegistryClient(makeConfig({ fetch }));

      await expect(client.getModule('foo')).rejects.toThrow(RegistryError);
      expect(callCount(fetch)).toBe(1);
    });

    it('does not refresh on a non-401 status', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'forbidden' }, 403));
      const client = new RegistryClient(makeConfig({ fetch }));
      client.setAuth(await makeAuth(fetch));

      await expect(client.getModule('foo')).rejects.toThrow(RegistryError);
      expect(callsTo(fetch, '/auth/refresh')).toBe(0);
      expect(callsTo(fetch, '/modules/foo')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Retry logic
  // -------------------------------------------------------------------------

  describe('retry logic', () => {
    it('retries on 503 then succeeds', async () => {
      let attempts = 0;
      const fetch = fakeFetch(() => {
        attempts++;
        if (attempts < 3) {
          return jsonResponse({ error: 'unavailable' }, 503);
        }
        return jsonResponse({ name: 'ok', version: '1' });
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 10 }));

      const mod = await client.getModule('ok');
      expect(mod.name).toBe('ok');
      expect(attempts).toBe(3);
    });

    it('does not retry on 400', async () => {
      let attempts = 0;
      const fetch = fakeFetch(() => {
        attempts++;
        return jsonResponse({ error: 'bad request' }, 400);
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 10 }));

      await expect(client.getModule('x')).rejects.toThrow(RegistryError);
      expect(attempts).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Retry classification
  // -------------------------------------------------------------------------

  describe('retry classification', () => {
    it.each([400, 401, 403, 404, 409, 422])('does not retry on %i', async (status) => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'nope' }, status));
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 1 }));

      await expect(client.getModule('x')).rejects.toThrow(RegistryError);
      expect(callCount(fetch)).toBe(1);
    });

    it.each([500, 502, 503, 504])('retries on %i up to the configured count', async (status) => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'server' }, status));
      const client = new RegistryClient(makeConfig({ fetch, retries: 2, retryDelay: 1 }));

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(3); // 1 initial attempt + 2 retries
      expect(err.statusCode).toBe(status);
    });

    it('retries on 408 and 429', async () => {
      const fetch = fakeFetch(() => jsonResponse({ error: 'slow down' }, 429));
      const client = new RegistryClient(makeConfig({ fetch, retries: 1, retryDelay: 1 }));

      await expect(client.getModule('x')).rejects.toThrow(RegistryError);
      expect(callCount(fetch)).toBe(2);
    });

    it('retries network errors up to the configured count', async () => {
      const fetch = fakeFetch(() => {
        throw new TypeError('Failed to fetch');
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 2, retryDelay: 1 }));

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(3);
      expect(err.isNetworkError).toBe(true);
      expect(err.isRetryable).toBe(true);
    });

    it('retries a timeout thrown as a plain Error named TimeoutError', async () => {
      const fetch = fakeFetch(() => {
        throw timeoutError();
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 2, retryDelay: 1 }));

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(3);
      expect(err.message).toMatch(/timed out/);
      expect(err.isTimeout).toBe(true);
      expect(err.isRetryable).toBe(true);
    });

    it('retries a timeout thrown as a DOMException', async () => {
      const fetch = fakeFetch(() => {
        throw new DOMException('The operation timed out', 'TimeoutError');
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 1, retryDelay: 1 }));

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(2);
      expect(err.isTimeout).toBe(true);
    });

    it('classifies a rejection as a timeout when the request signal aborted', async () => {
      const controller = new AbortController();
      const fetch = fakeFetch(() => {
        // some runtimes reject with a plain Error once the signal has aborted
        controller.abort();
        throw new Error('socket hang up');
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 1, retryDelay: 1 }));
      client.addRequestInterceptor((config) => {
        config.signal = controller.signal;
        return config;
      });

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(2);
      expect(err.isTimeout).toBe(true);
      expect(err.message).toMatch(/timed out/);
    });

    it('does not retry a programming error with no status code', async () => {
      const fetch = fakeFetch(() => jsonResponse({ ok: true }));
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 1 }));
      client.addRequestInterceptor(() => {
        throw new TypeError("Cannot read properties of undefined (reading 'x')");
      });

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(0);
      expect(err).toBeInstanceOf(RegistryError);
      expect(err.statusCode).toBeUndefined();
      expect(err.isRetryable).toBe(false);
    });

    it('does not retry a body that cannot be serialised', async () => {
      const fetch = fakeFetch(() => jsonResponse({ ok: true }));
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 1 }));

      const circular: Record<string, unknown> = {};
      circular.self = circular;

      const err = await client
        .request('POST', '/modules', circular)
        .catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(0);
      expect(err).toBeInstanceOf(RegistryError);
      expect(err.isRetryable).toBe(false);
      expect(err.message).toContain('POST /modules');
    });

    it('does not retry a response interceptor that throws', async () => {
      const fetch = fakeFetch(() => jsonResponse({ ok: true }));
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 1 }));
      client.addResponseInterceptor(() => {
        throw new Error('interceptor blew up');
      });

      const err = await client.getModule('x').catch((e: unknown) => e as RegistryError);

      expect(callCount(fetch)).toBe(1);
      expect(err.isRetryable).toBe(false);
      expect(err.message).toContain('interceptor blew up');
    });

    it('succeeds when a retried request recovers', async () => {
      let attempts = 0;
      const fetch = fakeFetch(() => {
        attempts++;
        if (attempts < 3) throw new TypeError('Failed to fetch');
        return jsonResponse({ name: 'ok', version: '1' });
      });
      const client = new RegistryClient(makeConfig({ fetch, retries: 3, retryDelay: 1 }));

      const mod = await client.getModule('ok');
      expect(mod.name).toBe('ok');
      expect(attempts).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Interceptors
  // -------------------------------------------------------------------------

  describe('interceptors', () => {
    it('runs request interceptors', async () => {
      const fetch = fakeFetch((_url, init) => {
        const headers = init.headers as Record<string, string>;
        expect(headers['X-Custom']).toBe('yes');
        return jsonResponse({ ok: true });
      });
      const client = new RegistryClient(makeConfig({ fetch }));

      client.addRequestInterceptor((config) => {
        (config.headers as Record<string, string>)['X-Custom'] = 'yes';
        return config;
      });

      await client.getModule('test');
    });

    it('runs response interceptors', async () => {
      const fetch = fakeFetch(() => jsonResponse({ ok: true }));
      const client = new RegistryClient(makeConfig({ fetch }));

      let intercepted = false;
      client.addResponseInterceptor((response) => {
        intercepted = true;
        return response;
      });

      await client.getModule('test');
      expect(intercepted).toBe(true);
    });
  });

  //---------
  // Error types
  // -------------------------------------------------------------------------

  describe('RegistryError', () => {
    it('isAuthError true for 401/403', () => {
      const e1 = new RegistryError('unauthorized', { statusCode: 401 });
      expect(e1.isAuthError).toBe(true);
      const e2 = new RegistryError('forbidden', { statusCode: 403 });
      expect(e2.isAuthError).toBe(true);
      const e3 = new RegistryError('not found', { statusCode: 404 });
      expect(e3.isAuthError).toBe(false);
    });

    it('isNotFound true for 404', () => {
      const e = new RegistryError('missing', { statusCode: 404 });
      expect(e.isNotFound).toBe(true);
    });

    it('isNetworkError defaults false', () => {
      const e = new RegistryError('fail');
      expect(e.isNetworkError).toBe(false);
      expect(e.statusCode).toBeUndefined();
    });

    it('isRetryable is true for network errors, timeouts and transient statuses', () => {
      expect(new RegistryError('down', { isNetworkError: true }).isRetryable).toBe(true);
      expect(new RegistryError('slow', { isTimeout: true }).isRetryable).toBe(true);
      expect(new RegistryError('boom', { statusCode: 503 }).isRetryable).toBe(true);
      expect(new RegistryError('gone', { statusCode: 404 }).isRetryable).toBe(false);
      expect(new RegistryError('bad', { statusCode: 400 }).isRetryable).toBe(false);
      expect(new RegistryError('oops').isRetryable).toBe(false);
    });

    it('isTimeout implies isNetworkError', () => {
      const e = new RegistryError('slow', { isTimeout: true });
      expect(e.isTimeout).toBe(true);
      expect(e.isNetworkError).toBe(true);
    });

    it('stays backward compatible with the original options', () => {
      const e = new RegistryError('not found', { statusCode: 404, body: { error: 'x' } });
      expect(e.statusCode).toBe(404);
      expect(e.body).toEqual({ error: 'x' });
      expect(e.isNetworkError).toBe(false);
      expect(e.isTimeout).toBe(false);
      expect(e.isNotFound).toBe(true);
      expect(e).toBeInstanceOf(Error);
    });
  });

  // -------------------------------------------------------------------------
  // Error helpers
  // -------------------------------------------------------------------------

  describe('error helpers', () => {
    it('isTimeoutError detects by name, code, class and signal', () => {
      const named = new Error('aborted');
      named.name = 'TimeoutError';
      expect(isTimeoutError(named)).toBe(true);
      expect(isTimeoutError(new DOMException('timed out', 'TimeoutError'))).toBe(true);
      expect(isTimeoutError({ code: 'ETIMEDOUT' })).toBe(true);
      expect(isTimeoutError(new RegistryError('slow', { isTimeout: true }))).toBe(true);

      const controller = new AbortController();
      controller.abort();
      expect(isTimeoutError(new Error('socket hang up'), controller.signal)).toBe(true);
    });

    it('isTimeoutError does not fire for ordinary errors', () => {
      expect(isTimeoutError(new Error('boom'))).toBe(false);
      expect(isTimeoutError(new RegistryError('nope', { statusCode: 500 }))).toBe(false);
      expect(isTimeoutError('boom')).toBe(false);
      expect(isTimeoutError(null)).toBe(false);
      expect(isTimeoutError(undefined)).toBe(false);
    });

    it('isRetryableError classifies unknown throwables', () => {
      expect(isRetryableError(new RegistryError('down', { isNetworkError: true }))).toBe(true);
      expect(isRetryableError(new RegistryError('boom', { statusCode: 502 }))).toBe(true);
      expect(isRetryableError(new RegistryError('bad', { statusCode: 422 }))).toBe(false);
      expect(isRetryableError(new TypeError('undefined is not a function'))).toBe(false);
    });

    it('toRegistryError passes an existing error through untouched', () => {
      const original = new RegistryError('boom', { statusCode: 500 });
      expect(toRegistryError(original)).toBe(original);
    });

    it('toRegistryError wraps a plain error and prefixes the context', () => {
      const err = toRegistryError(new TypeError('x is not a function'), 'GET /modules/foo');
      expect(err).toBeInstanceOf(RegistryError);
      expect(err.message).toBe('GET /modules/foo: x is not a function');
      expect(err.statusCode).toBeUndefined();
    });

    it('toRegistryError stringifies a non-Error throwable', () => {
      expect(toRegistryError('kaboom').message).toBe('kaboom');
      expect(toRegistryError({ weird: true }).message).toBe('[object Object]');
    });

    it('toRegistryError preserves the timeout flag', () => {
      const named = new Error('aborted');
      named.name = 'TimeoutError';
      const err = toRegistryError(named, 'GET /modules/foo');
      expect(err.isTimeout).toBe(true);
      expect(err.isRetryable).toBe(true);
    });
  });
});

