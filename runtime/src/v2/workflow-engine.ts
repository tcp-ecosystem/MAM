/**
 * MAM Workflow Engine
 *
 * Standalone engine for executing workflow steps, managing edges,
 * handling branching, error recovery, and workflow state.
 */

import { V2ModuleNode, V2StepNode, V2EdgeNode } from '@mam/ast';
import {
  ExecutionContext,
  ExecutionResult,
  EventEmitter,
  StateManager,
  MAMEvent,
  StateChange,
} from './types.js';

// ============================================================================
// Types
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type WorkflowStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused';
export type EdgeCondition = 'success' | 'failure' | 'always' | string;

export interface WorkflowStep {
  id: string;
  name: string;
  agent?: string;
  tool?: string;
  action?: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  condition?: string;
  retry?: number;
  timeout?: string;
  onError?: string;
  async?: boolean;
  parallel?: boolean;
  subworkflow?: string;
  status: StepStatus;
  result?: Record<string, unknown>;
  error?: string;
  startTime?: number;
  endTime?: number;
  attempts: number;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  condition: EdgeCondition;
  label?: string;
  weight?: number;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  parallel?: boolean;
  sequential?: boolean;
  conditions?: WorkflowCondition[];
  errorHandling?: string;
  compensation?: string;
  timeout?: WorkflowTimeout;
  retry?: WorkflowRetry;
  rollback?: string;
  checkpoints?: string[];
}

export interface WorkflowCondition {
  field: string;
  operator: string;
  value: unknown;
  negate: boolean;
}

export interface WorkflowTimeout {
  value: number;
  unit: string;
  action: string;
}

export interface WorkflowRetry {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  retryOn: string[];
}

export interface WorkflowContext {
  workflowId: string;
  executionId: string;
  variables: Map<string, unknown>;
  stepResults: Map<string, Record<string, unknown>>;
  startTime: number;
  timeout?: number;
  cancelled: boolean;
  paused: boolean;
}

export interface WorkflowStats {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  skippedSteps: number;
  pendingSteps: number;
  totalEdges: number;
  executionTimeMs: number;
  retryCount: number;
 平均StepTimeMs: number;
}

// ============================================================================
// Workflow Engine
// ============================================================================

export class WorkflowEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private contexts: Map<string, WorkflowContext> = new Map();
  private stepHandlers: Map<string, StepHandler> = new Map();
  private metrics: WorkflowMetrics;

  constructor() {
    this.metrics = new WorkflowMetrics();
    this.registerBuiltinHandlers();
  }

  /**
   * Register a step handler for a specific tool/agent type
   */
  registerHandler(name: string, handler: StepHandler): void {
    this.stepHandlers.set(name, handler);
  }

  /**
   * Create a workflow from a V2ModuleNode
   */
  createWorkflow(module: V2ModuleNode): WorkflowDefinition {
    const steps: WorkflowStep[] = (module.steps ?? []).map(s => ({
      id: s.name,
      name: s.name,
      agent: s.agent,
      tool: s.tool,
      action: s.action,
      inputs: s.inputs,
      outputs: s.outputs,
      condition: s.condition,
      retry: s.retry,
      timeout: s.timeout,
      onError: s.onError,
      async: s.async,
      parallel: s.parallel,
      subworkflow: s.subworkflow,
      status: 'pending' as StepStatus,
      attempts: 0,
    }));

    const edges: WorkflowEdge[] = (module.edges ?? []).map((e, i) => ({
      id: `edge-${i}`,
      source: e.source,
      target: e.target,
      condition: (e.condition as EdgeCondition) || 'always',
      label: e.label,
      weight: e.weight,
    }));

    const workflow: WorkflowDefinition = {
      id: module.name,
      name: module.name,
      description: module.description,
      steps,
      edges,
      status: 'idle',
      parallel: module.steps?.some(s => s.parallel),
      sequential: !module.steps?.some(s => s.parallel),
      errorHandling: undefined,
      compensation: undefined,
      timeout: module.ttl ? { value: parseInt(module.ttl) || 30000, unit: 'ms', action: 'abort' } : undefined,
      retry: module.steps?.some(s => s.retry) ? { maxAttempts: 3, backoffMs: 1000, backoffMultiplier: 2, retryOn: ['error'] } : undefined,
    };

    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  /**
   * Execute a workflow
   */
  async execute(
    workflowId: string,
    context: ExecutionContext,
    inputs: Record<string, unknown> = {}
  ): Promise<WorkflowExecutionResult> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const workflowContext: WorkflowContext = {
      workflowId,
      executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      variables: new Map(Object.entries(inputs)),
      stepResults: new Map(),
      startTime: performance.now(),
      timeout: workflow.timeout?.value,
      cancelled: false,
      paused: false,
    };

    this.contexts.set(workflowContext.executionId, workflowContext);
    workflow.status = 'running';

    const allEvents: MAMEvent[] = [];
    const allStateChanges: StateChange[] = [];
    const stepResults: WorkflowStepResult[] = [];

    context.events.emit('workflow:start', { workflowId, executionId: workflowContext.executionId });

    try {
      const executionOrder = this.determineExecutionOrder(workflow);

      for (const stepId of executionOrder) {
        if (workflowContext.cancelled) {
          workflow.status = 'cancelled';
          break;
        }

        if (workflowContext.paused) {
          await this.waitForResume(workflowContext);
        }

        const step = workflow.steps.find(s => s.id === stepId);
        if (!step) continue;

        const stepResult = await this.executeStep(step, workflow, workflowContext, context);
        stepResults.push(stepResult);

        workflowContext.stepResults.set(stepId, stepResult.output);

        if (!stepResult.success) {
          if (step.onError === 'skip') {
            step.status = 'skipped';
            continue;
          } else if (step.onError === 'abort') {
            workflow.status = 'failed';
            break;
          }
        }
      }

      const allSucceeded = stepResults.every(r => r.success);
      workflow.status = allSucceeded ? 'completed' : 'failed';

      context.events.emit('workflow:complete', {
        workflowId,
        status: workflow.status,
        steps: stepResults.length,
      });

      return {
        success: allSucceeded,
        workflowId,
        executionId: workflowContext.executionId,
        status: workflow.status,
        stepResults,
        output: this.collectOutputs(workflow, workflowContext),
        timeMs: performance.now() - workflowContext.startTime,
        events: allEvents,
        stateChanges: allStateChanges,
      };
    } catch (error) {
      workflow.status = 'failed';
      context.events.emit('workflow:error', { workflowId, error: (error as Error).message });

      return {
        success: false,
        workflowId,
        executionId: workflowContext.executionId,
        status: 'failed',
        stepResults,
        output: {},
        error: (error as Error).message,
        timeMs: performance.now() - workflowContext.startTime,
        events: allEvents,
        stateChanges: allStateChanges,
      };
    } finally {
      this.contexts.delete(workflowContext.executionId);
    }
  }

  /**
   * Cancel a running workflow
   */
  cancel(executionId: string): boolean {
    const ctx = this.contexts.get(executionId);
    if (!ctx) return false;
    ctx.cancelled = true;
    return true;
  }

  /**
   * Pause a running workflow
   */
  pause(executionId: string): boolean {
    const ctx = this.contexts.get(executionId);
    if (!ctx) return false;
    ctx.paused = true;
    return true;
  }

  /**
   * Resume a paused workflow
   */
  resume(executionId: string): boolean {
    const ctx = this.contexts.get(executionId);
    if (!ctx) return false;
    ctx.paused = false;
    return true;
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get all workflows
   */
  getWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get workflow stats
   */
  getStats(workflowId: string): WorkflowStats | null {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return null;

    const completed = workflow.steps.filter(s => s.status === 'completed').length;
    const failed = workflow.steps.filter(s => s.status === 'failed').length;
    const skipped = workflow.steps.filter(s => s.status === 'skipped').length;
    const pending = workflow.steps.filter(s => s.status === 'pending').length;

    const totalStepTime = workflow.steps.reduce((sum, s) => {
      if (s.startTime && s.endTime) return sum + (s.endTime - s.startTime);
      return sum;
    }, 0);

    return {
      totalSteps: workflow.steps.length,
      completedSteps: completed,
      failedSteps: failed,
      skippedSteps: skipped,
      pendingSteps: pending,
      totalEdges: workflow.edges.length,
      executionTimeMs: totalStepTime,
      retryCount: workflow.steps.reduce((sum, s) => sum + s.attempts, 0),
      平均StepTimeMs: completed > 0 ? totalStepTime / completed : 0,
    };
  }

  /**
   * Reset workflow to idle state
   */
  reset(workflowId: string): boolean {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return false;

    workflow.status = 'idle';
    for (const step of workflow.steps) {
      step.status = 'pending';
      step.result = undefined;
      step.error = undefined;
      step.startTime = undefined;
      step.endTime = undefined;
      step.attempts = 0;
    }
    return true;
  }

  /**
   * Remove a workflow
   */
  remove(workflowId: string): boolean {
    return this.workflows.delete(workflowId);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async executeStep(
    step: WorkflowStep,
    workflow: WorkflowDefinition,
    workflowContext: WorkflowContext,
    context: ExecutionContext
  ): Promise<WorkflowStepResult> {
    const startTime = performance.now();
    step.status = 'running';
    step.startTime = startTime;
    step.attempts++;

    context.events.emit('workflow:step:start', {
      workflowId: workflow.id,
      stepId: step.id,
      stepName: step.name,
    });

    try {
      if (step.condition && !this.evaluateCondition(step.condition, workflowContext)) {
        step.status = 'skipped';
        return {
          stepId: step.id,
          stepName: step.name,
          success: true,
          skipped: true,
          output: {},
          timeMs: performance.now() - startTime,
        };
      }

      const handler = this.resolveHandler(step);
      let output: Record<string, unknown> = {};

      if (handler) {
        const stepInputs = this.resolveInputs(step, workflowContext);
        output = await handler.execute(step, stepInputs, context);
      } else {
        output = {
          step: step.name,
          agent: step.agent,
          tool: step.tool,
          action: step.action,
          status: 'simulated',
        };
      }

      step.status = 'completed';
      step.result = output;
      step.endTime = performance.now();

      context.events.emit('workflow:step:complete', {
        workflowId: workflow.id,
        stepId: step.id,
        success: true,
      });

      this.metrics.recordStep(step.name, step.endTime - startTime, true);

      return {
        stepId: step.id,
        stepName: step.name,
        success: true,
        skipped: false,
        output,
        timeMs: step.endTime - startTime,
      };
    } catch (error) {
      step.status = 'failed';
      step.error = (error as Error).message;
      step.endTime = performance.now();

      context.events.emit('workflow:step:error', {
        workflowId: workflow.id,
        stepId: step.id,
        error: (error as Error).message,
      });

      this.metrics.recordStep(step.name, step.endTime - startTime, false);

      const shouldRetry = step.retry && step.attempts < step.retry;
      if (shouldRetry) {
        return this.executeStep(step, workflow, workflowContext, context);
      }

      return {
        stepId: step.id,
        stepName: step.name,
        success: false,
        skipped: false,
        output: {},
        error: (error as Error).message,
        timeMs: step.endTime - startTime,
      };
    }
  }

  private determineExecutionOrder(workflow: WorkflowDefinition): string[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const step of workflow.steps) {
      graph.set(step.id, new Set());
      inDegree.set(step.id, 0);
    }

    for (const edge of workflow.edges) {
      const sourceNode = graph.get(edge.source);
      if (sourceNode) {
        sourceNode.add(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      sorted.push(current);

      for (const neighbor of graph.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    for (const step of workflow.steps) {
      if (!sorted.includes(step.id)) {
        sorted.push(step.id);
      }
    }

    return sorted;
  }

  private resolveHandler(step: WorkflowStep): StepHandler | null {
    if (step.tool && this.stepHandlers.has(step.tool)) {
      return this.stepHandlers.get(step.tool)!;
    }
    if (step.agent && this.stepHandlers.has(step.agent)) {
      return this.stepHandlers.get(step.agent)!;
    }
    if (step.action && this.stepHandlers.has(step.action)) {
      return this.stepHandlers.get(step.action)!;
    }
    return this.stepHandlers.get('default') ?? null;
  }

  private resolveInputs(step: WorkflowStep, context: WorkflowContext): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};
    if (step.inputs) {
      for (const [key, value] of Object.entries(step.inputs)) {
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          const varName = value.slice(2, -1);
          resolved[key] = context.variables.get(varName) ?? context.stepResults.get(varName);
        } else {
          resolved[key] = value;
        }
      }
    }
    return resolved;
  }

  private evaluateCondition(condition: string, context: WorkflowContext): boolean {
    const parts = condition.split(' ').map(p => p.trim());
    if (parts.length === 1) {
      return context.variables.get(parts[0]) === true ||
        context.variables.get(parts[0]) === 'true';
    }
    if (parts.length === 3) {
      const [left, op, right] = parts;
      const leftVal = context.variables.get(left);
      const rightVal = isNaN(Number(right)) ? right : Number(right);
      switch (op) {
        case '==': return leftVal === rightVal;
        case '!=': return leftVal !== rightVal;
        case '>': return Number(leftVal) > Number(rightVal);
        case '<': return Number(leftVal) < Number(rightVal);
        case '>=': return Number(leftVal) >= Number(rightVal);
        case '<=': return Number(leftVal) <= Number(rightVal);
        case 'contains': return String(leftVal).includes(String(rightVal));
        default: return false;
      }
    }
    return true;
  }

  private collectOutputs(workflow: WorkflowDefinition, context: WorkflowContext): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [key, value] of context.stepResults) {
      outputs[key] = value;
    }
    return outputs;
  }

  private async waitForResume(context: WorkflowContext): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (!context.paused || context.cancelled) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  private registerBuiltinHandlers(): void {
    this.stepHandlers.set('default', {
      name: 'default',
      execute: async (step, inputs) => ({
        step: step.name,
        inputs,
        status: 'completed',
      }),
    });
  }
}

// ============================================================================
// Step Handler Interface
// ============================================================================

export interface StepHandler {
  name: string;
  execute: (
    step: WorkflowStep,
    inputs: Record<string, unknown>,
    context: ExecutionContext
  ) => Promise<Record<string, unknown>>;
}

// ============================================================================
// Workflow Step Result
// ============================================================================

export interface WorkflowStepResult {
  stepId: string;
  stepName: string;
  success: boolean;
  skipped: boolean;
  output: Record<string, unknown>;
  error?: string;
  timeMs: number;
}

// ============================================================================
// Workflow Execution Result
// ============================================================================

export interface WorkflowExecutionResult {
  success: boolean;
  workflowId: string;
  executionId: string;
  status: WorkflowStatus;
  stepResults: WorkflowStepResult[];
  output: Record<string, unknown>;
  error?: string;
  timeMs: number;
  events: MAMEvent[];
  stateChanges: StateChange[];
}

// ============================================================================
// Workflow Metrics
// ============================================================================

class WorkflowMetrics {
  private stepMetrics: Map<string, { count: number; totalTimeMs: number; successes: number; failures: number }> = new Map();

  recordStep(name: string, timeMs: number, success: boolean): void {
    const existing = this.stepMetrics.get(name) ?? { count: 0, totalTimeMs: 0, successes: 0, failures: 0 };
    existing.count++;
    existing.totalTimeMs += timeMs;
    if (success) existing.successes++;
    else existing.failures++;
    this.stepMetrics.set(name, existing);
  }

  getStepStats(name: string): { count: number; avgTimeMs: number; successRate: number } | null {
    const m = this.stepMetrics.get(name);
    if (!m) return null;
    return {
      count: m.count,
      avgTimeMs: m.totalTimeMs / m.count,
      successRate: m.successes / m.count,
    };
  }

  getAllStats(): Map<string, { count: number; avgTimeMs: number; successRate: number }> {
    const result = new Map();
    for (const [name, m] of this.stepMetrics) {
      result.set(name, {
        count: m.count,
        avgTimeMs: m.totalTimeMs / m.count,
        successRate: m.successes / m.count,
      });
    }
    return result;
  }

  reset(): void {
    this.stepMetrics.clear();
  }
}
