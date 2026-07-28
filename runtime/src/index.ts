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
  BaseExecutionContext,
  PythonExecutionContext,
  JavaScriptExecutionContext,
  createExecutionContext,
  PythonContext,
  JavaScriptContext,
  RustContext,
  GoContext,
} from './contexts/index.js';

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