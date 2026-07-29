/**
 * MAM v2 Runtime Specification
 * 
 * Defines the runtime interface, execution model, memory model, event model,
 * state management, and plugin loading for v2 modules.
 */

import { V2ModuleNode, V2EdgeNode, V2StepNode, V2MemoryReference, V2PermissionSet } from '@mam/ast';

// ============================================================================
// Runtime Interface
// ============================================================================

export interface RuntimeInterface {
  /** Runtime name */
  name: string;
  /** Runtime version */
  version: string;
  /** Supported module types */
  supportedTypes: string[];
  
  /** Initialize runtime */
  init(config: RuntimeConfig): Promise<void>;
  
  /** Execute a module */
  execute(module: V2ModuleNode, context: ExecutionContext): Promise<ExecutionResult>;
  
  /** Execute a system (multi-module) */
  executeSystem(modules: V2ModuleNode[], system: V2ModuleNode, context: ExecutionContext): Promise<SystemResult>;
  
  /** Cleanup resources */
  cleanup(): Promise<void>;
}

export interface RuntimeConfig {
  /** Working directory */
  workingDir: string;
  /** Default timeout in ms */
  defaultTimeout: number;
  /** Memory limit in bytes */
  memoryLimit: number;
  /** Enable logging */
  logging: boolean;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Plugin directories */
  pluginDirs: string[];
}

// ============================================================================
// Execution Model
// ============================================================================

export interface ExecutionContext {
  /** Module being executed */
  module: V2ModuleNode;
  /** All modules in the system */
  allModules: Map<string, V2ModuleNode>;
  /** Input parameters */
  inputs: Record<string, unknown>;
  /** Memory store */
  memory: MemoryStore;
  /** Event emitter */
  events: EventEmitter;
  /** State manager */
  state: StateManager;
  /** Permission checker */
  permissions: PermissionChecker;
  /** Execution options */
  options: ExecutionOptions;
}

export interface ExecutionOptions {
  /** Execution timeout in ms */
  timeout?: number;
  /** Dry run mode */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Target runtime */
  target?: string;
}

export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output values */
  output: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Execution time in ms */
  timeMs: number;
  /** Memory used in bytes */
  memoryUsed?: number;
  /** Events emitted */
  events: Event[];
  /** State changes */
  stateChanges: StateChange[];
}

export interface SystemResult extends ExecutionResult {
  /** Results from each module */
  moduleResults: Map<string, ExecutionResult>;
  /** Execution order */
  executionOrder: string[];
  /** Failed modules */
  failedModules: string[];
}

// ============================================================================
// Memory Model
// ============================================================================

export interface MemoryStore {
  /** Store a value */
  set(key: string, value: unknown, options?: MemoryOptions): Promise<void>;
  
  /** Retrieve a value */
  get(key: string): Promise<unknown>;
  
  /** Delete a value */
  delete(key: string): Promise<void>;
  
  /** Check if key exists */
  has(key: string): Promise<boolean>;
  
  /** List all keys */
  keys(): Promise<string[]>;
  
  /** Clear all memory */
  clear(): Promise<void>;
  
  /** Get memory stats */
  stats(): Promise<MemoryStats>;
}

export interface MemoryOptions {
  /** Time to live in seconds */
  ttl?: number;
  /** Memory scope */
  scope?: 'local' | 'shared' | 'global';
  /** Tags for filtering */
  tags?: string[];
}

export interface MemoryStats {
  /** Total entries */
  totalEntries: number;
  /** Memory used in bytes */
  memoryUsed: number;
  /** Hit rate */
  hitRate: number;
  /** Eviction count */
  evictions: number;
}

// ============================================================================
// Event Model
// ============================================================================

export interface EventEmitter {
  /** Emit an event */
  emit(event: string, data?: unknown): void;
  
  /** Listen for an event */
  on(event: string, listener: EventListener): void;
  
  /** Remove listener */
  off(event: string, listener: EventListener): void;
  
  /** Once listener */
  once(event: string, listener: EventListener): void;
  
  /** Get event history */
  history(): Event[];
}

export type EventListener = (data: unknown) => void | Promise<void>;

export interface Event {
  /** Event name */
  name: string;
  /** Event data */
  data: unknown;
  /** Timestamp */
  timestamp: number;
  /** Source module */
  source?: string;
}

// ============================================================================
// State Management
// ============================================================================

export interface StateManager {
  /** Get state value */
  get(key: string): unknown;
  
  /** Set state value */
  set(key: string, value: unknown): void;
  
  /** Delete state value */
  delete(key: string): void;
  
  /** Get all state */
  getAll(): Record<string, unknown>;
  
  /** Subscribe to state changes */
  subscribe(key: string, callback: StateCallback): void;
  
  /** Get state history */
  history(): StateChange[];
}

export type StateCallback = (key: string, oldValue: unknown, newValue: unknown) => void;

export interface StateChange {
  /** State key */
  key: string;
  /** Old value */
  oldValue: unknown;
  /** New value */
  newValue: unknown;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Permission Checker
// ============================================================================

export interface PermissionChecker {
  /** Check if action is allowed */
  check(action: string, context?: PermissionContext): PermissionResult;
  
  /** Get all allowed actions */
  getAllowed(): string[];
  
  /** Get all denied actions */
  getDenied(): string[];
}

export interface PermissionContext {
  /** Module requesting permission */
  module?: string;
  /** Current user */
  user?: string;
  /** Additional context */
  extra?: Record<string, unknown>;
}

export interface PermissionResult {
  /** Whether action is allowed */
  allowed: boolean;
  /** Reason if denied */
  reason?: string;
  /** Policy that matched */
  policy?: string;
}

// ============================================================================
// Plugin Loading
// ============================================================================

export interface PluginLoader {
  /** Load plugin from path */
  load(path: string): Promise<Plugin>;
  
  /** Load all plugins from directory */
  loadAll(dir: string): Promise<Plugin[]>;
  
  /** Unload plugin */
  unload(name: string): Promise<void>;
  
  /** Get loaded plugins */
  getLoaded(): Plugin[];
}

export interface Plugin {
  /** Plugin name */
  name: string;
  /** Plugin version */
  version: string;
  /** Plugin type */
  type: 'runtime' | 'compiler' | 'validator' | 'extension';
  
  /** Initialize plugin */
  init(context: PluginContext): Promise<void>;
  
  /** Execute plugin */
  execute(input: unknown): Promise<unknown>;
  
  /** Cleanup plugin */
  cleanup(): Promise<void>;
}

export interface PluginContext {
  /** Runtime reference */
  runtime: RuntimeInterface;
  /** Memory store */
  memory: MemoryStore;
  /** Event emitter */
  events: EventEmitter;
  /** Logger */
  logger: Logger;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ============================================================================
// Default Runtime Config
// ============================================================================

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  workingDir: process.cwd(),
  defaultTimeout: 30000,
  memoryLimit: 256 * 1024 * 1024, // 256MB
  logging: true,
  logLevel: 'info',
  pluginDirs: ['.mam/plugins', 'node_modules/@mam/plugin-*'],
};

// ============================================================================
// In-Memory Memory Store Implementation
// ============================================================================

interface MemoryEntry {
  value: unknown;
  expiry?: number;
  tags?: string[];
}

class InMemoryMemoryStore implements MemoryStore {
  private store = new Map<string, MemoryEntry>();
  private statsData = { hits: 0, misses: 0, evictions: 0 };

  async set(key: string, value: unknown, options?: MemoryOptions): Promise<void> {
    this.evict();
    const entry: MemoryEntry = { value };
    if (options?.ttl) {
      entry.expiry = Date.now() + options.ttl * 1000;
    }
    if (options?.tags) {
      entry.tags = options.tags;
    }
    this.store.set(key, entry);
  }

  async get(key: string): Promise<unknown> {
    this.evict();
    const entry = this.store.get(key);
    if (!entry) {
      this.statsData.misses++;
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.statsData.misses++;
      this.statsData.evictions++;
      return undefined;
    }
    this.statsData.hits++;
    return entry.value;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    this.evict();
    const entry = this.store.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.store.delete(key);
      this.statsData.evictions++;
      return false;
    }
    return true;
  }

  async keys(): Promise<string[]> {
    this.evict();
    const validKeys: string[] = [];
    for (const [key, entry] of this.store) {
      if (!this.isExpired(entry)) {
        validKeys.push(key);
      }
    }
    return validKeys;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.statsData.hits = 0;
    this.statsData.misses = 0;
    this.statsData.evictions = 0;
  }

  async stats(): Promise<MemoryStats> {
    this.evict();
    const totalRequests = this.statsData.hits + this.statsData.misses;
    return {
      totalEntries: this.store.size,
      memoryUsed: this.estimateMemory(),
      hitRate: totalRequests > 0 ? this.statsData.hits / totalRequests : 0,
      evictions: this.statsData.evictions,
    };
  }

  private isExpired(entry: MemoryEntry): boolean {
    if (entry.expiry === undefined) return false;
    return Date.now() > entry.expiry;
  }

  private evict(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (entry.expiry !== undefined && now > entry.expiry) {
        this.store.delete(key);
        this.statsData.evictions++;
      }
    }
  }

  private estimateMemory(): number {
    let bytes = 0;
    for (const [, entry] of this.store) {
      bytes += this.sizeOf(entry.value);
      if (entry.tags) {
        bytes += entry.tags.reduce((sum, tag) => sum + tag.length * 2, 0);
      }
    }
    return bytes;
  }

  private sizeOf(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 0;
      }
    }
    return 0;
  }
}

// ============================================================================
// Default Event Emitter Implementation
// ============================================================================

class DefaultEventEmitter implements EventEmitter {
  private listeners = new Map<string, Set<EventListener>>();
  private historyLog: Event[] = [];

  emit(event: string, data?: unknown): void {
    const eventRecord: Event = {
      name: event,
      data: data ?? null,
      timestamp: Date.now(),
    };
    this.historyLog.push(eventRecord);

    const listenerSet = this.listeners.get(event);
    if (listenerSet) {
      for (const listener of listenerSet) {
        try {
          const result = listener(data);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // Swallow listener errors to prevent unhandled exceptions
        }
      }
    }

    const wildcardListeners = this.listeners.get('*');
    if (wildcardListeners) {
      for (const listener of wildcardListeners) {
        try {
          const result = listener(eventRecord);
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).catch(() => {});
          }
        } catch {
          // Swallow listener errors
        }
      }
    }
  }

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
  }

  off(event: string, listener: EventListener): void {
    const listenerSet = this.listeners.get(event);
    if (listenerSet) {
      listenerSet.delete(listener);
      if (listenerSet.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  once(event: string, listener: EventListener): void {
    const wrappedListener: EventListener = (data) => {
      this.off(event, wrappedListener);
      return listener(data);
    };
    this.on(event, wrappedListener);
  }

  history(): Event[] {
    return [...this.historyLog];
  }
}

// ============================================================================
// Default State Manager Implementation
// ============================================================================

class DefaultStateManager implements StateManager {
  private state = new Map<string, unknown>();
  private subscribers = new Map<string, Set<StateCallback>>();
  private historyLog: StateChange[] = [];

  get(key: string): unknown {
    return this.state.get(key);
  }

  set(key: string, value: unknown): void {
    const oldValue = this.state.get(key);
    this.state.set(key, value);

    const change: StateChange = {
      key,
      oldValue: oldValue ?? null,
      newValue: value,
      timestamp: Date.now(),
    };
    this.historyLog.push(change);

    this.notifySubscribers(key, oldValue ?? null, value);
  }

  delete(key: string): void {
    const oldValue = this.state.get(key);
    this.state.delete(key);

    const change: StateChange = {
      key,
      oldValue: oldValue ?? null,
      newValue: null,
      timestamp: Date.now(),
    };
    this.historyLog.push(change);

    this.notifySubscribers(key, oldValue ?? null, null);
  }

  getAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of this.state) {
      result[key] = value;
    }
    return result;
  }

  subscribe(key: string, callback: StateCallback): void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key)!.add(callback);
  }

  history(): StateChange[] {
    return [...this.historyLog];
  }

  private notifySubscribers(key: string, oldValue: unknown, newValue: unknown): void {
    const subscriberSet = this.subscribers.get(key);
    if (subscriberSet) {
      for (const callback of subscriberSet) {
        try {
          callback(key, oldValue, newValue);
        } catch {
          // Swallow subscriber errors
        }
      }
    }

    const globalSubscribers = this.subscribers.get('*');
    if (globalSubscribers) {
      for (const callback of globalSubscribers) {
        try {
          callback(key, oldValue, newValue);
        } catch {
          // Swallow subscriber errors
        }
      }
    }
  }
}

// ============================================================================
// Default Permission Checker Implementation
// ============================================================================

class DefaultPermissionChecker implements PermissionChecker {
  private allowed: string[];
  private denied: string[];

  constructor(permissions?: V2PermissionSet) {
    this.allowed = [];
    this.denied = [];

    if (permissions) {
      if (permissions.filesystem && permissions.filesystem !== 'none') {
        this.allowed.push(`filesystem:${permissions.filesystem}`);
      } else if (permissions.filesystem === 'none') {
        this.denied.push('filesystem:*');
      }

      if (permissions.network && permissions.network !== 'none') {
        this.allowed.push(`network:${permissions.network}`);
      } else if (permissions.network === 'none') {
        this.denied.push('network:*');
      }

      if (permissions.python && permissions.python !== 'none') {
        this.allowed.push(`python:${permissions.python}`);
      } else if (permissions.python === 'none') {
        this.denied.push('python:*');
      }

      if (permissions.exec === 'allowed') {
        this.allowed.push('exec:allowed');
      } else if (permissions.exec === 'denied') {
        this.denied.push('exec:*');
      }

      if (permissions.memory && permissions.memory !== 'none') {
        this.allowed.push(`memory:${permissions.memory}`);
      } else if (permissions.memory === 'none') {
        this.denied.push('memory:*');
      }

      if (permissions.custom) {
        for (const [key, value] of Object.entries(permissions.custom)) {
          if (value === 'none' || value === 'denied') {
            this.denied.push(`${key}:*`);
          } else {
            this.allowed.push(`${key}:${value}`);
          }
        }
      }
    }
  }

  check(action: string, context?: PermissionContext): PermissionResult {
    for (const pattern of this.denied) {
      if (this.matchesPattern(action, pattern)) {
        return { allowed: false, reason: `Denied by pattern: ${pattern}`, policy: pattern };
      }
    }

    for (const pattern of this.allowed) {
      if (this.matchesPattern(action, pattern)) {
        return { allowed: true, policy: pattern };
      }
    }

    if (this.denied.length === 0 && this.allowed.length === 0) {
      return { allowed: true, policy: 'default-allow' };
    }

    return { allowed: false, reason: `No matching allow rule for action: ${action}` };
  }

  getAllowed(): string[] {
    return [...this.allowed];
  }

  getDenied(): string[] {
    return [...this.denied];
  }

  private matchesPattern(action: string, pattern: string): boolean {
    const regex = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regex}$`).test(action);
  }
}

// ============================================================================
// Default Plugin Loader Implementation
// ============================================================================

class DefaultPluginLoader implements PluginLoader {
  private plugins = new Map<string, Plugin>();

  async load(path: string): Promise<Plugin> {
    const module = await import(path);
    const pluginFactory = module.default ?? module;
    const plugin: Plugin = typeof pluginFactory === 'function'
      ? await pluginFactory()
      : pluginFactory;

    if (!plugin.name || !plugin.version || !plugin.type) {
      throw new Error(`Invalid plugin at ${path}: missing name, version, or type`);
    }

    this.plugins.set(plugin.name, plugin);
    return plugin;
  }

  async loadAll(dir: string): Promise<Plugin[]> {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const loaded: Plugin[] = [];

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return loaded;
    }

    for (const entry of entries) {
      if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
        try {
          const plugin = await this.load(join(dir, entry));
          loaded.push(plugin);
        } catch {
          // Skip invalid plugins
        }
      }
    }

    return loaded;
  }

  async unload(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.cleanup();
      this.plugins.delete(name);
    }
  }

  getLoaded(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}

// ============================================================================
// MAMV2 Runtime Implementation
// ============================================================================

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
  private initialized = false;

  constructor() {
    this.pluginLoader = new DefaultPluginLoader();
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

// ============================================================================
// Factory Function
// ============================================================================

export function createV2Runtime(config?: Partial<RuntimeConfig>): MAMV2Runtime {
  const runtime = new MAMV2Runtime();
  const fullConfig: RuntimeConfig = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  runtime.init(fullConfig);
  return runtime;
}
