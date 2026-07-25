/**
 * Runtime Tests
 */

import { describe, it, expect } from 'vitest';
import { MAMRuntime } from '../src/runtime.js';
import { createLocation } from '@mam/ast';
import type { MAMModule } from '@mam/ast';

function createTestModule(): MAMModule {
  const loc = createLocation(1, 0, 0, 10, 0, 100, 'test.mam.md');
  return {
    type: 'MAMModule',
    frontmatter: {
      type: 'FrontMatter',
      data: { id: 'test', version: '1.0.0', name: 'Test', author: 'Author', runtime: 'python' },
      location: loc,
    },
    sections: [{
      type: 'Section', name: 'Python', level: 2,
      content: [{ type: 'CodeBlock', language: 'python', value: 'print("hello")', metadata: {}, location: loc }],
      location: loc, attributes: { required: false, isCustom: false, contentTypes: ['code'] },
    }],
    location: loc,
    metadata: { sectionCount: 1, codeBlockCount: 1, languages: ['python'], customSections: [], parsedAt: '' },
  };
}

describe('MAM Runtime', () => {
  it('should initialize', async () => {
    const runtime = new MAMRuntime();
    await runtime.init();
    expect(runtime).toBeDefined();
  });

  it('should execute module', async () => {
    const runtime = new MAMRuntime({ validateBeforeExecution: false });
    await runtime.init();
    const module = createTestModule();
    const result = await runtime.execute(module);
    expect(result.success).toBe(true);
  });

  it('should cleanup', async () => {
    const runtime = new MAMRuntime();
    await runtime.init();
    await runtime.cleanup();
    expect(runtime).toBeDefined();
  });
});