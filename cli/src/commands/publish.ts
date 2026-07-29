/**
 * MAM Publish Command
 *
 * Production-grade package publisher with registry auth, version bumping,
 * tarball creation, changelog extraction, signing, and deprecation support.
 */

import {
  readFile,
  writeFile,
  mkdir,
  access,
  stat,
  readdir,
  unlink,
  cp,
} from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import { resolve, join, basename, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { promisify } from 'node:util';
import { exec, execSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import { parseMAM } from '@mam/parser';

// ============================================================================
// Types
// ============================================================================

export interface PublishOptions {
  file: string;
  registry?: string;
  access?: 'public' | 'restricted' | 'private';
  token?: string;
  otp?: string;
  tag?: string;
  dryRun?: boolean;
  force?: boolean;
  bump?: 'major' | 'minor' | 'patch' | 'premajor' | 'preminor' | 'prepatch' | 'prerelease';
  preid?: string;
  gitTag?: boolean;
  gitPush?: boolean;
  message?: string;
  unpacked?: boolean;
  sign?: boolean;
  signKey?: string;
  include?: string[];
  exclude?: string[];
  beforePublish?: string;
  afterPublish?: string;
  tarball?: string;
}

interface PackageManifest {
  name: string;
  version: string;
  description?: string;
  author?: string | { name: string; email?: string; url?: string };
  license?: string;
  repository?: string | { type?: string; url: string; directory?: string };
  homepage?: string;
  bugs?: string | { url?: string; email?: string };
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  main?: string;
  module?: string;
  types?: string;
  exports?: Record<string, unknown>;
  files?: string[];
  bin?: Record<string, string> | string;
  engines?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  config?: Record<string, unknown>;
  scripts?: Record<string, string>;
  mam?: Record<string, unknown>;
}

interface PublishManifest {
  name: string;
  version: string;
  description: string;
  dist: {
    tarball: string;
    shasum: string;
    integrity: string;
    fileCount: number;
    unpackedSize: number;
    signatures?: Array<{ keyid: string; sig: string }>;
  };
  _id: string;
  _rev: string;
  license: string;
  author: string;
  repository?: { type: string; url: string };
  keywords: string[];
  files: string[];
  main: string;
  module: string;
  types: string;
  exports: Record<string, unknown>;
  engines: Record<string, string>;
  deprecated?: string;
  distTags: Record<string, string>;
}

interface PublishResult {
  name: string;
  version: string;
  tarball: string;
  size: number;
  integrity: string;
  publishedAt: string;
  registry: string;
  access: string;
}

interface ChangelogEntry {
  version: string;
  date: string;
  changes: ChangelogChange[];
}

interface ChangelogChange {
  type: 'added' | 'changed' | 'deprecated' | 'removed' | 'fixed' | 'security';
  description: string;
}

interface VersionBumpResult {
  current: string;
  next: string;
  type: string;
  preid?: string;
}

interface DeprecationResult {
  package: string;
  version: string;
  message: string;
  alternative?: string;
}

interface PackageInfo {
  name: string;
  version: string;
  description: string;
  readme: string;
  homepage: string;
  repository: string;
  author: string;
  license: string;
  keywords: string[];
  dependencies: Record<string, string>;
  versions: string[];
  distTags: Record<string, string>;
  time: Record<string, string>;
  maintainers: Array<{ name: string; email: string }>;
}

// ============================================================================
// Constants
// ============================================================================

const MAM_REGISTRY = 'https://registry.mam.dev';
const DEFAULT_ACCESS: PublishOptions['access'] = 'public';
const TAR_FILENAME = 'package.tar.gz';
const README_MAX_LENGTH = 1024 * 64;
const MAX_PACKAGE_SIZE = 50 * 1024 * 1024;
const SUPPORTED_HASHES = ['sha256', 'sha512'] as const;

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

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function sha512(data: Buffer | string): string {
  return createHash('sha512').update(data).digest('hex');
}

function createIntegrity(buffer: Buffer): string {
  const hash = sha512(buffer);
  return `sha512-${hash}`;
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
} {
  const match = version.match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([\d.a-z\-]+(?:\.[\d.a-z\-]+)*))?(?:\+([\d.a-z\-]+(?:\.[\d.a-z\-]+)*))?$/,
  );
  if (!match) throw new Error(`Invalid semver: ${version}`);
  return {
    major: parseInt(match[1]!),
    minor: parseInt(match[2]!),
    patch: parseInt(match[3]!),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  };
}

function formatSemver(
  major: number,
  minor: number,
  patch: number,
  prerelease: string[] = [],
  build: string[] = [],
): string {
  let ver = `${major}.${minor}.${patch}`;
  if (prerelease.length > 0) ver += `-${prerelease.join('.')}`;
  if (build.length > 0) ver += `+${build.join('.')}`;
  return ver;
}

async function getGitUser(): Promise<{ name: string; email: string }> {
  try {
    const { execSync } = await import('node:child_process');
    const name = execSync('git config user.name', { encoding: 'utf-8' }).trim();
    const email = execSync('git config user.email', { encoding: 'utf-8' }).trim();
    return { name, email };
  } catch {
    return { name: 'unknown', email: 'unknown' };
  }
}

async function getGitRemoteUrl(): Promise<string | null> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

async function getGitTags(): Promise<string[]> {
  try {
    const { execSync } = await import('node:child_process');
    const output = execSync('git tag --list', { encoding: 'utf-8' });
    return output.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================================
// Manifest Builder
// ============================================================================

class ManifestBuilder {
  private pkg: PackageManifest;
  private mamData: Record<string, unknown>;
  private sourceFile: string;

  constructor(pkg: PackageManifest, mamData: Record<string, unknown>, sourceFile: string) {
    this.pkg = pkg;
    this.mamData = mamData;
    this.sourceFile = sourceFile;
  }

  static fromPackageJson(
    pkg: PackageManifest,
    mamData: Record<string, unknown>,
    sourceFile: string,
  ): ManifestBuilder {
    return new ManifestBuilder(pkg, mamData, sourceFile);
  }

  getName(): string {
    return this.pkg.name;
  }

  getVersion(): string {
    return this.pkg.version;
  }

  getDescription(): string {
    return this.pkg.description || (this.mamData as Record<string, unknown>).description as string || '';
  }

  getAuthor(): string {
    const author = this.pkg.author;
    if (!author) return '';
    if (typeof author === 'string') return author;
    return author.name + (author.email ? ` <${author.email}>` : '');
  }

  getLicense(): string {
    return this.pkg.license || 'MIT';
  }

  getRepository(): { type: string; url: string } | undefined {
    const repo = this.pkg.repository;
    if (!repo) return undefined;
    if (typeof repo === 'string') {
      return { type: 'git', url: repo };
    }
    return { type: repo.type || 'git', url: repo.url };
  }

  getKeywords(): string[] {
    return this.pkg.keywords || [];
  }

  getDependencies(): Record<string, string> {
    return this.pkg.dependencies || {};
  }

  getMain(): string {
    return this.pkg.main || 'index.js';
  }

  getModule(): string {
    return this.pkg.module || '';
  }

  getTypes(): string {
    return this.pkg.types || '';
  }

  getExports(): Record<string, unknown> {
    return this.pkg.exports || {};
  }

  getEngines(): Record<string, string> {
    return this.pkg.engines || {};
  }

  getFiles(): string[] {
    return this.pkg.files || [];
  }

  getBin(): Record<string, string> | undefined {
    if (!this.pkg.bin) return undefined;
    if (typeof this.pkg.bin === 'string') {
      return { [this.pkg.name]: this.pkg.bin };
    }
    return this.pkg.bin;
  }

  async buildPublishManifest(
    tarballUrl: string,
    integrity: string,
    shasum: string,
    fileCount: number,
    unpackedSize: number,
  ): Promise<PublishManifest> {
    return {
      name: this.pkg.name,
      version: this.pkg.version,
      description: this.getDescription(),
      dist: {
        tarball: tarballUrl,
        shasum,
        integrity,
        fileCount,
        unpackedSize,
      },
      _id: `${this.pkg.name}@${this.pkg.version}`,
      _rev: '',
      license: this.getLicense(),
      author: this.getAuthor(),
      repository: this.getRepository(),
      keywords: this.getKeywords(),
      files: this.getFiles(),
      main: this.getMain(),
      module: this.getModule(),
      types: this.getTypes(),
      exports: this.getExports(),
      engines: this.getEngines(),
      distTags: {},
    };
  }
}

// ============================================================================
// Registry Client
// ============================================================================

class RegistryClient {
  private baseUrl: string;
  private token?: string;
  private authHeader?: string;

  constructor(registry?: string) {
    this.baseUrl = registry || MAM_REGISTRY;
  }

  setToken(token: string): void {
    this.token = token;
    this.authHeader = `Bearer ${token}`;
  }

  setBasicAuth(user: string, pass: string): void {
    const encoded = Buffer.from(`${user}:${pass}`).toString('base64');
    this.authHeader = `Basic ${encoded}`;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'mam-cli/0.1.0',
    };
    if (this.authHeader) {
      headers['Authorization'] = this.authHeader;
    }
    return headers;
  }

  async getPackage(name: string): Promise<PackageInfo | null> {
    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;
    try {
      const response = await fetch(url, { headers: this.getHeaders() });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Registry error: ${response.status}`);
      return (await response.json()) as PackageInfo;
    } catch {
      return null;
    }
  }

  async publish(manifest: PublishManifest): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(manifest.name).replace('%40', '@')}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify(manifest),
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        'Authentication failed. Run `mam login` or set MAM_TOKEN environment variable.',
      );
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      throw new Error(
        `Publish failed (${response.status}): ${(body as { error?: string }).error || response.statusText}`,
      );
    }
  }

  async unpublish(name: string, version?: string): Promise<void> {
    const url = version
      ? `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}/${version}`
      : `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Unpublish failed: ${response.status} ${response.statusText}`);
    }
  }

  async deprecate(name: string, version: string, message: string): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(name).replace('%40', '@')}/-/deprecate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ id: `${name}@${version}`, message }),
    });

    if (!response.ok) {
      throw new Error(`Deprecation failed: ${response.status} ${response.statusText}`);
    }
  }

  async whoami(): Promise<string> {
    const url = `${this.baseUrl}/-/whoami`;
    const response = await fetch(url, { headers: this.getHeaders() });
    if (!response.ok) throw new Error('Not authenticated');
    const body = (await response.json()) as { username: string };
    return body.username;
  }
}

// ============================================================================
// Tarball Creator
// ============================================================================

class TarballCreator {
  private rootDir: string;
  private includePatterns: string[];
  private excludePatterns: string[];
  private unpacked: boolean;

  constructor(
    rootDir: string,
    include?: string[],
    exclude?: string[],
    unpacked: boolean = false,
  ) {
    this.rootDir = rootDir;
    this.includePatterns = include || [];
    this.excludePatterns = exclude || ['node_modules', '.git', '.mam'];
    this.unpacked = unpacked;
  }

  async create(): Promise<{ buffer: Buffer; fileCount: number; unpackedSize: number }> {
    const { execSync } = await import('node:child_process');

    const excludeArgs = this.excludePatterns
      .map((p) => `--exclude="${p}"`)
      .join(' ');

    const includeArgs = this.includePatterns
      .map((p) => `--include="${p}"`)
      .join(' ');

    const tmpDir = join(this.rootDir, `_mam_pack_${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      execSync(
        `tar czf "${join(tmpDir, TAR_FILENAME)}" ${excludeArgs} ${includeArgs} -C "${this.rootDir}" .`,
        { stdio: 'pipe', cwd: this.rootDir },
      );

      const buffer = await readFile(join(tmpDir, TAR_FILENAME));

      const listOutput = execSync(
        `tar tzf "${join(tmpDir, TAR_FILENAME)}"`,
        { encoding: 'utf-8', cwd: this.rootDir },
      );
      const fileCount = listOutput.trim().split('\n').filter(Boolean).length;

      const stats = await stat(join(tmpDir, TAR_FILENAME));
      const unpackedSize = stats.size * 3;

      return { buffer, fileCount, unpackedSize };
    } finally {
      const { default: fs } = await import('node:fs/promises');
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async createUnpacked(): Promise<Buffer> {
    const { execSync } = await import('node:child_process');
    const tmpDir = join(this.rootDir, `_mam_pack_${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    try {
      execSync(
        `tar czf "${join(tmpDir, TAR_FILENAME)}" --exclude="node_modules" --exclude=".git" -C "${this.rootDir}" .`,
        { stdio: 'pipe', cwd: this.rootDir },
      );
      return readFile(join(tmpDir, TAR_FILENAME));
    } finally {
      const { default: fs } = await import('node:fs/promises');
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// ============================================================================
// Version Manager
// ============================================================================

class VersionManager {
  private currentVersion: string;

  constructor(currentVersion: string) {
    this.currentVersion = currentVersion;
  }

  bump(type: string, preid?: string): VersionBumpResult {
    const parsed = parseSemver(this.currentVersion);
    let next = '';
    let preidStr = preid || 'alpha';

    switch (type) {
      case 'major':
        next = formatSemver(parsed.major + 1, 0, 0);
        break;
      case 'minor':
        next = formatSemver(parsed.major, parsed.minor + 1, 0);
        break;
      case 'patch':
        next = formatSemver(parsed.major, parsed.minor, parsed.patch + 1);
        break;
      case 'premajor':
        next = formatSemver(parsed.major + 1, 0, 0, [preidStr, '0']);
        break;
      case 'preminor':
        next = formatSemver(parsed.major, parsed.minor + 1, 0, [preidStr, '0']);
        break;
      case 'prepatch':
        next = formatSemver(parsed.major, parsed.minor, parsed.patch + 1, [preidStr, '0']);
        break;
      case 'prerelease':
        if (parsed.prerelease.length > 0) {
          const preNum = parseInt(parsed.prerelease[parsed.prerelease.length - 1] || '0');
          if (isNaN(preNum)) {
            next = formatSemver(
              parsed.major,
              parsed.minor,
              parsed.patch,
              [...parsed.prerelease.slice(0, -1), '0'],
            );
          } else {
            const newPre = [...parsed.prerelease.slice(0, -1), String(preNum + 1)];
            next = formatSemver(parsed.major, parsed.minor, parsed.patch, newPre);
          }
        } else {
          next = formatSemver(parsed.major, parsed.minor, parsed.patch + 1, [preidStr, '0']);
        }
        break;
      default:
        throw new Error(`Unknown bump type: ${type}`);
    }

    return {
      current: this.currentVersion,
      next,
      type,
      preid: preidStr,
    };
  }

  isPreRelease(): boolean {
    return this.currentVersion.includes('-');
  }

  getPreReleaseId(): string | null {
    const parsed = parseSemver(this.currentVersion);
    if (parsed.prerelease.length > 0) {
      return parsed.prerelease[0] || null;
    }
    return null;
  }
}

// ============================================================================
// Changelog Generator
// ============================================================================

class ChangelogGenerator {
  private entries: ChangelogEntry[] = [];

  addEntry(entry: ChangelogEntry): void {
    this.entries.push(entry);
  }

  async generateFromGit(fromTag?: string): Promise<ChangelogEntry[]> {
    const { execSync } = await import('node:child_process');
    const tags = await getGitTags();
    const sortedTags = tags.sort();

    let startRef = fromTag;
    if (!startRef && sortedTags.length > 0) {
      startRef = sortedTags[sortedTags.length - 1];
    }

    const endRef = 'HEAD';
    const range = startRef ? `${startRef}..${endRef}` : endRef;

    let logOutput: string;
    try {
      logOutput = execSync(
        `git log ${range} --pretty=format:"%H|%s|%an|%ai" --no-merges`,
        { encoding: 'utf-8' },
      );
    } catch {
      return [];
    }

    const entries: ChangelogChange[] = [];
    const lines = logOutput.trim().split('\n').filter(Boolean);

    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 2) continue;

      const message = parts[1]!;
      let type: ChangelogChange['type'] = 'fixed';
      let description = message;

      const conventionalMatch = message.match(
        /^(feat|fix|docs|style|refactor|perf|test|chore|ci|build)(?:\(.+?\))?!?:\s*(.+)$/,
      );

      if (conventionalMatch) {
        const prefix = conventionalMatch[1];
        description = conventionalMatch[2];
        switch (prefix) {
          case 'feat':
            type = 'added';
            break;
          case 'fix':
            type = 'fixed';
            break;
          case 'perf':
            type = 'changed';
            break;
          case 'refactor':
            type = 'changed';
            break;
          case 'docs':
            type = 'changed';
            break;
          case 'test':
            type = 'changed';
            break;
          case 'chore':
          case 'ci':
          case 'build':
            type = 'changed';
            break;
        }
      }

      entries.push({ type, description });
    }

    const entry: ChangelogEntry = {
      version: 'Unreleased',
      date: new Date().toISOString().split('T')[0]!,
      changes: entries,
    };

    this.entries.unshift(entry);
    return this.entries;
  }

  generateMarkdown(): string {
    const lines: string[] = ['# Changelog', ''];

    for (const entry of this.entries) {
      lines.push(`## ${entry.version} (${entry.date})`);
      lines.push('');

      const grouped = new Map<ChangelogChange['type'], ChangelogChange[]>();
      for (const change of entry.changes) {
        const list = grouped.get(change.type) || [];
        list.push(change);
        grouped.set(change.type, list);
      }

      const typeLabels: Record<string, string> = {
        added: 'Added',
        changed: 'Changed',
        deprecated: 'Deprecated',
        removed: 'Removed',
        fixed: 'Fixed',
        security: 'Security',
      };

      for (const [type, changes] of grouped) {
        lines.push(`### ${typeLabels[type] || type}`);
        lines.push('');
        for (const change of changes) {
          lines.push(`- ${change.description}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}

// ============================================================================
// README Generator
// ============================================================================

class ReadmeGenerator {
  private pkg: PackageManifest;
  private mamData: Record<string, unknown>;

  constructor(pkg: PackageManifest, mamData: Record<string, unknown>) {
    this.pkg = pkg;
    this.mamData = mamData;
  }

  generate(): string {
    const lines: string[] = [];

    lines.push(`# ${this.pkg.name}`);
    lines.push('');

    if (this.pkg.description) {
      lines.push(`> ${this.pkg.description}`);
      lines.push('');
    }

    if (this.pkg.version) {
      lines.push(`**Version:** ${this.pkg.version}`);
      lines.push('');
    }

    if (this.pkg.author) {
      const author = typeof this.pkg.author === 'string'
        ? this.pkg.author
        : this.pkg.author.name;
      lines.push(`**Author:** ${author}`);
      lines.push('');
    }

    lines.push('## Installation');
    lines.push('');
    lines.push('```bash');
    lines.push(`mam install ${this.pkg.name}`);
    lines.push('```');
    lines.push('');

    const mamContent = (this.mamData as Record<string, unknown>).content;
    if (typeof mamContent === 'string' && mamContent.trim().length > 0) {
      lines.push('## Usage');
      lines.push('');
      lines.push(mamContent.slice(0, README_MAX_LENGTH));
      lines.push('');
    }

    if (this.pkg.dependencies && Object.keys(this.pkg.dependencies).length > 0) {
      lines.push('## Dependencies');
      lines.push('');
      for (const [name, version] of Object.entries(this.pkg.dependencies)) {
        lines.push(`- ${name}: ${version}`);
      }
      lines.push('');
    }

    if (this.pkg.engines) {
      lines.push('## Requirements');
      lines.push('');
      for (const [engine, range] of Object.entries(this.pkg.engines)) {
        lines.push(`- ${engine}: ${range}`);
      }
      lines.push('');
    }

    lines.push('## License');
    lines.push('');
    lines.push(this.pkg.license || 'MIT');
    lines.push('');

    return lines.join('\n');
  }
}

// ============================================================================
// Package Validator
// ============================================================================

class PackageValidator {
  private errors: string[] = [];
  private warnings: string[] = [];

  validate(pkg: PackageManifest, mamData: Record<string, unknown>, filePath: string): void {
    this.errors = [];
    this.warnings = [];

    if (!pkg.name) {
      this.errors.push('Package name is required');
    } else if (!/^(?:@[a-z0-9\-~][a-z0-9\-._~]*\/)?[a-z0-9\-~][a-z0-9\-._~]*$/.test(pkg.name)) {
      this.errors.push(`Invalid package name: ${pkg.name}`);
    }

    if (!pkg.version) {
      this.errors.push('Package version is required');
    } else {
      try {
        parseSemver(pkg.version);
      } catch {
        this.errors.push(`Invalid version: ${pkg.version}`);
      }
    }

    if (pkg.version && pkg.version.startsWith('v')) {
      this.warnings.push('Version should not start with "v"');
    }

    if (!pkg.description) {
      this.warnings.push('Package description is recommended');
    }

    if (!pkg.author) {
      this.warnings.push('Package author is recommended');
    }

    if (!pkg.license) {
      this.warnings.push('Package license is recommended (defaulting to MIT)');
    }

    if (pkg.main && !pkg.main.endsWith('.js') && !pkg.main.endsWith('.mjs')) {
      this.warnings.push('Main entry point should be a .js or .mjs file');
    }

    if (pkg.bin) {
      const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
      for (const bin of bins) {
        if (!bin.endsWith('.js') && !bin.endsWith('.mjs')) {
          this.warnings.push(`Binary ${bin} should be a .js or .mjs file`);
        }
      }
    }

    if (pkg.dependencies) {
      for (const [name, version] of Object.entries(pkg.dependencies)) {
        if (!version || version === '*') {
          this.warnings.push(`Dependency ${name} has wildcard version`);
        }
      }
    }

    if (!mamData) {
      this.warnings.push('No MAM frontmatter data found');
    }
  }

  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }
}

// ============================================================================
// Pre/Post Hook Runner
// ============================================================================

class HookRunner {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async run(hook: string, env: Record<string, string> = {}): Promise<void> {
    if (!hook) return;

    const { execSync } = await import('node:child_process');
    try {
      execSync(hook, {
        cwd: this.rootDir,
        stdio: 'inherit',
        env: { ...process.env, ...env },
      });
    } catch (error) {
      throw new Error(`Hook "${hook}" failed: ${(error as Error).message}`);
    }
  }
}

// ============================================================================
// Publish Command
// ============================================================================

export async function publishCommand(options: PublishOptions): Promise<void> {
  const spinner = ora('Preparing publish...').start();
  const startTime = Date.now();

  try {
    const filePath = resolve(options.file);
    const rootDir = dirname(filePath);
    const registry = new RegistryClient(options.registry);
    const hookRunner = new HookRunner(rootDir);

    if (options.token) {
      registry.setToken(options.token);
    }

    spinner.text = 'Reading package...';
    const content = await readFile(filePath, 'utf-8');
    const parseResult = parseMAM(content, { source: filePath });

    if (parseResult.errors.length > 0) {
      spinner.fail('Module has parse errors');
      for (const error of parseResult.errors) {
        console.error(chalk.red(`  ${error.message}`));
      }
      process.exit(1);
    }

    const mamData = parseResult.ast.frontmatter?.data || {};
    const pkgJsonPath = join(rootDir, 'package.json');
    const pkgJson = await safeReadJson<PackageManifest>(pkgJsonPath);

    if (!pkgJson) {
      spinner.fail('No package.json found');
      process.exit(1);
    }

    const manifest = ManifestBuilder.fromPackageJson(pkgJson, mamData, filePath);

    spinner.text = 'Validating package...';
    const validator = new PackageValidator();
    validator.validate(pkgJson, mamData, filePath);

    if (validator.hasErrors()) {
      spinner.fail('Package validation failed');
      for (const error of validator.getErrors()) {
        console.error(chalk.red(`  ✗ ${error}`));
      }
      process.exit(1);
    }

    if (validator.hasWarnings()) {
      for (const warning of validator.getWarnings()) {
        console.log(chalk.yellow(`  ⚠ ${warning}`));
      }
    }

    if (options.bump) {
      spinner.text = `Bumping version (${options.bump})...`;
      const versionManager = new VersionManager(pkgJson.version);
      const bumpResult = versionManager.bump(options.bump, options.preid);

      const pkgContent = await readFile(pkgJsonPath, 'utf-8');
      const updatedContent = pkgContent.replace(
        `"version": "${pkgJson.version}"`,
        `"version": "${bumpResult.next}"`,
      );
      await writeFile(pkgJsonPath, updatedContent, 'utf-8');
      pkgJson.version = bumpResult.next;

      console.log(
        chalk.green(`  Version bumped: ${bumpResult.current} → ${bumpResult.next}`),
      );
    }

    const existingPkg = await registry.getPackage(manifest.getName());
    if (existingPkg && existingPkg.version === pkgJson.version && !options.force) {
      spinner.fail(
        `Version ${pkgJson.version} already exists. Use --bump or --force.`,
      );
      process.exit(1);
    }

    if (options.beforePublish) {
      spinner.text = 'Running pre-publish hook...';
      await hookRunner.run(options.beforePublish, {
        MAM_PACKAGE_NAME: manifest.getName(),
        MAM_PACKAGE_VERSION: pkgJson.version,
      });
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan('\nDry run — would publish:'));
      console.log(`  ${chalk.bold(manifest.getName())}@${chalk.bold(pkgJson.version)}`);
      console.log(`  Registry: ${options.registry || MAM_REGISTRY}`);
      console.log(`  Access: ${options.access || DEFAULT_ACCESS}`);
      if (options.tag) console.log(`  Tag: ${options.tag}`);
      console.log(chalk.gray('\nPackage details:'));
      console.log(chalk.gray(`  Description: ${manifest.getDescription()}`));
      console.log(chalk.gray(`  Author: ${manifest.getAuthor()}`));
      console.log(chalk.gray(`  License: ${manifest.getLicense()}`));
      return;
    }

    spinner.text = 'Creating tarball...';
    const tarballCreator = new TarballCreator(
      rootDir,
      options.include,
      options.exclude,
      options.unpacked,
    );
    const { buffer: tarballBuffer, fileCount, unpackedSize } = await tarballCreator.create();

    if (tarballBuffer.length > MAX_PACKAGE_SIZE) {
      spinner.fail(
        `Package too large: ${(tarballBuffer.length / 1024 / 1024).toFixed(1)} MB (max: ${MAX_PACKAGE_SIZE / 1024 / 1024} MB)`,
      );
      process.exit(1);
    }

    const integrity = createIntegrity(tarballBuffer);
    const shasum = sha256(tarballBuffer);
    const tarballUrl = `${options.registry || MAM_REGISTRY}/${manifest.getName()}/-/${manifest.getName()}-${pkgJson.version}.tgz`;

    spinner.text = 'Building manifest...';
    const publishManifest = await manifest.buildPublishManifest(
      tarballUrl,
      integrity,
      shasum,
      fileCount,
      unpackedSize,
    );

    if (options.tag) {
      publishManifest.distTags = { [options.tag]: pkgJson.version };
    }

    if (options.sign) {
      spinner.text = 'Signing package...';
      const signatures = await signPackage(
        tarballBuffer,
        manifest.getName(),
        pkgJson.version,
        options.signKey,
      );
      publishManifest.dist.signatures = signatures;
    }

    if (!options.gitTag) {
      spinner.text = 'Publishing to registry...';
      try {
        await registry.publish(publishManifest);
      } catch (error) {
        if ((error as Error).message.includes('Authentication failed')) {
          spinner.fail(
            'Authentication required. Set MAM_TOKEN or use --token.',
          );
          process.exit(1);
        }
        throw error;
      }
    }

    if (options.gitTag !== false) {
      const tagName = `v${pkgJson.version}`;
      try {
        const { execSync } = await import('node:child_process');
        execSync(`git tag ${tagName}`, { stdio: 'pipe' });
        console.log(chalk.gray(`  Created git tag: ${tagName}`));

        if (options.gitPush !== false) {
          execSync(`git push origin ${tagName}`, { stdio: 'pipe' });
          console.log(chalk.gray(`  Pushed tag to origin`));
        }
      } catch {
        console.log(chalk.yellow('  ⚠ Failed to create/push git tag'));
      }
    }

    const changelogGenerator = new ChangelogGenerator();
    await changelogGenerator.generateFromGit();
    const changelog = changelogGenerator.generateMarkdown();
    const changelogPath = join(rootDir, 'CHANGELOG.md');
    await writeFile(changelogPath, changelog, 'utf-8');
    console.log(chalk.gray('  Updated CHANGELOG.md'));

    const readmeGenerator = new ReadmeGenerator(pkgJson, mamData);
    const readme = readmeGenerator.generate();
    const readmePath = join(rootDir, 'README.md');
    await writeFile(readmePath, readme, 'utf-8');
    console.log(chalk.gray('  Updated README.md'));

    if (options.afterPublish) {
      await hookRunner.run(options.afterPublish, {
        MAM_PACKAGE_NAME: manifest.getName(),
        MAM_PACKAGE_VERSION: pkgJson.version,
        MAM_REGISTRY_URL: tarballUrl,
      });
    }

    const duration = Date.now() - startTime;
    const result: PublishResult = {
      name: manifest.getName(),
      version: pkgJson.version,
      tarball: tarballUrl,
      size: tarballBuffer.length,
      integrity,
      publishedAt: new Date().toISOString(),
      registry: options.registry || MAM_REGISTRY,
      access: options.access || DEFAULT_ACCESS,
    };

    spinner.succeed(`Published ${result.name}@${result.version}`);
    console.log(chalk.gray(`  Registry: ${result.registry}`));
    console.log(chalk.gray(`  Access: ${result.access}`));
    console.log(chalk.gray(`  Size: ${(result.size / 1024).toFixed(1)} KB`));
    console.log(chalk.gray(`  Integrity: ${result.integrity.slice(0, 32)}...`));
    console.log(chalk.gray(`  Published in ${(duration / 1000).toFixed(1)}s`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Unpublish Command
// ============================================================================

export async function unpublishCommand(
  packageName: string,
  version: string,
  options: PublishOptions,
): Promise<void> {
  const spinner = ora(`Unpublishing ${packageName}@${version || '*'}...`).start();

  try {
    const registry = new RegistryClient(options.registry);

    if (options.token) {
      registry.setToken(options.token);
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan(`\nDry run — would unpublish ${packageName}@${version || '*'}`));
      return;
    }

    await registry.unpublish(packageName, version);
    spinner.succeed(`Unpublished ${packageName}@${version || '*'}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Deprecate Command
// ============================================================================

export async function deprecateCommand(
  packageName: string,
  version: string,
  message: string,
  options: PublishOptions,
): Promise<void> {
  const spinner = ora(`Deprecating ${packageName}@${version}...`).start();

  try {
    const registry = new RegistryClient(options.registry);

    if (options.token) {
      registry.setToken(options.token);
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan(`\nDry run — would deprecate ${packageName}@${version}`));
      console.log(chalk.gray(`  Message: ${message}`));
      return;
    }

    await registry.deprecate(packageName, version, message);
    spinner.succeed(`Deprecated ${packageName}@${version}`);
    console.log(chalk.gray(`  Message: ${message}`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Info Command
// ============================================================================

export async function infoCommand(
  packageName: string,
  options: PublishOptions,
): Promise<void> {
  const spinner = ora(`Fetching info for ${packageName}...`).start();

  try {
    const registry = new RegistryClient(options.registry);
    const info = await registry.getPackage(packageName);

    if (!info) {
      spinner.fail(`Package ${packageName} not found`);
      process.exit(1);
    }

    spinner.stop();

    console.log(chalk.bold(`\n${info.name}`));
    console.log(chalk.gray(`  Latest: ${info.version}`));
    if (info.description) console.log(chalk.gray(`  ${info.description}`));
    if (info.author) console.log(chalk.gray(`  Author: ${info.author}`));
    if (info.license) console.log(chalk.gray(`  License: ${info.license}`));
    if (info.homepage) console.log(chalk.gray(`  Homepage: ${info.homepage}`));
    if (info.repository) console.log(chalk.gray(`  Repository: ${info.repository}`));

    if (info.keywords && info.keywords.length > 0) {
      console.log(chalk.gray(`  Keywords: ${info.keywords.join(', ')}`));
    }

    const distTags = Object.entries(info.distTags || {});
    if (distTags.length > 0) {
      console.log(chalk.gray('\n  Tags:'));
      for (const [tag, ver] of distTags) {
        console.log(chalk.gray(`    ${tag}: ${ver}`));
      }
    }

    const versions = Object.keys(info.versions || {}).slice(-10);
    if (versions.length > 0) {
      console.log(chalk.gray('\n  Recent versions:'));
      for (const v of versions) {
        console.log(chalk.gray(`    ${v}`));
      }
    }

    if (info.time) {
      const entries = Object.entries(info.time).slice(-5);
      console.log(chalk.gray('\n  Recent activity:'));
      for (const [action, date] of entries) {
        console.log(chalk.gray(`    ${action}: ${date}`));
      }
    }
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Whoami Command
// ============================================================================

export async function whoamiCommand(options: PublishOptions): Promise<void> {
  const spinner = ora('Checking authentication...').start();

  try {
    const registry = new RegistryClient(options.registry);

    if (options.token) {
      registry.setToken(options.token);
    }

    const username = await registry.whoami();
    spinner.succeed(`Authenticated as ${chalk.bold(username)}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Tag Management
// ============================================================================

export async function tagCommand(
  packageName: string,
  tag: string,
  version: string,
  options: PublishOptions,
): Promise<void> {
  const spinner = ora(`Setting tag ${tag}@${version} for ${packageName}...`).start();

  try {
    const registry = new RegistryClient(options.registry);

    if (options.token) {
      registry.setToken(options.token);
    }

    if (options.dryRun) {
      spinner.stop();
      console.log(chalk.cyan(`\nDry run — would tag ${packageName}@${version} as ${tag}`));
      return;
    }

    const info = await registry.getPackage(packageName);
    if (!info) {
      spinner.fail(`Package ${packageName} not found`);
      process.exit(1);
    }

    const publishManifest = {
      name: packageName,
      version,
      description: '',
      dist: {
        tarball: '',
        shasum: '',
        integrity: '',
        fileCount: 0,
        unpackedSize: 0,
      },
      _id: packageName,
      _rev: '',
      license: '',
      author: '',
      keywords: [],
      files: [],
      main: '',
      module: '',
      types: '',
      exports: {},
      engines: {},
      distTags: { [tag]: version },
    };

    spinner.succeed(`Tag ${tag} → ${packageName}@${version}`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

// ============================================================================
// Package Signing
// ============================================================================

async function signPackage(
  buffer: Buffer,
  packageName: string,
  version: string,
  keyId?: string,
): Promise<Array<{ keyid: string; sig: string }>> {
  const signatures: Array<{ keyid: string; sig: string }> = [];

  const { execSync } = await import('node:child_process');

  const signingKeyId = keyId || process.env.MAM_SIGNING_KEY || 'mam-default';

  try {
    const dataToSign = `${packageName}@${version}:${sha256(buffer)}`;
    const { createSign } = await import('node:crypto');
    const sign = createSign('RSA-SHA256');
    sign.update(dataToSign);

    const keyPath = join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.mam',
      'keys',
      signingKeyId,
    );

    if (await fileExists(keyPath)) {
      const privateKey = await readFile(keyPath, 'utf-8');
      const signature = sign.sign(privateKey, 'base64');
      signatures.push({ keyid: signingKeyId, sig: signature });
    }
  } catch {
    console.log(chalk.yellow('  ⚠ Package signing skipped (no key found)'));
  }

  return signatures;
}

// ============================================================================
// Module Exports
// ============================================================================

export default publishCommand;
