/**
 * lifecycle.ts
 *
 * The `ValidationLifecycle` — the orchestration layer that keeps the store,
 * index and validator in agreement over time and that owns the validation
 * runtime state (counters, events, periodic GC).
 *
 * The store (`store.ts`) is the write-side, the index (`index.ts`) is the
 * read-side and the validator (`retrieval.ts`) is the engine; none of them
 * knows about the others. The lifecycle manager is the glue that:
 *
 *   - pushes `registerSchema` / `removeSchema` changes from the store into the
 *     index immediately,
 *   - exposes `prune(names)` for bulk, transactional removal,
 *   - runs an optional periodic garbage-collection pass (`start` / `stop`)
 *     that reconciles the index against the store so a store mutated
 *     underneath us (or restored from a snapshot) converges automatically,
 *   - owns the validation counters (`validatedCount`, `validCount`,
 *     `invalidCount`, `issueCount`, `lastValidatedAt`),
 *   - emits `validated` / `invalid` events around every validation pass plus
 *     `registered`, `removed`, `pruned` and `gced` lifecycle events, through
 *     an injected event emitter (defaults to `node:events` `EventEmitter`),
 *   - clears / resets both sides on demand.
 *
 * The periodic GC pass uses `setInterval` and is unref'd so that it never
 * keeps a Node process alive on its own. Calling `start` twice is idempotent —
 * the second call is ignored while running.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins (`node:events`).
 */

import { EventEmitter } from 'node:events';

import {
  type ToolDefinition,
  type ToolParameter,
  type ValidateOptions,
  type ValidationEmitter,
  type ValidationEventPayload,
  type ValidationResult,
  type ValidationSchema,
  type ValidationStats,
  createValidationIssue,
  createValidationResult,
} from './types.js';
import { ValidationStore } from './store.js';
import { ValidationIndex } from './index.js';
import { ParamValidator } from './retrieval.js';

/**
 * Names of the lifecycle events. Kept in one place so consumers can subscribe
 * with confidence and so typo-prone string literals never leak into call
 * sites.
 */
export const VALIDATION_EVENTS = Object.freeze({
  /** Emitted after a validation pass that produced zero issues. */
  validated: 'validated',
  /** Emitted after a validation pass that produced at least one issue. */
  invalid: 'invalid',
  /** Emitted after a schema was registered and indexed. */
  registered: 'registered',
  /** Emitted after a schema was removed and de-indexed. */
  removed: 'removed',
  /** Emitted after one or more schemas were pruned in bulk. */
  pruned: 'pruned',
  /** Emitted after a periodic garbage-collection pass completed. */
  gced: 'gced',
} as const);

/**
 * Options accepted by the {@link ValidationLifecycle} constructor.
 */
export interface ValidationLifecycleOptions {
  /** The authoritative store this lifecycle manages. */
  store: ValidationStore;

  /**
   * The lookup index kept in sync with the store. Created automatically (and
   * seeded) when omitted.
   */
  index?: ValidationIndex;

  /**
   * The stateless validator used for every validation pass. Created
   * automatically when omitted.
   */
  validator?: ParamValidator;

  /**
   * Interval in milliseconds between automatic GC passes. Defaults to `60000`.
   * Only used when `autoGc` is `true`.
   */
  gcIntervalMs?: number;

  /**
   * Whether periodic GC is permitted at all. Defaults to `true`.
   */
  autoGc?: boolean;

  /**
   * The event emitter used for lifecycle events. Defaults to a fresh
   * `node:events` `EventEmitter`.
   */
  emitter?: ValidationEmitter;
}

/**
 * Coordinates the store, index and validator over the lifetime of a validation
 * process.
 *
 * @example
 * const store = new ValidationStore();
 * const lifecycle = new ValidationLifecycle({ store });
 *
 * lifecycle.on(VALIDATION_EVENTS.validated, (payload) => {
 *   console.log(`valid call to ${payload.name}`);
 * });
 *
 * lifecycle.registerSchema('http.get', [
 *   { name: 'url', type: 'string', required: true },
 * ]);
 *
 * const result = lifecycle.validate('http.get', { url: 'https://x.dev' });
 * result.valid; // true
 *
 * lifecycle.start(); // periodic GC every 60s
 * lifecycle.stop();
 */
export class ValidationLifecycle {
  /** The authoritative store this lifecycle manages. */
  readonly store: ValidationStore;

  /** The lookup index kept in sync with the store. */
  readonly index: ValidationIndex;

  /** The stateless validator used for every pass. */
  readonly validator: ParamValidator;

  /** The event emitter used for lifecycle events. */
  readonly emitter: ValidationEmitter;

  /** Interval handle of the periodic GC pass, or `undefined`. */
  private timer?: ReturnType<typeof setInterval>;

  /** Interval between GC passes. */
  private readonly gcIntervalMs: number;

  /** Whether periodic GC is permitted at all. */
  private readonly autoGc: boolean;

  /* Validation counters ------------------------------------------------ */

  /** Total number of validation passes performed. */
  private validatedCount = 0;

  /** Number of passes that produced zero issues. */
  private validCount = 0;

  /** Number of passes that produced at least one issue. */
  private invalidCount = 0;

  /** Total number of issues recorded across all passes. */
  private issueCount = 0;

  /** Epoch ms of the most recent validation pass. */
  private lastValidatedAt = 0;

  /**
   * Creates a lifecycle manager bound to a store.
   *
   * @param options the store plus optional index, validator, GC and emitter
   *   configuration. See {@link ValidationLifecycleOptions}.
   */
  constructor(options: ValidationLifecycleOptions) {
    this.store = options.store;
    this.index = options.index ?? new ValidationIndex();
    this.validator = options.validator ?? new ParamValidator();
    this.emitter = options.emitter ?? new EventEmitter();
    this.autoGc = options.autoGc ?? true;
    this.gcIntervalMs = options.gcIntervalMs ?? 60_000;
    this.index.rebuild(this.store.list());
  }

  /* ------------------------------------------------------------------ *
   * Schema registration
   * ------------------------------------------------------------------ */

  /**
   * Registers (or replaces) a schema under the given name and indexes it
   * immediately. This is the lifecycle-aware alternative to calling
   * `store.putSchema` directly; use it whenever you want events and index
   * consistency.
   *
   * @param name the schema name (usually the tool name).
   * @param parameters the declared parameter list.
   * @returns the previously registered schema for the same name, or
   *   `undefined`.
   */
  registerSchema(name: string, parameters: ToolParameter[]): ValidationSchema | undefined {
    const previous = this.store.putSchema(name, parameters);
    const schema = this.store.get(name);
    if (schema !== undefined) {
      this.index.indexSchema(schema);
    }
    this.emitter.emit(VALIDATION_EVENTS.registered, {
      name,
      schemaCount: this.store.size,
      validCount: this.validCount,
      invalidCount: this.invalidCount,
      issueCount: this.issueCount,
    } satisfies ValidationEventPayload);
    return previous;
  }

  /**
   * Alias of {@link ValidationLifecycle.registerSchema} accepting a full
   * {@link ToolDefinition}; only the tool's parameters are registered.
   *
   * @param tool the tool whose parameters should be registered.
   * @returns the previously registered schema for the same name, or
   *   `undefined`.
   */
  register(tool: ToolDefinition): ValidationSchema | undefined {
    return this.registerSchema(tool.name, tool.parameters ?? []);
  }

  /**
   * Registers a schema from a stored schema object.
   *
   * @param schema the schema to register.
   * @returns the previously registered schema for the same name, or
   *   `undefined`.
   */
  putSchema(schema: ValidationSchema): ValidationSchema | undefined {
    return this.registerSchema(schema.name, schema.parameters);
  }

  /**
   * Removes a schema by name from both the store and the index.
   *
   * @param name the schema name to remove.
   * @returns `true` when a schema was removed, `false` when it was absent.
   */
  removeSchema(name: string): boolean {
    if (this.store.delete(name) !== undefined) {
      this.index.removeSchema(name);
      this.emitter.emit(VALIDATION_EVENTS.removed, {
        name,
        schemaCount: this.store.size,
        validCount: this.validCount,
        invalidCount: this.invalidCount,
        issueCount: this.issueCount,
      } satisfies ValidationEventPayload);
      return true;
    }
    return false;
  }

  /**
   * Removes a batch of schemas in one transaction. Index removal happens for
   * every name that was actually registered, so absent names are ignored
   * silently.
   *
   * @param schemaNames the schema names to prune.
   * @returns the number of schemas actually removed.
   */
  prune(schemaNames: Iterable<string>): number {
    let removedCount = 0;
    for (const name of schemaNames) {
      if (this.removeSchema(name)) {
        removedCount += 1;
      }
    }
    if (removedCount > 0) {
      this.emitter.emit(VALIDATION_EVENTS.pruned, {
        name: `<pruned:${removedCount}>`,
        schemaCount: this.store.size,
        validCount: this.validCount,
        invalidCount: this.invalidCount,
        issueCount: this.issueCount,
      } satisfies ValidationEventPayload);
    }
    return removedCount;
  }

  /* ------------------------------------------------------------------ *
   * Validation passes
   * ------------------------------------------------------------------ */

  /**
   * Validates an invocation against a registered schema, updates the counters
   * and emits `validated` or `invalid`.
   *
   * When no schema is registered under `name`, the result is invalid with a
   * single `'custom'` issue and an `invalid` event is still emitted.
   *
   * @param name the schema name to validate against.
   * @param input the caller's raw input object.
   * @param options per-call overrides.
   * @returns the validation result; never throws for ordinary input.
   */
  validate(
    name: string,
    input: Record<string, unknown>,
    options: ValidateOptions = {},
  ): ValidationResult {
    const schema = this.store.get(name);
    const result =
      schema === undefined
        ? createValidationResult([
            createValidationIssue(
              '',
              'custom',
              `no schema is registered under "${name}"`,
            ),
          ])
        : this.validator.validateParams(schema.parameters, input, options);
    this.record(result);
    this.emitOutcome(result, name);
    return result;
  }

  /**
   * Validates the structural shape of a {@link ToolDefinition}, updates the
   * counters and emits `validated` or `invalid`. The definition is *not*
   * registered by this call — use {@link ValidationLifecycle.register} or
   * {@link ValidationLifecycle.registerSchema} for that.
   *
   * @param tool the definition to inspect.
   * @returns the structural validation result.
   */
  validateDefinition(tool: ToolDefinition): ValidationResult {
    const result = this.validator.validateDefinition(tool);
    this.record(result);
    this.emitOutcome(result, tool.name ?? '<definition>');
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Index reconciliation
   * ------------------------------------------------------------------ */

  /**
   * Rebuilds the index from scratch to match the store exactly. Useful after
   * external mutations to the store (e.g. bulk imports or snapshot restores)
   * that bypassed the lifecycle.
   *
   * @returns `this` for chaining.
   */
  reindex(): this {
    this.index.rebuild(this.store.list());
    return this;
  }

  /**
   * Clears the index while leaving the store intact. Use with care: lookups
   * will return nothing until the next {@link ValidationLifecycle.reindex} or
   * GC pass.
   *
   * @returns `this` for chaining.
   */
  clearIndex(): this {
    this.index.clear();
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Periodic garbage collection
   * ------------------------------------------------------------------ */

  /**
   * Performs one garbage-collection pass: reconciles the index against the
   * store so they agree exactly, then emits `gced`. This is the same work the
   * periodic timer performs, exposed so callers can trigger it on demand.
   *
   * @returns `this` for chaining.
   */
  gc(): this {
    this.reindex();
    this.emitter.emit(VALIDATION_EVENTS.gced, {
      name: '<gc>',
      schemaCount: this.store.size,
      validCount: this.validCount,
      invalidCount: this.invalidCount,
      issueCount: this.issueCount,
    } satisfies ValidationEventPayload);
    return this;
  }

  /**
   * Starts the periodic GC pass. Every `gcIntervalMs` the index is rebuilt
   * from the store, which reconciles any drift.
   *
   * The timer is `unref`'d so the process can still exit naturally. Starting
   * while already running is a no-op. When `autoGc` was disabled at
   * construction, `start` does nothing.
   *
   * @returns `true` when a new timer was started, `false` when one was already
   *   running or auto-GC is disabled.
   */
  start(): boolean {
    if (!this.autoGc || this.timer !== undefined) {
      return false;
    }
    this.timer = setInterval(() => {
      this.gc();
    }, this.gcIntervalMs);
    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
    return true;
  }

  /**
   * Stops the periodic GC pass, if one is running.
   *
   * @returns `true` when a timer was stopped, `false` when none was running.
   */
  stop(): boolean {
    if (this.timer === undefined) {
      return false;
    }
    clearInterval(this.timer);
    this.timer = undefined;
    return true;
  }

  /**
   * Returns `true` when the periodic GC pass is currently running.
   */
  isRunning(): boolean {
    return this.timer !== undefined;
  }

  /* ------------------------------------------------------------------ *
   * State reset
   * ------------------------------------------------------------------ */

  /**
   * Clears the store, the index and the validation counters, returning the
   * lifecycle to its initial empty state. The timer (if running) is stopped
   * first.
   *
   * @returns `this` for chaining.
   */
  clear(): this {
    this.stop();
    this.store.clear();
    this.index.clear();
    this.validatedCount = 0;
    this.validCount = 0;
    this.invalidCount = 0;
    this.issueCount = 0;
    this.lastValidatedAt = 0;
    return this;
  }

  /**
   * Alias of {@link ValidationLifecycle.clear} for symmetry with the rest of
   * the MAM layers.
   *
   * @returns `this` for chaining.
   */
  reset(): this {
    return this.clear();
  }

  /* ------------------------------------------------------------------ *
   * Subscription helpers
   * ------------------------------------------------------------------ */

  /**
   * Subscribes to lifecycle events. See {@link VALIDATION_EVENTS} for the
   * available event names; payloads are {@link ValidationEventPayload}.
   *
   * @param event the event name.
   * @param listener the callback.
   * @returns `this` for chaining.
   */
  on(
    event: string,
    listener: (payload: ValidationEventPayload) => void,
  ): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Unsubscribes a listener previously added via {@link ValidationLifecycle.on}.
   *
   * @param event the event name.
   * @param listener the callback to remove.
   * @returns `this` for chaining.
   */
  off(
    event: string,
    listener: (payload: ValidationEventPayload) => void,
  ): this {
    this.emitter.off(event, listener);
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Observation
   * ------------------------------------------------------------------ */

  /**
   * Returns the schema registered under `name`, or `undefined`.
   */
  getSchema(name: string): ValidationSchema | undefined {
    return this.store.getSchema(name);
  }

  /**
   * Returns `true` when a schema is registered under `name`.
   */
  has(name: string): boolean {
    return this.store.has(name);
  }

  /**
   * Returns every registered schema as an array, in insertion order.
   */
  list(): ValidationSchema[] {
    return this.store.list();
  }

  /**
   * Returns a {@link ValidationStats} snapshot combining the store's
   * authoritative counts, the index's derived statistics, the lifecycle's
   * validation counters and the current run state.
   */
  stats(): ValidationStats {
    const storeStats = this.store.stats();
    return {
      ...storeStats,
      typeCount: this.index.stats().typeCount,
      issueCount: this.issueCount,
      validatedCount: this.validatedCount,
      validCount: this.validCount,
      invalidCount: this.invalidCount,
      lastValidatedAt: this.lastValidatedAt,
      running: this.isRunning(),
    };
  }

  /**
   * Serialises the current store using {@link ValidationStore.toJSON} so it
   * can be persisted and restored on a later boot.
   */
  snapshot(): ReturnType<ValidationStore['toJSON']> {
    return this.store.toJSON();
  }

  /**
   * Replaces the store contents with a restored snapshot and re-indexes.
   *
   * @param serialized the serialised schemas.
   * @returns `this` for chaining.
   */
  restore(serialized: Parameters<typeof ValidationStore.fromJSON>[0]): this {
    const restored = ValidationStore.fromJSON(serialized);
    this.store.clear();
    for (const schema of restored.list()) {
      this.store.putSchema(schema.name, schema.parameters);
    }
    this.index.rebuild(this.store.list());
    return this;
  }

  /* ------------------------------------------------------------------ *
   * Private helpers
   * ------------------------------------------------------------------ */

  /**
   * Accumulates a validation result into the counters.
   */
  private record(result: ValidationResult): void {
    this.validatedCount += 1;
    this.issueCount += result.issues.length;
    if (result.valid) {
      this.validCount += 1;
    } else {
      this.invalidCount += 1;
    }
    this.lastValidatedAt = Date.now();
  }

  /**
   * Emits `validated` or `invalid` for a completed validation pass.
   */
  private emitOutcome(result: ValidationResult, name: string): void {
    this.emitter.emit(
      result.valid ? VALIDATION_EVENTS.validated : VALIDATION_EVENTS.invalid,
      {
        name,
        result,
        schemaCount: this.store.size,
        validCount: this.validCount,
        invalidCount: this.invalidCount,
        issueCount: this.issueCount,
      } satisfies ValidationEventPayload,
    );
  }
}

/**
 * Default exported convenience factory mirroring the class.
 *
 * @param options the store plus optional lifecycle configuration.
 * @returns a new {@link ValidationLifecycle}.
 */
export default function createValidationLifecycle(
  options: ValidationLifecycleOptions,
): ValidationLifecycle {
  return new ValidationLifecycle(options);
}