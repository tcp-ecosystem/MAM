/**
 * integration.ts
 *
 * The high-level facade of the Validation layer: `ToolValidator`.
 *
 * The individual components — store, index, validator and lifecycle — are
 * designed to be usable in isolation and composable in any arrangement. For
 * the common case, though, you want a single object that wires them together
 * with sensible defaults and exposes the operations end users actually need:
 *
 *   validateParams / validateDefinition   — the validation entry points
 *   registerSchema / unregister / prune   — schema lifecycle
 *   getSchema / has / list / stats        — introspection
 *   start / stop                          — periodic garbage collection
 *   on / off                              — `validated` / `invalid` events
 *
 * `ToolValidator` is that object. It owns a {@link ValidationStore}, a
 * {@link ValidationIndex}, a {@link ValidationLifecycle} and a
 * {@link ParamValidator}, and delegates to them. It also exposes a `adapter`
 * property: a {@link ValidationAdapter} implementing the stable
 * {@link Validator} interface so that any consumer code written against a
 * generic validator can talk to this layer without coupling to implementation
 * details.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events` is used transitively through the lifecycle).
 */

import {
  type ToolDefinition,
  type ValidateOptions,
  type ValidationConfig,
  type ValidationEmitter,
  type ValidationEventPayload,
  type ValidationResult,
  type ValidationSchema,
  type ValidationStats,
  DEFAULT_VALIDATION_CONFIG,
  resolveValidationConfig,
} from './types.js';
import { ValidationStore } from './store.js';
import { ValidationIndex } from './index.js';
import { ValidationLifecycle, VALIDATION_EVENTS } from './lifecycle.js';
import { ParamValidator } from './retrieval.js';

/**
 * Re-exported event names so consumers of the integration facade do not need
 * to import from `lifecycle.ts` directly.
 */
export { VALIDATION_EVENTS } from './lifecycle.js';

/**
 * Options accepted by the {@link ToolValidator} constructor. Extends the base
 * {@link ValidationConfig} with optional pre-built store / index / emitter
 * components so callers can inject their own stateful objects.
 */
export interface ValidationOptions extends ValidationConfig {
  /**
   * A pre-built schema store to reuse. Created automatically when omitted.
   */
  store?: ValidationStore;

  /**
   * A pre-built lookup index to reuse. Created automatically when omitted.
   */
  index?: ValidationIndex;

  /**
   * Interval in milliseconds between automatic GC passes. Defaults to `60000`.
   */
  gcIntervalMs?: number;

  /**
   * Whether periodic GC is permitted at all. Defaults to `true`.
   */
  autoGc?: boolean;

  /**
   * The event emitter used for lifecycle events.
   */
  emitter?: ValidationEmitter;
}

/**
 * The stable validator contract implemented by {@link ValidationAdapter}.
 *
 * Any component that only needs to *validate* — proxy servers, CLI argument
 * checkers, HTTP body validators, agent gates — can depend on this interface
 * instead of on the concrete `ToolValidator`. This keeps coupling low and
 * makes the validator easy to mock in tests.
 */
export interface Validator {
  /**
   * Validates an invocation against a tool. When `tool` is a name, the schema
   * is looked up in the registry (unknown names produce an invalid result);
   * when it is a definition, its parameters are used directly.
   */
  validate(
    tool: string | ToolDefinition,
    params?: Record<string, unknown>,
  ): ValidationResult;

  /**
   * Validates the structural shape of a tool definition.
   */
  validateDefinition(tool: ToolDefinition): ValidationResult;

  /**
   * Validates and registers a tool definition.
   */
  register(tool: ToolDefinition): ValidationResult;

  /**
   * Validates and registers several tool definitions.
   */
  registerMany(tools: Iterable<ToolDefinition>): number;

  /**
   * Removes a registered schema by name.
   */
  unregister(name: string): boolean;

  /**
   * Returns `true` when a schema is registered under `name`.
   */
  has(name: string): boolean;

  /**
   * Returns a {@link ValidationStats} snapshot.
   */
  stats(): ValidationStats;
}

/**
 * An immutable adapter that presents a {@link ToolValidator} instance through
 * the {@link Validator} interface. The adapter holds no state of its own —
 * every method delegates to the validator object it was constructed with.
 */
export class ValidationAdapter implements Validator {
  /** The validator instance backing this adapter. */
  private readonly validator: ToolValidator;

  /**
   * Creates an adapter around a validator instance.
   *
   * @param validator the validator object to delegate to.
   */
  constructor(validator: ToolValidator) {
    this.validator = validator;
  }

  /** @inheritdoc */
  validate(
    tool: string | ToolDefinition,
    params?: Record<string, unknown>,
  ): ValidationResult {
    return this.validator.validateParams(tool, params ?? {});
  }

  /** @inheritdoc */
  validateDefinition(tool: ToolDefinition): ValidationResult {
    return this.validator.validateDefinition(tool);
  }

  /** @inheritdoc */
  register(tool: ToolDefinition): ValidationResult {
    return this.validator.registerSchema(tool);
  }

  /** @inheritdoc */
  registerMany(tools: Iterable<ToolDefinition>): number {
    return this.validator.registerMany(tools);
  }

  /** @inheritdoc */
  unregister(name: string): boolean {
    return this.validator.unregister(name);
  }

  /** @inheritdoc */
  has(name: string): boolean {
    return this.validator.has(name);
  }

  /** @inheritdoc */
  stats(): ValidationStats {
    return this.validator.stats();
  }
}

/**
 * The high-level Validation facade.
 *
 * Wires a store, an index, a lifecycle manager and a validator into a single
 * coherent object. Construct with {@link ToolValidator.constructor} or the
 * {@link createToolValidator} factory.
 *
 * @example
 * const validator = createToolValidator();
 * validator.registerSchema({
 *   name: 'http.get',
 *   description: 'Perform an HTTP GET request',
 *   handler: async () => ({}),
 *   parameters: [
 *     { name: 'url', type: 'string', required: true },
 *     { name: 'timeoutMs', type: 'integer', required: false, default: 5000 },
 *   ],
 * });
 *
 * const ok = validator.validateParams('http.get', { url: 'https://x.dev' });
 * ok.valid;        // true
 * ok.coerced;      // { timeoutMs: 5000 } — default applied
 *
 * const bad = validator.validateParams('http.get', { url: 42 });
 * bad.valid;       // false
 * bad.issues[0].code; // 'type'
 *
 * validator.start(); // periodic GC every 60s
 * validator.stop();
 */
export class ToolValidator {
  /** The underlying schema store. Exposed for advanced consumers. */
  readonly store: ValidationStore;

  /** The underlying lookup index. Exposed for advanced consumers. */
  readonly index: ValidationIndex;

  /** The lifecycle manager keeping store, index and counters in sync. */
  readonly lifecycle: ValidationLifecycle;

  /** The stateless validation engine used for every pass. */
  readonly validator: ParamValidator;

  /** Effective configuration. */
  readonly config: Required<ValidationConfig>;

  /**
   * A validator adapter implementing {@link Validator}, safe to hand to
   * generic consumers.
   */
  readonly adapter: Validator;

  /**
   * Creates a validation facade.
   *
   * @param options optional config and injectable components; see
   *   {@link ValidationOptions}.
   */
  constructor(options: Partial<ValidationOptions> = {}) {
    this.config = resolveValidationConfig(options);
    this.store = options.store ?? new ValidationStore();
    this.index = options.index ?? new ValidationIndex();
    this.validator = new ParamValidator(this.config);
    this.lifecycle = new ValidationLifecycle({
      store: this.store,
      index: this.index,
      validator: this.validator,
      gcIntervalMs: options.gcIntervalMs ?? 60_000,
      autoGc: options.autoGc ?? true,
      emitter: options.emitter,
    });
    this.adapter = new ValidationAdapter(this);
  }

  /* ------------------------------------------------------------------ *
   * Validation entry points
   * ------------------------------------------------------------------ */

  /**
   * Validates an invocation against a tool.
   *
   * When `tool` is a string name, the schema is resolved from the registry and
   * the pass goes through the lifecycle (counters updated, `validated` /
   * `invalid` events emitted). When `tool` is a {@link ToolDefinition}, its
   * parameters are applied directly without requiring registration.
   *
   * @param tool the tool name or definition to validate against.
   * @param params the caller's raw input object.
   * @param options per-call overrides.
   * @returns a {@link ValidationResult}; never throws for ordinary input.
   */
  validateParams(
    tool: string | ToolDefinition,
    params: Record<string, unknown>,
    options: ValidateOptions = {},
  ): ValidationResult {
    if (typeof tool === 'string') {
      return this.lifecycle.validate(tool, params, options);
    }
    return this.validator.validateParamsForTool(tool, params, options);
  }

  /**
   * Validates an invocation against a tool name with no parameters supplied.
   * Convenience alias for {@link ToolValidator.validateParams} with an empty
   * input object.
   *
   * @param tool the tool name or definition.
   */
  validate(
    tool: string | ToolDefinition,
    params?: Record<string, unknown>,
  ): ValidationResult {
    return this.validateParams(tool, params ?? {});
  }

  /**
   * Validates the structural shape of a {@link ToolDefinition}: name and
   * description present, handler callable, parameters valid and unique. The
   * pass goes through the lifecycle so counters and events are updated.
   *
   * @param tool the definition to inspect.
   * @returns the structural validation result.
   */
  validateDefinition(tool: ToolDefinition): ValidationResult {
    return this.lifecycle.validateDefinition(tool);
  }

  /* ------------------------------------------------------------------ *
   * Schema lifecycle
   * ------------------------------------------------------------------ */

  /**
   * Validates a {@link ToolDefinition} and, when it is well-formed, registers
   * its parameter schema under its name.
   *
   * @param tool the definition to validate and register.
   * @returns the (valid) definition-check result.
   * @throws {TypeError} when the definition is invalid; nothing is registered.
   */
  registerSchema(tool: ToolDefinition): ValidationResult {
    const result = this.validateDefinition(tool);
    if (!result.valid) {
      throw new TypeError(
        `registerSchema: invalid definition for "${tool?.name ?? '<unknown>'}" ` +
          `— ${result.errors.join('; ')}`,
      );
    }
    this.lifecycle.register(tool);
    return result;
  }

  /**
   * Registers a schema by name and parameter list, skipping the definition
   * check. Prefer {@link ToolValidator.registerSchema} when a full definition
   * is available.
   *
   * @param name the schema name.
   * @param parameters the declared parameters.
   * @returns the previously registered schema for the same name.
   */
  putSchema(name: string, parameters: ValidationSchema['parameters']): ValidationSchema | undefined {
    return this.lifecycle.registerSchema(name, parameters);
  }

  /**
   * Registers several tools in one call, validating each. Stops at the first
   * invalid definition and throws; previously registered tools of the batch
   * remain registered.
   *
   * @param tools the definitions to validate and register.
   * @returns the number of tools registered in this call.
   * @throws {TypeError} when a definition is invalid.
   */
  registerMany(tools: Iterable<ToolDefinition>): number {
    let count = 0;
    for (const tool of tools) {
      this.registerSchema(tool);
      count += 1;
    }
    return count;
  }

  /**
   * Removes a registered schema by name.
   *
   * @param name the schema name to remove.
   * @returns `true` when a schema was removed, `false` when it was absent.
   */
  unregister(name: string): boolean {
    return this.lifecycle.removeSchema(name);
  }

  /**
   * Removes a batch of schemas in one transaction.
   *
   * @param names the schema names to prune.
   * @returns the number of schemas actually removed.
   */
  prune(names: Iterable<string>): number {
    return this.lifecycle.prune(names);
  }

  /* ------------------------------------------------------------------ *
   * Introspection
   * ------------------------------------------------------------------ */

  /**
   * Returns the schema registered under `name`, or `undefined`.
   */
  getSchema(name: string): ValidationSchema | undefined {
    return this.lifecycle.getSchema(name);
  }

  /**
   * Returns `true` when a schema is registered under `name`.
   */
  has(name: string): boolean {
    return this.lifecycle.has(name);
  }

  /**
   * Returns every registered schema in insertion order.
   */
  list(): ValidationSchema[] {
    return this.lifecycle.list();
  }

  /**
   * Returns a combined {@link ValidationStats} snapshot.
   */
  stats(): ValidationStats {
    return this.lifecycle.stats();
  }

  /**
   * Returns the current number of registered schemas.
   */
  get size(): number {
    return this.store.size;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle controls
   * ------------------------------------------------------------------ */

  /**
   * Starts periodic garbage collection (index reconciliation).
   *
   * @returns `true` when a timer was started.
   */
  start(): boolean {
    return this.lifecycle.start();
  }

  /**
   * Stops periodic garbage collection.
   *
   * @returns `true` when a timer was stopped.
   */
  stop(): boolean {
    return this.lifecycle.stop();
  }

  /**
   * Returns `true` when periodic garbage collection is running.
   */
  isRunning(): boolean {
    return this.lifecycle.isRunning();
  }

  /**
   * Rebuilds the index to match the store exactly.
   *
   * @returns `this` for chaining.
   */
  reindex(): this {
    this.lifecycle.reindex();
    return this;
  }

  /**
   * Resets the validation layer: stops the timer, clears the store, the index
   * and the validation counters.
   */
  reset(): this {
    this.lifecycle.reset();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Events & persistence
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to lifecycle events. See {@link VALIDATION_EVENTS} for names;
   * payloads are {@link ValidationEventPayload}.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: ValidationEventPayload) => void,
  ): this {
    this.lifecycle.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener added via {@link ToolValidator.on}.
   */
  off(
    event: string,
    listener: (payload: ValidationEventPayload) => void,
  ): this {
    this.lifecycle.off(event, listener);
    return this;
  }

  /**
   * Serialises the schema registry for persistence.
   */
  snapshot(): ReturnType<ValidationStore['toJSON']> {
    return this.lifecycle.snapshot();
  }

  /**
   * Restores a snapshot produced by {@link ToolValidator.snapshot} (or
   * `ValidationStore.toJSON`), replacing all current schemas and re-indexing.
   */
  restore(serialized: Parameters<typeof ValidationStore.fromJSON>[0]): this {
    this.lifecycle.restore(serialized);
    return this;
  }
}

/**
 * Convenience factory for a fully wired {@link ToolValidator}.
 *
 * @param options optional config and injectable components.
 * @returns a ready-to-use validation facade.
 */
export function createToolValidator(
  options?: Partial<ValidationOptions>,
): ToolValidator {
  return new ToolValidator(options);
}

/**
 * Default exported factory mirroring {@link createToolValidator}, so both
 * `import validator from './integration.js'` and named imports work.
 */
export default createToolValidator;