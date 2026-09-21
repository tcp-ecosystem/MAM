/**
 * MAM V2 Evaluation Engine
 *
 * Module quality scoring, execution metrics analysis,
 * performance benchmarking, output validation, and quality gates.
 */

export interface EvaluationConfig {
  thresholds: QualityThresholds;
  weights: MetricWeights;
  enabledChecks: string[];
}

export interface QualityThresholds {
  minScore: number;
  maxComplexity: number;
  minCoverage: number;
  maxCircularDeps: number;
  minDocumentation: number;
}

export interface MetricWeights {
  completeness: number;
  correctness: number;
  complexity: number;
  documentation: number;
  performance: number;
  security: number;
}

export interface EvaluationResult {
  moduleId: string;
  moduleName: string;
  timestamp: number;
  overallScore: number;
  grade: QualityGrade;
  metrics: EvaluationMetrics;
  checks: CheckResult[];
  suggestions: Suggestion[];
  passed: boolean;
}

export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface EvaluationMetrics {
  completeness: MetricScore;
  correctness: MetricScore;
  complexity: MetricScore;
  documentation: MetricScore;
  performance: MetricScore;
  security: MetricScore;
}

export interface MetricScore {
  score: number;
  maxScore: number;
  percentage: number;
  details: string[];
}

export interface CheckResult {
  name: string;
  passed: boolean;
  score: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  details?: unknown;
}

export interface Suggestion {
  category: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  impact: number;
}

export interface BenchmarkResult {
  name: string;
  runs: number;
  avgTimeMs: number;
  minTimeMs: number;
  maxTimeMs: number;
  p50TimeMs: number;
  p95TimeMs: number;
  p99TimeMs: number;
  throughput: number;
  memoryAvgMB: number;
  memoryPeakMB: number;
  successRate: number;
  errors: string[];
}

export interface ValidationRule {
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  validate: (module: EvaluableModule) => ValidationResult;
}

export interface ValidationResult {
  valid: boolean;
  message: string;
  details?: unknown;
}

export interface EvaluableModule {
  name: string;
  type: string;
  version?: string;
  description?: string;
  capabilities?: string[];
  inputs?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
  outputs?: Array<{ name: string; type: string; description?: string }>;
  requires?: string[];
  permissions?: Record<string, unknown>;
  steps?: Array<{ name: string; action: string; [key: string]: unknown }>;
  edges?: Array<{ from: string; to: string; [key: string]: unknown }>;
  documentation?: string;
  rules?: string[];
  metadata?: Record<string, unknown>;
}

export interface EvaluationReport {
  timestamp: number;
  moduleCount: number;
  passedCount: number;
  failedCount: number;
  averageScore: number;
  gradeDistribution: Record<QualityGrade, number>;
  results: EvaluationResult[];
  overallGrade: QualityGrade;
  summary: string;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_THRESHOLDS: QualityThresholds = {
  minScore: 70,
  maxComplexity: 100,
  minCoverage: 80,
  maxCircularDeps: 0,
  minDocumentation: 50,
};

const DEFAULT_WEIGHTS: MetricWeights = {
  completeness: 0.25,
  correctness: 0.20,
  complexity: 0.15,
  documentation: 0.20,
  performance: 0.10,
  security: 0.10,
};

// ============================================================================
// Evaluation Engine
// ============================================================================

export class EvaluationEngine {
  private config: EvaluationConfig;
  private rules: ValidationRule[] = [];

  constructor(config: Partial<EvaluationConfig> = {}) {
    this.config = {
      thresholds: { ...DEFAULT_THRESHOLDS, ...config.thresholds },
      weights: { ...DEFAULT_WEIGHTS, ...config.weights },
      enabledChecks: config.enabledChecks ?? [
        'completeness', 'correctness', 'complexity', 'documentation', 'security',
      ],
    };
    this.registerDefaultRules();
  }

  // -------------------------------------------------------------------------
  // Rule Management
  // -------------------------------------------------------------------------

  registerRule(rule: ValidationRule): void {
    this.rules.push(rule);
  }

  unregisterRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  private registerDefaultRules(): void {
    this.rules.push(
      {
        name: 'has-name',
        description: 'Module must have a name',
        severity: 'error',
        validate: (m) => ({ valid: !!m.name && m.name.length > 0, message: m.name ? 'OK' : 'Missing module name' }),
      },
      {
        name: 'has-type',
        description: 'Module must have a type',
        severity: 'error',
        validate: (m) => ({ valid: !!m.type && m.type.length > 0, message: m.type ? 'OK' : 'Missing module type' }),
      },
      {
        name: 'has-description',
        description: 'Module should have a description',
        severity: 'warning',
        validate: (m) => ({ valid: !!m.description && m.description.length > 0, message: m.description ? 'OK' : 'Missing description' }),
      },
      {
        name: 'has-inputs',
        description: 'Module should define inputs',
        severity: 'warning',
        validate: (m) => ({ valid: !!m.inputs && m.inputs.length > 0, message: (m.inputs?.length ?? 0) > 0 ? 'OK' : 'No inputs defined' }),
      },
      {
        name: 'has-outputs',
        description: 'Module should define outputs',
        severity: 'warning',
        validate: (m) => ({ valid: !!m.outputs && m.outputs.length > 0, message: (m.outputs?.length ?? 0) > 0 ? 'OK' : 'No outputs defined' }),
      },
      {
        name: 'has-capabilities',
        description: 'Module should declare capabilities',
        severity: 'info',
        validate: (m) => ({ valid: !!m.capabilities && m.capabilities.length > 0, message: (m.capabilities?.length ?? 0) > 0 ? 'OK' : 'No capabilities declared' }),
      },
      {
        name: 'no-orphan-edges',
        description: 'All edge sources and targets should exist',
        severity: 'error',
        validate: (m) => {
          if (!m.edges || m.edges.length === 0) return { valid: true, message: 'No edges' };
          const stepNames = new Set((m.steps ?? []).map(s => s.name));
          const orphans = m.edges.filter(e => !stepNames.has(e.from) || !stepNames.has(e.to));
          return {
            valid: orphans.length === 0,
            message: orphans.length === 0 ? 'OK' : `${orphans.length} orphan edge(s)`,
            details: orphans,
          };
        },
      },
      {
        name: 'workflow-has-steps',
        description: 'Workflow modules must have steps',
        severity: 'error',
        validate: (m) => {
          if (m.type !== 'workflow') return { valid: true, message: 'Not a workflow' };
          return { valid: !!m.steps && m.steps.length > 0, message: (m.steps?.length ?? 0) > 0 ? 'OK' : 'Workflow has no steps' };
        },
      },
      {
        name: 'agent-has-goal',
        description: 'Agent modules should have a description (goal)',
        severity: 'warning',
        validate: (m) => {
          if (m.type !== 'agent') return { valid: true, message: 'Not an agent' };
          return { valid: !!m.description && m.description.length > 5, message: (m.description?.length ?? 0) > 5 ? 'OK' : 'Agent lacks goal description' };
        },
      },
      {
        name: 'version-format',
        description: 'Version should follow semver',
        severity: 'info',
        validate: (m) => {
          if (!m.version) return { valid: true, message: 'No version set' };
          const semver = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
          return { valid: semver.test(m.version), message: semver.test(m.version) ? 'OK' : `Invalid version: ${m.version}` };
        },
      },
    );
  }

  // -------------------------------------------------------------------------
  // Evaluation
  // -------------------------------------------------------------------------

  evaluateModule(module: EvaluableModule): EvaluationResult {
    const checks: CheckResult[] = [];
    const suggestions: Suggestion[] = [];

    // Run all registered rules
    for (const rule of this.rules) {
      if (!this.config.enabledChecks.includes(rule.name.split('-')[0]) &&
          !['has-name', 'has-type', 'no-orphan-edges', 'workflow-has-steps'].includes(rule.name)) {
        continue;
      }
      const result = rule.validate(module);
      checks.push({
        name: rule.name,
        passed: result.valid,
        score: result.valid ? 100 : 0,
        message: result.message,
        severity: rule.severity,
        details: result.details,
      });
      if (!result.valid) {
        suggestions.push({
          category: rule.severity === 'error' ? 'correctness' : 'documentation',
          message: `${rule.description}: ${result.message}`,
          priority: rule.severity === 'error' ? 'high' : rule.severity === 'warning' ? 'medium' : 'low',
          impact: rule.severity === 'error' ? 20 : rule.severity === 'warning' ? 10 : 5,
        });
      }
    }

    const metrics = this.calculateMetrics(module, checks);
    const overallScore = this.calculateOverallScore(metrics);
    const grade = this.scoreToGrade(overallScore);
    const passed = overallScore >= this.config.thresholds.minScore &&
      checks.filter(c => c.severity === 'error' && !c.passed).length === 0;

    return {
      moduleId: module.name,
      moduleName: module.name,
      timestamp: Date.now(),
      overallScore,
      grade,
      metrics,
      checks,
      suggestions,
      passed,
    };
  }

  evaluateModules(modules: EvaluableModule[]): EvaluationReport {
    const results = modules.map(m => this.evaluateModule(m));
    const passedCount = results.filter(r => r.passed).length;
    const averageScore = results.length > 0
      ? results.reduce((s, r) => s + r.overallScore, 0) / results.length
      : 0;

    const gradeDistribution: Record<QualityGrade, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const r of results) gradeDistribution[r.grade]++;

    return {
      timestamp: Date.now(),
      moduleCount: modules.length,
      passedCount,
      failedCount: modules.length - passedCount,
      averageScore,
      gradeDistribution,
      results,
      overallGrade: this.scoreToGrade(averageScore),
      summary: this.generateSummary(results, passedCount, averageScore),
    };
  }

  // -------------------------------------------------------------------------
  // Metrics Calculation
  // -------------------------------------------------------------------------

  private calculateMetrics(module: EvaluableModule, checks: CheckResult[]): EvaluationMetrics {
    return {
      completeness: this.calculateCompleteness(module),
      correctness: this.calculateCorrectness(checks),
      complexity: this.calculateComplexity(module),
      documentation: this.calculateDocumentation(module),
      performance: this.calculatePerformance(module),
      security: this.calculateSecurity(module),
    };
  }

  private calculateCompleteness(module: EvaluableModule): MetricScore {
    let score = 0;
    const details: string[] = [];

    if (module.name) { score += 15; details.push('name'); }
    if (module.type) { score += 15; details.push('type'); }
    if (module.version) { score += 10; details.push('version'); }
    if (module.description) { score += 10; details.push('description'); }
    if (module.capabilities && module.capabilities.length > 0) { score += 10; details.push('capabilities'); }
    if (module.inputs && module.inputs.length > 0) { score += 10; details.push('inputs'); }
    if (module.outputs && module.outputs.length > 0) { score += 10; details.push('outputs'); }
    if (module.requires && module.requires.length > 0) { score += 10; details.push('requires'); }
    if (module.permissions && Object.keys(module.permissions).length > 0) { score += 10; details.push('permissions'); }

    return { score, maxScore: 100, percentage: score, details };
  }

  private calculateCorrectness(checks: CheckResult[]): MetricScore {
    const errorChecks = checks.filter(c => c.severity === 'error');
    const passedErrors = errorChecks.filter(c => c.passed).length;
    const score = errorChecks.length > 0 ? (passedErrors / errorChecks.length) * 100 : 100;
    return {
      score,
      maxScore: 100,
      percentage: score,
      details: [`${passedErrors}/${errorChecks.length} error checks passed`],
    };
  }

  private calculateComplexity(module: EvaluableModule): MetricScore {
    let complexity = 0;
    const details: string[] = [];

    const stepCount = module.steps?.length ?? 0;
    const edgeCount = module.edges?.length ?? 0;
    const inputCount = module.inputs?.length ?? 0;
    const outputCount = module.outputs?.length ?? 0;
    const depCount = module.requires?.length ?? 0;

    complexity = stepCount * 2 + edgeCount + inputCount + outputCount + depCount * 3;
    details.push(`steps=${stepCount}, edges=${edgeCount}, inputs=${inputCount}, outputs=${outputCount}, deps=${depCount}`);

    const maxComplexity = this.config.thresholds.maxComplexity;
    const score = Math.max(0, 100 - (complexity / maxComplexity) * 100);

    return { score, maxScore: 100, percentage: score, details };
  }

  private calculateDocumentation(module: EvaluableModule): MetricScore {
    let score = 0;
    const details: string[] = [];

    if (module.description && module.description.length > 0) {
      score += 30;
      details.push('description');
    }
    if (module.description && module.description.length > 50) {
      score += 10;
      details.push('detailed description');
    }
    if (module.documentation && module.documentation.length > 0) {
      score += 30;
      details.push('documentation');
    }
    if (module.rules && module.rules.length > 0) {
      score += 15;
      details.push('rules');
    }
    if (module.inputs?.some(i => i.description)) {
      score += 10;
      details.push('input descriptions');
    }
    if (module.outputs?.some(o => o.description)) {
      score += 5;
      details.push('output descriptions');
    }

    return { score, maxScore: 100, percentage: score, details };
  }

  private calculatePerformance(module: EvaluableModule): MetricScore {
    let score = 100;
    const details: string[] = [];

    const stepCount = module.steps?.length ?? 0;
    const edgeCount = module.edges?.length ?? 0;

    if (stepCount > 20) { score -= 20; details.push('too many steps'); }
    else if (stepCount > 10) { score -= 10; details.push('moderate step count'); }

    if (edgeCount > stepCount * 2) { score -= 15; details.push('dense edge graph'); }

    if (module.requires && module.requires.length > 5) {
      score -= 15; details.push('too many dependencies');
    }

    return { score, maxScore: 100, percentage: Math.max(0, score), details };
  }

  private calculateSecurity(module: EvaluableModule): MetricScore {
    let score = 100;
    const details: string[] = [];

    if (module.permissions) {
      const perms = Object.keys(module.permissions);
      if (perms.includes('admin') || perms.includes('root')) {
        score -= 30; details.push('dangerous permission');
      }
      if (perms.includes('network') || perms.includes('filesystem')) {
        score -= 10; details.push('system access permission');
      }
    }

    if (module.type === 'tool' && (!module.permissions || Object.keys(module.permissions).length === 0)) {
      score -= 5; details.push('tool without explicit permissions');
    }

    return { score, maxScore: 100, percentage: Math.max(0, score), details };
  }

  private calculateOverallScore(metrics: EvaluationMetrics): number {
    const w = this.config.weights;
    return Math.round(
      metrics.completeness.percentage * w.completeness +
      metrics.correctness.percentage * w.correctness +
      metrics.complexity.percentage * w.complexity +
      metrics.documentation.percentage * w.documentation +
      metrics.performance.percentage * w.performance +
      metrics.security.percentage * w.security
    );
  }

  private scoreToGrade(score: number): QualityGrade {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  private generateSummary(results: EvaluationResult[], passedCount: number, avgScore: number): string {
    const total = results.length;
    const failedCount = total - passedCount;
    const grade = this.scoreToGrade(avgScore);
    return `${total} modules evaluated: ${passedCount} passed, ${failedCount} failed. Average score: ${avgScore.toFixed(1)} (${grade})`;
  }

  // -------------------------------------------------------------------------
  // Benchmarking
  // -------------------------------------------------------------------------

  async benchmark(
    name: string,
    fn: () => Promise<void>,
    options: { runs?: number; warmup?: number } = {},
  ): Promise<BenchmarkResult> {
    const runs = options.runs ?? 10;
    const warmup = options.warmup ?? 2;
    const times: number[] = [];
    const memories: number[] = [];
    const errors: string[] = [];
    let successCount = 0;

    for (let i = 0; i < warmup; i++) {
      try { await fn(); } catch { /* warmup */ }
    }

    for (let i = 0; i < runs; i++) {
      const memBefore = process.memoryUsage().heapUsed;
      const start = performance.now();
      try {
        await fn();
        successCount++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
      const elapsed = performance.now() - start;
      times.push(elapsed);
      memories.push((process.memoryUsage().heapUsed - memBefore) / (1024 * 1024));
    }

    times.sort((a, b) => a - b);
    const avg = times.reduce((s, t) => s + t, 0) / times.length;

    return {
      name,
      runs,
      avgTimeMs: avg,
      minTimeMs: times[0] ?? 0,
      maxTimeMs: times[times.length - 1] ?? 0,
      p50TimeMs: times[Math.floor(times.length * 0.5)] ?? 0,
      p95TimeMs: times[Math.floor(times.length * 0.95)] ?? 0,
      p99TimeMs: times[Math.floor(times.length * 0.99)] ?? 0,
      throughput: avg > 0 ? 1000 / avg : 0,
      memoryAvgMB: memories.reduce((s, m) => s + m, 0) / memories.length,
      memoryPeakMB: Math.max(...memories),
      successRate: runs > 0 ? (successCount / runs) * 100 : 0,
      errors,
    };
  }

  // -------------------------------------------------------------------------
  // Quality Gate
  // -------------------------------------------------------------------------

  passesQualityGate(result: EvaluationResult): { passed: boolean; failures: string[] } {
    const failures: string[] = [];
    const t = this.config.thresholds;

    if (result.overallScore < t.minScore) {
      failures.push(`Score ${result.overallScore} below threshold ${t.minScore}`);
    }

    const errorChecks = result.checks.filter(c => c.severity === 'error' && !c.passed);
    for (const check of errorChecks) {
      failures.push(`Failed check: ${check.name} - ${check.message}`);
    }

    return { passed: failures.length === 0, failures };
  }

  passesBatchQualityGate(report: EvaluationReport): { passed: boolean; failures: string[] } {
    const failures: string[] = [];

    if (report.failedCount > 0) {
      failures.push(`${report.failedCount} module(s) failed quality gate`);
    }

    for (const result of report.results) {
      const gate = this.passesQualityGate(result);
      if (!gate.passed) {
        failures.push(`${result.moduleName}: ${gate.failures.join(', ')}`);
      }
    }

    return { passed: failures.length === 0, failures };
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  formatResult(result: EvaluationResult): string {
    const lines: string[] = [];
    lines.push(`Module: ${result.moduleName}`);
    lines.push(`Grade: ${result.grade} (${result.overallScore}/100)`);
    lines.push(`Passed: ${result.passed ? 'YES' : 'NO'}`);
    lines.push('');
    lines.push('Metrics:');
    for (const [key, metric] of Object.entries(result.metrics)) {
      lines.push(`  ${key}: ${metric.percentage.toFixed(0)}% (${metric.details.join(', ')})`);
    }
    lines.push('');
    if (result.checks.length > 0) {
      lines.push('Checks:');
      for (const check of result.checks) {
        const icon = check.passed ? '✓' : '✗';
        lines.push(`  ${icon} [${check.severity}] ${check.name}: ${check.message}`);
      }
    }
    if (result.suggestions.length > 0) {
      lines.push('');
      lines.push('Suggestions:');
      for (const s of result.suggestions) {
        lines.push(`  [${s.priority}] ${s.category}: ${s.message}`);
      }
    }
    return lines.join('\n');
  }

  formatReport(report: EvaluationReport): string {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════════════');
    lines.push('  MAM Evaluation Report');
    lines.push('═══════════════════════════════════════════');
    lines.push(`Date: ${new Date(report.timestamp).toISOString()}`);
    lines.push(`Modules: ${report.moduleCount}`);
    lines.push(`Passed: ${report.passedCount} | Failed: ${report.failedCount}`);
    lines.push(`Average Score: ${report.averageScore.toFixed(1)} (${report.overallGrade})`);
    lines.push('');
    lines.push('Grade Distribution:');
    for (const [grade, count] of Object.entries(report.gradeDistribution)) {
      if (count > 0) lines.push(`  ${grade}: ${count}`);
    }
    lines.push('');
    lines.push('───────────────────────────────────────────');
    for (const result of report.results) {
      const icon = result.passed ? '✓' : '✗';
      lines.push(`  ${icon} ${result.moduleName}: ${result.grade} (${result.overallScore})`);
    }
    lines.push('═══════════════════════════════════════════');
    return lines.join('\n');
  }
}
