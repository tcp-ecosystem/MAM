/**
 * retrieval.ts
 *
 * The `ParamValidator` — the heart of the Validation layer.
 *
 * Given a tool's declared parameter list and a caller's actual invocation
 * input, this module decides whether the call is acceptable. For every
 * parameter it performs, in order:
 *
 *   1. **Required check** — a missing value for a required parameter raises a
 *      `'missing'` issue.
 *   2. **Default application** — a missing value for an optional parameter
 *      with a `default` resolves to that default (which is itself validated
 *      against the type and enum constraints).
 *   3. **Type check** — a present value must match the declared type; a
 *      mismatch raises a `'type'` issue.
 *   4. **Coercion** — when enabled, values of the wrong type are coerced
 *      (string ↔ number ↔ boolean, plus JSON strings for array/object) before
 *      the type check fails. Successful coercions are recorded on the result
 *      via `coerced` so callers can use the resolved values.
 *   5. **Enum check** — when the parameter declares an `enum` and enum
 *      validation is enabled, the value must be a member.
 *   6. **Unknown check** — when strict mode is on, input keys that are not
 *      declared on the schema raise an `'unknown'` issue.
 *
 * The module also validates *definitions* (`validateDefinition`): structural
 * checks that a {@link ToolDefinition} is well-formed (name / description /
 * handler present, unique parameter names, valid parameter types).
 *
 * Everything here is a pure, deterministic function of its inputs — the
 * validator carries no mutable state, so it is safe to share across
 * concurrent callers and easy to unit test in isolation. Lifecycle state
 * (counters, events, timers) lives in `lifecycle.ts`.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type ToolDefinition,
  type ToolParameter,
  type TypeName,
  type ValidateOptions,
  type ValidationConfig,
  type ValidationIssue,
  type ValidationResult,
  DEFAULT_VALIDATION_CONFIG,
  createValidationIssue,
  createValidationResult,
  isToolParameter,
  isTypeName,
  resolveValidateOptions,
  resolveValidationConfig,
} from './types.js';

/**
 * The result of a single coercion attempt.
 */
export interface CoercionResult {
  /** `true` when the value was successfully coerced. */
  ok: boolean;
  /** The coerced value, present when `ok` is `true`. */
  value?: unknown;
  /** A human readable explanation, present when `ok` is `false`. */
  reason?: string;
}

/**
 * Returns `true` when `value` already satisfies the given type, with no
 * coercion needed. Custom (non-built-in) type names are treated as opaque and
 * always match.
 *
 * @param value the value to test.
 * @param type the declared type name.
 */
export function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'any':
      return true;
    default:
      // Custom / unknown runtime type names: opaque, accept anything.
      return true;
  }
}

/**
 * Returns `true` when `value` is a member of `members`. Comparison uses `===`
 * semantics but is NaN-safe (`NaN` equals `NaN` here) so enum members that are
 * NaN-ish still work predictably.
 *
 * @param value the value to test.
 * @param members the allowed values.
 */
export function inEnum(value: unknown, members: unknown[]): boolean {
  return members.some(
    (member) =>
      member === value || (Number.isNaN(member as number) && Number.isNaN(value as number)),
  );
}

/**
 * Describes a runtime value in a compact, message-friendly way. Examples:
 * `null`, `array`, `string "8080"`, `number 42`, `number NaN`, `boolean`,
 * `object`, `function`, `undefined`.
 *
 * @param value the value to describe.
 */
export function describeType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const type = typeof value;
  if (type === 'string') {
    return `string ${JSON.stringify(value)}`;
  }
  if (type === 'number') {
    return Number.isNaN(value) ? 'number NaN' : `number ${value}`;
  }
  return type;
}

/**
 * Coerces a value into the requested type without mutating the input.
 *
 * Supported conversions:
 *
 *   - `'string'`  — numbers and booleans stringify (`42` → `"42"`).
 *   - `'number'`  — numeric strings (`"42"` → `42`, whitespace tolerated),
 *     booleans (`true` → `1`, `false` → `0`), finite numbers pass through.
 *   - `'integer'` — as `'number'`, but the result must be an integer.
 *   - `'boolean'` — strings `"true"` / `"false"` / `"1"` / `"0"` / `"yes"` /
 *     `"no"` / `"on"` / `"off"` (case-insensitive) and numbers `1` / `0`.
 *   - `'array'`   — arrays pass through; strings that parse as a JSON array
 *     are converted.
 *   - `'object'`  — objects pass through; strings that parse as a JSON object
 *     are converted.
 *   - `'any'`     — pass-through, always succeeds.
 *   - custom type — pass-through, always succeeds (opaque).
 *
 * @param value the value to coerce.
 * @param type the target type name.
 * @returns a {@link CoercionResult}; never throws.
 */
export function coerce(value: unknown, type: TypeName): CoercionResult {
  switch (type) {
    case 'string':
      if (typeof value === 'string') {
        return { ok: true, value };
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { ok: true, value: String(value) };
      }
      return {
        ok: false,
        reason: `cannot coerce ${describeType(value)} to string`,
      };

    case 'number': {
      if (typeof value === 'number') {
        return Number.isFinite(value)
          ? { ok: true, value }
          : { ok: false, reason: 'value is not a finite number' };
      }
      if (typeof value === 'boolean') {
        return { ok: true, value: value ? 1 : 0 };
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          return { ok: false, reason: 'empty string cannot be coerced to number' };
        }
        const parsed = Number(trimmed);
        if (Number.isNaN(parsed)) {
          return { ok: false, reason: `"${trimmed}" is not a numeric string` };
        }
        return { ok: true, value: parsed };
      }
      return {
        ok: false,
        reason: `cannot coerce ${describeType(value)} to number`,
      };
    }

    case 'integer': {
      const attempt = coerceNumber(value);
      if (!attempt.ok) {
        return attempt;
      }
      if (!Number.isInteger(attempt.value as number)) {
        return {
          ok: false,
          reason: `${describeType(attempt.value)} is not an integer`,
        };
      }
      return attempt;
    }

    case 'boolean':
      if (typeof value === 'boolean') {
        return { ok: true, value };
      }
      if (typeof value === 'number') {
        if (value === 1) {
          return { ok: true, value: true };
        }
        if (value === 0) {
          return { ok: true, value: false };
        }
        return { ok: false, reason: `number ${value} cannot be coerced to boolean` };
      }
      if (typeof value === 'string') {
        const lowered = value.trim().toLocaleLowerCase();
        if (lowered === 'true' || lowered === '1' || lowered === 'yes' || lowered === 'on') {
          return { ok: true, value: true };
        }
        if (lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off') {
          return { ok: true, value: false };
        }
        return { ok: false, reason: `"${value}" is not a boolean string` };
      }
      return {
        ok: false,
        reason: `cannot coerce ${describeType(value)} to boolean`,
      };

    case 'object': {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return { ok: true, value };
      }
      if (typeof value === 'string') {
        const parsed = parseJsonValue(value);
        if (parsed !== undefined && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return { ok: true, value: parsed };
        }
        return { ok: false, reason: `"${value}" does not parse to an object` };
      }
      return {
        ok: false,
        reason: `cannot coerce ${describeType(value)} to object`,
      };
    }

    case 'array': {
      if (Array.isArray(value)) {
        return { ok: true, value };
      }
      if (typeof value === 'string') {
        const parsed = parseJsonValue(value);
        if (Array.isArray(parsed)) {
          return { ok: true, value: parsed };
        }
        return { ok: false, reason: `"${value}" does not parse to an array` };
      }
      return {
        ok: false,
        reason: `cannot coerce ${describeType(value)} to array`,
      };
    }

    case 'any':
      return { ok: true, value };

    default:
      // Custom / unknown runtime type names: opaque, accept anything.
      return { ok: true, value };
  }
}

/**
 * Numeric coercion shared by the `'number'` and `'integer'` branches.
 */
function coerceNumber(value: unknown): CoercionResult {
  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, reason: 'value is not a finite number' };
  }
  if (typeof value === 'boolean') {
    return { ok: true, value: value ? 1 : 0 };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'empty string cannot be coerced to number' };
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed)) {
      return { ok: false, reason: `"${trimmed}" is not a numeric string` };
    }
    return { ok: true, value: parsed };
  }
  return { ok: false, reason: `cannot coerce ${describeType(value)} to number` };
}

/**
 * Attempts to `JSON.parse` a string, returning `undefined` on any failure.
 * Used by the array/object coercion branches.
 */
function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Validates invocation parameters against a declared parameter list.
 *
 * The validator is stateless and pure: the same input always yields the same
 * result, and it never mutates `parameters` or `input`. When coercion and
 * default application produce resolved values, they are reported via
 * `result.coerced` so the caller can build the final argument object.
 *
 * @param parameters the declared parameter schema, in declaration order.
 * @param input the caller's raw input object.
 * @param options per-call overrides for this pass; omitted fields fall back to
 *   the resolved config.
 * @returns a {@link ValidationResult} describing the outcome.
 */
export function validateParams(
  parameters: ToolParameter[],
  input: Record<string, unknown>,
  config: Required<ValidationConfig>,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const coerced: Record<string, unknown> = {};
  let changed = false;

  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    issues.push(
      createValidationIssue(
        '',
        'custom',
        `input must be an object of parameter values, received ${describeType(input)}`,
        input,
      ),
    );
    return createValidationResult(issues);
  }

  for (const parameter of parameters) {
    const raw = input[parameter.name];
    const outcome = checkParameter(parameter, raw, config, issues);
    if (outcome.changed) {
      changed = true;
      coerced[parameter.name] = outcome.value;
    }
  }

  if (config.strict && !config.allowUnknown) {
    const declared = new Set(parameters.map((parameter) => parameter.name));
    for (const key of Object.keys(input)) {
      if (!declared.has(key)) {
        issues.push(
          createValidationIssue(
            key,
            'unknown',
            `undeclared parameter "${key}"`,
            input[key],
          ),
        );
      }
    }
  }

  return createValidationResult(issues, changed ? coerced : undefined);
}

/**
 * Performs the checks for a single parameter: missing, default, type, coercion
 * and enum. Returns the outcome for the caller to accumulate into `coerced`.
 */
function checkParameter(
  parameter: ToolParameter,
  raw: unknown,
  config: Required<ValidationConfig>,
  issues: ValidationIssue[],
): { changed: boolean; value: unknown } {
  const { name, type, required, default: defaultValue, enum: members } = parameter;

  /* --- missing / default -------------------------------------------- */
  if (raw === undefined) {
    if (required) {
      issues.push(
        createValidationIssue(name, 'missing', `required parameter "${name}" is missing`),
      );
      return { changed: false, value: undefined };
    }
    if (defaultValue !== undefined) {
      validateResolvedValue(name, defaultValue, type, members, config.validateEnums, issues, 'default');
      return { changed: true, value: defaultValue };
    }
    return { changed: false, value: undefined };
  }

  /* --- coercion ------------------------------------------------------ */
  let value = raw;
  let changed = false;
  if (config.coerce && !typeMatches(value, type)) {
    const attempt = coerce(value, type);
    if (attempt.ok) {
      value = attempt.value;
      changed = true;
    }
  }

  /* --- type ---------------------------------------------------------- */
  if (!typeMatches(value, type)) {
    issues.push(
      createValidationIssue(
        name,
        'type',
        `expected ${type}, received ${describeType(raw)}`,
        raw,
      ),
    );
    return { changed, value: raw };
  }

  /* --- enum ---------------------------------------------------------- */
  if (config.validateEnums && members !== undefined) {
    if (!inEnum(value, members)) {
      issues.push(
        createValidationIssue(
          name,
          'enum',
          `value ${JSON.stringify(value)} is not one of the allowed values for "${name}"`,
          raw,
        ),
      );
    }
  }

  return { changed, value: changed ? value : raw };
}

/**
 * Validates a value that was not supplied by the caller but resolved via a
 * default. Defaults are held to the same type and enum standards as real
 * input so a bad default is caught at validation time, not invocation time.
 */
function validateResolvedValue(
  name: string,
  value: unknown,
  type: TypeName,
  members: unknown[] | undefined,
  validateEnums: boolean,
  issues: ValidationIssue[],
  origin: 'default' | 'coerced',
): void {
  if (!typeMatches(value, type)) {
    issues.push(
      createValidationIssue(
        name,
        'type',
        `${origin} for "${name}" has type ${describeType(value)}, expected ${type}`,
        value,
      ),
    );
  } else if (validateEnums && members !== undefined && !inEnum(value, members)) {
    issues.push(
      createValidationIssue(
        name,
        'enum',
        `${origin} for "${name}" is not one of the allowed values`,
        value,
      ),
    );
  }
}

/**
 * The `ParamValidator` — the central validation engine of the Validation
 * layer.
 *
 * It is deliberately stateless: all validation logic is pure, so a single
 * validator instance can be shared across the store, index, lifecycle and any
 * number of concurrent callers. The only thing it holds is the resolved
 * configuration that governs coercion, strictness and enum enforcement.
 *
 * @example
 * const validator = new ParamValidator();
 * const result = validator.validateParams(
 *   [
 *     { name: 'url', type: 'string', required: true },
 *     { name: 'retries', type: 'integer', required: false, default: 3 },
 *   ],
 *   { url: 'https://example.com' },
 * );
 * result.valid;          // true
 * result.coerced;        // { retries: 3 } — default applied
 *
 * const bad = validator.validateParams(
 *   [{ name: 'retries', type: 'integer', required: true }],
 *   { retries: 'x' },
 * );
 * bad.valid;             // false
 * bad.issues[0].code;    // 'type'
 */
export class ParamValidator {
  /** The resolved configuration governing every pass. */
  private readonly config: Required<ValidationConfig>;

  /**
   * Creates a validator.
   *
   * @param config optional configuration overrides; missing fields fall back
   *   to {@link DEFAULT_VALIDATION_CONFIG}.
   */
  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = resolveValidationConfig(config);
  }

  /**
   * Returns the resolved configuration this validator uses. Handy for
   * introspection and for merging into downstream components.
   */
  getConfig(): Required<ValidationConfig> {
    return { ...this.config };
  }

  /**
   * Validates invocation parameters against a declared parameter list.
   *
   * See {@link validateParams} for the exact per-parameter algorithm.
   *
   * @param parameters the declared parameter schema.
   * @param input the caller's raw input object.
   * @param options per-call overrides; omitted fields fall back to config.
   * @returns a {@link ValidationResult}; never throws for ordinary input.
   */
  validateParams(
    parameters: ToolParameter[],
    input: Record<string, unknown>,
    options: ValidateOptions = {},
  ): ValidationResult {
    const effective = resolveValidateOptions(this.config, options);
    return validateParams(parameters, input, effective);
  }

  /**
   * Validates the invocation parameters of a full {@link ToolDefinition}.
   * Convenience wrapper that extracts `tool.parameters` before delegating.
   *
   * @param tool the tool whose schema should be applied.
   * @param input the caller's raw input object.
   * @param options per-call overrides.
   */
  validateParamsForTool(
    tool: ToolDefinition,
    input: Record<string, unknown>,
    options: ValidateOptions = {},
  ): ValidationResult {
    return this.validateParams(tool.parameters ?? [], input, options);
  }

  /**
   * Validates the invocation parameters against a stored schema object.
   * Convenience wrapper over {@link ParamValidator.validateParams}.
   *
   * @param schema the schema to apply.
   * @param input the caller's raw input object.
   * @param options per-call overrides.
   */
  validateSchema(
    schema: { name: string; parameters: ToolParameter[] },
    input: Record<string, unknown>,
    options: ValidateOptions = {},
  ): ValidationResult {
    return this.validateParams(schema.parameters, input, options);
  }

  /**
   * Validates a single value against a single parameter declaration. Useful
   * for ad-hoc, non-schema validation (e.g. validating a form field as the
   * user types).
   *
   * @param parameter the parameter declaration to apply.
   * @param value the raw value to validate.
   * @param options per-call overrides.
   * @returns a result scoped to this one parameter.
   */
  validateValue(
    parameter: ToolParameter,
    value: unknown,
    options: ValidateOptions = {},
  ): ValidationResult {
    return this.validateParams([parameter], { [parameter.name]: value }, options);
  }

  /**
   * Validates the structural shape of a {@link ToolDefinition}: name and
   * description present, handler callable, parameters an array of valid,
   * uniquely-named, well-typed parameters.
   *
   * @param definition the definition to inspect.
   * @returns a {@link ValidationResult}. The definition is acceptable only
   *   when `valid` is `true`.
   */
  validateDefinition(definition: ToolDefinition): ValidationResult {
    const issues: ValidationIssue[] = [];

    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
      issues.push(
        createValidationIssue(
          '',
          'type',
          `definition must be an object, received ${describeType(definition)}`,
          definition,
        ),
      );
      return createValidationResult(issues);
    }

    const record = definition as unknown as Record<string, unknown>;

    /* --- name ---------------------------------------------------------- */
    if (typeof record.name !== 'string' || record.name.length === 0) {
      issues.push(
        record.name === undefined || record.name === ''
          ? createValidationIssue('name', 'missing', 'a tool definition requires a non-empty string "name"')
          : createValidationIssue(
              'name',
              'type',
              `"name" must be a non-empty string, received ${describeType(record.name)}`,
              record.name,
            ),
      );
    }

    /* --- description --------------------------------------------------- */
    if (typeof record.description !== 'string') {
      issues.push(
        record.description === undefined
          ? createValidationIssue('description', 'missing', 'a tool definition requires a string "description"')
          : createValidationIssue(
              'description',
              'type',
              `"description" must be a string, received ${describeType(record.description)}`,
              record.description,
            ),
      );
    }

    /* --- handler ------------------------------------------------------- */
    if (typeof record.handler !== 'function') {
      issues.push(
        record.handler === undefined
          ? createValidationIssue('handler', 'missing', 'a tool definition requires a callable "handler"')
          : createValidationIssue(
              'handler',
              'type',
              `"handler" must be a function, received ${describeType(record.handler)}`,
              record.handler,
            ),
      );
    }

    /* --- parameters ---------------------------------------------------- */
    if (record.parameters === undefined) {
      // parameters are optional; an empty schema is acceptable.
    } else if (!Array.isArray(record.parameters)) {
      issues.push(
        createValidationIssue(
          'parameters',
          'type',
          `"parameters" must be an array, received ${describeType(record.parameters)}`,
          record.parameters,
        ),
      );
    } else {
      const seenNames = new Set<string>();
      record.parameters.forEach((parameter, index) => {
        const path = `parameters[${index}]`;
        if (!isToolParameter(parameter)) {
          issues.push(
            createValidationIssue(
              path,
              'type',
              `parameter #${index} is not a valid ToolParameter (needs name, type and required)`,
              parameter,
            ),
          );
          return;
        }
        if (!isTypeName(parameter.type)) {
          issues.push(
            createValidationIssue(
              `${path}.type`,
              'type',
              `type "${parameter.type}" is not a valid type name`,
              parameter.type,
            ),
          );
        }
        if (parameter.enum !== undefined && !Array.isArray(parameter.enum)) {
          issues.push(
            createValidationIssue(
              `${path}.enum`,
              'type',
              `enum for "${parameter.name}" must be an array`,
              parameter.enum,
            ),
          );
        }
        if (seenNames.has(parameter.name)) {
          issues.push(
            createValidationIssue(
              `${path}.name`,
              'custom',
              `duplicate parameter name "${parameter.name}"`,
              parameter.name,
            ),
          );
        }
        seenNames.add(parameter.name);
      });
    }

    return createValidationResult(issues);
  }

  /**
   * Returns the declaration for a named parameter, or `undefined`.
   *
   * @param parameters the parameter list to search.
   * @param name the parameter name to find.
   */
  findParam(parameters: ToolParameter[], name: string): ToolParameter | undefined {
    return parameters.find((parameter) => parameter.name === name);
  }

  /**
   * Returns the subset of parameters that are required.
   *
   * @param parameters the parameter list to filter.
   */
  requiredParams(parameters: ToolParameter[]): ToolParameter[] {
    return parameters.filter((parameter) => parameter.required);
  }

  /**
   * Returns the subset of parameters that are optional.
   *
   * @param parameters the parameter list to filter.
   */
  optionalParams(parameters: ToolParameter[]): ToolParameter[] {
    return parameters.filter((parameter) => !parameter.required);
  }

  /**
   * Returns the names of the parameters that are missing from `input`, i.e.
   * required parameters the caller did not supply.
   *
   * @param parameters the parameter list to check.
   * @param input the caller's input object.
   */
  missingParams(
    parameters: ToolParameter[],
    input: Record<string, unknown>,
  ): string[] {
    const missing: string[] = [];
    for (const parameter of parameters) {
      if (parameter.required && input[parameter.name] === undefined) {
        missing.push(parameter.name);
      }
    }
    return missing;
  }

  /**
   * Coerces a value into the declared type. See {@link coerce} for the exact
   * conversion rules.
   *
   * @param value the value to coerce.
   * @param type the target type name.
   * @returns a {@link CoercionResult}; never throws.
   */
  coerce(value: unknown, type: TypeName): CoercionResult {
    return coerce(value, type);
  }

  /**
   * Returns `true` when `value` matches `type` without coercion.
   *
   * @param value the value to test.
   * @param type the declared type name.
   */
  matches(value: unknown, type: string): boolean {
    return typeMatches(value, type);
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param config optional configuration overrides.
 * @returns a new {@link ParamValidator}.
 */
export default function createParamValidator(
  config?: Partial<ValidationConfig>,
): ParamValidator {
  return new ParamValidator(config);
}