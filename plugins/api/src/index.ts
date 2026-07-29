/**
 * MAM Plugin API
 *
 * Main exports for the MAM plugin system.
 */

// ─── Types ──────────────────────────────────────────────────────────
export {
  type MAMPlugin,
  type PluginManifest,
  type PluginCategory,
  type SectionDefinition,
  type SectionExample,
  type ContentType,
  type ValidationRule,
  type ValidationResult,
  type ValidationFix,
  type ValidationFixReplacement,
  type PluginHooks,
  type PluginError,
  type ExportOutput,
  type PluginConfig,
  type RuntimeContext,
  type RuntimeCapability,
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionArtifact,
  type Exporter,
  type ExportOptions,
  type ExportOptionDefinition,
  type Renderer,
  type RenderTarget,
  type RenderOptions,
  type Transformer,
  type TransformContext,
  type PluginMiddleware,
  type MiddlewarePhase,
  type HookName,
  type HookRegistration,
  type PluginRegistryEntry,
  type PluginRegistryConfig,
  type PluginEvent,
  type PluginEventData,
  type DeepPartial,
  type PluginMap,
  type RegistryMap,
  type HookMap,
  type EventMap,
  type EventSubscription,
  ALL_HOOK_NAMES,
  isMAMPlugin,
  isValidationResult,
  isExecutionResult,
  isRuntimeContext,
  isRenderer,
  isExporter,
  isTransformer,
} from './types.js';

// ─── Hook Manager ───────────────────────────────────────────────────
export {
  HookManager,
  type HookExecutionResult,
  type HookManagerStats,
} from './hooks.js';

// ─── Plugin Registry ────────────────────────────────────────────────
export {
  PluginRegistry,
  type RegistryLoadResult,
  type RegistryStats,
} from './registry.js';

// ─── Plugin Loader ──────────────────────────────────────────────────
export {
  loadPluginFromPath,
  discoverPluginPaths,
  discoverPluginsInNodeModules,
  validateManifest,
  resolvePluginPath,
  getPluginNameFromPath,
  getPluginScope,
  type LoadPluginResult,
  type ManifestValidationResult,
  type PluginLoadContext,
} from './loader.js';

// ─── Lifecycle Manager ──────────────────────────────────────────────
export {
  PluginLifecycleManager,
  type PluginState,
  type PluginLifecycleEntry,
  type LifecycleEvent,
} from './lifecycle.js';

// ─── Context Provider ───────────────────────────────────────────────
export {
  PluginContextProvider,
  type PluginContextOptions,
  type ExecutionRecord,
  type ContextMetrics,
  type ResourceSnapshot,
} from './context.js';

// ─── Event Bus ──────────────────────────────────────────────────────
export {
  PluginEventBus,
  type EventHandler,
  type EventStats,
  type EmittedEvent,
} from './events.js';

// ─── Validator ──────────────────────────────────────────────────────
export {
  validatePluginManifest,
  validatePluginIntegrity,
  getPluginStats,
  formatIntegrityReport,
  type PluginIntegrityReport,
  type PluginIntegrityStats,
} from './validator.js';
