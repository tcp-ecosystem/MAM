/**
 * MAM Validation Helpers
 *
 * Validation functions for package names, version ranges, specs, and
 * manifests. Each function returns an array of error messages.
 */

import { PackageManifest } from './package.js';
import { isValidVersion, isValidRange } from './semver.js';
import { parsePackageSpec } from './spec.js';

// ============================================================================
// Constants
// ============================================================================

const NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9][a-z0-9-._~]*$/;

// ============================================================================
// Functions
// ============================================================================

/**
 * Validate a package name.
 *
 * Names must be non-empty, lowercase, at most 214 characters, and consist of
 * alphanumeric characters, hyphens, dots, underscores, or tildes (optionally
 * scoped with `@scope/`).
 *
 * @param name - The name to validate.
 * @returns An array of error messages (empty when valid).
 */
export function validatePackageName(name: string): string[] {
  const errors: string[] = [];

  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Package name is required');
    return errors;
  }

  if (name !== name.toLowerCase()) {
    errors.push('Package name must be lowercase');
  }

  if (name.length > 214) {
    errors.push('Package name must be 214 characters or fewer');
  }

  if (!NAME_RE.test(name)) {
    errors.push(
      'Package name must contain only lowercase alphanumeric characters, hyphens, dots, underscores, or tildes'
    );
  }

  return errors;
}

/**
 * Validate a version range expression.
 *
 * @param range - The range to validate.
 * @returns An array of error messages (empty when valid).
 */
export function validateVersionRange(range: string): string[] {
  const errors: string[] = [];

  if (typeof range !== 'string' || range.trim().length === 0) {
    errors.push('Version range is required');
    return errors;
  }

  if (!isValidRange(range)) {
    errors.push(`Invalid version range: ${range}`);
  }

  return errors;
}

/**
 * Validate a package spec string (name, optional version range, or source).
 *
 * @param spec - The spec to validate.
 * @returns An array of error messages (empty when valid).
 */
export function validatePackageSpec(spec: string): string[] {
  const errors: string[] = [];

  if (typeof spec !== 'string' || spec.trim().length === 0) {
    errors.push('Package spec is required');
    return errors;
  }

  const parsed = parsePackageSpec(spec);

  if (parsed.name) {
    errors.push(...validatePackageName(parsed.name));

    if (parsed.versionRange !== undefined) {
      errors.push(...validateVersionRange(parsed.versionRange));
    }
  }

  return errors;
}

/**
 * Validate a package manifest.
 *
 * Checks the manifest name, version, and each dependency's name and version
 * range.
 *
 * @param manifest - The manifest to validate.
 * @returns An array of error messages (empty when valid).
 */
export function validatePackageManifest(manifest: PackageManifest): string[] {
  const errors: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    errors.push('Manifest is required');
    return errors;
  }

  errors.push(...validatePackageName(manifest.name));

  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push('Package version is required');
  } else if (!isValidVersion(manifest.version)) {
    errors.push(`Invalid package version: ${manifest.version}`);
  }

  for (const dep of manifest.dependencies ?? []) {
    if (!dep.name) {
      errors.push('Dependency name is required');
    } else {
      errors.push(...validatePackageName(dep.name));
    }

    if (!dep.version) {
      errors.push(`Dependency "${dep.name ?? 'unknown'}" version is required`);
    } else {
      errors.push(...validateVersionRange(dep.version));
    }
  }

  return errors;
}

/**
 * Check whether a package manifest is valid.
 *
 * @param manifest - The manifest to check.
 * @returns `true` when the manifest produces no validation errors.
 */
export function isValidPackageManifest(manifest: PackageManifest): boolean {
  return validatePackageManifest(manifest).length === 0;
}