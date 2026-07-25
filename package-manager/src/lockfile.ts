/**
 * MAM Lock File Manager
 * 
 * Manages package-lock.mam.json files for deterministic installs.
 */

import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { ResolvedDependency } from './resolver.js';

// ============================================================================
// Types
// ============================================================================

export interface LockFile {
  /** Lock file version */
  lockfileVersion: number;
  /** Package name */
  name: string;
  /** Resolved packages */
  packages: Record<string, LockedPackage>;
  /** Metadata */
  metadata: LockFileMetadata;
}

export interface LockedPackage {
  /** Package version */
  version: string;
  /** Resolved URL */
  resolved: string;
  /** Integrity hash */
  integrity: string;
  /** Dependencies */
  dependencies: Record<string, string>;
  /** Peer dependencies */
  peerDependencies?: Record<string, string>;
  /** Whether package is optional */
  optional?: boolean;
}

export interface LockFileMetadata {
  /** Creation timestamp */
  createdAt: string;
  /** Last updated timestamp */
  updatedAt: string;
  /** Node version used */
  nodeVersion?: string;
  /** MAM version used */
  mamVersion?: string;
}

// ============================================================================
// Lock File Manager
// ============================================================================

export class LockFileManager {
  private dir: string;
  private lockFile: string;
  private data: LockFile | null = null;

  constructor(dir: string) {
    this.dir = dir;
    this.lockFile = join(dir, 'package-lock.mam.json');
  }

  /**
   * Load lock file
   */
  async load(): Promise<LockFile | null> {
    try {
      const content = await readFile(this.lockFile, 'utf-8');
      this.data = JSON.parse(content);
      return this.data;
    } catch {
      return null;
    }
  }

  /**
   * Save lock file
   */
  async save(): Promise<void> {
    if (!this.data) {
      throw new Error('No lock file data to save');
    }

    this.data.metadata.updatedAt = new Date().toISOString();
    
    await writeFile(
      this.lockFile,
      JSON.stringify(this.data, null, 2),
      'utf-8'
    );
  }

  /**
   * Create new lock file
   */
  async create(name: string): Promise<LockFile> {
    this.data = {
      lockfileVersion: 1,
      name,
      packages: {},
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        mamVersion: '2.0.0',
      },
    };

    await this.save();
    return this.data;
  }

  /**
   * Add resolved dependency
   */
  addPackage(name: string, resolved: ResolvedDependency): void {
    if (!this.data) {
      throw new Error('No lock file loaded');
    }

    this.data.packages[name] = {
      version: resolved.version,
      resolved: resolved.url,
      integrity: resolved.integrity,
      dependencies: {},
    };
  }

  /**
   * Remove package
   */
  removePackage(name: string): void {
    if (!this.data) {
      throw new Error('No lock file loaded');
    }

    delete this.data.packages[name];
  }

  /**
   * Get package
   */
  getPackage(name: string): LockedPackage | null {
    if (!this.data) {
      return null;
    }

    return this.data.packages[name] || null;
  }

  /**
   * Check if package is locked
   */
  isLocked(name: string, version: string): boolean {
    const pkg = this.getPackage(name);
    return pkg !== null && pkg.version === version;
  }

  /**
   * Get all locked packages
   */
  getAllPackages(): Record<string, LockedPackage> {
    if (!this.data) {
      return {};
    }

    return { ...this.data.packages };
  }

  /**
   * Check if lock file exists
   */
  async exists(): Promise<boolean> {
    try {
      await access(this.lockFile);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get lock file path
   */
  getPath(): string {
    return this.lockFile;
  }

  /**
   * Clear lock file
   */
  async clear(): Promise<void> {
    this.data = null;
  }
}