/**
 * MAM Metadata Section Node
 *
 * Defines the MetadataNode and related types for the Metadata / FrontMatter
 * section. Metadata captures module identity, authoring, versioning,
 * runtime requirements, permissions, tags, and custom properties.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Runtime identifier. */
export type MetadataRuntimeType =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'rust'
  | 'go'
  | 'shell'
  | string;

/** Permission identifiers that a module may require. */
export type PermissionKind =
  | 'network'
  | 'filesystem'
  | 'environment'
  | 'exec'
  | 'memory'
  | 'gpu'
  | 'database'
  | string;

/** A single permission entry. */
export interface MetadataPermission {
  /** Resource identifier. */
  resource: string;
  /** Access level. */
  level: 'read' | 'write' | 'execute' | 'admin';
  /** Human-readable description. */
  description?: string;
}

/** Dependency declaration inside metadata. */
export interface MetadataDependency {
  /** Dependency name. */
  name: string;
  /** Version constraint. */
  version?: string;
  /** Dependency source. */
  source?: string;
}

/** The Metadata section AST node. */
export interface MetadataNode {
  /** Discriminant – always `'Metadata'`. */
  type: 'Metadata';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Module identifier. */
  id?: string;
  /** Human-readable module name. */
  name?: string;
  /** Semantic version string. */
  version?: string;
  /** Module author. */
  author?: string;
  /** Short description. */
  description?: string;
  /** Classification tags. */
  tags?: string[];
  /** Target runtime. */
  runtime?: MetadataRuntimeType;
  /** Permissions the module requires. */
  permissions?: MetadataPermission[];
  /** Internal dependencies. */
  dependencies?: MetadataDependency[];
  /** Minimum MAM version required. */
  mam_version?: string;
  /** Repository URL. */
  repository?: string;
  /** License identifier. */
  license?: string;
  /** Custom key-value metadata. */
  custom?: Record<string, string>;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a MetadataNode.
 * Returns an empty array when the node is valid.
 */
export function validateMetadataNode(node: MetadataNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'MetadataNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Metadata') {
    errors.push({ path: 'type', message: `Expected type "Metadata", got "${node.type}".` });
  }

  if (node.id !== undefined && (typeof node.id !== 'string' || node.id.length === 0)) {
    errors.push({ path: 'id', message: 'id must be a non-empty string.' });
  }

  if (node.version !== undefined) {
    if (typeof node.version !== 'string') {
      errors.push({ path: 'version', message: 'version must be a string.' });
    } else if (!/^\d+\.\d+\.\d+/.test(node.version)) {
      errors.push({ path: 'version', message: `version "${node.version}" is not valid semver.` });
    }
  }

  if (node.tags !== undefined) {
    if (!Array.isArray(node.tags)) {
      errors.push({ path: 'tags', message: 'tags must be an array.' });
    } else {
      node.tags.forEach((tag, i) => {
        if (typeof tag !== 'string' || tag.length === 0) {
          errors.push({ path: `tags[${i}]`, message: 'tag must be a non-empty string.' });
        }
      });
    }
  }

  if (node.permissions !== undefined) {
    if (!Array.isArray(node.permissions)) {
      errors.push({ path: 'permissions', message: 'permissions must be an array.' });
    } else {
      node.permissions.forEach((perm, i) => {
        const base = `permissions[${i}]`;
        if (!perm.resource || typeof perm.resource !== 'string') {
          errors.push({ path: `${base}.resource`, message: 'resource must be a non-empty string.' });
        }
        if (!perm.level || typeof perm.level !== 'string') {
          errors.push({ path: `${base}.level`, message: 'level must be a non-empty string.' });
        }
      });
    }
  }

  if (node.dependencies !== undefined) {
    if (!Array.isArray(node.dependencies)) {
      errors.push({ path: 'dependencies', message: 'dependencies must be an array.' });
    } else {
      node.dependencies.forEach((dep, i) => {
        const base = `dependencies[${i}]`;
        if (!dep.name || typeof dep.name !== 'string') {
          errors.push({ path: `${base}.name`, message: 'dependency name must be a non-empty string.' });
        }
      });
    }
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateMetadataNodeOptions {
  id?: string;
  name?: string;
  version?: string;
  author?: string;
  description?: string;
  tags?: string[];
  runtime?: MetadataRuntimeType;
  permissions?: MetadataPermission[];
  dependencies?: MetadataDependency[];
  mam_version?: string;
  repository?: string;
  license?: string;
  custom?: Record<string, string>;
  location?: SourceLocation;
}

/** Create a MetadataNode with sensible defaults. */
export function createMetadataNode(options: CreateMetadataNodeOptions = {}): MetadataNode {
  return {
    type: 'Metadata',
    id: options.id,
    name: options.name,
    version: options.version,
    author: options.author,
    description: options.description,
    tags: options.tags,
    runtime: options.runtime,
    permissions: options.permissions,
    dependencies: options.dependencies,
    mam_version: options.mam_version,
    repository: options.repository,
    license: options.license,
    custom: options.custom,
    location: options.location,
  };
}

/** Create a MetadataPermission. */
export function createMetadataPermission(
  resource: string,
  level: MetadataPermission['level'] = 'read',
  description?: string,
): MetadataPermission {
  return { resource, level, description };
}

/** Create a MetadataDependency. */
export function createMetadataDependency(
  name: string,
  version?: string,
  source?: string,
): MetadataDependency {
  return { name, version, source };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a MetadataNode. */
export function isMetadataNode(value: unknown): value is MetadataNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as MetadataNode).type === 'Metadata'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all tag names. */
export function getTags(node: MetadataNode): string[] {
  return node.tags ?? [];
}

/** Check whether a specific tag is present. */
export function hasTag(node: MetadataNode, tag: string): boolean {
  return node.tags?.includes(tag) ?? false;
}

/** Return all permission resources. */
export function getPermissionResources(node: MetadataNode): string[] {
  return (node.permissions ?? []).map((p) => p.resource);
}

/** Find a permission by resource name. */
export function findPermissionByResource(
  node: MetadataNode,
  resource: string,
): MetadataPermission | undefined {
  return node.permissions?.find((p) => p.resource === resource);
}

/** Return all dependency names. */
export function getDependencyNames(node: MetadataNode): string[] {
  return (node.dependencies ?? []).map((d) => d.name);
}

/** Check whether a dependency is declared. */
export function hasDependency(node: MetadataNode, name: string): boolean {
  return node.dependencies?.some((d) => d.name === name) ?? false;
}

/** Merge two MetadataNodes (second overrides first). */
export function mergeMetadataNodes(base: MetadataNode, override: MetadataNode): MetadataNode {
  return {
    type: 'Metadata',
    id: override.id ?? base.id,
    name: override.name ?? base.name,
    version: override.version ?? base.version,
    author: override.author ?? base.author,
    description: override.description ?? base.description,
    tags: [...(base.tags ?? []), ...(override.tags ?? [])],
    runtime: override.runtime ?? base.runtime,
    permissions: [...(base.permissions ?? []), ...(override.permissions ?? [])],
    dependencies: [...(base.dependencies ?? []), ...(override.dependencies ?? [])],
    mam_version: override.mam_version ?? base.mam_version,
    repository: override.repository ?? base.repository,
    license: override.license ?? base.license,
    custom: { ...(base.custom ?? {}), ...(override.custom ?? {}) },
    location: override.location ?? base.location,
  };
}

export function hasMetadataPermissions(node: MetadataNode): boolean {
  return (node.permissions?.length ?? 0) > 0;
}

export function countMetadataPermissions(node: MetadataNode): number {
  return node.permissions?.length ?? 0;
}

export function summarizeMetadata(node: MetadataNode): string {
  const header = [
    node.name ?? node.id,
    node.version ? `v${node.version}` : undefined,
    node.runtime,
  ]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(' ');
  const tags = (node.tags ?? []).length;
  const permissions = (node.permissions ?? []).length;
  const dependencies = (node.dependencies ?? []).length;
  return `${header || 'Metadata'} (${tags} tags, ${permissions} permissions, ${dependencies} dependencies)`;
}

export function withMetadataPermission(
  node: MetadataNode,
  permission: MetadataPermission,
): MetadataNode {
  return {
    ...node,
    permissions: [...(node.permissions ?? []), permission],
  };
}

export function withoutMetadataPermission(
  node: MetadataNode,
  resourceOrPredicate: string | ((permission: MetadataPermission) => boolean),
): MetadataNode {
  if (!node.permissions) {
    return { ...node };
  }
  const predicate =
    typeof resourceOrPredicate === 'string'
      ? (permission: MetadataPermission) => permission.resource === resourceOrPredicate
      : resourceOrPredicate;
  return {
    ...node,
    permissions: node.permissions.filter((permission) => !predicate(permission)),
  };
}

export function cloneMetadataNode(
  node: MetadataNode,
  options?: { stripLocation?: boolean },
): MetadataNode {
  const clone: MetadataNode = { ...node };
  if (node.tags) {
    clone.tags = [...node.tags];
  }
  if (node.permissions) {
    clone.permissions = node.permissions.map((permission) => ({ ...permission }));
  }
  if (node.dependencies) {
    clone.dependencies = node.dependencies.map((dependency) => ({ ...dependency }));
  }
  if (node.custom) {
    clone.custom = { ...node.custom };
  }
  if (options?.stripLocation) {
    delete clone.location;
  }
  return clone;
}

export function mergeMetadataPermissions(a: MetadataNode, b: MetadataNode): MetadataPermission[] {
  const merged = (a.permissions ?? []).map((permission) => ({ ...permission }));
  const index = new Map<string, number>(
    merged.map((permission, i): [string, number] => [permission.resource, i]),
  );
  for (const permission of b.permissions ?? []) {
    const existing = index.get(permission.resource);
    if (existing !== undefined) {
      merged[existing] = { ...permission };
    } else {
      index.set(permission.resource, merged.length);
      merged.push({ ...permission });
    }
  }
  return merged;
}
