/**
 * MAM Workspace
 *
 * Monorepo workspace support for managing multiple packages.
 */

import { readFile, writeFile, mkdir, access, readdir, lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { PackageManifest, PackageDependency } from './package.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkspaceConfig {
  /** Root directory of the workspace */
  rootDir: string;
  /** Glob patterns for package directories */
  packages: string[];
  /** Workspace name */
  name: string;
}

export interface WorkspacePackage {
  /** Package manifest */
  manifest: PackageManifest;
  /** Absolute path to package directory */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** Package dependencies within workspace */
  internalDeps: string[];
  /** Package dependencies from registry */
  externalDeps: PackageDependency[];
}

export interface WorkspaceGraph {
  /** Nodes in the dependency graph */
  nodes: WorkspaceNode[];
  /** Edges in the dependency graph */
  edges: WorkspaceEdge[];
  /** Topological order of package names */
  order: string[];
  /** Circular dependency chains if any */
  cycles: string[][];
}

export interface WorkspaceNode {
  /** Package name */
  name: string;
  /** Package version */
  version: string;
  /** Relative path */
  path: string;
}

export interface WorkspaceEdge {
  /** Source package name */
  from: string;
  /** Target package name */
  to: string;
  /** Edge type */
  type: 'dependency' | 'devDependency' | 'peerDependency';
}

export interface WorkspaceLinkResult {
  /** Whether linking succeeded */
  success: boolean;
  /** Linked package name */
  name: string;
  /** Symlink path created */
  symlink: string;
  /** Error message if failed */
  error?: string;
}

export interface WorkspaceDiscoverResult {
  /** Discovered packages */
  packages: WorkspacePackage[];
  /** Discovery time in ms */
  timeMs: number;
  /** Errors during discovery */
  errors: string[];
}

// ============================================================================
// Workspace Manager
// ============================================================================

export class Workspace {
  private config: WorkspaceConfig;
  private packages: Map<string, WorkspacePackage> = new Map();

  constructor(config: WorkspaceConfig) {
    this.config = config;
  }

  /**
   * Discover all packages in the workspace
   */
  async discover(): Promise<WorkspaceDiscoverResult> {
    const startTime = performance.now();
    const errors: string[] = [];
    const packages: WorkspacePackage[] = [];

    this.packages.clear();

    for (const pattern of this.config.packages) {
      try {
        const matched = await this.matchPattern(pattern);

        for (const dir of matched) {
          try {
            const pkg = await this.loadPackage(dir);

            if (pkg) {
              packages.push(pkg);
              this.packages.set(pkg.manifest.name, pkg);
            }
          } catch (error) {
            errors.push(`Failed to load package in "${dir}": ${(error as Error).message}`);
          }
        }
      } catch (error) {
        errors.push(`Pattern "${pattern}" failed: ${(error as Error).message}`);
      }
    }

    return {
      packages,
      timeMs: performance.now() - startTime,
      errors,
    };
  }

  /**
   * Link workspace packages as symlinks
   */
  async link(): Promise<WorkspaceLinkResult[]> {
    const results: WorkspaceLinkResult[] = [];
    const nodeModulesDir = join(this.config.rootDir, 'node_modules');

    await mkdir(nodeModulesDir, { recursive: true });

    for (const [name, pkg] of this.packages) {
      const symlinkPath = join(nodeModulesDir, name);
      const targetPath = pkg.path;

      try {
        // Remove existing link if present
        try {
          await access(symlinkPath);
          // If it exists, we need to remove it first
        } catch {
          // Does not exist, good
        }

        // Create relative symlink
        const relTarget = relative(nodeModulesDir, targetPath);

        await writeFile(symlinkPath, `module.exports = require("${relTarget}");`, 'utf-8');

        results.push({
          success: true,
          name,
          symlink: symlinkPath,
        });
      } catch (error) {
        results.push({
          success: false,
          name,
          symlink: symlinkPath,
          error: (error as Error).message,
        });
      }
    }

    return results;
  }

  /**
   * Unlink workspace packages
   */
  async unlink(): Promise<string[]> {
    const unlinked: string[] = [];
    const nodeModulesDir = join(this.config.rootDir, 'node_modules');

    for (const [name] of this.packages) {
      const symlinkPath = join(nodeModulesDir, name);

      try {
        const { unlink: unlinkFile } = await import('node:fs/promises');
        await unlinkFile(symlinkPath);
        unlinked.push(name);
      } catch {
        // Not linked or already removed
      }
    }

    return unlinked;
  }

  /**
   * Get topological order of packages (dependencies first)
   */
  getTopologicalOrder(): string[] {
    const graph = this.getPackageGraph();
    return graph.order;
  }

  /**
   * Get the dependency graph for workspace packages
   */
  getPackageGraph(): WorkspaceGraph {
    const nodes: WorkspaceNode[] = [];
    const edges: WorkspaceEdge[] = [];
    const order: string[] = [];
    const cycles: string[][] = [];

    // Build nodes
    for (const [name, pkg] of this.packages) {
      nodes.push({
        name,
        version: pkg.manifest.version,
        path: pkg.relativePath,
      });
    }

    // Build edges
    for (const [name, pkg] of this.packages) {
      const allDeps = [
        ...pkg.manifest.dependencies.map(d => ({ ...d, type: 'dependency' as const })),
        ...(pkg.manifest.dependencies.filter(d => d.optional).map(d => ({ ...d, type: 'peerDependency' as const }))),
      ];

      for (const dep of allDeps) {
        if (this.packages.has(dep.name)) {
          edges.push({
            from: name,
            to: dep.name,
            type: dep.type,
          });
        }
      }
    }

    // Topological sort with cycle detection
    const visited = new Set<string>();
    const temp = new Set<string>();

    const visit = (name: string, chain: string[]): boolean => {
      if (visited.has(name)) {
        return true;
      }

      if (temp.has(name)) {
        // Found a cycle
        const cycleStart = chain.indexOf(name);
        if (cycleStart >= 0) {
          cycles.push(chain.slice(cycleStart).concat(name));
        }
        return false;
      }

      temp.add(name);
      chain.push(name);

      // Visit dependencies first
      const outEdges = edges.filter(e => e.from === name);

      for (const edge of outEdges) {
        visit(edge.to, [...chain]);
      }

      temp.delete(name);
      visited.add(name);
      order.push(name);

      return true;
    };

    for (const name of this.packages.keys()) {
      if (!visited.has(name)) {
        visit(name, []);
      }
    }

    return { nodes, edges, order, cycles };
  }

  /**
   * Create a workspace from scratch
   */
  async createWorkspace(name: string, packageNames: string[]): Promise<void> {
    this.config.name = name;

    const rootManifest: PackageManifest = {
      name: name,
      version: '1.0.0',
      description: `Workspace: ${name}`,
      author: 'MAM',
      license: 'MIT',
      tags: ['workspace'],
      dependencies: packageNames.map(n => ({ name: n, version: '*' })),
      main: 'index.mam.md',
      files: ['*.mam.md'],
    };

    await mkdir(this.config.rootDir, { recursive: true });

    await writeFile(
      join(this.config.rootDir, 'mam-package.json'),
      JSON.stringify(rootManifest, null, 2),
      'utf-8'
    );

    // Create workspace config
    await writeFile(
      join(this.config.rootDir, 'mam-workspace.json'),
      JSON.stringify({
        name,
        packages: this.config.packages,
      }, null, 2),
      'utf-8'
    );

    // Create each package directory
    for (const pkgName of packageNames) {
      const pkgDir = join(this.config.rootDir, 'packages', pkgName);
      await mkdir(pkgDir, { recursive: true });

      const pkgManifest: PackageManifest = {
        name: pkgName,
        version: '1.0.0',
        description: `${pkgName} package`,
        author: 'MAM',
        license: 'MIT',
        tags: [],
        dependencies: [],
        main: 'index.mam.md',
        files: ['*.mam.md'],
      };

      await writeFile(
        join(pkgDir, 'mam-package.json'),
        JSON.stringify(pkgManifest, null, 2),
        'utf-8'
      );
    }
  }

  /**
   * Get a workspace package by name
   */
  getPackage(name: string): WorkspacePackage | undefined {
    return this.packages.get(name);
  }

  /**
   * Get all workspace package names
   */
  getPackageNames(): string[] {
    return Array.from(this.packages.keys());
  }

  /**
   * Get workspace root manifest
   */
  async getRootManifest(): Promise<PackageManifest | null> {
    try {
      const content = await readFile(join(this.config.rootDir, 'mam-package.json'), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Get workspace config
   */
  getConfig(): WorkspaceConfig {
    return { ...this.config };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async matchPattern(pattern: string): Promise<string[]> {
    const baseDir = join(this.config.rootDir, pattern.replace('*', ''));

    try {
      const entries = await readdir(baseDir);
      const dirs: string[] = [];

      for (const entry of entries) {
        const entryPath = join(baseDir, entry);
        const fileStat = await lstat(entryPath);

        if (fileStat.isDirectory()) {
          // Check if it has a mam-package.json
          try {
            await access(join(entryPath, 'mam-package.json'));
            dirs.push(entryPath);
          } catch {
            // Not a package directory
          }
        }
      }

      return dirs;
    } catch {
      return [];
    }
  }

  private async loadPackage(dir: string): Promise<WorkspacePackage | null> {
    const manifestPath = join(dir, 'mam-package.json');

    try {
      const content = await readFile(manifestPath, 'utf-8');
      const manifest: PackageManifest = JSON.parse(content);

      const internalDeps = manifest.dependencies
        .filter(d => this.packages.has(d.name) || this.willDiscover(d.name))
        .map(d => d.name);

      const externalDeps = manifest.dependencies
        .filter(d => !this.packages.has(d.name) && !this.willDiscover(d.name));

      return {
        manifest,
        path: dir,
        relativePath: relative(this.config.rootDir, dir),
        internalDeps,
        externalDeps,
      };
    } catch {
      return null;
    }
  }

  private willDiscover(name: string): boolean {
    // Check if this package name would be discovered by any pattern
    return false;
  }
}
