import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RegistryClient, type RegistryConfig, type SearchQuery } from '../src/client.js';
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

function makeConfig(overrides: Partial<RegistryConfig> = {}): RegistryConfig {
  return {
    baseUrl: 'https://registry.example.com',
    timeout: 5_000,
    retries: 0, // no retries in tests by default
    fetch: fakeFetch(() => jsonResponse({ ok: true })),
    ...overrides,
  };
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
        return jsonResponse(null, 204);
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
  });
});
