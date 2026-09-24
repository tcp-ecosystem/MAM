/**
 * MAM Package
 * 
 * Package definition and manifest management.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseMAM } from '@mam/parser';

// ============================================================================
// Types
// ============================================================================

export interface PackageManifest {
  /** Package name */
  name: string;
  /** Package version */
  version: string;
  /** Package description */
  description: string;
  /** Package author */
  author: string;
  /** Package license */
  license: string;
  /** Package tags */
  tags: string[];
  /** Package dependencies */
  dependencies: PackageDependency[];
  /** Package entry point */
  main: string;
  /** Package files */
  files: string[];
  /** Repository URL */
  repository?: string;
  /** Homepage URL */
  homepage?: string;
  /** Keywords */
  keywords?: string[];
  /** MAM version required */
  mamVersion?: string;
}

export interface PackageDependency {
  /** Dependency name */
  name: string;
  /** Version range (semver) */
  version: string;
  /** Whether dependency is optional */
  optional?: boolean;
}

export interface PackageConfig {
  /** Package directory */
  dir: string;
  /** Registry URL */
  registry?: string;
  /** Cache directory */
  cacheDir?: string;
}

export interface PackageLock {
  /** Lock file version */
  lockfileVersion: number;
  /** Resolved packages */
  packages: Record<string, LockedPackage>;
}

export interface LockedPackage {
  /** Resolved version */
  version: string;
  /** Resolved URL */
  resolved: string;
  /** Integrity hash */
  integrity: string;
}

// ============================================================================
// Package Manager
// ============================================================================

export class MAMPackage {
  private config: PackageConfig;
  private manifest: PackageManifest | null = null;

  constructor(config: PackageConfig) {
    this.config = config;
  }

  /**
   * Initialize a new package
   */
  async init(name: string, options: Partial<PackageManifest> = {}): Promise<PackageManifest> {
    const dir = join(this.config.dir, name);
    
    try {
      await access(dir);
      throw new Error(`Directory "${name}" already exists`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    await mkdir(dir, { recursive: true });

    const manifest: PackageManifest = {
      name,
      version: options.version || '1.0.0',
      description: options.description || `${name} MAM module`,
      author: options.author || 'Unknown',
      license: options.license || 'MIT',
      tags: options.tags || [],
      dependencies: [],
      main: 'index.mam.md',
      files: ['*.mam.md', '*.mam', 'README.md'],
      ...options,
    };

    await writeFile(
      join(dir, 'mam-package.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    // Create default module
    await writeFile(
      join(dir, 'index.mam.md'),
      this.generateDefaultModule(name),
      'utf-8'
    );

    // Create README
    await writeFile(
      join(dir, 'README.md'),
      `# ${name}\n\n${manifest.description}\n`,
      'utf-8'
    );

    this.manifest = manifest;
    return manifest;
  }

  /**
   * Load package from directory
   */
  async load(dir: string): Promise<PackageManifest> {
    const manifestPath = join(dir, 'mam-package.json');
    
    try {
      const content = await readFile(manifestPath, 'utf-8');
      this.manifest = JSON.parse(content);
      return this.manifest!;
    } catch (error) {
      throw new Error(`No valid package found in "${dir}"`);
    }
  }

  /**
   * Save package manifest
   */
  async save(dir?: string): Promise<void> {
    if (!this.manifest) {
      throw new Error('No package loaded');
    }

    const saveDir = dir || this.config.dir;
    const manifestPath = join(saveDir, 'mam-package.json');
    
    await writeFile(
      manifestPath,
      JSON.stringify(this.manifest, null, 2),
      'utf-8'
    );
  }

  /**
   * Add a dependency
   */
  async addDependency(name: string, version: string, optional: boolean = false): Promise<void> {
    if (!this.manifest) {
      throw new Error('No package loaded');
    }

    // Check if dependency already exists
    const existing = this.manifest.dependencies.find(d => d.name === name);
    if (existing) {
      existing.version = version;
      existing.optional = optional;
    } else {
      this.manifest.dependencies.push({ name, version, optional });
    }
  }

  /**
   * Remove a dependency
   */
  async removeDependency(name: string): Promise<void> {
    if (!this.manifest) {
      throw new Error('No package loaded');
    }

    this.manifest.dependencies = this.manifest.dependencies.filter(d => d.name !== name);
  }

  /**
   * Get package manifest
   */
  getManifest(): PackageManifest | null {
    return this.manifest;
  }

  /**
   * Validate package
   */
  validate(): ValidationResult {
    if (!this.manifest) {
      return { valid: false, errors: ['No package loaded'], warnings: [] };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate name
    if (!this.manifest.name) {
      errors.push('Package name is required');
    } else if (!/^[a-z][a-z0-9-]*$/.test(this.manifest.name)) {
      errors.push('Package name must be lowercase alphanumeric with hyphens');
    }

    // Validate version
    if (!this.manifest.version) {
      errors.push('Package version is required');
    } else if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/.test(this.manifest.version)) {
      errors.push('Package version must be valid semver');
    }

    // Validate main
    if (!this.manifest.main) {
      warnings.push('Package main is not set');
    }

    // Validate dependencies
    for (const dep of this.manifest.dependencies) {
      if (!dep.name) {
        errors.push('Dependency name is required');
      }
      if (!dep.version) {
        errors.push(`Dependency "${dep.name}" version is required`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private generateDefaultModule(name: string): string {
    return `---
id: ${name}
version: 2.0.0
name: ${name}
author: Unknown
runtime: python
tags: []
---

# ${name}

## Purpose

Describe what this module does.

## Rules

- Rule 1
- Rule 2

## Examples

Example usage here.
`;
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Manifest Helpers
// ============================================================================

/**
 * Build a package manifest from a partial definition, filling in sensible
 * defaults for every unspecified field.
 *
 * Defaults: version `'1.0.0'`, description `''`, author `''`, license
 * `'MIT'`, tags `[]`, dependencies `[]`, main `'index.mam.md'`, files `[]`.
 *
 * @param partial - Partial manifest fields to merge over the defaults.
 * @returns A complete {@link PackageManifest}.
 */
export function createPackageManifest(partial: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: partial.name ?? '',
    version: partial.version ?? '1.0.0',
    description: partial.description ?? '',
    author: partial.author ?? '',
    license: partial.license ?? 'MIT',
    tags: partial.tags ?? [],
    dependencies: partial.dependencies ?? [],
    main: partial.main ?? 'index.mam.md',
    files: partial.files ?? [],
    repository: partial.repository,
    homepage: partial.homepage,
    keywords: partial.keywords,
    mamVersion: partial.mamVersion,
  };
}

/**
 * Build a `name -> version` map from a manifest's dependencies.
 *
 * @param manifest - The manifest whose dependencies are read.
 * @returns A record mapping each dependency name to its version string.
 */
export function getManifestDependenciesMap(manifest: PackageManifest): Record<string, string> {
  const map: Record<string, string> = {};

  for (const dep of manifest.dependencies) {
    map[dep.name] = dep.version;
  }

  return map;
}