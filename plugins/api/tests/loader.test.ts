import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/loader.js';

describe('Plugin Loader', () => {
  it('validateManifest should accept valid manifest', () => {
    const result = validateManifest({
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validateManifest should reject missing name', () => {
    const result = validateManifest({
      name: '',
      version: '1.0.0',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('validateManifest should reject invalid name format', () => {
    const result = validateManifest({
      name: '123-invalid',
      version: '1.0.0',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid plugin name'))).toBe(true);
  });

  it('validateManifest should reject invalid version', () => {
    const result = validateManifest({
      name: 'test',
      version: 'abc',
      description: 'test',
      author: 'tester',
      license: 'MIT',
      mamVersion: '0.1.0',
      keywords: [],
      main: 'index.js',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('validateManifest should reject missing fields', () => {
    const result = validateManifest({
      name: '',
      version: '',
      description: '',
      author: '',
      license: '',
      mamVersion: '',
      keywords: [],
      main: '',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
