import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RegistryServer } from '../src/server.js';
import type { PackageManifest } from '@mam/package-manager';

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

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'mam-server-test-'));
    server = new RegistryServer({
      port: 0,
      dataDir: tmpDir,
      authRequired: true,
      rateLimit: 100,
      maxUploadSize: 1024 * 1024,
      corsOrigins: [],
    });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe('start()', () => {
    it('initializes the store without throwing', async () => {
      await expect(server.start()).resolves.toBeUndefined();
    });
  });

  describe('handleSearch()', () => {
    it('returns results (empty when nothing indexed)', async () => {
      await server.start();
      const response = await server.handleSearch('anything');
      expect(response.success).toBe(true);
      expect(response.data).toEqual([]);
      expect(response.meta).toBeDefined();
      expect(response.meta!.total).toBe(0);
    });
  });

  describe('handleGetModule()', () => {
    it('returns error for unknown module', async () => {
      await server.start();
      const response = await server.handleGetModule('nonexistent');
      expect(response.success).toBe(false);
      expect(response.error).toContain('not found');
    });

    it('returns module after publishing', async () => {
      await server.start();
      const loginResponse = await server.handleLogin('admin', 'admin123');
      const token = (loginResponse.data as { token: string }).token;

      const files = new Map([['index.js', 'export default 1;']]);
      const manifest = makeManifest();
      await server.handlePublish(manifest as unknown as Record<string, unknown>, files, token);

      const response = await server.handleGetModule('test-module');
      expect(response.success).toBe(true);
      expect((response.data as { name: string }).name).toBe('test-module');
    });
  });

  describe('handlePublish()', () => {
    it('succeeds with a valid token', async () => {
      await server.start();
      const loginResponse = await server.handleLogin('admin', 'admin123');
      const token = (loginResponse.data as { token: string }).token;

      const files = new Map([['index.js', 'export default 1;']]);
      const manifest = makeManifest();
      const response = await server.handlePublish(
        manifest as unknown as Record<string, unknown>,
        files,
        token
      );
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
  });

  describe('handleLogin()', () => {
    it('returns a token for valid credentials', async () => {
      await server.start();
      const response = await server.handleLogin('admin', 'admin123');
      expect(response.success).toBe(true);
      expect((response.data as { token: string }).token).toBeTypeOf('string');
    });

    it('fails for invalid credentials', async () => {
      await server.start();
      const response = await server.handleLogin('admin', 'wrongpassword');
      expect(response.success).toBe(false);
      expect(response.error).toContain('Invalid');
    });
  });

  describe('handleRegister()', () => {
    it('creates a new user', async () => {
      await server.start();
      const response = await server.handleRegister('newuser', 'new@example.com', 'pass123');
      expect(response.success).toBe(true);
      expect((response.data as { username: string }).username).toBe('newuser');
    });

    it('fails for duplicate username', async () => {
      await server.start();
      const response = await server.handleRegister('admin', 'admin2@example.com', 'pass123');
      expect(response.success).toBe(false);
      expect(response.error).toContain('already exists');
    });
  });

  describe('handleStats()', () => {
    it('returns stats with correct structure', async () => {
      await server.start();
      const response = await server.handleStats();
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
  });
});
