/**
 * lifecycle.ts
 *
 * `ToolsLifecycle`: the operational facade that ties the tools registry, the
 * tools index, the schema converter and periodic garbage collection together.
 *
 * While {@link ToolsRegistry} is a silent data holder and {@link ToolsIndex} a
 * pure lookup structure, the lifecycle is the *active* layer of the MCP Tools
 * stack. It owns the mutation path for registrations and unregistrations,
 * keeps the index in lock-step with the registry, validates call arguments
 * through a {@link SchemaConverter}, emits typed events for observability, and
 * runs an optional periodic GC timer so long-running servers do not leak
 * registrations.
 *
 * Typical usage:
 *
 * ```ts
 * const lifecycle = new ToolsLifecycle({ autoStart: true, maxTools: 100 });
 * lifecycle.onRegistered((kind, key, value) => logger.debug(`registered ${kind} ${key}`));
 * lifecycle.onValidated((result) => { if (!result.ok) logger.warn(result.issues); });
 * lifecycle.registerTool(converter.toolFromDefinition('echo', 'Echoes input', [
 *   { name: 'message', type: 'string', required: true },
 * ]));
 * lifecycle.prune(['echo']);
 * lifecycle.dispose();
 * ```
 *
 * Events are emitted on the standard Node `EventEmitter` surface, but typed
 * convenience hooks (`onRegistered`, `onUnregistered`, `onValidated`,
 * `onPruned`, `onCleared`, `onStart`, `onStop`) are provided so consumers do
 * not need stringly-typed listeners.
 *
 * @module tools/lifecycle
 */

import { EventEmitter } from 'node:events';
import {
  TOOL_KINDS,
  createRegisterOptions,
  isToolKind,
  kindOf,
  type JsonSchema,
  type McpPrompt,
  type McpRegistrable,
  type McpResource,
  type McpTool,
  type RegisterOptions,
  type ToolKind,
} from './types.js';
import { ToolsRegistry, type RegisteredEntry, type ToolsRegistryStats } from './store.js';
import {
  ToolsIndex,
  toToolsIndexEntry,
  type ToolsIndexEntry,
  type ToolsIndexStats,
} from './index.js';
import {
  SchemaConverter,
  toValidationResult,
  type ValidationIssue,
  type ValidationResult,
} from './retrieval.js';

/**
 * The event names emitted by {@link ToolsLifecycle}.
 */
export type ToolsLifecycleEvent =
  | 'registered'
  | 'unregistered'
  | 'validated'
  | 'pruned'
  | 'cleared'
  | 'start'
  | 'stop';

/**
 * Configuration options for {@link ToolsLifecycle}.
 */
export interface ToolsLifecycleOptions {
  /**
   * Optional pre-built registry to adopt instead of creating a fresh one
   * (e.g. to resume from a persisted snapshot).
   */
  readonly registry?: ToolsRegistry;
  /**
   * Optional pre-built index to adopt instead of creating a fresh one.
   */
  readonly index?: ToolsIndex;
  /**
   * Optional schema converter to adopt instead of creating a fresh one.
   */
  readonly converter?: SchemaConverter;
  /**
   * Retention cap for tools; the oldest registrations are pruned beyond this.
   * `0` disables the cap. Defaults to `0`.
   */
  readonly maxTools?: number;
  /**
   * Retention cap for resources; the oldest registrations are pruned beyond
   * this. `0` disables the cap. Defaults to `0`.
   */
  readonly maxResources?: number;
  /**
   * Retention cap for prompts; the oldest registrations are pruned beyond this.
   * `0` disables the cap. Defaults to `0`.
   */
  readonly maxPrompts?: number;
  /**
   * Maximum age (ms) a registration may live before GC considers it stale.
   * `0` disables age-based eviction. Defaults to `0`.
   */
  readonly maxAgeMs?: number;
  /**
   * Interval (ms) between periodic GC passes. `0` disables the timer entirely;
   * GC can still be triggered manually via {@link ToolsLifecycle.gc}. Defaults
   * to `30_000`.
   */
  readonly gcIntervalMs?: number;
  /**
   * Start the periodic GC timer immediately upon construction. Defaults to
   * `false`; call {@link ToolsLifecycle.start} explicitly.
   */
  readonly autoStart?: boolean;
  /**
   * Whether registrations are mirrored into the index. Defaults to `true`.
   */
  readonly autoIndex?: boolean;
  /**
   * Whether structural validation runs on every registration. Defaults to
   * `true`.
   */
  readonly validateOnRegister?: boolean;
}

/**
 * A point-in-time snapshot of the lifecycle's operational state.
 */
export interface ToolsLifecycleStats {
  /** Whether the periodic GC timer is currently running. */
  readonly running: boolean;
  /** Epoch ms at which the lifecycle was constructed. */
  readonly createdAt: number;
  /** Epoch ms of the most recent `start()`, or `undefined` when never started. */
  readonly startedAt?: number;
  /** Epoch ms of the most recent `stop()`, or `undefined` when never stopped. */
  readonly stoppedAt?: number;
  /** Number of times the lifecycle has been started. */
  readonly startCount: number;
  /** Number of `prune()`/`gc()` passes that actually removed entries. */
  readonly pruneCount: number;
  /** Total number of entries removed by pruning/GC. */
  readonly prunedTotal: number;
  /** Total number of registrations observed. */
  readonly registered: number;
  /** Total number of unregistrations observed. */
  readonly unregistered: number;
  /** Total number of argument-validation runs. */
  readonly validated: number;
  /** Total number of argument-validation failures. */
  readonly validationFailures: number;
  /** The configured GC interval, in milliseconds. */
  readonly gcIntervalMs: number;
  /** The configured tool retention cap. */
  readonly maxTools: number;
  /** The configured resource retention cap. */
  readonly maxResources: number;
  /** The configured prompt retention cap. */
  readonly maxPrompts: number;
  /** The configured maximum registration age, in milliseconds. */
  readonly maxAgeMs: number;
  /** Registry statistics. */
  readonly registry: ToolsRegistryStats;
  /** Index statistics. */
  readonly index: ToolsIndexStats;
}

/**
 * Manages the tools registry, the tools index, argument validation, periodic
 * GC and typed events for a server's MCP Tools layer.
 *
 * The class extends `EventEmitter` and is safe to `stop()` and re-`start()`
 * repeatedly. It is designed to be the single owner of registry/index
 * mutation: external code should go through `register*`/`unregister*`/
 * `prune`/`clear`/`reset` so that the index and events always stay consistent.
 */
export class ToolsLifecycle extends EventEmitter {
  /** The underlying tools registry. */
  private readonly _registry: ToolsRegistry;
  /** The lookup index kept in lock-step with the registry. */
  private readonly _index: ToolsIndex;
  /** The schema converter used for argument validation. */
  private readonly _converter: SchemaConverter;

  /** Tool retention cap for automatic pruning. */
  private readonly _maxTools: number;
  /** Resource retention cap for automatic pruning. */
  private readonly _maxResources: number;
  /** Prompt retention cap for automatic pruning. */
  private readonly _maxPrompts: number;
  /** Maximum registration age before GC considers it stale. */
  private readonly _maxAgeMs: number;
  /** Periodic GC interval, milliseconds. `0` disables the timer. */
  private readonly _gcIntervalMs: number;
  /** Whether registrations are mirrored into the index. */
  private readonly _autoIndex: boolean;

  /** Timer handle for the periodic GC pass, when running. */
  private _timer: ReturnType<typeof setInterval> | undefined;
  /** Whether the periodic GC is active. */
  private _running = false;
  /** Creation timestamp. */
  private readonly _createdAt: number;
  /** Timestamp of the most recent `start()`. */
  private _startedAt: number | undefined;
  /** Timestamp of the most recent `stop()`. */
  private _stoppedAt: number | undefined;
  /** Number of `start()` calls. */
  private _startCount = 0;
  /** Number of pruning passes that actually removed entries. */
  private _pruneCount = 0;
  /** Total entries removed by pruning/GC. */
  private _prunedTotal = 0;
  /** Total registrations observed. */
  private _registered = 0;
  /** Total unregistrations observed. */
  private _unregistered = 0;
  /** Total argument-validation runs. */
  private _validated = 0;
  /** Total argument-validation failures. */
  private _validationFailures = 0;

  /**
   * Create a lifecycle, optionally adopting an existing registry/index/
   * converter and starting the periodic GC timer immediately.
   *
   * @param options - configuration; see {@link ToolsLifecycleOptions}.
   */
  constructor(options: ToolsLifecycleOptions = {}) {
    super();
    this._registry = options.registry ?? new ToolsRegistry();
    this._index = options.index ?? new ToolsIndex();
    this._converter = options.converter ?? new SchemaConverter();
    this._maxTools = options.maxTools ?? 0;
    this._maxResources = options.maxResources ?? 0;
    this._maxPrompts = options.maxPrompts ?? 0;
    this._maxAgeMs = options.maxAgeMs ?? 0;
    this._gcIntervalMs = options.gcIntervalMs ?? 30_000;
    this._autoIndex = options.autoIndex ?? true;
    this._createdAt = Date.now();

    if (this._registry.size() > 0) {
      this._rebuildIndexFromRegistry();
    }
    if (options.autoStart === true) {
      this.start();
    }
  }

  /**
   * The underlying {@link ToolsRegistry}.
   *
   * @returns the registry.
   */
  get registry(): ToolsRegistry {
    return this._registry;
  }

  /**
   * The underlying {@link ToolsIndex}.
   *
   * @returns the index.
   */
  get index(): ToolsIndex {
    return this._index;
  }

  /**
   * The underlying {@link SchemaConverter}.
   *
   * @returns the converter.
   */
  get converter(): SchemaConverter {
    return this._converter;
  }

  /**
   * Whether the periodic GC timer is currently running.
   *
   * @returns `true` when running.
   */
  get running(): boolean {
    return this._running;
  }

  /**
   * Start the periodic GC timer (no-op when already running, or when
   * `gcIntervalMs` is `0`). Emits the `start` event.
   *
   * @returns `this` for chaining.
   */
  start(): this {
    if (this._running) {
      return this;
    }
    this._running = true;
    this._startCount += 1;
    this._startedAt = Date.now();
    if (this._gcIntervalMs > 0) {
      const timer = setInterval(() => {
        this.gc();
      }, this._gcIntervalMs);
      if (typeof timer === 'object' && typeof timer.unref === 'function') {
        timer.unref();
      }
      this._timer = timer;
    }
    this.emit('start');
    return this;
  }

  /**
   * Stop the periodic GC timer (no-op when not running). Emits the `stop`
   * event.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (!this._running) {
      return this;
    }
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    this._running = false;
    this._stoppedAt = Date.now();
    this.emit('stop');
    return this;
  }

  /**
   * Register a tool. Mirrors the registration into the index and emits the
   * `registered` event.
   *
   * @param tool - the tool to register.
   * @param options - optional per-call controls (`overwrite`, `validate`,
   *   `index`).
   * @returns the stored entry wrapper.
   */
  registerTool(tool: McpTool, options: Partial<RegisterOptions> = {}): RegisteredEntry<McpTool> {
    const resolved = createRegisterOptions(options);
    const entry = this._registry.registerTool(tool, resolved);
    if (resolved.index && this._autoIndex) {
      this._indexEntry('tool', entry.key, entry.value);
    }
    this._registered += 1;
    this.emit('registered', 'tool', entry.key, entry.value);
    return entry;
  }

  /**
   * Register a resource. Mirrors the registration into the index and emits the
   * `registered` event.
   *
   * @param resource - the resource to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   */
  registerResource(
    resource: McpResource,
    options: Partial<RegisterOptions> = {},
  ): RegisteredEntry<McpResource> {
    const resolved = createRegisterOptions(options);
    const entry = this._registry.registerResource(resource, resolved);
    if (resolved.index && this._autoIndex) {
      this._indexEntry('resource', entry.key, entry.value);
    }
    this._registered += 1;
    this.emit('registered', 'resource', entry.key, entry.value);
    return entry;
  }

  /**
   * Register a prompt. Mirrors the registration into the index and emits the
   * `registered` event.
   *
   * @param prompt - the prompt to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   */
  registerPrompt(
    prompt: McpPrompt,
    options: Partial<RegisterOptions> = {},
  ): RegisteredEntry<McpPrompt> {
    const resolved = createRegisterOptions(options);
    const entry = this._registry.registerPrompt(prompt, resolved);
    if (resolved.index && this._autoIndex) {
      this._indexEntry('prompt', entry.key, entry.value);
    }
    this._registered += 1;
    this.emit('registered', 'prompt', entry.key, entry.value);
    return entry;
  }

  /**
   * Register a primitive of any kind. Convenience for mixed iterables.
   *
   * @param value - the primitive to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   */
  register(value: McpRegistrable, options: Partial<RegisterOptions> = {}): RegisteredEntry<McpRegistrable> {
    const kind = kindOf(value);
    switch (kind) {
      case 'tool':
        return this.registerTool(value as McpTool, options);
      case 'resource':
        return this.registerResource(value as McpResource, options);
      case 'prompt':
        return this.registerPrompt(value as McpPrompt, options);
    }
  }

  /**
   * Unregister a tool, removing its index entry and emitting the
   * `unregistered` event.
   *
   * @param name - the tool name.
   * @returns the removed tool, or `undefined` when absent.
   */
  unregisterTool(name: string): McpTool | undefined {
    const removed = this._registry.unregisterTool(name);
    if (removed !== undefined) {
      this._index.removeByKey(name);
      this._unregistered += 1;
      this.emit('unregistered', 'tool', name, removed);
    }
    return removed;
  }

  /**
   * Unregister a resource, removing its index entry and emitting the
   * `unregistered` event.
   *
   * @param uri - the resource URI.
   * @returns the removed resource, or `undefined` when absent.
   */
  unregisterResource(uri: string): McpResource | undefined {
    const removed = this._registry.unregisterResource(uri);
    if (removed !== undefined) {
      this._index.removeByKey(uri);
      this._unregistered += 1;
      this.emit('unregistered', 'resource', uri, removed);
    }
    return removed;
  }

  /**
   * Unregister a prompt, removing its index entry and emitting the
   * `unregistered` event.
   *
   * @param name - the prompt name.
   * @returns the removed prompt, or `undefined` when absent.
   */
  unregisterPrompt(name: string): McpPrompt | undefined {
    const removed = this._registry.unregisterPrompt(name);
    if (removed !== undefined) {
      this._index.removeByKey(name);
      this._unregistered += 1;
      this.emit('unregistered', 'prompt', name, removed);
    }
    return removed;
  }

  /**
   * Unregister a primitive of any kind by its canonical key.
   *
   * @param kind - the kind to remove from.
   * @param key - the canonical key (name for tools/prompts, URI for resources).
   * @returns the removed primitive, or `undefined` when absent.
   */
  unregister(kind: ToolKind, key: string): McpRegistrable | undefined {
    switch (kind) {
      case 'tool':
        return this.unregisterTool(key);
      case 'resource':
        return this.unregisterResource(key);
      case 'prompt':
        return this.unregisterPrompt(key);
    }
  }

  /**
   * Validate call arguments against a JSON Schema, emit the `validated` event
   * and return a structured result. The lifecycle is deliberately never
   * throwing for *validation* failures — callers decide what to do with the
   * issues.
   *
   * @param schema - the JSON Schema to validate against.
   * @param args - the caller-supplied argument object.
   * @returns a structured {@link ValidationResult}.
   */
  validateArgs(schema: JsonSchema, args: unknown): ValidationResult {
    const issues = this._converter.validateArgs(schema, args);
    const result = toValidationResult(issues);
    this._validated += 1;
    if (!result.ok) {
      this._validationFailures += 1;
    }
    this.emit('validated', result, schema);
    return result;
  }

  /**
   * Convenience: validate tool call arguments against the tool's own
   * `inputSchema` and emit the `validated` event.
   *
   * @param tool - the tool being called.
   * @param args - the caller-supplied argument object.
   * @returns a structured {@link ValidationResult}.
   */
  validateToolArgs(tool: McpTool, args: unknown): ValidationResult {
    return this.validateArgs(tool.inputSchema, args);
  }

  /**
   * Prune registrations whose canonical key (tool/prompt name or resource URI)
   * is listed. Keeps the index consistent and emits the `pruned` event when
   * entries were removed.
   *
   * @param names - the canonical keys to prune.
   * @returns the number of removed entries.
   */
  prune(names: Iterable<string>): number {
    const removed = this._registry.prune(names);
    if (removed > 0) {
      this._index.rebuild(this._indexEntriesFromRegistry());
      this._pruneCount += 1;
      this._prunedTotal += removed;
      this.emit('pruned', removed, this._registry.size());
    }
    return removed;
  }

  /**
   * Run one garbage-collection pass. Enforces the per-kind retention caps and
   * the maximum registration age, evicting the oldest entries first. Safe to
   * call at any time; the periodic timer calls this on its interval.
   *
   * @returns the number of removed entries.
   */
  gc(): number {
    const now = Date.now();
    const toRemove: string[] = [];

    const caps: ReadonlyArray<readonly [ToolKind, number]> = [
      ['tool', this._maxTools],
      ['resource', this._maxResources],
      ['prompt', this._maxPrompts],
    ];
    for (const [kind, cap] of caps) {
      if (cap <= 0) {
        continue;
      }
      const entries = [...this._registry]
        .filter((entry) => entry.kind === kind)
        .sort((a, b) => a.registeredAt - b.registeredAt);
      const excess = entries.length - cap;
      for (let index = 0; index < excess; index += 1) {
        toRemove.push(entries[index].key);
      }
    }

    if (this._maxAgeMs > 0) {
      for (const entry of this._registry) {
        if (now - entry.registeredAt > this._maxAgeMs) {
          toRemove.push(entry.key);
        }
      }
    }

    if (toRemove.length === 0) {
      return 0;
    }
    return this.prune(toRemove);
  }

  /**
   * Clear the registry and the index. Statistics counters are preserved; only
   * the stored primitives are dropped. Emits the `cleared` event.
   */
  clear(): void {
    const removed = this._registry.size();
    this._registry.clear();
    this._index.clear();
    this.emit('cleared', removed);
  }

  /**
   * Full reset: clear the registry/index and re-seed from an optional set of
   * primitives.
   *
   * @param entries - optional primitives to seed the reset registry with.
   */
  reset(entries?: Iterable<McpRegistrable>): void {
    this.clear();
    if (entries !== undefined) {
      for (const value of entries) {
        this.register(value);
      }
    }
  }

  /**
   * Look up a tool by name.
   *
   * @param name - the tool name.
   * @returns the tool, or `undefined` when absent.
   */
  getTool(name: string): McpTool | undefined {
    return this._registry.getTool(name);
  }

  /**
   * Look up a resource by URI.
   *
   * @param uri - the resource URI.
   * @returns the resource, or `undefined` when absent.
   */
  getResource(uri: string): McpResource | undefined {
    return this._registry.getResource(uri);
  }

  /**
   * Look up a prompt by name.
   *
   * @param name - the prompt name.
   * @returns the prompt, or `undefined` when absent.
   */
  getPrompt(name: string): McpPrompt | undefined {
    return this._registry.getPrompt(name);
  }

  /**
   * Every registered tool.
   *
   * @returns an array of all registered tools.
   */
  listTools(): McpTool[] {
    return this._registry.listTools();
  }

  /**
   * Every registered resource.
   *
   * @returns an array of all registered resources.
   */
  listResources(): McpResource[] {
    return this._registry.listResources();
  }

  /**
   * Every registered prompt.
   *
   * @returns an array of all registered prompts.
   */
  listPrompts(): McpPrompt[] {
    return this._registry.listPrompts();
  }

  /**
   * Total number of registered primitives.
   *
   * @returns the registry size.
   */
  size(): number {
    return this._registry.size();
  }

  /**
   * Aggregate operational statistics.
   *
   * @returns a {@link ToolsLifecycleStats} snapshot.
   */
  stats(): ToolsLifecycleStats {
    return {
      running: this._running,
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      stoppedAt: this._stoppedAt,
      startCount: this._startCount,
      pruneCount: this._pruneCount,
      prunedTotal: this._prunedTotal,
      registered: this._registered,
      unregistered: this._unregistered,
      validated: this._validated,
      validationFailures: this._validationFailures,
      gcIntervalMs: this._gcIntervalMs,
      maxTools: this._maxTools,
      maxResources: this._maxResources,
      maxPrompts: this._maxPrompts,
      maxAgeMs: this._maxAgeMs,
      registry: this._registry.stats(),
      index: this._index.stats(),
    };
  }

  /**
   * Tear the lifecycle down: stop the timer and clear all state. Equivalent to
   * `stop()` followed by {@link ToolsLifecycle.clear}.
   */
  dispose(): void {
    this.stop();
    this.clear();
  }

  /**
   * Internal helper: mirror a registration into the index.
   *
   * @param kind - the kind of the primitive.
   * @param key - the canonical registry key.
   * @param value - the registered primitive.
   */
  private _indexEntry(kind: ToolKind, key: string, value: McpRegistrable): void {
    const name = kind === 'resource' ? (value as McpResource).name : (value as McpTool | McpPrompt).name;
    const uri = kind === 'resource' ? key : undefined;
    this._index.indexEntry(toToolsIndexEntry(kind, name, uri));
  }

  /**
   * Internal helper: derive index entries for every entry in the registry.
   * Used to resync the index after bulk pruning.
   *
   * @returns an array of index entries.
   */
  private _indexEntriesFromRegistry(): ToolsIndexEntry[] {
    const entries: ToolsIndexEntry[] = [];
    for (const stored of this._registry) {
      const name =
        stored.kind === 'resource'
          ? (stored.value as McpResource).name
          : (stored.value as McpTool | McpPrompt).name;
      const uri = stored.kind === 'resource' ? stored.key : undefined;
      entries.push(toToolsIndexEntry(stored.kind, name, uri, stored.registeredAt));
    }
    return entries;
  }

  /**
   * Rebuild the index from the current registry contents. Called once in the
   * constructor when a pre-populated registry is adopted.
   */
  private _rebuildIndexFromRegistry(): void {
    this._index.rebuild(this._indexEntriesFromRegistry());
  }

  /**
   * Typed hook for the `registered` event.
   *
   * @param listener - callback receiving the kind, the canonical key and the
   *   registered primitive.
   * @returns `this` for chaining.
   */
  onRegistered(
    listener: (kind: ToolKind, key: string, value: McpRegistrable) => void,
  ): this {
    return this.on('registered', listener);
  }

  /**
   * Typed hook for the `unregistered` event.
   *
   * @param listener - callback receiving the kind, the canonical key and the
   *   removed primitive.
   * @returns `this` for chaining.
   */
  onUnregistered(
    listener: (kind: ToolKind, key: string, value: McpRegistrable) => void,
  ): this {
    return this.on('unregistered', listener);
  }

  /**
   * Typed hook for the `validated` event.
   *
   * @param listener - callback receiving the validation result and the schema
   *   it was validated against.
   * @returns `this` for chaining.
   */
  onValidated(listener: (result: ValidationResult, schema: JsonSchema) => void): this {
    return this.on('validated', listener);
  }

  /**
   * Typed hook for the `pruned` event.
   *
   * @param listener - callback receiving the removed count and the remaining
   *   count.
   * @returns `this` for chaining.
   */
  onPruned(listener: (removed: number, remaining: number) => void): this {
    return this.on('pruned', listener);
  }

  /**
   * Typed hook for the `cleared` event.
   *
   * @param listener - callback receiving the number of removed primitives.
   * @returns `this` for chaining.
   */
  onCleared(listener: (removed: number) => void): this {
    return this.on('cleared', listener);
  }

  /**
   * Typed hook for the `start` event.
   *
   * @param listener - callback invoked when the periodic GC starts.
   * @returns `this` for chaining.
   */
  onStart(listener: () => void): this {
    return this.on('start', listener);
  }

  /**
   * Typed hook for the `stop` event.
   *
   * @param listener - callback invoked when the periodic GC stops.
   * @returns `this` for chaining.
   */
  onStop(listener: () => void): this {
    return this.on('stop', listener);
  }

  // ---- Typed EventEmitter overloads --------------------------------------

  /**
   * Register a listener for a lifecycle event.
   *
   * @param event - the event name.
   * @param listener - the callback.
   * @returns `this` for chaining.
   */
  override on(
    event: 'registered',
    listener: (kind: ToolKind, key: string, value: McpRegistrable) => void,
  ): this;
  override on(
    event: 'unregistered',
    listener: (kind: ToolKind, key: string, value: McpRegistrable) => void,
  ): this;
  override on(
    event: 'validated',
    listener: (result: ValidationResult, schema: JsonSchema) => void,
  ): this;
  override on(event: 'pruned', listener: (removed: number, remaining: number) => void): this;
  override on(event: 'cleared', listener: (removed: number) => void): this;
  override on(event: 'start' | 'stop', listener: () => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  /**
   * Emit a lifecycle event.
   *
   * @param event - the event name.
   * @param args - event payload arguments.
   * @returns `true` when the event had listeners.
   */
  override emit(
    event: 'registered',
    kind: ToolKind,
    key: string,
    value: McpRegistrable,
  ): boolean;
  override emit(
    event: 'unregistered',
    kind: ToolKind,
    key: string,
    value: McpRegistrable,
  ): boolean;
  override emit(event: 'validated', result: ValidationResult, schema: JsonSchema): boolean;
  override emit(event: 'pruned', removed: number, remaining: number): boolean;
  override emit(event: 'cleared', removed: number): boolean;
  override emit(event: 'start' | 'stop'): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean;
  override emit(event: string | symbol, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
}

/**
 * Convenience factory: create a fully configured {@link ToolsLifecycle}.
 *
 * @param options - optional lifecycle configuration.
 * @returns a new lifecycle.
 */
export function createToolsLifecycle(options: ToolsLifecycleOptions = {}): ToolsLifecycle {
  return new ToolsLifecycle(options);
}

/**
 * Validate a lifecycle event name.
 *
 * @param value - the event name to validate.
 * @returns `true` when `value` is a known tools-lifecycle event.
 */
export function isToolsLifecycleEvent(value: unknown): value is ToolsLifecycleEvent {
  return (
    typeof value === 'string' &&
    (TOOLS_LIFECYCLE_EVENTS as readonly string[]).indexOf(value) !== -1
  );
}

/**
 * All {@link ToolsLifecycleEvent} names in a stable order.
 */
export const TOOLS_LIFECYCLE_EVENTS: readonly ToolsLifecycleEvent[] = [
  'registered',
  'unregistered',
  'validated',
  'pruned',
  'cleared',
  'start',
  'stop',
] as const;

/**
 * Build a `registered`-style event payload tuple for manual emission from
 * integrations that re-route lifecycle events. Useful for testing and proxies.
 *
 * @param kind - the kind of the primitive.
 * @param key - the canonical key.
 * @param value - the primitive.
 * @returns a payload tuple matching the `registered`/`unregistered` events.
 */
export function toRegisteredPayload(
  kind: ToolKind,
  key: string,
  value: McpRegistrable,
): readonly [ToolKind, string, McpRegistrable] {
  if (!isToolKind(kind)) {
    throw new TypeError(`toRegisteredPayload: unknown kind "${String(kind)}"`);
  }
  return [kind, key, value];
}

/**
 * Combine a list of validation issues into a {@link ValidationResult} and, when
 * the lifecycle is unavailable, still give callers a consistent gate. Thin
 * re-export of {@link toValidationResult} for lifecycle consumers.
 *
 * @param issues - the issues found.
 * @returns a structured validation result.
 */
export function issuesToResult(issues: readonly ValidationIssue[]): ValidationResult {
  return toValidationResult(issues);
}

/**
 * The complete set of known {@link ToolKind} values, re-exported for lifecycle
 * consumers that iterate kinds without importing from `types.ts`.
 */
export const LIFECYCLE_KINDS: readonly ToolKind[] = TOOL_KINDS;