/**
 * MAM Permission Analyzer
 *
 * Validates permission keys/values declared on each module, detects conflicting
 * permission declarations across a system, and enforces deny-overrides: when a
 * policy module (or any member) contributes a deny value (`none` / `denied`)
 * for a shared permission key, that deny wins over any conflicting allow.
 */

import { V2ModuleNode, V2PermissionSet } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/** A single permission-analysis finding. */
export interface PermissionIssue {
  /** Stable diagnostic code, e.g. `INVALID_PERMISSION` or `PERMISSION_CONFLICT`. */
  code: string;
  /** Human-readable description of the problem. */
  message: string;
  /** The module the finding belongs to. */
  module?: string;
  /** The permission key involved, when applicable. */
  permission?: string;
  /** Whether this is an error (blocks validation) or a warning. */
  severity: 'error' | 'warning';
}

/** A permission disagreement discovered across modules within a system. */
export interface PermissionConflict {
  /** First module involved in the conflict. */
  moduleA: string;
  /** Second module involved in the conflict. */
  moduleB: string;
  /** The permission key whose values disagree. */
  permission: string;
  /** Value declared by `moduleA`. */
  valueA: string;
  /** Value declared by `moduleB`. */
  valueB: string;
  /** Winning value after applying deny-overrides. */
  resolved: string;
}

/** Result of analyzing permissions across a module list. */
export interface PermissionAnalysisResult {
  /** True when there are no error-severity issues. */
  valid: boolean;
  /** All findings (invalid keys/values and in-module conflicts). */
  issues: PermissionIssue[];
  /** Cross-module permission disagreements, with deny-overrides applied. */
  conflicts: PermissionConflict[];
}

// ============================================================================
// Permission Validators
// ============================================================================

const PERMISSION_VALUES: Record<string, readonly string[]> = {
  filesystem: ['read', 'write', 'none'],
  network: ['internet', 'internal', 'none'],
  python: ['sandbox', 'full', 'none'],
  memory: ['local', 'shared', 'none'],
  exec: ['allowed', 'denied'],
};

/**
 * How restrictive a permission value is, per key. Higher rank = more
 * restrictive (and thus the winner under deny-overrides).
 */
const RESTRICTIVE_RANK: Record<string, Record<string, number>> = {
  filesystem: { write: 1, read: 2, none: 3 },
  network: { internet: 1, internal: 2, none: 3 },
  python: { full: 1, sandbox: 2, none: 3 },
  memory: { shared: 1, local: 2, none: 3 },
  exec: { allowed: 1, denied: 2 },
};

// ============================================================================
// Permission Analyzer
// ============================================================================

/**
 * Validates permissions and resolves permission conflicts across a collection
 * of {@link V2ModuleNode} modules.
 */
export class PermissionAnalyzer {
  /**
   * Analyze permissions for a list of modules.
   *
   * @param modules - The modules whose permissions are validated.
   * @returns A {@link PermissionAnalysisResult} with issues and conflicts.
   */
  analyzePermissions(modules: V2ModuleNode[]): PermissionAnalysisResult {
    const issues: PermissionIssue[] = [];
    const conflicts: PermissionConflict[] = [];
    const byName = new Map(modules.map((m) => [m.name, m]));

    for (const mod of modules) {
      this.validatePermissionSet(mod, issues);
      this.checkInModuleConflict(mod, issues);
    }

    for (const mod of modules) {
      if (mod.moduleType === 'system') {
        this.checkSystemConflicts(mod, byName, conflicts);
      }
    }

    return {
      valid: issues.every((i) => i.severity !== 'error'),
      issues,
      conflicts,
    };
  }

  // ==========================================================================
  // Internals
  // ==========================================================================

  private validatePermissionSet(mod: V2ModuleNode, issues: PermissionIssue[]): void {
    const perms = mod.permissions;
    if (!perms) return;

    for (const [key, value] of Object.entries(perms) as [keyof V2PermissionSet, unknown][]) {
      if (key === 'custom') {
        const custom = perms.custom;
        if (custom === undefined) continue;
        for (const [customKey, customValue] of Object.entries(custom)) {
          if (typeof customValue !== 'string' || customValue.trim() === '') {
            issues.push({
              code: 'INVALID_PERMISSION',
              message: `Module "${mod.name}" declares an invalid custom permission "${customKey}"`,
              module: mod.name,
              permission: customKey,
              severity: 'error',
            });
          }
        }
        continue;
      }

      if (!(key in PERMISSION_VALUES)) {
        issues.push({
          code: 'INVALID_PERMISSION',
          message: `Module "${mod.name}" declares an unknown permission key "${String(key)}"`,
          module: mod.name,
          permission: String(key),
          severity: 'error',
        });
        continue;
      }

      const allowed = PERMISSION_VALUES[key] ?? [];
      const str = String(value);
      if (!allowed.includes(str)) {
        issues.push({
          code: 'INVALID_PERMISSION',
          message: `Module "${mod.name}" declares an invalid value "${str}" for permission "${String(key)}"`,
          module: mod.name,
          permission: String(key),
          severity: 'error',
        });
      }
    }
  }

  private checkInModuleConflict(mod: V2ModuleNode, issues: PermissionIssue[]): void {
    const perms = mod.permissions;
    if (!perms) return;

    if (perms.filesystem === 'write' && perms.network === 'none') {
      issues.push({
        code: 'PERMISSION_CONFLICT',
        message: `Module "${mod.name}" has filesystem write access but no network access`,
        module: mod.name,
        permission: 'network',
        severity: 'warning',
      });
    }
    if (perms.exec === 'allowed' && perms.network === 'none' && perms.python === 'full') {
      issues.push({
        code: 'PERMISSION_CONFLICT',
        message: `Module "${mod.name}" allows arbitrary execution while network access is disabled; verify the intent`,
        module: mod.name,
        permission: 'exec',
        severity: 'warning',
      });
    }
  }

  private checkSystemConflicts(
    system: V2ModuleNode,
    byName: Map<string, V2ModuleNode>,
    conflicts: PermissionConflict[],
  ): void {
    const members = [...(system.agents ?? []), ...(system.modules ?? [])];
    const memberModules = members
      .map((name) => byName.get(name))
      .filter((m): m is V2ModuleNode => m !== undefined && m.permissions !== undefined);

    if (memberModules.length < 2) return;

    const valuesByKey = new Map<string, { value: string; module: string }[]>();
    for (const member of memberModules) {
      const perms = member.permissions!;
      for (const [key, value] of Object.entries(perms) as [keyof V2PermissionSet, unknown][]) {
        if (key === 'custom' || value === undefined) continue;
        const entry = valuesByKey.get(String(key)) ?? [];
        entry.push({ value: String(value), module: member.name });
        valuesByKey.set(String(key), entry);
      }
    }

    for (const [key, entries] of valuesByKey) {
      const distinct = [...new Set(entries.map((e) => e.value))];
      if (distinct.length < 2) continue;

      // Deny-overrides: pick the most restrictive (deny) value among the
      // conflicting declarations.
      const resolved = this.resolveConflict(key, distinct);
      const denyWinner = entries.find((e) => e.value === resolved);
      const other = entries.find((e) => e.value !== resolved);

      conflicts.push({
        moduleA: other?.module ?? entries[0].module,
        moduleB: denyWinner?.module ?? entries[1]?.module ?? entries[0].module,
        permission: key,
        valueA: other?.value ?? entries[0].value,
        valueB: denyWinner?.value ?? entries[0].value,
        resolved,
      });
    }
  }

  private resolveConflict(key: string, values: string[]): string {
    const ranks = RESTRICTIVE_RANK[key];
    if (!ranks) return values[0];
    return values.reduce((a, b) => {
      const ra = ranks[a] ?? 0;
      const rb = ranks[b] ?? 0;
      return rb > ra ? b : a;
    });
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Validate the permission set of a single module in isolation.
 *
 * @param mod - The module whose permissions are validated.
 * @returns The list of {@link PermissionIssue} findings for that module.
 */
export function validatePermissions(mod: V2ModuleNode): PermissionIssue[] {
  return new PermissionAnalyzer().analyzePermissions([mod]).issues;
}