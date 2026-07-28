/**
 * Execution Context Types
 *
 * Shared types for execution contexts to avoid circular imports.
 */

import type { MAMModule, CodeBlock, Language } from '@mam/ast';

export interface ExecutionContextConfig {
  module: MAMModule;
  inputs: Record<string, unknown>;
  permissions: string[];
  timeout?: number;
  memoryLimit?: number;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface ExecutionResult {
  success: boolean;
  output?: unknown;
  error?: string;
  timeMs: number;
  memoryUsed?: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface ExecutionContext {
  readonly runtime: Language;
  init(config: ExecutionContextConfig): Promise<void>;
  execute(code: CodeBlock): Promise<ExecutionResult>;
  getMemory(): Record<string, unknown>;
  setMemory(key: string, value: unknown): void;
  clearMemory(): void;
  cleanup(): Promise<void>;
}
