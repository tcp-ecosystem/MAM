/**
 * MAM Plugin Loader
 *
 * Dynamic plugin import with validation and error handling.
 */

import type { MAMPlugin, PluginManifest } from './types.js';
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface LoadPluginResult {
  success: boolean;
  plugin?: MAMPlugin;
  manifest?: PluginManifest;
  error?: string;
}

export async function loadPluginFromPath(pluginPath: string): Promise<LoadPluginResult> {
  try {
    const manifestPath = join(pluginPath, 'plugin.json');
    await access(manifestPath);
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(manifestContent);

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      return { success: false, error: `Invalid manifest: ${validation.errors.join(', ')}` };
    }

    const pluginModule = await import(resolve(pluginPath, manifest.main));
    const plugin: MAMPlugin = pluginModule.default || pluginModule;

    if (!plugin.manifest) {
      plugin.manifest = manifest;
    }

    return { success: true, plugin, manifest };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

export async function discoverPluginPaths(searchPaths: string[]): Promise<string[]> {
  const discovered: string[] = [];
  for (const sp of searchPaths) {
    try {
      await access(sp);
      const entries = await readdir(sp);
      for (const entry of entries) {
        const pluginDir = join(sp, entry);
        try {
          await access(join(pluginDir, 'plugin.json'));
          discovered.push(pluginDir);
        } catch {
          // not a plugin directory
        }
      }
    } catch {
      // path doesn't exist
    }
  }
  return discovered;
}

export function validateManifest(manifest: PluginManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest.name) errors.push('Missing name');
  if (!manifest.version) errors.push('Missing version');
  if (!manifest.description) errors.push('Missing description');
  if (!manifest.author) errors.push('Missing author');
  if (!manifest.license) errors.push('Missing license');
  if (!manifest.main) errors.push('Missing main');
  if (manifest.name && !/^[a-zA-Z@][a-zA-Z0-9/_-]*$/.test(manifest.name)) {
    errors.push(`Invalid plugin name: "${manifest.name}"`);
  }
  if (manifest.version && !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    errors.push(`Invalid version format: "${manifest.version}"`);
  }
  return { valid: errors.length === 0, errors };
}

export function resolvePluginPath(basePath: string, main: string): string {
  return resolve(basePath, main);
}
