/**
 * Memory Plugin - Manifest & Section Definition
 *
 * Declares what the plugin provides and validates the `Memory` section of a
 * module before anything tries to persist it.
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { parseMemoryContent } from './parser.js';
import { MEMORY_KEY_PATTERN, MEMORY_SECTION_NAME, RESERVED_MEMORY_PREFIX } from './rule.js';

export { MEMORY_SECTION_NAME, MEMORY_KEY_PATTERN, RESERVED_MEMORY_PREFIX };

/**
 * `mamVersion` was `>=1.0.0` while the API package this plugin compiles
 * against is `0.1.0`, so the requirement could never be satisfied.
 * `main` pointed at `./index.js`, but the package only ships `dist`, so the
 * declared entry did not exist in the published artifact.
 */
export const MEMORY_MANIFEST: PluginManifest = {
  name: '@mam/plugin-memory',
  version: '0.1.0',
  description: 'Memory and state management for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=0.1.0',
  keywords: ['memory', 'state', 'persistence'],
  main: './dist/index.js',
};

export const MEMORY_CONTENT_TYPES = ['text', 'code'] as const;

/** Section-size limits enforced by the validator. */
export const MEMORY_LIMITS = {
  maxEntries: 200,
  maxKeyLength: 64,
  maxValueLength: 2000,
  maxDepth: 4,
} as const;

/** A worked example used by docs and the default export. */
export const MEMORY_EXAMPLE = `- status: active
- version: 2.0.0

\`\`\`json
{ "db": { "host": "localhost", "port": 5432 } }
\`\`\``;

/** Returns true when a key matches the accepted memory key charset. */
export function isValidMemoryKey(key: string): boolean {
  return MEMORY_KEY_PATTERN.test(key) && !key.startsWith(RESERVED_MEMORY_PREFIX);
}

/** Finds the Memory section on a module, if it has one. */
export function findMemorySection(module: MAMModule) {
  return module.sections.find((s) => s.name === MEMORY_SECTION_NAME);
}

/** Returns true when the module declares a Memory section. */
export function hasMemorySection(module: MAMModule): boolean {
  return findMemorySection(module) !== undefined;
}

/**
 * Validates Memory section content.
 *
 * Checks JSON syntax, key charset, reserved prefixes and section size. Runs
 * before persistence so malformed state is reported at parse time rather than
 * surfacing later as a confusing merge or a corrupt file.
 */
export function validateMemoryContent(
  content: Array<{ type?: string; language?: string; value?: string }>,
  limits: Partial<typeof MEMORY_LIMITS> = {},
): ValidationResult[] {
  const maxEntries = limits.maxEntries ?? MEMORY_LIMITS.maxEntries;
  const maxKeyLength = limits.maxKeyLength ?? MEMORY_LIMITS.maxKeyLength;
  const maxValueLength = limits.maxValueLength ?? MEMORY_LIMITS.maxValueLength;
  const results: ValidationResult[] = [];

  for (const node of content) {
    if (node.type !== 'CodeBlock' || node.language !== 'json') continue;
    try {
      JSON.parse(node.value ?? '');
    } catch (error) {
      results.push({
        valid: false,
        message: `Invalid JSON in Memory: ${(error as Error).message}`,
        severity: 'error',
        rule: 'memory-json-syntax',
      });
    }
  }

  const parsed = parseMemoryContent(content as never);
  results.push(...parsed.errors.map((error) => ({
    valid: false,
    message: error.message,
    severity: 'error' as const,
    rule: 'memory-parse',
  })));

  for (const key of parsed.keys) {
    if (!MEMORY_KEY_PATTERN.test(key)) {
      results.push({
        valid: false,
        message: `Invalid memory key: "${key}"`,
        severity: 'error',
        path: key,
        rule: 'memory-key-format',
      });
    }
    if (key.startsWith(RESERVED_MEMORY_PREFIX)) {
      results.push({
        valid: false,
        message: `Reserved memory key: "${key}"`,
        severity: 'error',
        path: key,
        rule: 'memory-reserved-prefix',
      });
    }
    if (key.length > maxKeyLength) {
      results.push({
        valid: true,
        message: `Memory key "${key}" exceeds ${maxKeyLength} characters`,
        severity: 'warning',
        path: key,
        rule: 'memory-key-length',
      });
    }
  }

  for (const [key, value] of Object.entries(parsed.flat)) {
    if (typeof value === 'string' && value.length > maxValueLength) {
      results.push({
        valid: true,
        message: `Memory value for "${key}" exceeds ${maxValueLength} characters`,
        severity: 'warning',
        path: key,
        rule: 'memory-value-length',
      });
    }
  }

  if (parsed.keys.length > maxEntries) {
    results.push({
      valid: true,
      message: `Memory section has ${parsed.keys.length} entries (max ${maxEntries})`,
      severity: 'warning',
      rule: 'memory-entry-count',
    });
  }

  for (const conflict of parsed.conflicts) {
    results.push({
      valid: false,
      message: `Duplicate memory key: "${conflict.key}"`,
      severity: 'error',
      path: conflict.key,
      rule: 'memory-duplicate-keys',
    });
  }

  return results;
}

export const memorySection: SectionDefinition = {
  name: MEMORY_SECTION_NAME,
  description: 'Persistent memory and state for the module',
  required: false,
  contentTypes: [...MEMORY_CONTENT_TYPES],
  validator: (content) => validateMemoryContent(content as never),
};

/** Returns a copy of the section definition, with limits overridden. */
export function getMemorySection(
  limits?: Partial<typeof MEMORY_LIMITS>,
): SectionDefinition {
  return {
    ...memorySection,
    contentTypes: [...MEMORY_CONTENT_TYPES],
    validator: limits
      ? (content) => validateMemoryContent(content as never, limits)
      : memorySection.validator,
  };
}

/** Returns a copy of the manifest with fields overridden. */
export function createMemoryManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return { ...MEMORY_MANIFEST, ...overrides, keywords: [...(overrides.keywords ?? MEMORY_MANIFEST.keywords!)] };
}
