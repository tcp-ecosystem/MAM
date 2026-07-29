/**
 * MAM Plugin Lifecycle Manager
 *
 * Manages plugin state transitions: load → ready → unload.
 */

import type { MAMPlugin } from './types.js';

export type PluginState = 'registered' | 'loading' | 'ready' | 'unloading' | 'unloaded' | 'error';

export interface PluginLifecycleEntry {
  plugin: MAMPlugin;
  state: PluginState;
  loadedAt?: Date;
  unloadedAt?: Date;
  error?: Error;
  loadCount: number;
}

export class PluginLifecycleManager {
  private entries: Map<string, PluginLifecycleEntry> = new Map();

  register(plugin: MAMPlugin): void {
    const name = plugin.manifest.name;
    this.entries.set(name, {
      plugin,
      state: 'registered',
      loadCount: 0,
    });
  }

  async load(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: ${name}`);
    if (entry.state === 'ready') return;

    entry.state = 'loading';
    try {
      if (entry.plugin.onLoad) {
        await entry.plugin.onLoad();
      }
      entry.state = 'ready';
      entry.loadedAt = new Date();
      entry.loadCount++;
    } catch (error) {
      entry.state = 'error';
      entry.error = error as Error;
      throw error;
    }
  }

  async unload(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: ${name}`);
    if (entry.state !== 'ready') return;

    entry.state = 'unloading';
    try {
      if (entry.plugin.onUnload) {
        await entry.plugin.onUnload();
      }
      entry.state = 'unloaded';
      entry.unloadedAt = new Date();
    } catch (error) {
      entry.state = 'error';
      entry.error = error as Error;
      throw error;
    }
  }

  getState(name: string): PluginState | undefined {
    return this.entries.get(name)?.state;
  }

  getEntry(name: string): PluginLifecycleEntry | undefined {
    return this.entries.get(name);
  }

  getAllEntries(): PluginLifecycleEntry[] {
    return Array.from(this.entries.values());
  }

  getReadyPlugins(): MAMPlugin[] {
    return this.getAllEntries()
      .filter((e) => e.state === 'ready')
      .map((e) => e.plugin);
  }

  getErrorPlugins(): PluginLifecycleEntry[] {
    return this.getAllEntries().filter((e) => e.state === 'error');
  }

  isReady(name: string): boolean {
    return this.entries.get(name)?.state === 'ready';
  }

  remove(name: string): boolean {
    return this.entries.delete(name);
  }

  clear(): void {
    this.entries.clear();
  }
}
