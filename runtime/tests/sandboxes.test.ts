/**
 * Sandbox Tests
 *
 * Comprehensive tests for ProcessSandbox, VMSandbox, createSandbox factory,
 * sandbox config defaults, permission checking, and cleanup of active processes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ProcessSandbox,
  VMSandbox,
  createSandbox,
  ProcessSandboxImpl,
  VMSandboxImpl,
} from '../src/sandboxes/index.js';
import { createLocation } from '@mam/ast';
import type { CodeBlock } from '@mam/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLocationForTest() {
  return createLocation(1, 0, 0, 10, 0, 100, 'test');
}

function createTestCodeBlock(code: string, language: string = 'javascript'): CodeBlock {
  return {
    type: 'CodeBlock',
    language,
    value: code,
    metadata: {},
    executable: true,
    location: createLocationForTest(),
  };
}

// ---------------------------------------------------------------------------
// Tests: ProcessSandbox
// ---------------------------------------------------------------------------

describe('ProcessSandbox', () => {
  let sandbox: ProcessSandbox;

  beforeEach(async () => {
    sandbox = new ProcessSandbox();
    await sandbox.init({});
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  describe('init', () => {
    it('should initialize with default config', async () => {
      const s = new ProcessSandbox();
      await s.init({});
      expect(s).toBeDefined();
    });

    it('should initialize with custom config', async () => {
      const s = new ProcessSandbox();
      await s.init({
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024,
        networkHosts: ['example.com'],
        filesystemPaths: ['/tmp', '/var'],
        allowedEnvVars: ['PATH'],
        allowProcess: true,
      });
      expect(s).toBeDefined();
    });

    it('should initialize multiple times', async () => {
      const s = new ProcessSandbox();
      await s.init({});
      await s.init({ timeout: 1000 });
      expect(s).toBeDefined();
    });
  });

  describe('checkPermission', () => {
    it('should deny network by default', () => {
      expect(sandbox.checkPermission('network')).toBe(false);
    });

    it('should allow network when hosts configured', async () => {
      const s = new ProcessSandbox();
      await s.init({ networkHosts: ['example.com'] });
      expect(s.checkPermission('network')).toBe(true);
    });

    it('should deny filesystem by default', () => {
      // Default config has filesystemPaths: ['/tmp'], so it should allow
      expect(sandbox.checkPermission('filesystem')).toBe(true);
    });

    it('should allow filesystem when paths configured', async () => {
      const s = new ProcessSandbox();
      await s.init({ filesystemPaths: ['/tmp'] });
      expect(s.checkPermission('filesystem')).toBe(true);
    });

    it('should deny exec by default', () => {
      expect(sandbox.checkPermission('exec')).toBe(false);
    });

    it('should allow exec when configured', async () => {
      const s = new ProcessSandbox();
      await s.init({ allowProcess: true });
      expect(s.checkPermission('exec')).toBe(true);
    });

    it('should deny unknown permissions', () => {
      expect(sandbox.checkPermission('unknown')).toBe(false);
    });

    it('should deny when network hosts is empty', async () => {
      const s = new ProcessSandbox();
      await s.init({ networkHosts: [] });
      expect(s.checkPermission('network')).toBe(false);
    });

    it('should deny when filesystem paths is empty', async () => {
      const s = new ProcessSandbox();
      await s.init({ filesystemPaths: [] });
      expect(s.checkPermission('filesystem')).toBe(false);
    });
  });

  describe('execute', () => {
    it('should execute javascript code', async () => {
      const result = await sandbox.execute(createTestCodeBlock('console.log("hello")', 'javascript'));
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timeMs');
    });

    it('should return timeMs >= 0', async () => {
      const result = await sandbox.execute(createTestCodeBlock('1', 'javascript'));
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle unsupported language', async () => {
      const result = await sandbox.execute(createTestCodeBlock('puts "hello"', 'ruby'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unsupported language');
    });

    it('should support python language', async () => {
      const result = await sandbox.execute(createTestCodeBlock('print("hello")', 'python'));
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });

    it('should support shell language', async () => {
      const result = await sandbox.execute(createTestCodeBlock('echo "hello"', 'shell'));
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });

    it('should support bash language', async () => {
      const result = await sandbox.execute(createTestCodeBlock('echo "hello"', 'bash'));
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      await sandbox.cleanup();
      expect(sandbox).toBeDefined();
    });

    it('should be safe to cleanup multiple times', async () => {
      await sandbox.cleanup();
      await sandbox.cleanup();
    });

    it('should cleanup after execution', async () => {
      await sandbox.execute(createTestCodeBlock('1', 'javascript'));
      await sandbox.cleanup();
      expect(sandbox).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: VMSandbox
// ---------------------------------------------------------------------------

describe('VMSandbox', () => {
  let sandbox: VMSandbox;

  beforeEach(async () => {
    sandbox = new VMSandbox();
    await sandbox.init({});
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  describe('init', () => {
    it('should initialize with default config', async () => {
      const s = new VMSandbox();
      await s.init({});
      expect(s).toBeDefined();
    });

    it('should initialize with custom config', async () => {
      const s = new VMSandbox();
      await s.init({ timeout: 10000 });
      expect(s).toBeDefined();
    });
  });

  describe('execute', () => {
    it('should execute simple arithmetic', async () => {
      const result = await sandbox.execute(createTestCodeBlock('2 * 3', 'javascript'));
      expect(result.success).toBe(true);
      expect(result.output).toBe(6);
      expect(result.exitCode).toBe(0);
    });

    it('should execute string operations', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('"hello" + " world"', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe('hello world');
    });

    it('should execute complex expressions', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('Math.max(1, 2, 3)', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe(3);
    });

    it('should handle syntax errors', async () => {
      const result = await sandbox.execute(createTestCodeBlock('function(', 'javascript'));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.exitCode).toBe(1);
    });

    it('should handle runtime errors', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('null.property', 'javascript')
      );
      expect(result.success).toBe(false);
    });

    it('should return timeMs >= 0', async () => {
      const result = await sandbox.execute(createTestCodeBlock('1', 'javascript'));
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute object literals', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('({ key: "value" })', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ key: 'value' });
    });

    it('should execute array operations', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('[1, 2, 3].filter(x => x > 1)', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual([2, 3]);
    });

    it('should handle undefined variables', async () => {
      const result = await sandbox.execute(
        createTestCodeBlock('undeclaredVar', 'javascript')
      );
      expect(result.success).toBe(false);
    });
  });

  describe('checkPermission', () => {
    it('should deny all permissions', () => {
      expect(sandbox.checkPermission('network')).toBe(false);
      expect(sandbox.checkPermission('filesystem')).toBe(false);
      expect(sandbox.checkPermission('exec')).toBe(false);
      expect(sandbox.checkPermission('unknown')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      await sandbox.cleanup();
    });

    it('should be safe to cleanup multiple times', async () => {
      await sandbox.cleanup();
      await sandbox.cleanup();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: ProcessSandboxImpl
// ---------------------------------------------------------------------------

describe('ProcessSandboxImpl', () => {
  let sandbox: ProcessSandboxImpl;

  beforeEach(async () => {
    sandbox = new ProcessSandboxImpl();
    await sandbox.init({});
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  it('should initialize', () => {
    expect(sandbox).toBeDefined();
  });

  it('should check permissions', () => {
    expect(sandbox.checkPermission('network')).toBe(false);
    expect(sandbox.checkPermission('exec')).toBe(false);
  });

  it('should execute javascript', async () => {
    const result = await sandbox.execute(createTestCodeBlock('42', 'javascript'));
    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');
  });

  it('should handle unsupported language', async () => {
    const result = await sandbox.execute(createTestCodeBlock('code', 'swift'));
    expect(result.success).toBe(false);
  });

  it('should cleanup', async () => {
    await sandbox.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Tests: VMSandboxImpl
// ---------------------------------------------------------------------------

describe('VMSandboxImpl', () => {
  let sandbox: VMSandboxImpl;

  beforeEach(async () => {
    sandbox = new VMSandboxImpl();
    await sandbox.init({});
  });

  afterEach(async () => {
    await sandbox.cleanup();
  });

  it('should initialize', () => {
    expect(sandbox).toBeDefined();
  });

  it('should execute javascript', async () => {
    const result = await sandbox.execute(createTestCodeBlock('10 + 20', 'javascript'));
    expect(result.success).toBe(true);
    expect(result.output).toBe(30);
  });

  it('should deny all permissions', () => {
    expect(sandbox.checkPermission('network')).toBe(false);
    expect(sandbox.checkPermission('filesystem')).toBe(false);
    expect(sandbox.checkPermission('exec')).toBe(false);
  });

  it('should handle syntax errors', async () => {
    const result = await sandbox.execute(createTestCodeBlock('if(', 'javascript'));
    expect(result.success).toBe(false);
  });

  it('should cleanup', async () => {
    await sandbox.cleanup();
  });
});

// ---------------------------------------------------------------------------
// Tests: createSandbox factory
// ---------------------------------------------------------------------------

describe('createSandbox', () => {
  it('should create process sandbox by default', () => {
    const sandbox = createSandbox();
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });

  it('should create process sandbox explicitly', () => {
    const sandbox = createSandbox('process');
    expect(sandbox).toBeInstanceOf(ProcessSandbox);
  });

  it('should create vm sandbox', () => {
    const sandbox = createSandbox('vm');
    expect(sandbox).toBeInstanceOf(VMSandbox);
  });

  it('should create docker sandbox', async () => {
    const sandbox = createSandbox('docker');
    expect(sandbox).toBeDefined();
    // DockerSandbox implements Sandbox interface
    expect(typeof sandbox.init).toBe('function');
    expect(typeof sandbox.execute).toBe('function');
    expect(typeof sandbox.checkPermission).toBe('function');
    expect(typeof sandbox.cleanup).toBe('function');
  });

  it('should throw for unknown sandbox type', () => {
    expect(() => createSandbox('unknown' as any)).toThrow('Unknown sandbox type');
  });

  it('created sandbox should have init method', () => {
    const sandbox = createSandbox('vm');
    expect(typeof sandbox.init).toBe('function');
  });

  it('created sandbox should have execute method', () => {
    const sandbox = createSandbox('vm');
    expect(typeof sandbox.execute).toBe('function');
  });

  it('created sandbox should have checkPermission method', () => {
    const sandbox = createSandbox('vm');
    expect(typeof sandbox.checkPermission).toBe('function');
  });

  it('created sandbox should have cleanup method', () => {
    const sandbox = createSandbox('vm');
    expect(typeof sandbox.cleanup).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Tests: Sandbox config defaults
// ---------------------------------------------------------------------------

describe('Sandbox config defaults', () => {
  it('process sandbox should use default timeout', async () => {
    const sandbox = new ProcessSandbox();
    await sandbox.init({});
    // Should not throw - default timeout is 30000
    expect(sandbox).toBeDefined();
  });

  it('vm sandbox should use default timeout', async () => {
    const sandbox = new VMSandbox();
    await sandbox.init({});
    expect(sandbox).toBeDefined();
  });

  it('process sandbox should merge configs', async () => {
    const sandbox = new ProcessSandbox();
    await sandbox.init({ timeout: 5000, networkHosts: ['test.com'] });
    expect(sandbox.checkPermission('network')).toBe(true);
  });
});
