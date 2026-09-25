/**
 * MAM Type Checker
 *
 * Validates that every module declares a valid module type and that the
 * type-specific required fields are present (e.g. an agent needs `role` and
 * `goal`, a tool needs `provider`, a memory needs `format` and `backend`,
 * a workflow needs `steps`, a system needs `modules` or `agents`).
 *
 * Also resolves capabilities: any module referenced from a `tools` or
 * `agents` list must map to a known module name in the same document.
 */

import { V2ModuleNode, isModuleType } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/**
 * A single type-check finding. `severity` distinguishes hard errors from
 * advisory warnings so consumers can decide how strictly to gate.
 */
export interface TypeCheckError {
  /** Stable diagnostic code, e.g. `INVALID_MODULE_TYPE`, `MISSING_ROLE`. */
  code: string;
  /** Human-readable description of the problem. */
  message: string;
  /** The module the finding belongs to, when applicable. */
  module?: string;
  /** The offending field on the module, when applicable. */
  field?: string;
  /** Whether this is an error (blocks validation) or a warning. */
  severity: 'error' | 'warning';
}

/** Aggregate statistics for a `typeCheck` run. */
export interface TypeCheckStats {
  /** Number of modules that were inspected. */
  modulesChecked: number;
  /** Number of module types that were validated. */
  typesValidated: number;
  /** Number of tool/agent capability references that resolved. */
  capabilitiesResolved: number;
  /** Wall-clock duration of the check, in milliseconds. */
  timeMs: number;
}

/** Result of running the full type checker over a module list. */
export interface TypeCheckResult {
  /** True when no errors were produced (warnings are allowed). */
  valid: boolean;
  /** All error-severity findings. */
  errors: TypeCheckError[];
  /** All warning-severity findings. */
  warnings: TypeCheckError[];
  /** Aggregate statistics for the run. */
  stats: TypeCheckStats;
}

/** Outcome of validating a single module's type via {@link checkModuleType}. */
export interface ModuleTypeCheck {
  /** True when the module type is valid and its required fields are present. */
  valid: boolean;
  /** The offending finding, or `undefined` when the module is valid. */
  error?: TypeCheckError;
}

// ============================================================================
// Module Type Checker
// ============================================================================

/**
 * Validates module types, type-specific required fields, and capability
 * resolution across a collection of {@link V2ModuleNode} modules.
 */
export class TypeChecker {
  private moduleNames: Set<string> = new Set();
  private errors: TypeCheckError[] = [];
  private warnings: TypeCheckError[] = [];
  private startTime = 0;

  /**
   * Run the full type check over a list of modules.
   *
   * @param modules - The modules to validate.
   * @returns A {@link TypeCheckResult} with per-module findings and stats.
   */
  typeCheck(modules: V2ModuleNode[]): TypeCheckResult {
    this.startTime = performance.now();
    this.errors = [];
    this.warnings = [];
    this.moduleNames = new Set(modules.map((m) => m.name));

    let capabilitiesResolved = 0;

    for (const mod of modules) {
      for (const finding of this.checkType(mod)) {
        this.pushFinding(finding);
      }
      const caps = this.checkCapabilities(mod);
      capabilitiesResolved += caps.resolved;
      for (const finding of caps.errors) {
        this.pushFinding(finding);
      }
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      stats: {
        modulesChecked: modules.length,
        typesValidated: modules.length,
        capabilitiesResolved,
        timeMs: performance.now() - this.startTime,
      },
    };
  }

  /**
   * Check that a module's type is valid and that all type-specific required
   * fields are present.
   *
   * @param mod - The module to validate.
   * @returns A list of {@link TypeCheckError} findings for this module.
   */
  checkType(mod: V2ModuleNode): TypeCheckError[] {
    const findings: TypeCheckError[] = [];

    if (!isModuleType(mod.moduleType)) {
      findings.push({
        code: 'INVALID_MODULE_TYPE',
        message: `Invalid module type "${String(mod.moduleType)}" for module "${mod.name}"`,
        module: mod.name,
        field: 'moduleType',
        severity: 'error',
      });
      return findings;
    }

    switch (mod.moduleType) {
      case 'agent':
        if (!mod.role) {
          findings.push({
            code: 'MISSING_ROLE',
            message: `Agent "${mod.name}" is missing its required "role" field`,
            module: mod.name,
            field: 'role',
            severity: 'error',
          });
        }
        if (!mod.goal) {
          findings.push({
            code: 'MISSING_GOAL',
            message: `Agent "${mod.name}" is missing its required "goal" field`,
            module: mod.name,
            field: 'goal',
            severity: 'error',
          });
        }
        break;
      case 'tool':
        if (!mod.provider) {
          findings.push({
            code: 'MISSING_PROVIDER',
            message: `Tool "${mod.name}" is missing its required "provider" field`,
            module: mod.name,
            field: 'provider',
            severity: 'error',
          });
        }
        break;
      case 'memory':
        if (!mod.format) {
          findings.push({
            code: 'MISSING_FORMAT',
            message: `Memory "${mod.name}" is missing its required "format" field`,
            module: mod.name,
            field: 'format',
            severity: 'error',
          });
        }
        if (!mod.backend) {
          findings.push({
            code: 'MISSING_BACKEND',
            message: `Memory "${mod.name}" is missing its required "backend" field`,
            module: mod.name,
            field: 'backend',
            severity: 'error',
          });
        }
        break;
      case 'workflow':
        if (!mod.steps || mod.steps.length === 0) {
          findings.push({
            code: 'MISSING_STEPS',
            message: `Workflow "${mod.name}" is missing its required "steps" field`,
            module: mod.name,
            field: 'steps',
            severity: 'error',
          });
        }
        break;
      case 'system':
        if (!mod.agents && !mod.modules) {
          findings.push({
            code: 'MISSING_MEMBERS',
            message: `System "${mod.name}" is missing its required "agents" or "modules" field`,
            module: mod.name,
            field: 'agents',
            severity: 'error',
          });
        }
        break;
      default:
        break;
    }

    return findings;
  }

  /**
   * Check that every capability reference (from `tools` and `agents` lists)
   * resolves to a known module name in the current module set.
   *
   * @param mod - The module whose capability references are validated.
   * @returns The number of resolved references plus any findings.
   */
  checkCapabilities(mod: V2ModuleNode): { resolved: number; errors: TypeCheckError[] } {
    const errors: TypeCheckError[] = [];
    let resolved = 0;

    const check = (name: string, list: string): void => {
      if (this.moduleNames.has(name)) {
        resolved++;
      } else {
        errors.push({
          code: 'UNRESOLVED_CAPABILITY',
          message: `Capability reference "${name}" in "${list}" of module "${mod.name}" does not resolve to a known module`,
          module: mod.name,
          field: list,
          severity: 'error',
        });
      }
    };

    for (const tool of mod.tools ?? []) {
      check(tool, 'tools');
    }
    for (const agent of mod.agents ?? []) {
      check(agent, 'agents');
    }

    return { resolved, errors };
  }

  private pushFinding(finding: TypeCheckError): void {
    if (finding.severity === 'error') {
      this.errors.push(finding);
    } else {
      this.warnings.push(finding);
    }
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

/**
 * Validate a single module's type in isolation (no cross-module resolution).
 *
 * @param mod - The module to validate.
 * @returns A {@link ModuleTypeCheck} describing validity (and, when invalid,
 * the first offending finding).
 */
export function checkModuleType(mod: V2ModuleNode): ModuleTypeCheck {
  const findings = new TypeChecker().checkType(mod);
  const error = findings.find((f) => f.severity === 'error');
  return { valid: error === undefined, error };
}