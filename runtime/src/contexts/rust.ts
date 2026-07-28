/**
 * Rust Execution Context
 *
 * Executes Rust code blocks. Currently a stub; requires rustc/cargo on PATH
 * and compilation step before execution.
 */

import { CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext, ExecutionResult } from './index.js';

export class RustContext extends BaseExecutionContext {
  readonly runtime: Language = 'rust';

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();

    const startTime = performance.now();

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { writeFile, unlink, mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const tmpDir = await mkdtemp(join(tmpdir(), 'mam-rust-'));
      const srcFile = join(tmpDir, 'main.rs');
      const outFile = join(tmpDir, 'main');

      await writeFile(srcFile, code.value);

      const execAsync = promisify(exec);

      const compileResult = await execAsync(
        `rustc ${srcFile} -o ${outFile}`,
        { timeout: this.config?.timeout || 30000 }
      ).catch((err) => ({
        stdout: '',
        stderr: err.stderr || err.message,
      }));

      if (compileResult.stderr) {
        return {
          success: false,
          error: compileResult.stderr,
          timeMs: performance.now() - startTime,
          stderr: compileResult.stderr,
          exitCode: 1,
        };
      }

      const runResult = await execAsync(outFile, {
        timeout: this.config?.timeout || 30000,
      }).catch((err) => ({
        stdout: '',
        stderr: err.stderr || err.message,
      }));

      await unlink(srcFile).catch(() => {});
      await unlink(outFile).catch(() => {});

      return {
        success: true,
        output: runResult.stdout.trim(),
        timeMs: performance.now() - startTime,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
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
