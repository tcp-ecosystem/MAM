/**
 * MAM SDK — Engines
 *
 * Direct wiring of the standalone MAM engine packages into the TypeScript
 * SDK. Every engine package is exposed three ways:
 *
 *  - as a module **namespace** (`engines.memory`, `engines.observability`, ...)
 *    so consumers can build custom engines from the full API;
 *  - as curated **re-exports** of the most common factories and classes
 *    (`createTracer`, `createEvaluator`, `QueryAnalyzer`, ...);
 *  - as **pre-wired default engines** via `createEngines()` with typed
 *    getters and an `engineStatus()` inventory.
 */

import * as memory from '@mam/memory-engine';
import * as knowledge from '@mam/knowledge-engine';
import * as observability from '@mam/observability';
import * as context from '@mam/context-engine';
import * as security from '@mam/security';
import * as toolEngine from '@mam/tool-engine';
import * as mcp from '@mam/mcp';
import * as tokenOptimization from '@mam/token-optimization';
import * as intelligence from '@mam/intelligence-layer';

// ---------------------------------------------------------------------------
// Module namespaces
// ---------------------------------------------------------------------------

/** Engine package namespaces keyed by subsystem. */
export const engines = {
  memory,
  knowledge,
  observability,
  context,
  security,
  toolEngine,
  mcp,
  tokenOptimization,
  intelligence,
} as const;

/** Names of every wired engine module. */
export function engineModuleNames(): readonly string[] {
  return Object.keys(engines);
}

/** Whether a named engine module is part of this SDK. */
export function hasEngineModule(name: string): boolean {
  return name.trim().toLowerCase() in engines;
}

// ---------------------------------------------------------------------------
// Curated re-exports (common factories + classes, collision-free)
// ---------------------------------------------------------------------------

// memory
export { createWorkingMemory } from '@mam/memory-engine';

// knowledge
export { createSourceAdapter } from '@mam/knowledge-engine';

// observability
export {
  createTracer,
  createMetricsRegistry,
  createEvaluator,
  createCostTracker,
  createTokenUsageTracker,
} from '@mam/observability';

// context
export {
  createContextAssembler,
  createTokenBudgeter,
  createPrioritizer,
} from '@mam/context-engine';

// security
export {
  createAuthenticator,
  createAuthorizer,
  createAuditLogger,
  createSecurityPolicyEngine,
} from '@mam/security';

// tool-engine
export {
  createToolDiscovery,
  createToolAuthorizer,
  createToolInvoker,
  createToolValidator,
} from '@mam/tool-engine';

// mcp
export { createMcpServer, createMcpClient } from '@mam/mcp';

// token-optimization
export { createCacheManager, PromptOptimizer } from '@mam/token-optimization';

// intelligence-layer
export {
  QueryAnalyzer,
  GroundednessScorer,
  AnswerSynthesizer,
  GraphEngine,
  Consolidator,
} from '@mam/intelligence-layer';

// ---------------------------------------------------------------------------
// Pre-wired default engines
// ---------------------------------------------------------------------------

/** The set of default engines created by {@link createEngines}. */
export interface SDKEngines {
  /** Working memory (short-term TTL store). */
  workingMemory: ReturnType<typeof memory.createWorkingMemory>;
  /** Knowledge source adapter. */
  knowledgeSource: ReturnType<typeof knowledge.createSourceAdapter>;
  /** Observability tracer. */
  tracer: ReturnType<typeof observability.createTracer>;
  /** Observability metrics registry. */
  metrics: ReturnType<typeof observability.createMetricsRegistry>;
  /** Observability evaluator. */
  evaluator: ReturnType<typeof observability.createEvaluator>;
  /** Observability cost tracker. */
  costs: ReturnType<typeof observability.createCostTracker>;
  /** Observability token usage tracker. */
  tokenUsage: ReturnType<typeof observability.createTokenUsageTracker>;
  /** Context engine assembler. */
  contextAssembler: ReturnType<typeof context.createContextAssembler>;
  /** Context engine token budgeter. */
  tokenBudgeter: ReturnType<typeof context.createTokenBudgeter>;
  /** Context engine prioritizer. */
  prioritizer: ReturnType<typeof context.createPrioritizer>;
  /** Security authenticator. */
  authenticator: ReturnType<typeof security.createAuthenticator>;
  /** Security authorizer. */
  authorizer: ReturnType<typeof security.createAuthorizer>;
  /** Security audit logger. */
  audit: ReturnType<typeof security.createAuditLogger>;
  /** Security policy engine. */
  policy: ReturnType<typeof security.createSecurityPolicyEngine>;
  /** Tool engine discovery. */
  toolDiscovery: ReturnType<typeof toolEngine.createToolDiscovery>;
  /** Tool engine authorizer. */
  toolAuthorizer: ReturnType<typeof toolEngine.createToolAuthorizer>;
  /** Tool engine invoker. */
  toolInvoker: ReturnType<typeof toolEngine.createToolInvoker>;
  /** Tool engine validator. */
  toolValidator: ReturnType<typeof toolEngine.createToolValidator>;
  /** MCP server. */
  mcpServer: ReturnType<typeof mcp.createMcpServer>;
  /** MCP client. */
  mcpClient: ReturnType<typeof mcp.createMcpClient>;
  /** Token-optimization cache manager. */
  cacheManager: ReturnType<typeof tokenOptimization.createCacheManager>;
  /** Token-optimization prompt optimizer. */
  promptOptimizer: tokenOptimization.PromptOptimizer;
  /** Intelligence query analyzer. */
  queryAnalyzer: intelligence.QueryAnalyzer;
  /** Intelligence groundedness scorer. */
  groundednessScorer: intelligence.GroundednessScorer;
  /** Intelligence answer synthesizer. */
  answerSynthesizer: intelligence.AnswerSynthesizer;
  /** Intelligence knowledge graph engine. */
  graphEngine: intelligence.GraphEngine;
  /** Intelligence knowledge consolidator. */
  consolidator: intelligence.Consolidator;
}

/**
 * Create a pre-wired set of default engines, instantiating each subsystem's
 * main engine directly from its package.
 *
 * @returns a typed bag of ready-to-use default engines.
 */
export function createEngines(): SDKEngines {
  return {
    workingMemory: memory.createWorkingMemory(24 * 60 * 60 * 1000),
    knowledgeSource: knowledge.createSourceAdapter(),
    tracer: observability.createTracer(),
    metrics: observability.createMetricsRegistry(),
    evaluator: observability.createEvaluator(),
    costs: observability.createCostTracker(),
    tokenUsage: observability.createTokenUsageTracker(),
    contextAssembler: context.createContextAssembler(),
    tokenBudgeter: context.createTokenBudgeter(),
    prioritizer: context.createPrioritizer(),
    authenticator: security.createAuthenticator(),
    authorizer: security.createAuthorizer(),
    audit: security.createAuditLogger(),
    policy: security.createSecurityPolicyEngine(),
    toolDiscovery: toolEngine.createToolDiscovery(),
    toolAuthorizer: toolEngine.createToolAuthorizer(),
    toolInvoker: toolEngine.createToolInvoker(),
    toolValidator: toolEngine.createToolValidator(),
    mcpServer: mcp.createMcpServer(),
    mcpClient: mcp.createMcpClient(),
    cacheManager: tokenOptimization.createCacheManager(),
    promptOptimizer: new tokenOptimization.PromptOptimizer(),
    queryAnalyzer: new intelligence.QueryAnalyzer(),
    groundednessScorer: new intelligence.GroundednessScorer(),
    answerSynthesizer: new intelligence.AnswerSynthesizer(),
    graphEngine: new intelligence.GraphEngine(),
    consolidator: new intelligence.Consolidator(),
  };
}

/** A single engine inventory row. */
export interface EngineStatusEntry {
  /** Canonical engine name. */
  name: string;
  /** Whether the engine was created. */
  present: boolean;
  /** Owning engine module. */
  module: keyof typeof engines;
}

/**
 * Produce an inventory of the wired default engines.
 *
 * @param created - an optional {@link SDKEngines} bag; defaults to a fresh
 * `createEngines()`.
 * @returns one entry per default engine.
 */
export function engineStatus(created: SDKEngines = createEngines()): EngineStatusEntry[] {
  const rows: EngineStatusEntry[] = [];
  for (const key of Object.keys(created) as Array<keyof SDKEngines>) {
    rows.push({
      name: key,
      present: created[key] !== undefined,
      module: engineModuleFor(key),
    });
  }
  return rows;
}

/**
 * Map an engine name to its owning module.
 *
 * @param engine - the canonical engine name.
 * @returns the owning module key.
 */
export function engineModuleFor(engine: keyof SDKEngines | string): keyof typeof engines {
  switch (engine) {
    case 'workingMemory':
      return 'memory';
    case 'knowledgeSource':
      return 'knowledge';
    case 'tracer':
    case 'metrics':
    case 'evaluator':
    case 'costs':
    case 'tokenUsage':
      return 'observability';
    case 'contextAssembler':
    case 'tokenBudgeter':
    case 'prioritizer':
      return 'context';
    case 'authenticator':
    case 'authorizer':
    case 'audit':
    case 'policy':
      return 'security';
    case 'toolDiscovery':
    case 'toolAuthorizer':
    case 'toolInvoker':
    case 'toolValidator':
      return 'toolEngine';
    case 'mcpServer':
    case 'mcpClient':
      return 'mcp';
    case 'cacheManager':
    case 'promptOptimizer':
      return 'tokenOptimization';
    case 'queryAnalyzer':
    case 'groundednessScorer':
    case 'answerSynthesizer':
    case 'graphEngine':
    case 'consolidator':
      return 'intelligence';
    default:
      return 'intelligence';
  }
}

/** Short SDK-level description of the engines surface. */
export function enginesDescription(): string {
  return `${engineModuleNames().length} engine modules (memory, knowledge, observability, context, security, tools, mcp, token-optimization, intelligence)`;
}