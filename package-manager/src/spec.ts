/**
 * MAM Package Spec Parsing
 *
 * Parses and normalizes package specification strings used in dependencies.
 */

import { isGitUrl } from './git.js';

// ============================================================================
// Types
// ============================================================================

export interface PackageSpec {
  /** Package name (empty when the spec is a workspace/file/git source) */
  name: string;
  /** Version range (semver) when the spec includes one */
  versionRange?: string;
  /** Source protocol for non-registry specs: "workspace", "file", or "git" */
  source?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/;

// ============================================================================
// Functions
// ============================================================================

/**
 * Parse a package spec string into its structural components.
 *
 * Supported forms:
 * - `name` -> `{ name }`
 * - `name@1.2.3` / `name@^1.2` -> `{ name, versionRange }`
 * - `workspace:*` -> `{ name: '', versionRange: '*', source: 'workspace' }`
 * - `file:./path` -> `{ name: '', source: 'file', versionRange: './path' }`
 * - `git:https://...` -> `{ name: '', source: 'git', versionRange: 'https://...' }`
 *
 * For workspace/file/git specs the package name is not encoded in the value,
 * so it is left empty (the manifest key provides it).
 *
 * @param spec - The package spec string to parse.
 * @returns The parsed spec components.
 */
export function parsePackageSpec(spec: string): PackageSpec {
  const trimmed = (spec ?? '').trim();

  if (trimmed.startsWith('workspace:')) {
    const versionRange = trimmed.slice('workspace:'.length) || '*';
    return { name: '', versionRange, source: 'workspace' };
  }

  if (trimmed.startsWith('file:')) {
    const versionRange = trimmed.slice('file:'.length);
    return { name: '', versionRange, source: 'file' };
  }

  if (trimmed.startsWith('git:')) {
    const versionRange = trimmed.slice('git:'.length);
    return { name: '', versionRange, source: 'git' };
  }

  if (isGitUrl(trimmed)) {
    return { name: '', source: 'git' };
  }

  const [name, versionRange] = splitNameVersion(trimmed);

  if (versionRange !== undefined) {
    return { name, versionRange };
  }

  return { name };
}

/**
 * Split a spec string into `[name, version]`. Handles scoped package names
 * such as `@scope/name@1.2.3`.
 *
 * @param spec - The spec string to split.
 * @returns A tuple of the package name and optional version.
 */
export function splitNameVersion(spec: string): [string, string | undefined] {
  const trimmed = (spec ?? '').trim();

  if (trimmed.startsWith('@')) {
    const idx = trimmed.indexOf('@', 1);

    if (idx > 1) {
      const version = trimmed.slice(idx + 1);
      return [trimmed.slice(0, idx), version || undefined];
    }

    return [trimmed, undefined];
  }

  const idx = trimmed.indexOf('@');

  if (idx >= 0) {
    const version = trimmed.slice(idx + 1);
    return [trimmed.slice(0, idx), version || undefined];
  }

  return [trimmed, undefined];
}

/**
 * Check whether a string is a valid package name.
 *
 * Names must be lowercase, start with an alphanumeric character (or a scope),
 * and may contain hyphens, dots, underscores, and tildes.
 *
 * @param name - The name to validate.
 * @returns `true` when the name is valid.
 */
export function isValidPackageName(name: string): boolean {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return false;
  }

  if (name !== name.toLowerCase()) {
    return false;
  }

  if (name.length > 214) {
    return false;
  }

  return NAME_RE.test(name);
}

/**
 * Normalize a package name to a canonical lowercase form.
 *
 * Trims whitespace, lowercases, replaces whitespace with hyphens, drops
 * invalid characters, and collapses repeated slashes.
 *
 * @param name - The name to normalize.
 * @returns The normalized package name.
 */
export function normalizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-._~/@]+/g, '')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}