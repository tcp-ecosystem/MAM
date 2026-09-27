/**
 * MAM Plugins Section Node
 *
 * Defines the PluginsNode and related types for the Plugins section.
 * A plugin reference describes an extension that augments the module's
 * capabilities, including version constraints and runtime configuration.
 */

import { SourceLocation } from '../location/index.js';

// ============================================================================
// Types
// ============================================================================

/** Plugin source origin. */
export type PluginSource =
  | 'npm'
  | 'pip'
  | 'registry'
  | 'local'
  | 'url'
  | string;

/** A single plugin reference. */
export interface PluginRef {
  /** Plugin name. */
  name: string;
  /** Semver constraint or version string. */
  version?: string;
  /** Plugin configuration (key-value pairs). */
  config?: Record<string, unknown>;
  /** Whether the plugin is enabled. Defaults to `true`. */
  enabled?: boolean;
  /** Plugin source/origin. */
  source?: PluginSource;
  /** Human-readable description of the plugin. */
  description?: string;
  /** Capabilities provided by the plugin. */
  capabilities?: string[];
  /** Plugins that this plugin requires. */
  dependencies?: string[];
}

/** The Plugins section AST node. */
export interface PluginsNode {
  /** Discriminant – always `'Plugins'`. */
  type: 'Plugins';
  /** Source location of the section. */
  location?: SourceLocation;
  /** Ordered list of plugin references. */
  plugins: PluginRef[];
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationError {
  path: string;
  message: string;
}

/**
 * Validate a PluginsNode.
 * Returns an empty array when the node is valid.
 */
export function validatePluginsNode(node: PluginsNode): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!node || typeof node !== 'object') {
    errors.push({ path: '', message: 'PluginsNode must be an object.' });
    return errors;
  }

  if (node.type !== 'Plugins') {
    errors.push({ path: 'type', message: `Expected type "Plugins", got "${node.type}".` });
  }

  if (!Array.isArray(node.plugins)) {
    errors.push({ path: 'plugins', message: 'plugins must be an array.' });
    return errors;
  }

  const seen = new Set<string>();
  node.plugins.forEach((plugin, idx) => {
    const base = `plugins[${idx}]`;

    if (!plugin.name || typeof plugin.name !== 'string') {
      errors.push({ path: `${base}.name`, message: 'Plugin name must be a non-empty string.' });
    } else if (seen.has(plugin.name)) {
      errors.push({ path: `${base}.name`, message: `Duplicate plugin "${plugin.name}".` });
    } else {
      seen.add(plugin.name);
    }

    if (plugin.version !== undefined && typeof plugin.version !== 'string') {
      errors.push({ path: `${base}.version`, message: 'version must be a string.' });
    }

    if (plugin.enabled !== undefined && typeof plugin.enabled !== 'boolean') {
      errors.push({ path: `${base}.enabled`, message: 'enabled must be a boolean.' });
    }

    if (plugin.config !== undefined && typeof plugin.config !== 'object') {
      errors.push({ path: `${base}.config`, message: 'config must be an object.' });
    }
  });

  return errors;
}

// ============================================================================
// Factory
// ============================================================================

export interface CreatePluginsNodeOptions {
  plugins?: PluginRef[];
  location?: SourceLocation;
}

/** Create a PluginsNode with sensible defaults. */
export function createPluginsNode(options: CreatePluginsNodeOptions = {}): PluginsNode {
  return {
    type: 'Plugins',
    plugins: options.plugins ?? [],
    location: options.location,
  };
}

/** Create a single PluginRef. */
export function createPluginRef(
  name: string,
  overrides: Partial<Omit<PluginRef, 'name'>> = {},
): PluginRef {
  return {
    name,
    enabled: true,
    ...overrides,
  };
}

// ============================================================================
// Type Guard
// ============================================================================

/** Type-guard that returns `true` when `value` is a PluginsNode. */
export function isPluginsNode(value: unknown): value is PluginsNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PluginsNode).type === 'Plugins' &&
    Array.isArray((value as PluginsNode).plugins)
  );
}

// ============================================================================
// Utilities
// ============================================================================

/** Return all plugin names. */
export function getPluginNames(node: PluginsNode): string[] {
  return node.plugins.map((p) => p.name);
}

/** Find a plugin by name. */
export function findPluginByName(node: PluginsNode, name: string): PluginRef | undefined {
  return node.plugins.find((p) => p.name === name);
}

/** Filter plugins by source. */
export function getPluginsBySource(node: PluginsNode, source: PluginSource): PluginRef[] {
  return node.plugins.filter((p) => p.source === source);
}

/** Return only enabled plugins. */
export function getEnabledPlugins(node: PluginsNode): PluginRef[] {
  return node.plugins.filter((p) => p.enabled !== false);
}

/** Return only disabled plugins. */
export function getDisabledPlugins(node: PluginsNode): PluginRef[] {
  return node.plugins.filter((p) => p.enabled === false);
}

/** Collect all capabilities across enabled plugins. */
export function getEnabledPluginCapabilities(node: PluginsNode): string[] {
  const caps: string[] = [];
  for (const plugin of node.plugins) {
    if (plugin.enabled !== false && plugin.capabilities) {
      caps.push(...plugin.capabilities);
    }
  }
  return caps;
}

/** Check whether a specific plugin is enabled. */
export function isPluginEnabled(node: PluginsNode, name: string): boolean {
  const plugin = findPluginByName(node, name);
  return plugin !== undefined && plugin.enabled !== false;
}

/** Check whether a specific plugin name exists. */
export function hasPlugin(node: PluginsNode, name: string): boolean {
  return node.plugins.some((p) => p.name === name);
}

/** Count total plugins. */
export function countPlugins(node: PluginsNode): number {
  return node.plugins.length;
}

export function hasPlugins(node: PluginsNode): boolean {
  return node.plugins.length > 0;
}

export function countEnabledPlugins(node: PluginsNode): number {
  return node.plugins.filter((plugin) => plugin.enabled !== false).length;
}

export function summarizePlugins(node: PluginsNode): string {
  const enabled = node.plugins.filter((plugin) => plugin.enabled !== false).length;
  const suffix = `${enabled} enabled`;
  if (node.plugins.length === 0) {
    return `0 plugins (${suffix})`;
  }
  const list = node.plugins.map((plugin) => plugin.name).join(', ');
  return `${node.plugins.length} plugins (${suffix}): ${list}`;
}

export function withPlugin(node: PluginsNode, plugin: PluginRef): PluginsNode {
  return {
    ...node,
    plugins: [...node.plugins, plugin],
  };
}

export function withoutPlugin(
  node: PluginsNode,
  nameOrPredicate: string | ((plugin: PluginRef) => boolean),
): PluginsNode {
  const predicate =
    typeof nameOrPredicate === 'string'
      ? (plugin: PluginRef) => plugin.name === nameOrPredicate
      : nameOrPredicate;
  return {
    ...node,
    plugins: node.plugins.filter((plugin) => !predicate(plugin)),
  };
}

export function clonePluginsNode(
  node: PluginsNode,
  options?: { stripLocation?: boolean },
): PluginsNode {
  const clone: PluginsNode = {
    ...node,
    plugins: node.plugins.map((plugin) => {
      const copy: PluginRef = { ...plugin };
      if (plugin.config) {
        copy.config = { ...plugin.config };
      }
      if (plugin.capabilities) {
        copy.capabilities = [...plugin.capabilities];
      }
      if (plugin.dependencies) {
        copy.dependencies = [...plugin.dependencies];
      }
      return copy;
    }),
  };
  if (options?.stripLocation) {
    delete clone.location;
  }
  return clone;
}

export function mergePluginsNodes(a: PluginsNode, b: PluginsNode): PluginsNode {
  const plugins = a.plugins.map((plugin) => ({ ...plugin }));
  const index = new Map<string, number>(
    plugins.map((plugin, i): [string, number] => [plugin.name, i]),
  );
  for (const plugin of b.plugins) {
    const existing = index.get(plugin.name);
    if (existing !== undefined) {
      plugins[existing] = { ...plugin };
    } else {
      index.set(plugin.name, plugins.length);
      plugins.push({ ...plugin });
    }
  }
  return {
    type: 'Plugins',
    plugins,
    location: b.location ?? a.location,
  };
}
