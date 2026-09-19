import { V2ModuleNode } from '@mam/ast';
import {
  RuntimeInterface,
  RuntimeConfig,
  ExecutionContext,
  ExecutionResult,
  SystemResult,
  DEFAULT_RUNTIME_CONFIG,
} from './types.js';
import { InMemoryMemoryStore } from './memory.js';
import { DefaultEventEmitter } from './events.js';
import { DefaultStateManager } from './state.js';
import { DefaultPermissionChecker } from './permissions.js';
import { DefaultPluginLoader, PluginRegistry } from './plugins.js';

const ALL_MODULE_TYPES = [
  'module', 'agent', 'tool', 'memory', 'workflow', 'team',
  'policy', 'system', 'service', 'component', 'resource',
  'interface', 'contract', 'plugin', 'extension', 'runtime',
  'package', 'repository', 'documentation',
];

export class MAMV2Runtime implements RuntimeInterface {
  name = 'mam-v2';
  version = '0.1.0';
  supportedTypes = [...ALL_MODULE_TYPES];

  private config: RuntimeConfig | null = null;
  private pluginLoader: DefaultPluginLoader;
  private pluginRegistry: PluginRegistry;
  private initialized = false;

  constructor() {
    this.pluginLoader = new DefaultPluginLoader();
    this.pluginRegistry = new PluginRegistry();
  }

  async init(config: RuntimeConfig): Promise<void> {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
    this.initialized = true;
  }

  async execute(module: V2ModuleNode, context: ExecutionContext): Promise<ExecutionResult> {
    if (!this.initialized) {
      throw new Error('Runtime not initialized. Call init() first.');
    }

    const startTime = performance.now();

    try {
      const result = await this.executeByType(module, context);
      const timeMs = performance.now() - startTime;

      return {
        ...result,
        timeMs,
        events: context.events.history(),
        stateChanges: context.state.history(),
      };
    } catch (error) {
      return {
        success: false,
        output: {},
        error: (error as Error).message,
        timeMs: performance.now() - startTime,
        events: [],
        stateChanges: [],
      };
    }
  }

  async executeSystem(
    modules: V2ModuleNode[],
    system: V2ModuleNode,
    context: ExecutionContext
  ): Promise<SystemResult> {
    if (!this.initialized) {
      throw new Error('Runtime not initialized. Call init() first.');
    }

    const startTime = performance.now();
    const executionOrder = this.topoSort(modules);
    const moduleResults = new Map<string, ExecutionResult>();
    const failedModules: string[] = [];

    for (const moduleId of executionOrder) {
      const mod = modules.find((m) => m.name === moduleId);
      if (!mod) {
        failedModules.push(moduleId);
        moduleResults.set(moduleId, {
          success: false,
          output: {},
          error: `Module not found: ${moduleId}`,
          timeMs: 0,
          events: [],
          stateChanges: [],
        });
        continue;
      }

      try {
        const result = await this.executeByType(mod, context);
        moduleResults.set(moduleId, result);
        if (!result.success) {
          failedModules.push(moduleId);
        }
      } catch (error) {
        failedModules.push(moduleId);
        moduleResults.set(moduleId, {
          success: false,
          output: {},
          error: (error as Error).message,
          timeMs: 0,
          events: [],
          stateChanges: [],
        });
      }
    }

    const allSuccess = failedModules.length === 0;
    const timeMs = performance.now() - startTime;

    return {
      success: allSuccess,
      output: {},
      timeMs,
      moduleResults,
      executionOrder,
      failedModules,
      events: context.events.history(),
      stateChanges: context.state.history(),
    };
  }

  async cleanup(): Promise<void> {
    for (const plugin of this.pluginLoader.getLoaded()) {
      await plugin.cleanup();
    }
    this.initialized = false;
    this.config = null;
  }

  private async executeByType(
    module: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    switch (module.moduleType) {
      case 'agent':
        return this.executeAgent(module, context);
      case 'tool':
        return this.executeTool(module, context);
      case 'memory':
        return this.executeMemory(module, context);
      case 'workflow':
        return this.executeWorkflow(module, context);
      case 'policy':
        return this.executePolicy(module, context);
      default:
        return this.executeGeneric(module, context);
    }
  }

  private async executeAgent(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    if (!node.role || !node.goal) {
      return {
        success: false,
        output: {},
        error: 'Agent requires role and goal',
        timeMs: performance.now() - startTime,
        events: [],
        stateChanges: [],
      };
    }

    context.events.emit('agent:start', { name: node.name, role: node.role });
    context.state.set(`agent:${node.name}:status`, 'running');

    const agentState: Record<string, unknown> = {
      name: node.name,
      role: node.role,
      goal: node.goal,
      tools: node.tools ?? [],
      memory: node.memory ?? null,
      handoff: node.handoff ?? [],
      status: 'completed',
    };

    context.state.set(`agent:${node.name}:status`, 'completed');
    context.state.set(`agent:${node.name}:result`, agentState);
    context.events.emit('agent:complete', { name: node.name });

    return {
      success: true,
      output: agentState,
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private async executeTool(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    if (!node.provider) {
      return {
        success: false,
        output: {},
        error: 'Tool requires provider',
        timeMs: performance.now() - startTime,
        events: [],
        stateChanges: [],
      };
    }

    context.events.emit('tool:execute', { name: node.name, provider: node.provider });

    const toolResult: Record<string, unknown> = {
      name: node.name,
      provider: node.provider,
      capabilities: node.capabilities ?? [],
      configuration: node.metadata ?? {},
    };

    context.events.emit('tool:complete', { name: node.name });

    return {
      success: true,
      output: toolResult,
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private async executeMemory(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    context.events.emit('memory:setup', { name: node.name });

    const memoryConfig: Record<string, unknown> = {
      name: node.name,
      format: node.format ?? 'key-value',
      backend: node.backend ?? 'in-memory',
      scope: node.scope ?? 'local',
      ttl: node.ttl ?? null,
    };

    context.events.emit('memory:ready', { name: node.name });

    return {
      success: true,
      output: memoryConfig,
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private async executeWorkflow(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    context.events.emit('workflow:start', { name: node.name });

    const steps = node.steps ?? [];
    const edges = node.edges ?? [];
    const stepResults: Array<{ step: string; success: boolean }> = [];

    for (const step of steps) {
      context.events.emit('workflow:step', { workflow: node.name, step: step.name });
      stepResults.push({ step: step.name, success: true });
    }

    context.events.emit('workflow:complete', { name: node.name, steps: stepResults.length });

    return {
      success: true,
      output: {
        name: node.name,
        steps: steps.length,
        edges: edges.length,
        stepResults,
      },
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private async executePolicy(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    context.events.emit('policy:evaluate', { name: node.name });

    const allowed = node.allow ?? [];
    const denied = node.deny ?? [];

    context.state.set(`policy:${node.name}:allowed`, allowed);
    context.state.set(`policy:${node.name}:denied`, denied);

    context.events.emit('policy:applied', { name: node.name, allowed, denied });

    return {
      success: true,
      output: {
        name: node.name,
        allow: allowed,
        deny: denied,
        permissions: node.permissions ?? null,
      },
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private async executeGeneric(
    node: V2ModuleNode,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const startTime = performance.now();

    context.events.emit('module:execute', { name: node.name, type: node.moduleType });

    const output: Record<string, unknown> = {
      name: node.name,
      type: node.moduleType,
      description: node.description ?? null,
      inputs: node.inputs ?? [],
      outputs: node.outputs ?? [],
      capabilities: node.capabilities ?? [],
    };

    context.events.emit('module:complete', { name: node.name });

    return {
      success: true,
      output,
      timeMs: performance.now() - startTime,
      events: [],
      stateChanges: [],
    };
  }

  private topoSort(modules: V2ModuleNode[]): string[] {
    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const mod of modules) {
      const name = mod.name;
      if (!graph.has(name)) graph.set(name, new Set());
      if (!inDegree.has(name)) inDegree.set(name, 0);

      const deps = mod.requires ?? [];
      for (const dep of deps) {
        if (!graph.has(dep)) graph.set(dep, new Set());
        graph.get(dep)!.add(name);
        inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
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

    for (const mod of modules) {
      if (!sorted.includes(mod.name)) {
        sorted.push(mod.name);
      }
    }

    return sorted;
  }
}

export function createV2Runtime(config?: Partial<RuntimeConfig>): MAMV2Runtime {
  const runtime = new MAMV2Runtime();
  const fullConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  runtime.init(fullConfig);
  return runtime;
}
