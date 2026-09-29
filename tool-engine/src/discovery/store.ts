/**
 * store.ts
 *
 * The `ToolRegistry` — an in-memory, name-keyed registry of MAM tools.
 *
 * The registry is the authoritative write-side of the Discovery layer. Every
 * tool that is registered lands here first, and the index (`index.ts`),
 * searcher (`retrieval.ts`) and lifecycle (`lifecycle.ts`) components all
 * derive their views from it.
 *
 * Key design decisions:
 *
 *   - Tools are keyed by their `name`, which must be unique. Registering a
 *     tool under an existing name overwrites the previous definition
 *     atomically.
 *   - Optional fields (`tags`, `capabilities`, `metadata`, `parameters`) are
 *     normalised on insertion so downstream consumers never have to guard
 *     against `undefined`.
 *   - The registry exposes a `Map`-compatible surface (`has`, `get`, `keys`,
 *     `size`, `clear`) plus registry-specific operations (`register`,
 *     `unregister`, `registerMany`, `list`, `getSchema`, `hasCapability`,
 *     `stats`).
 *   - Snapshot support via `toJSON` / `fromJSON` lets callers persist the
 *     entire registry to disk and restore it on a later boot. Handlers are
 *     serialised as `null` markers and restored as stubs; tool *metadata* is
 *     fully preserved.
 *
 * This module is self-contained and has no external dependencies beyond Node
 * built-ins.
 */

import {
  type DiscoveryStats,
  type ToolCapability,
  type ToolDefinition,
  type ToolSchema,
  createToolDefinition,
  normalizeToolDefinition,
  toToolSchema,
} from './types.js';

/**
 * Restores a tool definition from a serialised entry where the handler was
 * replaced with a `null` marker. The restored handler is a non-callable stub
 * so that schema queries and indexing still work after a cold restore without
 * silently invoking a missing implementation.
 */
function restoreHandler(
  name: string,
  serializedHandler: unknown,
): (...args: never[]) => unknown {
  if (typeof serializedHandler === 'function') {
    return serializedHandler as (...args: never[]) => unknown;
  }
  return (..._args: never[]): unknown => {
    throw new Error(
      `ToolRegistry: handler for "${name}" was not serialised and cannot be called.`,
    );
  };
}

/**
 * Registry of MAM tools keyed by name.
 *
 * @example
 * const registry = new ToolRegistry();
 * registry.register(createToolDefinition({
 *   name: 'math.add',
 *   description: 'Add two numbers',
 *   handler: () => 0,
 *   parameters: [
 *     { name: 'a', type: 'number', required: true },
 *     { name: 'b', type: 'number', required: true },
 *   ],
 *   tags: ['math'],
 *   capabilities: ['arithmetic.add'],
 * }));
 * registry.size;            // 1
 * registry.has('math.add'); // true
 * registry.list();          // [ { name: 'math.add', ... } ]
 * registry.getSchema('math.add'); // schema view without handler
 */
export class ToolRegistry {
  /**
   * The backing store. Tools are inserted via {@link ToolRegistry.register}
   * so all entries are guaranteed to satisfy the normalised
   * {@link ToolDefinition} invariants.
   */
  private readonly tools: Map<string, ToolDefinition>;

  /**
   * Creates an empty registry, optionally seeding it from a map of
   * pre-built definitions.
   *
   * @param initial optional seed map. Every entry is validated and
   *   normalised on insertion; invalid entries throw.
   * @param validateSeed when `false`, seed entries are trusted and inserted
   *   without re-validation. Defaults to `true`. Pass `false` only for seed
   *   data that already passed through {@link createToolDefinition}.
   */
  constructor(
    initial?: Map<string, ToolDefinition>,
    validateSeed = true,
  ) {
    this.tools = new Map();
    if (initial) {
      for (const [name, tool] of initial) {
        if (tool.name !== name) {
          throw new TypeError(
            `ToolRegistry: seed key "${name}" does not match tool name "${tool.name}".`,
          );
        }
        if (validateSeed) {
          this.register(tool);
        } else {
          this.tools.set(name, normalizeToolDefinition({ ...tool }));
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Map-compatible surface
   * ------------------------------------------------------------------ */

  /**
   * Returns the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Returns `true` when a tool with the given name is registered.
   *
   * @param name the tool name to probe.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns the tool definition for `name`, or `undefined` when absent.
   *
   * @param name the tool name to look up.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Returns the names of all registered tools in insertion order.
   */
  keys(): IterableIterator<string> {
    return this.tools.keys();
  }

  /**
   * Removes every tool from the registry.
   */
  clear(): void {
    this.tools.clear();
  }

  /* ------------------------------------------------------------------ *
   * Registry operations
   * ------------------------------------------------------------------ */

  /**
   * Registers (or replaces) a tool definition under its name.
   *
   * The definition is validated and normalised before insertion. Registering
   * an existing name replaces the previous entry; the previous definition is
   * returned so callers can decide how to react.
   *
   * @param tool the tool to register.
   * @returns the previously registered definition for the same name, or
   *   `undefined` when the name was not taken.
   * @throws {TypeError} when the definition fails validation.
   */
  register(tool: ToolDefinition): ToolDefinition | undefined {
    if (typeof tool?.name !== 'string' || tool.name.length === 0) {
      throw new TypeError(
        'ToolRegistry.register: a tool must have a non-empty string name.',
      );
    }
    const normalised = createToolDefinition(tool);
    const previous = this.tools.get(normalised.name);
    this.tools.set(normalised.name, normalised);
    return previous;
  }

  /**
   * Registers several tools in one call. Stops at the first invalid
   * definition and throws, leaving previously registered tools of the batch
   * in place.
   *
   * @param tools the definitions to register.
   * @returns the number of tools registered in this call.
   */
  registerMany(tools: Iterable<ToolDefinition>): number {
    let count = 0;
    for (const tool of tools) {
      this.register(tool);
      count += 1;
    }
    return count;
  }

  /**
   * Unregisters a tool by name.
   *
   * @param name the tool name to remove.
   * @returns the removed definition, or `undefined` when it was absent.
   */
  unregister(name: string): ToolDefinition | undefined {
    const removed = this.tools.get(name);
    if (removed !== undefined) {
      this.tools.delete(name);
    }
    return removed;
  }

  /* ------------------------------------------------------------------ *
   * Query surface
   * ------------------------------------------------------------------ */

  /**
   * Returns a shallow copy of every registered tool as an array, in
   * insertion order. The returned definitions are live references; mutate
   * with care.
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Returns the {@link ToolSchema} view of a tool, or `undefined` when the
   * tool is not registered. The schema omits the handler and metadata.
   *
   * @param name the tool name to describe.
   */
  getSchema(name: string): ToolSchema | undefined {
    const tool = this.tools.get(name);
    return tool === undefined ? undefined : toToolSchema(tool);
  }

  /**
   * Returns `true` when a registered tool advertises the given capability.
   *
   * @param name the tool name to inspect.
   * @param capability the capability to test for.
   */
  hasCapability(name: string, capability: string): boolean {
    const tool = this.tools.get(name);
    return (
      tool !== undefined &&
      tool.capabilities !== undefined &&
      tool.capabilities.includes(capability)
    );
  }

  /**
   * Groups every registered tool by capability. Only capabilities that at
   * least one tool advertises are included; tools advertising no
   * capabilities are omitted.
   */
  capabilities(): ToolCapability[] {
    const byName = new Map<string, string[]>();
    for (const tool of this.tools.values()) {
      for (const capability of tool.capabilities ?? []) {
        const list = byName.get(capability);
        if (list === undefined) {
          byName.set(capability, [tool.name]);
        } else {
          list.push(tool.name);
        }
      }
    }
    return Array.from(byName, ([name, tools]) => ({ name, tools }));
  }

  /**
   * Returns the tags used across every registered tool, de-duplicated and in
   * first-seen order.
   */
  allTags(): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tool of this.tools.values()) {
      for (const tag of tool.tags ?? []) {
        if (!seen.has(tag)) {
          seen.add(tag);
          result.push(tag);
        }
      }
    }
    return result;
  }

  /* ------------------------------------------------------------------ *
   * Stats & persistence
   * ------------------------------------------------------------------ */

  /**
   * Computes a {@link DiscoveryStats} snapshot from the current registry
   * contents. `lastIndexedAt` and `running` are filled with neutral values
   * (`0` / `false`) — lifecycle and index components override them with
   * their own state.
   */
  stats(): DiscoveryStats {
    const tags = new Set<string>();
    const capabilities = new Set<string>();
    let tokenCount = 0;

    for (const tool of this.tools.values()) {
      for (const tag of tool.tags ?? []) {
        tags.add(tag);
      }
      for (const capability of tool.capabilities ?? []) {
        capabilities.add(capability);
      }
      tokenCount += tool.description.split(/\s+/).filter(Boolean).length;
    }

    return {
      toolCount: this.tools.size,
      tagCount: Array.from(this.tools.values()).reduce(
        (sum, tool) => sum + (tool.tags?.length ?? 0),
        0,
      ),
      capabilityCount: Array.from(this.tools.values()).reduce(
        (sum, tool) => sum + (tool.capabilities?.length ?? 0),
        0,
      ),
      distinctTags: tags.size,
      distinctCapabilities: capabilities.size,
      tokenCount,
      lastIndexedAt: 0,
      running: false,
    };
  }

  /**
   * Serialises the entire registry as a JSON-safe structure. Handlers are
   * replaced with a `null` marker because functions do not survive
   * `JSON.stringify`; everything else is preserved verbatim.
   *
   * The result round-trips through {@link ToolRegistry.fromJSON} to rebuild a
   * working registry. Note that restored handlers are stubs that throw on
   * invocation.
   */
  toJSON(): Array<Omit<ToolDefinition, 'handler'> & { handler: null }> {
    return Array.from(this.tools.values(), (tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: (tool.parameters ?? []).map((param) => ({ ...param })),
      handler: null,
      tags: (tool.tags ?? []).slice(),
      capabilities: (tool.capabilities ?? []).slice(),
      version: tool.version,
      metadata: tool.metadata === undefined ? undefined : { ...tool.metadata },
    }));
  }

  /**
   * Rebuilds a registry from the output of {@link ToolRegistry.toJSON} (or
   * any JSON-serialised array of tool shapes with `handler: null` markers).
   *
   * @param serialized the serialised registry entries.
   * @returns a new registry populated with restored definitions.
   */
  static fromJSON(
    serialized: Array<{
      name: string;
      description: string;
      parameters: ToolDefinition['parameters'];
      handler: null;
      tags?: string[];
      capabilities?: string[];
      version?: string;
      metadata?: Record<string, unknown>;
    }>,
  ): ToolRegistry {
    const registry = new ToolRegistry();
    for (const entry of serialized) {
      const tool = createToolDefinition({
        name: entry.name,
        description: entry.description,
        parameters: entry.parameters ?? [],
        handler: restoreHandler(entry.name, entry.handler),
        tags: entry.tags ?? [],
        capabilities: entry.capabilities ?? [],
        version: entry.version,
        metadata: entry.metadata,
      });
      registry.tools.set(tool.name, tool);
    }
    return registry;
  }

  /**
   * Creates a deep-ish copy of the registry: a new registry whose tools share
   * the same handler references but have freshly copied array/object fields.
   * Useful before handing a registry over to code that mutates definitions.
   */
  clone(): ToolRegistry {
    const copy = new ToolRegistry();
    for (const [name, tool] of this.tools) {
      copy.tools.set(
        name,
        normalizeToolDefinition({
          name: tool.name,
          description: tool.description,
          parameters: (tool.parameters ?? []).map((param) => ({ ...param })),
          handler: tool.handler,
          tags: (tool.tags ?? []).slice(),
          capabilities: (tool.capabilities ?? []).slice(),
          version: tool.version,
          metadata:
            tool.metadata === undefined ? undefined : { ...tool.metadata },
        }),
      );
    }
    return copy;
  }
}

/**
 * Default exported convenience factory mirroring the class so consumers can
 * write `import createRegistry from './store.js'`.
 *
 * @param initial optional seed map.
 * @returns a new {@link ToolRegistry}.
 */
export default function createRegistry(
  initial?: Map<string, ToolDefinition>,
): ToolRegistry {
  return new ToolRegistry(initial);
}