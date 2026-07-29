/**
 * Ordering Validation Rules Tests
 */

import { describe, it, expect } from 'vitest';
import { validateOrdering, STANDARD_SECTION_ORDER } from '../../src/rules/ordering.js';
import type { OrderingIssue } from '../../src/rules/ordering.js';

function createAstWithSections(
  names: string[],
  levels?: number[]
): Record<string, unknown> {
  return {
    sections: names.map((name, i) => ({
      name,
      level: levels?.[i] ?? 2,
      location: { start: { line: (i + 1) * 10, column: 0 } },
    })),
  };
}

describe('Ordering Rules', () => {
  describe('validateOrdering', () => {
    it('should return no issues for empty sections', () => {
      const issues = validateOrdering({ sections: [] });
      expect(issues).toHaveLength(0);
    });

    it('should return no issues for correctly ordered standard sections', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'Inputs', 'Outputs']));
      expect(issues).toHaveLength(0);
    });

    it('should detect out-of-order standard sections', () => {
      const issues = validateOrdering(createAstWithSections(['Outputs', 'Inputs', 'Purpose']));
      const outOfOrder = issues.filter(i => i.code === 'SECTION_OUT_OF_ORDER');
      expect(outOfOrder.length).toBeGreaterThan(0);
    });

    it('should detect section after custom sections', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'MyCustom', 'Inputs']));
      const afterCustom = issues.filter(i => i.code === 'STANDARD_SECTION_AFTER_CUSTOM');
      expect(afterCustom.length).toBeGreaterThan(0);
    });

    it('should allow custom sections at the end', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'Inputs', 'MyCustom']));
      const notAtEnd = issues.filter(i => i.code === 'CUSTOM_SECTION_NOT_AT_END');
      expect(notAtEnd).toHaveLength(0);
    });

    it('should flag custom section not at end', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'CustomA', 'Inputs', 'CustomB']));
      const notAtEnd = issues.filter(i => i.code === 'CUSTOM_SECTION_NOT_AT_END');
      expect(notAtEnd.length).toBeGreaterThan(0);
    });

    it('should detect duplicate sections', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'Inputs', 'Purpose']));
      const dupes = issues.filter(i => i.code === 'DUPLICATE_SECTION');
      expect(dupes.length).toBe(1);
    });

    it('should detect inconsistent heading levels', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'Inputs'], [2, 3]));
      const inconsistent = issues.filter(i => i.code === 'INCONSISTENT_HEADING_LEVEL');
      expect(inconsistent.length).toBeGreaterThan(0);
    });

    it('should not flag consistent heading levels', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose', 'Inputs'], [2, 2]));
      const inconsistent = issues.filter(i => i.code === 'INCONSISTENT_HEADING_LEVEL');
      expect(inconsistent).toHaveLength(0);
    });

    it('should include line numbers in issues', () => {
      const issues = validateOrdering(createAstWithSections(['Outputs', 'Inputs']));
      expect(issues[0].line).toBeDefined();
    });

    it('should include path in issues', () => {
      const issues = validateOrdering(createAstWithSections(['Outputs', 'Inputs']));
      expect(issues[0].path).toBeDefined();
    });

    it('should return STANDARD_SECTION_ORDER constant', () => {
      expect(STANDARD_SECTION_ORDER).toContain('Purpose');
      expect(STANDARD_SECTION_ORDER).toContain('References');
      expect(STANDARD_SECTION_ORDER[0]).toBe('Purpose');
    });

    it('should handle single section', () => {
      const issues = validateOrdering(createAstWithSections(['Purpose']));
      expect(issues).toHaveLength(0);
    });

    it('should handle all standard sections in order', () => {
      const issues = validateOrdering(createAstWithSections(STANDARD_SECTION_ORDER));
      expect(issues).toHaveLength(0);
    });
  });
});
