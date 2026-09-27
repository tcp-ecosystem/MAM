import { describe, it, expect } from 'vitest';
import {
  createLockfileEntry,
  parseLockfile,
  serializeLockfile,
  mergeLockfiles,
  verifyLockfile,
  sortLockfileEntries,
} from '../src/lockfile.js';

describe('createLockfileEntry', () => {
  it('should create minimal entries', () => {
    expect(createLockfileEntry('a', '1.0.0')).toEqual({ name: 'a', version: '1.0.0' });
  });

  it('should attach extras without sharing references', () => {
    const deps = { b: '^1.0.0' };
    const entry = createLockfileEntry('a', '1.0.0', { source: 'npm', dependencies: deps });
    expect(entry.source).toBe('npm');
    expect(entry.dependencies).toEqual({ b: '^1.0.0' });
    expect(entry.dependencies).not.toBe(deps);
  });
});

describe('parseLockfile', () => {
  it('should parse valid lockfiles', () => {
    const entries = parseLockfile(JSON.stringify([{ name: 'a', version: '1.0.0' }]));
    expect(entries).toEqual([{ name: 'a', version: '1.0.0' }]);
  });

  it('should reject invalid shapes', () => {
    expect(() => parseLockfile(JSON.stringify({}))).toThrow();
    expect(() => parseLockfile(JSON.stringify([{ name: 'a' }]))).toThrow();
    expect(() => parseLockfile('nope')).toThrow();
  });
});

describe('serializeLockfile', () => {
  it('should round-trip through parse', () => {
    const entries = [
      createLockfileEntry('b', '2.0.0'),
      createLockfileEntry('a', '1.0.0'),
    ];
    const text = serializeLockfile(entries);
    expect(text.endsWith('\n')).toBe(true);
    const parsed = parseLockfile(text);
    expect(parsed.map((entry) => entry.name)).toEqual(['a', 'b']);
  });
});

describe('mergeLockfiles', () => {
  it('should override and append by name', () => {
    const merged = mergeLockfiles(
      [createLockfileEntry('a', '1.0.0'), createLockfileEntry('b', '1.0.0')],
      [createLockfileEntry('b', '2.0.0'), createLockfileEntry('c', '1.0.0')],
    );
    expect(merged.map((entry) => `${entry.name}@${entry.version}`)).toEqual([
      'a@1.0.0',
      'b@2.0.0',
      'c@1.0.0',
    ]);
  });
});

describe('verifyLockfile', () => {
  it('should accept valid lockfiles', () => {
    expect(verifyLockfile([createLockfileEntry('a', '1.0.0')])).toEqual([]);
  });

  it('should report duplicates, bad versions, integrity, and cycles', () => {
    const errors = verifyLockfile([
      createLockfileEntry('a', 'bad'),
      createLockfileEntry('a', '1.0.0', { integrity: 'nope' }),
      createLockfileEntry('x', '1.0.0', { dependencies: { y: '^1.0.0' } }),
      createLockfileEntry('y', '1.0.0', { dependencies: { x: '^1.0.0' } }),
    ]);
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.join('\n')).toContain('cycle');
  });

  it('should require names and versions', () => {
    const errors = verifyLockfile([{ name: '', version: '' }]);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('sortLockfileEntries', () => {
  it('should sort by name without mutating', () => {
    const entries = [createLockfileEntry('b', '1.0.0'), createLockfileEntry('a', '1.0.0')];
    const sorted = sortLockfileEntries(entries);
    expect(sorted.map((entry) => entry.name)).toEqual(['a', 'b']);
    expect(entries[0]!.name).toBe('b');
  });
});
