/**
 * Memory Plugin - Validation Rules
 *
 * A rule family over the `Memory` section. The original `memory-consistency`
 * rule is preserved as the composite entry point; the narrower rules can be
 * enabled individually when a module only needs one concern.
 */

import type { ValidationRule, ValidationResult } from '@mam/plugin-api';
import type { MAMModule } from '@mam/ast';
import { parseMemoryContent, getPath, type ParsedMemory, type MemoryParseOptions } from './parser.js';

/** The section this plugin owns. */
export const MEMORY_SECTION_NAME = 'Memory';

/** Severity levels a memory rule can report at. */
export type MemorySeverity = 'error' | 'warning' | 'info';

/** Keys a module is not allowed to define in memory. */
export const RESERVED_MEMORY_PREFIX = '__';

/** Accepted memory key charset: dot-separated identifiers. */
export const MEMORY_KEY_PATTERN = /^[A-Za-z_][\w-]*(\.[A-Za-z_][\w-]*)*$/;

export interface MemoryRuleOptions {
  /** Maximum number of memory entries. Default 200. */
  maxEntries?: number;
  /** Maximum characters in a key. Default 64. */
  maxKeyLength?: number;
  /** Maximum characters in a string value. Default 2000. */
  maxValueLength?: number;
  /** Maximum dotted-path depth. Default 4. */
  maxDepth?: number;
  /** Keys a module must define. */
  requiredKeys?: string[];
  /** Severity applied to rules that find problems. */
  severity?: MemorySeverity;
  /** Options forwarded to the parser. */
  parse?: MemoryParseOptions;
}

const DEFAULTS: Required<Omit<MemoryRuleOptions, 'parse'>> & { parse: MemoryParseOptions } = {
  maxEntries: 200,
  maxKeyLength: 64,
  maxValueLength: 2000,
  maxDepth: 4,
  requiredKeys: [],
  severity: 'error',
  parse: {},
};

/** Parses a module's memory, or undefined when it has no Memory section. */
export function readMemory(module: MAMModule): ParsedMemory | undefined {
  const section = module.sections.find((s) => s.name === MEMORY_SECTION_NAME);
  if (!section) return undefined;
  return parseMemoryContent(section.content, DEFAULTS.parse);
}

/** Returns true when a module defines a Memory section. */
export function hasMemorySection(module: MAMModule): boolean {
  return module.sections.some((s) => s.name === MEMORY_SECTION_NAME);
}

function pass(message: string, extra?: Partial<ValidationResult>): ValidationResult {
  return { valid: true, message, ...extra };
}

function problem(
  message: string,
  severity: MemorySeverity,
  extra?: Partial<ValidationResult>,
): ValidationResult {
  return { valid: false, message, severity, ...extra };
}

// ─── Individual Rules ─────────────────────────────────────────────

/** Reports keys defined more than once in the same section. */
export const duplicateKeysRule: ValidationRule = {
  name: 'memory-duplicate-keys',
  description: 'Every memory key should be defined only once',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return memory.conflicts.map((conflict) =>
      problem(
        `Duplicate memory key: "${conflict.key}" (${conflict.shadowed} shadowed ${conflict.kept})`,
        'error',
        { path: conflict.key, rule: 'memory-duplicate-keys' },
      ),
    );
  },
};

/** Reports keys whose value is empty, null or undefined. */
export const emptyValueRule: ValidationRule = {
  name: 'memory-empty-values',
  description: 'Memory keys should carry a value',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return Object.entries(memory.flat)
      .filter(([, value]) => value === '' || value === null || value === undefined)
      .map(([key]) =>
        problem(`Empty value for memory key: "${key}"`, 'error', {
          path: key,
          rule: 'memory-required-keys',
        }),
      );
  },
};

/** Reports keys outside the accepted charset. */
export const keyFormatRule: ValidationRule = {
  name: 'memory-key-format',
  description: 'Memory keys should be dot-separated identifiers',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return memory.keys
      .filter((key) => !MEMORY_KEY_PATTERN.test(key))
      .map((key) =>
        problem(`Invalid memory key format: "${key}"`, 'error', {
          path: key,
          rule: 'memory-key-format',
        }),
      );
  },
};

/** Reports keys longer than the configured limit. */
export const keyLengthRule: ValidationRule = {
  name: 'memory-key-length',
  description: 'Memory keys should stay short enough to read',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return memory.keys
      .filter((key) => key.length > DEFAULTS.maxKeyLength)
      .map((key) =>
        problem(`Memory key "${key}" exceeds ${DEFAULTS.maxKeyLength} characters`, 'warning', {
          path: key,
          rule: 'memory-key-length',
        }),
      );
  },
};

/** Reports string values longer than the configured limit. */
export const valueLengthRule: ValidationRule = {
  name: 'memory-value-length',
  description: 'Memory values should stay small enough to persist',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return Object.entries(memory.flat)
      .filter(([, value]) => typeof value === 'string' && value.length > DEFAULTS.maxValueLength)
      .map(([key, value]) =>
        problem(
          `Memory value for "${key}" is ${(value as string).length} characters (max ${DEFAULTS.maxValueLength})`,
          'warning',
          { path: key, rule: 'memory-value-length' },
        ),
      );
  },
};

/** Reports sections that are too large or that hit the parser's entry cap. */
export const entryCountRule: ValidationRule = {
  name: 'memory-entry-count',
  description: 'Memory sections should not grow without bound',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    const results: ValidationResult[] = [];
    if (memory.keys.length > DEFAULTS.maxEntries) {
      results.push(
        problem(
          `Memory section has ${memory.keys.length} entries (max ${DEFAULTS.maxEntries})`,
          'warning',
          { rule: 'memory-entry-count' },
        ),
      );
    }
    if (memory.truncated > 0) {
      results.push(
        problem(`Parser dropped ${memory.truncated} entries at the limit`, 'warning', {
          rule: 'memory-entry-count',
        }),
      );
    }
    return results;
  },
};

/** Reports keys under the reserved `__` prefix. */
export const reservedPrefixRule: ValidationRule = {
  name: 'memory-reserved-prefix',
  description: 'Keys starting with "__" are reserved for the runtime',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return memory.keys
      .filter((key) => key.startsWith(RESERVED_MEMORY_PREFIX))
      .map((key) =>
        problem(`Reserved memory key: "${key}"`, 'error', {
          path: key,
          rule: 'memory-reserved-prefix',
        }),
      );
  },
};

/** Reports paths nested deeper than the configured limit. */
export const nestingDepthRule: ValidationRule = {
  name: 'memory-nesting-depth',
  description: 'Memory paths should not nest too deeply',
  severity: 'warning',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return memory.keys
      .filter((key) => key.split('.').length > DEFAULTS.maxDepth)
      .map((key) =>
        problem(`Memory key "${key}" nests deeper than ${DEFAULTS.maxDepth} levels`, 'warning', {
          path: key,
          rule: 'memory-nesting-depth',
        }),
      );
  },
};

/** Reports missing required keys. */
export const requiredKeysRule: ValidationRule = {
  name: 'memory-required-keys',
  description: 'Certain memory keys must be present',
  severity: 'error',
  check: (module: MAMModule): ValidationResult[] => {
    const memory = readMemory(module);
    if (!memory) return [];
    return DEFAULTS.requiredKeys
      .filter((key) => getPath(memory.flat, key) === undefined)
      .map((key) =>
        problem(`Required memory key is missing: "${key}"`, 'error', {
          path: key,
          rule: 'memory-required-keys',
        }),
      );
  },
};

/** Every built-in rule, in the order they should run. */
export const MEMORY_RULES: ValidationRule[] = [
  duplicateKeysRule,
  emptyValueRule,
  keyFormatRule,
  reservedPrefixRule,
  keyLengthRule,
  valueLengthRule,
  nestingDepthRule,
  entryCountRule,
  requiredKeysRule,
];

// ─── Composite Rule ───────────────────────────────────────────────

/**
 * The original composite check: duplicates, empty values, then a summary.
 *
 * Kept as the default rule so a module that already relies on this single
 * result keeps behaving exactly as before.
 */
export const memoryRule: ValidationRule = {
  name: 'memory-consistency',
  description: 'Check memory section for consistency',
  severity: 'info',
  check: (module: MAMModule): ValidationResult[] => {
    const results: ValidationResult[] = [];
    const memory = readMemory(module);

    if (!memory) {
      return [{ valid: true, message: 'No Memory section found' }];
    }

    const { flat, keys, conflicts } = memory;

    if (keys.length === 0) {
      results.push({ valid: true, message: 'Memory section is empty' });
      return results;
    }

    for (const conflict of conflicts) {
      results.push({
        valid: false,
        message: `Duplicate memory key: "${conflict.key}"`,
        severity: 'error',
        path: conflict.key,
        rule: 'memory-consistency',
      });
    }

    for (const [key, value] of Object.entries(flat)) {
      if (value === '' || value === null || value === undefined) {
        results.push({
          valid: false,
          message: `Empty value for memory key: "${key}"`,
          severity: 'error',
          path: key,
          rule: 'memory-consistency',
        });
      }
    }

    if (results.length === 0) {
      results.push({ valid: true, message: `Memory section has ${keys.length} valid entries` });
    }

    return results;
  },
};

// ─── Factories ────────────────────────────────────────────────────

/** Overrides the limits used by the built-in rules. */
export function configureMemoryRules(options: MemoryRuleOptions): void {
  if (options.maxEntries !== undefined) DEFAULTS.maxEntries = options.maxEntries;
  if (options.maxKeyLength !== undefined) DEFAULTS.maxKeyLength = options.maxKeyLength;
  if (options.maxValueLength !== undefined) DEFAULTS.maxValueLength = options.maxValueLength;
  if (options.maxDepth !== undefined) DEFAULTS.maxDepth = options.maxDepth;
  if (options.requiredKeys) DEFAULTS.requiredKeys = [...options.requiredKeys];
  if (options.severity) DEFAULTS.severity = options.severity;
  if (options.parse) DEFAULTS.parse = { ...options.parse };
}

/** Restores the default limits. */
export function resetMemoryRuleConfig(): void {
  DEFAULTS.maxEntries = 200;
  DEFAULTS.maxKeyLength = 64;
  DEFAULTS.maxValueLength = 2000;
  DEFAULTS.maxDepth = 4;
  DEFAULTS.requiredKeys = [];
  DEFAULTS.severity = 'error';
  DEFAULTS.parse = {};
}

/** Returns the composite rule, optionally re-levelled or reconfigured. */
export function createMemoryRule(
  severityOrOptions?: MemorySeverity | MemoryRuleOptions,
): ValidationRule {
  if (typeof severityOrOptions === 'object') {
    configureMemoryRules(severityOrOptions);
    return { ...memoryRule, severity: severityOrOptions.severity ?? memoryRule.severity };
  }
  return { ...memoryRule, severity: severityOrOptions || memoryRule.severity };
}

/** Returns the full rule family, optionally re-levelled. */
export function createMemoryRules(severity?: MemorySeverity): ValidationRule[] {
  return MEMORY_RULES.map((rule) => (severity ? { ...rule, severity } : { ...rule }));
}

/** Runs rules against a module and flattens their results. */
export function runMemoryRules(
  module: MAMModule,
  rules: ValidationRule[] = MEMORY_RULES,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  for (const rule of rules) {
    try {
      results.push(...rule.check(module));
    } catch (error) {
      results.push(
        problem(`Rule "${rule.name}" threw: ${(error as Error).message}`, 'error', {
          rule: rule.name,
        }),
      );
    }
  }
  return results;
}

/** Summarises rule output as `3 errors, 1 warning`. */
export function formatRuleSummary(results: ValidationResult[]): string {
  const errors = results.filter((r) => !r.valid).length;
  const warnings = results.filter((r) => r.valid && r.severity === 'warning').length;
  const parts: string[] = [];
  if (errors > 0) parts.push(`${errors} error${errors === 1 ? '' : 's'}`);
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(', ') : 'no problems';
}
