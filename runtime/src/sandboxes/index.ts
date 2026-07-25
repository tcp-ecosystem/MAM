/**
 * MAM Sandboxes
 * 
 * Provides isolated execution environments for MAM code blocks.
 */

import { CodeBlock } from '@mam/ast';
import { ExecutionResult } from '../contexts/index.js';

/**
 * Sandbox configuration
 */
export interface SandboxConfig {
  /** Maximum execution time in milliseconds */
  timeout?: number;
  /** Maximum memory in bytes */
  memoryLimit?: number;
  /** Allowed network hosts */
  networkHosts?: string[];
  /** Allowed filesystem paths */
  filesystemPaths?: string[];
  /** Environment variables to expose */
  allowedEnvVars?: string[];
  /** Whether to allow process spawning */
  allowProcess?: boolean;
}

/**
 * Sandbox interface
 */
export interface Sandbox {
  /** Initialize the sandbox */
  init(config: SandboxConfig): Promise<void>;
  
  /** Execute code in the sandbox */
  execute(code: CodeBlock): Promise<ExecutionResult>;
  
  /** Check if a permission is allowed */
  checkPermission(permission: string): boolean;
  
  /** Cleanup resources */
  cleanup(): Promise<void>;
}

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  timeout: 30000,
  memoryLimit: 256 * 1024 * 1024, // 256MB
  networkHosts: [],
  filesystemPaths: ['/tmp'],
  allowedEnvVars: ['PATH', 'HOME', 'USER'],
  allowProcess: false,
};

/**
 * Process-based sandbox
 */
export class ProcessSandbox implements Sandbox {
  private config: SandboxConfig = DEFAULT_SANDBOX_CONFIG;
  private activeProcesses: Set<number> = new Set();

  async init(config: SandboxConfig): Promise<void> {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    const startTime = performance.now();
    
    try {
      // Create a child process for isolation
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

      const result = await new Promise<ExecutionResult>((resolve) => {
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

        // Write code to stdin
        proc.stdin.write(code.value);
        proc.stdin.end();
      });

      return result;
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
    // Kill any active processes
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
      default:
        return null;
    }
  }

  private getEnvironment(): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    
    // Only expose allowed environment variables
    for (const varName of this.config.allowedEnvVars || []) {
      env[varName] = process.env[varName];
    }
    
    return env;
  }
}

/**
 * VM-based sandbox (using Node.js vm module)
 */
export class VMSandbox implements Sandbox {
  private config: SandboxConfig = DEFAULT_SANDBOX_CONFIG;

  async init(config: SandboxConfig): Promise<void> {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    const startTime = performance.now();
    
    try {
      const vm = await import('node:vm');
      
      // Create isolated context
      const context = vm.createContext({
        // Limited console
        console: {
          log: (...args: unknown[]) => {},
          error: (...args: unknown[]) => {},
          warn: (...args: unknown[]) => {},
        },
        // No process access
        process: undefined,
        // Limited setTimeout
        setTimeout: (fn: Function, ms: number) => {
          if (ms > (this.config.timeout || 30000)) {
            throw new Error('Timeout exceeds limit');
          }
          return global.setTimeout(fn, ms);
        },
        clearTimeout: global.clearTimeout,
      });

      const script = new vm.Script(code.value, {
        filename: `mam-${code.language}-${Date.now()}.js`,
      });

      const result = script.runInContext(context, {
        timeout: this.config.timeout || 30000,
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

  checkPermission(permission: string): boolean {
    // VM sandbox has very limited permissions
    return false;
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }
}

/**
 * Create sandbox for configuration
 */
export function createSandbox(type: 'process' | 'vm' = 'process'): Sandbox {
  switch (type) {
    case 'process':
      return new ProcessSandbox();
    case 'vm':
      return new VMSandbox();
    default:
      throw new Error(`Unknown sandbox type: ${type}`);
  }
}