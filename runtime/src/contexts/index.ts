/**
 * MAM Execution Contexts
 * 
 * Provides execution contexts for different runtimes.
 */

import { MAMModule, CodeBlock, Language } from '@mam/ast';
import { RustContext } from './rust.js';
import { GoContext } from './go.js';

/**
 * Execution context configuration
 */
export interface ExecutionContextConfig {
  /** Module being executed */
  module: MAMModule;
  /** Input parameters */
  inputs: Record<string, unknown>;
  /** Required permissions */
  permissions: string[];
  /** Execution timeout in milliseconds */
  timeout?: number;
  /** Memory limit in bytes */
  memoryLimit?: number;
  /** Working directory */
  workingDir?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Output value */
  output?: unknown;
  /** Error message if failed */
  error?: string;
  /** Execution time in milliseconds */
  timeMs: number;
  /** Memory used in bytes */
  memoryUsed?: number;
  /** stdout output */
  stdout?: string;
  /** stderr output */
  stderr?: string;
  /** Exit code */
  exitCode?: number;
}

/**
 * Execution context interface
 */
export interface ExecutionContext {
  /** Runtime type */
  readonly runtime: Language;
  
  /** Initialize the context */
  init(config: ExecutionContextConfig): Promise<void>;
  
  /** Execute a code block */
  execute(code: CodeBlock): Promise<ExecutionResult>;
  
  /** Get memory state */
  getMemory(): Record<string, unknown>;
  
  /** Set memory state */
  setMemory(key: string, value: unknown): void;
  
  /** Clear memory */
  clearMemory(): void;
  
  /** Cleanup resources */
  cleanup(): Promise<void>;
}

/**
 * Base execution context
 */
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

/**
 * Python execution context
 */
export class PythonExecutionContext extends BaseExecutionContext {
  readonly runtime: Language = 'python';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();
    
    const startTime = performance.now();
    
    try {
      // In a real implementation, this would execute Python code
      // For now, return a placeholder
      return {
        success: true,
        output: null,
        timeMs: performance.now() - startTime,
        stdout: '',
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        timeMs: performance.now() - startTime,
        exitCode: 1,
      };
    }
  }
}

/**
 * JavaScript execution context
 */
export class JavaScriptExecutionContext extends BaseExecutionContext {
  readonly runtime: Language = 'javascript';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();
    
    const startTime = performance.now();
    
    try {
      // Execute JavaScript using Node.js vm module
      const vm = await import('node:vm');
      const context = vm.createContext({
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        ...this.memory,
      });
      
      const script = new vm.Script(code.value);
      const result = script.runInContext(context, {
        timeout: this.config?.timeout || 30000,
      });
      
      return {
        success: true,
        output: result,
        timeMs: performance.now() - startTime,
        exitCode: 0,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        timeMs: performance.now() - startTime,
        exitCode: 1,
      };
    }
  }
}

/**
 * Create execution context for a runtime
 */
export function createExecutionContext(runtime: Language): ExecutionContext {
  switch (runtime) {
    case 'python':
      return new PythonExecutionContext();
    case 'javascript':
    case 'js':
      return new JavaScriptExecutionContext();
    case 'rust':
      return new RustContext();
    case 'go':
      return new GoContext();
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
}

// Re-export standalone contexts
export { PythonContext } from './python.js';
export { JavaScriptContext } from './javascript.js';
export { RustContext } from './rust.js';
export { GoContext } from './go.js';