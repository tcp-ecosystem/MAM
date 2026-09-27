/**
 * MAM Imports Section Node
 *
 * Defines the ImportsNode and related types for the Imports section.
 * Each import item describes an external symbol, module, or resource that the
 * current module brings into scope.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Selective import kind. */
export type SelectiveImportKind =
  | 'named'
  | 'default'
  | 'namespace'
  | 'side-effect';

/** A single import item. */
export interface ImportItem {
  /** Name of the symbol or module to import. */
  name: string;
  /** Source module/path. */
  source: string;
  /** Local alias for the imported symbol. */
  alias?: string;
  /** Version constraint. */
  version?: string;
  /** Whether this is a selective import (e.g. `import { foo }`). */
  selective?: SelectiveImportKind;
  /** Import path qualifier (e.g. `"from"` clause). */
  qualifier?: string;
  /** Whether the import is optional. */
  optional?: boolean;
}

/** The Imports section AST node. */
export interface ImportsNode {
  /** Discriminant – always `'Imports'`. */
  type: 'Imports';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of import items. */
  items: ImportItem[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an ImportsNode.
 * Returns an empty array when the node is valid.
 */
export function validateImportsNode(node: ImportsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'ImportsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Imports') {
    errors.push({ path: 'type', message: `Expected type "Imports", got "${node.type}".` });
  }

  if (!Array.isArray(node.items)) {
    errors.push({ path: 'items', message: 'items must be an array.' });
    return errors;
  }

  node.items.forEach((item, idx) => {
    const base = `items[${idx}]`;

    if (!item.name || typeof item.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'Import name must be a non-empty string.' });
    }

    if (!item.source || typeof item.source !== 'string') {
      errors.push({ path: `${base}.source`, message: 'Import source must be a non-empty string.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateImportsNodeOptions {
  items?: ImportItem[];
  location?: SourceLocation;
}

/** Create an ImportsNode with sensible defaults. */
export function createImportsNode(options: CreateImportsNodeOptions = {}): ImportsNode {
  return {
    type: 'Imports',
    items: options.items ?? [],
    location: options.location,
  };
}

/** Create a single ImportItem. */
export function createImportItem(
  name: string,
  source: string,
  overrides: Partial<Omit<ImportItem, 'name' | 'source'>> = {},
): ImportItem {
  return {
    name,
    source,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is an ImportsNode. */
export function isImportsNode(value: unknown): value is ImportsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ImportsNode).type === 'Imports' &&
    Array.isArray((value as ImportsNode).items)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all import names. */
export function getImportNames(node: ImportsNode): string[] {
  return node.items.map((i) => i.name);
}

/** Find an import by name. */
export function findImportByName(node: ImportsNode, name: string): ImportItem | undefined {
  return node.items.find((i) => i.name === name);
}

/** Find imports from a specific source module. */
export function findImportsBySource(node: ImportsNode, source: string): ImportItem[] {
  return node.items.filter((i) => i.source === source);
}

/** Find imports by alias. */
export function findImportByAlias(node: ImportsNode, alias: string): ImportItem | undefined {
  return node.items.find((i) => i.alias === alias);
}

/** Return only optional imports. */
export function getOptionalImports(node: ImportsNode): ImportItem[] {
  return node.items.filter((i) => i.optional === true);
}

/** Return only required imports. */
export function getRequiredImports(node: ImportsNode): ImportItem[] {
  return node.items.filter((i) => i.optional !== true);
}

/** Collect all unique source modules. */
export function getSourceModules(node: ImportsNode): string[] {
  const sources = new Set<string>();
  for (const item of node.items) {
    sources.add(item.source);
  }
  return Array.from(sources);
}

/** Check whether a specific name is imported. */
export function hasImport(node: ImportsNode, name: string): boolean {
  return node.items.some((i) => i.name === name);
}

/** Count total imports. */
export function countImports(node: ImportsNode): number {
  return node.items.length;
}

export function hasImports(node: ImportsNode): boolean {
  return node.items.length > 0;
}

export function countImportsBySource(node: ImportsNode, source: string): number {
  return node.items.filter((item) => item.source === source).length;
}

export function summarizeImports(node: ImportsNode): string {
  const parts = node.items.map((item) => `${item.name} from "${item.source}"`);
  if (parts.length === 0) {
    return '0 imports';
  }
  return `${parts.length} imports: ${parts.join(', ')}`;
}

export function withImport(node: ImportsNode, item: ImportItem): ImportsNode {
  return {
    ...node,
    items: [...node.items, item],
  };
}

export function withoutImport(
  node: ImportsNode,
  match: string | ((item: ImportItem) => boolean),
): ImportsNode {
  const remove =
    typeof match === 'string'
      ? (item: ImportItem) => item.name === match
      : match;
  return {
    ...node,
    items: node.items.filter((item) => !remove(item)),
  };
}

export function cloneImportsNode(
  node: ImportsNode,
  options: { stripLocation?: boolean } = {},
): ImportsNode {
  const copy: ImportsNode = {
    ...node,
    items: node.items.map((item) => ({ ...item })),
  };
  if (options.stripLocation) {
    delete copy.location;
  } else if (copy.location) {
    copy.location = {
      source: copy.location.source,
      start: { ...copy.location.start },
      end: { ...copy.location.end },
    };
  }
  return copy;
}

export function mergeImportsNodes(a: ImportsNode, b: ImportsNode): ImportsNode {
  return {
    ...a,
    items: [...a.items, ...b.items],
  };
}
