/**
 * Node.js adapter for JavaScript and TypeScript implementations.
 *
 * TypeScript strategy: Node's built-in type stripping. Node >= 23.6 enables
 * it by default (`process.features.typescript === 'strip'`); Node 22.6–23.5
 * requires `--experimental-strip-types`. No package is downloaded or installed
 * implicitly. When the running Node cannot strip types, the adapter fails with
 * an actionable diagnostic instead of falling back to a different toolchain.
 *
 * Type stripping erases types; it does not support TypeScript features that
 * require code generation (enums, namespaces with runtime values, parameter
 * properties, decorators). Those must be avoided in LIR entry files, or the
 * project must compile them before invoking LIR.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { filterEnvironment } from '../env.js';
import { runProcess } from '../process.js';
import { failure, normalizeProcessResult } from './shared.js';
import type {
  LirAdapter,
  LirInvocationRequest,
  LirInvocationResult,
  LirLanguage,
  LirProbeOptions,
  LirProbeResult,
} from '../types.js';

const NODE_RUNNER = String.raw`
import { pathToFileURL } from 'node:url';

const SENTINEL = '__MAM_LIR_RESULT__';

function write(text) {
  process.stdout.write('\n' + SENTINEL + text + '\n');
}

function replacer(_key, value) {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('Result contains a non-finite number (' + value + ')');
  }
  if (typeof value === 'bigint') {
    throw new TypeError('Result contains a BigInt; convert it to a JSON value first');
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('Result contains a ' + typeof value + '; return a JSON value');
  }
  return value;
}

function emit(payload) {
  let text;
  try {
    text = JSON.stringify(payload, replacer);
  } catch (error) {
    text = JSON.stringify({
      ok: false,
      error: {
        name: 'SerializationError',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  write(text);
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;

try {
  const entry = process.argv[2];
  const exportPath = process.argv[3];
  if (!entry || !exportPath) {
    throw new Error('usage: runner.mjs <entry> <export>');
  }

  const url = pathToFileURL(entry);
  url.searchParams.set('mam_lir', Date.now().toString());
  const module = await import(url.href);

  let target = module;
  for (const part of exportPath.split('.')) {
    target = target?.[part];
  }
  if (typeof target !== 'function') {
    throw new TypeError('export "' + exportPath + '" is not a function');
  }

  const payload = input.trim() === '' ? null : JSON.parse(input);
  const value = await target(payload);
  if (value === undefined) {
    throw new TypeError('Implementation returned undefined; return a JSON value (null is allowed)');
  }
  emit({ ok: true, value });
} catch (error) {
  emit({
    ok: false,
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && typeof error.stack === 'string' ? error.stack : undefined,
    },
  });
}
`;

export interface NodeAdapterOptions {
  /** Explicit node executable. */
  nodePath?: string;
  /** Executable candidates, tried in order when `nodePath` is unset. */
  candidates?: string[];
  probeTimeoutMs?: number;
}

export class NodeLirAdapter implements LirAdapter {
  readonly name = 'node';
  readonly languages: readonly LirLanguage[] = ['javascript', 'typescript'];

  private readonly options: NodeAdapterOptions;
  private probePromise?: Promise<LirProbeResult>;
  private command?: string;
  private typescriptArgs: string[] = [];

  constructor(options: NodeAdapterOptions = {}) {
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
    const configured = this.options.nodePath ?? sourceEnv.MAM_NODE;
    const candidates = configured
      ? [configured]
      : (this.options.candidates ?? ['node']);
    const cwd = options.cwd ?? process.cwd();
    const env = filterEnvironment(sourceEnv);
    const reasons: string[] = [];

    for (const command of candidates) {
      const versionOutcome = await runProcess({
        command,
        args: ['--version'],
        cwd,
        env,
        timeoutMs: this.options.probeTimeoutMs ?? 5_000,
        maxOutputBytes: 64 * 1024,
      });

      if (versionOutcome.spawnError || versionOutcome.exitCode !== 0) {
        reasons.push(
          versionOutcome.spawnError
            ? `${command}: ${versionOutcome.spawnError.code ?? versionOutcome.spawnError.message}`
            : `${command}: exited ${versionOutcome.exitCode}`,
        );
        continue;
      }

      const version = versionOutcome.stdout.trim().replace(/^v/, '');
      const features = await runProcess({
        command,
        args: [
          '-e',
          'process.stdout.write(String(process.features && process.features.typescript))',
        ],
        cwd,
        env,
        timeoutMs: this.options.probeTimeoutMs ?? 5_000,
        maxOutputBytes: 64 * 1024,
      });

      let typescript = false;
      let tsArgs: string[] = [];
      if (features.exitCode === 0 && features.stdout.trim() === 'strip') {
        typescript = true;
      } else {
        const flag = await runProcess({
          command,
          args: ['--experimental-strip-types', '-e', 'process.stdout.write("ok")'],
          cwd,
          env,
          timeoutMs: this.options.probeTimeoutMs ?? 5_000,
          maxOutputBytes: 64 * 1024,
        });
        if (flag.exitCode === 0 && flag.stdout.trim() === 'ok') {
          typescript = true;
          tsArgs = ['--experimental-strip-types'];
        }
      }

      this.command = command;
      this.typescriptArgs = tsArgs;
      return {
        adapter: this.name,
        languages: [...this.languages],
        available: true,
        version,
        command,
        typescript,
        ...(typescript
          ? {}
          : {
              reason:
                'TypeScript execution requires Node >= 22.6 with type stripping. '
                + 'JavaScript implementations remain available.',
            }),
      };
    }

    return {
      adapter: this.name,
      languages: [...this.languages],
      available: false,
      reason: `No usable Node.js runtime found (${reasons.join('; ') || 'no candidates'}). Set MAM_NODE or pass --node.`,
    };
  }

  async invoke(request: LirInvocationRequest): Promise<LirInvocationResult> {
    const probe = await this.probe({ cwd: request.cwd, env: request.env });
    if (!probe.available) {
      return failure(
        request,
        this.name,
        this.command ?? 'node',
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
        probe.reason ?? 'Node.js is not available',
      );
    }

    if (request.implementation.language === 'typescript' && !probe.typescript) {
      return failure(
        request,
        this.name,
        this.command ?? 'node',
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
        probe.reason
          ?? 'This Node.js version cannot execute TypeScript. Use Node >= 22.6 or invoke a compiled JavaScript entry.',
      );
    }

    const command = this.command ?? this.options.nodePath ?? 'node';
    const dir = await mkdtemp(join(tmpdir(), 'mam-lir-node-'));
    const runner = join(dir, 'runner.mjs');

    try {
      await writeFile(runner, NODE_RUNNER, 'utf8');
      const isTypeScript = request.implementation.language === 'typescript';
      const outcome = await runProcess({
        command,
        args: [
          ...(isTypeScript ? this.typescriptArgs : []),
          runner,
          request.implementation.entry,
          request.implementation.export ?? 'default',
        ],
        cwd: request.cwd,
        env: request.env,
        input: request.inputText,
        timeoutMs: request.timeoutMs,
        maxOutputBytes: request.maxOutputBytes,
        signal: request.signal,
      });

      return normalizeProcessResult(request, this.name, command, outcome, request.implementation.language);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** Exposed for documentation and tests. */
export const NODE_LIR_RUNNER_SOURCE = NODE_RUNNER;
