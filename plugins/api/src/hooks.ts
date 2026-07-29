/**
 * MAM Plugin Hook System
 *
 * Priority-ordered hook chain execution with error recovery,
 * timeout support, and plugin-scoped hook management.
 */

import { MAMPlugin, HookName, HookRegistration, ALL_HOOK_NAMES } from './types.js';
import { randomBytes } from 'node:crypto';

export interface HookExecutionResult<T = unknown> {
  data: T;
  executed: number;
  errors: Array<{ plugin: string; error: Error }>;
  durationMs: number;
}

export interface HookManagerStats {
  totalRegistrations: number;
  hooksByType: Record<HookName, number>;
  pluginsByHook: Record<HookName, string[]>;
  lastExecutionTime?: number;
  totalExecutions: number;
}

export class HookManager {
  private registrations: Map<HookName, HookRegistration[]> = new Map();
  private executionCount = 0;
  private lastExecutionMs = 0;
  private errorHandlers: Array<(error: Error, hook: HookName, plugin: string) => void> = [];

  constructor() {
    for (const hookName of ALL_HOOK_NAMES) {
      this.registrations.set(hookName, []);
    }
  }

  // ─── Registration ───────────────────────────────────────────────

  registerPlugin(plugin: MAMPlugin): void {
    if (!plugin.hooks) return;
    const hooks = plugin.hooks as Record<string, unknown>;
    for (const [hookName, handler] of Object.entries(hooks)) {
      if (typeof handler === 'function' && ALL_HOOK_NAMES.includes(hookName as HookName)) {
        this.register(hookName as HookName, plugin, handler as HookRegistration['handler']);
      }
    }
  }

  unregisterPlugin(plugin: MAMPlugin): HookRegistration[] {
    const removed: HookRegistration[] = [];
    for (const regs of this.registrations.values()) {
      const idx = regs.findIndex((r) => r.plugin === plugin);
      if (idx !== -1) {
        removed.push(regs.splice(idx, 1)[0]!);
      }
    }
    return removed;
  }

  register(
    hook: HookName,
    plugin: MAMPlugin,
    handler: HookRegistration['handler'],
    priority: number = 100,
  ): string {
    const id = randomBytes(8).toString('hex');
    if (!this.registrations.has(hook)) {
      this.registrations.set(hook, []);
    }
    const regs = this.registrations.get(hook)!;
    const registration: HookRegistration = {
      plugin,
      hook,
      handler,
      priority,
      id,
      enabled: true,
      createdAt: new Date(),
    };
    regs.push(registration);
    regs.sort((a, b) => a.priority - b.priority);
    return id;
  }

  unregister(id: string): boolean {
    for (const regs of this.registrations.values()) {
      const idx = regs.findIndex((r) => r.id === id);
      if (idx !== -1) {
        regs.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  enable(id: string): boolean {
    for (const regs of this.registrations.values()) {
      const reg = regs.find((r) => r.id === id);
      if (reg) {
        reg.enabled = true;
        return true;
      }
    }
    return false;
  }

  disable(id: string): boolean {
    for (const regs of this.registrations.values()) {
      const reg = regs.find((r) => r.id === id);
      if (reg) {
        reg.enabled = false;
        return true;
      }
    }
    return false;
  }

  // ─── Execution ──────────────────────────────────────────────────

  async execute<T>(hook: HookName, data: T): Promise<HookExecutionResult<T>> {
    const startTime = performance.now();
    const regs = (this.registrations.get(hook) || []).filter((r) => r.enabled);
    let result = data;
    const errors: Array<{ plugin: string; error: Error }> = [];

    for (const reg of regs) {
      try {
        const out = await reg.handler(result);
        if (out !== undefined && out !== null) {
          result = out as T;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        errors.push({ plugin: reg.plugin.manifest.name, error });
        for (const handler of this.errorHandlers) {
          try { handler(error, hook, reg.plugin.manifest.name); } catch { /* ignore */ }
        }
      }
    }

    this.executionCount++;
    this.lastExecutionMs = performance.now() - startTime;

    return {
      data: result,
      executed: regs.length,
      errors,
      durationMs: this.lastExecutionMs,
    };
  }

  async executeSequential<T>(hook: HookName, data: T): Promise<HookExecutionResult<T>> {
    return this.execute(hook, data);
  }

  async executeParallel<T>(hook: HookName, items: T[]): Promise<T[]> {
    const regs = (this.registrations.get(hook) || []).filter((r) => r.enabled);
    if (regs.length === 0) return items;

    const results = await Promise.allSettled(
      items.map(async (item) => {
        let result = item;
        for (const reg of regs) {
          try {
            const out = await reg.handler(result);
            if (out !== undefined && out !== null) result = out as T;
          } catch {
            // continue with current result
          }
        }
        return result;
      }),
    );

    return results.map((r, i) => (r.status === 'fulfilled' ? r.value : items[i]!));
  }

  async executeError(error: Error, phase: string, pluginName?: string): Promise<boolean> {
    const regs = this.registrations.get('onError') || [];
    for (const reg of regs) {
      try {
        const hookData = { error, phase, plugin: pluginName, handled: false };
        const result = await reg.handler(hookData);
        if (result && (result as { handled: boolean }).handled) return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  // ─── Query ──────────────────────────────────────────────────────

  getRegistrations(hook: HookName): HookRegistration[] {
    return (this.registrations.get(hook) || []).filter((r) => r.enabled);
  }

  getAllRegistrations(): HookRegistration[] {
    const all: HookRegistration[] = [];
    for (const regs of this.registrations.values()) {
      all.push(...regs);
    }
    return all;
  }

  getRegistrationsByPlugin(plugin: MAMPlugin): HookRegistration[] {
    return this.getAllRegistrations().filter((r) => r.plugin === plugin);
  }

  getPluginHooks(plugin: MAMPlugin): HookName[] {
    const hooks: HookName[] = [];
    for (const [hookName, regs] of this.registrations) {
      if (regs.some((r) => r.plugin === plugin)) {
        hooks.push(hookName);
      }
    }
    return hooks;
  }

  getPluginsByHook(hook: HookName): string[] {
    return this.getRegistrations(hook).map((r) => r.plugin.manifest.name);
  }

  hasHooks(hook: HookName): boolean {
    return this.getRegistrations(hook).length > 0;
  }

  hasPlugin(plugin: MAMPlugin): boolean {
    return this.getAllRegistrations().some((r) => r.plugin === plugin);
  }

  // ─── Statistics ─────────────────────────────────────────────────

  getStats(): HookManagerStats {
    const hooksByType = {} as Record<HookName, number>;
    const pluginsByHook = {} as Record<HookName, string[]>;

    for (const hookName of ALL_HOOK_NAMES) {
      const regs = this.registrations.get(hookName) || [];
      hooksByType[hookName] = regs.filter((r) => r.enabled).length;
      pluginsByHook[hookName] = [...new Set(regs.map((r) => r.plugin.manifest.name))];
    }

    return {
      totalRegistrations: this.getAllRegistrations().filter((r) => r.enabled).length,
      hooksByType,
      pluginsByHook,
      lastExecutionTime: this.lastExecutionMs,
      totalExecutions: this.executionCount,
    };
  }

  // ─── Error Handling ─────────────────────────────────────────────

  onError(handler: (error: Error, hook: HookName, plugin: string) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const idx = this.errorHandlers.indexOf(handler);
      if (idx !== -1) this.errorHandlers.splice(idx, 1);
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  clear(): void {
    for (const hookName of ALL_HOOK_NAMES) {
      this.registrations.set(hookName, []);
    }
    this.executionCount = 0;
    this.lastExecutionMs = 0;
  }

  clearHook(hook: HookName): void {
    this.registrations.set(hook, []);
  }

  clearPlugin(plugin: MAMPlugin): void {
    this.unregisterPlugin(plugin);
  }

  clone(): HookManager {
    const clone = new HookManager();
    for (const [hookName, regs] of this.registrations) {
      clone.registrations.set(hookName, [...regs]);
    }
    clone.errorHandlers = [...this.errorHandlers];
    return clone;
  }
}
