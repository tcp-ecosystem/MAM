import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import {
  checkNodeVersion,
  checkPackageJson,
  checkConfigFile,
  runDoctorChecks,
  formatDoctorReport,
  hasFailingChecks,
  countChecksByStatus,
} from '../src/doctor.js';

const TMP = join(tmpdir(), 'mam-doctor-test-' + Date.now());

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('checkNodeVersion', () => {
  it('should pass for trivially low requirements', () => {
    const result = checkNodeVersion(1);
    expect(result.name).toBe('node-version');
    expect(result.status).toBe('pass');
    expect(result.message).toContain('Node.js');
  });

  it('should fail for impossible requirements', () => {
    const result = checkNodeVersion(999);
    expect(result.status).toBe('fail');
  });
});

describe('checkPackageJson', () => {
  it('should warn when missing', async () => {
    const result = await checkPackageJson(TMP);
    expect(result.status).toBe('warn');
  });

  it('should pass for valid package.json', async () => {
    await writeFile(join(TMP, 'package.json'), JSON.stringify({ name: 'demo' }), 'utf-8');
    const result = await checkPackageJson(TMP);
    expect(result.status).toBe('pass');
    expect(result.message).toContain('demo');
  });

  it('should fail for malformed JSON', async () => {
    await writeFile(join(TMP, 'package.json'), 'not json', 'utf-8');
    const result = await checkPackageJson(TMP);
    expect(result.status).toBe('fail');
  });
});

describe('checkConfigFile', () => {
  it('should pass with defaults when no config exists', async () => {
    const result = await checkConfigFile(TMP);
    expect(result.status).toBe('pass');
  });

  it('should fail for invalid config content', async () => {
    await writeFile(join(TMP, 'mam.config.json'), JSON.stringify({ version: '' }), 'utf-8');
    const result = await checkConfigFile(TMP);
    expect(result.status).toBe('fail');
  });
});

describe('runDoctorChecks', () => {
  it('should run the full suite', async () => {
    const report = await runDoctorChecks(TMP);
    expect(report.checks.length).toBe(9);
    expect(report.timeMs).toBeGreaterThanOrEqual(0);
    expect(report.checks.map((check) => check.name)).toContain('node-version');
  });
});

describe('formatDoctorReport', () => {
  it('should render statuses and counts', async () => {
    const report = await runDoctorChecks(TMP);
    const text = formatDoctorReport(report);
    expect(text).toContain('node-version');
    expect(text).toMatch(/\[PASS\]|\[WARN\]|\[FAIL\]/);
    expect(text).toContain('in ');
  });
});

describe('hasFailingChecks / countChecksByStatus', () => {
  it('should evaluate report outcomes', async () => {
    const report = await runDoctorChecks(TMP);
    const counts = countChecksByStatus(report);
    expect(counts.pass! + counts.warn! + counts.fail!).toBe(report.checks.length);
    expect(hasFailingChecks(report)).toBe(counts.fail! > 0);
    expect(hasFailingChecks({ checks: [], timeMs: 0 })).toBe(false);
  });
});
