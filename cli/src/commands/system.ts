/**
 * MAM System Command
 *
 * Shows the standalone MAM engine packages wired directly into the CLI.
 * Every engine below is instantiated directly from its package (NOT through
 * the runtime facade) and reported as `name -> engine present (module)`.
 */

import { createTracer, createMetricsRegistry, createEvaluator, createCostTracker } from '@mam/observability';
import { createContextAssembler, createTokenBudgeter, createPrioritizer } from '@mam/context-engine';
import { createWorkingMemory } from '@mam/memory-engine';
import { createSourceAdapter } from '@mam/knowledge-engine';
import {
  createAuthenticator,
  createAuthorizer,
  createAuditLogger,
  createSecurityPolicyEngine,
} from '@mam/security';
import { createToolDiscovery, createToolInvoker, createToolValidator } from '@mam/tool-engine';
import { createMcpServer } from '@mam/mcp';
import { createCacheManager, PromptOptimizer } from '@mam/token-optimization';
import {
  QueryAnalyzer,
  GroundednessScorer,
  AnswerSynthesizer,
  GraphEngine,
  Consolidator,
} from '@mam/intelligence-layer';
import chalk from 'chalk';

type EngineRow = [name: string, module: string, engine: unknown];

export function collectEngines(): EngineRow[] {
  return [
    ['workingMemory', '@mam/memory-engine', createWorkingMemory(60_000)],
    ['knowledgeSource', '@mam/knowledge-engine', createSourceAdapter()],
    ['tracer', '@mam/observability', createTracer()],
    ['metrics', '@mam/observability', createMetricsRegistry()],
    ['evaluator', '@mam/observability', createEvaluator()],
    ['costTracker', '@mam/observability', createCostTracker()],
    ['contextAssembler', '@mam/context-engine', createContextAssembler()],
    ['tokenBudgeter', '@mam/context-engine', createTokenBudgeter(undefined, { lifecycle: false })],
    ['prioritizer', '@mam/context-engine', createPrioritizer()],
    ['authenticator', '@mam/security', createAuthenticator()],
    ['authorizer', '@mam/security', createAuthorizer()],
    ['auditLogger', '@mam/security', createAuditLogger()],
    ['policy', '@mam/security', createSecurityPolicyEngine()],
    ['toolDiscovery', '@mam/tool-engine', createToolDiscovery()],
    ['toolInvoker', '@mam/tool-engine', createToolInvoker()],
    ['toolValidator', '@mam/tool-engine', createToolValidator()],
    ['mcpServer', '@mam/mcp', createMcpServer()],
    ['cacheManager', '@mam/token-optimization', createCacheManager()],
    ['promptOptimizer', '@mam/token-optimization', new PromptOptimizer()],
    ['queryAnalyzer', '@mam/intelligence-layer', new QueryAnalyzer()],
    ['groundednessScorer', '@mam/intelligence-layer', new GroundednessScorer()],
    ['answerSynthesizer', '@mam/intelligence-layer', new AnswerSynthesizer()],
    ['graphEngine', '@mam/intelligence-layer', new GraphEngine()],
    ['consolidator', '@mam/intelligence-layer', new Consolidator()],
  ];
}

export async function systemCommand(): Promise<void> {
  const rows = collectEngines();
  const nameWidth = Math.max(...rows.map(([name]) => name.length)) + 2;

  console.log(chalk.cyan('\n  Wired MAM Engines\n'));
  for (const [name, module, engine] of rows) {
    const present = engine != null;
    console.log(
      `  ${name.padEnd(nameWidth)} ${present ? chalk.green('present') : chalk.red('missing')}  ${chalk.gray(`(${module})`)}`,
    );
  }
  console.log(chalk.gray(`\n  ${rows.length} engines wired directly (no runtime facade)\n`));
}