/**
 * MAM Plugin Context Provider
 *
 * Provides shared context and utilities to plugins.
 */

import type { MAMPlugin, ExecutionContext, ExecutionResult } from './types.js';

export interface PluginContextOptions {
  timeout?: number;
  maxMemory?: number;
  debug?: boolean;
}

export class PluginContextProvider {
  private options: PluginContextOptions;
  private sharedData: Map<string, unknown> = new Map();
  private executionHistory: Array<{
    plugin: string;
    startMs: number;
    endMs: number;
    success: boolean;
  }> = [];

  constructor(options: PluginContextOptions = {}) {
    this.options = {
      timeout: options.timeout || 30000,
      maxMemory: options.maxMemory || 256 * 1024 * 1024,
      debug: options.debug || false,
    };
  }

  createExecutionContext(plugin: MAMPlugin, inputs: Record<string, unknown> = {}): ExecutionContext {
    return {
      module: { type: 'MAMModule', frontmatter: {}, sections: [], location: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } } as any,
      inputs,
      memory: {},
      timeout: this.options.timeout!,
    };
  }

  setSharedData(key: string, value: unknown): void {
    this.sharedData.set(key, value);
  }

  getSharedData(key: string): unknown {
    return this.sharedData.get(key);
  }

  hasSharedData(key: string): boolean {
    return this.sharedData.has(key);
  }

  clearSharedData(): void {
    this.sharedData.clear();
  }

  recordExecution(plugin: string, startMs: number, endMs: number, success: boolean): void {
    this.executionHistory.push({ plugin, startMs, endMs, success });
  }

  getExecutionHistory(plugin?: string): typeof this.executionHistory {
    if (plugin) return this.executionHistory.filter((e) => e.plugin === plugin);
    return [...this.executionHistory];
  }

  getAverageExecutionTime(plugin?: string): number {
    const history = this.getExecutionHistory(plugin);
    if (history.length === 0) return 0;
    const total = history.reduce((sum, e) => sum + (e.endMs - e.startMs), 0);
    return total / history.length;
  }

  getSuccessRate(plugin?: string): number {
    const history = this.getExecutionHistory(plugin);
    if (history.length === 0) return 0;
    return history.filter((e) => e.success).length / history.length;
  }

  clearHistory(): void {
    this.executionHistory = [];
  }
}
