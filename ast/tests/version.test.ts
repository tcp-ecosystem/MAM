import { describe, it, expect } from 'vitest';
import {
  MAM_VERSION,
  MAM_LEGACY_VERSION,
  MAM_MAJOR_VERSION,
  MAM_SCHEMA_VERSION,
  MAM_VERSION_RANGE,
  isLegacyMamVersion,
  isCurrentMamVersion,
  normalizeMamVersion,
} from '../src/constants/version.js';

describe('MAM version constants', () => {
  it('pins the current language version to 2.0.0', () => {
    expect(MAM_VERSION).toBe('2.0.0');
    expect(MAM_LEGACY_VERSION).toBe('1.0.0');
    expect(MAM_MAJOR_VERSION).toBe(2);
    expect(MAM_SCHEMA_VERSION).toBe('2');
    expect(MAM_VERSION_RANGE).toBe('>=2.0.0');
  });

  it('detects legacy v1 versions', () => {
    expect(isLegacyMamVersion('1.0.0')).toBe(true);
    expect(isLegacyMamVersion('1.4.2')).toBe(true);
    expect(isLegacyMamVersion('v1.9.9')).toBe(true);
    expect(isLegacyMamVersion('2.0.0')).toBe(false);
    expect(isLegacyMamVersion('3.1.0')).toBe(false);
    expect(isLegacyMamVersion(undefined)).toBe(false);
    expect(isLegacyMamVersion('not-a-version')).toBe(false);
  });

  it('detects current-major versions', () => {
    expect(isCurrentMamVersion('2.0.0')).toBe(true);
    expect(isCurrentMamVersion('v2.7.1')).toBe(true);
    expect(isCurrentMamVersion('1.0.0')).toBe(false);
    expect(isCurrentMamVersion('3.0.0')).toBe(false);
    expect(isCurrentMamVersion(null)).toBe(false);
  });

  it('normalises user supplied versions', () => {
    expect(normalizeMamVersion('v2.1.0')).toBe('2.1.0');
    expect(normalizeMamVersion('  2.0.0 ')).toBe('2.0.0');
    expect(normalizeMamVersion('')).toBe(MAM_VERSION);
    expect(normalizeMamVersion(undefined)).toBe(MAM_VERSION);
  });
});