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

// ============================================================================
// Context Statistics
// ============================================================================

export interface ContextStats {
  /** Number of code blocks executed */
  executionCount: number;
  /** Total time spent executing in ms */
  totalTimeMs: number;
  /** Timestamp of last execution */
  lastExecutedAt: number | null;
  /** Peak memory usage in bytes */
  memoryPeak: number;
}

// ============================================================================
// Context Lifecycle Events
// ============================================================================

export type ContextEvent =
  | { type: 'init'; timestamp: number; runtime: string }
  | { type: 'execute:start'; timestamp: number; runtime: string; codeLength: number }
  | { type: 'execute:complete'; timestamp: number; runtime: string; success: boolean; timeMs: number }
  | { type: 'execute:error'; timestamp: number; runtime: string; error: string }
  | { type: 'cleanup'; timestamp: number; runtime: string }
  | { type: 'memory:set'; timestamp: number; runtime: string; key: string }
  | { type: 'memory:clear'; timestamp: number; runtime: string };

export type ContextEventListener = (event: ContextEvent) => void;

// ============================================================================
// Language Configuration
// ============================================================================

export interface LanguageConfig {
  /** Language identifier */
  language: Language;
  /** File extensions associated with this language */
  extensions: string[];
  /** Command to execute the language */
  command: string;
  /** Arguments to pass before the file */
  args: string[];
  /** Whether the language requires compilation */
  compiled: boolean;
  /** Whether code can be executed inline (vs file-only) */
  inline: boolean;
}

export const SUPPORTED_LANGUAGES: Record<string, LanguageConfig> = {
  python: {
    language: 'python',
    extensions: ['.py'],
    command: 'python3',
    args: ['-c'],
    compiled: false,
    inline: true,
  },
  javascript: {
    language: 'javascript',
    extensions: ['.js', '.mjs'],
    command: 'node',
    args: ['--eval'],
    compiled: false,
    inline: true,
  },
  typescript: {
    language: 'typescript',
    extensions: ['.ts', '.tsx'],
    command: 'npx',
    args: ['tsx', '--eval'],
    compiled: false,
    inline: true,
  },
  go: {
    language: 'go',
    extensions: ['.go'],
    command: 'go',
    args: ['run'],
    compiled: true,
    inline: false,
  },
  rust: {
    language: 'rust',
    extensions: ['.rs'],
    command: 'rustc',
    args: [],
    compiled: true,
    inline: false,
  },
  shell: {
    language: 'shell',
    extensions: ['.sh', '.bash'],
    command: 'bash',
    args: ['-c'],
    compiled: false,
    inline: true,
  },
  yaml: {
    language: 'yaml',
    extensions: ['.yaml', '.yml'],
    command: '',
    args: [],
    compiled: false,
    inline: false,
  },
  json: {
    language: 'json',
    extensions: ['.json'],
    command: '',
    args: [],
    compiled: false,
    inline: false,
  },
};
