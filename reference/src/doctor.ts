import { readFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DoctorCheckResult, DoctorReport } from './types.js';
import { validateConfig } from './config.js';

export function checkNodeVersion(requiredMajor = 18): DoctorCheckResult {
  const match = process.version.match(/^v(\d+)\./);
  const major = match ? Number.parseInt(match[1]!, 10) : 0;
  if (major >= requiredMajor) {
    return {
      name: 'node-version',
      status: 'pass',
      message: `Node.js ${process.version} meets required >= ${requiredMajor}`,
    };
  }
  return {
    name: 'node-version',
    status: 'fail',
    message: `Node.js ${process.version} is below required >= ${requiredMajor}`,
  };
}

export async function checkPackageJson(dir: string): Promise<DoctorCheckResult> {
  const path = join(resolve(dir), 'package.json');
  try {
    await access(path);
  } catch {
    return { name: 'package-json', status: 'warn', message: `No package.json found in ${dir}` };
  }
  try {
    const raw = await readFile(path, 'utf-8');
    const pkg = JSON.parse(raw);
    if (!pkg.name) {
      return { name: 'package-json', status: 'warn', message: 'package.json has no name field' };
    }
    return { name: 'package-json', status: 'pass', message: `Found package ${pkg.name}` };
  } catch {
    return { name: 'package-json', status: 'fail', message: 'package.json is not valid JSON' };
  }
}

export async function checkConfigFile(dir: string): Promise<DoctorCheckResult> {
  const { loadConfig } = await import('./config.js');
  try {
    const config = await loadConfig(resolve(dir));
    const errors = validateConfig(config);
    if (errors.length > 0) {
      return { name: 'config-file', status: 'fail', message: `Config invalid: ${errors[0]}` };
    }
    return { name: 'config-file', status: 'pass', message: 'Configuration is valid' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { name: 'config-file', status: 'fail', message: `Config load failed: ${message}` };
  }
}

export async function runDoctorChecks(dir?: string): Promise<DoctorReport> {
  const startedAt = Date.now();
  const cwd = dir ?? process.cwd();
  const checks: DoctorCheckResult[] = [];
  checks.push(checkNodeVersion());
  checks.push(await checkPackageJson(cwd));
  checks.push(await checkConfigFile(cwd));
  checks.push(checkWorkingDirectory(cwd));
  checks.push(await checkDistWritable(cwd));
  checks.push(await checkTempWritable());
  checks.push(checkHomeEnv());
  checks.push(await checkConfigTargets(cwd));
  checks.push(await checkRegistryUrl(cwd));
  return { checks, timeMs: Date.now() - startedAt };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    lines.push(`${formatCheckStatus(check.status)} ${check.name}: ${check.message}`);
  }
  const counts = countChecksByStatus(report);
  lines.push(`---`);
  lines.push(formatCheckCounts(counts) + ` in ${report.timeMs}ms`);
  return lines.join('\n');
}

export function hasFailingChecks(report: DoctorReport): boolean {
  return report.checks.some((check) => check.status === 'fail');
}

export function countChecksByStatus(report: DoctorReport): Record<string, number> {
  const counts: Record<string, number> = { pass: 0, warn: 0, fail: 0 };
  for (const check of report.checks) {
    counts[check.status] = (counts[check.status] ?? 0) + 1;
  }
  return counts;
}

function checkWorkingDirectory(dir: string): DoctorCheckResult {
  if (!dir || dir.length === 0) {
    return { name: 'working-directory', status: 'fail', message: 'Working directory is empty' };
  }
  return { name: 'working-directory', status: 'pass', message: `Working directory is ${dir}` };
}

async function checkDistWritable(dir: string): Promise<DoctorCheckResult> {
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const probeDir = join(resolve(dir), '.mam-doctor-probe');
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(join(probeDir, 'probe.txt'), 'ok', 'utf-8');
    await rm(probeDir, { recursive: true, force: true });
    return { name: 'dist-writable', status: 'pass', message: 'Output directory is writable' };
  } catch {
    return { name: 'dist-writable', status: 'warn', message: 'Output directory may not be writable' };
  }
}

function formatCheckStatus(status: DoctorCheckResult['status']): string {
  if (status === 'pass') return '[PASS]';
  if (status === 'warn') return '[WARN]';
  return '[FAIL]';
}

function formatCheckCounts(counts: Record<string, number>): string {
  const pass = counts.pass ?? 0;
  const warn = counts.warn ?? 0;
  const fail = counts.fail ?? 0;
  return `${pass} passed, ${warn} warnings, ${fail} failed`;
}

function filterChecksByStatus(report: DoctorReport, status: DoctorCheckResult['status']): DoctorCheckResult[] {
  return report.checks.filter((check) => check.status === status);
}

function getFailingCheckNames(report: DoctorReport): string[] {
  return filterChecksByStatus(report, 'fail').map((check) => check.name);
}

function getWarningCheckNames(report: DoctorReport): string[] {
  return filterChecksByStatus(report, 'warn').map((check) => check.name);
}

function isCleanReport(report: DoctorReport): boolean {
  return !hasFailingChecks(report) && filterChecksByStatus(report, 'warn').length === 0;
}

function summarizeReport(report: DoctorReport): string {
  const counts = countChecksByStatus(report);
  return formatCheckCounts(counts);
}

function checkNodeMajorVersion(version: string, requiredMajor: number): boolean {
  const match = version.match(/^v?(\d+)\./);
  if (!match) return false;
  return Number.parseInt(match[1]!, 10) >= requiredMajor;
}

function parseNodeVersion(version: string): { major: number; minor: number; patch: number } | undefined {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return undefined;
  return {
    major: Number.parseInt(match[1]!, 10),
    minor: Number.parseInt(match[2]!, 10),
    patch: Number.parseInt(match[3]!, 10),
  };
}

function compareVersions(a: string, b: string): number {
  const pa = parseNodeVersion(a);
  const pb = parseNodeVersion(b);
  if (!pa || !pb) return 0;
  if (pa.major !== pb.major) return pa.major - pb.major;
  if (pa.minor !== pb.minor) return pa.minor - pb.minor;
  return pa.patch - pb.patch;
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  return compareVersions(version, minimum) >= 0;
}

function buildPassResult(name: string, message: string): DoctorCheckResult {
  return { name, status: 'pass', message };
}

function buildWarnResult(name: string, message: string): DoctorCheckResult {
  return { name, status: 'warn', message };
}

function buildFailResult(name: string, message: string): DoctorCheckResult {
  return { name, status: 'fail', message };
}

async function checkTempWritable(): Promise<DoctorCheckResult> {
  const { tmpdir } = await import('node:os');
  const { mkdir, writeFile, rm } = await import('node:fs/promises');
  const probeDir = join(tmpdir(), '.mam-doctor-tmp-probe');
  try {
    await mkdir(probeDir, { recursive: true });
    await writeFile(join(probeDir, 'probe.txt'), 'ok', 'utf-8');
    await rm(probeDir, { recursive: true, force: true });
    return buildPassResult('temp-writable', `Temp directory ${probeDir} is writable`);
  } catch {
    return buildWarnResult('temp-writable', 'Temp directory may not be writable');
  }
}

function checkHomeEnv(): DoctorCheckResult {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) {
    return buildWarnResult('home-env', 'No HOME/USERPROFILE environment variable set');
  }
  return buildPassResult('home-env', `Home directory is ${home}`);
}

async function checkConfigTargets(dir: string): Promise<DoctorCheckResult> {
  const { loadConfig } = await import('./config.js');
  const { TARGET_EXTENSIONS } = await import('./types.js');
  try {
    const config = await loadConfig(resolve(dir));
    const targets = Object.keys(config.targets ?? {});
    const unknown = targets.filter((target) => !(target in TARGET_EXTENSIONS));
    if (unknown.length > 0) {
      return buildWarnResult('config-targets', `Unknown targets: ${unknown.join(', ')}`);
    }
    if (targets.length === 0) {
      return buildPassResult('config-targets', 'No target overrides configured');
    }
    return buildPassResult('config-targets', `${targets.length} target overrides configured`);
  } catch {
    return buildWarnResult('config-targets', 'Could not load config to check targets');
  }
}

async function checkRegistryUrl(dir: string): Promise<DoctorCheckResult> {
  const { loadConfig } = await import('./config.js');
  try {
    const config = await loadConfig(resolve(dir));
    const url = config.registry?.url;
    if (!url) {
      return buildWarnResult('registry-url', 'No registry URL configured');
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return buildFailResult('registry-url', `Registry URL has unsupported protocol: ${parsed.protocol}`);
      }
      return buildPassResult('registry-url', `Registry URL is ${url}`);
    } catch {
      return buildFailResult('registry-url', `Registry URL is not valid: "${url}"`);
    }
  } catch {
    return buildWarnResult('registry-url', 'Could not load config to check registry URL');
  }
}

function renderCheckLine(check: DoctorCheckResult): string {
  return `${formatCheckStatus(check.status)} ${check.name}: ${check.message}`;
}

function renderReportHeader(total: number, timeMs: number): string {
  return `Doctor: ${total} checks in ${timeMs}ms`;
}

function renderReportFooter(counts: Record<string, number>): string {
  return formatCheckCounts(counts);
}

function buildVerboseReport(report: DoctorReport): string {
  const lines: string[] = [renderReportHeader(report.checks.length, report.timeMs)];
  for (const check of report.checks) {
    lines.push(renderCheckLine(check));
  }
  lines.push(renderReportFooter(countChecksByStatus(report)));
  return lines.join('\n');
}

function hasWarnings(report: DoctorReport): boolean {
  return filterChecksByStatus(report, 'warn').length > 0;
}

function getCheckByName(report: DoctorReport, name: string): DoctorCheckResult | undefined {
  return report.checks.find((check) => check.name === name);
}

function mergeReports(a: DoctorReport, b: DoctorReport): DoctorReport {
  return {
    checks: [...a.checks, ...b.checks],
    timeMs: a.timeMs + b.timeMs,
  };
}

function createEmptyReport(): DoctorReport {
  return { checks: [], timeMs: 0 };
}

function appendCheck(report: DoctorReport, check: DoctorCheckResult): DoctorReport {
  return { checks: [...report.checks, check], timeMs: report.timeMs };
}

function getCheckStatuses(report: DoctorReport): Array<DoctorCheckResult['status']> {
  return report.checks.map((check) => check.status);
}

function allChecksPassed(report: DoctorReport): boolean {
  return report.checks.length > 0 && report.checks.every((check) => check.status === 'pass');
}
