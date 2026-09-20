import { Token, TokenType } from '../../lexer/tokens.js';
import { V2ModuleNode, V2EdgeNode } from '@mam/ast';

export interface DSLParserLike {
  tokens: Token[];
  pos: number;
  source: string;
  currentToken(): Token | undefined;
  skipWhitespace(): void;
  isEOF(): boolean;
}

export function parseListItem(parser: DSLParserLike, module: V2ModuleNode, line: string): boolean {
  if (!line.startsWith('- ')) return false;
  const content = line.slice(2).trim();
  if (content.includes(':')) {
    const parts = content.split(':').map(p => p.trim());
    const key = parts[0];
    const value = parts.slice(1).join(':').trim();
    if (!module.metadata) module.metadata = {};
    module.metadata[key] = value;
    return true;
  }
  return false;
}

export function parseEdge(parser: DSLParserLike, module: V2ModuleNode, line: string): boolean {
  if (!module.edges) module.edges = [];

  const edge = parseEdgeLine(parser, line, parser.currentToken()!);
  if (edge) {
    module.edges.push(edge);
    parser.pos++;
    return true;
  }

  return false;
}

export function parseEdgeLine(parser: DSLParserLike, line: string, token: Token): V2EdgeNode | null {
  const arrowIndex = line.indexOf('->');
  if (arrowIndex === -1) return null;

  const source = line.slice(0, arrowIndex).trim();
  const rest = line.slice(arrowIndex + 2).trim();

  let target = rest;
  let condition: string | undefined;
  let label: string | undefined;

  const bracketStart = rest.indexOf('[');
  const bracketEnd = rest.indexOf(']');
  if (bracketStart !== -1 && bracketEnd !== -1) {
    condition = rest.slice(bracketStart + 1, bracketEnd);
    target = rest.slice(0, bracketStart).trim();
  }

  const parenStart = rest.indexOf('(');
  const parenEnd = rest.indexOf(')');
  if (parenStart !== -1 && parenEnd !== -1) {
    label = rest.slice(parenStart + 1, parenEnd);
    target = rest.slice(0, parenStart).trim();
  }

  return {
    type: 'EdgeNode',
    source,
    target,
    condition,
    label,
    location: {
      start: { line: token.line, column: token.column, offset: token.offset },
      end: { line: token.line, column: token.column + token.length, offset: token.offset + token.length },
      source: parser.source,
    },
  };
}

// ============================================================================
// Condition Expression Parsing
// ============================================================================

export interface DSLConditionExpression {
  operator: string;
  left: string;
  right: string;
  negate: boolean;
}

export function parseConditionExpression(parser: DSLParserLike, line: string): DSLConditionExpression | null {
  const trimmed = line.trim();
  let negate = false;
  let expr = trimmed;

  if (expr.startsWith('not ')) {
    negate = true;
    expr = expr.slice(4).trim();
  }

  const operators = ['==', '!=', '>=', '<=', '>', '<', 'in', 'not in', 'contains'];
  for (const op of operators) {
    const idx = expr.indexOf(op);
    if (idx !== -1) {
      const left = expr.slice(0, idx).trim();
      const right = expr.slice(idx + op.length).trim();
      return { operator: op, left, right, negate };
    }
  }

  return null;
}

// ============================================================================
// Annotation Parsing
// ============================================================================

export interface DSLAnnotation {
  name: string;
  arguments: Record<string, unknown>;
}

export function parseAnnotation(parser: DSLParserLike, line: string): DSLAnnotation | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;

  const withoutAt = trimmed.slice(1);
  const parenStart = withoutAt.indexOf('(');
  const name = parenStart !== -1 ? withoutAt.slice(0, parenStart) : withoutAt;

  const args: Record<string, unknown> = {};
  if (parenStart !== -1) {
    const parenEnd = withoutAt.lastIndexOf(')');
    if (parenEnd !== -1) {
      const argsStr = withoutAt.slice(parenStart + 1, parenEnd);
      const pairs = argsStr.split(',');
      for (const pair of pairs) {
        const eqIdx = pair.indexOf('=');
        if (eqIdx !== -1) {
          const key = pair.slice(0, eqIdx).trim();
          let value: unknown = pair.slice(eqIdx + 1).trim();
          if (value === 'true') value = true;
          else if (value === 'false') value = false;
          else if (/^\d+$/.test(value as string)) value = Number(value);
          args[key] = value;
        }
      }
    }
  }

  return { name, arguments: args };
}

// ============================================================================
// Comment Parsing
// ============================================================================

export interface DSLComment {
  text: string;
  isBlock: boolean;
}

export function parseComment(parser: DSLParserLike, line: string): DSLComment | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('#')) {
    return { text: trimmed.slice(1).trim(), isBlock: false };
  }
  if (trimmed.startsWith('//')) {
    return { text: trimmed.slice(2).trim(), isBlock: false };
  }
  if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) {
    return { text: trimmed.slice(2, -2).trim(), isBlock: true };
  }
  return null;
}

// ============================================================================
// Tag Parsing
// ============================================================================

export interface DSLTag {
  name: string;
  value?: string;
}

export function parseTag(parser: DSLParserLike, line: string): DSLTag | null {
  const trimmed = line.trim();
  let tagStr = '';
  if (trimmed.startsWith('#')) {
    tagStr = trimmed.slice(1);
  } else if (trimmed.startsWith('@')) {
    tagStr = trimmed.slice(1);
  } else {
    return null;
  }

  const eqIdx = tagStr.indexOf('=');
  if (eqIdx !== -1) {
    return { name: tagStr.slice(0, eqIdx).trim(), value: tagStr.slice(eqIdx + 1).trim() };
  }
  return { name: tagStr.trim() };
}

// ============================================================================
// Reference Parsing
// ============================================================================

export interface DSLReference {
  type: 'module' | 'variable' | 'external';
  name: string;
  path?: string;
}

export function parseReference(parser: DSLParserLike, line: string): DSLReference | null {
  const trimmed = line.trim();
  if (trimmed.startsWith('@')) {
    const ref = trimmed.slice(1);
    const dotIdx = ref.indexOf('.');
    if (dotIdx !== -1) {
      return { type: 'module', name: ref.slice(0, dotIdx), path: ref.slice(dotIdx + 1) };
    }
    return { type: 'module', name: ref };
  }
  if (trimmed.startsWith('$')) {
    return { type: 'variable', name: trimmed.slice(1) };
  }
  if (trimmed.startsWith('ext:')) {
    return { type: 'external', name: trimmed.slice(4) };
  }
  return null;
}

// ============================================================================
// Type Annotation Parsing
// ============================================================================

export interface DSLTypeAnnotation {
  name: string;
  type: string;
  optional: boolean;
  default?: unknown;
}

export function parseTypeAnnotation(parser: DSLParserLike, line: string): DSLTypeAnnotation | null {
  const trimmed = line.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return null;

  const name = trimmed.slice(0, colonIdx).trim();
  const rest = trimmed.slice(colonIdx + 1).trim();

  const eqIdx = rest.indexOf('=');
  let type = rest;
  let defaultValue: unknown;
  let optional = false;

  if (eqIdx !== -1) {
    type = rest.slice(0, eqIdx).trim();
    defaultValue = rest.slice(eqIdx + 1).trim();
  }

  if (type.endsWith('?')) {
    optional = true;
    type = type.slice(0, -1);
  }

  return { name, type, optional, default: defaultValue };
}

// ============================================================================
// Default Value Parsing
// ============================================================================

export function parseDefaultValue(parser: DSLParserLike, line: string): { key: string; value: unknown } | null {
  const trimmed = line.trim();
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) return null;

  const key = trimmed.slice(0, eqIdx).trim();
  let value: unknown = trimmed.slice(eqIdx + 1).trim();

  if (value === 'true') value = true;
  else if (value === 'false') value = false;
  else if (value === 'null') value = null;
  else if (/^-?\d+$/.test(value as string)) value = Number(value);
  else if (/^-?\d+\.\d+$/.test(value as string)) value = Number(value);
  else if ((value as string).startsWith('"') && (value as string).endsWith('"')) {
    value = (value as string).slice(1, -1);
  } else if ((value as string).startsWith("'") && (value as string).endsWith("'")) {
    value = (value as string).slice(1, -1);
  }

  return { key, value };
}

// ============================================================================
// Constraint Parsing
// ============================================================================

export interface DSLConstraint {
  type: string;
  target: string;
  params: Record<string, unknown>;
}

export function parseConstraint(parser: DSLParserLike, line: string): DSLConstraint | null {
  const trimmed = line.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return null;

  const type = trimmed.slice(0, colonIdx).trim();
  const rest = trimmed.slice(colonIdx + 1).trim();

  const bracketStart = rest.indexOf('[');
  const bracketEnd = rest.indexOf(']');
  let target = rest;
  const params: Record<string, unknown> = {};

  if (bracketStart !== -1 && bracketEnd !== -1) {
    target = rest.slice(0, bracketStart).trim();
    const paramsStr = rest.slice(bracketStart + 1, bracketEnd);
    const pairs = paramsStr.split(',');
    for (const pair of pairs) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx !== -1) {
        const key = pair.slice(0, eqIdx).trim();
        const value = pair.slice(eqIdx + 1).trim();
        params[key] = value;
      }
    }
  }

  return { type, target, params };
}

// ============================================================================
// Decorator Parsing
// ============================================================================

export interface DSLDecorator {
  name: string;
  args: string[];
}

export function parseDecorator(parser: DSLParserLike, line: string): DSLDecorator | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('@')) return null;

  const withoutAt = trimmed.slice(1);
  const parenStart = withoutAt.indexOf('(');
  const name = parenStart !== -1 ? withoutAt.slice(0, parenStart) : withoutAt;

  const args: string[] = [];
  if (parenStart !== -1) {
    const parenEnd = withoutAt.lastIndexOf(')');
    if (parenEnd !== -1) {
      const argsStr = withoutAt.slice(parenStart + 1, parenEnd);
      args.push(...argsStr.split(',').map(a => a.trim()));
    }
  }

  return { name, args };
}

// ============================================================================
// Map Parsing
// ============================================================================

export function parseMap(parser: DSLParserLike, lines: string[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result.set(key, value);
    }
  }
  return result;
}

// ============================================================================
// Inline Table Parsing
// ============================================================================

export function parseInlineTable(parser: DSLParserLike, line: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const trimmed = line.trim();
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart === -1 || braceEnd === -1) return result;

  const inner = trimmed.slice(braceStart + 1, braceEnd).trim();
  if (!inner) return result;

  const pairs = inner.split(',');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx !== -1) {
      const key = pair.slice(0, eqIdx).trim();
      let value: unknown = pair.slice(eqIdx + 1).trim();
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (/^\d+$/.test(value as string)) value = Number(value);
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// String List Parsing
// ============================================================================

export function parseStringList(parser: DSLParserLike, lines: string[]): string[] {
  const result: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ')) {
      result.push(trimmed.slice(2).trim());
    } else if (trimmed) {
      result.push(trimmed);
    }
  }
  return result;
}

// ============================================================================
// Key-Value List Parsing
// ============================================================================

export function parseKeyValueList(parser: DSLParserLike, lines: string[]): Array<{ key: string; value: string }> {
  const result: Array<{ key: string; value: string }> = [];
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      result.push({ key, value });
    }
  }
  return result;
}

// ============================================================================
// String Utilities
// ============================================================================

export function escapeString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export function unescapeString(value: string): string {
  return value
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

export function trimQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

// ============================================================================
// Argument Parsing
// ============================================================================

export function splitArguments(parser: DSLParserLike, value: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (const ch of value) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

// ============================================================================
// Numeric Value Parsing
// ============================================================================

export function parseNumericValue(parser: DSLParserLike, value: string): { value: number; unit?: string } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(s|ms|m|h|d|w|M|G|K|MB|GB|KB)?$/);
  if (!match) return null;
  return { value: Number(match[1]), unit: match[2] || undefined };
}

// ============================================================================
// Boolean Value Parsing
// ============================================================================

export function parseBooleanValue(parser: DSLParserLike, value: string): boolean | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === 'yes' || trimmed === 'on' || trimmed === '1') return true;
  if (trimmed === 'false' || trimmed === 'no' || trimmed === 'off' || trimmed === '0') return false;
  return null;
}

// ============================================================================
// Token Utility Functions
// ============================================================================

export function peekToken(parser: DSLParserLike, offset: number): Token | undefined {
  return parser.tokens[parser.pos + offset];
}

export function getTokenText(parser: DSLParserLike): string {
  const token = parser.currentToken();
  if (!token) return '';
  return token.value;
}

export function getLocation(parser: DSLParserLike): { line: number; column: number; offset: number } {
  const token = parser.currentToken();
  if (!token) return { line: 0, column: 0, offset: 0 };
  return { line: token.line, column: token.column, offset: token.offset };
}

export function expectToken(parser: DSLParserLike, type: TokenType): Token | null {
  const token = parser.currentToken();
  if (!token || token.type !== type) return null;
  parser.pos++;
  return token;
}

// ============================================================================
// Error Recovery
// ============================================================================

export function recoverToNextLine(parser: DSLParserLike): void {
  while (parser.pos < parser.tokens.length) {
    const token = parser.currentToken();
    if (token?.type === TokenType.NEWLINE) {
      parser.pos++;
      return;
    }
    parser.pos++;
  }
}

export function recoverToNextSection(parser: DSLParserLike): void {
  while (parser.pos < parser.tokens.length) {
    const token = parser.currentToken();
    if (!token) break;
    if (token.type === TokenType.NEWLINE) {
      parser.pos++;
      const next = parser.currentToken();
      if (next && next.type === TokenType.TEXT && next.value.includes(':')) {
        return;
      }
    }
    parser.pos++;
  }
}
