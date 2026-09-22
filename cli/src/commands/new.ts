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
