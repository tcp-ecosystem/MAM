/**
 * Project composition tests — TOML parser, manifest, globs, graph.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseToml } from '../../src/project/toml.js';
import { parseManifest, validateManifest } from '../../src/project/manifest.js';
import { globToRegExp, Project } from '../../src/project/loader.js';
import { buildProjectGraph } from '../../src/project/graph.js';
import type { LoadedModule } from '../../src/project/loader.js';

describe('parseToml', () => {
  it('parses primitives', () => {
    const t = parseToml(`
      name = "demo"
      version = "1.0.0"
      count = 3
      ratio = 1.5
      enabled = true
      disabled = false
    `);
    expect(t).toMatchObject({ name: 'demo', version: '1.0.0', count: 3, ratio: 1.5, enabled: true, disabled: false });
  });

  it('parses tables and dotted keys', () => {
    const t = parseToml(`
      [project]
      name = "demo"
      version = "2.0.0"
      meta.a = 1
      meta.b = 2
    `);
    expect(t.project).toMatchObject({ name: 'demo', version: '2.0.0' });
    expect((t.project as Record<string, unknown>).meta).toMatchObject({ a: 1, b: 2 });
  });

  it('parses arrays including multi-line', () => {
    const t = parseToml(`
      targets = [
        "python",
        "javascript",
      ]
      empty = []
    `);
    expect(t.targets).toEqual(['python', 'javascript']);
    expect(t.empty).toEqual([]);
  });

  it('parses inline tables', () => {
    const t = parseToml('runtime = { language = "python", version = ">=3.12" }');
    expect(t.runtime).toEqual({ language: 'python', version: '>=3.12' });
  });

  it('parses arrays of tables', () => {
    const t = parseToml(`
      [[deps]]
      name = "a"
      version = "^1.0"
      [[deps]]
      name = "b"
    `);
    expect(t.deps).toEqual([{ name: 'a', version: '^1.0' }, { name: 'b' }]);
  });

  it('ignores comments outside strings', () => {
    const t = parseToml('name = "a#b" # trailing comment\nother = 1');
    expect(t.name).toBe('a#b');
    expect(t.other).toBe(1);
  });
});

describe('parseManifest', () => {
  const TOML = `
    [project]
    name = "security-system"
    version = "1.0.0"
    description = "A system"
    license = "MIT"

    [build]
    entry = "system.mam"
    modules = ["modules/**/*.mam"]
    outDir = "build"
    targets = ["python", "javascript"]

    [dependencies]
    http-client = "^1.2"
  `;

  it('parses project, build and dependencies', () => {
    const m = parseManifest(TOML);
    expect(m.project).toMatchObject({ name: 'security-system', version: '1.0.0', license: 'MIT' });
    expect(m.build.entry).toBe('system.mam');
    expect(m.build.modules).toEqual(['modules/**/*.mam']);
    expect(m.build.outDir).toBe('build');
    expect(m.build.targets).toEqual(['python', 'javascript']);
    expect(m.dependencies).toEqual({ 'http-client': '^1.2' });
  });

  it('applies defaults when sections are missing', () => {
    const m = parseManifest('name = "x"');
    expect(m.build.targets).toEqual(['python']);
    expect(m.build.outDir).toBe('dist');
    expect(m.build.modules.length).toBeGreaterThan(0);
  });

  it('validates required fields', () => {
    const m = parseManifest('[project]\nname = "x"\nversion = "1.0.0"');
    expect(validateManifest(m)).toEqual([]);
  });
});

describe('globToRegExp', () => {
  it('matches files in nested directories', () => {
    const re = globToRegExp('modules/**/*.mam');
    expect(re.test('modules/a.mam')).toBe(true);
    expect(re.test('modules/sub/b.mam')).toBe(true);
    expect(re.test('modules/a.mam.md')).toBe(false);
  });

  it('matches root globs', () => {
    const re = globToRegExp('*.mam');
    expect(re.test('system.mam')).toBe(true);
    expect(re.test('modules/a.mam')).toBe(false);
  });

  it('matches .mam.md files', () => {
    const re = globToRegExp('modules/**/*.mam.md');
    expect(re.test('modules/a.mam.md')).toBe(true);
    expect(re.test('modules/a.mam')).toBe(false);
  });
});

function mod(id: string, deps: string[], extra: Partial<LoadedModule> = {}): LoadedModule {
  return {
    id,
    name: id,
    type: 'module',
    filePath: `/p/${id}.mam`,
    relativePath: `${id}.mam`,
    ast: {},
    dependencies: deps,
    errors: [],
    ...extra,
  };
}

describe('buildProjectGraph', () => {
  it('links local dependencies and marks external ones', () => {
    const graph = buildProjectGraph([
      mod('a', []),
      mod('b', ['a']),
      mod('c', ['b', 'external-pkg@^1.0']),
    ]);
    expect(graph.edges.some((e) => e.from === 'b' && e.to === 'a')).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'external-pkg')?.external).toBe(true);
  });

  it('orders dependencies before dependents', () => {
    const graph = buildProjectGraph([mod('a', []), mod('b', ['a']), mod('c', ['b'])]);
    expect(graph.order.indexOf('a')).toBeLessThan(graph.order.indexOf('b'));
    expect(graph.order.indexOf('b')).toBeLessThan(graph.order.indexOf('c'));
  });

  it('detects cycles', () => {
    const graph = buildProjectGraph([mod('a', ['b']), mod('b', ['a'])]);
    expect(graph.cycles.length).toBeGreaterThan(0);
  });
});

describe('Project loader (filesystem)', () => {
  it('findProject returns null when no mam.toml exists', async () => {
    const { findProject } = await import('../../src/project/detect.js');
    const dir = await mkdtemp(join(tmpdir(), 'mam-null-'));
    try {
      expect(await findProject(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('discovers modules and dedupes .mam/.mam.md twins', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-proj-'));
    const manifest = `[project]\nname = "t"\nversion = "1.0.0"\n[build]\nentry = "system.mam"\nmodules = ["**/*.mam", "**/*.mam.md"]\n`;
    const moduleBody = `---\nid: a\nname: A\nversion: 1.0.0\nauthor: x\nruntime: python\n---\n\n# A\n\n## Purpose\n\np\n`;
    try {
      await mkdir(join(dir, 'modules'), { recursive: true });
      await writeFile(join(dir, 'mam.toml'), manifest, 'utf-8');
      await writeFile(join(dir, 'modules', 'a.mam'), moduleBody, 'utf-8');
      await writeFile(join(dir, 'modules', 'a.mam.md'), moduleBody, 'utf-8');
      const project = Project.create(dir, manifest);
      const modules = await project.loadAllModules();
      expect(modules.filter((m) => m.id === 'a')).toHaveLength(1);
      expect(modules[0]?.filePath.endsWith('.mam')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads the entry system when declared', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mam-entry-'));
    const manifest = `[project]\nname = "t"\nversion = "1.0.0"\n[build]\nentry = "system.mam"\nmodules = ["**/*.mam"]\n`;
    try {
      await writeFile(join(dir, 'mam.toml'), manifest, 'utf-8');
      await writeFile(
        join(dir, 'system.mam'),
        `---\nid: system\nname: Sys\nversion: 1.0.0\nauthor: x\ntype: system\nruntime: python\n---\n\n# Sys\n\n## Purpose\n\np\n`,
        'utf-8',
      );
      const project = Project.create(dir, manifest);
      const entry = await project.loadEntry();
      expect(entry?.id).toBe('system');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
