/**
 * MAM System wiring.
 *
 * Integrates all standalone engine packages into a single MAM system facade:
 *
 * - the core runtime (`MAMV2Runtime`)
 * - memory-engine      (working/short-term/long-term/episodic/semantic memory)
 * - knowledge-engine   (sources, ranking, retrieval, RAG, provenance)
 * - observability      (traces, metrics, token usage, costs, evaluation)
 * - context-engine     (assembly, token budgeting, compression, summarization, prioritization)
 * - security           (auth, authorization, policy, audit)
 * - tool-engine        (discovery, permissions, invocation, validation)
 * - mcp                (protocol, server, client, tools)
 * - token-optimization (estimation, budgeting, compression, caching, optimization)
 * - intelligence-layer (query understanding, grounding, synthesis, graph, integration)
 *
 * Every subsystem is exposed both as a module namespace (`system.modules`) and
 * as a pre-wired default engine registered under a stable name
 * (`system.registry` / typed getters). `createMAMSystem()` wires the defaults
 * and returns a ready-to-use system.
 */

import { EventEmitter } from 'node:events';

import * as memory from '@mam/memory-engine';
import * as knowledge from '@mam/knowledge-engine';
import * as observability from '@mam/observability';
import * as context from '@mam/context-engine';
import * as security from '@mam/security';
import * as toolEngine from '@mam/tool-engine';
import * as mcp from '@mam/mcp';
import * as tokenOptimization from '@mam/token-optimization';
import * as intelligence from '@mam/intelligence-layer';

import * as ast from '@mam/ast';
import * as parser from '@mam/parser';
import * as compiler from '@mam/compiler';
import * as validator from '@mam/validator';
import * as visualization from '@mam/visualization';
import * as packageManager from '@mam/package-manager';
import * as testing from '@mam/testing';

import { createV2Runtime, MAMV2Runtime } from './runtime.js';

/**
 * Namespace access to every standalone engine package, so callers can build
 * custom engines from each module's full API.
 */
export interface MAMSystemModules {
  /** memory-engine package namespace. */
  readonly memory: typeof memory;
  /** knowledge-engine package namespace. */
  readonly knowledge: typeof knowledge;
  /** observability package namespace. */
  readonly observability: typeof observability;
  /** context-engine package namespace. */
  readonly context: typeof context;
  /** security package namespace. */
  readonly security: typeof security;
  /** tool-engine package namespace. */
  readonly toolEngine: typeof toolEngine;
  /** mcp package namespace. */
  readonly mcp: typeof mcp;
  /** token-optimization package namespace. */
  readonly tokenOptimization: typeof tokenOptimization;
  /** intelligence-layer package namespace. */
  readonly intelligence: typeof intelligence;

  // --- Language toolchain ---------------------------------------------------
  /** ast package namespace. */
  readonly ast: typeof ast;
  /** parser package namespace. */
  readonly parser: typeof parser;
  /** compiler package namespace. */
  readonly compiler: typeof compiler;
  /** validator package namespace. */
  readonly validator: typeof validator;
  /** visualization package namespace. */
  readonly visualization: typeof visualization;
  /** package-manager package namespace. */
  readonly packageManager: typeof packageManager;
  /** testing package namespace. */
  readonly testing: typeof testing;
}

/**
 * Options for building a {@link MAMSystem}.
 */
export interface MAMSystemOptions {
  /** Configuration forwarded to {@link createV2Runtime}. */
  runtimeConfig?: Parameters<typeof createV2Runtime>[0];
  /** When `true` (default), pre-wired default engines are registered. */
  autoWire?: boolean;
}

/**
 * A fully-wired MAM system: the core runtime plus every standalone engine,
 * with a shared registry and event bus.
 */
export class MAMSystem {
  /** Namespace access to every engine package. */
  readonly modules: MAMSystemModules;

  /** The core runtime. */
  readonly runtime: MAMV2Runtime;

  /** Shared event bus for system lifecycle events. */
  readonly events = new EventEmitter();

  /** Named registry of wired engines. */
  readonly registry = new Map<string, unknown>();

  /**
   * Create a system. When `options.autoWire !== false`, default engines are
   * registered under their canonical names.
   *
   * @param options - runtime config / auto-wire control.
   */
  constructor(options: MAMSystemOptions = {}) {
    this.modules = {
      memory,
      knowledge,
      observability,
      context,
      security,
      toolEngine,
      mcp,
      tokenOptimization,
      intelligence,
      ast,
      parser,
      compiler,
      validator,
      visualization,
      packageManager,
      testing,
    };
    this.runtime = createV2Runtime(options.runtimeConfig);
    this.register('runtime', this.runtime);
    if (options.autoWire !== false) {
      this.wireDefaults();
    }
  }

  /**
   * Register an engine under a canonical name and emit a `registered` event.
   *
   * @param name - canonical engine name.
   * @param engine - the engine instance.
   * @returns this system, for chaining.
   */
  register(name: string, engine: unknown): this {
    this.registry.set(name, engine);
    this.events.emit('registered', { name, at: Date.now() });
    return this;
  }

  /**
   * Retrieve a registered engine by name.
   *
   * @param name - canonical engine name.
   * @returns the engine, or `undefined` when not registered.
   */
  get<T = unknown>(name: string): T | undefined {
    return this.registry.get(name) as T | undefined;
  }

  /**
   * Whether an engine is registered.
   *
   * @param name - canonical engine name.
   */
  has(name: string): boolean {
    return this.registry.has(name);
  }

  /**
   * All registered engine names, in registration order.
   */
  list(): string[] {
    return [...this.registry.keys()];
  }

  /**
   * Register every default engine under its canonical name. Idempotent —
   * re-registering replaces the prior instance and emits `registered` again.
   */
  wireDefaults(): this {
    this.register('memory', memory.createWorkingMemory(24 * 60 * 60 * 1000));
    this.register('knowledge', knowledge.createSourceAdapter());
    this.register('tracer', observability.createTracer());
    this.register('metrics', observability.createMetricsRegistry());
    this.register('costs', observability.createCostTracker());
    this.register('evaluator', observability.createEvaluator());
    this.register('tokenUsage', observability.createTokenUsageTracker());
    this.register('contextAssembler', context.createContextAssembler());
    this.register('tokenBudgeter', context.createTokenBudgeter());
    this.register('prioritizer', context.createPrioritizer());
    this.register('authenticator', security.createAuthenticator());
    this.register('authorizer', security.createAuthorizer());
    this.register('audit', security.createAuditLogger());
    this.register('policy', security.createSecurityPolicyEngine());
    this.register('toolDiscovery', toolEngine.createToolDiscovery());
    this.register('toolAuthorizer', toolEngine.createToolAuthorizer());
    this.register('toolInvoker', toolEngine.createToolInvoker());
    this.register('toolValidator', toolEngine.createToolValidator());
    this.register('mcpServer', mcp.createMcpServer());
    this.register('cacheManager', tokenOptimization.createCacheManager());
    this.register('promptOptimizer', new tokenOptimization.PromptOptimizer());
    this.register('queryAnalyzer', new intelligence.QueryAnalyzer());
    this.register('groundednessScorer', new intelligence.GroundednessScorer());
    this.register('answerSynthesizer', new intelligence.AnswerSynthesizer());
    this.register('graphEngine', new intelligence.GraphEngine());
    this.register('consolidator', new intelligence.Consolidator());

    // Language toolchain engines
    this.register('parse', parser.parseMAM);
    this.register('validate', validator.validate);
    this.register('compiler', new compiler.MAMCompiler());
    this.register('validator', new validator.MAMValidator());
    this.register('visualizer', new visualization.GraphVisualizer());
    this.register('matcher', new testing.MAMMatcher());
    return this;
  }

  // --- Typed accessors for the pre-wired default engines --------------------

  /** Pre-wired working memory engine. */
  get workingMemory(): ReturnType<typeof memory.createWorkingMemory> | undefined {
    return this.get('memory');
  }

  /** Pre-wired knowledge source adapter. */
  get knowledgeSource(): ReturnType<typeof knowledge.createSourceAdapter> | undefined {
    return this.get('knowledge');
  }

  /** Pre-wired trace recorder (tracer adapter). */
  get tracer(): ReturnType<typeof observability.createTracer> | undefined {
    return this.get('tracer');
  }

  /** Pre-wired metrics registry. */
  get metrics(): ReturnType<typeof observability.createMetricsRegistry> | undefined {
    return this.get('metrics');
  }

  /** Pre-wired cost tracker. */
  get costs(): ReturnType<typeof observability.createCostTracker> | undefined {
    return this.get('costs');
  }

  /** Pre-wired evaluation evaluator. */
  get evaluator(): ReturnType<typeof observability.createEvaluator> | undefined {
    return this.get('evaluator');
  }

  /** Pre-wired token usage tracker. */
  get tokenUsage(): ReturnType<typeof observability.createTokenUsageTracker> | undefined {
    return this.get('tokenUsage');
  }

  /** Pre-wired context assembler. */
  get contextAssembler(): ReturnType<typeof context.createContextAssembler> | undefined {
    return this.get('contextAssembler');
  }

  /** Pre-wired token budgeter. */
  get tokenBudgeter(): ReturnType<typeof context.createTokenBudgeter> | undefined {
    return this.get('tokenBudgeter');
  }

  /** Pre-wired prioritizer. */
  get prioritizer(): ReturnType<typeof context.createPrioritizer> | undefined {
    return this.get('prioritizer');
  }

  /** Pre-wired authenticator. */
  get authenticator(): ReturnType<typeof security.createAuthenticator> | undefined {
    return this.get('authenticator');
  }

  /** Pre-wired authorizer. */
  get authorizer(): ReturnType<typeof security.createAuthorizer> | undefined {
    return this.get('authorizer');
  }

  /** Pre-wired audit logger. */
  get audit(): ReturnType<typeof security.createAuditLogger> | undefined {
    return this.get('audit');
  }

  /** Pre-wired security policy engine. */
  get policy(): ReturnType<typeof security.createSecurityPolicyEngine> | undefined {
    return this.get('policy');
  }

  /** Pre-wired tool discovery. */
  get toolDiscovery(): ReturnType<typeof toolEngine.createToolDiscovery> | undefined {
    return this.get('toolDiscovery');
  }

  /** Pre-wired tool authorizer. */
  get toolAuthorizer(): ReturnType<typeof toolEngine.createToolAuthorizer> | undefined {
    return this.get('toolAuthorizer');
  }

  /** Pre-wired tool invoker. */
  get toolInvoker(): ReturnType<typeof toolEngine.createToolInvoker> | undefined {
    return this.get('toolInvoker');
  }

  /** Pre-wired tool validator. */
  get toolValidator(): ReturnType<typeof toolEngine.createToolValidator> | undefined {
    return this.get('toolValidator');
  }

  /** Pre-wired MCP server. */
  get mcpServer(): ReturnType<typeof mcp.createMcpServer> | undefined {
    return this.get('mcpServer');
  }

  /** Pre-wired cache manager. */
  get cacheManager(): ReturnType<typeof tokenOptimization.createCacheManager> | undefined {
    return this.get('cacheManager');
  }

  /** Pre-wired prompt optimizer. */
  get promptOptimizer(): tokenOptimization.PromptOptimizer | undefined {
    return this.get('promptOptimizer');
  }

  /** Pre-wired query analyzer. */
  get queryAnalyzer(): intelligence.QueryAnalyzer | undefined {
    return this.get('queryAnalyzer');
  }

  /** Pre-wired groundedness scorer. */
  get groundednessScorer(): intelligence.GroundednessScorer | undefined {
    return this.get('groundednessScorer');
  }

  /** Pre-wired answer synthesizer. */
  get answerSynthesizer(): intelligence.AnswerSynthesizer | undefined {
    return this.get('answerSynthesizer');
  }

  /** Pre-wired graph engine. */
  get graphEngine(): intelligence.GraphEngine | undefined {
    return this.get('graphEngine');
  }

  /** Pre-wired knowledge consolidator. */
  get consolidator(): intelligence.Consolidator | undefined {
    return this.get('consolidator');
  }

  // --- Toolchain accessors --------------------------------------------------

  /** Pre-wired MAM parser (`parseMAM`). */
  get parse(): typeof parser.parseMAM | undefined {
    return this.get('parse');
  }

  /** Pre-wired MAM validator (`validate`). */
  get validate(): typeof validator.validate | undefined {
    return this.get('validate');
  }

  /** Pre-wired MAM compiler instance. */
  get compiler(): compiler.MAMCompiler | undefined {
    return this.get('compiler');
  }

  /** Pre-wired MAM validator instance. */
  get validator(): validator.MAMValidator | undefined {
    return this.get('validator');
  }

  /** Pre-wired graph visualizer. */
  get visualizer(): visualization.GraphVisualizer | undefined {
    return this.get('visualizer');
  }

  /** Pre-wired test matcher. */
  get matcher(): testing.MAMMatcher | undefined {
    return this.get('matcher');
  }

  /**
   * LSP server metadata. Loaded lazily because `@mam/lsp`'s entry point
   * starts a server connection on import, so it must only be loaded in an
   * actual LSP context.
   *
   * @returns server name + version.
   */
  async getLspInfo(): Promise<{ name: string; version: string }> {
    const lsp = await import('@mam/lsp');
    return lsp.getMAMServerInfo();
  }
}

/**
 * Build a fully-wired MAM system with default engines pre-registered.
 *
 * @param options - runtime config / auto-wire control.
 * @returns a ready-to-use {@link MAMSystem}.
 */
export function createMAMSystem(options?: MAMSystemOptions): MAMSystem {
  return new MAMSystem(options);
}