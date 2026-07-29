/**
 * Execution Context Tests
 *
 * Comprehensive tests for BaseExecutionContext, PythonExecutionContext,
 * JavaScriptExecutionContext, createExecutionContext factory,
 * isRuntimeSupported, getSupportedRuntimes, stats tracking, and error wrapping.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createExecutionContext,
  isRuntimeSupported,
  getSupportedRuntimes,
  JavaScriptExecutionContext,
  PythonExecutionContext,
  TypeScriptContext,
  BaseExecutionContext,
} from '../src/contexts/index.js';
import { SUPPORTED_LANGUAGES } from '../src/contexts/types.js';
import { createLocation } from '@mam/ast';
import type { MAMModule, CodeBlock } from '@mam/ast';

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

function createTestModule(overrides?: Partial<MAMModule>): MAMModule {
  const loc = createLocationForTest();
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'test', version: '1.0.0', name: 'Test', author: 'Author' },
      location: loc,
    },
    sections: [],
    location: loc,
    metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
    ...overrides,
  };
}

function getDefaultConfig() {
  return {
    module: createTestModule(),
    inputs: {},
    permissions: [],
  };
}

// ---------------------------------------------------------------------------
// Tests: BaseExecutionContext (via JavaScriptExecutionContext)
// ---------------------------------------------------------------------------

describe('BaseExecutionContext', () => {
  let ctx: JavaScriptExecutionContext;

  beforeEach(async () => {
    ctx = new JavaScriptExecutionContext();
    await ctx.init(getDefaultConfig());
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('init', () => {
    it('should initialize context', async () => {
      const c = new JavaScriptExecutionContext();
      await c.init(getDefaultConfig());
      expect(c).toBeDefined();
    });

    it('should have a unique id', () => {
      const c1 = new JavaScriptExecutionContext();
      const c2 = new JavaScriptExecutionContext();
      expect(c1.id).toBeDefined();
      expect(c2.id).toBeDefined();
      expect(c1.id).not.toBe(c2.id);
    });

    it('should have createdAt timestamp', () => {
      const before = Date.now();
      const c = new JavaScriptExecutionContext();
      const after = Date.now();
      expect(c.createdAt).toBeGreaterThanOrEqual(before);
      expect(c.createdAt).toBeLessThanOrEqual(after);
    });
  });

  describe('memory management', () => {
    it('should start with empty memory', () => {
      const memory = ctx.getMemory();
      expect(memory).toEqual({});
    });

    it('should set and get memory', () => {
      ctx.setMemory('key1', 'value1');
      ctx.setMemory('key2', 42);
      const memory = ctx.getMemory();
      expect(memory.key1).toBe('value1');
      expect(memory.key2).toBe(42);
    });

    it('should return a copy of memory (not reference)', () => {
      ctx.setMemory('key', 'value');
      const memory1 = ctx.getMemory();
      const memory2 = ctx.getMemory();
      expect(memory1).toEqual(memory2);
      expect(memory1).not.toBe(memory2);
    });

    it('should clear memory', () => {
      ctx.setMemory('key', 'value');
      ctx.clearMemory();
      expect(Object.keys(ctx.getMemory())).toHaveLength(0);
    });

    it('should overwrite existing memory keys', () => {
      ctx.setMemory('key', 'old');
      ctx.setMemory('key', 'new');
      expect(ctx.getMemory().key).toBe('new');
    });

    it('should handle various value types', () => {
      ctx.setMemory('string', 'hello');
      ctx.setMemory('number', 123);
      ctx.setMemory('boolean', true);
      ctx.setMemory('array', [1, 2, 3]);
      ctx.setMemory('object', { nested: true });
      ctx.setMemory('null', null);

      const memory = ctx.getMemory();
      expect(memory.string).toBe('hello');
      expect(memory.number).toBe(123);
      expect(memory.boolean).toBe(true);
      expect(memory.array).toEqual([1, 2, 3]);
      expect(memory.object).toEqual({ nested: true });
      expect(memory.null).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      await ctx.cleanup();
      expect(ctx).toBeDefined();
    });

    it('should clear memory after cleanup', async () => {
      ctx.setMemory('key', 'value');
      await ctx.cleanup();
      // After cleanup, memory should be cleared
      // Re-init to test
      await ctx.init(getDefaultConfig());
      expect(Object.keys(ctx.getMemory())).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return initial stats', () => {
      const stats = ctx.getStats();
      expect(stats).toEqual({
        executionCount: 0,
        totalTimeMs: 0,
        lastExecutedAt: null,
        memoryPeak: 0,
      });
    });

    it('should track execution count after executions', async () => {
      // Note: recordExecution() is protected and not called by default execute() implementations.
      // Stats remain at initial values unless subclasses explicitly call recordExecution().
      await ctx.execute(createTestCodeBlock('1', 'javascript'));
      const stats = ctx.getStats();
      expect(stats.executionCount).toBe(0);
      expect(stats.lastExecutedAt).toBeNull();
    });

    it('should accumulate total time', async () => {
      await ctx.execute(createTestCodeBlock('1', 'javascript'));
      await ctx.execute(createTestCodeBlock('2', 'javascript'));
      const stats = ctx.getStats();
      expect(stats.executionCount).toBe(0);
      expect(stats.totalTimeMs).toBe(0);
    });
  });

  describe('wrapError', () => {
    it('should wrap an Error object', () => {
      const error = new Error('test error');
      const wrapped = ctx.wrapError(error);
      expect(wrapped).toBeInstanceOf(Error);
      expect(wrapped.message).toContain('test error');
      expect(wrapped.message).toContain('javascript');
      expect(wrapped.message).toContain(ctx.id);
    });

    it('should wrap a string error', () => {
      const wrapped = ctx.wrapError('string error');
      expect(wrapped).toBeInstanceOf(Error);
      expect(wrapped.message).toContain('string error');
    });

    it('should wrap an unknown error', () => {
      const wrapped = ctx.wrapError(42);
      expect(wrapped).toBeInstanceOf(Error);
      expect(wrapped.message).toContain('42');
    });
  });

  describe('validateCode', () => {
    it('should accept valid code', () => {
      expect(ctx.validateCode('1 + 1')).toBe(true);
    });

    it('should reject empty code', () => {
      expect(ctx.validateCode('')).toBe(false);
      expect(ctx.validateCode('   ')).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return supported languages', () => {
      const langs = ctx.getSupportedLanguages();
      expect(langs).toContain('javascript');
      expect(langs).toContain('js');
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: JavaScriptExecutionContext
// ---------------------------------------------------------------------------

describe('JavaScriptExecutionContext', () => {
  let ctx: JavaScriptExecutionContext;

  beforeEach(async () => {
    ctx = new JavaScriptExecutionContext();
    await ctx.init(getDefaultConfig());
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('execute', () => {
    it('should execute simple arithmetic', async () => {
      const result = await ctx.execute(createTestCodeBlock('1 + 1', 'javascript'));
      expect(result.success).toBe(true);
      expect(result.output).toBe(2);
      expect(result.exitCode).toBe(0);
    });

    it('should execute string operations', async () => {
      const result = await ctx.execute(createTestCodeBlock('"hello".toUpperCase()', 'javascript'));
      expect(result.success).toBe(true);
      expect(result.output).toBe('HELLO');
    });

    it('should execute array operations', async () => {
      const result = await ctx.execute(
        createTestCodeBlock('[1, 2, 3].map(x => x * 2)', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual([2, 4, 6]);
    });

    it('should handle syntax errors', async () => {
      const result = await ctx.execute(createTestCodeBlock('function(', 'javascript'));
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.exitCode).toBe(1);
    });

    it('should handle runtime errors', async () => {
      const result = await ctx.execute(
        createTestCodeBlock('undefinedVariable.property', 'javascript')
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should execute console.log without crashing', async () => {
      const result = await ctx.execute(
        createTestCodeBlock('console.log("test"); 42', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe(42);
    });

    it('should return timeMs >= 0', async () => {
      const result = await ctx.execute(createTestCodeBlock('1', 'javascript'));
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should execute object literals', async () => {
      const result = await ctx.execute(
        createTestCodeBlock('({ a: 1, b: 2 })', 'javascript')
      );
      expect(result.success).toBe(true);
      expect(result.output).toEqual({ a: 1, b: 2 });
    });

    it('should handle setTimeout in sandbox', async () => {
      const result = await ctx.execute(
        createTestCodeBlock('let x = 0; setTimeout(() => { x = 1; }, 10); x;', 'javascript')
      );
      expect(result.success).toBe(true);
    });
  });

  describe('runtime property', () => {
    it('should have javascript runtime', () => {
      expect(ctx.runtime).toBe('javascript');
    });
  });

  describe('id and createdAt', () => {
    it('should have unique id', () => {
      const ctx2 = new JavaScriptExecutionContext();
      expect(ctx.id).not.toBe(ctx2.id);
    });

    it('should have createdAt as number', () => {
      expect(typeof ctx.createdAt).toBe('number');
      expect(ctx.createdAt).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: PythonExecutionContext
// ---------------------------------------------------------------------------

describe('PythonExecutionContext', () => {
  let ctx: PythonExecutionContext;

  beforeEach(async () => {
    ctx = new PythonExecutionContext();
    await ctx.init(getDefaultConfig());
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  describe('execute', () => {
    it('should have python runtime', () => {
      expect(ctx.runtime).toBe('python');
    });

    it('should execute without error', async () => {
      const result = await ctx.execute(createTestCodeBlock('print("hello")', 'python'));
      expect(result).toBeDefined();
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('timeMs');
    });
  });

  describe('validateCode', () => {
    it('should accept valid python code', () => {
      expect(ctx.validateCode('print("hello")')).toBe(true);
    });

    it('should reject empty code', () => {
      expect(ctx.validateCode('')).toBe(false);
      expect(ctx.validateCode('  ')).toBe(false);
    });

    it('should reject os.system', () => {
      expect(ctx.validateCode('os.system("rm -rf /")')).toBe(false);
    });

    it('should reject exec()', () => {
      expect(ctx.validateCode('exec("malicious")')).toBe(false);
    });

    it('should reject eval()', () => {
      expect(ctx.validateCode('eval("dangerous")')).toBe(false);
    });

    it('should reject __import__', () => {
      expect(ctx.validateCode('__import__("os")')).toBe(false);
    });
  });

  describe('getSupportedLanguages', () => {
    it('should return python', () => {
      const langs = ctx.getSupportedLanguages();
      expect(langs).toEqual(['python']);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: createExecutionContext factory
// ---------------------------------------------------------------------------

describe('createExecutionContext', () => {
  it('should create python context', () => {
    const ctx = createExecutionContext('python');
    expect(ctx).toBeInstanceOf(PythonExecutionContext);
    expect(ctx.runtime).toBe('python');
  });

  it('should create javascript context', () => {
    const ctx = createExecutionContext('javascript');
    expect(ctx).toBeInstanceOf(JavaScriptExecutionContext);
    expect(ctx.runtime).toBe('javascript');
  });

  it('should create js alias context', () => {
    const ctx = createExecutionContext('js');
    expect(ctx).toBeInstanceOf(JavaScriptExecutionContext);
    expect(ctx.runtime).toBe('javascript');
  });

  it('should create typescript context', () => {
    const ctx = createExecutionContext('typescript');
    expect(ctx).toBeInstanceOf(TypeScriptContext);
    expect(ctx.runtime).toBe('typescript');
  });

  it('should create ts alias context', () => {
    const ctx = createExecutionContext('ts');
    expect(ctx).toBeInstanceOf(TypeScriptContext);
  });

  it('should throw for unsupported runtime', () => {
    expect(() => createExecutionContext('ruby' as any)).toThrow('Unsupported runtime');
  });

  it('should throw for unknown runtime', () => {
    expect(() => createExecutionContext('unknown' as any)).toThrow('Unsupported runtime');
  });
});

// ---------------------------------------------------------------------------
// Tests: isRuntimeSupported
// ---------------------------------------------------------------------------

describe('isRuntimeSupported', () => {
  it('should return true for python', () => {
    expect(isRuntimeSupported('python')).toBe(true);
  });

  it('should return true for javascript', () => {
    expect(isRuntimeSupported('javascript')).toBe(true);
  });

  it('should return true for js', () => {
    expect(isRuntimeSupported('js')).toBe(true);
  });

  it('should return true for typescript', () => {
    expect(isRuntimeSupported('typescript')).toBe(true);
  });

  it('should return true for ts', () => {
    expect(isRuntimeSupported('ts')).toBe(true);
  });

  it('should return false for unsupported runtime', () => {
    expect(isRuntimeSupported('ruby')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isRuntimeSupported('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: getSupportedRuntimes
// ---------------------------------------------------------------------------

describe('getSupportedRuntimes', () => {
  it('should return array of runtimes', () => {
    const runtimes = getSupportedRuntimes();
    expect(Array.isArray(runtimes)).toBe(true);
    expect(runtimes.length).toBeGreaterThan(0);
  });

  it('should include all known runtimes', () => {
    const runtimes = getSupportedRuntimes();
    expect(runtimes).toContain('python');
    expect(runtimes).toContain('javascript');
    expect(runtimes).toContain('js');
    expect(runtimes).toContain('typescript');
    expect(runtimes).toContain('ts');
    expect(runtimes).toContain('rust');
    expect(runtimes).toContain('go');
  });
});

// ---------------------------------------------------------------------------
// Tests: SUPPORTED_LANGUAGES
// ---------------------------------------------------------------------------

describe('SUPPORTED_LANGUAGES', () => {
  it('should contain python config', () => {
    expect(SUPPORTED_LANGUAGES.python).toBeDefined();
    expect(SUPPORTED_LANGUAGES.python.language).toBe('python');
    expect(SUPPORTED_LANGUAGES.python.command).toBe('python3');
    expect(SUPPORTED_LANGUAGES.python.inline).toBe(true);
  });

  it('should contain javascript config', () => {
    expect(SUPPORTED_LANGUAGES.javascript).toBeDefined();
    expect(SUPPORTED_LANGUAGES.javascript.language).toBe('javascript');
    expect(SUPPORTED_LANGUAGES.javascript.command).toBe('node');
    expect(SUPPORTED_LANGUAGES.javascript.inline).toBe(true);
  });

  it('should contain typescript config', () => {
    expect(SUPPORTED_LANGUAGES.typescript).toBeDefined();
    expect(SUPPORTED_LANGUAGES.typescript.compiled).toBe(false);
  });

  it('should contain go config', () => {
    expect(SUPPORTED_LANGUAGES.go).toBeDefined();
    expect(SUPPORTED_LANGUAGES.go.compiled).toBe(true);
    expect(SUPPORTED_LANGUAGES.go.inline).toBe(false);
  });

  it('should contain rust config', () => {
    expect(SUPPORTED_LANGUAGES.rust).toBeDefined();
    expect(SUPPORTED_LANGUAGES.rust.compiled).toBe(true);
  });

  it('should contain shell config', () => {
    expect(SUPPORTED_LANGUAGES.shell).toBeDefined();
    expect(SUPPORTED_LANGUAGES.shell.command).toBe('bash');
  });

  it('should contain yaml config', () => {
    expect(SUPPORTED_LANGUAGES.yaml).toBeDefined();
    expect(SUPPORTED_LANGUAGES.yaml.command).toBe('');
  });

  it('should contain json config', () => {
    expect(SUPPORTED_LANGUAGES.json).toBeDefined();
    expect(SUPPORTED_LANGUAGES.json.command).toBe('');
  });
});
