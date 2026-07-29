/**
 * MAM Exports Section Node
 *
 * Defines the ExportsNode and related types for the Exports section.
 * Each export item describes a symbol, value, or resource that the module
 * makes available to consumers.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** The kind of exported item. */
export type ExportType =
  | 'function'
  | 'class'
  | 'constant'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'module'
  | 'resource'
  | string;

/** A single exported item. */
export interface ExportItem {
  /** Name of the exported symbol. */
  name: string;
  /** Type/kind of the export. */
  type?: ExportType;
  /** Alias under which consumers should import the symbol. */
  alias?: string;
  /** Human-readable description. */
  description?: string;
  /** Default value (for constants/variables). */
  defaultValue?: string;
  /** Whether the export is re-exported from a dependency. */
  reexport?: boolean;
  /** Original source module (for re-exports). */
  from?: string;
}

/** The Exports section AST node. */
export interface ExportsNode {
  /** Discriminant – always `'Exports'`. */
  type: 'Exports';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of exported items. */
  items: ExportItem[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate an ExportsNode.
 * Returns an empty array when the node is valid.
 */
export function validateExportsNode(node: ExportsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'ExportsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Exports') {
    errors.push({ path: 'type', message: `Expected type "Exports", got "${node.type}".` });
  }

  if (!Array.isArray(node.items)) {
    errors.push({ path: 'items', message: 'items must be an array.' });
    return errors;
  }

  const seen = new Set<string>();
  node.items.forEach((item, idx) => {
    const base = `items[${idx}]`;

    if (!item.name || typeof item.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'Export name must be a non-empty string.' });
    } else if (seen.has(item.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate export "${item.name}".` });
    } else {
      seen.add(item.name);
    }

    if (item.reexport && !item.from) {
      errors.push({ path: `${base}.from`, message: 'Re-exports must specify a "from" source.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreateExportsNodeOptions {
  items?: ExportItem[];
  location?: SourceLocation;
}

/** Create an ExportsNode with sensible defaults. */
export function createExportsNode(options: CreateExportsNodeOptions = {}): ExportsNode {
  return {
    type: 'Exports',
    items: options.items ?? [],
    location: options.location,
  };
}

/** Create a single ExportItem. */
export function createExportItem(
  name: string,
  overrides: Partial<Omit<ExportItem, 'name'>> = {},
): ExportItem {
  return {
    name,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is an ExportsNode. */
export function isExportsNode(value: unknown): value is ExportsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as ExportsNode).type === 'Exports' &&
    Array.isArray((value as ExportsNode).items)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all export names. */
export function getExportNames(node: ExportsNode): string[] {
  return node.items.map((i) => i.name);
}

/** Find an export by name. */
export function findExportByName(node: ExportsNode, name: string): ExportItem | undefined {
  return node.items.find((i) => i.name === name);
}

/** Find an export by alias. */
export function findExportByAlias(node: ExportsNode, alias: string): ExportItem | undefined {
  return node.items.find((i) => i.alias === alias);
}

/** Filter exports by type. */
export function getExportsByType(node: ExportsNode, type: ExportType): ExportItem[] {
  return node.items.filter((i) => i.type === type);
}

/** Return only re-exported items. */
export function getReExports(node: ExportsNode): ExportItem[] {
  return node.items.filter((i) => i.reexport === true);
}

/** Return only local (non-re-exported) items. */
export function getLocalExports(node: ExportsNode): ExportItem[] {
  return node.items.filter((i) => i.reexport !== true);
}

/** Check whether a specific name is exported. */
export function hasExport(node: ExportsNode, name: string): boolean {
  return node.items.some((i) => i.name === name);
}

/** Count total exports. */
export function countExports(node: ExportsNode): number {
  return node.items.length;
}
