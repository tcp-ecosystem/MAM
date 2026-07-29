/**
 * MAM Plugin Loader
 *
 * Loads, initializes, manages, and orchestrates MAM plugins through a
 * full lifecycle: init → ready → execute → cleanup.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PluginType = 'transform' | 'output' | 'input' | 'validator' | 'extension';

export interface PluginConfig {
  /** Plugin options supplied by the consumer. */
  options?: Record<string, unknown>;
  /** Ordered list of hook names the plugin registers. */
  hooks?: string[];
  /** Numeric priority – lower runs first. */
  priority?: number;
  /** Whether the plugin is enabled on creation. */
  enabled?: boolean;
}

export interface PluginContext {
  /** Arbitrary runtime key/value memory shared across hooks. */
  memory: Record<string, unknown>;
  /** Emit a namespaced event. */
  emit: (event: string, data?: unknown) => void;
  /** Subscribe to a namespaced event. Returns an unsubscribe function. */
  on: (event: string, listener: (data: unknown) => void) => () => void;
  /** Structured logger scoped to the plugin. */
  logger: PluginLogger;
  /** Reference to the runtime internals (read-only). */
  runtime: unknown;
}

export interface PluginLogger {
  debug(msg: string, ...args: unknown[]): void;
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

export interface Plugin {
  /** Unique plugin identifier. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Plugin type classification. */
  type?: PluginType;
  /** Configuration schema / defaults. */
  config?: PluginConfig;
  /** Names of plugins this plugin depends on. */
  dependencies?: string[];
  /** Numeric ordering priority (lower = earlier). */
  priority?: number;
  /** Whether the plugin is currently active. */
  enabled?: boolean;
  /** Called once when the plugin is first loaded. */
  initialize: (context: PluginContext) => void | Promise<void>;
  /** Called when the plugin transitions to the ready state. */
  ready?: () => void | Promise<void>;
  /** Called when a registered hook fires. */
  execute?: (hookName: string, data: unknown) => unknown | Promise<unknown>;
  /** Called during unload / shutdown. */
  destroy?: () => void | Promise<void>;
  /** Hook definitions the plugin exposes. */
  hooks?: PluginHook[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Convenience factory that merges a config object onto a base plugin
 * definition so consumers don't have to fill in boilerplate fields.
 */
export function createPlugin(base: Plugin): Plugin {
  return {
    type: 'extension',
    priority: 100,
    enabled: true,
    dependencies: [],
    hooks: [],
    ...base,
    config: {
      enabled: true,
      priority: 100,
      ...base.config,
    },
  };
}

// ---------------------------------------------------------------------------
// Re-export hook type used internally
// ---------------------------------------------------------------------------

interface PluginHook {
  name: string;
  phase: 'before' | 'after' | 'around';
  handler: (data: unknown) => unknown | Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

type PluginState = 'idle' | 'initialized' | 'ready' | 'executing' | 'cleaning' | 'error';

interface PluginEntry {
  plugin: Plugin;
  state: PluginState;
  loadedAt: number;
  context: PluginContext;
}

export class PluginLoader {
  private entries: Map<string, PluginEntry> = new Map();
  private eventListeners: Map<string, Set<(data: unknown) => void>> = new Map();
  private hookHandlers: Map<string, Array<{ pluginName: string; hook: PluginHook }>> = new Map();

  // -----------------------------------------------------------------------
  // Core lifecycle
  // -----------------------------------------------------------------------

  async load(plugin: Plugin): Promise<void> {
    if (this.entries.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already loaded`);
    }

    const context = this.createContext(plugin.name);

    const entry: PluginEntry = {
      plugin,
      state: 'idle',
      loadedAt: Date.now(),
      context,
    };

    this.entries.set(plugin.name, entry);

    try {
      await this.transition(entry, 'initialized');
      await plugin.initialize(context);
      await this.transition(entry, 'ready');
      await plugin.ready?.();
    } catch (err) {
      entry.state = 'error';
      context.logger.error(`Failed to load plugin "${plugin.name}": ${(err as Error).message}`);
      await this.safeUnload(plugin.name);
      throw err;
    }

    this.registerHooks(plugin);
    this.emit('plugin:loaded', { name: plugin.name, version: plugin.version });
  }

  async unload(name: string): Promise<void> {
    await this.safeUnload(name);
  }

  async reload(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin "${name}" is not loaded`);

    const plugin = entry.plugin;
    await this.safeUnload(name);
    await this.load(plugin);
  }

  // -----------------------------------------------------------------------
  // File-system loaders
  // -----------------------------------------------------------------------

  /**
   * Dynamically import a plugin from a file path.
   * The module must default-export a `Plugin` or an object matching the
   * `Plugin` interface.
   */
  async loadFromPath(filePath: string): Promise<void> {
    const imported = await import(filePath);
    const candidate = imported.default ?? imported.plugin ?? imported;
    if (!candidate || typeof candidate.name !== 'string') {
      throw new Error(`Module at "${filePath}" does not export a valid Plugin`);
    }
    await this.load(candidate as Plugin);
  }

  /**
   * Scan a directory and attempt to load every `.js` / `.mjs` file as a
   * plugin. Files that fail to parse as plugins are silently skipped.
   */
  async loadAll(dir: string): Promise<{ loaded: string[]; skipped: string[] }> {
    const loaded: string[] = [];
    const skipped: string[] = [];

    let files: string[];
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      files = fs.readdirSync(dir).filter((f: string) => /\.(js|mjs)$/.test(f));
    } catch {
      throw new Error(`Cannot read plugin directory: ${dir}`);
    }

    for (const file of files) {
      const filePath = `file://${dir}/${file}`;
      try {
        await this.loadFromPath(filePath);
        loaded.push(file);
      } catch {
        skipped.push(file);
      }
    }

    return { loaded, skipped };
  }

  // -----------------------------------------------------------------------
  // Dependency resolution
  // -----------------------------------------------------------------------

  /**
   * Return plugin names in topological order (dependencies first).
   * Throws if there is a cycle or a missing dependency.
   */
  resolveDependencies(): string[] {
    const graph = new Map<string, string[]>();
    for (const [name, entry] of this.entries) {
      graph.set(name, entry.plugin.dependencies ?? []);
    }

    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular dependency detected involving "${name}"`);
      visiting.add(name);

      for (const dep of graph.get(name) ?? []) {
        if (!this.entries.has(dep)) {
          throw new Error(`Missing dependency "${dep}" for plugin "${name}"`);
        }
        visit(dep);
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of graph.keys()) {
      visit(name);
    }

    return order;
  }

  // -----------------------------------------------------------------------
  // Enable / disable
  // -----------------------------------------------------------------------

  enable(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin "${name}" is not loaded`);
    entry.plugin.enabled = true;
    this.emit('plugin:enabled', { name });
  }

  disable(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin "${name}" is not loaded`);
    entry.plugin.enabled = false;
    this.emit('plugin:disabled', { name });
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  get(name: string): Plugin | undefined {
    return this.entries.get(name)?.plugin;
  }

  list(): Plugin[] {
    return Array.from(this.entries.values()).map((e) => e.plugin);
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  getByType(type: PluginType): Plugin[] {
    return this.list().filter((p) => p.type === type);
  }

  getStats(): LoaderStats {
    let memoryUsage = 0;
    try {
      memoryUsage = process.memoryUsage().heapUsed;
    } catch { /* non-node env */ }

    return {
      totalLoaded: this.entries.size,
      enabledCount: this.list().filter((p) => p.enabled !== false).length,
      byType: this.groupByType(),
      memoryUsage,
      hookCount: this.hookHandlers.size,
    };
  }

  // -----------------------------------------------------------------------
  // Hook execution
  // -----------------------------------------------------------------------

  /**
   * Execute a named hook across all loaded plugins that register it.
   * Hooks run in priority order (lower first).
   */
  async executeHook(hookName: string, data: unknown): Promise<unknown> {
    const handlers = this.hookHandlers.get(hookName) ?? [];
    let result = data;

    for (const { pluginName, hook } of handlers) {
      const entry = this.entries.get(pluginName);
      if (!entry || entry.plugin.enabled === false) continue;

      if (hook.phase === 'before') {
        result = (await hook.handler(result)) ?? result;
      }
    }

    for (const { pluginName, hook } of handlers) {
      const entry = this.entries.get(pluginName);
      if (!entry || entry.plugin.enabled === false) continue;

      if (hook.phase === 'around') {
        result = (await hook.handler(result)) ?? result;
      }
    }

    for (const { pluginName, hook } of handlers) {
      const entry = this.entries.get(pluginName);
      if (!entry || entry.plugin.enabled === false) continue;

      if (hook.phase === 'after') {
        result = (await hook.handler(result)) ?? result;
      }
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  on(event: string, listener: (data: unknown) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
    return () => {
      this.eventListeners.get(event)?.delete(listener);
    };
  }

  emit(event: string, data?: unknown): void {
    for (const listener of this.eventListeners.get(event) ?? []) {
      try {
        listener(data);
      } catch { /* swallow listener errors */ }
    }
  }

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  async unloadAll(): Promise<void> {
    const order = this.resolveDependencies().reverse();
    for (const name of order) {
      await this.safeUnload(name);
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private createContext(pluginName: string): PluginContext {
    const memory: Record<string, unknown> = {};

    const createLogger = (): PluginLogger => {
      const prefix = `[plugin:${pluginName}]`;
      return {
        debug: (msg, ...args) => console.debug(prefix, msg, ...args),
        info: (msg, ...args) => console.info(prefix, msg, ...args),
        warn: (msg, ...args) => console.warn(prefix, msg, ...args),
        error: (msg, ...args) => console.error(prefix, msg, ...args),
      };
    };

    return {
      memory,
      emit: (event, data) => this.emit(`${pluginName}:${event}`, data),
      on: (event, listener) => this.on(`${pluginName}:${event}`, listener),
      logger: createLogger(),
      runtime: undefined,
    };
  }

  private registerHooks(plugin: Plugin): void {
    if (!plugin.hooks) return;

    for (const hook of plugin.hooks) {
      if (!this.hookHandlers.has(hook.name)) {
        this.hookHandlers.set(hook.name, []);
      }
      this.hookHandlers.get(hook.name)!.push({
        pluginName: plugin.name,
        hook,
      });
    }

    this.hookHandlers.forEach((handlers) => {
      handlers.sort((a, b) => {
        const pa = this.entries.get(a.pluginName)?.plugin.priority ?? 100;
        const pb = this.entries.get(b.pluginName)?.plugin.priority ?? 100;
        return pa - pb;
      });
    });
  }

  private unregisterHooks(pluginName: string): void {
    for (const [hookName, handlers] of this.hookHandlers) {
      const filtered = handlers.filter((h) => h.pluginName !== pluginName);
      if (filtered.length === 0) {
        this.hookHandlers.delete(hookName);
      } else {
        this.hookHandlers.set(hookName, filtered);
      }
    }
  }

  private async transition(entry: PluginEntry, target: PluginState): Promise<void> {
    entry.state = target;
  }

  private async safeUnload(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return;

    try {
      entry.state = 'cleaning';
      await entry.plugin.destroy?.();
    } catch { /* ignore cleanup errors */ }

    this.unregisterHooks(name);
    this.entries.delete(name);
    this.emit('plugin:unloaded', { name });
  }

  private groupByType(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      const t = entry.plugin.type ?? 'unknown';
      counts[t] = (counts[t] ?? 0) + 1;
    }
    return counts;
  }
}

// -----------------------------------------------------------------------
// Stats
// -----------------------------------------------------------------------

export interface LoaderStats {
  totalLoaded: number;
  enabledCount: number;
  byType: Record<string, number>;
  memoryUsage: number;
  hookCount: number;
}
