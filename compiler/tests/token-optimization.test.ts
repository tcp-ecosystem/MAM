/**
 * Token-Optimization Integration Tests
 *
 * Verifies that AI SDK targets run their emitted prompt content through
 * `@mam/token-optimization` when `optimizeTokens: true` is set, surfacing the
 * savings on the `CompileResult`, while the default (disabled) path stays
 * byte-identical.
 */

import { describe, it, expect } from 'vitest';
import { MAMCompiler } from '../src/compiler.js';
import { OpenAITarget } from '../src/targets/openai.js';
import { type V2ModuleNode } from '@mam/ast';

const loc = { start: { line: 1, column: 0 }, end: { line: 5, column: 0 } };

function makeModule(overrides: Partial<V2ModuleNode> & { name: string }): V2ModuleNode {
  return {
    type: 'ModuleNode',
    moduleType: 'agent',
    name: 'test-module',
    role: 'Test agent',
    goal: 'Test goal',
    location: loc,
    ...overrides,
  };
}

const smallModule: V2ModuleNode = makeModule({
  name: 'researcher',
  moduleType: 'agent',
  role: 'Researcher',
  goal: 'Research topics',
  rules: ['Act clearly and carefully', 'Avoid obviously redundant filler language'],
});

function compilerWithOpenAI(): MAMCompiler {
  const compiler = new MAMCompiler();
  compiler.registerTarget('openai', new OpenAITarget());
  return compiler;
}

describe('TokenOptimization (OpenAI target)', () => {
  it('should return tokenOptimization savings when optimizeTokens is enabled', () => {
    const compiler = compilerWithOpenAI();
    const result = compiler.compile([smallModule], { target: 'openai', optimizeTokens: true });

    expect(result.success).toBe(true);
    expect(result.tokenOptimization).toBeDefined();
    expect(result.tokenOptimization!.originalTokens).toBeGreaterThan(0);
    expect(result.tokenOptimization!.savedTokens).toBeGreaterThanOrEqual(0);
    expect(result.tokenOptimization!.savedPercent).toBeGreaterThanOrEqual(0);
    expect(result.output).toContain('SYSTEM_PROMPT');
  });

  it('should keep the default path unchanged when optimizeTokens is disabled', () => {
    const compiler = compilerWithOpenAI();
    const baseline = compiler.compile([smallModule], { target: 'openai' });
    const plain = compiler.compile([smallModule], { target: 'openai', optimizeTokens: false });

    expect(baseline.success).toBe(true);
    expect(plain.success).toBe(true);
    expect(plain.output).toBe(baseline.output);
    expect(plain.tokenOptimization).toBeUndefined();
    expect(plain.output).toContain('run_researcher');
    expect(plain.output).not.toContain('SYSTEM_PROMPT =');
  });
});