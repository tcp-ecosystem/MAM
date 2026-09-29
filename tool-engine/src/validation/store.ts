/**
 * store.ts
 *
 * The `ValidationStore` — an in-memory, name-keyed registry of validation
 * schemas.
 *
 * A validation schema is the declared parameter list of a tool (a
 * {@link ValidationSchema}): what parameters exist, their types, whether they
 * are required, and any defaults or enum constraints. The store is the
 * authoritative write-side of the Validation layer. Every schema that is
 * registered lands here first, and the index (`index.ts`), validator
 * (`retrieval.ts`) and lifecycle (`lifecycle.ts`) components all derive their
 * views from it.
 *
 * Key design decisions:
 *
 *   - Schemas are keyed by their `name` (usually the tool name), which must be
 *     unique. Registering under an existing name replaces the previous schema
 *     atomically and returns it so callers can react.
 *   - Parameters are validated and deep-copied on insertion, so downstream
 *     consumers never observe caller mutations and never have to guard against
 *     malformed parameter entries.
 *   - The store exposes a `Map`-compatible surface (`has`, `get`, `keys`,
 *     `size`, `clear`) plus registry-specific operations (`putSchema`,
 *     `delete`, `list`, `names`, `register`, `stats`).
 *   - Snapshot support via `toJSON` / `fromJSON` lets callers persist the
 *     entire registry to disk and restore it on a later boot. Unlike tool
 *     registries, validation schemas contain no functions, so round-trips are
 *     lossless.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type ToolDefinition,
  type ToolParameter,
  type ValidationSchema,
  type ValidationStats,
  isValidationSchema,
  normalizeParameters,
} from './types.js';

/**
 * The serialisable, JSON-friendly representation of a {@link ValidationSchema}.
 * No functions are involved, so this is structurally identical to the live
 * shape — it exists to give `toJSON` / `fromJSON` a stable contract.
 */
export interface SerializedSchema {
  /** The schema name (tool name). */
  name: string;
  /** The declared parameters. */
  parameters: ToolParameter[];
}

/**
 * In-memory registry of validation schemas keyed by name.
 *
 * @example
 * const store = new ValidationStore();
 * store.putSchema('http.get', [
 *   { name: 'url', type: 'string', required: true },
 *   { name: 'timeoutMs', type: 'number', required: false, default: 5000 },
 * ]);
 * store.has('http.get');      // true
 * store.get('http.get');      // { name: 'http.get', parameters: [...] }
 * store.size;                 // 1
 * store.delete('http.get');   // removes and returns the schema
 */
export class ValidationStore {
  /**
   * The backing store. Schemas are inserted via
   * {@link ValidationStore.putSchema} so every entry is guaranteed to satisfy
   * the {@link ValidationSchema} invariants (valid, deep-copied parameters).
   */
  private readonly schemas: Map<string, ValidationSchema>;

  /**
   * Creates an empty store, optionally seeding it from pre-built schemas or a
   * full tool definition map.
   *
   * @param initial optional seed. Accepts an array / iterable of
   *   {@link ValidationSchema}s, a `Map` keyed by name, or a `Map` of
   *   {@link ToolDefinition}s (only their parameters are used).
   * @param validateSeed when `false`, seed entries are trusted and inserted
   *   without re-validation. Defaults to `true`. Pass `false` only for seed
   *   data that already passed through {@link ValidationStore.putSchema}.
   */
  constructor(
    initial?: Iterable<ValidationSchema> | Map<string, ValidationSchema> | Map<string, ToolDefinition>,
    validateSeed = true,
  ) {
    this.schemas = new Map();
    if (initial === undefined) {
      return;
    }
    if (initial instanceof Map) {
      for (const [name, entry] of initial) {
        if (entry !== null && typeof entry === 'object' && 'handler' in entry) {
          this.putSchema(name, (entry as ToolDefinition).parameters ?? []);
        } else if (validateSeed) {
          this.putSchema(name, (entry as ValidationSchema).parameters);
        } else {
          this.setValidated(
            (entry as ValidationSchema).name,
            (entry as ValidationSchema).parameters,
          );
        }
      }
      return;
    }
    for (const schema of initial) {
      this.putSchema(schema.name, schema.parameters);
    }
  }

  /* ------------------------------------------------------------------ *
   * Map-compatible surface
   * ------------------------------------------------------------------ */

  /**
   * Returns the number of registered schemas.
   */
  get size(): number {
    return this.schemas.size;
  }

  /**
   * Returns `true` when a schema with the given name is registered.
   *
   * @param name the schema name to probe.
   */
  has(name: string): boolean {
    return this.schemas.has(name);
  }

  /**
   * Returns the {@link ValidationSchema} for `name`, or `undefined` when
   * absent. The returned schema is a live reference; the parameters array is
   * the store's internal (already deep-copied) instance.
   *
   * @param name the schema name to look up.
   */
  get(name: string): ValidationSchema | undefined {
    return this.schemas.get(name);
  }

  /**
   * Returns the schema names in insertion order.
   */
  keys(): IterableIterator<string> {
    return this.schemas.keys();
  }

  /**
   * Removes every schema from the store.
   */
  clear(): void {
    this.schemas.clear();
  }

  /* ------------------------------------------------------------------ *
   * Registry operations
   * ------------------------------------------------------------------ */

  /**
   * Registers (or replaces) a schema under the given name.
   *
   * Parameters are validated and deep-copied before insertion. Registering an
   * existing name replaces the previous entry; the previous schema is returned
   * so callers can decide how to react.
   *
   * @param name the schema name (usually the tool name).
   * @param parameters the declared parameter list.
   * @returns the previously registered schema for the same name, or
   *   `undefined` when the name was not taken.
   * @throws {TypeError} when `name` is not a non-empty string or the parameter
   *   list contains an invalid entry.
   */
  putSchema(name: string, parameters: ToolParameter[]): ValidationSchema | undefined {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError(
        'ValidationStore.putSchema: a schema requires a non-empty string name.',
      );
    }
    const previous = this.schemas.get(name);
    this.schemas.set(name, {
      name,
      parameters: normalizeParameters(parameters, name),
    });
    return previous;
  }

  /**
   * Alias of {@link ValidationStore.putSchema} for callers that prefer the
   * shorter verb. Provided so the store reads naturally from both
   * `Map`-minded and domain-minded consumers.
   */
  put(name: string, parameters: ToolParameter[]): ValidationSchema | undefined {
    return this.putSchema(name, parameters);
  }

  /**
   * Convenience registration from a {@link ToolDefinition}: stores the tool's
   * declared parameters under its name. The handler is never inspected beyond
   * the name lookup, and the definition itself is not stored — only the
   * parameter schema.
   *
   * @param tool the tool whose parameters should be registered.
   * @returns the previously registered schema for the same name, or
   *   `undefined`.
   */
  register(tool: ToolDefinition): ValidationSchema | undefined {
    return this.putSchema(tool.name, tool.parameters ?? []);
  }

  /**
   * Returns the declared parameters of a schema, or `undefined` when the
   * schema is absent. The returned array is a copy — mutating it does not
   * affect the store.
   *
   * @param name the schema name to look up.
   */
  getParameters(name: string): ToolParameter[] | undefined {
    const schema = this.schemas.get(name);
    return schema === undefined ? undefined : schema.parameters.slice();
  }

  /**
   * Removes a schema by name.
   *
   * @param name the schema name to remove.
   * @returns the removed schema, or `undefined` when it was absent.
   */
  delete(name: string): ValidationSchema | undefined {
    const removed = this.schemas.get(name);
    if (removed !== undefined) {
      this.schemas.delete(name);
    }
    return removed;
  }

  /* ------------------------------------------------------------------ *
   * Query surface
   * ------------------------------------------------------------------ */

  /**
   * Returns a shallow copy of every registered schema as an array, in
   * insertion order. Each schema's parameter array is copied, so the returned
   * structures are safe to mutate.
   */
  list(): ValidationSchema[] {
    return Array.from(this.schemas.values(), (schema) => ({
      name: schema.name,
      parameters: schema.parameters.slice(),
    }));
  }

  /**
   * Returns every registered schema name as an array, in insertion order.
   */
  names(): string[] {
    return Array.from(this.schemas.keys());
  }

  /**
   * Returns the schema for `name` as a detached copy, or `undefined` when
   * absent. Prefer this over {@link ValidationStore.get} when the caller plans
   * to retain or mutate the result.
   *
   * @param name the schema name to look up.
   */
  getSchema(name: string): ValidationSchema | undefined {
    const schema = this.schemas.get(name);
    return schema === undefined
      ? undefined
      : { name: schema.name, parameters: schema.parameters.slice() };
  }

  /* ------------------------------------------------------------------ *
   * Stats & persistence
   * ------------------------------------------------------------------ */

  /**
   * Computes a {@link ValidationStats} snapshot from the current store
   * contents. The validation counters (`issueCount`, `validatedCount`, ...)
   * and `running` are filled with neutral values (`0` / `false`) — the
   * lifecycle component overrides them with its own state.
   */
  stats(): ValidationStats {
    const types = new Set<string>();
    let parameterCount = 0;
    for (const schema of this.schemas.values()) {
      parameterCount += schema.parameters.length;
      for (const parameter of schema.parameters) {
        types.add(parameter.type);
      }
    }
    return {
      schemaCount: this.schemas.size,
      parameterCount,
      typeCount: types.size,
      issueCount: 0,
      validatedCount: 0,
      validCount: 0,
      invalidCount: 0,
      lastValidatedAt: 0,
      running: false,
    };
  }

  /**
   * Serialises the entire store as a JSON-safe structure. Because validation
   * schemas contain no functions, the result round-trips losslessly through
   * {@link ValidationStore.fromJSON}.
   */
  toJSON(): SerializedSchema[] {
    return Array.from(this.schemas.values(), (schema) => ({
      name: schema.name,
      parameters: schema.parameters.slice(),
    }));
  }

  /**
   * Rebuilds a store from the output of {@link ValidationStore.toJSON} (or any
   * serialised array of `{ name, parameters }` shapes).
   *
   * @param serialized the serialised schemas.
   * @returns a new store populated with the restored schemas.
   * @throws {TypeError} when an entry is malformed.
   */
  static fromJSON(serialized: SerializedSchema[]): ValidationStore {
    const store = new ValidationStore();
    for (const entry of serialized) {
      if (!isValidationSchema(entry)) {
        throw new TypeError(
          `ValidationStore.fromJSON: invalid schema entry "${String((entry as { name?: unknown })?.name ?? '<unknown>')}".`,
        );
      }
      store.setValidated(entry.name, entry.parameters);
    }
    return store;
  }

  /**
   * Creates a detached copy of the store: a new store whose schemas share no
   * mutable state with this one. Useful before handing a store over to code
   * that mutates schemas.
   */
  clone(): ValidationStore {
    return ValidationStore.fromJSON(this.toJSON());
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Inserts a schema whose parameters are already known to be valid, skipping
   * the validation pass. Used by `fromJSON` where the caller has explicitly
   * vouched for the input shape.
   */
  private setValidated(name: string, parameters: ToolParameter[]): void {
    this.schemas.set(name, { name, parameters: normalizeParameters(parameters, name) });
  }
}

/**
 * Default exported convenience factory mirroring the class so consumers can
 * write `import createStore from './store.js'`.
 *
 * @param initial optional seed schemas or tool definitions.
 * @returns a new {@link ValidationStore}.
 */
export default function createValidationStore(
  initial?: ConstructorParameters<typeof ValidationStore>[0],
): ValidationStore {
  return new ValidationStore(initial);
}