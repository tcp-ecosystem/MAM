/**
 * MAMP — MAM Package Manager
 *
 * Manages MAM packages, dependencies, and registry interactions.
 */

// Core
export { MAMPackage, type PackageManifest, type PackageDependency, type PackageConfig, type PackageLock, type ValidationResult } from './package.js';
export { PackageRegistry, type RegistryConfig, type RegistryModule, type SearchResult, type PublishResult } from './registry.js';
export { DependencyResolver, type ResolutionResult, type DependencyGraph, type ResolvedDependency, type DependencyNode, type DependencyEdge } from './resolver.js';
export { LockFileManager, type LockFile, type LockedPackage, type LockFileMetadata } from './lockfile.js';

// Cache
export { PackageCache, type CacheConfig, type CacheEntry, type CacheStats, type CacheSetOptions, type CachePruneResult } from './cache.js';

// Workspace
export { Workspace, type WorkspaceConfig, type WorkspacePackage, type WorkspaceGraph, type WorkspaceNode, type WorkspaceEdge, type WorkspaceLinkResult, type WorkspaceDiscoverResult } from './workspace.js';

// Installer
export { PackageInstaller, type InstallOptions, type UninstallOptions, type UpdateOptions, type InstallProgress, type InstallResult, type InstalledPackage, type FailedPackage, type OutdatedPackage, type ConflictResolution, type RollbackInfo, type RestoredPackage } from './installer.js';

// Config
export { MAMPConfig, type MAMPConfigData, type RegistryEntry, type ConfigValidationResult, type ConfigError, type ConfigWarning } from './config.js';

// Audit
export { PackageAuditor, type AuditOptions, type AuditResult, type Vulnerability, type LicenseIssue, type LicenseInfo, type AuditReport } from './audit.js';