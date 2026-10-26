/**
 * MAM Language Interoperability Runtime (LIR) — public contract.
 *
 * LIR is deliberately small: MAM remains the system-description and
 * orchestration layer, while host-language adapters invoke independently
 * authored implementations through a JSON-in / JSON-out boundary.
 *
 * The contract is process-oriented and language-neutral. It does not assume
 * that Python objects or JavaScript objects can cross the boundary; only
 * JSON-compatible values can.
 */

/** JSON values allowed across the LIR boundary. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Languages with a first-party adapter in this package. */
export type LirLanguage = 'python' | 'javascript' | 'typescript';

export const SUPPORTED_LIR_LANGUAGES: readonly LirLanguage[] = [
  'python',
  'javascript',
  'typescript',
];

/**
 * A declaration read from a module's frontmatter.
 *
 * Paths are always project-relative. Absolute paths and paths that escape the
 * project root are rejected by the registry.
 */
export interface ImplementationDeclaration {
  /** Stable identifier used by orchestration and `inputFrom`. */
  id: string;
  /** Host language that executes the implementation. */
  language: LirLanguage;
  /** Project-relative path to the implementation entry file. */
  entry: string;
  /** Exported callable. Defaults to `main` for Python and `default` for JS/TS. */
  export?: string;
  /** Optional human-readable description. */
  description?: string;
  /**
   * Optional id of a previously invoked implementation. When present the
   * callable receives `{ inputs, upstream }` instead of the bare system inputs.
   */
  inputFrom?: string;
  /** Extra permissions requested by the implementation. */
  permissions?: string[];
  /** Environment variable names this implementation may read. */
  env?: string[];
  /** Per-implementation timeout. The registry clamps it to its policy. */
  timeoutMs?: number;
}

/**
 * A declaration with every path resolved and validated by the registry.
 */
export interface ResolvedImplementation extends ImplementationDeclaration {
  /** Absolute path to the implementation entry. */
  entry: string;
  /** Absolute project root used to resolve the entry. */
  projectRoot: string;
  /** Absolute working directory used for the child process. */
  cwd: string;
  /** Absolute path of the `.mam` file that declared the implementation. */
  manifestPath?: string;
}

export interface LirProbeOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LirProbeResult {
  /** Adapter name, for example `python` or `node`. */
  adapter: string;
  /** Languages this adapter can execute. */
  languages: LirLanguage[];
  available: boolean;
  /** Runtime version, when it could be detected. */
  version?: string;
  /** Command used, when applicable. */
  command?: string;
  /** Actionable reason when `available` is false. */
  reason?: string;
  /** Whether TypeScript type stripping is available (Node adapter only). */
  typescript?: boolean;
}

export interface LirInvocationRequest {
  implementation: ResolvedImplementation;
  /** Already validated, JSON-compatible input value. */
  input: JsonValue;
  /** Serialized input; adapters must not re-serialize it. */
  inputText: string;
  timeoutMs: number;
  cwd: string;
  env: NodeJS.ProcessEnv;
  maxOutputBytes: number;
  signal?: AbortSignal;
}

export type LirErrorCode =
  | 'LIR_DECLARATION_INVALID'
  | 'LIR_ADAPTER_MISSING'
  | 'LIR_LANGUAGE_NOT_ALLOWED'
  | 'LIR_IMPLEMENTATION_NOT_ALLOWED'
  | 'LIR_PERMISSION_DENIED'
  | 'LIR_ENTRY_MISSING'
  | 'LIR_ENTRY_NOT_FILE'
  | 'LIR_PATH_ESCAPE'
  | 'LIR_RUNTIME_MISSING'
  | 'LIR_INPUT_INVALID'
  | 'LIR_TIMEOUT'
  | 'LIR_ABORTED'
  | 'LIR_OUTPUT_LIMIT'
  | 'LIR_EXIT'
  | 'LIR_PROTOCOL'
  | 'LIR_RESULT_INVALID'
  | 'LIR_INVOKE_FAILED';

export interface LirFailure {
  code: LirErrorCode;
  message: string;
  details?: JsonValue;
}

/**
 * Normalized result of a host-language invocation.
 *
 * `stdout` and `stderr` always contain the implementation's own output with
 * the LIR protocol line removed. Execution failures never masquerade as
 * success: `ok` is false and `error` is populated.
 */
export interface LirInvocationResultBase {
  implementationId: string;
  language: LirLanguage;
  adapter: string;
  command?: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  /** Implementation stdout/stderr exceeded the configured cap. */
  outputTruncated: boolean;
}

export interface LirInvocationSuccess extends LirInvocationResultBase {
  ok: true;
  value: JsonValue;
}

export interface LirInvocationFailure extends LirInvocationResultBase {
  ok: false;
  error: LirFailure;
}

export type LirInvocationResult = LirInvocationSuccess | LirInvocationFailure;

export interface LirAdapter {
  readonly name: string;
  readonly languages: readonly LirLanguage[];
  probe(options?: LirProbeOptions): Promise<LirProbeResult>;
  invoke(request: LirInvocationRequest): Promise<LirInvocationResult>;
}

/** Auditable record kept for every invocation. */
export interface LirInvocationRecord {
  timestamp: string;
  implementationId: string;
  language: LirLanguage;
  entry: string;
  adapter: string;
  ok: boolean;
  code?: LirErrorCode;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
}

export interface LirPolicy {
  /** Languages that may be invoked. Defaults to all built-in adapters. */
  allowedLanguages: LirLanguage[];
  /** Optional id allowlist. Empty means all ids. */
  allowedImplementations: string[];
  /** Permissions granted to implementations. */
  grantedPermissions: string[];
  /** Environment variable names copied into child processes. */
  allowEnvironment: string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  maxOutputBytes: number;
}

export interface LirRegistryOptions {
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Policy overrides applied on top of LIR's safe defaults. */
  policy?: Partial<LirPolicy>;
  /** Source environment; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Absolute path of the declaring `.mam` file, used for audit records. */
  manifestPath?: string;
  /** Optional callback invoked for each auditable record. */
  onRecord?: (record: LirInvocationRecord) => void;
}

export interface LirInvokeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra environment values, already filtered by the registry policy. */
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_LIR_POLICY: LirPolicy = {
  allowedLanguages: [...SUPPORTED_LIR_LANGUAGES],
  allowedImplementations: [],
  grantedPermissions: ['process:spawn'],
  allowEnvironment: [
    'PATH',
    'Path',
    'PATHEXT',
    'SYSTEMROOT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'LANG',
    'LC_ALL',
    'TZ',
  ],
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  maxOutputBytes: 1_048_576,
};
