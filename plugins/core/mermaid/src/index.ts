/**
 * MAM Mermaid Plugin
 *
 * Provides Mermaid diagram rendering and validation for MAM modules.
 */

import type { MAMPlugin } from '@mam/plugin-api';
import { MERMAID_MANIFEST, mermaidSection } from './manifest.js';
import { mermaidRule } from './rule.js';
import { mermaidHtmlRenderer, ALL_MERMAID_RENDERERS } from './renderer.js';

export { MERMAID_MANIFEST, mermaidSection, getMermaidSection } from './manifest.js';
export { detectDiagramType, validateMermaidDiagram, countNodes, hasSubgraphs, hasArrows, getDiagramTypeLabel, VALID_DIAGRAM_TYPES } from './validator.js';
export type { MermaidDiagramType, MermaidValidationResult } from './validator.js';
export { mermaidHtmlRenderer, mermaidMarkdownRenderer, mermaidTextRenderer, mermaidJsonRenderer, ALL_MERMAID_RENDERERS } from './renderer.js';
export { mermaidRule, createMermaidRule } from './rule.js';
export { getDiagramInfo, DEFAULT_MERMAID_CONFIG, mergeConfig } from './types.js';
export type { MermaidConfig, MermaidDiagramInfo } from './types.js';

const mermaidPlugin: MAMPlugin = {
  manifest: MERMAID_MANIFEST,
  sections: [mermaidSection],
  rules: [mermaidRule],
  renderers: [mermaidHtmlRenderer, ...ALL_MERMAID_RENDERERS.filter((r) => r.name !== 'mermaid-html')],
};

export default mermaidPlugin;
