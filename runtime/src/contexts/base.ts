/**
 * Base Execution Context
 *
 * Abstract base class for all execution contexts. Extracted to its own
 * module to avoid circular imports between index.ts and per-runtime
 * context implementations (rust.ts, go.ts, etc.).
 *
 * Provides:
 * - Unique context identification (id, createdAt)
 * - Execution tracking (executionCount, lastExecutedAt, totalTimeMs)
 * - Memory management with peak tracking
 * - Error wrapping with runtime and context metadata
 * - Abstract validation and language support hooks
 */

import type { ExecutionContext, ExecutionContextConfig, ExecutionResult, ContextStats } from './types.js';
import type { CodeBlock, Language } from '@mam/ast';

let contextIdCounter = 0;

/**
 * Abstract base for all MAM execution contexts.
 *
 * Subclasses must implement:
 * - `execute(code)` — run a code block
 * - `validateCode(code)` — language-specific syntax/safety check
 * - `getSupportedLanguages()` — list of Language identifiers this context handles
 *
 * @example
 * class MyContext extends BaseExecutionContext {
 *   readonly runtime = 'python';
 *   async execute(code) { ... }
 *   validateCode(code) { return true; }
 *   getSupportedLanguages() { return ['python']; }
 * }
 */
export abstract class BaseExecutionContext implements ExecutionContext {
  abstract readonly runtime: Language;

  protected config: ExecutionContextConfig | null = null;
  protected memory: Record<string, unknown> = {};
  protected initialized = false;

  /** Unique identifier for this context instance. */
  readonly id: string;

  /** Timestamp when this context was created. */
  readonly createdAt: number;

  /** Number of code blocks executed through this context. */
  protected executionCount = 0;

  /** Timestamp of the most recent execution, or null if none yet. */
  protected lastExecutedAt: number | null = null;

  /** Accumulated execution time in milliseconds across all executions. */
  protected totalTimeMs = 0;

  /** Peak memory usage in bytes observed during any single execution. */
  protected memoryPeak = 0;

  constructor() {
    this.id = `ctx-${Date.now()}-${++contextIdCounter}`;
    this.createdAt = Date.now();
  }

  async init(config: ExecutionContextConfig): Promise<void> {
    this.config = config;
    this.memory = {};
    this.initialized = true;
  }

  abstract execute(code: CodeBlock): Promise<ExecutionResult>;

  getMemory(): Record<string, unknown> {
    return { ...this.memory };
  }

  setMemory(key: string, value: unknown): void {
    this.memory[key] = value;
    this.updateMemoryPeak();
  }

  clearMemory(): void {
    this.memory = {};
  }

  async cleanup(): Promise<void> {
    this.memory = {};
    this.config = null;
    this.initialized = false;
  }

  /**
   * Return statistics about this context's lifetime.
   * Useful for monitoring, profiling, and capacity planning.
   */
  getStats(): ContextStats {
    return {
      executionCount: this.executionCount,
      totalTimeMs: this.totalTimeMs,
      lastExecutedAt: this.lastExecutedAt,
      memoryPeak: this.memoryPeak,
    };
  }

  /**
   * Return the average execution time in ms, or 0 if no executions.
   */
  protected getAverageExecutionTime(): number {
    return this.executionCount > 0 ? this.totalTimeMs / this.executionCount : 0;
  }

  /**
   * Wrap an arbitrary error with runtime and context metadata for
   * consistent error reporting across all context implementations.
   */
  wrapError(error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`[${this.runtime}:${this.id}] ${message}`);
  }

  /**
   * Language-specific code validation. Subclasses should override to
   * perform syntax checks, disallow dangerous constructs, etc.
   * Returns true if the code is safe to execute.
   */
  abstract validateCode(code: string): boolean;

  /**
   * Return the list of Language identifiers this context can handle.
   */
  abstract getSupportedLanguages(): Language[];

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Execution context not initialized');
    }
  }

  /**
   * Record a completed execution for stats tracking.
   */
  protected recordExecution(timeMs: number): void {
    this.executionCount++;
    this.totalTimeMs += timeMs;
    this.lastExecutedAt = Date.now();
  }

  private updateMemoryPeak(): void {
    let bytes = 0;
    for (const value of Object.values(this.memory)) {
      bytes += this.estimateSize(value);
    }
    if (bytes > this.memoryPeak) {
      this.memoryPeak = bytes;
    }
  }

  private estimateSize(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'number') return 8;
    if (typeof value === 'boolean') return 4;
    if (Array.isArray(value)) {
      let total = 8; // array overhead
      for (const item of value) {
        total += this.estimateSize(item);
      }
      return total;
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value).length * 2;
      } catch {
        return 0;
      }
    }
    return 0;
  }
}
