/**
 * MAM YAML Plugin
 *
 * Provides YAML configuration parsing, validation and serialisation for MAM
 * modules: a real indentation-based parser with nested maps, sequences, block
 * scalars, anchors and duplicate-key detection, plus a schema layer and a rule
 * family for build-time checks.
 */

import type { MAMPlugin, ValidationRule, ValidationResult } from '@mam/plugin-api';
import { YAML_MANIFEST, yamlSection, YAML_SECTION_NAME, YAML_LIMITS, YAML_EXAMPLE } from './manifest.js';
import { YAML_RULES, yamlRule, type YAMLSeverity } from './rule.js';
import { parseYAML, validateYAMLContent, stringifyYAML, type YAMLValidationOptions } from './parser.js';
import { validateYAMLSchema, MAM_CORE_SCHEMA, type YAMLSchema } from './schema.js';

// ─── Manifest ──────────────────────────────────────────────────────
export {
  YAML_MANIFEST,
  yamlSection,
  getYamlSection,
  createYamlManifest,
  createValidatedYamlSection,
  validateYAMLContentBlocks,
  readModuleConfig,
  isValidYAMLKey,
  YAML_SECTION_NAME,
  YAML_LANGUAGES,
  YAML_CONTENT_TYPES,
  YAML_LIMITS,
  YAML_EXAMPLE,
  YAML_KEY_PATTERN,
} from './manifest.js';

// ─── Parser ────────────────────────────────────────────────────────
export {
  parseYAML,
  parseYAMLDocuments,
  parseYAMLValue,
  parseFlowCollection,
  validateYAMLContent,
  countDocuments,
  stripYAMLComment,
  needsQuoting,
  stringifyYAML,
} from './parser.js';
export type {
  YAMLParseResult,
  YAMLError,
  YAMLContentValidation,
  YAMLValidationOptions,
} from './parser.js';

// ─── Utils ─────────────────────────────────────────────────────────
export {
  flattenYAML,
  unflattenYAML,
  mergeYAMLObjects,
  mergeYAMLDefaults,
  splitYAMLPath,
  getYAMLPath,
  setYAMLPath,
  deleteYAMLPath,
  hasYAMLPath,
  pickYAML,
  yamlKeys,
  yamlEquals,
  sortYAMLKeys,
  describeYAMLShape,
  diffYAMLObjects,
  YAMLToJSON,
  yamlToJSONResult,
  jsonToYAML,
} from './utils.js';
export type { YAMLDiff, YAMLShape } from './utils.js';

// ─── Schema ────────────────────────────────────────────────────────
export {
  validateYAMLSchema,
  applyYAMLSchemaDefaults,
  getRequiredFields,
  getSchemaPaths,
  mergeYAMLSchemas,
  getValueType,
  MAM_CORE_SCHEMA,
  MAM_BUILD_SCHEMA,
} from './schema.js';
export type {
  YAMLSchema,
  YAMLSchemaField,
  YAMLFieldType,
  SchemaValidationResult,
  SchemaValidationOptions,
  SchemaFieldIssue,
} from './schema.js';

// ─── Rules ─────────────────────────────────────────────────────────
export {
  YAML_RULES,
  yamlRule,
  createYamlRule,
  createYAMLRules,
  createYAMLValidationRule,
  configureYAMLRules,
  resetYAMLRuleConfig,
  runYAMLRules,
  formatYAMLRuleSummary,
  findYAMLBlocks,
  countYAMLBlocks,
  syntaxRule,
  duplicateKeyRule,
  tabIndentRule,
  keyFormatRule,
  emptyRule,
  multiDocumentRule,
  sizeRule,
  depthRule,
} from './rule.js';
export type { YAMLRuleOptions, YAMLSeverity, YAMLBlock } from './rule.js';

// ─── Plugin Factory ────────────────────────────────────────────────

import { yamlSection as section } from './manifest.js';
import { YAML_RULES as rules } from './rule.js';

/** The default singleton plugin, for callers that just want the plugin. */
const yamlPlugin: MAMPlugin = {
  manifest: YAML_MANIFEST,
  sections: [section],
  rules: [yamlRule],
};

export const YAML_PLUGIN_VERSION = '0.1.0';

export interface YAMLPluginOptions {
  /** Install the full rule family instead of just the composite rule. */
  allRules?: boolean;
  /** Re-level every installed rule. */
  severity?: YAMLSeverity;
  /** Enforce a schema in the section validator. */
  schema?: YAMLSchema;
  /** Options forwarded to the section's YAML validation. */
  validation?: YAMLValidationOptions;
  /** Manifest fields to override. */
  manifest?: Partial<typeof YAML_MANIFEST>;
}

/** Builds a YAML plugin with a chosen rule set and optional schema. */
export function createYamlPlugin(options: YAMLPluginOptions = {}): MAMPlugin {
  const installedRules: ValidationRule[] = options.allRules
    ? rules.map((rule) => (options.severity ? { ...rule, severity: options.severity } : { ...rule }))
    : [options.severity ? { ...yamlRule, severity: options.severity } : yamlRule];

  const sectionWithValidation = options.schema || options.validation
    ? {
        ...section,
        validator: (content: Parameters<NonNullable<typeof section.validator>>[0]) => {
          const results: ValidationResult[] = [];
          for (const node of content as Array<{ type?: string; language?: string; value?: string }>) {
            if (node.type !== 'CodeBlock') continue;
            if (node.language !== 'yaml' && node.language !== 'yml') continue;
            const validation = validateYAMLContent(node.value ?? '', options.validation ?? {});
            for (const issue of validation.errors) {
              results.push({ valid: false, message: issue.message, severity: 'error', rule: `yaml-${issue.code}` });
            }
            if (options.schema) {
              const schemaResult = validateYAMLSchema(parseYAML(node.value ?? '').data, options.schema);
              for (const error of schemaResult.errors) {
                results.push({ valid: false, message: error, severity: 'error', rule: 'yaml-schema' });
              }
            }
          }
          return results;
        },
      }
    : section;

  return {
    manifest: { ...YAML_MANIFEST, ...options.manifest },
    sections: [sectionWithValidation],
    rules: installedRules,
  };
}

export interface YAMLApi {
  version: string;
  sectionName: string;
  rules: ValidationRule[];
  schema: YAMLSchema;
  limits: typeof YAML_LIMITS;
  example: string;
  /** Parses YAML source, returning data plus any errors. */
  parse(source: string): ReturnType<typeof parseYAML>;
  /** Validates a record against the default schema. */
  validate(data: Record<string, unknown>, schema?: YAMLSchema): ReturnType<typeof validateYAMLSchema>;
  /** Serialises a record as YAML. */
  stringify(data: Record<string, unknown>): string;
}

/**
 * Bundles the parser, rules and schema behind one object.
 *
 * For hosts that want to read configuration without the full plugin wiring,
 * such as a CLI or a docs generator.
 */
export function createYamlApi(options: { schema?: YAMLSchema } = {}): YAMLApi {
  const schema = options.schema ?? MAM_CORE_SCHEMA;
  return {
    version: YAML_PLUGIN_VERSION,
    sectionName: YAML_SECTION_NAME,
    rules: [...YAML_RULES],
    schema,
    limits: { ...YAML_LIMITS },
    example: YAML_EXAMPLE,
    parse: parseYAML,
    validate: (data, override) => validateYAMLSchema(data, override ?? schema),
    stringify: stringifyYAML,
  };
}

/** One-line summary of the plugin's surface, for diagnostics. */
export function describeYamlPlugin(): string {
  return `MAM YAML Plugin v${YAML_PLUGIN_VERSION} — ${YAML_RULES.length} rules, ` +
    `section "${YAML_SECTION_NAME}", schema "${MAM_CORE_SCHEMA.name}"`;
}

export default yamlPlugin;
