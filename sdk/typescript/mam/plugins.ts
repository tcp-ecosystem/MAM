import { Module } from './ast.js';

/** Pipeline points at which a plugin can be invoked. */
export type HookPoint = 'before_parse' | 'after_parse' | 'before_validate' | 'after_validate' | 'before_execute' | 'after_execute' | 'on_error';

/** State passed to a plugin callback. */
export interface PluginContext {
  module?: Module;
  hook: HookPoint;
  data: Record<string, unknown>;
  cancelled: boolean;
  error?: Error;
}

/** Minimal plugin interface shared by all SDK implementations. */
export interface Plugin {
  readonly name: string;
  readonly version: string;
  readonly hooks: readonly HookPoint[];
  handle(context: PluginContext): void | Promise<void>;
}

/** Registry that dispatches plugins in registration order. */
export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  /** Registers a plugin; duplicate names are rejected. */
  register(plugin: Plugin): this {
    if (!plugin.name.trim()) throw new Error('plugin name must not be empty');
    if (this.plugins.has(plugin.name)) throw new Error(`plugin already registered: ${plugin.name}`);
    this.plugins.set(plugin.name, plugin);
    return this;
  }

  /** Registers a plugin and throws on any registration error. */
  mustRegister(plugin: Plugin): void {
    this.register(plugin);
  }

  /** Removes a plugin, returning whether it existed. */
  unregister(name: string): boolean {
    return this.plugins.delete(name);
  }

  /** Returns a registered plugin by name. */
  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  /** Reports whether a name is registered. */
  has(name: string): boolean {
    return this.plugins.has(name);
  }

  /** Returns registered plugin names in registration order. */
  names(): string[] {
    return [...this.plugins.keys()];
  }

  /** Returns the number of registered plugins. */
  count(): number {
    return this.plugins.size;
  }

  /** Returns the plugins registered for a hook. */
  pluginsFor(hook: HookPoint): Plugin[] {
    return [...this.plugins.values()].filter((plugin) => plugin.hooks.includes(hook));
  }

  /** Returns registered plugin names for a hook. */
  hookNames(hook: HookPoint): string[] {
    return this.pluginsFor(hook).map((plugin) => plugin.name);
  }

  /** Fires a hook and stops when a plugin cancels or throws. */
  async fire(hook: HookPoint, context: Omit<PluginContext, 'hook'> = { data: {}, cancelled: false }): Promise<PluginContext> {
    const state: PluginContext = { ...context, hook };
    for (const plugin of this.pluginsFor(hook)) {
      try {
        await plugin.handle(state);
      } catch (error) {
        state.error = error instanceof Error ? error : new Error(String(error));
        throw state.error;
      }
      if (state.cancelled) break;
    }
    return state;
  }

  /** Removes every plugin. */
  clear(): void {
    this.plugins.clear();
  }

  /** Returns a sorted snapshot of plugin metadata. */
  describe(): Array<{ name: string; version: string; hooks: readonly HookPoint[] }> {
    return [...this.plugins.values()].map(({ name, version, hooks }) => ({ name, version, hooks: [...hooks] })).sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Creates an empty registry. */
export function createPluginRegistry(): PluginRegistry {
  return new PluginRegistry();
}

/** Returns every standard hook point in lifecycle order. */
export function knownHooks(): readonly HookPoint[] {
  return ['before_parse', 'after_parse', 'before_validate', 'after_validate', 'before_execute', 'after_execute', 'on_error'];
}

/** Creates a plugin context with defensive data storage. */
export function createPluginContext(module?: Module, data: Record<string, unknown> = {}): Omit<PluginContext, 'hook'> {
  return { module, data: { ...data }, cancelled: false };
}

/** Creates a function-backed plugin useful in tests and embedding. */
export function functionPlugin(name: string, hooks: HookPoint[], handler: (context: PluginContext) => void | Promise<void>, version = '1.0.0'): Plugin {
  return { name, version, hooks: [...hooks], handle: handler };
}

/** Returns whether a plugin listens to a hook. */
export function pluginHasHook(plugin: Plugin, hook: HookPoint): boolean {
  return plugin.hooks.includes(hook);
}

/** Returns plugins sorted by semantic version descending. */
export function pluginsByVersion(registry: PluginRegistry): Plugin[] {
  return registry.names().map((name) => registry.get(name)).filter((plugin): plugin is Plugin => plugin !== undefined).sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

/** Returns a diagnostic-safe registry summary. */
export function registrySummary(registry: PluginRegistry): string {
  return registry.count() === 0 ? 'no plugins' : `${registry.count()} plugins: ${registry.names().join(', ')}`;
}

/** Creates a context for a hook. */
export function hookContext(hook: HookPoint, data: Record<string, unknown> = {}): PluginContext {
  return { hook, data: { ...data }, cancelled: false };
}

/** Reports whether a hook point is known. */
export function isKnownHook(value: string): value is HookPoint {
  return knownHooks().includes(value as HookPoint);
}

/** Returns plugins that listen to any of several hooks. */
export function pluginsForAny(registry: PluginRegistry, hooks: HookPoint[]): Plugin[] {
  return registry.names().map((name) => registry.get(name)).filter((plugin): plugin is Plugin => plugin !== undefined && plugin.hooks.some((hook) => hooks.includes(hook)));
}

/** Returns a duplicate-free hook list from plugins. */
export function registeredHooks(registry: PluginRegistry): HookPoint[] {
  return knownHooks().filter((hook) => registry.hookNames(hook).length > 0);
}

/** Returns a registry containing only matching plugins. */
export function filteredRegistry(registry: PluginRegistry, predicate: (plugin: Plugin) => boolean): PluginRegistry {
  const result = createPluginRegistry();
  for (const plugin of registry.names().map((name) => registry.get(name)).filter((item): item is Plugin => item !== undefined)) if (predicate(plugin)) result.register(plugin);
  return result;
}

/** Returns plugin versions. */
export function pluginVersions(registry: PluginRegistry): Record<string, string> {
  return Object.fromEntries(registry.describe().map((plugin) => [plugin.name, plugin.version]));
}

/** Returns the number of hook subscriptions. */
export function hookSubscriptionCount(registry: PluginRegistry): number {
  return registry.describe().reduce((sum, plugin) => sum + plugin.hooks.length, 0);
}

/** Reports whether two registries have the same names. */
export function samePluginNames(left: PluginRegistry, right: PluginRegistry): boolean {
  return left.names().sort().join('\u0000') === right.names().sort().join('\u0000');
}

/** Cancels a context without invoking a plugin. */
export function cancelContext(context: PluginContext): PluginContext {
  context.cancelled = true;
  return context;
}

/** Adds data to a context. */
export function setContextData(context: PluginContext, key: string, value: unknown): PluginContext {
  context.data[key] = value;
  return context;
}

/** Returns context data with a fallback. */
export function contextValue(context: PluginContext, key: string, fallback: unknown = undefined): unknown {
  return context.data[key] ?? fallback;
}

/** Returns a stable lifecycle description. */
export function hookLabel(hook: HookPoint): string {
  return hook.replace(/_/g, ' ');
}

/** Returns a safe error message for plugin failures. */
export function pluginErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns a list of plugin hook labels. */
export function pluginHookLabels(plugin: Plugin): string[] {
  return plugin.hooks.map(hookLabel);
}

/** Reports whether a registry has any hook subscriptions. */
export function registryHasHooks(registry: PluginRegistry): boolean {
  return hookSubscriptionCount(registry) > 0;
}

/** Returns a fresh empty context. */
export function emptyPluginContext(hook: HookPoint): PluginContext {
  return hookContext(hook);
}

/** Returns a plugin's display name. */
export function pluginDisplayName(plugin: Plugin): string {
  return `${plugin.name}@${plugin.version}`;
}

/** Returns a plugin's hook count. */
export function pluginHookCount(plugin: Plugin): number {
  return plugin.hooks.length;
}

/** Returns a plugin's display description. */
export function pluginDescription(plugin: Plugin): string {
  return `${pluginDisplayName(plugin)} (${pluginHookCount(plugin)} hooks)`;
}

/** Reports whether a plugin has a semantic version. */
export function pluginHasVersion(plugin: Plugin): boolean {
  return plugin.version.trim().length > 0;
}

/** Reports whether a plugin has hooks. */
export function pluginHasHooks(plugin: Plugin): boolean {
  return plugin.hooks.length > 0;
}

/** Returns a registry's plugin display names. */
export function registryDisplayNames(registry: PluginRegistry): string[] {
  return registry.describe().map((plugin) => `${plugin.name}@${plugin.version} (${plugin.hooks.length} hooks)`);
}

/** Returns a registry's hook count by hook. */
export function registryHookCounts(registry: PluginRegistry): Record<string, number> {
  return Object.fromEntries(knownHooks().map((hook) => [hook, registry.hookNames(hook).length]));
}

/** Returns a safe registry name. */
export function registryName(registry: PluginRegistry): string {
  return registry.count() ? `registry(${registry.count()})` : 'registry(empty)';
}

/** Returns whether a plugin is cancellable by convention. */
export function pluginCanCancel(plugin: Plugin): boolean {
  return plugin.hooks.includes('on_error') || plugin.hooks.includes('before_execute');
}

/** Returns a context error message. */
export function contextError(context: PluginContext): string | undefined {
  return context.error?.message;
}

/** Returns a context module name. */
export function contextModuleName(context: PluginContext): string {
  return context.module?.frontmatter?.name || '(none)';
}

/** Returns a context data key list. */
export function contextDataKeys(context: PluginContext): string[] {
  return Object.keys(context.data).sort();
}

/** Returns a plugin registry from a list. */
export function registryFromPlugins(plugins: Plugin[]): PluginRegistry {
  const registry = createPluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  return registry;
}

/** Returns a context cancellation flag. */
export function contextCancelled(context: PluginContext): boolean {
  return context.cancelled;
}

/** Returns a short plugin status string. */
export function pluginStatus(registry: PluginRegistry): string {
  return `${registry.count()}/${knownHooks().length} hooks registered`;
}

/** Returns a context data summary. */
export function contextSummary(context: PluginContext): string {
  return `${context.hook}: ${contextDataKeys(context).join(', ') || 'no data'}`;
}

/** Returns a safe plugin version. */
export function safePluginVersion(plugin: Plugin): string {
  return plugin.version.trim() || '0.0.0';
}

/** Reports whether a plugin name is valid. */
export function validPluginName(name: string): boolean {
  return name.trim().length > 0;
}
