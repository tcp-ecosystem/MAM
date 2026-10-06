/**
 * MAM Build Command
 *
 * Multi-file build pipeline for MAM modules.
 * Supports incremental builds, parallel processing, watch mode,
 * source maps, multiple output formats, build hooks, and cache management.
 */

import {
  readFile,
  writeFile,
  mkdir,
  access,
  readdir,
  stat,
  unlink,
} from 'node:fs/promises';
import {
  resolve,
  join,
  basename,
  relative,
  dirname,
  extname,
} from 'node:path';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseMAM } from '@mam/parser';
import { MAM_VERSION, serializeToJSON, getASTStats } from '@mam/ast';
import chalk from 'chalk';
import ora from 'ora';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuildOptions {
  file?: string;
  dir?: string;
  outDir?: string;
  format?: BuildFormat;
  minify?: boolean;
  sourceMap?: boolean;
  watch?: boolean;
  parallel?: number;
  config?: string;
  verbose?: boolean;
  quiet?: boolean;
  cache?: boolean;
  incremental?: boolean;
  stats?: boolean;
  hooks?: boolean;
  dryRun?: boolean;
}

export type BuildFormat = 'json' | 'ast' | 'binary' | 'combined';

export type OutputFormat = {
  serialize: (ast: unknown, options: { compact: boolean }) => string;
  extension: string;
};

interface BuildInfo {
  fileHash: string;
  builtAt: string;
  version: string;
  dependencies: string[];
}

interface BuildConfig {
  outDir: string;
  format: BuildFormat;
  minify: boolean;
  sourceMap: boolean;
  parallel: number;
  excludes: string[];
  includes: string[];
  hooks: {
    preBuild?: string;
    postBuild?: string;
  };
  cacheDir: string;
}

interface BuildStats {
  totalFiles: number;
  successFiles: number;
  failedFiles: number;
  skippedFiles: number;
  totalDurationMs: number;
  fileStats: FileBuildStats[];
  cachedFiles: number;
}

interface FileBuildStats {
  file: string;
  durationMs: number;
  status: 'success' | 'failed' | 'skipped' | 'cached';
  sectionCount: number;
  codeBlockCount: number;
  parseTimeMs: number;
  outputSize: number;
  error?: string;
}

interface FileEntry {
  path: string;
  relativePath: string;
  hash: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAM_EXTENSION = '.mam.md';
const BUILD_INFO_FILE = '.mam-buildinfo.json';
const DEFAULT_CONFIG_FILE = '.mambuild.json';
const CACHE_DIR = '.mam-cache';
const DEFAULT_PARALLEL = 4;

// ---------------------------------------------------------------------------
// Build info / incremental tracking
// ---------------------------------------------------------------------------

async function loadBuildInfo(outDir: string): Promise<Record<string, BuildInfo>> {
  const infoPath = join(outDir, BUILD_INFO_FILE);
  try {
    const raw = await readFile(infoPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveBuildInfo(outDir: string, info: Record<string, BuildInfo>): Promise<void> {
  const infoPath = join(outDir, BUILD_INFO_FILE);
  await writeFile(infoPath, JSON.stringify(info, null, 2), 'utf-8');
}

async function hashFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

async function hasFileChanged(filePath: string, buildInfo: Record<string, BuildInfo>): Promise<boolean> {
  const hash = await hashFile(filePath);
  const existing = buildInfo[filePath];
  return !existing || existing.fileHash !== hash;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

async function loadBuildConfig(configPath: string): Promise<Partial<BuildConfig>> {
  try {
    const raw = await readFile(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function resolveConfig(options: BuildOptions, projectRoot: string): BuildConfig {
  const merged: Record<string, unknown> = {
    outDir: options.outDir || join(projectRoot, 'dist'),
    format: options.format || 'json',
    minify: options.minify ?? false,
    sourceMap: options.sourceMap ?? false,
    parallel: options.parallel || DEFAULT_PARALLEL,
    excludes: [],
    includes: ['**/*.mam.md'],
    hooks: typeof options.hooks === 'object' ? options.hooks : {},
    cacheDir: join(projectRoot, CACHE_DIR),
  };
  return merged as unknown as BuildConfig;
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function discoverMamFiles(dir: string, config: BuildConfig): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];

  async function walk(currentDir: string): Promise<void> {
    let dirEntries;
    try {
      dirEntries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const dirName = entry.name;
        if (['node_modules', '.git', 'dist', 'build', CACHE_DIR, '.mam-cache'].includes(dirName)) continue;
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(MAM_EXTENSION)) {
        const relPath = relative(dir, fullPath);

        // Check excludes
        const isExcluded = config.excludes.some((pattern) => {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
            return regex.test(relPath);
          }
          return relPath.includes(pattern);
        });
        if (isExcluded) continue;

        try {
          const hash = await hashFile(fullPath);
          entries.push({ path: fullPath, relativePath: relPath, hash });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(dir);
  return entries;
}

// ---------------------------------------------------------------------------
// Source map generation
// ---------------------------------------------------------------------------

function generateSourceMap(
  filePath: string,
  originalContent: string,
  compiledContent: string,
  projectRoot: string,
): object {
  const relPath = relative(projectRoot, filePath);
  const originalLines = originalContent.split('\n');
  const compiledLines = compiledContent.split('\n');

  return {
    version: 3,
    file: relPath,
    sourceRoot: '',
    sources: [relPath],
    sourcesContent: [originalContent],
    names: [],
    mappings: generateMappings(originalLines.length, compiledLines.length),
  };
}

function generateMappings(originalLineCount: number, compiledLineCount: number): string {
  const segments: string[] = [];
  const lines = Math.min(originalLineCount, compiledLineCount);
  for (let i = 0; i < lines; i++) {
    segments.push('AAAA');
  }
  return segments.join(';');
}

// ---------------------------------------------------------------------------
// Build hooks
// ---------------------------------------------------------------------------

async function runPreBuildHook(config: BuildConfig, projectRoot: string): Promise<void> {
  if (!config.hooks?.preBuild) return;
  const hookScript = config.hooks.preBuild;
  console.log(chalk.gray(`  Running pre-build hook: ${hookScript}`));

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);
    const parts = hookScript.split(/\s+/);
    await execAsync(parts[0], parts.slice(1), { cwd: projectRoot, timeout: 30000 });
  } catch (err) {
    console.log(chalk.yellow(`  Pre-build hook failed: ${(err as Error).message}`));
  }
}

async function runPostBuildHook(config: BuildConfig, projectRoot: string, stats: BuildStats): Promise<void> {
  if (!config.hooks?.postBuild) return;
  const hookScript = config.hooks.postBuild;
  console.log(chalk.gray(`  Running post-build hook: ${hookScript}`));

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(execFile);
    const env = {
      ...process.env,
      MAM_BUILD_STATUS: stats.failedFiles === 0 ? 'success' : 'failure',
      MAM_BUILD_TOTAL: String(stats.totalFiles),
      MAM_BUILD_SUCCESS: String(stats.successFiles),
      MAM_BUILD_FAILED: String(stats.failedFiles),
    };
    const parts = hookScript.split(/\s+/);
    await execAsync(parts[0], parts.slice(1), { cwd: projectRoot, timeout: 30000, env });
  } catch (err) {
    console.log(chalk.yellow(`  Post-build hook failed: ${(err as Error).message}`));
  }
}

// ---------------------------------------------------------------------------
// Single file build
// ---------------------------------------------------------------------------

async function buildSingleFile(
  entry: FileEntry,
  config: BuildConfig,
  buildInfo: Record<string, BuildInfo>,
  options: BuildOptions,
): Promise<FileBuildStats> {
  const startTime = performance.now();
  const stats: FileBuildStats = {
    file: entry.relativePath,
    durationMs: 0,
    status: 'success',
    sectionCount: 0,
    codeBlockCount: 0,
    parseTimeMs: 0,
    outputSize: 0,
  };

  try {
    // Check if cached / unchanged
    if (options.incremental || options.cache) {
      const changed = await hasFileChanged(entry.path, buildInfo);
      if (!changed && buildInfo[entry.path]) {
        stats.status = 'cached';
        stats.durationMs = performance.now() - startTime;
        return stats;
      }
    }

    // Read and parse
    const content = await readFile(entry.path, 'utf-8');
    const parseResult = parseMAM(content, { source: entry.path });

    stats.parseTimeMs = parseResult.stats?.parseTimeMs ?? 0;

    if (parseResult.errors.length > 0) {
      const errorMsg = parseResult.errors.map((e) => e.toFormattedString()).join('\n');
      stats.status = 'failed';
      stats.error = errorMsg;
      stats.durationMs = performance.now() - startTime;
      return stats;
    }

    // Get section/code stats
    const astStats = getASTStats(parseResult.ast as any);
    stats.sectionCount = astStats.totalSections;
    stats.codeBlockCount = astStats.totalCodeBlocks;

    // Serialize
    const compact = config.minify;
    let output: string;

    switch (config.format) {
      case 'ast': {
        output = JSON.stringify(parseResult.ast, null, compact ? undefined : 2);
        break;
      }
      case 'binary': {
        const json = serializeToJSON(parseResult.ast as any, compact ? 'compact' : 'json');
        output = Buffer.from(json, 'utf-8').toString('base64');
        break;
      }
      case 'combined': {
        const jsonData = serializeToJSON(parseResult.ast as any, compact ? 'compact' : 'json');
        output = JSON.stringify({
          version: MAM_VERSION,
          source: entry.relativePath,
          ast: JSON.parse(jsonData),
          metadata: {
            sectionCount: stats.sectionCount,
            codeBlockCount: stats.codeBlockCount,
            parseTimeMs: stats.parseTimeMs,
            builtAt: new Date().toISOString(),
          },
        }, null, compact ? undefined : 2);
        break;
      }
      default: {
        output = serializeToJSON(parseResult.ast as any, compact ? 'compact' : 'json');
        break;
      }
    }

    // Write output
    const outBaseName = basename(entry.relativePath, MAM_EXTENSION);
    const outSubDir = dirname(entry.relativePath);
    const outDir = join(config.outDir, outSubDir);
    await mkdir(outDir, { recursive: true });

    const ext = config.format === 'binary' ? '.bin' : config.format === 'combined' ? '.json' : `.${config.format}`;
    const outFile = join(outDir, `${outBaseName}${ext}`);
    await writeFile(outFile, output, 'utf-8');
    stats.outputSize = Buffer.byteLength(output, 'utf-8');

    // Source map
    if (config.sourceMap) {
      const sourceMap = generateSourceMap(entry.path, content, output, process.cwd());
      const mapFile = `${outFile}.map`;
      await writeFile(mapFile, JSON.stringify(sourceMap), 'utf-8');
    }

    // Update build info
    buildInfo[entry.path] = {
      fileHash: entry.hash,
      builtAt: new Date().toISOString(),
      version: MAM_VERSION,
      dependencies: [],
    };

    stats.durationMs = performance.now() - startTime;
    return stats;
  } catch (err) {
    stats.status = 'failed';
    stats.error = (err as Error).message;
    stats.durationMs = performance.now() - startTime;
    return stats;
  }
}

// ---------------------------------------------------------------------------
// Parallel execution helper
// ---------------------------------------------------------------------------

async function runInParallel<T>(
  items: T[],
  fn: (item: T) => Promise<FileBuildStats>,
  maxParallel: number,
): Promise<FileBuildStats[]> {
  const results: FileBuildStats[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const promise = fn(item).then((result) => {
      results.push(result);
    });
    executing.add(promise);
    promise.then(() => executing.delete(promise), () => executing.delete(promise));

    if (executing.size >= maxParallel) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

async function cleanCache(projectRoot: string): Promise<void> {
  const cacheDir = join(projectRoot, CACHE_DIR);
  try {
    const entries = await readdir(cacheDir);
    for (const entry of entries) {
      await unlink(join(cacheDir, entry));
    }
    console.log(chalk.green('  Cache cleaned'));
  } catch {
    console.log(chalk.gray('  No cache to clean'));
  }
}

// ---------------------------------------------------------------------------
// Build orchestration
// ---------------------------------------------------------------------------

async function executeBuild(
  mamFiles: FileEntry[],
  config: BuildConfig,
  options: BuildOptions,
): Promise<BuildStats> {
  const buildStartTime = performance.now();
  const buildInfo = config.cacheDir ? await loadBuildInfo(config.outDir) : {};
  const isQuiet = options.quiet;

  // Pre-build hook
  if (options.hooks) {
    await runPreBuildHook(config, process.cwd());
  }

  // Progress tracking
  const spinner = isQuiet ? undefined : ora(`Building ${mamFiles.length} file(s)...`).start();

  const fileStats: FileBuildStats[] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let cachedCount = 0;

  if (options.parallel && options.parallel > 1) {
    // Parallel build
    const results = await runInParallel(
      mamFiles,
      async (entry) => {
        if (spinner) spinner.text = `Building ${entry.relativePath}...`;
        return buildSingleFile(entry, config, buildInfo, options);
      },
      config.parallel,
    );
    fileStats.push(...results);
  } else {
    // Sequential build
    for (const entry of mamFiles) {
      if (spinner) spinner.text = `[${fileStats.length + 1}/${mamFiles.length}] Building ${entry.relativePath}...`;

      const fileStat = await buildSingleFile(entry, config, buildInfo, options);
      fileStats.push(fileStat);

      if (options.verbose) {
        const icon = fileStat.status === 'success' ? chalk.green('✓')
          : fileStat.status === 'cached' ? chalk.cyan('○')
          : fileStat.status === 'skipped' ? chalk.yellow('–')
          : chalk.red('✗');
        console.log(`  ${icon} ${entry.relativePath} (${fileStat.durationMs.toFixed(1)}ms)`);
      }
    }
  }

  // Tally
  for (const fs of fileStats) {
    switch (fs.status) {
      case 'success': successCount++; break;
      case 'failed': failedCount++; break;
      case 'skipped': skippedCount++; break;
      case 'cached': cachedCount++; break;
    }
  }

  // Save build info
  if (config.cacheDir) {
    await saveBuildInfo(config.outDir, buildInfo);
  }

  const totalDurationMs = performance.now() - buildStartTime;

  const buildStats: BuildStats = {
    totalFiles: mamFiles.length,
    successFiles: successCount,
    failedFiles: failedCount,
    skippedFiles: skippedCount,
    totalDurationMs,
    fileStats,
    cachedFiles: cachedCount,
  };

  // Post-build hook
  if (options.hooks) {
    await runPostBuildHook(config, process.cwd(), buildStats);
  }

  if (spinner) {
    if (failedCount === 0) {
      spinner.succeed(`Built ${successCount + cachedCount} file(s) in ${totalDurationMs.toFixed(1)}ms`);
    } else {
      spinner.fail(`${failedCount} file(s) failed to build`);
    }
  }

  return buildStats;
}

// ---------------------------------------------------------------------------
// Watch mode
// ---------------------------------------------------------------------------

async function watchMode(
  dir: string,
  config: BuildConfig,
  options: BuildOptions,
): Promise<void> {
  console.log(chalk.cyan(`\n  Watching for changes in ${dir}...\n`));

  let building = false;

  const rebuild = async (changedFile: string) => {
    if (building) return;
    if (!changedFile.endsWith(MAM_EXTENSION)) return;

    building = true;
    console.log(chalk.gray(`\n  Change detected: ${relative(dir, changedFile)}`));

    try {
      const entries = await discoverMamFiles(dir, config);
      const changedEntry = entries.find((e) => e.path === changedFile);
      if (changedEntry) {
        await executeBuild([changedEntry], config, options);
      }
    } catch (err) {
      console.log(chalk.red(`  Build error: ${(err as Error).message}`));
    } finally {
      building = false;
    }
  };

  // Use node:fs watch
  const watcher: FSWatcher = fsWatch(dir, { recursive: true }, (event, filename) => {
    if (filename) {
      rebuild(join(dir, filename));
    }
  });

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n  Stopping watch mode...'));
    watcher.close();
    process.exit(0);
  });

  // Initial build
  const entries = await discoverMamFiles(dir, config);
  if (entries.length > 0) {
    await executeBuild(entries, config, options);
  } else {
    console.log(chalk.yellow('  No .mam.md files found'));
  }

  // Block forever
  await new Promise(() => {});
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

function printBuildReport(stats: BuildStats, verbose: boolean): void {
  console.log(chalk.bold('\n  Build Report'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(`  Total files:     ${stats.totalFiles}`);
  console.log(`  ${chalk.green('Succeeded:')}      ${stats.successFiles}`);
  if (stats.cachedFiles > 0) {
    console.log(`  ${chalk.cyan('Cached:')}         ${stats.cachedFiles}`);
  }
  if (stats.skippedFiles > 0) {
    console.log(`  ${chalk.yellow('Skipped:')}        ${stats.skippedFiles}`);
  }
  if (stats.failedFiles > 0) {
    console.log(`  ${chalk.red('Failed:')}         ${stats.failedFiles}`);
  }
  console.log(`  Duration:        ${stats.totalDurationMs.toFixed(1)}ms`);
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  if (verbose && stats.fileStats.length > 0) {
    console.log(chalk.bold('\n  File Details'));
    for (const fs of stats.fileStats) {
      const icon = fs.status === 'success' ? chalk.green('✓')
        : fs.status === 'cached' ? chalk.cyan('○')
        : fs.status === 'skipped' ? chalk.yellow('–')
        : chalk.red('✗');

      const detail = fs.status === 'failed'
        ? chalk.red(` ${fs.error?.split('\n')[0] ?? 'unknown error'}`)
        : ` ${fs.sectionCount} sections, ${fs.codeBlockCount} blocks, ${fs.outputSize} bytes, ${fs.durationMs.toFixed(1)}ms`;

      console.log(`  ${icon} ${fs.file}${detail}`);
    }
  }

  if (stats.failedFiles > 0) {
    console.log(chalk.red('\n  Failed files:'));
    for (const fs of stats.fileStats) {
      if (fs.status === 'failed') {
        console.log(chalk.red(`    ${fs.file}`));
        if (fs.error) {
          const lines = fs.error.split('\n').slice(0, 5);
          for (const line of lines) {
            console.log(chalk.red(`      ${line}`));
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Single-file mode (backward compat)
// ---------------------------------------------------------------------------

async function buildSingleFileMode(
  filePath: string,
  config: BuildConfig,
  options: BuildOptions,
): Promise<BuildStats> {
  const entry: FileEntry = {
    path: resolve(filePath),
    relativePath: basename(filePath),
    hash: await hashFile(resolve(filePath)),
  };

  const buildInfo: Record<string, BuildInfo> = {};
  const fileStat = await buildSingleFile(entry, config, buildInfo, options);

  return {
    totalFiles: 1,
    successFiles: fileStat.status === 'success' ? 1 : 0,
    failedFiles: fileStat.status === 'failed' ? 1 : 0,
    skippedFiles: fileStat.status === 'skipped' ? 1 : 0,
    totalDurationMs: fileStat.durationMs,
    fileStats: [fileStat],
    cachedFiles: fileStat.status === 'cached' ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function buildCommand(options: BuildOptions): Promise<void> {
  const buildStart = performance.now();
  const quiet = options.quiet;
  const verbose = options.verbose;

  try {
    // Determine project root
    const projectRoot = process.cwd();

    // Load config file
    const configFilePath = options.config
      ? resolve(options.config)
      : join(projectRoot, DEFAULT_CONFIG_FILE);

    const fileConfig = await loadBuildConfig(configFilePath);
    const mergedOptions: BuildOptions = {
      ...fileConfig,
      ...options,
      hooks: options.hooks ?? (typeof fileConfig.hooks === 'object' ? true : undefined),
    } as BuildOptions;

    // Resolve final config
    const config = resolveConfig(mergedOptions, projectRoot);

    // Ensure output directory
    await mkdir(config.outDir, { recursive: true });

    // Clean cache if requested
    if (options.cache === false) {
      await cleanCache(projectRoot);
    }

    // Single file mode
    if (options.file) {
      const spinner = quiet ? undefined : ora('Building module...').start();

      if (spinner) spinner.text = 'Parsing module...';
      const stats = await buildSingleFileMode(options.file, config, options);

      if (spinner) {
        if (stats.failedFiles === 0) {
          spinner.succeed(`Built in ${stats.totalDurationMs.toFixed(1)}ms`);
        } else {
          spinner.fail('Build failed');
        }
      }

      if (options.stats || verbose) {
        printBuildReport(stats, verbose ?? false);
      }

      // Print summary for single file
      const fileStat = stats.fileStats[0];
      if (fileStat && !quiet) {
        console.log(chalk.gray(`  Sections: ${fileStat.sectionCount}`));
        console.log(chalk.gray(`  Code blocks: ${fileStat.codeBlockCount}`));
        console.log(chalk.gray(`  Parse time: ${fileStat.parseTimeMs.toFixed(2)}ms`));
        console.log(chalk.gray(`  Output size: ${fileStat.outputSize} bytes`));
      }

      process.exit(stats.failedFiles > 0 ? 1 : 0);
    }

    // Directory mode
    const targetDir = options.dir ? resolve(options.dir) : projectRoot;

    if (!quiet) {
      console.log(chalk.gray(`  Source:  ${targetDir}`));
      console.log(chalk.gray(`  Output:  ${config.outDir}`));
      console.log(chalk.gray(`  Format:  ${config.format}`));
      console.log(chalk.gray(`  Parallel: ${config.parallel}`));
    }

    // Discover files
    const discoverSpinner = quiet ? undefined : ora('Discovering MAM files...').start();
    const mamFiles = await discoverMamFiles(targetDir, config);

    if (discoverSpinner) {
      discoverSpinner.succeed(`Found ${mamFiles.length} MAM file(s)`);
    }

    if (mamFiles.length === 0) {
      if (!quiet) console.log(chalk.yellow('  No .mam.md files found'));
      process.exit(0);
    }

    // Watch mode
    if (options.watch) {
      await watchMode(targetDir, config, options);
      return;
    }

    // Execute build
    const stats = await executeBuild(mamFiles, config, options);

    // Report
    if (options.stats || verbose || stats.failedFiles > 0) {
      printBuildReport(stats, verbose ?? false);
    }

    // Exit with error if any files failed
    process.exit(stats.failedFiles > 0 ? 1 : 0);
  } catch (error) {
    const spinner = ora();
    spinner.fail((error as Error).message);
    if (verbose) {
      console.error((error as Error).stack);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Exports for programmatic use
// ---------------------------------------------------------------------------

export {
  discoverMamFiles,
  loadBuildConfig,
  resolveConfig,
  hashFile,
  generateSourceMap,
  BUILD_INFO_FILE,
  CACHE_DIR,
  MAM_EXTENSION,
  DEFAULT_CONFIG_FILE,
};
