import { describe, it, expect, beforeEach } from 'vitest';
import { MAMAssert, MAMAssertionError } from '../src/assertions.js';
import { ConsoleReporter } from '../src/reporters.js';
import { getEvaluationStats, resetEvaluationEngine } from '../src/engines.js';
import type { EvidenceChunk } from '@mam/intelligence-layer';
import type { TestResult } from '../src/runner.js';

const matchingEvidence: EvidenceChunk[] = [
  { id: 'docs/api.md#l42', source: 'docs/api.md', text: 'The API returns 204 on success.' },
];

describe('engine-backed assertions', () => {
  let assert: MAMAssert;

  beforeEach(() => {
    assert = new MAMAssert();
    resetEvaluationEngine();
  });

  describe('evaluate', () => {
    it('should pass and record when the score clears the default threshold', () => {
      const result = assert.evaluate('accuracy', 0.9);

      expect(result.passed).toBe(true);
      expect(assert.allPassed()).toBe(true);

      const stats = getEvaluationStats();
      expect(stats.total).toBe(1);
      expect(stats.passed).toBe(1);
    });

    it('should throw MAMAssertionError when the score misses the threshold', () => {
      expect(() => assert.evaluate('accuracy', 0.3)).toThrow(MAMAssertionError);
      expect(assert.allPassed()).toBe(false);

      const stats = getEvaluationStats();
      expect(stats.total).toBe(1);
      expect(stats.passed).toBe(0);
    });

    it('should honour an explicit threshold override', () => {
      assert.evaluate('strict', 0.85, { value: 0.8, comparison: 'gte' });
      expect(assert.allPassed()).toBe(true);

      expect(() =>
        assert.evaluate('strict', 0.7, { value: 0.8, comparison: 'gte' })
      ).toThrow(MAMAssertionError);
    });
  });

  describe('assertGrounded', () => {
    it('should pass when the claim is grounded in the evidence', () => {
      const verdict = assert.assertGrounded('The API returns 204 on success', matchingEvidence);

      expect(verdict.supported).toBe(true);
      expect(assert.allPassed()).toBe(true);
    });

    it('should throw when the claim is not supported by the evidence', () => {
      const unrelated: EvidenceChunk[] = [
        { id: 'docs/errors.md', text: 'The service handles errors gracefully.' },
      ];

      expect(() =>
        assert.assertGrounded('The API returns 999 on failure', unrelated)
      ).toThrow(MAMAssertionError);
    });

    it('should fail when the score is below an explicit minScore', () => {
      expect(() =>
        assert.assertGrounded('The API returns a 204 status code', matchingEvidence, 0.9)
      ).toThrow(MAMAssertionError);
    });
  });

  describe('ConsoleReporter evaluation summary', () => {
    it('should include evaluation stats after evaluations were recorded', () => {
      assert.evaluate('accuracy', 0.9);
      assert.evaluate('quality', 0.85);
      expect(() => assert.evaluate('robustness', 0.3)).toThrow(MAMAssertionError);

      const result: TestResult = {
        success: true,
        timeMs: 12.34,
        summary: { total: 3, passed: 3, failed: 0, skipped: 0 },
        suites: [],
      };

      const report = new ConsoleReporter().report(result);
      expect(report).toContain('Evaluations:');
      expect(report).toContain('3 total');
      expect(report).toContain('2 passed');
      expect(report).toContain('66.7% pass rate');
      expect(report).toContain('average score 0.6833');
    });

    it('should omit the evaluation section when no evaluations were recorded', () => {
      const result: TestResult = {
        success: true,
        timeMs: 1,
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
        suites: [],
      };

      const report = new ConsoleReporter().report(result);
      expect(report).not.toContain('Evaluations:');
      expect(report).toContain('SUCCESS');
    });
  });
});