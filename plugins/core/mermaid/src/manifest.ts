/**
 * Mermaid Plugin - Manifest & Section Definition
 *
 * Declares what the plugin provides and validates Mermaid blocks before a
 * renderer ever tries to draw them.
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import {
  detectDiagramType, validateMermaidDiagram, getDiagramTypeLabel,
  VALID_DIAGRAM_TYPES, DIAGRAM_TYPE_VARIANTS,
  type MermaidHeader, type MermaidValidationOptions,
} from './validator.js';
import { MERMAID_THEMES, validateConfig, type MermaidConfig } from './types.js';

/** The section this plugin owns. */
export const MERMAID_SECTION_NAME = 'Mermaid';

/**
 * `mamVersion` was `>=1.0.0` while the API package this plugin compiles against
 * is `0.1.0`, so the requirement could never be satisfied. `main` pointed at
 * `./index.js`, but the package only ships `dist`.
 */
export const MERMAID_MANIFEST: PluginManifest = {
  name: '@mam/plugin-mermaid',
  version: '0.1.0',
  description: 'Mermaid diagram renderer and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=0.1.0',
  keywords: ['mermaid', 'diagram', 'visualization'],
  main: './dist/index.js',
};

export const MERMAID_CONTENT_TYPES = ['diagram', 'code'] as const;

/** Diagram-size limits enforced by the section validator. */
export const MERMAID_LIMITS = {
  maxLines: 500,
  maxNodes: 200,
} as const;

/** A worked example used by docs and the default export. */
export const MERMAID_EXAMPLE = `\`\`\`mermaid
flowchart TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Ship it]
  B -->|No| A
\`\`\``;

/** Every diagram header this plugin recognises. */
export function getSupportedDiagramTypes(): MermaidHeader[] {
  return [...VALID_DIAGRAM_TYPES, ...DIAGRAM_TYPE_VARIANTS];
}

/** Returns true when a header names a diagram type Mermaid supports. */
export function isSupportedDiagramType(type: string): type is MermaidHeader {
  return (VALID_DIAGRAM_TYPES as readonly string[]).includes(type)
    || (DIAGRAM_TYPE_VARIANTS as readonly string[]).includes(type);
}

/**
 * Validates Mermaid code blocks in a section.
 *
 * Delegates to the shared validator so the section check and the rule family
 * agree; a block that would not render is reported before it reaches a
 * renderer that can only emit broken output.
 */
export function validateMermaidContent(
  content: Array<{ type?: string; language?: string; value?: string }>,
  limits: Partial<typeof MERMAID_LIMITS> = {},
): ValidationResult[] {
  const maxLines = limits.maxLines ?? MERMAID_LIMITS.maxLines;
  const maxNodes = limits.maxNodes ?? MERMAID_LIMITS.maxNodes;
  const results: ValidationResult[] = [];

  const options: MermaidValidationOptions = { maxLines, maxNodes };

  for (const node of content) {
    if (node.type !== 'CodeBlock' || node.language !== 'mermaid') continue;
    const value = node.value ?? '';
    const validation = validateMermaidDiagram(value, options);

    for (const issue of validation.issues) {
      results.push({
        valid: issue.severity !== 'error',
        message: issue.message,
        severity: issue.severity,
        rule: `mermaid-${issue.code}`,
      });
    }

    // A diagram with an unrecognised header cannot be drawn at all, so name
    // the closest supported type rather than just saying it is unknown.
    if (validation.diagramType === 'unknown' && value.trim().length > 0) {
      results.push({
        valid: false,
        message: `Unsupported Mermaid diagram type: "${value.trim().split(/\s/)[0]}"`,
        severity: 'error',
        rule: 'mermaid-unsupported-type',
      });
    }
  }
  return results;
}

export const mermaidSection: SectionDefinition = {
  name: MERMAID_SECTION_NAME,
  description: 'Mermaid diagram definition',
  required: false,
  contentTypes: [...MERMAID_CONTENT_TYPES],
  validator: (content) => validateMermaidContent(content as never),
};

/** Returns a copy of the section definition, with limits overridden. */
export function getMermaidSection(
  limits?: Partial<typeof MERMAID_LIMITS>,
): SectionDefinition {
  return {
    ...mermaidSection,
    contentTypes: [...MERMAID_CONTENT_TYPES],
    validator: limits
      ? (content) => validateMermaidContent(content as never, limits)
      : mermaidSection.validator,
  };
}

/** Returns a copy of the manifest with fields overridden. */
export function createMermaidManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    ...MERMAID_MANIFEST,
    ...overrides,
    keywords: [...(overrides.keywords ?? MERMAID_MANIFEST.keywords!)],
  };
}

/**
 * Validates a host's Mermaid config.
 *
 * Exposed from the manifest so a host can check its config through the
 * plugin's entry point without reaching into the type module.
 */
export function validateMermaidConfig(config: MermaidConfig): ValidationResult[] {
  return validateConfig(config).map((issue) => ({
    valid: false,
    message: `${issue.path}: ${issue.message}`,
    severity: 'error' as const,
    rule: 'mermaid-config',
  }));
}

export { MERMAID_THEMES, detectDiagramType, getDiagramTypeLabel };
