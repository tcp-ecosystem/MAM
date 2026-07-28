/**
 * VM Sandbox
 *
 * Standalone VM sandbox extracted from sandboxes/index.ts.
 * Executes JavaScript code in isolated V8 VM contexts.
 */

import { CodeBlock } from '@mam/ast';
import { Sandbox, SandboxConfig } from './index.js';
import { ExecutionResult } from '../contexts/index.js';

export interface VMSandboxConfig extends SandboxConfig {}

const DEFAULT_CONFIG: SandboxConfig = {
  timeout: 30000,
  memoryLimit: 256 * 1024 * 1024,
  networkHosts: [],
  filesystemPaths: ['/tmp'],
  allowedEnvVars: ['PATH', 'HOME', 'USER'],
  allowProcess: false,
};

export class VMSandboxImpl implements Sandbox {
  private config: SandboxConfig = DEFAULT_CONFIG;

  async init(config: SandboxConfig): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(code: CodeBlock): Promise<ExecutionResult> {
    const startTime = performance.now();

    try {
      const vm = await import('node:vm');

      const context = vm.createContext({
        console: {
          log: (...args: unknown[]) => {},
          error: (...args: unknown[]) => {},
          warn: (...args: unknown[]) => {},
        },
        process: undefined,
        setTimeout: ((fn: () => void, ms: number) => {
          if (ms > (this.config.timeout || 30000)) {
            throw new Error('Timeout exceeds limit');
          }
          return global.setTimeout(fn, ms);
        }) as unknown as typeof globalThis.setTimeout,
        clearTimeout: global.clearTimeout,
      });

      const script = new vm.Script(code.value, {
        filename: `mam-vm-${Date.now()}.js`,
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
    return false;
  }

  async cleanup(): Promise<void> {
    // Nothing to clean up
  }
}
