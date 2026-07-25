/**
 * MAM Plugin Hook System
 * 
 * Implements the hook system for plugin lifecycle management.
 */

import { MAMPlugin, HookName, HookRegistration } from './types.js';

export class HookManager {
  private registrations: Map<HookName, HookRegistration[]> = new Map();

  registerPlugin(plugin: MAMPlugin): void {
    if (!plugin.hooks) return;
    const hooks = plugin.hooks as Record<string, unknown>;
    for (const [hookName, handler] of Object.entries(hooks)) {
      if (typeof handler === 'function') {
        this.register(hookName as HookName, plugin, handler as HookRegistration['handler']);
      }
    }
  }

  unregisterPlugin(plugin: MAMPlugin): void {
    for (const regs of this.registrations.values()) {
      const idx = regs.findIndex(r => r.plugin === plugin);
      if (idx !== -1) regs.splice(idx, 1);
    }
  }

  register(hook: HookName, plugin: MAMPlugin, handler: HookRegistration['handler'], priority: number = 100): void {
    if (!this.registrations.has(hook)) this.registrations.set(hook, []);
    const regs = this.registrations.get(hook)!;
    regs.push({ plugin, hook, handler, priority });
    regs.sort((a, b) => a.priority - b.priority);
  }

  async execute<T>(hook: HookName, data: T): Promise<T> {
    const regs = this.registrations.get(hook) || [];
    let result = data;
    for (const reg of regs) {
      try {
        const out = await reg.handler(result);
        if (out !== undefined && out !== null) result = out as T;
      } catch (err) {
        console.error(`Hook "${hook}" error in "${reg.plugin.manifest.name}":`, err);
      }
    }
    return result;
  }

  async executeError(error: Error, phase: string): Promise<boolean> {
    const regs = this.registrations.get('onError') || [];
    for (const reg of regs) {
      try {
        const hookData = { error, phase, handled: false };
        const result = await reg.handler(hookData);
        if (result && (result as { handled: boolean }).handled) return true;
      } catch { /* continue */ }
    }
    return false;
  }

  clear(): void { this.registrations.clear(); }
  getRegistrations(hook: HookName): HookRegistration[] { return this.registrations.get(hook) || []; }
}