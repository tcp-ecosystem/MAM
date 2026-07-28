/**
 * MAM Module Executor
 *
 * Convenience executor that wires together the runtime engine
 * for standalone use outside the MAMRuntime class.
 */

import { MAMModule, CodeBlock } from '@mam/ast';
import { validate } from '@mam/validator';
import {
  ExecutionContext,
  ExecutionContextConfig,
  ExecutionResult,
  createExecutionContext,
} from './contexts/index.js';
import { Sandbox, SandboxConfig, createSandbox } from './sandboxes/index.js';

export interface ExecutorConfig {
  sandboxType?: 'process' | 'vm';
  sandboxConfig?: SandboxConfig;
  validateBeforeExecution?: boolean;
  defaultTimeout?: number;
  defaultMemoryLimit?: number;
}

export interface ExecutorResult {
  success: boolean;
  output: Record<string, unknown>;
  errors: string[];
  timeMs: number;
}

const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  sandboxType: 'process',
  validateBeforeExecution: true,
  defaultTimeout: 30000,
  defaultMemoryLimit: 256 * 1024 * 1024,
};

export class ModuleExecutor {
  private config: ExecutorConfig;
  private sandbox: Sandbox | null = null;
  private contexts: Map<string, ExecutionContext> = new Map();

  constructor(config: ExecutorConfig = DEFAULT_EXECUTOR_CONFIG) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  async init(): Promise<void> {
    this.sandbox = createSandbox(this.config.sandboxType || 'process');
    await this.sandbox.init(this.config.sandboxConfig || {});
  }

  async execute(
    module: MAMModule,
    options: { sections?: string[]; inputs?: Record<string, unknown>; timeout?: number } = {}
  ): Promise<ExecutorResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    const output: Record<string, unknown> = {};

    if (this.config.validateBeforeExecution) {
      const validation = validate(module);
      if (!validation.valid) {
        return {
          success: false,
          output,
          errors: validation.errors.map((e) => e.message),
          timeMs: performance.now() - startTime,
        };
      }
    }

    const sectionsToExecute = module.sections.filter((section) => {
      if (options.sections && options.sections.length > 0) {
        return options.sections.includes(section.name);
      }
      return ['Python', 'JavaScript', 'TypeScript', 'Tests'].includes(section.name);
    });

    for (const section of sectionsToExecute) {
      const codeBlocks = section.content.filter(
        (c): c is CodeBlock => c.type === 'CodeBlock'
      );

      for (const codeBlock of codeBlocks) {
        try {
          const context = await this.getExecutionContext(codeBlock.language);
          const execConfig: ExecutionContextConfig = {
            module,
            inputs: options.inputs || {},
            permissions: module.frontmatter?.data.permissions || [],
            timeout: options.timeout || this.config.defaultTimeout,
            memoryLimit: this.config.defaultMemoryLimit,
          };

          await context.init(execConfig);
          const result = await context.execute(codeBlock);

          if (result.success && result.output !== undefined) {
            context.setMemory('lastOutput', result.output);
            output[`${section.name}:${codeBlock.language}`] = result.output;
          }

          if (!result.success && result.error) {
            errors.push(`[${section.name}] ${result.error}`);
          }
        } catch (error) {
          errors.push(`[${section.name}] ${(error as Error).message}`);
        }
      }
    }

    return {
      success: errors.length === 0,
      output,
      errors,
      timeMs: performance.now() - startTime,
    };
  }

  async cleanup(): Promise<void> {
    for (const context of this.contexts.values()) {
      await context.cleanup();
    }
    this.contexts.clear();

    if (this.sandbox) {
      await this.sandbox.cleanup();
      this.sandbox = null;
    }
  }

  private async getExecutionContext(runtime: string): Promise<ExecutionContext> {
    if (!this.contexts.has(runtime)) {
      const context = await createExecutionContext(runtime as any);
      this.contexts.set(runtime, context);
    }
    return this.contexts.get(runtime)!;
  }
}
