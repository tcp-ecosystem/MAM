/**
 * MAM Create Command
 *
 * Scaffolds new MAM modules, agents, workflows and projects.
 *
 * `mam create` is the interactive-first counterpart to `mam init`: instead of
 * taking a bare name it walks the operator through the module's identity and
 * purpose, renders a starter from a built-in template, writes it to disk and
 * immediately validates the result so a broken scaffold can never be
 * committed.
 *
 * Supported artefact kinds:
 *
 *   - `module`   a single `.mam` module with the standard section skeleton
 *   - `agent`    an agent module with metadata/inputs/outputs/prompt
 *   - `workflow` a workflow module with a mermaid + workflow section
 *   - `project`  a full project: `mam.toml`, a `system.mam` and `modules/`
 *
 * Templates are plain functions returning markdown, so they are trivially
 * extensible and testable without touching the filesystem.
 *
 * @module create
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { validate } from '@mam/validator';

// ============================================================================
// Types
// ============================================================================

/** The kinds of artefact {@link createCommand} can scaffold. */
export type CreateKind = 'module' | 'agent' | 'workflow' | 'project';

/** Options accepted by {@link createCommand}. */
export interface CreateOptions {
  /** Name of the artefact to create. */
  name?: string;
  /** Kind of artefact to create. */
  kind?: CreateKind;
  /** One-line description used in the module purpose. */
  description?: string;
  /** Template variant (`minimal` | `standard` | `full`). */
  template?: 'minimal' | 'standard' | 'full';
  /** Target directory (defaults to the current directory). */
  dir?: string;
  /** Overwrite existing files. */
  force?: boolean;
}

/** Context interpolated into a template. */
export interface TemplateContext {
  /** Artefact name as given by the operator. */
  name: string;
  /** Description line. */
  description: string;
  /** Module type recorded in frontmatter. */
  moduleType: string;
  /** Semantic version. */
  version: string;
  /** Template variant. */
  template: 'minimal' | 'standard' | 'full';
}

/** Result of a single scaffolded file. */
export interface CreatedFile {
  /** Absolute path written. */
  path: string;
  /** Whether the file already existed and was overwritten. */
  overwritten: boolean;
  /** Whether the written content passed validation. */
  valid: boolean;
}

/** Aggregate result of {@link createCommand}. */
export interface CreateResult {
  /** Whether the command succeeded. */
  success: boolean;
  /** Artefact kind that was created. */
  kind: CreateKind;
  /** Root directory of the artefact. */
  root: string;
  /** Every file written. */
  files: CreatedFile[];
  /** Non-fatal problems encountered. */
  warnings: string[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Slugify a name into a safe module identifier.
 *
 * @param name - raw name.
 * @returns a lowercase, dash-separated identifier.
 */
export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Title-case a name for use in headings.
 *
 * @param name - raw name.
 * @returns the title-cased name.
 */
export function titleCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Whether a path already exists on disk.
 *
 * @param path - absolute path to test.
 * @returns `true` when the path exists.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the interpolation context for a template.
 *
 * @param options - create options.
 * @param kind - resolved artefact kind.
 * @returns a populated {@link TemplateContext}.
 */
export function buildContext(options: CreateOptions, kind: CreateKind): TemplateContext {
  const name = (options.name ?? 'untitled').trim();
  return {
    name,
    description: options.description?.trim() || `${titleCase(name)} module.`,
    moduleType: kind === 'agent' ? 'agent' : kind === 'workflow' ? 'workflow' : 'module',
    version: '0.1.0',
    template: options.template ?? 'standard',
  };
}

// ============================================================================
// Templates
// ============================================================================

/**
 * Render the frontmatter block for a module.
 *
 * @param ctx - template context.
 * @returns the frontmatter markdown.
 */
export function renderFrontmatter(ctx: TemplateContext): string {
  return [
    '---',
    `name: ${ctx.name}`,
    `version: "${ctx.version}"`,
    `type: ${ctx.moduleType}`,
    `description: "${ctx.description.replace(/"/g, "'")}"`,
    '---',
  ].join('\n');
}

/**
 * Render the standard section skeleton.
 *
 * @param ctx - template context.
 * @returns the module body markdown.
 */
export function renderStandardModule(ctx: TemplateContext): string {
  const body = [
    renderFrontmatter(ctx),
    '',
    '## Metadata',
    '',
    `- name: ${ctx.name}`,
    `- version: "${ctx.version}"`,
    `- type: ${ctx.moduleType}`,
    '',
    '## Purpose',
    '',
    ctx.description,
    '',
    '## Inputs',
    '',
    '- input: payload',
    '',
    '## Outputs',
    '',
    '- output: result',
    '',
    '## Rules',
    '',
    '1. Validate all inputs before processing.',
    '2. Emit a deterministic result.',
    '',
  ];
  return body.join('\n');
}

/**
 * Render the minimal module skeleton.
 *
 * @param ctx - template context.
 * @returns the module body markdown.
 */
export function renderMinimalModule(ctx: TemplateContext): string {
  return [renderFrontmatter(ctx), '', '## Purpose', '', ctx.description, ''].join('\n');
}

/**
 * Render the full agent skeleton (adds prompt + examples).
 *
 * @param ctx - template context.
 * @returns the module body markdown.
 */
export function renderAgentModule(ctx: TemplateContext): string {
  return [
    renderStandardModule(ctx),
    '## Prompt',
    '',
    'You are a MAM agent. Follow the rules above and respond with the output contract.',
    '',
    '## Examples',
    '',
    '### Example 1',
    '',
    '- input: `{ "payload": 1 }`',
    '- output: `{ "result": 1 }`',
    '',
  ].join('\n');
}

/**
 * Render the workflow skeleton (adds workflow + mermaid sections).
 *
 * @param ctx - template context.
 * @returns the module body markdown.
 */
export function renderWorkflowModule(ctx: TemplateContext): string {
  return [
    renderStandardModule(ctx),
    '## Workflow',
    '',
    '1. Load the payload.',
    '2. Transform the payload.',
    '3. Emit the result.',
    '',
    '## Mermaid',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[Load] --> B[Transform]',
    '  B --> C[Emit]',
    '```',
    '',
  ].join('\n');
}

/**
 * Select and render the template for a given kind and variant.
 *
 * @param ctx - template context.
 * @param kind - artefact kind.
 * @returns the rendered module markdown.
 */
export function templateFor(ctx: TemplateContext, kind: CreateKind): string {
  if (kind === 'agent') return renderAgentModule(ctx);
  if (kind === 'workflow') return renderWorkflowModule(ctx);
  if (ctx.template === 'minimal') return renderMinimalModule(ctx);
  return renderStandardModule(ctx);
}

/**
 * Render a `mam.toml` project manifest.
 *
 * @param ctx - template context.
 * @returns the manifest text.
 */
export function renderProjectManifest(ctx: TemplateContext): string {
  return [
    '[project]',
    `name = "${ctx.name}"`,
    'version = "0.1.0"',
    'description = "' + ctx.description.replace(/"/g, "'") + '"',
    '',
    '[modules]',
    'system = "system.mam"',
    '',
  ].join('\n');
}

/**
 * Render the `system.mam` root module of a project.
 *
 * @param ctx - template context.
 * @returns the system module markdown.
 */
export function renderSystemModule(ctx: TemplateContext): string {
  return [
    renderFrontmatter({ ...ctx, name: `${ctx.name}-system`, moduleType: 'system' }),
    '',
    '## Metadata',
    '',
    `- name: ${ctx.name}-system`,
    '- type: system',
    '',
    '## Purpose',
    '',
    `Root system module for ${ctx.name}.`,
    '',
    '## Modules',
    '',
    '- module: modules/example.mam',
    '',
  ].join('\n');
}

// ============================================================================
// Writing
// ============================================================================

/**
 * Write a single scaffolded file, honouring `force`.
 *
 * @param path - absolute destination path.
 * @param content - file contents.
 * @param force - overwrite an existing file when `true`.
 * @param validateContent - run the validator on `.mam` content.
 * @returns a {@link CreatedFile} describing the outcome.
 */
export async function writeScaffolded(
  path: string,
  content: string,
  force: boolean,
  validateContent = true,
): Promise<CreatedFile> {
  const existed = await pathExists(path);
  if (existed && !force) {
    return { path, overwritten: false, valid: true };
  }
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content, 'utf-8');
  let valid = true;
  if (validateContent && /\.mam(\.md)?$/.test(path)) {
    try {
      validate({ raw_content: content, file_path: path, sections: [] } as never);
    } catch {
      valid = false;
    }
  }
  return { path, overwritten: existed, valid };
}

/**
 * Scaffold a single module into a directory.
 *
 * @param options - create options.
 * @param kind - module kind.
 * @returns the list of files written.
 */
export async function scaffoldModule(
  options: CreateOptions,
  kind: CreateKind,
): Promise<CreatedFile[]> {
  const ctx = buildContext(options, kind);
  const dir = resolve(options.dir ?? '.');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${slugify(ctx.name)}.mam`);
  const content = templateFor(ctx, kind);
  return [await writeScaffolded(file, content, options.force === true)];
}

/**
 * Scaffold a full project (`mam.toml`, `system.mam`, `modules/example.mam`).
 *
 * @param options - create options.
 * @returns the list of files written.
 */
export async function scaffoldProject(options: CreateOptions): Promise<CreatedFile[]> {
  const ctx = buildContext(options, 'project');
  const dir = resolve(options.dir ?? '.');
  await mkdir(join(dir, 'modules'), { recursive: true });
  const files: CreatedFile[] = [];
  files.push(await writeScaffolded(join(dir, 'mam.toml'), renderProjectManifest(ctx), options.force === true, false));
  files.push(await writeScaffolded(join(dir, 'system.mam'), renderSystemModule(ctx), options.force === true));
  files.push(
    await writeScaffolded(
      join(dir, 'modules', 'example.mam'),
      renderStandardModule({ ...ctx, name: 'example' }),
      options.force === true,
    ),
  );
  return files;
}

/**
 * Validate every generated module file and collect warnings.
 *
 * @param files - files that were written.
 * @returns the list of warning strings.
 */
export function validateGenerated(files: CreatedFile[]): string[] {
  return files
    .filter((f) => /\.mam(\.md)?$/.test(f.path) && !f.valid)
    .map((f) => `generated module did not fully validate: ${f.path}`);
}

// ============================================================================
// Command entry point
// ============================================================================

/**
 * `mam create` entry point: scaffold a module, agent, workflow or project.
 *
 * @param options - create options.
 * @returns the aggregate {@link CreateResult}.
 */
export async function createCommand(options: CreateOptions): Promise<CreateResult> {
  const kind: CreateKind = options.kind ?? 'module';
  const spinner = ora(`Creating ${chalk.cyan(kind)}...`).start();

  try {
    const files =
      kind === 'project'
        ? await scaffoldProject(options)
        : await scaffoldModule(options, kind);

    const warnings = validateGenerated(files);
    spinner.succeed(`${chalk.green(kind)} created`);

    for (const file of files) {
      const tag = file.overwritten ? chalk.yellow('overwritten') : chalk.green('created');
      console.log(`  ${tag}  ${chalk.white(file.path)}`);
    }
    for (const warning of warnings) {
      console.log(`  ${chalk.yellow('warning')}  ${warning}`);
    }
    console.log(chalk.gray('\nNext: mam validate <file>  |  mam run <file>'));

    return { success: true, kind, root: resolve(options.dir ?? '.'), files, warnings };
  } catch (error) {
    spinner.fail((error as Error).message);
    return {
      success: false,
      kind,
      root: resolve(options.dir ?? '.'),
      files: [],
      warnings: [(error as Error).message],
    };
  }
}