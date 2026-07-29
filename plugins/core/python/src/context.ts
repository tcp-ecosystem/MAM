/**
 * Python Plugin - Runtime Context
 */

import type { RuntimeContext, ExecutionContext, ExecutionResult } from '@mam/plugin-api';
import { runPythonCode } from './runner.js';

export const pythonContext: RuntimeContext = {
  name: 'python',
  language: 'python',
  canHandle: (lang) => lang === 'python' || lang === 'py' || lang === 'python3',
  execute: async (code: string, ctx: ExecutionContext): Promise<ExecutionResult> => {
    const startTime = performance.now();
    try {
      const result = await runPythonCode(code, {
        timeout: ctx.timeout || 30000,
      });
      return {
        success: result.success,
        output: result.stdout || undefined,
        error: result.stderr || undefined,
        timeMs: performance.now() - startTime,
      };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        timeMs: performance.now() - startTime,
      };
    }
  },
};

export function createPythonContext(options?: { timeout?: number }): RuntimeContext {
  return {
    ...pythonContext,
    execute: async (code: string, ctx: ExecutionContext): Promise<ExecutionResult> => {
      const startTime = performance.now();
      try {
        const result = await runPythonCode(code, {
          timeout: options?.timeout || ctx.timeout || 30000,
        });
        return {
          success: result.success,
          output: result.stdout || undefined,
          error: result.stderr || undefined,
          timeMs: performance.now() - startTime,
        };
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          timeMs: performance.now() - startTime,
        };
      }
    },
  };
}
