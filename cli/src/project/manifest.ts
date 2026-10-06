/**
 * MAM Project Manifest (`mam.toml`)
 *
 * Defines a multi-file MAM project: project identity, the entry system,
 * module discovery globs, build targets, and cross-project dependencies.
 */

import { MAM_VERSION } from '@mam/ast';
import { parseToml, type TomlTable } from './toml.js';

export interface ProjectInfo {
  name: string;
  version: string;
  description?: string;
  license?: string;
  authors?: string[];
}

export interface ProjectBuildConfig {
  /** Entry system module, relative to the project root (e.g. `system.mam`). */
  entry?: string;
  /** Glob patterns (relative to root) used to discover modules. */
  modules: string[];
  /** Output directory for compiled artifacts. */
  outDir: string;
  /** Compiler targets to emit. */
  targets: string[];
  /** Extra include globs. */
  include: string[];
  /** Glob patterns to exclude. */
  exclude: string[];
}

export interface ProjectManifest {
  project: ProjectInfo;
  build: ProjectBuildConfig;
  dependencies: Record<string, string>;
  raw: TomlTable;
}

export const DEFAULT_MODULE_GLOBS = [
  'modules/**/*.mam',
  'modules/**/*.mam.md',
  '*.mam',
  '*.mam.md',
];

export const DEFAULT_BUILD: ProjectBuildConfig = {
  modules: DEFAULT_MODULE_GLOBS,
  outDir: 'dist',
  targets: ['python'],
  include: [],
  exclude: ['node_modules/**', 'dist/**', '.mam-cache/**'],
};

const DEFAULT_PROJECT: ProjectInfo = {
  name: 'mam-project',
  version: MAM_VERSION,
};

function asString(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function asStringArray(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') return [value];
  return fallback;
}

/**
 * Parse a `mam.toml` document into a normalized manifest.
 */
export function parseManifest(tomlText: string): ProjectManifest {
  const raw = parseToml(tomlText);
  const projectTable = (raw.project as TomlTable) ?? {};
  const buildTable = (raw.build as TomlTable) ?? {};
  const depsTable = (raw.dependencies as TomlTable) ?? {};

  const project: ProjectInfo = {
    name: asString(projectTable.name, DEFAULT_PROJECT.name),
    version: asString(projectTable.version, DEFAULT_PROJECT.version),
    description: projectTable.description !== undefined ? asString(projectTable.description) : undefined,
    license: projectTable.license !== undefined ? asString(projectTable.license) : undefined,
    authors: projectTable.authors !== undefined ? asStringArray(projectTable.authors) : undefined,
  };

  const build: ProjectBuildConfig = {
    entry: buildTable.entry !== undefined ? asString(buildTable.entry) : undefined,
    modules: buildTable.modules !== undefined ? asStringArray(buildTable.modules, DEFAULT_MODULE_GLOBS) : [...DEFAULT_MODULE_GLOBS],
    outDir: asString(buildTable.outDir, DEFAULT_BUILD.outDir),
    targets: buildTable.targets !== undefined ? asStringArray(buildTable.targets, DEFAULT_BUILD.targets) : [...DEFAULT_BUILD.targets],
    include: asStringArray(buildTable.include),
    exclude: buildTable.exclude !== undefined ? asStringArray(buildTable.exclude, DEFAULT_BUILD.exclude) : [...DEFAULT_BUILD.exclude],
  };

  const dependencies: Record<string, string> = {};
  for (const [key, value] of Object.entries(depsTable)) {
    dependencies[key] = asString(value);
  }

  return { project, build, dependencies, raw };
}

/**
 * Validate a manifest, returning human-readable problems (empty = valid).
 */
export function validateManifest(manifest: ProjectManifest): string[] {
  const errors: string[] = [];
  if (!manifest.project.name) errors.push('project.name is required');
  if (!manifest.project.version) errors.push('project.version is required');
  if (manifest.build.targets.length === 0) errors.push('build.targets must contain at least one target');
  if (manifest.build.modules.length === 0) errors.push('build.modules must contain at least one glob');
  return errors;
}

/**
 * Render a default manifest for `mam project init`.
 */
export function renderManifest(info: ProjectInfo, options: Partial<ProjectBuildConfig> = {}): string {
  const build = { ...DEFAULT_BUILD, ...options };
  const lines: string[] = [];
  lines.push('[project]');
  lines.push(`name = "${info.name}"`);
  lines.push(`version = "${info.version}"`);
  if (info.description) lines.push(`description = "${info.description}"`);
  if (info.license) lines.push(`license = "${info.license}"`);
  if (info.authors && info.authors.length > 0) {
    lines.push(`authors = [${info.authors.map((a) => `"${a}"`).join(', ')}]`);
  }
  lines.push('');
  lines.push('[build]');
  if (build.entry) lines.push(`entry = "${build.entry}"`);
  lines.push(`modules = [${build.modules.map((m) => `"${m}"`).join(', ')}]`);
  lines.push(`outDir = "${build.outDir}"`);
  lines.push(`targets = [${build.targets.map((t) => `"${t}"`).join(', ')}]`);
  lines.push('');
  return lines.join('\n');
}
