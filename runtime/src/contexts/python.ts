/**
 * Python Execution Context
 *
 * Standalone Python context that executes code blocks via the process sandbox.
 */

import { CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext } from './base.js';
import type { ExecutionContextConfig, ExecutionResult } from './types.js';

export interface PythonContextConfig {
  pythonPath?: string;
  timeout?: number;
  sandbox?: boolean;
}

export class PythonContext extends BaseExecutionContext {
  readonly runtime: Language = 'python';
  private pythonConfig: PythonContextConfig;

  constructor(config: PythonContextConfig = {}) {
    super();
    this.pythonConfig = {
      pythonPath: config.pythonPath || 'python3',
      timeout: config.timeout || 30000,
      sandbox: config.sandbox ?? true,
    };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = performance.now();

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(
        `${this.pythonConfig.pythonPath} -c ${JSON.stringify(code.value)}`,
        {
          timeout: this.config?.timeout || this.pythonConfig.timeout,
          env: this.buildEnvironment(),
        }
      );

      return {
        success: true,
        output: stdout.trim(),
        timeMs: performance.now() - startTime,
        stdout,
        stderr,
        exitCode: 0,
      };
    } catch (error) {
      const err = error as { message: string; stdout?: string; stderr?: string };
      return {
        success: false,
        error: err.stderr || err.message,
        timeMs: performance.now() - startTime,
        stdout: err.stdout || '',
        stderr: err.stderr || '',
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

  private buildEnvironment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    const allowedVars = ['PATH', 'HOME', 'USER', 'PYTHONPATH', 'VIRTUAL_ENV'];

    for (const varName of allowedVars) {
      env[varName] = process.env[varName];
    }

    if (this.config?.env) {
      Object.assign(env, this.config.env);
    }

    return env;
  }
}
