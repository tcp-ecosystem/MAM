/**
 * Memory Plugin - Content Parser
 *
 * Turns the `Memory` section of a parsed MAM module into flat, addressable
 * state. Values keep their JSON types, nested objects are flattened to dotted
 * paths, and every parse reports what it could not read instead of dropping it
 * silently.
 */

import type { ContentNode } from '@mam/ast';

export type MemoryEntrySource = 'paragraph' | 'codeblock';

export interface MemoryEntry {
  key: string;
  value: unknown;
  source: MemoryEntrySource;
  /** Dotted path when the key came from a nested object. */
  path?: string;
  /** 1-based line number within the paragraph, when known. */
  line?: number;
  /** The original text before coercion, when coercion changed it. */
  raw?: string;
}

export interface MemoryConflict {
  key: string;
  /** Source whose value was kept. Later sources lose to earlier ones. */
  kept: MemoryEntrySource;
  /** Source whose value was discarded. */
  shadowed: MemoryEntrySource;
}

export interface MemoryParseError {
  /** `codeblock` for malformed JSON, `paragraph` for an unparsable line. */
  source: MemoryEntrySource;
  message: string;
  line?: number;
}

export interface ParsedMemory {
  entries: MemoryEntry[];
  flat: Record<string, unknown>;
  keys: string[];
  /** Keys defined more than once, with which definition won. */
  conflicts: MemoryConflict[];
  /** Input that could not be parsed, for diagnostics. */
  errors: MemoryParseError[];
  /** Entries dropped by `maxEntries`. */
  truncated: number;
}

export interface MemoryParseOptions {
  /**
   * Prefix applied to every produced key, e.g. `runtime.` to namespace a
   * module's memory without rewriting each key.
   */
  prefix?: string;
  /**
   * Convert scalar strings to number, boolean or null.
   *
   * Off by default: a value like `007` or a version `1.10` would otherwise
   * change meaning, and bullets are inherently textual.
   */
  coerce?: boolean;
  /**
   * Flatten nested objects to dotted paths such as `db.host`.
   *
   * On by default so a module can address one leaf without reaching through
   * the whole tree.
   */
  flatten?: boolean;
  /** Depth limit for `flatten`; deeper objects stay as-is. Default 8. */
  maxDepth?: number;
  /** Cap on produced entries. Default 1000. */
  maxEntries?: number;
  /**
   * Also read bare `key: value` prose lines.
   *
   * Off by default because it also matches ordinary sentences containing a
   * colon, which would sweep prose into the module's state.
   */
  includeBarePairs?: boolean;
  /** Accept a non-object top-level JSON value instead of ignoring it. */
  allowScalarJson?: boolean;
}

const BOLD_PAIR = /^\*\*(.+?)\*\*:\s*(.+)$/;
const BULLET_PAIR = /^[-*]\s+(.+?)\s*[:=]\s*(.+)$/;
const BARE_PAIR = /^([A-Za-z_][\w.-]*)\s*[:=]\s*(.+)$/;

/** Keys that would let a crafted path walk onto Object.prototype. */
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

const DEFAULTS: Required<MemoryParseOptions> = {
  prefix: '',
  coerce: false,
  flatten: true,
  maxDepth: 8,
  maxEntries: 1000,
  includeBarePairs: false,
  allowScalarJson: false,
};

// ─── Value Parsing ────────────────────────────────────────────────

/**
 * Converts a raw scalar string to a typed value.
 *
 * Only exact matches are converted, so `1.0.0`, `yes` and `007` stay
 * strings; `true`, `42` and `null` do not.
 */
export function parseMemoryValue(raw: unknown, coerce = false): unknown {
  if (typeof raw !== 'string') return raw;
  const text = raw.trim();
  if (!coerce) return text;
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text === 'null') return null;
  // A leading zero means the author wanted a string (a zip code, a padded id).
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text) && !/^-?0\d/.test(text)) {
    const num = Number(text);
    return Number.isFinite(num) ? num : text;
  }
  return text;
}

/** Returns true when `coerce` would change the string. */
export function isCoercible(raw: string): boolean {
  return parseMemoryValue(raw, true) !== raw.trim();
}

// ─── Path Helpers ─────────────────────────────────────────────────

/**
 * Splits a dotted path into segments.
 *
 * Returns an empty array when any segment is empty or unsafe, so a crafted
 * path like `__proto__.polluted` is rejected outright rather than silently
 * rewritten to a harmless-looking but wrong key.
 */
export function splitPath(path: string): string[] {
  const segments = path.split('.');
  if (segments.some((segment) => segment.length === 0 || UNSAFE_SEGMENTS.has(segment))) return [];
  return segments;
}

/** Reads a dotted path, returning undefined when any segment is missing. */
export function getPath(data: Record<string, unknown>, path: string): unknown {
  const segments = splitPath(path);
  if (segments.length === 0) return undefined;

  let current: unknown = data;
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Writes a dotted path, creating intermediate objects.
 *
 * Returns false when the path is empty or unsafe rather than writing to
 * `__proto__`.
 */
export function setPath(
  data: Record<string, unknown>,
  path: string,
  value: unknown,
): boolean {
  const segments = splitPath(path);
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
export function deletePath(data: Record<string, unknown>, path: string): boolean {
  const segments = splitPath(path);
  if (segments.length === 0) return false;

  const parents = getPath(data, segments.slice(0, -1).join('.'));
  if (typeof parents !== 'object' || parents === null || Array.isArray(parents)) return false;

  const last = segments[segments.length - 1]!;
  if (!(last in (parents as Record<string, unknown>))) return false;
  delete (parents as Record<string, unknown>)[last];
  return true;
}

// ─── Flatten / Unflatten ──────────────────────────────────────────

/**
 * Flattens nested objects into dotted keys.
 *
 * Arrays and `null` are treated as leaves rather than walked, so a list of
 * records stays one addressable value instead of expanding into
 * `items.0.name` paths.
 */
export function flattenMemory(
  data: Record<string, unknown>,
  options: { maxDepth?: number; prefix?: string } = {},
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? DEFAULTS.maxDepth;
  const result: Record<string, unknown> = {};

  const walk = (node: unknown, prefix: string, depth: number): void => {
    if (
      depth >= maxDepth ||
      typeof node !== 'object' ||
      node === null ||
      Array.isArray(node)
    ) {
      if (prefix) result[prefix] = node;
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      if (UNSAFE_SEGMENTS.has(key)) continue;
      walk(value, prefix ? `${prefix}.${key}` : key, depth + 1);
    }
  };

  walk(data, options.prefix ?? '', 0);
  return result;
}

/** Rebuilds a nested object from dotted keys, the inverse of `flattenMemory`. */
export function unflattenMemory(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (splitPath(key).length === 0) continue;
    setPath(result, key, value);
  }
  return result;
}

// ─── Core Parsing ─────────────────────────────────────────────────

/**
 * Extracts memory entries from a section's content nodes.
 *
 * Paragraph bullets are read first and code blocks second, so an explicit
 * JSON block wins over a prose bullet for the same key; the shadowed
 * definition is reported in `conflicts` rather than overwritten quietly.
 */
export function parseMemoryContent(
  content: ContentNode[],
  options: MemoryParseOptions = {},
): ParsedMemory {
  const opts = { ...DEFAULTS, ...options };
  const entries: MemoryEntry[] = [];
  const flat: Record<string, unknown> = {};
  const conflicts: MemoryConflict[] = [];
  const errors: MemoryParseError[] = [];
  const sourceOf = new Map<string, MemoryEntrySource>();
  let truncated = 0;

  const addEntry = (key: string, value: unknown, source: MemoryEntrySource, line?: number, raw?: string): void => {
    if (entries.length >= opts.maxEntries) {
      truncated++;
      return;
    }
    const trimmed = key.trim();
    if (!trimmed) return;

    const fullKey = opts.prefix ? `${opts.prefix}${trimmed}` : trimmed;
    const previous = sourceOf.get(fullKey);
    if (previous) {
      conflicts.push({ key: fullKey, kept: previous, shadowed: source });
      return;
    }
    sourceOf.set(fullKey, source);

    const entry: MemoryEntry = { key: fullKey, value, source };
    if (line !== undefined) entry.line = line;
    if (raw !== undefined && raw !== String(value)) entry.raw = raw;
    entries.push(entry);
    flat[fullKey] = value;
  };

  for (const node of content) {
    const n = node as { type?: string; value?: string; language?: string };

    if (n.type === 'Paragraph') {
      const lines = (n.value || '').split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const match = line.match(BOLD_PAIR) ?? line.match(BULLET_PAIR)
          ?? (opts.includeBarePairs ? line.match(BARE_PAIR) : null);
        if (!match) continue;
        const raw = match[2]!.trim();
        addEntry(match[1]!, parseMemoryValue(raw, opts.coerce), 'paragraph', i + 1, raw);
      }
      continue;
    }

    if (n.type === 'CodeBlock') {
      if (n.language !== 'json') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(n.value || '');
      } catch (error) {
        errors.push({ source: 'codeblock', message: (error as Error).message });
        continue;
      }

      if (opts.allowScalarJson && (typeof parsed !== 'object' || parsed === null)) {
        addEntry(opts.prefix ? opts.prefix.slice(0, -1) || 'value' : 'value', parsed, 'codeblock');
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        if (parsed !== null) {
          errors.push({ source: 'codeblock', message: 'Top-level JSON must be an object' });
        }
        continue;
      }

      const record = parsed as Record<string, unknown>;

      // Checked before flattening: flattenMemory drops unsafe segments, so
      // looking afterwards would never see them and the drop would be silent.
      for (const key of Object.keys(record)) {
        if (UNSAFE_SEGMENTS.has(key)) {
          errors.push({ source: 'codeblock', message: `Skipped unsafe key "${key}"` });
        }
      }

      const source = opts.flatten
        ? flattenMemory(record, { maxDepth: opts.maxDepth })
        : record;

      for (const [key, value] of Object.entries(source)) {
        addEntry(key, value, 'codeblock');
      }
    }
  }

  return { entries, flat, keys: Object.keys(flat), conflicts, errors, truncated };
}

// ─── Merging ──────────────────────────────────────────────────────

/** Shallow merge; incoming keys win. */
export function mergeMemory(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...incoming };
}

/**
 * Deep merge; incoming keys win at every level.
 *
 * Prefers the shallow merge for flat key sets, which is the common case here.
 */
export function deepMerge(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (UNSAFE_SEGMENTS.has(key)) continue;
    const current = result[key];
    if (
      typeof value === 'object' && value !== null && !Array.isArray(value) &&
      typeof current === 'object' && current !== null && !Array.isArray(current)
    ) {
      result[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface MemoryDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/** Compares two flat memory records by key. */
export function diffMemory(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): MemoryDiff {
  const diff: MemoryDiff = { added: [], removed: [], changed: [], unchanged: [] };
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);

  for (const key of afterKeys) {
    if (!(key in before)) {
      diff.added.push(key);
    } else if (Object.is(before[key], after[key])) {
      diff.unchanged.push(key);
    } else {
      diff.changed.push(key);
    }
  }
  for (const key of beforeKeys) {
    if (!(key in after)) diff.removed.push(key);
  }
  return diff;
}

// ─── Projections ──────────────────────────────────────────────────

/** Returns only the requested keys, omitting the ones that are absent. */
export function pickMemory(
  data: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in data) result[key] = data[key];
  }
  return result;
}

/** Groups keys by their leading segment, e.g. `db.host` joins `db`. */
export function groupByPrefix(
  data: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(data)) {
    const dot = key.indexOf('.');
    const group = dot === -1 ? '_root' : key.slice(0, dot);
    (result[group] ??= {})[dot === -1 ? key : key.slice(dot + 1)] = value;
  }
  return result;
}

/** Removes a prefix from each key, dropping keys that do not carry it. */
export function filterMemoryByPrefix(
  data: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(prefix)) {
      result[key.slice(prefix.length)] = value;
    }
  }
  return result;
}

/** The inverse of `filterMemoryByPrefix`: puts a prefix back on every key. */
export function namespaceMemory(
  data: Record<string, unknown>,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[`${prefix}${key}`] = value;
  }
  return result;
}

export interface FormatMemoryOptions {
  /** Prefix each key with `- `. Off produces a plain `key: value` list. */
  bullets?: boolean;
  /** Indent string for bullets. Default `- `. */
  bullet?: string;
  /** Append a JSON code block holding values that are not strings. */
  includeJsonBlock?: boolean;
}

/**
 * Renders flat memory back into `Memory` section text.
 *
 * Strings become bullets and everything else goes into a JSON block, because
 * `**port**: 5432` would come back as the string `"5432"`.
 */
export function formatMemory(
  data: Record<string, unknown>,
  options: FormatMemoryOptions = {},
): string {
  const lines: string[] = [];
  const structured: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      lines.push(options.bullets ? `${options.bullet ?? '- '}${key}: ${value}` : `${key}: ${value}`);
    } else {
      structured[key] = value;
    }
  }

  if (options.includeJsonBlock && Object.keys(structured).length > 0) {
    lines.push('', '```json', JSON.stringify(structured, null, 2), '```');
  } else if (!options.includeJsonBlock) {
    for (const [key, value] of Object.entries(structured)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  return lines.join('\n');
}
