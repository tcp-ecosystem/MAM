/**
 * LIR registry and dispatcher.
 *
 * The registry owns policy. Adapters only know how to start their runtime and
 * speak the JSON protocol; they do not decide whether an invocation is
 * allowed. Every invocation produces an auditable record, including failures
 * that happen before a process starts.
 */

import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { errorMessage, isLirError, LirError } from './errors.js';
import { filterEnvironment } from './env.js';
import { resolveImplementation } from './manifest.js';
import { PythonLirAdapter, type PythonAdapterOptions } from './adapters/python.js';
import { NodeLirAdapter, type NodeAdapterOptions } from './adapters/node.js';
import {
  DEFAULT_LIR_POLICY,
  type ImplementationDeclaration,
  type JsonValue,
  type LirAdapter,
  type LirErrorCode,
  type LirInvocationFailure,
  type LirInvocationRecord,
  type LirInvocationResult,
  type LirLanguage,
  type LirPolicy,
  type LirProbeOptions,
  type LirProbeResult,
  type LirRegistryOptions,
  type LirInvokeOptions,
  type ResolvedImplementation,
} from './types.js';

function assertJsonValue(value: unknown, path = '$', stack = new Set<object>()): asserts value is JsonValue {
  if (value === null) return;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new LirError('LIR_INPUT_INVALID', `Input ${path} is not a finite number`);
      }
      return;
    case 'object':
      break;
    default:
      throw new LirError(
        'LIR_INPUT_INVALID',
        `Input ${path} is ${typeof value}; only JSON values are supported`,
      );
  }

  if (stack.has(value)) {
    throw new LirError('LIR_INPUT_INVALID', `Input ${path} contains a circular reference`);
  }
  stack.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, stack));
  } else {
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, stack);
    }
  }

  stack.delete(value);
}

function escape(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

export class LirRegistry {
  readonly projectRoot: string;
  private readonly manifestPath?: string;
  private readonly sourceEnv: NodeJS.ProcessEnv;
  private readonly policy: LirPolicy;
  private readonly onRecord?: (record: LirInvocationRecord) => void;
  private readonly adapters = new Map<LirLanguage, LirAdapter>();
  private readonly records: LirInvocationRecord[] = [];

  constructor(options: LirRegistryOptions) {
    if (!options.projectRoot || !isAbsolute(options.projectRoot)) {
      throw new LirError(
        'LIR_DECLARATION_INVALID',
        'LirRegistry requires an absolute projectRoot',
      );
    }
    this.projectRoot = resolve(options.projectRoot);
    this.manifestPath = options.manifestPath
      ? resolve(options.manifestPath)
      : undefined;
    this.sourceEnv = options.env ?? process.env;
    this.policy = {
      ...DEFAULT_LIR_POLICY,
      ...options.policy,
      allowedLanguages: options.policy?.allowedLanguages
        ?? DEFAULT_LIR_POLICY.allowedLanguages,
      allowedImplementations: options.policy?.allowedImplementations
        ?? DEFAULT_LIR_POLICY.allowedImplementations,
      grantedPermissions: options.policy?.grantedPermissions
        ?? DEFAULT_LIR_POLICY.grantedPermissions,
      allowEnvironment: options.policy?.allowEnvironment
        ?? DEFAULT_LIR_POLICY.allowEnvironment,
    };
    this.onRecord = options.onRecord;
  }

  /** Register an adapter for every language it supports. */
  register(adapter: LirAdapter): this {
    for (const language of adapter.languages) {
      this.adapters.set(language, adapter);
    }
    return this;
  }

  /** Distinct registered adapters. */
  listAdapters(): LirAdapter[] {
    return [...new Set(this.adapters.values())];
  }

  getAdapter(language: LirLanguage): LirAdapter | undefined {
    return this.adapters.get(language);
  }

  getPolicy(): Readonly<LirPolicy> {
    return this.policy;
  }

  getAuditLog(): readonly LirInvocationRecord[] {
    return this.records;
  }

  async probeAll(options: LirProbeOptions = {}): Promise<LirProbeResult[]> {
    return Promise.all(
      this.listAdapters().map((adapter) => adapter.probe({
        cwd: options.cwd ?? this.projectRoot,
        env: options.env ?? this.sourceEnv,
      })),
    );
  }

  /**
   * Resolve a declaration without touching the filesystem. Useful for
   * `mam lir list`, which should show declarations even when an entry is
   * missing.
   */
  resolve(declaration: ImplementationDeclaration): ResolvedImplementation {
    return resolveImplementation(declaration, {
      projectRoot: this.projectRoot,
      manifestPath: this.manifestPath,
    });
  }

  private checkPolicy(declaration: ImplementationDeclaration): LirError | null {
    if (!this.policy.allowedLanguages.includes(declaration.language)) {
      return new LirError(
        'LIR_LANGUAGE_NOT_ALLOWED',
        `Language "${declaration.language}" is not allowed by policy (allowed: ${this.policy.allowedLanguages.join(', ')})`,
      );
    }

    if (
      this.policy.allowedImplementations.length > 0
      && !this.policy.allowedImplementations.includes(declaration.id)
    ) {
      return new LirError(
        'LIR_IMPLEMENTATION_NOT_ALLOWED',
        `Implementation "${declaration.id}" is not in the policy allowlist`,
      );
    }

    if (!this.policy.grantedPermissions.includes('process:spawn')) {
      return new LirError(
        'LIR_PERMISSION_DENIED',
        'Policy does not grant "process:spawn"; host-language execution is disabled',
      );
    }

    for (const permission of declaration.permissions ?? []) {
      if (!this.policy.grantedPermissions.includes(permission)) {
        return new LirError(
          'LIR_PERMISSION_DENIED',
          `Implementation "${declaration.id}" requests permission "${permission}", which policy does not grant`,
        );
      }
    }

    for (const name of declaration.env ?? []) {
      if (!this.policy.allowEnvironment.includes(name)) {
        return new LirError(
          'LIR_PERMISSION_DENIED',
          `Implementation "${declaration.id}" requests environment variable "${name}", which policy does not allow`,
        );
      }
    }

    return null;
  }

  private async prepare(declaration: ImplementationDeclaration): Promise<ResolvedImplementation> {
    const resolved = this.resolve(declaration);

    let entryStat;
    try {
      entryStat = await stat(resolved.entry);
    } catch {
      throw new LirError(
        'LIR_ENTRY_MISSING',
        `Entry file not found for implementation "${declaration.id}": ${resolved.entry}`,
      );
    }

    if (!entryStat.isFile()) {
      throw new LirError(
        'LIR_ENTRY_NOT_FILE',
        `Entry for implementation "${declaration.id}" is not a file: ${resolved.entry}`,
      );
    }

    // Symlinks must not escape the project root either.
    const [realRoot, realEntry] = await Promise.all([
      realpath(this.projectRoot),
      realpath(resolved.entry),
    ]);
    if (escape(realRoot, realEntry)) {
      throw new LirError(
        'LIR_PATH_ESCAPE',
        `Entry for implementation "${declaration.id}" resolves outside the project root: ${realEntry}`,
      );
    }

    return { ...resolved, entry: realEntry };
  }

  private childEnvironment(
    declaration: ImplementationDeclaration,
    extra: NodeJS.ProcessEnv | undefined,
  ): NodeJS.ProcessEnv {
    const names = [
      ...this.policy.allowEnvironment,
      ...(declaration.env ?? []),
      ...Object.keys(extra ?? {}),
    ];
    const env = filterEnvironment(this.sourceEnv, names, []);
    for (const [name, value] of Object.entries(extra ?? {})) {
      if (typeof value === 'string') env[name] = value;
    }
    return env;
  }

  private record(
    declaration: ImplementationDeclaration,
    adapter: string,
    result: LirInvocationResult,
  ): void {
    let entry = declaration.entry;
    try {
      entry = this.resolve(declaration).entry;
    } catch {
      // Keep the declared value when the path is invalid; the failure result
      // already carries the actionable diagnostic.
    }
    const record: LirInvocationRecord = {
      timestamp: new Date().toISOString(),
      implementationId: declaration.id,
      language: declaration.language,
      entry,
      adapter,
      ok: result.ok,
      ...(result.ok ? {} : { code: result.error.code }),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
    };
    this.records.push(record);
    try {
      this.onRecord?.(record);
    } catch {
      // Observability must not change execution outcome.
    }
  }

  private preflightFailure(
    declaration: ImplementationDeclaration,
    started: number,
    code: LirErrorCode,
    message: string,
  ): LirInvocationFailure {
    return {
      implementationId: declaration.id,
      language: declaration.language,
      adapter: 'registry',
      stdout: '',
      stderr: '',
      durationMs: Date.now() - started,
      exitCode: null,
      timedOut: false,
      aborted: false,
      outputTruncated: false,
      ok: false,
      error: { code, message },
    };
  }

  /**
   * Invoke a declared implementation.
   *
   * Preconditions are checked in a deterministic order: policy, path,
   * existence, input serialization, runtime probe. The method returns a
   * normalized failure instead of throwing for those conditions.
   */
  async invoke(
    declaration: ImplementationDeclaration,
    input: unknown,
    options: LirInvokeOptions = {},
  ): Promise<LirInvocationResult> {
    const started = Date.now();

    const finish = (result: LirInvocationResult): LirInvocationResult => {
      this.record(declaration, result.adapter, result);
      return result;
    };

    const policyError = this.checkPolicy(declaration);
    if (policyError) {
      return finish(this.preflightFailure(declaration, started, policyError.code, policyError.message));
    }

    let resolved: ResolvedImplementation;
    try {
      resolved = await this.prepare(declaration);
    } catch (error) {
      const code = isLirError(error) ? error.code : 'LIR_INVOKE_FAILED';
      return finish(this.preflightFailure(
        declaration,
        started,
        code,
        errorMessage(error),
      ));
    }

    let inputText: string;
    try {
      assertJsonValue(input);
      inputText = JSON.stringify(input);
    } catch (error) {
      const code = isLirError(error) ? error.code : 'LIR_INPUT_INVALID';
      return finish(this.preflightFailure(declaration, started, code, errorMessage(error)));
    }

    const adapter = this.getAdapter(declaration.language);
    if (!adapter) {
      return finish(this.preflightFailure(
        declaration,
        started,
        'LIR_ADAPTER_MISSING',
        `No adapter registered for language "${declaration.language}"`,
      ));
    }

    const probe = await adapter.probe({ cwd: resolved.cwd, env: this.sourceEnv });
    if (!probe.available) {
      return finish(this.preflightFailure(
        declaration,
        started,
        'LIR_RUNTIME_MISSING',
        probe.reason ?? `${adapter.name} is not available`,
      ));
    }

    const requested = options.timeoutMs ?? declaration.timeoutMs ?? this.policy.defaultTimeoutMs;
    const timeoutMs = Math.min(
      Math.max(1, Number.isFinite(requested) ? requested : this.policy.defaultTimeoutMs),
      this.policy.maxTimeoutMs,
    );

    const result = await adapter.invoke({
      implementation: resolved,
      input: input as JsonValue,
      inputText,
      timeoutMs,
      cwd: resolved.cwd,
      env: this.childEnvironment(declaration, options.env),
      maxOutputBytes: this.policy.maxOutputBytes,
      signal: options.signal,
    });

    return finish(result);
  }
}

export interface CreateDefaultLirRegistryOptions extends LirRegistryOptions {
  python?: PythonAdapterOptions;
  node?: NodeAdapterOptions;
}

/** Registry with the first-party Python and Node adapters registered. */
export function createDefaultLirRegistry(
  options: CreateDefaultLirRegistryOptions,
): LirRegistry {
  const { python, node, ...registryOptions } = options;
  return new LirRegistry(registryOptions)
    .register(new PythonLirAdapter(python))
    .register(new NodeLirAdapter(node));
}
