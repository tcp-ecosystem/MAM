/**
 * MAM Install Command
 *
 * Production-grade dependency installer with registry resolution, lock files,
 * integrity verification, parallel downloads, and caching.
 */

import {
  readFile,
  writeFile,
  mkdir,
  access,
  stat,
  readdir,
  unlink,
  rename,
  cp,
  chmod,
  lstat,
  readlink,
} from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { resolve, join, relative, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import { parseMAM } from '@mam/parser';

// ============================================================================
// Types
// ============================================================================

export interface InstallOptions {
  file?: string;
  dir?: string;
  global?: boolean;
  dev?: boolean;
  production?: boolean;
  optional?: boolean;
  peer?: boolean;
  dryRun?: boolean;
  force?: boolean;
  audit?: boolean;
  legacy?: boolean;
  shrinkwrap?: boolean;
  parallel?: number;
  cacheDir?: string;
  registry?: string;
  omit?: string[];
  include?: string[];
}

interface DependencySpec {
  name: string;
  version: string;
  range?: string;
  type: 'dependencies' | 'devDependencies' | 'optionalDependencies' | 'peerDependencies';
  parent?: string;
  source?: 'registry' | 'url' | 'git' | 'workspace' | 'file';
  url?: string;
  gitRef?: string;
  integrity?: string;
}

interface ResolvedPackage {
  name: string;
  version: string;
  resolved: string;
  integrity: string;
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  deprecated?: string;
  tarball: string;
  shasum: string;
  bin?: Record<string, string>;
  dist: {
    integrity: string;
    shasum: string;
    tarball: string;
    fileCount?: number;
    unpackedSize?: number;
  };
}

interface PackageVersion {
  version: string;
  dist: ResolvedPackage['dist'];
  deprecated?: string;
}

interface RegistryMetadata {
  name: string;
  'dist-tags': Record<string, string>;
  versions: Record<string, PackageVersion>;
  modified: string;
}

interface LockFileEntry {
  version: string;
  resolved: string;
  integrity: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface LockFile {
  lockfileVersion: number;
  requires?: boolean;
  packages: Record<string, LockFileEntry>;
}

interface InstallPlan {
  root: string;
  dependencies: DependencySpec[];
  resolved: Map<string, ResolvedPackage>;
  conflicts: VersionConflict[];
  toInstall: InstallTask[];
  toRemove: string[];
  integrityMap: Map<string, string>;
  integrityChanges: number;
  lockFileChanges: number;
}

interface InstallTask {
  spec: DependencySpec;
  resolved: ResolvedPackage;
  targetDir: string;
  fromCache: boolean;
}

interface VersionConflict {
  name: string;
  required: string;
  installed: string;
  parent?: string;
}

interface InstallResult {
  installed: number;
  upToDate: number;
  removed: number;
  conflicts: VersionConflict[];
  integrityChanges: number;
  duration: number;
  auditResult?: AuditResult;
}

interface AuditResult {
  vulnerabilities: AuditVulnerability[];
  totalDependencies: number;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
}

interface AuditVulnerability {
  name: string;
  severity: string;
  via: string[];
  range: string;
  fixAvailable: boolean | { name: string; version: string };
  nodes: string[];
}

interface IntegrityEntry {
  algorithm: string;
  digest: string;
  source: string;
}

// ============================================================================
// Constants
// ============================================================================

const MAM_REGISTRY = 'https://registry.mam.dev';
const MAM_LOCKFILE_VERSION = 3;
const LOCKFILE_NAME = 'package-lock.mam.json';
const DEFAULT_CACHE_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.mam',
  'cache',
);
const INTEGRITY_FILE = '.integrity';
const MAX_PARALLEL_DOWNLOADS = 8;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 1000;
const TAR_EXTRACT_TIMEOUT_MS = 15_000;

// ============================================================================
// Helpers
// ============================================================================

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function safeReadJson<T>(path: string): Promise<T | null> {
  try {
    const content = await readFile(path, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

async function safeWriteJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function semverSatisfies(version: string, range: string): boolean {
  if (range === '*' || range === 'latest') return true;
  if (range.startsWith('^')) {
    const target = range.slice(1);
    return compareMajor(version, target) === 0 && compareAtLeast(version, target);
  }
  if (range.startsWith('~')) {
    const target = range.slice(1);
    return compareMajor(version, target) === 0 &&
      compareMinor(version, target) === 0 &&
      compareAtLeast(version, target);
  }
  if (range.includes('-')) {
    const [low, high] = range.split(' - ');
    return compareAtLeast(version, low) && compareAtMost(version, high);
  }
  if (range.startsWith('>=')) return compareAtLeast(version, range.slice(2));
  if (range.startsWith('<')) return compareLess(version, range.slice(1));
  if (range.startsWith('=')) return compareExact(version, range.slice(1));
  if (range.startsWith('!=')) return !compareExact(version, range.slice(1));
  if (range.includes(' || ')) {
    return range.split(' || ').some((r) => semverSatisfies(version, r.trim()));
  }
  if (range.includes(' && ')) {
    return range.split(' && ').every((r) => semverSatisfies(version, r.trim()));
  }
  return compareExact(version, range);
}

function compareMajor(a: string, b: string): number {
  return parseInt(a.split('.')[0]) - parseInt(b.split('.')[0]);
}

function compareMinor(a: string, b: string): number {
  return parseInt(a.split('.')[1] || '0') - parseInt(b.split('.')[1] || '0');
}

function comparePatch(a: string, b: string): number {
  return parseInt(a.split('.')[2] || '0') - parseInt(b.split('.')[2] || '0');
}

function compareAtLeast(a: string, b: string): boolean {
  if (compareMajor(a, b) > 0) return true;
  if (compareMajor(a, b) < 0) return false;
  if (compareMinor(a, b) > 0) return true;
  if (compareMinor(a, b) < 0) return false;
  return comparePatch(a, b) >= 0;
}

function compareAtMost(a: string, b: string): boolean {
  if (compareMajor(a, b) > 0) return false;
  if (compareMajor(a, b) < 0) return true;
  if (compareMinor(a, b) > 0) return false;
  if (compareMinor(a, b) < 0) return true;
  return comparePatch(a, b) <= 0;
}

function compareLess(a: string, b: string): boolean {
  if (compareMajor(a, b) < 0) return true;
  if (compareMajor(a, b) > 0) return false;
  if (compareMinor(a, b) < 0) return true;
  if (compareMinor(a, b) > 0) return false;
  return comparePatch(a, b) < 0;
}

function compareExact(a: string, b: string): boolean {
  return a === b;
}

function sortVersions(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
      const aVal = aParts[i] || 0;
      const bVal = bParts[i] || 0;
      if (aVal !== bVal) return aVal - bVal;
    }
    return 0;
  });
}

function highestSatisfying(versions: string[], range: string): string | null {
  const satisfying = versions.filter((v) => semverSatisfies(v, range));
  if (satisfying.length === 0) return null;
  return sortVersions(satisfying).pop()!;
}

function parseSpec(raw: string): { name: string; version: string } {
  if (raw.startsWith('@')) {
    const parts = raw.split('@');
    if (parts.length === 2) return { name: '@' + parts[1], version: 'latest' };
    return { name: parts.slice(1).join('@'), version: parts[parts.length - 1] };
  }
  if (raw.includes('@')) {
    const [name, version] = raw.split('@');
    return { name: name!, version: version || 'latest' };
  }
  return { name: raw, version: 'latest' };
}

function detectSource(spec: string): DependencySpec['source'] {
  if (spec.startsWith('git+')) return 'git';
  if (spec.startsWith('http://') || spec.startsWith('https://')) return 'url';
  if (spec.startsWith('file:')) return 'file';
  if (spec.startsWith('workspace:')) return 'workspace';
  return 'registry';
}

// ============================================================================
// Registry Client
// ============================================================================

class RegistryClient {
  private baseUrl: string;
  private cache: Map<string, RegistryMetadata> = new Map();
  private token?: string;

  constructor(registry?: string) {
    this.baseUrl = registry || MAM_REGISTRY;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async getMetadata(name: string): Promise<RegistryMetadata> {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'mam-cli/0.1.0',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        const response = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timeout);

        if (response.status === 404) {
          throw new Error(`Package '${name}' not found in registry`);
        }
        if (!response.ok) {
          throw new Error(`Registry responded with ${response.status}: ${response.statusText}`);
        }

        const metadata = (await response.json()) as RegistryMetadata;
        this.cache.set(name, metadata);
        return metadata;
      } catch (error) {
        lastError = error as Error;
        if (attempt < RETRY_COUNT - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error(`Failed to fetch metadata for '${name}'`);
  }

  async getResolved(name: string, version: string): Promise<ResolvedPackage> {
    const metadata = await this.getMetadata(name);
    let resolvedVersion: string;

    if (version === 'latest') {
      resolvedVersion = metadata['dist-tags']['latest'];
      if (!resolvedVersion) throw new Error(`No latest version found for '${name}'`);
    } else if (metadata['dist-tags'][version]) {
      resolvedVersion = metadata['dist-tags'][version];
    } else {
      resolvedVersion = highestSatisfying(Object.keys(metadata.versions), version) || version;
    }

    const pkgVersion = metadata.versions[resolvedVersion];
    if (!pkgVersion) {
      throw new Error(
        `Version '${resolvedVersion}' of '${name}' not found. Available: ${Object.keys(metadata.versions).join(', ')}`,
      );
    }

    return {
      name,
      version: resolvedVersion,
      resolved: pkgVersion.dist.tarball,
      integrity: pkgVersion.dist.integrity,
      dependencies: {} as Record<string, string>,
      optionalDependencies: {} as Record<string, string>,
      peerDependencies: {} as Record<string, string>,
      devDependencies: {} as Record<string, string>,
      deprecated: pkgVersion.deprecated,
      tarball: pkgVersion.dist.tarball,
      shasum: pkgVersion.dist.shasum,
      dist: pkgVersion.dist,
    };
  }

  async download(tarballUrl: string): Promise<Buffer> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
        const response = await fetch(tarballUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'mam-cli/0.1.0' },
        });
        clearTimeout(timeout);

        if (!response.ok) {
          throw new Error(`Download failed: ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (error) {
        lastError = error as Error;
        if (attempt < RETRY_COUNT - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
        }
      }
    }
    throw lastError || new Error('Download failed after retries');
  }
}

// ============================================================================
// Cache Manager
// ============================================================================

class CacheManager {
  private cacheDir: string;

  constructor(cacheDir?: string) {
    this.cacheDir = cacheDir || DEFAULT_CACHE_DIR;
  }

  private getCachePath(name: string, version: string): string {
    const safeName = name.startsWith('@')
      ? name.replace('/', '__')
      : name;
    return join(this.cacheDir, safeName, version);
  }

  async get(name: string, version: string): Promise<Buffer | null> {
    const cachePath = this.getCachePath(name, version);
    const tgzPath = join(cachePath, 'package.tgz');
    try {
      await access(tgzPath);
      return await readFile(tgzPath);
    } catch {
      return null;
    }
  }

  async set(name: string, version: string, data: Buffer): Promise<void> {
    const cachePath = this.getCachePath(name, version);
    await mkdir(cachePath, { recursive: true });
    const tgzPath = join(cachePath, 'package.tgz');
    await writeFile(tgzPath, data);
  }

  async has(name: string, version: string): Promise<boolean> {
    const cachePath = this.getCachePath(name, version);
    return fileExists(join(cachePath, 'package.tgz'));
  }

  async clear(): Promise<void> {
    const { default: fs } = await import('node:fs/promises');
    try {
      await fs.rm(this.cacheDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  async prune(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    let pruned = 0;
    try {
      const entries = await readdir(this.cacheDir, { withFileTypes: true });
      const now = Date.now();
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = join(this.cacheDir, entry.name);
        const dirStat = await stat(dirPath);
        if (now - dirStat.mtimeMs > maxAgeMs) {
          const { default: fs } = await import('node:fs/promises');
          await fs.rm(dirPath, { recursive: true, force: true });
          pruned++;
        }
      }
    } catch {
      // empty cache
    }
    return pruned;
  }

  async getStats(): Promise<{ files: number; size: number }> {
    let files = 0;
    let size = 0;
    try {
      const walk = async (dir: string): Promise<void> => {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else {
            files++;
            const s = await stat(fullPath);
            size += s.size;
          }
        }
      };
      await walk(this.cacheDir);
    } catch {
      // empty
    }
    return { files, size };
  }
}

// ============================================================================
// Lock File Manager
// ============================================================================

class LockFileManager {
  private lockPath: string;
  private data: LockFile;

  constructor(rootDir: string) {
    this.lockPath = join(rootDir, LOCKFILE_NAME);
    this.data = {
      lockfileVersion: MAM_LOCKFILE_VERSION,
      requires: true,
      packages: {},
    };
  }

  async load(): Promise<boolean> {
    const existing = await safeReadJson<LockFile>(this.lockPath);
    if (existing && existing.lockfileVersion) {
      this.data = existing;
      return true;
    }
    return false;
  }

  getEntry(pkgPath: string): LockFileEntry | null {
    return this.data.packages[pkgPath] || null;
  }

  setEntry(pkgPath: string, entry: LockFileEntry): void {
    this.data.packages[pkgPath] = entry;
  }

  removeEntry(pkgPath: string): void {
    delete this.data.packages[pkgPath];
  }

  hasEntry(pkgPath: string): boolean {
    return pkgPath in this.data.packages;
  }

  getEntries(): Record<string, LockFileEntry> {
    return { ...this.data.packages };
  }

  async save(): Promise<void> {
    await safeWriteJson(this.lockPath, this.data);
  }

  countEntries(): number {
    return Object.keys(this.data.packages).length;
  }

  diff(other: LockFile): { added: string[]; removed: string[]; changed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];

    for (const key of Object.keys(this.data.packages)) {
      if (!(key in other.packages)) {
        added.push(key);
      } else if (
        this.data.packages[key]!.version !== other.packages[key]!.version ||
        this.data.packages[key]!.resolved !== other.packages[key]!.resolved
      ) {
        changed.push(key);
      }
    }

    for (const key of Object.keys(other.packages)) {
      if (!(key in this.data.packages)) {
        removed.push(key);
      }
    }

    return { added, removed, changed };
  }
}

// ============================================================================
// Tarball Extractor
// ============================================================================

async function extractTarball(
  buffer: Buffer,
  targetDir: string,
): Promise<{ files: string[]; integrity: string }> {
  const files: string[] = [];
  const hash = createHash('sha256');

  await mkdir(targetDir, { recursive: true });

  const tmpFile = join(targetDir, `.._tmp_${Date.now()}.tgz`);
  await writeFile(tmpFile, buffer);

  try {
    const { execSync } = await import('node:child_process');
    execSync(`tar xzf "${tmpFile}" -C "${targetDir}" --strip-components=1`, {
      stdio: 'pipe',
    });

    const { readdirSync } = await import('node:fs');
    const walkDir = (dir: string): string[] => {
      const entries = readdirSync(dir, { withFileTypes: true });
      let results: string[] = [];
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(walkDir(full));
        } else {
          results.push(relative(targetDir, full));
          hash.update(entry.name);
        }
      }
      return results;
    };
    files.push(...walkDir(targetDir));
  } finally {
    try { await unlink(tmpFile); } catch { /* ignore */ }
  }

  const integrity = `sha256-${hash.digest('hex')}`;
  return { files, integrity };
}

// ============================================================================
// Dependency Resolution
// ============================================================================

async function resolveDependencyTree(
  specs: DependencySpec[],
  registry: RegistryClient,
  spinner: { text: string; warn: (msg: string) => void },
  seen: Map<string, ResolvedPackage> = new Map(),
  depth: number = 0,
): Promise<Map<string, ResolvedPackage>> {
  const toResolve: DependencySpec[] = [];

  for (const spec of specs) {
    const key = `${spec.name}@${spec.range || spec.version}`;
    if (seen.has(key)) continue;

    spinner.text = `${'  '.repeat(depth)}Resolving ${spec.name}@${spec.range || spec.version}...`;

    try {
      const resolved = await registry.getResolved(spec.name, spec.range || spec.version);
      seen.set(key, resolved);

      if (resolved.deprecated) {
        spinner.warn(`  ${spec.name}@${resolved.version} is deprecated: ${resolved.deprecated}`);
      }

      const subDeps = resolved.dependencies || {};
      for (const [depName, depRange] of Object.entries(subDeps)) {
        toResolve.push({
          name: depName,
          version: depRange,
          range: depRange,
          type: 'dependencies',
          parent: spec.name,
          source: 'registry',
        });
      }

      const optDeps = resolved.optionalDependencies || {};
      for (const [depName, depRange] of Object.entries(optDeps)) {
        toResolve.push({
          name: depName,
          version: depRange,
          range: depRange,
          type: 'optionalDependencies',
          parent: spec.name,
          source: 'registry',
        });
      }
    } catch (error) {
      if (spec.type === 'optionalDependencies') {
        spinner.warn(`  Optional dependency ${spec.name} not available`);
      } else {
        throw error;
      }
    }
  }

  if (toResolve.length > 0) {
    await resolveDependencyTree(toResolve, registry, spinner, seen, depth + 1);
  }

  return seen;
}

// ============================================================================
// Conflict Detection
// ============================================================================

function detectConflicts(
  resolved: Map<string, ResolvedPackage>,
  existingModules: Map<string, string>,
): VersionConflict[] {
  const conflicts: VersionConflict[] = [];
  const byName = new Map<string, ResolvedPackage[]>();

  for (const [, pkg] of resolved) {
    const list = byName.get(pkg.name) || [];
    list.push(pkg);
    byName.set(pkg.name, list);
  }

  for (const [name, pkgs] of byName) {
    const versions = [...new Set(pkgs.map((p) => p.version))];
    if (versions.length > 1) {
      const existing = existingModules.get(name);
      for (const v of versions) {
        if (existing && existing !== v) {
          conflicts.push({
            name,
            required: v,
            installed: existing,
          });
        }
      }
    }
  }

  return conflicts;
}

// ============================================================================
// Tree Shaking / Unused Detection
// ============================================================================

function detectUnused(
  packageJson: Record<string, unknown>,
  installedPaths: Set<string>,
): string[] {
  const deps = [
    ...(Object.keys(packageJson.dependencies || {}) as string[]),
    ...(Object.keys(packageJson.devDependencies || {}) as string[]),
  ];
  const unused: string[] = [];

  for (const dep of deps) {
    let found = false;
    for (const installedPath of installedPaths) {
      if (installedPath.endsWith(`/node_modules/${dep}`) || installedPath.endsWith(`\\node_modules\\${dep}`)) {
        found = true;
        break;
      }
    }
    if (!found) {
      unused.push(dep);
    }
  }

  return unused;
}

// ============================================================================
// Audit
// ============================================================================

async function auditDependencies(
  packageJson: Record<string, unknown>,
  registry: RegistryClient,
): Promise<AuditResult> {
  const allDeps: Record<string, string> = {
    ...(packageJson.dependencies as Record<string, string> || {}),
    ...(packageJson.devDependencies as Record<string, string> || {}),
  };

  const vulnerabilities: AuditVulnerability[] = [];
  let totalDependencies = 0;

  for (const [name, range] of Object.entries(allDeps)) {
    try {
      const metadata = await registry.getMetadata(name);
      totalDependencies++;

      for (const [, versionInfo] of Object.entries(metadata.versions)) {
        if (versionInfo.deprecated) {
          const resolved = highestSatisfying(
            Object.keys(metadata.versions),
            range as string,
          );
          if (resolved && semverSatisfies(resolved, range as string)) {
            vulnerabilities.push({
              name,
              severity: 'moderate',
              via: [versionInfo.deprecated],
              range: range as string,
              fixAvailable: true,
              nodes: [`node_modules/${name}`],
            });
          }
        }
      }
    } catch {
      // package not found, skip
    }
  }

  let severity: 'info' | 'low' | 'medium' | 'high' = 'info';
  for (const vuln of vulnerabilities) {
    if (vuln.severity === 'critical') { severity = 'high'; break; }
    if (vuln.severity === 'high') severity = 'high';
    if (vuln.severity === 'medium' && severity === 'info') severity = 'medium';
    if (vuln.severity === 'low' && severity === 'info') severity = 'low';
  }

  return { vulnerabilities, totalDependencies, severity };
}

// ============================================================================
// Progress Reporter
// ============================================================================

class ProgressReporter {
  private total: number;
  private completed: number = 0;
  private failed: number = 0;
  private spinner: { text: string };

  constructor(spinner: { text: string }, total: number) {
    this.spinner = spinner;
    this.total = total;
  }

  tick(name: string, success: boolean): void {
    if (success) {
      this.completed++;
    } else {
      this.failed++;
    }
    const pct = Math.round(((this.completed + this.failed) / this.total) * 100);
    const bar = this.renderBar(pct);
    this.spinner.text = `${bar} ${this.completed}/${this.total} ${name}`;
  }

  private renderBar(pct: number): string {
    const width = 20;
    const filled = Math.round((pct / 100) * width);
    const empty = width - filled;
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
  }

  get summary(): { completed: number; failed: number; total: number } {
    return { completed: this.completed, failed: this.failed, total: this.total };
  }
}

// ============================================================================
// Duplicate Detection
// ============================================================================

function findDuplicates(specs: DependencySpec[]): Map<string, DependencySpec[]> {
  const byName = new Map<string, DependencySpec[]>();
  for (const spec of specs) {
    const list = byName.get(spec.name) || [];
    list.push(spec);
    byName.set(spec.name, list);
  }

  const duplicates = new Map<string, DependencySpec[]>();
  for (const [name, list] of byName) {
    const versions = [...new Set(list.map((s) => s.range || s.version))];
    if (versions.length > 1) {
      duplicates.set(name, list);
    }
  }

  return duplicates;
}

// ============================================================================
// Peer Dependency Warning
// ============================================================================

function checkPeerDependencies(
  resolved: ResolvedPackage,
  installedModules: Map<string, string>,
): string[] {
  const warnings: string[] = [];
  const peers = resolved.peerDependencies || {};

  for (const [peerName, peerRange] of Object.entries(peers)) {
    const installed = installedModules.get(peerName);
    if (!installed) {
      warnings.push(
        `${resolved.name} requires peer ${peerName}@${peerRange} but none is installed`,
      );
    } else if (!semverSatisfies(installed, peerRange as string)) {
      warnings.push(
        `${resolved.name} requires peer ${peerName}@${peerRange} but installed is ${installed}`,
      );
    }
  }

  return warnings;
}

// ============================================================================
// Install Command
// ============================================================================

export async function installCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Initializing install...').start();
  const startTime = Date.now();

  try {
    const rootDir = resolve(options.dir || '.');
    const nodeModulesDir = join(rootDir, 'node_modules');
    const registry = new RegistryClient(options.registry);
    const cache = new CacheManager(options.cacheDir);
    const lockFile = new LockFileManager(rootDir);

    await lockFile.load();

    let packageJson = await loadPackageJson(rootDir);
    if (!packageJson) {
      spinner.fail('No mam-package.json or package.json found');
      process.exit(1);
    }

    const specs = collectDependencySpecs(packageJson, options);
    if (specs.length === 0) {
      spinner.succeed('No dependencies to install');
      return;
    }

    spinner.text = `Resolving ${specs.length} dependencies...`;
    const resolved = await resolveDependencyTree(specs, registry, spinner);

    const duplicates = findDuplicates(specs);
    for (const [name, dupes] of duplicates) {
      const versions = dupes.map((d) => d.range || d.version);
      spinner.warn(
        `Duplicate dependency: ${name} requested as ${versions.join(', ')}`,
      );
    }

    const existingModules = await getInstalledModules(nodeModulesDir);
    const conflicts = detectConflicts(resolved, existingModules);

    if (conflicts.length > 0 && !options.force) {
      spinner.warn('Version conflicts detected:');
      for (const c of conflicts) {
        console.log(
          chalk.yellow(
            `  ${c.name}: wants ${c.required} but ${c.installed} is installed`,
          ),
        );
      }
    }

    const toInstall: InstallTask[] = [];
    const toRemove: string[] = [];

    for (const [, pkg] of resolved) {
      const targetDir = join(nodeModulesDir, pkg.name);
      const pkgJsonPath = join(targetDir, 'package.json');
      const existing = await safeReadJson<{ version: string }>(pkgJsonPath);
      const fromCache = await cache.has(pkg.name, pkg.version);

      if (existing && existing.version === pkg.version && !options.force) {
        continue;
      }

      toInstall.push({
        spec: { name: pkg.name, version: pkg.version, range: pkg.version, type: 'dependencies' },
        resolved: pkg,
        targetDir,
        fromCache,
      });
    }

    const lockEntries = lockFile.getEntries();
    for (const lockPath of Object.keys(lockEntries)) {
      const name = lockPath.replace('node_modules/', '');
      if (!resolved.has(`${name}@${lockEntries[lockPath]!.version}`)) {
        toRemove.push(name);
      }
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan('\nDry run — would install:'));
      for (const task of toInstall) {
        const src = task.fromCache ? chalk.green('(cached)') : chalk.blue('(download)');
        console.log(`  ${task.resolved.name}@${task.resolved.version} ${src}`);
      }
      if (toRemove.length > 0) {
        console.log(chalk.cyan('\nWould remove:'));
        for (const name of toRemove) {
          console.log(`  ${name}`);
        }
      }
      return;
    }

    const progress = new ProgressReporter(spinner, toInstall.length);
    const parallel = options.parallel || MAX_PARALLEL_DOWNLOADS;
    const chunks: InstallTask[][] = [];
    for (let i = 0; i < toInstall.length; i += parallel) {
      chunks.push(toInstall.slice(i, i + parallel));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (task) => {
          try {
            let tarball: Buffer | null = null;

            if (task.fromCache) {
              tarball = await cache.get(task.resolved.name, task.resolved.version);
            }

            if (!tarball) {
              spinner.text = `Downloading ${task.resolved.name}@${task.resolved.version}...`;
              tarball = await registry.download(task.resolved.tarball);
              await cache.set(task.resolved.name, task.resolved.version, tarball);

              const expectedHash = task.resolved.dist.shasum;
              const actualHash = sha256(tarball);
              if (expectedHash && actualHash !== expectedHash) {
                throw new Error(
                  `Integrity check failed for ${task.resolved.name}@${task.resolved.version}: expected ${expectedHash}, got ${actualHash}`,
                );
              }
            }

            await extractTarball(tarball, task.targetDir);

            const extractedPkgJson = await safeReadJson<Record<string, unknown>>(
              join(task.targetDir, 'package.json'),
            );
            if (extractedPkgJson) {
              const subDeps = extractedPkgJson.dependencies as Record<string, string> || {};
              for (const [depName, depRange] of Object.entries(subDeps)) {
                if (!resolved.has(`${depName}@${depRange}`)) {
                  resolved.set(`${depName}@${depRange}`, {
                    name: depName,
                    version: depRange,
                    resolved: '',
                    integrity: '',
                    dependencies: {},
                    optionalDependencies: {},
                    peerDependencies: {},
                    devDependencies: {},
                    tarball: '',
                    shasum: '',
                    dist: { integrity: '', shasum: '', tarball: '' },
                  });
                }
              }
            }

            progress.tick(task.resolved.name, true);
          } catch (error) {
            progress.tick(task.resolved.name, false);
            spinner.fail(`Failed to install ${task.resolved.name}: ${(error as Error).message}`);
            throw error;
          }
        }),
      );
    }

    for (const name of toRemove) {
      const targetDir = join(nodeModulesDir, name);
      const { default: fs } = await import('node:fs/promises');
      await fs.rm(targetDir, { recursive: true, force: true });
      lockFile.removeEntry(`node_modules/${name}`);
    }

    for (const task of toInstall) {
      lockFile.setEntry(`node_modules/${task.resolved.name}`, {
        version: task.resolved.version,
        resolved: task.resolved.tarball,
        integrity: task.resolved.integrity,
      });
    }

    await lockFile.save();

    await writeIntegrityFile(rootDir, resolved, specs);

    const peerWarnings: string[] = [];
    for (const [, pkg] of resolved) {
      const warnings = checkPeerDependencies(pkg, existingModules);
      peerWarnings.push(...warnings);
    }
    if (peerWarnings.length > 0) {
      for (const warning of peerWarnings) {
        console.log(chalk.yellow(`  ⚠ ${warning}`));
      }
    }

    const installedModules = await getInstalledModules(nodeModulesDir);
    const unused = detectUnused(packageJson, new Set([...installedModules.keys()]));
    if (unused.length > 0) {
      console.log(chalk.gray('\nUnused dependencies detected:'));
      for (const name of unused) {
        console.log(chalk.gray(`  ${name}`));
      }
    }

    let auditResult: AuditResult | undefined;
    if (options.audit) {
      spinner.text = 'Auditing dependencies for vulnerabilities...';
      auditResult = await auditDependencies(packageJson, registry);
      if (auditResult.vulnerabilities.length > 0) {
        console.log(
          chalk.yellow(
            `\nFound ${auditResult.vulnerabilities.length} vulnerability(ies) [${auditResult.severity}]:`,
          ),
        );
        for (const vuln of auditResult.vulnerabilities) {
          console.log(
            chalk.yellow(`  ${vuln.name}: ${vuln.severity} — ${vuln.via.join(', ')}`),
          );
        }
      } else {
        console.log(chalk.green('\nNo known vulnerabilities found'));
      }
    }

    const duration = Date.now() - startTime;
    const result: InstallResult = {
      installed: toInstall.length,
      upToDate: resolved.size - toInstall.length,
      removed: toRemove.length,
      conflicts,
      integrityChanges: toInstall.length,
      duration,
      auditResult,
    };

    spinner.succeed(
      `Installed ${result.installed} package(s) in ${(duration / 1000).toFixed(1)}s`,
    );

    if (result.upToDate > 0) {
      console.log(chalk.gray(`  ${result.upToDate} already up to date`));
    }
    if (result.removed > 0) {
      console.log(chalk.gray(`  ${result.removed} removed`));
    }

    const stats = await cache.getStats();
    console.log(
      chalk.gray(
        `  Cache: ${stats.files} files, ${(stats.size / 1024 / 1024).toFixed(1)} MB`,
      ),
    );
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Secondary Commands
// ============================================================================

export async function installGlobalCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Installing globally...').start();
  try {
    const globalDir = join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.mam',
      'global',
      'node_modules',
    );
    await mkdir(globalDir, { recursive: true });

    await installCommand({ ...options, dir: globalDir, global: true });
    spinner.succeed('Global installation complete');
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export async function installCleanCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Cleaning node_modules...').start();
  try {
    const rootDir = resolve(options.dir || '.');
    const nodeModulesDir = join(rootDir, 'node_modules');
    const { default: fs } = await import('node:fs/promises');

    if (await fileExists(nodeModulesDir)) {
      await fs.rm(nodeModulesDir, { recursive: true, force: true });
    }

    const lockPath = join(rootDir, LOCKFILE_NAME);
    if (await fileExists(lockPath)) {
      await unlink(lockPath);
    }

    spinner.succeed('Cleaned node_modules and lock file');
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export async function installCacheCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Managing cache...').start();
  try {
    const cache = new CacheManager(options.cacheDir);

    if (options.force) {
      await cache.clear();
      spinner.succeed('Cache cleared');
      return;
    }

    const pruned = await cache.prune();
    const stats = await cache.getStats();
    spinner.succeed(
      `Cache: ${stats.files} files, ${(stats.size / 1024 / 1024).toFixed(1)} MB, ${pruned} pruned`,
    );
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export async function installAuditCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Auditing dependencies...').start();
  try {
    const rootDir = resolve(options.dir || '.');
    const packageJson = await loadPackageJson(rootDir);
    if (!packageJson) {
      spinner.fail('No package.json found');
      process.exit(1);
    }

    const registry = new RegistryClient(options.registry);
    const result = await auditDependencies(packageJson, registry);

    spinner.stop();

    if (result.vulnerabilities.length === 0) {
      console.log(chalk.green('No known vulnerabilities found'));
    } else {
      console.log(
        chalk.yellow(`\nFound ${result.vulnerabilities.length} vulnerability(ies):\n`),
      );
      for (const vuln of result.vulnerabilities) {
        const severityColor =
          vuln.severity === 'critical'
            ? chalk.red.bold
            : vuln.severity === 'high'
              ? chalk.red
              : vuln.severity === 'medium'
                ? chalk.yellow
                : chalk.gray;
        console.log(
          `  ${severityColor(vuln.severity.padEnd(10))} ${vuln.name} ${vuln.range}`,
        );
        for (const via of vuln.via) {
          console.log(chalk.gray(`              ${via}`));
        }
        if (vuln.fixAvailable) {
          const fix =
            typeof vuln.fixAvailable === 'object'
              ? `${vuln.fixAvailable.name}@${vuln.fixAvailable.version}`
              : 'run `mam install`';
          console.log(chalk.green(`              fix: ${fix}`));
        }
      }
    }

    process.exit(result.vulnerabilities.length > 0 ? 1 : 0);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export async function installDedupeCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Deduplicating dependencies...').start();
  try {
    const rootDir = resolve(options.dir || '.');
    const nodeModulesDir = join(rootDir, 'node_modules');
    const lockFile = new LockFileManager(rootDir);
    await lockFile.load();

    const entries = lockFile.getEntries();
    const byName = new Map<string, { path: string; entry: LockFileEntry }[]>();

    for (const [pkgPath, entry] of Object.entries(entries)) {
      const name = pkgPath.replace('node_modules/', '');
      const baseName = name.startsWith('@')
        ? name.split('/').slice(0, 2).join('/')
        : name.split('/')[0]!;
      const list = byName.get(baseName) || [];
      list.push({ path: pkgPath, entry });
      byName.set(baseName, list);
    }

    let deduped = 0;
    for (const [, variants] of byName) {
      if (variants.length <= 1) continue;

      const versions = [...new Set(variants.map((v) => v.entry.version))];
      if (versions.length <= 1) continue;

      const target = sortVersions(versions).pop()!;
      for (const variant of variants) {
        if (variant.entry.version !== target) {
          const targetDir = join(nodeModulesDir, variant.path);
          const targetPkgDir = join(nodeModulesDir, variant.path, '..', target);
          if (await fileExists(targetPkgDir)) {
            const { default: fs } = await import('node:fs/promises');
            await fs.rm(targetDir, { recursive: true, force: true });
            deduped++;
          }
        }
      }
    }

    spinner.succeed(`Deduped ${deduped} duplicate(s)`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Helpers (module-level)
// ============================================================================

async function loadPackageJson(
  dir: string,
): Promise<Record<string, unknown> | null> {
  for (const name of ['mam-package.json', 'package.json']) {
    const pkgPath = join(dir, name);
    const pkg = await safeReadJson<Record<string, unknown>>(pkgPath);
    if (pkg) return pkg;
  }
  return null;
}

function collectDependencySpecs(
  packageJson: Record<string, unknown>,
  options: InstallOptions,
): DependencySpec[] {
  const specs: DependencySpec[] = [];

  if (!options.production && !options.omit?.includes('dev')) {
    const devDeps = packageJson.devDependencies as Record<string, string> || {};
    for (const [name, version] of Object.entries(devDeps)) {
      const { version: range } = parseSpec(`${name}@${version}`);
      specs.push({
        name,
        version,
        range,
        type: 'devDependencies',
        source: detectSource(version),
      });
    }
  }

  if (!options.dev || options.production) {
    const deps = packageJson.dependencies as Record<string, string> || {};
    for (const [name, version] of Object.entries(deps)) {
      const { version: range } = parseSpec(`${name}@${version}`);
      specs.push({
        name,
        version,
        range,
        type: 'dependencies',
        source: detectSource(version),
      });
    }
  }

  if (options.optional !== false) {
    const optDeps = packageJson.optionalDependencies as Record<string, string> || {};
    for (const [name, version] of Object.entries(optDeps)) {
      const { version: range } = parseSpec(`${name}@${version}`);
      specs.push({
        name,
        version,
        range,
        type: 'optionalDependencies',
        source: detectSource(version),
      });
    }
  }

  if (options.peer) {
    const peerDeps = packageJson.peerDependencies as Record<string, string> || {};
    for (const [name, version] of Object.entries(peerDeps)) {
      const { version: range } = parseSpec(`${name}@${version}`);
      specs.push({
        name,
        version,
        range,
        type: 'peerDependencies',
        source: detectSource(version),
      });
    }
  }

  return specs;
}

async function getInstalledModules(
  nodeModulesDir: string,
): Promise<Map<string, string>> {
  const modules = new Map<string, string>();
  try {
    await access(nodeModulesDir);
    const entries = await readdir(nodeModulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) {
        const scopePath = join(nodeModulesDir, entry.name);
        const scopedEntries = await readdir(scopePath, { withFileTypes: true });
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) continue;
          const pkgJson = await safeReadJson<{ version: string }>(
            join(scopePath, scopedEntry.name, 'package.json'),
          );
          if (pkgJson) {
            modules.set(`${entry.name}/${scopedEntry.name}`, pkgJson.version);
          }
        }
      } else if (entry.isDirectory()) {
        const pkgJson = await safeReadJson<{ version: string }>(
          join(nodeModulesDir, entry.name, 'package.json'),
        );
        if (pkgJson) {
          modules.set(entry.name, pkgJson.version);
        }
      }
    }
  } catch {
    // no node_modules
  }
  return modules;
}

async function writeIntegrityFile(
  rootDir: string,
  resolved: Map<string, ResolvedPackage>,
  specs: DependencySpec[],
): Promise<void> {
  const integrityData: Record<string, IntegrityEntry> = {};
  for (const spec of specs) {
    const pkg = resolved.get(`${spec.name}@${spec.range || spec.version}`);
    if (pkg && pkg.integrity) {
      integrityData[spec.name] = {
        algorithm: 'sha256',
        digest: pkg.integrity,
        source: pkg.tarball,
      };
    }
  }

  const integrityPath = join(rootDir, 'node_modules', INTEGRITY_FILE);
  await mkdir(dirname(integrityPath), { recursive: true });
  await safeWriteJson(integrityPath, integrityData);
}

// ============================================================================
// Resume Interrupted Installs
// ============================================================================

export async function resumeInstall(options: InstallOptions): Promise<void> {
  const spinner = ora('Resuming interrupted install...').start();
  try {
    const rootDir = resolve(options.dir || '.');
    const lockFile = new LockFileManager(rootDir);
    const lockExists = await lockFile.load();

    if (!lockExists) {
      spinner.fail('No lock file found — run `mam install` first');
      process.exit(1);
    }

    const nodeModulesDir = join(rootDir, 'node_modules');
    const incomplete: string[] = [];

    for (const [pkgPath, entry] of Object.entries(lockFile.getEntries())) {
      const pkgDir = join(rootDir, pkgPath);
      const pkgJsonPath = join(pkgDir, 'package.json');
      const exists = await fileExists(pkgJsonPath);

      if (!exists) {
        incomplete.push(pkgPath);
      } else {
        const installed = await safeReadJson<{ version: string }>(pkgJsonPath);
        if (!installed || installed.version !== entry.version) {
          incomplete.push(pkgPath);
        }
      }
    }

    if (incomplete.length === 0) {
      spinner.succeed('All packages already installed');
      return;
    }

    spinner.text = `Resuming ${incomplete.length} incomplete package(s)...`;
    await installCommand(options);
    spinner.succeed('Resume complete');
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Shrinkwrap
// ============================================================================

export async function shrinkwrapCommand(options: InstallOptions): Promise<void> {
  const spinner = ora('Generating shrinkwrap...').start();
  try {
    const rootDir = resolve(options.dir || '.');
    const lockFile = new LockFileManager(rootDir);
    const lockExists = await lockFile.load();

    if (!lockExists) {
      spinner.fail('No lock file found — run `mam install` first');
      process.exit(1);
    }

    const shrinkwrapPath = join(rootDir, 'npm-shrinkwrap.json');
    const entries = lockFile.getEntries();
    const shrinkwrap: LockFile = {
      lockfileVersion: MAM_LOCKFILE_VERSION,
      requires: true,
      packages: {},
    };

    for (const [pkgPath, entry] of Object.entries(entries)) {
      shrinkwrap.packages[pkgPath] = {
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
      };
    }

    await safeWriteJson(shrinkwrapPath, shrinkwrap);
    spinner.succeed(`Shrinkwrap written to ${shrinkwrapPath}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// URL / Git Install
// ============================================================================

export async function installFromUrl(
  url: string,
  options: InstallOptions,
): Promise<void> {
  const spinner = ora(`Installing from ${url}...`).start();
  try {
    const rootDir = resolve(options.dir || '.');
    const nodeModulesDir = join(rootDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    const registry = new RegistryClient(options.registry);
    spinner.text = 'Downloading...';
    const tarball = await registry.download(url);

    const tempDir = join(nodeModulesDir, `_tmp_url_${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    const { files } = await extractTarball(tarball, tempDir);

    const pkgJsonPath = join(tempDir, 'package.json');
    const pkgJson = await safeReadJson<{ name: string; version: string }>(pkgJsonPath);

    if (!pkgJson || !pkgJson.name) {
      throw new Error('Downloaded archive does not contain a valid package.json');
    }

    const targetDir = join(nodeModulesDir, pkgJson.name);
    if (await fileExists(targetDir)) {
      const { default: fs } = await import('node:fs/promises');
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await rename(tempDir, targetDir);
    spinner.succeed(`Installed ${pkgJson.name}@${pkgJson.version || 'unknown'} from ${url}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export async function installFromGit(
  gitUrl: string,
  options: InstallOptions,
): Promise<void> {
  const spinner = ora(`Installing from ${gitUrl}...`).start();
  try {
    const rootDir = resolve(options.dir || '.');
    const nodeModulesDir = join(rootDir, 'node_modules');
    await mkdir(nodeModulesDir, { recursive: true });

    let ref = '';
    let url = gitUrl;
    if (gitUrl.includes('#')) {
      [url, ref] = gitUrl.split('#');
    }

    const tempDir = join(nodeModulesDir, `_tmp_git_${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    spinner.text = 'Cloning repository...';
    const cloneUrl = url!.replace('git+', '').replace('git://', 'https://');

    const { execSync } = await import('node:child_process');
    execSync(
      `git clone --depth 1 ${ref ? `--branch ${ref}` : ''} "${cloneUrl}" "${tempDir}"`,
      { stdio: 'pipe' },
    );

    const pkgJsonPath = join(tempDir, 'package.json');
    const pkgJson = await safeReadJson<{ name: string; version: string }>(pkgJsonPath);

    if (!pkgJson || !pkgJson.name) {
      throw new Error('Cloned repository does not contain a valid package.json');
    }

    const targetDir = join(nodeModulesDir, pkgJson.name);
    if (await fileExists(targetDir)) {
      const { default: fs } = await import('node:fs/promises');
      await fs.rm(targetDir, { recursive: true, force: true });
    }

    await rename(tempDir, targetDir);
    spinner.succeed(
      `Installed ${pkgJson.name}@${pkgJson.version || 'git'} from ${gitUrl}`,
    );
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}
