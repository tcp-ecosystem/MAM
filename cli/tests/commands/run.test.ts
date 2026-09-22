/**
 * CLI Run Command Tests — target runtime routing
 */

import { describe, it, expect } from 'vitest';
import { detectTargetRuntime } from '../../src/commands/run.js';

describe('Run Command — target runtime detection', () => {
  it('detects python target artifacts', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.py')).toBe('python');
  });

  it('detects javascript target artifacts', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.js')).toBe('javascript');
    expect(detectTargetRuntime('/tmp/hello.mam.mjs')).toBe('javascript');
    expect(detectTargetRuntime('/tmp/hello.mam.cjs')).toBe('javascript');
  });

  it('detects typescript, shell, go, rust targets', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.ts')).toBe('typescript');
    expect(detectTargetRuntime('/tmp/hello.mam.sh')).toBe('shell');
    expect(detectTargetRuntime('/tmp/hello.mam.go')).toBe('go');
    expect(detectTargetRuntime('/tmp/hello.mam.rs')).toBe('rust');
  });

  it('treats .mam and .mam.md as native (no target runtime)', () => {
    expect(detectTargetRuntime('/tmp/hello.mam')).toBeNull();
    expect(detectTargetRuntime('/tmp/hello.mam.md')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectTargetRuntime('/tmp/HELLO.MAM.PY')).toBe('python');
  });
});
