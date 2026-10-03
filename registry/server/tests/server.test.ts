import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryServer } from '../src/server.js';
import type { RegistryServerConfig, RegistryLogger } from '../src/server.js';
import type { PackageManifest } from '@mam/package-manager';

const ADMIN = {
  username: 'admin',
  email: 'admin@mam.dev',
  password: 'AdminPass123',
};

const silentLogger: RegistryLogger = { info() {}, error() {} };

function makeManifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: 'test-module',
    version: '1.0.0',
    description: 'A test module',
    author: 'tester',
    license: 'MIT',
    tags: ['test'],
    dependencies: [],
    main: 'index.js',
    files: [],
    ...overrides,
  };
}

describe('RegistryServer', () => {
  let tmpDir: string;
  let server: RegistryServer;

  function makeServer(overrides: Partial<RegistryServerConfig> = {}): RegistryServer {
    return new RegistryServer({
      port: 0,
      dataDir: tmpDir,
      authRequired: true,
      rateLimit: 1000,
      maxUploadSize: 1024 * 1024,
      corsOrigins: [],
      auth: { bootstrapAdmin: { ...ADMIN } },
      logger: silentLogger,
      ...overrides,
    });
  }

  /**
   * `clientId` keeps the setup calls out of the caller's own rate limit
   * budget, so a test about limiting is not throttled while it sets up.
   */
  async function login(
    target: RegistryServer,
    username: string = ADMIN.username,
    password: string = ADMIN.password,
    clientId?: string
  ): Promise<string> {
    const response = await target.handleLogin(username, password, clientId ? { clientId } : {});
    return (response.data as { token: string }).token;
  }

  async function registerAndLogin(
    target: RegistryServer,
    username: string,
    clientId?: string
  ): Promise<string> {
    const password = 'MemberPass123';
    const registered = await target.handleRegister(
      username,
      `${username}@example.com`,
      password,
      clientId ? { clientId: `${clientId}-register` } : {}
    );
    expect(registered.success).toBe(true);
    return login(target, username, password, clientId ? `${clientId}-login` : undefined);
  }

  async function publish(
    target: RegistryServer,
    manifest: PackageManifest,
    token: string,
    files: Map<string, string> = new Map([['index.js', 'export default 1;']])
  ) {
    return target.handlePublish(manifest as unknown as Record<string, unknown>, files, token);
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-server-test-'));
    server = makeServer();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('start()', () => {
    it('initializes the store without throwing', async () => {
      await expect(server.start()).resolves.toBeUndefined();
    });

    it('indexes modules that were already on disk', async () => {
      const writer = makeServer({ authRequired: false });
      await writer.start();
      await publish(writer, makeManifest(), await login(writer));

      // A fresh server over the same data directory has to rebuild its index
      // from disk, otherwise search is empty until something is republished.
      const restarted = makeServer({ authRequired: false });
      await restarted.start();
      expect(restarted.getSearchIndexSize()).toBe(1);

      const response = await restarted.handleSearch('test-module');
      expect(response.success).toBe(true);
      expect(response.meta!.total).toBe(1);
    });

    it('reports startup through the configured logger', async () => {
      const lines: string[] = [];
      const logging = makeServer({
        logger: { info: (message) => lines.push(message), error: () => {} },
      });

      await logging.start();

      expect(lines.some(line => line.includes('started'))).toBe(true);
    });
  });

  describe('stop()', () => {
    it('reports shutdown through the configured logger', async () => {
      const lines: string[] = [];
      const logging = makeServer({
        logger: { info: (message) => lines.push(message), error: () => {} },
      });

      await logging.start();
      await logging.stop();

      expect(lines.some(line => line.includes('stopped'))).toBe(true);
    });
  });

  describe('handleSearch()', () => {
    it('returns results (empty when nothing indexed)', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleSearch('anything', { token });
      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.meta).toBeDefined();
      expect(response.meta!.total).toBe(0);
    });

    it('returns a module that was published this session', async () => {
      await server.start();
      const token = await login(server);
      const published = await publish(server, makeManifest(), token);
      expect(published.success).toBe(true);

      const response = await server.handleSearch('test-module', { token });
      expect(response.success).toBe(true);
      expect(response.meta!.total).toBe(1);
      expect((response.data as { name: string }[])[0].name).toBe('test-module');
    });

    it('rejects an unauthenticated caller when authRequired is true', async () => {
      await server.start();
      const response = await server.handleSearch('anything');
      expect(response.success).toBe(false);
      expect(response.error).toContain('authentication token');
    });

    it('allows an unauthenticated caller when authRequired is false', async () => {
      const open = makeServer({ authRequired: false });
      await open.start();

      const response = await open.handleSearch('anything');
      expect(response.success).toBe(true);
    });

    it('rejects an invalid token', async () => {
      await server.start();
      const response = await server.handleSearch('anything', { token: 'not-a-token' });
      expect(response.success).toBe(false);
      expect(response.error).toContain('authentication token');
    });

    it('sorts by name when asked', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ name: 'zebra' }), token);
      await publish(server, makeManifest({ name: 'alpha' }), token);

      const response = await server.handleSearch('', { token, sort: 'name' });
      expect((response.data as { name: string }[]).map(m => m.name)).toEqual(['alpha', 'zebra']);
    });

    it('reports the limit it actually applied', async () => {
      await server.start();
      const token = await login(server);

      const clamped = await server.handleSearch('anything', { token, limit: 1_000_000 });
      expect(clamped.meta!.limit).toBe(100);

      const defaulted = await server.handleSearch('anything', { token, limit: 0 });
      expect(defaulted.meta!.limit).toBe(1);
    });

    it('does not use a negative offset', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ name: 'alpha' }), token);

      const response = await server.handleSearch('module', { token, offset: -5 });
      expect(response.meta!.offset).toBe(0);
      expect(response.meta!.total).toBe(1);
    });
  });

  describe('search index maintenance', () => {
    it('drops a deleted module from the index', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ author: ADMIN.username }), token);
      expect(server.getSearchIndexSize()).toBe(1);

      const deleted = await server.handleDeleteModule('test-module', token);
      expect(deleted.success).toBe(true);
      expect(server.getSearchIndexSize()).toBe(0);

      const response = await server.handleSearch('test-module', { token });
      expect(response.meta!.total).toBe(0);
    });

    it('reindexSearch() rebuilds the index from the store', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ name: 'indexed-a' }), token);
      await publish(server, makeManifest({ name: 'indexed-b' }), token);

      const count = await server.reindexSearch();
      expect(count).toBe(2);
      expect(server.getSearchIndexSize()).toBe(2);
    });
  });

  describe('handleListModules()', () => {
    it('hides archived modules unless asked for them', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ name: 'listed', author: ADMIN.username }), token);
      await server.handleArchive('listed', { token });

      const hidden = await server.handleListModules({ token });
      expect(hidden.data).toEqual([]);
      expect(hidden.meta!.total).toBe(0);

      const included = await server.handleListModules({ token, includeArchived: true });
      expect((included.data as { name: string }[]).map(m => m.name)).toEqual(['listed']);
    });

    it('filters by author and tag', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ name: 'tagged', author: ADMIN.username, tags: ['alpha'] }), token);

      const byAuthor = await server.handleListModules({ token, author: ADMIN.username });
      expect((byAuthor.data as { name: string }[]).map(m => m.name)).toEqual(['tagged']);

      const byTag = await server.handleListModules({ token, tags: ['missing'] });
      expect(byTag.data).toEqual([]);
    });
  });

  describe('handleGetModule()', () => {
    it('returns error for unknown module', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleGetModule('nonexistent', { token });
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('returns module after publishing', async () => {
      await server.start();
      const token = await login(server);

      const files = new Map([['index.js', 'export default 1;']]);
      const manifest = makeManifest();
      await publish(server, manifest, token, files);

      const response = await server.handleGetModule('test-module', { token });
      expect(response.success).toBe(true);
      expect((response.data as { name: string }).name).toBe('test-module');
    });
  });

  describe('handleGetVersions()', () => {
    it('fails with not found for a module that does not exist', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleGetVersions('nonexistent', { token });
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('lists the published versions of an existing module', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ version: '1.0.0' }), token);
      await publish(server, makeManifest({ version: '1.1.0' }), token);

      const response = await server.handleGetVersions('test-module', { token });
      expect(response.success).toBe(true);
      expect((response.data as string[]).sort()).toEqual(['1.0.0', '1.1.0']);
    });

    it('rejects an unauthenticated caller when authRequired is true', async () => {
      await server.start();
      const response = await server.handleGetVersions('test-module');
      expect(response.success).toBe(false);
      expect(response.error).toContain('authentication token');
    });
  });

  describe('handlePublish()', () => {
    it('succeeds with a valid token', async () => {
      await server.start();
      const token = await login(server);

      const files = new Map([['index.js', 'export default 1;']]);
      const manifest = makeManifest();
      const response = await publish(server, manifest, token, files);
      expect(response.success).toBe(true);
      expect((response.data as { name: string }).name).toBe('test-module');
      expect((response.data as { version: string }).version).toBe('1.0.0');
    });

    it('fails without a valid token', async () => {
      await server.start();
      const files = new Map([['index.js', 'code']]);
      const manifest = makeManifest();
      const response = await server.handlePublish(
        manifest as unknown as Record<string, unknown>,
        files,
        'invalid-token'
      );
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
    });

    it('still requires a token when authRequired is false', async () => {
      const open = makeServer({ authRequired: false });
      await open.start();

      const response = await open.handlePublish(
        makeManifest() as unknown as Record<string, unknown>,
        new Map([['index.js', 'code']]),
        'invalid-token'
      );
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid authentication token');
    });

    it('rejects a payload over maxUploadSize without writing anything', async () => {
      const small = makeServer({ maxUploadSize: 128 });
      await small.start();
      const token = await login(small);

      const files = new Map([['index.js', 'x'.repeat(4096)]]);
      const response = await publish(small, makeManifest(), token, files);
      expect(response.success).toBe(false);
      expect(response.error).toContain('maximum upload size');

      // Nothing was written, so the module does not exist at all.
      const lookup = await small.handleGetModule('test-module', { token });
      expect(lookup.success).toBe(false);
      expect(small.getSearchIndexSize()).toBe(0);
    });

    it('accepts a payload that sits exactly on the limit', async () => {
      const manifest = makeManifest();
      const files = new Map([['index.js', 'export default 1;']]);
      const exact = makeServer({ maxUploadSize: payloadSize(manifest, files) });
      await exact.start();
      const token = await login(exact);

      const response = await publish(exact, manifest, token, files);
      expect(response.success).toBe(true);
    });

    it('does not enforce a limit of zero', async () => {
      const unlimited = makeServer({ maxUploadSize: 0 });
      await unlimited.start();
      const token = await login(unlimited);

      const files = new Map([['index.js', 'x'.repeat(8192)]]);
      const response = await publish(unlimited, makeManifest(), token, files);
      expect(response.success).toBe(true);
    });

    it('reports the rejection through the logger', async () => {
      const errors: string[] = [];
      const logging = makeServer({
        maxUploadSize: 64,
        logger: { info: () => {}, error: (message) => errors.push(message) },
      });
      await logging.start();
      const token = await login(logging);

      await publish(logging, makeManifest(), token, new Map([['index.js', 'x'.repeat(1024)]]));
      expect(errors.some(line => line.includes('maximum')) || errors.length > 0).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('rejects requests over the limit with a clear error', async () => {
      const limited = makeServer({ rateLimit: 2 });
      await limited.start();
      const token = await login(limited);

      expect((await limited.handleSearch('a', { token })).success).toBe(true);
      expect((await limited.handleSearch('b', { token })).success).toBe(true);

      const blocked = await limited.handleSearch('c', { token });
      expect(blocked.success).toBe(false);
      expect(blocked.error).toContain('Rate limit');
    });

    it('counts each token separately', async () => {
      const limited = makeServer({ rateLimit: 1 });
      await limited.start();
      const adminToken = await login(limited, ADMIN.username, ADMIN.password, 'setup-admin');
      const memberToken = await registerAndLogin(limited, 'member', 'setup-member');

      // Each token has its own budget, so the member is unaffected by the
      // admin spending theirs.
      expect((await limited.handleSearch('a', { token: adminToken })).success).toBe(true);
      expect((await limited.handleSearch('a', { token: memberToken })).success).toBe(true);
      expect((await limited.handleSearch('a', { token: adminToken })).success).toBe(false);
    });

    it('counts each client id separately when there is no token', async () => {
      const limited = makeServer({ authRequired: false, rateLimit: 1 });
      await limited.start();

      expect((await limited.handleSearch('a', { clientId: 'ip-1' })).success).toBe(true);
      expect((await limited.handleSearch('a', { clientId: 'ip-2' })).success).toBe(true);
      expect((await limited.handleSearch('a', { clientId: 'ip-1' })).success).toBe(false);
    });

    it('starts a fresh window once the old one has passed', async () => {
      const limited = makeServer({ rateLimit: 1, rateLimitWindowMs: 10 });
      await limited.start();
      const token = await login(limited);

      expect((await limited.handleSearch('a', { token })).success).toBe(true);
      expect((await limited.handleSearch('a', { token })).success).toBe(false);

      await new Promise(resolve => setTimeout(resolve, 40));

      expect((await limited.handleSearch('a', { token })).success).toBe(true);
    });

    it('does not rate limit when the limit is zero', async () => {
      const unlimited = makeServer({ rateLimit: 0, authRequired: false });
      await unlimited.start();

      for (let i = 0; i < 25; i++) {
        expect((await unlimited.handleSearch('a', { clientId: 'ip' })).success).toBe(true);
      }
    });

    it('rate limits login attempts too', async () => {
      const limited = makeServer({ rateLimit: 2 });
      await limited.start();

      await limited.handleLogin(ADMIN.username, 'wrong-password');
      await limited.handleLogin(ADMIN.username, 'wrong-password');
      const blocked = await limited.handleLogin(ADMIN.username, ADMIN.password);
      expect(blocked.success).toBe(false);
      expect(blocked.error).toContain('Rate limit');
    });
  });

  describe('handleDeleteModule()', () => {
    it('lets the author delete their own module', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ author: ADMIN.username }), token);

      const response = await server.handleDeleteModule('test-module', token);
      expect(response.success).toBe(true);
    });

    it('rejects a user deleting somebody else\'s module', async () => {
      await server.start();
      const ownerToken = await registerAndLogin(server, 'owner');
      const otherToken = await registerAndLogin(server, 'other');
      await publish(server, makeManifest({ author: 'owner' }), ownerToken);

      const response = await server.handleDeleteModule('test-module', otherToken);
      expect(response.success).toBe(false);
      expect(response.error).toContain('Not authorized');
    });

    it('lets an admin-scoped token delete any module', async () => {
      await server.start();
      const ownerToken = await registerAndLogin(server, 'owner');
      const strangerToken = await registerAndLogin(server, 'stranger');
      const adminToken = await login(server);
      await publish(server, makeModuleNamed('owned-by-other', 'owner'), ownerToken);

      // A third party is still refused; only the admin scope gets through.
      const forbidden = await server.handleDeleteModule('owned-by-other', strangerToken);
      expect(forbidden.success).toBe(false);
      expect(forbidden.error).toContain('Not authorized');

      const allowed = await server.handleDeleteModule('owned-by-other', adminToken);
      expect(allowed.success).toBe(true);
    });

    it('does not let a non-admin token delete by admin role alone', async () => {
      await server.start();
      const ownerToken = await registerAndLogin(server, 'owner');
      const otherToken = await registerAndLogin(server, 'other');
      await publish(server, makeModuleNamed('owned-by-owner', 'owner'), ownerToken);

      const response = await server.handleDeleteModule('owned-by-owner', otherToken);
      expect(response.success).toBe(false);
    });

    it('returns not found for an unknown module', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleDeleteModule('nonexistent', token);
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('rejects an unauthenticated caller', async () => {
      await server.start();
      const response = await server.handleDeleteModule('test-module', 'invalid-token');
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
    });
  });

  describe('handleArchive()', () => {
    it('archives a module the caller owns and leaves it resolvable', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ author: ADMIN.username }), token);

      const response = await server.handleArchive('test-module', { token });
      expect(response.success).toBe(true);
      expect((response.data as { archived: boolean }).archived).toBe(true);

      const lookup = await server.handleGetModule('test-module', { token });
      expect((lookup.data as { archived: boolean }).archived).toBe(true);

      const version = await server.handleGetVersion('test-module', '1.0.0', { token });
      expect(version.success).toBe(true);
    });

    it('unarchives a module when asked', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ author: ADMIN.username }), token);
      await server.handleArchive('test-module', { token });

      const response = await server.handleArchive('test-module', { token, archived: false });
      expect(response.success).toBe(true);
      expect((response.data as { archived: boolean }).archived).toBe(false);
    });

    it('hides an archived module from search until it is opted back in', async () => {
      await server.start();
      const token = await login(server);
      await publish(server, makeManifest({ author: ADMIN.username }), token);
      await server.handleArchive('test-module', { token });

      const hidden = await server.handleSearch('test-module', { token });
      expect(hidden.meta!.total).toBe(0);

      const included = await server.handleSearch('test-module', { token, includeArchived: true });
      expect(included.meta!.total).toBe(1);

      await server.handleArchive('test-module', { token, archived: false });
      const restored = await server.handleSearch('test-module', { token });
      expect(restored.meta!.total).toBe(1);
    });

    it('rejects a user archiving somebody else\'s module', async () => {
      await server.start();
      const ownerToken = await registerAndLogin(server, 'owner');
      const otherToken = await registerAndLogin(server, 'other');
      await publish(server, makeManifest({ author: 'owner' }), ownerToken);

      const response = await server.handleArchive('test-module', { token: otherToken });
      expect(response.success).toBe(false);
      expect(response.error).toContain('Not authorized');
    });

    it('lets an admin-scoped token archive any module', async () => {
      await server.start();
      const ownerToken = await registerAndLogin(server, 'owner');
      const adminToken = await login(server);
      await publish(server, makeModuleNamed('owned-by-other', 'owner'), ownerToken);

      const response = await server.handleArchive('owned-by-other', { token: adminToken });
      expect(response.success).toBe(true);
      expect((response.data as { archived: boolean }).archived).toBe(true);
    });

    it('returns not found for an unknown module', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleArchive('nonexistent', { token });
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('rejects an unauthenticated caller when authRequired is true', async () => {
      await server.start();
      const response = await server.handleArchive('test-module');
      expect(response.success).toBe(false);
      expect(response.error).toContain('authentication token');
    });
  });

  describe('handleLogin()', () => {
    it('returns a token for valid credentials', async () => {
      await server.start();
      const response = await server.handleLogin(ADMIN.username, ADMIN.password);
      expect(response.success).toBe(true);
      expect((response.data as { token: string }).token).toBeTypeOf('string');
    });

    it('works while authRequired is true, since there is no token yet', async () => {
      await server.start();
      const response = await server.handleLogin(ADMIN.username, ADMIN.password);
      expect(response.success).toBe(true);
    });

    it('fails for invalid credentials', async () => {
      await server.start();
      const response = await server.handleLogin(ADMIN.username, 'wrongpassword');
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
    });
  });

  describe('handleRegister()', () => {
    it('creates a new user', async () => {
      await server.start();
      const response = await server.handleRegister('newuser', 'new@example.com', 'MemberPass123');
      expect(response.success).toBe(true);
      expect((response.data as { username: string }).username).toBe('newuser');
    });

    it('fails for duplicate username', async () => {
      await server.start();
      const response = await server.handleRegister(ADMIN.username, 'admin2@example.com', 'MemberPass123');
      expect(response.success).toBe(false);
      expect(response.error).toContain('already exists');
    });

    it('fails for a password that breaks the policy', async () => {
      await server.start();
      const response = await server.handleRegister('weakling', 'weak@example.com', 'short');
      expect(response.success).toBe(false);
      expect(response.error).toContain('characters');
    });
  });

  describe('handleStats()', () => {
    it('returns stats with correct structure', async () => {
      await server.start();
      const token = await login(server);
      const response = await server.handleStats({ token });
      expect(response.success).toBe(true);
      const stats = response.data as {
        totalModules: number;
        totalVersions: number;
        totalDownloads: number;
        lastUpdated: string;
      };
      expect(stats.totalModules).toBe(0);
      expect(stats.totalVersions).toBe(0);
      expect(stats.totalDownloads).toBe(0);
      expect(stats.lastUpdated).toBeDefined();
    });

    it('rejects an unauthenticated caller when authRequired is true', async () => {
      await server.start();
      const response = await server.handleStats();
      expect(response.success).toBe(false);
      expect(response.error).toContain('authentication token');
    });
  });

  describe('CORS', () => {
    it('allows only the configured origins', () => {
      const scoped = makeServer({ corsOrigins: ['https://mam.dev'] });
      expect(scoped.isOriginAllowed('https://mam.dev')).toBe(true);
      expect(scoped.isOriginAllowed('https://evil.example')).toBe(false);
      expect(scoped.isOriginAllowed(undefined)).toBe(false);
    });

    it('allows any origin when configured with a wildcard', () => {
      const wildcard = makeServer({ corsOrigins: ['*'] });
      expect(wildcard.isOriginAllowed('https://anything.example')).toBe(true);
    });

    it('allows nothing when no origin is configured', () => {
      expect(server.isOriginAllowed('https://mam.dev')).toBe(false);
    });

    it('returns headers for an allowed origin and nothing for a denied one', () => {
      const scoped = makeServer({ corsOrigins: ['https://mam.dev'] });

      const headers = scoped.getCorsHeaders('https://mam.dev');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://mam.dev');
      expect(headers['Access-Control-Allow-Headers']).toContain('Authorization');
      expect(headers['Access-Control-Allow-Methods']).toContain('POST');
      expect(headers['Vary']).toBe('Origin');

      expect(scoped.getCorsHeaders('https://evil.example')).toEqual({});
    });

    it('answers a preflight for an allowed origin and method', () => {
      const scoped = makeServer({ corsOrigins: ['https://mam.dev'] });

      const allowed = scoped.handlePreflight('https://mam.dev', 'PUT');
      expect(allowed.status).toBe(204);
      expect(allowed.headers['Access-Control-Allow-Origin']).toBe('https://mam.dev');
    });

    it('refuses a preflight from an origin that is not allowed', () => {
      const scoped = makeServer({ corsOrigins: ['https://mam.dev'] });
      const denied = scoped.handlePreflight('https://evil.example', 'PUT');
      expect(denied.status).toBe(403);
      expect(denied.headers).toEqual({});
    });

    it('refuses a preflight for a method that is not allowed', () => {
      const scoped = makeServer({ corsOrigins: ['https://mam.dev'] });
      expect(scoped.handlePreflight('https://mam.dev', 'TRACE').status).toBe(405);
    });
  });
});

function makeModuleNamed(name: string, author: string): PackageManifest {
  return makeManifest({ name, author });
}

function payloadSize(manifest: PackageManifest, files: Map<string, string>): number {
  let total = Buffer.byteLength(JSON.stringify(manifest), 'utf-8');
  for (const [path, content] of files) {
    total += Buffer.byteLength(path, 'utf-8') + Buffer.byteLength(content, 'utf-8');
  }
  return total;
}
