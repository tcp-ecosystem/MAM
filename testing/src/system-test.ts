/**
 * MAM System Test
 * 
 * Tests complete MAM systems (multi-module).
 */

import { readFile } from 'node:fs/promises';
import { parseMAM } from '@mam/parser';
import { analyzeSemantics } from '@mam/compiler';
import { V2ModuleNode, V2WorkflowNode, V2SystemNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface SystemTestConfig {
  /** System file path */
  file: string;
  /** Test name */
  name?: string;
  /** Expected module count */
  expectedModules?: number;
  /** Expected agents */
  expectedAgents?: string[];
  /** Expected edges */
  expectedEdges?: Array<{ from: string; to: string }>;
}

export interface SystemTestResult {
  /** Test name */
  name: string;
  /** Test success */
  success: boolean;
  /** Test errors */
  errors: string[];
  /** Test warnings */
  warnings: string[];
  /** Test stats */
  stats: {
    parseTimeMs: number;
    analyzeTimeMs: number;
    moduleCount: number;
    edgeCount: number;
  };
}

// ============================================================================
// System Test
// ============================================================================

export class SystemTest {
  /**
   * Test a system file
   */
  static async test(config: SystemTestConfig): Promise<SystemTestResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const startTime = performance.now();

    try {
      const content = await readFile(config.file, 'utf-8');
      
      // Parse
      const parseStart = performance.now();
      const parseResult = parseMAM(content, { source: config.file });
      const parseTimeMs = performance.now() - parseStart;

      // Collect parse errors
      for (const error of parseResult.errors) {
        errors.push(error.message);
      }

      // Analyze semantics
      const analyzeStart = performance.now();
      const semanticResult = analyzeSemantics(parseResult.ast.sections as any);
      const analyzeTimeMs = performance.now() - analyzeStart;

      // Collect semantic errors
      for (const error of semanticResult.errors) {
        errors.push(error.message);
      }
      for (const warning of semanticResult.warnings) {
        warnings.push(warning.message);
      }

      // Check expected modules
      if (config.expectedModules) {
        const actualCount = parseResult.ast.sections.length;
        if (actualCount !== config.expectedModules) {
          errors.push(`Expected ${config.expectedModules} modules, got ${actualCount}`);
        }
      }

      // Count edges
      let edgeCount = 0;
      for (const section of parseResult.ast.sections) {
        // In v2, edges would be in the module nodes
        edgeCount += semanticResult.stats.edgesValidated;
      }

      return {
        name: config.name || config.file,
        success: errors.length === 0,
        errors,
        warnings,
        stats: {
          parseTimeMs,
          analyzeTimeMs,
          moduleCount: parseResult.ast.sections.length,
          edgeCount,
        },
      };
    } catch (error) {
      return {
        name: config.name || config.file,
        success: false,
        errors: [(error as Error).message],
        warnings,
        stats: {
          parseTimeMs: 0,
          analyzeTimeMs: 0,
          moduleCount: 0,
          edgeCount: 0,
        },
      };
    }
  }

  /**
   * Test multiple systems
   */
  static async testAll(configs: SystemTestConfig[]): Promise<SystemTestResult[]> {
    const results: SystemTestResult[] = [];
    for (const config of configs) {
      results.push(await this.test(config));
    }
    return results;
  }
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/** Error thrown by the system assertion helpers */
export class SystemAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemAssertionError';
  }
}

export interface ModulePresenceOptions {
  /** Expected module type (agent, tool, workflow, memory, ...) */
  moduleType?: string;
  /** Custom message prefix for assertion failures */
  message?: string;
}

/**
 * Assert that a named module is present in a set of v2 modules, optionally
 * verifying its type. Returns the module or throws `SystemAssertionError`.
 */
export function assertModulePresent(modules: V2ModuleNode[], name: string, options: ModulePresenceOptions = {}): V2ModuleNode {
  const module = modules.find((mod) => mod.name === name);
  if (!module) {
    throw new SystemAssertionError(`${options.message ?? 'Expected module'} "${name}" to be present, but it was not found`);
  }
  if (options.moduleType && module.moduleType !== options.moduleType) {
    throw new SystemAssertionError(`Module "${name}" has type "${module.moduleType}", expected "${options.moduleType}"`);
  }
  return module;
}

export interface AgentPresenceOptions {
  /** Custom message prefix for assertion failures */
  message?: string;
  /** Whether a role must be defined on the agent */
  requireRole?: boolean;
}

/**
 * Assert that an agent module (moduleType `agent`) is present and optionally
 * defines a role. Returns the module or throws `SystemAssertionError`.
 */
export function assertAgentPresent(modules: V2ModuleNode[], agentName: string, options: AgentPresenceOptions = {}): V2ModuleNode {
  const agent = assertModulePresent(modules, agentName, {
    moduleType: 'agent',
    message: options.message,
  });
  if (options.requireRole && !agent.role) {
    throw new SystemAssertionError(`Agent "${agentName}" is present but defines no role`);
  }
  return agent;
}

// ============================================================================
// Module / Edge Collection
// ============================================================================

/** Return module names from either a v1 AST or a v2 module array */
export function getModuleNames(ast: { sections: Array<{ name: string }> } | V2ModuleNode[]): string[] {
  if (Array.isArray(ast)) return ast.map((mod) => mod.name);
  return ast.sections.map((section) => section.name);
}

/**
 * Extract `from -> to` edges from a Mermaid code block inside a MAM AST.
 * Recognizes simple adjacency lines such as `a --> b`.
 */
export function extractMermaidEdges(ast: { sections: Array<{ name: string; content: unknown[] }> }): Array<{ from: string; to: string }> {
  const edges: Array<{ from: string; to: string }> = [];
  const mermaid = ast.sections.find((section) => section.name === 'Mermaid');
  if (!mermaid) return edges;

  for (const node of mermaid.content) {
    const candidate = node as { type: string; value?: unknown };
    if (candidate.type !== 'codeblock' && candidate.type !== 'CodeBlock') continue;
    const text = typeof candidate.value === 'string' ? candidate.value : '';
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*-->\s*([A-Za-z0-9_-]+)\s*$/);
      if (match) edges.push({ from: match[1]!, to: match[2]! });
    }
  }
  return edges;
}

// ============================================================================
// Scenario Runner
// ============================================================================

export interface ScenarioCheck {
  /** Check label, e.g. `module:research` */
  name: string;
  /** Whether the check passed */
  present: boolean;
  /** Optional detail message */
  message?: string;
}

export interface SystemScenario {
  /** Scenario name */
  name: string;
  /** Human readable description */
  description?: string;
  /** Inputs passed to the scenario */
  input?: unknown;
  /** Modules that must be present */
  expectedModules?: string[];
  /** Agents that must be present */
  expectedAgents?: string[];
  /** Edges that must be present */
  expectedEdges?: Array<{ from: string; to: string }>;
}

export interface ScenarioResult {
  /** Scenario name */
  name: string;
  /** Overall success */
  success: boolean;
  /** Errors encountered */
  errors: string[];
  /** Warnings encountered */
  warnings: string[];
  /** Duration in milliseconds */
  durationMs: number;
  /** Individual presence checks */
  checks: ScenarioCheck[];
}

/**
 * Run a named scenario against a system file. Reuses `SystemTest.test` for the
 * base parse/analyze pass, then verifies module/agent/edge presence from the
 * parsed AST.
 */
export async function runScenario(config: SystemTestConfig, scenario: SystemScenario): Promise<ScenarioResult> {
  const startTime = performance.now();
  const errors: string[] = [];
  const warnings: string[] = [];
  const checks: ScenarioCheck[] = [];

  const base = await SystemTest.test(config);
  errors.push(...base.errors);
  warnings.push(...base.warnings);

  let moduleNames: string[] = [];
  let edgeList: Array<{ from: string; to: string }> = [];
  try {
    const content = await readFile(config.file, 'utf-8');
    const parseResult = parseMAM(content, { source: config.file });
    moduleNames = getModuleNames(parseResult.ast);
    edgeList = extractMermaidEdges(parseResult.ast as any);
  } catch (error) {
    errors.push((error as Error).message);
  }

  if (scenario.expectedModules) {
    for (const expected of scenario.expectedModules) {
      const present = moduleNames.includes(expected);
      checks.push({ name: `module:${expected}`, present, message: present ? undefined : `Missing module "${expected}"` });
      if (!present) errors.push(`Scenario "${scenario.name}" expected module "${expected}"`);
    }
  }

  if (scenario.expectedAgents) {
    for (const expected of scenario.expectedAgents) {
      const present = moduleNames.includes(expected);
      checks.push({ name: `agent:${expected}`, present, message: present ? undefined : `Missing agent "${expected}"` });
      if (!present) errors.push(`Scenario "${scenario.name}" expected agent "${expected}"`);
    }
  }

  if (scenario.expectedEdges) {
    for (const expected of scenario.expectedEdges) {
      const present = edgeList.some((edge) => edge.from === expected.from && edge.to === expected.to);
      checks.push({
        name: `edge:${expected.from}->${expected.to}`,
        present,
        message: present ? undefined : `Missing edge ${expected.from} -> ${expected.to}`,
      });
      if (!present) errors.push(`Scenario "${scenario.name}" expected edge ${expected.from} -> ${expected.to}`);
    }
  }

  return {
    name: scenario.name,
    success: errors.length === 0,
    errors,
    warnings,
    durationMs: performance.now() - startTime,
    checks,
  };
}

/** Run every scenario in a list against the same system file */
export async function runScenarios(config: SystemTestConfig, scenarios: SystemScenario[]): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(config, scenario));
  }
  return results;
}

// ============================================================================
// Workflow Verification
// ============================================================================

export interface WorkflowExpectation {
  /** Steps that must be present */
  steps?: string[];
  /** Edges that must be present */
  edges?: Array<{ from: string; to: string }>;
  /** Agents that must be referenced by at least one step */
  agents?: string[];
}

export interface WorkflowVerification {
  /** Workflow/module name */
  workflow: string;
  /** Whether all expectations were satisfied */
  valid: boolean;
  /** Steps found in the workflow */
  presentSteps: string[];
  /** Expected steps that were missing */
  missingSteps: string[];
  /** Edges found in the workflow */
  presentEdges: Array<{ from: string; to: string }>;
  /** Expected edges that were missing */
  missingEdges: Array<{ from: string; to: string }>;
  /** Human readable descriptions of every problem found */
  issues: string[];
}

/**
 * Verify that a workflow (v2 workflow node or module) contains the expected
 * steps, edges, and agent references. Returns a structured report instead of
 * throwing.
 */
export function verifyWorkflow(workflow: V2ModuleNode | V2WorkflowNode, expected: WorkflowExpectation = {}): WorkflowVerification {
  const node = workflow as V2ModuleNode;
  const name = workflow.name;
  const steps = node.steps ?? [];
  const edges = node.edges ?? [];

  const presentSteps = steps.map((step) => step.name);
  const presentEdges = edges.map((edge) => ({ from: edge.source, to: edge.target }));

  const missingSteps: string[] = [];
  for (const step of expected.steps ?? []) {
    if (!presentSteps.includes(step)) missingSteps.push(step);
  }

  const missingEdges: Array<{ from: string; to: string }> = [];
  for (const edge of expected.edges ?? []) {
    if (!presentEdges.some((e) => e.from === edge.from && e.to === edge.to)) missingEdges.push(edge);
  }

  const stepAgents = steps.map((step) => step.agent).filter((agent): agent is string => typeof agent === 'string');
  const missingAgents = (expected.agents ?? []).filter((agent) => !stepAgents.includes(agent));

  const issues: string[] = [];
  for (const step of missingSteps) issues.push(`Missing step "${step}"`);
  for (const edge of missingEdges) issues.push(`Missing edge ${edge.from} -> ${edge.to}`);
  for (const agent of missingAgents) issues.push(`No step references agent "${agent}"`);

  return {
    workflow: name,
    valid: issues.length === 0,
    presentSteps,
    missingSteps,
    presentEdges,
    missingEdges,
    issues,
  };
}

// ============================================================================
// System Verification
// ============================================================================

export interface SystemExpectation {
  /** Modules that must be present */
  modules?: string[];
  /** Agents that must be present */
  agents?: string[];
  /** Edges that must be present */
  edges?: Array<{ from: string; to: string }>;
}

export interface SystemVerification {
  /** Whether all expectations were satisfied */
  valid: boolean;
  /** Human readable descriptions of every problem found */
  issues: string[];
  /** Modules found */
  presentModules: string[];
  /** Expected modules that were missing */
  missingModules: string[];
  /** Agents found */
  presentAgents: string[];
  /** Expected agents that were missing */
  missingAgents: string[];
  /** Edges found */
  presentEdges: Array<{ from: string; to: string }>;
  /** Expected edges that were missing */
  missingEdges: Array<{ from: string; to: string }>;
}

/**
 * Verify module, agent, and edge presence against a parsed MAM AST.
 */
export function verifySystem(ast: { sections: Array<{ name: string; content: unknown[] }> }, expected: SystemExpectation = {}): SystemVerification {
  const moduleNames = getModuleNames(ast);
  const edges = extractMermaidEdges(ast);

  const presentModules = moduleNames;
  const missingModules = (expected.modules ?? []).filter((name) => !moduleNames.includes(name));

  const presentAgents = moduleNames;
  const missingAgents = (expected.agents ?? []).filter((name) => !moduleNames.includes(name));

  const presentEdges = edges;
  const missingEdges = (expected.edges ?? []).filter(
    (edge) => !edges.some((e) => e.from === edge.from && e.to === edge.to)
  );

  const issues: string[] = [];
  for (const module of missingModules) issues.push(`Missing module "${module}"`);
  for (const agent of missingAgents) issues.push(`Missing agent "${agent}"`);
  for (const edge of missingEdges) issues.push(`Missing edge ${edge.from} -> ${edge.to}`);

  return {
    valid: issues.length === 0,
    issues,
    presentModules,
    missingModules,
    presentAgents,
    missingAgents,
    presentEdges,
    missingEdges,
  };
}

// ============================================================================
// Agent Result Collection
// ============================================================================

export interface AgentResult {
  /** Agent name */
  name: string;
  /** Whether a matching agent module was found */
  present: boolean;
  /** Module type of the definition */
  moduleType?: string;
  /** Role defined on the module */
  role?: string;
  /** Goal defined on the module */
  goal?: string;
  /** Description of why the agent is missing */
  error?: string;
}

/**
 * Resolve every agent referenced by a v2 system node against a set of module
 * definitions, producing one `AgentResult` per agent.
 */
export function collectAgentResults(system: V2SystemNode, modules: V2ModuleNode[]): AgentResult[] {
  const agentNames = system.agents ?? [];
  const results: AgentResult[] = [];

  for (const name of agentNames) {
    const definition = modules.find((mod) => mod.name === name && mod.moduleType === 'agent');
    if (definition) {
      results.push({
        name,
        present: true,
        moduleType: definition.moduleType,
        role: definition.role,
        goal: definition.goal,
      });
    } else {
      results.push({ name, present: false, error: `No agent module named "${name}" was found` });
    }
  }
  return results;
}

// ============================================================================
// Reporting + Summary
// ============================================================================

export interface SystemTestReporterOptions {
  /** Output sink; defaults to `console.log` */
  stream?: { write(line: string): void };
  /** Include warnings */
  showWarnings?: boolean;
  /** Include errors */
  showErrors?: boolean;
}

/**
 * Renders system test and scenario results into a human readable report.
 */
export class SystemTestReporter {
  private readonly options: SystemTestReporterOptions;

  constructor(options: SystemTestReporterOptions = {}) {
    this.options = {
      stream: { write: (line: string) => console.log(line) },
      showWarnings: true,
      showErrors: true,
      ...options,
    };
  }

  /** Build the report text without writing anywhere */
  render(results: Array<SystemTestResult | ScenarioResult>): string {
    const lines: string[] = [];
    lines.push('MAM System Test Report');
    lines.push('='.repeat(44));

    for (const result of results) {
      const status = result.success ? 'PASS' : 'FAIL';
      const duration = 'stats' in result ? result.stats.parseTimeMs + result.stats.analyzeTimeMs : result.durationMs;
      lines.push(`[${status}] ${result.name} (${duration.toFixed(1)}ms)`);

      if (this.options.showWarnings) {
        for (const warning of result.warnings) {
          lines.push(`       warning: ${warning}`);
        }
      }
      if (this.options.showErrors) {
        for (const error of result.errors) {
          lines.push(`       error: ${error}`);
        }
      }
      if ('checks' in result) {
        for (const check of result.checks) {
          lines.push(`       ${check.present ? 'ok  ' : 'FAIL'} ${check.name}`);
        }
      }
    }

    const summary = systemTestSummary(results);
    lines.push('='.repeat(44));
    lines.push(
      `Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}  Modules: ${summary.moduleCount}  Edges: ${summary.edgeCount}  (${summary.durationMs.toFixed(1)}ms)`
    );
    return lines.join('\n');
  }

  /** Render and write the report to the configured stream */
  report(results: Array<SystemTestResult | ScenarioResult>, options?: SystemTestReporterOptions): void {
    const stream = options?.stream ?? this.options.stream;
    stream.write(this.render(results));
  }
}

export interface SystemTestSummary {
  /** Total results */
  total: number;
  /** Passing results */
  passed: number;
  /** Failing results */
  failed: number;
  /** Aggregate duration in milliseconds */
  durationMs: number;
  /** Total module count across results */
  moduleCount: number;
  /** Total edge count across results */
  edgeCount: number;
  /** Total warning count across results */
  warningCount: number;
}

/**
 * Aggregate system test and scenario results into a compact summary.
 */
export function systemTestSummary(results: Array<SystemTestResult | ScenarioResult>, options: { durationMs?: number } = {}): SystemTestSummary {
  const summary: SystemTestSummary = {
    total: results.length,
    passed: 0,
    failed: 0,
    durationMs: options.durationMs ?? 0,
    moduleCount: 0,
    edgeCount: 0,
    warningCount: 0,
  };

  for (const result of results) {
    if (result.success) summary.passed++;
    else summary.failed++;
    summary.warningCount += result.warnings.length;

    if ('stats' in result) {
      summary.moduleCount += result.stats.moduleCount;
      summary.edgeCount += result.stats.edgeCount;
      summary.durationMs += result.stats.parseTimeMs + result.stats.analyzeTimeMs;
    } else {
      summary.durationMs += result.durationMs;
    }
  }
  return summary;
}