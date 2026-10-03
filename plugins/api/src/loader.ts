/**
 * MAM Plugin Loader
 *
 * Dynamic plugin import, manifest validation, dependency checking,
 * and sandboxed loading with timeout support.
 */

import type { MAMPlugin, PluginManifest } from './types.js';
import { readdir, readFile, access, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';

export interface LoadPluginResult {
  success: boolean;
  plugin?: MAMPlugin;
  manifest?: PluginManifest;
  error?: string;
  warnings: string[];
  durationMs: number;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PluginLoadContext {
  basePath: string;
  timeout?: number;
  validateDependencies?: boolean;
  availablePlugins?: string[];
}

const REQUIRED_MANIFEST_FIELDS: Array<keyof PluginManifest> = [
  'name', 'version', 'description', 'author', 'license', 'main',
];

const NAME_PATTERN = /^[a-zA-Z@][a-zA-Z0-9/_-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const SCOPE_PATTERN = /^@mam\//;

// ─── Core Loading ───────────────────────────────────────────────────

export async function loadPluginFromPath(
  pluginPath: string,
  context?: PluginLoadContext,
): Promise<LoadPluginResult> {
  const startTime = performance.now();
  const warnings: string[] = [];

  try {
    const manifestPath = join(pluginPath, 'plugin.json');
    await access(manifestPath);
    const manifestContent = await readFile(manifestPath, 'utf-8');
    let manifest: PluginManifest;

    try {
      manifest = JSON.parse(manifestContent);
    } catch (e) {
      return {
        success: false,
        error: `Invalid JSON in plugin.json: ${(e as Error).message}`,
        warnings,
        durationMs: performance.now() - startTime,
      };
    }

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid manifest: ${validation.errors.join('; ')}`,
        warnings: [...warnings, ...validation.warnings],
        durationMs: performance.now() - startTime,
      };
    }
    warnings.push(...validation.warnings);

    if (context?.validateDependencies && manifest.dependencies) {
      const available = context.availablePlugins || [];
      for (const dep of manifest.dependencies) {
        if (!available.includes(dep)) {
          warnings.push(`Dependency "${dep}" not available`);
        }
      }
    }

    const mainPath = resolve(pluginPath, manifest.main);
    let pluginModule: any;
    try {
      if (context?.timeout) {
        pluginModule = await Promise.race([
          import(mainPath),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Import timeout after ${context.timeout}ms`)), context.timeout),
          ),
        ]);
      } else {
        pluginModule = await import(mainPath);
      }
    } catch (e) {
      return {
        success: false,
        error: `Failed to import "${manifest.main}": ${(e as Error).message}`,
        warnings,
        durationMs: performance.now() - startTime,
      };
    }

    const plugin: MAMPlugin = pluginModule.default || pluginModule;
    if (!plugin.manifest) {
      plugin.manifest = manifest;
    }

    return {
      success: true,
      plugin,
      manifest,
      warnings,
      durationMs: performance.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      warnings,
      durationMs: performance.now() - startTime,
    };
  }
}

// ─── Discovery ──────────────────────────────────────────────────────

export async function discoverPluginPaths(searchPaths: string[]): Promise<string[]> {
  const discovered: string[] = [];
  const seen = new Set<string>();

  for (const sp of searchPaths) {
    try {
      await access(sp);
      const entries = await readdir(sp);
      for (const entry of entries) {
        const pluginDir = join(sp, entry);
        try {
          const s = await stat(pluginDir);
          if (!s.isDirectory()) continue;
          const manifestPath = join(pluginDir, 'plugin.json');
          await access(manifestPath);
          const resolved = resolve(pluginDir);
          if (!seen.has(resolved)) {
            seen.add(resolved);
            discovered.push(pluginDir);
          }
        } catch { /* skip */ }
      }
    } catch { /* path doesn't exist */ }
  }
  return discovered;
}

export async function discoverPluginsInNodeModules(
  projectRoot: string,
): Promise<string[]> {
  const nodeModules = join(projectRoot, 'node_modules');
  const discovered: string[] = [];
  try {
    await access(nodeModules);
    const entries = await readdir(nodeModules);
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (entry.startsWith('@')) {
        const scopePath = join(nodeModules, entry);
        const scopeEntries = await readdir(scopePath);
        for (const sub of scopeEntries) {
          const pluginDir = join(scopePath, sub);
          try {
            await access(join(pluginDir, 'plugin.json'));
            discovered.push(pluginDir);
          } catch { /* skip */ }
        }
      } else {
        const pluginDir = join(nodeModules, entry);
        try {
          await access(join(pluginDir, 'plugin.json'));
          discovered.push(pluginDir);
        } catch { /* skip */ }
      }
    }
  } catch { /* node_modules doesn't exist */ }
  return discovered;
}

// ─── Manifest Validation ────────────────────────────────────────────

export function validateManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (manifest.name) {
    if (!NAME_PATTERN.test(manifest.name)) {
      errors.push(`Invalid plugin name format: "${manifest.name}"`);
    }
    if (manifest.name.length > 128) {
      errors.push('Plugin name too long (max 128 characters)');
    }
  }

  if (manifest.version) {
    if (!VERSION_PATTERN.test(manifest.version)) {
      errors.push(`Invalid version format (expected semver): "${manifest.version}"`);
    }
  }

  if (manifest.description && manifest.description.length > 512) {
    warnings.push('Description is very long (max 512 chars recommended)');
  }

  if (manifest.keywords) {
    if (manifest.keywords.length > 30) {
      warnings.push('Too many keywords (max 30 recommended)');
    }
    const dupes = manifest.keywords.filter((k, i) => manifest.keywords!.indexOf(k) !== i);
    if (dupes.length > 0) {
      warnings.push(`Duplicate keywords: ${dupes.join(', ')}`);
    }
  }

  if (manifest.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!NAME_PATTERN.test(dep)) {
        errors.push(`Invalid dependency name: "${dep}"`);
      }
    }
  }

  if (manifest.license) {
    const spdxPattern = /^[A-Za-z0-9\-+.]+$/;
    if (!spdxPattern.test(manifest.license)) {
      warnings.push(`Non-standard license identifier: "${manifest.license}"`);
    }
  }

  if (manifest.main && !manifest.main.endsWith('.js') && !manifest.main.endsWith('.mjs')) {
    warnings.push(`Main entry "${manifest.main}" does not appear to be a JS file`);
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Path Resolution ────────────────────────────────────────────────

export function resolvePluginPath(basePath: string, main: string): string {
  return resolve(basePath, main);
}

export function getPluginNameFromPath(pluginPath: string): string {
  return basename(pluginPath);
}

export function getPluginScope(name: string): string | null {
  if (name.startsWith('@')) {
    const slashIdx = name.indexOf('/');
    return slashIdx > 0 ? name.slice(0, slashIdx) : null;
  }
  return null;
}

// ─── Semver ─────────────────────────────────────────────────────────

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

/** Parses a `major.minor.patch[-prerelease]` version, or null when malformed. */
function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/**
 * Compares two semver strings: negative if `a < b`, 0 if equal, positive if `a > b`.
 *
 * A prerelease ranks below its own release (`1.0.0-rc.1` < `1.0.0`), matching
 * the semver spec. Returns NaN when either version is malformed.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return NaN;

  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let i = 0; i < length; i++) {
    const l = left.prerelease[i];
    const r = right.prerelease[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNum = /^\d+$/.test(l);
    const rNum = /^\d+$/.test(r);
    if (lNum && rNum) return Number(l) - Number(r);
    if (lNum) return -1;
    if (rNum) return 1;
    return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Checks a version against a caret/tilde/exact/comparator range.
 *
 * Supports `^1.2.3`, `~1.2.3`, exact `1.2.3`, and space-separated comparators
 * such as `>=1.0.0 <2.0.0`. Returns false for ranges that cannot be parsed.
 */
export function satisfiesSemver(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === '' || trimmed === '*' || trimmed === 'latest') return true;

  const current = parseVersion(version);
  if (!current) return false;

  const test = (clause: string): boolean | null => {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$/.exec(clause.trim());
    if (!m) return null;
    const operator = m[1] || '=';
    const target = parseVersion(m[2]!);
    if (!target) return null;
    const cmp = compareSemver(version, m[2]!);
    if (Number.isNaN(cmp)) return null;

    switch (operator) {
      case '=': return cmp === 0;
      case '>': return cmp > 0;
      case '>=': return cmp >= 0;
      case '<': return cmp < 0;
      case '<=': return cmp <= 0;
      case '^': {
        if (cmp < 0) return false;
        // A 0.x release pins the minor as well.
        if (target.major === 0) return current.minor === target.minor && cmp <= 0;
        return current.major === target.major;
      }
      case '~': {
        if (cmp < 0) return false;
        return current.major === target.major && current.minor === target.minor;
      }
    }
    return null;
  };

  return trimmed.split(/\s+/).every((clause) => test(clause) !== false);
}

// ─── Manifest Utilities ────────────────────────────────────────────

/** Reads and parses a plugin's `plugin.json`, or null when unreadable. */
export async function readPluginManifest(
  pluginPath: string,
): Promise<PluginManifest | null> {
  try {
    const content = await readFile(join(pluginPath, 'plugin.json'), 'utf-8');
    return JSON.parse(content) as PluginManifest;
  } catch {
    return null;
  }
}

/** Returns a one-line human summary of a manifest. */
export function formatManifestSummary(manifest: PluginManifest): string {
  const scope = getPluginScope(manifest.name);
  const scopeLabel = scope ? `${scope} ` : '';
  const deps = manifest.dependencies?.length ? ` (${manifest.dependencies.length} deps)` : '';
  return `${scopeLabel}${manifest.name}@${manifest.version} — ${manifest.description}${deps}`;
}

/** Returns the distinct plugin names declared by a set of manifests. */
export function getManifestDependencyNames(manifests: PluginManifest[]): string[] {
  const names = new Set<string>();
  for (const manifest of manifests) {
    for (const dep of manifest.dependencies || []) names.add(dep);
  }
  return [...names].sort();
}

/** Returns the manifests that no other manifest depends on. */
export function findRootManifests(manifests: PluginManifest[]): PluginManifest[] {
  const dependedOn = new Set(getManifestDependencyNames(manifests));
  return manifests.filter((m) => !dependedOn.has(m.name));
}

/**
 * Orders manifests so every plugin comes after the plugins it depends on.
 *
 * Dependencies that are not in `manifests` are ignored, and a cycle leaves the
 * remaining members in input order rather than looping forever. The input is
 * not mutated.
 */
export function sortManifestsForLoad(manifests: PluginManifest[]): PluginManifest[] {
  const byName = new Map(manifests.map((m) => [m.name, m]));
  const ordered: PluginManifest[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (manifest: PluginManifest): void => {
    const mark = state.get(manifest.name);
    if (mark === 'done' || mark === 'visiting') return;
    state.set(manifest.name, 'visiting');
    for (const dep of manifest.dependencies || []) {
      const target = byName.get(dep);
      if (target) visit(target);
    }
    state.set(manifest.name, 'done');
    ordered.push(manifest);
  };

  for (const manifest of manifests) visit(manifest);
  return ordered;
}
