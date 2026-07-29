/**
 * MAM Package Installer
 *
 * Package installation engine with dependency resolution,
 * conflict detection, and rollback support.
 */

import { readFile, writeFile, mkdir, access, readdir, rm, rename, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { PackageManifest, PackageDependency } from './package.js';
import { DependencyResolver, ResolvedDependency } from './resolver.js';
import { PackageCache, CacheEntry } from './cache.js';

// ============================================================================
// Types
// ============================================================================

export interface InstallOptions {
  /** Install as dev dependency */
  dev?: boolean;
  /** Install as optional dependency */
  optional?: boolean;
  /** Skip integrity check */
  skipIntegrity?: boolean;
  /** Dry run - do not write files */
  dryRun?: boolean;
  /** Force reinstall even if cached */
  force?: boolean;
  /** Progress callback */
  onProgress?: (progress: InstallProgress) => void;
}

export interface UninstallOptions {
  /** Remove unused dependencies */
  prune?: boolean;
  /** Dry run - do not write files */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (progress: InstallProgress) => void;
}

export interface UpdateOptions {
  /** Update all packages */
  all?: boolean;
  /** Specific packages to update */
  packages?: string[];
  /** Dry run - do not write files */
  dryRun?: boolean;
  /** Progress callback */
  onProgress?: (progress: InstallProgress) => void;
}

export interface InstallProgress {
  /** Current phase name */
  phase: string;
  /** Current step index */
  current: number;
  /** Total steps */
  total: number;
  /** Current package being processed */
  package?: string;
  /** Percentage complete */
  percentage: number;
}

export interface InstallResult {
  /** Whether installation succeeded */
  success: boolean;
  /** Installed package names and versions */
  installed: InstalledPackage[];
  /** Failed packages */
  failed: FailedPackage[];
  /** Skipped packages */
  skipped: string[];
  /** Total installation time in ms */
  timeMs: number;
  /** Rollback info if available */
  rollback?: RollbackInfo;
}

export interface InstalledPackage {
  /** Package name */
  name: string;
  /** Installed version */
  version: string;
  /** Install path */
  path: string;
  /** Dependencies installed */
  dependencies: string[];
}

export interface FailedPackage {
  /** Package name */
  name: string;
  /** Error message */
  error: string;
  /** Error code */
  code: string;
}

export interface OutdatedPackage {
  /** Package name */
  name: string;
  /** Current version */
  current: string;
  /** Latest version */
  latest: string;
  /** Wanted version (satisfies range) */
  wanted: string;
  /** Dependency type */
  type: 'dependency' | 'devDependency' | 'optionalDependency';
}

export interface ConflictResolution {
  /** Package name */
  name: string;
  /** Conflicting versions */
  conflicting: string[];
  /** Resolved version */
  resolved: string;
  /** Resolution strategy used */
  strategy: 'highest' | 'latest' | 'nearest';
}

export interface RollbackInfo {
  /** Packages to remove */
  remove: string[];
  /** Packages to restore */
  restore: RestoredPackage[];
  /** Rollback timestamp */
  timestamp: string;
}

export interface RestoredPackage {
  /** Package name */
  name: string;
  /** Version to restore */
  version: string;
  /** Source path */
  source: string;
}

// ============================================================================
// Package Installer
// ============================================================================

export class PackageInstaller {
  private projectDir: string;
  private resolver: DependencyResolver;
  private cache: PackageCache;
  private installDir: string;
  private manifest: PackageManifest | null = null;
  private installedPackages: Map<string, InstalledPackage> = new Map();

  constructor(projectDir: string, cache: PackageCache) {
    this.projectDir = projectDir;
    this.installDir = join(projectDir, 'node_modules');
    this.resolver = new DependencyResolver();
    this.cache = cache;
  }

  /**
   * Install packages from manifest
   */
  async install(options: InstallOptions = {}): Promise<InstallResult> {
    const startTime = performance.now();
    const installed: InstalledPackage[] = [];
    const failed: FailedPackage[] = [];
    const skipped: string[] = [];

    // Load manifest
    this.manifest = await this.loadManifest();

    if (!this.manifest) {
      return {
        success: false,
        installed: [],
        failed: [{ name: '', error: 'No mam-package.json found', code: 'NO_MANIFEST' }],
        skipped: [],
        timeMs: performance.now() - startTime,
      };
    }

    // Resolve dependencies
    const resolution = this.resolver.resolve(this.manifest.dependencies);

    if (resolution.errors.length > 0 && !options.force) {
      return {
        success: false,
        installed: [],
        failed: resolution.errors.map(e => ({
          name: e.dependency || '',
          error: e.message,
          code: e.code,
        })),
        skipped: [],
        timeMs: performance.now() - startTime,
      };
    }

    // Create install directory
    await mkdir(this.installDir, { recursive: true });

    // Install each resolved dependency
    const total = resolution.resolved.length;

    for (let i = 0; i < total; i++) {
      const resolved = resolution.resolved[i];

      options.onProgress?.({
        phase: 'install',
        current: i + 1,
        total,
        package: resolved.name,
        percentage: Math.round(((i + 1) / total) * 100),
      });

      // Check cache first
      if (!options.force) {
        const cached = await this.cache.get(resolved.name, resolved.version);

        if (cached) {
          const result = await this.installFromCache(resolved, cached);

          if (result) {
            installed.push(result);
            continue;
          }
        }
      }

      // Install fresh
      try {
        const result = await this.installPackage(resolved, options);
        installed.push(result);

        // Cache the installed package
        const packagePath = join(this.installDir, resolved.name);

        try {
          await this.cache.set(resolved.name, resolved.version, packagePath, {
            integrity: resolved.integrity,
          });
        } catch {
          // Cache failure is non-fatal
        }
      } catch (error) {
        failed.push({
          name: resolved.name,
          error: (error as Error).message,
          code: 'INSTALL_FAILED',
        });
      }
    }

    // Save updated manifest
    if (!options.dryRun && installed.length > 0) {
      await this.saveManifest();
    }

    return {
      success: failed.length === 0,
      installed,
      failed,
      skipped,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Uninstall packages
   */
  async uninstall(packageNames: string[], options: UninstallOptions = {}): Promise<InstallResult> {
    const startTime = performance.now();
    const installed: InstalledPackage[] = [];
    const failed: FailedPackage[] = [];
    const skipped: string[] = [];

    this.manifest = await this.loadManifest();

    if (!this.manifest) {
      return {
        success: false,
        installed: [],
        failed: [{ name: '', error: 'No mam-package.json found', code: 'NO_MANIFEST' }],
        skipped: [],
        timeMs: performance.now() - startTime,
      };
    }

    const total = packageNames.length;

    for (let i = 0; i < total; i++) {
      const name = packageNames[i];

      options.onProgress?.({
        phase: 'uninstall',
        current: i + 1,
        total,
        package: name,
        percentage: Math.round(((i + 1) / total) * 100),
      });

      try {
        const packageDir = join(this.installDir, name);

        if (!options.dryRun) {
          await rm(packageDir, { recursive: true, force: true });
        }

        // Remove from manifest
        this.manifest.dependencies = this.manifest.dependencies.filter(d => d.name !== name);
      } catch (error) {
        failed.push({
          name,
          error: (error as Error).message,
          code: 'UNINSTALL_FAILED',
        });
      }
    }

    // Save updated manifest
    if (!options.dryRun) {
      await this.saveManifest();
    }

    return {
      success: failed.length === 0,
      installed,
      failed,
      skipped,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Update packages
   */
  async update(options: UpdateOptions = {}): Promise<InstallResult> {
    const startTime = performance.now();
    const installed: InstalledPackage[] = [];
    const failed: FailedPackage[] = [];
    const skipped: string[] = [];

    this.manifest = await this.loadManifest();

    if (!this.manifest) {
      return {
        success: false,
        installed: [],
        failed: [{ name: '', error: 'No mam-package.json found', code: 'NO_MANIFEST' }],
        skipped: [],
        timeMs: performance.now() - startTime,
      };
    }

    // Find outdated packages
    const outdated = await this.getOutdated();
    const packagesToUpdate = options.packages
      ? outdated.filter(o => options.packages!.includes(o.name))
      : options.all
        ? outdated
        : outdated.filter(o => o.wanted !== o.current);

    const total = packagesToUpdate.length;

    for (let i = 0; i < total; i++) {
      const pkg = packagesToUpdate[i];

      options.onProgress?.({
        phase: 'update',
        current: i + 1,
        total,
        package: pkg.name,
        percentage: Math.round(((i + 1) / total) * 100),
      });

      try {
        // Update manifest version range
        const dep = this.manifest.dependencies.find(d => d.name === pkg.name);

        if (dep) {
          dep.version = pkg.latest;
        }

        // Force reinstall
        const resolved: ResolvedDependency = {
          name: pkg.name,
          version: pkg.latest,
          url: `https://registry.mam.dev/${pkg.name}/${pkg.latest}`,
          integrity: `sha256-${this.generateHash(pkg.name + pkg.latest)}`,
          direct: true,
          dependencies: [],
        };

        const result = await this.installPackage(resolved, { ...options, force: true });
        installed.push(result);
      } catch (error) {
        failed.push({
          name: pkg.name,
          error: (error as Error).message,
          code: 'UPDATE_FAILED',
        });
      }
    }

    // Save updated manifest
    if (!options.dryRun && installed.length > 0) {
      await this.saveManifest();
    }

    return {
      success: failed.length === 0,
      installed,
      failed,
      skipped,
      timeMs: performance.now() - startTime,
    };
  }

  /**
   * Get outdated packages
   */
  async getOutdated(): Promise<OutdatedPackage[]> {
    const outdated: OutdatedPackage[] = [];

    this.manifest = await this.loadManifest();

    if (!this.manifest) {
      return outdated;
    }

    for (const dep of this.manifest.dependencies) {
      const installedVersion = await this.getInstalledVersion(dep.name);

      if (installedVersion && installedVersion !== dep.version) {
        outdated.push({
          name: dep.name,
          current: installedVersion,
          latest: dep.version,
          wanted: dep.version,
          type: dep.optional ? 'optionalDependency' : 'dependency',
        });
      }
    }

    return outdated;
  }

  /**
   * Resolve dependency conflicts
   */
  resolveConflicts(dependencies: PackageDependency[]): ConflictResolution[] {
    const resolutions: ConflictResolution[] = [];
    const grouped = new Map<string, PackageDependency[]>();

    for (const dep of dependencies) {
      const existing = grouped.get(dep.name) || [];
      existing.push(dep);
      grouped.set(dep.name, existing);
    }

    for (const [name, deps] of grouped) {
      if (deps.length > 1) {
        const versions = [...new Set(deps.map(d => d.version))];

        if (versions.length > 1) {
          // Use highest version
          const sorted = versions.sort(this.compareVersions);
          resolutions.push({
            name,
            conflicting: versions,
            resolved: sorted[sorted.length - 1],
            strategy: 'highest',
          });
        }
      }
    }

    return resolutions;
  }

  /**
   * Rollback to a previous state
   */
  async rollback(info: RollbackInfo): Promise<void> {
    // Remove packages that were added
    for (const name of info.remove) {
      const packageDir = join(this.installDir, name);

      try {
        await rm(packageDir, { recursive: true, force: true });
      } catch {
        // Continue rollback
      }
    }

    // Restore packages that were removed
    for (const pkg of info.restore) {
      const packageDir = join(this.installDir, pkg.name);

      try {
        await mkdir(packageDir, { recursive: true });
        await this.installPackage({
          name: pkg.name,
          version: pkg.version,
          url: `https://registry.mam.dev/${pkg.name}/${pkg.version}`,
          integrity: '',
          direct: true,
          dependencies: [],
        }, {});
      } catch {
        // Continue rollback
      }
    }
  }

  /**
   * Get installation status for a package
   */
  async isInstalled(name: string): Promise<boolean> {
    const packageDir = join(this.installDir, name);

    try {
      await access(packageDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get installed version of a package
   */
  async getInstalledVersion(name: string): Promise<string | null> {
    try {
      const manifestPath = join(this.installDir, name, 'mam-package.json');
      const content = await readFile(manifestPath, 'utf-8');
      const manifest: PackageManifest = JSON.parse(content);
      return manifest.version;
    } catch {
      return null;
    }
  }

  /**
   * List all installed packages
   */
  async listInstalled(): Promise<InstalledPackage[]> {
    const installed: InstalledPackage[] = [];

    try {
      const entries = await readdir(this.installDir);

      for (const entry of entries) {
        if (entry.startsWith('.')) {
          continue;
        }

        const version = await this.getInstalledVersion(entry);

        if (version) {
          installed.push({
            name: entry,
            version,
            path: join(this.installDir, entry),
            dependencies: [],
          });
        }
      }
    } catch {
      // node_modules doesn't exist yet
    }

    return installed;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async installPackage(resolved: ResolvedDependency, options: InstallOptions): Promise<InstalledPackage> {
    const packageDir = join(this.installDir, resolved.name);

    await mkdir(packageDir, { recursive: true });

    // Simulate package installation
    // In real implementation, this would download and extract the package
    const manifest: PackageManifest = {
      name: resolved.name,
      version: resolved.version,
      description: '',
      author: '',
      license: 'MIT',
      tags: [],
      dependencies: [],
      main: 'index.mam.md',
      files: [],
    };

    await writeFile(
      join(packageDir, 'mam-package.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    const pkg: InstalledPackage = {
      name: resolved.name,
      version: resolved.version,
      path: packageDir,
      dependencies: resolved.dependencies.map(d => d.name),
    };

    this.installedPackages.set(resolved.name, pkg);

    return pkg;
  }

  private async installFromCache(resolved: ResolvedDependency, cached: CacheEntry): Promise<InstalledPackage | null> {
    const packageDir = join(this.installDir, resolved.name);

    try {
      await mkdir(packageDir, { recursive: true });

      // Copy from cache
      const { copyFile } = await import('node:fs/promises');
      await copyFile(cached.path, join(packageDir, 'mam-package.json'));

      const pkg: InstalledPackage = {
        name: resolved.name,
        version: resolved.version,
        path: packageDir,
        dependencies: resolved.dependencies.map(d => d.name),
      };

      this.installedPackages.set(resolved.name, pkg);

      return pkg;
    } catch {
      return null;
    }
  }

  private async loadManifest(): Promise<PackageManifest | null> {
    try {
      const content = await readFile(join(this.projectDir, 'mam-package.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  private async saveManifest(): Promise<void> {
    if (!this.manifest) {
      return;
    }

    await writeFile(
      join(this.projectDir, 'mam-package.json'),
      JSON.stringify(this.manifest, null, 2),
      'utf-8'
    );
  }

  private generateHash(input: string): string {
    let hash = 0;

    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash).toString(16).padStart(16, '0');
  }

  private compareVersions(a: string, b: string): number {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);

    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;

      if (aVal !== bVal) {
        return aVal - bVal;
      }
    }

    return 0;
  }
}
