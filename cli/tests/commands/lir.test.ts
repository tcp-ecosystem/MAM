/**
 * CLI LIR command tests.
 *
 * These exercise the real command surface against temporary Python fixtures:
 * declaration listing, direct invocation, JSON-only output, and exit codes.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lirCommand } from '../../src/commands/lir.js';

const scratch: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-lir-cli-'));
  scratch.push(root);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content, 'utf8');
  }
  return root;
}

function systemModule(implementations: string): string {
  return [
    '---',
    '# MAM Metadata',
    'id: lir-cli-test',
    'name: LIR CLI Test',
    'version: 1.0.0',
    'type: system',
    '',
    'author: MAM Tests',
    '',
    'description: Temporary LIR command fixture.',
    '',
    'runtime: python',
    '',
    'implementations:',
    implementations,
    '---',
    '',
    '# LIR CLI Test',
    '',
    'Temporary fixture for the LIR command tests.',
    '',
    '## Purpose',
    '',
    'Exercise the LIR command surface.',
    '',
    '## Inputs',
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    '| name | string | Yes | Name |',
    '',
    '## Outputs',
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    '| name | string | Yes | Name |',
    '',
    '## Rules',
    '',
    '- Return JSON.',
    '',
  ].join('\n');
}

const NORMALIZE = [
  'def normalize(payload):',
  '    return {"name": payload["name"].strip().lower()}',
  '',
].join('\n');

async function capture(run: () => Promise<void>): Promise<{ json: any; stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(' '));
  });
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(' '));
  });

  try {
    await run();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }

  const text = stdout.join('\n');
  return {
    json: text ? JSON.parse(text) : undefined,
    stdout: text,
    stderr: stderr.join('\n'),
  };
}

afterEach(async () => {
  process.exitCode = 0;
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('mam lir', () => {
  it('lists declarations with resolved project-relative entries', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "lir-cli-test"\n',
      'system.mam': systemModule([
        '  - id: normalize',
        '    language: python',
        '    entry: normalize.py',
        '    export: normalize',
      ].join('\n')),
      'normalize.py': NORMALIZE,
    });

    const { json } = await capture(() => lirCommand({
      action: 'list',
      file: join(root, 'system.mam'),
      format: 'json',
    }));

    expect(json.success).toBe(true);
    expect(json.projectRoot).toBe(root);
    expect(json.implementations).toHaveLength(1);
    expect(json.implementations[0]).toMatchObject({
      id: 'normalize',
      language: 'python',
      export: 'normalize',
      runtimeAvailable: true,
    });
    expect(json.implementations[0].entry).toBe(join(root, 'normalize.py'));
  });

  it('invokes a Python implementation and writes only JSON to stdout', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "lir-cli-test"\n',
      'system.mam': systemModule([
        '  - id: normalize',
        '    language: python',
        '    entry: normalize.py',
        '    export: normalize',
      ].join('\n')),
      'normalize.py': NORMALIZE,
    });

    const { json, stdout } = await capture(() => lirCommand({
      action: 'invoke',
      file: join(root, 'system.mam'),
      id: 'normalize',
      input: '{"name":"  Ada  "}',
      format: 'json',
    }));

    expect(json.ok).toBe(true);
    expect(json.value).toEqual({ name: 'ada' });
    expect(stdout.trimStart().startsWith('{')).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it('reports missing entries and sets a failing exit code', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "lir-cli-test"\n',
      'system.mam': systemModule([
        '  - id: missing',
        '    language: python',
        '    entry: missing.py',
        '    export: main',
      ].join('\n')),
    });

    const { json } = await capture(() => lirCommand({
      action: 'invoke',
      file: join(root, 'system.mam'),
      id: 'missing',
      format: 'json',
    }));

    expect(json.ok).toBe(false);
    expect(json.error.code).toBe('LIR_ENTRY_MISSING');
    expect(process.exitCode).toBe(1);
  });

  it('reports an unknown implementation id as JSON', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "lir-cli-test"\n',
      'system.mam': systemModule([
        '  - id: normalize',
        '    language: python',
        '    entry: normalize.py',
        '    export: normalize',
      ].join('\n')),
      'normalize.py': NORMALIZE,
    });

    const { json } = await capture(() => lirCommand({
      action: 'invoke',
      file: join(root, 'system.mam'),
      id: 'absent',
      format: 'json',
    }));

    expect(json.success).toBe(false);
    expect(json.error).toContain('not declared');
    expect(process.exitCode).toBe(1);
  });
});
