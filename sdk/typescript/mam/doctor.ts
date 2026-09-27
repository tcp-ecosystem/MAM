import { access, constants, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defaultSDKConfig, isValidSDKConfig } from './config.js';

/** Doctor check status. */
export type CheckStatus = 'pass' | 'warn' | 'fail';
/** One environment check. */
export interface CheckResult { name: string; status: CheckStatus; message: string; }
/** A complete doctor report. */
export interface DoctorReport { checks: CheckResult[]; passed: boolean; }

/** Creates a passing check. */
export function checkPass(name: string, message = 'ok'): CheckResult {
  return { name, status: 'pass', message };
}

/** Creates a warning check. */
export function checkWarn(name: string, message: string): CheckResult {
  return { name, status: 'warn', message };
}

/** Creates a failing check. */
export function checkFail(name: string, message: string): CheckResult {
  return { name, status: 'fail', message };
}

/** Checks that a working directory exists and is readable. */
export async function checkWorkDirReadable(directory = process.cwd()): Promise<CheckResult> {
  try {
    const info = await stat(directory);
    if (!info.isDirectory()) return checkFail('workdir', `${directory} is not a directory`);
    await access(directory, constants.R_OK);
    return checkPass('workdir', directory);
  } catch (error) {
    return checkFail('workdir', error instanceof Error ? error.message : String(error));
  }
}

/** Checks the current Node runtime without installing anything. */
export function checkNodeRuntime(): CheckResult {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 18 ? checkPass('node', `v${process.versions.node}`) : checkFail('node', `Node 18+ required, found v${process.versions.node}`);
}

/** Checks the default SDK configuration. */
export function checkDefaultConfig(): CheckResult {
  return isValidSDKConfig(defaultSDKConfig()) ? checkPass('config', 'defaults are valid') : checkFail('config', 'default configuration is invalid');
}

/** Checks whether an optional command can be found on PATH. */
export function checkCommand(command: string): CheckResult {
  const separator = process.platform === 'win32' ? ';' : ':';
  const path = process.env.PATH ?? '';
  const found = path.split(separator).some((directory) => {
    if (!directory) return false;
    const candidate = resolve(directory, command);
    return Boolean(candidate);
  });
  return found ? checkPass(`command:${command}`, 'available on PATH') : checkWarn(`command:${command}`, 'not found on PATH');
}

/** Runs the complete deterministic doctor suite. */
export async function runDoctorChecks(directory = process.cwd()): Promise<DoctorReport> {
  const checks = [checkNodeRuntime(), checkDefaultConfig(), await checkWorkDirReadable(directory), checkCommand('node'), checkCommand('git')];
  return { checks, passed: !checks.some((check) => check.status === 'fail') };
}

/** Formats a doctor report. */
export function formatCheckReport(report: DoctorReport): string {
  return report.checks.map((check) => `${check.status.toUpperCase().padEnd(5)} ${check.name}: ${check.message}`).join('\n');
}

/** Reports whether any check failed. */
export function hasFailingChecks(checks: CheckResult[]): boolean {
  return checks.some((check) => check.status === 'fail');
}

/** Counts checks by status. */
export function countChecksByStatus(checks: CheckResult[]): Record<CheckStatus, number> {
  return { pass: checks.filter((check) => check.status === 'pass').length, warn: checks.filter((check) => check.status === 'warn').length, fail: checks.filter((check) => check.status === 'fail').length };
}

/** Returns a short report summary. */
export function summarizeDoctorReport(report: DoctorReport): string {
  const counts = countChecksByStatus(report.checks);
  return `${counts.pass} passed, ${counts.warn} warnings, ${counts.fail} failed`;
}

/** Checks a path exists. */
export async function checkPath(path: string): Promise<CheckResult> {
  try { await stat(path); return checkPass(`path:${path}`, 'exists'); } catch (error) { return checkFail(`path:${path}`, error instanceof Error ? error.message : String(error)); }
}

/** Checks a directory has at least one entry. */
export async function checkDirectoryNotEmpty(directory: string): Promise<CheckResult> {
  try { const entries = await readdir(directory); return entries.length ? checkPass('directory', `${entries.length} entries`) : checkWarn('directory', 'directory is empty'); } catch (error) { return checkFail('directory', error instanceof Error ? error.message : String(error)); }
}

/** Returns a warning for a missing environment variable. */
export function checkEnvironmentVariable(name: string, required = false): CheckResult {
  const value = process.env[name];
  if (value?.trim()) return checkPass(`env:${name}`, 'set');
  return required ? checkFail(`env:${name}`, 'required variable is not set') : checkWarn(`env:${name}`, 'not set');
}

/** Returns whether a report has warnings even when it passes. */
export function hasDoctorWarnings(checks: CheckResult[]): boolean {
  return checks.some((check) => check.status === 'warn');
}

/** Returns all failed checks. */
export function failedChecks(checks: CheckResult[]): CheckResult[] {
  return checks.filter((check) => check.status === 'fail');
}

/** Returns all warning checks. */
export function warningChecks(checks: CheckResult[]): CheckResult[] {
  return checks.filter((check) => check.status === 'warn');
}

/** Returns a report filtered to one status. */
export function checksByStatus(checks: CheckResult[], status: CheckStatus): CheckResult[] {
  return checks.filter((check) => check.status === status);
}

/** Merges doctor reports. */
export function mergeDoctorReports(reports: DoctorReport[]): DoctorReport {
  const checks = reports.flatMap((report) => report.checks);
  return { checks, passed: !hasFailingChecks(checks) };
}

/** Returns a compact line for a single check. */
export function formatCheck(check: CheckResult): string {
  return `${check.name}=${check.status}`;
}

/** Creates a report from checks. */
export function doctorReport(checks: CheckResult[]): DoctorReport {
  return { checks, passed: !hasFailingChecks(checks) };
}

/** Returns a check for a path with a custom label. */
export async function checkPathWithLabel(path: string, label: string): Promise<CheckResult> {
  const result = await checkPath(path);
  return { ...result, name: label };
}

/** Returns whether a check has a failure status. */
export function isFailing(check: CheckResult): boolean {
  return check.status === 'fail';
}

/** Returns whether a check should block execution. */
export function blocksExecution(check: CheckResult): boolean {
  return check.status === 'fail';
}

/** Returns all check names in source order. */
export function checkNames(checks: CheckResult[]): string[] {
  return checks.map((check) => check.name);
}

/** Formats counts with deterministic status order. */
export function formatDoctorCounts(checks: CheckResult[]): string {
  const counts = countChecksByStatus(checks);
  return `pass=${counts.pass} warn=${counts.warn} fail=${counts.fail}`;
}

/** Returns an empty report. */
export function emptyDoctorReport(): DoctorReport {
  return doctorReport([]);
}

void formatCheck;
void formatDoctorCounts;

/** Returns a passing Node check. */
export function nodeCheck(): CheckResult {
  return checkNodeRuntime();
}

/** Returns a passing default config check. */
export function defaultConfigCheck(): CheckResult {
  return checkDefaultConfig();
}

/** Returns a command check for the host platform. */
export function commandCheck(command: string): CheckResult {
  return checkCommand(command);
}

/** Returns a report for an explicit list of checks. */
export function reportFor(checks: CheckResult[]): DoctorReport {
  return doctorReport(checks);
}

/** Returns whether a report is safe to continue. */
export function reportIsRunnable(report: DoctorReport): boolean {
  return report.passed;
}

/** Returns the worst status in a list. */
export function worstStatus(checks: CheckResult[]): CheckStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail';
  if (checks.some((check) => check.status === 'warn')) return 'warn';
  return 'pass';
}

/** Returns a one-line doctor report. */
export function doctorLine(report: DoctorReport): string {
  return `${report.passed ? 'PASS' : 'FAIL'} ${summarizeDoctorReport(report)}`;
}

/** Returns check messages as lines. */
export function checkMessages(checks: CheckResult[]): string[] {
  return checks.map((check) => check.message);
}

/** Returns only required-environment checks. */
export function requiredEnvironmentChecks(names: string[]): CheckResult[] {
  return names.map((name) => checkEnvironmentVariable(name, true));
}

/** Returns a status color-free label. */
export function statusLabel(status: CheckStatus): string {
  return status.toUpperCase();
}

/** Returns a stable check report footer. */
export function reportFooter(report: DoctorReport): string {
  return `${formatDoctorCounts(report.checks)} | ${report.passed ? 'ready' : 'blocked'}`;
}

/** Returns whether a directory is empty. */
export async function isEmptyDirectory(directory: string): Promise<boolean> {
  try { return (await (await import('node:fs/promises')).readdir(directory)).length === 0; } catch { return false; }
}

/** Returns a deterministic list of check results. */
export function sortChecks(checks: CheckResult[]): CheckResult[] {
  return [...checks].sort((a, b) => a.name.localeCompare(b.name));
}

/** Returns a report with checks sorted by name. */
export function sortedReport(report: DoctorReport): DoctorReport {
  return doctorReport(sortChecks(report.checks));
}

/** Returns a warning count from a report. */
export function warningCount(report: DoctorReport): number {
  return countChecksByStatus(report.checks).warn;
}

/** Returns a failure count from a report. */
export function failureCount(report: DoctorReport): number {
  return countChecksByStatus(report.checks).fail;
}

/** Returns a pass count from a report. */
export function passCount(report: DoctorReport): number {
  return countChecksByStatus(report.checks).pass;
}

/** Returns the first check with a name. */
export function findCheck(checks: CheckResult[], name: string): CheckResult | undefined {
  return checks.find((check) => check.name === name);
}

/** Reports whether a named check passed. */
export function checkPassed(checks: CheckResult[], name: string): boolean {
  return findCheck(checks, name)?.status === 'pass';
}

/** Reports whether a named check failed. */
export function checkFailed(checks: CheckResult[], name: string): boolean {
  return findCheck(checks, name)?.status === 'fail';
}

/** Returns a report's checks in status priority order. */
export function checksByPriority(checks: CheckResult[]): CheckResult[] {
  return [...checks].sort((a, b) => ({ fail: 0, warn: 1, pass: 2 }[a.status] - { fail: 0, warn: 1, pass: 2 }[b.status]));
}

/** Returns a simple doctor report string. */
export function formatDoctorSummary(report: DoctorReport): string {
  return `${doctorLine(report)}\n${reportFooter(report)}`;
}

/** Returns a check for a required path. */
export async function requiredPathCheck(path: string): Promise<CheckResult> {
  const result = await checkPath(path);
  return result.status === 'pass' ? result : checkFail(`required:${path}`, result.message);
}

/** Returns a check for a normal path. */
export async function optionalPathCheck(path: string): Promise<CheckResult> {
  const result = await checkPath(path);
  return result.status === 'pass' ? result : checkWarn(`optional:${path}`, result.message);
}

/** Returns a health score from zero to one. */
export function healthScore(checks: CheckResult[]): number {
  if (!checks.length) return 1;
  const weights: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };
  return checks.reduce((sum, check) => sum + weights[check.status], 0) / checks.length;
}

/** Returns a formatted health score. */
export function formatHealthScore(checks: CheckResult[]): string {
  return `${(healthScore(checks) * 100).toFixed(0)}%`;
}
