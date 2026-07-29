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
  type Event as V2Event,
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
