/**
 * MAM Mermaid Plugin
 *
 * Provides Mermaid diagram rendering and validation for MAM modules: structural
 * validation that runs without executing Mermaid, four render targets, and a
 * rule family for build-time checks.
 */

import type { MAMPlugin, ValidationRule } from '@mam/plugin-api';
import { MERMAID_MANIFEST, mermaidSection, MERMAID_SECTION_NAME, MERMAID_LIMITS, MERMAID_EXAMPLE } from './manifest.js';
import { MERMAID_RULES, mermaidRule, type MermaidSeverity } from './rule.js';
import { ALL_MERMAID_RENDERERS, mermaidHtmlRenderer } from './renderer.js';
import { normalizeConfig, getAllSupportedTypes, type MermaidConfig } from './types.js';

// ─── Manifest ──────────────────────────────────────────────────────
export {
  MERMAID_MANIFEST,
  mermaidSection,
  getMermaidSection,
  createMermaidManifest,
  validateMermaidContent,
  validateMermaidConfig,
  isSupportedDiagramType,
  getSupportedDiagramTypes,
  MERMAID_SECTION_NAME,
  MERMAID_CONTENT_TYPES,
  MERMAID_LIMITS,
  MERMAID_EXAMPLE,
} from './manifest.js';

// ─── Validator ─────────────────────────────────────────────────────
export {
  VALID_DIAGRAM_TYPES,
  DIAGRAM_TYPE_VARIANTS,
  detectDiagramType,
  getDiagramTypeLabel,
  validateMermaidDiagram,
  validateMermaidDiagram as validateDiagram,
  countNodes,
  countArrows,
  extractNodes,
  extractMermaidBlocks,
  hasArrows,
  hasSubgraphs,
  hasBalancedSubgraphs,
  countUnclosedSubgraphs,
  findSubgraphLines,
  getHeaderLine,
  getCodeLines,
  stripComments,
  filterIssues,
  formatValidationSummary,
} from './validator.js';
export type {
  MermaidDiagramType,
  MermaidDiagramVariant,
  MermaidHeader,
  MermaidIssue,
  MermaidIssueSeverity,
  MermaidValidationResult,
  MermaidValidationOptions,
} from './validator.js';

// ─── Renderers ─────────────────────────────────────────────────────
export {
  ALL_MERMAID_RENDERERS,
  mermaidHtmlRenderer,
  mermaidMarkdownRenderer,
  mermaidTextRenderer,
  mermaidJsonRenderer,
  describeDiagrams,
  renderDiagram,
  renderInitScript,
  renderWith,
  getRenderer,
  getRendererForTarget,
  escapeHtml,
  escapeScriptContent,
} from './renderer.js';
export type { MermaidRenderOptions, RenderedDiagram } from './renderer.js';

// ─── Types & Config ────────────────────────────────────────────────
export {
  DEFAULT_MERMAID_CONFIG,
  DEFAULT_THRESHOLDS,
  DIAGRAM_PRESETS,
  MERMAID_THEMES,
  MERMAID_LOG_LEVELS,
  MERMAID_SECURITY_LEVELS,
  MERMAID_CURVES,
  getDiagramInfo,
  formatDiagramInfo,
  gradeComplexity,
  countStatements,
  longestLine,
  mergeConfig,
  mergeConfigs,
  normalizeConfig,
  validateConfig,
  getPresetForType,
  getConfigForDiagram,
  getAllSupportedTypes,
  stripDiagramComments,
} from './types.js';
export type {
  MermaidConfig,
  MermaidDiagramInfo,
  MermaidComplexity,
  MermaidTheme,
  MermaidLogLevel,
  MermaidSecurityLevel,
  MermaidCurve,
  ComplexityThresholds,
  ConfigIssue,
} from './types.js';

// ─── Rules ─────────────────────────────────────────────────────────
export {
  MERMAID_RULES,
  mermaidRule,
  createMermaidRule,
  createMermaidRules,
  createMermaidValidationRule,
  configureMermaidRules,
  resetMermaidRuleConfig,
  runMermaidRules,
  formatMermaidRuleSummary,
  findMermaidBlocks,
  countMermaidDiagrams,
  emptyDiagramRule,
  unknownTypeRule,
  subgraphRule,
  emptyNodeRule,
  sizeRule,
  complexityRule,
} from './rule.js';
export type { MermaidRuleOptions, MermaidSeverity } from './rule.js';

// ─── Plugin Factory ────────────────────────────────────────────────

import { mermaidSection as section } from './manifest.js';
import { mermaidHtmlRenderer as htmlRenderer, ALL_MERMAID_RENDERERS as renderers } from './renderer.js';
import { MERMAID_RULES as rules } from './rule.js';

export const MERMAID_PLUGIN_VERSION = '0.1.0';

export interface MermaidPluginOptions {
  /** Install the full rule family instead of just the composite rule. */
  allRules?: boolean;
  /** Re-level every installed rule. */
  severity?: MermaidSeverity;
  /** Restrict which render targets are installed. Defaults to all four. */
  targets?: Array<'html' | 'markdown' | 'text' | 'json'>;
  /** Mermaid runtime config baked into the HTML renderer. */
  config?: MermaidConfig;
  /** Manifest fields to override. */
  manifest?: Partial<typeof MERMAID_MANIFEST>;
}

/** Builds a Mermaid plugin with a chosen rule set and render targets. */
export function createMermaidPlugin(options: MermaidPluginOptions = {}): MAMPlugin {
  const installedRules: ValidationRule[] = options.allRules
    ? rules.map((rule) => (options.severity ? { ...rule, severity: options.severity } : { ...rule }))
    : [options.severity ? { ...mermaidRule, severity: options.severity } : mermaidRule];

  const selected = options.targets
    ? renderers.filter((r) => options.targets!.includes(r.target as 'html'))
    : renderers;

  return {
    manifest: { ...MERMAID_MANIFEST, ...options.manifest },
    sections: [section],
    rules: installedRules,
    renderers: options.config
      ? selected.map((r) =>
          r.name === htmlRenderer.name
            ? { ...r, render: (content, renderOptions) => r.render(content, { ...options.config, ...(renderOptions as object) }) }
            : r,
        )
      : selected,
  };
}

/** The default singleton plugin, for callers that just want the plugin. */
export const mermaidPlugin: MAMPlugin = {
  manifest: MERMAID_MANIFEST,
  sections: [section],
  rules: [mermaidRule],
  renderers: [htmlRenderer, ...renderers.filter((r) => r.name !== htmlRenderer.name)],
};

export interface MermaidApi {
  version: string;
  sectionName: string;
  rules: ValidationRule[];
  renderers: typeof ALL_MERMAID_RENDERERS;
  config: MermaidConfig;
  supportedTypes: string[];
  limits: typeof MERMAID_LIMITS;
  example: string;
  /** Renders content for a target. */
  render(target: string, content: Parameters<typeof htmlRenderer.render>[0]): string | undefined;
}

/**
 * Bundles renderers, rules and config behind one object.
 *
 * For hosts that want to render Mermaid without the full plugin wiring, such
 * as a docs generator or a CLI preview.
 */
export function createMermaidApi(config: MermaidConfig = {}): MermaidApi {
  const resolved = normalizeConfig(config);
  return {
    version: MERMAID_PLUGIN_VERSION,
    sectionName: MERMAID_SECTION_NAME,
    rules: [...MERMAID_RULES],
    renderers: ALL_MERMAID_RENDERERS,
    config: resolved,
    supportedTypes: getAllSupportedTypes(),
    limits: { ...MERMAID_LIMITS },
    example: MERMAID_EXAMPLE,
    render(target, content) {
      return ALL_MERMAID_RENDERERS.find((r) => r.target === target)?.render(content, resolved);
    },
  };
}

/** One-line summary of the plugin's surface, for diagnostics. */
export function describeMermaidPlugin(): string {
  const types = getAllSupportedTypes().length;
  return `MAM Mermaid Plugin v${MERMAID_PLUGIN_VERSION} — ${types} diagram types, ` +
    `${MERMAID_RULES.length} rules, ${ALL_MERMAID_RENDERERS.length} renderers`;
}

export default mermaidPlugin;
