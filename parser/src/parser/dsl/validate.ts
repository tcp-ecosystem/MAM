/**
 * MAM DSL Semantic Validation
 *
 * Validators for the normalized `DSLModule` model produced by `model.ts`.
 * All validators are pure functions that return `ParseError` (or `DSLError`)
 * instances without mutating their inputs.
 */

import { ParseError, ParseWarning, ParseWarningCode } from '../errors.js';
import { createDSLError, DSLErrorCode } from './errors.js';
import { DSLModule, DSLEdgeModel } from './model.js';
import { DSLToken } from './tokens.js';
import { DSLTokenType } from './types.js';
import { isModuleType, V2_SECTION_KEYWORDS } from '@mam/ast';

// ============================================================================
// Validation Result
// ============================================================================

/**
 * Result of running one or more DSL validation passes.
 */
export interface DSLValidationResult {
  /** `true` when no errors were produced. */
  valid: boolean;
  /** Errors produced during validation. */
  errors: ParseError[];
  /** Warnings produced during validation. */
  warnings: ParseWarning[];
}

// ============================================================================
// Module Validation
// ============================================================================

/**
 * Validates a normalized `DSLModule` and returns all errors found.
 *
 * Checks the module name and type, validates every scalar section key against
 * the known v2 section keywords, and validates every edge against the set of
 * known node names (derived from the module name and all list items).
 *
 * @param module - Module model to validate.
 * @returns A list of `ParseError` (specifically `DSLError`) instances.
 */
export function validateModule(module: DSLModule): ParseError[] {
  const errors: ParseError[] = [];

  const name = module.name.trim();
  if (name.length === 0) {
    errors.push(createDSLError(DSLErrorCode.MISSING_NAME, 'Module is missing a name.'));
  }

  const typeError = validateType(module.type);
  if (typeError) errors.push(typeError);

  const knownNodes = new Set<string>([name]);
  for (const items of Object.values(module.lists)) {
    for (const item of items) {
      const trimmed = item.trim();
      if (trimmed.length > 0) knownNodes.add(trimmed);
    }
  }

  for (const key of Object.keys(module.sections)) {
    if (!validateSectionKey(key, V2_SECTION_KEYWORDS)) {
      errors.push(
        createDSLError(
          DSLErrorCode.UNKNOWN_SECTION_KEY,
          `Unknown section key: "${key}".`,
          '<dsl>'
        )
      );
    }
  }

  for (const edge of module.edges) {
    const edgeError = validateEdge(edge, knownNodes);
    if (edgeError) errors.push(edgeError);
  }

  return errors;
}

/**
 * Runs `validateModule` and packages the result (plus warnings) into a
 * `DSLValidationResult`.
 *
 * @param module - Module model to validate.
 * @returns A validation result with `valid`, `errors`, and `warnings`.
 */
export function validateModuleWithResult(module: DSLModule): DSLValidationResult {
  const errors = validateModule(module);
  const warnings: ParseWarning[] = [];

  const hasContent =
    Object.keys(module.sections).length > 0 ||
    Object.keys(module.lists).length > 0 ||
    module.edges.length > 0;
  if (!hasContent) {
    warnings.push(
      new ParseWarning(
        'Module has no content (no sections, lists, or edges).',
        '<dsl>',
        0,
        0,
        ParseWarningCode.EMPTY_SECTION
      )
    );
  }

  return toValidationResult(errors, warnings);
}

/**
 * Packages a set of errors and warnings into a `DSLValidationResult`.
 *
 * @param errors - Errors to include.
 * @param warnings - Warnings to include (defaults to an empty list).
 * @returns A validation result.
 */
export function toValidationResult(
  errors: ParseError[],
  warnings: ParseWarning[] = []
): DSLValidationResult {
  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Section Key Validation
// ============================================================================

/**
 * Returns `true` when the given key is present in the known keys collection.
 *
 * The key is compared case-insensitively after trimming.
 *
 * @param key - Section key to check.
 * @param knownKeys - Known keys as a `Set` or array.
 * @returns `true` when the key is known.
 */
export function validateSectionKey(
  key: string,
  knownKeys: ReadonlySet<string> | readonly string[]
): boolean {
  const normalized = key.trim().toLowerCase();
  return Array.from(knownKeys).includes(normalized);
}

// ============================================================================
// Type Validation
// ============================================================================

/**
 * Validates a module type declaration.
 *
 * A missing/empty type produces a `MISSING_TYPE` error; an unrecognized type
 * produces an `UNKNOWN_TYPE` error.
 *
 * @param type - Module type to validate (may be `undefined`).
 * @returns A `DSLError` when invalid, otherwise `null`.
 */
export function validateType(type: string | undefined): ParseError | null {
  if (!type || type.trim().length === 0) {
    return createDSLError(DSLErrorCode.MISSING_TYPE, 'Module is missing a required type declaration.');
  }
  const normalized = type.trim().toLowerCase();
  if (!isModuleType(normalized)) {
    return createDSLError(DSLErrorCode.UNKNOWN_TYPE, `Unknown module type: "${type}".`);
  }
  return null;
}

// ============================================================================
// Edge Validation
// ============================================================================

/**
 * Validates a single edge model.
 *
 * An edge must have non-empty `from` and `to` nodes. When `knownNodes` is
 * provided, both endpoints must be present in the set.
 *
 * @param edge - Edge to validate.
 * @param knownNodes - Optional set (or array) of known node names.
 * @returns A `DSLError` when invalid, otherwise `null`.
 */
export function validateEdge(
  edge: DSLEdgeModel,
  knownNodes?: ReadonlySet<string> | readonly string[]
): ParseError | null {
  const from = edge.from.trim();
  const to = edge.to.trim();

  if (from.length === 0 || to.length === 0) {
    return createDSLError(
      DSLErrorCode.INVALID_EDGE,
      `Edge is missing a source or target node (from: "${edge.from}", to: "${edge.to}").`
    );
  }

  if (knownNodes) {
    const known = knownNodes instanceof Set ? knownNodes : new Set(knownNodes);
    const unknown: string[] = [];
    if (!known.has(from)) unknown.push(from);
    if (!known.has(to)) unknown.push(to);
    if (unknown.length > 0) {
      return createDSLError(
        DSLErrorCode.INVALID_EDGE,
        `Edge references unknown node(s): ${unknown.join(', ')}.`
      );
    }
  }

  return null;
}

// ============================================================================
// Block Structure Validation
// ============================================================================

/**
 * Validates that `BLOCK_START` and `BLOCK_END` tokens are properly balanced.
 *
 * @param nodes - Token stream (or any node array with `BLOCK_START`/`BLOCK_END`
 *   entries) to validate.
 * @returns Errors for unclosed or stray block delimiters.
 */
export function validateBlockStructure(nodes: readonly DSLToken[]): ParseError[] {
  const errors: ParseError[] = [];
  const stack: DSLToken[] = [];

  for (const node of nodes) {
    if (node.type === DSLTokenType.BLOCK_START) {
      stack.push(node);
    } else if (node.type === DSLTokenType.BLOCK_END) {
      if (stack.length === 0) {
        errors.push(
          createDSLError(
            DSLErrorCode.UNTERMINATED_BLOCK,
            'Unexpected block end without a matching block start.',
            '<dsl>',
            node.line,
            node.column
          )
        );
      } else {
        stack.pop();
      }
    }
  }

  for (const open of stack) {
    errors.push(
      createDSLError(
        DSLErrorCode.UNTERMINATED_BLOCK,
        'Block was opened but never closed before end of input.',
        '<dsl>',
        open.line,
        open.column
      )
    );
  }

  return errors;
}