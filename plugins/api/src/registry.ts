/**
 * MAM Plugin Registry
 * 
 * Plugin discovery, loading, and management.
 */

import { MAMPlugin, PluginManifest, PluginRegistryEntry } from './types.js';
import { HookManager } from './hooks.js';
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class PluginRegistry {
  private plugins: Map<string, PluginRegistryEntry> = new Map();
  private hookManager: HookManager;
  private searchPaths: string[];

  constructor(hookManager: HookManager) {
    this.hookManager = hookManager;
    this.searchPaths = [
      join(process.cwd(), '.mam', 'plugins'),
      join(process.cwd(), 'node_modules'),
      join(process.env.HOME || process.env.USERPROFILE || '', '.mam', 'plugins'),
    ];
  }

  async loadPlugin(pluginPath: string): Promise<PluginRegistryEntry> {
    const manifestPath = join(pluginPath, 'plugin.json');
    try {
      await access(manifestPath);
      const manifestContent = await readFile(manifestPath, 'utf-8');
      const manifest: PluginManifest = JSON.parse(manifestContent);
      const pluginModule = await import(resolve(pluginPath, manifest.main));
      const plugin: MAMPlugin = pluginModule.default || pluginModule;
      const entry: PluginRegistryEntry = { manifest, plugin, path: pluginPath, enabled: true, loadedAt: new Date() };
      this.hookManager.registerPlugin(plugin);
      if (plugin.onLoad) await plugin.onLoad();
      this.plugins.set(manifest.name, entry);
      return entry;
    } catch (error) {
      throw new Error(`Failed to load plugin from ${pluginPath}: ${(error as Error).message}`);
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const entry = this.plugins.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);
    this.hookManager.unregisterPlugin(entry.plugin);
    if (entry.plugin.onUnload) await entry.plugin.onUnload();
    this.plugins.delete(name);
  }

  getPlugin(name: string): PluginRegistryEntry | undefined { return this.plugins.get(name); }
  getAllPlugins(): PluginRegistryEntry[] { return Array.from(this.plugins.values()); }
  getEnabledPlugins(): PluginRegistryEntry[] { return this.getAllPlugins().filter(p => p.enabled); }
  enablePlugin(name: string): void { const e = this.plugins.get(name); if (e) e.enabled = true; }
  disablePlugin(name: string): void { const e = this.plugins.get(name); if (e) e.enabled = false; }

  async discoverPlugins(): Promise<string[]> {
    const discovered: string[] = [];
    for (const sp of this.searchPaths) {
      try {
        await access(sp);
        const entries = await readdir(sp);
        for (const entry of entries) {
          const pluginDir = join(sp, entry);
          try { await access(join(pluginDir, 'plugin.json')); discovered.push(pluginDir); } catch { /* skip */ }
        }
      } catch { /* path doesn't exist */ }
    }
    return discovered;
  }

  async loadAllPlugins(): Promise<void> {
    const discovered = await this.discoverPlugins();
    for (const p of discovered) {
      try { await this.loadPlugin(p); } catch (err) { console.error('Failed to load plugin:', err); }
    }
  }

  isLoaded(name: string): boolean { return this.plugins.has(name); }
  getPluginCount(): number { return this.plugins.size; }
}