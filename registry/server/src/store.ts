/**
 * MAM Module Store
 * 
 * Persistent storage for modules and versions.
 */

import { readFile, writeFile, mkdir, access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { PackageManifest } from '@mam/package-manager';

// ============================================================================
// Types
// ============================================================================

export interface ModuleRecord {
  /** Module name */
  name: string;
  /** Module description */
  description: string;
  /** Module author */
  author: string;
  /** Module tags */
  tags: string[];
  /** Module versions */
  versions: Record<string, VersionRecord>;
  /** Latest version */
  latest: string;
  /** Creation timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
}

export interface VersionRecord {
  /** Version string */
  version: string;
  /** Module manifest */
  manifest: PackageManifest;
  /** Module files */
  files: Record<string, string>;
  /** Tarball URL */
  tarball: string;
  /** Integrity hash */
  integrity: string;
  /** Publish timestamp */
  publishedAt: string;
  /** Published by */
  publishedBy: string;
}

// ============================================================================
// Module Store
// ============================================================================

export class ModuleStore {
  private dataDir: string;
  private modulesDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.modulesDir = join(dataDir, 'modules');
  }

  /**
   * Initialize store
   */
  async init(): Promise<void> {
    await mkdir(this.modulesDir, { recursive: true });
  }

  /**
   * Get module record
   */
  async getModule(name: string): Promise<ModuleRecord | null> {
    const moduleDir = join(this.modulesDir, name);
    const metaPath = join(moduleDir, 'meta.json');

    try {
      const content = await readFile(metaPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get all modules
   */
  async getAllModules(): Promise<ModuleRecord[]> {
    try {
      const entries = await readdir(this.modulesDir);
      const modules: ModuleRecord[] = [];

      for (const entry of entries) {
        const module = await this.getModule(entry);
        if (module) {
          modules.push(module);
        }
      }

      return modules;
    } catch {
      return [];
    }
  }

  /**
   * Get module versions
   */
  async getVersions(name: string): Promise<string[]> {
    const module = await this.getModule(name);
    return module ? Object.keys(module.versions) : [];
  }

  /**
   * Get specific version
   */
  async getVersion(name: string, version: string): Promise<VersionRecord | null> {
    const module = await this.getModule(name);
    return module?.versions[version] || null;
  }

  /**
   * Publish module
   */
  async publish(
    manifest: PackageManifest,
    files: Map<string, string>,
    publishedBy: string
  ): Promise<{ name: string; version: string }> {
    const moduleDir = join(this.modulesDir, manifest.name);
    await mkdir(moduleDir, { recursive: true });

    // Get or create module record
    let record = await this.getModule(manifest.name);
    if (!record) {
      record = {
        name: manifest.name,
        description: manifest.description,
        author: manifest.author,
        tags: manifest.tags,
        versions: {},
        latest: manifest.version,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Add version
    const filesObj: Record<string, string> = {};
    for (const [path, content] of files) {
      filesObj[path] = content;
    }

    record.versions[manifest.version] = {
      version: manifest.version,
      manifest,
      files: filesObj,
      tarball: `/tarballs/${manifest.name}-${manifest.version}.tgz`,
      integrity: this.generateIntegrity(filesObj),
      publishedAt: new Date().toISOString(),
      publishedBy,
    };

    record.latest = manifest.version;
    record.updatedAt = new Date().toISOString();

    // Save
    await writeFile(
      join(moduleDir, 'meta.json'),
      JSON.stringify(record, null, 2),
      'utf-8'
    );

    // Save version files
    const versionDir = join(moduleDir, manifest.version);
    await mkdir(versionDir, { recursive: true });
    
    for (const [path, content] of files) {
      const filePath = join(versionDir, path);
      const fileDir = resolve.dirname(filePath);
      await mkdir(fileDir, { recursive: true });
      await writeFile(filePath, content, 'utf-8');
    }

    return { name: manifest.name, version: manifest.version };
  }

  /**
   * Delete module
   */
  async deleteModule(name: string): Promise<void> {
    const moduleDir = join(this.modulesDir, name);
    await rm(moduleDir, { recursive: true, force: true });
  }

  /**
   * Get stats
   */
  async getStats(): Promise<RegistryStats> {
    const modules = await this.getAllModules();
    let totalVersions = 0;
    let totalDownloads = 0;

    for (const module of modules) {
      totalVersions += Object.keys(module.versions).length;
    }

    return {
      totalModules: modules.length,
      totalVersions,
      totalDownloads,
      lastUpdated: new Date().toISOString(),
    };
  }

  private generateIntegrity(files: Record<string, string>): string {
    const content = JSON.stringify(files);
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `sha256-${Math.abs(hash).toString(16).padStart(16, '0')}`;
  }
}

export interface RegistryStats {
  totalModules: number;
  totalVersions: number;
  totalDownloads: number;
  lastUpdated: string;
}