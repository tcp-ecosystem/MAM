/**
 * MAM Validation Issue Helpers
 *
 * Pure, dependency-free utilities for working with the unified
 * `ValidationIssue` type: creating, classifying, grouping, sorting,
 * deduplicating, counting, and filtering issues.
 */

import type { Severity } from './index.js';
import type {
  IssueFilter,
  IssuePredicate,
  IssueSortDirection,
  IssueSortField,
  ValidationIssue,
  ValidationIssueGroup,
  ValidationIssueGroupBy,
} from './types.js';

/**
 * Numeric weight for a severity, used for comparisons and ordering.
 * Errors outrank warnings, which outrank informational notices.
 */
const SEVERITY_VALUE: Record<Severity, number> = {
  error: 2,
  warning: 1,
  info: 0,
};

/**
 * Resolve the numeric weight of a severity.
 *
 * @param severity - The severity to weight.
 * @returns 2 for `'error'`, 1 for `'warning'`, 0 for `'info'`.
 */
export function issueSeverityValue(severity: Severity): number {
  return SEVERITY_VALUE[severity];
}

/**
 * Create a `ValidationIssue` from a partial specification.
 *
 * Defaults `severity` to `'error'` when not supplied; every other field is
 * taken verbatim from `partial`. This is the recommended factory for rules
 * and tooling that want a consistent, complete issue shape.
 *
 * @param partial - The issue fields to set. `code` and `message` are required.
 * @returns A fully-formed `ValidationIssue`.
 *
 * @example
 * ```ts
 * createIssue({ code: ErrorCode.MISSING_SECTION, message: 'Missing Purpose', line: 1 });
 * ```
 */
export function createIssue(
  partial: Partial<ValidationIssue> & { code: ValidationIssue['code']; message: string }
): ValidationIssue {
  return {
    severity: 'error',
    ...partial,
  };
}

/**
 * Classify issues into severity buckets.
 *
 * Returns a record with three always-present keys (`error`, `warning`,
 * `info`) each holding the issues of that severity, in their original order.
 *
 * @param issues - Issues to classify.
 * @returns A record keyed by severity.
 */
export function classifyIssues(
  issues: ValidationIssue[]
): Record<Severity, ValidationIssue[]> {
  const classified: Record<Severity, ValidationIssue[]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const issue of issues) {
    classified[issue.severity].push(issue);
  }
  return classified;
}

/**
 * Group issues by a key and return ordered groups.
 *
 * Groups are returned in first-appearance order of their key. Each group
 * carries the most severe severity found within it.
 *
 * @param issues - Issues to group.
 * @param by - The field to group by (`'rule'`, `'code'`, `'severity'`, `'path'`).
 * @returns An array of `ValidationIssueGroup`, one per distinct key.
 */
export function groupIssues(
  issues: ValidationIssue[],
  by: ValidationIssueGroupBy
): ValidationIssueGroup[] {
  const groups = new Map<string, ValidationIssue[]>();
  for (const issue of issues) {
    const key = groupKey(issue, by);
    const list = groups.get(key);
    if (list) {
      list.push(issue);
    } else {
      groups.set(key, [issue]);
    }
  }

  const result: ValidationIssueGroup[] = [];
  for (const [key, groupIssuesList] of groups) {
    result.push({
      key,
      severity: dominantSeverity(groupIssuesList),
      issues: groupIssuesList,
    });
  }
  return result;
}

/**
 * Sort issues by a field and direction.
 *
 * Does not mutate the input; returns a new array. Missing values sort last
 * when ascending (`path`, `rule`, and line/column on issues without a
 * location).
 *
 * @param issues - Issues to sort.
 * @param field - Field to sort by. Defaults to `'severity'`.
 * @param direction - Sort direction. Defaults to `'asc'`.
 * @returns A new, sorted array of issues.
 */
export function sortIssues(
  issues: ValidationIssue[],
  field: IssueSortField = 'severity',
  direction: IssueSortDirection = 'asc'
): ValidationIssue[] {
  const sign = direction === 'asc' ? 1 : -1;
  const accessor = SORT_ACCESSORS[field];
  return [...issues].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -sign;
    if (av > bv) return sign;
    return 0;
  });
}

/**
 * Deduplicate issues.
 *
 * Two issues are considered duplicates when they share the same severity,
 * code, message, source range, and path. The first occurrence is kept.
 *
 * @param issues - Issues to deduplicate.
 * @returns A new array without duplicate issues, preserving order.
 */
export function dedupeIssues(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const result: ValidationIssue[] = [];
  for (const issue of issues) {
    const loc = issue.location
      ? `${issue.location.start.line}:${issue.location.start.column}-${issue.location.end.line}:${issue.location.end.column}`
      : '';
    const key =
      `${issue.severity}\u0000${String(issue.code)}\u0000` +
      `${issue.message}\u0000${loc}\u0000${issue.path ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }
  return result;
}

/**
 * Count issues per severity.
 *
 * @param issues - Issues to count.
 * @returns An object with `error`, `warning`, and `info` totals.
 */
export function countBySeverity(issues: ValidationIssue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity]++;
  }
  return counts;
}

/**
 * Filter issues using either a structured `IssueFilter` or an arbitrary
 * predicate function.
 *
 * @param issues - Issues to filter.
 * @param filter - A structured filter object or a predicate over a single issue.
 * @returns A new array containing only the matching issues.
 */
export function filterIssues(
  issues: ValidationIssue[],
  filter: IssueFilter | IssuePredicate
): ValidationIssue[] {
  if (typeof filter === 'function') {
    return issues.filter(filter);
  }
  return issues.filter((issue) => matchesFilter(issue, filter));
}

/** Extract the grouping key for an issue under a given grouping strategy. */
function groupKey(issue: ValidationIssue, by: ValidationIssueGroupBy): string {
  switch (by) {
    case 'rule':
      return issue.rule ?? '';
    case 'code':
      return String(issue.code);
    case 'severity':
      return issue.severity;
    case 'path':
      return issue.path ?? '';
    default:
      return '';
  }
}

/** Compute the most severe severity present in a list of issues. */
function dominantSeverity(issues: ValidationIssue[]): Severity {
  let level: Severity = 'info';
  for (const issue of issues) {
    if (issueSeverityValue(issue.severity) > issueSeverityValue(level)) {
      level = issue.severity;
    }
  }
  return level;
}

/** Accessors used by `sortIssues` for each sortable field. */
const SORT_ACCESSORS: Record<IssueSortField, (issue: ValidationIssue) => number | string> = {
  severity: (issue) => issueSeverityValue(issue.severity),
  line: (issue) => issue.location?.start.line ?? Number.MAX_SAFE_INTEGER,
  column: (issue) => issue.location?.start.column ?? Number.MAX_SAFE_INTEGER,
  code: (issue) => String(issue.code),
  rule: (issue) => issue.rule ?? '',
  path: (issue) => issue.path ?? '',
};

/** Apply a structured `IssueFilter` to a single issue. */
function matchesFilter(issue: ValidationIssue, filter: IssueFilter): boolean {
  if (filter.severity !== undefined && issue.severity !== filter.severity) return false;
  if (filter.code !== undefined && issue.code !== filter.code) return false;
  if (filter.rule !== undefined && issue.rule !== filter.rule) return false;
  if (filter.path !== undefined && issue.path !== filter.path) return false;

  const line = issue.location?.start.line ?? Number.MAX_SAFE_INTEGER;
  if (filter.minLine !== undefined && line < filter.minLine) return false;
  if (filter.maxLine !== undefined && line > filter.maxLine) return false;

  return true;
}