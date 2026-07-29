/**
 * Mermaid Plugin - Manifest & Section Definition
 */

import type { PluginManifest, SectionDefinition, ValidationResult } from '@mam/plugin-api';
import { detectDiagramType, VALID_DIAGRAM_TYPES } from './validator.js';

export const MERMAID_MANIFEST: PluginManifest = {
  name: '@mam/plugin-mermaid',
  version: '1.0.0',
  description: 'Mermaid diagram renderer and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['mermaid', 'diagram', 'visualization'],
  main: './index.js',
};

export const mermaidSection: SectionDefinition = {
  name: 'Mermaid',
  description: 'Mermaid diagram definition',
  required: false,
  contentTypes: ['diagram'],
  validator: (content) => {
    const results: ValidationResult[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        const value = (node as { value: string }).value;
        if (value.trim().length === 0) {
          results.push({ valid: false, message: 'Empty Mermaid diagram' });
          continue;
        }
        const diagramType = detectDiagramType(value);
        if (diagramType === 'unknown') {
          results.push({
            valid: false,
            message: `Unrecognized Mermaid diagram type: "${value.trim().split(/\s/)[0]}"`,
          });
        }
      }
    }
    return results;
  },
};

export function getMermaidSection(): SectionDefinition {
  return { ...mermaidSection };
}
