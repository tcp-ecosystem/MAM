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

export function hasDependencies(node: DependenciesNode): boolean {
  return node.dependencies.length > 0;
}

export function countDependenciesByType(node: DependenciesNode, type: DependencyType): number {
  return node.dependencies.filter((dependency) => dependency.type === type).length;
}

export function summarizeDependencies(node: DependenciesNode): string {
  const names = node.dependencies.map((dependency) =>
    dependency.version ? `${dependency.name}@${dependency.version}` : dependency.name,
  );
  if (names.length === 0) {
    return '0 dependencies';
  }
  return `${names.length} dependencies: ${names.join(', ')}`;
}

export function withDependency(node: DependenciesNode, dependency: Dependency): DependenciesNode {
  return {
    ...node,
    dependencies: [...node.dependencies, dependency],
  };
}

export function withoutDependency(
  node: DependenciesNode,
  match: string | ((dependency: Dependency) => boolean),
): DependenciesNode {
  const remove =
    typeof match === 'string'
      ? (dependency: Dependency) => dependency.name === match
      : match;
  return {
    ...node,
    dependencies: node.dependencies.filter((dependency) => !remove(dependency)),
  };
}

export function cloneDependenciesNode(
  node: DependenciesNode,
  options: { stripLocation?: boolean } = {},
): DependenciesNode {
  const copy: DependenciesNode = {
    ...node,
    dependencies: node.dependencies.map((dependency) => {
      const next: Dependency = { ...dependency };
      if (dependency.aliases) {
        next.aliases = [...dependency.aliases];
      }
      if (dependency.conditions) {
        next.conditions = [...dependency.conditions];
      }
      return next;
    }),
  };
  if (options.stripLocation) {
    delete copy.location;
  } else if (copy.location) {
    copy.location = {
      source: copy.location.source,
      start: { ...copy.location.start },
      end: { ...copy.location.end },
    };
  }
  return copy;
}

export function mergeDependenciesNodes(a: DependenciesNode, b: DependenciesNode): DependenciesNode {
  return {
    ...a,
    dependencies: [...a.dependencies, ...b.dependencies],
  };
}
