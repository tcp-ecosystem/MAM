/**
 * CLI Run Command Tests — target runtime routing and LIR composition.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTargetRuntime, executeRun } from '../../src/commands/run.js';

const scratch: string[] = [];

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mam-run-lir-'));
  scratch.push(root);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(root, name), content, 'utf8');
  }
  return root;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function moduleSource(implementations: string): string {
  const lines = [
    '---',
    '# MAM Metadata',
    'id: run-lir-test',
    'name: Run LIR Test',
    'version: 1.0.0',
    'type: system',
    '',
    'author: MAM Tests',
    '',
    'description: Temporary run fixture.',
    '',
    'runtime: python',
    '',
  ];
  if (implementations) {
    lines.push('implementations:', implementations, '');
  }
  lines.push(
    '---',
    '',
    '# Run LIR Test',
    '',
    'Temporary fixture for run integration.',
    '',
    '## Purpose',
    '',
    'Exercise native execution with host implementations.',
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
    '| label | string | Yes | Label |',
    '',
    '## Rules',
    '',
    '- Return JSON.',
    '',
  );
  return lines.join('\n');
}

describe('Run Command — target runtime detection', () => {
  it('detects python target artifacts', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.py')).toBe('python');
  });

  it('detects javascript target artifacts', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.js')).toBe('javascript');
    expect(detectTargetRuntime('/tmp/hello.mam.mjs')).toBe('javascript');
    expect(detectTargetRuntime('/tmp/hello.mam.cjs')).toBe('javascript');
  });

  it('detects typescript, shell, go, rust targets', () => {
    expect(detectTargetRuntime('/tmp/hello.mam.ts')).toBe('typescript');
    expect(detectTargetRuntime('/tmp/hello.mam.sh')).toBe('shell');
    expect(detectTargetRuntime('/tmp/hello.mam.go')).toBe('go');
    expect(detectTargetRuntime('/tmp/hello.mam.rs')).toBe('rust');
  });

  it('treats .mam and .mam.md as native (no target runtime)', () => {
    expect(detectTargetRuntime('/tmp/hello.mam')).toBeNull();
    expect(detectTargetRuntime('/tmp/hello.mam.md')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(detectTargetRuntime('/tmp/HELLO.MAM.PY')).toBe('python');
  });
});

describe('Run Command — LIR composition', () => {
  it('composes Python and JavaScript implementations in declaration order', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "run-lir-test"\n',
      'system.mam': moduleSource([
        '  - id: normalize',
        '    language: python',
        '    entry: normalize.py',
        '    export: normalize',
        '  - id: label',
        '    language: javascript',
        '    entry: label.mjs',
        '    export: default',
        '    inputFrom: normalize',
      ].join('\n')),
      'normalize.py': [
        'def normalize(payload):',
        '    return {"name": payload["name"].strip().lower()}',
        '',
      ].join('\n'),
      'label.mjs': [
        'export default function label(payload) {',
        '  return { label: payload.upstream.name.toUpperCase() };',
        '}',
        '',
      ].join('\n'),
    });

    const result = await executeRun({
      file: join(root, 'system.mam'),
      inputs: JSON.stringify({ name: '  Ada  ' }),
      quiet: true,
    });

    expect(result.success).toBe(true);
    const lir = (result.output as any).lir;
    expect(lir.ok).toBe(true);
    expect(lir.implementations.map((item: any) => item.id)).toEqual(['normalize', 'label']);
    expect(lir.implementations[0].value).toEqual({ name: 'ada' });
    expect(lir.implementations[1].value).toEqual({ label: 'ADA' });
    expect(lir.implementations[1].inputFrom).toBe('normalize');
  });

  it('runs a .mam.md twin with the same LIR declarations', async () => {
    const source = moduleSource([
      '  - id: normalize',
      '    language: python',
      '    entry: normalize.py',
      '    export: normalize',
    ].join('\n'));
    const root = await fixture({
      'mam.toml': '[project]\nname = "run-lir-test"\n',
      'system.mam': source,
      'system.mam.md': source,
      'normalize.py': [
        'def normalize(payload):',
        '    return {"name": payload["name"].strip().lower()}',
        '',
      ].join('\n'),
    });

    const result = await executeRun({
      file: join(root, 'system.mam.md'),
      inputs: JSON.stringify({ name: '  Ada  ' }),
      quiet: true,
    });

    expect(result.success).toBe(true);
    const lir = (result.output as any).lir;
    expect(lir.ok).toBe(true);
    expect(lir.implementations[0].value).toEqual({ name: 'ada' });
  });

  it('keeps pure native modules runtime-free', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "run-native-test"\n',
      'system.mam': moduleSource(''),
    });

    const result = await executeRun({
      file: join(root, 'system.mam'),
      inputs: '{}',
      quiet: true,
    });

    expect(result.success).toBe(true);
    expect((result.output as any).lir).toBeUndefined();
    expect(result.metadata.lir).toBe('none');
  });

  it('fails the run when a declared implementation is missing', async () => {
    const root = await fixture({
      'mam.toml': '[project]\nname = "run-lir-test"\n',
      'system.mam': moduleSource([
        '  - id: missing',
        '    language: python',
        '    entry: missing.py',
        '    export: main',
      ].join('\n')),
    });

    const result = await executeRun({
      file: join(root, 'system.mam'),
      inputs: '{}',
      quiet: true,
    });

    expect(result.success).toBe(false);
    const lir = (result.output as any).lir;
    expect(lir.ok).toBe(false);
    expect(lir.implementations[0].error.code).toBe('LIR_ENTRY_MISSING');
    expect(result.errors.join('\n')).toContain('LIR[missing]');
  });
});
