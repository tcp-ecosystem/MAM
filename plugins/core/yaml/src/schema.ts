/**
 * YAML Plugin - Schema Validation
 */

export interface YAMLSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
  description?: string;
}

export interface YAMLSchema {
  name: string;
  fields: YAMLSchemaField[];
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateYAMLSchema(
  data: Record<string, unknown>,
  schema: YAMLSchema,
): SchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of schema.fields) {
    const value = data[field.name];

    if (field.required && (value === undefined || value === null)) {
      errors.push(`Missing required field: "${field.name}"`);
      continue;
    }

    if (value === undefined || value === null) {
      if (field.default !== undefined) {
        data[field.name] = field.default;
      }
      continue;
    }

    const actualType = typeof value;
    if (actualType !== field.type && field.type !== 'array' && field.type !== 'object') {
      errors.push(`Field "${field.name}" should be ${field.type}, got ${actualType}`);
    }

    if (field.type === 'array' && !Array.isArray(value)) {
      errors.push(`Field "${field.name}" should be an array, got ${actualType}`);
    }

    if (field.type === 'object' && (actualType !== 'object' || Array.isArray(value))) {
      errors.push(`Field "${field.name}" should be an object, got ${actualType}`);
    }
  }

  const knownFields = new Set(schema.fields.map((f) => f.name));
  for (const key of Object.keys(data)) {
    if (!knownFields.has(key)) {
      warnings.push(`Unknown field: "${key}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export const MAM_CORE_SCHEMA: YAMLSchema = {
  name: 'MAM Core',
  fields: [
    { name: 'id', type: 'string', required: true, description: 'Module identifier' },
    { name: 'version', type: 'string', description: 'Module version' },
    { name: 'title', type: 'string', description: 'Module title' },
    { name: 'description', type: 'string', description: 'Module description' },
    { name: 'tags', type: 'array', description: 'Module tags' },
    { name: 'author', type: 'string', description: 'Module author' },
    { name: 'license', type: 'string', description: 'Module license' },
  ],
};
