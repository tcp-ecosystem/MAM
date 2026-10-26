/**
 * MAM Runtime
 * 
 * Execution engine for MAM modules.
 */

export {
  MAMRuntime,
  executeModule,
  type RuntimeConfig,
  type RuntimeExecutionOptions,
  type ModuleExecutionResult,
} from './runtime.js';

export {
  ModuleExecutor,
  type ExecutorConfig,
  type ExecutorResult,
} from './executor.js';

export {
  type ExecutionContext,
  type ExecutionContextConfig,
  type ExecutionResult,
  type ContextStats,
  type ContextEvent,
  type ContextEventListener,
  type LanguageConfig,
  SUPPORTED_LANGUAGES,
  BaseExecutionContext,
  PythonExecutionContext,
  JavaScriptExecutionContext,
  TypeScriptContext,
  createExecutionContext,
  PythonContext,
  JavaScriptContext,
  RustContext,
  GoContext,
} from './contexts/index.js';

export {
  MAMV2Runtime,
  createV2Runtime,
  DEFAULT_RUNTIME_CONFIG,
  type RuntimeInterface,
  type RuntimeConfig as V2RuntimeConfig,
  type ExecutionContext as V2ExecutionContext,
  type ExecutionResult as V2ExecutionResult,
  type SystemResult,
  type MemoryStore,
  type MemoryOptions,
  type MemoryStats,
  type EventEmitter as V2EventEmitter,
  type EventListener as V2EventListener,
  type MAMEvent as V2Event,
  type StateManager,
  type StateCallback,
  type StateChange,
  type PermissionChecker,
  type PermissionContext,
  type PermissionResult,
  type PluginLoader as V2PluginLoader,
  type Plugin as V2Plugin,
  type PluginContext as V2PluginContext,
  type Logger,
  type ExecutionOptions,
} from './v2/index.js';

export {
  type Sandbox,
  type SandboxConfig,
  ProcessSandbox,
  VMSandbox,
  createSandbox,
  ProcessSandboxImpl,
  VMSandboxImpl,
  DockerSandbox,
} from './sandboxes/index.js';

export {
  PluginLoader,
  type Plugin,
  PluginRegistry,
  type PluginMetadata,
} from './plugins/index.js';

export {
  JSONOutput,
  HTMLOutput,
  MarkdownOutput,
} from './outputs/index.js';

export {
  LirRegistry,
  createDefaultLirRegistry,
  PythonLirAdapter,
  NodeLirAdapter,
  LirError,
  isLirError,
  parseImplementationDeclarations,
  resolveImplementation,
  SUPPORTED_LIR_LANGUAGES,
  DEFAULT_LIR_POLICY,
  DEFAULT_EXPORT_FOR_LANGUAGE,
  type CreateDefaultLirRegistryOptions,
  type ImplementationDeclaration,
  type JsonObject,
  type JsonPrimitive,
  type JsonValue,
  type LirAdapter,
  type LirErrorCode,
  type LirFailure,
  type LirInvocationFailure,
  type LirInvocationRecord,
  type LirInvocationRequest,
  type LirInvocationResult,
  type LirInvocationSuccess,
  type LirInvokeOptions,
  type LirLanguage,
  type LirPolicy,
  type LirProbeOptions,
  type LirProbeResult,
  type LirRegistryOptions,
  type ResolvedImplementation,
} from './lir/index.js';
