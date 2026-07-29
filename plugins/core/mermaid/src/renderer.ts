/**
 * Mermaid Plugin - Renderers
 */

import type { Renderer } from '@mam/plugin-api';
import type { ContentNode } from '@mam/ast';
import { detectDiagramType, getDiagramTypeLabel } from './validator.js';

export const mermaidHtmlRenderer: Renderer = {
  name: 'mermaid-html',
  target: 'html',
  render: (content: ContentNode[]) => {
    const parts: string[] = [
      '<div class="mermaid-container">',
      '<style>.mermaid-container { margin: 1em 0; }.mermaid-container .mermaid { text-align: center; }</style>',
    ];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        const value = (node as { value: string }).value;
        parts.push(`<div class="mermaid">${escapeHtml(value)}</div>`);
      }
    }
    parts.push('</div>');
    return parts.join('\n');
  },
};

export const mermaidMarkdownRenderer: Renderer = {
  name: 'mermaid-markdown',
  target: 'markdown',
  render: (content: ContentNode[]) => {
    const parts: string[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        parts.push('```mermaid');
        parts.push((node as { value: string }).value);
        parts.push('```');
      }
    }
    return parts.join('\n');
  },
};

export const mermaidTextRenderer: Renderer = {
  name: 'mermaid-text',
  target: 'text',
  render: (content: ContentNode[]) => {
    const parts: string[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        const value = (node as { value: string }).value;
        const diagramType = detectDiagramType(value);
        parts.push(`[${getDiagramTypeLabel(diagramType)} Diagram]`);
        parts.push(value);
        parts.push('');
      }
    }
    return parts.join('\n');
  },
};

export const mermaidJsonRenderer: Renderer = {
  name: 'mermaid-json',
  target: 'json',
  render: (content: ContentNode[]) => {
    const diagrams: object[] = [];
    for (const node of content) {
      if (node.type === 'CodeBlock' && (node as { language: string }).language === 'mermaid') {
        const value = (node as { value: string }).value;
        diagrams.push({
          type: detectDiagramType(value),
          source: value,
          label: getDiagramTypeLabel(detectDiagramType(value)),
        });
      }
    }
    return JSON.stringify({ diagrams }, null, 2);
  },
};

export const ALL_MERMAID_RENDERERS: Renderer[] = [
  mermaidHtmlRenderer,
  mermaidMarkdownRenderer,
  mermaidTextRenderer,
  mermaidJsonRenderer,
];

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
