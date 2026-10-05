/**
 * MAM Uninstall Command
 *
 * Production-grade removal of MAM packages (and any package) from a workspace
 * manifest. This module implements `mam uninstall`:
 *
 * - **targeted** — remove one or more named packages from the workspace
 *   `package.json` (or `mam-package.json`) across every dependency section.
 * - **`--all`** — remove every `@mam/*` dependency in one pass.
 * - **spawn** — after the manifest is rewritten, `pnpm remove <pkg...>` is
 *   spawned so the lockfile and `node_modules` stay in sync.
 *
 * Two manifest formats are supported. Standard npm-style `package.json`
 * manifests are edited with direct read/write JSON. MAM-native
 * `mam-package.json` manifests (whose `dependencies` is an array of
 * {@link @mam/package-manager!PackageDependency} objects) are handled through
 * the {@link @mam/package-manager!createPackageManifest} helper so the two
 * formats behave identically from the user's point of view.
 *
 * `--dry-run` prints exactly what would be removed and the exact `pnpm`
 * command without touching the filesystem; `--save-dev` forces the `-D` flag
 * on the spawned `pnpm remove` invocation.
 */

import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  createPackageManifest,
  getManifestDependenciesMap,
} from '@mam/package-manager';
import type { PackageDependency, PackageManifest } from '@mam/package-manager';

// ============================================================================
// Types
// ============================================================================

/**
 * Options accepted by {@link uninstallCommand}.
 */
export interface UninstallOptions {
  /** Package names to uninstall (empty when `all` is set). */
  packages: string[];
  /** Pass `-D` to `pnpm remove`, treating targets as dev dependencies. */
  saveDev?: boolean;
  /** Remove every `@mam/*` dependency from the target manifest. */
  all?: boolean;
  /** Directory whose manifest is edited (defaults to cwd). */
  dir?: string;
  /** Print what would happen without modifying the manifest. */
  dryRun?: boolean;
  /** Skip the spawned `pnpm remove` step (manifest-only uninstall). */
  noInstall?: boolean;
  /** Emit the result as JSON instead of a human-readable summary. */
  json?: boolean;
}

/**
 * The kind of manifest being edited.
 *
 * `'npm'` manifests store dependencies as `Record<string, string>` maps in
 * the four standard sections; `'mam'` manifests store a `dependencies` array
 * of {@link PackageDependency} objects.
 */
export type ManifestKind = 'npm' | 'mam';

/**
 * A parsed manifest plus its location and format on disk.
 */
export interface ResolvedManifest {
  /** Absolute path to the manifest file. */
  path: string;
  /** Directory containing the manifest. */
  dir: string;
  /** Whether the manifest is npm-style or MAM-native. */
  kind: ManifestKind;
  /** The parsed manifest object. */
  manifest: Record<string, unknown>;
}

/**
 * Outcome of removing dependencies from a manifest.
 *
 * `removed` lists the packages that were present and removed; `missing` lists
 * the requested packages that were not found (empty for `--all`). `mutated`
 * is the transformed manifest ready to be written.
 */
export interface RemovalResult {
  /** Packages actually removed from the manifest. */
  removed: string[];
  /** Requested packages that were not present. */
  missing: string[];
  /** The mutated manifest (a copy; the source object is untouched). */
  mutated: Record<string, unknown>;
}

/**
 * Result of spawning a child process.
 */
export interface SpawnResult {
  /** Process exit code (`1` when the process could not be spawned). */
  code: number;
  /** Signal that terminated the process, when it was killed by one. */
  signal: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/** The four manifest sections that can declare npm-style dependencies. */
const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** The MAM package scope prefix. */
const MAM_SCOPE = '@mam/';

// ============================================================================
// Manifest Reading
// ============================================================================

/**
 * Test whether a package name belongs to the `@mam/*` scope.
 *
 * @param name - the package name to test
 * @returns `true` when the name starts with `@mam/`
 */
export function isMamPackage(name: string): boolean {
  return name.startsWith(MAM_SCOPE);
}

/**
 * Read a manifest from a directory.
 *
 * Prefers `package.json` (npm style); falls back to `mam-package.json` (MAM
 * native) when the former is missing. Both formats are reported via
 * {@link ResolvedManifest.kind}.
 *
 * @param dir - the directory to look in (defaults to the current working
 *   directory)
 * @returns the resolved manifest, or `null` when neither file exists
 */
export async function readManifest(dir?: string): Promise<ResolvedManifest | null> {
  const root = resolve(dir || process.cwd());

  const npmPath = join(root, 'package.json');
  try {
    const content = await readFile(npmPath, 'utf-8');
    return {
      path: npmPath,
      dir: root,
      kind: 'npm',
      manifest: JSON.parse(content) as Record<string, unknown>,
    };
  } catch {
    // fall through to the MAM-native manifest
  }

  const mamPath = join(root, 'mam-package.json');
  try {
    const content = await readFile(mamPath, 'utf-8');
    return {
      path: mamPath,
      dir: root,
      kind: 'mam',
      manifest: JSON.parse(content) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Manifest Editing
// ============================================================================

/**
 * Collect every package name declared across all npm-style sections.
 *
 * @param manifest - the npm-style manifest to scan
 * @returns the set of declared package names
 */
export function declaredPackages(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Remove dependencies from an npm-style manifest.
 *
 * Deletes each named package from every section (or every `@mam/*` package
 * when `all` is set) on a shallow copy, leaving the input untouched. Empty
 * sections are preserved so the manifest's shape stays predictable.
 *
 * @param manifest - the npm-style manifest to transform
 * @param names - the packages to remove (ignored when `all` is set)
 * @param all - when `true`, remove every `@mam/*` dependency
 * @returns the list of packages that were removed
 */
export function removeNpmDeps(
  manifest: Record<string, unknown>,
  names: string[],
  all: boolean,
): string[] {
  const mutated: Record<string, unknown> = { ...manifest };
  const removed: string[] = [];
  const present = declaredPackages(mutated);

  if (all) {
    for (const name of present) {
      if (isMamPackage(name)) removed.push(name);
    }
  } else {
    for (const name of names) {
      if (present.has(name)) removed.push(name);
    }
  }

  for (const section of DEP_SECTIONS) {
    const deps = mutated[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (removed.includes(name)) {
        delete deps[name];
      }
    }
  }

  return removed;
}

/**
 * Read the `dependencies` array of a MAM-native manifest.
 *
 * @param manifest - the MAM-native manifest
 * @returns the dependency array (may be empty)
 */
export function mamDependencies(manifest: Record<string, unknown>): PackageDependency[] {
  const raw = manifest.dependencies;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is PackageDependency =>
      typeof d === 'object' && d !== null && typeof (d as PackageDependency).name === 'string',
  );
}

/**
 * Remove dependencies from a MAM-native manifest.
 *
 * Rebuilds the manifest through
 * {@link @mam/package-manager!createPackageManifest} with the target
 * dependencies filtered out, so the MAM manifest helpers stay the single
 * source of truth for the MAM format.
 *
 * @param manifest - the MAM-native manifest to transform
 * @param names - the packages to remove (ignored when `all` is set)
 * @param all - when `true`, remove every `@mam/*` dependency
 * @returns the list of packages that were removed
 */
export function removeMamDeps(
  manifest: Record<string, unknown>,
  names: string[],
  all: boolean,
): string[] {
  const deps = mamDependencies(manifest);
  const removed = all
    ? deps.filter((d) => isMamPackage(d.name)).map((d) => d.name)
    : names.filter((n) => deps.some((d) => d.name === n));

  const base = manifest as Partial<PackageManifest>;
  const mutated = createPackageManifest({
    ...base,
    dependencies: deps.filter((d) => !removed.includes(d.name)),
  });

  // Surface the mutated manifest back to the caller by reference so
  // `removeDeps` can attach it uniformly to the result.
  manifest.dependencies = mutated.dependencies;

  return removed;
}

/**
 * Remove dependencies from a manifest, honouring its format.
 *
 * Dispatches to {@link removeNpmDeps} or {@link removeMamDeps} based on
 * {@link ResolvedManifest.kind}, then assembles a complete {@link RemovalResult}
 * with the removed/missing lists and the mutated manifest copy.
 *
 * @param resolved - the resolved manifest
 * @param names - the packages to remove (ignored when `all` is set)
 * @param all - when `true`, remove every `@mam/*` dependency
 * @returns the removal outcome
 */
export function removeDeps(
  resolved: ResolvedManifest,
  names: string[],
  all: boolean,
): RemovalResult {
  if (resolved.kind === 'mam') {
    const present = new Set(mamDependencies(resolved.manifest).map((d) => d.name));
    const removed = all
      ? [...present].filter((n) => isMamPackage(n))
      : names.filter((n) => present.has(n));
    const missing = all ? [] : names.filter((n) => !present.has(n));
    removeMamDeps(resolved.manifest, names, all);
    return {
      removed,
      missing,
      mutated: { ...resolved.manifest, dependencies: mamDependencies(resolved.manifest) },
    };
  }

  const present = declaredPackages(resolved.manifest);
  const removed = removeNpmDeps(resolved.manifest, names, all);
  const missing = all ? [] : names.filter((n) => !present.has(n));
  return { removed, missing, mutated: { ...resolved.manifest } };
}

/**
 * Resolve the dependency map of a manifest.
 *
 * Convenience wrapper around
 * {@link @mam/package-manager!getManifestDependenciesMap} that tolerates both
 * npm-style and MAM-native manifests, returning the `name → version` map for
 * inspection and reporting.
 *
 * @param manifest - the manifest to inspect
 * @returns a `name → version` record
 */
export function dependenciesMap(manifest: Record<string, unknown>): Record<string, string> {
  if (manifest.dependencies && Array.isArray(manifest.dependencies)) {
    return getManifestDependenciesMap({
      name: String(manifest.name ?? ''),
      version: String(manifest.version ?? ''),
      description: String(manifest.description ?? ''),
      author: String(manifest.author ?? ''),
      license: String(manifest.license ?? ''),
      tags: [],
      dependencies: mamDependencies(manifest),
      main: String(manifest.main ?? 'index.mam.md'),
      files: [],
    });
  }
  const map: Record<string, string> = {};
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, version] of Object.entries(deps)) {
      map[name] = version;
    }
  }
  return map;
}

// ============================================================================
// Manifest Writing
// ============================================================================

/**
 * Persist a mutated manifest back to disk.
 *
 * MAM-native manifests are written through this function too — after
 * {@link removeMamDeps} has replaced the `dependencies` array on the source
 * object, a plain write keeps the helper path single and predictable.
 *
 * @param resolved - the resolved manifest (whose `manifest` has been mutated)
 * @returns a promise that resolves when the file is written
 */
export async function writeManifest(resolved: ResolvedManifest): Promise<void> {
  await writeFile(
    resolved.path,
    `${JSON.stringify(resolved.manifest, null, 2)}\n`,
    'utf-8',
  );
}

// ============================================================================
// Reporting Helpers
// ============================================================================

/**
 * Render a removal outcome as a human-readable summary.
 *
 * @param removed - the packages that were removed
 * @param missing - the packages that were requested but absent
 * @returns the rendered summary
 */
export function formatRemovalSummary(
  removed: string[],
  missing: string[],
): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('Uninstall summary'));
  if (removed.length > 0) {
    lines.push(chalk.green(`  Removed ${removed.length} package(s):`));
    for (const name of removed) {
      lines.push(chalk.gray(`    - ${name}`));
    }
  } else {
    lines.push(chalk.yellow('  Nothing to remove.'));
  }
  if (missing.length > 0) {
    lines.push(chalk.yellow(`  Not found in manifest (${missing.length}):`));
    for (const name of missing) {
      lines.push(chalk.gray(`    ? ${name}`));
    }
  }
  return lines.join('\n');
}

// ============================================================================
// Process Spawning
// ============================================================================

/**
 * Spawn a child process and await its completion.
 *
 * Streams stdout/stderr straight through (`stdio: 'inherit'`) and uses a
 * shell on Windows so `.cmd` shims such as `pnpm` resolve correctly.
 *
 * @param command - the executable to run
 * @param args - the argument vector
 * @param cwd - optional working directory for the child
 * @returns the exit code and terminating signal
 */
export function runSpawn(
  command: string,
  args: string[],
  cwd?: string,
): Promise<SpawnResult> {
  return new Promise((resolveSpawn) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolveSpawn({ code: 1, signal: null }));
    child.on('close', (code, signal) => resolveSpawn({ code: code ?? 1, signal }));
  });
}

/**
 * Run `pnpm remove <pkg...>` for a set of packages.
 *
 * Passes `-D` when `saveDev` is set. Returns the child process exit code.
 *
 * @param packages - the packages to remove
 * @param options - the parsed command options
 * @returns the exit code of `pnpm`
 */
export async function spawnRemove(
  packages: string[],
  options: UninstallOptions,
): Promise<number> {
  if (packages.length === 0) return 0;
  const args = ['remove'];
  if (options.saveDev) args.push('-D');
  args.push(...packages);
  console.log(chalk.cyan(`Running: pnpm ${args.join(' ')}`));
  const result = await runSpawn('pnpm', args, options.dir);
  return result.code;
}

// ============================================================================
// Command Entry Point
// ============================================================================

/**
 * Run the MAM uninstall command.
 *
 * Reads the target manifest, removes the requested packages (or every
 * `@mam/*` dependency with `--all`), writes the result back, and spawns
 * `pnpm remove` so the lockfile and node_modules stay consistent. With
 * `--dry-run` nothing is written and the exact commands are printed instead.
 *
 * @param options - the parsed command options
 * @returns a promise that resolves when the command completes
 */
export async function uninstallCommand(options: UninstallOptions): Promise<void> {
  const spinner = ora('Reading manifest...').start();

  try {
    const resolved = await readManifest(options.dir);
    if (!resolved) {
      spinner.fail('No package.json or mam-package.json found in the target directory.');
      process.exit(1);
    }

    const names = options.all
      ? []
      : [...new Set((options.packages ?? []).filter((n) => n.trim().length > 0))];

    if (!options.all && names.length === 0) {
      spinner.fail('Nothing to uninstall: pass package names or use --all.');
      process.exit(1);
    }

    spinner.text = 'Removing dependencies from manifest...';
    const { removed, missing } = removeDeps(resolved, names, options.all ?? false);

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan('Dry run — manifest not modified:'));
      console.log(formatRemovalSummary(removed, missing));
      return;
    }

    if (removed.length > 0) {
      await writeManifest(resolved);
      spinner.succeed(`Updated ${resolved.path}`);
    } else {
      spinner.stop();
    }

    console.log(formatRemovalSummary(removed, missing));

    if (options.json) {
      console.log(
        JSON.stringify(
          { manifest: resolved.path, removed, missing, saveDev: options.saveDev ?? false },
          null,
          2,
        ),
      );
    }

    if (removed.length > 0 && !options.noInstall) {
      const code = await spawnRemove(removed, options);
      process.exit(code);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}