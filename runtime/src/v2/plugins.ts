import { PluginLoader, Plugin, PluginContext, RuntimeInterface, MemoryStore, EventEmitter, Logger } from './types.js';

export interface PluginMetrics {
  executionCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastExecuted?: number;
  firstExecuted?: number;
}

export interface PluginHealthStatus {
  name: string;
  healthy: boolean;
  lastCheck: number;
  error?: string;
}

export interface DependencyNode {
  name: string;
  dependencies: string[];
  dependents: string[];
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface SandboxContext {
  memory: MemoryStore;
  events: EventEmitter;
  logger: Logger;
  isolated: boolean;
  permissions: Set<string>;
}

interface PluginMeta {
  plugin: Plugin;
  dependencies: string[];
  tags: string[];
  capabilities: string[];
  configSchema: Record<string, unknown>;
  config: Record<string, unknown>;
  filePath?: string;
  lastVersion?: string;
  healthCheckInterval?: ReturnType<typeof setInterval>;
  healthStatus: PluginHealthStatus;
  metrics: PluginMetrics;
}

export class DefaultPluginLoader implements PluginLoader {
  private plugins = new Map<string, Plugin>();
  private loadOrder: string[] = [];
  private pluginMeta = new Map<string, PluginMeta>();
  private fileWatchers = new Map<string, ReturnType<typeof setTimeout>>();
  private sandboxContexts = new Map<string, SandboxContext>();
  private healthCheckMs = 30000;
  private logger?: Logger;

  async load(path: string): Promise<Plugin> {
    const module = await import(path);
    const pluginFactory = module.default ?? module;
    const plugin: Plugin = typeof pluginFactory === 'function'
      ? await pluginFactory()
      : pluginFactory;

    if (!plugin.name || !plugin.version || !plugin.type) {
      throw new Error(`Invalid plugin at ${path}: missing name, version, or type`);
    }

    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already loaded: ${plugin.name}`);
    }

    const deps = this.extractDependencies(plugin);
    const tags = this.extractTags(plugin);
    const caps = this.extractCapabilities(plugin);
    const schema = this.extractConfigSchema(plugin);

    this.validateNoCircularDeps(plugin.name, deps);

    const meta: PluginMeta = {
      plugin,
      dependencies: deps,
      tags,
      capabilities: caps,
      configSchema: schema,
      config: {},
      filePath: path,
      lastVersion: plugin.version,
      healthStatus: { name: plugin.name, healthy: true, lastCheck: Date.now() },
      metrics: { executionCount: 0, errorCount: 0, totalDurationMs: 0, avgDurationMs: 0 },
    };

    this.plugins.set(plugin.name, plugin);
    this.loadOrder.push(plugin.name);
    this.pluginMeta.set(plugin.name, meta);

    return plugin;
  }

  async loadAll(dir: string): Promise<Plugin[]> {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const loaded: Plugin[] = [];

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return loaded;
    }

    for (const entry of entries) {
      if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.ts')) {
        try {
          const plugin = await this.load(join(dir, entry));
          loaded.push(plugin);
        } catch {
          // Skip invalid plugins
        }
      }
    }

    return loaded;
  }

  async unload(name: string): Promise<void> {
    const meta = this.pluginMeta.get(name);
    if (meta) {
      if (meta.healthCheckInterval) {
        clearInterval(meta.healthCheckInterval);
      }
      const watcher = this.fileWatchers.get(name);
      if (watcher) {
        clearTimeout(watcher);
        this.fileWatchers.delete(name);
      }
      this.sandboxContexts.delete(name);
      this.pluginMeta.delete(name);
    }

    const plugin = this.plugins.get(name);
    if (plugin) {
      await plugin.cleanup();
      this.plugins.delete(name);
      const idx = this.loadOrder.indexOf(name);
      if (idx >= 0) this.loadOrder.splice(idx, 1);
    }
  }

  getLoaded(): Plugin[] {
    return this.loadOrder.map(name => this.plugins.get(name)!).filter(Boolean);
  }

  getByName(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  async initAll(context: PluginContext): Promise<void> {
    this.logger = context.logger;
    const sorted = this.resolveInitOrder();
    for (const name of sorted) {
      const plugin = this.plugins.get(name);
      const meta = this.pluginMeta.get(name);
      if (!plugin || !meta) continue;

      try {
        await this.runLifecycleHook(name, 'beforeInit', context);
        await plugin.init(context);
        await this.runLifecycleHook(name, 'afterInit', context);
        this.startHealthCheck(name, plugin);
      } catch (error) {
        context.logger.error(`Failed to initialize plugin ${plugin.name}: ${(error as Error).message}`);
        await this.runLifecycleHook(name, 'onError', { error, context });
      }
    }
  }

  async cleanupAll(): Promise<void> {
    for (const name of [...this.loadOrder].reverse()) {
      await this.unload(name);
    }
  }

  getStats(): { total: number; byType: Record<string, number> } {
    const byType: Record<string, number> = {};
    for (const plugin of this.plugins.values()) {
      byType[plugin.type] = (byType[plugin.type] ?? 0) + 1;
    }
    return { total: this.plugins.size, byType };
  }

  async reloadPlugin(name: string): Promise<Plugin> {
    const meta = this.pluginMeta.get(name);
    if (!meta || !meta.filePath) {
      throw new Error(`Cannot reload plugin ${name}: no file path recorded`);
    }

    const oldVersion = meta.lastVersion;
    await this.unload(name);

    const plugin = await this.load(meta.filePath);
    const newMeta = this.pluginMeta.get(name);

    if (newMeta && oldVersion && plugin.version !== oldVersion) {
      if (this.logger) {
        this.logger.info(`Plugin ${name} reloaded: ${oldVersion} -> ${plugin.version}`);
      }
    }

    return plugin;
  }

  getPluginMetrics(name: string): PluginMetrics | undefined {
    const meta = this.pluginMeta.get(name);
    return meta?.metrics;
  }

  validateConfig(plugin: Plugin, config: Record<string, unknown>): ConfigValidationResult {
    const meta = this.pluginMeta.get(plugin.name);
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!meta) {
      errors.push(`Plugin ${plugin.name} not registered`);
      return { valid: false, errors, warnings };
    }

    const schema = meta.configSchema as Record<string, { type?: string; required?: boolean; default?: unknown }>;
    for (const [key, rules] of Object.entries(schema)) {
      if (rules.required && !(key in config)) {
        errors.push(`Missing required config key: ${key}`);
      }
      if (key in config && rules.type) {
        const val = config[key];
        const actualType = typeof val;
        if (actualType !== rules.type) {
          errors.push(`Config key ${key}: expected ${rules.type}, got ${actualType}`);
        }
      }
    }

    for (const key of Object.keys(config)) {
      if (!(key in schema)) {
        warnings.push(`Unknown config key: ${key}`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  getDependencyGraph(): DependencyNode[] {
    const nodes: DependencyNode[] = [];
    for (const [name, meta] of this.pluginMeta) {
      const dependents: string[] = [];
      for (const [otherName, otherMeta] of this.pluginMeta) {
        if (otherMeta.dependencies.includes(name)) {
          dependents.push(otherName);
        }
      }
      nodes.push({ name, dependencies: meta.dependencies, dependents });
    }
    return nodes;
  }

  getPluginsByType(type: Plugin['type']): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.type === type);
  }

  getPluginsByCapability(capability: string): Plugin[] {
    const result: Plugin[] = [];
    for (const [name, meta] of this.pluginMeta) {
      if (meta.capabilities.includes(capability)) {
        result.push(meta.plugin);
      }
    }
    return result;
  }

  getPluginsByTag(tag: string): Plugin[] {
    const result: Plugin[] = [];
    for (const [name, meta] of this.pluginMeta) {
      if (meta.tags.includes(tag)) {
        result.push(meta.plugin);
      }
    }
    return result;
  }

  createSandbox(name: string, context: PluginContext): SandboxContext {
    const sandbox: SandboxContext = {
      memory: context.memory,
      events: context.events,
      logger: context.logger,
      isolated: true,
      permissions: new Set(['read', 'execute']),
    };
    this.sandboxContexts.set(name, sandbox);
    return sandbox;
  }

  getSandbox(name: string): SandboxContext | undefined {
    return this.sandboxContexts.get(name);
  }

  getHealthStatus(name: string): PluginHealthStatus | undefined {
    return this.pluginMeta.get(name)?.healthStatus;
  }

  getAllHealthStatuses(): PluginHealthStatus[] {
    const statuses: PluginHealthStatus[] = [];
    for (const meta of this.pluginMeta.values()) {
      statuses.push(meta.healthStatus);
    }
    return statuses;
  }

  setHealthCheckInterval(ms: number): void {
    this.healthCheckMs = ms;
    for (const [name, meta] of this.pluginMeta) {
      if (meta.healthCheckInterval) {
        clearInterval(meta.healthCheckInterval);
      }
      this.startHealthCheck(name, meta.plugin);
    }
  }

  setPluginConfig(name: string, config: Record<string, unknown>): void {
    const meta = this.pluginMeta.get(name);
    if (meta) {
      meta.config = { ...meta.config, ...config };
    }
  }

  getPluginConfig(name: string): Record<string, unknown> | undefined {
    return this.pluginMeta.get(name)?.config;
  }

  enableHotReload(name: string, intervalMs: number = 5000): void {
    const meta = this.pluginMeta.get(name);
    if (!meta || !meta.filePath) return;

    const check = async () => {
      try {
        const { stat } = await import('node:fs/promises');
        const fileStat = await stat(meta.filePath!);
        const mtime = fileStat.mtimeMs.toString();
        if (meta.lastVersion && mtime !== meta.lastVersion) {
          if (this.logger) {
            this.logger.info(`Hot-reload triggered for ${name}`);
          }
          await this.reloadPlugin(name);
        }
      } catch {
        // File not accessible
      }
    };

    const watcher = setInterval(check, intervalMs);
    this.fileWatchers.set(name, watcher as unknown as ReturnType<typeof setTimeout>);
  }

  disableHotReload(name: string): void {
    const watcher = this.fileWatchers.get(name);
    if (watcher) {
      clearTimeout(watcher);
      this.fileWatchers.delete(name);
    }
  }

  private extractDependencies(plugin: Plugin): string[] {
    const p = plugin as Plugin & { dependencies?: string[] };
    return Array.isArray(p.dependencies) ? p.dependencies : [];
  }

  private extractTags(plugin: Plugin): string[] {
    const p = plugin as Plugin & { tags?: string[] };
    return Array.isArray(p.tags) ? p.tags : [];
  }

  private extractCapabilities(plugin: Plugin): string[] {
    const p = plugin as Plugin & { capabilities?: string[] };
    return Array.isArray(p.capabilities) ? p.capabilities : [];
  }

  private extractConfigSchema(plugin: Plugin): Record<string, unknown> {
    const p = plugin as Plugin & { configSchema?: Record<string, unknown> };
    return p.configSchema ?? {};
  }

  private validateNoCircularDeps(name: string, deps: string[]): void {
    const visited = new Set<string>();
    const stack = [name];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);

      if (current !== name && !this.plugins.has(current) && !deps.includes(current)) {
        continue;
      }

      const meta = this.pluginMeta.get(current);
      if (meta) {
        for (const dep of meta.dependencies) {
          if (dep === name) {
            throw new Error(`Circular dependency detected: ${name} -> ${dep}`);
          }
          stack.push(dep);
        }
      }
    }
  }

  private resolveInitOrder(): string[] {
    const resolved: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`Circular dependency detected during init order resolution: ${name}`);
      }
      visiting.add(name);

      const meta = this.pluginMeta.get(name);
      if (meta) {
        for (const dep of meta.dependencies) {
          if (this.plugins.has(dep)) {
            visit(dep);
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      resolved.push(name);
    };

    for (const name of this.loadOrder) {
      visit(name);
    }

    return resolved;
  }

  private async runLifecycleHook(name: string, hook: string, data: unknown): Promise<void> {
    const meta = this.pluginMeta.get(name);
    if (!meta) return;

    const plugin = meta.plugin as Plugin & {
      beforeInit?: (data: unknown) => Promise<void>;
      afterInit?: (data: unknown) => Promise<void>;
      beforeExecute?: (data: unknown) => Promise<void>;
      afterExecute?: (data: unknown) => Promise<void>;
      onError?: (data: unknown) => Promise<void>;
    };

    const hookFn = plugin[hook as keyof typeof plugin];
    if (typeof hookFn === 'function') {
      await (hookFn as (data: unknown) => Promise<void>)(data);
    }
  }

  private startHealthCheck(name: string, plugin: Plugin): void {
    const meta = this.pluginMeta.get(name);
    if (!meta) return;

    const check = async () => {
      try {
        const p = plugin as Plugin & { isHealthy?: () => Promise<boolean> | boolean };
        if (typeof p.isHealthy === 'function') {
          const result = await p.isHealthy();
          meta.healthStatus = { name, healthy: result, lastCheck: Date.now() };
        } else {
          meta.healthStatus = { name, healthy: true, lastCheck: Date.now() };
        }
      } catch (error) {
        meta.healthStatus = {
          name,
          healthy: false,
          lastCheck: Date.now(),
          error: (error as Error).message,
        };
      }
    };

    meta.healthCheckInterval = setInterval(check, this.healthCheckMs);
  }

  async executePlugin(name: string, input: unknown, context?: PluginContext): Promise<unknown> {
    const plugin = this.plugins.get(name);
    const meta = this.pluginMeta.get(name);
    if (!plugin || !meta) {
      throw new Error(`Plugin ${name} not found`);
    }

    if (meta.healthStatus && !meta.healthStatus.healthy) {
      throw new Error(`Plugin ${name} is unhealthy: ${meta.healthStatus.error}`);
    }

    if (context) {
      await this.runLifecycleHook(name, 'beforeExecute', { input, context });
    }

    const start = performance.now();
    try {
      const result = await plugin.execute(input);
      const duration = performance.now() - start;

      meta.metrics.executionCount++;
      meta.metrics.totalDurationMs += duration;
      meta.metrics.avgDurationMs = meta.metrics.totalDurationMs / meta.metrics.executionCount;
      meta.metrics.lastExecuted = Date.now();
      if (!meta.metrics.firstExecuted) {
        meta.metrics.firstExecuted = Date.now();
      }

      if (context) {
        await this.runLifecycleHook(name, 'afterExecute', { input, result, context });
      }

      return result;
    } catch (error) {
      meta.metrics.errorCount++;
      if (context) {
        await this.runLifecycleHook(name, 'onError', { error, input, context });
      }
      throw error;
    }
  }
}

export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private hooks: Map<string, Set<(input: unknown) => Promise<unknown>>> = new Map();
  private pluginTags: Map<string, string[]> = new Map();
  private pluginCapabilities: Map<string, string[]> = new Map();
  private metrics: Map<string, PluginMetrics> = new Map();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.name, plugin);
    this.metrics.set(plugin.name, {
      executionCount: 0,
      errorCount: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
    });

    const p = plugin as Plugin & { tags?: string[]; capabilities?: string[] };
    if (Array.isArray(p.tags)) {
      this.pluginTags.set(plugin.name, p.tags);
    }
    if (Array.isArray(p.capabilities)) {
      this.pluginCapabilities.set(plugin.name, p.capabilities);
    }
  }

  unregister(name: string): void {
    this.plugins.delete(name);
    this.pluginTags.delete(name);
    this.pluginCapabilities.delete(name);
    this.metrics.delete(name);
  }

  get(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  list(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  async executeHook(hookName: string, input: unknown): Promise<unknown> {
    const hookHandlers = this.hooks.get(hookName);
    if (!hookHandlers) return input;

    let result = input;
    for (const handler of hookHandlers) {
      try {
        result = await handler(result);
      } catch {
        // Continue with other handlers
      }
    }
    return result;
  }

  onHook(hookName: string, handler: (input: unknown) => Promise<unknown>): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, new Set());
    }
    this.hooks.get(hookName)!.add(handler);
  }

  offHook(hookName: string, handler: (input: unknown) => Promise<unknown>): void {
    const hookHandlers = this.hooks.get(hookName);
    if (hookHandlers) {
      hookHandlers.delete(handler);
      if (hookHandlers.size === 0) {
        this.hooks.delete(hookName);
      }
    }
  }

  getByType(type: Plugin['type']): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.type === type);
  }

  getByCapability(capability: string): Plugin[] {
    const result: Plugin[] = [];
    for (const [name, caps] of this.pluginCapabilities) {
      if (caps.includes(capability)) {
        const plugin = this.plugins.get(name);
        if (plugin) result.push(plugin);
      }
    }
    return result;
  }

  getByTag(tag: string): Plugin[] {
    const result: Plugin[] = [];
    for (const [name, tags] of this.pluginTags) {
      if (tags.includes(tag)) {
        const plugin = this.plugins.get(name);
        if (plugin) result.push(plugin);
      }
    }
    return result;
  }

  getMetrics(name: string): PluginMetrics | undefined {
    return this.metrics.get(name);
  }

  recordExecution(name: string, durationMs: number, success: boolean): void {
    const m = this.metrics.get(name);
    if (!m) return;
    m.executionCount++;
    m.totalDurationMs += durationMs;
    m.avgDurationMs = m.totalDurationMs / m.executionCount;
    m.lastExecuted = Date.now();
    if (!m.firstExecuted) m.firstExecuted = Date.now();
    if (!success) m.errorCount++;
  }

  getDependencyGraph(): DependencyNode[] {
    const nodes: DependencyNode[] = [];
    for (const [name, plugin] of this.plugins) {
      const p = plugin as Plugin & { dependencies?: string[] };
      const deps = Array.isArray(p.dependencies) ? p.dependencies : [];
      const dependents: string[] = [];
      for (const [otherName, otherPlugin] of this.plugins) {
        const op = otherPlugin as Plugin & { dependencies?: string[] };
        if (Array.isArray(op.dependencies) && op.dependencies.includes(name)) {
          dependents.push(otherName);
        }
      }
      nodes.push({ name, dependencies: deps, dependents });
    }
    return nodes;
  }

  async executeWithMetrics(name: string, input: unknown): Promise<unknown> {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin ${name} not found`);

    const start = performance.now();
    try {
      const result = await plugin.execute(input);
      this.recordExecution(name, performance.now() - start, true);
      return result;
    } catch (error) {
      this.recordExecution(name, performance.now() - start, false);
      throw error;
    }
  }
}
