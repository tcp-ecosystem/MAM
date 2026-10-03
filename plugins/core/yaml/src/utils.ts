/**
 * YAML Plugin - Utility Functions
 *
 * Flattening, merging, diffing and path access for parsed YAML records.
 */

import { parseYAML, stringifyYAML, type YAMLParseResult } from './parser.js';

/** Keys that would let a crafted path walk onto Object.prototype. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Flattens nested objects into dotted keys.
 *
 * Arrays are treated as leaves so a list of records stays one addressable
 * value rather than expanding into `items.0.name` paths.
 */
export function flattenYAML(
  data: Record<string, unknown>,
  prefix = '',
  options: { maxDepth?: number } = {},
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;

  // A depth of zero means "do not descend", so the record is returned as-is.
  // Without this the walk would reach the root, find no key prefix to store
  // the node under, and return an empty object.
  if (maxDepth <= 0) {
    return prefix ? { [prefix]: data } : { ...data };
  }

  const result: Record<string, unknown> = {};

  const walk = (node: unknown, keyPrefix: string, depth: number): void => {
    if (
      depth >= maxDepth ||
      typeof node !== 'object' || node === null || Array.isArray(node)
    ) {
      if (keyPrefix) result[keyPrefix] = node;
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (UNSAFE_SEGMENTS.has(key)) continue;
      walk(value, keyPrefix ? `${keyPrefix}.${key}` : key, depth + 1);
    }
  };

  walk(data ?? {}, prefix, 0);
  return result;
}

/** Splits a dotted path, rejecting empty and prototype-polluting segments. */
export function splitYAMLPath(path: string): string[] {
  const segments = path.split('.');
  if (segments.some((segment) => segment.length === 0 || UNSAFE_SEGMENTS.has(segment))) return [];
  return segments;
}

/**
 * Rebuilds a nested object from dotted keys.
 *
 * Rejects a path rather than rewriting it: filtering the unsafe segment out of
 * `__proto__.x` would silently write a different, legitimate-looking key.
 */
export function unflattenYAML(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    setYAMLPath(result, key, value);
  }
  return result;
}

/** Reads a dotted path, returning undefined when any segment is missing. */
export function getYAMLPath(data: Record<string, unknown>, path: string): unknown {
  const segments = splitYAMLPath(path);
  if (segments.length === 0) return undefined;

  let current: unknown = data;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Writes a dotted path, creating intermediate objects. Returns false if unsafe. */
export function setYAMLPath(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): boolean {
  const segments = splitYAMLPath(path);
  if (segments.length === 0) return false;

  let current: Record<string, unknown> = data;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]!;
    const next = current[segment];
    if (typeof next !== 'object' || next === null || Array.isArray(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[segments[segments.length - 1]!] = value;
  return true;
}

/** Removes a dotted path, returning whether it was present. */
export function deleteYAMLPath(data: Record<string, unknown>, path: string): boolean {
  const segments = splitYAMLPath(path);
  if (segments.length === 0) return false;

  const parents = getYAMLPath(data, segments.slice(0, -1).join('.'));
  if (typeof parents !== 'object' || parents === null || Array.isArray(parents)) return false;

  const last = segments[segments.length - 1]!;
  if (!(last in (parents as Record<string, unknown>))) return false;
  delete (parents as Record<string, unknown>)[last];
  return true;
}

/** Returns true when a dotted path resolves to something. */
export function hasYAMLPath(data: Record<string, unknown>, path: string): boolean {
  return getYAMLPath(data, path) !== undefined;
}

/**
 * Deep merge; `override` wins at every level.
 *
 * Returns new objects rather than mutating either input, so a caller's
 * defaults stay intact.
 */
export function mergeYAMLObjects(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (UNSAFE_SEGMENTS.has(key)) continue;
    const current = result[key];
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof current === 'object' && current !== null && !Array.isArray(current)
    ) {
      result[key] = mergeYAMLObjects(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Deep merge that drops keys whose value is `null`, for layering overrides. */
export function mergeYAMLDefaults(
  defaults: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...(defaults ?? {}) };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === null) continue;
    const current = result[key];
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof current === 'object' && current !== null && !Array.isArray(current)
    ) {
      result[key] = mergeYAMLDefaults(
        current as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Returns only the requested paths, omitting the ones that are absent. */
export function pickYAML(
  data: Record<string, unknown>,
  paths: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getYAMLPath(data, path);
    if (value !== undefined) setYAMLPath(result, path, value);
  }
  return result;
}

/** Returns the top-level keys present in `data`. */
export function yamlKeys(data: Record<string, unknown>): string[] {
  return Object.keys(data ?? {}).sort();
}

/** Counts nodes, leaves and depth in a record. */
export interface YAMLShape {
  nodes: number;
  leaves: number;
  maxDepth: number;
  arrays: number;
}

export function describeYAMLShape(data: Record<string, unknown>): YAMLShape {
  const shape: YAMLShape = { nodes: 0, leaves: 0, maxDepth: 0, arrays: 0 };
  const walk = (node: unknown, depth: number): void => {
    shape.nodes++;
    shape.maxDepth = Math.max(shape.maxDepth, depth);
    if (Array.isArray(node)) {
      shape.arrays++;
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const value of Object.values(node)) walk(value, depth + 1);
      return;
    }
    shape.leaves++;
  };
  walk(data ?? {}, 0);
  return shape;
}

/** Converts YAML source to pretty JSON. */
export function YAMLToJSON(yamlText: string): string {
  // Previously a second, even simpler line scanner ran here, which silently
  // dropped every nested map and turned numbers into strings. It now goes
  // through the real parser so both entry points agree.
  const { data } = parseYAML(yamlText);
  return JSON.stringify(data, null, 2);
}

/** Converts YAML source to JSON, including any parse errors. */
export function yamlToJSONResult(yamlText: string): YAMLParseResult & { json: string } {
  const parsed = parseYAML(yamlText);
  return { ...parsed, json: JSON.stringify(parsed.data, null, 2) };
}

/** Parses JSON and serialises it as YAML. */
export function jsonToYAML(jsonText: string): string {
  const data = JSON.parse(jsonText) as Record<string, unknown>;
  return stringifyYAML(data);
}

export interface YAMLDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/** Compares two records by dotted path. */
export function diffYAMLObjects(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): YAMLDiff {
  const flatA = flattenYAML(a);
  const flatB = flattenYAML(b);
  const diff: YAMLDiff = { added: [], removed: [], changed: [], unchanged: [] };

  for (const key of Object.keys(flatB)) {
    if (!(key in flatA)) {
      diff.added.push(key);
    } else if (!Object.is(flatA[key], flatB[key])) {
      diff.changed.push(key);
    } else {
      diff.unchanged.push(key);
    }
  }
  for (const key of Object.keys(flatA)) {
    if (!(key in flatB)) diff.removed.push(key);
  }
  for (const list of [diff.added, diff.removed, diff.changed, diff.unchanged]) list.sort();
  return diff;
}

/** Returns true when two records are structurally identical. */
export function yamlEquals(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const flatA = flattenYAML(a);
  const flatB = flattenYAML(b);
  const keys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);
  for (const key of keys) {
    if (!Object.is(flatA[key], flatB[key])) return false;
  }
  return true;
}

/** Sorts a record's keys recursively, for stable output. */
export function sortYAMLKeys(data: Record<string, unknown>): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (typeof node === 'object' && node !== null) {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        result[key] = walk((node as Record<string, unknown>)[key]);
      }
      return result;
    }
    return node;
  };
  return walk(data ?? {}) as Record<string, unknown>;
}
