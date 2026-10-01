import { describe, expect, it } from 'vitest';
import {
  createEngines,
  engineStatus,
  engineModuleNames,
  hasEngineModule,
  createTracer,
  createEvaluator,
  createAuthenticator,
  QueryAnalyzer,
  PromptOptimizer,
} from '../mam/index.js';

describe('engines', () => {
  it('exposes all nine engine module namespaces', () => {
    const names = engineModuleNames();
    expect(names).toEqual(
      expect.arrayContaining([
        'memory',
        'knowledge',
        'observability',
        'context',
        'security',
        'toolEngine',
        'mcp',
        'tokenOptimization',
        'intelligence',
      ]),
    );
    expect(hasEngineModule('observability')).toBe(true);
    expect(hasEngineModule('nope')).toBe(false);
  });

  it('creates a typed bag of default engines directly', () => {
    const engines = createEngines();
    expect(engines.workingMemory).toBeDefined();
    expect(engines.knowledgeSource).toBeDefined();
    expect(engines.tracer).toBeDefined();
    expect(engines.metrics).toBeDefined();
    expect(engines.evaluator).toBeDefined();
    expect(engines.authenticator).toBeDefined();
    expect(engines.authorizer).toBeDefined();
    expect(engines.policy).toBeDefined();
    expect(engines.toolDiscovery).toBeDefined();
    expect(engines.toolInvoker).toBeDefined();
    expect(engines.mcpServer).toBeDefined();
    expect(engines.mcpClient).toBeDefined();
    expect(engines.cacheManager).toBeDefined();
    expect(engines.promptOptimizer).toBeDefined();
    expect(engines.queryAnalyzer).toBeDefined();
    expect(engines.groundednessScorer).toBeDefined();
    expect(engines.answerSynthesizer).toBeDefined();
    expect(engines.graphEngine).toBeDefined();
    expect(engines.consolidator).toBeDefined();
  });

  it('engineStatus inventories every default engine', () => {
    const status = engineStatus(createEngines());
    expect(status.length).toBeGreaterThan(10);
    for (const entry of status) {
      expect(entry.present).toBe(true);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.module.length).toBeGreaterThan(0);
    }
    expect(status.some((e) => e.name === 'tracer' && e.module === 'observability')).toBe(true);
    expect(status.some((e) => e.name === 'graphEngine' && e.module === 'intelligence')).toBe(true);
  });

  it('re-exports curated factories that are functional', () => {
    expect(typeof createTracer).toBe('function');
    expect(typeof createEvaluator).toBe('function');
    expect(typeof createAuthenticator).toBe('function');
    expect(typeof QueryAnalyzer).toBe('function');
    expect(typeof PromptOptimizer).toBe('function');
    const analyzer = new QueryAnalyzer();
    const analysis = analyzer.analyze('What is MAM?');
    expect(analysis.intent).toBeDefined();
    const evaluator = createEvaluator();
    expect(evaluator.evaluate('accuracy', 0.9).passed).toBe(true);
  });
});