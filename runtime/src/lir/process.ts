/**
 * Process execution primitives shared by host-language adapters.
 *
 * This is intentionally *not* a sandbox. It provides the containment that a
 * subprocess can honestly provide: a fixed command and argument array (no
 * shell interpolation), a controlled working directory, a filtered
 * environment, a wall-clock timeout, cancellation, and bounded output.
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface ProcessRequest {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export interface ProcessOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  spawnError?: NodeJS.ErrnoException;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
  durationMs: number;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    try {
      child.kill();
    } catch {
      // The process may already be gone.
    }
    return;
  }

  if (process.platform === 'win32') {
    try {
      const killer = spawn(
        'taskkill',
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      );
      killer.on('error', () => {
        try {
          child.kill();
        } catch {
          // Ignore: the process may have exited.
        }
      });
      return;
    } catch {
      // Fall through to the direct kill below.
    }
  }

  if (process.platform !== 'win32' && child.pid) {
    try {
      // The child was spawned as a process-group leader, so the negative pid
      // terminates descendants as well.
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to the direct kill below.
    }
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // Ignore: the process may have exited.
  }
}

function collect(
  stream: NodeJS.ReadableStream | null,
  maxBytes: number,
): { chunks: Buffer[]; truncated: () => boolean } {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;

  stream?.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (size >= maxBytes) {
      truncated = true;
      return;
    }
    const remaining = maxBytes - size;
    if (buffer.length > remaining) {
      chunks.push(buffer.subarray(0, remaining));
      size = maxBytes;
      truncated = true;
      return;
    }
    chunks.push(buffer);
    size += buffer.length;
  });

  return { chunks, truncated: () => truncated };
}

/**
 * Run a child process to completion. Never rejects for ordinary execution
 * failures; callers receive a structured outcome and decide what it means.
 */
export function runProcess(request: ProcessRequest): Promise<ProcessOutcome> {
  const started = Date.now();

  return new Promise<ProcessOutcome>((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let spawnError: NodeJS.ErrnoException | undefined;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    const finish = (
      stdout: string,
      stderr: string,
      exitCode: number | null,
      truncated: boolean,
    ): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onAbort) request.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout,
        stderr,
        exitCode,
        spawnError,
        timedOut,
        aborted,
        outputTruncated: truncated,
        durationMs: Date.now() - started,
      });
    };

    if (request.signal?.aborted) {
      aborted = true;
      finish('', '', null, false);
      return;
    }

    let child: ChildProcess;
    try {
      child = spawn(request.command, request.args, {
        cwd: request.cwd,
        env: request.env,
        windowsHide: true,
        // POSIX: create a process group so timeouts can terminate descendants.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = error as NodeJS.ErrnoException;
      finish('', '', null, false);
      return;
    }

    const stdout = collect(child.stdout, request.maxOutputBytes);
    const stderr = collect(child.stderr, request.maxOutputBytes);

    const onAbortHandler = (): void => {
      if (settled) return;
      aborted = true;
      killProcessTree(child);
    };
    onAbort = onAbortHandler;
    request.signal?.addEventListener('abort', onAbortHandler, { once: true });

    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killProcessTree(child);
    }, Math.max(1, request.timeoutMs));

    child.on('error', (error: NodeJS.ErrnoException) => {
      spawnError = error;
      finish(
        Buffer.concat(stdout.chunks).toString('utf8'),
        Buffer.concat(stderr.chunks).toString('utf8'),
        null,
        stdout.truncated() || stderr.truncated(),
      );
    });

    child.on('close', (code) => {
      finish(
        Buffer.concat(stdout.chunks).toString('utf8'),
        Buffer.concat(stderr.chunks).toString('utf8'),
        code,
        stdout.truncated() || stderr.truncated(),
      );
    });

    if (child.stdin) {
      child.stdin.on('error', () => {
        // The child may exit before consuming stdin; the exit code and
        // stderr carry the actionable failure.
      });
      child.stdin.end(request.input ?? '');
    }
  });
}
