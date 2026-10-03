/**
 * Mermaid Plugin - Renderers
 *
 * Emits Mermaid diagrams for the HTML, Markdown, text and JSON targets.
 *
 * The HTML target produces a self-contained block: the diagram source, the
 * `mermaid.initialize` call Mermaid needs before it will draw anything, and a
 * unique id per diagram so several diagrams on one page cannot collide.
 */

import type { Renderer } from '@mam/plugin-api';
import type { ContentNode } from '@mam/ast';
import {
  detectDiagramType, getDiagramTypeLabel, validateMermaidDiagram, extractMermaidBlocks,
  type MermaidHeader, type MermaidValidationResult,
} from './validator.js';
import { getDiagramInfo, normalizeConfig, mergeConfig, DEFAULT_MERMAID_CONFIG, type MermaidConfig, type MermaidDiagramInfo } from './types.js';

export interface MermaidRenderOptions extends MermaidConfig {
  /** Container class name. Default `mermaid-container`. */
  containerClass?: string;
  /** Include the `mermaid.initialize` script. Default true. */
  includeInit?: boolean;
  /** Inline the theme via `data-theme` for dark-mode aware renderers. */
  applyTheme?: boolean;
  /** Prefix for generated diagram ids. Default `mam-diagram`. */
  idPrefix?: string;
  /** Return a placeholder for a diagram that fails validation. Default true. */
  placeholderOnError?: boolean;
}

const DEFAULTS: MermaidRenderOptions = {
  containerClass: 'mermaid-container',
  includeInit: true,
  applyTheme: true,
  idPrefix: 'mam-diagram',
  placeholderOnError: true,
};

/**
 * Escapes text for interpolation into HTML.
 *
 * Covers the single quote as well: diagram text lands inside a
 * `data-diagram-source='...'` attribute, where an unescaped apostrophe would
 * end the attribute early.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escapes a string for safe use inside a `<script>` block. */
export function escapeScriptContent(str: string): string {
  // Closes the script element if the payload ever contains one.
  return str.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--');
}

const RENDER_OPTION_KEYS = [
  'containerClass', 'includeInit', 'applyTheme', 'idPrefix', 'placeholderOnError',
] as const;

/** Extracts the config fields that are Mermaid settings, not render options. */
function splitOptions(options: MermaidRenderOptions): MermaidConfig {
  const config: Record<string, unknown> = { ...(options as unknown as Record<string, unknown>) };
  for (const key of RENDER_OPTION_KEYS) delete config[key];
  return config as MermaidConfig;
}

/** Builds the `<script>` block that configures Mermaid in the host page. */
export function renderInitScript(config: MermaidConfig): string {
  const json = JSON.stringify(config, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return [
    '<script>',
    'if (window.mermaid && !window.mermaid.__mamInitialised) {',
    `  window.mermaid.initialize(${json});`,
    '  window.mermaid.__mamInitialised = true;',
    '}',
    '</script>',
  ].join('\n');
}

export interface RenderedDiagram {
  index: number;
  id: string;
  type: MermaidHeader;
  label: string;
  source: string;
  validation: MermaidValidationResult;
  info: MermaidDiagramInfo;
}

/** Validates and measures every diagram in a content list. */
export function describeDiagrams(content: ContentNode[]): RenderedDiagram[] {
  return extractMermaidBlocks(content).map((source, index) => ({
    index,
    id: `${DEFAULTS.idPrefix}-${index}`,
    type: detectDiagramType(source),
    label: getDiagramTypeLabel(detectDiagramType(source)),
    source,
    validation: validateMermaidDiagram(source),
    info: getDiagramInfo(source),
  }));
}

const STYLE_BLOCK = [
  '<style>',
  '.mermaid-container { margin: 1em 0; }',
  '.mermaid-container .mermaid { text-align: center; }',
  '.mermaid-container .mermaid-error {',
  '  border-left: 3px solid #d33; padding: 0.5em 1em;',
  '  font-family: monospace; white-space: pre-wrap;',
  '}',
  '.mermaid-container .mermaid-figure { margin: 0 0 1em; }',
  '.mermaid-container figcaption { font-size: 0.875em; opacity: 0.8; }',
  '</style>',
].join('\n');

/**
 * Deep-merges render options while keeping the render-option fields.
 *
 * `mergeConfig` is typed to `MermaidConfig`, which would drop `containerClass`
 * and the rest at the type level even though they are present at runtime.
 */
function mergeRenderOptions(
  base: MermaidRenderOptions,
  override: Partial<MermaidRenderOptions>,
): MermaidRenderOptions {
  return mergeConfig(base as MermaidConfig, override as Partial<MermaidConfig>) as MermaidRenderOptions;
}

/** Renders one diagram as a figure, or an error placeholder when invalid. */
export function renderDiagram(
  diagram: RenderedDiagram,
  options: MermaidRenderOptions = {},
): string {
  const opts = { ...DEFAULTS, ...options };
  const themeAttr = opts.applyTheme && opts.theme
    ? ` data-theme="${escapeHtml(String(opts.theme))}"`
    : '';

  if (!diagram.validation.valid && opts.placeholderOnError) {
    const reason = diagram.validation.message ?? 'Unknown problem';
    return [
      `<figure class="mermaid-figure"${themeAttr}>`,
      `<div class="mermaid-error" role="alert">${escapeHtml(reason)}</div>`,
      `<pre class="mermaid">${escapeHtml(diagram.source)}</pre>`,
      '</figure>',
    ].join('\n');
  }

  return [
    `<figure class="mermaid-figure"${themeAttr}>`,
    `<div class="mermaid" id="${escapeHtml(diagram.id)}" data-diagram-type="${escapeHtml(diagram.type)}" data-diagram-index="${diagram.index}">${escapeHtml(diagram.source)}</div>`,
    `<figcaption>${escapeHtml(diagram.label)} (${diagram.info.nodeCount} nodes)</figcaption>`,
    '</figure>',
  ].join('\n');
}

// ─── Renderers ────────────────────────────────────────────────────

export const mermaidHtmlRenderer: Renderer = {
  name: 'mermaid-html',
  target: 'html',
  getStyles: () => STYLE_BLOCK,
  getScripts: () => [renderInitScript(normalizeConfig(splitOptions(DEFAULTS)))],
  render: (content: ContentNode[], renderOptions?: unknown) => {
    const options = mergeRenderOptions(DEFAULTS, (renderOptions ?? {}) as MermaidRenderOptions);
    const diagrams = describeDiagrams(content);
    const config = normalizeConfig(splitOptions(options));

    const parts: string[] = [`<div class="${escapeHtml(options.containerClass!)}">`];
    if (diagrams.length === 0) {
      parts.push('<p class="mermaid-empty">No Mermaid diagrams to render.</p>');
      parts.push('</div>');
      return parts.join('\n');
    }

    parts.push(STYLE_BLOCK);
    if (options.includeInit) parts.push(renderInitScript(config));
    parts.push('<div class="mermaid-errors" hidden></div>');
    for (const diagram of diagrams) {
      parts.push(renderDiagram(diagram, options));
    }
    parts.push(
      '<script>',
      'window.addEventListener("error", function (e) {',
      '  var box = document.currentScript && document.currentScript.previousElementSibling;',
      '  var holder = document.querySelector("' + options.containerClass + ' .mermaid-errors");',
      '  if (holder && box) { box.hidden = false; box.textContent = String(e.message); }',
      '});',
      '</script>',
    );
    parts.push('</div>');
    return parts.join('\n');
  },
};

export const mermaidMarkdownRenderer: Renderer = {
  name: 'mermaid-markdown',
  target: 'markdown',
  render: (content: ContentNode[]) => {
    const diagrams = describeDiagrams(content);
    if (diagrams.length === 0) return '';
    return diagrams
      .map((d) => `<!-- ${d.label}, ${d.info.nodeCount} nodes -->\n\`\`\`mermaid\n${d.source}\n\`\`\``)
      .join('\n\n');
  },
};

export const mermaidTextRenderer: Renderer = {
  name: 'mermaid-text',
  target: 'text',
  render: (content: ContentNode[]) => {
    const diagrams = describeDiagrams(content);
    return diagrams
      .map((d) => {
        const stats = `${d.info.nodeCount} nodes, ${d.info.arrowCount} edges`;
        return `[${d.label}] (${stats})\n${d.source}`;
      })
      .join('\n\n');
  },
};

export const mermaidJsonRenderer: Renderer = {
  name: 'mermaid-json',
  target: 'json',
  render: (content: ContentNode[]) => {
    const diagrams = describeDiagrams(content).map((d) => ({
      index: d.index,
      id: d.id,
      type: d.type,
      label: d.label,
      source: d.source,
      valid: d.validation.valid,
      issues: d.validation.issues,
      info: d.info,
    }));
    return JSON.stringify({ version: 1, count: diagrams.length, diagrams }, null, 2);
  },
};

export const ALL_MERMAID_RENDERERS: Renderer[] = [
  mermaidHtmlRenderer,
  mermaidMarkdownRenderer,
  mermaidTextRenderer,
  mermaidJsonRenderer,
];

/** Returns a renderer by name. */
export function getRenderer(name: string): Renderer | undefined {
  return ALL_MERMAID_RENDERERS.find((r) => r.name === name);
}

/** Returns a renderer for a render target. */
export function getRendererForTarget(target: string): Renderer | undefined {
  return ALL_MERMAID_RENDERERS.find((r) => r.target === target);
}

/** Renders content with a named renderer. */
export function renderWith(name: string, content: ContentNode[]): string | undefined {
  return getRenderer(name)?.render(content) as string | undefined;
}

export { DEFAULT_MERMAID_CONFIG };
