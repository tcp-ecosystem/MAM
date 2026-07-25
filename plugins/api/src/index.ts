/**
 * MAM Plugin API
 * 
 * Main exports for the MAM plugin system.
 */

export {
  type MAMPlugin,
  type PluginManifest,
  type SectionDefinition,
  type ContentType,
  type ValidationRule,
  type ValidationResult,
  type PluginHooks,
  type RuntimeContext,
  type ExecutionContext,
  type ExecutionResult,
  type Exporter,
  type Renderer,
  type HookName,
  type HookRegistration,
  type PluginRegistryEntry,
  type PluginEvent,
} from './types.js';

export { HookManager } from './hooks.js';
export { PluginRegistry } from './registry.js';