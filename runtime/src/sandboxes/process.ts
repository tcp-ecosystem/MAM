/**
 * Process Sandbox
 *
 * Standalone process sandbox extracted from sandboxes/index.ts.
 * Executes code in isolated child processes.
 */

import { CodeBlock } from '@mam/ast';
import { Sandbox, SandboxConfig } from './index.js';
import { ExecutionResult } from '../contexts/index.js';

export interface ProcessSandboxConfig extends SandboxConfig {}

const DEFAULT_CONFIG: SandboxConfig = {
  timeout: 30000,
  memoryLimit: 256 * 1024 * 1024,
  networkHosts: [],
  filesystemPaths: ['/tmp'],
  allowedEnvVars: ['PATH', 'HOME', 'USER'],
  allowProcess: false,
};

export class ProcessSandboxImpl implements Sandbox {
  private config: SandboxConfig = DEFAULT_CONFIG;
  private activeProcesses: Set<number> = new Set();

  async init(config: SandboxConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      const { spawn } = await import('node:child_process');
      const runtime = this.getRuntimeCommand(code.language);

      if (!runtime) {
        return {
          success: false,
          error: `Unsupported language: ${code.language}`,
          timeMs: performance.now() - startTime,
          exitCode: 1,
        };
      }

      return new Promise<ExecutionResult>((resolve) => {
        const proc = spawn(runtime.cmd, runtime.args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: this.config.timeout,
          env: this.getEnvironment(),
        });

        this.activeProcesses.add(proc.pid!);

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on('close', (exitCode) => {
          this.activeProcesses.delete(proc.pid!);
          resolve({
            success: exitCode === 0,
            output: stdout,
            timeMs: performance.now() - startTime,
            stdout,
            stderr,
            exitCode: exitCode ?? 1,
          });
        });

        proc.on('error', (error) => {
          this.activeProcesses.delete(proc.pid!);
          resolve({
            success: false,
            error: error.message,
            timeMs: performance.now() - startTime,
            exitCode: 1,
          });
        });

        proc.stdin.write(code.value);
        proc.stdin.end();
      });
    } catch (error) {
      return {
        success: false,
        error: (error as Error).message,
        timeMs: performance.now() - startTime,
        exitCode: 1,
      };
    }
  }

  checkPermission(permission: string): boolean {
    switch (permission) {
      case 'network':
        return (this.config.networkHosts?.length ?? 0) > 0;
      case 'filesystem':
        return (this.config.filesystemPaths?.length ?? 0) > 0;
      case 'exec':
        return this.config.allowProcess ?? false;
      default:
        return false;
    }
  }

  async cleanup(): Promise<void> {
    for (const pid of this.activeProcesses) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may have already exited
      }
    }
    this.activeProcesses.clear();
  }

  private getRuntimeCommand(language: string): { cmd: string; args: string[] } | null {
    switch (language.toLowerCase()) {
      case 'python':
        return { cmd: 'python3', args: ['-'] };
      case 'javascript':
      case 'js':
        return { cmd: 'node', args: ['-'] };
      case 'shell':
      case 'bash':
        return { cmd: 'bash', args: ['-'] };
      case 'go':
        return { cmd: 'go', args: ['run', '-'] };
      case 'rust':
        return null; // Requires compilation step
      default:
        return null;
    }
  }

  private getEnvironment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    for (const varName of this.config.allowedEnvVars || []) {
      env[varName] = process.env[varName];
    }
    return env;
  }
}
