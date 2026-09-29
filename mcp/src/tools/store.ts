/**
 * store.ts
 *
 * `ToolsRegistry`: the authoritative, in-memory registry for MCP tools,
 * resources and prompts.
 *
 * The registry is the single place where {@link McpTool}, {@link McpResource}
 * and {@link McpPrompt} primitives are stored and looked up. It keeps three
 * name/uri-keyed maps (one per {@link ToolKind}), tracks per-entry bookkeeping
 * (registration timestamps, mutation history), exposes list/get/has/keys/clear
 * semantics for each kind, computes aggregate statistics, and can round-trip
 * its entire contents through a JSON snapshot for persistence, crash recovery
 * or test fixtures.
 *
 * The registry is deliberately dependency-light (it imports only the shared
 * `types.ts` module) and deliberately *silent*: it does not emit events or run
 * timers. Cross-cutting concerns such as indexing, validation, pruning and
 * observability belong to the {@link ToolsLifecycle} layer in `lifecycle.ts`,
 * which adopts a registry and keeps an index in lock-step with it.
 *
 * Typical usage:
 *
 * ```ts
 * const registry = new ToolsRegistry();
 * registry.registerTool(createTool('echo', { type: 'object', properties: {} }));
 * registry.registerResource(createResource('file:///a.txt', 'A file'));
 * registry.registerPrompt(createPrompt('greet'));
 * registry.listTools();              // [McpTool]
 * registry.hasResource('file:///a.txt'); // true
 * registry.size();                   // 3
 * const clone = ToolsRegistry.fromJSON(registry.toJSON());
 * ```
 *
 * @module tools/store
 */

import {
  TOOL_KINDS,
  canonicalKey,
  createRegisterOptions,
  estimateRegistrableBytes,
  isMcpPrompt,
  isMcpRegistrable,
  isMcpResource,
  isMcpTool,
  isPlainObject,
  isToolKind,
  keyOf,
  kindOf,
  type McpPrompt,
  type McpRegistrable,
  type McpResource,
  type McpTool,
  type RegisterOptions,
  type ToolKind,
  type ToolsStats,
} from './types.js';

/**
 * The version tag written into {@link ToolsRegistryJSON} payloads. Bump this
 * whenever the serialized shape changes so older snapshots can be migrated.
 */
export const REGISTRY_JSON_VERSION = 1 as const;

/**
 * A single stored primitive together with its registry bookkeeping.
 *
 * The registry never exposes this wrapper directly — list/get methods return
 * the bare {@link McpRegistrable} value — but snapshots (and the internal
 * maps) need the timestamps so that GC and LRU-style eviction can work.
 */
export interface RegisteredEntry<T extends McpRegistrable> {
  /** The kind of the stored primitive. */
  readonly kind: ToolKind;
  /** The canonical registry key (name for tools/prompts, URI for resources). */
  readonly key: string;
  /** Epoch ms at which the entry was first registered. */
  readonly registeredAt: number;
  /** Epoch ms of the most recent overwrite (equal to `registeredAt` initially). */
  readonly updatedAt: number;
  /** The stored primitive value. */
  readonly value: T;
}

/**
 * Serializable snapshot of a registry, produced by {@link ToolsRegistry.toJSON}
 * and consumed by {@link ToolsRegistry.fromJSON}.
 */
export interface ToolsRegistryJSON {
  /** Schema version of this snapshot. */
  readonly version: typeof REGISTRY_JSON_VERSION;
  /** Total number of registrations recorded by the source registry. */
  readonly registered: number;
  /** Total number of unregistrations recorded by the source registry. */
  readonly unregistered: number;
  /** Total number of primitives pruned by the source registry. */
  readonly pruned: number;
  /** Epoch ms at which the source registry was created. */
  readonly createdAt: number;
  /** The stored entries, keyed by canonical key. */
  readonly entries: Readonly<Record<string, RegisteredEntry<McpRegistrable>>>;
}

/**
 * Aggregate statistics describing the current contents of a registry.
 */
export interface ToolsRegistryStats {
  /** Number of registered tools. */
  readonly tools: number;
  /** Number of registered resources. */
  readonly resources: number;
  /** Number of registered prompts. */
  readonly prompts: number;
  /** Total number of registered primitives. */
  readonly total: number;
  /** Total registrations since construction (including overwrites). */
  readonly registered: number;
  /** Total unregistrations since construction. */
  readonly unregistered: number;
  /** Total primitives removed by pruning. */
  readonly pruned: number;
  /** Approximate serialized byte size of all stored primitives. */
  readonly approximateBytes: number;
  /** Epoch ms at which the registry was created. */
  readonly createdAt: number;
  /** Epoch ms of the most recent mutation, or `undefined` when untouched. */
  readonly lastUpdated?: number;
  /** Per-kind entry counts. */
  readonly byKind: Readonly<Record<ToolKind, number>>;
}

/**
 * Build a {@link RegisteredEntry} wrapper for a primitive.
 *
 * @param kind - the kind of the primitive.
 * @param key - the canonical registry key.
 * @param value - the primitive value.
 * @param now - the timestamp to stamp (defaults to `Date.now()`).
 * @returns a complete registered entry.
 */
export function toRegisteredEntry<T extends McpRegistrable>(
  kind: ToolKind,
  key: string,
  value: T,
  now: number = Date.now(),
): RegisteredEntry<T> {
  return { kind, key, registeredAt: now, updatedAt: now, value };
}

/**
 * The authoritative in-memory registry for MCP tools, resources and prompts.
 *
 * All mutation methods validate their inputs before storing and throw
 * {@link TypeError} for malformed primitives or unknown kinds. Registration
 * over an existing key throws a {@link DuplicateKeyError} unless the caller
 * passes `overwrite: true` (see {@link RegisterOptions}).
 *
 * The class is intentionally synchronous, dependency-free and event-free; pair
 * it with `ToolsIndex` (fast lookups) and `ToolsLifecycle` (GC + events) for a
 * complete Tools layer.
 */
export class ToolsRegistry {
  /** Tool registrations keyed by tool name. */
  private readonly _tools = new Map<string, RegisteredEntry<McpTool>>();
  /** Resource registrations keyed by resource URI. */
  private readonly _resources = new Map<string, RegisteredEntry<McpResource>>();
  /** Prompt registrations keyed by prompt name. */
  private readonly _prompts = new Map<string, RegisteredEntry<McpPrompt>>();

  /** Total registrations since construction. */
  private _registered = 0;
  /** Total unregistrations since construction. */
  private _unregistered = 0;
  /** Total pruned entries since construction. */
  private _pruned = 0;
  /** Approximate byte size of all stored primitives. */
  private _approximateBytes = 0;
  /** Creation timestamp. */
  private readonly _createdAt: number;
  /** Timestamp of the most recent mutation. */
  private _lastUpdated: number | undefined;

  /**
   * Create an empty registry, optionally seeding it from existing entries.
   *
   * @param initial - an iterable of primitives (their kinds are inferred), or a
   *   full {@link ToolsRegistryJSON} snapshot. When omitted the registry starts
   *   empty.
   */
  constructor(initial?: Iterable<McpRegistrable> | ToolsRegistryJSON) {
    this._createdAt = Date.now();
    if (initial === undefined) {
      return;
    }
    if (isToolsRegistryJSON(initial)) {
      this._restore(initial);
      return;
    }
    for (const value of initial) {
      this.register(value);
    }
  }

  /**
   * Register a tool. Overwrites are rejected by default.
   *
   * @param tool - the tool to register.
   * @param options - optional per-call controls (see {@link RegisterOptions}).
   * @returns the stored entry wrapper.
   * @throws {@link TypeError} when `tool` is malformed.
   * @throws {@link DuplicateKeyError} when a tool with the same name is already
   *   registered and `options.overwrite` is not `true`.
   */
  registerTool(tool: McpTool, options: Partial<RegisterOptions> = {}): RegisteredEntry<McpTool> {
    const resolved = createRegisterOptions(options);
    if (resolved.validate && !isMcpTool(tool)) {
      throw new TypeError(`ToolsRegistry: invalid tool "${String((tool as { name?: unknown })?.name)}"`);
    }
    const key = canonicalKey('tool', tool.name);
    const now = Date.now();
    if (this._tools.has(key)) {
      if (!resolved.overwrite) {
        throw new DuplicateKeyError('tool', key);
      }
      this._approximateBytes -= estimateRegistrableBytes(this._tools.get(key)!.value);
    }
    this._tools.set(key, { kind: 'tool', key, registeredAt: now, updatedAt: now, value: tool });
    this._registered += 1;
    this._lastUpdated = now;
    this._approximateBytes += estimateRegistrableBytes(tool);
    return this._tools.get(key)!;
  }

  /**
   * Register a resource. Overwrites are rejected by default.
   *
   * @param resource - the resource to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   * @throws {@link TypeError} when `resource` is malformed.
   * @throws {@link DuplicateKeyError} when a resource with the same URI is
   *   already registered and `options.overwrite` is not `true`.
   */
  registerResource(
    resource: McpResource,
    options: Partial<RegisterOptions> = {},
  ): RegisteredEntry<McpResource> {
    const resolved = createRegisterOptions(options);
    if (resolved.validate && !isMcpResource(resource)) {
      throw new TypeError(`ToolsRegistry: invalid resource "${String((resource as { uri?: unknown })?.uri)}"`);
    }
    const key = canonicalKey('resource', resource.uri);
    const now = Date.now();
    if (this._resources.has(key)) {
      if (!resolved.overwrite) {
        throw new DuplicateKeyError('resource', key);
      }
      this._approximateBytes -= estimateRegistrableBytes(this._resources.get(key)!.value);
    }
    this._resources.set(key, { kind: 'resource', key, registeredAt: now, updatedAt: now, value: resource });
    this._registered += 1;
    this._lastUpdated = now;
    this._approximateBytes += estimateRegistrableBytes(resource);
    return this._resources.get(key)!;
  }

  /**
   * Register a prompt. Overwrites are rejected by default.
   *
   * @param prompt - the prompt to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   * @throws {@link TypeError} when `prompt` is malformed.
   * @throws {@link DuplicateKeyError} when a prompt with the same name is
   *   already registered and `options.overwrite` is not `true`.
   */
  registerPrompt(
    prompt: McpPrompt,
    options: Partial<RegisterOptions> = {},
  ): RegisteredEntry<McpPrompt> {
    const resolved = createRegisterOptions(options);
    if (resolved.validate && !isMcpPrompt(prompt)) {
      throw new TypeError(`ToolsRegistry: invalid prompt "${String((prompt as { name?: unknown })?.name)}"`);
    }
    const key = canonicalKey('prompt', prompt.name);
    const now = Date.now();
    if (this._prompts.has(key)) {
      if (!resolved.overwrite) {
        throw new DuplicateKeyError('prompt', key);
      }
      this._approximateBytes -= estimateRegistrableBytes(this._prompts.get(key)!.value);
    }
    this._prompts.set(key, { kind: 'prompt', key, registeredAt: now, updatedAt: now, value: prompt });
    this._registered += 1;
    this._lastUpdated = now;
    this._approximateBytes += estimateRegistrableBytes(prompt);
    return this._prompts.get(key)!;
  }

  /**
   * Register a primitive of any kind, dispatching on its inferred
   * {@link ToolKind}. Convenience for code that handles mixed iterables.
   *
   * @param value - the primitive to register.
   * @param options - optional per-call controls.
   * @returns the stored entry wrapper.
   * @throws {@link TypeError} when `value` matches none of the three shapes.
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
   * Unregister a tool by name.
   *
   * @param name - the tool name.
   * @returns the removed tool, or `undefined` when absent.
   */
  unregisterTool(name: string): McpTool | undefined {
    const entry = this._tools.get(name);
    if (entry === undefined) {
      return undefined;
    }
    this._tools.delete(name);
    this._unregistered += 1;
    this._lastUpdated = Date.now();
    this._approximateBytes -= estimateRegistrableBytes(entry.value);
    return entry.value;
  }

  /**
   * Unregister a resource by URI.
   *
   * @param uri - the resource URI.
   * @returns the removed resource, or `undefined` when absent.
   */
  unregisterResource(uri: string): McpResource | undefined {
    const entry = this._resources.get(uri);
    if (entry === undefined) {
      return undefined;
    }
    this._resources.delete(uri);
    this._unregistered += 1;
    this._lastUpdated = Date.now();
    this._approximateBytes -= estimateRegistrableBytes(entry.value);
    return entry.value;
  }

  /**
   * Unregister a prompt by name.
   *
   * @param name - the prompt name.
   * @returns the removed prompt, or `undefined` when absent.
   */
  unregisterPrompt(name: string): McpPrompt | undefined {
    const entry = this._prompts.get(name);
    if (entry === undefined) {
      return undefined;
    }
    this._prompts.delete(name);
    this._unregistered += 1;
    this._lastUpdated = Date.now();
    this._approximateBytes -= estimateRegistrableBytes(entry.value);
    return entry.value;
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
   * Look up a tool by name.
   *
   * @param name - the tool name.
   * @returns the tool, or `undefined` when absent.
   */
  getTool(name: string): McpTool | undefined {
    return this._tools.get(name)?.value;
  }

  /**
   * Look up a resource by URI.
   *
   * @param uri - the resource URI.
   * @returns the resource, or `undefined` when absent.
   */
  getResource(uri: string): McpResource | undefined {
    return this._resources.get(uri)?.value;
  }

  /**
   * Look up a prompt by name.
   *
   * @param name - the prompt name.
   * @returns the prompt, or `undefined` when absent.
   */
  getPrompt(name: string): McpPrompt | undefined {
    return this._prompts.get(name)?.value;
  }

  /**
   * Look up a primitive of any kind by its canonical key.
   *
   * @param kind - the kind to look in.
   * @param key - the canonical key.
   * @returns the primitive, or `undefined` when absent.
   */
  get(kind: ToolKind, key: string): McpRegistrable | undefined {
    switch (kind) {
      case 'tool':
        return this.getTool(key);
      case 'resource':
        return this.getResource(key);
      case 'prompt':
        return this.getPrompt(key);
    }
  }

  /**
   * Whether a tool with the given name is registered.
   *
   * @param name - the tool name.
   * @returns `true` when present.
   */
  hasTool(name: string): boolean {
    return this._tools.has(name);
  }

  /**
   * Whether a resource with the given URI is registered.
   *
   * @param uri - the resource URI.
   * @returns `true` when present.
   */
  hasResource(uri: string): boolean {
    return this._resources.has(uri);
  }

  /**
   * Whether a prompt with the given name is registered.
   *
   * @param name - the prompt name.
   * @returns `true` when present.
   */
  hasPrompt(name: string): boolean {
    return this._prompts.has(name);
  }

  /**
   * Whether a primitive of the given kind and key is registered.
   *
   * @param kind - the kind to check.
   * @param key - the canonical key.
   * @returns `true` when present.
   */
  has(kind: ToolKind, key: string): boolean {
    switch (kind) {
      case 'tool':
        return this.hasTool(key);
      case 'resource':
        return this.hasResource(key);
      case 'prompt':
        return this.hasPrompt(key);
    }
  }

  /**
   * Return a defensive copy of every registered tool, in registration order.
   *
   * @returns an array of all registered tools.
   */
  listTools(): McpTool[] {
    return [...this._tools.values()].map((entry) => entry.value);
  }

  /**
   * Return a defensive copy of every registered resource, in registration order.
   *
   * @returns an array of all registered resources.
   */
  listResources(): McpResource[] {
    return [...this._resources.values()].map((entry) => entry.value);
  }

  /**
   * Return a defensive copy of every registered prompt, in registration order.
   *
   * @returns an array of all registered prompts.
   */
  listPrompts(): McpPrompt[] {
    return [...this._prompts.values()].map((entry) => entry.value);
  }

  /**
   * Return every registered primitive of the given kind, in registration order.
   *
   * @param kind - the kind to list.
   * @returns an array of all primitives of that kind.
   * @throws {@link TypeError} for an unknown kind.
   */
  list(kind: ToolKind): McpRegistrable[] {
    if (!isToolKind(kind)) {
      throw new TypeError(`ToolsRegistry: unknown kind "${String(kind)}"`);
    }
    switch (kind) {
      case 'tool':
        return this.listTools();
      case 'resource':
        return this.listResources();
      case 'prompt':
        return this.listPrompts();
    }
  }

  /**
   * Return the canonical keys of every registered primitive, optionally
   * restricted to one kind.
   *
   * @param kind - optional kind to restrict to.
   * @returns the canonical keys in registration order.
   */
  keys(kind?: ToolKind): string[] {
    if (kind !== undefined && !isToolKind(kind)) {
      throw new TypeError(`ToolsRegistry: unknown kind "${String(kind)}"`);
    }
    const out: string[] = [];
    if (kind === undefined || kind === 'tool') {
      out.push(...this._tools.keys());
    }
    if (kind === undefined || kind === 'resource') {
      out.push(...this._resources.keys());
    }
    if (kind === undefined || kind === 'prompt') {
      out.push(...this._prompts.keys());
    }
    return out;
  }

  /**
   * Current number of registered primitives.
   *
   * @returns the total count.
   */
  size(): number {
    return this._tools.size + this._resources.size + this._prompts.size;
  }

  /**
   * Current number of registered primitives of one kind.
   *
   * @param kind - the kind to count.
   * @returns the count for that kind.
   */
  sizeByKind(kind: ToolKind): number {
    switch (kind) {
      case 'tool':
        return this._tools.size;
      case 'resource':
        return this._resources.size;
      case 'prompt':
        return this._prompts.size;
    }
  }

  /**
   * Whether the registry holds no primitives at all.
   *
   * @returns `true` when empty.
   */
  isEmpty(): boolean {
    return this.size() === 0;
  }

  /**
   * Remove a set of entries in bulk by canonical key. Missing keys are ignored.
   *
   * @param keys - the canonical keys to remove (names and/or URIs).
   * @returns the number of removed entries.
   */
  prune(keys: Iterable<string>): number {
    let removed = 0;
    for (const key of keys) {
      if (this._tools.delete(key) || this._resources.delete(key) || this._prompts.delete(key)) {
        removed += 1;
      }
    }
    if (removed > 0) {
      this._pruned += removed;
      this._lastUpdated = Date.now();
      this._recomputeBytes();
    }
    return removed;
  }

  /**
   * Drop every registered primitive. Statistics counters (`registered`,
   * `unregistered`, `pruned`) are preserved — this is a *state* clear, not a
   * history reset.
   */
  clear(): void {
    this._tools.clear();
    this._resources.clear();
    this._prompts.clear();
    this._approximateBytes = 0;
    this._lastUpdated = Date.now();
  }

  /**
   * Compute aggregate statistics about the registry contents.
   *
   * @returns a {@link ToolsRegistryStats} snapshot.
   */
  stats(): ToolsRegistryStats {
    return {
      tools: this._tools.size,
      resources: this._resources.size,
      prompts: this._prompts.size,
      total: this.size(),
      registered: this._registered,
      unregistered: this._unregistered,
      pruned: this._pruned,
      approximateBytes: this._approximateBytes,
      createdAt: this._createdAt,
      lastUpdated: this._lastUpdated,
      byKind: {
        tool: this._tools.size,
        resource: this._resources.size,
        prompt: this._prompts.size,
      },
    };
  }

  /**
   * Convenience: project the registry onto the plain {@link ToolsStats} shape
   * used across the Tools layer (adds validated/pruned/bytes counters with
   * `validated` left at the value supplied).
   *
   * @param validated - the number of validation runs to report (defaults to `0`).
   * @returns a {@link ToolsStats} snapshot.
   */
  toToolsStats(validated = 0): ToolsStats {
    const snapshot = this.stats();
    return {
      tools: snapshot.tools,
      resources: snapshot.resources,
      prompts: snapshot.prompts,
      total: snapshot.total,
      registered: snapshot.registered,
      unregistered: snapshot.unregistered,
      pruned: snapshot.pruned,
      validated,
      validationFailures: 0,
      approximateBytes: snapshot.approximateBytes,
      createdAt: snapshot.createdAt,
      lastUpdated: snapshot.lastUpdated,
    };
  }

  /**
   * Serialize the registry into a plain, JSON-serializable snapshot.
   *
   * @returns the snapshot object.
   */
  toJSON(): ToolsRegistryJSON {
    const entries: Record<string, RegisteredEntry<McpRegistrable>> = {};
    for (const entry of [
      ...this._tools.values(),
      ...this._resources.values(),
      ...this._prompts.values(),
    ]) {
      entries[entry.key] = entry;
    }
    return {
      version: REGISTRY_JSON_VERSION,
      registered: this._registered,
      unregistered: this._unregistered,
      pruned: this._pruned,
      createdAt: this._createdAt,
      entries,
    };
  }

  /**
   * Reconstruct a registry from a snapshot produced by
   * {@link ToolsRegistry.toJSON}.
   *
   * @param json - the snapshot to restore.
   * @returns a new registry seeded with the snapshot's entries.
   * @throws {@link TypeError} when the snapshot is malformed.
   */
  static fromJSON(json: ToolsRegistryJSON): ToolsRegistry {
    const registry = new ToolsRegistry();
    registry._restore(json);
    return registry;
  }

  /**
   * Reconstruct a registry from a JSON string snapshot.
   *
   * @param text - the serialized snapshot.
   * @returns a new registry seeded with the snapshot's entries.
   * @throws {@link TypeError} on invalid JSON or a malformed snapshot shape.
   */
  static fromJSONString(text: string): ToolsRegistry {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new TypeError(`ToolsRegistry: invalid snapshot JSON: ${(err as Error).message}`);
    }
    if (!isToolsRegistryJSON(parsed)) {
      throw new TypeError('ToolsRegistry: snapshot does not match the expected shape');
    }
    return new ToolsRegistry(parsed);
  }

  /**
   * Serialize the registry to a compact JSON string (see
   * {@link ToolsRegistry.toJSON}).
   *
   * @returns the serialized snapshot string.
   */
  toString(): string {
    return JSON.stringify(this.toJSON());
  }

  /**
   * Create an iterable view over all stored entries, registration order across
   * kinds (tools, then resources, then prompts).
   *
   * @returns an iterator over the registered entries.
   */
  [Symbol.iterator](): Iterator<RegisteredEntry<McpRegistrable>> {
    return [...this._tools.values(), ...this._resources.values(), ...this._prompts.values()][
      Symbol.iterator
    ]();
  }

  /**
   * Internal restore path shared by the constructor, `fromJSON` and
   * `fromJSONString`: validate a snapshot and load it wholesale.
   *
   * @param json - the validated snapshot.
   */
  private _restore(json: ToolsRegistryJSON): void {
    this._tools.clear();
    this._resources.clear();
    this._prompts.clear();
    for (const entry of Object.values(json.entries)) {
      if (!isRegisteredEntry(entry)) {
        throw new TypeError('ToolsRegistry: snapshot contains an invalid RegisteredEntry');
      }
      const { kind, key, registeredAt, updatedAt, value } = entry;
      const now = Date.now();
      const stamped = toRegisteredEntry(kind, key, value, now);
      // Preserve the recorded timestamps so GC/age tracking survives a restore.
      (stamped as { registeredAt: number }).registeredAt = registeredAt;
      (stamped as { updatedAt: number }).updatedAt = updatedAt;
      switch (kind) {
        case 'tool':
          if (!isMcpTool(value)) {
            throw new TypeError('ToolsRegistry: snapshot tool entry is not a valid McpTool');
          }
          this._tools.set(key, stamped as RegisteredEntry<McpTool>);
          break;
        case 'resource':
          if (!isMcpResource(value)) {
            throw new TypeError('ToolsRegistry: snapshot resource entry is not a valid McpResource');
          }
          this._resources.set(key, stamped as RegisteredEntry<McpResource>);
          break;
        case 'prompt':
          if (!isMcpPrompt(value)) {
            throw new TypeError('ToolsRegistry: snapshot prompt entry is not a valid McpPrompt');
          }
          this._prompts.set(key, stamped as RegisteredEntry<McpPrompt>);
          break;
      }
    }
    this._registered = json.registered;
    this._unregistered = json.unregistered;
    this._pruned = json.pruned;
    this._lastUpdated = Date.now();
    this._recomputeBytes();
  }

  /**
   * Recompute the approximate byte total from the currently stored entries.
   * Called after bulk removals where per-entry bookkeeping would be wasteful.
   */
  private _recomputeBytes(): void {
    let total = 0;
    for (const entry of this) {
      total += estimateRegistrableBytes(entry.value);
    }
    this._approximateBytes = total;
  }
}

/**
 * Error thrown when registering over an existing canonical key without
 * `overwrite: true`. Carries the kind and the conflicting key so callers can
 * recover programmatically.
 */
export class DuplicateKeyError extends Error {
  /** The kind that collided. */
  readonly kind: ToolKind;
  /** The conflicting canonical key. */
  readonly key: string;

  /**
   * Create a duplicate-key error.
   *
   * @param kind - the kind that collided.
   * @param key - the conflicting canonical key.
   */
  constructor(kind: ToolKind, key: string) {
    super(`ToolsRegistry: a ${kind} with key "${key}" is already registered`);
    this.name = 'DuplicateKeyError';
    this.kind = kind;
    this.key = key;
  }
}

/**
 * Compute the per-kind counts of a registry without materializing a full
 * statistics object. Convenience for lightweight reporting.
 *
 * @param registry - the registry to inspect.
 * @returns a `kind -> count` map.
 */
export function countByKind(registry: ToolsRegistry): Record<ToolKind, number> {
  return { ...registry.stats().byKind };
}

/**
 * Return every stored primitive as a flat array, registration order across
 * kinds. Convenience for iterating values without the entry wrapper.
 *
 * @param registry - the registry to inspect.
 * @returns an array of all registered primitives.
 */
export function allValues(registry: ToolsRegistry): McpRegistrable[] {
  const out: McpRegistrable[] = [];
  for (const entry of registry) {
    out.push(entry.value);
  }
  return out;
}

/**
 * Internal guard: does `value` satisfy the {@link RegisteredEntry} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a registered entry.
 */
function isRegisteredEntry(value: unknown): value is RegisteredEntry<McpRegistrable> {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (!isToolKind(record['kind'])) {
    return false;
  }
  if (typeof record['key'] !== 'string') {
    return false;
  }
  if (typeof record['registeredAt'] !== 'number' || typeof record['updatedAt'] !== 'number') {
    return false;
  }
  if (typeof record['value'] !== 'object' || record['value'] === null) {
    return false;
  }
  return isMcpRegistrable(record['value']);
}

/**
 * Internal guard: does `value` satisfy the {@link ToolsRegistryJSON} shape?
 *
 * @param value - the untrusted value to validate.
 * @returns `true` when the value looks like a registry snapshot.
 */
function isToolsRegistryJSON(value: unknown): value is ToolsRegistryJSON {
  if (!isPlainObject(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record['version'] === REGISTRY_JSON_VERSION &&
    typeof record['registered'] === 'number' &&
    typeof record['unregistered'] === 'number' &&
    typeof record['pruned'] === 'number' &&
    typeof record['createdAt'] === 'number' &&
    isPlainObject(record['entries'])
  );
}