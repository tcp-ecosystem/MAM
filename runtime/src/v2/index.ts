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