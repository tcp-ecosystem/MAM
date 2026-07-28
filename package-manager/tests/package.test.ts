/**
 * MAMPackage Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { MAMPackage } from '../src/package.js';

describe('MAMPackage', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mam-package-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('should create package with default manifest', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      const manifest = await pkg.init('my-module');

      expect(manifest.name).toBe('my-module');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.description).toBe('my-module MAM module');
      expect(manifest.author).toBe('Unknown');
      expect(manifest.license).toBe('MIT');
      expect(manifest.tags).toEqual([]);
      expect(manifest.dependencies).toEqual([]);
      expect(manifest.main).toBe('index.mam.md');
    });

    it('should create package with custom options', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      const manifest = await pkg.init('my-module', {
        version: '2.0.0',
        description: 'Custom description',
        author: 'TestAuthor',
        license: 'Apache-2.0',
        tags: ['test', 'custom'],
      });

      expect(manifest.name).toBe('my-module');
      expect(manifest.version).toBe('2.0.0');
      expect(manifest.description).toBe('Custom description');
      expect(manifest.author).toBe('TestAuthor');
      expect(manifest.license).toBe('Apache-2.0');
      expect(manifest.tags).toEqual(['test', 'custom']);
    });

    it('should write mam-package.json to disk', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      const content = await readFile(join(tempDir, 'my-module', 'mam-package.json'), 'utf-8');
      const written = JSON.parse(content);
      expect(written.name).toBe('my-module');
    });

    it('should throw if directory already exists', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      const pkg2 = new MAMPackage({ dir: tempDir });
      await expect(pkg2.init('my-module')).rejects.toThrow('Directory "my-module" already exists');
    });
  });

  describe('addDependency', () => {
    it('should add a dependency', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');
      await pkg.addDependency('lodash', '^4.17.21');

      const manifest = pkg.getManifest();
      expect(manifest!.dependencies).toHaveLength(1);
      expect(manifest!.dependencies[0].name).toBe('lodash');
      expect(manifest!.dependencies[0].version).toBe('^4.17.21');
    });

    it('should update existing dependency', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');
      await pkg.addDependency('lodash', '^4.17.21');
      await pkg.addDependency('lodash', '^4.18.0');

      const manifest = pkg.getManifest();
      expect(manifest!.dependencies).toHaveLength(1);
      expect(manifest!.dependencies[0].version).toBe('^4.18.0');
    });

    it('should throw if no package loaded', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await expect(pkg.addDependency('lodash', '^4.17.21')).rejects.toThrow(
        'No package loaded'
      );
    });
  });

  describe('removeDependency', () => {
    it('should remove a dependency', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');
      await pkg.addDependency('lodash', '^4.17.21');
      await pkg.addDependency('react', '^18.2.0');
      await pkg.removeDependency('lodash');

      const manifest = pkg.getManifest();
      expect(manifest!.dependencies).toHaveLength(1);
      expect(manifest!.dependencies[0].name).toBe('react');
    });

    it('should throw if no package loaded', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await expect(pkg.removeDependency('lodash')).rejects.toThrow('No package loaded');
    });
  });

  describe('validate', () => {
    it('should catch invalid name format', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      // Tamper with name via load to bypass init validation
      const manifest = pkg.getManifest()!;
      manifest.name = 'Invalid_Name!';

      const result = pkg.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('name'))).toBe(true);
    });

    it('should catch invalid version format', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      const manifest = pkg.getManifest()!;
      manifest.version = 'not-a-version';

      const result = pkg.validate();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('version'))).toBe(true);
    });

    it('should pass for valid manifest', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      const result = pkg.validate();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return error if no package loaded', () => {
      const pkg = new MAMPackage({ dir: tempDir });
      const result = pkg.validate();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('No package loaded');
    });
  });

  describe('getManifest', () => {
    it('should return loaded manifest', async () => {
      const pkg = new MAMPackage({ dir: tempDir });
      await pkg.init('my-module');

      const manifest = pkg.getManifest();
      expect(manifest).not.toBeNull();
      expect(manifest!.name).toBe('my-module');
    });

    it('should return null if no package loaded', () => {
      const pkg = new MAMPackage({ dir: tempDir });
      expect(pkg.getManifest()).toBeNull();
    });
  });
});
