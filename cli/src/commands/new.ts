/**
 * MAM New Command
 *
 * Scaffolds a new module from a project template (`modules/templates`).
 * Emits both the canonical `.mam` and the `.mam.md` source form.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Project } from '../project/loader.js';

export interface NewOptions {
  dir?: string;
  force?: boolean;
  quiet?: boolean;
}

/** Template aliases for module types. */
const TYPE_TO_TEMPLATE: Record<string, string> = {
  module: 'basic',
  basic: 'basic',
  agent: 'agent',
  tool: 'tool',
  memory: 'memory',
  workflow: 'workflow',
  team: 'team',
  policy: 'policy',
  system: 'system',
  service: 'service',
  component: 'component',
  resource: 'resource',
  plugin: 'plugin',
  api: 'api',
};

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

/** Locate the bundled templates directory. */
export async function findTemplatesDir(): Promise<string | null> {
  const candidates: string[] = [];

  try {
    const here = dirname(fileURLToPath(import.meta.url)); // .../cli/dist/commands
    candidates.push(resolve(here, '..', '..', '..', 'modules', 'templates'));
    candidates.push(resolve(here, '..', '..', 'modules', 'templates'));
  } catch {
    // import.meta may be unavailable in some bundlers
  }

  let dir = process.cwd();
  for (;;) {
    candidates.push(join(dir, 'modules', 'templates'));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export async function listTemplateTypes(): Promise<string[]> {
  const dir = await findTemplatesDir();
  if (!dir) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir);
  return entries
    .filter((e) => e.endsWith('.mam.md'))
    .map((e) => e.replace(/\.mam\.md$/, ''))
    .sort();
}

// ============================================================================
// Name-case converters
// ============================================================================

/**
 * Split a name into its constituent words.
 *
 * Handles kebab-case, snake_case, dot.case, spaces and camelCase, which covers
 * every way a MAM module is named in practice.
 *
 * @param value - raw name.
 * @returns the lowercase words.
 */
export function words(value: string): string[] {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * Convert a name to kebab-case, the canonical MAM module id form.
 *
 * @param value - raw name.
 * @returns the kebab-case name.
 */
export function toKebabCase(value: string): string {
  return words(value).join('-');
}

/**
 * Convert a name to snake_case, as used by generated Python imports.
 *
 * @param value - raw name.
 * @returns the snake_case name.
 */
export function toSnakeCase(value: string): string {
  return words(value).join('_');
}

/**
 * Convert a name to PascalCase, as used for classes and type names.
 *
 * @param value - raw name.
 * @returns the PascalCase name.
 */
export function toPascalCase(value: string): string {
  return words(value).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/**
 * Convert a name to Title Case for the frontmatter `name:` field.
 *
 * @param value - raw name.
 * @returns the title-cased name.
 */
export function toTitleCase(value: string): string {
  return words(value).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Strip a trailing `.mam` / `.mam.md` extension from a name.
 *
 * @param value - possibly suffixed name.
 * @returns the base name.
 */
export function stripExtension(value: string): string {
  return value.replace(/\.mam(\.md)?$/, '');
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// ============================================================================
// Template interpolation
// ============================================================================

/** Values substituted into a template. */
export interface TemplateVars {
  /** Canonical kebab-case module id. */
  id: string;
  /** Title-cased display name. */
  name: string;
  /** PascalCase identifier. */
  pascal: string;
  /** snake_case identifier. */
  snake: string;
  /** The template the module was generated from. */
  template: string;
}

/**
 * Build the substitution set for a module name.
 *
 * @param name - raw module name.
 * @param template - template the module is generated from.
 * @returns the {@link TemplateVars}.
 */
export function templateVars(name: string, template: string): TemplateVars {
  const id = toKebabCase(name);
  return {
    id,
    name: toTitleCase(name),
    pascal: toPascalCase(name),
    snake: toSnakeCase(name),
    template,
  };
}

/**
 * Substitute `{{placeholders}}` in template text.
 *
 * Unknown placeholders are left untouched so a template author can spot the
 * typo instead of silently blanking a field.
 *
 * @param content - template text.
 * @param vars - substitution values.
 * @returns the interpolated text.
 */
export function interpolate(content: string, vars: TemplateVars): string {
  return content.replace(/\{\{\s*([a-zA-Z_][\w]*)\s*\}\}/g, (match, key: string) => {
    const value = (vars as unknown as Record<string, string | undefined>)[key];
    return value === undefined ? match : value;
  });
}

/**
 * Apply the interpolation to a template read from disk.
 *
 * Rewrites the frontmatter `id:` and `name:` keys (the two fields every
 * template carries) and then interpolates any `{{placeholder}}` tokens.
 *
 * @param content - raw template text.
 * @param vars - substitution values.
 * @returns the generated module source.
 */
export function renderTemplate(content: string, vars: TemplateVars): string {
  const withFields = content
    .replace(/^id:\s*.*$/m, `id: ${vars.id}`)
    .replace(/^name:\s*.*$/m, `name: ${vars.name}`);
  return interpolate(withFields, vars);
}

/**
 * Render a template by name without writing it.
 *
 * @param templateName - template key.
 * @param name - module name.
 * @returns the generated source, or `undefined` when the template is missing.
 */
export async function renderTemplateByName(templateName: string, name: string): Promise<string | undefined> {
  const templatesDir = await findTemplatesDir();
  if (!templatesDir) return undefined;
  const templatePath = join(templatesDir, `${templateName}.mam.md`);
  if (!(await exists(templatePath))) return undefined;
  return renderTemplate(await readFile(templatePath, 'utf-8'), templateVars(name, templateName));
}

// ============================================================================
// Scaffolding plan
// ============================================================================

/** One planned write produced by {@link planScaffold}. */
export interface ScaffoldFile {
  /** Absolute path the file would be written to. */
  path: string;
  /** Path relative to the output directory. */
  relative: string;
  /** File contents. */
  content: string;
  /** Whether the file already exists on disk. */
  exists: boolean;
}

/** The full plan for a `mam new` invocation. */
export interface ScaffoldPlan {
  /** Template the module is generated from. */
  template: string;
  /** Substitution values used. */
  vars: TemplateVars;
  /** Files to write, in write order. */
  files: ScaffoldFile[];
  /** Existing files that would block the write without `--force`. */
  conflicts: string[];
}

/**
 * The module kinds `mam new` accepts, resolved to template names.
 *
 * @returns the type -> template mapping.
 */
export function typeCatalogue(): Record<string, string> {
  return { ...TYPE_TO_TEMPLATE };
}

/**
 * Resolve a module type to a template name.
 *
 * @param type - user-supplied type.
 * @returns the template name, defaulting to the type itself.
 */
export function resolveTemplateName(type: string): string {
  return TYPE_TO_TEMPLATE[type] ?? type;
}

/**
 * Resolve the output directory for a new module.
 *
 * Falls back to the enclosing project's `modules/` directory, then to the
 * current working directory when there is no project.
 *
 * @param options - new-command options.
 * @returns the absolute output directory.
 */
export async function resolveOutputDir(options: NewOptions): Promise<string> {
  if (options.dir) return resolve(options.dir);
  try {
    const project = await Project.load(process.cwd());
    return join(project.root, 'modules');
  } catch {
    return process.cwd();
  }
}

/**
 * Build the full write plan without touching the filesystem.
 *
 * Separating planning from writing is what makes the preview in
 * {@link newCommandInteractive} and the `--dry-run` flag trustworthy.
 *
 * @param type - module type.
 * @param name - module name.
 * @param options - new-command options.
 * @returns the {@link ScaffoldPlan}, or `undefined` when the template is missing.
 */
export async function planScaffold(type: string, name: string, options: NewOptions = {}): Promise<ScaffoldPlan | undefined> {
  const templateName = resolveTemplateName(type);
  const rendered = await renderTemplateByName(templateName, name);
  if (rendered === undefined) return undefined;

  const outDir = await resolveOutputDir(options);
  const base = stripExtension(basename(name));
  const vars = templateVars(name, templateName);
  const paths = [join(outDir, `${base}.mam`), join(outDir, `${base}.mam.md`)];

  const files: ScaffoldFile[] = [];
  for (const path of paths) {
    files.push({ path, relative: basename(path), content: rendered, exists: await exists(path) });
  }
  return { template: templateName, vars, files, conflicts: files.filter((f) => f.exists).map((f) => f.path) };
}

/**
 * Render a preview of a scaffold plan.
 *
 * @param plan - the plan from {@link planScaffold}.
 * @param maxLines - maximum preview lines per file.
 * @returns the rendered preview text.
 */
export function renderPlan(plan: ScaffoldPlan, maxLines = 24): string[] {
  const lines: string[] = [
    '',
    chalk.cyan.bold(`New ${plan.template} module`),
    `  ${chalk.gray('id')}     ${chalk.white(plan.vars.id)}`,
    `  ${chalk.gray('name')}   ${chalk.white(plan.vars.name)}`,
    `  ${chalk.gray('ident')} ${chalk.gray(`${plan.vars.pascal} / ${plan.vars.snake}`)}`,
    '',
  ];
  for (const file of plan.files) {
    const badge = file.exists ? chalk.yellow('overwrite') : chalk.green('create');
    lines.push(`  ${badge}  ${chalk.white(file.path)}`);
    const body = file.content.split('\n').slice(0, maxLines);
    for (const line of body) lines.push(`      ${chalk.gray(line)}`);
    if (file.content.split('\n').length > maxLines) lines.push(`      ${chalk.gray('...')}`);
    lines.push('');
  }
  if (plan.conflicts.length > 0) {
    lines.push(chalk.yellow(`  ${plan.conflicts.length} file(s) exist; --force is required to overwrite.`), '');
  }
  return lines;
}

/**
 * Execute a scaffold plan.
 *
 * @param plan - the plan from {@link planScaffold}.
 * @param options - new-command options (`force`, `quiet`).
 * @returns the paths written, or `undefined` when blocked by existing files.
 */
export async function writeScaffold(plan: ScaffoldPlan, options: NewOptions = {}): Promise<string[] | undefined> {
  if (plan.conflicts.length > 0 && !options.force) return undefined;

  const written: string[] = [];
  for (const file of plan.files) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf-8');
    written.push(file.path);
  }
  return written;
}

// ============================================================================
// Interactive flow
// ============================================================================

/** Whether the process is attached to an interactive terminal. */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Ask the user for the missing `mam new` arguments.
 *
 * Only reached when the process is a TTY and the type or name was omitted, so
 * piped and scripted invocations are never blocked on a prompt.
 *
 * @param defaults - values already supplied on the command line.
 * @returns the resolved type and name, or `undefined` when the user aborted.
 */
export async function promptForModule(defaults: { type?: string; name?: string } = {}): Promise<{ type: string; name: string } | undefined> {
  const available = await listTemplateTypes();
  const choices = Array.from(new Set([...Object.keys(TYPE_TO_TEMPLATE), ...available]))
    .sort()
    .map((value) => ({ name: value, value }));

  const { default: inquirer } = await import('inquirer');

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'type',
      message: 'What kind of module do you want to create?',
      choices: choices.length > 0 ? choices : Object.keys(TYPE_TO_TEMPLATE).sort().map((value) => ({ name: value, value })),
      default: defaults.type,
      when: defaults.type !== undefined,
    },
    {
      type: 'input',
      name: 'name',
      message: 'Module name:',
      default: defaults.name,
      validate: (input: string) => (toKebabCase(input).length > 0 ? true : 'A module name is required.'),
      when: defaults.name !== undefined,
    },
  ]);

  const type = answers.type ?? defaults.type;
  const name = answers.name ?? defaults.name;
  if (!type || !name) return undefined;
  return { type: String(type), name: String(name) };
}

/**
 * `mam new` with an interactive fallback.
 *
 * When `type` and `name` are both supplied this is exactly
 * {@link newCommand}. When either is missing and the process is a TTY the
 * missing arguments are prompted for and the scaffold is previewed before
 * anything is written.
 *
 * @param type - module type, or an empty string to prompt.
 * @param name - module name, or an empty string to prompt.
 * @param options - new-command options.
 * @returns the written paths, or `undefined` when nothing was written.
 */
export async function newCommandInteractive(
  type: string,
  name: string,
  options: NewOptions & { preview?: boolean; yes?: boolean } = {},
): Promise<string[] | undefined> {
  let resolvedType = type;
  let resolvedName = name;

  if ((!resolvedType || !resolvedName) && isInteractive()) {
    const answered = await promptForModule({ type: resolvedType || undefined, name: resolvedName || undefined });
    if (!answered) {
      console.log(chalk.gray('\nAborted.'));
      return undefined;
    }
    resolvedType = answered.type;
    resolvedName = answered.name;
  }

  if (!resolvedType || !resolvedName) return newCommand(resolvedType || 'module', resolvedName || 'module', options);

  const templateName = resolveTemplateName(resolvedType);
  const plan = await planScaffold(resolvedType, resolvedName, options);
  if (!plan) {
    const available = await listTemplateTypes();
    console.error(chalk.red(`Unknown template type: "${resolvedType}".`));
    if (available.length > 0) console.error(chalk.gray(`Available: ${available.join(', ')}`));
    process.exitCode = 1;
    return undefined;
  }

  const showPreview = options.preview === true || (options.yes !== true && plan.conflicts.length === 0 && !options.quiet);
  if (showPreview && !options.quiet) console.log(renderPlan(plan).join('\n'));

  const written = await writeScaffold(plan, options);
  if (!written) {
    console.error(chalk.red(`File already exists: ${plan.conflicts[0]}. Use --force to overwrite.`));
    process.exitCode = 1;
    return undefined;
  }

  if (!options.quiet) {
    console.log(chalk.green(`Created ${resolvedType} module "${plan.vars.name}" from template "${templateName}"`));
    for (const file of written) console.log(chalk.gray(`  ${file}`));
    console.log('');
    console.log(chalk.gray(`  Next: mam fmt ${stripExtension(basename(resolvedName))}.mam --in-place`));
    console.log('');
  }

  return written;
}

/**
 * Scaffold a new module from a template. Writes `<name>.mam` and
 * `<name>.mam.md` and returns their paths.
 */
export async function newCommand(type: string, name: string, options: NewOptions = {}): Promise<string[]> {
  const templateName = TYPE_TO_TEMPLATE[type] ?? type;
  const templatesDir = await findTemplatesDir();

  if (!templatesDir) {
    console.error(chalk.red('Could not locate the MAM templates directory (modules/templates).'));
    process.exit(1);
  }

  const templatePath = join(templatesDir, `${templateName}.mam.md`);
  if (!(await exists(templatePath))) {
    const available = await listTemplateTypes();
    console.error(chalk.red(`Unknown template type: "${type}".`));
    if (available.length > 0) console.error(chalk.gray(`Available: ${available.join(', ')}`));
    process.exit(1);
  }

  let content = await readFile(templatePath, 'utf-8');
  const id = slug(name);
  const displayName = titleCase(name);
  content = content
    .replace(/^id:\s*.*$/m, `id: ${id}`)
    .replace(/^name:\s*.*$/m, `name: ${displayName}`);

  // Choose output directory: explicit, else project `modules/`, else cwd.
  let outDir = options.dir ? resolve(options.dir) : process.cwd();
  if (!options.dir) {
    try {
      const project = await Project.load(process.cwd());
      outDir = join(project.root, 'modules');
    } catch {
      // not in a project; use cwd
    }
  }
  await mkdir(outDir, { recursive: true });

  const base = basename(name).replace(/\.mam(\.md)?$/, '');
  const mamPath = join(outDir, `${base}.mam`);
  const mdPath = join(outDir, `${base}.mam.md`);

  for (const path of [mamPath, mdPath]) {
    if ((await exists(path)) && !options.force) {
      console.error(chalk.red(`File already exists: ${path}. Use --force to overwrite.`));
      process.exit(1);
    }
  }

  await writeFile(mamPath, content, 'utf-8');
  await writeFile(mdPath, content, 'utf-8');

  if (!options.quiet) {
    console.log(chalk.green(`Created ${type} module "${displayName}"`));
    console.log(chalk.gray(`  ${mamPath}`));
    console.log(chalk.gray(`  ${mdPath}`));
  }

  return [mamPath, mdPath];
}
