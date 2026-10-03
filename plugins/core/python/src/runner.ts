/**
 * Python Plugin - Subprocess Runner
 *
 * Runs Python in a child process with a bounded wall-clock timeout and a
 * bounded output size. The interpreter is resolved at runtime rather than
 * hardcoded, because `python3` is absent on Windows (where the name resolves to
 * a Microsoft Store alias that exits 9009) while `python` is the norm, and the
 * reverse is true on many Linux images.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** A resolved interpreter: the command plus any launcher flags it needs. */
export interface PythonInterpreter {
  command: string;
  args: string[];
  /** The full version string, when it could be read. */
  version?: string;
  /** How the interpreter was chosen, for diagnostics. */
  source: 'env' | 'detected' | 'assumed';
}

export interface PythonRunOptions {
  /** Wall-clock limit in ms. Default 30000. */
  timeout?: number;
  cwd?: string;
  /** Extra environment variables, merged over the inherited set. */
  env?: Record<string, string>;
  /** Data written to the child's stdin, which is then closed. */
  stdin?: string;
  /**
   * Pass only `options.env`, dropping the parent environment.
   *
   * Off by default: dropping `PATH` and friends breaks most interpreters. Turn
   * it on for untrusted code that should not see the host's environment.
   */
  inheritEnv?: boolean;
  /** Run with `-I`, ignoring `PYTHON*` variables and the user site directory. */
  isolated?: boolean;
  /** Abort once stdout and stderr together exceed this many bytes. */
  maxOutputBytes?: number;
  /** Strip leading and trailing whitespace from the captured streams. */
  trimOutput?: boolean;
  /**
   * Leave CRLF alone.
   *
   * Off by default: a Windows child emits `\r\n` for every `print`, so keeping
   * it would make a module's output differ by platform. Turn this on for code
   * that genuinely deals in carriage returns.
   */
  preserveLineEndings?: boolean;
  /** Interpreter override; otherwise the resolved one is used. */
  interpreter?: PythonInterpreter;
  /** Directory for temporary script files. */
  tempDir?: string;
  /** Extra arguments inserted before the script path. */
  pythonArgs?: string[];
}

export interface PythonRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timeMs: number;
  signal?: string;
  /** True when the run hit the timeout and was killed. */
  timedOut?: boolean;
  /** True when output was cut off at `maxOutputBytes`. */
  truncated?: boolean;
  /** Total bytes captured before truncation. */
  outputBytes?: number;
  /** The interpreter that actually ran, for diagnostics. */
  interpreter?: string;
}

export interface PythonExecutionStats {
  runs: number;
  successes: number;
  failures: number;
  timeouts: number;
  truncated: number;
  totalTimeMs: number;
  averageTimeMs: number;
  lastRunAt?: Date;
  lastErrorAt?: Date;
}

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_OUTPUT = 10 * 1024 * 1024;
const stats: PythonExecutionStats = {
  runs: 0, successes: 0, failures: 0, timeouts: 0, truncated: 0,
  totalTimeMs: 0, averageTimeMs: 0,
};

/** Returns cumulative execution statistics. */
export function getExecutionStats(): Readonly<PythonExecutionStats> {
  return { ...stats };
}

/** Resets execution statistics without affecting the interpreter cache. */
export function resetExecutionStats(): void {
  stats.runs = 0;
  stats.successes = 0;
  stats.failures = 0;
  stats.timeouts = 0;
  stats.truncated = 0;
  stats.totalTimeMs = 0;
  stats.averageTimeMs = 0;
  delete stats.lastRunAt;
  delete stats.lastErrorAt;
}

// ─── Interpreter Resolution ───────────────────────────────────────

/** Candidate interpreters, most preferred first. */
function getCandidates(): Array<{ command: string; args: string[] }> {
  const candidates: Array<{ command: string; args: string[] }> = [];
  if (process.env.PYTHON) candidates.push({ command: process.env.PYTHON, args: [] });
  candidates.push({ command: 'python3', args: [] });
  candidates.push({ command: 'python', args: [] });
  if (process.platform === 'win32') candidates.push({ command: 'py', args: ['-3'] });
  return candidates;
}

let cachedInterpreter: PythonInterpreter | null = null;
let resolution: Promise<PythonInterpreter> | null = null;

function probeInterpreter(
  candidate: { command: string; args: string[] },
  timeout: number,
): Promise<PythonInterpreter | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PythonInterpreter | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(candidate.command, [...candidate.args, '-c', 'import sys; print(sys.version.split()[0])'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch {
      finish(null);
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish(null);
    }, timeout);
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();

    let version = '';
    child.stdout.on('data', (chunk: Buffer) => { version += chunk.toString(); });
    child.on('error', () => { clearTimeout(timer); finish(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish(code === 0
        ? { ...candidate, version: version.trim(), source: 'detected' }
        : null);
    });
  });
}

/**
 * Resolves a working interpreter, caching the result.
 *
 * Falls back to the first candidate without probing so a missing interpreter
 * surfaces as a real spawn error rather than a silent "no candidates" case.
 */
export function resolveInterpreter(timeout = 5000): Promise<PythonInterpreter> {
  if (cachedInterpreter) return Promise.resolve(cachedInterpreter);
  if (resolution) return resolution;

  resolution = (async () => {
    const candidates = getCandidates();
    for (const candidate of candidates) {
      const found = await probeInterpreter(candidate, timeout);
      if (found) {
        cachedInterpreter = found;
        return found;
      }
    }
    const fallback = candidates[0]!;
    cachedInterpreter = { ...fallback, source: 'assumed' };
    return cachedInterpreter;
  })();

  return resolution;
}

/** Overrides the interpreter, skipping discovery. */
export function setInterpreter(interpreter: PythonInterpreter | null): void {
  cachedInterpreter = interpreter;
  resolution = null;
}

/** Returns the cached interpreter without probing. */
export function getCachedInterpreter(): PythonInterpreter | null {
  return cachedInterpreter;
}

function commandFor(options: PythonRunOptions, interpreter: PythonInterpreter): {
  command: string;
  prefix: string[];
  resolved: PythonInterpreter;
} {
  const resolved = interpreter;
  const prefix = [
    ...resolved.args,
    ...(options.isolated ? ['-I'] : []),
    // Keeps output decodable as UTF-8 regardless of the host locale.
    '-X', 'utf8',
    ...(options.pythonArgs ?? []),
  ];
  return { command: resolved.command, prefix, resolved };
}

// ─── Execution ────────────────────────────────────────────────────

/** Runs a Python script file. */
export async function runPythonFile(
  filePath: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const startTime = performance.now();
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  // Resolved here rather than read from the cache, so a first call works
  // without the host having probed in advance.
  const interpreter = options.interpreter ?? await resolveInterpreter();
  const { command, prefix, resolved } = commandFor(options, interpreter);

  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, [...prefix, filePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options.cwd,
        env: {
          ...(options.inheritEnv === false ? {} : process.env),
          PYTHONIOENCODING: 'utf-8',
          ...options.env,
        },
        windowsHide: true,
      });
    } catch (error) {
      resolve(failure(error as Error, startTime, resolved, timeout));
      return;
    }

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;
    let truncated = false;
    let settled = false;

    const settle = (result: PythonRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      recordStats(result);
      resolve(result);
    };

    const kill = (): void => {
      child.kill('SIGKILL');
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeout);
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();

    const collect = (chunk: Buffer, into: 'out' | 'err'): void => {
      const text = chunk.toString();
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > maxOutputBytes) {
        // Cut off rather than buffering an unbounded print loop into memory.
        if (!truncated) {
          truncated = true;
          const room = Math.max(0, maxOutputBytes - (outputBytes - Buffer.byteLength(text)));
          const kept = text.slice(0, room);
          if (into === 'out') stdout += kept; else stderr += kept;
        }
        kill();
        return;
      }
      if (into === 'out') stdout += text; else stderr += text;
    };

    child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'out'));
    child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'err'));

    // The pipe must be closed even with no input, or a script that reads
    // stdin would block until the timeout.
    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();

    child.on('close', (code, signal) => {
      const shape = (value: string): string => {
        let out = value;
        if (!options.preserveLineEndings) out = out.replace(/\r\n/g, '\n');
        return options.trimOutput ? out.trim() : out;
      };
      settle({
        success: code === 0 && !timedOut && !truncated,
        stdout: shape(stdout),
        stderr: shape(stderr),
        exitCode: code,
        timeMs: performance.now() - startTime,
        signal: signal ?? undefined,
        timedOut,
        truncated,
        outputBytes,
        interpreter: resolved.command,
      });
    });

    child.on('error', (error) => settle(failure(error, startTime, resolved, timeout)));
  });
}

function failure(
  error: Error,
  startTime: number,
  interpreter: PythonInterpreter,
  _timeout: number,
): PythonRunResult {
  const result: PythonRunResult = {
    success: false,
    stdout: '',
    stderr: error.message,
    exitCode: null,
    timeMs: performance.now() - startTime,
    interpreter: interpreter.command,
  };
  recordStats(result);
  return result;
}

function recordStats(result: PythonRunResult): void {
  stats.runs++;
  stats.totalTimeMs += result.timeMs;
  stats.averageTimeMs = stats.totalTimeMs / stats.runs;
  stats.lastRunAt = new Date();
  if (result.success) stats.successes++;
  else {
    stats.failures++;
    stats.lastErrorAt = new Date();
  }
  if (result.timedOut) stats.timeouts++;
  if (result.truncated) stats.truncated++;
}

function getTempDir(options: PythonRunOptions): string {
  return join(options.tempDir ?? tmpdir(), 'mam-python');
}

function randomFilename(ext = '.py'): string {
  return `mam-${randomBytes(8).toString('hex')}${ext}`;
}

/** Writes code to a temporary file, runs it, then removes the file. */
export async function runPythonCode(
  code: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const tempDir = getTempDir(options);
  await mkdir(tempDir, { recursive: true });
  const tmpFile = join(tempDir, randomFilename());

  try {
    await writeFile(tmpFile, code, 'utf-8');
    return await runPythonFile(tmpFile, options);
  } finally {
    try { await unlink(tmpFile); } catch { /* the run may have removed it already */ }
  }
}

/**
 * Evaluates a Python expression and returns its JSON form.
 *
 * Wrapped so a failing expression exits non-zero with the message on stderr,
 * rather than being indistinguishable from a successful `print`.
 */
export async function runPythonExpression(
  expression: string,
  options: PythonRunOptions = {},
): Promise<PythonRunResult> {
  const code = [
    'import json, sys',
    'try:',
    `    result = eval(${JSON.stringify(expression)})`,
    '    print(json.dumps(result))',
    'except Exception as e:',
    '    print(json.dumps({"error": str(e)}), file=sys.stderr)',
    '    sys.exit(1)',
  ].join('\n');
  return runPythonCode(code, options);
}

/** Parses the JSON produced by {@link runPythonExpression}. */
export function parseExpressionResult(result: PythonRunResult): { value?: unknown; error?: string } {
  if (result.success) {
    try {
      return { value: JSON.parse(result.stdout) as unknown };
    } catch (error) {
      return { error: `Unparsable JSON output: ${(error as Error).message}` };
    }
  }

  // The expression wrapper reports failures as `{"error": "..."}` on stderr,
  // so the real message is recoverable rather than being discarded.
  try {
    const parsed = JSON.parse(result.stderr) as { error?: string };
    if (parsed && typeof parsed.error === 'string') return { error: parsed.error };
  } catch { /* stderr was not the wrapper's JSON */ }

  if (result.timedOut) return { error: `Timed out after the configured limit` };
  return { error: result.stderr || 'Execution failed' };
}

export interface PythonAvailability {
  available: boolean;
  version?: string;
  interpreter?: string;
  /** Why the interpreter could not be used, when it could not. */
  error?: string;
}

/** Reports whether a working interpreter is available, and which one. */
export async function checkPythonAvailable(timeout = 5000): Promise<PythonAvailability> {
  const interpreter = await resolveInterpreter(timeout);
  if (interpreter.source === 'assumed') {
    // Every candidate failed the probe; ask it to print something to see why.
    const result = await runPythonCode('import sys; print(sys.version)', { timeout, interpreter });
    return {
      available: result.success,
      interpreter: interpreter.command,
      error: result.success ? undefined : (result.stderr || 'No Python interpreter found'),
    };
  }
  return { available: true, version: interpreter.version, interpreter: interpreter.command };
}

/** Resets the cached interpreter so the next run probes again. */
export function resetInterpreterCache(): void {
  cachedInterpreter = null;
  resolution = null;
}
