/**
 * Python Plugin - Runtime Context
 *
 * Bridges the plugin API's synchronous-looking execution contract to the
 * subprocess runner.
 */

import type { RuntimeContext, ExecutionContext, ExecutionResult } from '@mam/plugin-api';
import {
  runPythonCode, runPythonExpression, checkPythonAvailable,
  type PythonRunOptions, type PythonRunResult,
} from './runner.js';

export interface PythonContextOptions extends PythonRunOptions {
  /** Default timeout when the execution context does not supply one. */
  timeout?: number;
  /** Run the code as an expression and JSON-decode the result. */
  asExpression?: boolean;
  /** Trim captured output. */
  trimOutput?: boolean;
}

function toExecutionResult(
  result: PythonRunResult,
  elapsedMs: number,
): ExecutionResult {
  const memory = result.truncated
    ? { truncated: true, outputBytes: result.outputBytes }
    : undefined;

  if (result.timedOut) {
    return {
      success: false,
      error: 'Python execution timed out',
      timeMs: elapsedMs,
      exitCode: result.exitCode ?? undefined,
      ...(memory ? { memory } : {}),
    };
  }
  if (result.truncated) {
    return {
      success: false,
      error: `Output exceeded the configured limit and was truncated`,
      timeMs: elapsedMs,
      exitCode: result.exitCode ?? undefined,
      ...(memory ? { memory } : {}),
    };
  }
  return {
    success: result.success,
    // An empty string is real output, so only undefined when nothing was written.
    output: result.stdout !== '' ? result.stdout : undefined,
    error: result.stderr !== '' ? result.stderr : undefined,
    timeMs: elapsedMs,
    exitCode: result.exitCode ?? undefined,
    ...(result.signal ? { memory: { signal: result.signal } } : {}),
  };
}

async function execute(
  code: string,
  ctx: ExecutionContext,
  options: PythonContextOptions,
): Promise<ExecutionResult> {
  const startTime = performance.now();
  const runOptions: PythonRunOptions = {
    ...options,
    timeout: options.timeout ?? ctx.timeout ?? 30000,
  };

  try {
    const result = options.asExpression
      ? await runPythonExpression(code, runOptions)
      : await runPythonCode(code, runOptions);
    return toExecutionResult(result, performance.now() - startTime);
  } catch (error) {
    // The runner resolves rather than rejecting, so this only catches a
    // failure to even attempt the run, such as an unwritable temp directory.
    return {
      success: false,
      error: (error as Error).message,
      timeMs: performance.now() - startTime,
    };
  }
}

/** The default context, using the resolved interpreter and a 30s timeout. */
export const pythonContext: RuntimeContext = {
  name: 'python',
  language: 'python',
  canHandle: (lang) => lang === 'python' || lang === 'py' || lang === 'python3',
  execute: (code: string, ctx: ExecutionContext) => execute(code, ctx, {}),
};

/** Builds a Python context with the given run options. */
export function createPythonContext(options: PythonContextOptions = {}): RuntimeContext {
  return {
    name: 'python',
    language: 'python',
    canHandle: (lang) => lang === 'python' || lang === 'py' || lang === 'python3',
    execute: (code: string, ctx: ExecutionContext) => execute(code, ctx, options),
  };
}

/** Reports whether a Python interpreter is available, for a readiness probe. */
export async function checkPythonReady(timeout = 5000) {
  return checkPythonAvailable(timeout);
}
