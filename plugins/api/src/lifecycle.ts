/**
 * MAM Plugin Lifecycle Manager
 *
 * State machine for plugin transitions: registered → loading → ready → unloading → unloaded.
 * Tracks timing, errors, retry counts, and enforces valid transitions.
 */

import type { MAMPlugin } from './types.js';

export type PluginState =
  | 'registered'
  | 'loading'
  | 'ready'
  | 'enabling'
  | 'enabled'
  | 'disabling'
  | 'disabled'
  | 'unloading'
  | 'unloaded'
  | 'error'
  | 'retrying';

export interface PluginLifecycleEntry {
  plugin: MAMPlugin;
  state: PluginState;
  registeredAt: Date;
  loadedAt?: Date;
  unloadedAt?: Date;
  enabledAt?: Date;
  disabledAt?: Date;
  error?: Error;
  loadCount: number;
  errorCount: number;
  retryCount: number;
  maxRetries: number;
  lastStateChange: Date;
  stateHistory: Array<{ from: PluginState; to: PluginState; timestamp: Date; error?: string }>;
}

export interface LifecycleEvent {
  plugin: string;
  from: PluginState;
  to: PluginState;
  timestamp: Date;
  error?: Error;
}

const VALID_TRANSITIONS: Record<PluginState, PluginState[]> = {
  registered: ['loading', 'unloaded'],
  loading: ['ready', 'error'],
  ready: ['enabling', 'disabling', 'unloading', 'error'],
  enabling: ['enabled', 'error'],
  enabled: ['disabling', 'unloading', 'error'],
  disabling: ['disabled', 'error'],
  disabled: ['enabling', 'unloading', 'error'],
  unloading: ['unloaded', 'error'],
  unloaded: ['registered'],
  error: ['retrying', 'unloaded', 'registered'],
  retrying: ['loading', 'error'],
};

export class PluginLifecycleManager {
  private entries: Map<string, PluginLifecycleEntry> = new Map();
  private listeners: Array<(event: LifecycleEvent) => void> = [];

  // ─── Registration ───────────────────────────────────────────────

  register(plugin: MAMPlugin, options?: { maxRetries?: number }): void {
    const name = plugin.manifest.name;
    if (this.entries.has(name)) {
      throw new Error(`Plugin "${name}" already registered`);
    }
    this.entries.set(name, {
      plugin,
      state: 'registered',
      registeredAt: new Date(),
      loadCount: 0,
      errorCount: 0,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 3,
      lastStateChange: new Date(),
      stateHistory: [],
    });
    this.emit({ plugin: name, from: 'unloaded' as any, to: 'registered', timestamp: new Date() });
  }

  unregister(name: string): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    if (entry.state !== 'unloaded' && entry.state !== 'registered') {
      throw new Error(`Cannot unregister "${name}" in state "${entry.state}"`);
    }
    return this.entries.delete(name);
  }

  // ─── State Transitions ──────────────────────────────────────────

  private transition(name: string, to: PluginState, error?: Error): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);

    const from = entry.state;
    const valid = VALID_TRANSITIONS[from];
    if (!valid?.includes(to)) {
      throw new Error(`Invalid transition for "${name}": ${from} → ${to}`);
    }

    entry.state = to;
    entry.lastStateChange = new Date();
    entry.stateHistory.push({ from, to, timestamp: new Date(), error: error?.message });

    if (error) {
      entry.error = error;
      entry.errorCount++;
    }

    this.emit({ plugin: name, from, to, timestamp: new Date(), error });
  }

  async load(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);
    if (entry.state === 'ready' || entry.state === 'enabled') return;

    this.transition(name, 'loading');
    try {
      if (entry.plugin.onLoad) await entry.plugin.onLoad();
      entry.loadCount++;
      entry.loadedAt = new Date();
      this.transition(name, 'ready');
    } catch (error) {
      this.transition(name, 'error', error as Error);
      throw error;
    }
  }

  async unload(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);
    if (entry.state === 'unloaded') return;

    this.transition(name, 'unloading');
    try {
      if (entry.plugin.onUnload) await entry.plugin.onUnload();
      entry.unloadedAt = new Date();
      this.transition(name, 'unloaded');
    } catch (error) {
      this.transition(name, 'error', error as Error);
      throw error;
    }
  }

  async enable(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);
    if (entry.state === 'enabled') return;

    if (entry.state === 'disabled') {
      this.transition(name, 'enabling');
    } else if (entry.state === 'ready') {
      this.transition(name, 'enabling');
    } else {
      throw new Error(`Cannot enable "${name}" in state "${entry.state}"`);
    }

    try {
      if (entry.plugin.onEnable) await entry.plugin.onEnable();
      entry.enabledAt = new Date();
      this.transition(name, 'enabled');
    } catch (error) {
      this.transition(name, 'error', error as Error);
      throw error;
    }
  }

  async disable(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);
    if (entry.state === 'disabled') return;

    this.transition(name, 'disabling');
    try {
      if (entry.plugin.onDisable) await entry.plugin.onDisable();
      entry.disabledAt = new Date();
      this.transition(name, 'disabled');
    } catch (error) {
      this.transition(name, 'error', error as Error);
      throw error;
    }
  }

  async retry(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not registered: "${name}"`);
    if (entry.state !== 'error') throw new Error(`Cannot retry "${name}" in state "${entry.state}"`);
    if (entry.retryCount >= entry.maxRetries) {
      throw new Error(`Max retries (${entry.maxRetries}) reached for "${name}"`);
    }

    entry.retryCount++;
    this.transition(name, 'retrying');
    await this.load(name);
  }

  // ─── Query ──────────────────────────────────────────────────────

  getState(name: string): PluginState | undefined {
    return this.entries.get(name)?.state;
  }

  getEntry(name: string): PluginLifecycleEntry | undefined {
    return this.entries.get(name);
  }

  getAllEntries(): PluginLifecycleEntry[] {
    return Array.from(this.entries.values());
  }

  getPluginsInState(state: PluginState): MAMPlugin[] {
    return this.getAllEntries()
      .filter((e) => e.state === state)
      .map((e) => e.plugin);
  }

  getReadyPlugins(): MAMPlugin[] {
    return this.getPluginsInState('ready').concat(this.getPluginsInState('enabled'));
  }

  getErrorPlugins(): PluginLifecycleEntry[] {
    return this.getAllEntries().filter((e) => e.state === 'error');
  }

  isReady(name: string): boolean {
    const s = this.getState(name);
    return s === 'ready' || s === 'enabled';
  }

  canTransition(name: string, to: PluginState): boolean {
    const from = this.getState(name);
    if (!from) return false;
    return VALID_TRANSITIONS[from]?.includes(to) ?? false;
  }

  // ─── Listeners ──────────────────────────────────────────────────

  onEvent(listener: (event: LifecycleEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) this.listeners.splice(idx, 1);
    };
  }

  private emit(event: LifecycleEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  remove(name: string): boolean {
    return this.entries.delete(name);
  }

  clear(): void {
    this.entries.clear();
    this.listeners = [];
  }
}
