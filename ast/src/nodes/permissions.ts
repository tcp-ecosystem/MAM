/**
 * MAM Permissions Section Node
 *
 * Defines the PermissionsNode and related types for the Permissions section.
 * A permission describes the access rights the module requires on a given
 * resource, including optional conditions and scope constraints.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Access level granted by a permission. */
export type PermissionLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'admin'
  | 'none'
  | string;

/** Resource kind. */
export type PermissionResourceKind =
  | 'filesystem'
  | 'network'
  | 'environment'
  | 'exec'
  | 'memory'
  | 'gpu'
  | 'database'
  | 'api'
  | string;

/** A condition that restricts when a permission applies. */
export interface PermissionCondition {
  /** Condition type. */
  type: 'env' | 'path' | 'time' | 'ip' | 'user' | 'custom';
  /** Condition expression. */
  expression: string;
  /** Human-readable description. */
  description?: string;
}

/** A single permission entry. */
export interface PermissionEntry {
  /** Resource identifier (e.g. "fs:/tmp/*", "net:api.openai.com"). */
  resource: string;
  /** Access level. */
  level: PermissionLevel;
  /** Optional human-readable description. */
  description?: string;
  /** Conditions that restrict the permission. */
  conditions?: PermissionCondition[];
  /** Whether this permission is optional. */
  optional?: boolean;
  /** Resource kind for categorisation. */
  resourceKind?: PermissionResourceKind;
}

/** The Permissions section AST node. */
export interface PermissionsNode {
  /** Discriminant – always `'Permissions'`. */
  type: 'Permissions';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of permission entries. */
  permissions: PermissionEntry[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a PermissionsNode.
 * Returns an empty array when the node is valid.
 */
export function validatePermissionsNode(node: PermissionsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'PermissionsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Permissions') {
    errors.push({ path: 'type', message: `Expected type "Permissions", got "${node.type}".` });
  }

  if (!Array.isArray(node.permissions)) {
    errors.push({ path: 'permissions', message: 'permissions must be an array.' });
    return errors;
  }

  node.permissions.forEach((perm, idx) => {
    const base = `permissions[${idx}]`;

    if (!perm.resource || typeof perm.resource !== 'string') {
      errors.push({ path: `${base}.resource`, message: 'resource must be a non-empty string.' });
    }

    if (!perm.level || typeof perm.level !== 'string') {
      errors.push({ path: `${base}.level`, message: 'level must be a non-empty string.' });
    }

    if (perm.conditions) {
      if (!Array.isArray(perm.conditions)) {
        errors.push({ path: `${base}.conditions`, message: 'conditions must be an array.' });
      } else {
        perm.conditions.forEach((cond, ci) => {
          const cBase = `${base}.conditions[${ci}]`;
          if (!cond.type || typeof cond.type !== 'string') {
            errors.push({ path: `${cBase}.type`, message: 'condition type must be a non-empty string.' });
          }
          if (!cond.expression || typeof cond.expression !== 'string') {
            errors.push({ path: `${cBase}.expression`, message: 'condition expression must be a non-empty string.' });
          }
        });
      }
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreatePermissionsNodeOptions {
  permissions?: PermissionEntry[];
  location?: SourceLocation;
}

/** Create a PermissionsNode with sensible defaults. */
export function createPermissionsNode(options: CreatePermissionsNodeOptions = {}): PermissionsNode {
  return {
    type: 'Permissions',
    permissions: options.permissions ?? [],
    location: options.location,
  };
}

/** Create a single PermissionEntry. */
export function createPermission(
  resource: string,
  level: PermissionLevel = 'read',
  overrides: Partial<Omit<PermissionEntry, 'resource' | 'level'>> = {},
): PermissionEntry {
  return {
    resource,
    level,
    ...overrides,
  };
}

/** Create a PermissionCondition. */
export function createPermissionCondition(
  type: PermissionCondition['type'],
  expression: string,
  description?: string,
): PermissionCondition {
  return { type, expression, description };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a PermissionsNode. */
export function isPermissionsNode(value: unknown): value is PermissionsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PermissionsNode).type === 'Permissions' &&
    Array.isArray((value as PermissionsNode).permissions)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all resource identifiers. */
export function getPermissionResources(node: PermissionsNode): string[] {
  return node.permissions.map((p) => p.resource);
}

/** Find a permission by resource. */
export function findPermissionByResource(
  node: PermissionsNode,
  resource: string,
): PermissionEntry | undefined {
  return node.permissions.find((p) => p.resource === resource);
}

/** Filter permissions by access level. */
export function getPermissionsByLevel(
  node: PermissionsNode,
  level: PermissionLevel,
): PermissionEntry[] {
  return node.permissions.filter((p) => p.level === level);
}

/** Filter permissions by resource kind. */
export function getPermissionsByResourceKind(
  node: PermissionsNode,
  kind: PermissionResourceKind,
): PermissionEntry[] {
  return node.permissions.filter((p) => p.resourceKind === kind);
}

/** Return only optional permissions. */
export function getOptionalPermissions(node: PermissionsNode): PermissionEntry[] {
  return node.permissions.filter((p) => p.optional === true);
}

/** Return only required (non-optional) permissions. */
export function getRequiredPermissions(node: PermissionsNode): PermissionEntry[] {
  return node.permissions.filter((p) => p.optional !== true);
}

/** Check whether the module requires admin access on any resource. */
export function requiresAdminAccess(node: PermissionsNode): boolean {
  return node.permissions.some((p) => p.level === 'admin');
}

/** Check whether a specific resource has a permission. */
export function hasPermission(node: PermissionsNode, resource: string): boolean {
  return node.permissions.some((p) => p.resource === resource);
}

/** Count total permissions. */
export function countPermissions(node: PermissionsNode): number {
  return node.permissions.length;
}
