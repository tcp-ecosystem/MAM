/**
 * MAM Reference Analyzer
 *
 * Resolves every inter-module reference (`requires`, `edges`, `handoff`,
 * `tools`, `members`, `modules`, `agents`, `steps`, `policy`, and memory
 * references) against the set of known module names. Unresolved references
 * produce `UNRESOLVED_REFERENCE` errors; modules that no other module ever
 * references produce `UNUSED_MODULE` warnings.
 */

import { V2ModuleNode } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

/** Kinds of reference the analyzer is able to resolve. */
export type ReferenceKind =
  | 'requires'
  | 'edge'
  | 'handoff'
  | 'tool'
  | 'member'
  | 'module'
  | 'agent'
  | 'step'
  | 'policy'
  | 'memory';

/** A single reference-analysis finding. */
export interface ReferenceIssue {
  /** Stable diagnostic code, e.g. `UNRESOLVED_REFERENCE` or `UNUSED_MODULE`. */
  code: string;
  /** Human-readable description of the problem. */
  message: string;
  /** The module the finding belongs to. */
  module?: string;
  /** The referenced name that could not be resolved. */
  reference?: string;
  /** Which kind of reference produced the finding. */
  kind: ReferenceKind;
  /** Whether this is an error (blocks validation) or a warning. */
  severity: 'error' | 'warning';
}

/** Result of analyzing references across a module list. */
export interface ReferenceAnalysisResult {
  /** True when there are no errors (warnings are allowed). */
  valid: boolean;
  /** All error-severity findings. */
  errors: ReferenceIssue[];
  /** All warning-severity findings. */
  warnings: ReferenceIssue[];
  /** Every distinct name that failed to resolve. */
  unresolved: string[];
  /** Module names that are never referenced by any other module. */
  unused: string[];
}

// ============================================================================
// Reference Analyzer
// ============================================================================

/**
 * Resolves cross-module references and reports unresolved names and unused
 * modules for a collection of {@link V2ModuleNode} modules.
 */
export class ReferenceAnalyzer {
  /**
   * Analyze all reference sites in a list of modules.
   *
   * @param modules - The modules whose references are resolved.
   * @returns A {@link ReferenceAnalysisResult} with errors, warnings, and the
   * lists of unresolved/unused names.
   */
  analyzeReferences(modules: V2ModuleNode[]): ReferenceAnalysisResult {
    const errors: ReferenceIssue[] = [];
    const warnings: ReferenceIssue[] = [];
    const names = new Set(modules.map((m) => m.name));
    const unresolved = new Set<string>();
    const referenced = new Set<string>();

    const check = (
      ref: string,
      mod: V2ModuleNode,
      kind: ReferenceKind,
      detail?: string,
    ): void => {
      if (names.has(ref)) {
        referenced.add(ref);
        return;
      }
      errors.push({
        code: 'UNRESOLVED_REFERENCE',
        message: `Unresolved ${kind} reference "${ref}"${detail ? ` (${detail})` : ''} in module "${mod.name}"`,
        module: mod.name,
        reference: ref,
        kind,
        severity: 'error',
      });
      unresolved.add(ref);
    };

    for (const mod of modules) {
      for (const ref of mod.requires ?? []) check(ref, mod, 'requires');
      for (const ref of mod.handoff ?? []) check(ref, mod, 'handoff');
      for (const ref of mod.tools ?? []) check(ref, mod, 'tool');
      for (const ref of mod.members ?? []) check(ref, mod, 'member');
      for (const ref of mod.agents ?? []) check(ref, mod, 'agent');
      for (const ref of mod.modules ?? []) check(ref, mod, 'module');

      if (typeof mod.policy === 'string' && mod.policy) check(mod.policy, mod, 'policy');
      if (mod.memory?.name) check(mod.memory.name, mod, 'memory');

      // Edges: a module-level edge references module names; workflow-internal
      // edges referencing this module's own steps are permitted.
      const stepNames = new Set((mod.steps ?? []).map((s) => s.name));
      for (const edge of mod.edges ?? []) {
        if (!names.has(edge.source) && !stepNames.has(edge.source)) {
          errors.push({
            code: 'UNRESOLVED_REFERENCE',
            message: `Unresolved edge source "${edge.source}" in module "${mod.name}"`,
            module: mod.name,
            reference: edge.source,
            kind: 'edge',
            severity: 'error',
          });
          unresolved.add(edge.source);
        } else if (names.has(edge.source)) {
          referenced.add(edge.source);
        }
        if (!names.has(edge.target) && !stepNames.has(edge.target)) {
          errors.push({
            code: 'UNRESOLVED_REFERENCE',
            message: `Unresolved edge target "${edge.target}" in module "${mod.name}"`,
            module: mod.name,
            reference: edge.target,
            kind: 'edge',
            severity: 'error',
          });
          unresolved.add(edge.target);
        } else if (names.has(edge.target)) {
          referenced.add(edge.target);
        }
      }

      // Steps: step-level agent/tool bindings must resolve to module names.
      for (const step of mod.steps ?? []) {
        if (step.agent) check(step.agent, mod, 'step', `step "${step.name}" agent`);
        if (step.tool) check(step.tool, mod, 'step', `step "${step.name}" tool`);
      }
    }

    const unused = modules.filter((m) => !referenced.has(m.name)).map((m) => m.name);
    for (const name of unused) {
      warnings.push({
        code: 'UNUSED_MODULE',
        message: `Module "${name}" is never referenced by any other module`,
        module: name,
        reference: name,
        kind: 'module',
        severity: 'warning',
      });
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      unresolved: [...unresolved],
      unused,
    };
  }
}