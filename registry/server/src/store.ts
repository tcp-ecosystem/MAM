/**
 * MAM Module Store
 * 
 * Persistent storage for modules and versions.
 *
 * Two concurrent publishes of the same module used to interleave their read,
 * merge and write, which left a truncated or lost `meta.json`. Every write now
 * goes through `writeFileAtomic`, and every operation that mutates a module
 * runs under that module's own lock, so unrelated modules still publish in
 * parallel.
 */

import { readFile, writeFile, mkdir, access, readdir, rm, rename } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { PackageManifest } from '@mam/package-manager';

// ============================================================================
// Atomic write
// ============================================================================

/**
 * Windows refuses to replace a file that anything else has open, so the rename
 * is retried for a moment. Antivirus scanners, search indexers and ordinary
 * concurrent readers all cause this, and a publish should not fail because one
 * of them happened to be looking at `meta.json`.
 *
 * Bounded on purpose, and it does absorb a reader that polls every few
 * milliseconds. It cannot rescue a writer against a reader that holds the file
 * open essentially continuously; no bound can, short of queueing forever. That
 * case surfaces as a rejected publish with the previous file intact, which is
 * the behaviour worth having: a lost write is recoverable, a truncated
 * `meta.json` is not.
 */
const RENAME_RETRYABLE = new Set(['EPERM', 'EACCES', 'EBUSY']);
/**
 * How long to keep retrying a rename before giving up.
 *
 * A deadline rather than an attempt count, because what matters is surviving a
 * reader's hold, and hold time does not have an attempt-count equivalent. Two
 * seconds comfortably covers a slow poller while still failing fast enough for
 * a genuinely permanent hold to surface as an error.
 */
const RENAME_DEADLINE_MS = 2_000;
const RENAME_BACKOFF_CEILING_MS = 50;

async function renameWithRetry(from: string, to: string): Promise<void> {
  const deadline = Date.now() + RENAME_DEADLINE_MS;

  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!RENAME_RETRYABLE.has((error as NodeJS.ErrnoException).code) || Date.now() >= deadline) {
        throw error;
      }
      // Exponential backoff with *full* jitter. The jitter is the important half:
      // a fixed or linear backoff can lock into resonance with a reader that
      // polls on a similar period, and then every retry lands inside the same
      // held window forever. Randomising the wait decorrelates the writer from
      // the reader instead of racing it on a fixed schedule.
      const ceiling = Math.min(RENAME_BACKOFF_CEILING_MS, 2 ** Math.min(attempt, 6));
      const wait = Math.floor(Math.random() * ceiling);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

/**
 * Writes a file so a reader never observes a partial one.
 *
 * The bytes go to a uniquely named temp file in the *same* directory as the
 * target, then the temp is renamed over it. Same directory matters: `rename`
 * is only atomic within a single filesystem, and the destination directory is
 * the one place guaranteed to be on it. `rename` is atomic, so a crash at any
 * point leaves either the old complete file or the new complete file, never a
 * truncated one.
 *
 * The unique suffix lets two processes write the same target concurrently
 * without clobbering each other's temp.
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, content, 'utf-8');
    await renameWithRetry(temp, target);
  } catch (error) {
    // A failed write removes its own temp so the data directory is not littered
    // with debris. The target is untouched either way, because it is only ever
    // replaced by a rename that completed.
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

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
  /** Set when the module has been archived; archived modules stay resolvable. */
  archived?: boolean;
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
// Path safety
// ============================================================================

/** Raised when a module name or file path would escape the data directory. */
export class PathSafetyError extends Error {
  readonly value: string;
  readonly kind: 'module-name' | 'file-path';
  constructor(kind: 'module-name' | 'file-path', value: string, reason: string) {
    super(`Unsafe ${kind} "${value}": ${reason}`);
    this.name = 'PathSafetyError';
    this.kind = kind;
    this.value = value;
  }
}

/**
 * A module name is a single path segment, not a path.
 *
 * Scoped names are common (`@mam/thing`), so a slash is allowed only as the
 * one separating a scope from the package.
 */
const MODULE_NAME = /^(?:@[a-zA-Z0-9][\w.-]{0,63}\/)?[a-zA-Z0-9][\w.-]{0,127}$/;

/**
 * Validates a module name before it is joined onto the modules directory.
 *
 * Without this, `publish({ name: "../../x" })` writes a directory outside the
 * data directory: `join(modulesDir, "../../x")` normalises straight past it.
 */
export function assertSafeModuleName(name: unknown): string {
  if (typeof name !== 'string' || name.length === 0) {
    throw new PathSafetyError('module-name', String(name), 'must be a non-empty string');
  }
  if (name.includes('\0')) {
    throw new PathSafetyError('module-name', name, 'must not contain a null byte');
  }
  if (name === '.' || name === '..' || name.includes('..')) {
    throw new PathSafetyError('module-name', name, 'must not contain a parent-directory segment');
  }
  if (/^[/\\]/.test(name) || /^[A-Za-z]:/.test(name)) {
    throw new PathSafetyError('module-name', name, 'must be relative, not absolute');
  }
  if (/[\\]/.test(name)) {
    throw new PathSafetyError('module-name', name, 'must use forward slashes only');
  }
  const segments = name.split('/');
  if (segments.length > 2) {
    throw new PathSafetyError('module-name', name, 'has too many path segments');
  }
  if (!MODULE_NAME.test(name)) {
    throw new PathSafetyError('module-name', name, 'contains characters that are not allowed');
  }
  return name;
}

/**
 * Validates a published file path.
 *
 * A file path is relative to the module directory and may nest, but must not
 * climb out of it. Resolving and re-checking the containment is the part that
 * actually matters, because a pattern alone does not cover every spelling of
 * the same escape.
 */
export function assertSafeFilePath(root: string, filePath: unknown): string {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new PathSafetyError('file-path', String(filePath), 'must be a non-empty string');
  }
  if (filePath.includes('\0')) {
    throw new PathSafetyError('file-path', filePath, 'must not contain a null byte');
  }
  if (/^[/\\]/.test(filePath) || /^[A-Za-z]:/.test(filePath)) {
    throw new PathSafetyError('file-path', filePath, 'must be relative, not absolute');
  }
  if (filePath.includes('\\')) {
    throw new PathSafetyError('file-path', filePath, 'must use forward slashes only');
  }

  // Belt and braces: resolve, then confirm the result is still under root.
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, filePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new PathSafetyError('file-path', filePath, 'resolves outside the module directory');
  }
  return filePath;
}

// ============================================================================
// Module Store
// ============================================================================

export class ModuleStore {
  private dataDir: string;
  private modulesDir: string;
  /**
   * Tail of the serialisation chain for each module, keyed by module name.
   *
   * Keyed per module rather than globally on purpose: a global lock would make
   * publishing `@a/b` wait on `@c/d`, which is a throughput regression for
   * every module in the registry in exchange for a guarantee nobody needs.
   */
  private moduleLocks: Map<string, Promise<void>> = new Map();

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
   * Runs `fn` with exclusive access to one module.
   *
   * Callers queue behind the previous operation on the same name. The stored
   * tail never rejects, so one failed operation cannot wedge the module for the
   * rest of the process's life, and a queue that nobody is waiting on is
   * dropped so the map does not grow with every module ever touched.
   */
  private async withModuleLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.moduleLocks.get(name) ?? Promise.resolve();
    const run = previous.then(fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.moduleLocks.set(name, tail);
    try {
      return await run;
    } finally {
      if (this.moduleLocks.get(name) === tail) this.moduleLocks.delete(name);
    }
  }

  /**
   * Replaces a module's `meta.json` in one atomic step.
   */
  private async writeMeta(name: string, record: ModuleRecord): Promise<void> {
    const moduleDir = this.moduleDirFor(name);
    await mkdir(moduleDir, { recursive: true });
    await writeFileAtomic(join(moduleDir, 'meta.json'), JSON.stringify(record, null, 2));
  }

  /**
   * Resolves a module name to its directory, refusing to leave the registry.
   *
   * Every path built from a name goes through here, so the containment check
   * cannot be forgotten at a call site.
   */
  private moduleDirFor(name: string): string {
    assertSafeModuleName(name);
    const dir = join(this.modulesDir, name);
    const root = resolve(this.modulesDir);
    const resolved = resolve(dir);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new PathSafetyError('module-name', name, 'resolves outside the registry');
    }
    return dir;
  }

  /**
   * Get module record
   *
   * Reads need no lock: `meta.json` is only ever replaced by a rename, so a
   * reader sees one complete record or the other, never a mixture.
   */
  async getModule(name: string): Promise<ModuleRecord | null> {
    const metaPath = join(this.moduleDirFor(name), 'meta.json');

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
   *
   * The whole read-merge-write runs under the module's lock, so two concurrent
   * publishes of the same version converge on a single record instead of two
   * half-written ones, and two publishes of different versions cannot lose each
   * other's entry.
   */
  async publish(
    manifest: PackageManifest,
    files: Map<string, string>,
    publishedBy: string
  ): Promise<{ name: string; version: string }> {
    return this.withModuleLock(manifest.name, async () => {
      // Validate the name and every file path before touching the filesystem:
      // a crafted name or path would otherwise write outside the registry.
      const moduleDir = this.moduleDirFor(manifest.name);
      for (const path of files.keys()) {
        assertSafeFilePath(moduleDir, path);
      }
      await mkdir(moduleDir, { recursive: true });

      // Get or create module record
      let record = await this.getModule(manifest.name);
      // A stored record is always complete. A publish that omits an optional
      // manifest field must not leave `undefined` behind it: the search indexer
      // spreads `tags`, and `...undefined` is a 500 on every publish without
      // tags rather than a validation error on the one that omitted them.
      if (!record) {
        record = {
          name: manifest.name,
          description: manifest.description ?? '',
          author: manifest.author ?? 'anonymous',
          tags: Array.isArray(manifest.tags) ? manifest.tags : [],
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

      // Content first, then metadata. `meta.json` is the index readers trust,
      // so it must never name a version whose files are not on disk yet.
      const versionDir = join(moduleDir, manifest.version);
      await mkdir(versionDir, { recursive: true });

      for (const [path, content] of files) {
        const filePath = join(versionDir, path);
        const fileDir = dirname(filePath);
        await mkdir(fileDir, { recursive: true });
        await writeFileAtomic(filePath, content);
      }

      record.latest = manifest.version;
      record.updatedAt = new Date().toISOString();

      // Save
      await this.writeMeta(manifest.name, record);

      return { name: manifest.name, version: manifest.version };
    });
  }

  /**
   * Delete module
   */
  async deleteModule(name: string): Promise<void> {
    await this.withModuleLock(name, async () => {
    const moduleDir = this.moduleDirFor(name);
    await rm(moduleDir, { recursive: true, force: true });

    });
  }

  /**
   * Mark a module as archived, or clear the flag.
   *
   * Writes `meta.json` directly because the flag lives on the module record
   * rather than on any version, so re-publishing a version would not carry it.
   * Archived modules stay resolvable; only their availability changes.
   *
   * Runs under the module's lock and through the atomic writer, so an archive
   * cannot race a publish and drop a version.
   */
  async setArchived(name: string, archived: boolean): Promise<ModuleRecord> {
    return this.withModuleLock(name, async () => {
      const record = await this.getModule(name);
      if (!record) {
        throw new Error(`Module "${name}" not found`);
      }
      record.archived = archived;
      record.updatedAt = new Date().toISOString();
      await this.writeMeta(name, record);
      return record;
    });
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

  /**
   * Content integrity hash over the published files.
   *
   * Real SHA-256, not the 32-bit rolling hash this used to return while still
   * labelling the output `sha256-`; a field called integrity that cannot detect
   * a modified payload is worse than no hash at all.
   *
   * Paths are sorted before hashing, so the same files hash identically
   * regardless of the order they were supplied in.
   */
  private generateIntegrity(files: Record<string, string>): string {
    const hash = createHash('sha256');
    for (const path of Object.keys(files).sort()) {
      // Length-prefix each part so a file named "ab" with body "c" cannot
      // collide with a file named "a" with body "bc".
      hash.update(String(Buffer.byteLength(path, 'utf-8')));
      hash.update(':');
      hash.update(path);
      hash.update(':');
      const content = files[path] ?? '';
      hash.update(String(Buffer.byteLength(content, 'utf-8')));
      hash.update(':');
      hash.update(content);
      hash.update('\n');
    }
    return `sha256-${hash.digest('hex')}`;
  }
}

export interface RegistryStats {
  totalModules: number;
  totalVersions: number;
  totalDownloads: number;
  lastUpdated: string;
}
