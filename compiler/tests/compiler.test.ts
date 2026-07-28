/**
 * MAMCompiler Tests
 */

import { describe, it, expect } from 'vitest';
import { MAMCompiler, type CompilerConfig, type CompileResult } from '../src/compiler.js';
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

const agentModule = makeModule({
  name: 'researcher',
  moduleType: 'agent',
  role: 'Researcher',
  goal: 'Research topics',
  tools: ['web-search'],
  handoff: ['writer'],
});

const toolModule = makeModule({
  name: 'web-search',
  moduleType: 'tool',
  provider: 'google',
  capabilities: ['search'],
});

const workflowModule = makeModule({
  name: 'pipeline',
  moduleType: 'workflow',
  steps: [
    { type: 'StepNode', name: 'step-1', location: loc },
    { type: 'StepNode', name: 'step-2', location: loc },
  ],
  edges: [
    { type: 'EdgeNode', source: 'step-1', target: 'step-2', location: loc },
  ],
});

const baseConfig: CompilerConfig = { target: 'json', includeComments: true };

describe('MAMCompiler', () => {
  it('should initialize with default targets', () => {
    const compiler = new MAMCompiler();
    const targets = compiler.getTargets();

    expect(targets).toContain('python');
    expect(targets).toContain('javascript');
    expect(targets).toContain('json');
  });

  it('should register a custom target', () => {
    const compiler = new MAMCompiler();
    compiler.registerTarget('custom', {
      name: 'custom',
      compile: () => 'custom output',
    });

    const targets = compiler.getTargets();
    expect(targets).toContain('custom');
  });

  it('should compile with a simple V2ModuleNode array', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([agentModule], baseConfig);

    expect(result.success).toBe(true);
    expect(result.output).toBeTruthy();
    expect(result.target).toBe('json');
    expect(result.stats.modulesCompiled).toBe(1);
    expect(result.stats.linesGenerated).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should compile with empty modules array', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([], baseConfig);

    expect(result.success).toBe(true);
    expect(result.stats.modulesCompiled).toBe(0);
  });

  it('should compile an agent type module', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([agentModule], { target: 'python', includeComments: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('class');
    expect(result.output).toContain('def execute');
    expect(result.output).toContain('Researcher');
  });

  it('should compile a tool type module', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([toolModule], { target: 'python', includeComments: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('class');
    expect(result.output).toContain('def execute');
    expect(result.output).toContain('google');
  });

  it('should compile a workflow type module', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([workflowModule], { target: 'python', includeComments: true });

    expect(result.success).toBe(true);
    expect(result.output).toContain('class');
    expect(result.output).toContain('STEPS');
    expect(result.output).toContain('step-1');
    expect(result.output).toContain('step-2');
  });

  it('should return error for unknown target', () => {
    const compiler = new MAMCompiler();
    const result = compiler.compile([agentModule], { target: 'unknown-target' as any });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Unknown target');
  });

  it('should warn on modules without names', () => {
    const compiler = new MAMCompiler();
    const modules = [
      makeModule({ name: '' }),
    ];
    const result = compiler.compile(modules, baseConfig);

    expect(result.warnings.some(w => w.includes('no name'))).toBe(true);
  });

  it('should compile with a registered custom target', () => {
    const compiler = new MAMCompiler();
    compiler.registerTarget('custom', {
      name: 'custom',
      compile: (modules, _config) => `// Custom output for ${modules.length} modules`,
    });

    const result = compiler.compile([agentModule], { target: 'custom' as any });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Custom output');
    expect(result.stats.modulesCompiled).toBe(1);
  });
});
