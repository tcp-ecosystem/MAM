/**
 * MAM Front Matter Parser
 * 
 * Parses YAML front matter from token stream.
 */

import { Token, TokenType, TokenMetadata } from '../lexer/tokens.js';
import { ParseError, ParseErrorCode } from './errors.js';

export interface FrontMatterData {
  id: string;
  version: string;
  name: string;
  author: string;
  runtime: string;
  tags?: string[];
  description?: string;
  dependencies?: string[];
  permissions?: string[];
  license?: string;
  repository?: string;
  mam_version?: string;
  [key: string]: unknown;
}

export interface FrontMatterResult {
  data: FrontMatterData | null;
  errors: ParseError[];
  endIndex: number;
}

/**
 * Parse front matter from tokens
 */
export function parseFrontMatter(
  tokens: Token[],
  startIndex: number,
  source: string
): FrontMatterResult {
  const errors: ParseError[] = [];
  let pos = startIndex;

  // Skip whitespace tokens
  while (pos < tokens.length && isWhitespace(tokens[pos]!)) {
    pos++;
  }

  // Check for opening ---
  if (pos >= tokens.length || tokens[pos]!.type !== TokenType.FRONTMATTER_SEPARATOR) {
    return { data: null, errors, endIndex: pos };
  }

  pos++; // Skip opening ---

  // Collect YAML tokens until closing ---
  const yamlTokens: Token[] = [];
  while (pos < tokens.length) {
    const token = tokens[pos]!;

    if (token.type === TokenType.FRONTMATTER_SEPARATOR) {
      pos++; // Skip closing ---
      break;
    }

    if (token.type === TokenType.EOF) {
      errors.push(
        new ParseError(
          'Unterminated front matter',
          source,
          token.line,
          token.column,
          ParseErrorCode.UNTERMINATED_FRONTMATTER
        )
      );
      return { data: null, errors, endIndex: pos };
    }

    yamlTokens.push(token);
    pos++;
  }

  // Parse YAML tokens into data
  const data = parseYAMLTokens(yamlTokens, source, errors);

  return { data, errors, endIndex: pos };
}

/**
 * Parse YAML tokens into structured data
 */
function parseYAMLTokens(
  tokens: Token[],
  source: string,
  errors: ParseError[]
): FrontMatterData | null {
  const data: Record<string, unknown> = {};
  const listAccumulator: Map<string, string[]> = new Map();
  let currentKey: string | null = null;

  for (const token of tokens) {
    switch (token.type) {
      case TokenType.YAML_KEY: {
        const key = token.metadata?.yamlKey || token.value;
        currentKey = key;
        
        // Check if this key has a value on the same line
        const nextToken = tokens[tokens.indexOf(token) + 1];
        if (nextToken?.type === TokenType.YAML_VALUE) {
          data[key] = parseYAMLValue(nextToken.metadata?.yamlValue || nextToken.value);
        }
        break;
      }

      case TokenType.YAML_VALUE: {
        if (currentKey) {
          data[currentKey] = parseYAMLValue(token.metadata?.yamlValue || token.value);
          currentKey = null;
        }
        break;
      }

      case TokenType.YAML_LIST_ITEM: {
        if (currentKey) {
          if (!listAccumulator.has(currentKey)) {
            listAccumulator.set(currentKey, []);
          }
          listAccumulator.get(currentKey)!.push(
            token.metadata?.yamlValue || token.value
          );
        }
        break;
      }

      case TokenType.TEXT: {
        // Handle plain text that might be a value
        if (currentKey && !data[currentKey]) {
          data[currentKey] = parseYAMLValue(token.value);
          currentKey = null;
        }
        break;
      }
    }
  }

  // Merge list accumulators
  for (const [key, values] of listAccumulator) {
    data[key] = values;
  }

  // Validate required fields
  if (!data.id) {
    errors.push(
      new ParseError(
        'Missing required field: id',
        source,
        1,
        0,
        ParseErrorCode.INVALID_YAML
      )
    );
    return null;
  }

  if (!data.version) {
    errors.push(
      new ParseError(
        'Missing required field: version',
        source,
        1,
        0,
        ParseErrorCode.INVALID_YAML
      )
    );
    return null;
  }

  if (!data.name) {
    errors.push(
      new ParseError(
        'Missing required field: name',
        source,
        1,
        0,
        ParseErrorCode.INVALID_YAML
      )
    );
    return null;
  }

  if (!data.author) {
    errors.push(
      new ParseError(
        'Missing required field: author',
        source,
        1,
        0,
        ParseErrorCode.INVALID_YAML
      )
    );
    return null;
  }

  if (!data.runtime) {
    errors.push(
      new ParseError(
        'Missing required field: runtime',
        source,
        1,
        0,
        ParseErrorCode.INVALID_YAML
      )
    );
    return null;
  }

  return data as FrontMatterData;
}

/**
 * Parse YAML value (handle types)
 */
function parseYAMLValue(value: string): unknown {
  const trimmed = value.trim();

  // Boolean
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Null
  if (trimmed === 'null' || trimmed === '~') return null;

  // Number
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  // Quoted string
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  // Plain string
  return trimmed;
}

function isWhitespace(token: Token): boolean {
  return token.type === TokenType.NEWLINE || token.type === TokenType.WHITESPACE;
}