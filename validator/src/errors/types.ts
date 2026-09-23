/**
 * MAM Validation Error Types
 */

export interface ValidationErrorOptions {
  rule: string;
  message: string;
  line?: number;
  column?: number;
  severity?: 'error' | 'warning' | 'info';
}

export class MAMValidationError extends Error {
  rule: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';

  constructor(options: ValidationErrorOptions) {
    super(options.message);
    this.name = 'MAMValidationError';
    this.rule = options.rule;
    this.line = options.line;
    this.column = options.column;
    this.severity = options.severity ?? 'error';
  }
}

// ============================================================================
// Type-Only Imports
// ============================================================================
// The imports below are type-only and are erased entirely at compile time.
// They reference public types from the AST package and from the validator's
// own error barrel (`./index.js`) so that the richer types declared in this
// file remain fully type-checked without introducing any runtime dependency
// or circular-import hazard.

import type { MAMModule, Section } from '@mam/ast';
import type { ErrorCode, Severity, WarningCode } from './index.js';

// ============================================================================
// Severity & Category
// ============================================================================

/**
 * Severity level alias.
 *
 * A convenience alias for the canonical `Severity` union used throughout the
 * validator. Kept in this file so that rule authors and issue helpers can rely
 * on a single, stable spelling without reaching across module boundaries.
 *
 * @remarks
 * - `'error'` — the module cannot be considered valid; validation fails.
 * - `'warning'` — the module is usable but violates a style or best practice.
 * - `'info'` — an informational notice; does not affect validity.
 */
export type SeverityLevel = 'error' | 'warning' | 'info';

/**
 * Error category.
 *
 * Classifies a validation issue according to the part of the MAM module it
 * concerns. Categories drive filtering, grouping, and reporting so that
 * consumers can, for example, ignore all `'style'` issues or summarize
 * `'reference'` problems specifically.
 *
 * @remarks
 * - `'frontmatter'` — issues in the YAML front matter (id, version, runtime, ...).
 * - `'section'` — issues with section presence, naming, ordering, or structure.
 * - `'content'` — issues with the body content of a section.
 * - `'reference'` — issues with cross-references, URLs, and dependencies.
 * - `'schema'` — issues where data violates a declared schema or type contract.
 * - `'style'` — stylistic inconsistencies (formatting, whitespace, line length).
 * - `'best-practice'` — recommendations that are not strictly required.
 * - `'other'` — anything that does not fit a more specific category.
 */
export type ErrorCategory =
  | 'frontmatter'
  | 'section'
  | 'content'
  | 'reference'
  | 'schema'
  | 'style'
  | 'best-practice'
  | 'other';

// ============================================================================
// Source Position & Range
// ============================================================================

/**
 * A position within the validated MAM source document.
 *
 * Lines are 1-indexed (the first line of a document is line 1). Columns are
 * 0-indexed (the first character on a line sits at column 0), matching the
 * convention used by the MAM AST `Position` type.
 *
 * @property line - 1-based line number in the source document.
 * @property column - 0-based character offset within the line.
 * @property offset - Optional absolute character offset from the start of the
 *   document. Useful for editors and for computing ranges without re-parsing.
 */
export interface SourcePosition {
  line: number;
  column: number;
  offset?: number;
}

/**
 * A contiguous range in the source document, delimited by two positions.
 *
 * Ranges are half-open in spirit: the `start` position is inclusive while the
 * `end` position is exclusive. This mirrors typical editor and language-server
 * span semantics and makes range math (slicing, replacement, overlap checks)
 * predictable.
 *
 * @property start - The inclusive start position of the range.
 * @property end - The exclusive end position of the range.
 *
 * @example
 * ```ts
 * const range: SourceRange = {
 *   start: { line: 4, column: 2 },
 *   end: { line: 4, column: 14 },
 * };
 * ```
 */
export interface SourceRange {
  start: SourcePosition;
  end: SourcePosition;
}

// ============================================================================
// Unified Issue Model
// ============================================================================

/**
 * A single edit to apply to the source document as part of a suggested fix.
 *
 * Used by `SuggestedFix` to describe exactly which bytes of source text should
 * be replaced and with what. Consumers (editors, CLIs, formatters) can apply
 * edits independently of the rest of the validation pipeline.
 *
 * @property range - The source range that the edit replaces.
 * @property replacement - The text that will replace the range.
 */
export interface TextEdit {
  range: SourceRange;
  replacement: string;
}

/**
 * A suggested, machine-applicable fix for a validation issue.
 *
 * Carries a human-readable description plus a list of precise edits. Having a
 * concrete fix description allows tools to offer `--fix` style automation, and
 * allows editors to render quick-fix actions.
 *
 * @property description - Human-readable summary of what the fix does.
 * @property edits - Ordered list of source edits to apply.
 */
export interface SuggestedFix {
  description: string;
  edits: TextEdit[];
}

/**
 * A unified validation issue.
 *
 * Represents both errors and warnings (and informational notices) through a
 * single shape. This is the currency of the issue helpers, collectors, and
 * formatters defined alongside this file: it intentionally unifies the
 * stricter `ValidationError`/`ValidationWarning` pair used by the public
 * validator API into one structure that is easy to sort, group, filter, and
 * render.
 *
 * @property code - A stable, programmatic identifier for the issue. Prefer an
 *   `ErrorCode` or `WarningCode` value; arbitrary strings are allowed for
 *   custom rules and tooling.
 * @property message - Human-readable description of the problem.
 * @property severity - How severe the issue is; `'error'`, `'warning'`, or
 *   `'info'`.
 * @property location - Optional source range the issue applies to.
 * @property path - Optional dotted path to the relevant node or field in the
 *   module (for example `'frontmatter.dependencies'`).
 * @property context - Optional structured, machine-readable metadata that
 *   supplements the message (expected vs. actual values, offending tokens, ...).
 * @property rule - Optional name of the rule that produced the issue.
 * @property suggestedFix - Optional fix that can be applied to resolve the issue.
 */
export interface ValidationIssue {
  code: ErrorCode | WarningCode | string;
  message: string;
  severity: SeverityLevel;
  location?: SourceRange;
  path?: string;
  context?: Record<string, unknown>;
  rule?: string;
  suggestedFix?: SuggestedFix;
}

/**
 * The key used when grouping a collection of issues.
 *
 * Drives the `groupIssues` helper: issues can be grouped by the rule that
 * produced them, by their code, by their severity, or by their AST path.
 *
 * @remarks
 * - `'rule'` — group by `issue.rule`.
 * - `'code'` — group by `issue.code`.
 * - `'severity'` — group by `issue.severity`.
 * - `'path'` — group by `issue.path`.
 */
export type ValidationIssueGroupBy = 'rule' | 'code' | 'severity' | 'path';

/**
 * A group of issues sharing a common key.
 *
 * Produced by `groupIssues`. The `severity` field records the most severe
 * severity found within the group, which is convenient when rendering groups
 * in priority order.
 *
 * @property key - The shared grouping value (rule name, code, severity, or path).
 * @property severity - The most severe `SeverityLevel` present in the group.
 * @property issues - The issues belonging to this group, in their original order.
 */
export interface ValidationIssueGroup {
  key: string;
  severity: SeverityLevel;
  issues: ValidationIssue[];
}

// ============================================================================
// Rule Infrastructure
// ============================================================================

/**
 * Rule options bag.
 *
 * Free-form configuration passed to a rule's validation function. Rules read
 * whatever options they understand from this map; unknown keys are ignored.
 * Typical entries include things like `maxLineLength`, `allowedLanguages`,
 * or `requiredSections`.
 */
export type RuleOptions = Record<string, unknown>;

/**
 * Context provided to a rule's `validate` function.
 *
 * Gives rules full access to the parsed module, its sections, and the AST so
 * that they can implement anything from simple field checks to deep semantic
 * analysis.
 *
 * @property module - The full parsed MAM module.
 * @property sections - The module's sections, for convenient iteration.
 * @property ast - The full module AST (same object as `module`); present as a
 *   named alias for rule authors who think in AST terms.
 * @property options - Free-form configuration bag for the rule run.
 * @property file - Optional file name or path the module was read from, when known.
 */
export interface RuleContext {
  module: MAMModule;
  sections: Section[];
  ast: MAMModule;
  options: RuleOptions;
  file?: string;
}

/**
 * A declarative validation rule.
 *
 * Encapsulates everything needed to run one check: identity, documentation,
 * a default severity, a category, and the validation function itself.
 *
 * @property name - Unique, stable identifier for the rule (e.g. `'no-long-lines'`).
 * @property description - Human-readable explanation of what the rule checks.
 * @property severity - Default severity for issues the rule produces.
 * @property category - The `ErrorCategory` the rule belongs to.
 * @property validate - Function invoked with a `RuleContext`; returns the
 *   issues found. Should be pure and free of side effects.
 */
export interface RuleDefinition {
  name: string;
  description: string;
  severity: SeverityLevel;
  category: ErrorCategory;
  validate: (context: RuleContext) => ValidationIssue[];
}

/**
 * Result of executing a single rule.
 *
 * Bundles the rule with whatever issues it produced plus timing and status
 * information, making it easy to report per-rule performance and outcomes.
 *
 * @property rule - The rule definition that was executed.
 * @property issues - Issues produced by the rule's `validate` function.
 * @property durationMs - Wall-clock time the rule took to run, in milliseconds.
 * @property skipped - Whether the rule was skipped (for example, because its
 *   preconditions were not met or it was disabled).
 */
export interface RuleResult {
  rule: RuleDefinition;
  issues: ValidationIssue[];
  durationMs: number;
  skipped?: boolean;
}

/**
 * The overall status of a rule's execution.
 *
 * - `'passed'` — the rule ran and produced no issues.
 * - `'failed'` — the rule ran and produced at least one issue.
 * - `'skipped'` — the rule was skipped (preconditions not met, or disabled).
 * - `'errored'` — the rule threw while running.
 */
export type RuleExecutionStatus = 'passed' | 'failed' | 'skipped' | 'errored';

// ============================================================================
// Filtering, Sorting & Reporting
// ============================================================================

/**
 * Criteria for filtering a collection of issues.
 *
 * All fields are optional; only the fields that are provided participate in
 * filtering. This allows callers to compose filters incrementally and reuse
 * them across issue sets.
 *
 * @property severity - Keep only issues with this exact severity.
 * @property code - Keep only issues with this code.
 * @property rule - Keep only issues produced by this rule.
 * @property path - Keep only issues whose `path` equals this value.
 * @property minLine - Keep only issues whose start line is greater than or
 *   equal to this value.
 * @property maxLine - Keep only issues whose start line is less than or equal
 *   to this value.
 */
export interface IssueFilter {
  severity?: SeverityLevel;
  code?: ErrorCode | WarningCode | string;
  rule?: string;
  path?: string;
  minLine?: number;
  maxLine?: number;
}

/**
 * The field issues are sorted by.
 *
 * - `'severity'` — sort by severity value (error > warning > info).
 * - `'line'` — sort by the issue's start line.
 * - `'column'` — sort by the issue's start column.
 * - `'code'` — sort by the issue's code, lexicographically.
 * - `'rule'` — sort by the rule name, lexicographically.
 * - `'path'` — sort by the issue's path, lexicographically.
 */
export type IssueSortField = 'severity' | 'line' | 'column' | 'code' | 'rule' | 'path';

/**
 * Sort direction.
 *
 * - `'asc'` — ascending (errors last when sorting by severity, earliest lines first).
 * - `'desc'` — descending (errors first when sorting by severity, latest lines first).
 */
export type IssueSortDirection = 'asc' | 'desc';

/**
 * Options controlling how a validation report is produced or rendered.
 *
 * @property includeStats - Whether to include validation statistics.
 * @property includeMeta - Whether to include validation metadata (validator,
 *   version, timestamp).
 * @property errorOnly - Whether to omit warnings and informational notices.
 * @property maxIssues - Maximum number of issues to include; excess issues are
 *   dropped to bound output size.
 */
export interface ValidationReportOptions {
  includeStats?: boolean;
  includeMeta?: boolean;
  errorOnly?: boolean;
  maxIssues?: number;
}

/**
 * Per-severity counters.
 *
 * A plain tally of how many issues exist at each severity. Produced by the
 * `countBySeverity` helper and the `ValidationIssueCollector`.
 *
 * @property error - Number of issues at severity `'error'`.
 * @property warning - Number of issues at severity `'warning'`.
 * @property info - Number of issues at severity `'info'`.
 */
export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
}

/**
 * A predicate over a single issue.
 *
 * Used by `filterIssues` to let callers express arbitrary, custom filtering
 * logic on top of the structured `IssueFilter` fields. A predicate receives an
 * issue and returns `true` when the issue should be kept.
 *
 * @example
 * ```ts
 * const onlyMissing: IssuePredicate = (issue) =>
 *   issue.code.startsWith('MISSING_');
 * ```
 */
export type IssuePredicate = (issue: ValidationIssue) => boolean;

/**
 * A complete sort configuration for a set of issues.
 *
 * Pairs a sort field with a direction so that callers can pass a single object
 * (rather than two positional arguments) to sorting utilities.
 *
 * @property field - The field to sort by.
 * @property direction - The direction to sort in.
 */
export interface IssueSortConfig {
  field: IssueSortField;
  direction: IssueSortDirection;
}

/**
 * A compact, render-friendly summary of a single issue.
 *
 * Flattens the most useful fields of a `ValidationIssue` into a small shape
 * that is convenient for CLI output, log lines, and table rendering. Produced
 * by the formatters in `format.ts`.
 *
 * @property severity - The issue's severity.
 * @property code - The issue's code.
 * @property message - The issue's message.
 * @property file - Source file name, when known.
 * @property line - Start line, when the issue has a location.
 * @property column - Start column, when the issue has a location.
 * @property rule - The rule that produced the issue, when known.
 * @property path - The issue's AST path, when known.
 */
export interface IssueSummary {
  severity: SeverityLevel;
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  rule?: string;
  path?: string;
}

/**
 * A map of grouping keys to their issue arrays.
 *
 * The result shape of grouping operations where insertion order is preserved
 * (plain objects with string keys). Keys are the grouping value (`'rule'`,
 * `'code'`, `'severity'`, or `'path'` depending on the grouping key chosen).
 */
export type GroupedIssueMap = Record<string, ValidationIssue[]>;

/**
 * The complete output of a validation run.
 *
 * Bundles the standard `ValidationReport` with run metadata and the unified
 * issue list, giving consumers a single object they can persist, diff, or
 * re-render later without re-running the validator.
 *
 * @property report - The standard validation report (errors, warnings, stats).
 * @property meta - Metadata about the run (validator, version, timestamp).
 * @property issues - The unified, severity-ordered issue list for the run.
 */
export interface ValidationRunResult {
  report: import('./index.js').ValidationReport;
  meta: ValidationMeta;
  issues: ValidationIssue[];
}

// ============================================================================
// Metadata & Diagnostics
// ============================================================================

/**
 * Descriptive metadata about an error code.
 *
 * Provides the canonical category, default severity, and a human-readable
 * description for each known `ErrorCode`. Consumed by the `codes.ts` module to
 * build lookup tables and to render richer diagnostics.
 *
 * @property code - The `ErrorCode` value this entry describes.
 * @property category - The `ErrorCategory` the code belongs to.
 * @property severity - The default severity the code should be reported at.
 * @property description - Human-readable explanation of the code's meaning.
 */
export interface ErrorCodeInfo {
  code: ErrorCode;
  category: ErrorCategory;
  severity: SeverityLevel;
  description: string;
}

/**
 * Metadata describing a validation run.
 *
 * Useful for attaching provenance to reports and for diagnosing which version
 * of the validator produced a given set of issues.
 *
 * @property validator - Name of the validator that ran (e.g. `'@mam/validator'`).
 * @property version - Version string of the validator.
 * @property timestamp - ISO-8601 timestamp of when the run completed.
 * @property durationMs - Total wall-clock duration of the run, in milliseconds.
 */
export interface ValidationMeta {
  validator: string;
  version: string;
  timestamp: string;
  durationMs: number;
}