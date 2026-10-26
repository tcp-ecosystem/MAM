/**
 * Python host-language adapter.
 *
 * The implementation is an ordinary Python file with a callable export. The
 * callable receives one JSON-decoded value and may return any JSON-compatible
 * value. Async callables are awaited with `asyncio.run`.
 *
 * Security boundary: this adapter starts a subprocess. It is not a sandbox.
 * The registry controls the executable, working directory, filtered
 * environment, timeout, and output limit; OS-level isolation is out of scope.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterEnvironment } from '../env.js';
import { runProcess } from '../process.js';
import {
  normalizeProcessResult,
  failure,
} from './shared.js';
import type {
  LirAdapter,
  LirInvocationRequest,
  LirInvocationResult,
  LirLanguage,
  LirProbeOptions,
  LirProbeResult,
} from '../types.js';

const PYTHON_PROBE = [
  'import json, sys',
  'print(json.dumps({"version": sys.version.split()[0], "executable": sys.executable}))',
].join('\n');

const PYTHON_RUNNER = String.raw`
import asyncio
import importlib.util
import inspect
import json
import sys
import traceback

_SENTINEL = "__MAM_LIR_RESULT__"


def _write(text):
    sys.stdout.write("\n" + _SENTINEL + text + "\n")
    sys.stdout.flush()


def _emit(payload):
    try:
        text = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        text = json.dumps({
            "ok": False,
            "error": {
                "name": "SerializationError",
                "message": "Result is not JSON-serializable: " + str(exc),
            },
        })
    _write(text)


def _resolve_export(module, export_path):
    target = module
    for part in export_path.split("."):
        target = getattr(target, part)
    return target


def _main():
    try:
        if len(sys.argv) != 3:
            raise RuntimeError("usage: runner.py <entry> <export>")
        entry, export_path = sys.argv[1], sys.argv[2]
        raw = sys.stdin.read()
        payload = json.loads(raw) if raw.strip() else None
        spec = importlib.util.spec_from_file_location("mam_lir_impl", entry)
        if spec is None or spec.loader is None:
            raise RuntimeError("unable to load implementation: " + entry)
        module = importlib.util.module_from_spec(spec)
        sys.modules["mam_lir_impl"] = module
        spec.loader.exec_module(module)
        target = _resolve_export(module, export_path)
        if not callable(target):
            raise TypeError("export %r is not callable" % export_path)
        value = target(payload)
        if inspect.isawaitable(value):
            value = asyncio.run(value)
        _emit({"ok": True, "value": value})
    except BaseException as exc:
        _emit({
            "ok": False,
            "error": {
                "name": type(exc).__name__,
                "message": str(exc),
                "stack": traceback.format_exc(),
            },
        })
    return 0


if __name__ == "__main__":
    sys.exit(_main())
`;

export interface PythonAdapterOptions {
  /** Explicit interpreter path. Takes precedence over candidates. */
  pythonPath?: string;
  /** Interpreter candidates, tried in order when `pythonPath` is unset. */
  candidates?: string[];
  /** Probe timeout in milliseconds. */
  probeTimeoutMs?: number;
}

export class PythonLirAdapter implements LirAdapter {
  readonly name = 'python';
  readonly languages: readonly LirLanguage[] = ['python'];

  private readonly options: PythonAdapterOptions;
  private probePromise?: Promise<LirProbeResult>;
  private command?: string;

  constructor(options: PythonAdapterOptions = {}) {
    this.options = options;
  }

  probe(options: LirProbeOptions = {}): Promise<LirProbeResult> {
    if (!this.probePromise) {
      this.probePromise = this.probeOnce(options);
    }
    return this.probePromise;
  }

  private async probeOnce(options: LirProbeOptions): Promise<LirProbeResult> {
    const sourceEnv = options.env ?? process.env;
    const configured = this.options.pythonPath ?? sourceEnv.MAM_PYTHON;
    const candidates = configured
      ? [configured]
      : (this.options.candidates
        ?? (process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']));
    const cwd = options.cwd ?? process.cwd();
    const env = filterEnvironment(sourceEnv);
    const reasons: string[] = [];

    for (const command of candidates) {
      const outcome = await runProcess({
        command,
        args: ['-c', PYTHON_PROBE],
        cwd,
        env,
        timeoutMs: this.options.probeTimeoutMs ?? 5_000,
        maxOutputBytes: 64 * 1024,
      });

      if (outcome.spawnError || outcome.exitCode !== 0) {
        reasons.push(
          outcome.spawnError
            ? `${command}: ${outcome.spawnError.code ?? outcome.spawnError.message}`
            : `${command}: exited ${outcome.exitCode}${outcome.stderr.trim() ? ` (${outcome.stderr.trim().split(/\r?\n/).pop()})` : ''}`,
        );
        continue;
      }

      const line = outcome.stdout.trim().split(/\r?\n/).pop() ?? '';
      try {
        const parsed = JSON.parse(line) as { version?: string; executable?: string };
        if (typeof parsed.version === 'string') {
          this.command = command;
          return {
            adapter: this.name,
            languages: [...this.languages],
            available: true,
            version: parsed.version,
            command,
          };
        }
      } catch {
        // Try the next candidate; a broken probe is not a usable runtime.
      }
      reasons.push(`${command}: probe output was not valid JSON`);
    }

    return {
      adapter: this.name,
      languages: [...this.languages],
      available: false,
      reason: `No usable Python interpreter found (${reasons.join('; ') || 'no candidates'}). Set MAM_PYTHON or pass --python.`,
    };
  }

  async invoke(request: LirInvocationRequest): Promise<LirInvocationResult> {
    const probe = await this.probe({ cwd: request.cwd, env: request.env });
    if (!probe.available) {
      return failure(
        request,
        this.name,
        this.command ?? 'python',
        {
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: false,
          aborted: false,
          outputTruncated: false,
          durationMs: 0,
        },
        'LIR_RUNTIME_MISSING',
        probe.reason ?? 'Python interpreter is not available',
      );
    }

    const command = this.command ?? this.options.pythonPath ?? 'python';
    const dir = await mkdtemp(join(tmpdir(), 'mam-lir-python-'));
    const runner = join(dir, 'runner.py');

    try {
      await writeFile(runner, PYTHON_RUNNER, 'utf8');
      const outcome = await runProcess({
        command,
        args: [runner, request.implementation.entry, request.implementation.export ?? 'main'],
        cwd: request.cwd,
        env: {
          ...request.env,
          // Deterministic UTF-8 JSON over the protocol pipe.
          PYTHONIOENCODING: 'utf-8',
          PYTHONUNBUFFERED: '1',
        },
        input: request.inputText,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal: request.signal,
      });

      return normalizeProcessResult(request, this.name, command, outcome, 'python');
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Exposed for tests that need to check the runner protocol without spawning. */
export const PYTHON_LIR_RUNNER_SOURCE = PYTHON_RUNNER;
