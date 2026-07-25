/**
 * MAM Mermaid Plugin
 * 
 * Provides Mermaid diagram rendering and validation for MAM modules.
 */

import { MAMPlugin, PluginManifest, SectionDefinition, ValidationRule, Renderer } from '@mam/plugin-api';

const manifest: PluginManifest = {
  name: '@mam/plugin-mermaid',
  version: '1.0.0',
  description: 'Mermaid diagram renderer and validator for MAM modules',
  author: 'MAM Team',
  license: 'MIT',
  mamVersion: '>=1.0.0',
  keywords: ['mermaid', 'diagram', 'visualization'],
  main: './index.js',
};

const VALID_DIAGRAM_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
  'stateDiagram', 'erDiagram', 'gantt', 'pie', 'gitgraph',
  'mindmap', 'timeline', 'block-beta', 'journey', 'quadrantChart',
];

function detectDiagramType(code: string): string {
  const firstLine = code.trim().split('\n')[0]!.trim();
  for (const dt of VALID_DIAGRAM_TYPES) {
    if (firstLine.startsWith(dt)) return dt;
  }
  return 'unknown';
}

const mermaidSection: SectionDefinition = {
  name: 'Mermaid',
  description: 'Mermaid diagram definition',
  required: false,
  contentTypes: ['diagram'],
  validator: (content) => {
    const results = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        const value = (node as { value: string }).value;
        if (value.trim().length === 0) {
          results.push({ valid: false, message: 'Empty Mermaid diagram' });
          continue;
        }
        const diagramType = detectDiagramType(value);
        if (diagramType === 'unknown') {
          results.push({ valid: false, message: `Unrecognized Mermaid diagram type: "${value.trim().split(/\s/)[0]}"` });
        }
      }
    }
    return results;
  },
};

const mermaidRule: ValidationRule = {
  name: 'valid-mermaid',
  description: 'Validate Mermaid diagram syntax',
  severity: 'warning',
  check: (module) => {
    const results = [];
    for (const section of module.sections) {
      for (const content of section.content) {
        if (content.type === 'CodeBlock' && (content as { language: string }).language === 'mermaid') {
          const value = (content as { value: string }).value;
          if (value.trim().length === 0) {
            results.push({ valid: false, message: 'Empty Mermaid diagram', location: content.location?.start });
          }
        }
      }
    }
    return results;
  },
};

const mermaidRenderer: Renderer = {
  name: 'mermaid-html',
  target: 'html',
  render: (content) => {
    const parts: string[] = ['<div class="mermaid">'];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        parts.push((node as { value: string }).value);
      }
    }
    parts.push('</div>');
    return parts.join('\n');
  },
};

const mermaidPlugin: MAMPlugin = {
  manifest,
  sections: [mermaidSection],
  rules: [mermaidRule],
  renderers: [mermaidRenderer],
};
export default mermaidPlugin;