/**
 * LockFileManager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { LockFileManager } from '../src/lockfile.js';
import { ResolvedDependency } from '../src/resolver.js';

describe('LockFileManager', () => {
  let tempDir: string;
  let manager: LockFileManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mam-lockfile-test-'));
    manager = new LockFileManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('should create a lock file with correct structure', async () => {
      const lockFile = await manager.create('test-project');

      expect(lockFile.lockfileVersion).toBe(1);
      expect(lockFile.name).toBe('test-project');
      expect(lockFile.packages).toEqual({});
      expect(lockFile.metadata).toBeDefined();
      expect(lockFile.metadata.mamVersion).toBe('2.0.0');
      expect(lockFile.metadata.createdAt).toBeDefined();
      expect(lockFile.metadata.updatedAt).toBeDefined();
    });
  });

  describe('addPackage', () => {
    it('should add a package entry', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      const pkg = manager.getPackage('lodash');

      expect(pkg).not.toBeNull();
      expect(pkg!.version).toBe('4.17.21');
      expect(pkg!.resolved).toBe('https://registry.mam.dev/lodash/4.17.21');
      expect(pkg!.integrity).toBe('sha256-abc123');
    });

    it('should throw if no lock file loaded', () => {
      expect(() => manager.addPackage('lodash', {} as ResolvedDependency)).toThrow(
        'No lock file loaded'
      );
    });
  });

  describe('removePackage', () => {
    it('should remove a package', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      expect(manager.getPackage('lodash')).not.toBeNull();

      manager.removePackage('lodash');
      expect(manager.getPackage('lodash')).toBeNull();
    });

    it('should throw if no lock file loaded', () => {
      expect(() => manager.removePackage('lodash')).toThrow('No lock file loaded');
    });
  });

  describe('getPackage', () => {
    it('should return correct package', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'react',
        version: '18.2.0',
        url: 'https://registry.mam.dev/react/18.2.0',
        integrity: 'sha256-def456',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('react', resolved);
      const pkg = manager.getPackage('react');

      expect(pkg).not.toBeNull();
      expect(pkg!.version).toBe('18.2.0');
    });

    it('should return null for unknown package', async () => {
      await manager.create('test-project');
      expect(manager.getPackage('nonexistent')).toBeNull();
    });

    it('should return null if no lock file loaded', () => {
      expect(manager.getPackage('lodash')).toBeNull();
    });
  });

  describe('isLocked', () => {
    it('should return true when version matches', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      expect(manager.isLocked('lodash', '4.17.21')).toBe(true);
    });

    it('should return false when version does not match', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      expect(manager.isLocked('lodash', '4.18.0')).toBe(false);
    });

    it('should return false for unknown package', async () => {
      await manager.create('test-project');
      expect(manager.isLocked('lodash', '4.17.21')).toBe(false);
    });
  });

  describe('getAllPackages', () => {
    it('should return all packages', async () => {
      await manager.create('test-project');

      const lodash: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc',
        direct: true,
        dependencies: [],
      };

      const react: ResolvedDependency = {
        name: 'react',
        version: '18.2.0',
        url: 'https://registry.mam.dev/react/18.2.0',
        integrity: 'sha256-def',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', lodash);
      manager.addPackage('react', react);

      const all = manager.getAllPackages();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all.lodash).toBeDefined();
      expect(all.react).toBeDefined();
    });

    it('should return empty object if no lock file loaded', () => {
      expect(manager.getAllPackages()).toEqual({});
    });
  });

  describe('load and save', () => {
    it('should roundtrip load and save', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      await manager.save();

      const manager2 = new LockFileManager(tempDir);
      const loaded = await manager2.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('test-project');
      expect(loaded!.packages.lodash.version).toBe('4.17.21');
    });

    it('should return null when loading non-existent file', async () => {
      const result = await manager.load();
      expect(result).toBeNull();
    });
  });

  describe('clear', () => {
    it('should reset data', async () => {
      await manager.create('test-project');

      const resolved: ResolvedDependency = {
        name: 'lodash',
        version: '4.17.21',
        url: 'https://registry.mam.dev/lodash/4.17.21',
        integrity: 'sha256-abc123',
        direct: true,
        dependencies: [],
      };

      manager.addPackage('lodash', resolved);
      await manager.clear();

      expect(manager.getPackage('lodash')).toBeNull();
      expect(manager.getAllPackages()).toEqual({});
    });
  });
});
