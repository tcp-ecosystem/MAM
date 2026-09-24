/**
 * MAM Package Registry
 * 
 * Registry client for module discovery, publishing, and management.
 */

import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PackageManifest } from './package.js';

// ============================================================================
// Types
// ============================================================================

export interface RegistryConfig {
  /** Registry URL */
  url: string;
  /** Authentication token */
  token?: string;
  /** Cache directory */
  cacheDir?: string;
  /** Request timeout */
  timeout?: number;
}

export interface RegistryModule {
  /** Module name */
  name: string;
  /** Latest version */
  version: string;
  /** Module description */
  description: string;
  /** Module author */
  author: string;
  /** Module tags */
  tags: string[];
  /** Module URL */
  url: string;
  /** Download count */
  downloads: number;
  /** Last updated */
  updatedAt: string;
}

export interface SearchResult {
  /** Found modules */
  modules: RegistryModule[];
  /** Total count */
  total: number;
  /** Search time */
  timeMs: number;
}

export interface PublishResult {
  /** Whether publish succeeded */
  success: boolean;
  /** Published version */
  version: string;
  /** Module URL */
  url: string;
  /** Error message if failed */
  error?: string;
}

// ============================================================================
// Registry Client
// ============================================================================

export class PackageRegistry {
  private config: RegistryConfig;
  private cache: Map<string, RegistryModule> = new Map();

  constructor(config: RegistryConfig) {
    this.config = {
      timeout: 30000,
      ...config,
    };
  }

  /**
   * Search for modules
   */
  async search(query: string, options: { limit?: number; offset?: number } = {}): Promise<SearchResult> {
    const startTime = performance.now();
    const limit = options.limit || 20;
    const offset = options.offset || 0;

    try {
      // In real implementation, this would make HTTP request
      // For now, return cached/placeholder results
      const modules = Array.from(this.cache.values())
        .filter(m => 
          m.name.includes(query) ||
          m.description.includes(query) ||
          m.tags.some(t => t.includes(query))
        )
        .slice(offset, offset + limit);

      return {
        modules,
        total: modules.length,
        timeMs: performance.now() - startTime,
      };
    } catch (error) {
      return {
        modules: [],
        total: 0,
        timeMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Get module info
   */
  async getModule(name: string, version?: string): Promise<RegistryModule | null> {
    const cacheKey = version ? `${name}@${version}` : name;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // In real implementation, fetch from registry
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Publish a module
   */
  async publish(manifest: PackageManifest, files: Map<string, string>): Promise<PublishResult> {
    try {
      // Validate manifest
      if (!manifest.name || !manifest.version) {
        return {
          success: false,
          version: '',
          url: '',
          error: 'Invalid manifest: name and version required',
        };
      }

      // In real implementation, upload to registry
      const moduleInfo: RegistryModule = {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        tags: manifest.tags,
        url: `${this.config.url}/${manifest.name}`,
        downloads: 0,
        updatedAt: new Date().toISOString(),
      };

      this.cache.set(manifest.name, moduleInfo);

      return {
        success: true,
        version: manifest.version,
        url: moduleInfo.url,
      };
    } catch (error) {
      return {
        success: false,
        version: '',
        url: '',
        error: (error as Error).message,
      };
    }
  }

  /**
   * Download a module
   */
  async download(name: string, version: string, destDir: string): Promise<boolean> {
    try {
      // In real implementation, download from registry
      await mkdir(destDir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get module versions
   */
  async getVersions(name: string): Promise<string[]> {
    try {
      // In real implementation, fetch versions from registry
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Check if module exists
   */
  async exists(name: string, version?: string): Promise<boolean> {
    const module = await this.getModule(name, version);
    return module !== null;
  }

  /**
   * Get latest version
   */
  async getLatest(name: string): Promise<string | null> {
    const module = await this.getModule(name);
    return module?.version || null;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Registry URL Helpers
// ============================================================================

/**
 * Normalize a registry URL to a canonical form.
 *
 * Trims whitespace, strips trailing slashes, prepends `https://` when no
 * scheme is present, and upgrades `http://` to `https://`.
 *
 * @param url - The registry URL to normalize.
 * @returns The normalized registry URL.
 */
export function normalizeRegistryUrl(url: string): string {
  let normalized = (url ?? '').trim().replace(/\/+$/, '');

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) {
    normalized = `https://${normalized}`;
  } else if (normalized.startsWith('http://')) {
    normalized = `https://${normalized.slice('http://'.length)}`;
  }

  return normalized;
}

/**
 * Build a package URL for a registry, name, and optional version.
 *
 * Scoped names are encoded with `%2f` between scope and name. The registry is
 * normalized first via {@link normalizeRegistryUrl}.
 *
 * @param registry - The registry base URL.
 * @param name - The package name.
 * @param version - Optional package version.
 * @returns The full package URL.
 */
export function buildPackageUrl(registry: string, name: string, version?: string): string {
  const base = normalizeRegistryUrl(registry);
  const encodedName = name.startsWith('@') ? name.replace('/', '%2f') : name;

  if (version) {
    return `${base}/${encodedName}/${version}`;
  }

  return `${base}/${encodedName}`;
}