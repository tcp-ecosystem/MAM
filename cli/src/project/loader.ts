/**
 * MAM Project loader.
 *
 * Discovers `.mam` / `.mam.md` modules declared by `mam.toml`, parses and
 * transforms them, resolves local dependencies, and builds the project graph.
 */

import { readFile, readdir, access } from 'node:fs/promises';
import { join, relative, resolve, dirname, basename } from 'node:path';
import { parseMAM } from '@mam/parser';
import { transformToV2 } from '@mam/compiler';
import type { V2ModuleNode } from '@mam/ast';
import { parseManifest, validateManifest, type ProjectManifest } from './manifest.js';
import { buildProjectGraph, type ProjectGraph } from './graph.js';

export interface LoadedModule {
  id: string;
  name: string;
  type: string;
  filePath: string;
  relativePath: string;
  ast: unknown;
  node?: V2ModuleNode;
  dependencies: string[];
  errors: string[];
}

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  modules: LoadedModule[];
  graph: ProjectGraph;
  duplicates: string[];
  externalDependencies: string[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.mam-cache', '.turbo', '.kilo', 'coverage',
]);

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

export function globToRegExp(pattern: string): RegExp {
  const p = pattern.replace(/\\/g, '/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i]!;
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('+.^$()|{}[]'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export class Project {
  readonly root: string;
  readonly manifestPath: string;
  readonly manifest: ProjectManifest;

  private constructor(root: string, manifestPath: string, manifest: ProjectManifest) {
    this.root = root;
    this.manifestPath = manifestPath;
    this.manifest = manifest;
  }

  /** Walk up from `startDir` looking for a `mam.toml`. */
  static async findManifest(startDir: string): Promise<string | null> {
    let dir = resolve(startDir);
    for (;;) {
      const candidate = join(dir, 'mam.toml');
      if (await exists(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }

  /** Load the project that contains (or is above) `startDir`. */
  static async load(startDir: string): Promise<Project> {
    const manifestPath = await Project.findManifest(startDir);
    if (!manifestPath) {
      throw new Error(`No mam.toml found from "${startDir}"`);
    }
    const text = await readFile(manifestPath, 'utf-8');
    return Project.fromText(dirname(manifestPath), manifestPath, text);
  }

  static fromText(root: string, manifestPath: string, text: string): Project {
    return new Project(resolve(root), manifestPath, parseManifest(text));
  }

  /** Create a project in-memory (used for tests). */
  static create(root: string, manifestText: string): Project {
    return Project.fromText(root, join(root, 'mam.toml'), manifestText);
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  async discoverModuleFiles(): Promise<string[]> {
    const include = [...this.manifest.build.modules, ...this.manifest.build.include].map(globToRegExp);
    const exclude = this.manifest.build.exclude.map(globToRegExp);
    const results = new Set<string>();

    const walk = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          await walk(full);
        } else if (entry.isFile() && (entry.name.endsWith('.mam') || entry.name.endsWith('.mam.md'))) {
          const rel = relative(this.root, full).replace(/\\/g, '/');
          if (exclude.some((r) => r.test(rel))) continue;
          if (include.some((r) => r.test(rel))) results.add(full);
        }
      }
    };

    await walk(this.root);
    return [...results].sort();
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  async loadModuleFile(filePath: string): Promise<LoadedModule> {
    const relativePath = relative(this.root, filePath).replace(/\\/g, '/');
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseMAM(content, { source: filePath });
    const errors = parsed.errors.map((e) => e.message ?? String(e));

    const data = (parsed.ast.frontmatter?.data ?? {}) as Record<string, unknown>;
    let node: V2ModuleNode | undefined;
    if (errors.length === 0) {
      try {
        node = transformToV2(parsed.ast)[0];
      } catch (err) {
        errors.push(`Transform error: ${(err as Error).message}`);
      }
    }

    const id = data.id ? String(data.id) : slug(basename(relativePath).replace(/\.mam(\.md)?$/, ''));
    const name = node?.name ?? (data.name ? String(data.name) : id);
    const type = node?.moduleType ?? (data.type ? String(data.type) : 'module');

    const dependencies = [
      ...(node?.requires ?? []),
      ...(node?.dependencies ?? []).map((d) => (d.version ? `${d.name}@${d.version}` : d.name)),
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    return { id, name, type, filePath, relativePath, ast: parsed.ast, node, dependencies, errors };
  }

  async loadModules(): Promise<LoadedModule[]> {
    const files = await this.discoverModuleFiles();
    const byId = new Map<string, LoadedModule>();

    for (const file of files) {
      const mod = await this.loadModuleFile(file);
      const key = mod.id.toLowerCase();
      const existing = byId.get(key);
      if (!existing) {
        byId.set(key, mod);
        continue;
      }
      // `.mam` and `.mam.md` describe the same module; prefer canonical `.mam`.
      const existingCanonical = existing.filePath.endsWith('.mam');
      const currentCanonical = mod.filePath.endsWith('.mam');
      if (currentCanonical && !existingCanonical) {
        byId.set(key, mod);
      }
    }

    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  /** Load the declared entry system, or `system.mam` at the root. */
  async loadEntry(): Promise<LoadedModule | null> {
    const candidates: string[] = [];
    if (this.manifest.build.entry) candidates.push(resolve(this.root, this.manifest.build.entry));
    candidates.push(join(this.root, 'system.mam'));
    candidates.push(join(this.root, 'system.mam.md'));

    for (const candidate of candidates) {
      if (await exists(candidate)) return this.loadModuleFile(candidate);
    }
    return null;
  }

  /**
   * All project modules plus the entry system (deduplicated by id).
   */
  async loadAllModules(): Promise<LoadedModule[]> {
    const modules = await this.loadModules();
    const entry = await this.loadEntry();
    if (!entry) return modules;
    if (modules.some((m) => m.id.toLowerCase() === entry.id.toLowerCase())) return modules;
    return [...modules, entry].sort((a, b) => a.id.localeCompare(b.id));
  }

  // -------------------------------------------------------------------------
  // Graph + validation
  // -------------------------------------------------------------------------

  buildGraph(modules: LoadedModule[]): ProjectGraph {
    return buildProjectGraph(modules);
  }

  async validate(): Promise<ProjectValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    errors.push(...validateManifest(this.manifest));

    const modules = await this.loadAllModules();

    for (const mod of modules) {
      for (const err of mod.errors) errors.push(`${mod.relativePath}: ${err}`);
    }

    const duplicates: string[] = [];
    const seen = new Map<string, string>();
    for (const mod of modules) {
      const key = mod.id.toLowerCase();
      if (seen.has(key)) {
        duplicates.push(mod.id);
        errors.push(`Duplicate module id "${mod.id}" (${seen.get(key)}, ${mod.relativePath})`);
      } else {
        seen.set(key, mod.relativePath);
      }
    }

    const graph = buildProjectGraph(modules);

    for (const cycle of graph.cycles) {
      errors.push(`Dependency cycle: ${cycle.join(' -> ')}`);
    }

    const externalDependencies = graph.nodes.filter((n) => n.external).map((n) => n.id);
    for (const dep of externalDependencies) {
      warnings.push(`External dependency not found in project: ${dep}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      modules,
      graph,
      duplicates,
      externalDependencies,
    };
  }
}
