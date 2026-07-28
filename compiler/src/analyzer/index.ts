/**
 * MAM Semantic Analyzer
 * 
 * Validates module type consistency, dependency resolution, edge connections,
 * permission inheritance, workflow step references, and team member references.
 */

import { V2ModuleNode, V2EdgeNode, V2StepNode, isModuleType } from '@mam/ast';

// ============================================================================
// Types
// ============================================================================

export interface SemanticResult {
  valid: boolean;
  errors: SemanticError[];
  warnings: SemanticWarning[];
  stats: SemanticStats;
}

export interface SemanticError {
  code: string;
  message: string;
  module?: string;
  location?: { line: number; column: number };
  severity: 'error';
}

export interface SemanticWarning {
  code: string;
  message: string;
  module?: string;
  location?: { line: number; column: number };
  severity: 'warning';
}

export interface SemanticStats {
  modulesAnalyzed: number;
  edgesValidated: number;
  referencesChecked: number;
  timeMs: number;
}

export interface AnalyzerConfig {
  /** Strict mode - more errors */
  strict?: boolean;
  /** Allow undefined references */
  allowUndefinedRefs?: boolean;
  /** Maximum graph depth */
  maxGraphDepth?: number;
}

// ============================================================================
// Semantic Analyzer
// ============================================================================

export class SemanticAnalyzer {
  private config: AnalyzerConfig;
  private moduleMap: Map<string, V2ModuleNode> = new Map();
  private errors: SemanticError[] = [];
  private warnings: SemanticWarning[] = [];
  private startTime: number = 0;

  constructor(config: AnalyzerConfig = {}) {
    this.config = {
      strict: false,
      allowUndefinedRefs: false,
      maxGraphDepth: 50,
      ...config,
    };
  }

  /**
   * Analyze modules
   */
  analyze(modules: V2ModuleNode[]): SemanticResult {
    this.startTime = performance.now();
    this.errors = [];
    this.warnings = [];
    this.moduleMap.clear();

    // Build module map
    for (const mod of modules) {
      this.moduleMap.set(mod.name, mod);
    }

    // Run all analyses
    for (const mod of modules) {
      this.analyzeModule(mod);
    }

    // Cross-module analysis
    this.validateEdges(modules);
    this.validateReferences(modules);
    this.validateDependencyGraph(modules);
    this.validatePermissions(modules);

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      stats: {
        modulesAnalyzed: modules.length,
        edgesValidated: this.countEdges(modules),
        referencesChecked: this.countReferences(modules),
        timeMs: performance.now() - this.startTime,
      },
    };
  }

  // ==========================================================================
  // Module Analysis
  // ==========================================================================

  private analyzeModule(mod: V2ModuleNode): void {
    // Validate module type
    if (!isModuleType(mod.moduleType)) {
      this.errors.push({
        code: 'INVALID_MODULE_TYPE',
        message: `Invalid module type: "${mod.moduleType}"`,
        module: mod.name,
        location: mod.location.start,
        severity: 'error',
      });
    }

    // Type-specific validation
    switch (mod.moduleType) {
      case 'agent':
        this.analyzeAgent(mod);
        break;
      case 'tool':
        this.analyzeTool(mod);
        break;
      case 'memory':
        this.analyzeMemory(mod);
        break;
      case 'workflow':
        this.analyzeWorkflow(mod);
        break;
      case 'team':
        this.analyzeTeam(mod);
        break;
      case 'policy':
        this.analyzePolicy(mod);
        break;
      case 'system':
        this.analyzeSystem(mod);
        break;
    }
  }

  private analyzeAgent(mod: V2ModuleNode): void {
    if (!mod.role) {
      this.warnings.push({
        code: 'MISSING_ROLE',
        message: `Agent "${mod.name}" has no role defined`,
        module: mod.name,
        severity: 'warning',
      });
    }
    if (!mod.goal) {
      this.warnings.push({
        code: 'MISSING_GOAL',
        message: `Agent "${mod.name}" has no goal defined`,
        module: mod.name,
        severity: 'warning',
      });
    }
  }

  private analyzeTool(mod: V2ModuleNode): void {
    if (!mod.provider) {
      this.warnings.push({
        code: 'MISSING_PROVIDER',
        message: `Tool "${mod.name}" has no provider defined`,
        module: mod.name,
        severity: 'warning',
      });
    }
  }

  private analyzeMemory(mod: V2ModuleNode): void {
    if (!mod.format) {
      this.errors.push({
        code: 'MISSING_FORMAT',
        message: `Memory "${mod.name}" has no format defined`,
        module: mod.name,
        severity: 'error',
      });
    }
    if (!mod.backend) {
      this.warnings.push({
        code: 'MISSING_BACKEND',
        message: `Memory "${mod.name}" has no backend defined`,
        module: mod.name,
        severity: 'warning',
      });
    }
    if (!mod.scope) {
      this.warnings.push({
        code: 'MISSING_SCOPE',
        message: `Memory "${mod.name}" has no scope defined`,
        module: mod.name,
        severity: 'warning',
      });
    }
  }

  private analyzeWorkflow(mod: V2ModuleNode): void {
    if (!mod.steps || mod.steps.length === 0) {
      this.errors.push({
        code: 'EMPTY_WORKFLOW',
        message: `Workflow "${mod.name}" has no steps`,
        module: mod.name,
        severity: 'error',
      });
    }
  }

  private analyzeTeam(mod: V2ModuleNode): void {
    if (!mod.members || mod.members.length === 0) {
      this.errors.push({
        code: 'EMPTY_TEAM',
        message: `Team "${mod.name}" has no members`,
        module: mod.name,
        severity: 'error',
      });
    }
  }

  private analyzePolicy(mod: V2ModuleNode): void {
    if (!mod.allow && !mod.deny) {
      this.warnings.push({
        code: 'EMPTY_POLICY',
        message: `Policy "${mod.name}" has no allow/deny rules`,
        module: mod.name,
        severity: 'warning',
      });
    }
  }

  private analyzeSystem(mod: V2ModuleNode): void {
    if (!mod.agents && !mod.modules) {
      this.warnings.push({
        code: 'EMPTY_SYSTEM',
        message: `System "${mod.name}" has no agents or modules`,
        module: mod.name,
        severity: 'warning',
      });
    }
  }

  // ==========================================================================
  // Edge Validation
  // ==========================================================================

  private validateEdges(modules: V2ModuleNode[]): void {
    for (const mod of modules) {
      if (!mod.edges) continue;

      for (const edge of mod.edges) {
        // Validate source exists
        if (!this.moduleMap.has(edge.source)) {
          if (!this.config.allowUndefinedRefs) {
            this.errors.push({
              code: 'UNDEFINED_EDGE_SOURCE',
              message: `Edge source "${edge.source}" not found in module "${mod.name}"`,
              module: mod.name,
              location: edge.location.start,
              severity: 'error',
            });
          }
        }

        // Validate target exists
        if (!this.moduleMap.has(edge.target)) {
          if (!this.config.allowUndefinedRefs) {
            this.errors.push({
              code: 'UNDEFINED_EDGE_TARGET',
              message: `Edge target "${edge.target}" not found in module "${mod.name}"`,
              module: mod.name,
              location: edge.location.start,
              severity: 'error',
            });
          }
        }

        // Check for self-loops
        if (edge.source === edge.target) {
          this.warnings.push({
            code: 'SELF_LOOP',
            message: `Self-loop detected: "${edge.source}" -> "${edge.target}"`,
            module: mod.name,
            location: edge.location.start,
            severity: 'warning',
          });
        }
      }
    }
  }

  // ==========================================================================
  // Reference Validation
  // ==========================================================================

  private validateReferences(modules: V2ModuleNode[]): void {
    for (const mod of modules) {
      // Validate tool references
      if (mod.tools) {
        for (const tool of mod.tools) {
          if (!this.moduleMap.has(tool) && !this.config.allowUndefinedRefs) {
            this.warnings.push({
              code: 'UNDEFINED_TOOL',
              message: `Tool "${tool}" not found in module "${mod.name}"`,
              module: mod.name,
              severity: 'warning',
            });
          }
        }
      }

      // Validate handoff references
      if (mod.handoff) {
        for (const target of mod.handoff) {
          if (!this.moduleMap.has(target) && !this.config.allowUndefinedRefs) {
            this.warnings.push({
              code: 'UNDEFINED_HANDOFF',
              message: `Handoff target "${target}" not found in module "${mod.name}"`,
              module: mod.name,
              severity: 'warning',
            });
          }
        }
      }

      // Validate member references (team)
      if (mod.members) {
        for (const member of mod.members) {
          if (!this.moduleMap.has(member) && !this.config.allowUndefinedRefs) {
            this.warnings.push({
              code: 'UNDEFINED_MEMBER',
              message: `Team member "${member}" not found in module "${mod.name}"`,
              module: mod.name,
              severity: 'warning',
            });
          }
        }
      }

      // Validate agent references (system)
      if (mod.agents) {
        for (const agent of mod.agents) {
          if (!this.moduleMap.has(agent) && !this.config.allowUndefinedRefs) {
            this.warnings.push({
              code: 'UNDEFINED_AGENT',
              message: `Agent "${agent}" not found in system "${mod.name}"`,
              module: mod.name,
              severity: 'warning',
            });
          }
        }
      }

      // Validate policy references
      if (mod.policy && typeof mod.policy === 'string') {
        if (!this.moduleMap.has(mod.policy) && !this.config.allowUndefinedRefs) {
          this.warnings.push({
            code: 'UNDEFINED_POLICY',
            message: `Policy "${mod.policy}" not found in module "${mod.name}"`,
            module: mod.name,
            severity: 'warning',
          });
        }
      }

      // Validate memory references
      if (mod.memory && typeof mod.memory === 'object' && mod.memory.name) {
        if (!this.moduleMap.has(mod.memory.name) && !this.config.allowUndefinedRefs) {
          this.warnings.push({
            code: 'UNDEFINED_MEMORY',
            message: `Memory "${mod.memory.name}" not found in module "${mod.name}"`,
            module: mod.name,
            severity: 'warning',
          });
        }
      }
    }
  }

  // ==========================================================================
  // Dependency Graph Validation
  // ==========================================================================

  private validateDependencyGraph(modules: V2ModuleNode[]): void {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    for (const mod of modules) {
      if (!visited.has(mod.name)) {
        this.detectCycles(mod.name, visited, recursionStack, modules);
      }
    }
  }

  private detectCycles(
    name: string,
    visited: Set<string>,
    recursionStack: Set<string>,
    modules: V2ModuleNode[]
  ): void {
    visited.add(name);
    recursionStack.add(name);

    const mod = this.moduleMap.get(name);
    if (mod?.edges) {
      for (const edge of mod.edges) {
        if (!visited.has(edge.target)) {
          this.detectCycles(edge.target, visited, recursionStack, modules);
        } else if (recursionStack.has(edge.target)) {
          this.errors.push({
            code: 'CYCLIC_DEPENDENCY',
            message: `Cyclic dependency detected: "${name}" -> "${edge.target}"`,
            module: name,
            severity: 'error',
          });
        }
      }
    }

    recursionStack.delete(name);
  }

  // ==========================================================================
  // Permission Validation
  // ==========================================================================

  private validatePermissions(modules: V2ModuleNode[]): void {
    for (const mod of modules) {
      if (!mod.permissions) continue;

      // Check for conflicting permissions
      const perms = mod.permissions;
      if (perms.filesystem === 'write' && perms.network === 'none') {
        this.warnings.push({
          code: 'PERMISSION_CONFLICT',
          message: `Module "${mod.name}" has filesystem write but no network access`,
          module: mod.name,
          severity: 'warning',
        });
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private countEdges(modules: V2ModuleNode[]): number {
    let count = 0;
    for (const mod of modules) {
      if (mod.edges) count += mod.edges.length;
    }
    return count;
  }

  private countReferences(modules: V2ModuleNode[]): number {
    let count = 0;
    for (const mod of modules) {
      if (mod.tools) count += mod.tools.length;
      if (mod.handoff) count += mod.handoff.length;
      if (mod.members) count += mod.members.length;
      if (mod.agents) count += mod.agents.length;
      if (mod.requires) count += mod.requires.length;
    }
    return count;
  }
}

// ============================================================================
// Convenience Function
// ============================================================================

export function analyzeSemantics(modules: V2ModuleNode[], config?: AnalyzerConfig): SemanticResult {
  const analyzer = new SemanticAnalyzer(config);
  return analyzer.analyze(modules);
}
