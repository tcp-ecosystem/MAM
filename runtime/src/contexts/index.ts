/**
 * MAM Execution Contexts
 *
 * Provides execution contexts for different runtimes.
 */

import { MAMModule, CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext } from './base.js';
import { RustContext } from './rust.js';
import { GoContext } from './go.js';
import type { ExecutionContext, ExecutionContextConfig, ExecutionResult } from './types.js';

export type { ExecutionContext, ExecutionContextConfig, ExecutionResult };

/**
 * Python execution context
 */
export class PythonExecutionContext extends BaseExecutionContext {
  readonly runtime: Language = 'python';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = performance.now();

    try {
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

export { PythonContext } from './python.js';
export { JavaScriptContext } from './javascript.js';
export { RustContext } from './rust.js';
export { GoContext } from './go.js';
export { BaseExecutionContext } from './base.js';
