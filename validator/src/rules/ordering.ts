/**
 * Section Ordering Validation Rules
 *
 * Enforces recommended section order, heading-level consistency,
 * and returns issues with specific line numbers.
 */

export type Severity = 'error' | 'warning' | 'info';

export interface OrderingIssue {
  rule: string;
  code: string;
  message: string;
  severity: Severity;
  line?: number;
  column?: number;
  path?: string;
}

/**
 * A detailed section-ordering issue.
 *
 * Extends {@link OrderingIssue} with the two section names that were found
 * out of order and the array position of the misplaced section.
 */
export interface OrderingIssueDetail extends OrderingIssue {
  /** The section that was expected to appear before the misplaced section. */
  expected: string;
  /** The section that was found out of order. */
  found: string;
  /** The index of the misplaced section within the sections array. */
  position: number;
}

export const STANDARD_SECTION_ORDER: string[] = [
  'Purpose',
  'Inputs',
  'Outputs',
  'Rules',
  'Workflow',
  'Mermaid',
  'Python',
  'JavaScript',
  'TypeScript',
  'Prompt',
  'Memory',
  'Examples',
  'Tests',
  'References',
  'Dependencies',
  'Exports',
  'Imports',
  'Plugins',
  'Permissions',
  'Capabilities',
];

const CUSTOM_SECTION_PLACEHOLDER = '__custom__';

function sectionIndex(name: string): number {
  const idx = STANDARD_SECTION_ORDER.indexOf(name);
  return idx === -1 ? -1 : idx;
}

function locParts(
  sections: Array<{ name: string; location?: { start?: { line?: number; column?: number } } }>,
  name: string
): { line?: number; column?: number } {
  const sec = sections.find(s => s.name === name);
  if (!sec?.location?.start) return {};
  return { line: sec.location.start.line, column: sec.location.start.column };
}

export function validateOrdering(
  ast: unknown,
  opts?: { treatCustomAsWarning?: boolean }
): OrderingIssue[] {
  const issues: OrderingIssue[] = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{
    name: string;
    level?: number;
    location?: { start?: { line?: number; column?: number } };
  }>) || [];

  if (sections.length === 0) return issues;

  let lastStandardIndex = -1;
  let customSeen = false;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const stdIdx = sectionIndex(sec.name);
    const loc = locParts(sections, sec.name);
    const path = `sections[${i}].${sec.name}`;

    if (stdIdx !== -1) {
      if (customSeen) {
        issues.push({
          rule: 'ordering',
          code: 'STANDARD_SECTION_AFTER_CUSTOM',
          message: `Standard section "${sec.name}" appears after custom sections; move it before custom sections`,
          severity: opts?.treatCustomAsWarning !== false ? 'warning' : 'error',
          ...loc,
          path,
        });
      }

      if (lastStandardIndex !== -1 && stdIdx < lastStandardIndex) {
        const expectedBefore = STANDARD_SECTION_ORDER[lastStandardIndex]!;
        issues.push({
          rule: 'ordering',
          code: 'SECTION_OUT_OF_ORDER',
          message: `Section "${sec.name}" is out of order; expected it before "${expectedBefore}"`,
          severity: 'warning',
          ...loc,
          path,
        });
      }

      lastStandardIndex = Math.max(lastStandardIndex, stdIdx);
    } else {
      customSeen = true;
      if (i < sections.length - 1) {
        const nextSec = sections[i + 1];
        if (nextSec && sectionIndex(nextSec.name) !== -1) {
          issues.push({
            rule: 'ordering',
            code: 'CUSTOM_SECTION_NOT_AT_END',
            message: `Custom section "${sec.name}" is not at the end of the section list`,
            severity: 'info',
            ...loc,
            path,
          });
        }
      }
    }
  }

  const levels: number[] = sections
    .map(s => s.level)
    .filter((l): l is number => l !== undefined && l !== null);

  if (levels.length > 0) {
    const uniqueLevels = [...new Set(levels)];
    if (uniqueLevels.length > 1) {
      const primary = Math.min(...uniqueLevels);
      const nonPrimary = uniqueLevels.filter(l => l !== primary);
      for (const nl of nonPrimary) {
        const mismatched = sections.filter(s => s.level === nl);
        for (const m of mismatched) {
          const loc = locParts(sections, m.name);
          issues.push({
            rule: 'ordering',
            code: 'INCONSISTENT_HEADING_LEVEL',
            message: `Section "${m.name}" uses heading level ${m.level}; most sections use level ${primary}`,
            severity: 'info',
            ...loc,
            path: `sections[${m.name}].level`,
          });
        }
      }
    }
  }

  const names = sections.map(s => s.name);
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    if (seen.has(name)) {
      const loc = locParts(sections, name);
      issues.push({
        rule: 'ordering',
        code: 'DUPLICATE_SECTION',
        message: `Duplicate section "${name}"`,
        severity: 'error',
        ...loc,
        path: `sections[${i}].${name}`,
      });
    }
    seen.add(name);
  }

  return issues;
}

/**
 * Detailed section-ordering validation.
 *
 * Like {@link validateOrdering} but restricted to out-of-order standard
 * sections, with each result carrying `expected`, `found`, and `position`
 * fields via the {@link OrderingIssueDetail} interface.
 *
 * @param ast - The MAM AST (expects `ast.sections`).
 * @returns A list of {@link OrderingIssueDetail} objects (assignable to
 * {@link OrderingIssue}[]); empty when all standard sections are ordered.
 * @remarks Emits `SECTION_OUT_OF_ORDER` warnings. The `expected` field names
 * the section that should have appeared before `found`, and `position` is the
 * array index of the misplaced section.
 */
export function validateSectionOrderingDetailed(ast: unknown): OrderingIssue[] {
  const issues: OrderingIssueDetail[] = [];
  const doc = ast as Record<string, unknown>;
  const sections = (doc.sections as Array<{
    name: string;
    location?: { start?: { line?: number; column?: number } };
  }>) || [];

  let lastStandardIndex = -1;

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i]!;
    const stdIdx = sectionIndex(sec.name);

    if (stdIdx === -1) continue;

    if (lastStandardIndex !== -1 && stdIdx < lastStandardIndex) {
      const expected = STANDARD_SECTION_ORDER[lastStandardIndex]!;
      const loc = locParts(sections, sec.name);
      issues.push({
        rule: 'ordering',
        code: 'SECTION_OUT_OF_ORDER',
        message: `Section "${sec.name}" is out of order; expected it before "${expected}"`,
        severity: 'warning',
        expected,
        found: sec.name,
        position: i,
        ...loc,
        path: `sections[${i}].${sec.name}`,
      });
    }

    lastStandardIndex = Math.max(lastStandardIndex, stdIdx);
  }

  return issues;
}
