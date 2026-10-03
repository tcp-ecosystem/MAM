/**
 * Python Plugin - Manifest & Section Definition
 *
 * Declares what the plugin provides and validates Python blocks before the
 * runner is asked to execute them.
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import {
  validatePythonCodeStatic, getPythonSecurityIssues,
  type PythonValidationOptions,
} from './validator.js';

/** The section this plugin owns. */
export const PYTHON_SECTION_NAME = 'Python';

/** Block languages treated as Python. */
export const PYTHON_LANGUAGES = ['python', 'py'] as const;

/**
 * `mamVersion` was `>=1.0.0` while the API package this plugin compiles against
 * is `0.1.0`, so the requirement could never be satisfied. `main` pointed at
 * `./index.js`, but the package only ships `dist`.
 */
export const PYTHON_MANIFEST: PluginManifest = {
  name: '@mam/plugin-python',
  version: '0.1.0',
  description: 'Python code execution for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=0.1.0',
  keywords: ['python', 'runtime', 'execution'],
  main: './dist/index.js',
};

export const PYTHON_CONTENT_TYPES = ['code'] as const;

/** Block-size limits enforced by the section validator. */
export const PYTHON_LIMITS = {
  maxLines: 2000,
} as const;

/** A worked example used by docs and the default export. */
export const PYTHON_EXAMPLE = `\`\`\`python
def greet(name: str) -> str:
    return f"Hello, {name}!"


if __name__ == "__main__":
    print(greet("MAM"))
\`\`\``;

export interface PythonContentOptions {
  limits?: Partial<typeof PYTHON_LIMITS>;
  validation?: PythonValidationOptions;
  /** Include security findings. Default true. */
  checkSecurity?: boolean;
}

/**
 * Validates Python blocks in a section.
 *
 * Delegates to the shared analyser so the section check and the rule family
 * cannot drift apart; the previous version re-implemented an `os.system`
 * check here while the analyser used a different one.
 */
export function validatePythonContent(
  content: Array<{ type?: string; language?: string; value?: string }>,
  options: PythonContentOptions = {},
): ValidationResult[] {
  const maxLines = options.limits?.maxLines ?? PYTHON_LIMITS.maxLines;
  const checkSecurity = options.checkSecurity ?? true;
  const results: ValidationResult[] = [];

  for (const node of content) {
    if (node.type !== 'CodeBlock') continue;
    if (!PYTHON_LANGUAGES.includes(node.language as (typeof PYTHON_LANGUAGES)[number])) continue;
    const value = node.value ?? '';

    if (value.trim().length === 0) {
      results.push({ valid: false, message: 'Empty Python code block', rule: 'python-empty' });
      continue;
    }

    const lineCount = value.split('\n').length;
    if (lineCount > maxLines) {
      results.push({
        valid: true,
        message: `Python block has ${lineCount} lines (max ${maxLines})`,
        severity: 'warning',
        rule: 'python-size',
      });
    }

    for (const issue of validatePythonCodeStatic(value, {
      ...options.validation,
      // The section check stays interpreter-free; the async syntax rule is
      // the opt-in for hosts that can await a subprocess.
      checkSyntax: false,
    })) {
      results.push({
        valid: issue.severity !== 'error',
        message: issue.message,
        severity: issue.severity,
        rule: issue.rule,
        location: { line: issue.line, column: issue.column },
      });
    }

    if (checkSecurity) {
      for (const issue of getPythonSecurityIssues(value)) {
        results.push({
          valid: issue.severity !== 'error',
          message: `Security: ${issue.message}`,
          severity: issue.severity,
          rule: issue.rule,
        });
      }
    }
  }
  return results;
}

export const pythonSection: SectionDefinition = {
  name: PYTHON_SECTION_NAME,
  description: 'Python code block',
  required: false,
  contentTypes: [...PYTHON_CONTENT_TYPES],
  validator: (content) => validatePythonContent(content as never),
};

/** Returns a copy of the section definition, with options applied. */
export function getPythonSection(options?: PythonContentOptions): SectionDefinition {
  return {
    ...pythonSection,
    contentTypes: [...PYTHON_CONTENT_TYPES],
    validator: options
      ? (content) => validatePythonContent(content as never, options)
      : pythonSection.validator,
  };
}

/** Returns a copy of the manifest with fields overridden. */
export function createPythonManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    ...PYTHON_MANIFEST,
    ...overrides,
    keywords: [...(overrides.keywords ?? PYTHON_MANIFEST.keywords!)],
  };
}
