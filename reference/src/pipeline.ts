import type {
  PipelineStage,
  PipelineContext,
  PipelineResult,
  PipelineOptions,
} from './types.js';

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  stopOnError: true,
  verbose: false,
};

export class Pipeline {
  private stages: PipelineStage[] = [];
  private options: PipelineOptions;

  constructor(stages: PipelineStage[] = [], options: PipelineOptions = {}) {
    this.stages = [...stages];
    this.options = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  }

  use(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  insert(index: number, stage: PipelineStage): this {
    this.stages.splice(Math.max(0, Math.min(index, this.stages.length)), 0, stage);
    return this;
  }

  remove(name: string): boolean {
    const index = this.stages.findIndex((stage) => stage.name === name);
    if (index < 0) return false;
    this.stages.splice(index, 1);
    return true;
  }

  has(name: string): boolean {
    return this.stages.some((stage) => stage.name === name);
  }

  getStageNames(): string[] {
    return this.stages.map((stage) => stage.name);
  }

  getStageCount(): number {
    return this.stages.length;
  }

  getOptions(): PipelineOptions {
    return { ...this.options };
  }

  setOptions(options: PipelineOptions): void {
    this.options = { ...this.options, ...options };
  }

  clone(): Pipeline {
    return new Pipeline([...this.stages], { ...this.options });
  }

  merge(other: Pipeline): Pipeline {
    return new Pipeline([...this.stages, ...other.stages], { ...this.options });
  }

  async run(ctx: PipelineContext): Promise<PipelineResult> {
    return runPipelineStages(this.stages, ctx, this.options);
  }

  async runWithValues(values: Record<string, unknown>, cwd: string): Promise<PipelineResult> {
    return this.run({ cwd, values });
  }

  dryRun(): PipelineResult {
    return {
      success: true,
      stagesRun: [],
      errors: [],
      timeMs: 0,
    };
  }

  getStage(name: string): PipelineStage | undefined {
    return this.stages.find((stage) => stage.name === name);
  }

  first(): PipelineStage | undefined {
    return this.stages[0];
  }

  last(): PipelineStage | undefined {
    return this.stages[this.stages.length - 1];
  }

  prepend(stage: PipelineStage): this {
    this.stages.unshift(stage);
    return this;
  }

  concat(stages: PipelineStage[]): Pipeline {
    return new Pipeline([...this.stages, ...stages], { ...this.options });
  }

  only(names: string[]): Pipeline {
    return new Pipeline(filterStages(this.stages, names), { ...this.options });
  }

  without(names: string[]): Pipeline {
    return new Pipeline(excludeStages(this.stages, names), { ...this.options });
  }

  validate(): string[] {
    return validateStages(this.stages);
  }

  describe(): string {
    if (this.stages.length === 0) return 'empty pipeline';
    return formatStageList(this.stages);
  }

  async runSingle(name: string, ctx: PipelineContext): Promise<PipelineResult> {
    const stage = this.getStage(name);
    if (!stage) {
      return {
        success: false,
        stagesRun: [],
        failedStage: name,
        errors: [`unknown stage "${name}"`],
        timeMs: 0,
      };
    }
    return runPipelineStages([stage], ctx, this.options);
  }
}

export function createPipeline(stages: PipelineStage[] = [], options: PipelineOptions = {}): Pipeline {
  return new Pipeline(stages, options);
}

export async function runPipelineStages(
  stages: PipelineStage[],
  ctx: PipelineContext,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const merged = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  const startedAt = Date.now();
  const stagesRun: string[] = [];
  const errors: string[] = [];
  let failedStage: string | undefined;
  for (const stage of stages) {
    try {
      if (merged.verbose) {
        ctx.values[`__started_${stage.name}`] = Date.now();
      }
      await stage.run(ctx);
      stagesRun.push(stage.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${stage.name}: ${message}`);
      failedStage = stage.name;
      if (merged.stopOnError !== false) {
        break;
      }
    }
  }
  const result: PipelineResult = {
    success: errors.length === 0,
    stagesRun,
    errors,
    timeMs: Date.now() - startedAt,
  };
  if (failedStage !== undefined) {
    result.failedStage = failedStage;
  }
  return result;
}

export function getPipelineStageNames(pipeline: Pipeline): string[] {
  return pipeline.getStageNames();
}

export function isPipelineSuccess(result: PipelineResult): boolean {
  return result.success;
}

export function summarizePipelineResult(result: PipelineResult): string {
  const status = result.success ? 'PIPELINE SUCCEEDED' : 'PIPELINE FAILED';
  const parts = [`${status}: ${result.stagesRun.length} stages in ${result.timeMs}ms`];
  if (result.failedStage) {
    parts.push(`failed at "${result.failedStage}"`);
  }
  for (const error of result.errors) {
    parts.push(`  - ${error}`);
  }
  return parts.join('\n');
}

function createStageContext(cwd: string, values: Record<string, unknown> = {}): PipelineContext {
  return { cwd, values: { ...values } };
}

function cloneStageContext(ctx: PipelineContext): PipelineContext {
  const clone: PipelineContext = { cwd: ctx.cwd, values: { ...ctx.values } };
  if (ctx.config !== undefined) {
    clone.config = ctx.config;
  }
  return clone;
}

function mergeStageValues(base: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...extra };
}

function validateStages(stages: PipelineStage[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const stage of stages) {
    if (!stage.name) {
      errors.push('stage name is required');
    } else if (seen.has(stage.name)) {
      errors.push(`duplicate stage "${stage.name}"`);
    } else {
      seen.add(stage.name);
    }
    if (typeof stage.run !== 'function') {
      errors.push(`stage "${stage.name}" has no run function`);
    }
  }
  return errors;
}

function filterStages(stages: PipelineStage[], names: string[]): PipelineStage[] {
  const wanted = new Set(names);
  return stages.filter((stage) => wanted.has(stage.name));
}

function excludeStages(stages: PipelineStage[], names: string[]): PipelineStage[] {
  const excluded = new Set(names);
  return stages.filter((stage) => !excluded.has(stage.name));
}

function mapStageNames(stages: PipelineStage[]): string[] {
  return stages.map((stage) => stage.name);
}

function countCompletedStages(result: PipelineResult): number {
  return result.stagesRun.length;
}

function getFailedStageName(result: PipelineResult): string | undefined {
  return result.failedStage;
}

function formatStageList(stages: PipelineStage[]): string {
  return stages.map((stage) => stage.name).join(' -> ');
}

function buildSkippedResult(stageCount: number): PipelineResult {
  return {
    success: true,
    stagesRun: [],
    errors: [],
    timeMs: 0,
  };
}

function isStageErrorRecoverable(error: unknown): boolean {
  return error instanceof Error && !/fatal/i.test(error.message);
}

function formatStageError(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${stage}: ${message}`;
}

function buildFailureResult(failedStage: string, error: unknown, stagesRun: string[], startedAt: number): PipelineResult {
  return {
    success: false,
    stagesRun,
    failedStage,
    errors: [formatStageError(failedStage, error)],
    timeMs: Date.now() - startedAt,
  };
}

function buildSuccessResult(stagesRun: string[], startedAt: number): PipelineResult {
  return {
    success: true,
    stagesRun,
    errors: [],
    timeMs: Date.now() - startedAt,
  };
}

function recordStageStart(values: Record<string, unknown>, name: string): void {
  values[`__started_${name}`] = Date.now();
}

function recordStageEnd(values: Record<string, unknown>, name: string): void {
  values[`__finished_${name}`] = Date.now();
}

function getStageElapsedMs(values: Record<string, unknown>, name: string): number | undefined {
  const started = values[`__started_${name}`];
  const finished = values[`__finished_${name}`];
  if (typeof started !== 'number' || typeof finished !== 'number') return undefined;
  return Math.max(0, finished - started);
}
