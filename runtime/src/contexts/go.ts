/**
 * Go Execution Context
 *
 * Executes Go code blocks. Requires go on PATH.
 */

import { CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext } from './base.js';
import type { ExecutionResult } from './types.js';

export class GoContext extends BaseExecutionContext {
  readonly runtime: Language = 'go';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = performance.now();

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { writeFile, unlink, mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const tmpDir = await mkdtemp(join(tmpdir(), 'mam-go-'));
      const srcFile = join(tmpDir, 'main.go');

      await writeFile(srcFile, `package main\n\nimport "fmt"\n\nfunc main() {\n${code.value}\n}\n`);

      const execAsync = promisify(exec);

      const runResult = await execAsync(
        `go run ${srcFile}`,
        { timeout: this.config?.timeout || 30000, cwd: tmpDir }
      ).catch((err) => ({
        stdout: '',
        stderr: err.stderr || err.message,
      }));

      await unlink(srcFile).catch(() => {});

      return {
        success: !runResult.stderr,
        output: runResult.stdout.trim(),
        timeMs: performance.now() - startTime,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        exitCode: runResult.stderr ? 1 : 0,
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
