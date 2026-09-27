/**
 * MAM Purpose Section Node
 *
 * Defines the PurposeNode and related types for the Purpose section.
 * The purpose section captures the module's intent, goals, success criteria,
 * and context in a structured way.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** A specific goal the module aims to achieve. */
export interface PurposeGoal {
  /** Goal identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** Priority level. */
  priority?: 'critical' | 'high' | 'medium' | 'low';
  /** Measurable outcome. */
  measurable?: string;
}

/** A criterion used to evaluate success. */
export interface SuccessCriterion {
  /** Criterion identifier. */
  id: string;
  /** Human-readable description. */
  description: string;
  /** How to measure this criterion. */
  metric?: string;
  /** Target value (e.g. "95%", "< 200ms"). */
  target?: string;
}

/** The Purpose section AST node. */
export interface PurposeNode {
  /** Discriminant – always `'Purpose'`. */
  type: 'Purpose';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Free-form purpose content. */
  content: string;
  /** Structured goals. */
  goals?: PurposeGoal[];
  /** Success criteria. */
  successCriteria?: SuccessCriterion[];
  /** Target audience. */
  audience?: string;
  /** Constraints or assumptions. */
  constraints?: string[];
  /** Non-goals (explicitly out of scope). */
  nonGoals?: string[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a PurposeNode.
 * Returns an empty array when the node is valid.
 */
export function validatePurposeNode(node: PurposeNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'PurposeNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Purpose') {
    errors.push({ path: 'type', message: `Expected type "Purpose", got "${node.type}".` });
  }

  if (!node.content || typeof node.content !== 'string') {
    errors.push({ path: 'content', message: 'content must be a non-empty string.' });
  }

  if (node.goals) {
    if (!Array.isArray(node.goals)) {
      errors.push({ path: 'goals', message: 'goals must be an array.' });
    } else {
      node.goals.forEach((goal, i) => {
        const base = `goals[${i}]`;
        if (!goal.id || typeof goal.id !== 'string') {
          errors.push({ path: `${base}.id`, message: 'goal id must be a non-empty string.' });
        }
        if (!goal.description || typeof goal.description !== 'string') {
          errors.push({ path: `${base}.description`, message: 'goal description must be a non-empty string.' });
        }
      });
    }
  }

  if (node.successCriteria) {
    if (!Array.isArray(node.successCriteria)) {
      errors.push({ path: 'successCriteria', message: 'successCriteria must be an array.' });
    } else {
      node.successCriteria.forEach((c, i) => {
        const base = `successCriteria[${i}]`;
        if (!c.id || typeof c.id !== 'string') {
          errors.push({ path: `${base}.id`, message: 'criterion id must be a non-empty string.' });
        }
        if (!c.description || typeof c.description !== 'string') {
          errors.push({ path: `${base}.description`, message: 'criterion description must be a non-empty string.' });
        }
      });
    }
  }

  if (node.constraints !== undefined && !Array.isArray(node.constraints)) {
    errors.push({ path: 'constraints', message: 'constraints must be an array.' });
  }

  if (node.nonGoals !== undefined && !Array.isArray(node.nonGoals)) {
    errors.push({ path: 'nonGoals', message: 'nonGoals must be an array.' });
  }

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreatePurposeNodeOptions {
  content: string;
  goals?: PurposeGoal[];
  successCriteria?: SuccessCriterion[];
  audience?: string;
  constraints?: string[];
  nonGoals?: string[];
  location?: SourceLocation;
}

/** Create a PurposeNode with sensible defaults. */
export function createPurposeNode(options: CreatePurposeNodeOptions): PurposeNode {
  return {
    type: 'Purpose',
    content: options.content,
    goals: options.goals,
    successCriteria: options.successCriteria,
    audience: options.audience,
    constraints: options.constraints,
    nonGoals: options.nonGoals,
    location: options.location,
  };
}

/** Create a PurposeGoal. */
export function createPurposeGoal(
  id: string,
  description: string,
  overrides: Partial<Omit<PurposeGoal, 'id' | 'description'>> = {},
): PurposeGoal {
  return { id, description, ...overrides };
}

/** Create a SuccessCriterion. */
export function createSuccessCriterion(
  id: string,
  description: string,
  overrides: Partial<Omit<SuccessCriterion, 'id' | 'description'>> = {},
): SuccessCriterion {
  return { id, description, ...overrides };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a PurposeNode. */
export function isPurposeNode(value: unknown): value is PurposeNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PurposeNode).type === 'Purpose' &&
    typeof (value as PurposeNode).content === 'string'
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all goal ids. */
export function getGoalIds(node: PurposeNode): string[] {
  return (node.goals ?? []).map((g) => g.id);
}

/** Find a goal by id. */
export function findGoalById(node: PurposeNode, id: string): PurposeGoal | undefined {
  return node.goals?.find((g) => g.id === id);
}

/** Return goals sorted by priority (critical > high > medium > low). */
export function getGoalsByPriority(node: PurposeNode): PurposeGoal[] {
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...(node.goals ?? [])].sort(
    (a, b) => (order[a.priority ?? 'medium'] ?? 2) - (order[b.priority ?? 'medium'] ?? 2),
  );
}

/** Return all success criterion ids. */
export function getSuccessCriterionIds(node: PurposeNode): string[] {
  return (node.successCriteria ?? []).map((c) => c.id);
}

/** Find a success criterion by id. */
export function findSuccessCriterionById(
  node: PurposeNode,
  id: string,
): SuccessCriterion | undefined {
  return node.successCriteria?.find((c) => c.id === id);
}

/** Return all constraints. */
export function getConstraints(node: PurposeNode): string[] {
  return node.constraints ?? [];
}

/** Return all non-goals. */
export function getNonGoals(node: PurposeNode): string[] {
  return node.nonGoals ?? [];
}

/** Build a summary string from the purpose. */
export function summarizePurpose(node: PurposeNode): string {
  const parts: string[] = [node.content];
  if (node.goals && node.goals.length > 0) {
    parts.push(`Goals: ${node.goals.length}`);
  }
  if (node.successCriteria && node.successCriteria.length > 0) {
    parts.push(`Criteria: ${node.successCriteria.length}`);
  }
  return parts.join(' | ');
}

export function hasGoals(node: PurposeNode): boolean {
  return (node.goals?.length ?? 0) > 0;
}

export function countGoals(node: PurposeNode): number {
  return node.goals?.length ?? 0;
}

export function summarizeSuccessCriteria(node: PurposeNode): string {
  const criteria = node.successCriteria ?? [];
  const list = criteria
    .map((criterion) => (criterion.target ? `${criterion.id}: ${criterion.target}` : criterion.id))
    .join(', ');
  return list.length > 0 ? `${criteria.length} criteria: ${list}` : `${criteria.length} criteria`;
}

export function withGoal(node: PurposeNode, goal: PurposeGoal): PurposeNode {
  return {
    ...node,
    goals: [...(node.goals ?? []), goal],
  };
}

export function withoutGoal(
  node: PurposeNode,
  idOrPredicate: string | ((goal: PurposeGoal) => boolean),
): PurposeNode {
  if (!node.goals) {
    return { ...node };
  }
  const predicate =
    typeof idOrPredicate === 'string'
      ? (goal: PurposeGoal) => goal.id === idOrPredicate
      : idOrPredicate;
  return {
    ...node,
    goals: node.goals.filter((goal) => !predicate(goal)),
  };
}

export function clonePurposeNode(
  node: PurposeNode,
  options?: { stripLocation?: boolean },
): PurposeNode {
  const clone: PurposeNode = { ...node };
  if (node.goals) {
    clone.goals = node.goals.map((goal) => ({ ...goal }));
  }
  if (node.successCriteria) {
    clone.successCriteria = node.successCriteria.map((criterion) => ({ ...criterion }));
  }
  if (node.constraints) {
    clone.constraints = [...node.constraints];
  }
  if (node.nonGoals) {
    clone.nonGoals = [...node.nonGoals];
  }
  if (options?.stripLocation) {
    delete clone.location;
  }
  return clone;
}

export function mergePurposeNodes(a: PurposeNode, b: PurposeNode): PurposeNode {
  const goals = (a.goals ?? []).map((goal) => ({ ...goal }));
  const goalIndex = new Map<string, number>(
    goals.map((goal, i): [string, number] => [goal.id, i]),
  );
  for (const goal of b.goals ?? []) {
    const existing = goalIndex.get(goal.id);
    if (existing !== undefined) {
      goals[existing] = { ...goal };
    } else {
      goalIndex.set(goal.id, goals.length);
      goals.push({ ...goal });
    }
  }

  const successCriteria = (a.successCriteria ?? []).map((criterion) => ({ ...criterion }));
  const criterionIndex = new Map<string, number>(
    successCriteria.map((criterion, i): [string, number] => [criterion.id, i]),
  );
  for (const criterion of b.successCriteria ?? []) {
    const existing = criterionIndex.get(criterion.id);
    if (existing !== undefined) {
      successCriteria[existing] = { ...criterion };
    } else {
      criterionIndex.set(criterion.id, successCriteria.length);
      successCriteria.push({ ...criterion });
    }
  }

  const constraints = [...(a.constraints ?? []), ...(b.constraints ?? [])];
  const nonGoals = [...(a.nonGoals ?? []), ...(b.nonGoals ?? [])];

  const merged: PurposeNode = {
    type: 'Purpose',
    content: b.content || a.content,
    audience: b.audience ?? a.audience,
    location: b.location ?? a.location,
  };
  if (goals.length > 0) {
    merged.goals = goals;
  }
  if (successCriteria.length > 0) {
    merged.successCriteria = successCriteria;
  }
  if (constraints.length > 0) {
    merged.constraints = constraints;
  }
  if (nonGoals.length > 0) {
    merged.nonGoals = nonGoals;
  }
  return merged;
}
