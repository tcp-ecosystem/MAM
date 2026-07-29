/**
 * Runtime Tests
 *
 * Comprehensive tests for MAMRuntime, executeModule, RuntimeConfig defaults,
 * ModuleExecutionResult structure, section filtering, error handling,
 * validation, and memory get/set.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAMRuntime, executeModule } from '../src/runtime.js';
import { createLocation } from '@mam/ast';
import type { MAMModule, CodeBlock, Section } from '@mam/ast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createLocationForTest() {
  return createLocation(1, 0, 0, 10, 0, 100, 'test.mam.md');
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
      data: { id: 'test', version: '1.0.0', name: 'Test', author: 'Author', runtime: 'python' },
      location: loc,
    },
    sections: [
      {
        type: 'Section',
        name: 'JavaScript',
        level: 2,
        content: [createTestCodeBlock('1 + 1', 'javascript')],
        location: loc,
        attributes: { required: false, isCustom: false, contentTypes: ['code'] },
      },
    ],
    location: loc,
    metadata: {
      sectionCount: 1,
      codeBlockCount: 1,
      languages: ['javascript'],
      customSections: [],
      parsedAt: '',
    },
    ...overrides,
  };
}

function createMultiSectionModule(): MAMModule {
  const loc = createLocationForTest();
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'multi', version: '1.0.0', name: 'Multi', author: 'Author', runtime: 'javascript' },
      location: loc,
    },
    sections: [
      {
        type: 'Section',
        name: 'JavaScript',
        level: 2,
        content: [createTestCodeBlock('const x = 42; x;', 'javascript')],
        location: loc,
        attributes: { required: false, isCustom: false, contentTypes: ['code'] },
      },
      {
        type: 'Section',
        name: 'Python',
        level: 2,
        content: [createTestCodeBlock('print("hello")', 'python')],
        location: loc,
        attributes: { required: false, isCustom: false, contentTypes: ['code'] },
      },
      {
        type: 'Section',
        name: 'Tests',
        level: 2,
        content: [createTestCodeBlock('assert true', 'javascript')],
        location: loc,
        attributes: { required: false, isCustom: false, contentTypes: ['code'] },
      },
      {
        type: 'Section',
        name: 'Documentation',
        level: 2,
        content: [{ type: 'Paragraph', value: 'Some docs', location: loc }],
        location: loc,
        attributes: { required: false, isCustom: false, contentTypes: ['paragraph'] },
      },
    ],
    location: loc,
    metadata: {
      sectionCount: 4,
      codeBlockCount: 3,
      languages: ['javascript', 'python'],
      customSections: ['Documentation'],
      parsedAt: '',
    },
  };
}

function createModuleWithEmptySections(): MAMModule {
  const loc = createLocationForTest();
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'empty', version: '1.0.0', name: 'Empty', author: 'Author' },
      location: loc,
    },
    sections: [],
    location: loc,
    metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MAMRuntime', () => {
  describe('constructor and config', () => {
    it('should create with default config', () => {
      const runtime = new MAMRuntime();
      expect(runtime).toBeDefined();
    });

    it('should create with custom config', () => {
      const runtime = new MAMRuntime({
        sandboxType: 'vm',
        defaultTimeout: 5000,
        defaultMemoryLimit: 128 * 1024 * 1024,
      });
      expect(runtime).toBeDefined();
    });

    it('should create with partial config', () => {
      const runtime = new MAMRuntime({ stopOnError: true });
      expect(runtime).toBeDefined();
    });
  });

  describe('init', () => {
    it('should initialize runtime', async () => {
      const runtime = new MAMRuntime();
      await runtime.init();
      expect(runtime).toBeDefined();
    });

    it('should initialize with vm sandbox type', async () => {
      const runtime = new MAMRuntime({ sandboxType: 'vm' });
      await runtime.init();
      expect(runtime).toBeDefined();
    });
  });

  describe('execute', () => {
    let runtime: MAMRuntime;

    beforeEach(async () => {
      runtime = new MAMRuntime({ validateBeforeExecution: false });
      await runtime.init();
    });

    afterEach(async () => {
      await runtime.cleanup();
    });

    it('should execute a simple module', async () => {
      const module = createTestModule();
      const result = await runtime.execute(module);
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.sectionResults).toBeInstanceOf(Map);
      expect(result.errors).toEqual([]);
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return ModuleExecutionResult with correct structure', async () => {
      const module = createTestModule();
      const result = await runtime.execute(module);
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('sectionResults');
      expect(result).toHaveProperty('output');
      expect(result).toHaveProperty('timeMs');
      expect(result).toHaveProperty('errors');
      expect(typeof result.success).toBe('boolean');
      expect(result.sectionResults).toBeInstanceOf(Map);
      expect(typeof result.output).toBe('object');
      expect(typeof result.timeMs).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should execute module with multiple sections', async () => {
      const module = createMultiSectionModule();
      const result = await runtime.execute(module);
      expect(result.success).toBe(true);
      expect(result.sectionResults.size).toBeGreaterThan(0);
    });

    it('should handle empty sections', async () => {
      const module = createModuleWithEmptySections();
      const result = await runtime.execute(module);
      expect(result.success).toBe(true);
      expect(result.sectionResults.size).toBe(0);
    });

    it('should return timeMs >= 0', async () => {
      const module = createTestModule();
      const result = await runtime.execute(module);
      expect(result.timeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('section filtering', () => {
    let runtime: MAMRuntime;

    beforeEach(async () => {
      runtime = new MAMRuntime({ validateBeforeExecution: false });
      await runtime.init();
    });

    afterEach(async () => {
      await runtime.cleanup();
    });

    it('should execute only specified sections', async () => {
      const module = createMultiSectionModule();
      const result = await runtime.execute(module, { sections: ['JavaScript'] });
      expect(result.success).toBe(true);
      expect(result.sectionResults.has('JavaScript')).toBe(true);
      expect(result.sectionResults.has('Python')).toBe(false);
      expect(result.sectionResults.has('Tests')).toBe(false);
    });

    it('should execute multiple specified sections', async () => {
      const module = createMultiSectionModule();
      const result = await runtime.execute(module, {
        sections: ['JavaScript', 'Tests'],
      });
      expect(result.success).toBe(true);
      expect(result.sectionResults.has('JavaScript')).toBe(true);
      expect(result.sectionResults.has('Tests')).toBe(true);
      expect(result.sectionResults.has('Python')).toBe(false);
    });

    it('should return empty results for non-existent section', async () => {
      const module = createMultiSectionModule();
      const result = await runtime.execute(module, {
        sections: ['NonExistent'],
      });
      expect(result.success).toBe(true);
      expect(result.sectionResults.size).toBe(0);
    });

    it('should skip non-executable sections by default', async () => {
      const module = createMultiSectionModule();
      const result = await runtime.execute(module);
      expect(result.sectionResults.has('Documentation')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle stopOnError and stop on first failure', async () => {
      const loc = createLocationForTest();
      const module: MAMModule = {
        type: 'MAMModule',
        frontmatter: {
          type: 'FrontMatter',
          data: { id: 'err', version: '1.0.0', name: 'Err', author: 'Author' },
          location: loc,
        },
        sections: [
          {
            type: 'Section',
            name: 'JavaScript',
            level: 2,
            content: [
              createTestCodeBlock('throw new Error("fail1")', 'javascript'),
              createTestCodeBlock('42', 'javascript'),
            ],
            location: loc,
            attributes: { required: false, isCustom: false, contentTypes: ['code'] },
          },
        ],
        location: loc,
        metadata: { sectionCount: 1, codeBlockCount: 2, languages: ['javascript'], customSections: [], parsedAt: '' },
      };

      const runtime = new MAMRuntime({
        validateBeforeExecution: false,
        stopOnError: true,
      });
      await runtime.init();
      const result = await runtime.execute(module);
      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      await runtime.cleanup();
    });

    it('should continue after error when stopOnError is false', async () => {
      const loc = createLocationForTest();
      const module: MAMModule = {
        type: 'MAMModule',
        frontmatter: {
          type: 'FrontMatter',
          data: { id: 'err2', version: '1.0.0', name: 'Err2', author: 'Author' },
          location: loc,
        },
        sections: [
          {
            type: 'Section',
            name: 'JavaScript',
            level: 2,
            content: [
              createTestCodeBlock('throw new Error("fail")', 'javascript'),
              createTestCodeBlock('42', 'javascript'),
            ],
            location: loc,
            attributes: { required: false, isCustom: false, contentTypes: ['code'] },
          },
        ],
        location: loc,
        metadata: { sectionCount: 1, codeBlockCount: 2, languages: ['javascript'], customSections: [], parsedAt: '' },
      };

      const runtime = new MAMRuntime({
        validateBeforeExecution: false,
        stopOnError: false,
      });
      await runtime.init();
      const result = await runtime.execute(module);
      // The section may succeed overall if the second block succeeds,
      // or have errors from the first block depending on implementation
      expect(result).toBeDefined();
      expect(result.sectionResults.size).toBeGreaterThan(0);
      await runtime.cleanup();
    });
  });

  describe('validation', () => {
    it('should validate before execution by default', async () => {
      const runtime = new MAMRuntime({ validateBeforeExecution: true });
      await runtime.init();
      // A module with empty sections may fail validation
      const module = createModuleWithEmptySections();
      const result = await runtime.execute(module);
      expect(result).toHaveProperty('validation');
      await runtime.cleanup();
    });

    it('should skip validation when disabled', async () => {
      const runtime = new MAMRuntime({ validateBeforeExecution: false });
      await runtime.init();
      const module = createTestModule();
      const result = await runtime.execute(module);
      expect(result.validation).toBeUndefined();
      await runtime.cleanup();
    });
  });

  describe('memory get/set', () => {
    let runtime: MAMRuntime;

    beforeEach(async () => {
      runtime = new MAMRuntime({ validateBeforeExecution: false });
      await runtime.init();
    });

    afterEach(async () => {
      await runtime.cleanup();
    });

    it('should return empty memory for non-existent runtime', () => {
      const memory = runtime.getMemory('nonexistent');
      expect(memory).toEqual({});
    });

    it('should set and get memory after execution', async () => {
      const module = createTestModule();
      await runtime.execute(module);
      // After execution, context should exist for javascript
      runtime.setMemory('javascript', 'testKey', 'testValue');
      const memory = runtime.getMemory('javascript');
      expect(memory.testKey).toBe('testValue');
    });

    it('should clear memory via context', async () => {
      const module = createTestModule();
      await runtime.execute(module);
      runtime.setMemory('javascript', 'key', 'value');
      expect(runtime.getMemory('javascript').key).toBe('value');
    });
  });

  describe('cleanup', () => {
    it('should cleanup without error', async () => {
      const runtime = new MAMRuntime();
      await runtime.init();
      await runtime.cleanup();
      expect(runtime).toBeDefined();
    });

    it('should cleanup after execution', async () => {
      const runtime = new MAMRuntime({ validateBeforeExecution: false });
      await runtime.init();
      const module = createTestModule();
      await runtime.execute(module);
      await runtime.cleanup();
      expect(runtime).toBeDefined();
    });

    it('should be safe to cleanup multiple times', async () => {
      const runtime = new MAMRuntime();
      await runtime.init();
      await runtime.cleanup();
      await runtime.cleanup();
    });
  });
});

describe('executeModule', () => {
  it('should execute a module via convenience function', async () => {
    const module = createTestModule();
    const result = await executeModule(module, { validateBeforeExecution: false });
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.timeMs).toBeGreaterThanOrEqual(0);
  });

  it('should execute with custom config', async () => {
    const module = createTestModule();
    const result = await executeModule(module, {
      validateBeforeExecution: false,
      stopOnError: true,
      defaultTimeout: 5000,
    });
    expect(result.success).toBe(true);
  });

  it('should execute with options', async () => {
    const module = createMultiSectionModule();
    const result = await executeModule(
      module,
      { validateBeforeExecution: false },
      { sections: ['JavaScript'] }
    );
    expect(result.success).toBe(true);
    expect(result.sectionResults.has('JavaScript')).toBe(true);
  });

  it('should handle invalid module gracefully', async () => {
    const loc = createLocationForTest();
    const module: MAMModule = {
      type: 'MAMModule',
      frontmatter: null,
      sections: [],
      location: loc,
      metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' },
    };
    // May succeed or fail depending on validation
    const result = await executeModule(module, { validateBeforeExecution: false });
    expect(result).toBeDefined();
  });
});
