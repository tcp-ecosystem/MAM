/**
 * MAM Rules Section Node
 *
 * Defines the RulesNode and related types for the Rules section.
 * A rule captures a behavioural constraint, policy, or guideline that the
 * module must follow, including priority, category, severity, and examples.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Priority level of a rule. */
export type RulePriority =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info';

/** Severity level when a rule is violated. */
export type RuleSeverity =
  | 'error'
  | 'warning'
  | 'info'
  | 'none';

/** Category for grouping rules. */
export type RuleCategory =
  | 'safety'
  | 'security'
  | 'performance'
  | 'correctness'
  | 'style'
  | 'compliance'
  | 'business-logic'
  | string;

/** A single rule entry. */
export interface Rule {
  /** Human-readable rule text. */
  text: string;
  /** Priority level. */
  priority?: RulePriority;
  /** Category. */
  category?: RuleCategory;
  /** Severity on violation. */
  severity?: RuleSeverity;
  /** Examples illustrating the rule. */
  examples?: string[];
  /** Whether the rule is currently active. */
  active?: boolean;
  /** Tags for filtering. */
  tags?: string[];
  /** Source of the rule (e.g. "policy-doc-v2"). */
  source?: string;
}

/** The Rules section AST node. */
export interface RulesNode {
  /** Discriminant – always `'Rules'`. */
  type: 'Rules';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of rules. */
  rules: Rule[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_SEVERITIES = new Set(['error', 'warning', 'info', 'none']);

/**
 * Validate a RulesNode.
 * Returns an empty array when the node is valid.
 */
export function validateRulesNode(node: RulesNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'RulesNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Rules') {
    errors.push({ path: 'type', message: `Expected type "Rules", got "${node.type}".` });
  }

  if (!Array.isArray(node.rules)) {
    errors.push({ path: 'rules', message: 'rules must be an array.' });
    return errors;
  }

  node.rules.forEach((rule, idx) => {
    const base = `rules[${idx}]`;

    if (!rule.text || typeof rule.text !== 'string') {
      errors.push({ path: `${base}.text`, message: 'rule text must be a non-empty string.' });
    }

    if (rule.priority !== undefined && !VALID_PRIORITIES.has(rule.priority)) {
      errors.push({ path: `${base}.priority`, message: `Invalid priority "${rule.priority}".` });
    }

    if (rule.severity !== undefined && !VALID_SEVERITIES.has(rule.severity)) {
      errors.push({ path: `${base}.severity`, message: `Invalid severity "${rule.severity}".` });
    }

    if (rule.examples !== undefined && !Array.isArray(rule.examples)) {
      errors.push({ path: `${base}.examples`, message: 'examples must be an array.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateRulesNodeOptions {
  rules?: Rule[];
  location?: SourceLocation;
}

/** Create a RulesNode with sensible defaults. */
export function createRulesNode(options: CreateRulesNodeOptions = {}): RulesNode {
  return {
    type: 'Rules',
    rules: options.rules ?? [],
    location: options.location,
  };
}

/** Create a single Rule. */
export function createRule(
  text: string,
  overrides: Partial<Omit<Rule, 'text'>> = {},
): Rule {
  return {
    text,
    priority: 'medium',
    active: true,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a RulesNode. */
export function isRulesNode(value: unknown): value is RulesNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RulesNode).type === 'Rules' &&
    Array.isArray((value as RulesNode).rules)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return rules sorted by priority (critical > high > medium > low > info). */
export function getRulesByPriority(node: RulesNode): Rule[] {
  const order: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
  };
  return [...node.rules].sort(
    (a, b) => (order[a.priority ?? 'medium'] ?? 2) - (order[b.priority ?? 'medium'] ?? 2),
  );
}

/** Filter rules by category. */
export function getRulesByCategory(node: RulesNode, category: RuleCategory): Rule[] {
  return node.rules.filter((r) => r.category === category);
}

/** Filter rules by severity. */
export function getRulesBySeverity(node: RulesNode, severity: RuleSeverity): Rule[] {
  return node.rules.filter((r) => r.severity === severity);
}

/** Return only active rules. */
export function getActiveRules(node: RulesNode): Rule[] {
  return node.rules.filter((r) => r.active !== false);
}

/** Return only inactive rules. */
export function getInactiveRules(node: RulesNode): Rule[] {
  return node.rules.filter((r) => r.active === false);
}

/** Collect all unique categories. */
export function getAllCategories(node: RulesNode): string[] {
  const cats = new Set<string>();
  for (const rule of node.rules) {
    if (rule.category) {
      cats.add(rule.category);
    }
  }
  return Array.from(cats);
}

/** Collect all unique tags. */
export function getAllRuleTags(node: RulesNode): string[] {
  const tags = new Set<string>();
  for (const rule of node.rules) {
    if (rule.tags) {
      for (const tag of rule.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags);
}

/** Count total rules. */
export function countRules(node: RulesNode): number {
  return node.rules.length;
}

/** Count active rules. */
export function countActiveRules(node: RulesNode): number {
  return getActiveRules(node).length;
}
