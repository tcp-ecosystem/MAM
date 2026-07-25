/**
 * MAMP — MAM Package Manager
 * 
 * Manages MAM packages, dependencies, and registry interactions.
 */

export { MAMPackage, type PackageManifest, type PackageDependency, type PackageConfig, type PackageLock } from './package.js';
export { PackageRegistry, type RegistryConfig, type RegistryModule, type SearchResult } from './registry.js';
export { DependencyResolver, type ResolutionResult, type DependencyGraph } from './resolver.js';
export { LockFileManager, type LockFile } from './lockfile.js';