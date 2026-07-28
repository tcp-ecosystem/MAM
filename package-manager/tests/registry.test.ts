/**
 * PackageRegistry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PackageRegistry } from '../src/registry.js';
import { PackageManifest } from '../src/package.js';

describe('PackageRegistry', () => {
  let registry: PackageRegistry;

  const validManifest: PackageManifest = {
    name: 'test-module',
    version: '1.0.0',
    description: 'A test module',
    author: 'TestAuthor',
    license: 'MIT',
    tags: ['test'],
    dependencies: [],
    main: 'index.mam.md',
    files: ['*.mam.md'],
  };

  beforeEach(() => {
    registry = new PackageRegistry({ url: 'https://registry.mam.dev' });
  });

  describe('search', () => {
    it('should return empty results with empty cache', async () => {
      const result = await registry.search('test');

      expect(result.modules).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('getModule', () => {
    it('should return null for unknown module', async () => {
      const result = await registry.getModule('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('publish', () => {
    it('should succeed with valid manifest', async () => {
      const files = new Map<string, string>();
      files.set('index.mam.md', '# test module content');

      const result = await registry.publish(validManifest, files);

      expect(result.success).toBe(true);
      expect(result.version).toBe('1.0.0');
      expect(result.url).toBe('https://registry.mam.dev/test-module');
    });

    it('should fail with invalid manifest', async () => {
      const invalidManifest = { ...validManifest, name: '' };
      const files = new Map<string, string>();

      const result = await registry.publish(invalidManifest, files);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should fail with missing version', async () => {
      const invalidManifest = { ...validManifest, version: '' };
      const files = new Map<string, string>();

      const result = await registry.publish(invalidManifest, files);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('clearCache', () => {
    it('should empty the cache', async () => {
      const files = new Map<string, string>();
      await registry.publish(validManifest, files);

      let result = await registry.getModule('test-module');
      expect(result).not.toBeNull();

      registry.clearCache();

      result = await registry.getModule('test-module');
      expect(result).toBeNull();
    });
  });

  describe('exists', () => {
    it('should return false for unknown module', async () => {
      const result = await registry.exists('nonexistent');
      expect(result).toBe(false);
    });
  });
});
