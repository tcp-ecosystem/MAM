/**
 * MAM AST JSON Serializer
 *
 * Production-grade JSON serialization with cycle detection, depth limiting,
 * schema validation, compact output, and AST patching.
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

export interface SerializeOptions {
  /** Indentation spaces (0 for compact). Default: 2. */
  indent?: number;
  /** Include location data in output. Default: true. */
  includeLocation?: boolean;
  /** Maximum depth to serialize. 0 = unlimited. Default: 0. */
  maxDepth?: number;
  /** Include metadata fields (moduleMetadata, sectionAttributes, etc.). Default: true. */
  includeMetadata?: boolean;
  /** Custom replacer function applied to each value. */
  replacer?: (key: string, value: unknown) => unknown;
}

export interface DeserializeOptions {
  /** Strict mode: throw on unknown node types. Default: false. */
  strict?: boolean;
  /** Validate required fields. Default: true. */
  validate?: boolean;
  /** Transform function applied to each node after deserialization. */
  transform?: (node: BaseNode) => BaseNode;
}

export interface JSONSchemaValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Core Serialization
// ============================================================================

/**
 * Serialize a MAMModule AST to a JSON string with full options.
 */
export function serializeToJSON(ast: MAMModule, options: SerializeOptions = {}): string {
  const opts: Required<SerializeOptions> = {
    indent: options.indent ?? 2,
    includeLocation: options.includeLocation ?? true,
    maxDepth: options.maxDepth ?? 0,
    includeMetadata: options.includeMetadata ?? true,
    replacer: options.replacer ?? ((_, v) => v),
  };

  const seen = new WeakSet<object>();
  const cleanAst = sanitizeForSerialization(ast, opts, seen, 0);

  return JSON.stringify(cleanAst, opts.replacer, opts.indent);
}

/**
 * Deserialize a JSON string back to a MAMModule AST.
 */
export function deserializeFromJSON(json: string, options: DeserializeOptions = {}): MAMModule {
  const opts: Required<DeserializeOptions> = {
    strict: options.strict ?? false,
    validate: options.validate ?? true,
    transform: options.transform ?? ((n) => n),
  };

  const data: unknown = JSON.parse(json);

  if (opts.validate) {
    const result = validateJSONSchema(data);
    if (!result.valid) {
      throw new Error(`Invalid AST JSON: ${result.errors.join('; ')}`);
    }
  }

  if (opts.strict && opts.validate) {
    assertKnownNodeTypes(data);
  }

  return restoreLocations(opts.transform(data as MAMModule) as MAMModule);
}

// ============================================================================
// Schema Validation
// ============================================================================

const VALID_NODE_TYPES = new Set([
  'MAMModule', 'FrontMatter', 'Section', 'Paragraph', 'List',
  'CodeBlock', 'Table', 'Mermaid', 'Heading', 'Blockquote',
  'InlineText', 'InlineCode', 'Bold', 'Italic', 'Link', 'Image',
]);

/**
 * Validate that data conforms to the MAM AST JSON structure.
 */
export function validateJSONSchema(data: unknown): JSONSchemaValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    errors.push('Root value must be an object');
    return { valid: false, errors };
  }

  const root = data as Record<string, unknown>;

  if (root.type !== 'MAMModule') {
    errors.push(`Root type must be "MAMModule", got "${root.type}"`);
  }

  if (!Array.isArray(root.sections)) {
    errors.push('"sections" must be an array');
  }

  if (root.frontmatter !== null && root.frontmatter !== undefined) {
    if (typeof root.frontmatter !== 'object') {
      errors.push('"frontmatter" must be an object or null');
    }
  }

  if (root.metadata !== null && root.metadata !== undefined) {
    if (typeof root.metadata !== 'object') {
      errors.push('"metadata" must be an object or null');
    }
  }

  if (Array.isArray(root.sections)) {
    (root.sections as unknown[]).forEach((section, i) => {
      const se = validateSection(section, `sections[${i}]`);
      errors.push(...se);
    });
  }

  return { valid: errors.length === 0, errors };
}

function validateSection(data: unknown, path: string): string[] {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    errors.push(`${path}: must be an object`);
    return errors;
  }

  const node = data as Record<string, unknown>;

  if (node.type !== 'Section') {
    errors.push(`${path}: type must be "Section"`);
  }

  if (typeof node.name !== 'string') {
    errors.push(`${path}: "name" must be a string`);
  }

  if (typeof node.level !== 'number') {
    errors.push(`${path}: "level" must be a number`);
  }

  if (!Array.isArray(node.content)) {
    errors.push(`${path}: "content" must be an array`);
  }

  return errors;
}

function assertKnownNodeTypes(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;

  const node = data as Record<string, unknown>;

  if (node.type && typeof node.type === 'string' && !VALID_NODE_TYPES.has(node.type)) {
    throw new Error(`Unknown node type: "${node.type}"`);
  }

  for (const key of Object.keys(node)) {
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        if (item && typeof item === 'object' && 'type' in item) {
          assertKnownNodeTypes(item);
        }
      }
    } else if (val && typeof val === 'object' && 'type' in val) {
      assertKnownNodeTypes(val);
    }
  }
}

// ============================================================================
// Compact Serialization
// ============================================================================

/**
 * Serialize AST as minified JSON (no whitespace).
 */
export function compactSerialize(ast: MAMModule): string {
  return serializeToJSON(ast, {
    indent: 0,
    includeLocation: false,
    includeMetadata: false,
  });
}

// ============================================================================
// AST Normalization
// ============================================================================

/**
 * Deep clone and normalize AST to a plain JSON object.
 * Strips functions, undefined values, and normalizes node shapes.
 */
export function astToJSON(ast: MAMModule): Record<string, unknown> {
  return deepCloneAndClean(ast) as Record<string, unknown>;
}

// ============================================================================
// AST Patching
// ============================================================================

/**
 * Apply a partial patch to a serialized AST.
 * Only the fields present in patch are applied; everything else is preserved.
 */
export function patchAST(
  original: MAMModule,
  patch: Partial<MAMModule> & Record<string, unknown>,
): MAMModule {
  const merged = { ...original, ...patch };

  if (patch.sections) {
    merged.sections = patch.sections.map((section, i) => {
      const existing = original.sections[i];
      if (existing && typeof section === 'object' && section !== null) {
        return { ...existing, ...(section as Partial<Section>) } as Section;
      }
      return section as Section;
    });
  }

  if (patch.frontmatter && typeof patch.frontmatter === 'object' && patch.frontmatter !== null) {
    merged.frontmatter = {
      ...original.frontmatter!,
      ...(patch.frontmatter as Partial<FrontMatter>),
    } as FrontMatter;
  }

  if (patch.metadata && typeof patch.metadata === 'object' && patch.metadata !== null) {
    merged.metadata = {
      ...original.metadata,
      ...(patch.metadata as unknown as Record<string, unknown>),
    } as MAMModule['metadata'];
  }

  return merged;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function sanitizeForSerialization(
  ast: MAMModule,
  opts: Required<SerializeOptions>,
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (ast === null || ast === undefined) return null;

  if (typeof ast !== 'object') return ast;

  if (seen.has(ast)) {
    throw new Error('Cycle detected in AST during serialization');
  }
  seen.add(ast);

  if (opts.maxDepth > 0 && depth > opts.maxDepth) {
    return '[Max depth exceeded]';
  }

  if (Array.isArray(ast)) {
    return ast.map((item) => {
      if (item && typeof item === 'object') {
        return sanitizeForSerialization(item as MAMModule, opts, seen, depth);
      }
      return item;
    });
  }

  const result: Record<string, unknown> = {};
  const node = ast as unknown as Record<string, unknown>;

  for (const key of Object.keys(node)) {
    const value = node[key];

    if (key === 'location' && !opts.includeLocation) continue;
    if (key === 'metadata' && !opts.includeMetadata) continue;
    if (key === 'attributes' && !opts.includeMetadata) continue;

    if (value === undefined) continue;
    if (typeof value === 'function') continue;

    if (value === null) {
      result[key] = null;
    } else if (typeof value === 'object') {
      result[key] = sanitizeForSerialization(value as MAMModule, opts, seen, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function deepCloneAndClean(obj: unknown): unknown {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => deepCloneAndClean(item));
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value === 'function') continue;
    result[key] = deepCloneAndClean(value);
  }
  return result;
}

function restoreLocations(ast: MAMModule): MAMModule {
  return ast as MAMModule;
}
