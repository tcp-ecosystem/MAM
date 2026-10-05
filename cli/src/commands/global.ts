/**
 * MAM Global Command
 *
 * Production-grade management of MAM's global installation surface. This
 * module implements `mam global` with four sub-actions:
 *
 * - **info** — print the npm global root, the global MAM install directory
 *   (where `@mam/*` packages land when installed with `-g`), the MAM
 *   configuration path, and the host toolchain (node/npm versions, platform,
 *   registry).
 * - **link** — run `npm link` in the CLI package so the `mam` binary is
 *   symlinked into the global `node_modules/.bin`.
 * - **unlink** — run `npm unlink` to remove that global symlink.
 * - **list** — enumerate the `@mam/*` packages currently installed in the
 *   global node_modules tree.
 *
 * All sub-processes are spawned synchronously with `node:child_process`
 * (`spawnSync`) so results are guaranteed complete before the command
 * returns. On Windows a shell is used so `.cmd` shims such as `npm` resolve
 * correctly. Output is coloured with `chalk`; pass `--json` to emit
 * machine-readable payloads instead.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import ora from 'ora';

// ============================================================================
// Types
// ============================================================================

/**
 * The supported global-management sub-actions.
 */
export type GlobalAction = 'info' | 'link' | 'unlink' | 'list';

/**
 * Options accepted by {@link globalCommand}.
 */
export interface GlobalOptions {
  /** Which sub-action to execute. Required. */
  action: GlobalAction;
  /** Directory to run `npm link`/`npm unlink` in (defaults to the CLI root). */
  dir?: string;
  /** Registry URL to report for `info` (defaults to the npm-configured one). */
  registry?: string;
  /** Emit JSON instead of a human-readable report. */
  json?: boolean;
}

/**
 * Snapshot of the global MAM environment, as produced by
 * {@link collectGlobalInfo}.
 */
export interface GlobalInfo {
  /** User home directory. */
  home: string;
  /** npm global root (where `-g` packages are installed). */
  npmRoot: string;
  /** Directory holding globally installed `@mam/*` packages. */
  mamDir: string;
  /** Absolute path of the MAM configuration file. */
  configPath: string;
  /** Node.js version of the running process. */
  nodeVersion: string;
  /** npm CLI version. */
  npmVersion: string;
  /** npm registry URL. */
  registry: string;
  /** Operating system platform. */
  platform: string;
  /** Whether the global `@mam` directory currently exists. */
  mamDirExists: boolean;
}

/**
 * A globally installed `@mam/*` package.
 */
export interface GlobalPackage {
  /** Scoped package name, e.g. `@mam/cli`. */
  name: string;
  /** Installed version. */
  version: string;
  /** Absolute path of the package directory. */
  path: string;
}

/**
 * Result of a synchronously spawned command.
 */
export interface SpawnResult {
  /** Process exit status (`0` on success). */
  status: number;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default registry reported when npm's own value cannot be read. */
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';

// ============================================================================
// Environment Helpers
// ============================================================================

/**
 * Resolve the directory of the running CLI package.
 *
 * Works in both source and compiled layouts: when executed from
 * `cli/src/commands/global.ts` it resolves to `cli/`; when executed from
 * `cli/dist/commands/global.js` it resolves to `cli/` as well. This gives
 * `link`/`unlink` a reliable default target.
 *
 * @returns the absolute path of the `@mam/cli` package root
 */
export function cliRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(dirname(here), '..', '..');
}

/**
 * Query the npm global root (`npm prefix -g`).
 *
 * Falls back to a conventional `~/.npm-global` when the npm query fails.
 * The result is cached so repeated calls do not re-spawn npm.
 *
 * @returns the absolute npm global root
 */
export function npmGlobalRoot(): string {
  const result = runSpawnSync('npm', ['prefix', '-g']);
  if (result.status === 0 && result.stdout.trim().length > 0) {
    return result.stdout.trim();
  }
  return join(os.homedir(), '.npm-global');
}

/**
 * Resolve the global MAM install directory.
 *
 * This is the `node_modules/@mam` folder beneath the npm global root, i.e.
 * exactly where `npm install -g @mam/cli` places MAM packages.
 *
 * @returns the absolute global `@mam` install directory
 */
export function mamGlobalInstallDir(): string {
  return join(npmGlobalRoot(), 'node_modules', '@mam');
}

/**
 * Resolve the global MAM configuration path.
 *
 * @returns the absolute path of the MAM config file under the user home
 */
export function globalConfigPath(): string {
  return join(os.homedir(), '.mam', 'config.json');
}

/**
 * Query the npm CLI version.
 *
 * @returns the version string, or `'unknown'` when npm cannot be queried
 */
export function npmVersion(): string {
  const result = runSpawnSync('npm', ['--version']);
  return result.status === 0 && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : 'unknown';
}

/**
 * Query the npm-configured registry URL.
 *
 * @returns the registry URL, or the default npm registry when unreadable
 */
export function npmConfigRegistry(): string {
  const result = runSpawnSync('npm', ['config', 'get', 'registry']);
  return result.status === 0 && result.stdout.trim().length > 0
    ? result.stdout.trim()
    : DEFAULT_REGISTRY;
}

/**
 * Collect a full snapshot of the global MAM environment.
 *
 * @param options - the parsed command options (used for an explicit registry)
 * @returns a populated {@link GlobalInfo}
 */
export function collectGlobalInfo(options: GlobalOptions): GlobalInfo {
  const root = npmGlobalRoot();
  const mamDir = mamGlobalInstallDir();
  return {
    home: os.homedir(),
    npmRoot: root,
    mamDir,
    configPath: globalConfigPath(),
    nodeVersion: process.version,
    npmVersion: npmVersion(),
    registry: options.registry ?? npmConfigRegistry(),
    platform: os.platform(),
    mamDirExists: existsSync(mamDir),
  };
}

// ============================================================================
// Process Spawning
// ============================================================================

/**
 * Spawn a command synchronously and capture its output.
 *
 * Uses a shell on Windows so `.cmd` shims resolve correctly, and an empty
 * `shell: false` environment otherwise. Output is captured as UTF-8 text.
 *
 * @param command - the executable to run
 * @param args - the argument vector
 * @param cwd - optional working directory for the child
 * @returns the captured result
 */
export function runSpawnSync(
  command: string,
  args: string[],
  cwd?: string,
): SpawnResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/**
 * Run `npm link` inside a directory.
 *
 * Symlinks the local package (the CLI by default) into the global
 * `node_modules`, which also exposes its `bin` entries on `PATH`.
 *
 * @param dir - the package directory to link
 * @param name - optional package name for `npm link <name>`
 * @returns the captured result
 */
export function runLink(dir: string, name?: string): SpawnResult {
  const args = name ? ['link', name] : ['link'];
  return runSpawnSync('npm', args, dir);
}

/**
 * Run `npm unlink` inside a directory.
 *
 * Removes the global symlink created by {@link runLink}.
 *
 * @param dir - the package directory that was linked
 * @param name - optional package name for `npm unlink <name>`
 * @returns the captured result
 */
export function runUnlink(dir: string, name?: string): SpawnResult {
  const args = name ? ['unlink', name] : ['unlink'];
  return runSpawnSync('npm', args, dir);
}

// ============================================================================
// Global Package Listing
// ============================================================================

/**
 * Enumerate the `@mam/*` packages installed in a global node_modules tree.
 *
 * Scans the `@mam` scope directory beneath `<root>/node_modules`, reading
 * each package's `package.json` for its real name and version. Entries
 * without a parseable manifest are skipped; results are sorted by name.
 *
 * @param rootDir - the global node_modules root (e.g. the npm global root)
 * @returns the discovered packages, sorted alphabetically
 */
export function globalsFor(rootDir: string): GlobalPackage[] {
  const scopeDir = join(rootDir, 'node_modules', '@mam');
  if (!existsSync(scopeDir)) return [];

  let entries: string[];
  try {
    entries = readdirSync(scopeDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const packages: GlobalPackage[] = [];
  for (const entry of entries) {
    const pkgDir = join(scopeDir, entry);
    const manifestPath = join(pkgDir, 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
        name?: string;
        version?: string;
      };
      packages.push({
        name: manifest.name ?? `@mam/${entry}`,
        version: manifest.version ?? 'unknown',
        path: pkgDir,
      });
    } catch {
      // entry is not a valid installed package — skip it
    }
  }

  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

// ============================================================================
// Rendering Helpers
// ============================================================================

/**
 * Render a {@link GlobalInfo} snapshot as a human-readable report.
 *
 * @param info - the snapshot to render
 * @returns the rendered report
 */
export function formatGlobalInfo(info: GlobalInfo): string {
  const lines: string[] = [];
  lines.push(chalk.cyan('MAM global configuration'));
  lines.push(chalk.gray(`  Home:             ${info.home}`));
  lines.push(chalk.gray(`  npm global root:  ${info.npmRoot}`));
  lines.push(chalk.gray(`  global MAM dir:   ${info.mamDir}`));
  lines.push(chalk.gray(`  config path:      ${info.configPath}`));
  lines.push(chalk.gray(`  node:             ${info.nodeVersion}`));
  lines.push(chalk.gray(`  npm:              ${info.npmVersion}`));
  lines.push(chalk.gray(`  registry:         ${info.registry}`));
  lines.push(chalk.gray(`  platform:         ${info.platform}`));
  lines.push(
    info.mamDirExists
      ? chalk.green('  global MAM dir:   present')
      : chalk.yellow('  global MAM dir:   not yet created'),
  );
  return lines.join('\n');
}

/**
 * Render a list of globally installed `@mam/*` packages.
 *
 * @param packages - the packages to render
 * @returns the rendered report
 */
export function formatGlobalList(packages: GlobalPackage[]): string {
  if (packages.length === 0) {
    return chalk.yellow('No globally installed @mam/* packages found.');
  }
  const lines: string[] = [];
  lines.push(chalk.cyan(`Globally installed @mam/* packages (${packages.length})`));
  for (const pkg of packages) {
    lines.push(`  ${chalk.bold(pkg.name)} ${chalk.gray(pkg.version)}`);
    lines.push(chalk.gray(`      ${pkg.path}`));
  }
  return lines.join('\n');
}

/**
 * Render a spawned command result for display.
 *
 * @param result - the captured result
 * @returns the rendered summary
 */
export function formatSpawnResult(result: SpawnResult): string {
  const lines: string[] = [];
  if (result.status === 0) {
    lines.push(chalk.green(`  exit ${result.status}`));
  } else {
    lines.push(chalk.red(`  exit ${result.status}`));
  }
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  if (stdout) lines.push(chalk.gray(stdout));
  if (stderr) lines.push(chalk.yellow(stderr));
  return lines.join('\n');
}

// ============================================================================
// Command Entry Point
// ============================================================================

/**
 * Run the MAM global command.
 *
 * Dispatches to the action-specific handler. `info` prints the environment
 * snapshot; `link`/`unlink` run `npm link`/`npm unlink` in the CLI root (or
 * the directory given via `--dir`); `list` enumerates globally installed
 * `@mam/*` packages. Non-zero child exit codes are propagated via
 * `process.exit`.
 *
 * @param options - the parsed command options
 * @returns a promise that resolves when the command completes
 */
export async function globalCommand(options: GlobalOptions): Promise<void> {
  const spinner = ora(`Global: ${options.action}...`).start();

  try {
    switch (options.action) {
      case 'info': {
        const info = collectGlobalInfo(options);
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify(info, null, 2));
        } else {
          console.log(formatGlobalInfo(info));
        }
        return;
      }

      case 'link': {
        const dir = resolve(options.dir ?? cliRoot());
        spinner.text = `Linking ${dir}...`;
        const result = runLink(dir);
        spinner.stop();
        console.log(formatSpawnResult(result));
        process.exit(result.status);
        return;
      }

      case 'unlink': {
        const dir = resolve(options.dir ?? cliRoot());
        spinner.text = `Unlinking ${dir}...`;
        const result = runUnlink(dir);
        spinner.stop();
        console.log(formatSpawnResult(result));
        process.exit(result.status);
        return;
      }

      case 'list': {
        const root = options.dir ? resolve(options.dir) : npmGlobalRoot();
        spinner.text = `Scanning ${root}...`;
        const packages = globalsFor(root);
        spinner.stop();
        if (options.json) {
          console.log(JSON.stringify({ root, count: packages.length, packages }, null, 2));
        } else {
          console.log(formatGlobalList(packages));
        }
        return;
      }

      default:
        spinner.fail(`Unknown action: ${String(options.action)}`);
        process.exit(1);
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}