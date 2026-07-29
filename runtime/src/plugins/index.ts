/**
 * MAM Runtime Plugin System
 *
 * Provides plugin loading, lifecycle management, dependency resolution,
 * hook execution, and event-driven plugin discovery.
 *
 * @example
 *   import {
 *     PluginLoader, PluginRegistry, createPlugin,
 *     type Plugin, type PluginConfig, type PluginContext,
 *   } from './plugins/index.js';
 *
 *   const loader = new PluginLoader();
 *   const registry = new PluginRegistry();
 *
 *   const myPlugin = createPlugin({
 *     name: 'my-plugin',
 *     version: '1.0.0',
 *     initialize: async (ctx) => { ctx.logger.info('ready'); },
 *   });
 *
 *   registry.register({ name: myPlugin.name, version: myPlugin.version });
 *   await loader.load(myPlugin);
 *
 *   // Execute hooks across all loaded plugins
 *   const result = await loader.executeHook('transform', inputData);
 *
 *   // Query loaded plugins
 *   const transforms = loader.getByType('transform');
 *
 *   // Resolve dependency order
 *   const loadOrder = loader.resolveDependencies();
 */

// ---------------------------------------------------------------------------
// Loader exports
// ---------------------------------------------------------------------------

export {
  PluginLoader,
  type Plugin,
  type PluginConfig,
  type PluginContext,
  type PluginLogger,
  type PluginType,
  type LoaderStats,
  createPlugin,
} from './loader.js';

// ---------------------------------------------------------------------------
// Registry exports
// ---------------------------------------------------------------------------

export {
  PluginRegistry,
  type PluginMetadata,
  type PluginHook,
  type PluginEvent,
  type PluginEventListener,
  type RegistryStats,
} from './registry.js';

// ---------------------------------------------------------------------------
// Convenience re-exports (value + type in one statement)
// ---------------------------------------------------------------------------

export { PluginLoader as PluginLoaderClass } from './loader.js';
export { PluginRegistry as PluginRegistryClass } from './registry.js';

// ---------------------------------------------------------------------------
// Utility types
// ---------------------------------------------------------------------------

import type { Plugin as PluginType, PluginConfig as PluginConfigType } from './loader.js';

/** Extract the plugin type union from a loader instance. */
export type ExtractPluginNames<L> = L extends { get(name: infer N): unknown } ? N : never;

/** Map of plugin name → Plugin instance. */
export type PluginMap = Record<string, PluginType>;

/** Callback invoked when a plugin's lifecycle state changes. */
export type PluginStateListener = (event: {
  plugin: string;
  from: string;
  to: string;
  timestamp: number;
}) => void;

/** Options for creating a plugin with sensible defaults. */
export interface CreatePluginOptions extends Partial<PluginConfigType> {
  name: string;
  version: string;
}
