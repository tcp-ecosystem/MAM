/**
 * Docker Sandbox
 *
 * Executes code in isolated Docker containers.
 * Requires Docker daemon running on the host.
 */

import { CodeBlock } from '@mam/ast';
import { Sandbox, SandboxConfig } from './index.js';
import { ExecutionResult } from '../contexts/index.js';

export interface DockerSandboxConfig extends SandboxConfig {
  image?: string;
}

const DEFAULT_CONFIG: SandboxConfig & { image: string } = {
  timeout: 30000,
  memoryLimit: 256 * 1024 * 1024,
  networkHosts: [],
  filesystemPaths: ['/tmp'],
  allowedEnvVars: ['PATH', 'HOME'],
  allowProcess: false,
  image: 'node:20-alpine',
};

export class DockerSandbox implements Sandbox {
  private config = DEFAULT_CONFIG;
  private activeContainers: Set<string> = new Set();

  async init(config: SandboxConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      const runtime = this.getRuntimeCommand(code.language);
      if (!runtime) {
        return {
          success: false,
          error: `Unsupported language in Docker sandbox: ${code.language}`,
          timeMs: performance.now() - startTime,
          exitCode: 1,
        };
      }

      const containerName = `mam-sandbox-${Date.now()}`;
      this.activeContainers.add(containerName);

      try {
        const timeoutArg = this.config.timeout ? `--timeout ${this.config.timeout}` : '';
        const memoryArg = this.config.memoryLimit
          ? `--memory ${this.config.memoryLimit}`
          : '';

        const escapedCode = code.value.replace(/"/g, '\\"');
        const cmd = `docker run --rm --name ${containerName} ${memoryArg} ${timeoutArg} ${this.config.image} sh -c "${runtime.cmd} -c \\"${escapedCode}\\""`;

        const { stdout, stderr } = await execAsync(cmd, {
          timeout: this.config.timeout,
        });

        return {
          success: true,
          output: stdout.trim(),
          timeMs: performance.now() - startTime,
          stdout,
          stderr,
          exitCode: 0,
        };
      } finally {
        this.activeContainers.delete(containerName);
      }
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

  checkPermission(permission: string): boolean {
    switch (permission) {
      case 'network':
        return true;
      case 'filesystem':
        return true;
      case 'exec':
        return true;
      default:
        return false;
    }
  }

  async cleanup(): Promise<void> {
    if (this.activeContainers.size === 0) return;

    try {
      const { exec } = await import('node:child_process');
      const { promisify } = await import('node:util');
      const execAsync = promisify(exec);

      for (const name of this.activeContainers) {
        try {
          await execAsync(`docker rm -f ${name}`, { timeout: 5000 });
        } catch {
          // Container may already be gone
        }
      }
    } finally {
      this.activeContainers.clear();
    }
  }

  private getRuntimeCommand(
    language: string
  ): { cmd: string; args: string[] } | null {
    switch (language.toLowerCase()) {
      case 'python':
        return { cmd: 'python3', args: ['-c'] };
      case 'javascript':
      case 'js':
        return { cmd: 'node', args: ['-e'] };
      case 'shell':
      case 'bash':
        return { cmd: 'sh', args: ['-c'] };
      case 'go':
        return null; // Requires compilation
      case 'rust':
        return null; // Requires compilation
      default:
        return null;
    }
  }
}
