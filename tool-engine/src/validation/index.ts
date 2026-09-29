/**
 * index.ts
 *
 * The `ValidationIndex` — an in-memory inverted index over the Validation
 * registry.
 *
 * While `store.ts` keeps the authoritative, name-keyed schemas, this module
 * maintains the derived structures that make lookups fast:
 *
 *   - `bySchemaName`     — name → {@link ValidationSchema} (mirrors the store).
 *   - `byParamName`      — parameter name → set of schema names declaring it.
 *                         Answers "which tools take a `timeoutMs` argument?".
 *   - `byType`           — type name → set of schema names declaring at least
 *                         one parameter of that type. Answers "which tools
 *                         consume a `number`?".
 *   - `byRequired`       — required flag → set of schema names with at least
 *                         one required / all-optional parameter.
 *   - `paramDetail`      — schema name → (parameter name → parameter). This is
 *                         the fast path for `findParam`.
 *
 * The index is *eventually consistent* with the store: callers push schemas in
 * via `indexSchema` and remove them via `removeSchema`, or ask the lifecycle
 * layer to rebuild from scratch with `rebuild`. Duplicate indexes for the same
 * schema are idempotent — re-indexing a name replaces, never duplicates.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type ToolParameter,
  type TypeName,
  type ValidationSchema,
  type ValidationStats,
  isKnownType,
  normalizeParameters,
} from './types.js';

/**
 * An inverted index over a collection of validation schemas.
 *
 * @example
 * const index = new ValidationIndex();
 * index.indexSchema({ name: 'http.get', parameters: [...] });
 * index.findByType('number');      // Set { 'http.get' }
 * index.findParam('http.get', 'url'); // the url ToolParameter
 * index.findByParamName('url');    // Set { 'http.get' }
 * index.rebuild(schemas);          // full rebuild from a list
 */
export class ValidationIndex {
  /** Schema name → schema (mirrors the registry). */
  private readonly bySchemaName = new Map<string, ValidationSchema>();

  /** Parameter name → schema names declaring that parameter. */
  private readonly byParamName = new Map<string, Set<string>>();

  /** Type name → schema names declaring at least one parameter of that type. */
  private readonly byType = new Map<string, Set<string>>();

  /** Required flag → schema names with at least one parameter of that flag. */
  private readonly byRequired = new Map<boolean, Set<string>>();

  /** Schema name → (parameter name → parameter). Fast `findParam` path. */
  private readonly paramDetail = new Map<string, Map<string, ToolParameter>>();

  /** Epoch ms of the most recent rebuild or significant mutation. */
  private lastIndexedAt = 0;

  /* ------------------------------------------------------------------ *
   * Mutations
   * ------------------------------------------------------------------ */

  /**
   * Indexes a schema. If the schema was already indexed under the same name,
   * the old entry is fully removed first so stale parameter/type/required
   * entries never linger.
   *
   * @param schema the schema to index.
   * @returns `this` for chaining.
   * @throws {TypeError} when the schema is malformed.
   */
  indexSchema(schema: ValidationSchema): this {
    if (typeof schema?.name !== 'string' || schema.name.length === 0) {
      throw new TypeError(
        'ValidationIndex.indexSchema: a schema must have a non-empty string name.',
      );
    }
    if (this.bySchemaName.has(schema.name)) {
      this.removeSchema(schema.name);
    }

    const parameters = normalizeParameters(schema.parameters, schema.name);
    const normalized: ValidationSchema = { name: schema.name, parameters };

    this.bySchemaName.set(schema.name, normalized);

    const details = new Map<string, ToolParameter>();
    for (const parameter of parameters) {
      this.addToSet(this.byParamName, parameter.name, schema.name);
      this.addToSet(this.byType, parameter.type, schema.name);
      this.addToSet(this.byRequired, parameter.required, schema.name);
      details.set(parameter.name, parameter);
    }
    this.paramDetail.set(schema.name, details);

    this.lastIndexedAt = Date.now();
    return this;
  }

  /**
   * Convenience overload: indexes a schema from its name and parameter list
   * without building a {@link ValidationSchema} object first.
   *
   * @param name the schema name.
   * @param parameters the declared parameters.
   * @returns `this` for chaining.
   */
  indexSchemaByName(name: string, parameters: ToolParameter[]): this {
    return this.indexSchema({ name, parameters });
  }

  /**
   * Removes a schema and every index entry that references it.
   *
   * @param name the schema name to drop from the index.
   * @returns `true` when the schema was indexed and removed, `false` when it
   *   was unknown.
   */
  removeSchema(name: string): boolean {
    const schema = this.bySchemaName.get(name);
    if (schema === undefined) {
      return false;
    }

    this.bySchemaName.delete(name);

    for (const parameter of schema.parameters) {
      this.removeFromSet(this.byParamName, parameter.name, name);
      this.removeFromSet(this.byType, parameter.type, name);
      this.removeFromSet(this.byRequired, parameter.required, name);
    }
    this.paramDetail.delete(name);

    this.lastIndexedAt = Date.now();
    return true;
  }

  /**
   * Rebuilds the entire index from a list of schemas. This is the canonical
   * reconciliation path: it guarantees the index matches the registry exactly,
   * which matters after bulk removal operations.
   *
   * @param schemas the schemas to index.
   * @returns `this` for chaining.
   */
  rebuild(schemas: Iterable<ValidationSchema>): this {
    this.clear();
    for (const schema of schemas) {
      this.indexSchema(schema);
    }
    this.lastIndexedAt = Date.now();
    return this;
  }

  /**
   * Removes every entry from the index, leaving it empty but reusable.
   */
  clear(): void {
    this.bySchemaName.clear();
    this.byParamName.clear();
    this.byType.clear();
    this.byRequired.clear();
    this.paramDetail.clear();
    this.lastIndexedAt = 0;
  }

  /* ------------------------------------------------------------------ *
   * Lookups
   * ------------------------------------------------------------------ */

  /**
   * Returns the indexed schema for `name`, or `undefined`.
   */
  get(name: string): ValidationSchema | undefined {
    return this.bySchemaName.get(name);
  }

  /**
   * Returns `true` when `name` is present in the index.
   */
  has(name: string): boolean {
    return this.bySchemaName.has(name);
  }

  /**
   * Returns the number of indexed schemas.
   */
  get size(): number {
    return this.bySchemaName.size;
  }

  /**
   * Returns every indexed schema as an array, in insertion order.
   */
  all(): ValidationSchema[] {
    return Array.from(this.bySchemaName.values(), (schema) => ({
      name: schema.name,
      parameters: schema.parameters.slice(),
    }));
  }

  /**
   * Returns every indexed schema name as an array, in insertion order.
   */
  names(): string[] {
    return Array.from(this.bySchemaName.keys());
  }

  /**
   * Returns the names of all schemas that declare at least one parameter of
   * the given type. Exact string match; empty result set when the type is
   * unknown. Accepts custom type names as well as built-in ones.
   *
   * @param type the type name to search for.
   */
  findByType(type: string): Set<string> {
    return new Set(this.byType.get(type) ?? []);
  }

  /**
   * Returns the names of all schemas that declare a parameter with the given
   * name.
   *
   * @param paramName the parameter name to search for.
   */
  findByParamName(paramName: string): Set<string> {
    return new Set(this.byParamName.get(paramName) ?? []);
  }

  /**
   * Returns the names of all schemas that have at least one parameter with the
   * given required flag.
   *
   * @param required the required flag to search for.
   */
  findByRequired(required: boolean): Set<string> {
    return new Set(this.byRequired.get(required) ?? []);
  }

  /**
   * Returns the {@link ToolParameter} declared by `schemaName` under
   * `paramName`, or `undefined` when either the schema or the parameter is
   * unknown.
   *
   * @param schemaName the schema name to inspect.
   * @param paramName the parameter name to look up.
   */
  findParam(
    schemaName: string,
    paramName: string,
  ): ToolParameter | undefined {
    return this.paramDetail.get(schemaName)?.get(paramName);
  }

  /**
   * Returns the parameter names declared by a schema, in declaration order.
   * Empty array for unknown schemas.
   *
   * @param schemaName the schema name to inspect.
   */
  paramNames(schemaName: string): string[] {
    const details = this.paramDetail.get(schemaName);
    return details === undefined ? [] : Array.from(details.keys());
  }

  /**
   * Returns every distinct parameter name known to the index, sorted for
   * determinism. Useful for documentation and diagnostics.
   */
  allParamNames(): string[] {
    return Array.from(this.byParamName.keys()).sort();
  }

  /**
   * Returns every distinct parameter type known to the index, sorted for
   * determinism. Custom type names appear alongside built-ins.
   */
  types(): string[] {
    return Array.from(this.byType.keys()).sort();
  }

  /**
   * Returns `true` when the index knows at least one schema declaring a
   * parameter of the given (built-in or custom) type.
   */
  hasType(type: string): boolean {
    return this.byType.has(type);
  }

  /**
   * Returns the total number of parameters indexed across all schemas.
   */
  get totalParameterCount(): number {
    let count = 0;
    for (const details of this.paramDetail.values()) {
      count += details.size;
    }
    return count;
  }

  /* ------------------------------------------------------------------ *
   * Stats
   * ------------------------------------------------------------------ */

  /**
   * Computes a {@link ValidationStats} snapshot for the index. The validation
   * counters and `running` are neutral (`0` / `false`) — lifecycle-managed
   * stats override them.
   */
  stats(): ValidationStats {
    return {
      schemaCount: this.bySchemaName.size,
      parameterCount: this.totalParameterCount,
      typeCount: this.byType.size,
      issueCount: 0,
      validatedCount: 0,
      validCount: 0,
      invalidCount: 0,
      lastValidatedAt: 0,
      running: false,
    };
  }

  /**
   * Returns the epoch ms of the last index mutation (index/remove/rebuild/
   * clear). `0` for a brand-new, never-touched index.
   */
  get indexedAt(): number {
    return this.lastIndexedAt;
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /** Adds `name` to the set behind `key` in `map`, creating it on demand. */
  private addToSet<K>(
    map: Map<K, Set<string>>,
    key: K,
    name: string,
  ): void {
    let set = map.get(key);
    if (set === undefined) {
      set = new Set();
      map.set(key, set);
    }
    set.add(name);
  }

  /** Removes `name` from the set behind `key`; drops empty sets. */
  private removeFromSet<K>(
    map: Map<K, Set<string>>,
    key: K,
    name: string,
  ): void {
    const set = map.get(key);
    if (set === undefined) {
      return;
    }
    set.delete(name);
    if (set.size === 0) {
      map.delete(key);
    }
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param schemas optional schemas to index immediately.
 * @returns a new {@link ValidationIndex}.
 */
export function createValidationIndex(
  schemas: Iterable<ValidationSchema> = [],
): ValidationIndex {
  const index = new ValidationIndex();
  for (const schema of schemas) {
    index.indexSchema(schema);
  }
  return index;
}

/**
 * Re-export of {@link isKnownType} so index consumers can test candidate type
 * names without importing from `types.ts` directly.
 */
export { isKnownType } from './types.js';

/**
 * Re-export of the {@link TypeName} type for convenience.
 */
export type { TypeName } from './types.js';