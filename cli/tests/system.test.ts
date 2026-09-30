/**
 * CLI System / Optimize Command Tests — direct wiring of MAM engine packages.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { systemCommand, collectEngines } from '../src/commands/system.js';
import { optimizeCommand, buildSections } from '../src/commands/optimize.js';

function captureLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  });
  return { logs, restore: () => spy.mockRestore() };
}

describe('System Command — wired MAM engines', () => {
  afterEach(() => vi.restoreAllMocks());

  it('instantiates every module main engine directly', () => {
    const rows = collectEngines();
    const names = rows.map(([name]) => name);
    expect(names).toEqual(
      expect.arrayContaining([
        'workingMemory',
        'knowledgeSource',
        'tracer',
        'metrics',
        'evaluator',
        'authenticator',
        'authorizer',
        'policy',
        'toolDiscovery',
        'mcpServer',
        'cacheManager',
        'promptOptimizer',
        'queryAnalyzer',
        'graphEngine',
        'consolidator',
      ]),
    );
    for (const [, module, engine] of rows) {
      expect(engine).toBeTruthy();
      expect(module).toMatch(/^@mam\//);
    }
  });

  it('prints the engine table with name -> present (module)', async () => {
    const { logs, restore } = captureLogs();
    try {
      await systemCommand();
    } finally {
      restore();
    }
    const out = logs.join('\n');
    expect(out).toContain('workingMemory');
    expect(out).toContain('@mam/memory-engine');
    expect(out).toContain('mcpServer');
    expect(out).toContain('@mam/mcp');
    expect(out).toContain('promptOptimizer');
    expect(out).toContain('@mam/token-optimization');
    expect(out).toMatch(/present/);
  });
});

describe('Optimize Command — token savings report', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports originalTokens / optimizedTokens / savedPercent for a sample file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-opt-'));
    const file = join(dir, 'prompt.md');
    try {
      await writeFile(
        file,
        [
          '# Prompt',
          '',
          '## Purpose',
          '',
          'The purpose of this system is to actually and really and essentially manage and simplify and basically streamline the token consumption of prompts across the entire organization. We just really want to just basically reduce the number of tokens that are just simply being used by the models, just essentially for no real reason at all really. It is actually quite important to just carefully and simply consider every single token that is just being passed into the system, and to really just optimize and streamline the representation of the content, just to keep the costs down.',
          '',
          '## Outputs',
          '',
          'Return just the summary of the just optimization, just the summary.',
          '',
        ].join('\n'),
        'utf-8',
      );

      const { logs, restore } = captureLogs();
      try {
        await optimizeCommand({ file });
      } finally {
        restore();
      }

      const out = logs.join('\n');
      expect(out).toContain('originalTokens:');
      expect(out).toContain('optimizedTokens:');
      expect(out).toContain('savedPercent:');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('builds prompt sections from markdown headings', () => {
    const sections = buildSections('## Purpose\n\nDo the thing.\n\n## Outputs\n\nReturn it.');
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) {
      expect(typeof s.role).toBe('string');
      expect(typeof s.content).toBe('string');
    }
  });
});