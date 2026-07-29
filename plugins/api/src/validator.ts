/**
 * MAM Plugin Manifest Validator
 *
 * Validates plugin manifests against the schema.
 */

import type { MAMPlugin, PluginManifest, ValidationResult } from './types.js';

export interface ManifestValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePluginManifest(manifest: PluginManifest): ManifestValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest.name) errors.push('Plugin name is required');
  if (!manifest.version) errors.push('Plugin version is required');
  if (!manifest.description) errors.push('Plugin description is required');
  if (!manifest.author) errors.push('Plugin author is required');
  if (!manifest.license) errors.push('Plugin license is required');
  if (!manifest.main) errors.push('Plugin main entry is required');

  if (manifest.name && !/^[a-zA-Z@][a-zA-Z0-9/_-]*$/.test(manifest.name)) {
    errors.push(`Invalid plugin name format: "${manifest.name}"`);
  }

  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`Invalid version format (expected semver): "${manifest.version}"`);
  }

  if (manifest.keywords && manifest.keywords.length > 20) {
    warnings.push('Too many keywords (max 20 recommended)');
  }

  if (manifest.description && manifest.description.length > 200) {
    warnings.push('Description is very long (max 200 chars recommended)');
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validatePluginIntegrity(plugin: MAMPlugin): ValidationResult[] {
  const results: ValidationResult[] = [];
  const manifest = plugin.manifest;

  if (plugin.sections) {
    for (const section of plugin.sections) {
      if (!section.name) {
        results.push({ valid: false, message: 'Section definition missing name' });
      }
      if (!section.contentTypes || section.contentTypes.length === 0) {
        results.push({ valid: false, message: `Section "${section.name}" has no content types` });
      }
    }
  }

  if (plugin.rules) {
    for (const rule of plugin.rules) {
      if (!rule.name) {
        results.push({ valid: false, message: 'Validation rule missing name' });
      }
      if (typeof rule.check !== 'function') {
        results.push({ valid: false, message: `Rule "${rule.name}" check is not a function` });
      }
    }
  }

  if (plugin.contexts) {
    for (const ctx of plugin.contexts) {
      if (!ctx.name) {
        results.push({ valid: false, message: 'Runtime context missing name' });
      }
      if (typeof ctx.execute !== 'function') {
        results.push({ valid: false, message: `Context "${ctx.name}" execute is not a function` });
      }
      if (typeof ctx.canHandle !== 'function') {
        results.push({ valid: false, message: `Context "${ctx.name}" canHandle is not a function` });
      }
    }
  }

  if (plugin.renderers) {
    for (const renderer of plugin.renderers) {
      if (!renderer.name) {
        results.push({ valid: false, message: 'Renderer missing name' });
      }
      if (typeof renderer.render !== 'function') {
        results.push({ valid: false, message: `Renderer "${renderer.name}" render is not a function` });
      }
    }
  }

  if (plugin.exporters) {
    for (const exporter of plugin.exporters) {
      if (!exporter.name) {
        results.push({ valid: false, message: 'Exporter missing name' });
      }
      if (typeof exporter.export !== 'function') {
        results.push({ valid: false, message: `Exporter "${exporter.name}" export is not a function` });
      }
    }
  }

  return results;
}

export function getPluginStats(plugin: MAMPlugin) {
  return {
    name: plugin.manifest.name,
    version: plugin.manifest.version,
    sections: plugin.sections?.length || 0,
    rules: plugin.rules?.length || 0,
    hooks: plugin.hooks ? Object.keys(plugin.hooks).length : 0,
    contexts: plugin.contexts?.length || 0,
    renderers: plugin.renderers?.length || 0,
    exporters: plugin.exporters?.length || 0,
  };
}
