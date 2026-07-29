/**
 * MAM Workflow Section Node
 *
 * Defines the WorkflowNode and related types for the Workflow section.
 * A workflow describes a directed graph of steps (agents/actions) connected
 * by edges, forming an executable process.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** A single step in the workflow. */
export interface WorkflowStep {
  /** Step name (unique within the workflow). */
  name: string;
  /** Human-readable description. */
  description?: string;
  /** Agent or module responsible for this step. */
  agent?: string;
  /** Tool to execute (alternative to agent). */
  tool?: string;
  /** Action/command to invoke. */
  action?: string;
  /** Input mapping (step-local name -> source expression). */
  inputs?: Record<string, string>;
  /** Output mapping (step-local name -> target expression). */
  outputs?: Record<string, string>;
  /** Conditional expression; step runs only when truthy. */
  condition?: string;
  /** Number of retry attempts on failure. */
  retry?: number;
  /** Timeout string (e.g. "30s", "5m"). */
  timeout?: string;
}

/** A directed edge connecting two steps. */
export interface WorkflowEdge {
  /** Source step name. */
  from: string;
  /** Target step name. */
  to: string;
  /** Label displayed on the edge. */
  label?: string;
  /** Conditional expression; edge is taken only when truthy. */
  condition?: string;
}

/** Workflow-level configuration. */
export interface WorkflowConfig {
  /** Execution strategy. */
  strategy?: 'sequential' | 'parallel' | 'dag';
  /** Maximum concurrency (for parallel/dag strategies). */
  maxConcurrency?: number;
  /** Global timeout for the entire workflow. */
  timeout?: string;
  /** Whether to stop on first failure. */
  failFast?: boolean;
}

/** The Workflow section AST node. */
export interface WorkflowNode {
  /** Discriminant – always `'Workflow'`. */
  type: 'Workflow';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of workflow steps. */
  steps: WorkflowStep[];
  /** Directed edges between steps. */
  edges?: WorkflowEdge[];
  /** Workflow configuration. */
  config?: WorkflowConfig;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a WorkflowNode.
 * Returns an empty array when the node is valid.
 */
export function validateWorkflowNode(node: WorkflowNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'WorkflowNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Workflow') {
    errors.push({ path: 'type', message: `Expected type "Workflow", got "${node.type}".` });
  }

  if (!Array.isArray(node.steps)) {
    errors.push({ path: 'steps', message: 'steps must be an array.' });
    return errors;
  }

  const stepNames = new Set<string>();
  node.steps.forEach((step, idx) => {
    const base = `steps[${idx}]`;

    if (!step.name || typeof step.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'step name must be a non-empty string.' });
    } else if (stepNames.has(step.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate step name "${step.name}".` });
    } else {
      stepNames.add(step.name);
    }

    if (step.retry !== undefined && (typeof step.retry !== 'number' || step.retry < 0)) {
      errors.push({ path: `${base}.retry`, message: 'retry must be a non-negative number.' });
    }
  });

  if (node.edges) {
    if (!Array.isArray(node.edges)) {
      errors.push({ path: 'edges', message: 'edges must be an array.' });
    } else {
      node.edges.forEach((edge, idx) => {
        const base = `edges[${idx}]`;

        if (!edge.from || typeof edge.from !== 'string') {
          errors.push({ path: `${base}.from`, message: 'edge from must be a non-empty string.' });
        } else if (!stepNames.has(edge.from)) {
          errors.push({ path: `${base}.from`, message: `edge from "${edge.from}" references unknown step.` });
        }

        if (!edge.to || typeof edge.to !== 'string') {
          errors.push({ path: `${base}.to`, message: 'edge to must be a non-empty string.' });
        } else if (!stepNames.has(edge.to)) {
          errors.push({ path: `${base}.to`, message: `edge to "${edge.to}" references unknown step.` });
        }
      });
    }
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateWorkflowNodeOptions {
  steps?: WorkflowStep[];
  edges?: WorkflowEdge[];
  config?: WorkflowConfig;
  location?: SourceLocation;
}

/** Create a WorkflowNode with sensible defaults. */
export function createWorkflowNode(options: CreateWorkflowNodeOptions = {}): WorkflowNode {
  return {
    type: 'Workflow',
    steps: options.steps ?? [],
    edges: options.edges,
    config: options.config,
    location: options.location,
  };
}

/** Create a single WorkflowStep. */
export function createWorkflowStep(
  name: string,
  overrides: Partial<Omit<WorkflowStep, 'name'>> = {},
): WorkflowStep {
  return { name, ...overrides };
}

/** Create a single WorkflowEdge. */
export function createWorkflowEdge(
  from: string,
  to: string,
  overrides: Partial<Omit<WorkflowEdge, 'from' | 'to'>> = {},
): WorkflowEdge {
  return { from, to, ...overrides };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a WorkflowNode. */
export function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as WorkflowNode).type === 'Workflow' &&
    Array.isArray((value as WorkflowNode).steps)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all step names. */
export function getStepNames(node: WorkflowNode): string[] {
  return node.steps.map((s) => s.name);
}

/** Find a step by name. */
export function findStepByName(node: WorkflowNode, name: string): WorkflowStep | undefined {
  return node.steps.find((s) => s.name === name);
}

/** Return steps that have no incoming edges (roots). */
export function getRootSteps(node: WorkflowNode): WorkflowStep[] {
  const targets = new Set((node.edges ?? []).map((e) => e.to));
  return node.steps.filter((s) => !targets.has(s.name));
}

/** Return steps that have no outgoing edges (leaves). */
export function getLeafSteps(node: WorkflowNode): WorkflowStep[] {
  const sources = new Set((node.edges ?? []).map((e) => e.from));
  return node.steps.filter((s) => !sources.has(s.name));
}

/** Return the direct successors of a step. */
export function getSuccessors(node: WorkflowNode, stepName: string): string[] {
  return (node.edges ?? [])
    .filter((e) => e.from === stepName)
    .map((e) => e.to);
}

/** Return the direct predecessors of a step. */
export function getPredecessors(node: WorkflowNode, stepName: string): string[] {
  return (node.edges ?? [])
    .filter((e) => e.to === stepName)
    .map((e) => e.from);
}

/** Check whether the workflow contains a cycle (DFS-based). */
export function hasCycle(node: WorkflowNode): boolean {
  const visited = new Set<string>();
  const inStack = new Set<string>();

  const adjacency = new Map<string, string[]>();
  for (const step of node.steps) {
    adjacency.set(step.name, []);
  }
  for (const edge of node.edges ?? []) {
    adjacency.get(edge.from)?.push(edge.to);
  }

  function dfs(current: string): boolean {
    visited.add(current);
    inStack.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (inStack.has(neighbor)) return true;
      if (!visited.has(neighbor) && dfs(neighbor)) return true;
    }
    inStack.delete(current);
    return false;
  }

  for (const step of node.steps) {
    if (!visited.has(step.name) && dfs(step.name)) {
      return true;
    }
  }
  return false;
}

/** Return a topological ordering of steps (throws if cycle exists). */
export function topologicalSort(node: WorkflowNode): string[] {
  const inDegree = new Map<string, number>();
  for (const step of node.steps) {
    inDegree.set(step.name, 0);
  }
  for (const edge of node.edges ?? []) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push(name);
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);
    for (const edge of node.edges ?? []) {
      if (edge.from === current) {
        const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, newDeg);
        if (newDeg === 0) queue.push(edge.to);
      }
    }
  }

  if (result.length !== node.steps.length) {
    throw new Error('Workflow contains a cycle; topological sort is not possible.');
  }

  return result;
}

/** Count steps and edges. */
export function countWorkflowElements(node: WorkflowNode): { steps: number; edges: number } {
  return {
    steps: node.steps.length,
    edges: node.edges?.length ?? 0,
  };
}
