/**
 * YAML Plugin - Manifest & Section Definition
 *
 * Declares what the plugin provides and validates YAML blocks before anything
 * consumes the configuration they hold.
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import {
  parseYAML, validateYAMLContent, YAML_KEY_PATTERN,
  type YAMLValidationOptions,
} from './parser.js';
import { validateYAMLSchema, MAM_CORE_SCHEMA, type YAMLSchema } from './schema.js';
import { flattenYAML } from './utils.js';

/** The section this plugin owns. */
export const YAML_SECTION_NAME = 'Config';

/** Block languages treated as YAML. */
export const YAML_LANGUAGES = ['yaml', 'yml'] as const;

/**
 * `mamVersion` was `>=1.0.0` while the API package this plugin compiles against
 * is `0.1.0`, so the requirement could never be satisfied. `main` pointed at
 * `./index.js`, but the package only ships `dist`.
 */
export const YAML_MANIFEST: PluginManifest = {
  name: '@mam/plugin-yaml',
  version: '0.1.0',
  description: 'YAML section parser and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=0.1.0',
  keywords: ['yaml', 'parser', 'validator'],
  main: './dist/index.js',
};

export const YAML_CONTENT_TYPES = ['code', 'text'] as const;

/** Configuration-size limits enforced by the section validator. */
export const YAML_LIMITS = {
  maxLines: 1000,
  maxKeys: 200,
} as const;

/** A worked example used by docs and the default export. */
export const YAML_EXAMPLE = `\`\`\`yaml
id: my-module
version: 2.0.0
tags:
  - core
  - example
database:
  host: localhost
  port: 5432
\`\`\``;

export { YAML_KEY_PATTERN };

/** Returns true when a key can be addressed as a dotted path. */
export function isValidYAMLKey(key: string): boolean {
  return YAML_KEY_PATTERN.test(key);
}

/**
 * Validates YAML blocks in a section.
 *
 * Reports syntax, duplicate keys, tab indentation and key shape, plus a
 * schema check when one is supplied. Doing this at parse time means a bad
 * config fails where it is written rather than somewhere downstream.
 */
export function validateYAMLContentBlocks(
  content: Array<{ type?: string; language?: string; value?: string }>,
  options: {
    limits?: Partial<typeof YAML_LIMITS>;
    validation?: YAMLValidationOptions;
    schema?: YAMLSchema;
  } = {},
): ValidationResult[] {
  const maxLines = options.limits?.maxLines ?? YAML_LIMITS.maxLines;
  const maxKeys = options.limits?.maxKeys ?? YAML_LIMITS.maxKeys;
  const results: ValidationResult[] = [];

  for (const node of content) {
    if (node.type !== 'CodeBlock') continue;
    if (!YAML_LANGUAGES.includes(node.language as (typeof YAML_LANGUAGES)[number])) continue;
    const value = node.value ?? '';

    const validation = validateYAMLContent(value, options.validation);
    for (const issue of validation.errors) {
      results.push({
        valid: false,
        message: issue.message,
        severity: 'error',
        rule: `yaml-${issue.code}`,
        ...(issue.line ? { location: { line: issue.line, column: 1 } } : {}),
      });
    }

    const lineCount = value.split(/\r?\n/).length;
    if (lineCount > maxLines) {
      results.push({
        valid: true,
        message: `YAML block has ${lineCount} lines (max ${maxLines})`,
        severity: 'warning',
        rule: 'yaml-size',
      });
    }

    const parsed = parseYAML(value);
    const keyCount = Object.keys(parsed.data).length;
    if (keyCount > maxKeys) {
      results.push({
        valid: true,
        message: `YAML block has ${keyCount} top-level keys (max ${maxKeys})`,
        severity: 'warning',
        rule: 'yaml-size',
      });
    }

    if (options.schema) {
      const schemaResult = validateYAMLSchema(parsed.data, options.schema);
      for (const error of schemaResult.errors) {
        results.push({ valid: false, message: error, severity: 'error', rule: 'yaml-schema' });
      }
      for (const warning of schemaResult.warnings) {
        results.push({ valid: true, message: warning, severity: 'warning', rule: 'yaml-schema' });
      }
    }
  }
  return results;
}

export const yamlSection: SectionDefinition = {
  name: YAML_SECTION_NAME,
  description: 'YAML configuration section',
  required: false,
  contentTypes: [...YAML_CONTENT_TYPES],
  validator: (content) => validateYAMLContentBlocks(content as never),
};

/** Returns a copy of the section definition, with limits or a schema applied. */
export function getYamlSection(
  options?: {
    limits?: Partial<typeof YAML_LIMITS>;
    validation?: YAMLValidationOptions;
    schema?: YAMLSchema;
  },
): SectionDefinition {
  return {
    ...yamlSection,
    contentTypes: [...YAML_CONTENT_TYPES],
    validator: options
      ? (content) => validateYAMLContentBlocks(content as never, options)
      : yamlSection.validator,
  };
}

/** Returns a copy of the manifest with fields overridden. */
export function createYamlManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    ...YAML_MANIFEST,
    ...overrides,
    keywords: [...(overrides.keywords ?? YAML_MANIFEST.keywords!)],
  };
}

/** Returns a section definition that also enforces a schema. */
export function createValidatedYamlSection(schema: YAMLSchema = MAM_CORE_SCHEMA): SectionDefinition {
  return getYamlSection({ schema });
}

/**
 * Reads a module's YAML configuration as a flat record.
 *
 * The shape most consumers want: dotted paths straight out of the block,
 * without walking the tree by hand.
 */
export function readModuleConfig(
  module: { sections: Array<{ name: string; content: unknown[] }> },
  sectionName: string = YAML_SECTION_NAME,
): Record<string, unknown> {
  const section = module.sections.find((s) => s.name === sectionName);
  if (!section) return {};

  let merged: Record<string, unknown> = {};
  for (const node of section.content as Array<{ type?: string; language?: string; value?: string }>) {
    if (node.type !== 'CodeBlock') continue;
    if (!YAML_LANGUAGES.includes(node.language as (typeof YAML_LANGUAGES)[number])) continue;
    merged = { ...merged, ...flattenYAML(parseYAML(node.value ?? '').data) };
  }
  return merged;
}
