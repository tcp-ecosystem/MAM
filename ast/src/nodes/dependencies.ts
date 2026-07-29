/**
 * MAM Dependencies Section Node
 *
 * Defines the DependenciesNode and related types for the Dependencies section.
 * A dependency describes an external or internal module/package that must be
 * available at runtime or build time.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** The source origin of a dependency. */
export type DependencySource =
  | 'pip'
  | 'npm'
  | 'cargo'
  | 'go'
  | 'maven'
  | 'nuget'
  | 'git'
  | 'local'
  | 'url'
  | 'standard'
  | string;

/** The type/kind of dependency. */
export type DependencyType =
  | 'runtime'
  | 'development'
  | 'test'
  | 'build'
  | 'optional'
  | 'peer'
  | 'system'
  | string;

/** A single dependency entry. */
export interface Dependency {
  /** Name of the dependency. */
  name: string;
  /** Semver constraint or version string. */
  version?: string;
  /** Where to fetch the dependency from. */
  source?: DependencySource;
  /** Dependency type. */
  type?: DependencyType;
  /** Whether the dependency is optional. */
  optional?: boolean;
  /** Human-readable reason for the dependency. */
  reason?: string;
  /** Alternative names or package aliases. */
  aliases?: string[];
  /** Constraints that limit when the dependency applies. */
  conditions?: string[];
}

/** The Dependencies section AST node. */
export interface DependenciesNode {
  /** Discriminant – always `'Dependencies'`. */
  type: 'Dependencies';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of dependencies. */
  dependencies: Dependency[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a DependenciesNode.
 * Returns an empty array when the node is valid.
 */
export function validateDependenciesNode(node: DependenciesNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'DependenciesNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Dependencies') {
    errors.push({ path: 'type', message: `Expected type "Dependencies", got "${node.type}".` });
  }

  if (!Array.isArray(node.dependencies)) {
    errors.push({ path: 'dependencies', message: 'dependencies must be an array.' });
    return errors;
  }

  const seen = new Set<string>();
  node.dependencies.forEach((dep, idx) => {
    const base = `dependencies[${idx}]`;

    if (!dep.name || typeof dep.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'Dependency name must be a non-empty string.' });
    } else if (seen.has(dep.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate dependency "${dep.name}".` });
    } else {
      seen.add(dep.name);
    }

    if (dep.version !== undefined && typeof dep.version !== 'string') {
      errors.push({ path: `${base}.version`, message: 'version must be a string.' });
    }

    if (dep.source !== undefined && typeof dep.source !== 'string') {
      errors.push({ path: `${base}.source`, message: 'source must be a string.' });
    }

    if (dep.optional !== undefined && typeof dep.optional !== 'boolean') {
      errors.push({ path: `${base}.optional`, message: 'optional must be a boolean.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateDependenciesNodeOptions {
  dependencies?: Dependency[];
  location?: SourceLocation;
}

/** Create a DependenciesNode with sensible defaults. */
export function createDependenciesNode(options: CreateDependenciesNodeOptions = {}): DependenciesNode {
  return {
    type: 'Dependencies',
    dependencies: options.dependencies ?? [],
    location: options.location,
  };
}

/** Create a single Dependency with defaults. */
export function createDependency(name: string, overrides: Partial<Omit<Dependency, 'name'>> = {}): Dependency {
  return {
    name,
    optional: false,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a DependenciesNode. */
export function isDependenciesNode(value: unknown): value is DependenciesNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as DependenciesNode).type === 'Dependencies' &&
    Array.isArray((value as DependenciesNode).dependencies)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all dependency names. */
export function getDependencyNames(node: DependenciesNode): string[] {
  return node.dependencies.map((d) => d.name);
}

/** Find a dependency by name. */
export function findDependencyByName(node: DependenciesNode, name: string): Dependency | undefined {
  return node.dependencies.find((d) => d.name === name);
}

/** Filter dependencies by source. */
export function getDependenciesBySource(node: DependenciesNode, source: DependencySource): Dependency[] {
  return node.dependencies.filter((d) => d.source === source);
}

/** Filter dependencies by type. */
export function getDependenciesByType(node: DependenciesNode, type: DependencyType): Dependency[] {
  return node.dependencies.filter((d) => d.type === type);
}

/** Return only optional dependencies. */
export function getOptionalDependencies(node: DependenciesNode): Dependency[] {
  return node.dependencies.filter((d) => d.optional === true);
}

/** Return only required (non-optional) dependencies. */
export function getRequiredDependencies(node: DependenciesNode): Dependency[] {
  return node.dependencies.filter((d) => d.optional !== true);
}

/** Return runtime dependencies. */
export function getRuntimeDependencies(node: DependenciesNode): Dependency[] {
  return node.dependencies.filter((d) => d.type === 'runtime' || d.type === undefined);
}

/** Check whether a specific dependency exists. */
export function hasDependency(node: DependenciesNode, name: string): boolean {
  return node.dependencies.some((d) => d.name === name);
}

/** Count dependencies. */
export function countDependencies(node: DependenciesNode): number {
  return node.dependencies.length;
}
