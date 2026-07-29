/**
 * MAM Doctor Command
 *
 * Comprehensive environment and health checks for the MAM development stack.
 * Validates tooling, permissions, configuration, dependencies, network, and performance.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { statfs, access, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { networkInterfaces, hostname } from 'node:os';
import chalk from 'chalk';
import ora from 'ora';

const execAsync = promisify(exec);

// ============================================================================
// Types
// ============================================================================

export type CheckStatus = 'ok' | 'warning' | 'missing' | 'error' | 'skipped';

export type OutputFormat = 'text' | 'json' | 'markdown';

export interface CheckResult {
  name: string;
  category: string;
  status: CheckStatus;
  version?: string;
  expected?: string;
  message?: string;
  fix?: string;
  fixCommand?: string;
  durationMs?: number;
}

export interface HealthReport {
  timestamp: string;
  hostname: string;
  platform: string;
  arch: string;
  checks: CheckResult[];
  summary: {
    total: number;
    ok: number;
    warnings: number;
    errors: number;
    skipped: number;
  };
  score: number;
  durationMs: number;
}

export interface VersionRequirement {
  name: string;
  command: string;
  minVersion?: string;
  maxVersion?: string;
}

export interface DoctorOptions {
  fix?: boolean;
  format?: OutputFormat;
  category?: string;
  verbose?: boolean;
  json?: boolean;
  markdown?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const REQUIRED_TOOLS: VersionRequirement[] = [
  { name: 'Node.js', command: 'node', minVersion: '18.0.0' },
  { name: 'npm', command: 'npm', minVersion: '9.0.0' },
  { name: 'pnpm', command: 'pnpm', minVersion: '8.0.0' },
];

const OPTIONAL_TOOLS: VersionRequirement[] = [
  { name: 'Python', command: 'python3', minVersion: '3.9.0' },
  { name: 'Go', command: 'go', minVersion: '1.21.0' },
  { name: 'Rust', command: 'rustc', minVersion: '1.70.0' },
  { name: 'Docker', command: 'docker' },
  { name: 'Git', command: 'git', minVersion: '2.30.0' },
  { name: 'cargo', command: 'cargo' },
  { name: 'pip', command: 'pip3' },
  { name: 'ffmpeg', command: 'ffmpeg' },
];

const MIN_DISK_SPACE_MB = 500;
const NETWORK_TEST_URLS = ['https://registry.npmjs.org', 'https://pypi.org', 'https://crates.io'];
const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const MAM_CONFIG_FILE = 'mam.config.json';
const MAM_PACKAGE_NAME = '@mam/cli';

const CATEGORIES = {
  environment: 'Environment',
  tools: 'Development Tools',
  workspace: 'Workspace',
  config: 'Configuration',
  dependencies: 'Dependencies',
  network: 'Network',
  permissions: 'Permissions',
  performance: 'Performance',
};

// ============================================================================
// Version Utilities
// ============================================================================

function parseVersion(version: string): number[] {
  const cleaned = version.replace(/^[^\d]*/, '').split('-')[0] || '0.0.0';
  return cleaned.split('.').map(Number);
}

function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const na = va[i] || 0;
    const nb = vb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function satisfiesVersion(version: string, min?: string, max?: string): boolean {
  if (min && compareVersions(version, min) < 0) return false;
  if (max && compareVersions(version, max) > 0) return false;
  return true;
}

// ============================================================================
// Command Execution
// ============================================================================

async function runCommand(cmd: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: timeoutMs });
    return { stdout: stdout.trim(), stderr: stderr.trim(), ok: true };
  } catch {
    return { stdout: '', stderr: '', ok: false };
  }
}

async function getCommandVersion(cmd: string): Promise<string | undefined> {
  const versionFlags = ['--version', '-v', '-V'];
  for (const flag of versionFlags) {
    const result = await runCommand(`${cmd} ${flag}`);
    if (result.ok && result.stdout) {
      const match = result.stdout.match(/(\d+\.\d+[\.\d]*)/);
      return match ? match[1] : result.stdout.split('\n')[0];
    }
  }
  return undefined;
}

// ============================================================================
// Individual Checks
// ============================================================================

async function checkTool(req: VersionRequirement): Promise<CheckResult> {
  const start = Date.now();
  const version = await getCommandVersion(req.command);
  const durationMs = Date.now() - start;

  if (!version) {
    return {
      name: req.name,
      category: 'tools',
      status: 'missing',
      expected: req.minVersion ? `>= ${req.minVersion}` : undefined,
      message: `${req.name} is not installed or not in PATH`,
      fix: getFixSuggestion(req.name),
      fixCommand: getFixCommand(req.name),
      durationMs,
    };
  }

  if (req.minVersion || req.maxVersion) {
    if (!satisfiesVersion(version, req.minVersion, req.maxVersion)) {
      return {
        name: req.name,
        category: 'tools',
        status: 'warning',
        version,
        expected: `>= ${req.minVersion || '0.0.0'}`,
        message: `Version ${version} may be outdated. Recommended: >= ${req.minVersion}`,
        fix: `Upgrade ${req.name} to the latest version`,
        fixCommand: getFixCommand(req.name),
        durationMs,
      };
    }
  }

  return {
    name: req.name,
    category: 'tools',
    status: 'ok',
    version,
    durationMs,
  };
}

async function checkNodeEnvironment(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  const nodeVersion = process.version;
  results.push({
    name: 'Node.js Runtime',
    category: 'environment',
    status: satisfiesVersion(nodeVersion, '18.0.0') ? 'ok' : 'warning',
    version: nodeVersion,
    expected: '>= 18.0.0',
    message: satisfiesVersion(nodeVersion, '18.0.0') ? undefined : 'Node.js 18+ is recommended for ESM support',
    fix: satisfiesVersion(nodeVersion, '18.0.0') ? undefined : 'Upgrade Node.js to v18 or later',
    durationMs: Date.now() - start,
  });

  results.push({
    name: 'Platform',
    category: 'environment',
    status: 'ok',
    version: `${process.platform} ${process.arch}`,
    message: `Running on ${process.platform}/${process.arch}`,
    durationMs: 0,
  });

  const nodeEnv = process.env.NODE_ENV || 'development';
  results.push({
    name: 'NODE_ENV',
    category: 'environment',
    status: 'ok',
    version: nodeEnv,
    message: `Environment: ${nodeEnv}`,
    durationMs: 0,
  });

  const langs: Array<{ name: string; env: string }> = [
    { name: 'LANG', env: 'LANG' },
    { name: 'LC_ALL', env: 'LC_ALL' },
  ];
  for (const l of langs) {
    const val = process.env[l.env];
    if (val) {
      results.push({
        name: l.name,
        category: 'environment',
        status: 'ok',
        version: val,
        durationMs: 0,
      });
    }
  }

  return results;
}

async function checkMAMInstallation(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  try {
    const npmRootResult = await runCommand('npm root -g');
    if (npmRootResult.ok) {
      const globalModulesPath = join(npmRootResult.stdout, MAM_PACKAGE_NAME);
      try {
        await access(globalModulesPath);
        const pkgPath = join(globalModulesPath, 'package.json');
        const pkgContent = await readFile(pkgPath, 'utf-8');
        const pkg = JSON.parse(pkgContent);
        results.push({
          name: 'MAM CLI (global)',
          category: 'workspace',
          status: 'ok',
          version: pkg.version,
          message: `Globally installed at ${globalModulesPath}`,
          durationMs: Date.now() - start,
        });
      } catch {
        results.push({
          name: 'MAM CLI (global)',
          category: 'workspace',
          status: 'warning',
          message: 'MAM CLI is not installed globally',
          fix: 'Install with: npm install -g @mam/cli',
          fixCommand: 'npm install -g @mam/cli',
          durationMs: Date.now() - start,
        });
      }
    }
  } catch {
    results.push({
      name: 'MAM CLI (global)',
      category: 'workspace',
      status: 'skipped',
      message: 'Could not check global installation',
      durationMs: Date.now() - start,
    });
  }

  const localPaths = [
    join(process.cwd(), 'node_modules', MAM_PACKAGE_NAME, 'package.json'),
    join(process.cwd(), 'packages', 'cli', 'package.json'),
  ];

  let foundLocal = false;
  for (const p of localPaths) {
    try {
      const content = await readFile(p, 'utf-8');
      const pkg = JSON.parse(content);
      results.push({
        name: 'MAM CLI (local)',
        category: 'workspace',
        status: 'ok',
        version: pkg.version,
        message: `Local installation found at ${p}`,
        durationMs: Date.now() - start,
      });
      foundLocal = true;
      break;
    } catch {
      // continue
    }
  }

  if (!foundLocal) {
    results.push({
      name: 'MAM CLI (local)',
      category: 'workspace',
      status: 'warning',
      message: 'No local MAM installation found in workspace',
      fix: 'Run: npm install in the project root',
      fixCommand: 'npm install',
      durationMs: Date.now() - start,
    });
  }

  return results;
}

async function checkWorkspaceHealth(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();
  const cwd = process.cwd();

  const requiredDirs = ['node_modules', 'src'];
  const requiredFiles = ['package.json', 'tsconfig.json'];

  for (const dir of requiredDirs) {
    try {
      await access(join(cwd, dir));
      results.push({
        name: `Directory: ${dir}`,
        category: 'workspace',
        status: 'ok',
        durationMs: Date.now() - start,
      });
    } catch {
      results.push({
        name: `Directory: ${dir}`,
        category: 'workspace',
        status: dir === 'node_modules' ? 'warning' : 'ok',
        message: dir === 'node_modules' ? 'node_modules not found — run npm install' : undefined,
        fix: dir === 'node_modules' ? 'Run: npm install' : undefined,
        fixCommand: dir === 'node_modules' ? 'npm install' : undefined,
        durationMs: Date.now() - start,
      });
    }
  }

  for (const file of requiredFiles) {
    try {
      await access(join(cwd, file));
      results.push({
        name: `File: ${file}`,
        category: 'workspace',
        status: 'ok',
        durationMs: Date.now() - start,
      });
    } catch {
      results.push({
        name: `File: ${file}`,
        category: 'workspace',
        status: 'warning',
        message: `${file} not found in project root`,
        durationMs: Date.now() - start,
      });
    }
  }

  try {
    const pkgContent = await readFile(join(cwd, 'package.json'), 'utf-8');
    const pkg = JSON.parse(pkgContent);
    if (pkg.type === 'module') {
      results.push({
        name: 'ESM Config',
        category: 'workspace',
        status: 'ok',
        version: 'ESM (type: module)',
        message: 'Project configured for ES modules',
        durationMs: Date.now() - start,
      });
    } else {
      results.push({
        name: 'ESM Config',
        category: 'workspace',
        status: 'warning',
        message: 'Project is not configured as ESM — add "type": "module" to package.json',
        fix: 'Add "type": "module" to package.json',
        durationMs: Date.now() - start,
      });
    }
  } catch {
    // package.json not found, already reported
  }

  try {
    const tsConfig = await readFile(join(cwd, 'tsconfig.json'), 'utf-8');
    const config = JSON.parse(tsConfig);
    const target = config.compilerOptions?.target;
    if (target && compareVersions(target.replace('ES', '').replace('es', ''), '2022') >= 0) {
      results.push({
        name: 'TypeScript Target',
        category: 'workspace',
        status: 'ok',
        version: target,
        durationMs: Date.now() - start,
      });
    } else if (target) {
      results.push({
        name: 'TypeScript Target',
        category: 'workspace',
        status: 'warning',
        version: target,
        message: `Target ${target} may not support all ES2022 features`,
        fix: 'Set target to ES2022 in tsconfig.json',
        durationMs: Date.now() - start,
      });
    }
  } catch {
    // tsconfig not found, already reported
  }

  return results;
}

async function checkDiskSpace(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  try {
    const stats = await statfs(process.cwd());
    const freeBytes = stats.bavail * stats.bsize;
    const freeMB = Math.round(freeBytes / (1024 * 1024));
    const totalMB = Math.round((stats.blocks * stats.bsize) / (1024 * 1024));
    const usedPercent = Math.round(((totalMB - freeMB) / totalMB) * 100);

    let status: CheckStatus = 'ok';
    let message = `${freeMB} MB free of ${totalMB} MB (${usedPercent}% used)`;

    if (freeMB < MIN_DISK_SPACE_MB) {
      status = 'warning';
      message += ` — less than ${MIN_DISK_SPACE_MB} MB free`;
    }

    results.push({
      name: 'Disk Space',
      category: 'workspace',
      status,
      version: `${freeMB} MB free`,
      message,
      fix: freeMB < MIN_DISK_SPACE_MB ? 'Free up disk space or run: npm cache clean --force' : undefined,
      fixCommand: freeMB < MIN_DISK_SPACE_MB ? 'npm cache clean --force' : undefined,
      durationMs: Date.now() - start,
    });
  } catch {
    results.push({
      name: 'Disk Space',
      category: 'workspace',
      status: 'skipped',
      message: 'Could not determine disk space',
      durationMs: Date.now() - start,
    });
  }

  return results;
}

async function checkNetworkConnectivity(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  const interfaces = networkInterfaces();
  let hasIPv4 = false;
  let hasIPv6 = false;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal) {
        if (iface.family === 'IPv4') hasIPv4 = true;
        if (iface.family === 'IPv6') hasIPv6 = true;
      }
    }
  }

  results.push({
    name: 'Network Interfaces',
    category: 'network',
    status: hasIPv4 || hasIPv6 ? 'ok' : 'warning',
    version: `IPv4: ${hasIPv4}, IPv6: ${hasIPv6}`,
    message: hasIPv4 || hasIPv6 ? 'Active network interfaces detected' : 'No active network interfaces found',
    durationMs: Date.now() - start,
  });

  for (const url of NETWORK_TEST_URLS) {
    const testStart = Date.now();
    try {
      const { stdout } = await runCommand(`curl -sI --max-time 5 ${url}`, 8000);
      const ok = stdout.includes('200') || stdout.includes('301') || stdout.includes('302');
      results.push({
        name: `Connectivity: ${new URL(url).hostname}`,
        category: 'network',
        status: ok ? 'ok' : 'error',
        message: ok ? `Reachable (${Date.now() - testStart}ms)` : 'Not reachable',
        durationMs: Date.now() - start,
      });
    } catch {
      results.push({
        name: `Connectivity: ${new URL(url).hostname}`,
        category: 'network',
        status: 'error',
        message: 'Connection failed',
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

async function checkRegistryConnectivity(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  const registries = [
    { name: 'npm', url: NPM_REGISTRY_URL, checkCmd: `npm ping --registry ${NPM_REGISTRY_URL}` },
    { name: 'pnpm', url: 'https://registry.npmjs.org', checkCmd: 'pnpm ping' },
  ];

  for (const reg of registries) {
    const regStart = Date.now();
    const result = await runCommand(reg.checkCmd, 8000);
    results.push({
      name: `Registry: ${reg.name}`,
      category: 'network',
      status: result.ok ? 'ok' : 'warning',
      message: result.ok ? `Registry reachable (${Date.now() - regStart}ms)` : `Could not ping ${reg.url}`,
      fix: result.ok ? undefined : 'Check network connectivity or proxy settings',
      durationMs: Date.now() - start,
    });
  }

  try {
    const npmConfigResult = await runCommand('npm config get registry');
    if (npmConfigResult.ok && npmConfigResult.stdout) {
      results.push({
        name: 'npm Registry URL',
        category: 'network',
        status: 'ok',
        version: npmConfigResult.stdout,
        durationMs: Date.now() - start,
      });
    }
  } catch {
    // skip
  }

  return results;
}

async function checkPermissions(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();
  const cwd = process.cwd();

  const testPaths = [
    { path: cwd, name: 'Project Root' },
    { path: join(cwd, 'node_modules'), name: 'node_modules' },
    { path: join(cwd, 'src'), name: 'src' },
  ];

  for (const tp of testPaths) {
    try {
      await access(tp.path);
      try {
        const testFile = join(tp.path, '.mam-doctor-write-test');
        await writeFile(testFile, 'test', 'utf-8');
        const { unlink } = await import('node:fs/promises');
        await unlink(testFile);
        results.push({
          name: `Write: ${tp.name}`,
          category: 'permissions',
          status: 'ok',
          message: 'Read/write access confirmed',
          durationMs: Date.now() - start,
        });
      } catch {
        results.push({
          name: `Write: ${tp.name}`,
          category: 'permissions',
          status: 'warning',
          message: 'Directory exists but is not writable',
          fix: 'Check directory permissions',
          durationMs: Date.now() - start,
        });
      }
    } catch {
      results.push({
        name: `Access: ${tp.name}`,
        category: 'permissions',
        status: 'warning',
        message: 'Directory does not exist or is not accessible',
        durationMs: Date.now() - start,
      });
    }
  }

  const uid = process.getuid?.();
  const euid = process.geteuid?.();
  if (uid !== undefined && euid !== undefined) {
    results.push({
      name: 'User ID',
      category: 'permissions',
      status: uid === 0 ? 'warning' : 'ok',
      version: `uid=${uid} euid=${euid}`,
      message: uid === 0 ? 'Running as root — not recommended for development' : `Running as user ${uid}`,
      fix: uid === 0 ? 'Avoid running as root in development' : undefined,
      durationMs: Date.now() - start,
    });
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) {
    try {
      await access(home);
      results.push({
        name: 'Home Directory',
        category: 'permissions',
        status: 'ok',
        message: `Home directory accessible: ${home}`,
        durationMs: Date.now() - start,
      });
    } catch {
      results.push({
        name: 'Home Directory',
        category: 'permissions',
        status: 'warning',
        message: 'Home directory is not accessible',
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

async function checkConfiguration(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();
  const cwd = process.cwd();

  const configPath = join(cwd, MAM_CONFIG_FILE);
  try {
    const content = await readFile(configPath, 'utf-8');
    const config = JSON.parse(content);

    results.push({
      name: 'MAM Config File',
      category: 'config',
      status: 'ok',
      version: `${MAM_CONFIG_FILE} found`,
      message: `Configuration loaded successfully`,
      durationMs: Date.now() - start,
    });

    const requiredFields = ['name', 'version'];
    for (const field of requiredFields) {
      if (config[field]) {
        results.push({
          name: `Config: ${field}`,
          category: 'config',
          status: 'ok',
          version: String(config[field]),
          durationMs: Date.now() - start,
        });
      } else {
        results.push({
          name: `Config: ${field}`,
          category: 'config',
          status: 'warning',
          message: `Missing recommended field: ${field}`,
          fix: `Add "${field}" to ${MAM_CONFIG_FILE}`,
          durationMs: Date.now() - start,
        });
      }
    }

    if (config.runtime) {
      const validRuntimes = ['python', 'javascript', 'typescript', 'go', 'rust', 'bash'];
      results.push({
        name: 'Config: runtime',
        category: 'config',
        status: validRuntimes.includes(config.runtime) ? 'ok' : 'warning',
        version: config.runtime,
        message: validRuntimes.includes(config.runtime) ? undefined : `Unknown runtime: ${config.runtime}`,
        durationMs: Date.now() - start,
      });
    }

    if (config.validationLevel) {
      const validLevels = ['syntax', 'schema', 'semantic', 'strict'];
      results.push({
        name: 'Config: validationLevel',
        category: 'config',
        status: validLevels.includes(config.validationLevel) ? 'ok' : 'warning',
        version: config.validationLevel,
        durationMs: Date.now() - start,
      });
    }
  } catch {
    results.push({
      name: 'MAM Config File',
      category: 'config',
      status: 'warning',
      message: `${MAM_CONFIG_FILE} not found — using defaults`,
      fix: `Create ${MAM_CONFIG_FILE} with: mam init`,
      durationMs: Date.now() - start,
    });
  }

  try {
    const tsConfigPath = join(cwd, 'tsconfig.json');
    const content = await readFile(tsConfigPath, 'utf-8');
    const config = JSON.parse(content);

    if (config.compilerOptions?.strict) {
      results.push({
        name: 'TypeScript Strict Mode',
        category: 'config',
        status: 'ok',
        version: 'enabled',
        message: 'Strict mode is enabled',
        durationMs: Date.now() - start,
      });
    } else {
      results.push({
        name: 'TypeScript Strict Mode',
        category: 'config',
        status: 'warning',
        message: 'Strict mode is not enabled',
        fix: 'Enable strict mode in tsconfig.json for better type safety',
        durationMs: Date.now() - start,
      });
    }
  } catch {
    // tsconfig not found
  }

  const envVars = ['MAM_HOME', 'MAM_CONFIG', 'MAM_LOG_LEVEL'];
  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) {
      results.push({
        name: `Env: ${envVar}`,
        category: 'config',
        status: 'ok',
        version: value,
        durationMs: Date.now() - start,
      });
    }
  }

  return results;
}

async function checkDependencies(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();
  const cwd = process.cwd();

  try {
    const pkgPath = join(cwd, 'package.json');
    const content = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const depCount = Object.keys(deps).length;

    results.push({
      name: 'Package Dependencies',
      category: 'dependencies',
      status: depCount > 0 ? 'ok' : 'warning',
      version: `${depCount} packages`,
      message: depCount > 0 ? `${depCount} dependencies declared` : 'No dependencies declared',
      durationMs: Date.now() - start,
    });

    const mamDeps = Object.keys(deps).filter(d => d.startsWith('@mam/'));
    if (mamDeps.length > 0) {
      results.push({
        name: 'MAM Workspace Packages',
        category: 'dependencies',
        status: 'ok',
        version: `${mamDeps.length} packages`,
        message: `Workspace packages: ${mamDeps.join(', ')}`,
        durationMs: Date.now() - start,
      });
    }
  } catch {
    results.push({
      name: 'Package Dependencies',
      category: 'dependencies',
      status: 'skipped',
      message: 'package.json not found',
      durationMs: Date.now() - start,
    });
  }

  const auditResult = await runCommand('npm audit --json 2>/dev/null || echo "{}"', 30000);
  try {
    const audit = JSON.parse(auditResult.stdout || '{}');
    const vulnerabilities = audit.metadata?.vulnerabilities;
    if (vulnerabilities) {
      const total = (vulnerabilities.low || 0) + (vulnerabilities.moderate || 0) +
                    (vulnerabilities.high || 0) + (vulnerabilities.critical || 0);

      results.push({
        name: 'Security Audit',
        category: 'dependencies',
        status: total === 0 ? 'ok' : vulnerabilities.critical > 0 ? 'error' : 'warning',
        version: `${total} vulnerabilities`,
        message: total === 0
          ? 'No known vulnerabilities'
          : `${total} vulnerabilities: ${vulnerabilities.critical} critical, ${vulnerabilities.high} high, ${vulnerabilities.moderate} moderate, ${vulnerabilities.low} low`,
        fix: total > 0 ? 'Run: npm audit fix' : undefined,
        fixCommand: total > 0 ? 'npm audit fix' : undefined,
        durationMs: Date.now() - start,
      });
    }
  } catch {
    results.push({
      name: 'Security Audit',
      category: 'dependencies',
      status: 'skipped',
      message: 'Could not run npm audit',
      durationMs: Date.now() - start,
    });
  }

  const outdatedResult = await runCommand('npm outdated --json 2>/dev/null || echo "{}"', 15000);
  try {
    const outdated = JSON.parse(outdatedResult.stdout || '{}');
    const outdatedCount = Object.keys(outdated).length;

    results.push({
      name: 'Outdated Packages',
      category: 'dependencies',
      status: outdatedCount === 0 ? 'ok' : 'warning',
      version: `${outdatedCount} outdated`,
      message: outdatedCount === 0 ? 'All packages up to date' : `${outdatedCount} packages have updates available`,
      fix: outdatedCount > 0 ? 'Run: npm update' : undefined,
      fixCommand: outdatedCount > 0 ? 'npm update' : undefined,
      durationMs: Date.now() - start,
    });
  } catch {
    results.push({
      name: 'Outdated Packages',
      category: 'dependencies',
      status: 'skipped',
      message: 'Could not check for outdated packages',
      durationMs: Date.now() - start,
    });
  }

  return results;
}

async function checkPerformance(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const start = Date.now();

  const cpuStart = process.hrtime.bigint();
  let sum = 0;
  for (let i = 0; i < 1_000_000; i++) {
    sum += i;
  }
  const cpuEnd = process.hrtime.bigint();
  const cpuTimeMs = Number(cpuEnd - cpuStart) / 1_000_000;

  results.push({
    name: 'CPU Benchmark',
    category: 'performance',
    status: cpuTimeMs < 50 ? 'ok' : 'warning',
    version: `${cpuTimeMs.toFixed(1)}ms`,
    message: `1M iterations in ${cpuTimeMs.toFixed(1)}ms`,
    durationMs: Date.now() - start,
  });

  const memStart = process.memoryUsage();
  const buffer = Buffer.alloc(10 * 1024 * 1024);
  buffer.fill(42);
  const memEnd = process.memoryUsage();
  const heapDelta = (memEnd.heapUsed - memStart.heapUsed) / (1024 * 1024);

  results.push({
    name: 'Memory Allocation',
    category: 'performance',
    status: 'ok',
    version: `${(memEnd.heapUsed / 1024 / 1024).toFixed(1)} MB heap`,
    message: `Heap: ${(memEnd.heapUsed / 1024 / 1024).toFixed(1)} MB, RSS: ${(memEnd.rss / 1024 / 1024).toFixed(1)} MB`,
    durationMs: Date.now() - start,
  });

  const fsStart = Date.now();
  const testDir = join(process.cwd(), '.mam-doctor-fs-test');
  try {
    await mkdir(testDir, { recursive: true });
    const testFile = join(testDir, 'test.txt');
    const data = 'x'.repeat(1024 * 100);
    await writeFile(testFile, data, 'utf-8');
    await readFile(testFile, 'utf-8');
    const { unlink, rmdir } = await import('node:fs/promises');
    await unlink(testFile);
    await rmdir(testDir);
    const fsTimeMs = Date.now() - fsStart;

    results.push({
      name: 'Filesystem Speed',
      category: 'performance',
      status: fsTimeMs < 100 ? 'ok' : 'warning',
      version: `${fsTimeMs}ms`,
      message: `Write+Read 100KB in ${fsTimeMs}ms`,
      durationMs: Date.now() - start,
    });
  } catch {
    results.push({
      name: 'Filesystem Speed',
      category: 'performance',
      status: 'skipped',
      message: 'Could not test filesystem performance',
      durationMs: Date.now() - start,
    });
  }

  const procStart = Date.now();
  const result = await runCommand('node -e "process.exit(0)"', 5000);
  const procTimeMs = Date.now() - procStart;

  results.push({
    name: 'Process Spawn',
    category: 'performance',
    status: procTimeMs < 200 ? 'ok' : 'warning',
    version: `${procTimeMs}ms`,
    message: `Node.js process spawn in ${procTimeMs}ms`,
    durationMs: Date.now() - start,
  });

  return results;
}

// ============================================================================
// Fix Suggestions
// ============================================================================

function getFixSuggestion(toolName: string): string {
  const fixes: Record<string, string> = {
    'Node.js': 'Install Node.js from https://nodejs.org or use nvm: nvm install --lts',
    'npm': 'npm is bundled with Node.js — reinstall Node.js or run: npm install -g npm',
    'pnpm': 'Install with: npm install -g pnpm',
    'Python': 'Install from https://python.org or use pyenv: pyenv install 3.11',
    'Go': 'Install from https://go.dev or use goenv: goenv install 1.21',
    'Rust': 'Install with: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh',
    'Docker': 'Install from https://docker.com/get-started',
    'Git': 'Install from https://git-scm.com or use your system package manager',
    'cargo': 'cargo is bundled with Rust — install Rust with rustup',
    'pip': 'pip is bundled with Python — install Python from https://python.org',
    'ffmpeg': 'Install with: apt install ffmpeg (Linux), brew install ffmpeg (macOS), choco install ffmpeg (Windows)',
  };
  return fixes[toolName] || `Install ${toolName} from the official website`;
}

function getFixCommand(toolName: string): string | undefined {
  const commands: Record<string, string> = {
    'pnpm': 'npm install -g pnpm',
    'Docker': 'brew install --cask docker',
    'Git': 'apt install git',
    'ffmpeg': 'apt install ffmpeg',
  };
  return commands[toolName];
}

// ============================================================================
// Auto-Fix
// ============================================================================

async function runAutoFix(checks: CheckResult[]): Promise<CheckResult[]> {
  const fixable = checks.filter(c => c.status === 'missing' && c.fixCommand);
  if (fixable.length === 0) return checks;

  console.log(chalk.cyan(`\nAttempting to fix ${fixable.length} issue(s)...\n`));

  for (const check of fixable) {
    const spinner = ora(`Fixing: ${check.name}`).start();
    try {
      const result = await runCommand(check.fixCommand!, 60000);
      if (result.ok) {
        spinner.succeed(`Fixed: ${check.name}`);
        check.status = 'ok';
        check.message = 'Fixed automatically';
      } else {
        spinner.fail(`Could not fix: ${check.name}`);
      }
    } catch {
      spinner.fail(`Failed to fix: ${check.name}`);
    }
  }

  return checks;
}

// ============================================================================
// Health Score
// ============================================================================

function calculateHealthScore(checks: CheckResult[]): number {
  if (checks.length === 0) return 0;

  let score = 0;
  const weights: Record<CheckStatus, number> = {
    ok: 1,
    warning: 0.5,
    skipped: 0.3,
    missing: 0,
    error: 0,
  };

  for (const check of checks) {
    score += weights[check.status] || 0;
  }

  return Math.round((score / checks.length) * 100);
}

function getScoreLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 50) return 'Fair';
  if (score >= 25) return 'Poor';
  return 'Critical';
}

function getScoreColor(score: number): (text: string) => string {
  if (score >= 90) return chalk.green;
  if (score >= 75) return chalk.green;
  if (score >= 50) return chalk.yellow;
  if (score >= 25) return chalk.yellow;
  return chalk.red;
}

// ============================================================================
// Report Formatting
// ============================================================================

function formatTextReport(report: HealthReport): string {
  const lines: string[] = [];
  const scoreColor = getScoreColor(report.score);

  lines.push('');
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push(chalk.bold.cyan('          MAM Environment Doctor'));
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push('');
  lines.push(`  ${chalk.gray('Host:')} ${report.hostname}`);
  lines.push(`  ${chalk.gray('Platform:')} ${report.platform}/${report.arch}`);
  lines.push(`  ${chalk.gray('Timestamp:')} ${report.timestamp}`);
  lines.push('');

  const categories = new Map<string, CheckResult[]>();
  for (const check of report.checks) {
    const cat = categories.get(check.category) || [];
    cat.push(check);
    categories.set(check.category, cat);
  }

  const categoryLabels: Record<string, string> = {
    environment: 'Environment',
    tools: 'Development Tools',
    workspace: 'Workspace',
    config: 'Configuration',
    dependencies: 'Dependencies',
    network: 'Network',
    permissions: 'Permissions',
    performance: 'Performance',
  };

  for (const [cat, checks] of categories) {
    lines.push(chalk.bold.white(`  ── ${categoryLabels[cat] || cat} ${'─'.repeat(40 - (categoryLabels[cat] || cat).length)}`));
    for (const check of checks) {
      const icon = getStatusIcon(check.status);
      const version = check.version ? chalk.gray(` (${check.version})`) : '';
      lines.push(`    ${icon} ${check.name}${version}`);
      if (check.message) {
        lines.push(chalk.gray(`      ${check.message}`));
      }
      if (check.fix && (check.status === 'missing' || check.status === 'error' || check.status === 'warning')) {
        lines.push(chalk.cyan(`      → ${check.fix}`));
        if (check.fixCommand) {
          lines.push(chalk.gray(`        $ ${check.fixCommand}`));
        }
      }
    }
    lines.push('');
  }

  lines.push(chalk.bold.cyan('───────────────────────────────────────────'));
  lines.push('');
  lines.push(`  ${chalk.gray('Total checks:')} ${report.summary.total}`);
  lines.push(`  ${chalk.green('Passed:')} ${report.summary.ok}`);
  if (report.summary.warnings > 0) {
    lines.push(`  ${chalk.yellow('Warnings:')} ${report.summary.warnings}`);
  }
  if (report.summary.errors > 0) {
    lines.push(`  ${chalk.red('Errors:')} ${report.summary.errors}`);
  }
  if (report.summary.skipped > 0) {
    lines.push(`  ${chalk.gray('Skipped:')} ${report.summary.skipped}`);
  }
  lines.push('');
  lines.push(`  ${chalk.gray('Health Score:')} ${scoreColor(`${report.score}/100 — ${getScoreLabel(report.score)}`)}`);
  lines.push(`  ${chalk.gray('Completed in:')} ${report.durationMs}ms`);
  lines.push('');
  lines.push(chalk.bold.cyan('═══════════════════════════════════════════'));
  lines.push('');

  return lines.join('\n');
}

function formatJsonReport(report: HealthReport): string {
  return JSON.stringify(report, null, 2);
}

function formatMarkdownReport(report: HealthReport): string {
  const lines: string[] = [];

  lines.push('# MAM Environment Doctor Report');
  lines.push('');
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Host:** ${report.hostname}`);
  lines.push(`**Platform:** ${report.platform}/${report.arch}`);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Health Score | ${report.score}/100 (${getScoreLabel(report.score)}) |`);
  lines.push(`| Total Checks | ${report.summary.total} |`);
  lines.push(`| Passed | ${report.summary.ok} |`);
  lines.push(`| Warnings | ${report.summary.warnings} |`);
  lines.push(`| Errors | ${report.summary.errors} |`);
  lines.push(`| Skipped | ${report.summary.skipped} |`);
  lines.push(`| Duration | ${report.durationMs}ms |`);
  lines.push('');

  const categories = new Map<string, CheckResult[]>();
  for (const check of report.checks) {
    const cat = categories.get(check.category) || [];
    cat.push(check);
    categories.set(check.category, cat);
  }

  for (const [cat, checks] of categories) {
    lines.push(`## ${CATEGORIES[cat as keyof typeof CATEGORIES] || cat}`);
    lines.push('');
    lines.push('| Status | Check | Version | Message |');
    lines.push('|--------|-------|---------|---------|');
    for (const check of checks) {
      const statusIcon = check.status === 'ok' ? '✅' : check.status === 'warning' ? '⚠️' : check.status === 'error' ? '❌' : '⏭️';
      lines.push(`| ${statusIcon} | ${check.name} | ${check.version || '-'} | ${check.message || '-'} |`);
    }
    lines.push('');
  }

  const fixable = report.checks.filter(c => c.fix);
  if (fixable.length > 0) {
    lines.push('## Recommended Actions');
    lines.push('');
    for (const check of fixable) {
      lines.push(`- **${check.name}:** ${check.fix}${check.fixCommand ? ` (\`${check.fixCommand}\`)` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getStatusIcon(status: CheckStatus): string {
  switch (status) {
    case 'ok': return chalk.green('✓');
    case 'warning': return chalk.yellow('!');
    case 'error': return chalk.red('✗');
    case 'missing': return chalk.red('✗');
    case 'skipped': return chalk.gray('○');
    default: return chalk.gray('?');
  }
}

// ============================================================================
// Main Command
// ============================================================================

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const startTime = Date.now();
  const format: OutputFormat = options.json ? 'json' : options.markdown ? 'markdown' : options.format || 'text';
  const categoryFilter = options.category;

  const spinner = ora({ text: 'Running environment checks...', color: 'cyan' }).start();

  try {
    spinner.text = 'Checking Node.js environment...';
    const envChecks = await checkNodeEnvironment();

    spinner.text = 'Checking development tools...';
    const toolChecks: CheckResult[] = [];
    for (const req of REQUIRED_TOOLS) {
      toolChecks.push(await checkTool(req));
    }
    for (const req of OPTIONAL_TOOLS) {
      toolChecks.push(await checkTool(req));
    }

    spinner.text = 'Verifying MAM installation...';
    const mamChecks = await checkMAMInstallation();

    spinner.text = 'Checking workspace health...';
    const workspaceChecks = await checkWorkspaceHealth();

    spinner.text = 'Checking disk space...';
    const diskChecks = await checkDiskSpace();

    spinner.text = 'Testing network connectivity...';
    const networkChecks = await checkNetworkConnectivity();

    spinner.text = 'Checking registry connectivity...';
    const registryChecks = await checkRegistryConnectivity();

    spinner.text = 'Verifying permissions...';
    const permissionChecks = await checkPermissions();

    spinner.text = 'Validating configuration...';
    const configChecks = await checkConfiguration();

    spinner.text = 'Auditing dependencies...';
    const depChecks = await checkDependencies();

    spinner.text = 'Running performance benchmarks...';
    const perfChecks = await checkPerformance();

    spinner.text = 'Compiling report...';

    let allChecks = [
      ...envChecks,
      ...toolChecks,
      ...mamChecks,
      ...workspaceChecks,
      ...diskChecks,
      ...networkChecks,
      ...registryChecks,
      ...permissionChecks,
      ...configChecks,
      ...depChecks,
      ...perfChecks,
    ];

    if (categoryFilter) {
      allChecks = allChecks.filter(c => c.category === categoryFilter);
    }

    if (options.fix) {
      await runAutoFix(allChecks);
    }

    const summary = {
      total: allChecks.length,
      ok: allChecks.filter(c => c.status === 'ok').length,
      warnings: allChecks.filter(c => c.status === 'warning').length,
      errors: allChecks.filter(c => c.status === 'error' || c.status === 'missing').length,
      skipped: allChecks.filter(c => c.status === 'skipped').length,
    };

    const report: HealthReport = {
      timestamp: new Date().toISOString(),
      hostname: hostname(),
      platform: process.platform,
      arch: process.arch,
      checks: allChecks,
      summary,
      score: calculateHealthScore(allChecks),
      durationMs: Date.now() - startTime,
    };

    spinner.stop();

    switch (format) {
      case 'json':
        console.log(formatJsonReport(report));
        break;
      case 'markdown':
        console.log(formatMarkdownReport(report));
        break;
      default:
        console.log(formatTextReport(report));
    }

    if (report.score < 50) {
      process.exit(1);
    }
  } catch (error) {
    spinner.fail(`Doctor check failed: ${(error as Error).message}`);
    if (options.verbose) {
      console.error(error);
    }
    process.exit(1);
  }
}
