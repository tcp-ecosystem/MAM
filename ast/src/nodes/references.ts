/**
 * MAM References Section Node
 *
 * Defines the ReferencesNode and related types for the References section.
 * A reference points to external documentation, papers, URLs, or internal
 * resources that provide context for the module.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** The type/kind of reference. */
export type ReferenceType =
  | 'documentation'
  | 'paper'
  | 'url'
  | 'api'
  | 'specification'
  | 'tutorial'
  | 'code'
  | 'dataset'
  | string;

/** A single reference entry. */
export interface Reference {
  /** Title of the reference. */
  title: string;
  /** URL or URI to the reference. */
  url?: string;
  /** Human-readable description. */
  description?: string;
  /** Reference type. */
  type?: ReferenceType;
  /** Date the reference was last accessed or published. */
  date?: string;
  /** Author(s) of the reference. */
  authors?: string[];
  /** Tags for categorisation. */
  tags?: string[];
}

/** The References section AST node. */
export interface ReferencesNode {
  /** Discriminant – always `'References'`. */
  type: 'References';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of references. */
  references: Reference[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a ReferencesNode.
 * Returns an empty array when the node is valid.
 */
export function validateReferencesNode(node: ReferencesNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'ReferencesNode must be an object.' });
    return errors;
  }

  if (node.type !== 'References') {
    errors.push({ path: 'type', message: `Expected type "References", got "${node.type}".` });
  }

  if (!Array.isArray(node.references)) {
    errors.push({ path: 'references', message: 'references must be an array.' });
    return errors;
  }

  node.references.forEach((ref, idx) => {
    const base = `references[${idx}]`;

    if (!ref.title || typeof ref.title !== 'string') {
      errors.push({ path: `${base}.title`, message: 'title must be a non-empty string.' });
    }

    if (ref.url !== undefined) {
      if (typeof ref.url !== 'string') {
        errors.push({ path: `${base}.url`, message: 'url must be a string.' });
      } else if (ref.url.length > 0) {
        try {
          new URL(ref.url);
        } catch {
          // Allow relative URLs and non-standard schemes
          if (!ref.url.startsWith('/') && !ref.url.startsWith('./') && !ref.url.startsWith('../')) {
            errors.push({ path: `${base}.url`, message: `url "${ref.url}" is not a valid URL.` });
          }
        }
      }
    }

    if (ref.date !== undefined && typeof ref.date !== 'string') {
      errors.push({ path: `${base}.date`, message: 'date must be a string.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateReferencesNodeOptions {
  references?: Reference[];
  location?: SourceLocation;
}

/** Create a ReferencesNode with sensible defaults. */
export function createReferencesNode(options: CreateReferencesNodeOptions = {}): ReferencesNode {
  return {
    type: 'References',
    references: options.references ?? [],
    location: options.location,
  };
}

/** Create a single Reference. */
export function createReference(
  title: string,
  overrides: Partial<Omit<Reference, 'title'>> = {},
): Reference {
  return { title, ...overrides };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a ReferencesNode. */
export function isReferencesNode(value: unknown): value is ReferencesNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ReferencesNode).type === 'References' &&
    Array.isArray((value as ReferencesNode).references)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all reference titles. */
export function getReferenceTitles(node: ReferencesNode): string[] {
  return node.references.map((r) => r.title);
}

/** Find a reference by title (case-insensitive). */
export function findReferenceByTitle(node: ReferencesNode, title: string): Reference | undefined {
  const lower = title.toLowerCase();
  return node.references.find((r) => r.title.toLowerCase() === lower);
}

/** Find references by type. */
export function findReferencesByType(node: ReferencesNode, type: ReferenceType): Reference[] {
  return node.references.filter((r) => r.type === type);
}

/** Find references by tag. */
export function findReferencesByTag(node: ReferencesNode, tag: string): Reference[] {
  return node.references.filter((r) => r.tags?.includes(tag));
}

/** Return only references with a URL. */
export function getReferencesWithUrl(node: ReferencesNode): Reference[] {
  return node.references.filter((r) => r.url !== undefined && r.url.length > 0);
}

/** Collect all unique tags across references. */
export function getAllReferenceTags(node: ReferencesNode): string[] {
  const tags = new Set<string>();
  for (const ref of node.references) {
    if (ref.tags) {
      for (const tag of ref.tags) {
        tags.add(tag);
      }
    }
  }
  return Array.from(tags);
}

/** Count total references. */
export function countReferences(node: ReferencesNode): number {
  return node.references.length;
}

export function hasReferences(node: ReferencesNode): boolean {
  return node.references.length > 0;
}

export function countReferencesByType(node: ReferencesNode): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ref of node.references) {
    const key = ref.type ?? 'untyped';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function summarizeReferences(node: ReferencesNode): string {
  return `References: ${node.references.length} total, ${getReferencesWithUrl(node).length} with URL, ${getAllReferenceTags(node).length} tags`;
}

export function withReference(node: ReferencesNode, reference: Reference): ReferencesNode {
  return { ...node, references: [...node.references, reference] };
}

export function withoutReference(
  node: ReferencesNode,
  titleOrPredicate: string | ((reference: Reference) => boolean),
): ReferencesNode {
  const predicate =
    typeof titleOrPredicate === 'string'
      ? (reference: Reference) => reference.title.toLowerCase() === titleOrPredicate.toLowerCase()
      : titleOrPredicate;
  return { ...node, references: node.references.filter((reference) => !predicate(reference)) };
}

export function cloneReferencesNode(
  node: ReferencesNode,
  options?: { stripLocation?: boolean },
): ReferencesNode {
  const cloned: ReferencesNode = {
    type: 'References',
    references: node.references.map((reference): Reference => ({
      ...reference,
      ...(reference.authors !== undefined ? { authors: [...reference.authors] } : {}),
      ...(reference.tags !== undefined ? { tags: [...reference.tags] } : {}),
    })),
    location: node.location,
  };
  if (options?.stripLocation) {
    delete cloned.location;
  }
  return cloned;
}

export function mergeReferencesNodes(a: ReferencesNode, b: ReferencesNode): ReferencesNode {
  const references = [...a.references];
  for (const reference of b.references) {
    if (
      !references.some(
        (existing) => existing.title.toLowerCase() === reference.title.toLowerCase(),
      )
    ) {
      references.push(reference);
    }
  }
  return {
    type: 'References',
    references,
    location: a.location ?? b.location,
  };
}
