import { describe, it, expect } from 'vitest';
import { createMAMSystem, MAMSystem } from '../src/v2/system.js';

describe('mam system wiring', () => {
  it('creates a system with all module namespaces', () => {
    const system = createMAMSystem();
    expect(system).toBeInstanceOf(MAMSystem);
    expect(system.modules.memory).toBeDefined();
    expect(system.modules.knowledge).toBeDefined();
    expect(system.modules.observability).toBeDefined();
    expect(system.modules.context).toBeDefined();
    expect(system.modules.security).toBeDefined();
    expect(system.modules.toolEngine).toBeDefined();
    expect(system.modules.mcp).toBeDefined();
    expect(system.modules.tokenOptimization).toBeDefined();
    expect(system.modules.intelligence).toBeDefined();
  });

  it('auto-wires default engines under canonical names', () => {
    const system = createMAMSystem();
    const names = system.list();
    expect(names).toContain('runtime');
    expect(names).toContain('memory');
    expect(names).toContain('knowledge');
    expect(names).toContain('tracer');
    expect(names).toContain('metrics');
    expect(names).toContain('costs');
    expect(names).toContain('evaluator');
    expect(names).toContain('authenticator');
    expect(names).toContain('authorizer');
    expect(names).toContain('policy');
    expect(names).toContain('toolInvoker');
    expect(names).toContain('mcpServer');
    expect(names).toContain('promptOptimizer');
    expect(names).toContain('queryAnalyzer');
  });

  it('exposes typed getters for default engines', () => {
    const system = createMAMSystem();
    expect(system.workingMemory).toBeDefined();
    expect(system.knowledgeSource).toBeDefined();
    expect(system.tracer).toBeDefined();
    expect(system.metrics).toBeDefined();
    expect(system.costs).toBeDefined();
    expect(system.evaluator).toBeDefined();
    expect(system.tokenUsage).toBeDefined();
    expect(system.contextAssembler).toBeDefined();
    expect(system.tokenBudgeter).toBeDefined();
    expect(system.prioritizer).toBeDefined();
    expect(system.authenticator).toBeDefined();
    expect(system.authorizer).toBeDefined();
    expect(system.audit).toBeDefined();
    expect(system.policy).toBeDefined();
    expect(system.toolDiscovery).toBeDefined();
    expect(system.toolAuthorizer).toBeDefined();
    expect(system.toolInvoker).toBeDefined();
    expect(system.toolValidator).toBeDefined();
    expect(system.mcpServer).toBeDefined();
    expect(system.cacheManager).toBeDefined();
    expect(system.promptOptimizer).toBeDefined();
    expect(system.queryAnalyzer).toBeDefined();
    expect(system.groundednessScorer).toBeDefined();
    expect(system.answerSynthesizer).toBeDefined();
    expect(system.graphEngine).toBeDefined();
    expect(system.consolidator).toBeDefined();
  });

  it('register/get/has/list work and emit events', () => {
    const system = createMAMSystem({ autoWire: false });
    let registered = 0;
    system.events.on('registered', () => (registered += 1));
    const engine = { hello: true };
    system.register('custom', engine);
    expect(system.has('custom')).toBe(true);
    expect(system.get('custom')).toBe(engine);
    expect(system.list()).toContain('custom');
    expect(system.list()).toContain('runtime');
    expect(registered).toBe(1);
  });

  it('default engines are functional end-to-end', () => {
    const system = createMAMSystem();
    expect(system.metrics!.stats()).toBeDefined();
    const analysis = system.queryAnalyzer!.analyze('What is MAM?');
    expect(analysis.intent).toBeDefined();
    expect(typeof analysis.confidence).toBe('number');
    const grounded = system.groundednessScorer!.ground(
      'MAM is a language.',
      [{ id: 'e1', text: 'MAM is a language for modules.' }],
    );
    expect(grounded).toBeDefined();
  });
});