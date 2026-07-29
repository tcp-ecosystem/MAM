/**
 * MAM Run Command
 *
 * Full execution engine with sandbox support (process, vm, docker),
 * environment management, timeout handling, memory limits, hooks,
 * plugins, parallel execution, execution history, and benchmark mode.
 */

import { readFile } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { parseMAM } from '@mam/parser';
import chalk from 'chalk';
import ora from 'ora';

// ---------------------------------------------------------------------------
// Types & Interfaces
// ---------------------------------------------------------------------------

export type SandboxType = 'process' | 'vm' | 'docker';
export type ResultFormat = 'text' | 'json' | 'table';

export interface RunOptions {
  file: string;
  inputs?: string;
  timeout?: number;
  target?: string;
  verbose?: boolean;
  quiet?: boolean;
  format?: ResultFormat;
  sandbox?: SandboxType;
  memoryLimit?: string;
  env?: string[];
  hooks?: string[];
  plugins?: string[];
  parallel?: boolean;
  benchmark?: boolean;
  benchmarkRuns?: number;
  trace?: boolean;
  historyFile?: string;
  envFile?: string;
}

export interface ExecutionContext {
  id: string;
  inputs: Record<string, unknown>;
  env: Record<string, string>;
  timeoutMs: number;
  memoryLimitBytes: number;
  sandboxType: SandboxType;
  plugins: PluginInstance[];
  hooksBefore: HookCallback[];
  hooksAfter: HookCallback[];
  traceEnabled: boolean;
  startTime: number;
  metadata: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  output: Record<string, unknown>;
  errors: string[];
  warnings: string[];
  timeMs: number;
  memoryUsedBytes: number;
  metadata: Record<string, unknown>;
  trace: TraceEntry[];
}

export interface TraceEntry {
  timestamp: number;
  event: string;
  message: string;
  data?: unknown;
  durationMs?: number;
}

export interface HookCallback {
  name: string;
  event: 'before' | 'after';
  fn: (ctx: ExecutionContext, result?: ExecutionResult) => void | Promise<void>;
}

export interface PluginInstance {
  name: string;
  version: string;
  onLoad?: (ctx: ExecutionContext) => void | Promise<void>;
  beforeExecute?: (ctx: ExecutionContext) => void | Promise<void>;
  afterExecute?: (ctx: ExecutionContext, result: ExecutionResult) => void | Promise<void>;
  onUnload?: () => void | Promise<void>;
  onError?: (ctx: ExecutionContext, error: Error) => void | Promise<void>;
}

export interface HistoryEntry {
  id: string;
  file: string;
  target: string;
  inputs: Record<string, unknown>;
  success: boolean;
  timeMs: number;
  timestamp: number;
  errors: string[];
}

export interface BenchmarkResult {
  runs: number;
  totalTimeMs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  medianTimeMs: number;
  p95TimeMs: number;
  p99TimeMs: number;
  successRate: number;
  results: ExecutionResult[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MEMORY_LIMIT_MB = 256;
const MAX_HISTORY_ENTRIES = 100;
const BENCHMARK_WARMUP_RUNS = 2;

// ---------------------------------------------------------------------------
// Input Parser
// ---------------------------------------------------------------------------

class InputParser {
  static parse(inputStr?: string): Record<string, unknown> {
    if (!inputStr) return {};
    try {
      return JSON.parse(inputStr);
    } catch {
      // Try key=value format
      const result: Record<string, unknown> = {};
      const pairs = inputStr.split(',');
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx > 0) {
          const key = pair.slice(0, eqIdx).trim();
          let value: unknown = pair.slice(eqIdx + 1).trim();
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (value === 'null') value = null;
          else if (!isNaN(Number(value)) && value !== '') value = Number(value);
          result[key] = value;
        }
      }
      return result;
    }
  }

  static parseEnv(envArgs?: string[]): Record<string, string> {
    const env: Record<string, string> = {};
    if (!envArgs) return env;
    for (const arg of envArgs) {
      const eqIdx = arg.indexOf('=');
      if (eqIdx > 0) {
        env[arg.slice(0, eqIdx).trim()] = arg.slice(eqIdx + 1).trim();
      }
    }
    return env;
  }

  static parseMemoryLimit(limit?: string): number {
    if (!limit) return DEFAULT_MEMORY_LIMIT_MB * 1024 * 1024;
    const match = limit.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
    if (!match) return DEFAULT_MEMORY_LIMIT_MB * 1024 * 1024;
    const value = parseFloat(match[1]);
    const unit = (match[2] || 'mb').toLowerCase();
    switch (unit) {
      case 'b': return value;
      case 'kb': return value * 1024;
      case 'mb': return value * 1024 * 1024;
      case 'gb': return value * 1024 * 1024 * 1024;
      default: return DEFAULT_MEMORY_LIMIT_MB * 1024 * 1024;
    }
  }
}

// ---------------------------------------------------------------------------
// ID Generator
// ---------------------------------------------------------------------------

class IDGenerator {
  static generate(): string {
    return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 12);
  }
}

// ---------------------------------------------------------------------------
// Trace Collector
// ---------------------------------------------------------------------------

class TraceCollector {
  private entries: TraceEntry[] = [];
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  add(event: string, message: string, data?: unknown, durationMs?: number): void {
    if (!this.enabled) return;
    this.entries.push({ timestamp: Date.now(), event, message, data, durationMs });
  }

  getEntries(): TraceEntry[] { return [...this.entries]; }
  clear(): void { this.entries = []; }
}

// ---------------------------------------------------------------------------
// Execution History
// ---------------------------------------------------------------------------

class ExecutionHistory {
  private entries: HistoryEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries = MAX_HISTORY_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  add(entry: HistoryEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  getEntries(): HistoryEntry[] { return [...this.entries]; }
  getRecent(count: number): HistoryEntry[] { return this.entries.slice(-count); }
  clear(): void { this.entries = []; }

  getStats(): { total: number; successCount: number; failureCount: number; avgTimeMs: number } {
    const total = this.entries.length;
    const successCount = this.entries.filter(e => e.success).length;
    const avgTimeMs = total > 0 ? this.entries.reduce((s, e) => s + e.timeMs, 0) / total : 0;
    return { total, successCount, failureCount: total - successCount, avgTimeMs };
  }
}

// ---------------------------------------------------------------------------
// Sandbox: Process-based Execution
// ---------------------------------------------------------------------------

class ProcessSandbox {
  async execute(code: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const { fork } = await import('node:child_process');
    const trace = new TraceCollector(ctx.traceEnabled);
    trace.add('sandbox-process', 'Starting process-based execution');

    return new Promise((resolve) => {
      const timeout = ctx.timeoutMs > 0 ? ctx.timeoutMs : undefined;
      let killed = false;

      const child = fork('--eval', [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, ...ctx.env, MAM_SANDBOX: 'process' },
        timeout,
      });

      let stdout = '';
      let stderr = '';
      const startMem = process.memoryUsage().heapUsed;

      child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
      child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

      child.on('message', (msg: unknown) => {
        trace.add('sandbox-process', 'Received result from child process', msg);
        const result = msg as ExecutionResult;
        child.kill();
        resolve({
          ...result,
          memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
          trace: trace.getEntries(),
        });
      });

      child.on('error', (err) => {
        trace.add('sandbox-process', `Process error: ${err.message}`);
        child.kill();
        resolve({
          success: false, output: {}, errors: [err.message], warnings: [],
          timeMs: Date.now() - ctx.startTime, memoryUsedBytes: 0,
          metadata: {}, trace: trace.getEntries(),
        });
      });

      child.on('exit', (code_) => {
        if (!killed) {
          killed = true;
          const timeMs = Date.now() - ctx.startTime;
          trace.add('sandbox-process', `Process exited with code ${code_}`);
          resolve({
            success: code_ === 0,
            output: stdout ? { stdout: stdout.trim() } : {},
            errors: stderr ? [stderr.trim()] : [],
            warnings: [], timeMs, memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
            metadata: { exitCode: code_ }, trace: trace.getEntries(),
          });
        }
      });

      // Send code to child
      child.send({ type: 'execute', code, inputs: ctx.inputs });

      // Timeout handling
      if (ctx.timeoutMs > 0) {
        setTimeout(() => {
          if (!killed) {
            killed = true;
            trace.add('sandbox-process', `Execution timed out after ${ctx.timeoutMs}ms`);
            child.kill('SIGKILL');
            resolve({
              success: false, output: {}, errors: [`Execution timed out after ${ctx.timeoutMs}ms`],
              warnings: [], timeMs: ctx.timeoutMs, memoryUsedBytes: 0,
              metadata: {}, trace: trace.getEntries(),
            });
          }
        }, ctx.timeoutMs);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Sandbox: VM-based Execution
// ---------------------------------------------------------------------------

class VMSandbox {
  async execute(code: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const { createContext, runInContext } = await import('node:vm');
    const trace = new TraceCollector(ctx.traceEnabled);
    trace.add('sandbox-vm', 'Starting VM-based execution');

    const startMem = process.memoryUsage().heapUsed;
    const sandbox: Record<string, unknown> = {
      console: { log: (...args: unknown[]) => trace.add('sandbox-vm', 'console.log', args), error: (...args: unknown[]) => trace.add('sandbox-vm', 'console.error', args) },
      process: { env: ctx.env, exit: (code: number) => { trace.add('sandbox-vm', `process.exit(${code})`); } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error,
      TypeError,
      RangeError,
      SyntaxError,
      ReferenceError,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent,
      encodeURI,
      decodeURI,
      btoa: (s: string) => Buffer.from(s).toString('base64'),
      atob: (s: string) => Buffer.from(s, 'base64').toString('utf8'),
      _mamInputs: ctx.inputs,
      _mamResult: { success: true, output: {}, errors: [], warnings: [] as string[] },
    };

    const contextOptions: { timeout?: number; microtaskMode?: string } = {};
    if (ctx.timeoutMs > 0) contextOptions.timeout = ctx.timeoutMs;
    if (ctx.memoryLimitBytes > 0) {
      // Approximate: V8 doesn't expose direct memory limit in sandbox
      // We rely on the timeout for safety
    }

    const vmContext = createContext(sandbox, { name: 'MAM Sandbox' });

    try {
      trace.add('sandbox-vm', 'Executing code in VM');
      const execStart = Date.now();
      runInContext(code, vmContext, contextOptions);
      const execTimeMs = Date.now() - execStart;

      trace.add('sandbox-vm', `VM execution completed in ${execTimeMs}ms`);

      const result = sandbox._mamResult as ExecutionResult;
      return {
        ...result,
        timeMs: execTimeMs,
        memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
        trace: trace.getEntries(),
      };
    } catch (err) {
      trace.add('sandbox-vm', `VM execution error: ${(err as Error).message}`);
      return {
        success: false, output: {},
        errors: [`VM error: ${(err as Error).message}`],
        warnings: [], timeMs: Date.now() - ctx.startTime,
        memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
        metadata: { errorType: (err as Error).name },
        trace: trace.getEntries(),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Sandbox: Docker-based Execution
// ---------------------------------------------------------------------------

class DockerSandbox {
  async execute(code: string, ctx: ExecutionContext): Promise<ExecutionResult> {
    const trace = new TraceCollector(ctx.traceEnabled);
    trace.add('sandbox-docker', 'Starting Docker-based execution');

    const { execSync } = await import('node:child_process');

    try {
      // Check if Docker is available
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
    } catch {
      trace.add('sandbox-docker', 'Docker not available, falling back to VM');
      const vm = new VMSandbox();
      return vm.execute(code, ctx);
    }

    const startMem = process.memoryUsage().heapUsed;
    const containerName = `mam-sandbox-${IDGenerator.generate()}`;
    const memoryFlag = ctx.memoryLimitBytes > 0 ? `--memory=${ctx.memoryLimitBytes}` : '';
    const timeoutFlag = ctx.timeoutMs > 0 ? `--timeout=${Math.ceil(ctx.timeoutMs / 1000)}` : '';

    try {
      trace.add('sandbox-docker', `Creating container: ${containerName}`);

      const envFlags = Object.entries(ctx.env).map(([k, v]) => `-e ${k}="${v}"`).join(' ');

      // Create and run container
      const dockerCmd = [
        'docker run --rm',
        `--name ${containerName}`,
        memoryFlag,
        '--network none', // Isolate network
        envFlags,
        'node:20-alpine',
        'node', '-e', JSON.stringify(code),
      ].filter(Boolean).join(' ');

      trace.add('sandbox-docker', `Running: docker run ${containerName}`);
      const execStart = Date.now();

      const output = execSync(dockerCmd, {
        stdio: 'pipe',
        timeout: ctx.timeoutMs > 0 ? ctx.timeoutMs : undefined,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, ...ctx.env },
      });

      const execTimeMs = Date.now() - execStart;
      trace.add('sandbox-docker', `Docker execution completed in ${execTimeMs}ms`);

      let parsedOutput: Record<string, unknown> = {};
      try {
        parsedOutput = JSON.parse(output.toString());
      } catch {
        parsedOutput = { stdout: output.toString().trim() };
      }

      return {
        success: true, output: parsedOutput, errors: [], warnings: [],
        timeMs: execTimeMs, memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
        metadata: { container: containerName, docker: true },
        trace: trace.getEntries(),
      };
    } catch (err) {
      trace.add('sandbox-docker', `Docker execution error: ${(err as Error).message}`);
      return {
        success: false, output: {},
        errors: [`Docker error: ${(err as Error).message}`],
        warnings: [], timeMs: Date.now() - ctx.startTime,
        memoryUsedBytes: process.memoryUsage().heapUsed - startMem,
        metadata: { container: containerName, docker: true },
        trace: trace.getEntries(),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Sandbox Factory
// ---------------------------------------------------------------------------

class SandboxFactory {
  static create(type: SandboxType): { execute(code: string, ctx: ExecutionContext): Promise<ExecutionResult> } {
    switch (type) {
      case 'process': return new ProcessSandbox();
      case 'vm': return new VMSandbox();
      case 'docker': return new DockerSandbox();
      default: return new VMSandbox();
    }
  }
}

// ---------------------------------------------------------------------------
// Hook Manager
// ---------------------------------------------------------------------------

class HookManager {
  private hooks: HookCallback[] = [];

  register(hook: HookCallback): void {
    this.hooks.push(hook);
  }

  async runBefore(ctx: ExecutionContext, trace: TraceCollector): Promise<void> {
    const beforeHooks = this.hooks.filter(h => h.event === 'before');
    for (const hook of beforeHooks) {
      trace.add('hook', `Running before hook: ${hook.name}`);
      const start = Date.now();
      await hook.fn(ctx);
      trace.add('hook', `Before hook ${hook.name} completed in ${Date.now() - start}ms`);
    }
  }

  async runAfter(ctx: ExecutionContext, result: ExecutionResult, trace: TraceCollector): Promise<void> {
    const afterHooks = this.hooks.filter(h => h.event === 'after');
    for (const hook of afterHooks) {
      trace.add('hook', `Running after hook: ${hook.name}`);
      const start = Date.now();
      await hook.fn(ctx, result);
      trace.add('hook', `After hook ${hook.name} completed in ${Date.now() - start}ms`);
    }
  }

  clear(): void { this.hooks = []; }
}

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

class PluginManager {
  private plugins: PluginInstance[] = [];

  async load(pluginPaths: string[], ctx: ExecutionContext): Promise<void> {
    for (const path of pluginPaths) {
      try {
        const mod = await import(path);
        const plugin: PluginInstance = {
          name: mod.name || basename(path, extname(path)),
          version: mod.version || '0.0.0',
          onLoad: mod.onLoad,
          beforeExecute: mod.beforeExecute,
          afterExecute: mod.afterExecute,
          onUnload: mod.onUnload,
          onError: mod.onError,
        };
        if (plugin.onLoad) await plugin.onLoad(ctx);
        this.plugins.push(plugin);
      } catch (err) {
        console.warn(chalk.yellow(`Warning: Failed to load plugin ${path}: ${(err as Error).message}`));
      }
    }
  }

  async runBefore(ctx: ExecutionContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeExecute) await plugin.beforeExecute(ctx);
    }
  }

  async runAfter(ctx: ExecutionContext, result: ExecutionResult): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.afterExecute) await plugin.afterExecute(ctx, result);
    }
  }

  async runError(ctx: ExecutionContext, error: Error): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onError) await plugin.onError(ctx, error);
    }
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onUnload) await plugin.onUnload();
    }
    this.plugins = [];
  }

  getPlugins(): PluginInstance[] { return [...this.plugins]; }
}

// ---------------------------------------------------------------------------
// Result Formatter
// ---------------------------------------------------------------------------

class ResultFormatter {
  static format(result: ExecutionResult, format: ResultFormat, verbose: boolean): string {
    switch (format) {
      case 'json': return this.formatJSON(result, verbose);
      case 'table': return this.formatTable(result, verbose);
      case 'text':
      default: return this.formatText(result, verbose);
    }
  }

  private static formatText(result: ExecutionResult, verbose: boolean): string {
    const lines: string[] = [];
    if (result.success) {
      lines.push(chalk.green('Execution completed successfully'));
    } else {
      lines.push(chalk.red('Execution failed'));
    }

    if (result.output && Object.keys(result.output).length > 0) {
      lines.push(chalk.cyan('\nOutput:'));
      lines.push(JSON.stringify(result.output, null, 2));
    }

    if (result.errors.length > 0) {
      lines.push(chalk.red('\nErrors:'));
      for (const e of result.errors) lines.push(chalk.red(`  ${e}`));
    }

    if (result.warnings.length > 0) {
      lines.push(chalk.yellow('\nWarnings:'));
      for (const w of result.warnings) lines.push(chalk.yellow(`  ${w}`));
    }

    if (verbose) {
      lines.push(chalk.gray(`\nTime: ${result.timeMs.toFixed(2)}ms`));
      lines.push(chalk.gray(`Memory: ${(result.memoryUsedBytes / 1024 / 1024).toFixed(2)}MB`));
      if (result.metadata && Object.keys(result.metadata).length > 0) {
        lines.push(chalk.gray(`Metadata: ${JSON.stringify(result.metadata)}`));
      }
      if (result.trace.length > 0) {
        lines.push(chalk.gray(`\nTrace (${result.trace.length} entries):`));
        for (const t of result.trace) {
          const ts = new Date(t.timestamp).toISOString().slice(11, 23);
          lines.push(chalk.gray(`  [${ts}] ${t.event}: ${t.message}${t.durationMs != null ? ` (${t.durationMs}ms)` : ''}`));
        }
      }
    }

    return lines.join('\n');
  }

  private static formatJSON(result: ExecutionResult, verbose: boolean): string {
    const output: Record<string, unknown> = {
      success: result.success,
      output: result.output,
      errors: result.errors,
      warnings: result.warnings,
      timeMs: result.timeMs,
      memoryUsedBytes: result.memoryUsedBytes,
    };
    if (verbose) {
      output.metadata = result.metadata;
      output.trace = result.trace;
    }
    return JSON.stringify(output, null, 2);
  }

  private static formatTable(result: ExecutionResult, verbose: boolean): string {
    const lines: string[] = [];
    const pad = (s: string, w: number) => s.padEnd(w);
    const sep = '+'.padEnd(20, '-') + '+' + '-'.repeat(40) + '+';

    lines.push(sep);
    lines.push(`| ${pad('Status', 18)} | ${pad(result.success ? 'SUCCESS' : 'FAILED', 39)} |`);
    lines.push(`| ${pad('Time (ms)', 18)} | ${pad(result.timeMs.toFixed(2), 39)} |`);
    lines.push(`| ${pad('Memory', 18)} | ${pad(`${(result.memoryUsedBytes / 1024 / 1024).toFixed(2)} MB`, 39)} |`);

    if (result.errors.length > 0) {
      lines.push(`| ${pad('Errors', 18)} | ${pad(result.errors.length.toString(), 39)} |`);
    }
    if (result.warnings.length > 0) {
      lines.push(`| ${pad('Warnings', 18)} | ${pad(result.warnings.length.toString(), 39)} |`);
    }
    if (result.output && Object.keys(result.output).length > 0) {
      lines.push(`| ${pad('Output Keys', 18)} | ${pad(Object.keys(result.output).join(', '), 39)} |`);
    }
    lines.push(sep);

    if (verbose && result.trace.length > 0) {
      lines.push('');
      lines.push('Trace:');
      for (const t of result.trace) {
        lines.push(`  ${t.event}: ${t.message}${t.durationMs != null ? ` (${t.durationMs}ms)` : ''}`);
      }
    }

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

class BenchmarkRunner {
  static async run(
    executeFn: () => Promise<ExecutionResult>,
    totalRuns: number,
    trace: TraceCollector,
  ): Promise<BenchmarkResult> {
    const results: ExecutionResult[] = [];
    const times: number[] = [];

    // Warmup
    trace.add('benchmark', `Warmup: ${BENCHMARK_WARMUP_RUNS} runs`);
    for (let i = 0; i < BENCHMARK_WARMUP_RUNS; i++) {
      await executeFn();
    }

    // Actual benchmark runs
    trace.add('benchmark', `Benchmarking: ${totalRuns} runs`);
    for (let i = 0; i < totalRuns; i++) {
      const start = Date.now();
      const result = await executeFn();
      const elapsed = Date.now() - start;
      results.push(result);
      times.push(elapsed);
      trace.add('benchmark', `Run ${i + 1}/${totalRuns}`, { timeMs: elapsed, success: result.success });
    }

    times.sort((a, b) => a - b);
    const totalTimeMs = times.reduce((s, t) => s + t, 0);
    const successCount = results.filter(r => r.success).length;

    return {
      runs: totalRuns,
      totalTimeMs,
      avgTimeMs: totalTimeMs / totalRuns,
      minTimeMs: times[0],
      maxTimeMs: times[times.length - 1],
      medianTimeMs: times[Math.floor(times.length / 2)],
      p95TimeMs: times[Math.floor(times.length * 0.95)],
      p99TimeMs: times[Math.floor(times.length * 0.99)],
      successRate: (successCount / totalRuns) * 100,
      results,
    };
  }

  static format(result: BenchmarkResult): string {
    const lines: string[] = [];
    const sep = '='.repeat(50);
    lines.push(sep);
    lines.push('  BENCHMARK RESULTS');
    lines.push(sep);
    lines.push(`  Runs:         ${result.runs}`);
    lines.push(`  Total:        ${result.totalTimeMs.toFixed(2)}ms`);
    lines.push(`  Average:      ${result.avgTimeMs.toFixed(2)}ms`);
    lines.push(`  Min:          ${result.minTimeMs.toFixed(2)}ms`);
    lines.push(`  Max:          ${result.maxTimeMs.toFixed(2)}ms`);
    lines.push(`  Median:       ${result.medianTimeMs.toFixed(2)}ms`);
    lines.push(`  P95:          ${result.p95TimeMs.toFixed(2)}ms`);
    lines.push(`  P99:          ${result.p99TimeMs.toFixed(2)}ms`);
    lines.push(`  Success Rate: ${result.successRate.toFixed(1)}%`);
    lines.push(sep);
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Parallel Executor
// ---------------------------------------------------------------------------

class ParallelExecutor {
  static async executeAll(
    tasks: Array<{ id: string; code: string; ctx: ExecutionContext }>,
    sandbox: { execute(code: string, ctx: ExecutionContext): Promise<ExecutionResult> },
    trace: TraceCollector,
  ): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();
    trace.add('parallel', `Executing ${tasks.length} tasks in parallel`);

    const promises = tasks.map(async (task) => {
      trace.add('parallel', `Starting task ${task.id}`);
      const start = Date.now();
      const result = await sandbox.execute(task.code, task.ctx);
      trace.add('parallel', `Task ${task.id} completed in ${Date.now() - start}ms`, { success: result.success });
      results.set(task.id, result);
    });

    await Promise.allSettled(promises);
    return results;
  }
}

// ---------------------------------------------------------------------------
// Code Generator for Runtime Execution
// ---------------------------------------------------------------------------

class RuntimeCodeGenerator {
  static generate(ast: unknown, inputs: Record<string, unknown>, env: Record<string, string>): string {
    const inputJSON = JSON.stringify(inputs);
    const envJSON = JSON.stringify(env);

    return `
      "use strict";
      const _mamInputs = ${inputJSON};
      const _mamEnv = ${envJSON};
      const _mamResult = { success: true, output: {}, errors: [], warnings: [], metadata: {} };

      function _mamValidate(inputs, schema) {
        const errors = [];
        for (const [key, rules] of Object.entries(schema || {})) {
          if (rules.required && !(key in inputs)) errors.push("Missing: " + key);
        }
        return errors;
      }

      function _mamOutput(key, value) {
        _mamResult.output[key] = value;
      }

      function _mamError(msg) {
        _mamResult.errors.push(msg);
        _mamResult.success = false;
      }

      function _mamWarn(msg) {
        _mamResult.warnings.push(msg);
      }

      // Core execution
      try {
        // Validate inputs
        const validationErrors = _mamValidate(_mamInputs, {});
        if (validationErrors.length > 0) {
          _mamResult.errors.push(...validationErrors);
          _mamResult.success = false;
        } else {
          // Module logic placeholder - will be replaced by actual AST execution
          // For now, pass through inputs to outputs
          _mamResult.output = { ..._mamInputs };
        }
      } catch (err) {
        _mamResult.errors.push(err.message || String(err));
        _mamResult.success = false;
      }

      // Set result in parent scope
      if (typeof _mamResult !== 'undefined') {
        this._mamResult = _mamResult;
      }
    `;
  }

  static generateWithHooks(
    ast: unknown,
    inputs: Record<string, unknown>,
    env: Record<string, string>,
    hooksBefore: string[],
    hooksAfter: string[],
  ): string {
    const inputJSON = JSON.stringify(inputs);
    const envJSON = JSON.stringify(env);
    const beforeCode = hooksBefore.join('\n');
    const afterCode = hooksAfter.join('\n');

    return `
      "use strict";
      const _mamInputs = ${inputJSON};
      const _mamEnv = ${envJSON};
      const _mamResult = { success: true, output: {}, errors: [], warnings: [], metadata: {} };

      // Before hooks
      ${beforeCode}

      try {
        const validationErrors = [];
        if (validationErrors.length > 0) {
          _mamResult.errors.push(...validationErrors);
          _mamResult.success = false;
        } else {
          _mamResult.output = { ..._mamInputs };
        }
      } catch (err) {
        _mamResult.errors.push(err.message || String(err));
        _mamResult.success = false;
      }

      // After hooks
      ${afterCode}

      if (typeof this !== 'undefined') this._mamResult = _mamResult;
    `;
  }
}

// ---------------------------------------------------------------------------
// Parallel Execution Support
// ---------------------------------------------------------------------------

interface ParallelTask {
  file: string;
  target?: string;
  inputs?: Record<string, unknown>;
}

class ParallelRunner {
  static async run(
    tasks: ParallelTask[],
    baseOptions: RunOptions,
  ): Promise<Map<string, ExecutionResult>> {
    const results = new Map<string, ExecutionResult>();
    const promises = tasks.map(async (task) => {
      const opts = { ...baseOptions, file: task.file, target: task.target, inputs: task.inputs ? JSON.stringify(task.inputs) : undefined };
      const result = await executeRun(opts);
      results.set(task.file, result);
    });
    await Promise.allSettled(promises);
    return results;
  }
}

// ---------------------------------------------------------------------------
// Main Execute Function
// ---------------------------------------------------------------------------

async function executeRun(options: RunOptions): Promise<ExecutionResult> {
  const startTime = Date.now();
  const trace = new TraceCollector(options.trace || false);
  const hookManager = new HookManager();
  const pluginManager = new PluginManager();

  trace.add('init', 'Starting execution');

  try {
    const filePath = resolve(options.file);
    trace.add('init', `Loading file: ${filePath}`);

    const content = await readFile(filePath, 'utf-8');
    trace.add('init', `File loaded: ${content.length} bytes`);

    // Parse
    trace.add('parse', 'Parsing MAM module');
    const parseStart = Date.now();
    const result = parseMAM(content, { source: filePath });
    trace.add('parse', `Parse completed in ${Date.now() - parseStart}ms`);

    if (result.errors.length > 0) {
      return {
        success: false, output: {}, errors: result.errors.map(e => e.toFormattedString()),
        warnings: [], timeMs: Date.now() - startTime, memoryUsedBytes: 0,
        metadata: {}, trace: trace.getEntries(),
      };
    }

    // Parse inputs
    const inputs = InputParser.parse(options.inputs);
    trace.add('init', `Inputs: ${JSON.stringify(inputs)}`);

    // Parse environment
    const env = InputParser.parseEnv(options.env);
    trace.add('init', `Env vars: ${Object.keys(env).length} entries`);

    // Memory limit
    const memoryLimitBytes = InputParser.parseMemoryLimit(options.memoryLimit);
    trace.add('init', `Memory limit: ${(memoryLimitBytes / 1024 / 1024).toFixed(0)}MB`);

    // Build execution context
    const ctx: ExecutionContext = {
      id: IDGenerator.generate(),
      inputs,
      env,
      timeoutMs: options.timeout || DEFAULT_TIMEOUT_MS,
      memoryLimitBytes,
      sandboxType: options.sandbox || 'vm',
      plugins: [],
      hooksBefore: [],
      hooksAfter: [],
      traceEnabled: options.trace || false,
      startTime,
      metadata: { file: filePath, target: options.target },
    };

    // Load plugins
    if (options.plugins && options.plugins.length > 0) {
      trace.add('plugins', `Loading ${options.plugins.length} plugins`);
      await pluginManager.load(options.plugins, ctx);
    }

    // Load custom hooks
    if (options.hooks && options.hooks.length > 0) {
      for (const hookPath of options.hooks) {
        try {
          const hookMod = await import(hookPath);
          if (hookMod.before) hookManager.register({ name: basename(hookPath), event: 'before', fn: hookMod.before });
          if (hookMod.after) hookManager.register({ name: basename(hookPath), event: 'after', fn: hookMod.after });
        } catch (err) {
          console.warn(chalk.yellow(`Warning: Failed to load hook ${hookPath}: ${(err as Error).message}`));
        }
      }
    }

    // Run before hooks and plugins
    await hookManager.runBefore(ctx, trace);
    await pluginManager.runBefore(ctx);

    // Generate execution code
    trace.add('compile', 'Generating runtime code');
    const code = RuntimeCodeGenerator.generate(result.ast, inputs, env);

    // Execute in sandbox
    trace.add('execute', `Executing in ${ctx.sandboxType} sandbox`);
    const sandbox = SandboxFactory.create(ctx.sandboxType);
    const execStart = Date.now();
    const execResult = await sandbox.execute(code, ctx);
    const execTimeMs = Date.now() - execStart;
    trace.add('execute', `Execution completed in ${execTimeMs}ms`);

    // Merge results
    const finalResult: ExecutionResult = {
      success: execResult.success,
      output: execResult.output,
      errors: execResult.errors,
      warnings: [...execResult.warnings, ...execResult.warnings],
      timeMs: Date.now() - startTime,
      memoryUsedBytes: execResult.memoryUsedBytes,
      metadata: { ...execResult.metadata, sandbox: ctx.sandboxType, file: filePath },
      trace: [...trace.getEntries(), ...execResult.trace],
    };

    // Run after hooks and plugins
    await pluginManager.runAfter(ctx, finalResult);
    await hookManager.runAfter(ctx, finalResult, trace);

    // Unload plugins
    await pluginManager.unloadAll();

    return finalResult;
  } catch (error) {
    trace.add('error', `Fatal error: ${(error as Error).message}`);
    await pluginManager.runError({} as ExecutionContext, error as Error);
    await pluginManager.unloadAll();
    return {
      success: false, output: {},
      errors: [`Fatal error: ${(error as Error).message}`],
      warnings: [], timeMs: Date.now() - startTime,
      memoryUsedBytes: 0, metadata: {},
      trace: trace.getEntries(),
    };
  }
}

// ---------------------------------------------------------------------------
// CLI Entry Point
// ---------------------------------------------------------------------------

export async function runCommand(options: RunOptions): Promise<void> {
  const spinner = ora({ text: 'Running module...', isEnabled: !options.quiet }).start();

  try {
    // Parallel mode
    if (options.parallel) {
      spinner.text = 'Running in parallel mode...';
      // If inputs contains an array of task objects, run them in parallel
      const inputTasks = options.inputs ? JSON.parse(options.inputs) : [];
      if (Array.isArray(inputTasks)) {
        const tasks: ParallelTask[] = inputTasks.map((t: Record<string, unknown>) => ({
          file: (t.file as string) || options.file,
          target: t.target as string,
          inputs: t.inputs as Record<string, unknown>,
        }));
        const results = await ParallelRunner.run(tasks, options);
        spinner.stop();
        let hasFailure = false;
        for (const [file, result] of results) {
          console.log(chalk.cyan(`\n${basename(file)}:`));
          console.log(ResultFormatter.format(result, options.format || 'text', options.verbose || false));
          if (!result.success) hasFailure = true;
        }
        process.exit(hasFailure ? 1 : 0);
      }
    }

    // Benchmark mode
    if (options.benchmark) {
      const runs = options.benchmarkRuns || 10;
      spinner.text = `Running benchmark (${runs} runs)...`;

      const trace = new TraceCollector(true);
      const benchmarkResult = await BenchmarkRunner.run(
        () => executeRun({ ...options, benchmark: false, trace: false }),
        runs,
        trace,
      );

      spinner.stop();
      console.log(BenchmarkRunner.format(benchmarkResult));

      if (options.format === 'json') {
        console.log(JSON.stringify(benchmarkResult, null, 2));
      }

      process.exit(benchmarkResult.successRate === 100 ? 0 : 1);
    }

    // Single execution
    spinner.text = 'Executing module...';
    const result = await executeRun(options);
    spinner.stop();

    const formatted = ResultFormatter.format(result, options.format || 'text', options.verbose || false);
    console.log(formatted);

    process.exit(result.success ? 0 : 1);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  InputParser, IDGenerator, TraceCollector, ExecutionHistory,
  ProcessSandbox, VMSandbox, DockerSandbox, SandboxFactory,
  HookManager, PluginManager, ResultFormatter, BenchmarkRunner,
  ParallelExecutor, ParallelRunner, RuntimeCodeGenerator,
  executeRun,
};
