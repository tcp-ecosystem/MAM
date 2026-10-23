/**
 * Publish-target tests: the multi-ecosystem fan-out
 * (`mam publish --targets npm,python,github`).
 *
 * Everything runs in dryRun mode against temp projects — no registry,
 * npm login, or gh token required.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseTargets,
  runNpmTarget,
  runPythonTarget,
  runGitHubTarget,
  buildTargetInfo,
  type ModuleTargetInfo,
} from '../src/commands/publish-targets.js';

const MAM_CONTENT =
  '---\nid: demo-widget\nname: Demo Widget\nversion: 3.1.0\ntype: module\nauthor: Test\n' +
  'description: A demo module\nlicense: MIT\nruntime:\n  language: python\n  version: ">=3.12"\n' +
  'tags: [demo, widget]\n---\n\n# Demo Widget\n\n## Purpose\n\nWorks.\n';

async function makeProject(): Promise<{ dir: string; info: ModuleTargetInfo }> {
  const dir = await mkdtemp(join(tmpdir(), 'mam-targets-'));
  const file = join(dir, 'demo-widget.mam');
  await writeFile(file, MAM_CONTENT, 'utf-8');
  const info: ModuleTargetInfo = {
    id: 'demo-widget',
    name: 'Demo Widget',
    version: '3.1.0',
    description: 'A demo module',
    author: 'Test',
    license: 'MIT',
    tags: ['demo', 'widget'],
    file,
    rootDir: dir,
  };
  return { dir, info };
}

describe('parseTargets', () => {
  it('defaults to the hub target', () => {
    expect(parseTargets()).toEqual(['hub']);
    expect(parseTargets('')).toEqual(['hub']);
  });

  it('parses a comma-separated list, normalizing case and spaces', () => {
    expect(parseTargets('npm, python ,GITHUB')).toEqual(['npm', 'python', 'github']);
  });

  it('rejects unknown targets with the supported list in the message', () => {
    expect(() => parseTargets('npm,crates')).toThrow(/crates.*(hub|npm|python|github)/);
  });
});

describe('npm target', () => {
  it('generates a complete package and passes the real npm pack --dry-run', { timeout: 60_000 }, async () => {
    const { info } = await makeProject();
    const result = await runNpmTarget(info, { dryRun: true, access: 'public' });

    expect(result.published).toBe(false);
    expect(result.packageName).toBe('demo-widget');
    expect(result.dir.endsWith(join('dist', 'npm', 'demo-widget'))).toBe(true);

    const pkg = JSON.parse(await readFile(join(result.dir, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('demo-widget');
    expect(pkg.version).toBe('3.1.0');
    expect(pkg.files).toContain('demo-widget.mam');
    expect(pkg.mam.module).toBe('demo-widget.mam');
    expect(pkg.keywords).toContain('mam');

    // The copied module file must be byte-identical to the source.
    expect(await readFile(join(result.dir, 'demo-widget.mam'), 'utf-8')).toBe(MAM_CONTENT);
  });
});

describe('python target', () => {
  it('generates a buildable pyproject with the module as package data', async () => {
    const { info } = await makeProject();
    const result = await runPythonTarget(info, { dryRun: true, access: 'public' });

    expect(result.projectName).toBe('mam-demo_widget');
    expect(result.built).toEqual([]);

    const pyproject = await readFile(join(result.dir, 'pyproject.toml'), 'utf-8');
    expect(pyproject).toContain('name = "mam-demo_widget"');
    expect(pyproject).toContain('version = "3.1.0"');
    expect(pyproject).toContain('mam_modules = ["*.mam"');
    expect(pyproject).toContain('build-backend = "setuptools.build_meta"');

    const files = await readdir(join(result.dir, 'mam_modules'));
    expect(files).toContain('demo-widget.mam');
    expect(files).toContain('__init__.py');
  });
});

describe('github target', () => {
  it('writes release notes and performs no shellout in dry-run', async () => {
    const { info } = await makeProject();
    const result = await runGitHubTarget(info, { dryRun: true, access: 'public' });

    expect(result.releaseCreated).toBe(false);
    const notes = await readFile(result.notesFile, 'utf-8');
    expect(notes).toContain('## Demo Widget mam-v3.1.0');
    expect(notes).toContain('mam validate demo-widget.mam');
  });
});

describe('buildTargetInfo', () => {
  it('maps frontmatter onto the target info, finding .mam.md twins', () => {
    const dir = __dirname;
    const info = buildTargetInfo(
      {
        id: 'tal',
        name: 'TAL',
        version: '1.0.0',
        description: 'd',
        author: { name: 'Jane' },
        license: 'Apache-2.0',
        tags: ['a', 2, 'b'],
      },
      join(dir, 'tal.mam'),
      dir,
      'https://github.com/example/tal',
    );

    expect(info.id).toBe('tal');
    expect(info.author).toBe('Jane');
    expect(info.license).toBe('Apache-2.0');
    expect(info.tags).toEqual(['a', 'b']);
    expect(info.repository).toBe('https://github.com/example/tal');
    expect(info.fileMd).toBeUndefined(); // no twin in the test tree
  });
});
