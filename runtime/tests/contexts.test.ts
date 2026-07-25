/**
 * Execution Context Tests
 */

import { describe, it, expect } from 'vitest';
import { createExecutionContext, JavaScriptExecutionContext } from '../src/contexts/index.js';
import { createLocation } from '@mam/ast';

describe('Execution Contexts', () => {
  it('should create JavaScript context', () => {
    const ctx = createExecutionContext('javascript');
    expect(ctx).toBeInstanceOf(JavaScriptExecutionContext);
  });

  it('should execute JavaScript code', async () => {
    const ctx = new JavaScriptExecutionContext();
    await ctx.init({
      module: { type: 'MAMModule', frontmatter: null, sections: [], location: createLocation(1, 0, 0, 1, 0, 0, 'test'), metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' } },
      inputs: {},
      permissions: [],
    });
    const result = await ctx.execute({ type: 'CodeBlock', language: 'javascript', value: '1 + 1', metadata: {}, location: createLocation(1, 0, 0, 1, 0, 0, 'test') });
    expect(result.success).toBe(true);
    expect(result.output).toBe(2);
  });

  it('should manage memory', async () => {
    const ctx = new JavaScriptExecutionContext();
    await ctx.init({
      module: { type: 'MAMModule', frontmatter: null, sections: [], location: createLocation(1, 0, 0, 1, 0, 0, 'test'), metadata: { sectionCount: 0, codeBlockCount: 0, languages: [], customSections: [], parsedAt: '' } },
      inputs: {},
      permissions: [],
    });
    ctx.setMemory('key', 'value');
    expect(ctx.getMemory().key).toBe('value');
    ctx.clearMemory();
    expect(Object.keys(ctx.getMemory())).toHaveLength(0);
  });
});