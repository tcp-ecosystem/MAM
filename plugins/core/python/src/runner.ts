/**
 * Python Plugin - Subprocess Runner
 */

import { spawn } from 'node:child_process';
import { writeFile, unlink, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export interface PythonRunOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
}

export interface PythonRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  signal?: string;
}

function getTempDir(): string {
  return join(tmpdir(), 'mam-python');
}

function randomFilename(ext = '.py'): string {
  return `mam-${randomBytes(8).toString('hex')}${ext}`;
}

export async function runPythonFile(
  filePath: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const startTime = performance.now();
  const timeout = options.timeout || 30000;

  return new Promise((resolve) => {
    const proc = spawn('python3', [filePath], {
      timeout,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...options.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    if (options.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }

    proc.on('close', (code, signal) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
        timeMs: performance.now() - startTime,
        signal: signal || undefined,
      });
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        stdout: '',
        stderr: err.message,
        exitCode: null,
        timeMs: performance.now() - startTime,
      });
    });
  });
}

export async function runPythonCode(
  code: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });
  const tmpFile = join(tempDir, randomFilename());

  try {
    await writeFile(tmpFile, code, 'utf-8');
    return await runPythonFile(tmpFile, options);
  } finally {
    try { await unlink(tmpFile); } catch { /* ignore */ }
  }
}

export async function runPythonExpression(
  expression: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const code = `import json, sys\ntry:\n    result = eval(${JSON.stringify(expression)})\n    print(json.dumps(result))\nexcept Exception as e:\n    print(json.dumps({"error": str(e)}), file=sys.stderr)\n    sys.exit(1)\n`;
  return runPythonCode(code, options);
}

export async function checkPythonAvailable(): Promise<{ available: boolean; version?: string }> {
  const result = await runPythonCode('import sys; print(sys.version)', { timeout: 5000 });
  return {
    available: result.success,
    version: result.stdout || undefined,
  };
}
