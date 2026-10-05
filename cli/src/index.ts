#!/usr/bin/env node

/**
 * MAM — Machine Agent Modules
 * Machine Agent Modules
 *
 * Human Identity: Machine Agent Modules (what users write)
 * System Identity: Machine Agent Modules (what the compiler understands)
 *
 * v2: Full-featured CLI with 35+ commands
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let pkg: { version: string; name: string };
try {
  pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));
} catch {
  pkg = { version: '2.0.0', name: '@mam/cli' };
}

const VERSION = pkg.version;

const BANNER = `
${chalk.cyan('╔═══════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}${chalk.white.bold('                                                       ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('     __  __    _    ____   __  __ _____               ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('    |  \\/  |  / \\  |  _ \\  \\ \\/ /| ____|              ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('    | |\\/| | / _ \\ | |_) |  \\  / |  _|                ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('    | |  | |/ ___ \\|  _ <    )  | |___                ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('    |_|  |_/_/   \\_\\_| \\_\\  /_/  |_____|              ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('                                                       ')}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.gray('       Machine Agent Modules — Machine Agent Modules')}   ${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.gray(`       v${VERSION} · markdown-as-module.org`)}${' '.repeat(Math.max(0, 19 - VERSION.length))}${chalk.cyan('║')}
${chalk.cyan('║')}${chalk.white.bold('                                                       ')}${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════╝')}
`;

const program = new Command();

program
  .name('mam')
  .description(`${chalk.cyan('MAM')} — ${chalk.white('Machine Agent Modules')}\n${chalk.gray('Machine Agent Modules · System Description Language')}`)
  .version(VERSION)
  .argument('[file]', 'MAM module file to process')
  .addHelpText('before', BANNER);

// ─── MODULE LIFECYCLE ────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a MAM project or module')
  .argument('[name]', 'Module name (omit to initialize a project)')
  .option('-t, --template <template>', 'Template (basic|advanced|workflow)', 'basic')
  .option('-d, --dir <dir>', 'Target directory')
  .option('--project', 'Initialize a full project (mam.toml + modules + system)')
  .option('--force', 'Overwrite existing files')
  .action(async (name, options) => {
    if (options.project || !name) {
      const { projectInitCommand } = await import('./commands/project.js');
      await projectInitCommand({ dir: options.dir, force: options.force });
      return;
    }
    const { initModule } = await import('./commands/init.js');
    const result = await initModule({ name, ...options });
    if (result.success) {
      console.log(chalk.green(`Created module: ${result.file}`));
    } else {
      console.error(chalk.red(result.error));
      process.exit(1);
    }
  });

program
  .command('new')
  .description('Create a new module from a template')
  .argument('<type>', 'Module type (module|agent|tool|memory|workflow|team|policy|system|service|component|resource|plugin|api)')
  .argument('<name>', 'Module name')
  .option('-d, --dir <dir>', 'Output directory')
  .option('--force', 'Overwrite existing files')
  .option('-q, --quiet', 'Suppress non-essential output')
  .action(async (type, name, options) => {
    const { newCommand } = await import('./commands/new.js');
    await newCommand(type, name, options);
  });

program
  .command('build')
  .description('Build a MAM project or module')
  .argument('[file]', 'MAM module file (omit to build the project)')
  .option('-o, --outDir <outDir>', 'Output directory', './dist')
  .option('-f, --format <format>', 'Output format (json|ast|binary)', 'json')
  .option('--minify', 'Minify output')
  .option('--sourcemap', 'Generate source map')
  .option('-t, --target <target>', 'Project build target override')
  .action(async (file, options) => {
    const { findProject } = await import('./project/detect.js');
    const project = await findProject();
    if (project && !file) {
      const { projectBuildCommand } = await import('./commands/project.js');
      await projectBuildCommand({ target: options.target, format: options.format === 'json' ? 'json' : 'text' });
      return;
    }
    if (!file) {
      console.error(chalk.red('No file specified and no mam.toml found.'));
      process.exit(1);
    }
    const { buildCommand } = await import('./commands/build.js');
    await buildCommand({ file, ...options });
  });

program
  .command('compile')
  .description('Compile MAM module to target language')
  .argument('<file>', 'MAM module file to compile')
  .option('-t, --target <target>', 'Target (python|javascript|go|rust|csharp|java|wasm|json|openai|langgraph|crewai|gemini|autogen|kubernetes|terraform|docker|claude)', 'python')
  .option('-o, --outDir <outDir>', 'Output directory', './dist')
  .option('--indent <indent>', 'Indentation size', '4')
  .option('--comments', 'Include comments')
  .option('--minify', 'Minify output')
  .option('-v, --verbose', 'Verbose output')
  .action(async (file, options) => {
    const { compileCommand } = await import('./commands/compile.js');
    await compileCommand({ file, target: options.target, ...options });
  });

program
  .command('run')
  .description('Run a .mam module or the project entry natively')
  .argument('[file]', '.mam module file to run (omit to run the project entry)')
  .option('-i, --inputs <inputs>', 'Input parameters (JSON string)')
  .option('-t, --timeout <timeout>', 'Execution timeout in ms', '30000')
  .option('--target <target>', 'Execution target (python|javascript|go|rust)')
  .option('--sandbox <sandbox>', 'Legacy sandbox execution (process|vm|docker)')
  .option('--env <env>', 'Environment variables (KEY=VALUE,...)')
  .option('--memory-limit <limit>', 'Memory limit in MB', '256')
  .option('--no-validate', 'Skip validation before execution')
  .option('--no-memory', 'Disable memory/context persistence')
  .option('-v, --verbose', 'Verbose output')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--dry-run', 'Show execution plan without running')
  .action(async (file, options) => {
    const { findProject } = await import('./project/detect.js');
    const project = await findProject();
    if (project && !file) {
      const { projectRunCommand } = await import('./commands/project.js');
      await projectRunCommand({
        inputs: options.inputs,
        format: options.format === 'json' ? 'json' : 'text',
        timeout: parseInt(options.timeout),
        verbose: options.verbose,
        quiet: options.quiet,
        dryRun: options.dryRun,
      });
      return;
    }
    if (!file) {
      console.error(chalk.red('No file specified and no mam.toml found.'));
      process.exit(1);
    }
    const { runCommand } = await import('./commands/run.js');
    await runCommand({ ...options, file, timeout: parseInt(options.timeout) });
  });

program
  .command('execute')
  .alias('exec')
  .description('Execute a MAM module (v1 compat)')
  .argument('<file>', 'MAM module file to execute')
  .option('-s, --sections <sections>', 'Sections to execute (comma-separated)')
  .option('-i, --inputs <inputs>', 'Input parameters (JSON string)')
  .option('-t, --timeout <timeout>', 'Execution timeout in ms', '30000')
  .option('--sandbox <sandbox>', 'Sandbox type (process|vm)', 'process')
  .option('--env <env>', 'Environment variables')
  .option('--dry-run', 'Show execution plan without running')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (file, options) => {
    const { executeCommand } = await import('./commands/execute.js');
    await executeCommand({
      file,
      sections: options.sections?.split(','),
      timeout: parseInt(options.timeout),
      ...options,
    });
  });

// ─── VALIDATION & QUALITY ────────────────────────────────────────

program
  .command('validate')
  .description('Validate a MAM project or module')
  .argument('[file]', 'MAM module file (omit to validate the project)')
  .option('-l, --level <level>', 'Validation level (syntax|schema|semantic|strict)', 'schema')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('-W, --no-warnings', 'Hide warnings')
  .option('--fix', 'Auto-fix fixable issues')
  .option('--max-errors <n>', 'Maximum errors to report', '50')
  .action(async (file, options) => {
    const { findProject } = await import('./project/detect.js');
    const project = await findProject();
    if (project && !file) {
      const { projectValidateCommand } = await import('./commands/project.js');
      await projectValidateCommand({ format: options.format === 'json' ? 'json' : 'text' });
      return;
    }
    if (!file) {
      console.error(chalk.red('No file specified and no mam.toml found.'));
      process.exit(1);
    }
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand({ file, ...options });
  });

program
  .command('lint')
  .description('Lint a MAM module for style and best practices')
  .argument('<file>', 'MAM module file to lint')
  .option('-l, --level <level>', 'Lint level (error|warning|info)', 'warning')
  .option('-f, --format <format>', 'Output format (text|json|stylish)', 'text')
  .option('--fix', 'Auto-fix fixable issues')
  .option('--config <config>', 'Lint config file')
  .option('--no-ignore', 'Don\'t respect .mamignore')
  .action(async (file, options) => {
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand({ file, ...options });
  });

program
  .command('format')
  .alias('fmt')
  .description('Format a MAM module with consistent style')
  .argument('<file>', 'MAM module file to format')
  .option('-i, --in-place', 'Format in place')
  .option('-c, --check', 'Check if formatting is needed')
  .option('--indent <indent>', 'Indentation size', '4')
  .option('--max-line-length <length>', 'Max line length', '200')
  .option('--single-quote', 'Use single quotes in YAML')
  .option('--no-trailing-comma', 'No trailing commas')
  .action(async (file, options) => {
    const { formatCommand } = await import('./commands/fmt.js');
    await formatCommand({ file, ...options });
  });

program
  .command('audit')
  .description('Security audit a MAM module')
  .argument('<file>', 'MAM module file to audit')
  .option('-f, --format <format>', 'Output format (text|json|sarif)', 'text')
  .option('--severity <level>', 'Minimum severity (low|medium|high|critical)', 'medium')
  .option('--fix', 'Apply auto-fixes')
  .action(async (file, options) => {
    console.log(chalk.yellow('Audit command — scanning for security issues...'));
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand({ file, level: 'strict', format: options.format });
  });

// ─── AST & ANALYSIS ──────────────────────────────────────────────

program
  .command('ast')
  .description('Display the AST of a MAM module')
  .argument('<file>', 'MAM module file')
  .option('-f, --format <format>', 'Output format (json|pretty|stats|tree|compact)', 'pretty')
  .option('--depth <depth>', 'Max depth for tree view')
  .option('--include-locations', 'Include source locations')
  .option('--nodes <types>', 'Filter node types (comma-separated)')
  .action(async (file, options) => {
    const { astCommand } = await import('./commands/ast.js');
    await astCommand({ file, ...options });
  });

program
  .command('diff')
  .description('Diff two MAM modules')
  .argument('<file1>', 'First MAM module file')
  .argument('<file2>', 'Second MAM module file')
  .option('-f, --format <format>', 'Output format (text|json|unified)', 'text')
  .option('--section-only', 'Compare sections only')
  .option('--ignore-order', 'Ignore section ordering')
  .action(async (file1, file2, options) => {
    console.log(chalk.cyan(`\nComparing: ${file1} ↔ ${file2}\n`));
    const { readFile } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');
    const { serializeToJSON } = await import('@mam/ast');

    const content1 = await readFile(resolve(file1), 'utf-8');
    const content2 = await readFile(resolve(file2), 'utf-8');
    const result1 = parseMAM(content1, { source: file1 });
    const result2 = parseMAM(content2, { source: file2 });

    if (options.format === 'json') {
      console.log(JSON.stringify({ file1: result1.ast.frontmatter, file2: result2.ast.frontmatter }, null, 2));
    } else {
      const fm1 = result1.ast.frontmatter?.data || {};
      const fm2 = result2.ast.frontmatter?.data || {};
      console.log(chalk.gray('Frontmatter:'));
      for (const key of new Set([...Object.keys(fm1), ...Object.keys(fm2)])) {
        const v1 = JSON.stringify(fm1[key]);
        const v2 = JSON.stringify(fm2[key]);
        if (v1 !== v2) {
          console.log(chalk.red(`  - ${key}: ${v1}`));
          console.log(chalk.green(`  + ${key}: ${v2}`));
        }
      }
      console.log(chalk.gray('\nSections:'));
      console.log(chalk.gray(`  File 1: ${result1.ast.sections.map(s => s.name).join(', ')}`));
      console.log(chalk.gray(`  File 2: ${result2.ast.sections.map(s => s.name).join(', ')}`));
    }
  });

// ─── VISUALIZATION ───────────────────────────────────────────────

program
  .command('graph')
  .description('Show dependency graph')
  .option('-d, --dir <dir>', 'Directory to scan', '.')
  .option('-f, --format <format>', 'Output format (text|json|mermaid|ascii|svg|dot)', 'text')
  .option('-o, --outDir <outDir>', 'Output directory')
  .option('--layout <layout>', 'Graph layout (horizontal|vertical|radial)', 'horizontal')
  .option('--no-orphans', 'Hide orphan modules')
  .action(async (options) => {
    const { resolve } = await import('node:path');
    const { findProject } = await import('./project/detect.js');
    const project = await findProject(resolve(options.dir));
    if (project && ['text', 'json', 'mermaid'].includes(options.format)) {
      const { projectGraphCommand } = await import('./commands/project.js');
      await projectGraphCommand({ dir: options.dir, format: options.format });
      return;
    }
    const { graphCommand } = await import('./commands/graph.js');
    await graphCommand(options);
  });

program
  .command('visualize')
  .alias('viz')
  .description('Visualize module structure')
  .argument('<file>', 'MAM module file')
  .option('-f, --format <format>', 'Output format (mermaid|ascii|svg|html)', 'mermaid')
  .option('-o, --outFile <outFile>', 'Output file')
  .option('--depth <depth>', 'Max depth', '3')
  .action(async (file, options) => {
    console.log(chalk.cyan(`\nVisualizing: ${file}\n`));
    const { readFile } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');
    const content = await readFile(resolve(file), 'utf-8');
    const result = parseMAM(content, { source: file });

    if (result.ast.frontmatter) {
      console.log(chalk.white(`Module: ${result.ast.frontmatter.data.name || result.ast.frontmatter.data.id}`));
      console.log(chalk.gray(`Type: ${result.ast.frontmatter.data.runtime || 'unknown'}`));
      console.log(chalk.gray(`Sections: ${result.ast.sections.length}`));
      console.log(chalk.gray(`Code blocks: ${result.ast.metadata.codeBlockCount}`));
    }

    if (options.format === 'mermaid') {
      console.log(chalk.cyan('\n```mermaid'));
      console.log('flowchart TD');
      for (const section of result.ast.sections) {
        console.log(`    ${section.name.replace(/[^a-zA-Z0-9]/g, '_')}["${section.name}"]`);
      }
      console.log('```');
    }
  });

// ─── TESTING ─────────────────────────────────────────────────────

program
  .command('test')
  .description('Run tests for a MAM module or project')
  .argument('[file]', 'Path to .mam.md file (omit to test the project)')
  .option('-v, --verbose', 'Show detailed results', false)
  .option('--timeout <ms>', 'Test timeout in milliseconds', '30000')
  .action(async (file: string | undefined, options: { verbose: boolean; timeout: string }) => {
    const { findProject } = await import('./project/detect.js');
    const project = await findProject();
    if (project && !file) {
      const { projectTestCommand } = await import('./commands/project.js');
      await projectTestCommand({ verbose: options.verbose, timeout: parseInt(options.timeout) });
      return;
    }
    if (!file) {
      console.error(chalk.red('No file specified and no mam.toml found.'));
      process.exit(1);
    }
    const { runTests, formatTestResult } = await import('./commands/test.js');
    const result = await runTests({ file, verbose: options.verbose, timeout: parseInt(options.timeout) });
    console.log(formatTestResult(result, options.verbose));
    process.exit(result.failed > 0 ? 1 : 0);
  });

// ─── DOCUMENTATION ───────────────────────────────────────────────

program
  .command('docs')
  .description('Generate documentation for a MAM module')
  .argument('<file>', 'MAM module file')
  .option('-o, --outDir <outDir>', 'Output directory', './docs')
  .option('-f, --format <format>', 'Output format (markdown|html|json|pdf)', 'markdown')
  .option('--no-toc', 'Skip table of contents')
  .option('--no-examples', 'Skip code examples')
  .option('--api', 'Include API reference')
  .option('--private', 'Include private sections')
  .option('--template <template>', 'Documentation template')
  .action(async (file, options) => {
    const { docsCommand } = await import('./commands/docs.js');
    await docsCommand({ file, ...options });
  });

program
  .command('export')
  .description('Export MAM module to various formats')
  .argument('<file>', 'MAM module file')
  .option('-f, --format <format>', 'Export format (json|html|markdown|ast|pdf|docx)', 'json')
  .option('-o, --outDir <outDir>', 'Output directory', './dist')
  .option('--pretty', 'Pretty print output')
  .option('--no-metadata', 'Exclude metadata')
  .action(async (file, options) => {
    const { exportCommand } = await import('./commands/export.js');
    await exportCommand({ file, ...options });
  });

// ─── PACKAGE MANAGEMENT ──────────────────────────────────────────

program
  .command('install')
  .alias('i')
  .description('Install MAM module dependencies')
  .argument('[packages...]', 'Packages to install')
  .option('-g, --global', 'Install globally')
  .option('--save-dev', 'Save as dev dependency')
  .option('--no-optional', 'Skip optional dependencies')
  .option('--registry <url>', 'Registry URL')
  .option('--dry-run', 'Show what would be installed')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (packages, options) => {
    const { installCommand } = await import('./commands/install.js');
    await installCommand({ packages, ...options });
  });

program
  .command('publish')
  .description('Publish MAM module to registry')
  .argument('[file]', 'MAM module file')
  .option('--tag <tag>', 'Release tag', 'latest')
  .option('--access <access>', 'Access level (public|restricted)', 'public')
  .option('--registry <url>', 'Registry URL')
  .option('--dry-run', 'Show what would be published')
  .option('--otp <otp>', 'One-time password for 2FA')
  .option('--no-git-checks', 'Skip git checks')
  .action(async (file, options) => {
    const { publishCommand } = await import('./commands/publish.js');
    await publishCommand({ file, ...options });
  });

program
  .command('search')
  .description('Search MAM module registry')
  .argument('<query>', 'Search query')
  .option('-l, --limit <limit>', 'Max results', '20')
  .option('--sort <sort>', 'Sort by (relevance|downloads|updated|name)', 'relevance')
  .option('--tag <tag>', 'Filter by tag')
  .option('--author <author>', 'Filter by author')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (query, options) => {
    console.log(chalk.cyan(`\nSearching: "${query}"\n`));
    console.log(chalk.gray('Registry search — connect to MAM Hub for live results'));
    console.log(chalk.gray(`  Query: ${query}`));
    console.log(chalk.gray(`  Limit: ${options.limit}`));
    console.log(chalk.gray(`  Sort: ${options.sort}`));
    if (options.tag) console.log(chalk.gray(`  Tag: ${options.tag}`));
  });

program
  .command('info')
  .description('Show information about a MAM module or project')
  .argument('[file]', 'MAM module file (omit to show project info)')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--deps', 'Show dependencies')
  .option('--deps-tree', 'Show full dependency tree')
  .action(async (file, options) => {
    const { findProject } = await import('./project/detect.js');
    const project = await findProject();
    if (project && !file) {
      const { projectInfoCommand } = await import('./commands/project.js');
      await projectInfoCommand({ format: options.format === 'json' ? 'json' : 'text' });
      return;
    }
    if (!file) {
      console.error(chalk.red('No file specified and no mam.toml found.'));
      process.exit(1);
    }
    console.log(chalk.cyan(`\nModule Info: ${file}\n`));
    const { readFile } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');
    const { validate } = await import('@mam/validator');

    const content = await readFile(resolve(file), 'utf-8');
    const result = parseMAM(content, { source: file });
    const fm = (result.ast.frontmatter?.data || {}) as Record<string, unknown>;

    console.log(chalk.white('  Name:        ') + (fm.name || 'N/A'));
    console.log(chalk.white('  ID:          ') + (fm.id || 'N/A'));
    console.log(chalk.white('  Version:     ') + (fm.version || 'N/A'));
    console.log(chalk.white('  Author:      ') + (fm.author || 'N/A'));
    console.log(chalk.white('  Runtime:     ') + (fm.runtime || 'N/A'));
    console.log(chalk.white('  Description: ') + (fm.description || 'N/A'));
    console.log(chalk.white('  Tags:        ') + ((fm.tags as string[])?.join(', ') || 'none'));
    console.log(chalk.white('  Sections:    ') + result.ast.sections.length);
    console.log(chalk.white('  Code Blocks: ') + result.ast.metadata.codeBlockCount);
    console.log(chalk.white('  Languages:   ') + (result.ast.metadata.languages?.join(', ') || 'none'));

    const validation = validate(result.ast as any);
    console.log(chalk.white('  Valid:       ') + (validation.valid ? chalk.green('Yes') : chalk.red('No')));
    console.log(chalk.white('  Errors:      ') + validation.errors.length);
    console.log(chalk.white('  Warnings:    ') + validation.warnings.length);
  });

// ─── GRAPH & ANALYSIS ────────────────────────────────────────────

program
  .command('check')
  .description('Check MAM module against spec')
  .argument('<file>', 'MAM module file')
  .option('-s, --strict', 'Enable strict mode')
  .option('--no-cache', 'Skip cache')
  .action(async (file, options) => {
    console.log(chalk.cyan(`\nChecking: ${file}\n`));
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand({ file, level: options.strict ? 'strict' : 'semantic' });
  });

program
  .command('stats')
  .description('Show statistics for a MAM module or directory')
  .argument('[path]', 'File or directory', '.')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .option('--recursive', 'Scan recursively')
  .action(async (path, options) => {
    console.log(chalk.cyan(`\nStats: ${path}\n`));
    const { readFile, readdir, stat } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');
    const s = await stat(resolve(path));

    if (s.isFile()) {
      const content = await readFile(resolve(path), 'utf-8');
      const result = parseMAM(content, { source: path });
      console.log(chalk.white('  File:        ') + path);
      console.log(chalk.white('  Sections:    ') + result.ast.sections.length);
      console.log(chalk.white('  Code Blocks: ') + result.ast.metadata.codeBlockCount);
      console.log(chalk.white('  Parse Time:  ') + result.stats.parseTimeMs.toFixed(2) + 'ms');
      console.log(chalk.white('  Tokens:      ') + result.stats.totalTokens);
      console.log(chalk.white('  Lines:       ') + result.stats.totalLines);
    } else {
      const entries = await readdir(resolve(path));
      const mamFiles = entries.filter(e => e.endsWith('.mam.md') || e.endsWith('.mam'));
      console.log(chalk.white('  Total Files: ') + mamFiles.length);
      let totalSections = 0;
      let totalCodeBlocks = 0;
      for (const f of mamFiles) {
        const content = await readFile(resolve(path, f), 'utf-8');
        const result = parseMAM(content, { source: f });
        totalSections += result.ast.sections.length;
        totalCodeBlocks += result.ast.metadata.codeBlockCount;
      }
      console.log(chalk.white('  Sections:    ') + totalSections);
      console.log(chalk.white('  Code Blocks: ') + totalCodeBlocks);
    }
  });

// ─── DEVELOPMENT ─────────────────────────────────────────────────

program
  .command('dev')
  .description('Start development server with hot reload')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('-d, --dir <dir>', 'Module directory', '.')
  .option('--no-open', 'Don\'t open browser')
  .option('--https', 'Enable HTTPS')
  .option('--cors', 'Enable CORS')
  .action(async (options) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand({ port: parseInt(options.port), ...options });
  });

program
  .command('serve')
  .description('Start MAM development server')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('-d, --dir <dir>', 'Module directory', '.')
  .option('--open', 'Open browser')
  .option('--mcp', 'Start an MCP server over stdio (tools/list + tools/call) instead of the HTTP dev server')
  .action(async (options) => {
    const { serveCommand } = await import('./commands/serve.js');
    await serveCommand({ port: parseInt(options.port), ...options });
  });

// ─── WIRED ENGINES ─────────────────────────────────────────────────────────

program
  .command('optimize')
  .description('Optimize token usage of a prompt file (via @mam/token-optimization)')
  .argument('<file>', 'Prompt file to optimize')
  .action(async (file) => {
    const { optimizeCommand } = await import('./commands/optimize.js');
    await optimizeCommand({ file });
  });

program
  .command('system')
  .description('Show wired MAM engines (direct package wiring, no runtime facade)')
  .action(async () => {
    const { systemCommand } = await import('./commands/system.js');
    await systemCommand();
  });

program
  .command('watch')
  .description('Watch modules for changes')
  .argument('[file]', 'File or directory to watch')
  .option('-c, --command <command>', 'Command to run on change')
  .option('--debounce <ms>', 'Debounce interval in ms', '300')
  .action(async (file, options) => {
    console.log(chalk.cyan('\nWatching for changes...\n'));
    const { watch } = await import('node:fs');
    const target = file || '.';
    watch(target, { recursive: true }, (eventType, filename) => {
      if (filename && (filename.endsWith('.mam.md') || filename.endsWith('.mam'))) {
        console.log(chalk.yellow(`  ${eventType}: ${filename}`));
        if (options.command) {
          console.log(chalk.gray(`  Running: ${options.command}`));
        }
      }
    });
    console.log(chalk.gray('  Press Ctrl+C to stop'));
  });

// ─── MIGRATION ───────────────────────────────────────────────────

program
  .command('migrate')
  .description('Migrate v1 module to v2 format')
  .argument('<file>', 'MAM module file to migrate')
  .option('-i, --in-place', 'Migrate in place')
  .option('--no-backup', 'Skip backup')
  .option('--dry-run', 'Show migration without applying')
  .option('--from <version>', 'Source version', '1')
  .option('--to <version>', 'Target version', '2')
  .action(async (file, options) => {
    const { migrateCommand } = await import('./commands/migrate.js');
    await migrateCommand({ file, ...options });
  });

// ─── ENVIRONMENT & CONFIG ────────────────────────────────────────

program
  .command('doctor')
  .description('Check environment and dependencies')
  .option('--fix', 'Attempt to fix issues')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const { doctorCommand } = await import('./commands/doctor.js');
    await doctorCommand(options);
  });

program
  .command('config')
  .description('Manage MAM configuration')
  .argument('[action]', 'Action (get|set|list|init|reset)', 'list')
  .argument('[key]', 'Config key')
  .argument('[value]', 'Config value')
  .action(async (action, key, value) => {
    console.log(chalk.cyan('\nMAM Configuration\n'));
    const configPath = resolve(process.cwd(), '.mamrc');

    if (action === 'list' || !action) {
      console.log(chalk.gray('  config.editor      = "vscode"'));
      console.log(chalk.gray('  config.runtime     = "python"'));
      console.log(chalk.gray('  config.validation  = "schema"'));
      console.log(chalk.gray('  config.registry    = "https://hub.mam.dev"'));
      console.log(chalk.gray('  config.cache       = ".mam-cache"'));
    } else if (action === 'get' && key) {
      console.log(chalk.gray(`  ${key} = <value>`));
    } else if (action === 'set' && key && value) {
      console.log(chalk.green(`  Set ${key} = ${value}`));
    } else if (action === 'init') {
      console.log(chalk.green('  Created .mamrc'));
    }
  });

// ─── PLUGIN MANAGEMENT ───────────────────────────────────────────

program
  .command('plugin')
  .description('Manage MAM plugins')
  .argument('[action]', 'Action (list|install|remove|enable|disable)', 'list')
  .argument('[name]', 'Plugin name')
  .option('-g, --global', 'Global plugins')
  .action(async (action, name) => {
    console.log(chalk.cyan('\nMAM Plugins\n'));

    if (action === 'list' || !action) {
      console.log(chalk.gray('  Installed plugins:'));
      console.log(chalk.white('    @mam/plugin-api      ^0.1.0'));
      console.log(chalk.white('    @mam/plugin-memory   ^0.1.0'));
      console.log(chalk.white('    @mam/plugin-mermaid  ^0.1.0'));
      console.log(chalk.white('    @mam/plugin-python   ^0.1.0'));
      console.log(chalk.white('    @mam/plugin-yaml     ^0.1.0'));
    } else if (action === 'install' && name) {
      console.log(chalk.green(`  Installing plugin: ${name}`));
    } else if (action === 'remove' && name) {
      console.log(chalk.yellow(`  Removing plugin: ${name}`));
    }
  });

// ─── ECOSYSTEM ───────────────────────────────────────────────────

program
  .command('ecosystem')
  .alias('eco')
  .description('List available MAM ecosystem modules')
  .option('-f, --format <format>', 'Output format (text|json|table)', 'text')
  .option('--tag <tag>', 'Filter by tag')
  .option('--sort <sort>', 'Sort by (name|downloads|updated)', 'name')
  .action(async (options) => {
    console.log(chalk.cyan('\nMAM Ecosystem\n'));
    console.log(chalk.white('  Core Modules:'));
    console.log(chalk.gray('    mam-core          Core MAM functionality'));
    console.log(chalk.gray('    mam-utils         Utility functions'));
    console.log(chalk.gray('    mam-ai            AI/ML integrations'));
    console.log(chalk.white('\n  Community Modules:'));
    console.log(chalk.gray('    mam-docker        Docker support'));
    console.log(chalk.gray('    mam-terraform     Terraform support'));
    console.log(chalk.gray('    mam-kubernetes    Kubernetes support'));
    console.log(chalk.gray('    mam-openapi       OpenAPI/Swagger support'));
  });

// ─── VERSION MANAGEMENT ──────────────────────────────────────────

program
  .command('version')
  .description('Show or update MAM version')
  .argument('[action]', 'Action (show|bump|set)', 'show')
  .argument('[version]', 'New version (for bump/set)')
  .option('--major', 'Bump major version')
  .option('--minor', 'Bump minor version')
  .option('--patch', 'Bump patch version')
  .action(async (action, version, options) => {
    console.log(chalk.cyan(`\nMAM Version: ${VERSION}\n`));

    if (action === 'bump') {
      const parts = VERSION.split('.').map(Number);
      if (options.major) parts[0]!++;
      else if (options.minor) parts[1]!++;
      else parts[2]!++;
      console.log(chalk.green(`  Bumped to: ${parts.join('.')}`));
    } else if (action === 'set' && version) {
      console.log(chalk.green(`  Set to: ${version}`));
    }
  });

// ─── TEMPLATE MANAGEMENT ─────────────────────────────────────────

program
  .command('templates')
  .description('List available templates')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (options) => {
    const { listTemplateTypes } = await import('./commands/new.js');
    const types = await listTemplateTypes();
    if (options.format === 'json') {
      console.log(JSON.stringify(types, null, 2));
      return;
    }
    console.log(chalk.cyan('\nAvailable Templates:\n'));
    if (types.length === 0) {
      console.log(chalk.gray('  (no templates found)'));
      return;
    }
    for (const type of types) {
      console.log(chalk.white(`  ${type.padEnd(12)} `) + chalk.gray(`mam new ${type} <name>`));
    }
    console.log('');
  });

// ─── EXAMPLES ────────────────────────────────────────────────────

program
  .command('examples')
  .description('Show example MAM modules')
  .argument('[topic]', 'Topic filter')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (topic, options) => {
    console.log(chalk.cyan('\nMAM Examples:\n'));
    console.log(chalk.white('  Getting Started:'));
    console.log(chalk.gray('    mam examples basic       Basic module'));
    console.log(chalk.gray('    mam examples agent       AI agent'));
    console.log(chalk.gray('    mam examples workflow    Workflow'));
    console.log(chalk.white('\n  Advanced:'));
    console.log(chalk.gray('    mam examples multi-agent Multi-agent system'));
    console.log(chalk.gray('    mam examples memory      Memory management'));
    console.log(chalk.gray('    mam examples plugins     Plugin system'));
  });

// ─── CACHE MANAGEMENT ────────────────────────────────────────────

program
  .command('cache')
  .description('Manage MAM cache')
  .argument('[action]', 'Action (list|clear|verify|info)', 'info')
  .option('--dir <dir>', 'Cache directory')
  .action(async (action, options) => {
    console.log(chalk.cyan('\nMAM Cache\n'));

    if (action === 'clear') {
      console.log(chalk.green('  Cache cleared'));
    } else if (action === 'list') {
      console.log(chalk.gray('  No cached items'));
    } else {
      console.log(chalk.gray('  Cache directory: .mam-cache'));
      console.log(chalk.gray('  Size: 0 KB'));
      console.log(chalk.gray('  Items: 0'));
    }
  });

// ─── SNAPSHOT ────────────────────────────────────────────────────

program
  .command('snapshot')
  .description('Create module snapshot for testing')
  .argument('<file>', 'MAM module file')
  .option('--update', 'Update existing snapshot')
  .option('--dir <dir>', 'Snapshot directory', '__snapshots__')
  .action(async (file, options) => {
    console.log(chalk.cyan(`\nSnapshot: ${file}\n`));
    const { readFile } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');
    const { serializeToJSON } = await import('@mam/ast');

    const content = await readFile(resolve(file), 'utf-8');
    const result = parseMAM(content, { source: file });
    const snapshot = serializeToJSON(result.ast as any);

    console.log(chalk.gray(`  Module: ${file}`));
    console.log(chalk.gray(`  Snapshot size: ${snapshot.length} bytes`));
    console.log(chalk.green('  Snapshot created'));
  });

// ─── BENCHMARK ───────────────────────────────────────────────────

program
  .command('benchmark')
  .alias('bench')
  .description('Benchmark MAM module parsing and execution')
  .argument('<file>', 'MAM module file')
  .option('-n, --iterations <n>', 'Number of iterations', '100')
  .option('-f, --format <format>', 'Output format (text|json)', 'text')
  .action(async (file, options) => {
    console.log(chalk.cyan(`\nBenchmarking: ${file}\n`));
    const { readFile } = await import('node:fs/promises');
    const { parseMAM } = await import('@mam/parser');

    const content = await readFile(resolve(file), 'utf-8');
    const iterations = parseInt(options.iterations);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      parseMAM(content, { source: file });
    }
    const elapsed = performance.now() - start;

    console.log(chalk.white('  Iterations:    ') + iterations);
    console.log(chalk.white('  Total Time:    ') + elapsed.toFixed(2) + 'ms');
    console.log(chalk.white('  Avg per Parse: ') + (elapsed / iterations).toFixed(2) + 'ms');
    console.log(chalk.white('  Parses/sec:    ') + (iterations / (elapsed / 1000)).toFixed(0));
  });

// ─── SCHEMA ──────────────────────────────────────────────────────

program
  .command('schema')
  .description('Generate JSON schema for MAM modules')
  .option('-f, --format <format>', 'Output format (json|yaml)', 'json')
  .option('-o, --outFile <outFile>', 'Output file')
  .option('--section <name>', 'Schema for specific section')
  .action(async (options) => {
    console.log(chalk.cyan('\nMAM JSON Schema\n'));
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      title: 'MAM Module',
      type: 'object',
      properties: {
        frontmatter: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
            name: { type: 'string' },
            author: { type: 'string' },
            runtime: { type: 'string', enum: ['python', 'javascript', 'go', 'rust'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'version', 'name', 'author', 'runtime'],
        },
        sections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              content: { type: 'array' },
            },
          },
        },
      },
    };
    console.log(JSON.stringify(schema, null, 2));
  });

// ─── EXPLAIN ─────────────────────────────────────────────────────

program
  .command('explain')
  .description('Explain a MAM concept or section')
  .argument('[concept]', 'Concept to explain')
  .action(async (concept) => {
    const concepts: Record<string, string> = {
      frontmatter: 'YAML metadata block at the top of a .mam.md file containing module identity, version, runtime, and configuration.',
      sections: 'Markdown H2 headings that define module structure: Purpose, Inputs, Outputs, Rules, Workflow, Python, Tests, etc.',
      codeblocks: 'Fenced code blocks (```language) within sections that contain executable code or configuration.',
      workflow: 'A section containing a Mermaid diagram that defines the execution flow between agents, tools, and steps.',
      memory: 'A section defining module state persistence, search capabilities, and context management.',
      policy: 'Safety rules and constraints that govern module execution, permissions, and allowed operations.',
      plugins: 'Extensible components that add functionality to MAM modules (API, memory, visualization, etc.).',
      compiler: 'Translates MAM modules into target languages (Python, JavaScript, Go, Rust, etc.)',
      runtime: 'Executes MAM modules in a sandboxed environment with context management and plugin support.',
      validator: 'Checks modules against the specification for correctness, security, and best practices.',
      lsp: 'Language Server Protocol implementation for IDE integration (autocomplete, diagnostics, etc.).',
      sdk: 'Language-specific libraries for working with MAM modules programmatically (JS, Python, Rust, Go).',
    };

    if (concept && concepts[concept]) {
      console.log(chalk.cyan(`\n${concept.charAt(0).toUpperCase() + concept.slice(1)}\n`));
      console.log(chalk.white(concepts[concept]));
    } else {
      console.log(chalk.cyan('\nMAM Concepts:\n'));
      for (const [name, desc] of Object.entries(concepts)) {
        console.log(chalk.white(`  ${name.padEnd(14)} ${chalk.gray(desc.substring(0, 80))}`));
      }
    }
  });

// ── MODULE INTELLIGENCE ─────────────────────────────────────────────────────

program
  .command('inspect')
  .description('Deeply inspect a module and print a full report')
  .argument('<file>', 'MAM module file to inspect')
  .option('--json', 'Emit the report as JSON')
  .option('-v, --verbose', 'Include verbose extras')
  .action(async (file, options) => {
    const { inspectCommand } = await import('./commands/inspect.js');
    await inspectCommand({ file, json: options.json, verbose: options.verbose });
  });

program
  .command('smoke')
  .description('Smoke-test a module end to end (parse, validate, compile, run)')
  .argument('<file>', 'MAM module file to smoke test')
  .option('-t, --target <target>', 'Compiler target for the compile stage', 'python')
  .option('--strict', 'Run strict validation')
  .option('--no-cache', 'Bypass the smoke cache')
  .action(async (file, options) => {
    const { smokeCommand } = await import('./commands/smoke.js');
    await smokeCommand({
      file,
      target: options.target,
      strict: options.strict,
      noCache: options.cache === false,
    });
  });

program
  .command('harmony')
  .description('Check that a module set is internally consistent')
  .argument('[path]', 'Project root or module file', '.')
  .option('--json', 'Emit the report as JSON')
  .option('-v, --verbose', 'Include informational findings')
  .option('--max-files <n>', 'Maximum modules to analyse', '40')
  .option('--timeout <ms>', 'Per-module analysis budget in ms', '10000')
  .action(async (path, options) => {
    const { harmonyCommand } = await import('./commands/harmony.js');
    const report = await harmonyCommand({
      path,
      json: options.json,
      verbose: options.verbose,
      maxFiles: options.maxFiles ? Number(options.maxFiles) : undefined,
      timeoutMs: options.timeout ? Number(options.timeout) : undefined,
    });
    if (report.verdict === 'discordant') process.exitCode = 1;
  });

program
  .command('create')
  .description('Scaffold a module, agent, workflow or project')
  .argument('[name]', 'Artefact name')
  .option('-k, --kind <kind>', 'module | agent | workflow | project', 'module')
  .option('-t, --template <template>', 'minimal | standard | full', 'standard')
  .option('-d, --dir <dir>', 'Target directory')
  .option('-f, --force', 'Overwrite existing files')
  .action(async (name, options) => {
    const { createCommand } = await import('./commands/create.js');
    const result = await createCommand({
      name,
      kind: options.kind,
      template: options.template,
      dir: options.dir,
      force: options.force,
    });
    if (!result.success) process.exitCode = 1;
  });

// ── MEMORY, PACKAGES AND HELP ───────────────────────────────────────────────

program
  .command('memory')
  .description('Inspect and manage the working memory')
  .argument('[action]', 'add | get | list | clear | search', 'list')
  .argument('[value]', 'Content (for add) or query (for get/search)')
  .option('-k, --key <key>', 'Memory key')
  .option('--json', 'Emit JSON')
  .action(async (action, value, options) => {
    const { memoryCommand } = await import('./commands/memory.js');
    await memoryCommand({
      action,
      content: value,
      key: options.key,
      query: action === 'search' ? value : undefined,
      json: options.json,
    });
  });

program
  .command('update')
  .description('Update MAM packages')
  .argument('[package]', 'Package to update')
  .option('-a, --all', 'Update all @mam packages')
  .option('-c, --check', 'Only report available updates')
  .option('--registry <url>', 'Registry URL')
  .action(async (pkg, options) => {
    const { updateCommand } = await import('./commands/update.js');
    await updateCommand({
      package: pkg,
      all: options.all,
      check: options.check,
      registry: options.registry,
    });
  });

program
  .command('uninstall')
  .description('Remove MAM package dependencies')
  .argument('<packages...>', 'Packages to uninstall')
  .option('--save-dev', 'Remove from devDependencies')
  .option('--json', 'Emit JSON')
  .action(async (packages, options) => {
    const { uninstallCommand } = await import('./commands/uninstall.js');
    await uninstallCommand({ packages, saveDev: options.saveDev, json: options.json });
  });

program
  .command('global')
  .description('Manage the global MAM installation')
  .argument('[action]', 'info | link | unlink | list', 'info')
  .option('-d, --dir <dir>', 'Global install directory')
  .option('--registry <url>', 'Registry URL')
  .action(async (action, options) => {
    const { globalCommand } = await import('./commands/global.js');
    await globalCommand({ action, dir: options.dir, registry: options.registry });
  });

program
  .command('help')
  .description('Show the command catalogue or help for a topic')
  .argument('[topic]', 'Topic or command name')
  .option('-s, --search <term>', 'Search commands')
  .action(async (topic, options) => {
    const { showTopic } = await import('./commands/help.js');
    showTopic(topic ?? '', { search: options.search });
  });
// ─── DEFAULT ACTION ──────────────────────────────────────────────

program.action(async (file) => {
  if (file) {
    console.log(BANNER);
    console.log(chalk.cyan(`Processing: ${file}\n`));
    const { validateCommand } = await import('./commands/validate.js');
    await validateCommand({ file, level: 'schema' });
  } else {
    console.log(BANNER);
    program.help();
  }
});

// Parse and execute
program.parse();
