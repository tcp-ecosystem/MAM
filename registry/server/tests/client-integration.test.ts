/**
 * Real client against a real server.
 *
 * Everything else in this package tests the server against `fetch`. This file
 * tests the *pair*: the published `@mam/registry-client` drives a live
 * `RegistryHttpServer` over a socket, and every operation the client offers is
 * exercised end to end. If the wire format drifts - the server wraps what the
 * client reads raw, or paginates in a shape the client does not expect - this
 * is the file that goes red, because it is the only one that speaks both
 * sides of the contract.
 *
 * It imports the built client, not its source, so it also proves the packaged
 * artifact works, not just the code in the next directory.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { RegistryClient, RegistryAuth, RegistryError } from '@mam/registry-client';
import { RegistryServer, type RegistryLogger } from '../src/server.js';
import { RegistryHttpServer } from '../src/http.js';

const silentLogger: RegistryLogger = { info() {}, error() {} };
const ADMIN = { username: 'e2e-admin', email: 'e2e@example.test', password: 'E2e-admin-pass-1' };

let dataDir: string;
let server: RegistryServer;
let http: RegistryHttpServer;
let base: string;
let client: RegistryClient;
let auth: RegistryAuth;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mam-e2e-'));
  server = new RegistryServer({
    port: 0,
    dataDir,
    authRequired: false,
    rateLimit: 0,
    maxUploadSize: 4 * 1024 * 1024,
    corsOrigins: [],
    auth: { bootstrapAdmin: { ...ADMIN }, keyLength: 16 },
    logger: silentLogger,
  });
  await server.start();

  http = new RegistryHttpServer({ server, port: 0, logger: silentLogger });
  const { port } = await http.listen();
  base = `http://127.0.0.1:${port}`;

  auth = new RegistryAuth({ baseUrl: base, fetch });
  const { token } = await auth.login(ADMIN.username, ADMIN.password);
  expect(typeof token).toBe('string');

  // The token travels as a plain AuthConfig, not as the RegistryAuth instance:
  // RegistryClient builds its own auth state from the config, so handing it a
  // live instance would silently drop the session it just established.
  client = new RegistryClient({
    baseUrl: base,
    fetch,
    auth: { baseUrl: base, token },
    timeout: 15000,
    retries: 0,
  });
}, 60000);

afterAll(async () => {
  await http.close();
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
});

describe('publish and read back', () => {
  it('round-trips a module through every read operation', async () => {
    const published = await client.publishModule({
      name: 'e2e-widget',
      version: '1.2.3',
      description: 'An end-to-end widget',
      author: 'alice',
      tags: ['tools'],
      dependencies: [{ name: '@mam/base', version: '^1.0.0' }],
      files: { 'index.js': 'export const answer = 42;', 'lib/util.js': 'export const x = 1;' },
    });
    expect(published.name).toBe('e2e-widget');
    expect(published.version).toBe('1.2.3');

    const record = await client.getModule('e2e-widget');
    expect(record.name).toBe('e2e-widget');
    expect(record.description).toContain('end-to-end');

    expect(await client.getVersions('e2e-widget')).toEqual(['1.2.3']);

    const version = await client.getVersion('e2e-widget', '1.2.3');
    expect(version.version).toBe('1.2.3');
    expect(version.integrity).toMatch(/^sha256-/);
  });

  it('lists with the pagination shape the client declares', async () => {
    const page = await client.listModules({ limit: 10, page: 1 });
    expect(Array.isArray(page.data)).toBe(true);
    expect(page.data.some((m) => m.name === 'e2e-widget')).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(1);
    expect(page.limit).toBe(10);
  });

  it('searches and finds what it published', async () => {
    const results = await client.searchModules({ q: 'widget' });
    expect(results.data.some((m) => m.name === 'e2e-widget')).toBe(true);
  });

  it('reads dependencies from the manifest', async () => {
    const deps = await client.getModuleDependencies('e2e-widget');
    expect(deps).toEqual([{ name: '@mam/base', version: '^1.0.0' }]);
  });

  it('downloads a tarball that unpacks to the published files', async () => {
    const { url } = await client.downloadModule('e2e-widget', '1.2.3');
    const tarball = await fetch(`${base}${url}`);
    expect(tarball.status).toBe(200);
    const text = gunzipSync(Buffer.from(await tarball.arrayBuffer())).toString('utf-8');
    expect(text).toContain('index.js');
    expect(text).toContain('lib/util.js');
    expect(text).toContain('export const answer = 42;');
  });

  it('reports per-module stats', async () => {
    const stats = await client.getModuleStats('e2e-widget');
    expect(stats.name).toBe('e2e-widget');
    expect(stats.downloads).toBe(0);
  });
});

describe('scoped names over the wire', () => {
  it('round-trips @mam/thing through URL encoding', async () => {
    await client.publishModule({
      name: '@mam/thing',
      version: '0.1.0',
      description: 'scoped',
      author: 'bob',
      files: { 'index.js': 'scoped' },
    });
    expect((await client.getModule('@mam/thing')).name).toBe('@mam/thing');
    expect(await client.getVersions('@mam/thing')).toEqual(['0.1.0']);
  });
});

describe('errors the client must surface', () => {
  it('throws RegistryError with a 404 for a missing module', async () => {
    const error = await client.getModule('absent').then(
      () => null,
      (e: unknown) => e as RegistryError
    );
    expect(error).toBeInstanceOf(RegistryError);
    expect(error?.statusCode).toBe(404);
    expect(error?.message).toContain('absent');
  });

  it('throws on a missing version rather than returning null', async () => {
    await expect(client.getVersion('e2e-widget', '9.9.9')).rejects.toBeInstanceOf(RegistryError);
  });
});

describe('auth lifecycle', () => {
  it('reads its own profile and logs out', async () => {
    const profile = await auth.getProfile();
    expect(profile.username).toBe(ADMIN.username);
    await auth.logout();
    await expect(auth.getProfile()).rejects.toThrow();
    // Log back in and hand the fresh token to the client: logout revoked the
    // one it was built with, and a revoked token must stay revoked.
    const { token } = await auth.login(ADMIN.username, ADMIN.password);
    client.setAuthToken(token);
  });
});

describe('archive and delete', () => {
  it('archives, hides, unarchives and deletes', async () => {
    await client.publishModule({
      name: 'e2e-doomed',
      version: '1.0.0',
      description: 'temporary',
      author: 'alice',
      files: { 'index.js': 'x' },
    });

    // Archive and delete go through the client's auth session, proving the
    // token the server minted is accepted on write routes too.
    const archive = await fetch(`${base}/modules/e2e-doomed/archive`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${(await auth.login(ADMIN.username, ADMIN.password)).token}`,
      },
      body: JSON.stringify({ archived: true }),
    });
    expect(archive.status).toBe(200);

    await client.deleteModule('e2e-doomed');
    await expect(client.getModule('e2e-doomed')).rejects.toBeInstanceOf(RegistryError);
  });
});
