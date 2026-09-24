/**
 * MAM Tarball Helpers
 *
 * Utilities for working with package tarball filenames.
 */

import { isValidVersion } from './semver.js';

// ============================================================================
// Functions
// ============================================================================

/**
 * Build a standard tarball filename for a package name and version.
 *
 * Scoped names are flattened (e.g. `@scope/name` becomes `scope-name`).
 *
 * @param name - The package name.
 * @param version - The package version.
 * @returns The tarball filename, e.g. `name-version.tgz`.
 */
export function tarballFilename(name: string, version: string): string {
  const safe = name.replace(/^@/, '').replace(/\//g, '-');
  return `${safe}-${version}.tgz`;
}

/**
 * Extract the package name and version from a tarball filename.
 *
 * The version is taken as the final hyphen-delimited segment and must be a
 * valid semver string.
 *
 * @param filename - The tarball filename to inspect.
 * @returns The extracted name and version, or `null` when the filename does
 * not match the expected shape.
 */
export function extractTarballInfo(filename: string): { name: string; version: string } | null {
  const base = stripTarballExt(filename);

  if (!base) {
    return null;
  }

  const idx = base.lastIndexOf('-');

  if (idx <= 0 || idx === base.length - 1) {
    return null;
  }

  const name = base.slice(0, idx);
  const version = base.slice(idx + 1);

  if (!name || !isValidVersion(version)) {
    return null;
  }

  return { name, version };
}

/**
 * Check whether a filename looks like a tarball archive.
 *
 * Matches both `.tgz` and `.tar.gz` extensions (case-insensitive).
 *
 * @param name - The filename to check.
 * @returns `true` when the filename ends with a tarball extension.
 */
export function isTarballFilename(name: string): boolean {
  return /\.(tgz|tar\.gz)$/i.test(name.trim());
}

/**
 * Remove the tarball extension (`.tgz` or `.tar.gz`) from a filename.
 *
 * @param name - The filename to strip.
 * @returns The filename without its tarball extension.
 */
export function stripTarballExt(name: string): string {
  return name.trim().replace(/\.(tgz|tar\.gz)$/i, '');
}