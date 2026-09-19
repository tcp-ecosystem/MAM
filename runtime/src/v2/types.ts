import { V2ModuleNode, V2EdgeNode, V2StepNode, V2MemoryReference, V2PermissionSet } from '@mam/ast';

export type CompilerTarget = 'javascript' | 'typescript' | 'wasm' | 'python' | 'bytecode';

export type RetryBackoffStrategy = 'linear' | 'exponential' | 'fixed';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type PluginType = 'runtime' | 'compiler' | 'validator' | 'extension';

export type MemoryScope = 'local' | 'shared' | 'global';

export type ResourceState = 'pending' | 'active' | 'released' | 'failed';

export type SandboxStatus = 'running' | 'completed' | 'failed' | 'timed-out';

export type CapabilityStatus = 'registered' | 'resolved' | 'failed' | 'deprecated';

export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

export interface RuntimeInterface {
  name: string;
  version: string;
  supportedTypes: string[];
  init(config: RuntimeConfig): Promise<void>;
  execute(module: V2ModuleNode, context: ExecutionContext): Promise<ExecutionResult>;
  executeSystem(modules: V2ModuleNode[], system: V2ModuleNode, context: ExecutionContext): Promise<SystemResult>;
  cleanup(): Promise<void>;
}

export interface RuntimeConfig {
  workingDir: string;
  defaultTimeout: number;
  memoryLimit: number;
  logging: boolean;
  logLevel: LogLevel;
  pluginDirs: string[];
}

export interface ExecutionContext {
  module: V2ModuleNode;
  allModules: Map<string, V2ModuleNode>;
  inputs: Record<string, unknown>;
  memory: MemoryStore;
  events: EventEmitter;
  state: StateManager;
  permissions: PermissionChecker;
  options: ExecutionOptions;
}

export interface ExecutionOptions {
  timeout?: number;
  dryRun?: boolean;
  verbose?: boolean;
  target?: string;
  retryPolicy?: RetryPolicy;
  telemetry?: TelemetryInterface;
  tokenBudget?: TokenBudget;
}

export interface ExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
  timeMs: number;
  memoryUsed?: number;
  events: MAMEvent[];
  stateChanges: StateChange[];
}

export interface SystemResult extends ExecutionResult {
  moduleResults: Map<string, ExecutionResult>;
  executionOrder: string[];
  failedModules: string[];
}

export interface MemoryStore {
  set(key: string, value: unknown, options?: MemoryOptions): Promise<void>;
  get(key: string): Promise<unknown>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
  stats(): Promise<MemoryStats>;
}

export interface MemoryOptions {
  ttl?: number;
  scope?: MemoryScope;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface MemoryStats {
  totalEntries: number;
  memoryUsed: number;
  hitRate: number;
  evictions: number;
}

export interface EventEmitter {
  emit(event: string, data?: unknown): void;
  on(event: string, listener: EventListener): void;
  off(event: string, listener: EventListener): void;
  once(event: string, listener: EventListener): void;
  history(): MAMEvent[];
}

export type EventListener = (data: unknown) => void | Promise<void>;

export interface MAMEvent {
  name: string;
  data: unknown;
  timestamp: number;
  source?: string;
}

export interface StateManager {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  getAll(): Record<string, unknown>;
  subscribe(key: string, callback: StateCallback): void;
  unsubscribe(key: string, callback: StateCallback): void;
  history(): StateChange[];
}

export type StateCallback = (key: string, oldValue: unknown, newValue: unknown) => void;

export interface StateChange {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  timestamp: number;
}

export interface PermissionChecker {
  check(action: string, context?: PermissionContext): PermissionResult;
  getAllowed(): string[];
  getDenied(): string[];
}

export interface PermissionContext {
  module?: string;
  user?: string;
  extra?: Record<string, unknown>;
}

export interface PermissionResult {
  allowed: boolean;
  reason?: string;
  policy?: string;
}

export interface PluginLoader {
  load(path: string): Promise<Plugin>;
  loadAll(dir: string): Promise<Plugin[]>;
  unload(name: string): Promise<void>;
  getLoaded(): Plugin[];
}

export interface Plugin {
  name: string;
  version: string;
  type: PluginType;
  init(context: PluginContext): Promise<void>;
  execute(input: unknown): Promise<unknown>;
  cleanup(): Promise<void>;
}

export interface PluginContext {
  runtime: RuntimeInterface;
  memory: MemoryStore;
  events: EventEmitter;
  logger: Logger;
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

export interface ResourceAllocator {
  request(resourceType: string, amount: number, metadata?: Record<string, unknown>): Promise<ResourceHandle>;
  release(handle: string): Promise<void>;
  getActive(): ResourceHandle[];
  getStats(): ResourceStats;
}

export interface ResourceHandle {
  id: string;
  type: string;
  amount: number;
  state: ResourceState;
  allocatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ResourceStats {
  totalRequested: number;
  totalActive: number;
  totalReleased: number;
  totalFailed: number;
  peakUsage: number;
}

export interface PolicyEngine {
  evaluate(action: string, context: PermissionContext): Promise<PolicyDecision>;
  register(policy: PolicyDefinition): void;
  unregister(policyId: string): void;
  list(): PolicyDefinition[];
}

export interface PolicyDefinition {
  id: string;
  name: string;
  version: string;
  effect: 'allow' | 'deny';
  conditions: PolicyCondition[];
  priority: number;
}

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'not-equals' | 'in' | 'not-in' | 'contains' | 'matches';
  value: unknown;
}

export interface PolicyDecision {
  allowed: boolean;
  matchedPolicies: string[];
  reason?: string;
}

export interface CapabilityEngine {
  register(capability: CapabilityDefinition): void;
  resolve(name: string, context?: Record<string, unknown>): Promise<CapabilityInstance>;
  invoke(instanceId: string, input: unknown): Promise<unknown>;
  list(): CapabilityDefinition[];
}

export interface CapabilityDefinition {
  name: string;
  version: string;
  description: string;
  parameters: CapabilityParameter[];
  returnType: string;
}

export interface CapabilityParameter {
  name: string;
  type: string;
  required: boolean;
  default?: unknown;
  description?: string;
}

export interface CapabilityInstance {
  id: string;
  capabilityName: string;
  status: CapabilityStatus;
  resolvedAt: number;
  context: Record<string, unknown>;
}

export interface Sandbox {
  execute(code: string, config?: SandboxConfig): Promise<SandboxResult>;
  cleanup(): Promise<void>;
  getStats(): SandboxStats;
}

export interface SandboxConfig {
  timeout: number;
  memoryLimit: number;
  networkAccess: boolean;
  filesystemAccess: boolean;
  allowedModules?: string[];
  env?: Record<string, string>;
}

export interface SandboxResult {
  status: SandboxStatus;
  output: unknown;
  error?: string;
  timeMs: number;
  memoryUsed: number;
  logs: SandboxLog[];
}

export interface SandboxLog {
  level: LogLevel;
  message: string;
  timestamp: number;
}

export interface SandboxStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTimeMs: number;
  peakMemoryUsage: number;
}

export interface Compiler {
  compile(input: V2ModuleNode, target: CompilerTarget): Promise<CompiledOutput>;
  validate(input: V2ModuleNode): Promise<ValidationResult>;
  getTargets(): CompilerTarget[];
}

export interface CompiledOutput {
  target: CompilerTarget;
  code: string;
  sourceMap?: string;
  dependencies: string[];
  metadata: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ValidationWarning {
  code: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ModuleGraph {
  addNode(node: V2ModuleNode): void;
  addEdge(edge: V2EdgeNode): void;
  removeNode(nodeId: string): void;
  removeEdge(edgeId: string): void;
  getExecutionOrder(): string[];
  getDependencies(nodeId: string): string[];
  getDependents(nodeId: string): string[];
  getNode(nodeId: string): V2ModuleNode | undefined;
  hasCycle(): boolean;
  topologicalSort(): string[];
}

export interface TokenBudget {
  allocate(amount: number, label?: string): TokenAllocation;
  spend(allocationId: string, amount: number): void;
  remaining(): number;
  getUsage(): TokenUsage;
}

export interface TokenAllocation {
  id: string;
  amount: number;
  label?: string;
  allocatedAt: number;
}

export interface TokenUsage {
  totalAllocated: number;
  totalSpent: number;
  totalRemaining: number;
  allocations: TokenAllocation[];
}

export interface MemoryEngine {
  store(id: string, content: string, metadata?: MemoryStoreMetadata): Promise<MemoryRecord>;
  retrieve(id: string): Promise<MemoryRecord | null>;
  search(query: string, options?: MemorySearchOptions): Promise<MemorySearchResult[]>;
  getStats(): MemoryEngineStats;
}

export interface MemoryStoreMetadata {
  source?: string;
  tags?: string[];
  embedding?: number[];
  timestamp?: number;
}

export interface MemoryRecord {
  id: string;
  content: string;
  metadata: MemoryStoreMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface MemorySearchOptions {
  limit?: number;
  threshold?: number;
  filter?: Record<string, unknown>;
}

export interface MemorySearchResult {
  record: MemoryRecord;
  score: number;
}

export interface MemoryEngineStats {
  totalRecords: number;
  totalSearches: number;
  averageSearchTimeMs: number;
  embeddingDimension?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: ToolHandler;
}

export interface ToolParameter {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

export type ToolHandler = (params: Record<string, unknown>, context?: ExecutionContext) => Promise<unknown>;

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface ToolEngine {
  register(tool: ToolDefinition): void;
  invoke(toolName: string, params: Record<string, unknown>, context?: ExecutionContext): Promise<unknown>;
  list(): ToolDefinition[];
  getSchema(toolName: string): ToolSchema | undefined;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  backoffMultiplier: number;
  strategy: RetryBackoffStrategy;
  retryableErrors?: string[];
}

export interface TelemetryInterface {
  track(event: string, properties?: Record<string, unknown>): void;
  flush(): Promise<void>;
  getMetrics(): TelemetryMetrics;
}

export interface TelemetryMetrics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  averageEventSize: number;
  flushCount: number;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  workingDir: process.cwd(),
  defaultTimeout: 30000,
  memoryLimit: 256 * 1024 * 1024,
  logging: true,
  logLevel: 'info',
  pluginDirs: ['.mam/plugins', 'node_modules/@mam/plugin-*'],
};
