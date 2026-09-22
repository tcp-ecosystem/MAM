/**
 * Minimal TOML parser for MAM project manifests (`mam.toml`).
 *
 * Supports the subset used by MAM projects and common TOML constructs:
 * comments, bare/quoted/dotted keys, basic and literal strings
 * (single-line and multi-line), integers, floats, booleans, arrays
 * (including multi-line), inline tables, tables and arrays of tables.
 */

export type TomlPrimitive = string | number | boolean;
export type TomlValue = TomlPrimitive | TomlValue[] | { [key: string]: TomlValue };
export type TomlTable = { [key: string]: TomlValue };

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseToml(input: string): TomlTable {
  const root: TomlTable = {};
  let current: TomlTable = root;

  const statements = splitStatements(input);
  for (const raw of statements) {
    const statement = raw.trim();
    if (!statement) continue;

    // Array of tables: [[a.b]]
    if (statement.startsWith('[[') && statement.endsWith(']]')) {
      const path = splitKeyPath(statement.slice(2, -2).trim());
      current = createArrayTable(root, path);
      continue;
    }

    // Table: [a.b]
    if (statement.startsWith('[') && statement.endsWith(']')) {
      const path = splitKeyPath(statement.slice(1, -1).trim());
      current = ensureTable(root, path);
      continue;
    }

    // key = value
    const eq = findTopLevel(statement, '=');
    if (eq === -1) continue; // ignore malformed line rather than throw
    const keyPath = splitKeyPath(statement.slice(0, eq).trim());
    const value = parseValue(statement.slice(eq + 1).trim());
    assignValue(current, keyPath, value);
  }

  return root;
}

// ---------------------------------------------------------------------------
// Statement splitting (handles multi-line arrays / strings / inline tables)
// ---------------------------------------------------------------------------

function splitStatements(input: string): string[] {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const statements: string[] = [];
  let buffer = '';
  let depth = 0;
  let i = 0;

  const flush = () => {
    if (buffer.trim()) statements.push(buffer);
    buffer = '';
  };

  while (i < normalized.length) {
    const ch = normalized[i]!;

    // Multi-line strings
    if (ch === '"' && normalized.startsWith('"""', i)) {
      buffer += '"""';
      i += 3;
      const end = normalized.indexOf('"""', i);
      if (end === -1) { buffer += normalized.slice(i); i = normalized.length; }
      else { buffer += normalized.slice(i, end + 3); i = end + 3; }
      continue;
    }
    if (ch === "'" && normalized.startsWith("'''", i)) {
      buffer += "'''";
      i += 3;
      const end = normalized.indexOf("'''", i);
      if (end === -1) { buffer += normalized.slice(i); i = normalized.length; }
      else { buffer += normalized.slice(i, end + 3); i = end + 3; }
      continue;
    }

    // Single-line strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < normalized.length) {
        const c = normalized[j]!;
        if (quote === '"' && c === '\\') { j += 2; continue; }
        if (c === quote) break;
        j++;
      }
      buffer += normalized.slice(i, Math.min(j + 1, normalized.length));
      i = j + 1;
      continue;
    }

    // Comment (outside strings)
    if (ch === '#') {
      while (i < normalized.length && normalized[i] !== '\n') i++;
      continue;
    }

    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);

    if (ch === '\n') {
      if (depth === 0) { flush(); i++; continue; }
      buffer += ' ';
      i++;
      continue;
    }

    buffer += ch;
    i++;
  }

  flush();
  return statements;
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

function splitKeyPath(key: string): string[] {
  const parts = splitTopLevel(key, '.');
  return parts.map((p) => unquoteKey(p.trim())).filter((p) => p.length > 0);
}

function unquoteKey(key: string): string {
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    return key.slice(1, -1);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function parseValue(raw: string): TomlValue {
  const value = raw.trim();
  if (value === '') return '';

  // Multi-line strings
  if (value.startsWith('"""') && value.endsWith('"""')) {
    return unescapeBasicString(value.slice(3, -3)).replace(/^\n/, '');
  }
  if (value.startsWith("'''") && value.endsWith("'''")) {
    return value.slice(3, -3).replace(/^\n/, '');
  }

  // Basic string
  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeBasicString(value.slice(1, -1));
  }
  // Literal string
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  // Array
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').filter((p) => p.trim() !== '').map((p) => parseValue(p.trim()));
  }

  // Inline table
  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const table: TomlTable = {};
    if (inner) {
      for (const pair of splitTopLevel(inner, ',')) {
        const eq = findTopLevel(pair, '=');
        if (eq === -1) continue;
        const path = splitKeyPath(pair.slice(0, eq).trim());
        assignValue(table, path, parseValue(pair.slice(eq + 1).trim()));
      }
    }
    return table;
  }

  // Booleans
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Numbers
  if (/^[+-]?\d+$/.test(value)) return parseInt(value, 10);
  if (/^[+-]?(\d+\.\d*|\d*\.\d+|\d+)([eE][+-]?\d+)?$/.test(value)) return parseFloat(value);

  // Dates and other scalars are kept as strings.
  return value;
}

function unescapeBasicString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_m, esc: string) => {
    switch (esc[0]) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '"': return '"';
      case '\\': return '\\';
      case 'u': return String.fromCodePoint(parseInt(esc.slice(1), 16));
      case 'U': return String.fromCodePoint(parseInt(esc.slice(1), 16));
      default: return esc;
    }
  });
}

// ---------------------------------------------------------------------------
// Table navigation
// ---------------------------------------------------------------------------

function ensureTable(root: TomlTable, path: string[]): TomlTable {
  let node: TomlTable = root;
  for (const part of path) {
    const existing = node[part];
    if (Array.isArray(existing)) {
      const last = existing[existing.length - 1];
      if (last && typeof last === 'object' && !Array.isArray(last)) {
        node = last as TomlTable;
        continue;
      }
    }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      node[part] = {};
    }
    node = node[part] as TomlTable;
  }
  return node;
}

function createArrayTable(root: TomlTable, path: string[]): TomlTable {
  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1]!;
  const parent = ensureTable(root, parentPath);

  if (!Array.isArray(parent[key])) parent[key] = [];
  const table: TomlTable = {};
  (parent[key] as TomlValue[]).push(table);
  return table;
}

function assignValue(table: TomlTable, path: string[], value: TomlValue): void {
  if (path.length === 0) return;
  let node = table;
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i]!;
    const existing = node[part];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
      node[part] = {};
    }
    node = node[part] as TomlTable;
  }
  node[path[path.length - 1]!] = value;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Find the first occurrence of `ch` at top level (not in strings/brackets). */
function findTopLevel(input: string, ch: string): number {
  let depth = 0;
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < input.length) {
        const cc = input[i]!;
        if (quote === '"' && cc === '\\') { i += 2; continue; }
        if (cc === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === ch && depth === 0) return i;
    i++;
  }
  return -1;
}

/** Split `input` by `sep` at top level (not in strings/brackets). */
function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < input.length) {
        const cc = input[i]!;
        if (quote === '"' && cc === '\\') { i += 2; continue; }
        if (cc === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') depth--;
    else if (c === sep && depth === 0) {
      parts.push(input.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(input.slice(start));
  return parts;
}
