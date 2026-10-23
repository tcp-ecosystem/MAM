/**
 * External ecosystem publish targets.
 *
 * `mam publish` puts a module (or a whole module folder) on the MAM Hub.
 * These targets extend the same artifact to the ecosystems developers
 * already build in, per the adoption principle "build once, reuse
 * everywhere":
 *
 *   npm     → an npm package wrapping the .mam module (publish with the real npm CLI)
 *   python  → a pip-installable package with the module as package data
 *   github  → a release in the module's own repository (via the gh CLI)
 *
 * Hub publishing stays the default; a target only runs when it is listed
 * in --targets. External publishing shells out to the standard tool of
 * that ecosystem (npm / python -m build + twine / gh) rather than
 * re-implementing any registry protocol — failure messages point at the
 * missing token or tool, never at MAM internals.
 */

import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

export interface ModuleTargetInfo {
  /** Module id from frontmatter. */
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  tags: string[];
  /** The .mam file being published. */
  file: string;
  /** The .mam.md twin next to it, when present. */
  fileMd?: string;
  rootDir: string;
  /** Git remote URL when the folder is a repo. */
  repository?: string;
}

export interface TargetOptions {
  dryRun: boolean;
  access: 'public' | 'restricted';
  tag?: string;
  /** Suppress per-step console output (used when invoked from other commands). */
  quiet?: boolean;
}

export const ALL_TARGETS = ['hub', 'npm', 'python', 'github'] as const;
export type TargetName = (typeof ALL_TARGETS)[number];

/**
 * Parse a comma-separated --targets value. 'hub' is the implicit default;
 * unknown names fail loudly so typos never publish to the wrong place.
 */
export function parseTargets(spec?: string): TargetName[] {
  if (!spec || spec.trim() === '') return ['hub'];
  const parts = spec
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unknown = parts.filter((p) => !ALL_TARGETS.includes(p as TargetName));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown publish target(s): ${unknown.join(', ')}. Supported: ${ALL_TARGETS.join(', ')}`,
    );
  }
  return [...new Set(parts)] as TargetName[];
}

async function copyIfPresent(from: string, to: string): Promise<boolean> {
  try {
    await access(from);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    return true;
  } catch {
    return false;
  }
}

function npmSafeName(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .replace(/^-+/, 'mam-')
    || 'mam-module';
}

function pythonSafeName(id: string): string {
  const norm = id.toLowerCase().replace(/[^a-z0-9._]+/g, '_').replace(/_+$/, '');
  return norm || 'mam_module';
}

/**
 * Shared README body used across the npm/python packages: states what the
 * artifact is and the one command to run it, so a package consumer never
 * lands in an empty readme.
 */
function generatePackageReadme(info: ModuleTargetInfo, runLine: string): string {
  const lines: string[] = [];
  lines.push(`# ${info.name}`, '');
  if (info.description) lines.push(info.description, '');
  lines.push(`> MAM module \`${basename(info.file)}\` v${info.version} — a [Machine Agent Modules](https://github.com/tcp-ecosystems/MAM) system description.`, '');
  lines.push('## Run', '');
  lines.push('```bash', 'npm i -g @mam/cli', runLine, '```', '');
  if (info.tags.length > 0) lines.push(`**Tags:** ${info.tags.join(', ')}`);
  return `${lines.join('\n').trimEnd()}\n`;
}

// ============================================================================
// npm
// ============================================================================

export interface NpmTargetResult {
  dir: string;
  packageName: string;
  published: boolean;
  packedBytes?: number;
}

/**
 * Materialise `dist/npm/<name>/` as a complete npm package: package.json,
 * the .mam/.mam.md files, a README and LICENSE when present. `mam publish`
 * then either `npm pack --dry-run` (dryRun) or runs the real `npm publish`
 * with that ecosystem's own CLI, so npm auth, 2FA and provenance behave
 * exactly like any other npm package.
 */
export async function runNpmTarget(
  info: ModuleTargetInfo,
  options: TargetOptions,
): Promise<NpmTargetResult> {
  const pkgName = npmSafeName(info.id);
  const mamBase = basename(info.file);
  const dir = join(resolve(info.rootDir), 'dist', 'npm', pkgName);
  await mkdir(dir, { recursive: true });

  const pkg: Record<string, unknown> = {
    name: pkgName,
    version: info.version,
    description: info.description || `${info.name} — MAM module`,
    license: info.license || 'MIT',
    author: info.author || undefined,
    keywords: [...new Set([...info.tags, 'mam', 'machine-agent-modules', 'agent-system'])],
    files: [mamBase, ...(info.fileMd ? [basename(info.fileMd)] : []), 'README.md', 'LICENSE'],
    mam: { module: mamBase, spec: '2.0.0' },
    repository: info.repository
      ? { type: 'git', url: info.repository }
      : undefined,
  };

  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8');

  await copyIfPresent(info.file, join(dir, mamBase));
  if (info.fileMd) await copyIfPresent(info.fileMd, join(dir, basename(info.fileMd)));
  if (!existsSync(join(dir, 'README.md'))) {
    await writeFile(
      join(dir, 'README.md'),
      generatePackageReadme(info, `mam run ${mamBase}`),
      'utf-8',
    );
  }
  await copyIfPresent(join(info.rootDir, 'LICENSE'), join(dir, 'LICENSE'));

  if (!options.quiet) {
    console.log(chalk.green(`  npm package ready: dist/npm/${pkgName}`));
  }

  let published = false;
  if (options.dryRun) {
    const out = execSync(`npm pack --dry-run`, { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    const sizeLine = out.split('\n').find((l) => /total size|package size/i.test(l))?.trim();
    if (!options.quiet) {
      console.log(chalk.gray(`  npm pack (dry-run): ${sizeLine || 'ok'}`));
    }
    return { dir, packageName: pkgName, published: false };
  }

  const args = ['npm', 'publish', '--access', options.access];
  if (options.tag) args.push('--tag', options.tag);
  try {
    execSync(args.join(' '), { cwd: dir, stdio: 'pipe' });
    published = true;
    if (!options.quiet) console.log(chalk.green(`  Published to npm: ${pkgName}@${info.version}`));
  } catch (error) {
    const msg = (error as { stderr?: Buffer }).stderr?.toString() || (error as Error).message;
    if (/E409|requires auth|ENEEDAUTH|401|403/i.test(msg)) {
      throw new Error(
        `npm publish needs an npm login. Run "npm adduser" (or npm login) in dist/npm/${pkgName}, then retry.`,
      );
    }
    if (/EPUBLISHCONFLICT|E409/i.test(msg) === false && /409|conflict/i.test(msg)) {
      throw new Error(`npm rejected ${pkgName}@${info.version} (version conflict). Bump the module version.`);
    }
    throw new Error(`npm publish failed: ${msg.split('\n')[0]}`);
  }

  return { dir, packageName: pkgName, published };
}

// ============================================================================
// python
// ============================================================================

export interface PythonTargetResult {
  dir: string;
  projectName: string;
  built: string[];
  uploaded: boolean;
}

/**
 * Materialise `dist/python/` as a pip-installable project with the module
 * as package data. `mam publish` shells out to this ecosystem's own tools
 * (python -m build, then twine to the user's configured index); each is
 * skipped with an actionable message when the tool is not installed.
 */
export async function runPythonTarget(
  info: ModuleTargetInfo,
  options: TargetOptions,
): Promise<PythonTargetResult> {
  const projName = pythonSafeName(info.id);
  const dir = join(resolve(info.rootDir), 'dist', 'python');
  await mkdir(dir, { recursive: true });

  const pyAuthors = info.author ? [{ name: info.author }] : [];
  const authorsLiteral = authorsLiteralFor(pyAuthors);
  const classifiers = [
    'Programming Language :: Python :: 3',
    'License :: OSI Approved :: MIT License',
    ...info.tags.map((t) => `Topic :: ${t}`),
  ];

  const pyproject = [
    '[build-system]',
    'requires = ["setuptools>=68"]',
    'build-backend = "setuptools.build_meta"',
    '',
    '[project]',
    `name = "mam-${projName}"`,
    `version = "${info.version}"`,
    info.description ? `description = "${info.description.replace(/"/g, "'")}"` : '',
    `classifiers = [`,
    ...classifiers.map((c) => `  "${c}",`),
    `]`,
    '',
    '[tool.setuptools]',
    'packages = ["mam_modules"]',
    '',
    '[tool.setuptools.package-data]',
    'mam_modules = ["*.mam", "*.mam.md", "README.md"]',
    '',
    '[project.urls]',
    info.repository ? `Repository = "${info.repository}"` : 'Documentation = "https://github.com/tcp-ecosystems/MAM"',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  await writeFile(join(dir, 'pyproject.toml'), `${pyproject}\n`, 'utf-8');
  await mkdir(join(dir, 'mam_modules'), { recursive: true });
  await writeFile(join(dir, 'mam_modules', '__init__.py'), `"""${info.name} — MAM module (Machine Agent Modules)."""\n`, 'utf-8');
  const mamBase = basename(info.file);
  const mamData = await readFile(info.file, 'utf-8');
  await writeFile(join(dir, 'mam_modules', mamBase), mamData, 'utf-8');
  if (info.fileMd) {
    await copyIfPresent(info.fileMd, join(dir, 'mam_modules', basename(info.fileMd)));
  }
  if (!existsSync(join(dir, 'README.md'))) {
    await writeFile(
      join(dir, 'README.md'),
      generatePackageReadme(info, `mam run ${mamBase}`),
      'utf-8',
    );
  }

  if (!options.quiet) {
    console.log(chalk.green(`  python package ready: dist/python (mam-${projName})`));
  }

  const built: string[] = [];
  if (!options.dryRun) {
    const hasBuild = toolAvailable('python -m build --version');
    if (!hasBuild) {
      console.log(chalk.yellow('  ⚠ python -m build not installed — skipping sdist/wheel. Run: python -m pip install build'));
    } else {
      execSync('python -m build --outdir dist_mam', { cwd: dir, stdio: 'pipe' });
      built.push('sdist', 'wheel');
      if (!options.quiet) console.log(chalk.green(`  Built sdist + wheel in dist/python/dist_mam`));

      const hasTwine = toolAvailable('twine --version');
      if (!hasTwine) {
        console.log(chalk.yellow('  ⚠ twine not installed — artifacts not uploaded. Run: python -m pip install twine'));
      } else {
        execSync(`twine upload dist_mam/*${options.tag ? '' : ''}`, { cwd: dir, stdio: 'pipe' });
        if (!options.quiet) console.log(chalk.green(`  Uploaded to PyPI: mam-${projName} ${info.version}`));
      }
    }
  }

  return { dir, projectName: `mam-${projName}`, built, uploaded: built.length > 0 && options.dryRun === false };
}

function authorsLiteralFor(authors: Array<{ name: string }>): string {
  if (authors.length === 0) return '[]';
  return `[${authors.map((a) => `{ name = "${a.name}" }`).join(', ')}]`;
}

function toolAvailable(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// github
// ============================================================================

export interface GitHubTargetResult {
  notesFile: string;
  releaseCreated: boolean;
  repo?: string;
}

/**
 * Attach the module files as a GitHub Release on the folder's own remote.
 * Shellouts to the gh CLI only — MAM holds no GitHub API client. When gh
 * is missing or unauthenticated the release notes still land on disk.
 */
export async function runGitHubTarget(
  info: ModuleTargetInfo,
  options: TargetOptions,
): Promise<GitHubTargetResult> {
  const dir = join(resolve(info.rootDir), 'dist', 'github');
  await mkdir(dir, { recursive: true });
  const tag = `mam-v${info.version}`;
  const mamBase = basename(info.file);

  const notes = [
    `## ${info.name} ${tag}`,
    '',
    info.description || '',
    '',
    '**Install**',
    '',
    '```bash',
    'npm i -g @mam/cli',
    `mam install mam-${npmSafeName(info.id)}   # from the MAM Hub`,
    '```',
    '',
    '**Validate this artifact locally**',
    '',
    '```bash',
    `mam validate ${mamBase}`,
    '```',
    '',
  ].join('\n') + '\n';

  const notesFile = join(dir, `${tag}-notes.md`);
  await writeFile(notesFile, notes, 'utf-8');
  if (!options.quiet) {
    console.log(chalk.green(`  release notes ready: dist/github/${tag}-notes.md`));
  }

  let releaseCreated = false;
  if (!options.dryRun) {
    if (!info.repository) {
      console.log(chalk.yellow('  ⚠ no git remote detected for this folder — skipping release creation'));
      return { notesFile, releaseCreated: false };
    }
    if (!toolAvailable('gh --version')) {
      console.log(chalk.yellow('  ⚠ gh CLI not installed — skipping release. Install: https://cli.github.com'));
      return { notesFile, releaseCreated: false };
    }
    const repoSlug = info.repository.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
    try {
      execSync(`gh release create ${tag} ${info.file}${info.fileMd ? ` ${info.fileMd}` : ''} --title "${tag}" --notes-file "${notesFile}" --repo ${repoSlug}`, { stdio: 'pipe' });
      releaseCreated = true;
      if (!options.quiet) console.log(chalk.green(`  GitHub release created: ${repoSlug} @ ${tag}`));
    } catch (error) {
      const msg = (error as { stderr?: Buffer }).stderr?.toString() || (error as Error).message;
      if (/auth/i.test(msg)) {
        throw new Error(`GitHub release auth needed. Run "gh auth login" (or set GH_TOKEN), then retry.`);
      }
      if (/already exists/i.test(msg)) {
        console.log(chalk.yellow(`  ⚠ release ${tag} already exists on ${repoSlug}`));
        return { notesFile, releaseCreated: false, repo: repoSlug };
      }
      throw new Error(`GitHub release failed: ${msg.split('\n')[0]}`);
    }
    return { notesFile, releaseCreated: true, repo: repoSlug };
  }

  return { notesFile, releaseCreated: false };
}

/** Pull the module frontmatter subset the targets need off parsed data. */
export function buildTargetInfo(
  mamData: Record<string, unknown>,
  filePath: string,
  rootDir: string,
  repository?: string,
): ModuleTargetInfo {
  const tags = Array.isArray(mamData.tags)
    ? mamData.tags.filter((t): t is string => typeof t === 'string')
    : [];
  const author =
    typeof mamData.author === 'string'
      ? mamData.author
      : mamData.author && typeof mamData.author === 'object' && 'name' in (mamData.author as Record<string, unknown>)
        ? String((mamData.author as Record<string, { name?: string }>).name ?? '')
        : '';
  const fileMd = (() => {
    const base = filePath.replace(/\.mam$/, '.mam.md');
    if (base !== filePath && existsSync(base)) return base;
    const twin = `${filePath}.md`;
    return existsSync(twin) ? twin : undefined;
  })();

  return {
    id: String(mamData.id ?? basename(filePath, '.mam')),
    name: String(mamData.name ?? basename(filePath)),
    version: String(mamData.version ?? '0.0.0'),
    description: String(mamData.description ?? ''),
    author,
    license: String(mamData.license ?? 'MIT'),
    tags,
    file: filePath,
    fileMd,
    rootDir,
    repository,
  };
}
