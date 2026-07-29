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

export type {
  ExecutionContext,
  ExecutionContextConfig,
  ExecutionResult,
  ContextStats,
  ContextEvent,
  ContextEventListener,
  LanguageConfig,
  SUPPORTED_LANGUAGES,
} from './types.js';

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

  validateCode(code: string): boolean {
    if (!code || code.trim().length === 0) return false;
    const disallowed = [/\bos\.system\b/, /\bexec\(/, /\beval\(/, /\b__import__\b/];
    for (const pattern of disallowed) {
      if (pattern.test(code)) return false;
    }
    return true;
  }

  getSupportedLanguages(): Language[] {
    return ['python'];
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

  validateCode(code: string): boolean {
    if (!code || code.trim().length === 0) return false;
    return true;
  }

  getSupportedLanguages(): Language[] {
    return ['javascript', 'js'];
  }
}

/**
 * TypeScript execution context — compiles TS to JS and executes via Node.
 */
export class TypeScriptContext extends JavaScriptExecutionContext {
  readonly runtime: Language = 'typescript';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();
    const startTime = performance.now();

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { writeFile, unlink, mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const execAsync = promisify(exec);
      const tmpDir = await mkdtemp(join(tmpdir(), 'mam-ts-'));
      const srcFile = join(tmpDir, 'index.ts');
      const outFile = join(tmpDir, 'index.mjs');

      await writeFile(srcFile, code.value);

      const compileResult = await execAsync(
        `npx tsc --outFile ${outFile} --module nodenext --moduleResolution nodenext --target es2022 ${srcFile}`,
        { timeout: this.config?.timeout || 30000, cwd: tmpDir }
      ).catch((err) => ({
        stdout: '',
        stderr: err.stderr || err.message,
      }));

      if (compileResult.stderr) {
        const timeMs = performance.now() - startTime;
        await unlink(srcFile).catch(() => {});
        return {
          success: false,
          error: compileResult.stderr,
          timeMs,
          stderr: compileResult.stderr,
          exitCode: 1,
        };
      }

      const runResult = await execAsync(
        `node ${outFile}`,
        { timeout: this.config?.timeout || 30000, cwd: tmpDir }
      ).catch((err) => ({
        stdout: '',
        stderr: err.stderr || err.message,
      }));

      await unlink(srcFile).catch(() => {});
      await unlink(outFile).catch(() => {});

      const timeMs = performance.now() - startTime;
      const hasError = !!runResult.stderr;

      return {
        success: !hasError,
        output: runResult.stdout.trim(),
        timeMs,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: hasError ? 1 : 0,
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

  validateCode(code: string): boolean {
    if (!code || code.trim().length === 0) return false;
    return true;
  }

  getSupportedLanguages(): Language[] {
    return ['typescript', 'ts'];
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
    case 'typescript':
    case 'ts':
      return new TypeScriptContext();
    case 'rust':
      return new RustContext();
    case 'go':
      return new GoContext();
    default:
      throw new Error(`Unsupported runtime: ${runtime}`);
  }
}

/**
 * Check if a runtime is supported by any registered context.
 */
export function isRuntimeSupported(runtime: string): boolean {
  try {
    createExecutionContext(runtime as Language);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the list of all supported runtime identifiers.
 */
export function getSupportedRuntimes(): string[] {
  return ['python', 'javascript', 'js', 'typescript', 'ts', 'rust', 'go'];
}

export { PythonContext } from './python.js';
export { JavaScriptContext } from './javascript.js';
export { RustContext } from './rust.js';
export { GoContext } from './go.js';
export { BaseExecutionContext } from './base.js';
