/**
 * MAM Examples Section Node
 *
 * Defines the ExamplesNode and related types for the Examples section.
 * Each example demonstrates module usage with input, expected output, and
 * optional metadata for categorisation and filtering.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** A single example entry. */
export interface ExampleEntry {
  /** Title of the example. */
  title: string;
  /** Input data (may be JSON, YAML, or free-form text). */
  input: string;
  /** Expected output or behaviour. */
  expected?: string;
  /** Human-readable description of the example. */
  description?: string;
  /** Tags for categorisation and filtering. */
  tags?: string[];
  /** Whether the example is a negative / error case. */
  negative?: boolean;
  /** Execution time limit in milliseconds (0 = no limit). */
  timeout?: number;
}

/** The Examples section AST node. */
export interface ExamplesNode {
  /** Discriminant – always `'Examples'`. */
  type: 'Examples';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of example entries. */
  examples: ExampleEntry[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an ExamplesNode.
 * Returns an empty array when the node is valid.
 */
export function validateExamplesNode(node: ExamplesNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'ExamplesNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Examples') {
    errors.push({ path: 'type', message: `Expected type "Examples", got "${node.type}".` });
  }

  if (!Array.isArray(node.examples)) {
    errors.push({ path: 'examples', message: 'examples must be an array.' });
    return errors;
  }

  node.examples.forEach((ex, idx) => {
    const base = `examples[${idx}]`;

    if (!ex.title || typeof ex.title !== 'string') {
      errors.push({ path: `${base}.title`, message: 'title must be a non-empty string.' });
    }

    if (!ex.input || typeof ex.input !== 'string') {
      errors.push({ path: `${base}.input`, message: 'input must be a non-empty string.' });
    }

    if (ex.tags !== undefined) {
      if (!Array.isArray(ex.tags)) {
        errors.push({ path: `${base}.tags`, message: 'tags must be an array.' });
      } else {
        ex.tags.forEach((tag, ti) => {
          if (typeof tag !== 'string' || tag.length === 0) {
            errors.push({ path: `${base}.tags[${ti}]`, message: 'tag must be a non-empty string.' });
          }
        });
      }
    }

    if (ex.timeout !== undefined && (typeof ex.timeout !== 'number' || ex.timeout < 0)) {
      errors.push({ path: `${base}.timeout`, message: 'timeout must be a non-negative number.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateExamplesNodeOptions {
  examples?: ExampleEntry[];
  location?: SourceLocation;
}

/** Create an ExamplesNode with sensible defaults. */
export function createExamplesNode(options: CreateExamplesNodeOptions = {}): ExamplesNode {
  return {
    type: 'Examples',
    examples: options.examples ?? [],
    location: options.location,
  };
}

/** Create a single ExampleEntry. */
export function createExampleEntry(
  title: string,
  input: string,
  overrides: Partial<Omit<ExampleEntry, 'title' | 'input'>> = {},
): ExampleEntry {
  return {
    title,
    input,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is an ExamplesNode. */
export function isExamplesNode(value: unknown): value is ExamplesNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ExamplesNode).type === 'Examples' &&
    Array.isArray((value as ExamplesNode).examples)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all example titles. */
export function getExampleTitles(node: ExamplesNode): string[] {
  return node.examples.map((e) => e.title);
}

/** Find an example by title. */
export function findExampleByTitle(node: ExamplesNode, title: string): ExampleEntry | undefined {
  return node.examples.find((e) => e.title === title);
}

/** Find examples that include a specific tag. */
export function findExamplesByTag(node: ExamplesNode, tag: string): ExampleEntry[] {
  return node.examples.filter((e) => e.tags?.includes(tag));
}

/** Find examples that include at least one of the given tags. */
export function findExamplesByAnyTag(node: ExamplesNode, tags: string[]): ExampleEntry[] {
  return node.examples.filter((e) => e.tags?.some((t) => tags.includes(t)));
}

/** Return only negative / error-case examples. */
export function getNegativeExamples(node: ExamplesNode): ExampleEntry[] {
  return node.examples.filter((e) => e.negative === true);
}

/** Return only positive (non-negative) examples. */
export function getPositiveExamples(node: ExamplesNode): ExampleEntry[] {
  return node.examples.filter((e) => e.negative !== true);
}

/** Return examples that have an expected output defined. */
export function getExamplesWithExpected(node: ExamplesNode): ExampleEntry[] {
  return node.examples.filter((e) => e.expected !== undefined);
}

/** Collect all unique tags across all examples. */
export function getAllTags(node: ExamplesNode): string[] {
  const tags = new Set<string>();
  for (const ex of node.examples) {
    if (ex.tags) {
      for (const tag of ex.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags);
}

/** Count total examples. */
export function countExamples(node: ExamplesNode): number {
  return node.examples.length;
}
