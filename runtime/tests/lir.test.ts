/**
 * LIR contract, adapter, and policy tests.
 *
 * Fixtures are ordinary source files created in a temporary directory. No
 * network access and no dependency installation are involved.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LirRegistry,
  NodeLirAdapter,
  PythonLirAdapter,
  createDefaultLirRegistry,
  parseImplementationDeclarations,
  resolveImplementation,
  type ImplementationDeclaration,
} from '../src/lir/index.js';

const PYTHON_FILES: Record<string, string> = {
  'normalize.py': [
    'def normalize(payload):',
    '    print("python-stdout")',
    '    name = payload["name"].strip().lower()',
    '    return {"name": name, "count": len(name)}',
    '',
  ].join('\n'),
  'explode.py': [
    'def explode(payload):',
    '    raise ValueError("bad input: " + str(payload.get("value")))',
    '',
  ].join('\n'),
  'slow.py': [
    'import time',
    '',
    'def slow(payload):',
    '    time.sleep(2)',
    '    return {"done": True}',
    '',
  ].join('\n'),
  'noise.py': [
    'import sys',
    '',
    'def noisy(payload):',
    '    print("x" * 2000)',
    '    print("warning", file=sys.stderr)',
    '    return {"ok": True}',
    '',
  ].join('\n'),
  'bad_result.py': [
    'def bad(payload):',
    '    return {1, 2, 3}',
    '',
  ].join('\n'),
  'crash.py': [
    'import os',
    '',
    'def crash(payload):',
    '    os._exit(3)',
    '',
  ].join('\n'),
  'score.ts': [
    'interface Payload {',
    '  name: string;',
    '}',
    '',
    'export function score(payload: Payload): { score: number; label: string } {',
    '  const label: string = `${payload.name}!`;',
    '  return { score: payload.name.length, label };',
    '}',
    '',
  ].join('\n'),
  'pipeline.mjs': [
    'export default async function runPipeline(payload) {',
    '  return { upstream: payload.upstream, step: "ts" };',
    '}',
    '',
  ].join('\n'),
};

function declaration(
  overrides: Partial<ImplementationDeclaration> = {},
): ImplementationDeclaration {
  return {
    id: 'normalize',
    language: 'python',
    entry: 'normalize.py',
    export: 'normalize',
    ...overrides,
  };
}

describe('parseImplementationDeclarations', () => {
  it('parses a valid declaration list and applies language defaults', () => {
    const parsed = parseImplementationDeclarations([
      { id: 'normalize', language: 'py', entry: 'normalize.py' },
      {
        id: 'score',
        language: 'ts',
        entry: 'score.ts',
        inputFrom: 'normalize',
        timeoutMs: 1500,
        permissions: ['process:spawn'],
        env: ['NODE_ENV'],
      },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      id: 'normalize',
      language: 'python',
      export: 'main',
    });
    expect(parsed[1]).toMatchObject({
      language: 'typescript',
      export: 'default',
      inputFrom: 'normalize',
      timeoutMs: 1500,
      permissions: ['process:spawn'],
      env: ['NODE_ENV'],
    });
  });

  it('returns an empty list when no declarations are present', () => {
    expect(parseImplementationDeclarations(undefined)).toEqual([]);
    expect(parseImplementationDeclarations(null)).toEqual([]);
  });

  it('rejects malformed declarations with actionable errors', () => {
    expect(() => parseImplementationDeclarations({ id: 'x' })).toThrow(/must be an array/);
    expect(() => parseImplementationDeclarations([
      { id: 'x', language: 'ruby', entry: 'x.rb' },
    ])).toThrow(/not supported/);
    expect(() => parseImplementationDeclarations([
      { id: 'x', language: 'python', entry: '/etc/passwd' },
    ])).toThrow(/must be project-relative/);
    expect(() => parseImplementationDeclarations([
      { id: 'x', language: 'python', entry: 'x.py' },
      { id: 'x', language: 'python', entry: 'y.py' },
    ])).toThrow(/more than once/);
    expect(() => parseImplementationDeclarations([
      { id: 'x', language: 'python', entry: 'x.py', extra: true },
    ])).toThrow(/unknown field/);
    expect(() => parseImplementationDeclarations([
      { id: 'x', language: 'python', entry: 'x.py', inputFrom: 'later' },
      { id: 'later', language: 'python', entry: 'y.py' },
    ])).toThrow(/earlier implementation/);
  });

  it('rejects entries that escape the project root', () => {
    expect(() => resolveImplementation(
      declaration({ entry: '../outside.py' }),
      { projectRoot: join(tmpdir(), 'mam-lir-project') },
    )).toThrow(/escapes the project root/);
  });
});

describe('LIR invocation', () => {
  let root: string;
  let pythonAvailable = false;
  let typescriptAvailable = false;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'mam-lir-test-'));
    for (const [name, content] of Object.entries(PYTHON_FILES)) {
      await writeFile(join(root, name), content, 'utf8');
    }

    const pythonProbe = await new PythonLirAdapter().probe({ cwd: root });
    const nodeProbe = await new NodeLirAdapter().probe({ cwd: root });
    pythonAvailable = pythonProbe.available;
    typescriptAvailable = nodeProbe.available && nodeProbe.typescript === true;
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it('registers and discovers adapters by language', async () => {
    const registry = new LirRegistry({ projectRoot: root });
    const python = new PythonLirAdapter();
    const node = new NodeLirAdapter();

    registry.register(python).register(node);

    expect(registry.listAdapters()).toHaveLength(2);
    expect(registry.getAdapter('python')).toBe(python);
    expect(registry.getAdapter('javascript')).toBe(node);
    expect(registry.getAdapter('typescript')).toBe(node);

    const probes = await registry.probeAll();
    expect(probes.map((probe) => probe.adapter).sort()).toEqual(['node', 'python']);
  });

  it('invokes an ordinary Python implementation and separates stdout', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(declaration(), { name: '  Ada  ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ name: 'ada', count: 3 });
    expect(result.stdout).toContain('python-stdout');
    expect(result.stderr).toBe('');
    expect(result.language).toBe('python');
    expect(result.adapter).toBe('python');
    expect(result.exitCode).toBe(0);
  });

  it('normalizes Python exceptions instead of reporting success', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ id: 'explode', entry: 'explode.py', export: 'explode' }),
      { value: 42 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_INVOKE_FAILED');
    expect(result.error.message).toContain('bad input: 42');
    expect(result.error.details).toMatchObject({ name: 'ValueError' });
  });

  it('returns LIR_ENTRY_MISSING for an unknown entry', async () => {
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ id: 'missing', entry: 'missing.py' }),
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_ENTRY_MISSING');
  });

  it('enforces the process:spawn permission', async () => {
    const registry = createDefaultLirRegistry({
      projectRoot: root,
      policy: { grantedPermissions: [] },
    });
    const result = await registry.invoke(declaration(), {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_PERMISSION_DENIED');
  });

  it('rejects environment variables the policy does not allow', async () => {
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ env: ['SECRET_TOKEN'] }),
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_PERMISSION_DENIED');
    expect(result.error.message).toContain('SECRET_TOKEN');
  });

  it('enforces timeouts and reports LIR_TIMEOUT', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ id: 'slow', entry: 'slow.py', export: 'slow' }),
      {},
      { timeoutMs: 250 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_TIMEOUT');
    expect(result.timedOut).toBe(true);
  });

  it('supports cancellation through AbortSignal', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);

    const result = await registry.invoke(
      declaration({ id: 'slow', entry: 'slow.py', export: 'slow' }),
      {},
      { signal: controller.signal, timeoutMs: 10_000 },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_ABORTED');
    expect(result.aborted).toBe(true);
  });

  it('reports a missing interpreter with LIR_RUNTIME_MISSING', async () => {
    const registry = new LirRegistry({ projectRoot: root })
      .register(new PythonLirAdapter({ pythonPath: 'mam-lir-missing-python' }));
    const result = await registry.invoke(declaration(), {});

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_RUNTIME_MISSING');
  });

  it('rejects results that are not JSON-serializable', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ id: 'bad', entry: 'bad_result.py', export: 'bad' }),
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_INVOKE_FAILED');
    expect(result.error.message).toContain('not JSON-serializable');
  });

  it('rejects non-JSON input before starting a process', async () => {
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const result = await registry.invoke(declaration(), circular);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_INPUT_INVALID');
    expect(result.error.message).toContain('circular');
  });

  it('reports a non-zero process exit without a result as LIR_EXIT', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({ id: 'crash', entry: 'crash.py', export: 'crash' }),
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_EXIT');
    expect(result.exitCode).toBe(3);
  });

  it('enforces the output limit', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({
      projectRoot: root,
      policy: { maxOutputBytes: 128 },
    });
    const result = await registry.invoke(
      declaration({ id: 'noisy', entry: 'noise.py', export: 'noisy' }),
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('LIR_OUTPUT_LIMIT');
    expect(result.outputTruncated).toBe(true);
  });

  it('invokes a TypeScript implementation through Node type stripping', async () => {
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({
        id: 'score',
        language: 'typescript',
        entry: 'score.ts',
        export: 'score',
      }),
      { name: 'Ada' },
    );

    if (!typescriptAvailable) {
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('LIR_RUNTIME_MISSING');
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ score: 3, label: 'Ada!' });
    expect(result.language).toBe('typescript');
  });

  it('invokes a JavaScript default export and carries upstream data', async () => {
    const registry = createDefaultLirRegistry({ projectRoot: root });
    const result = await registry.invoke(
      declaration({
        id: 'pipeline',
        language: 'javascript',
        entry: 'pipeline.mjs',
        export: 'default',
      }),
      { upstream: { name: 'ada' } },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ upstream: { name: 'ada' }, step: 'ts' });
  });

  it('records every invocation in the audit log', async () => {
    if (!pythonAvailable) return;
    const registry = createDefaultLirRegistry({ projectRoot: root });
    await registry.invoke(declaration(), { name: 'Ada' });
    await registry.invoke(declaration({ id: 'missing', entry: 'missing.py' }), {});

    const log = registry.getAuditLog();
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ implementationId: 'normalize', ok: true });
    expect(log[1]).toMatchObject({
      implementationId: 'missing',
      ok: false,
      code: 'LIR_ENTRY_MISSING',
    });
  });
});
