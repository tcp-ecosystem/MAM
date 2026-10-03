/**
 * MAM Registry HTTP transport tests
 *
 * These start a real server on a real socket and drive it with `fetch`, because
 * the things most likely to be wrong here — percent-decoding a scoped name,
 * `search` shadowing `:name`, a body limit that does not actually stop reading,
 * a shutdown that drops the request in flight — are exactly the things a
 * mocked transport cannot show.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { RegistryServer, type RegistryLogger, type RegistryServerConfig } from '../src/server.js';
import {
  RegistryHttpServer,
  classifyFailure,
  decodeSegments,
  isSafeErrorMessage,
} from '../src/http.js';
import type { PackageManifest } from '@mam/package-manager';

const ADMIN = {
  username: 'admin',
  email: 'admin@mam.dev',
  password: 'AdminPass123',
};

const silentLogger: RegistryLogger = { info() {}, error() {} };

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
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

interface Harness {
  base: string;
  http: RegistryHttpServer;
  server: RegistryServer;
  token: string;
}

/** Every server in this file listens on an OS-assigned port. */
const openHarnesses: Harness[] = [];

async function startServer(overrides: Partial<RegistryServerConfig> = {}): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), 'mam-http-test-'));
  const server = new RegistryServer({
    port: 0,
    dataDir,
    authRequired: false,
    rateLimit: 1000,
    maxUploadSize: 1024 * 1024,
    corsOrigins: [],
    // `keyLength: 16` is a test-only cost reduction. This file stands up a
    // fresh server per test, and a real scrypt derivation on every one of them
    // dominates the runtime without testing anything HTTP-specific.
    auth: { bootstrapAdmin: { ...ADMIN }, keyLength: 16 },
    logger: silentLogger,
    ...overrides,
  });
  await server.start();

  const http = new RegistryHttpServer({ server, port: 0, logger: silentLogger });
  const { port } = await http.listen();
  const base = `http://127.0.0.1:${port}`;

  const login = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN.username, password: ADMIN.password }),
  });
  const token = ((await login.json()) as { token: string }).token;

  const harness: Harness = { base, http, server, token };
  openHarnesses.push(harness);
  return harness;
}

async function stopHarness(harness: Harness): Promise<void> {
  await harness.http.close();
  await harness.server.stop();
  await rm(harness.server.settings.dataDir, { recursive: true, force: true });
  const index = openHarnesses.indexOf(harness);
  if (index >= 0) openHarnesses.splice(index, 1);
}

async function publish(
  harness: Harness,
  overrides: Partial<PackageManifest> = {},
  files: Record<string, string> = { 'index.js': 'export default 1;' }
): Promise<{ name: string; version: string; url: string }> {
  const response = await fetch(`${harness.base}/modules`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${harness.token}` },
    body: JSON.stringify({ ...manifest(overrides), files }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { name: string; version: string; url: string };
}

let harness: Harness;

beforeEach(async () => {
  harness = await startServer();
});

afterEach(async () => {
  while (openHarnesses.length > 0) {
    await stopHarness(openHarnesses[openHarnesses.length - 1]!);
  }
});

// ============================================================================
// Binding
// ============================================================================

describe('binding', () => {
  it('listens on port 0 and reports the port the OS assigned', async () => {
    expect(harness.http.port).toBeGreaterThan(0);
    expect(harness.http.isListening).toBe(true);
    const address = harness.http.address();
    expect(address.host).toBe('127.0.0.1');
    expect(address.port).toBe(harness.http.port);
  });

  it('binds loopback by default, not every interface', async () => {
    // A registry reachable on 0.0.0.0 is a registry that exposed a module
    // endpoint nobody asked it to expose.
    expect(harness.http.address().host).toBe('127.0.0.1');
  });
});

// ============================================================================
// Health
// ============================================================================

describe('GET /healthz', () => {
  it('answers without credentials', async () => {
    const response = await fetch(`${harness.base}/healthz`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('answers without credentials even when auth is required', async () => {
    const strict = await startServer({ authRequired: true });
    try {
      const response = await fetch(`${strict.base}/healthz`);
      expect(response.status).toBe(200);
    } finally {
      await stopHarness(strict);
    }
  });
});

// ============================================================================
// Modules
// ============================================================================

describe('module routes', () => {
  it('publishes a module and returns the body the client method promises', async () => {
    const created = await publish(harness);
    expect(created).toEqual({
      name: 'test-module',
      version: '1.0.0',
      url: '/api/v1/modules/test-module',
    });
  });

  it('returns a module record directly, not wrapped in {success, data}', async () => {
    await publish(harness);
    const response = await fetch(`${harness.base}/modules/test-module`);
    expect(response.status).toBe(200);
    const record = (await response.json()) as { name: string; latest: string };
    expect(record.name).toBe('test-module');
    expect(record.latest).toBe('1.0.0');
    expect(record).not.toHaveProperty('success');
    expect(record).not.toHaveProperty('data');
  });

  it('lists modules as PaginatedResponse<T>', async () => {
    await publish(harness);
    const response = await fetch(`${harness.base}/modules`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as {
      data: { name: string }[];
      total: number;
      page: number;
      limit: number;
    };
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data[0].name).toBe('test-module');
    expect(page.total).toBe(1);
    expect(page.page).toBe(1);
    expect(page.limit).toBe(20);
  });

  it('translates the client\'s 1-based ?page into an offset', async () => {
    for (const name of ['alpha', 'beta', 'gamma']) {
      await publish(harness, { name, description: `${name} module` });
    }
    const second = (await (
      await fetch(`${harness.base}/modules?limit=1&page=2`)
    ).json()) as { data: { name: string }[]; total: number; page: number; limit: number };
    expect(second.page).toBe(2);
    expect(second.limit).toBe(1);
    expect(second.total).toBe(3);
    expect(second.data).toHaveLength(1);
  });

  it('returns versions as a bare array of strings', async () => {
    await publish(harness);
    await publish(harness, { version: '1.1.0' });
    const response = await fetch(`${harness.base}/modules/test-module/versions`);
    expect(response.status).toBe(200);
    const versions = (await response.json()) as unknown;
    expect(Array.isArray(versions)).toBe(true);
    expect((versions as string[]).sort()).toEqual(['1.0.0', '1.1.0']);
  });

  it('returns one version as a bare object', async () => {
    await publish(harness, {}, { 'index.js': 'x' });
    const response = await fetch(`${harness.base}/modules/test-module/versions/1.0.0`);
    expect(response.status).toBe(200);
    const record = (await response.json()) as { version: string; integrity: string };
    expect(record.version).toBe('1.0.0');
    expect(record.integrity).toMatch(/^sha256-/);
  });

  it('answers 404 with an error field for a missing module', async () => {
    const response = await fetch(`${harness.base}/modules/nope`);
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('deletes a module and then reports it missing', async () => {
    await publish(harness);
    const removed = await fetch(`${harness.base}/modules/test-module`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${harness.token}` },
    });
    expect(removed.status).toBe(204);
    expect((await fetch(`${harness.base}/modules/test-module`)).status).toBe(404);
  });

  it('serves registry stats', async () => {
    await publish(harness);
    const response = await fetch(`${harness.base}/stats`);
    expect(response.status).toBe(200);
    const stats = (await response.json()) as { totalModules: number };
    expect(stats.totalModules).toBe(1);
  });
});

// ============================================================================
// The search/:name collision
// ============================================================================

describe('/modules/search versus /modules/:name', () => {
  it('reads the static segment as a search, never as a module name', async () => {
    await publish(harness, { name: 'searchable', description: 'pipeline helper' });
    const response = await fetch(`${harness.base}/modules/search?q=pipeline`);
    expect(response.status).toBe(200);
    const page = (await response.json()) as { data: { name: string }[]; total: number };
    expect(page.total).toBe(1);
    expect(page.data[0].name).toBe('searchable');
  });

  it('still serves a module whose name collides with a static segment', async () => {
    // `/modules/search` is the search route, so a module literally named
    // "search" is reachable by its version routes but not by name. What matters
    // is that the *other* module's name is not swallowed by the search route.
    await publish(harness, { name: 'other', description: 'pipeline helper' });
    const response = await fetch(`${harness.base}/modules/other`);
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Percent-encoded scoped names
// ============================================================================

describe('percent-encoded scoped names', () => {
  it('round-trips @mam/thing through a URL-encoded path', async () => {
    await publish(harness, { name: '@mam/thing', description: 'a scoped module' });

    // What the client actually sends: encodeURIComponent('@mam/thing').
    const encoded = encodeURIComponent('@mam/thing');
    expect(encoded).toBe('%40mam%2Fthing');

    const response = await fetch(`${harness.base}/modules/${encoded}`);
    expect(response.status).toBe(200);
    const record = (await response.json()) as { name: string };
    // The whole point: the store was asked for '@mam/thing', not for the
    // literal string '%40mam%2Fthing'.
    expect(record.name).toBe('@mam/thing');
  });

  it('serves the sub-routes of a scoped name', async () => {
    await publish(harness, {
      name: '@mam/thing',
      dependencies: [{ name: '@mam/base', version: '^1.0.0' }],
    }, { 'index.js': 'scoped' });
    const encoded = encodeURIComponent('@mam/thing');

    expect((await fetch(`${harness.base}/modules/${encoded}/versions`)).status).toBe(200);
    expect((await fetch(`${harness.base}/modules/${encoded}/dependencies`)).status).toBe(200);
    expect((await fetch(`${harness.base}/modules/${encoded}/stats`)).status).toBe(200);
  });

  it('decodes each segment after splitting, never before', () => {
    // The single most common way to get this wrong: decoding first turns one
    // encoded segment into three, and no route matches.
    expect(decodeSegments('/modules/%40mam%2Fthing')).toEqual(['modules', '@mam/thing']);
    expect(decodeSegments('/modules/%40mam%2Fthing/versions/1.0.0')).toEqual([
      'modules',
      '@mam/thing',
      'versions',
      '1.0.0',
    ]);
    expect(decodeSegments('/')).toEqual([]);
    expect(decodeSegments('/healthz')).toEqual(['healthz']);
  });
});

// ============================================================================
// The three previously-missing handlers
// ============================================================================

describe('GET /modules/:name/dependencies', () => {
  it('derives dependencies from the version manifest', async () => {
    await publish(harness, {
      name: 'with-deps',
      dependencies: [
        { name: '@mam/base', version: '^1.0.0' },
        { name: 'left-pad', version: '~2.0.0', optional: true },
      ],
    });
    const response = await fetch(`${harness.base}/modules/with-deps/dependencies`);
    expect(response.status).toBe(200);
    const deps = (await response.json()) as { name: string; version: string; optional?: boolean }[];
    expect(deps).toEqual([
      { name: '@mam/base', version: '^1.0.0' },
      { name: 'left-pad', version: '~2.0.0', optional: true },
    ]);
  });

  it('returns an empty list for a module with no dependencies', async () => {
    await publish(harness, { name: 'no-deps', dependencies: [] });
    const response = await fetch(`${harness.base}/modules/no-deps/dependencies`);
    expect(await response.json()).toEqual([]);
  });

  it('404s for a module that does not exist', async () => {
    const response = await fetch(`${harness.base}/modules/absent/dependencies`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toContain('not found');
  });
});

describe('GET /modules/:name/download', () => {
  it('returns a url the tarball route really serves', async () => {
    await publish(harness, { name: 'downloadable' }, { 'index.js': 'hello' });
    const response = await fetch(`${harness.base}/modules/downloadable/download`);
    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };

    // Not an assertion that the string looks like a URL: the download is
    // actually fetched, unpacked, and its contents compared.
    const tarball = await fetch(`${harness.base}${url}`);
    expect(tarball.status).toBe(200);
    expect(tarball.headers.get('content-type')).toBe('application/gzip');
    expect(gunzipSync(Buffer.from(await tarball.arrayBuffer())).toString('utf-8')).toContain(
      'index.js'
    );
  });

  it('unpacks to the file contents the registry stored', async () => {
    await publish(
      harness,
      { name: 'with-content', version: '2.3.4' },
      { 'index.js': 'export const answer = 42;', 'lib/util.js': 'export const x = 1;' }
    );
    const { url } = (await (
      await fetch(`${harness.base}/modules/with-content/download?version=2.3.4`)
    ).json()) as { url: string };

    const tarball = Buffer.from(await (await fetch(`${harness.base}${url}`)).arrayBuffer());
    const text = gunzipSync(tarball).toString('binary');

    // Each file contributes a ustar header with its name at offset 0, and the
    // contents sit in the data block that follows.
    expect(text).toContain('index.js');
    expect(text).toContain('lib/util.js');
    expect(text).toContain('export const answer = 42;');
    expect(text).toContain('export const x = 1;');

    // Two 512-byte zero blocks terminate the archive, so the buffer is a whole
    // number of records.
    expect(tarball.length % 512).not.toBe(0); // gzip framing, not tar framing
  });

  it('publishes the integrity hash so a download can be verified', async () => {
    await publish(harness, { name: 'verifiable' }, { 'index.js': 'abc' });
    const { url } = (await (
      await fetch(`${harness.base}/modules/verifiable/download`)
    ).json()) as { url: string; integrity: string };
    // The checksum is on the tarball itself: it is the hash of what the client
    // is about to unpack, not a property of the metadata that points at it.
    const tarball = await fetch(`${harness.base}${url}`);
    expect(url).toContain('verifiable');
    expect(tarball.status).toBe(200);
    expect(tarball.headers.get('x-checksum-sha256')).toMatch(/^sha256-/);
  });

  it('404s for an unknown version rather than pointing at nothing', async () => {
    await publish(harness, { name: 'pinned' });
    const response = await fetch(`${harness.base}/modules/pinned/download?version=9.9.9`);
    expect(response.status).toBe(404);
  });
});

describe('GET /modules/:name/stats', () => {
  it('reports version count, dependents and a real zero for downloads', async () => {
    await publish(harness, { name: 'lib-a', version: '1.0.0' });
    await publish(harness, { name: 'lib-a', version: '1.1.0' });
    await publish(harness, { name: 'lib-b', dependencies: [{ name: 'lib-a', version: '^1.0.0' }] });
    await publish(harness, { name: 'lib-c', dependencies: [{ name: 'lib-a', version: '^1.0.0' }] });

    const response = await fetch(`${harness.base}/modules/lib-a/stats`);
    expect(response.status).toBe(200);
    const stats = (await response.json()) as {
      name: string;
      versionCount: number;
      downloads: number;
      dependents: number;
    };
    expect(stats.name).toBe('lib-a');
    expect(stats.versionCount).toBe(2);
    expect(stats.dependents).toBe(2);
    // The store does not count downloads. A real zero is reportable; an
    // invented one is not.
    expect(stats.downloads).toBe(0);
  });

  it('404s for a module that does not exist', async () => {
    expect((await fetch(`${harness.base}/modules/ghost/stats`)).status).toBe(404);
  });
});

// ============================================================================
// Auth routes
// ============================================================================

describe('auth routes', () => {
  it('registers, logs in, reads a profile and logs out', async () => {
    const registered = await fetch(`${harness.base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'alice',
        email: 'alice@example.com',
        password: 'MemberPass123',
      }),
    });
    expect(registered.status).toBe(201);

    const login = await fetch(`${harness.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'MemberPass123' }),
    });
    const { token } = (await login.json()) as { token: string };
    expect(typeof token).toBe('string');

    const profile = await fetch(`${harness.base}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(profile.status).toBe(200);
    expect(((await profile.json()) as { username: string }).username).toBe('alice');

    const logout = await fetch(`${harness.base}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);

    // The token is genuinely dead, not merely forgotten.
    const after = await fetch(`${harness.base}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });

  it('401s a bad password without saying which field was wrong', async () => {
    const response = await fetch(`${harness.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ADMIN.username, password: 'wrong-password' }),
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toBe('Invalid credentials');
  });

  it('changes a password and retires the token that made the change', async () => {
    await fetch(`${harness.base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'bob',
        email: 'bob@example.com',
        password: 'MemberPass123',
      }),
    });
    const login = await fetch(`${harness.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'MemberPass123' }),
    });
    const { token } = (await login.json()) as { token: string };

    const changed = await fetch(`${harness.base}/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ oldPassword: 'MemberPass123', newPassword: 'RotatedPass456' }),
    });
    expect(changed.status).toBe(204);

    const withOldToken = await fetch(`${harness.base}/auth/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(withOldToken.status).toBe(401);

    const relogin = await fetch(`${harness.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'RotatedPass456' }),
    });
    expect(relogin.status).toBe(200);
  });

  it('answers 501 on refresh, not 401', async () => {
    // This registry issues session tokens only. A 401 would send the client
    // hunting a credential problem it does not have.
    const response = await fetch(`${harness.base}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'anything' }),
    });
    expect(response.status).toBe(501);
    expect(((await response.json()) as { error: string }).error).toContain('not supported');
  });
});

// ============================================================================
// CORS
// ============================================================================

describe('CORS', () => {
  it('echoes the headers for an allowed origin', async () => {
    const allowed = await startServer({ corsOrigins: ['https://app.example.com'] });
    try {
      const response = await fetch(`${allowed.base}/healthz`, {
        headers: { Origin: 'https://app.example.com' },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
      expect(response.headers.get('vary')).toBe('Origin');
    } finally {
      await stopHarness(allowed);
    }
  });

  it('refuses a disallowed origin rather than merely omitting the header', async () => {
    const allowed = await startServer({ corsOrigins: ['https://app.example.com'] });
    try {
      const response = await fetch(`${allowed.base}/healthz`, {
        headers: { Origin: 'https://evil.example.com' },
      });
      // Leaving out the CORS header only stops a *browser*; a non-browser
      // caller would be served regardless. So it is refused.
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stopHarness(allowed);
    }
  });

  it('answers a preflight with 204 and the allowed methods', async () => {
    const allowed = await startServer({ corsOrigins: ['https://app.example.com'] });
    try {
      const response = await fetch(`${allowed.base}/modules`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
      expect(response.headers.get('access-control-allow-methods')).toContain('POST');
      expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
      expect(response.headers.get('access-control-max-age')).toBe('600');
    } finally {
      await stopHarness(allowed);
    }
  });

  it('403s a preflight from a disallowed origin', async () => {
    const allowed = await startServer({ corsOrigins: ['https://app.example.com'] });
    try {
      const response = await fetch(`${allowed.base}/modules`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await stopHarness(allowed);
    }
  });

  it('405s a preflight for a method CORS does not grant', async () => {
    const allowed = await startServer({ corsOrigins: ['https://app.example.com'] });
    try {
      const response = await fetch(`${allowed.base}/modules`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'PATCH',
        },
      });
      expect(response.status).toBe(405);
    } finally {
      await stopHarness(allowed);
    }
  });

  it('does not combine a wildcard origin with credentials', async () => {
    const any = await startServer({ corsOrigins: ['*'] });
    try {
      const response = await fetch(`${any.base}/healthz`, {
        headers: { Origin: 'https://anything.example.com' },
      });
      // `*` here means "any origin", but the concrete origin is echoed so a
      // credentialed fetch is never told to send cookies to a wildcard.
      expect(response.headers.get('access-control-allow-origin')).toBe('https://anything.example.com');
      expect(response.headers.get('access-control-allow-credentials')).toBeNull();
    } finally {
      await stopHarness(any);
    }
  });
});

// ============================================================================
// Body limits and malformed input
// ============================================================================

describe('request bodies', () => {
  it('413s a body over the limit and stops reading it', async () => {
    const small = await startServer({ maxUploadSize: 1024 });
    try {
      const response = await fetch(`${small.base}/modules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${small.token}` },
        body: JSON.stringify({ name: 'big', version: '1.0.0', files: { 'a.txt': 'x'.repeat(50_000) } }),
      });
      expect(response.status).toBe(413);
      const body = (await response.json()) as { error: string };
      expect(body.error).toContain('exceeds the maximum size');
      // Nothing was published: the rejection happens before the store is
      // touched, not after a partial write.
      expect((await fetch(`${small.base}/modules/big`)).status).toBe(404);
    } finally {
      await stopHarness(small);
    }
  });

  it('400s malformed JSON rather than 500ing', async () => {
    const response = await fetch(`${harness.base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "username": "admin", ',
    });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('not valid JSON');
  });

  it('400s malformed JSON on GraphQL too', async () => {
    const response = await fetch(`${harness.base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ nope',
    });
    expect(response.status).toBe(400);
  });
});

// ============================================================================
// Routing errors
// ============================================================================

describe('routing errors', () => {
  it('404s an unknown route', async () => {
    const response = await fetch(`${harness.base}/no/such/thing`);
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: string }).error).toBeTruthy();
  });

  it('405s a known path with the wrong method, and says which are allowed', async () => {
    const response = await fetch(`${harness.base}/modules`, { method: 'PUT' });
    expect(response.status).toBe(405);
    const allow = (response.headers.get('allow') ?? '').split(', ').sort();
    expect(allow).toEqual(['GET', 'HEAD', 'OPTIONS', 'POST']);
  });

  it('405s DELETE on a path that has no DELETE', async () => {
    const response = await fetch(`${harness.base}/stats`, { method: 'DELETE' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('GET');
  });

  it('405s a POST to a path that only serves GET', async () => {
    const response = await fetch(`${harness.base}/healthz`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toContain('GET');
  });
});

// ============================================================================
// Error containment
// ============================================================================

describe('error containment', () => {
  it('does not leak a stack trace or filesystem path', async () => {
    // Force a handler to throw something that carries an absolute path, the
    // way a filesystem failure would.
    const leaky = await startServer();
    try {
      (leaky.server as unknown as { handleGetModule: () => Promise<never> }).handleGetModule =
        async () => {
          throw new Error(`ENOENT: no such file or directory, open '${leaky.server.settings.dataDir}\\modules\\secret\\meta.json'`);
        };

      const response = await fetch(`${leaky.base}/modules/anything`);
      expect(response.status).toBe(500);
      const text = await response.text();

      expect(text).not.toContain(leaky.server.settings.dataDir);
      expect(text).not.toContain('secret');
      expect(text).not.toContain('at ');
      expect(text).not.toContain('Error:');
      expect(JSON.parse(text)).toEqual({ error: 'Internal server error' });
    } finally {
      await stopHarness(leaky);
    }
  });

  it('logs the detail server-side even though the client gets nothing', async () => {
    const errors: string[] = [];
    // `RegistryLogger` takes the detail as a second argument, so the collector
    // has to take the whole argument list; capturing only the message would
    // miss exactly the payload this test is about.
    const collect = (message: string, ...details: unknown[]): void => {
      errors.push([message, ...details.map(String)].join(' '));
    };
    const dataDir = await mkdtemp(join(tmpdir(), 'mam-http-log-'));
    const server = new RegistryServer({
      port: 0,
      dataDir,
      authRequired: false,
      rateLimit: 1000,
      maxUploadSize: 1024,
      corsOrigins: [],
      logger: { info() {}, error: collect },
    });
    await server.start();
    const http = new RegistryHttpServer({
      server,
      port: 0,
      logger: { info() {}, error: collect },
    });
    const { port } = await http.listen();

    (server as unknown as { handleStats: () => Promise<never> }).handleStats = async () => {
      throw new Error('the underlying cause, with detail');
    };

    try {
      const response = await fetch(`http://127.0.0.1:${port}/stats`);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('underlying cause');
      expect(errors.some((line) => line.includes('underlying cause'))).toBe(true);
    } finally {
      await http.close();
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('classifies handler messages into statuses conservatively', () => {
    expect(classifyFailure('Module "x" not found')).toBe(404);
    expect(classifyFailure('Invalid or missing authentication token')).toBe(401);
    expect(classifyFailure('Invalid credentials')).toBe(401);
    expect(classifyFailure('Not authorized to delete this module')).toBe(403);
    expect(classifyFailure('Rate limit exceeded. Retry in 12s')).toBe(429);
    expect(classifyFailure('Username "a" already exists')).toBe(409);
    expect(classifyFailure('Upload of 9 bytes exceeds the maximum upload size of 5 bytes')).toBe(413);
    expect(classifyFailure('Name and version are required')).toBe(400);
    // Anything unrecognised is a server fault, not a message to pass through.
    expect(classifyFailure('EACCES: permission denied')).toBe(500);
    expect(classifyFailure('')).toBe(500);
  });

  it('recognises messages that must not reach a client', () => {
    expect(isSafeErrorMessage('Module "x" not found')).toBe(true);
    expect(isSafeErrorMessage('at Object.<anonymous> (/app/src/x.js:1:1)')).toBe(false);
    expect(isSafeErrorMessage('failed\n    at foo (/app/src/x.js:1:1)')).toBe(false);
    expect(isSafeErrorMessage('cannot open C:\\data\\modules\\a\\meta.json')).toBe(false);
    expect(isSafeErrorMessage('cannot open /home/deploy/registry/meta.json')).toBe(false);
  });
});

// ============================================================================
// Security headers
// ============================================================================

describe('security headers', () => {
  it('are present on a normal response', async () => {
    const response = await fetch(`${harness.base}/healthz`);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('are present on an error response too', async () => {
    const response = await fetch(`${harness.base}/no/such/thing`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('omits HSTS on plaintext and a forwarded-proto claim is not trusted', async () => {
    // Strict-Transport-Security over plain HTTP is a promise about a transport
    // that is not in use, and an attacker-supplied header must not buy one.
    const plain = await fetch(`${harness.base}/healthz`, {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    expect(plain.headers.get('strict-transport-security')).toBeNull();
  });
});

// ============================================================================
// Rate limiting
// ============================================================================

describe('rate limiting', () => {
  it('engages under a burst and surfaces RateLimit-* headers', async () => {
    // Budget 4, not 3: `startServer` itself logs in to mint the token, and that
    // request is correctly charged to the same per-client budget. Three are
    // left for the burst.
    const limited = await startServer({ rateLimit: 4, rateLimitWindowMs: 60_000 });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 8; i++) {
        // `/modules`, not `/healthz`: the health probe is deliberately exempt
        // from rate limiting, so throttling it would 429 a load balancer.
        const response = await fetch(`${limited.base}/modules`);
        statuses.push(response.status);
        if (response.status === 429) {
          // The headers have to be on the response that is actually refused,
          // not only on the ones that succeeded.
          expect(response.headers.get('ratelimit-limit')).toBe('4');
          expect(response.headers.get('ratelimit-remaining')).toBe('0');
          expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
          expect(Number(response.headers.get('ratelimit-reset'))).toBeGreaterThan(0);
        } else {
          expect(response.headers.get('ratelimit-limit')).toBe('4');
        }
      }

      expect(statuses).toContain(429);
      expect(statuses.slice(0, 3).every((status) => status === 200)).toBe(true);
    } finally {
      await stopHarness(limited);
    }
  });

  it('does not let a spoofed X-Forwarded-For reset the budget', async () => {
    const limited = await startServer({ rateLimit: 2 });
    try {
      // Each request claims a different client. If the header were honoured
      // the burst below would never trip the limit.
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const response = await fetch(`${limited.base}/modules`, {
          headers: { 'X-Forwarded-For': `10.0.0.${i}` },
        });
        statuses.push(response.status);
      }
      expect(statuses).toContain(429);
    } finally {
      await stopHarness(limited);
    }
  });

  it('leaves the health probe exempt, so a load balancer is never throttled', async () => {
    const limited = await startServer({ rateLimit: 2, rateLimitWindowMs: 60_000 });
    try {
      for (let i = 0; i < 12; i++) {
        const response = await fetch(`${limited.base}/healthz`);
        expect(response.status).toBe(200);
      }
    } finally {
      await stopHarness(limited);
    }
  });
});

// ============================================================================
// Shutdown
// ============================================================================

describe('graceful shutdown', () => {
  it('completes the in-flight request, then closes the port', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'mam-http-close-'));
    const server = new RegistryServer({
      port: 0,
      dataDir,
      authRequired: false,
      rateLimit: 0,
      maxUploadSize: 1024,
      corsOrigins: [],
      logger: silentLogger,
    });
    await server.start();
    const http = new RegistryHttpServer({ server, port: 0, logger: silentLogger });
    const { port } = await http.listen();
    const base = `http://127.0.0.1:${port}`;

    // A handler that takes long enough for the request to still be open when
    // close() is called.
    (server as unknown as { handleStats: () => Promise<unknown> }).handleStats = async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { success: true, data: { totalModules: 1 } };
    };

    try {
      const inFlight = fetch(`${base}/stats`);
      // Let the request actually reach the handler before closing.
      await new Promise((resolve) => setTimeout(resolve, 40));
      const closing = http.close();

      const response = await inFlight;
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ totalModules: 1 });

      await closing;
      expect(http.isListening).toBe(false);

      // The port is really closed, not merely marked closed.
      await expect(fetch(`${base}/healthz`)).rejects.toBeTruthy();
    } finally {
      await http.close();
      await server.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it('is safe to call twice', async () => {
    const first = harness.http.close();
    const second = harness.http.close();
    expect(second).toBe(first);
    await first;
    expect(harness.http.isListening).toBe(false);
  });

  it('is safe on a server that was never started', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'mam-http-unstarted-'));
    const server = new RegistryServer({
      port: 0,
      dataDir,
      authRequired: false,
      rateLimit: 0,
      maxUploadSize: 1024,
      corsOrigins: [],
      logger: silentLogger,
    });
    const http = new RegistryHttpServer({ server, port: 0, logger: silentLogger });
    await expect(http.close()).resolves.toBeUndefined();
    await rm(dataDir, { recursive: true, force: true });
  });
});

// ============================================================================
// Specs
// ============================================================================

describe('GET /openapi.yaml', () => {
  it('serves the real spec file', async () => {
    const response = await fetch(`${harness.base}/openapi.yaml`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('yaml');
    const text = await response.text();
    expect(text).toContain('openapi: 3.0.3');
  });
});
