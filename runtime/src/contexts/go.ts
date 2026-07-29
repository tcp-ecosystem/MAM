/**
 * Go Execution Context
 *
 * Executes Go code blocks. Requires go on PATH.
 * Supports proper main function wrapping, go.mod generation,
 * compilation error handling, output capture, and temp directory cleanup.
 */

import { CodeBlock, Language } from '@mam/ast';
import { BaseExecutionContext } from './base.js';
import type { ExecutionResult } from './types.js';

/** Configuration for GoContext behavior. */
export interface GoContextConfig {
  /** Path to go binary. Defaults to 'go'. */
  goPath?: string;
  /** Execution timeout in ms. */
  timeout?: number;
  /** Go module version. Defaults to '1.21'. */
  goVersion?: string;
}

/** Standard library packages that can be auto-imported. */
const AUTO_IMPORTABLE_PACKAGES: Record<string, string> = {
  fmt: '"fmt"',
  strings: '"strings"',
  math: '"math"',
  strconv: '"strconv"',
  errors: '"errors"',
  time: '"time"',
  sort: '"sort"',
  slices: '"slices"',
  maps: '"maps"',
};

export class GoContext extends BaseExecutionContext {
  readonly runtime: Language = 'go';
  private goConfig: GoContextConfig;

  constructor(config: GoContextConfig = {}) {
    super();
    this.goConfig = {
      goPath: config.goPath || 'go',
      timeout: config.timeout || 30000,
      goVersion: config.goVersion || '1.21',
    };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    this.ensureInitialized();
    const startTime = performance.now();
    let tmpDir: string | null = null;

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const { writeFile, rm, mkdtemp } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const execAsync = promisify(exec);
      tmpDir = await mkdtemp(join(tmpdir(), 'mam-go-'));

      const srcFile = join(tmpDir, 'main.go');
      const goModFile = join(tmpDir, 'go.mod');

      const wrappedCode = this.wrapMainFunction(code.value);
      await writeFile(srcFile, wrappedCode);
      await writeFile(goModFile, this.generateGoMod());

      const compileResult = await this.compile(execAsync, srcFile, tmpDir);

      if (compileResult.stderr) {
        const timeMs = performance.now() - startTime;
        await this.cleanupDir(tmpDir);
        this.recordExecution(timeMs);
        return {
          success: false,
          error: compileResult.stderr,
          timeMs,
          stderr: compileResult.stderr,
          exitCode: 1,
        };
      }

      const outFile = join(tmpDir, 'main');
      const runResult = await this.run(execAsync, outFile, tmpDir);

      const timeMs = performance.now() - startTime;
      await this.cleanupDir(tmpDir);
      this.recordExecution(timeMs);

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
      const timeMs = performance.now() - startTime;
      if (tmpDir) await this.cleanupDir(tmpDir);
      this.recordExecution(timeMs);
      return {
        success: false,
        error: (error as Error).message,
        timeMs,
        exitCode: 1,
      };
    }
  }

  validateCode(code: string): boolean {
    if (!code || code.trim().length === 0) return false;
    const disallowed = [
      /\bos\.Exit\b/,
      /\bsyscall\b/,
      /\bexec\.Command\b/,
      /\bos\.Remove\b/,
      /\bos\.RemoveAll\b/,
      /\bios\.ReadFile\b/,
      /\bios\.WriteFile\b/,
      /\bos\.Process\b/,
      /\bunsafe\.Pointer\b/,
      /\breflect\.ValueOf\b/,
    ];
    for (const pattern of disallowed) {
      if (pattern.test(code)) return false;
    }
    return true;
  }

  getSupportedLanguages(): Language[] {
    return ['go'];
  }

  private generateGoMod(): string {
    return `module mam-temp\n\ngo ${this.goConfig.goVersion}\n`;
  }

  private async compile(
    execAsync: (cmd: string, opts: { timeout: number; cwd: string; env: Record<string, string | undefined> }) => Promise<{ stdout: string; stderr: string }>,
    srcFile: string,
    cwd: string
  ): Promise<{ stdout: string; stderr: string }> {
    const { join } = await import('node:path');
    const outFile = join(cwd, 'main');
    return execAsync(
      `${this.goConfig.goPath} build -o ${outFile} ${srcFile}`,
      {
        timeout: this.goConfig.timeout!,
        cwd,
        env: this.buildEnv(cwd),
      }
    ).catch((err) => ({
      stdout: '',
      stderr: err.stderr || err.message,
    }));
  }

  private async run(
    execAsync: (cmd: string, opts: { timeout: number; cwd: string; env: Record<string, string | undefined> }) => Promise<{ stdout: string; stderr: string }>,
    outFile: string,
    cwd: string
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(outFile, {
      timeout: this.goConfig.timeout!,
      cwd,
      env: this.buildEnv(cwd),
    }).catch((err) => ({
      stdout: '',
      stderr: err.stderr || err.message,
    }));
  }

  private buildEnv(cwd: string): Record<string, string | undefined> {
    return {
      ...process.env,
      GOPATH: `${cwd}/go`,
      GOCACHE: `${cwd}/cache`,
      HOME: process.env.HOME,
    };
  }

  private wrapMainFunction(code: string): string {
    const trimmed = code.trim();

    if (trimmed.includes('func main()')) {
      return `package main\n\nimport "fmt"\n\nfunc main() {\n${trimmed}\n}`;
    }

    if (trimmed.startsWith('package ')) {
      return trimmed;
    }

    const imports: string[] = [];
    for (const [pkg, importPath] of Object.entries(AUTO_IMPORTABLE_PACKAGES)) {
      const pattern = new RegExp(`\\b${pkg}\\.`);
      if (pattern.test(trimmed)) {
        imports.push(importPath);
      }
    }

    const importBlock = imports.length > 0
      ? `import (\n${imports.map((i) => `\t${i}`).join('\n')}\n)\n\n`
      : '';

    const hasVarDecl = /\bvar\b/.test(trimmed);
    const hasFuncDecl = /\bfunc\b/.test(trimmed);
    const hasTypeDecl = /\btype\b/.test(trimmed);

    if (hasVarDecl || hasFuncDecl || hasTypeDecl) {
      return `package main\n\n${importBlock}${trimmed}\n\nfunc main() {\n\tfmt.Println("executed")\n}`;
    }

    const lines = trimmed.split('\n').filter((l) => l.trim().length > 0);
    const body = lines.map((l) => `\t${l}`).join('\n');

    return `package main\n\n${importBlock}func main() {\n${body}\n}`;
  }

  private async cleanupDir(dir: string): Promise<void> {
    try {
      const { rm } = await import('node:fs/promises');
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
