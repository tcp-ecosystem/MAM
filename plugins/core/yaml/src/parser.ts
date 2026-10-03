/**
 * YAML Plugin - Parser & Serialisation
 *
 * A hand-written parser for the YAML subset MAM configuration uses: block
 * mappings, block sequences, flow collections, block scalars, comments,
 * document markers, anchors and aliases. Anything outside that subset is
 * reported rather than silently mis-parsed.
 */

export interface YAMLError {
  message: string;
  line?: number;
  code: string;
}

export interface YAMLParseResult {
  data: Record<string, unknown>;
  errors: string[];
  /** Non-fatal findings: unsupported tags, dropped anchors, and the like. */
  warnings: string[];
  /** Structured form of `errors`, for callers that want line numbers. */
  details: YAMLError[];
  /** Documents found in the source; more than one means a multi-doc stream. */
  documentCount: number;
}

// ─── Scalar Parsing ───────────────────────────────────────────────

/**
 * Coerces a scalar token to a JavaScript value.
 *
 * Only exact matches are converted, so a version like `1.0.0` or a padded id
 * like `007` stays a string rather than becoming a number.
 */
export function parseYAMLValue(value: string): unknown {
  // Stripped here as well as during line handling so the scalar-level entry
  // point behaves the same whether or not it came from the line parser.
  const trimmed = stripYAMLComment(value).trim();
  if (trimmed === '') return null;

  if (trimmed === 'true' || trimmed === 'True' || trimmed === 'TRUE') return true;
  if (trimmed === 'false' || trimmed === 'False' || trimmed === 'FALSE') return false;
  if (trimmed === 'null' || trimmed === 'Null' || trimmed === 'NULL' || trimmed === '~') return null;

  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return unescapeDoubleQuoted(trimmed.slice(1, -1));
  }
  // In single quotes YAML escapes a quote by doubling it, not with a backslash.
  if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const flow = parseFlowCollection(trimmed);
    if (flow.ok) return flow.value;
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const flow = parseFlowCollection(trimmed);
    if (flow.ok) return flow.value;
  }

  if (/^[-+]?[0-9]+$/.test(trimmed) && !/^[-+]?0[0-9]+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[-+]?0x[0-9a-fA-F]+$/.test(trimmed)) return parseInt(trimmed, 16);
  if (/^[-+]?0o[0-7]+$/.test(trimmed)) return parseInt(trimmed.slice(2), 8);
  // A float must carry a decimal point or an exponent. Without that guard the
  // pattern also matches a plain integer, so `007` — rejected above as a
  // padded id — would fall through here and become 7.
  if (/[.eE]/.test(trimmed) && /^[-+]?(\.[0-9]+|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[-+]?(\.inf|\.Inf|\.INF)$/.test(trimmed)) return trimmed.startsWith('-') ? -Infinity : Infinity;
  if (/^\.nan$/.test(trimmed) || /^\.NaN$/.test(trimmed) || /^\.NAN$/.test(trimmed)) return NaN;

  return trimmed;
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v',
  f: '\f', r: '\r', e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\',
  N: '\x85', _: '\xa0', L: ' ', P: ' ',
};

function unescapeDoubleQuoted(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char !== '\\') {
      out += char;
      continue;
    }
    const next = body[++i];
    if (next === undefined) break;
    if (next === 'x' || next === 'u' || next === 'U') {
      const width = next === 'x' ? 2 : next === 'u' ? 4 : 8;
      const hex = body.slice(i + 1, i + 1 + width);
      const code = parseInt(hex, 16);
      if (Number.isFinite(code) && hex.length === width) {
        out += String.fromCodePoint(code);
        i += width;
      } else {
        out += next;
      }
      continue;
    }
    out += DOUBLE_QUOTE_ESCAPES[next] ?? next;
  }
  return out;
}

interface FlowResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/**
 * Parses a flow collection (`[a, b]` or `{a: 1}`).
 *
 * Uses YAML's own rules rather than `JSON.parse`, which rejects the unquoted
 * scalars and bare keys that make flow style common in configuration.
 */
export function parseFlowCollection(text: string): FlowResult {
  const state = { pos: 0, text };
  try {
    const value = parseFlowNode(state);
    skipFlowSpace(state);
    if (state.pos !== state.text.length) {
      return { ok: false, error: `Unexpected "${state.text[state.pos]}" at position ${state.pos}` };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

function skipFlowSpace(state: { pos: number; text: string }): void {
  while (state.pos < state.text.length && /\s/.test(state.text[state.pos]!)) state.pos++;
}

function parseFlowNode(state: { pos: number; text: string }): unknown {
  skipFlowSpace(state);
  const char = state.text[state.pos];
  if (char === '[') return parseFlowSequence(state);
  if (char === '{') return parseFlowMapping(state);
  return parseFlowScalar(state);
}

function parseFlowScalar(state: { pos: number; text: string }): unknown {
  skipFlowSpace(state);
  const start = state.pos;
  const quote = state.text[start];
  if (quote === '"' || quote === "'") {
    state.pos++;
    let body = '';
    while (state.pos < state.text.length) {
      const char = state.text[state.pos]!;
      if (quote === "'" && char === "'") {
        if (state.text[state.pos + 1] === "'") {
          body += "'";
          state.pos += 2;
          continue;
        }
        state.pos++;
        return body;
      }
      if (quote === '"' && char === '\\') {
        body += char + (state.text[state.pos + 1] ?? '');
        state.pos += 2;
        continue;
      }
      if (char === quote) {
        state.pos++;
        return quote === '"' ? unescapeDoubleQuoted(body) : body;
      }
      body += char;
      state.pos++;
    }
    throw new Error('Unterminated quoted string in flow collection');
  }

  while (state.pos < state.text.length && !/[,:\]}]/.test(state.text[state.pos]!)) state.pos++;
  return parseYAMLValue(state.text.slice(start, state.pos));
}

function parseFlowSequence(state: { pos: number; text: string }): unknown[] {
  state.pos++;
  const items: unknown[] = [];
  skipFlowSpace(state);
  if (state.text[state.pos] === ']') {
    state.pos++;
    return items;
  }
  while (state.pos < state.text.length) {
    items.push(parseFlowNode(state));
    skipFlowSpace(state);
    const char = state.text[state.pos];
    if (char === ',') {
      state.pos++;
      skipFlowSpace(state);
      if (state.text[state.pos] === ']') {
        state.pos++;
        return items;
      }
      continue;
    }
    if (char === ']') {
      state.pos++;
      return items;
    }
    throw new Error(`Expected "," or "]" at position ${state.pos}`);
  }
  throw new Error('Unterminated flow sequence');
}

function parseFlowMapping(state: { pos: number; text: string }): Record<string, unknown> {
  state.pos++;
  const map: Record<string, unknown> = {};
  skipFlowSpace(state);
  if (state.text[state.pos] === '}') {
    state.pos++;
    return map;
  }
  while (state.pos < state.text.length) {
    const key = parseFlowScalar(state);
    skipFlowSpace(state);
    if (state.text[state.pos] !== ':') throw new Error(`Expected ":" at position ${state.pos}`);
    state.pos++;
    const value = parseFlowNode(state);
    map[String(key)] = value;
    skipFlowSpace(state);
    const char = state.text[state.pos];
    if (char === ',') {
      state.pos++;
      skipFlowSpace(state);
      if (state.text[state.pos] === '}') {
        state.pos++;
        return map;
      }
      continue;
    }
    if (char === '}') {
      state.pos++;
      return map;
    }
    throw new Error(`Expected "," or "}" at position ${state.pos}`);
  }
  throw new Error('Unterminated flow mapping');
}

// ─── Line Preprocessing ───────────────────────────────────────────

interface SourceLine {
  indent: number;
  text: string;
  number: number;
  /** Set when the line was a tab-indented line, which YAML forbids. */
  tabIndented?: boolean;
}

/**
 * Removes a trailing comment, ignoring `#` inside quotes.
 *
 * A bare `#` only starts a comment when preceded by whitespace or at the start
 * of the line, so `a: b#c` keeps its value.
 */
export function stripYAMLComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '\\') {
        i++;
        continue;
      }
      if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function isDocumentMarker(text: string): boolean {
  return text === '---' || text === '...' || text.startsWith('--- ');
}

function toSourceLines(text: string, errors: YAMLError[], warnings: string[]): SourceLine[] {
  const rawLines = text.split(/\r?\n/);
  const lines: SourceLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    const withoutComment = stripYAMLComment(raw);
    if (withoutComment.trim().length === 0) continue;

    const marker = withoutComment.trim();
    if (marker === '---' || marker === '...') {
      // A marker that follows content begins the next document, so stop here.
      // A leading marker just opens the first one.
      if (lines.length > 0) break;
      continue;
    }

    const leading = withoutComment.length - withoutComment.trimStart().length;
    const indentText = withoutComment.slice(0, leading);
    const content = withoutComment.slice(leading).trimEnd();

    if (indentText.includes('\t')) {
      errors.push({
        message: 'Tab characters cannot be used for indentation',
        line: i + 1,
        code: 'tab-indent',
      });
    }
    if (isDocumentMarker(content)) continue;
    if (content === '%YAML' || content.startsWith('%YAML')) {
      warnings.push(`Directive "${content}" ignored`);
      continue;
    }
    if (/^!!?[A-Za-z]/.test(content) || /^!\S/.test(content)) {
      warnings.push(`Tag on line ${i + 1} ignored`);
    }

    lines.push({
      indent: indentText.replace(/\t/g, '  ').length,
      text: content,
      number: i + 1,
    });
  }
  return lines;
}

// ─── Block Parsing ────────────────────────────────────────────────

const BLOCK_SCALAR = /^([|>])([+-]?)(\d*)\s*$/;
const SEQUENCE_ITEM = /^-(?:\s+(.*))?$/;

interface ParseContext {
  errors: YAMLError[];
  warnings: string[];
  anchors: Map<string, unknown>;
}

/** Splits `key: value`, respecting quotes and brackets. Returns null if absent. */
function splitKey(text: string): { key: string; value: string } | null {
  let inSingle = false;
  let inDouble = false;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inSingle) {
      if (char === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (char === '\\') {
        i++;
        continue;
      }
      if (char === '"') inDouble = false;
      continue;
    }
    if (char === "'") inSingle = true;
    else if (char === '"') inDouble = true;
    else if (char === '[' || char === '{') depth++;
    else if (char === ']' || char === '}') depth--;
    else if (char === ':' && depth === 0) {
      const after = text[i + 1];
      // YAML only treats ':' as a separator when followed by space or EOL.
      if (after === undefined || after === ' ') {
        return { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function normaliseKey(key: string): string {
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    return unescapeDoubleQuoted(key.slice(1, -1));
  }
  if (key.length >= 2 && key.startsWith("'") && key.endsWith("'")) {
    return key.slice(1, -1).replace(/''/g, "'");
  }
  return key;
}

function isSequenceItem(text: string): boolean {
  return text === '-' || text.startsWith('- ');
}

/** Strips a leading `&anchor` or `!tag`, reporting what was removed. */
function stripProperties(
  text: string,
  context: ParseContext,
  line: number,
): string {
  let rest = text;
  for (;;) {
    const match = /^([&!])[^\s]*\s*/.exec(rest);
    if (!match) return rest;
    const marker = match[1]!;
    if (marker === '&') {
      rest = rest.slice(match[0].length);
    } else {
      context.warnings.push(`Tag ignored on line ${line}`);
      rest = rest.slice(match[0].length);
    }
  }
}

/** Reads a literal (`|`) or folded (`>`) block scalar. */
function readBlockScalar(
  lines: SourceLine[],
  start: number,
  parentIndent: number,
  header: string,
  context: ParseContext,
): { value: string; next: number } {
  const match = BLOCK_SCALAR.exec(header);
  if (!match) return { value: header, next: start };
  const style = match[1] as '|' | '>';
  const chomp = match[2]!;
  const explicitIndent = match[3] ? Number(match[3]) : null;

  const collected: string[] = [];
  let contentIndent: number | null = explicitIndent !== null ? parentIndent + explicitIndent : null;
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (contentIndent === null) {
      if (line.indent <= parentIndent) break;
      contentIndent = line.indent;
    }
    if (line.indent < contentIndent && line.text.length > 0) break;
    collected.push(' '.repeat(Math.max(0, line.indent - contentIndent)) + line.text);
    i++;
  }

  let value: string;
  if (style === '|') {
    value = collected.join('\n');
  } else {
    // Folded: a newline between two non-empty lines becomes a space; a blank
    // line becomes a newline, which is how a paragraph break is expressed.
    value = collected
      .reduce((acc, line) => {
        if (acc === '') return line;
        if (line === '') return acc + '\n';
        if (acc.endsWith('\n')) return acc + line;
        return acc + ' ' + line;
      }, '')
      .replace(/\n /g, '\n');
  }

  if (chomp === '-') value = value.replace(/\n+$/, '');
  else if (chomp === '+') value += '\n';
  else value = value.replace(/\n+$/, '') + '\n';

  if (collected.length === 0) {
    context.warnings.push(`Empty block scalar on line ${start - 1}`);
  }
  return { value, next: i };
}

/** Resolves an `*alias` against the anchors captured so far. */
function resolveAlias(
  text: string,
  context: ParseContext,
  line: number,
): unknown {
  const name = text.slice(1).trim();
  if (context.anchors.has(name)) return context.anchors.get(name);
  context.errors.push({ message: `Unknown alias "*${name}"`, line, code: 'unknown-alias' });
  return null;
}

function parseBlock(
  lines: SourceLine[],
  start: number,
  indent: number,
  context: ParseContext,
): { value: unknown; next: number } {
  if (start >= lines.length || lines[start]!.indent < indent) {
    return { value: null, next: start };
  }

  if (isSequenceItem(lines[start]!.text)) {
    return parseSequence(lines, start, lines[start]!.indent, context);
  }
  return parseMapping(lines, start, lines[start]!.indent, context);
}

function parseSequence(
  lines: SourceLine[],
  start: number,
  indent: number,
  context: ParseContext,
): { value: unknown[]; next: number } {
  const items: unknown[] = [];
  let i = start;

  while (i < lines.length && lines[i]!.indent === indent && isSequenceItem(lines[i]!.text)) {
    const line = lines[i]!;
    const rest = stripProperties(
      (SEQUENCE_ITEM.exec(line.text)?.[1] ?? '').trim(),
      context,
      line.number,
    );

    if (rest === '') {
      i++;
      if (i < lines.length && lines[i]!.indent > indent) {
        const nested = parseBlock(lines, i, lines[i]!.indent, context);
        items.push(nested.value);
        i = nested.next;
      } else {
        items.push(null);
      }
      continue;
    }

    if (rest.startsWith('*')) {
      items.push(resolveAlias(rest, context, line.number));
      i++;
      continue;
    }

    const block = BLOCK_SCALAR.exec(rest);
    if (block) {
      const scalar = readBlockScalar(lines, i + 1, indent, rest, context);
      items.push(scalar.value);
      i = scalar.next;
      continue;
    }

    // A plain scalar item: `- a`. Without this branch the compact-notation
    // rewrite below would hand `a` to the mapping parser, which finds no
    // "key:" and yields an empty object for every item.
    if (!splitKey(rest) && !isSequenceItem(rest) && !/^[[{]/.test(rest)) {
      items.push(parseYAMLValue(rest));
      i++;
      continue;
    }

    // Compact notation: rewrite the line as if the dash were replaced by two
    // spaces, so `- name: a` and a plain `name: a` parse through one path.
    const rewritten: SourceLine = { indent: indent + 2, text: rest, number: line.number };
    const holder = { lines: [rewritten, ...lines.slice(i + 1)], offset: i + 1 };
    const inner = parseBlock(holder.lines, 0, indent + 2, context);
    items.push(inner.value);
    i = inner.next <= 1 ? i + 1 : holder.offset + inner.next - 1;
  }

  return { value: items, next: i };
}

function parseMapping(
  lines: SourceLine[],
  start: number,
  indent: number,
  context: ParseContext,
): { value: Record<string, unknown>; next: number } {
  const map: Record<string, unknown> = {};
  const seen = new Set<string>();
  let i = start;

  while (i < lines.length && lines[i]!.indent === indent && !isSequenceItem(lines[i]!.text)) {
    const line = lines[i]!;
    const body = stripProperties(line.text, context, line.number);
    const split = splitKey(body);

    if (!split) {
      context.errors.push({
        message: `Expected "key: value" but found "${body}"`,
        line: line.number,
        code: 'expected-key',
      });
      i++;
      continue;
    }

    const key = normaliseKey(split.key);
    if (key === '') {
      context.errors.push({ message: 'Empty key', line: line.number, code: 'empty-key' });
      i++;
      continue;
    }
    if (seen.has(key)) {
      context.errors.push({
        message: `Duplicate key "${key}"`,
        line: line.number,
        code: 'duplicate-key',
      });
    }
    seen.add(key);

    const rawValue = split.value;

    if (rawValue.startsWith('&')) {
      const name = rawValue.slice(1).split(/\s/)[0]!;
      const rest = rawValue.slice(1 + name.length).trim();
      if (rest === '') {
        i++;
        if (i < lines.length && lines[i]!.indent > indent) {
          const nested = parseBlock(lines, i, lines[i]!.indent, context);
          context.anchors.set(name, nested.value);
          map[key] = nested.value;
          i = nested.next;
        } else {
          map[key] = null;
        }
      } else {
        context.anchors.set(name, parseYAMLValue(rest));
        map[key] = parseYAMLValue(rest);
        i++;
      }
      continue;
    }

    if (rawValue.startsWith('*')) {
      map[key] = resolveAlias(rawValue, context, line.number);
      i++;
      continue;
    }

    if (BLOCK_SCALAR.test(rawValue)) {
      const scalar = readBlockScalar(lines, i + 1, indent, rawValue, context);
      map[key] = scalar.value;
      i = scalar.next;
      continue;
    }

    if (rawValue === '') {
      i++;
      if (i < lines.length && lines[i]!.indent > indent) {
        const nested = parseBlock(lines, i, lines[i]!.indent, context);
        map[key] = nested.value;
        i = nested.next;
      } else if (i < lines.length && lines[i]!.indent === indent && isSequenceItem(lines[i]!.text)) {
        // A sequence may sit at the same indent as the key that owns it.
        const nested = parseSequence(lines, i, indent, context);
        map[key] = nested.value;
        i = nested.next;
      } else {
        map[key] = null;
      }
      continue;
    }

    map[key] = parseYAMLValue(rawValue);
    i++;
  }

  return { value: map, next: i };
}

// ─── Entry Points ─────────────────────────────────────────────────

/**
 * Parses a YAML document.
 *
 * Never throws: syntax problems come back in `errors` with line numbers, and
 * `data` holds whatever could be read. Reporting beats throwing here because a
 * config block usually needs to surface several problems at once.
 */
export function parseYAML(text: string): YAMLParseResult {
  const context: ParseContext = { errors: [], warnings: [], anchors: new Map() };
  const lines = toSourceLines(text ?? '', context.errors, context.warnings);

  let data: Record<string, unknown> = {};
  if (lines.length > 0) {
    const result = parseBlock(lines, 0, lines[0]!.indent, context);
    const value = result.value;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      data = value as Record<string, unknown>;
    } else if (Array.isArray(value)) {
      data = { '': value };
      context.warnings.push('Top-level sequence wrapped under an empty key');
    } else {
      context.warnings.push('Top-level scalar document is not a mapping');
    }
    if (result.next < lines.length) {
      const line = lines[result.next]!;
      context.errors.push({
        message: `Unexpected indentation at "${line.text}"`,
        line: line.number,
        code: 'bad-indent',
      });
    }
  }

  const documents = countDocuments(text ?? '');
  if (documents > 1) {
    context.warnings.push(
      `Source contains ${documents} documents; only the first was parsed. Use parseYAMLDocuments() for the rest.`,
    );
  }

  return {
    data,
    errors: context.errors.map((e) => (e.line ? `${e.message} at line ${e.line}` : e.message)),
    warnings: context.warnings,
    details: context.errors,
    documentCount: documents,
  };
}

/** Counts documents in a stream, treating `---` as a document boundary. */
export function countDocuments(text: string): number {
  const chunks = (text ?? '')
    .split(/\r?\n/)
    .reduce<string[]>((acc, line) => {
      if (/^---\s*$/.test(line)) {
        acc.push('');
        return acc;
      }
      acc[acc.length - 1] = (acc[acc.length - 1] ?? '') + line + '\n';
      return acc;
    }, ['']);
  return Math.max(chunks.filter((chunk) => chunk.trim().length > 0).length, 1);
}

/**
 * Splits a multi-document stream and parses each document.
 *
 * Later documents reuse the first document's key space, which is how YAML
 * merge keys (`<<:`) are conventionally applied.
 */
export function parseYAMLDocuments(text: string): YAMLParseResult[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of (text ?? '').split(/\r?\n/)) {
    if (/^---\s*$/.test(line)) {
      chunks.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  chunks.push(current.join('\n'));
  return chunks.filter((chunk) => chunk.trim().length > 0).map(parseYAML);
}

// ─── Validation ───────────────────────────────────────────────────

/**
 * Keys must look like identifiers, optionally dotted.
 *
 * Deliberately stricter than YAML, which permits any string as a key: MAM
 * addresses configuration with dotted paths, so a key that cannot be written
 * as a path is rejected at parse time rather than becoming unreachable later.
 */
export const YAML_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z_][A-Za-z0-9_-]*)*$/;

export interface YAMLValidationOptions {
  /** Allow `a.b` style keys. Default true. */
  allowDottedKeys?: boolean;
  /** Reject a key that does not match the expected pattern. Default true. */
  enforceKeyPattern?: boolean;
  /** Reject tab indentation. Default true. */
  enforceNoTabs?: boolean;
}

export interface YAMLContentValidation {
  valid: boolean;
  error?: string;
  line?: number;
  errors: YAMLError[];
  warnings: string[];
}

/** Validates YAML source, reporting syntax problems and key-shape problems. */
export function validateYAMLContent(
  value: string,
  options: YAMLValidationOptions = {},
): YAMLContentValidation {
  const allowDotted = options.allowDottedKeys ?? true;
  const enforceKeys = options.enforceKeyPattern ?? true;
  const enforceTabs = options.enforceNoTabs ?? true;

  const parsed = parseYAML(value);
  const errors: YAMLError[] = [...parsed.details];

  if (enforceTabs) {
    value.split(/\r?\n/).forEach((line, index) => {
      if (/^[ ]*\t/.test(line) || /^[\t ]*\S/.test(line) && /^\s*\t/.test(line)) {
        errors.push({
          message: 'Tab characters cannot be used for indentation',
          line: index + 1,
          code: 'tab-indent',
        });
      }
    });
  }

  if (enforceKeys) {
    const pattern = allowDotted ? YAML_KEY_PATTERN : /^[A-Za-z_][A-Za-z0-9_-]*$/;
    const lines = value.split(/\r?\n/);
    lines.forEach((raw, index) => {
      const content = stripYAMLComment(raw).trim();
      if (content === '' || isDocumentMarker(content)) return;

      // splitKey returns an object, not a tuple, so index it by name.
      const key = content.replace(/^- (?=\S)/, '').split(/:\s|:\s*$/)[0]!.trim();
      const split = /^-(?:\s|$)/.test(content) ? null : splitKey(content);
      const candidate = split ? normaliseKey(split.key) : key;
      if (candidate === '' || !pattern.test(candidate)) {
        errors.push({
          message: `Invalid YAML key "${candidate}" at line ${index + 1}`,
          line: index + 1,
          code: 'invalid-key',
        });
      }
    });
  }

  const deduplicated = errors.filter(
    (error, index) => errors.findIndex((e) => e.code === error.code && e.line === error.line) === index,
  );
  const first = deduplicated[0];

  return {
    valid: deduplicated.length === 0,
    error: first ? first.message : undefined,
    line: first?.line,
    errors: deduplicated,
    warnings: parsed.warnings,
  };
}

// ─── Serialisation ────────────────────────────────────────────────

/** Returns true when a string must be quoted to survive a round trip. */
export function needsQuoting(value: string): boolean {
  if (value === '') return true;
  if (value !== value.trim()) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(value)) return true;
  if (/:\s/.test(value) || /\s#/.test(value)) return true;
  if (/^(true|false|null|~|yes|no|on|off|True|False|Null|TRUE|FALSE|NULL)$/i.test(value)) return true;
  // Would otherwise be read back as a number, date or flow collection.
  if (/^[-+]?[0-9._+-]+$/.test(value)) return true;
  if (/^\[|^\{/.test(value)) return true;
  return false;
}

function quoteString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined
    || typeof value === 'string' || typeof value === 'number'
    || typeof value === 'boolean';
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') {
    return Number.isNaN(value) ? '.nan' : String(value);
  }
  const text = String(value);
  return needsQuoting(text) ? quoteString(text) : text;
}

function stringifyValue(value: unknown, indent: number, depth: number): string[] {
  const pad = ' '.repeat(indent * (depth + 1));

  if (Array.isArray(value)) {
    if (value.length === 0) return ['[]'];
    const lines: string[] = [];
    for (const item of value) {
      if (isScalar(item)) {
        lines.push(`${pad}- ${formatScalar(item)}`);
      } else if (Array.isArray(item)) {
        const nested = stringifyValue(item, indent, depth + 1);
        // Splice the first child line onto the dash, compact style.
        lines.push(`${pad}- ${nested[0]!.trimStart()}`);
        lines.push(...nested.slice(1));
      } else {
        const nested = stringifyValue(item, indent, depth + 1);
        lines.push(`${pad}- ${nested[0]!.trimStart()}`);
        lines.push(...nested.slice(1));
      }
    }
    return lines;
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return ['{}'];
    const lines: string[] = [];
    for (const [key, child] of entries) {
      const safeKey = needsQuoting(key) ? quoteString(key) : key;
      // Checked before the generic scalar branch, which would otherwise claim
      // every string and emit a raw newline that no longer parses.
      if (typeof child === 'string' && child.includes('\n')) {
        lines.push(`${pad}${safeKey}: |-`);
        for (const line of child.replace(/\n+$/, '').split('\n')) {
          lines.push(`${pad}  ${line}`);
        }
      } else if (isScalar(child)) {
        lines.push(`${pad}${safeKey}: ${formatScalar(child)}`);
      } else if (Array.isArray(child) && child.length === 0) {
        lines.push(`${pad}${safeKey}: []`);
      } else if (!Array.isArray(child) && Object.keys(child as object).length === 0) {
        lines.push(`${pad}${safeKey}: {}`);
      } else {
        lines.push(`${pad}${safeKey}:`);
        lines.push(...stringifyValue(child, indent, depth + 1));
      }
    }
    return lines;
  }

  return [`${pad}${formatScalar(value)}`];
}

/**
 * Serialises a value as YAML.
 *
 * Round-trips through {@link parseYAML}: nested maps, sequences and
 * multi-line strings come back as the same structure and types.
 */
export function stringifyYAML(data: Record<string, unknown>, indent = 2): string {
  return stringifyValue(data ?? {}, Math.max(0, indent), 0).join('\n');
}
