/**
 * MAM Init Command
 *
 * Bootstraps MAM modules (`mam init <name>`) and MAM projects
 * (`mam init <name> --project`).
 *
 * The module path is the historic one: pick a template from the small built-in
 * catalogue, render it against the module name and write `<name>.mam`.
 *
 * Around that core this module provides the reusable pieces:
 *
 *   - {@link listTemplates} / {@link describeTemplate} — the template catalogue
 *   - {@link validateTemplate} / {@link validateModuleName} — input validation
 *   - {@link ensureDir} / {@link writeFileIfAbsent} — filesystem helpers that
 *     respect `--force`
 *   - {@link renderGitignore} / {@link renderReadme} / {@link renderMamToml} —
 *     the `--project` scaffolding content
 *
 * Everything is exported so the MCP server and the docs generator can render
 * the same catalogue the CLI shows.
 *
 * @module init
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import chalk from 'chalk';

/** Names of the templates shipped with the CLI. */
export type TemplateName = 'basic' | 'advanced' | 'workflow';

/** Description of one scaffold template. */
export interface TemplateInfo {
  /** Template key, as accepted by `--template`. */
  name: TemplateName;
  /** One-line summary shown by `mam init --list-templates`. */
  summary: string;
  /** The `type:` value written into the module frontmatter. */
  moduleType: string;
  /** Tags written into the frontmatter. */
  tags: string[];
  /** The sections the generated module contains. */
  sections: string[];
}

export interface InitOptions {
  name: string;
  template?: TemplateName;
  dir?: string;
  /** Overwrite existing files instead of failing. */
  force?: boolean;
  /** Print the resolved plan without touching the filesystem. */
  dryRun?: boolean;
  /** Suppress non-essential output. */
  quiet?: boolean;
}

/** Options accepted by {@link initProject}. */
export interface InitProjectOptions {
  /** Project (and workspace) name. */
  name: string;
  /** Directory the project is created in. Defaults to the current directory. */
  dir?: string;
  /** Overwrite existing files instead of failing. */
  force?: boolean;
  /** Print the resolved plan without touching the filesystem. */
  dryRun?: boolean;
  /** Suppress non-essential output. */
  quiet?: boolean;
}

/** Result of {@link initProject}. */
export interface InitProjectResult {
  /** Whether the project was created (or, for a dry run, would be). */
  success: boolean;
  /** Absolute path of the project root. */
  root: string;
  /** Absolute paths of every file the run created or would create. */
  files: string[];
  /** Files that already existed and were left untouched. */
  skipped: string[];
  /** Failure reason, when `success` is `false`. */
  error?: string;
}

const TEMPLATES = {
  basic: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 2.0.0
type: module
author: Your Name
license: MIT
tags: [mam, module]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

A new MAM module.

## Purpose

Describe what this module does.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input | string | Yes | Input description |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output | string | Output description |

## Rules

- Rule 1
- Rule 2

## Workflow

- Step 1: Validate input
- Step 2: Process data
- Step 3: Return result

## Tests

Test the module with sample inputs.

## Examples

\`\`\`python
from ${name.replace(/-/g, '_')} import main
result = main(input="test")
print(result)
\`\`\`
`,

  advanced: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 2.0.0
type: module
author: Your Name
license: MIT
tags: [mam, module, advanced]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

An advanced MAM module with multiple capabilities.

## Purpose

Advanced module with parallel processing and branching.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | array | Yes | Input data array |
| options | object | No | Configuration options |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | array | Processed results |
| metadata | object | Processing metadata |

## Capabilities

- Parallel processing
- Error handling
- Caching

## Rules

- Handle errors gracefully
- Log all operations
- Validate input before processing

## Workflow

- Step 1: Validate and parse input
- Step 2: Check cache for existing results
- Step 3: Process data in parallel
- Step 4: Merge results
- Step 5: Update cache
- Step 6: Return results with metadata

## Permissions

- Network: outbound HTTP requests
- Filesystem: read/write cache directory

## Tests

Test parallel processing with large datasets.

## Examples

\`\`\`python
from ${name.replace(/-/g, '_')} import process
results = process(data=[1, 2, 3], options={"parallel": True})
\`\`\`
`,

  workflow: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 2.0.0
type: workflow
author: Your Name
license: MIT
tags: [mam, workflow, pipeline]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

A multi-step workflow with branching.

## Purpose

Orchestrate complex multi-step processes.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Data source |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | Workflow status |
| artifacts | array | Generated artifacts |

## Workflow

- Step 1: Fetch data from source
- Step 2: Validate data format
- Step 3: Transform data
- Step 4: Branch: if large dataset, use parallel processing
- Step 5: Generate output artifacts
- Step 6: Cleanup temporary files
- Step 7: Return status and artifacts

## Rules

- Never skip validation steps
- Log all state transitions
- Rollback on failure

## Tests

Test workflow with various data sources and sizes.
`
};

/**
 * Metadata for each bundled template.
 *
 * Kept next to the renderers so `describeTemplate` and the `--help` output can
 * never drift from what is actually scaffolded.
 */
const TEMPLATE_INFO: Readonly<Record<TemplateName, TemplateInfo>> = {
  basic: {
    name: 'basic',
    summary: 'Single-purpose module with inputs, outputs, rules and tests.',
    moduleType: 'module',
    tags: ['mam', 'module'],
    sections: ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Workflow', 'Tests', 'Examples'],
  },
  advanced: {
    name: 'advanced',
    summary: 'Module with parallel processing, caching, permissions and metadata.',
    moduleType: 'module',
    tags: ['mam', 'module', 'advanced'],
    sections: ['Purpose', 'Inputs', 'Outputs', 'Capabilities', 'Rules', 'Workflow', 'Permissions', 'Tests', 'Examples'],
  },
  workflow: {
    name: 'workflow',
    summary: 'Multi-step workflow with branching and artifact generation.',
    moduleType: 'workflow',
    tags: ['mam', 'workflow', 'pipeline'],
    sections: ['Purpose', 'Inputs', 'Outputs', 'Workflow', 'Rules', 'Tests'],
  },
};

/**
 * Every template name, in listing order.
 *
 * @returns the template keys.
 */
export function templateNames(): TemplateName[] {
  return Object.keys(TEMPLATE_INFO) as TemplateName[];
}

/**
 * Describe one template.
 *
 * @param name - template key.
 * @returns the {@link TemplateInfo}, or `undefined` for unknown keys.
 */
export function describeTemplate(name: string): TemplateInfo | undefined {
  return TEMPLATE_INFO[name as TemplateName];
}

/**
 * The template catalogue used by `mam init --list-templates`.
 *
 * @returns one {@link TemplateInfo} per template, in listing order.
 */
export function listTemplates(): TemplateInfo[] {
  return templateNames().map((name) => TEMPLATE_INFO[name]);
}

/**
 * Render the template catalogue as an aligned text table.
 *
 * @returns the rendered lines.
 */
export function renderTemplateCatalogue(): string[] {
  const templates = listTemplates();
  const width = templates.reduce((n, t) => Math.max(n, t.name.length), 0) + 2;
  const lines = ['', chalk.cyan.bold('Available templates'), ''];
  for (const template of templates) {
    lines.push(`  ${chalk.cyan(template.name.padEnd(width))} ${chalk.gray(template.summary)}`);
    lines.push(`  ${' '.repeat(width)} ${chalk.white(`type: ${template.moduleType}`)} ${chalk.gray(`· ${template.tags.join(', ')}`)}`);
    lines.push(`  ${' '.repeat(width)} ${chalk.gray(`sections: ${template.sections.join(', ')}`)}`);
    lines.push('');
  }
  lines.push(chalk.gray('  Usage: mam init <name> --template <template>'));
  lines.push('');
  return lines;
}

/**
 * Print the template catalogue.
 *
 * @param json - emit JSON instead of the text table.
 * @returns the catalogue that was printed.
 */
export function templates(json = false): TemplateInfo[] {
  const catalogue = listTemplates();
  if (json) console.log(JSON.stringify(catalogue, null, 2));
  else console.log(renderTemplateCatalogue().join('\n'));
  return catalogue;
}

/**
 * Validate a template name.
 *
 * @param name - candidate template key.
 * @returns `true` when the template exists.
 */
export function isValidTemplate(name: string): name is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_INFO, name);
}

/**
 * Validate a requested template, normalising case and surrounding whitespace.
 *
 * @param name - candidate template key.
 * @returns the resolved template name and an error message when invalid.
 */
export function validateTemplate(name?: string): { valid: boolean; template: TemplateName; error?: string } {
  if (name === undefined || name === '') return { valid: true, template: 'basic' };
  const needle = String(name).trim().toLowerCase();
  if (isValidTemplate(needle)) return { valid: true, template: needle };
  return {
    valid: false,
    template: 'basic',
    error: `Unknown template: "${name}". Available templates: ${templateNames().join(', ')}.`,
  };
}

/**
 * Validate a module name against the MAM identifier rules.
 *
 * Names become file names and frontmatter `id:` values, so anything that is
 * not `[A-Za-z0-9_-]+` is rejected rather than silently sanitised.
 *
 * @param name - candidate module name.
 * @returns `true` when the name is usable.
 */
export function validateModuleName(name: string): boolean {
  return typeof name === 'string' && /^[a-zA-Z0-9-_]+$/.test(name);
}

/**
 * Derive a human readable title from a module name.
 *
 * @param name - module name, typically kebab-case.
 * @returns the title-cased form.
 */
export function titleFromModuleName(name: string): string {
  return name.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Ensure a directory exists, creating parents as needed.
 *
 * @param dir - absolute directory path.
 * @returns the directory path, for chaining.
 */
export async function ensureDir(dir: string): Promise<string> {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Write a file unless it already exists and `force` was not requested.
 *
 * @param path - absolute file path.
 * @param content - file contents.
 * @param force - overwrite an existing file.
 * @returns whether the file was written.
 */
export async function writeFileIfAbsent(path: string, content: string, force: boolean): Promise<boolean> {
  if (existsSync(path) && !force) return false;
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
  return true;
}

/**
 * Render the `.gitignore` shipped with a new project.
 *
 * The ignore list mirrors the directories the build commands create, so a
 * freshly initialised project never commits build output.
 *
 * @returns the `.gitignore` contents.
 */
export function renderGitignore(): string {
  return `# MAM
mam.lock
*.log

# Build output
dist/
build/
out/
*.tsbuildinfo

# Generated module artefacts
*.gen.mam

# Dependencies
node_modules/

# Editor / OS
.DS_Store
Thumbs.db
.idea/
.vscode/
`;
}

/**
 * Render the README for a new project.
 *
 * @param name - project name.
 * @returns the Markdown contents.
 */
export function renderReadme(name: string): string {
  const title = titleFromModuleName(name);
  return `# ${title}

A [MAM](https://github.com/tcp-ecosystems/MAM) project.

## Layout

| Path | Purpose |
|------|---------|
| \`mam.toml\` | Project manifest: modules, dependencies and build targets |
| \`modules/\` | Module sources (\`.mam\`) |
| \`tests/\` | Test modules and fixtures |
| \`dist/\` | Compiler output (git-ignored) |

## Getting started

\`\`\`bash
mam build            # compile every module declared in mam.toml
mam graph            # show the dependency graph
mam test             # run the module test suites
mam fmt --check -d modules   # assert formatting in CI
\`\`\`

## Adding modules

\`\`\`bash
mam init ${name}-helper            # a basic module
mam new agent ${name}-reviewer    # from the shared template catalogue
\`\`\`

## Conventions

- One concern per module; keep frontmatter \`type:\` accurate.
- Every module needs \`## Purpose\`, \`## Rules\`, \`## Workflow\` and \`## Tests\`.
- Run \`mam fmt --check\` before opening a pull request.
`;
}

/**
 * Render the `mam.toml` manifest for a new project.
 *
 * @param name - project name.
 * @returns the TOML contents.
 */
export function renderMamToml(name: string): string {
  return `# MAM project manifest
# Generated by \`mam init ${name} --project\`

[project]
name = "${name}"
version = "0.1.0"
description = "A MAM project"
runtime = "python >=3.12"

[modules]
paths = ["modules/**/*.mam"]
tests = ["tests/**/*.mam"]

[build]
outDir = "dist"
targets = ["python", "typescript"]

[validate]
level = "schema"
`;
}

/**
 * Create a new MAM project layout.
 *
 * Writes `mam.toml`, `.gitignore`, `README.md` and a starter `modules/`
 * directory. Honours `--force` (overwrite) and `--dry-run` (report only).
 *
 * @param options - project init options.
 * @returns the {@link InitProjectResult}.
 */
export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const { name, dir = '.', force = false, dryRun = false, quiet = false } = options;

  if (!validateModuleName(name)) {
    return {
      success: false,
      root: '',
      files: [],
      skipped: [],
      error: 'Invalid project name. Use only letters, numbers, hyphens, and underscores.',
    };
  }

  const root = resolve(dir);
  const plan: Array<{ path: string; content: string }> = [
    { path: join(root, 'mam.toml'), content: renderMamToml(name) },
    { path: join(root, '.gitignore'), content: renderGitignore() },
    { path: join(root, 'README.md'), content: renderReadme(name) },
    { path: join(root, 'modules', `${name}.mam`), content: TEMPLATES.basic(name) },
  ];

  if (dryRun) {
    if (!quiet) {
      console.log(chalk.cyan.bold('\nPlan'));
      console.log('');
      for (const item of plan) {
        const status = existsSync(item.path) ? chalk.yellow('overwrite') : chalk.green('create ');
        console.log(`  ${status}  ${relative(root, item.path) || item.path}`);
      }
      console.log('');
    }
    return { success: true, root, files: plan.map((p) => p.path), skipped: [] };
  }

  await ensureDir(join(root, 'modules'));

  const created: string[] = [];
  const skipped: string[] = [];
  for (const item of plan) {
    if (await writeFileIfAbsent(item.path, item.content, force)) created.push(item.path);
    else skipped.push(item.path);
  }

  if (!quiet) {
    for (const file of created) console.log(chalk.green(`created  ${relative(root, file)}`));
    for (const file of skipped) console.log(chalk.yellow(`skipped  ${relative(root, file)} (exists, use --force)`));
    console.log('');
    console.log(chalk.gray(`  Project ready. Next: cd ${relative(process.cwd(), root) || '.'} && mam build`));
    console.log('');
  }

  return { success: true, root, files: created, skipped };
}

/**
 * `mam init <name> --template <t> [--dir <d>]` entry point.
 *
 * Kept as the historical exported symbol; behaviour is unchanged apart from
 * honouring the newly optional `force` and `dryRun` flags.
 *
 * @param options - init options.
 * @returns the created file, or the reason it could not be created.
 */
export async function initModule(options: InitOptions): Promise<{ success: boolean; file: string; error?: string }> {
  const { name, template = 'basic', dir = '.' } = options;

  if (!name || !name.match(/^[a-zA-Z0-9-_]+$/)) {
    return { success: false, file: '', error: 'Invalid module name. Use only letters, numbers, hyphens, and underscores.' };
  }
  
  const outDir = resolve(dir);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  
  const outFile = join(outDir, `${name}.mam`);
  if (existsSync(outFile)) {
    return { success: false, file: outFile, error: `File already exists: ${outFile}` };
  }
  
  const content = TEMPLATES[template](name);
  if (options.dryRun) return { success: true, file: outFile };
  await writeFile(outFile, content, 'utf-8');
  
  return { success: true, file: outFile };
}

/**
 * Resolve an init invocation, honouring `--list-templates`.
 *
 * When the template catalogue is requested nothing is written and the
 * catalogue is returned instead.
 *
 * @param name - module name, or an empty string for `--list-templates`.
 * @param options - init options.
 * @returns the catalogue, the created file, or the reason it failed.
 */
export async function resolveInit(
  name: string,
  options: InitOptions & { listTemplates?: boolean } = { name: '' },
): Promise<
  | { kind: 'templates'; templates: TemplateInfo[] }
  | { kind: 'module'; success: boolean; file: string; error?: string }
> {
  if (options.listTemplates || name === '') {
    return { kind: 'templates', templates: templates(options.quiet === false) };
  }

  const check = validateTemplate(options.template);
  if (!check.valid) return { kind: 'module', success: false, file: '', error: check.error };

  return { kind: 'module', ...(await initModule({ ...options, name, template: check.template })) };
}
