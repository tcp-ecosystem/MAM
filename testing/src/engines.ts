/**
 * MAM Engine Integration
 *
 * Shared instances of the observability evaluation engine, used by
 * evaluation-backed assertions and reporters so a suite summary is available
 * across a test run.
 */

import {
  createEvaluationEngine,
  type EvaluationEngine,
} from '@mam/observability';

/** Shared engine that accumulates evaluation results across assertions. */
export const evaluationEngine: EvaluationEngine = createEvaluationEngine();

/** Evaluation roll-up stats surfaced by {@link getEvaluationStats}. */
export interface EvaluationStatsView {
  total: number;
  passed: number;
  passRate: number;
  averageScore: number;
}

/** Current evaluation stats for the shared engine. */
export function getEvaluationStats(): EvaluationStatsView {
  const stats = evaluationEngine.summary().stats;
  return {
    total: stats.total,
    passed: stats.passed,
    passRate: stats.passRate,
    averageScore: stats.averageScore,
  };
}

/** Clear all accumulated evaluations. */
export function resetEvaluationEngine(): void {
  evaluationEngine.clear();
}