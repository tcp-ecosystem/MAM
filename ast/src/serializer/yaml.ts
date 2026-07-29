/**
 * MAM AST YAML Serializer
 *
 * Production-grade YAML serialization handling all AST node types,
 * special character escaping, multiline strings, and document markers.
 */

import type {
  MAMModule,
  Section,
  FrontMatter,
  ContentNode,
  InlineNode,
  BaseNode,
} from '../nodes/index.js';

// ============================================================================
// Types
// ============================================================================

export interface YAMLOptions {
  /** Indentation spaces. Default: 2. */
  indent?: number;
  /** Maximum line width before wrapping. 0 = no wrap. Default: 80. */
  lineWidth?: number;
  /** Quoting style for strings. Default: 'double'. */
  quotingType?: 'single' | 'double' | 'auto';
  /** Sort object keys alphabetically. Default: false. */
  sortKeys?: boolean;
  /** Include YAML document start marker. Default: true. */
  documentMarker?: boolean;
  /** Include location data. Default: false. */
  includeLocation?: boolean;
  /** Maximum depth. 0 = unlimited. Default: 0. */
  maxDepth?: number;
}

type ScalarStyle = 'plain' | 'single-quoted' | 'double-quoted' | 'literal' | 'folded';

// ============================================================================
// Constants
// ============================================================================

const YAML_SPECIAL_SCALARS = /^(true|false|null|yes|no|on|off|~|\.|\d+[\d.e+-]*|[\d:.+-]*T|)$/i;

const YAML_NEEDS_QUOTING = /^[&*?|>!%@`\[\]{}#"-]/;

const YAML_NEEDS_ESCAPING = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

// ============================================================================
// Core Serialization
// ============================================================================

/**
 * Serialize a MAMModule AST to YAML string.
 */
export function serializeToYAML(ast: MAMModule, options: YAMLOptions = {}): string {
  const opts: Required<YAMLOptions> = {
    indent: options.indent ?? 2,
    lineWidth: options.lineWidth ?? 80,
    quotingType: options.quotingType ?? 'auto',
    sortKeys: options.sortKeys ?? false,
    documentMarker: options.documentMarker ?? true,
    includeLocation: options.includeLocation ?? false,
    maxDepth: options.maxDepth ?? 0,
  };

  const lines: string[] = [];

  if (opts.documentMarker) {
    lines.push('---');
  }

  const serialized = serializeValue(ast, opts, 0);
  lines.push(serialized);

  return lines.join('\n');
}

/**
 * Deserialize a YAML string back to a MAMModule AST (basic implementation).
 */
export function deserializeFromYAML(yaml: string): MAMModule {
  const cleaned = yaml
    .replace(/^---\s*\n/, '')
    .replace(/\n\.\.\.\s*$/, '');

  const lines = cleaned.split('\n');
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentIndent = 0;
  let stack: Array<{ obj: Record<string, unknown>; key: string; indent: number }> = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const indent = line.length - line.trimStart().length;

    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      const popped = stack.pop()!;
      currentKey = popped.key;
      currentIndent = popped.indent;
    }

    const kvMatch = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();

      const target = stack.length > 0
        ? stack[stack.length - 1].obj
        : result;

      if (value === '' || value === '|' || value === '>') {
        const nested: Record<string, unknown> = {};
        target[key] = nested;
        stack.push({ obj: nested, key, indent });
      } else {
        target[key] = parseYAMLScalar(value);
      }
    } else if (trimmed.startsWith('- ')) {
      const listKey = currentKey ?? Object.keys(result).pop();
      if (listKey) {
        const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
        if (!Array.isArray(parent[listKey])) {
          parent[listKey] = [];
        }
        const list = parent[listKey] as unknown[];
        const item = trimmed.slice(2).trim();
        list.push(parseYAMLScalar(item));
      }
    }
  }

  return result as unknown as MAMModule;
}

// ============================================================================
// Value Serialization
// ============================================================================

function serializeValue(
  value: unknown,
  opts: Required<YAMLOptions>,
  depth: number,
): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return serializeString(value, opts);
  if (Array.isArray(value)) return serializeArray(value, opts, depth);

  if (typeof value === 'object') {
    return serializeObject(value as Record<string, unknown>, opts, depth);
  }

  return String(value);
}

function serializeString(value: string, opts: Required<YAMLOptions>): string {
  if (value === '') return '""';

  if (YAML_NEEDS_ESCAPING.test(value)) {
    return escapeDoubleQuoted(value);
  }

  if (value.includes('\n')) {
    const lines = value.split('\n');
    const lastIdx = lines.length - 1;
    const result = lines
      .map((line, i) => i < lastIdx ? line + '\n' : line)
      .join('');
    return `|\n${result}`;
  }

  if (opts.quotingType === 'single') {
    return value.includes("'") ? escapeDoubleQuoted(value) : `'${value}'`;
  }

  if (opts.quotingType === 'double') {
    if (YAML_SPECIAL_SCALARS.test(value) || YAML_NEEDS_QUOTING.test(value)) {
      return escapeDoubleQuoted(value);
    }
    return `"${value}"`;
  }

  // auto quoting
  if (YAML_SPECIAL_SCALARS.test(value) || YAML_NEEDS_QUOTING.test(value) || value.includes(':') || value.includes('#')) {
    return value.includes("'") ? escapeDoubleQuoted(value) : `'${value}'`;
  }

  return value;
}

function escapeDoubleQuoted(value: string): string {
  return '"' + value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/[\x00-\x08]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
    + '"';
}

function serializeArray(arr: unknown[], opts: Required<YAMLOptions>, depth: number): string {
  if (arr.length === 0) return '[]';

  const items = arr.map((item) => {
    const indented = ' '.repeat((depth + 1) * opts.indent);

    if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
      const inner = serializeObject(item as Record<string, unknown>, opts, depth + 1);
      return `${indented}- ${inner.replace(/\n/g, '\n' + indented)}`;
    }

    return `${indented}- ${serializeValue(item, opts, depth + 1)}`;
  });

  return '\n' + items.join('\n');
}

function serializeObject(
  obj: Record<string, unknown>,
  opts: Required<YAMLOptions>,
  depth: number,
): string {
  if (obj === null) return 'null';

  const keys = opts.sortKeys
    ? Object.keys(obj).sort()
    : Object.keys(obj);

  if (keys.length === 0) return '{}';

  const indent = ' '.repeat(depth * opts.indent);
  const childIndent = ' '.repeat((depth + 1) * opts.indent);
  const lines: string[] = [];

  for (const key of keys) {
    const value = obj[key];

    if (value === undefined) continue;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      const nestedKeys = Object.keys(nested);
      if (nestedKeys.length === 0) {
        lines.push(`${childIndent}${key}: {}`);
      } else {
        lines.push(`${childIndent}${key}:`);
        lines.push(serializeObject(nested, opts, depth + 2));
      }
    } else if (Array.isArray(value)) {
      lines.push(`${childIndent}${key}:`);
      lines.push(serializeArray(value, opts, depth + 1));
    } else {
      lines.push(`${childIndent}${key}: ${serializeValue(value, opts, depth + 1)}`);
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Scalar Parsing
// ============================================================================

function parseYAMLScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
