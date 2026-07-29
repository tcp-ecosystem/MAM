/**
 * MAM Plugin Context Provider
 *
 * Shared context, execution history, metrics collection,
 * resource management, and cross-plugin communication.
 */

import type { MAMPlugin, ExecutionContext, ExecutionResult } from './types.js';

export interface PluginContextOptions {
  timeout?: number;
  maxMemory?: number;
  maxOutputSize?: number;
  debug?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface ExecutionRecord {
  id: string;
  plugin: string;
  startMs: number;
  endMs: number;
  success: boolean;
  output?: unknown;
  error?: string;
  inputs?: Record<string, unknown>;
}

export interface ContextMetrics {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTimeMs: number;
  totalExecutionTimeMs: number;
  lastExecutionTime?: Date;
  uptimeMs: number;
}

export interface ResourceSnapshot {
  memoryUsage: NodeJS.MemoryUsage;
  activeContexts: number;
  sharedDataKeys: number;
  historySize: number;
}

const DEFAULT_OPTIONS: Required<PluginContextOptions> = {
  timeout: 30000,
  maxMemory: 256 * 1024 * 1024,
  maxOutputSize: 10 * 1024 * 1024,
  debug: false,
  logLevel: 'info',
};

export class PluginContextProvider {
  private options: Required<PluginContextOptions>;
  private sharedData: Map<string, unknown> = new Map();
  private namespacedData: Map<string, Map<string, unknown>> = new Map();
  private executionHistory: ExecutionRecord[] = [];
  private activeContexts: Map<string, ExecutionContext> = new Map();
  private startTime: Date;
  private executionCounter = 0;
  private logs: Array<{ level: string; message: string; timestamp: Date; plugin?: string }> = [];

  constructor(options?: PluginContextOptions) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.startTime = new Date();
  }

  // ─── Execution Context Creation ─────────────────────────────────

  createExecutionContext(
    plugin: MAMPlugin,
    inputs: Record<string, unknown> = {},
    module?: any,
  ): ExecutionContext {
    const ctx: ExecutionContext = {
      module: module || { type: 'MAMModule', frontmatter: {}, sections: [], location: { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } } },
      inputs,
      memory: {},
      timeout: this.options.timeout,
    };
    this.activeContexts.set(plugin.manifest.name, ctx);
    return ctx;
  }

  getActiveContext(pluginName: string): ExecutionContext | undefined {
    return this.activeContexts.get(pluginName);
  }

  removeActiveContext(pluginName: string): boolean {
    return this.activeContexts.delete(pluginName);
  }

  getActiveContextCount(): number {
    return this.activeContexts.size;
  }

  // ─── Shared Data ────────────────────────────────────────────────

  setSharedData(key: string, value: unknown): void {
    this.sharedData.set(key, value);
  }

  getSharedData(key: string): unknown {
    return this.sharedData.get(key);
  }

  hasSharedData(key: string): boolean {
    return this.sharedData.has(key);
  }

  deleteSharedData(key: string): boolean {
    return this.sharedData.delete(key);
  }

  getSharedDataKeys(): string[] {
    return Array.from(this.sharedData.keys());
  }

  getSharedDataSize(): number {
    return this.sharedData.size;
  }

  clearSharedData(): void {
    this.sharedData.clear();
  }

  // ─── Namespaced Data ────────────────────────────────────────────

  setNamespaced(plugin: string, key: string, value: unknown): void {
    if (!this.namespacedData.has(plugin)) {
      this.namespacedData.set(plugin, new Map());
    }
    this.namespacedData.get(plugin)!.set(key, value);
  }

  getNamespaced(plugin: string, key: string): unknown {
    return this.namespacedData.get(plugin)?.get(key);
  }

  hasNamespaced(plugin: string, key: string): boolean {
    return this.namespacedData.get(plugin)?.has(key) ?? false;
  }

  clearNamespaced(plugin: string): void {
    this.namespacedData.delete(plugin);
  }

  // ─── Execution History ──────────────────────────────────────────

  recordExecution(record: Omit<ExecutionRecord, 'id'>): ExecutionRecord {
    const id = `exec-${++this.executionCounter}`;
    const fullRecord: ExecutionRecord = { ...record, id };
    this.executionHistory.push(fullRecord);

    const maxHistory = 1000;
    if (this.executionHistory.length > maxHistory) {
      this.executionHistory = this.executionHistory.slice(-maxHistory);
    }

    return fullRecord;
  }

  getExecutionHistory(plugin?: string): ExecutionRecord[] {
    if (plugin) return this.executionHistory.filter((e) => e.plugin === plugin);
    return [...this.executionHistory];
  }

  getRecentExecutions(count: number, plugin?: string): ExecutionRecord[] {
    const history = plugin
      ? this.executionHistory.filter((e) => e.plugin === plugin)
      : this.executionHistory;
    return history.slice(-count);
  }

  clearHistory(): void {
    this.executionHistory = [];
  }

  // ─── Metrics ────────────────────────────────────────────────────

  getMetrics(plugin?: string): ContextMetrics {
    const history = this.getExecutionHistory(plugin);
    const totalTime = history.reduce((sum, e) => sum + (e.endMs - e.startMs), 0);
    const successCount = history.filter((e) => e.success).length;

    return {
      totalExecutions: history.length,
      successfulExecutions: successCount,
      failedExecutions: history.length - successCount,
      averageExecutionTimeMs: history.length > 0 ? totalTime / history.length : 0,
      totalExecutionTimeMs: totalTime,
      lastExecutionTime: history.length > 0 ? new Date(history[history.length - 1]!.endMs) : undefined,
      uptimeMs: Date.now() - this.startTime.getTime(),
    };
  }

  getAverageExecutionTime(plugin?: string): number {
    return this.getMetrics(plugin).averageExecutionTimeMs;
  }

  getSuccessRate(plugin?: string): number {
    const history = this.getExecutionHistory(plugin);
    if (history.length === 0) return 0;
    return history.filter((e) => e.success).length / history.length;
  }

  // ─── Resources ──────────────────────────────────────────────────

  getResourceSnapshot(): ResourceSnapshot {
    return {
      memoryUsage: process.memoryUsage(),
      activeContexts: this.activeContexts.size,
      sharedDataKeys: this.sharedData.size,
      historySize: this.executionHistory.length,
    };
  }

  // ─── Logging ────────────────────────────────────────────────────

  log(level: string, message: string, plugin?: string): void {
    if (this.shouldLog(level)) {
      this.logs.push({ level, message, timestamp: new Date(), plugin });
      const maxLogs = 500;
      if (this.logs.length > maxLogs) {
        this.logs = this.logs.slice(-maxLogs);
      }
    }
  }

  debug(message: string, plugin?: string): void { this.log('debug', message, plugin); }
  info(message: string, plugin?: string): void { this.log('info', message, plugin); }
  warn(message: string, plugin?: string): void { this.log('warn', message, plugin); }
  error(message: string, plugin?: string): void { this.log('error', message, plugin); }

  getLogs(level?: string, plugin?: string, count?: number): typeof this.logs {
    let filtered = this.logs;
    if (level) filtered = filtered.filter((l) => l.level === level);
    if (plugin) filtered = filtered.filter((l) => l.plugin === plugin);
    if (count) filtered = filtered.slice(-count);
    return filtered;
  }

  clearLogs(): void { this.logs = []; }

  private shouldLog(level: string): boolean {
    const levels = ['debug', 'info', 'warn', 'error'];
    const currentIdx = levels.indexOf(this.options.logLevel);
    const msgIdx = levels.indexOf(level);
    return msgIdx >= currentIdx;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  destroy(): void {
    this.sharedData.clear();
    this.namespacedData.clear();
    this.activeContexts.clear();
    this.executionHistory = [];
    this.logs = [];
  }
}
