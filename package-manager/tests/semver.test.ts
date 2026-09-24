/**
 * Semver Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  parseVersion,
  compareVersions,
  isValidVersion,
  satisfiesRange,
  isVersionRange,
  coerceVersion,
  maxSatisfying,
} from '../src/semver.js';

describe('parseVersion', () => {
  it('should parse a full semver version', () => {
    expect(parseVersion('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('should accept an optional leading v', () => {
    expect(parseVersion('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });

  it('should parse prerelease and build metadata', () => {
    expect(parseVersion('1.2.3-alpha.1+build.5')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'alpha.1',
      build: 'build.5',
    });
  });

  it('should return null for partial versions', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('1')).toBeNull();
  });

  it('should return null for non-semver strings', () => {
    expect(parseVersion('not-a-version')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion('1.2.3.4')).toBeNull();
  });
});

describe('isValidVersion', () => {
  it('should accept valid versions', () => {
    expect(isValidVersion('1.2.3')).toBe(true);
    expect(isValidVersion('v2.0.0')).toBe(true);
    expect(isValidVersion('1.2.3-rc.1')).toBe(true);
  });

  it('should reject invalid values', () => {
    expect(isValidVersion('1.2')).toBe(false);
    expect(isValidVersion('')).toBe(false);
    expect(isValidVersion('abc')).toBe(false);
  });
});

describe('compareVersions', () => {
  it('should order versions by major, minor, then patch', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.1.0', '2.0.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.5.0')).toBeGreaterThan(0);
  });

  it('should treat equal versions as zero', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('should sort prereleases below their release', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta')).toBeGreaterThan(0);
  });

  it('should order prerelease identifiers (alphabetical and numeric)', () => {
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
    expect(compareVersions('1.0.0-2', '1.0.0-10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-2')).toBeGreaterThan(0);
  });

  it('should ignore build metadata for precedence', () => {
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0);
  });

  it('should sort invalid versions before valid ones', () => {
    expect(compareVersions('garbage', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', 'garbage')).toBe(1);
    expect(compareVersions('garbage', 'nope')).toBe(0);
  });
});

describe('satisfiesRange', () => {
  it('should match exact versions', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
  });

  it('should support caret ranges', () => {
    expect(satisfiesRange('1.2.3', '^1.2.3')).toBe(true);
    expect(satisfiesRange('1.9.9', '^1.2.3')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesRange('0.2.5', '^0.2.3')).toBe(true);
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfiesRange('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfiesRange('0.0.4', '^0.0.3')).toBe(false);
  });

  it('should support tilde ranges', () => {
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.0', '~1.2')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2')).toBe(false);
  });

  it('should support >= and <=', () => {
    expect(satisfiesRange('1.2.3', '>=1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.2', '>=1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.3', '<=1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '<=1.2.3')).toBe(false);
  });

  it('should support partial <= and > with npm floor/ceiling semantics', () => {
    expect(satisfiesRange('1.2.9', '<=1.2')).toBe(true);
    expect(satisfiesRange('1.3.0', '<=1.2')).toBe(false);
    expect(satisfiesRange('1.2.9', '>1.2')).toBe(false);
    expect(satisfiesRange('1.3.0', '>1.2')).toBe(true);
  });

  it('should support > and <', () => {
    expect(satisfiesRange('1.2.4', '>1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.3', '>1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.2', '<1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.3', '<1.2.3')).toBe(false);
  });

  it('should support x-ranges and bare partial versions', () => {
    expect(satisfiesRange('1.5.0', '1.x')).toBe(true);
    expect(satisfiesRange('2.0.0', '1.x')).toBe(false);
    expect(satisfiesRange('1.2.9', '1.2.x')).toBe(true);
    expect(satisfiesRange('1.3.0', '1.2.x')).toBe(false);
    expect(satisfiesRange('1.9.9', '1')).toBe(true);
    expect(satisfiesRange('2.0.0', '1')).toBe(false);
  });

  it('should treat wildcards and empty ranges as matching anything', () => {
    expect(satisfiesRange('3.0.0', '*')).toBe(true);
    expect(satisfiesRange('9.9.9', 'latest')).toBe(true);
    expect(satisfiesRange('1.2.3', '')).toBe(true);
  });

  it('should gate prerelease versions to ranges that include a prerelease', () => {
    expect(satisfiesRange('1.2.3-beta', '^1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.3-beta', '>=1.2.3')).toBe(false);
    expect(satisfiesRange('1.2.3-beta', '1.2.3-beta')).toBe(true);
    expect(satisfiesRange('1.2.3-beta', '>1.2.3-beta')).toBe(false);
    expect(satisfiesRange('1.2.3-beta', '*')).toBe(true);
  });

  it('should support OR groups', () => {
    expect(satisfiesRange('1.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfiesRange('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });

  it('should return false for invalid versions even against wildcards', () => {
    expect(satisfiesRange('abc', '^1.0.0')).toBe(false);
    expect(satisfiesRange('abc', '*')).toBe(false);
  });
});

describe('isVersionRange', () => {
  it('should detect range syntax', () => {
    expect(isVersionRange('1.2')).toBe(true);
    expect(isVersionRange('^1.2')).toBe(true);
    expect(isVersionRange('>=1.2.3')).toBe(true);
    expect(isVersionRange('*')).toBe(true);
  });

  it('should treat full versions and empty strings as non-ranges', () => {
    expect(isVersionRange('1.2.3')).toBe(false);
    expect(isVersionRange('')).toBe(false);
  });
});

describe('coerceVersion', () => {
  it('should fill in missing components with zero', () => {
    expect(coerceVersion('1.2')).toBe('1.2.0');
    expect(coerceVersion('1')).toBe('1.0.0');
  });

  it('should strip prefixes, extra segments, and whitespace', () => {
    expect(coerceVersion('v1.2.3.4')).toBe('1.2.3');
    expect(coerceVersion('=1.2.3')).toBe('1.2.3');
    expect(coerceVersion(' 1.2.3 ')).toBe('1.2.3');
  });

  it('should preserve prerelease metadata', () => {
    expect(coerceVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1');
  });

  it('should return null when no version can be found', () => {
    expect(coerceVersion('abc')).toBeNull();
    expect(coerceVersion('')).toBeNull();
  });
});

describe('maxSatisfying', () => {
  it('should return the highest version that satisfies the range', () => {
    expect(maxSatisfying(['1.0.0', '1.2.0', '2.0.0'], '^1.0.0')).toBe('1.2.0');
    expect(maxSatisfying(['1.0.0', '1.2.0', '2.0.0'], '*')).toBe('2.0.0');
  });

  it('should return undefined when nothing satisfies the range', () => {
    expect(maxSatisfying(['2.0.0'], '^1.0.0')).toBeUndefined();
    expect(maxSatisfying([], '^1.0.0')).toBeUndefined();
  });

  it('should apply prerelease gating when selecting', () => {
    expect(maxSatisfying(['1.2.3-beta', '1.2.3'], '>=1.0.0')).toBe('1.2.3');
  });
});