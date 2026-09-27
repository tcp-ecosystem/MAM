import { describe, it, expect } from 'vitest';
import {
  Pipeline,
  createPipeline,
  runPipelineStages,
  getPipelineStageNames,
  isPipelineSuccess,
  summarizePipelineResult,
  DEFAULT_PIPELINE_OPTIONS,
} from '../src/pipeline.js';
import type { PipelineContext } from '../src/types.js';

function makeCtx(): PipelineContext {
  return { cwd: '/tmp', values: {} };
}

describe('runPipelineStages', () => {
  it('should run stages in order sharing context', async () => {
    const order: string[] = [];
    const result = await runPipelineStages(
      [
        { name: 'a', run: async (ctx) => { order.push('a'); ctx.values.a = 1; } },
        { name: 'b', run: async (ctx) => { order.push('b'); ctx.values.b = ctx.values.a; } },
      ],
      makeCtx(),
    );
    expect(result.success).toBe(true);
    expect(order).toEqual(['a', 'b']);
    expect(result.stagesRun).toEqual(['a', 'b']);
    expect(result.timeMs).toBeGreaterThanOrEqual(0);
  });

  it('should stop on first error by default', async () => {
    const result = await runPipelineStages(
      [
        { name: 'bad', run: async () => { throw new Error('nope'); } },
        { name: 'next', run: async () => {} },
      ],
      makeCtx(),
    );
    expect(result.success).toBe(false);
    expect(result.failedStage).toBe('bad');
    expect(result.stagesRun).toEqual([]);
    expect(result.errors[0]).toContain('nope');
  });

  it('should continue when stopOnError is false', async () => {
    const result = await runPipelineStages(
      [
        { name: 'bad', run: async () => { throw new Error('nope'); } },
        { name: 'next', run: async () => {} },
      ],
      makeCtx(),
      { stopOnError: false },
    );
    expect(result.success).toBe(false);
    expect(result.stagesRun).toEqual(['next']);
  });

  it('should handle empty stage lists', async () => {
    const result = await runPipelineStages([], makeCtx());
    expect(result.success).toBe(true);
    expect(DEFAULT_PIPELINE_OPTIONS.stopOnError).toBe(true);
  });
});

describe('Pipeline class', () => {
  it('should manage stages fluently', () => {
    const pipeline = createPipeline()
      .use({ name: 'a', run: async () => {} })
      .use({ name: 'b', run: async () => {} });
    expect(pipeline.getStageNames()).toEqual(['a', 'b']);
    expect(pipeline.getStageCount()).toBe(2);
    expect(pipeline.has('a')).toBe(true);
    expect(pipeline.first()?.name).toBe('a');
    expect(pipeline.last()?.name).toBe('b');
  });

  it('should insert, remove, and filter stages', () => {
    const pipeline = createPipeline([
      { name: 'a', run: async () => {} },
      { name: 'c', run: async () => {} },
    ]);
    pipeline.insert(1, { name: 'b', run: async () => {} });
    expect(pipeline.getStageNames()).toEqual(['a', 'b', 'c']);
    expect(pipeline.remove('b')).toBe(true);
    expect(pipeline.remove('missing')).toBe(false);
    expect(pipeline.only(['a']).getStageNames()).toEqual(['a']);
    expect(pipeline.without(['a']).getStageNames()).toEqual(['c']);
    expect(pipeline.validate()).toEqual([]);
  });

  it('should run, clone, merge, and describe', async () => {
    const pipeline = createPipeline([{ name: 'a', run: async (ctx) => { ctx.values.done = true; } }]);
    const ctx = makeCtx();
    const result = await pipeline.run(ctx);
    expect(result.success).toBe(true);
    expect(ctx.values.done).toBe(true);
    expect(pipeline.clone().getStageNames()).toEqual(['a']);
    expect(pipeline.merge(createPipeline()).getStageNames()).toEqual(['a']);
    expect(pipeline.describe()).toContain('a');
    expect(new Pipeline().describe()).toBe('empty pipeline');
  });

  it('should run single stages and values', async () => {
    const pipeline = createPipeline([{ name: 'a', run: async () => {} }]);
    const single = await pipeline.runSingle('a', makeCtx());
    expect(single.success).toBe(true);
    const missing = await pipeline.runSingle('nope', makeCtx());
    expect(missing.success).toBe(false);
    const viaValues = await pipeline.runWithValues({}, '/tmp');
    expect(viaValues.success).toBe(true);
  });

  it('should manage options', () => {
    const pipeline = createPipeline();
    pipeline.setOptions({ verbose: true });
    expect(pipeline.getOptions().verbose).toBe(true);
  });
});

describe('pipeline helpers', () => {
  it('should expose names, status, and summaries', async () => {
    const pipeline = createPipeline([{ name: 'a', run: async () => {} }]);
    expect(getPipelineStageNames(pipeline)).toEqual(['a']);
    const ok = await pipeline.run(makeCtx());
    expect(isPipelineSuccess(ok)).toBe(true);
    expect(summarizePipelineResult(ok)).toContain('SUCCEEDED');
    const bad = await runPipelineStages(
      [{ name: 'x', run: async () => { throw new Error('bad'); } }],
      makeCtx(),
    );
    expect(summarizePipelineResult(bad)).toContain('FAILED');
    expect(summarizePipelineResult(bad)).toContain('"x"');
  });
});
