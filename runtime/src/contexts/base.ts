/**
 * Base Execution Context
 *
 * Abstract base class for all execution contexts. Extracted to its own
 * module to avoid circular imports between index.ts and per-runtime
 * context implementations (rust.ts, go.ts, etc.).
 */

import type { ExecutionContext, ExecutionContextConfig, ExecutionResult } from './types.js';
import type { CodeBlock, Language } from '@mam/ast';

export abstract class BaseExecutionContext implements ExecutionContext {
  abstract readonly runtime: Language;

  protected config: ExecutionContextConfig | null = null;
  protected memory: Record<string, unknown> = {};
  protected initialized = false;

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
  }

  clearMemory(): void {
    this.memory = {};
  }

  async cleanup(): Promise<void> {
    this.memory = {};
    this.config = null;
    this.initialized = false;
  }

  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Execution context not initialized');
    }
  }
}
