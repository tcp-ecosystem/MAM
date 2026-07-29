/**
 * MAM YAML Plugin
 *
 * Provides YAML section parsing and validation for MAM modules.
 */

import type { MAMPlugin } from '@mam/plugin-api';
import { YAML_MANIFEST, yamlSection } from './manifest.js';
import { yamlRule } from './rule.js';

export { YAML_MANIFEST, yamlSection, getYamlSection } from './manifest.js';
export { parseYAMLValue, validateYAMLContent, parseYAML, stringifyYAML } from './parser.js';
export type { YAMLParseResult } from './parser.js';
export { yamlRule, createYamlRule } from './rule.js';
export { validateYAMLSchema, MAM_CORE_SCHEMA } from './schema.js';
export type { YAMLSchema, YAMLSchemaField, SchemaValidationResult } from './schema.js';
export { flattenYAML, unflattenYAML, mergeYAMLObjects, YAMLToJSON, jsonToYAML, diffYAMLObjects } from './utils.js';

const yamlPlugin: MAMPlugin = { manifest: YAML_MANIFEST, sections: [yamlSection], rules: [yamlRule] };
export default yamlPlugin;
