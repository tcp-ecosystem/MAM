/**
 * MAM Plugin Validator
 *
 * Comprehensive validation for plugin manifests, integrity,
 * compatibility, and runtime contracts.
 */

import type { MAMPlugin, PluginManifest, ValidationResult } from './types.js';

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

export interface PluginIntegrityReport {
  valid: boolean;
  pluginName: string;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  stats: PluginIntegrityStats;
}

export interface PluginIntegrityStats {
  sections: number;
  rules: number;
  hooks: number;
  contexts: number;
  renderers: number;
  exporters: number;
  transformers: number;
  middleware: number;
}

const REQUIRED_FIELDS: Array<{ field: keyof PluginManifest; label: string }> = [
  { field: 'name', label: 'Plugin name' },
  { field: 'version', label: 'Plugin version' },
  { field: 'description', label: 'Plugin description' },
  { field: 'author', label: 'Plugin author' },
  { field: 'license', label: 'Plugin license' },
  { field: 'main', label: 'Plugin main entry' },
];

const NAME_PATTERN = /^[a-zA-Z@][a-zA-Z0-9/_-]*$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const VALID_SEVERITIES = ['error', 'warning', 'info'] as const;
const VALID_CONTENT_TYPES = ['text', 'list', 'code', 'table', 'diagram', 'mixed'] as const;
const VALID_RENDER_TARGETS = ['html', 'markdown', 'json', 'text', 'svg', 'pdf'] as const;

// ─── Manifest Validation ────────────────────────────────────────────

export function validatePluginManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  for (const { field, label } of REQUIRED_FIELDS) {
    if (!manifest[field]) {
      errors.push(`${label} is required`);
    }
  }

  if (manifest.name) {
    if (!NAME_PATTERN.test(manifest.name)) {
      errors.push(`Invalid plugin name format: "${manifest.name}"`);
    }
    if (manifest.name.length > 128) {
      errors.push('Plugin name too long (max 128 characters)');
    }
    if (manifest.name.startsWith('@mam/')) {
      info.push('Scoped under @mam/ namespace');
    }
  }

  if (manifest.version) {
    if (!VERSION_PATTERN.test(manifest.version)) {
      errors.push(`Invalid version format (expected semver): "${manifest.version}"`);
    }
  }

  if (manifest.description && manifest.description.length > 512) {
    warnings.push('Description is very long (max 512 chars recommended)');
  }

  if (manifest.keywords) {
    if (manifest.keywords.length > 30) {
      warnings.push('Too many keywords (max 30 recommended)');
    }
    const dupes = manifest.keywords.filter((k, i) => manifest.keywords!.indexOf(k) !== i);
    if (dupes.length > 0) {
      warnings.push(`Duplicate keywords: ${dupes.join(', ')}`);
    }
  }

  if (manifest.dependencies) {
    for (const dep of manifest.dependencies) {
      if (!NAME_PATTERN.test(dep)) {
        errors.push(`Invalid dependency name: "${dep}"`);
      }
    }
    if (manifest.dependencies.length > 20) {
      warnings.push('Many dependencies — consider if all are necessary');
    }
  }

  if (manifest.license) {
    const spdx = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'UNLICENSED'];
    if (!spdx.includes(manifest.license)) {
      warnings.push(`Non-standard license identifier: "${manifest.license}"`);
    }
  }

  if (manifest.main) {
    if (!manifest.main.endsWith('.js') && !manifest.main.endsWith('.mjs')) {
      warnings.push(`Main entry "${manifest.main}" does not appear to be a JS file`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, info };
}

// ─── Plugin Integrity Validation ────────────────────────────────────

export function validatePluginIntegrity(plugin: MAMPlugin): PluginIntegrityReport {
  const errors: ValidationResult[] = [];
  const warnings: ValidationResult[] = [];
  const manifest = plugin.manifest;

  // Validate sections
  if (plugin.sections) {
    for (let i = 0; i < plugin.sections.length; i++) {
      const section = plugin.sections[i]!;
      if (!section.name) {
        errors.push({ valid: false, message: `Section at index ${i} missing name` });
      } else if (section.name.length > 64) {
        warnings.push({ valid: true, message: `Section "${section.name}" name is very long` });
      }
      if (!section.contentTypes || section.contentTypes.length === 0) {
        errors.push({ valid: false, message: `Section "${section.name}" has no content types` });
      } else {
        for (const ct of section.contentTypes) {
          if (!VALID_CONTENT_TYPES.includes(ct as any)) {
            errors.push({ valid: false, message: `Section "${section.name}" has invalid content type: "${ct}"` });
          }
        }
      }
      if (typeof section.validator === 'function') {
        try { section.validator([]); } catch (e) {
          errors.push({ valid: false, message: `Section "${section.name}" validator throws: ${(e as Error).message}` });
        }
      }
    }
  }

  // Validate rules
  if (plugin.rules) {
    for (const rule of plugin.rules) {
      if (!rule.name) {
        errors.push({ valid: false, message: 'Validation rule missing name' });
      } else if (rule.name.length > 64) {
        warnings.push({ valid: true, message: `Rule "${rule.name}" name is very long` });
      }
      if (!VALID_SEVERITIES.includes(rule.severity as any)) {
        errors.push({ valid: false, message: `Rule "${rule.name}" has invalid severity: "${rule.severity}"` });
      }
      if (typeof rule.check !== 'function') {
        errors.push({ valid: false, message: `Rule "${rule.name}" check is not a function` });
      }
    }
  }

  // Validate contexts
  if (plugin.contexts) {
    for (const ctx of plugin.contexts) {
      if (!ctx.name) {
        errors.push({ valid: false, message: 'Runtime context missing name' });
      }
      if (!ctx.language) {
        errors.push({ valid: false, message: `Context "${ctx.name}" missing language` });
      }
      if (typeof ctx.execute !== 'function') {
        errors.push({ valid: false, message: `Context "${ctx.name}" execute is not a function` });
      }
      if (typeof ctx.canHandle !== 'function') {
        errors.push({ valid: false, message: `Context "${ctx.name}" canHandle is not a function` });
      }
    }
  }

  // Validate renderers
  if (plugin.renderers) {
    for (const renderer of plugin.renderers) {
      if (!renderer.name) {
        errors.push({ valid: false, message: 'Renderer missing name' });
      }
      if (!VALID_RENDER_TARGETS.includes(renderer.target as any)) {
        errors.push({ valid: false, message: `Renderer "${renderer.name}" has invalid target: "${renderer.target}"` });
      }
      if (typeof renderer.render !== 'function') {
        errors.push({ valid: false, message: `Renderer "${renderer.name}" render is not a function` });
      }
    }
  }

  // Validate exporters
  if (plugin.exporters) {
    for (const exporter of plugin.exporters) {
      if (!exporter.name) {
        errors.push({ valid: false, message: 'Exporter missing name' });
      }
      if (!exporter.format) {
        errors.push({ valid: false, message: `Exporter "${exporter.name}" missing format` });
      }
      if (!exporter.extension) {
        warnings.push({ valid: true, message: `Exporter "${exporter.name}" missing extension` });
      }
      if (typeof exporter.export !== 'function') {
        errors.push({ valid: false, message: `Exporter "${exporter.name}" export is not a function` });
      }
    }
  }

  // Validate transformers
  if (plugin.transformers) {
    for (const tf of plugin.transformers) {
      if (!tf.name) {
        errors.push({ valid: false, message: 'Transformer missing name' });
      }
      if (typeof tf.transform !== 'function') {
        errors.push({ valid: false, message: `Transformer "${tf.name}" transform is not a function` });
      }
      if (typeof tf.canTransform !== 'function') {
        errors.push({ valid: false, message: `Transformer "${tf.name}" canTransform is not a function` });
      }
    }
  }

  // Validate hooks
  const hookErrors = validateHooks(plugin);
  errors.push(...hookErrors.filter((r) => !r.valid));
  warnings.push(...hookErrors.filter((r) => r.valid && r.message?.includes('warn')));

  // Validate manifest
  const manifestResult = validatePluginManifest(manifest);
  for (const err of manifestResult.errors) {
    errors.push({ valid: false, message: err });
  }
  for (const warn of manifestResult.warnings) {
    warnings.push({ valid: true, message: warn });
  }

  return {
    valid: errors.length === 0,
    pluginName: manifest.name,
    errors,
    warnings,
    stats: getPluginStats(plugin),
  };
}

function validateHooks(plugin: MAMPlugin): ValidationResult[] {
  const results: ValidationResult[] = [];
  if (!plugin.hooks) return results;

  const validHooks = [
    'beforeParse', 'afterParse', 'beforeValidation', 'afterValidation',
    'beforeExecution', 'afterExecution', 'beforeExport', 'afterExport',
    'onError', 'onSection', 'onCodeBlock',
  ];

  for (const [key, value] of Object.entries(plugin.hooks)) {
    if (!validHooks.includes(key)) {
      results.push({ valid: true, message: `Unknown hook: "${key}"`, severity: 'info' });
    }
    if (typeof value !== 'function') {
      results.push({ valid: false, message: `Hook "${key}" is not a function` });
    }
  }
  return results;
}

// ─── Stats ──────────────────────────────────────────────────────────

export function getPluginStats(plugin: MAMPlugin): PluginIntegrityStats {
  return {
    sections: plugin.sections?.length || 0,
    rules: plugin.rules?.length || 0,
    hooks: plugin.hooks ? Object.keys(plugin.hooks).filter((k) => typeof (plugin.hooks as any)[k] === 'function').length : 0,
    contexts: plugin.contexts?.length || 0,
    renderers: plugin.renderers?.length || 0,
    exporters: plugin.exporters?.length || 0,
    transformers: plugin.transformers?.length || 0,
    middleware: plugin.middleware?.length || 0,
  };
}

export function formatIntegrityReport(report: PluginIntegrityReport): string {
  const lines: string[] = [
    `Plugin: ${report.pluginName}`,
    `Valid: ${report.valid ? 'Yes' : 'No'}`,
    `Errors: ${report.errors.length}`,
    `Warnings: ${report.warnings.length}`,
    '',
    'Stats:',
    `  Sections: ${report.stats.sections}`,
    `  Rules: ${report.stats.rules}`,
    `  Hooks: ${report.stats.hooks}`,
    `  Contexts: ${report.stats.contexts}`,
    `  Renderers: ${report.stats.renderers}`,
    `  Exporters: ${report.stats.exporters}`,
    `  Transformers: ${report.stats.transformers}`,
    `  Middleware: ${report.stats.middleware}`,
  ];

  if (report.errors.length > 0) {
    lines.push('', 'Errors:');
    for (const err of report.errors) {
      lines.push(`  - ${err.message}`);
    }
  }

  if (report.warnings.length > 0) {
    lines.push('', 'Warnings:');
    for (const warn of report.warnings) {
      lines.push(`  - ${warn.message}`);
    }
  }

  return lines.join('\n');
}
