/**
 * YAML Plugin - Schema Validation
 *
 * A small declarative schema for parsed configuration records: required
 * fields, type checks, defaults and per-field constraints.
 */

import { getYAMLPath, setYAMLPath } from './utils.js';

export type YAMLFieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null';

export interface YAMLSchemaField {
  name: string;
  type: YAMLFieldType | YAMLFieldType[];
  required?: boolean;
  default?: unknown;
  description?: string;
  /** Permitted values, for a closed set. */
  enum?: unknown[];
  /** Pattern the string value must match. */
  pattern?: RegExp;
  /** Inclusive numeric bounds. */
  min?: number;
  max?: number;
  /** Length bounds for strings and arrays. */
  minLength?: number;
  maxLength?: number;
  /** Field type, for a nested record. */
  fields?: YAMLSchemaField[];
  /** Schema for array elements. */
  items?: YAMLSchemaField;
  /** Treat the field as deprecated and report it as a warning. */
  deprecated?: boolean;
  /** Alternate names accepted for this field. */
  aliases?: string[];
}

export interface YAMLSchema {
  name: string;
  fields: YAMLSchemaField[];
  /** Report fields outside the schema as errors rather than warnings. */
  strict?: boolean;
}

export interface SchemaFieldIssue {
  field: string;
  message: string;
  code: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Structured form of `errors` and `warnings`. */
  fieldIssues: SchemaFieldIssue[];
  /** Fields whose type did not match. */
  typeMismatches: string[];
}

/** Reports a value's schema type name. */
export function getValueType(value: unknown): YAMLFieldType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const type = typeof value;
  if (type === 'object') return 'object';
  if (type === 'string' || type === 'number' || type === 'boolean') return type;
  return 'object';
}

function matchesType(value: unknown, expected: YAMLFieldType): boolean {
  const actual = getValueType(value);
  if (expected === 'object') return actual === 'object';
  return actual === expected;
}

interface FieldContext {
  errors: SchemaFieldIssue[];
  warnings: SchemaFieldIssue[];
  mismatches: string[];
  /** Off means the caller's data is never modified. */
  applyDefaults: boolean;
  data: Record<string, unknown>;
}

function resolveValue(field: YAMLSchemaField, data: Record<string, unknown>): unknown {
  const direct = field.name.includes('.')
    ? getYAMLPath(data, field.name)
    : data[field.name];
  if (direct !== undefined) return direct;
  for (const alias of field.aliases ?? []) {
    const viaAlias = alias.includes('.') ? getYAMLPath(data, alias) : data[alias];
    if (viaAlias !== undefined) return viaAlias;
  }
  return undefined;
}

function writeValue(field: YAMLSchemaField, data: Record<string, unknown>, value: unknown): void {
  if (field.name.includes('.')) setYAMLPath(data, field.name, value);
  else data[field.name] = value;
}

function validateField(
  field: YAMLSchemaField,
  value: unknown,
  context: FieldContext,
  path: string,
): void {
  const label = path || field.name;

  if (value === undefined || value === null) {
    if (field.required) {
      context.errors.push({
        field: label,
        message: `Missing required field: "${label}"`,
        code: 'required',
      });
    } else if (field.default !== undefined) {
      // Opt-in: a previous version wrote defaults into the caller's object,
      // so simply validating a record silently changed it.
      if (context.applyDefaults) writeValue(field, context.data, field.default);
      else {
        context.warnings.push({
          field: label,
          message: `Field "${label}" is absent and would default to ${JSON.stringify(field.default)}`,
          code: 'default-available',
        });
      }
    }
    return;
  }

  const expected = Array.isArray(field.type) ? field.type : [field.type];
  if (!expected.some((type) => matchesType(value, type))) {
    context.mismatches.push(label);
    context.errors.push({
      field: label,
      message: `Field "${label}" should be ${expected.join(' or ')}, got ${getValueType(value)}`,
      code: 'type-mismatch',
    });
    return;
  }

  if (field.enum && !field.enum.some((allowed) => Object.is(allowed, value))) {
    context.errors.push({
      field: label,
      message: `Field "${label}" must be one of: ${field.enum.map((v) => JSON.stringify(v)).join(', ')}`,
      code: 'enum',
    });
  }

  if (field.pattern && typeof value === 'string' && !field.pattern.test(value)) {
    context.errors.push({
      field: label,
      message: `Field "${label}" does not match ${field.pattern}`,
      code: 'pattern',
    });
  }

  if (typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      context.errors.push({
        field: label,
        message: `Field "${label}" must be >= ${field.min}, got ${value}`,
        code: 'min',
      });
    }
    if (field.max !== undefined && value > field.max) {
      context.errors.push({
        field: label,
        message: `Field "${label}" must be <= ${field.max}, got ${value}`,
        code: 'max',
      });
    }
  }

  if (typeof value === 'string' || Array.isArray(value)) {
    const length = typeof value === 'string' ? value.length : value.length;
    if (field.minLength !== undefined && length < field.minLength) {
      context.errors.push({
        field: label,
        message: `Field "${label}" must have at least ${field.minLength} items, got ${length}`,
        code: 'min-length',
      });
    }
    if (field.maxLength !== undefined && length > field.maxLength) {
      context.errors.push({
        field: label,
        message: `Field "${label}" must have at most ${field.maxLength} items, got ${length}`,
        code: 'max-length',
      });
    }
  }

  if (field.deprecated) {
    context.warnings.push({ field: label, message: `Field "${label}" is deprecated`, code: 'deprecated' });
  }

  if (Array.isArray(value) && field.items) {
    value.forEach((item, index) => {
      validateField(field.items!, item, context, `${label}[${index}]`);
    });
  }

  if (typeof value === 'object' && value !== null && !Array.isArray(value) && field.fields) {
    for (const nested of field.fields) {
      validateField(nested, (value as Record<string, unknown>)[nested.name], context, `${label}.${nested.name}`);
    }
  }
}

export interface SchemaValidationOptions {
  /** Write defaults into `data`. Off by default; the input is left alone. */
  applyDefaults?: boolean;
  /** Report unknown fields as errors instead of warnings. */
  strict?: boolean;
}

/**
 * Validates a record against a schema.
 *
 * Does not modify `data` unless `applyDefaults` is set.
 */
export function validateYAMLSchema(
  data: Record<string, unknown>,
  schema: YAMLSchema,
  options: SchemaValidationOptions = {},
): SchemaValidationResult {
  const context: FieldContext = {
    errors: [],
    warnings: [],
    mismatches: [],
    applyDefaults: options.applyDefaults ?? false,
    data: data ?? {},
  };

  for (const field of schema.fields) {
    validateField(field, resolveValue(field, context.data), context, field.name);
  }

  const known = new Set<string>();
  for (const field of schema.fields) {
    known.add(field.name.split('.')[0]!);
    for (const alias of field.aliases ?? []) known.add(alias.split('.')[0]!);
  }
  for (const key of Object.keys(context.data)) {
    if (known.has(key)) continue;
    const issue: SchemaFieldIssue = {
      field: key,
      message: `Unknown field: "${key}"`,
      code: 'unknown-field',
    };
    if (options.strict ?? schema.strict) context.errors.push(issue);
    else context.warnings.push(issue);
  }

  return {
    valid: context.errors.length === 0,
    errors: context.errors.map((i) => i.message),
    warnings: context.warnings.map((i) => i.message),
    fieldIssues: [...context.errors, ...context.warnings],
    typeMismatches: context.mismatches,
  };
}

/** Returns a copy of `data` with every schema default applied. */
export function applyYAMLSchemaDefaults(
  data: Record<string, unknown>,
  schema: YAMLSchema,
): Record<string, unknown> {
  const copy: Record<string, unknown> = structuredCloneish(data ?? {});
  validateYAMLSchema(copy, schema, { applyDefaults: true });
  return copy;
}

/** Returns the fields in a schema that are required. */
export function getRequiredFields(schema: YAMLSchema): string[] {
  return schema.fields.filter((f) => f.required).map((f) => f.name);
}

/** Returns every field path in a schema, including nested ones. */
export function getSchemaPaths(schema: YAMLSchema, prefix = ''): string[] {
  const paths: string[] = [];
  for (const field of schema.fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    paths.push(path);
    if (field.fields) paths.push(...getSchemaPaths({ name: '', fields: field.fields }, path));
  }
  return paths;
}

/** Merges two schemas, with `override` fields winning by name. */
export function mergeYAMLSchemas(base: YAMLSchema, override: YAMLSchema): YAMLSchema {
  const byName = new Map(base.fields.map((f) => [f.name, f]));
  for (const field of override.fields) {
    byName.set(field.name, { ...byName.get(field.name), ...field });
  }
  return { name: override.name || base.name, fields: [...byName.values()] };
}

function structuredCloneish<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export const MAM_CORE_SCHEMA: YAMLSchema = {
  name: 'MAM Core',
  fields: [
    { name: 'id', type: 'string', required: true, pattern: /^[A-Za-z0-9._-]+$/, description: 'Module identifier' },
    // Accepts 1, 1.0 and 1.0.0 forms: module versions in the wild are not
    // always full semver, but a non-numeric version is still worth rejecting.
    { name: 'version', type: 'string', pattern: /^\d+(\.\d+){0,2}(-[a-zA-Z0-9.]+)?$/, description: 'Module version' },
    { name: 'title', type: 'string', maxLength: 200, description: 'Module title' },
    { name: 'description', type: 'string', maxLength: 2000, description: 'Module description' },
    {
      name: 'tags',
      type: 'array',
      maxLength: 30,
      items: { name: '', type: 'string', minLength: 1, maxLength: 64 },
      description: 'Module tags',
    },
    { name: 'author', type: 'string', description: 'Module author' },
    { name: 'license', type: 'string', enum: ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'UNLICENSED'], description: 'Module license' },
    { name: 'enabled', type: 'boolean', default: true, description: 'Whether the module is active' },
    { name: 'dependencies', type: 'array', items: { name: '', type: 'string' }, description: 'Required modules' },
  ],
};

/** A schema for nested build configuration. */
export const MAM_BUILD_SCHEMA: YAMLSchema = {
  name: 'MAM Build',
  fields: [
    { name: 'target', type: 'string', required: true, enum: ['esm', 'cjs', 'umd'] },
    {
      name: 'output',
      type: 'object',
      fields: [
        { name: 'dir', type: 'string', required: true },
        { name: 'sourcemap', type: 'boolean', default: true },
        { name: 'minify', type: 'boolean', default: false },
      ],
    },
    {
      name: 'external',
      type: 'array',
      items: { name: '', type: 'string', pattern: /^(@[a-z0-9-]+\/)?[a-z0-9-._~]+$/ },
    },
  ],
};
