/**
 * MAM Update Command
 *
 * Production-grade updater for MAM packages inside a pnpm workspace. This
 * module implements the `mam update` sub-commands:
 *
 * - **check** — inspect the workspace root `package.json`, enumerate every
 *   `@mam/*` dependency, and compare each declared range against the latest
 *   version resolvable through {@link @mam/package-manager!PackageRegistry}
 *   (falling back to a direct registry fetch, then to a purely local report
 *   when no registry data is reachable).
 * - **update** — run `pnpm update <pkg>` for the targeted `@mam/*` packages
 *   via a spawned child process, streaming output straight to the terminal.
 *
 * By default the command targets every `@mam/*` workspace dependency; pass a
 * single package name to scope the operation to one package, or `--check` to
 * produce a report without mutating anything. A `--dry-run` flag prints the
 * exact `pnpm` invocation instead of executing it.
 *
 * Version comparison uses the package manager's own
 * {@link @mam/package-manager!sortVersions} and
 * {@link @mam/package-manager!maxSatisfying} helpers so the results agree
 * with the rest of the toolchain.
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import {
  PackageRegistry,
  maxSatisfying,
  normalizeRegistryUrl,
  sortVersions,
} from '@mam/package-manager';

// ============================================================================
// Types
// ============================================================================

/**
 * Options accepted by {@link updateCommand}.
 *
 * `package`, `all`, `check` and `registry` are the core switches; `dir`,
 * `dryRun` and `json` are convenience extras for scripting and CI use.
 */
export interface UpdateOptions {
  /** Update only this single package (e.g. `@mam/parser`). */
  package?: string;
  /** Update every `@mam/*` dependency found in the workspace manifest. */
  all?: boolean;
  /** Report available updates without running `pnpm update`. */
  check?: boolean;
  /** Registry URL used for version resolution during `--check`. */
  registry?: string;
  /** Directory whose `package.json` is inspected (defaults to cwd). */
  dir?: string;
  /** Print the `pnpm` invocation instead of executing it. */
  dryRun?: boolean;
  /** Emit the report as JSON instead of a human-readable table. */
  json?: boolean;
}

/**
 * A single `@mam/*` dependency discovered in a manifest.
 *
 * Carries the declared version range and the manifest section it came from so
 * the report can explain where the dependency lives.
 */
export interface MamDependency {
  /** The scoped package name, e.g. `@mam/parser`. */
  name: string;
  /** The declared version range, e.g. `workspace:*`. */
  range: string;
  /** The manifest section the dependency was found in. */
  section: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
}

/**
 * One row of an update report.
 *
 * When registry data could not be reached the row is marked `source:
 * 'installed'` and carries no `latest`, so the report degrades gracefully
 * instead of guessing.
 */
export interface UpdateReportEntry {
  /** The package name. */
  name: string;
  /** The declared (installed) version range. */
  installed: string;
  /** The latest resolvable version, when known. */
  latest?: string;
  /** `true` when a newer version exists than the declared range resolves to. */
  outdated: boolean;
  /** Where the comparison data came from. */
  source: 'registry' | 'installed';
  /** Human-readable explanation of an unusual state, if any. */
  note?: string;
}

/**
 * A full update-check report.
 *
 * `actionable` lists the packages that should actually be updated — this is
 * exactly the argument list a caller would hand to `pnpm update`.
 */
export interface UpdateReport {
  /** ISO timestamp of when the check ran. */
  checkedAt: string;
  /** One entry per inspected dependency. */
  entries: UpdateReportEntry[];
  /** Names of packages that are behind the latest resolvable version. */
  actionable: string[];
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

/** The four manifest sections that can declare package dependencies. */
const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Default registry consulted when the caller supplies none. */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

/** Recognised `@mam/*` scope prefix. */
const MAM_SCOPE = '@mam/';

// ============================================================================
// Manifest Helpers
// ============================================================================

/**
 * A parsed workspace manifest plus its location on disk.
 */
export interface ResolvedManifest {
  /** Absolute path to the manifest file. */
  path: string;
  /** Directory containing the manifest file. */
  dir: string;
  /** The parsed manifest object. */
  manifest: Record<string, unknown>;
}

/**
 * Load and parse a `package.json` from a directory.
 *
 * Returns `null` when the file is missing or un-parseable, so callers can
 * fail with a friendly message rather than a raw filesystem error.
 *
 * @param dir - the directory to look in (defaults to the current working
 *   directory)
 * @returns the resolved manifest, or `null`
 */
export async function resolveManifest(dir?: string): Promise<ResolvedManifest | null> {
  const root = resolve(dir || process.cwd());
  const filePath = join(root, 'package.json');
  try {
    const content = await readFile(filePath, 'utf-8');
    const manifest = JSON.parse(content) as Record<string, unknown>;
    return { path: filePath, dir: root, manifest };
  } catch {
    return null;
  }
}

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
 * Read the declared version range of a package from a manifest.
 *
 * Searches every dependency section in precedence order
 * (dependencies → dev → optional → peer) and returns the first match.
 *
 * @param manifest - the manifest to search
 * @param name - the package name to look up
 * @returns the declared range, or `undefined` when absent
 */
export function readVersion(
  manifest: Record<string, unknown>,
  name: string,
): string | undefined {
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section] as Record<string, string> | undefined;
    if (deps && typeof deps[name] === 'string') {
      return deps[name];
    }
  }
  return undefined;
}

/**
 * Enumerate every `@mam/*` dependency declared in a manifest.
 *
 * Collects from all four dependency sections, de-duplicates by package name
 * (keeping the first, highest-precedence occurrence), and sorts the result
 * alphabetically so reports are stable.
 *
 * @param manifest - the manifest to scan
 * @returns the deduplicated, sorted dependency list
 */
export function listMamDeps(manifest: Record<string, unknown>): MamDependency[] {
  const found: MamDependency[] = [];
  for (const section of DEP_SECTIONS) {
    const deps = manifest[section] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (isMamPackage(name)) {
        found.push({ name, range, section });
      }
    }
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  const seen = new Set<string>();
  return found.filter((dep) => {
    if (seen.has(dep.name)) return false;
    seen.add(dep.name);
    return true;
  });
}

/**
 * Narrow the full dependency list to the packages the user targeted.
 *
 * A specific `package` wins; otherwise every `@mam/*` dependency is targeted
 * (mirroring `--all`), which is also the default for a bare update call.
 *
 * @param deps - the full dependency list
 * @param options - the parsed command options
 * @returns the targeted dependencies
 */
export function filterTargets(
  deps: MamDependency[],
  options: UpdateOptions,
): MamDependency[] {
  if (options.package) {
    return deps.filter((dep) => dep.name === options.package);
  }
  return deps;
}

// ============================================================================
// Registry Resolution
// ============================================================================

/**
 * Resolve the versions of a package that are available from a registry.
 *
 * Consults {@link @mam/package-manager!PackageRegistry} first (its cached
 * index and `getLatest`), then falls back to a direct `Accept:
 * application/json` fetch of the registry metadata when the manager yields
 * nothing. Both paths are guarded — any failure returns an empty list so the
 * caller can degrade to an installed-versions-only report.
 *
 * @param name - the package name to resolve
 * @param registry - optional registry URL
 * @returns the available versions sorted highest-first (may be empty)
 */
export async function resolveAvailableVersions(
  name: string,
  registry?: string,
): Promise<string[]> {
  const base = registry ?? DEFAULT_REGISTRY;
  const client = new PackageRegistry({ url: base });

  const collected: string[] = [];
  try {
    collected.push(...(await client.getVersions(name)));
    const latest = await client.getLatest(name);
    if (latest) collected.push(latest);
  } catch {
    // registry client unavailable — fall through to direct fetch
  }

  const unique = [...new Set(collected)].filter((v) => v.length > 0);
  if (unique.length > 0) {
    return sortVersions(unique);
  }

  try {
    const encoded = name.startsWith('@') ? name.replace('/', '%2f') : name;
    const response = await fetch(`${normalizeRegistryUrl(base)}/${encoded}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { versions?: Record<string, unknown> };
    if (!data.versions) return [];
    return sortVersions(Object.keys(data.versions));
  } catch {
    return [];
  }
}

/**
 * Build a report comparing declared ranges to the latest resolvable version.
 *
 * For each dependency, the declared range is matched against the available
 * version list with `maxSatisfying`; an entry is `outdated` when the highest
 * satisfying version differs from the newest available version.
 *
 * @param deps - the dependencies to check
 * @param options - the parsed command options
 * @returns the assembled update report
 */
export async function buildUpdateReport(
  deps: MamDependency[],
  options: UpdateOptions,
): Promise<UpdateReport> {
  const entries: UpdateReportEntry[] = [];

  for (const dep of deps) {
    const versions = await resolveAvailableVersions(dep.name, options.registry);

    if (versions.length === 0) {
      entries.push({
        name: dep.name,
        installed: dep.range,
        outdated: false,
        source: 'installed',
        note: 'No registry data available; reporting declared version.',
      });
      continue;
    }

    const latest = sortVersions(versions)[0];
    const satisfied = maxSatisfying(versions, dep.range);
    const outdated = latest !== undefined && satisfied !== latest;
    entries.push({
      name: dep.name,
      installed: dep.range,
      latest,
      outdated,
      source: 'registry',
      note: outdated
        ? `Declared range resolves to ${satisfied ?? 'nothing'} but ${latest} is available.`
        : 'Up to date within the declared range.',
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    entries,
    actionable: entries.filter((e) => e.outdated).map((e) => e.name),
  };
}

// ============================================================================
// Reporting Helpers
// ============================================================================

/**
 * Render a single report entry as a coloured line.
 *
 * @param entry - the entry to render
 * @returns the rendered line
 */
export function formatEntry(entry: UpdateReportEntry): string {
  const name = chalk.bold(entry.name);
  if (entry.source === 'installed' || entry.latest === undefined) {
    return `  ${name} ${chalk.gray(`declared ${entry.installed} (no registry data)`)}`;
  }
  const status = entry.outdated ? chalk.yellow('OUTDATED') : chalk.green('up-to-date');
  const arrow = entry.outdated ? chalk.gray(` → ${entry.latest}`) : '';
  return `  ${name} ${status} ${chalk.gray(entry.installed)}${arrow}`;
}

/**
 * Render a full {@link UpdateReport} as a human-readable summary.
 *
 * @param report - the report to render
 * @returns the rendered summary
 */
export function formatUpdateReport(report: UpdateReport): string {
  const lines: string[] = [];
  lines.push(chalk.cyan(`MAM update check — ${report.checkedAt}`));
  lines.push('');
  if (report.entries.length === 0) {
    lines.push(chalk.yellow('  No @mam/* dependencies found.'));
    return lines.join('\n');
  }
  for (const entry of report.entries) {
    lines.push(formatEntry(entry));
    if (entry.note) {
      lines.push(chalk.gray(`      ${entry.note}`));
    }
  }
  lines.push('');
  if (report.actionable.length > 0) {
    lines.push(
      chalk.yellow(`  ${report.actionable.length} package(s) can be updated:`),
    );
    lines.push(chalk.cyan(`    pnpm update ${report.actionable.join(' ')}`));
  } else {
    lines.push(chalk.green('  All @mam/* packages are up to date.'));
  }
  return lines.join('\n');
}

// ============================================================================
// Process Spawning
// ============================================================================

/**
 * Spawn a child process and await its completion.
 *
 * Streams stdout/stderr straight through (`stdio: 'inherit'`) so the user
 * sees real progress. On Windows a shell is used so `.cmd` shims such as
 * `pnpm` resolve correctly.
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
 * Run `pnpm update <pkg...>` for a set of packages.
 *
 * Prints the exact invocation before executing it so the user always knows
 * what ran. Returns the child process exit code.
 *
 * @param packages - the packages to update
 * @param options - the parsed command options
 * @returns the exit code of `pnpm`
 */
export async function spawnUpdate(
  packages: string[],
  options: UpdateOptions,
): Promise<number> {
  if (packages.length === 0) return 0;
  const args = ['update', ...packages];
  console.log(chalk.cyan(`Running: pnpm ${args.join(' ')}`));
  const result = await runSpawn('pnpm', args, options.dir);
  return result.code;
}

// ============================================================================
// Command Entry Point
// ============================================================================

/**
 * Run the MAM update command.
 *
 * Loads the workspace manifest, enumerates the targeted `@mam/*`
 * dependencies, and either produces a check report (`--check`) or executes
 * `pnpm update` for the affected packages. When registry data is
 * unreachable, `--check` still reports the declared versions so the command
 * never fails on a flaky network.
 *
 * Exit codes: `0` on success, `1` when the check found actionable updates,
 * when `pnpm` itself failed, or on any unexpected error.
 *
 * @param options - the parsed command options
 * @returns a promise that resolves when the command completes
 */
export async function updateCommand(options: UpdateOptions): Promise<void> {
  const spinner = ora('Reading workspace manifest...').start();

  try {
    const resolved = await resolveManifest(options.dir);
    if (!resolved) {
      spinner.fail('No package.json found in the target directory.');
      process.exit(1);
    }

    const allDeps = listMamDeps(resolved.manifest);
    const targets = filterTargets(allDeps, options);

    if (targets.length === 0) {
      spinner.succeed(
        options.package
          ? `"${options.package}" is not a declared @mam/* dependency.`
          : 'No @mam/* packages found to update.',
      );
      return;
    }

    if (options.check) {
      spinner.text = `Checking ${targets.length} package(s) against the registry...`;
      const report = await buildUpdateReport(targets, options);
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatUpdateReport(report));
      }

      process.exit(report.actionable.length > 0 ? 1 : 0);
    }

    const names = targets.map((t) => t.name);
    spinner.text = `Updating ${names.length} package(s)...`;

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan(`Would run: pnpm update ${names.join(' ')}`));
      return;
    }

    spinner.stop();
    const code = await spawnUpdate(names, options);
    process.exit(code);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}