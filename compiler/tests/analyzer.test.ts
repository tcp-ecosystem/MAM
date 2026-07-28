/**
 * SemanticAnalyzer Tests
 */

import { describe, it, expect } from 'vitest';
import { SemanticAnalyzer, analyzeSemantics } from '../src/analyzer/index.js';
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

const validModules: V2ModuleNode[] = [
  makeModule({
    name: 'agent-a',
    moduleType: 'agent',
    role: 'Agent A',
    goal: 'Do work',
    tools: ['tool-a'],
    handoff: ['agent-b'],
  }),
  makeModule({
    name: 'agent-b',
    moduleType: 'agent',
    role: 'Agent B',
    goal: 'Do more work',
  }),
  makeModule({
    name: 'tool-a',
    moduleType: 'tool',
    provider: 'google',
  }),
];

describe('SemanticAnalyzer', () => {
  it('should return no errors for valid modules', () => {
    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(validModules);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.modulesAnalyzed).toBe(3);
  });

  it('should detect self-loop edges', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'self-loop',
        moduleType: 'agent',
        role: 'Loop',
        goal: 'Loop',
        edges: [
          { type: 'EdgeNode', source: 'self-loop', target: 'self-loop', location: loc },
        ],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.warnings.some(w => w.code === 'SELF_LOOP')).toBe(true);
  });

  it('should detect undefined edge targets', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'agent-a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal A',
        edges: [
          { type: 'EdgeNode', source: 'agent-a', target: 'nonexistent', location: loc },
        ],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'UNDEFINED_EDGE_TARGET')).toBe(true);
  });

  it('should detect undefined edge sources', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'agent-a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal A',
        edges: [
          { type: 'EdgeNode', source: 'nonexistent', target: 'agent-a', location: loc },
        ],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'UNDEFINED_EDGE_SOURCE')).toBe(true);
  });

  it('should detect cyclic dependencies', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal',
        edges: [
          { type: 'EdgeNode', source: 'a', target: 'b', location: loc },
        ],
      }),
      makeModule({
        name: 'b',
        moduleType: 'agent',
        role: 'B',
        goal: 'Goal',
        edges: [
          { type: 'EdgeNode', source: 'b', target: 'a', location: loc },
        ],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.errors.some(e => e.code === 'CYCLIC_DEPENDENCY')).toBe(true);
  });

  it('should detect undefined tool references', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'agent-a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal',
        tools: ['nonexistent-tool'],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.warnings.some(w => w.code === 'UNDEFINED_TOOL')).toBe(true);
  });

  it('should detect undefined handoff references', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'agent-a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal',
        handoff: ['nonexistent-agent'],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.warnings.some(w => w.code === 'UNDEFINED_HANDOFF')).toBe(true);
  });

  it('should warn on agent missing role', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'no-role',
        moduleType: 'agent',
        role: '',
        goal: 'Goal',
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.warnings.some(w => w.code === 'MISSING_ROLE')).toBe(true);
  });

  it('should warn on agent missing goal', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'no-goal',
        moduleType: 'agent',
        role: 'Role',
        goal: '',
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.warnings.some(w => w.code === 'MISSING_GOAL')).toBe(true);
  });

  it('should error on empty workflow', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'empty-wf',
        moduleType: 'workflow',
        steps: [],
        edges: [],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.errors.some(e => e.code === 'EMPTY_WORKFLOW')).toBe(true);
  });

  it('should error on empty team', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'empty-team',
        moduleType: 'team',
        members: [],
      }),
    ];

    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(modules);

    expect(result.errors.some(e => e.code === 'EMPTY_TEAM')).toBe(true);
  });

  it('should allow undefined refs when configured', () => {
    const modules: V2ModuleNode[] = [
      makeModule({
        name: 'agent-a',
        moduleType: 'agent',
        role: 'A',
        goal: 'Goal',
        tools: ['nonexistent'],
        handoff: ['nonexistent'],
      }),
    ];

    const analyzer = new SemanticAnalyzer({ allowUndefinedRefs: true });
    const result = analyzer.analyze(modules);

    expect(result.warnings.filter(w => w.code === 'UNDEFINED_TOOL')).toHaveLength(0);
    expect(result.warnings.filter(w => w.code === 'UNDEFINED_HANDOFF')).toHaveLength(0);
  });

  it('should provide stats after analysis', () => {
    const analyzer = new SemanticAnalyzer();
    const result = analyzer.analyze(validModules);

    expect(result.stats.modulesAnalyzed).toBe(3);
    expect(result.stats.timeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('analyzeSemantics', () => {
  it('should be a convenience function that returns the same result', () => {
    const result = analyzeSemantics(validModules);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.stats.modulesAnalyzed).toBe(3);
  });

  it('should accept config parameter', () => {
    const result = analyzeSemantics(validModules, { allowUndefinedRefs: true });

    expect(result.valid).toBe(true);
  });
});
