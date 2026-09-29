/**
 * retrieval.ts
 *
 * `SchemaConverter`: the bridge between *declarative* MCP tool definitions and
 * the *wire* shapes MCP clients understand.
 *
 * MCP servers frequently describe their tools in a compact, engine-friendly
 * form — a flat list of parameter objects:
 *
 * ```ts
 * const parameters = [
 *   { name: 'message', type: 'string', required: true, description: 'text to echo' },
 *   { name: 'times',   type: 'number', default: 1, enum: [1, 2, 3] },
 * ];
 * ```
 *
 * The converter turns such lists into the JSON Schema `inputSchema` documents
 * that MCP requires for `tools/list` (`type: 'object'` + `properties` +
 * `required`), and provides the reverse direction too: {@link SchemaConverter.validateArgs}
 * validates a client-supplied argument object against a JSON Schema and returns
 * a structured list of issues (missing required fields, type mismatches, enum
 * violations, unknown properties) instead of throwing.
 *
 * Beyond tools, the module also derives {@link McpResource} and {@link McpPrompt}
 * records from their minimal inputs (`resourceFromUri`, `promptFromName`),
 * making it the single factory surface for the whole Tools layer.
 *
 * The converter is dependency-free (it imports only the shared `types.ts`) and
 * fully synchronous, so it can be used in hot request paths without worrying
 * about timers or I/O.
 *
 * @module tools/retrieval
 */

import {
  createPrompt,
  createPromptArgument,
  createResource,
  createTool,
  isJsonSchemaType,
  isPlainObject,
  type JsonSchema,
  type JsonSchemaType,
  type McpPrompt,
  type McpPromptArgument,
  type McpResource,
  type McpTool,
} from './types.js';

/**
 * The parameter type names accepted by {@link SchemaConverter.toJsonSchemaType}.
 *
 * `integer` is a supported alias of the JSON Schema integer type; `any` has no
 * JSON Schema equivalent and maps to an open (untyped) schema.
 */
export type ParameterTypeName =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any';

/**
 * Every accepted {@link ParameterTypeName} value, in a stable order.
 */
export const PARAMETER_TYPE_NAMES: readonly ParameterTypeName[] = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
  'any',
] as const;

/**
 * A single declarative tool parameter, as fed to
 * {@link SchemaConverter.toolFromDefinition}.
 */
export interface ToolParameter {
  /** The parameter name (becomes a key in `inputSchema.properties`). */
  readonly name: string;
  /** The parameter type name; `'any'` produces an open (untyped) property. */
  readonly type?: ParameterTypeName | string;
  /** Whether the parameter must be present when calling the tool. */
  readonly required?: boolean;
  /** The only acceptable values, when constrained. */
  readonly enum?: readonly unknown[];
  /** The default value used when the caller omits the parameter. */
  readonly default?: unknown;
  /** Human-readable description of the parameter. */
  readonly description?: string;
  /** Any additional JSON Schema keywords merged into the property schema. */
  readonly schema?: Readonly<Record<string, unknown>>;
}

/**
 * Options controlling {@link SchemaConverter.toolFromDefinition}.
 */
export interface ToolFromDefinitionOptions {
  /** Optional short display title merged into the tool's annotations. */
  readonly title?: string;
  /** Semantic hints attached to the produced tool. */
  readonly annotations?: McpTool['annotations'];
  /** Whether object parameters may carry undeclared keys (`false` is strict). */
  readonly additionalProperties?: boolean;
}

/**
 * Options controlling {@link SchemaConverter.resourceFromUri}.
 */
export interface ResourceFromUriOptions {
  /** Optional description of the resource. */
  readonly description?: string;
  /** Optional MIME type of the resource body. */
  readonly mimeType?: string;
}

/**
 * Options controlling {@link SchemaConverter.promptFromName}.
 */
export interface PromptFromNameOptions {
  /** Optional description of the prompt. */
  readonly description?: string;
  /** Optional declared argument slots. */
  readonly arguments?: readonly McpPromptArgument[];
  /** Convenience: declarative `{name, description?, required?}` argument list. */
  readonly argumentDefinitions?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

/**
 * The classification of a single validation issue.
 */
export type ValidationIssueCode =
  | 'missing' // a required field is absent
  | 'type' // the value does not match the declared JSON Schema type
  | 'enum' // the value is not one of the declared enum members
  | 'unknown' // the property is undeclared and additionalProperties is false
  | 'invalid'; // any other structural violation

/**
 * A single argument-validation issue produced by
 * {@link SchemaConverter.validateArgs}.
 */
export interface ValidationIssue {
  /** Dot-separated path of the offending value (e.g. `"user.age"`). */
  readonly path: string;
  /** The classification of the issue. */
  readonly code: ValidationIssueCode;
  /** Human-readable description of the failure. */
  readonly message: string;
  /** What was expected (e.g. the required type name). */
  readonly expected?: unknown;
  /** What was actually observed (the offending value). */
  readonly actual?: unknown;
}

/**
 * The full outcome of an argument-validation run.
 */
export interface ValidationResult {
  /** `true` when no issues were found. */
  readonly ok: boolean;
  /** Alias of `ok` for callers that prefer the longer name. */
  readonly valid: boolean;
  /** Every issue found, in evaluation order. */
  readonly issues: readonly ValidationIssue[];
  /** The number of issues found. */
  readonly count: number;
}

/**
 * Converts declarative tool/resource/prompt definitions into MCP wire shapes
 * and validates call arguments against JSON Schemas.
 *
 * Instances are stateless apart from an optional custom type-inference hook
 * (`options.typeOf`) used by {@link SchemaConverter.inferTypeOf}; a single
 * instance can be shared safely across the whole process.
 */
export class SchemaConverter {
  /** Optional custom runtime type-inference hook. */
  private readonly _typeOf: (value: unknown) => string;

  /**
   * Create a converter.
   *
   * @param options - optional configuration.
   */
  constructor(options: { readonly typeOf?: (value: unknown) => string } = {}) {
    this._typeOf = options.typeOf ?? defaultTypeOf;
  }

  /**
   * Map a declarative type name onto a JSON Schema type keyword.
   *
   * @param type - the type name (`'string' | 'number' | 'integer' | 'boolean' |
   *   'object' | 'array' | 'any'`, or any other string).
   * @returns the JSON Schema type keyword, or `undefined` when the name maps to
   *   "no type constraint" (`'any'` or an unknown name).
   */
  toJsonSchemaType(type: string): JsonSchemaType | undefined {
    switch (type) {
      case 'string':
        return 'string';
      case 'number':
        return 'number';
      case 'integer':
        return 'integer';
      case 'boolean':
        return 'boolean';
      case 'object':
        return 'object';
      case 'array':
        return 'array';
      case 'any':
        return undefined;
      default:
        return isJsonSchemaType(type) ? type : undefined;
    }
  }

  /**
   * Build a single JSON Schema property from a declarative parameter.
   *
   * @param parameter - the declarative parameter.
   * @returns the property schema, or `undefined` when the parameter name is
   *   empty (the caller should skip it).
   */
  buildProperty(parameter: ToolParameter): JsonSchema | undefined {
    if (parameter.name.trim().length === 0) {
      return undefined;
    }
    const type = parameter.type === undefined ? undefined : this.toJsonSchemaType(parameter.type);
    const property: JsonSchema = {
      ...(type !== undefined ? { type } : {}),
      ...(parameter.description !== undefined ? { description: parameter.description } : {}),
      ...(parameter.enum !== undefined ? { enum: parameter.enum } : {}),
      ...(parameter.default !== undefined ? { default: parameter.default } : {}),
      ...(parameter.schema !== undefined ? (parameter.schema as Record<string, unknown>) : {}),
    };
    return property;
  }

  /**
   * Build a complete JSON Schema object (`type: 'object'` + `properties` +
   * `required`) from a declarative parameter list.
   *
   * @param parameters - the declarative parameters.
   * @param additionalProperties - whether undeclared keys are allowed (defaults
   *   to `true`).
   * @returns a JSON Schema object.
   */
  schemaFromDefinitions(
    parameters: readonly ToolParameter[],
    additionalProperties = true,
  ): JsonSchema {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const parameter of parameters) {
      const property = this.buildProperty(parameter);
      if (property === undefined) {
        continue;
      }
      properties[parameter.name] = property;
      if (parameter.required === true) {
        required.push(parameter.name);
      }
    }
    const schema: JsonSchema = {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(additionalProperties === false ? { additionalProperties: false } : {}),
    };
    return schema;
  }

  /**
   * Convert a declarative tool definition into a full {@link McpTool} whose
   * `inputSchema` is derived from the parameter list.
   *
   * @param name - the unique tool name.
   * @param description - optional human-readable description.
   * @param parameters - the declarative parameter list.
   * @param options - optional conversion controls.
   * @returns a complete tool object.
   * @throws {@link TypeError} when `name` is empty.
   */
  toolFromDefinition(
    name: string,
    description?: string,
    parameters: readonly ToolParameter[] = [],
    options: ToolFromDefinitionOptions = {},
  ): McpTool {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('SchemaConverter: tool name must be a non-empty string');
    }
    const inputSchema = this.schemaFromDefinitions(
      parameters,
      options.additionalProperties ?? true,
    );
    const annotations = { ...(options.title !== undefined ? { title: options.title } : {}), ...options.annotations };
    return createTool(name, inputSchema, description, Object.keys(annotations).length > 0 ? annotations : undefined);
  }

  /**
   * Convert a minimal resource description into a full {@link McpResource}.
   *
   * @param uri - the resource URI.
   * @param name - the human-readable resource name.
   * @param options - optional description/MIME-type controls.
   * @returns a complete resource object.
   * @throws {@link TypeError} when `uri` or `name` is empty.
   */
  resourceFromUri(uri: string, name: string, options: ResourceFromUriOptions = {}): McpResource {
    return createResource(uri, name, options.description, options.mimeType);
  }

  /**
   * Convert a minimal prompt description into a full {@link McpPrompt}.
   *
   * @param name - the unique prompt name.
   * @param options - optional description/argument controls.
   * @returns a complete prompt object.
   * @throws {@link TypeError} when `name` is empty.
   */
  promptFromName(name: string, options: PromptFromNameOptions = {}): McpPrompt {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new TypeError('SchemaConverter: prompt name must be a non-empty string');
    }
    let arguments_: readonly McpPromptArgument[] | undefined = options.arguments;
    if (arguments_ === undefined && options.argumentDefinitions !== undefined) {
      arguments_ = options.argumentDefinitions.map((definition) =>
        createPromptArgument(definition.name, definition.description, definition.required),
      );
    }
    return createPrompt(name, options.description, arguments_);
  }

  /**
   * Infer the runtime type of a value as a {@link ParameterTypeName}-style
   * string. Uses the configured custom hook when present, otherwise the built-in
   * classifier.
   *
   * @param value - the value to classify.
   * @returns `'string'`, `'number'`, `'boolean'`, `'object'`, `'array'` or `'null'`.
   */
  inferTypeOf(value: unknown): string {
    return this._typeOf(value);
  }

  /**
   * Validate an argument object against a JSON Schema, returning a structured
   * list of issues. Never throws: malformed schemas are reported as `invalid`
   * issues rather than exceptions.
   *
   * Checks performed (recursively for object properties):
   *   - every name in `schema.required` must be present,
   *   - every present value must satisfy the declared `type`,
   *   - values constrained by `enum` must be members,
   *   - values constrained by `const` must be deep-equal,
   *   - when `additionalProperties === false`, undeclared keys are reported.
   *
   * @param schema - the JSON Schema to validate against.
   * @param args - the caller-supplied argument object.
   * @returns the list of validation issues (empty when the arguments are valid).
   */
  validateArgs(schema: JsonSchema, args: unknown): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (!isPlainObject(schema)) {
      return [{ path: '', code: 'invalid', message: 'input schema is not a plain object' }];
    }
    if (!isPlainObject(args)) {
      return [{ path: '', code: 'type', message: 'arguments must be an object', expected: 'object', actual: args }];
    }
    this._validateObject(schema, args, '', issues);
    return issues;
  }

  /**
   * Validate tool call arguments against the tool's own `inputSchema`.
   *
   * @param tool - the tool being called.
   * @param args - the caller-supplied argument object.
   * @returns a structured {@link ValidationResult}.
   */
  validateToolArgs(tool: McpTool, args: unknown): ValidationResult {
    const issues = this.validateArgs(tool.inputSchema, args);
    return toValidationResult(issues);
  }

  /**
   * Convenience: validate an argument object and report only whether it is
   * acceptable, skipping the issue list when the caller only needs a gate.
   *
   * @param schema - the JSON Schema to validate against.
   * @param args - the caller-supplied argument object.
   * @returns `true` when the arguments satisfy the schema.
   */
  accepts(schema: JsonSchema, args: unknown): boolean {
    return this.validateArgs(schema, args).length === 0;
  }

  /**
   * Internal recursive validator for an object-typed schema node.
   *
   * @param schema - the schema node.
   * @param value - the value to validate (must be a plain object).
   * @param path - the current dot-path prefix for issue reporting.
   * @param issues - the accumulator.
   */
  private _validateObject(schema: JsonSchema, value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
    const required = schema.required;
    if (required !== undefined) {
      if (!Array.isArray(required)) {
        issues.push({ path, code: 'invalid', message: 'schema.required must be an array' });
      } else {
        for (const name of required) {
          if (typeof name !== 'string') {
            issues.push({ path, code: 'invalid', message: 'schema.required entries must be strings' });
            continue;
          }
          if (!(name in value)) {
            issues.push({
              path: joinPath(path, name),
              code: 'missing',
              message: `missing required field "${name}"`,
              expected: name,
              actual: undefined,
            });
          }
        }
      }
    }

    const properties = schema.properties;
    if (properties !== undefined) {
      if (!isPlainObject(properties)) {
        issues.push({ path, code: 'invalid', message: 'schema.properties must be an object' });
      } else {
        for (const [name, propertySchema] of Object.entries(properties)) {
          if (!(name in value)) {
            continue;
          }
          const child = value[name];
          const childPath = joinPath(path, name);
          const typeIssues = this._checkValue(propertySchema, child, childPath);
          issues.push(...typeIssues);
          if (isPlainObject(child) && isPlainObject(propertySchema) && propertySchema['properties'] !== undefined) {
            this._validateObject(propertySchema as JsonSchema, child, childPath, issues);
          }
        }
      }
    }

    if (schema.additionalProperties === false) {
      const declared = new Set<string>();
      if (Array.isArray(required)) {
        for (const name of required) {
          if (typeof name === 'string') {
            declared.add(name);
          }
        }
      }
      if (isPlainObject(properties)) {
        for (const name of Object.keys(properties)) {
          declared.add(name);
        }
      }
      for (const name of Object.keys(value)) {
        if (!declared.has(name)) {
          issues.push({
            path: joinPath(path, name),
            code: 'unknown',
            message: `unknown property "${name}" (additionalProperties is false)`,
            actual: value[name],
          });
        }
      }
    }
  }

  /**
   * Internal helper: type/enum/const checks for a single value against a schema
   * node. Does not recurse into nested object properties (that is handled by
   * {@link SchemaConverter._validateObject}).
   *
   * @param schema - the schema node.
   * @param value - the value to check.
   * @param path - the dot-path prefix for issue reporting.
   * @returns matching issues (possibly none).
   */
  private _checkValue(schema: JsonSchema, value: unknown, path: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];
    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || !schema.enum.some((member) => deepEqual(member, value))) {
        issues.push({
          path,
          code: 'enum',
          message: `value is not one of the allowed enum members`,
          expected: schema.enum,
          actual: value,
        });
      }
    }
    if (schema.const !== undefined && !deepEqual(schema.const, value)) {
      issues.push({
        path,
        code: 'enum',
        message: 'value does not match the declared const',
        expected: schema.const,
        actual: value,
      });
    }
    const type = schema.type;
    if (type === undefined) {
      return issues;
    }
    const typeNames = Array.isArray(type) ? type : [type];
    const matches = typeNames.some((typeName) => this._matchesType(typeName, value));
    if (!matches) {
      issues.push({
        path,
        code: 'type',
        message: `expected type ${typeNames.join(' | ')}, got ${this.inferTypeOf(value)}`,
        expected: type,
        actual: value,
      });
    }
    return issues;
  }

  /**
   * Internal helper: does a value match a single JSON Schema type keyword?
   *
   * @param typeName - the type keyword.
   * @param value - the value to test.
   * @returns `true` when the value satisfies the type.
   */
  private _matchesType(typeName: JsonSchemaType, value: unknown): boolean {
    switch (typeName) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && Number.isFinite(value);
      case 'integer':
        return typeof value === 'number' && Number.isInteger(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'array':
        return Array.isArray(value);
      default:
        return true;
    }
  }
}

/**
 * Wrap an issue list into a complete {@link ValidationResult}.
 *
 * @param issues - the issues found (empty means valid).
 * @returns a structured validation result.
 */
export function toValidationResult(issues: readonly ValidationIssue[]): ValidationResult {
  const ok = issues.length === 0;
  return { ok, valid: ok, issues, count: issues.length };
}

/**
 * The built-in runtime type classifier. Mirrors `typeof` but distinguishes
 * `array` from `object` and names `null` explicitly.
 *
 * @param value - the value to classify.
 * @returns a {@link ParameterTypeName}-style name.
 */
export function defaultTypeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  const base = typeof value;
  return base === 'object' ? 'object' : base;
}

/**
 * Join a parent dot-path with a child key, producing `""` when both are empty.
 *
 * @param parent - the parent path (may be `""`).
 * @param child - the child key.
 * @returns the joined path.
 */
export function joinPath(parent: string, child: string): string {
  return parent.length === 0 ? child : `${parent}.${child}`;
}

/**
 * Deep structural equality for JSON-comparable values. Used for `enum`/`const`
 * checks; treats objects/arrays recursively and values of different types as
 * unequal (so `1 !== '1'`).
 *
 * @param a - the left operand.
 * @param b - the right operand.
 * @returns `true` when the values are deep-equal.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray !== bArray) {
    return false;
  }
  if (aArray && bArray) {
    const left = a as readonly unknown[];
    const right = b as readonly unknown[];
    if (left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  for (const key of aKeys) {
    if (!(key in (b as Record<string, unknown>))) {
      return false;
    }
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Convenience: build a single missing-field issue. Useful for callers that
 * post-process validation results.
 *
 * @param path - the dot-path of the missing field.
 * @param name - the field name.
 * @returns a {@link ValidationIssue}.
 */
export function missingFieldIssue(path: string, name: string): ValidationIssue {
  return { path, code: 'missing', message: `missing required field "${name}"`, expected: name };
}