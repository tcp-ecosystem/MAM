/**
 * MAM Plugin Registry
 *
 * Central plugin management: discovery, loading, dependency resolution,
 * enable/disable, and lifecycle orchestration.
 */

import { MAMPlugin, PluginManifest, PluginRegistryEntry, PluginRegistryConfig } from './types.js';
import { HookManager } from './hooks.js';
import { readdir, readFile, access, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

export interface RegistryLoadResult {
  success: boolean;
  entry?: PluginRegistryEntry;
  error?: string;
  durationMs: number;
}

export interface RegistryStats {
  totalPlugins: number;
  enabledPlugins: number;
  disabledPlugins: number;
  errorPlugins: number;
  loadTime: number;
  plugins: Array<{
    name: string;
    version: string;
    enabled: boolean;
    loadCount: number;
    errorCount: number;
  }>;
}

const DEFAULT_CONFIG: PluginRegistryConfig = {
  searchPaths: [],
  autoDiscover: true,
  autoLoad: false,
  enableDependencyResolution: true,
  maxPlugins: 100,
  timeout: 30000,
};

export class PluginRegistry {
  private plugins: Map<string, PluginRegistryEntry> = new Map();
  private hookManager: HookManager;
  private config: PluginRegistryConfig;
  private loadStartTime = 0;
  private loadErrors: Array<{ path: string; error: string }> = [];

  constructor(hookManager: HookManager, config?: Partial<PluginRegistryConfig>) {
    this.hookManager = hookManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.searchPaths.length === 0) {
      this.config.searchPaths = [
        join(process.cwd(), '.mam', 'plugins'),
        join(process.cwd(), 'node_modules'),
        join(process.env.HOME || process.env.USERPROFILE || '', '.mam', 'plugins'),
      ];
    }
  }

  // ─── Loading ────────────────────────────────────────────────────

  async loadPlugin(pluginPath: string): Promise<RegistryLoadResult> {
    const startTime = performance.now();
    try {
      if (this.plugins.size >= this.config.maxPlugins) {
        return { success: false, error: `Max plugin limit reached (${this.config.maxPlugins})`, durationMs: performance.now() - startTime };
      }

      const manifestPath = join(pluginPath, 'plugin.json');
      await access(manifestPath);
      const manifestContent = await readFile(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestContent);

      if (this.plugins.has(manifest.name)) {
        return { success: false, error: `Plugin "${manifest.name}" already loaded`, durationMs: performance.now() - startTime };
      }

      if (this.config.enableDependencyResolution && manifest.dependencies) {
        for (const dep of manifest.dependencies) {
          if (!this.plugins.has(dep)) {
            return { success: false, error: `Missing dependency: "${dep}"`, durationMs: performance.now() - startTime };
          }
        }
      }

      const pluginModule = await import(resolve(pluginPath, manifest.main));
      const plugin: MAMPlugin = pluginModule.default || pluginModule;
      if (!plugin.manifest) plugin.manifest = manifest;

      const entry: PluginRegistryEntry = {
        manifest,
        plugin,
        path: pluginPath,
        enabled: true,
        loadedAt: new Date(),
        loadCount: 0,
        errorCount: 0,
        dependencies: manifest.dependencies || [],
        dependents: [],
      };

      this.hookManager.registerPlugin(plugin);
      if (plugin.onLoad) await plugin.onLoad();

      // Update dependents
      for (const dep of manifest.dependencies || []) {
        const depEntry = this.plugins.get(dep);
        if (depEntry) {
          depEntry.dependents.push(manifest.name);
        }
      }

      this.plugins.set(manifest.name, entry);
      return { success: true, entry, durationMs: performance.now() - startTime };
    } catch (error) {
      const err = error as Error;
      this.loadErrors.push({ path: pluginPath, error: err.message });
      return { success: false, error: err.message, durationMs: performance.now() - startTime };
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);

    // Check dependents
    if (entry.dependents.length > 0) {
      throw new Error(`Cannot unload "${name}": depended on by ${entry.dependents.join(', ')}`);
    }

    this.hookManager.unregisterPlugin(entry.plugin);
    if (entry.plugin.onUnload) await entry.plugin.onUnload();

    // Remove from dependencies' dependents lists
    for (const dep of entry.dependencies) {
      const depEntry = this.plugins.get(dep);
      if (depEntry) {
        depEntry.dependents = depEntry.dependents.filter((d) => d !== name);
      }
    }

    this.plugins.delete(name);
  }

  async reloadPlugin(name: string): Promise<RegistryLoadResult> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);
    const path = entry.path;
    await this.unloadPlugin(name);
    return this.loadPlugin(path);
  }

  // ─── Discovery ──────────────────────────────────────────────────

  async discoverPlugins(): Promise<string[]> {
    const discovered: string[] = [];
    for (const sp of this.config.searchPaths) {
      try {
        await access(sp);
        const entries = await readdir(sp);
        for (const entry of entries) {
          const pluginDir = join(sp, entry);
          try {
            const s = await stat(pluginDir);
            if (!s.isDirectory()) continue;
            await access(join(pluginDir, 'plugin.json'));
            discovered.push(pluginDir);
          } catch { /* skip */ }
        }
      } catch { /* path doesn't exist */ }
    }
    return discovered;
  }

  async loadAllPlugins(): Promise<{ loaded: number; errors: number }> {
    this.loadStartTime = performance.now();
    this.loadErrors = [];
    const discovered = await this.discoverPlugins();
    let loaded = 0;
    let errors = 0;

    for (const p of discovered) {
      const result = await this.loadPlugin(p);
      if (result.success) loaded++;
      else errors++;
    }

    return { loaded, errors };
  }

  // ─── Query ──────────────────────────────────────────────────────

  getPlugin(name: string): PluginRegistryEntry | undefined {
    return this.plugins.get(name);
  }

  getAllPlugins(): PluginRegistryEntry[] {
    return Array.from(this.plugins.values());
  }

  getEnabledPlugins(): PluginRegistryEntry[] {
    return this.getAllPlugins().filter((p) => p.enabled);
  }

  getDisabledPlugins(): PluginRegistryEntry[] {
    return this.getAllPlugins().filter((p) => !p.enabled);
  }

  getPluginsWithErrors(): PluginRegistryEntry[] {
    return this.getAllPlugins().filter((p) => p.errorCount > 0);
  }

  getPluginsByCategory(category: string): PluginRegistryEntry[] {
    return this.getAllPlugins().filter((p) =>
      p.manifest.categories?.includes(category as any),
    );
  }

  getPluginsByKeyword(keyword: string): PluginRegistryEntry[] {
    return this.getAllPlugins().filter((p) =>
      p.manifest.keywords.includes(keyword),
    );
  }

  getDependencies(name: string): PluginRegistryEntry[] {
    const entry = this.plugins.get(name);
    if (!entry) return [];
    return entry.dependencies.map((d) => this.plugins.get(d)).filter(Boolean) as PluginRegistryEntry[];
  }

  getDependents(name: string): PluginRegistryEntry[] {
    const entry = this.plugins.get(name);
    if (!entry) return [];
    return entry.dependents.map((d) => this.plugins.get(d)).filter(Boolean) as PluginRegistryEntry[];
  }

  getLoadOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const visit = (name: string) => {
      if (visited.has(name)) return;
      visited.add(name);
      const entry = this.plugins.get(name);
      if (entry) {
        for (const dep of entry.dependencies) visit(dep);
        order.push(name);
      }
    };
    for (const name of this.plugins.keys()) visit(name);
    return order;
  }

  // ─── Management ─────────────────────────────────────────────────

  enablePlugin(name: string): boolean {
    const entry = this.plugins.get(name);
    if (!entry) return false;
    entry.enabled = true;
    if (entry.plugin.onEnable) entry.plugin.onEnable();
    return true;
  }

  disablePlugin(name: string): boolean {
    const entry = this.plugins.get(name);
    if (!entry) return false;
    entry.enabled = false;
    if (entry.plugin.onDisable) entry.plugin.onDisable();
    return true;
  }

  recordError(name: string, error: Error): void {
    const entry = this.plugins.get(name);
    if (entry) {
      entry.errorCount++;
      entry.lastError = error;
    }
  }

  isLoaded(name: string): boolean {
    return this.plugins.has(name);
  }

  getPluginCount(): number {
    return this.plugins.size;
  }

  getLoadErrors(): Array<{ path: string; error: string }> {
    return [...this.loadErrors];
  }

  // ─── Statistics ─────────────────────────────────────────────────

  getStats(): RegistryStats {
    const all = this.getAllPlugins();
    return {
      totalPlugins: all.length,
      enabledPlugins: all.filter((p) => p.enabled).length,
      disabledPlugins: all.filter((p) => !p.enabled).length,
      errorPlugins: all.filter((p) => p.errorCount > 0).length,
      loadTime: performance.now() - this.loadStartTime,
      plugins: all.map((p) => ({
        name: p.manifest.name,
        version: p.manifest.version,
        enabled: p.enabled,
        loadCount: p.loadCount,
        errorCount: p.errorCount,
      })),
    };
  }

  clear(): void {
    for (const entry of this.plugins.values()) {
      this.hookManager.unregisterPlugin(entry.plugin);
    }
    this.plugins.clear();
    this.loadErrors = [];
  }
}
