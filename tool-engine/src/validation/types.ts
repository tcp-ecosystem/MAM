/**
 * types.ts
 *
 * Core type definitions, guards, factories and defaults for the Validation
 * layer of the standalone MAM Tool Engine.
 *
 * The Validation layer is the enforcement point of the MAM runtime tool
 * contract. Given a tool's *declared* parameter schema it decides whether a
 * caller's *actual* invocation parameters are acceptable: required parameters
 * are present, values have the right runtime type, enum constraints hold and,
 * optionally, values are coerced into the declared type (string ↔ number ↔
 * boolean and friends).
 *
 * The reference runtime model of a tool is:
 *
 *     ToolParameter { name, type, required, description?, default?, enum? }
 *
 * and a tool definition is:
 *
 *     ToolDefinition {
 *       name, description, parameters, handler,
 *       tags?, capabilities?, version?, metadata?
 *     }
 *
 * This module is the single source of truth for every shape that travels
 * through the layer: the schema registry (`store.ts`), the lookup index
 * (`index.ts`), the validator itself (`retrieval.ts`), the lifecycle manager
 * (`lifecycle.ts`) and the high-level facade (`integration.ts`).
 *
 * Every shape here is plain-data friendly so that `JSON.stringify` /
 * `JSON.parse` round-trips without surprises. Functions (handlers) are the
 * only exception and are typed opaquely.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events` is imported as a type only).
 */

import type { EventEmitter } from 'node:events';

/* -------------------------------------------------------------------------- *
 * Type names
 * -------------------------------------------------------------------------- */

/**
 * The set of well-known parameter type names understood by the Validation
 * layer.
 *
 * `'integer'` is a subtype of `'number'` that additionally requires the value
 * to be an integer. `'any'` accepts every value without inspection. Unknown
 * strings are still permitted (see the `(string & {})` union member) so that
 * exotic runtimes can attach custom type names; values under those names are
 * treated as opaque and always match unless the config forbids them.
 */
export type TypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'any'
  | (string & {});

/**
 * The canonical, ordered list of built-in type names. Order matters for
 * documentation and stable enumeration; it is the fallback ordering used by
 * index and stats code when reporting distinct types.
 */
export const KNOWN_TYPE_NAMES: readonly TypeName[] = Object.freeze([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
  'any',
] as TypeName[]);

/**
 * Returns `true` when `value` is one of the built-in {@link TypeName}s.
 *
 * @param value the value to test. Any string that is not a built-in name
 *   returns `false`, even though such names remain *legal* on a parameter.
 */
export function isKnownType(value: unknown): value is TypeName {
  return (
    typeof value === 'string' && (KNOWN_TYPE_NAMES as readonly string[]).includes(value)
  );
}

/* -------------------------------------------------------------------------- *
 * Parameter & definition model
 * -------------------------------------------------------------------------- */

/**
 * Describes a single declared input parameter of a tool.
 *
 * Parameters form the *schema* of a tool: what a caller must (or may) supply
 * in order to invoke it. The Validation layer uses this shape both to check
 * incoming invocation parameters and to describe tools in the registry.
 */
export interface ToolParameter {
  /**
   * The canonical parameter name. Names are case-sensitive and must be unique
   * within a tool's parameter list. Used as the path segment of any issue
   * raised against this parameter.
   */
  name: string;

  /**
   * The expected type of the value. See {@link TypeName}. A value that does
   * not match this type produces a `'type'` issue, unless coercion is enabled
   * and the value can be converted.
   */
  type: TypeName;

  /**
   * Whether the caller must always supply this parameter. A missing value for
   * a required parameter produces a `'missing'` issue.
   */
  required: boolean;

  /**
   * Free-form human description of the parameter. Used for documentation and
   * schema emission; never inspected during validation.
   */
  description?: string;

  /**
   * The value assumed when the parameter is omitted. Applied by the validator
   * before the type/enum checks, so defaults are validated like any other
   * value. Only meaningful when `required` is `false`.
   */
  default?: unknown;

  /**
   * An optional closed set of allowed values. When present (and enum
   * validation is enabled), the supplied value must strictly equal one of the
   * members. Members are compared with `===` semantics (NaN-safe).
   */
  enum?: unknown[];
}

/**
 * A fully formed tool definition in the MAM runtime model.
 *
 * The `handler` is intentionally opaque: the Validation layer inspects it only
 * to confirm it is a function — it never invokes it.
 */
export interface ToolDefinition {
  /** Unique, stable tool name, e.g. `"http.get"`. */
  name: string;

  /** Short human readable summary of what the tool does. */
  description: string;

  /** Declared input schema, in declaration order. */
  parameters: ToolParameter[];

  /**
   * The callable implementation. Typed opaquely here; runtimes that actually
   * execute tools narrow this to a concrete signature.
   */
  handler: (...args: never[]) => unknown;

  /** Optional free-form classification tags. */
  tags?: string[];

  /** Optional capability names the tool provides, e.g. `"filesystem.read"`. */
  capabilities?: string[];

  /** Optional semantic version string, e.g. `"1.2.0"`. */
  version?: string;

  /**
   * Arbitrary application metadata. Values should be JSON-serializable so
   * that `toJSON` / `fromJSON` round-trips preserve them.
   */
  metadata?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- *
 * Schema registry shape
 * -------------------------------------------------------------------------- */

/**
 * The unit of storage in the Validation layer: a named parameter list.
 *
 * A schema is what `validateParams` runs against. It is deliberately detached
 * from the full {@link ToolDefinition} so that schemas can be shipped to
 * remote or untrusted consumers, or registered for tools whose handler lives
 * elsewhere.
 */
export interface ValidationSchema {
  /** The canonical schema name, usually the tool name it describes. */
  name: string;

  /** The declared parameters, in declaration order. */
  parameters: ToolParameter[];
}

/* -------------------------------------------------------------------------- *
 * Issues & results
 * -------------------------------------------------------------------------- */

/**
 * The stable classification of a single validation problem. Consumers can
 * switch on this to react differently to, say, a missing required parameter
 * versus a value of the wrong type.
 */
export type ValidationIssueCode =
  /** A required parameter was not supplied. */
  | 'missing'
  /** A supplied value does not have the declared type (and could not be
      coerced). */
  | 'type'
  /** A supplied value is not one of the declared enum members. */
  | 'enum'
  /** An undeclared parameter was supplied while validation was strict. */
  | 'unknown'
  /** Any other structural or custom problem (definition checks, non-object
      input, unknown schema, ...). */
  | 'custom';

/**
 * A single validation problem, located at a parameter path.
 *
 * @example
 * const issue = {
 *   path: 'port',
 *   message: 'expected number, received string "8080"',
 *   code: 'type',
 *   value: '8080',
 * };
 */
export interface ValidationIssue {
  /**
   * Dot-separated path of the value that failed. Usually the parameter name;
   * the empty string denotes the top-level input object itself.
   */
  path: string;

  /** A human readable, action-oriented description of the problem. */
  message: string;

  /** The stable classification of the problem. See {@link ValidationIssueCode}. */
  code: ValidationIssueCode;

  /**
   * The offending value, when it is meaningful to expose it. Omitted when the
   * problem is about the *absence* of a value (e.g. a missing parameter).
   */
  value?: unknown;
}

/**
 * The outcome of a single validation pass.
 *
 * A result is either fully valid (zero issues) or carries one or more
 * {@link ValidationIssue}s. `errors` is a convenience projection of the issue
 * messages; `coerced` records every parameter whose final value differed from
 * the raw input (via default application or type coercion).
 */
export interface ValidationResult {
  /** `true` when there are zero issues — the input is acceptable. */
  valid: boolean;

  /** Every problem found, in detection order. */
  issues: ValidationIssue[];

  /** The issue messages, projected for logging and error reporting. */
  errors: string[];

  /**
   * Maps parameter name → resolved value for every parameter that was changed
   * during validation (default applied or coerced). Present only when at
   * least one parameter changed; a caller that wants the fully resolved input
   * should merge this over the raw input.
   */
  coerced?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- *
 * Configuration
 * -------------------------------------------------------------------------- */

/**
 * Tunables controlling how every validation pass behaves. All fields are
 * optional at the config level; missing fields fall back to the defaults in
 * {@link DEFAULT_VALIDATION_CONFIG}.
 */
export interface ValidationConfig {
  /**
   * Whether to attempt coercing values into the declared type. When `true`,
   * a string `"42"` validates as a `'number'` parameter (and lands in
   * `result.coerced`). Defaults to `true`.
   */
  coerce?: boolean;

  /**
   * Whether to treat undeclared parameters as errors. When `true`, any input
   * key that is not declared on the schema produces an `'unknown'` issue.
   * Defaults to `false`. Note that strict mode *implies* unknown parameters
   * are rejected unless `allowUnknown` is explicitly `true`.
   */
  strict?: boolean;

  /**
   * Whether undeclared parameters are tolerated. When `false`, undeclared
   * parameters are rejected — this only takes effect when `strict` is `true`.
   * Defaults to `true`.
   */
  allowUnknown?: boolean;

  /**
   * Whether parameters that declare an `enum` are constrained to its members.
   * When `false`, enum constraints are documented but never enforced.
   * Defaults to `true`.
   */
  validateEnums?: boolean;
}

/**
 * The default configuration applied by every Validation component unless the
 * caller overrides individual fields. Frozen so it can be shared freely.
 */
export const DEFAULT_VALIDATION_CONFIG: Readonly<ValidationConfig> =
  Object.freeze({
    coerce: true,
    strict: false,
    allowUnknown: true,
    validateEnums: true,
  } as ValidationConfig);

/**
 * Builds a concrete {@link ValidationConfig} by merging caller-provided values
 * over {@link DEFAULT_VALIDATION_CONFIG}.
 *
 * A semantic refinement is applied: when `strict` is `true` and `allowUnknown`
 * was not explicitly provided, `allowUnknown` is forced to `false` so that
 * strict mode does what it says by default.
 *
 * @param overrides optional partial config to merge over the defaults.
 * @returns a fully populated configuration object.
 */
export function resolveValidationConfig(
  overrides?: Partial<ValidationConfig>,
): Required<ValidationConfig> {
  const explicit = overrides ?? {};
  const base = { ...DEFAULT_VALIDATION_CONFIG, ...explicit };
  if (base.strict && explicit.allowUnknown === undefined) {
    base.allowUnknown = false;
  }
  return base as Required<ValidationConfig>;
}

/* -------------------------------------------------------------------------- *
 * Per-call options
 * -------------------------------------------------------------------------- */

/**
 * Per-call knobs for a single `validateParams` invocation. Mirrors
 * {@link ValidationConfig} but scoped to one call; a field left `undefined`
 * falls back to the resolved config, so callers can override selectively.
 */
export interface ValidateOptions {
  /** Override `config.coerce` for this call. */
  coerce?: boolean;

  /** Override `config.strict` for this call. */
  strict?: boolean;

  /** Override `config.allowUnknown` for this call. */
  allowUnknown?: boolean;

  /** Override `config.validateEnums` for this call. */
  validateEnums?: boolean;
}

/**
 * The default per-call options. All fields `undefined` so that resolution
 * falls through to the config in every case.
 */
export const DEFAULT_VALIDATE_OPTIONS: Readonly<ValidateOptions> =
  Object.freeze({
    coerce: undefined,
    strict: undefined,
    allowUnknown: undefined,
    validateEnums: undefined,
  } as ValidateOptions);

/**
 * Merges per-call options over a resolved config, producing the effective
 * settings for one validation pass.
 *
 * @param config the resolved base config.
 * @param options optional per-call overrides.
 * @returns the effective, fully populated settings.
 */
export function resolveValidateOptions(
  config: Required<ValidationConfig>,
  options: ValidateOptions = {},
): Required<ValidationConfig> {
  return {
    coerce: options.coerce ?? config.coerce,
    strict: options.strict ?? config.strict,
    allowUnknown:
      options.allowUnknown ??
      (options.strict === true ? false : config.allowUnknown),
    validateEnums: options.validateEnums ?? config.validateEnums,
  };
}

/* -------------------------------------------------------------------------- *
 * Stats
 * -------------------------------------------------------------------------- */

/**
 * A point-in-time snapshot of the Validation layer.
 *
 * Components fill the fields they own: the store and index populate the
 * schema / parameter / type counts, while the lifecycle fills the
 * validation counters and run state.
 */
export interface ValidationStats {
  /** Total number of registered schemas. */
  schemaCount: number;

  /** Total number of declared parameters across all schemas. */
  parameterCount: number;

  /** Number of distinct parameter types in use across all schemas. */
  typeCount: number;

  /** Total number of issues recorded since the counters were last reset. */
  issueCount: number;

  /** Total number of validation passes performed. */
  validatedCount: number;

  /** Number of validation passes that produced zero issues. */
  validCount: number;

  /** Number of validation passes that produced at least one issue. */
  invalidCount: number;

  /** Epoch ms of the most recent validation pass. `0` when none yet. */
  lastValidatedAt: number;

  /** Whether the lifecycle manager is currently running. */
  running: boolean;
}

/* -------------------------------------------------------------------------- *
 * Event payloads & emitter helpers
 * -------------------------------------------------------------------------- */

/**
 * Payload attached to every lifecycle event (`validated`, `invalid`,
 * `registered`, `removed`, `pruned`, `gced`).
 */
export interface ValidationEventPayload {
  /** The schema / tool name the event concerns. */
  name: string;

  /** The result of the validation pass that triggered the event, when any. */
  result?: ValidationResult;

  /** The current number of registered schemas. */
  schemaCount: number;

  /** The running total of valid passes. */
  validCount: number;

  /** The running total of invalid passes. */
  invalidCount: number;

  /** The running total of recorded issues. */
  issueCount: number;
}

/**
 * Structural type of the event emitter expected by lifecycle components.
 * Kept intentionally minimal so any EventEmitter-like object can be injected.
 */
export type ValidationEmitter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

/* -------------------------------------------------------------------------- *
 * Guards & predicates
 * -------------------------------------------------------------------------- */

/**
 * Returns `true` when `value` is a string that is usable as a parameter type
 * name (a non-empty string). This is deliberately looser than
 * {@link isKnownType} so custom runtime type names still pass.
 */
export function isTypeName(value: unknown): value is TypeName {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Returns `true` when `value` looks like a {@link ToolParameter}: an object
 * with a non-empty string `name`, a string `type` and a boolean `required`.
 */
export function isToolParameter(value: unknown): value is ToolParameter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    record.name.length > 0 &&
    typeof record.type === 'string' &&
    typeof record.required === 'boolean'
  );
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link ToolDefinition}.
 *
 * The guard is strict about `name`, `description`, `handler` and `parameters`
 * and lenient about the optional fields. `parameters` may be omitted (treated
 * as an empty schema) but when present every entry must be a valid
 * {@link ToolParameter}.
 *
 * @param value the value to test.
 */
export function isToolDefinition(value: unknown): value is ToolDefinition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    typeof record.description !== 'string' ||
    typeof record.handler !== 'function'
  ) {
    return false;
  }
  if (record.parameters !== undefined) {
    if (!Array.isArray(record.parameters)) {
      return false;
    }
    for (const parameter of record.parameters) {
      if (!isToolParameter(parameter)) {
        return false;
      }
    }
  }
  if (record.tags !== undefined && !isStringArray(record.tags)) {
    return false;
  }
  if (
    record.capabilities !== undefined &&
    !isStringArray(record.capabilities)
  ) {
    return false;
  }
  if (record.version !== undefined && typeof record.version !== 'string') {
    return false;
  }
  if (
    record.metadata !== undefined &&
    (typeof record.metadata !== 'object' || record.metadata === null)
  ) {
    return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a non-empty string array.
 */
export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === 'string')
  );
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link ValidationSchema}.
 */
export function isValidationSchema(value: unknown): value is ValidationSchema {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.name !== 'string' ||
    record.name.length === 0 ||
    !Array.isArray(record.parameters)
  ) {
    return false;
  }
  return record.parameters.every(isToolParameter);
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link ValidationIssue}.
 */
export function isValidationIssue(value: unknown): value is ValidationIssue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.path === 'string' &&
    typeof record.message === 'string' &&
    typeof record.code === 'string' &&
    (record.value === undefined || 'value' in record)
  );
}

/**
 * Returns `true` when `value` satisfies the shape of a {@link ValidationResult}.
 */
export function isValidationResult(value: unknown): value is ValidationResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.valid === 'boolean' &&
    Array.isArray(record.issues) &&
    record.issues.every(isValidationIssue) &&
    Array.isArray(record.errors)
  );
}

/**
 * Returns `true` when `value` looks like a partial {@link ValidationConfig}:
 * an object whose known keys are correctly typed.
 */
export function isValidationConfig(value: unknown): value is ValidationConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const optionalBooleans: ReadonlyArray<keyof ValidationConfig> = [
    'coerce',
    'strict',
    'allowUnknown',
    'validateEnums',
  ];
  return optionalBooleans.every(
    (key) => record[key] === undefined || typeof record[key] === 'boolean',
  );
}

/* -------------------------------------------------------------------------- *
 * Factories
 * -------------------------------------------------------------------------- */

/**
 * Creates a {@link ValidationIssue} with a canonical, consistent message when
 * none is supplied. The default message follows the pattern
 * `"{path}: {code}"` and is only a fallback — callers are encouraged to pass
 * an explicit, descriptive message.
 *
 * @param path the parameter path (empty string for the input object itself).
 * @param code the issue classification.
 * @param message optional human readable description.
 * @param value the offending value, when relevant.
 */
export function createValidationIssue(
  path: string,
  code: ValidationIssueCode,
  message?: string,
  value?: unknown,
): ValidationIssue {
  const issue: ValidationIssue = {
    path,
    code,
    message: message ?? (path.length === 0 ? code : `${path}: ${code}`),
  };
  if (value !== undefined || code === 'type' || code === 'enum') {
    issue.value = value;
  }
  return issue;
}

/**
 * Returns the empty, valid result — zero issues, zero errors. Useful as the
 * canonical "everything is fine" value and as a base for accumulators.
 */
export function emptyValidationResult(): ValidationResult {
  return { valid: true, issues: [], errors: [] };
}

/**
 * Creates a {@link ValidationResult} from a list of issues. `valid` and
 * `errors` are derived automatically so callers cannot build a contradictory
 * result.
 *
 * @param issues the issues found; empty means valid.
 * @param coerced optional record of coerced / defaulted values.
 */
export function createValidationResult(
  issues: ValidationIssue[],
  coerced?: Record<string, unknown>,
): ValidationResult {
  const result: ValidationResult = {
    valid: issues.length === 0,
    issues,
    errors: issues.map((issue) => issue.message),
  };
  if (coerced !== undefined && Object.keys(coerced).length > 0) {
    result.coerced = coerced;
  }
  return result;
}

/**
 * Convenience alias of {@link createValidationResult} for callers that always
 * pass a pre-built issue list.
 *
 * @param issues the issues to wrap; an empty array yields a valid result.
 */
export function validationResult(issues: ValidationIssue[]): ValidationResult {
  return createValidationResult(issues);
}

/**
 * Merges several results into one. The merged result is valid only when every
 * input is valid; issues are concatenated in order; the `coerced` records are
 * merged (later entries win for the same parameter name).
 *
 * @param results the results to merge. May be empty (yields a valid result).
 */
export function mergeValidationResults(
  ...results: ValidationResult[]
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const coerced: Record<string, unknown> = {};
  let hasCoerced = false;
  for (const result of results) {
    issues.push(...result.issues);
    if (result.coerced !== undefined) {
      hasCoerced = true;
      Object.assign(coerced, result.coerced);
    }
  }
  return createValidationResult(issues, hasCoerced ? coerced : undefined);
}

/**
 * Returns `true` when the result contains at least one issue with the given
 * code. Useful for decision logic such as "retry with coercion disabled when
 * only type issues were raised".
 *
 * @param result the result to inspect.
 * @param code the code to look for.
 */
export function hasIssueCode(
  result: ValidationResult,
  code: ValidationIssueCode,
): boolean {
  return result.issues.some((issue) => issue.code === code);
}

/**
 * Returns the codes present in a result, deduplicated and in first-seen
 * order. Useful for compact logging and telemetry.
 *
 * @param result the result to inspect.
 */
export function issueCodes(result: ValidationResult): ValidationIssueCode[] {
  const seen = new Set<ValidationIssueCode>();
  const codes: ValidationIssueCode[] = [];
  for (const issue of result.issues) {
    if (!seen.has(issue.code)) {
      seen.add(issue.code);
      codes.push(issue.code);
    }
  }
  return codes;
}

/* -------------------------------------------------------------------------- *
 * Normalisation helpers
 * -------------------------------------------------------------------------- */

/**
 * Deep-copies a parameter so registry entries are insulated from caller
 * mutation. The `enum` array and `default` (when an object/array) are copied.
 */
export function cloneToolParameter(parameter: ToolParameter): ToolParameter {
  const copy: ToolParameter = {
    name: parameter.name,
    type: parameter.type,
    required: parameter.required,
  };
  if (parameter.description !== undefined) {
    copy.description = parameter.description;
  }
  if (parameter.default !== undefined) {
    copy.default = cloneUnknown(parameter.default);
  }
  if (parameter.enum !== undefined) {
    copy.enum = parameter.enum.map(cloneUnknown);
  }
  return copy;
}

/**
 * Normalises a parameter list: drops non-parameter entries and guarantees
 * every kept entry satisfies the {@link ToolParameter} invariants. Missing
 * `required` is treated as `false`; unknown types are preserved verbatim.
 *
 * @param parameters the raw parameter list.
 * @param name the schema name, used only in error messages.
 * @throws {TypeError} when an entry is not a valid {@link ToolParameter}.
 */
export function normalizeParameters(
  parameters: ToolParameter[],
  name = '<schema>',
): ToolParameter[] {
  if (!Array.isArray(parameters)) {
    throw new TypeError(
      `normalizeParameters: parameters for "${name}" must be an array.`,
    );
  }
  return parameters.map((parameter, index) => {
    if (!isToolParameter(parameter)) {
      throw new TypeError(
        `normalizeParameters: parameter #${index} of "${name}" is not a ` +
          'valid ToolParameter (needs a string name, string type and boolean required).',
      );
    }
    return cloneToolParameter(parameter);
  });
}

/**
 * Recursively clones an arbitrary unknown value using `structuredClone` when
 * available, falling back to JSON round-tripping for plain data.
 *
 * @param value the value to clone.
 */
export function cloneUnknown(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const g = globalThis as { structuredClone?: (v: unknown) => unknown };
  if (typeof g.structuredClone === 'function') {
    return g.structuredClone(value);
  }
  if (Array.isArray(value)) {
    return value.map(cloneUnknown);
  }
  const record: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    record[key] = cloneUnknown(entry);
  }
  return record;
}