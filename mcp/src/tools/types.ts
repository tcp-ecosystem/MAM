/**
 * types.ts
 *
 * Shared type definitions, constants, guards, factories and defaults for the
 * MAM MCP **Tools** layer.
 *
 * The Tools layer is the part of a standalone MCP (Model Context Protocol)
 * package that manages the three *discoverable* primitives a server exposes to
 * clients:
 *
 *   - **tools**    — callable functions the model may invoke (`tools/list`,
 *                    `tools/call`). Each tool carries a JSON Schema document
 *                    that describes its input arguments.
 *   - **resources** — addressable data blobs the client can read
 *                    (`resources/list`, `resources/read`). Each resource is
 *                    identified by a URI and described by a name/MIME type.
 *   - **prompts**   — parameterised prompt templates the client can render
 *                    (`prompts/list`, `prompts/get`). Each prompt declares a
 *                    list of typed argument slots.
 *
 * Every object that crosses the boundary between the registry, the index, the
 * schema converter and the lifecycle is either one of the `Mcp*` shapes below
 * or a plain configuration/statistics object. This module is the single source
 * of truth for those shapes, and it is deliberately dependency-free so that
 * every other layer in the package (store, index, retrieval, lifecycle) can
 * import it without creating cycles or pulling in external packages.
 *
 * The second half of the file provides the runtime safety net: structural
 * guards that reduce untrusted `unknown` values (from `toJSON` snapshots,
 * transport payloads or plugin-provided definitions) to fully typed objects,
 * plus factory functions and default constants so that callers never construct
 * partial or malformed records by hand.
 *
 * @module tools/types
 */

/**
 * The three kinds of registrable MCP primitives, in a stable order. Used to
 * bucket registries, indexes, statistics and lifecycle bookkeeping cheaply.
 */
export const TOOL_KINDS = ['tool', 'resource', 'prompt'] as const;

/**
 * The kind of a registrable MCP primitive.
 */
export type ToolKind = (typeof TOOL_KINDS)[number];

/**
 * Guard: is `value` one of the three {@link ToolKind} values?
 *
 * @param value - the untrusted value to inspect.
 * @returns `true` when `value` is `'tool'`, `'resource'` or `'prompt'`.
 */
export function isToolKind(value: unknown): value is ToolKind {
  return typeof value === 'string' && (TOOL_KINDS as readonly string[]).indexOf(value) !== -1;
}

/**
 * The JSON Schema primitive type names understood by the schema converter.
 *
 * `integer` is accepted as a refinement of `number`; `null` is rarely used but
 * kept for completeness. `any` deliberately has NO JSON Schema equivalent — the
 * converter maps it to "no `type` keyword", i.e. an open schema.
 */
export type JsonSchemaType =
  | 'null'
  | 'boolean'
  | 'object'
  | 'array'
  | 'number'
  | 'string'
  | 'integer';

/**
 * Every valid {@link JsonSchemaType} value in a stable order.
 */
export const JSON_SCHEMA_TYPES: readonly JsonSchemaType[] = [
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'string',
  'integer',
] as const;

/**
 * Guard: is `value` a valid {@link JsonSchemaType}?
 *
 * @param value - the untrusted value to inspect.
 * @returns `true` when `value` names a JSON Schema primitive type.
 */
export function isJsonSchemaType(value: unknown): value is JsonSchemaType {
  return (
    typeof value === 'string' &&
    (JSON_SCHEMA_TYPES as readonly string[]).indexOf(value) !== -1
  );
}

/**
 * A loose JSON Schema document (draft-07 subset) used by MCP `tools/*`.
 *
 * The shape is deliberately "typed at the top, open below": the commonly used
 * keywords (`type`, `properties`, `required`, `items`, `enum`, `const`,
 * `default`, `description`, `title`, `additionalProperties`) are declared with
 * sensible TypeScript types, while the `[key: string]: unknown` index signature
 * keeps the door open for any other valid JSON Schema keyword (examples, `$defs`,
 * `minLength`, `format`, ...) without forcing a schema-library dependency.
 *
 * Tools that need to inspect a schema produced by an external tool should
 * validate it first with {@link isJsonSchema}.
 */
export interface JsonSchema {
  /** The JSON Schema type (or a union of types). `any` is represented by absence. */
  readonly type?: JsonSchemaType | readonly JsonSchemaType[];
  /** Object keyword: name -> property schema. */
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  /** Object keyword: names of properties that must be present. */
  readonly required?: readonly string[];
  /** Array keyword: the element schema (or a tuple of element schemas). */
  readonly items?: JsonSchema | readonly JsonSchema[];
  /** Enumeration of the only acceptable values. */
  readonly enum?: readonly unknown[];
  /** Const keyword: the single acceptable value. */
  readonly const?: unknown;
  /** The default value, used when the caller omits the argument. */
  readonly default?: unknown;
  /** Human-readable description of the value. */
  readonly description?: string;
  /** Short human-readable title. */
  readonly title?: string;
  /** Whether (or with which schema) additional object properties are allowed. */
  readonly additionalProperties?: boolean | JsonSchema;
  /** JSON Schema dialect identifier (e.g. `http://json-schema.org/draft-07/schema#`). */
  readonly $schema?: string;
  /** Any other valid JSON Schema keyword, kept as-is. */
  readonly [key: string]: unknown;
}

/**
 * Guard: reports whether `value` is a plain object that can safely be treated
 * as a {@link JsonSchema}.
 *
 * The check is deliberately shallow (no recursive validation of nested
 * properties): callers that need deep guarantees should walk the tree with the
 * {@link isJsonSchema} predicate, but for snapshot restoration and registry
 * ingestion a top-level plain-object check plus a well-typed `type` field is
 * sufficient in practice.
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` is a plain object usable as a JSON Schema.
 */
export function isJsonSchema(value: unknown): value is JsonSchema {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record['type'] !== undefined && !isJsonSchemaType(record['type'])) {
    if (
      !Array.isArray(record['type']) ||
      record['type'].some((entry) => !isJsonSchemaType(entry))
    ) {
      return false;
    }
  }
  if (record['properties'] !== undefined && !isPlainObject(record['properties'])) {
    return false;
  }
  if (record['required'] !== undefined && !Array.isArray(record['required'])) {
    return false;
  }
  return true;
}

/**
 * Semantic hints a server may attach to a tool to influence client UX. These
 * map directly to the `annotations` field of MCP's `tools/list` entries.
 */
export interface McpToolAnnotations {
  /** Short display title for the tool. */
  readonly title?: string;
  /** Whether the tool only reads state and never mutates anything. */
  readonly readOnlyHint?: boolean;
  /** Whether a successful call has irreversible side effects. */
  readonly destructiveHint?: boolean;
  /** Whether repeated calls with the same arguments are harmless / repeatable. */
  readonly idempotentHint?: boolean;
  /** Whether the tool may interact with the open world (network, FS, ...). */
  readonly openWorldHint?: boolean;
  /** Any extension metadata beyond the well-known hints. */
  readonly [key: string]: unknown;
}

/**
 * Guard: is `value` a structurally valid {@link McpToolAnnotations} object?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when every present hint is a boolean (or unknown extension).
 */
export function isMcpToolAnnotations(value: unknown): value is McpToolAnnotations {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record['title'] !== undefined && typeof record['title'] !== 'string') {
    return false;
  }
  for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
    if (record[hint] !== undefined && typeof record[hint] !== 'boolean') {
      return false;
    }
  }
  return true;
}

/**
 * A tool exposed by a MCP server.
 *
 * Returned by `tools/list`, passed to `tools/call`. The `inputSchema` is the
 * JSON Schema document the client must satisfy when invoking the tool; MCP
 * clients use it both for argument validation and for describing the tool to a
 * model.
 */
export interface McpTool {
  /** Unique tool name, used to invoke it via `tools/call`. */
  readonly name: string;
  /** Human-readable description of what the tool does. */
  readonly description?: string;
  /** JSON Schema describing the tool's input arguments. */
  readonly inputSchema: JsonSchema;
  /** Optional semantic hints for client UX. */
  readonly annotations?: McpToolAnnotations;
}

/**
 * A resource exposed by a MCP server.
 *
 * Returned by `resources/list`, addressed by `resources/read`. The `uri` is the
 * stable, globally meaningful address of the resource (for example
 * `file:///notes/a.txt` or `mam://memory/<id>`).
 */
export interface McpResource {
  /** The resource's URI (e.g. `file:///notes/a.txt`). */
  readonly uri: string;
  /** Human-readable resource name. */
  readonly name: string;
  /** Optional description of the resource. */
  readonly description?: string;
  /** Optional MIME type of the resource body (e.g. `text/markdown`). */
  readonly mimeType?: string;
}

/**
 * The contents of a resource, returned by `resources/read`.
 *
 * Exactly one of `text` or `blob` should be set: text for UTF-8 bodies, blob
 * (base64-encoded) for binary bodies. MCP requires the `uri` to echo the
 * resource's address so clients can correlate content to its source.
 */
export interface McpResourceContents {
  /** The URI the content was read from. */
  readonly uri: string;
  /** Optional MIME type of the content. */
  readonly mimeType?: string;
  /** Textual content (set for text bodies). */
  readonly text?: string;
  /** Base64-encoded binary content (set for binary bodies). */
  readonly blob?: string;
}

/**
 * A single argument slot declared by a {@link McpPrompt}.
 */
export interface McpPromptArgument {
  /** Argument name (the key clients pass in the prompt's arguments object). */
  readonly name: string;
  /** Optional description of the argument. */
  readonly description?: string;
  /** Whether the argument must be supplied when rendering the prompt. */
  readonly required?: boolean;
}

/**
 * A prompt template exposed by a MCP server.
 *
 * Returned by `prompts/list`, rendered by `prompts/get`. Prompts are
 * parameterised: each declared argument slot is filled by the client before the
 * template is rendered into concrete messages.
 */
export interface McpPrompt {
  /** Unique prompt name, used to render it via `prompts/get`. */
  readonly name: string;
  /** Optional human-readable description of the prompt. */
  readonly description?: string;
  /** Optional declared argument slots. */
  readonly arguments?: readonly McpPromptArgument[];
}

/**
 * The union of every primitive that can be registered in a tools registry.
 * Used by {@link register / dispatch} style helpers that must handle any kind.
 */
export type McpRegistrable = McpTool | McpResource | McpPrompt;

/**
 * The canonical key of a registrable primitive.
 *
 * Tools and prompts are keyed by their **name**; resources are keyed by their
 * **URI**. This is the single rule that keeps the registry, the index and the
 * lifecycle in agreement about what "the same entry" means.
 *
 * @param kind - the kind of the primitive.
 * @param nameOrUri - the tool/prompt name or the resource URI.
 * @returns the canonical registry key.
 */
export function canonicalKey(kind: ToolKind, nameOrUri: string): string {
  switch (kind) {
    case 'tool':
    case 'prompt':
      return nameOrUri;
    case 'resource':
      return nameOrUri;
  }
}

/**
 * Convenience: canonical key for a tool.
 *
 * @param name - the tool name.
 * @returns the canonical registry key.
 */
export function toolKey(name: string): string {
  return name;
}

/**
 * Convenience: canonical key for a resource.
 *
 * @param uri - the resource URI.
 * @returns the canonical registry key.
 */
export function resourceKey(uri: string): string {
  return uri;
}

/**
 * Convenience: canonical key for a prompt.
 *
 * @param name - the prompt name.
 * @returns the canonical registry key.
 */
export function promptKey(name: string): string {
  return name;
}

/**
 * Compute the canonical key of an already-typed registrable primitive.
 *
 * @param value - the primitive.
 * @returns the canonical registry key.
 */
export function keyOf(value: McpRegistrable): string {
  if ('uri' in value) {
    return resourceKey(value.uri);
  }
  return value.name;
}

/**
 * Determine the {@link ToolKind} of an already-typed registrable primitive.
 *
 * @param value - the primitive.
 * @returns `'tool'`, `'resource'` or `'prompt'`.
 */
export function kindOf(value: McpRegistrable): ToolKind {
  if ('inputSchema' in value) {
    return 'tool';
  }
  if ('uri' in value) {
    return 'resource';
  }
  return 'prompt';
}

/**
 * Guard: is `value` a structurally valid {@link McpTool}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries a non-empty `name` and a valid schema.
 */
export function isMcpTool(value: unknown): value is McpTool {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    return false;
  }
  if (record['description'] !== undefined && typeof record['description'] !== 'string') {
    return false;
  }
  if (!isJsonSchema(record['inputSchema'])) {
    return false;
  }
  if (record['annotations'] !== undefined && !isMcpToolAnnotations(record['annotations'])) {
    return false;
  }
  return true;
}

/**
 * Guard: is `value` a structurally valid {@link McpResource}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries a non-empty `uri` and `name`.
 */
export function isMcpResource(value: unknown): value is McpResource {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['uri'] !== 'string' || record['uri'].length === 0) {
    return false;
  }
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    return false;
  }
  if (record['description'] !== undefined && typeof record['description'] !== 'string') {
    return false;
  }
  if (record['mimeType'] !== undefined && typeof record['mimeType'] !== 'string') {
    return false;
  }
  return true;
}

/**
 * Guard: is `value` a structurally valid {@link McpResourceContents}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries a non-empty `uri` and at least one of
 *   `text`/`blob` (both strings).
 */
export function isMcpResourceContents(value: unknown): value is McpResourceContents {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['uri'] !== 'string' || record['uri'].length === 0) {
    return false;
  }
  if (record['mimeType'] !== undefined && typeof record['mimeType'] !== 'string') {
    return false;
  }
  if (record['text'] !== undefined && typeof record['text'] !== 'string') {
    return false;
  }
  if (record['blob'] !== undefined && typeof record['blob'] !== 'string') {
    return false;
  }
  return record['text'] !== undefined || record['blob'] !== undefined;
}

/**
 * Guard: is `value` a structurally valid {@link McpPromptArgument}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries a non-empty `name`.
 */
export function isMcpPromptArgument(value: unknown): value is McpPromptArgument {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    return false;
  }
  if (record['description'] !== undefined && typeof record['description'] !== 'string') {
    return false;
  }
  if (record['required'] !== undefined && typeof record['required'] !== 'boolean') {
    return false;
  }
  return true;
}

/**
 * Guard: is `value` a structurally valid {@link McpPrompt}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries a non-empty `name` and, when present, a
 *   list of valid {@link McpPromptArgument} objects.
 */
export function isMcpPrompt(value: unknown): value is McpPrompt {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || record['name'].length === 0) {
    return false;
  }
  if (record['description'] !== undefined && typeof record['description'] !== 'string') {
    return false;
  }
  if (record['arguments'] !== undefined) {
    if (!Array.isArray(record['arguments'])) {
      return false;
    }
    for (const argument of record['arguments']) {
      if (!isMcpPromptArgument(argument)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Guard: is `value` any valid registrable MCP primitive?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` matches the tool, resource or prompt shape.
 */
export function isMcpRegistrable(value: unknown): value is McpRegistrable {
  return isMcpTool(value) || isMcpResource(value) || isMcpPrompt(value);
}

/**
 * Fully-resolved configuration for a tools registry/index/lifecycle stack.
 *
 * Construct instances with {@link createToolsConfig} so that every field is
 * guaranteed to be present; never spread the defaults object directly.
 */
export interface ToolsConfig {
  /** Whether registrations should be mirrored into a {@link ToolsIndex}. */
  readonly autoIndex: boolean;
  /** Whether `register*` calls should run schema validation eagerly. */
  readonly validateOnRegister: boolean;
  /** Retention cap for tools; the oldest registrations are pruned beyond this. */
  readonly maxTools: number;
  /** Retention cap for resources; the oldest registrations are pruned beyond this. */
  readonly maxResources: number;
  /** Retention cap for prompts; the oldest registrations are pruned beyond this. */
  readonly maxPrompts: number;
  /** Interval (ms) between periodic GC passes; `0` disables the timer. */
  readonly gcIntervalMs: number;
  /** Maximum age (ms) a registration may live before GC considers it stale. */
  readonly maxAgeMs: number;
}

/**
 * Immutable-by-convention default tools configuration. Never mutate this
 * object; copy it with {@link createToolsConfig} instead.
 */
export const DEFAULT_TOOLS_CONFIG: ToolsConfig = {
  autoIndex: true,
  validateOnRegister: true,
  maxTools: 0,
  maxResources: 0,
  maxPrompts: 0,
  gcIntervalMs: 30_000,
  maxAgeMs: 0,
} as const;

/**
 * Create a fully-populated {@link ToolsConfig} by merging a partial over the
 * defaults. The returned object is a fresh copy; the defaults are never
 * mutated.
 *
 * @param partial - optional overrides.
 * @returns a complete configuration object.
 */
export function createToolsConfig(partial: Partial<ToolsConfig> = {}): ToolsConfig {
  return { ...DEFAULT_TOOLS_CONFIG, ...partial };
}

/**
 * Guard: is `value` a structurally valid {@link ToolsConfig}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries the expected boolean/number fields.
 */
export function isToolsConfig(value: unknown): value is ToolsConfig {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  for (const field of ['maxTools', 'maxResources', 'maxPrompts', 'gcIntervalMs', 'maxAgeMs'] as const) {
    if (typeof record[field] !== 'number' || !Number.isFinite(record[field] as number)) {
      return false;
    }
  }
  return typeof record['autoIndex'] === 'boolean' && typeof record['validateOnRegister'] === 'boolean';
}

/**
 * Per-call options accepted by `register*`/`unregister*` methods.
 *
 * Construct instances with {@link createRegisterOptions} so callers can pass
 * partial objects (`{ overwrite: true }`) without spelling out every field.
 */
export interface RegisterOptions {
  /** Whether registering over an existing key replaces it (else it throws). */
  readonly overwrite: boolean;
  /** Whether to run schema validation before storing (else it is skipped). */
  readonly validate: boolean;
  /** Whether to index the entry after storing (when an index is attached). */
  readonly index: boolean;
}

/**
 * Immutable-by-convention default register options.
 */
export const DEFAULT_REGISTER_OPTIONS: RegisterOptions = {
  overwrite: false,
  validate: true,
  index: true,
} as const;

/**
 * Create a fully-populated {@link RegisterOptions} by merging a partial over
 * the defaults.
 *
 * @param partial - optional overrides.
 * @returns a complete options object.
 */
export function createRegisterOptions(partial: Partial<RegisterOptions> = {}): RegisterOptions {
  return { ...DEFAULT_REGISTER_OPTIONS, ...partial };
}

/**
 * Guard: is `value` a structurally valid {@link RegisterOptions}?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when `value` carries boolean fields.
 */
export function isRegisterOptions(value: unknown): value is RegisterOptions {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['overwrite'] === 'boolean' &&
    typeof record['validate'] === 'boolean' &&
    typeof record['index'] === 'boolean'
  );
}

/**
 * Aggregate statistics describing the current contents of a tools
 * registry/index/lifecycle stack.
 */
export interface ToolsStats {
  /** Number of registered tools. */
  readonly tools: number;
  /** Number of registered resources. */
  readonly resources: number;
  /** Number of registered prompts. */
  readonly prompts: number;
  /** Total number of registered primitives. */
  readonly total: number;
  /** Total number of registrations since construction (including overwrites). */
  readonly registered: number;
  /** Total number of unregistrations since construction. */
  readonly unregistered: number;
  /** Total number of primitives removed by pruning/GC. */
  readonly pruned: number;
  /** Total number of argument-validation runs. */
  readonly validated: number;
  /** Total number of argument-validation failures. */
  readonly validationFailures: number;
  /** Approximate serialized byte size of all registered primitives. */
  readonly approximateBytes: number;
  /** Epoch ms at which the tracking object was created. */
  readonly createdAt: number;
  /** Epoch ms of the most recent mutation, or `undefined` when untouched. */
  readonly lastUpdated?: number;
}

/**
 * Create a zeroed {@link ToolsStats} record stamped with the current time.
 *
 * @returns a fresh statistics snapshot.
 */
export function createToolsStats(): ToolsStats {
  return {
    tools: 0,
    resources: 0,
    prompts: 0,
    total: 0,
    registered: 0,
    unregistered: 0,
    pruned: 0,
    validated: 0,
    validationFailures: 0,
    approximateBytes: 0,
    createdAt: Date.now(),
  };
}

/**
 * Factory: build a well-formed {@link McpTool}.
 *
 * @param name - the unique tool name.
 * @param inputSchema - the JSON Schema describing the tool's arguments.
 * @param description - optional human-readable description.
 * @param annotations - optional semantic hints.
 * @returns a complete tool object.
 * @throws {@link TypeError} when `name` is empty or the schema is not a plain object.
 */
export function createTool(
  name: string,
  inputSchema: JsonSchema,
  description?: string,
  annotations?: McpToolAnnotations,
): McpTool {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('createTool: `name` must be a non-empty string');
  }
  if (!isPlainObject(inputSchema)) {
    throw new TypeError('createTool: `inputSchema` must be a plain object');
  }
  return {
    name,
    inputSchema,
    ...(description !== undefined ? { description } : {}),
    ...(annotations !== undefined ? { annotations } : {}),
  };
}

/**
 * Factory: build a well-formed {@link McpResource}.
 *
 * @param uri - the resource URI.
 * @param name - the human-readable resource name.
 * @param description - optional description.
 * @param mimeType - optional MIME type of the resource body.
 * @returns a complete resource object.
 * @throws {@link TypeError} when `uri` or `name` is empty.
 */
export function createResource(
  uri: string,
  name: string,
  description?: string,
  mimeType?: string,
): McpResource {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new TypeError('createResource: `uri` must be a non-empty string');
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('createResource: `name` must be a non-empty string');
  }
  return {
    uri,
    name,
    ...(description !== undefined ? { description } : {}),
    ...(mimeType !== undefined ? { mimeType } : {}),
  };
}

/**
 * Factory: build a well-formed {@link McpResourceContents}.
 *
 * Exactly one of `text` or `blob` should be provided; when both are provided
 * `text` wins and `blob` is dropped.
 *
 * @param uri - the URI the content was read from.
 * @param text - textual content.
 * @param mimeType - optional MIME type.
 * @param blob - base64-encoded binary content.
 * @returns a complete resource-contents object.
 * @throws {@link TypeError} when `uri` is empty or neither `text` nor `blob`
 *   is supplied.
 */
export function createResourceContents(
  uri: string,
  text?: string,
  mimeType?: string,
  blob?: string,
): McpResourceContents {
  if (typeof uri !== 'string' || uri.trim().length === 0) {
    throw new TypeError('createResourceContents: `uri` must be a non-empty string');
  }
  if (text === undefined && blob === undefined) {
    throw new TypeError('createResourceContents: provide either `text` or `blob`');
  }
  return {
    uri,
    ...(mimeType !== undefined ? { mimeType } : {}),
    ...(text !== undefined ? { text } : {}),
    ...(blob !== undefined ? { blob } : {}),
  };
}

/**
 * Factory: build a well-formed {@link McpPromptArgument}.
 *
 * @param name - the argument name.
 * @param description - optional description.
 * @param required - whether the argument must be supplied.
 * @returns a complete prompt-argument object.
 * @throws {@link TypeError} when `name` is empty.
 */
export function createPromptArgument(
  name: string,
  description?: string,
  required?: boolean,
): McpPromptArgument {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('createPromptArgument: `name` must be a non-empty string');
  }
  return {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(required !== undefined ? { required } : {}),
  };
}

/**
 * Factory: build a well-formed {@link McpPrompt}.
 *
 * @param name - the unique prompt name.
 * @param description - optional description.
 * @param arguments_ - optional declared argument slots.
 * @returns a complete prompt object.
 * @throws {@link TypeError} when `name` is empty.
 */
export function createPrompt(
  name: string,
  description?: string,
  arguments_?: readonly McpPromptArgument[],
): McpPrompt {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new TypeError('createPrompt: `name` must be a non-empty string');
  }
  return {
    name,
    ...(description !== undefined ? { description } : {}),
    ...(arguments_ !== undefined ? { arguments: arguments_ } : {}),
  };
}

/**
 * Factory: build a {@link JsonSchema} from a partial schema, defaulting missing
 * structural keywords to their neutral values (`type: 'object'` is NOT forced;
 * the schema stays exactly as supplied, only wrapped).
 *
 * @param partial - the schema keywords to keep.
 * @returns a complete {@link JsonSchema} object.
 */
export function createJsonSchema(partial: Partial<JsonSchema> = {}): JsonSchema {
  const schema: JsonSchema = {};
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) {
      (schema as Record<string, unknown>)[key] = value;
    }
  }
  return schema;
}

/**
 * Estimate the serialized byte size of a registrable primitive. Used for
 * coarse-grained memory accounting; exact JSON length is not guaranteed.
 *
 * @param value - the primitive to measure.
 * @returns an upper-bound byte estimate.
 */
export function estimateRegistrableBytes(value: McpRegistrable): number {
  let bytes = keyOf(value).length;
  if ('description' in value && value.description !== undefined) {
    bytes += value.description.length;
  }
  const serialized = JSON.stringify(value);
  if (serialized !== undefined) {
    bytes += serialized.length;
  }
  return bytes + 64;
}

/**
 * Guard: is `value` a plain object literal (prototype is `Object.prototype` or
 * `null`)? Every structural guard in this module is built on this primitive,
 * which deliberately rejects class instances, arrays and boxed primitives.
 *
 * @param value - the value to inspect.
 * @returns `true` when `value` is a plain object.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Validate a primitive name (tool name, prompt name, resource name). Names must
 * be non-empty strings and must not contain characters that would corrupt the
 * canonical-key space (whitespace-only names are rejected).
 *
 * @param value - the name to validate.
 * @returns `true` when `value` is a usable primitive name.
 */
export function isValidName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

/**
 * Validate a resource URI. The check is intentionally light (non-empty string,
 * contains a `:` scheme separator, no whitespace) — full RFC 3986 parsing is
 * out of scope for a registry that must accept custom schemes like `mam://`.
 *
 * @param value - the URI to validate.
 * @returns `true` when `value` looks like a usable resource URI.
 */
export function isValidUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  if (/\s/.test(value)) {
    return false;
  }
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}