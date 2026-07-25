/**
 * MAM Runtime Engine
 * 
 * Main runtime that orchestrates execution of MAM modules.
 */

import { MAMModule, CodeBlock, Section } from '@mam/ast';
import { validate, ValidationReport } from '@mam/validator';
import {
  ExecutionContext,
  ExecutionContextConfig,
  ExecutionResult,
  createExecutionContext,
} from './contexts/index.js';
import { Sandbox, SandboxConfig, createSandbox } from './sandboxes/index.js';

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  /** Sandbox type */
  sandboxType?: 'process' | 'vm';
  /** Sandbox configuration */
  sandboxConfig?: SandboxConfig;
  /** Whether to validate before execution */
  validateBeforeExecution?: boolean;
  /** Whether to stop on first error */
  stopOnError?: boolean;
  /** Default timeout in milliseconds */
  defaultTimeout?: number;
  /** Default memory limit */
  defaultMemoryLimit?: number;
}

/**
 * Runtime execution options
 */
export interface RuntimeExecutionOptions {
  /** Specific sections to execute */
  sections?: string[];
  /** Input parameters */
  inputs?: Record<string, unknown>;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Override timeout */
  timeout?: number;
}

/**
 * Module execution result
 */
export interface ModuleExecutionResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Validation report (if validation was run) */
  validation?: ValidationReport;
  /** Results from each section */
  sectionResults: Map<string, ExecutionResult>;
  /** Aggregate output */
  output: Record<string, unknown>;
  /** Total execution time */
  timeMs: number;
  /** Errors encountered */
  errors: string[];
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  sandboxType: 'process',
  validateBeforeExecution: true,
  stopOnError: false,
  defaultTimeout: 30000,
  defaultMemoryLimit: 256 * 1024 * 1024,
};

/**
 * MAM Runtime Engine
 */
export class MAMRuntime {
  private config: RuntimeConfig;
  private sandbox: Sandbox | null = null;
  private contexts: Map<string, ExecutionContext> = new Map();

  constructor(config: RuntimeConfig = DEFAULT_RUNTIME_CONFIG) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...config };
  }

  /**
   * Initialize the runtime
   */
  async init(): Promise<void> {
    this.sandbox = createSandbox(this.config.sandboxType || 'process');
    await this.sandbox.init(this.config.sandboxConfig || {});
  }

  /**
   * Execute a MAM module
   */
  async execute(
    module: MAMModule,
    options: RuntimeExecutionOptions = {}
  ): Promise<ModuleExecutionResult> {
    const startTime = performance.now();
    const sectionResults = new Map<string, ExecutionResult>();
    const errors: string[] = [];
    const output: Record<string, unknown> = {};

    // Validate if required
    let validation: ValidationReport | undefined;
    if (this.config.validateBeforeExecution) {
      validation = validate(module);
      if (!validation.valid) {
        return {
          success: false,
          validation,
          sectionResults,
          output,
          timeMs: performance.now() - startTime,
          errors: validation.errors.map(e => e.message),
        };
      }
    }

    // Filter sections to execute
    const sectionsToExecute = module.sections.filter(section => {
      if (options.sections && options.sections.length > 0) {
        return options.sections.includes(section.name);
      }
      return this.isExecutableSection(section);
    });

    // Execute each section
    for (const section of sectionsToExecute) {
      try {
        const result = await this.executeSection(section, module, options);
        sectionResults.set(section.name, result);

        if (!result.success && this.config.stopOnError) {
          errors.push(`Section "${section.name}" failed: ${result.error}`);
          break;
        }

        // Collect output
        if (result.output !== undefined) {
          output[section.name] = result.output;
        }
      } catch (error) {
        const errorMsg = `Section "${section.name}" error: ${(error as Error).message}`;
        errors.push(errorMsg);
        sectionResults.set(section.name, {
          success: false,
          error: errorMsg,
          timeMs: 0,
          exitCode: 1,
        });

        if (this.config.stopOnError) {
          break;
        }
      }
    }

    return {
      success: errors.length === 0,
      validation,
      sectionResults,
      output,
      timeMs: performance.now() - startTime,
      errors,
    };
  }

  /**
   * Execute a single section
   */
  private async executeSection(
    section: Section,
    module: MAMModule,
    options: RuntimeExecutionOptions
  ): Promise<ExecutionResult> {
    // Find code blocks in the section
    const codeBlocks = section.content.filter(
      (c): c is CodeBlock => c.type === 'CodeBlock'
    );

    if (codeBlocks.length === 0) {
      return {
        success: true,
        output: null,
        timeMs: 0,
      };
    }

    // Execute each code block
    const results: ExecutionResult[] = [];
    
    for (const codeBlock of codeBlocks) {
      const context = this.getExecutionContext(codeBlock.language);
      
      const execConfig: ExecutionContextConfig = {
        module,
        inputs: options.inputs || {},
        permissions: module.frontmatter?.data.permissions || [],
        timeout: options.timeout || this.config.defaultTimeout,
        memoryLimit: this.config.defaultMemoryLimit,
        env: options.env,
      };

      await context.init(execConfig);
      const result = await context.execute(codeBlock);
      results.push(result);

      // Store in memory
      if (result.success && result.output !== undefined) {
        context.setMemory('lastOutput', result.output);
      }
    }

    // Combine results
    const lastResult = results[results.length - 1]!;
    return {
      success: results.every(r => r.success),
      output: lastResult.output,
      timeMs: results.reduce((sum, r) => sum + r.timeMs, 0),
      stdout: results.map(r => r.stdout || '').join('\n'),
      stderr: results.map(r => r.stderr || '').join('\n'),
      exitCode: lastResult.exitCode,
    };
  }

  /**
   * Get or create execution context for a runtime
   */
  private getExecutionContext(runtime: string): ExecutionContext {
    const key = runtime;
    
    if (!this.contexts.has(key)) {
      const context = createExecutionContext(runtime as any);
      this.contexts.set(key, context);
    }
    
    return this.contexts.get(key)!;
  }

  /**
   * Check if a section is executable
   */
  private isExecutableSection(section: Section): boolean {
    const executableSections = ['Python', 'JavaScript', 'TypeScript', 'Tests'];
    return executableSections.includes(section.name);
  }

  /**
   * Get memory from a specific runtime context
   */
  getMemory(runtime: string): Record<string, unknown> {
    const context = this.contexts.get(runtime);
    return context ? context.getMemory() : {};
  }

  /**
   * Set memory in a specific runtime context
   */
  setMemory(runtime: string, key: string, value: unknown): void {
    const context = this.contexts.get(runtime);
    if (context) {
      context.setMemory(key, value);
    }
  }

  /**
   * Cleanup all resources
   */
  async cleanup(): Promise<void> {
    // Cleanup all contexts
    for (const context of this.contexts.values()) {
      await context.cleanup();
    }
    this.contexts.clear();

    // Cleanup sandbox
    if (this.sandbox) {
      await this.sandbox.cleanup();
      this.sandbox = null;
    }
  }
}

/**
 * Convenience function to execute a MAM module
 */
export async function executeModule(
  module: MAMModule,
  config?: RuntimeConfig,
  options?: RuntimeExecutionOptions
): Promise<ModuleExecutionResult> {
  const runtime = new MAMRuntime(config);
  await runtime.init();
  
  try {
    return await runtime.execute(module, options);
  } finally {
    await runtime.cleanup();
  }
}