/**
 * JavaScript Execution Context
 *
 * Standalone JavaScript context that executes code in isolated V8 VM contexts.
 */

import { CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext, ExecutionResult } from './index.js';

export interface JavaScriptContextConfig {
  timeout?: number;
  sandbox?: boolean;
}

export class JavaScriptContext extends BaseExecutionContext {
  readonly runtime: Language = 'javascript';
  private jsConfig: JavaScriptContextConfig;

  constructor(config: JavaScriptContextConfig = {}) {
    super();
    this.jsConfig = {
      timeout: config.timeout || 30000,
      sandbox: config.sandbox ?? true,
    };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = performance.now();

    try {
      const vm = await import('node:vm');

      const sandboxContext: Record<string, unknown> = {
        console: {
          log: (...args: unknown[]) => {},
          error: (...args: unknown[]) => {},
          warn: (...args: unknown[]) => {},
        },
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
        setInterval: globalThis.setInterval,
        clearInterval: globalThis.clearInterval,
        ...this.memory,
      };

      if (!this.jsConfig.sandbox) {
        sandboxContext.process = process;
        sandboxContext.require = require;
      }

      const context = vm.createContext(sandboxContext);
      const script = new vm.Script(code.value, {
        filename: `mam-js-${Date.now()}.js`,
      });

      const result = script.runInContext(context, {
        timeout: this.config?.timeout || this.jsConfig.timeout,
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
