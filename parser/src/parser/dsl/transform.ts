/**
 * MAM DSL Transform Helpers
 *
 * Utility functions for normalizing and transforming raw parsed DSL data into
 * cleaner shapes: module names, section values, id conversion, maps, section
 * merging, and list coercion.
 */

// ============================================================================
// Name Normalization
// ============================================================================

/**
 * Normalizes a module name by trimming surrounding whitespace and collapsing
 * runs of internal whitespace into a single space.
 *
 * @param name - Raw module name.
 * @returns A cleaned module name, or `unnamed` when the input is empty.
 */
export function normalizeModuleName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : 'unnamed';
}

/**
 * Converts a module name into a URL-safe, snake_case id.
 *
 * @param name - Raw module name.
 * @returns A lower-cased id using underscores for separators, or `unnamed`
 *   when the input contains no usable characters.
 */
export function moduleNameToId(name: string): string {
  const normalized = normalizeModuleName(name).toLowerCase();
  const id = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return id.length > 0 ? id : 'unnamed';
}

// ============================================================================
// Section Value Normalization
// ============================================================================

/**
 * Section keys whose values are treated as case-insensitive enumerations.
 */
const ENUM_LIKE_SECTION_KEYS = new Set(['type', 'format', 'backend', 'scope', 'ttl']);

/**
 * Normalizes a section value for a given section key.
 *
 * Trims whitespace, collapses internal whitespace, strips matching surrounding
 * quotes, and lower-cases values for known enum-like keys (e.g. `type`).
 *
 * @param key - Section key used to decide value normalization rules.
 * @param value - Raw section value.
 * @returns The normalized section value.
 */
export function normalizeSectionValue(key: string, value: string): string {
  let normalized = value.trim().replace(/\s+/g, ' ');
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  if (ENUM_LIKE_SECTION_KEYS.has(key.trim().toLowerCase())) {
    return normalized.toLowerCase();
  }
  return normalized;
}

// ============================================================================
// Section Map Helpers
// ============================================================================

/**
 * A single key/value entry for building a section map.
 */
export interface DSLEntry {
  /** Section key. */
  key: string;
  /** Section value. */
  value: string;
}

/**
 * Converts a list of key/value entries into a `Map` keyed by the lower-cased,
 * trimmed key.
 *
 * @param entries - Key/value entries to convert.
 * @returns A `Map` of lower-cased section keys to trimmed values.
 */
export function sectionValuesToMap(entries: ReadonlyArray<DSLEntry>): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const key = entry.key.trim().toLowerCase();
    if (key.length === 0) continue;
    map.set(key, entry.value.trim());
  }
  return map;
}

/**
 * Merges two section records, with `extra` values taking precedence over
 * `base`. Does not mutate either input.
 *
 * @param base - Base section record.
 * @param extra - Section record to overlay.
 * @returns A new merged section record.
 */
export function mergeSections(
  base: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>>
): Record<string, string> {
  return { ...base, ...extra };
}

// ============================================================================
// List Coercion
// ============================================================================

/**
 * Coerces an unknown value into a list of strings.
 *
 * Arrays are flattened recursively; strings are split on newlines and commas
 * (stripping leading `-`/`*` bullets); numbers and booleans become a single
 * string entry; `null`/`undefined` and other values produce an empty list.
 *
 * @param value - Value to coerce.
 * @returns A non-empty-free list of strings.
 */
export function coerceList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap(item => coerceList(item));
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map(part => part.replace(/^[-*]\s*/, '').trim())
      .filter(part => part.length > 0);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  return [];
}