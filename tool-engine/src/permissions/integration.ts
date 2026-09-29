/**
 * integration.ts
 *
 * The high-level entry point of the Permissions layer: {@link ToolAuthorizer}.
 *
 * `ToolAuthorizer` composes a {@link PermissionStore}, a
 * {@link PermissionIndex} and a {@link PermissionChecker} into a single,
 * ergonomic facade that most application code will talk to. It exposes:
 *
 *   - `grant`/`deny` to mutate policy,
 *   - `check` to obtain a {@link PermissionDecision},
 *   - `authorize` to throw when a request is denied,
 *   - `can` for boolean checks,
 *   - `setDefault` to change the fallback policy at runtime.
 *
 * The module also provides:
 *
 *   - `createToolAuthorizer(config)` — a factory with sensible defaults.
 *   - {@link ToolPermissionProvider} — the interface the rest of the MAM Tool
 *     Engine depends on when it needs to ask "may this tool run?".
 *   - {@link PermissionsAdapter} — an adapter that backs a
 *     `ToolPermissionProvider` with any checker-like implementation, so the
 *     provider contract can be satisfied by custom backends too.
 *
 * A single authorizer instance is cheap; in a process that hosts one agent it
 * is typical to create exactly one and share it across tool dispatches.
 *
 * @module permissions/integration
 */

import {
  PermissionRequest,
  PermissionDecision,
  PermissionConfig,
  PermissionRule,
  ToolName,
  RoleName,
  GrantOptions,
  PermissionEffect,
  isPermissionRequest,
  resolveConfig,
  DEFAULT_PERMISSION_CONFIG,
} from './types.js';
import { PermissionStore } from './store.js';
import { PermissionIndex } from './index.js';
import { PermissionChecker, PermissionRuleSource } from './retrieval.js';

/**
 * The error thrown by {@link ToolAuthorizer.authorize} when a request is
 * denied.
 *
 * Carries the full decision so callers can inspect *why* the denial happened
 * (matched rule, reason, source).
 *
 * @public
 */
export class PermissionDeniedError extends Error {
  /** The decision that triggered the denial. */
  readonly decision: PermissionDecision;
  /** The request that was denied. */
  readonly request: PermissionRequest;

  /**
   * @param request - The denied request.
   * @param decision - The denying decision.
   */
  constructor(request: PermissionRequest, decision: PermissionDecision) {
    super(
      `Permission denied for tool "${request.tool}"` +
        (request.capability ? ` (capability "${request.capability}")` : '') +
        (decision.reason ? `: ${decision.reason}` : '.')
    );
    this.name = 'PermissionDeniedError';
    this.decision = decision;
    this.request = request;
  }
}

/**
 * The interface the MAM Tool Engine relies on to gate tool dispatch.
 *
 * Implementations may be backed by a local authorizer, a remote policy
 * service, or a sidecar. The permissions layer ships {@link PermissionsAdapter}
 * which adapts a checker-like backend to this contract.
 *
 * @public
 */
export interface ToolPermissionProvider {
  /**
   * Decide whether a tool request is permitted.
   *
   * @param request - The request to evaluate.
   * @returns A {@link PermissionDecision}; never throws for policy reasons.
   */
  check(request: PermissionRequest): PermissionDecision;
  /**
   * Boolean form of {@link ToolPermissionProvider.check}.
   *
   * @param request - The request to evaluate.
   * @returns `true` when allowed.
   */
  can(request: PermissionRequest): boolean;
  /**
   * Check and throw on denial.
   *
   * @param request - The request to evaluate.
   * @throws {PermissionDeniedError} When the request is denied.
   * @returns The allowing decision.
   */
  authorize(request: PermissionRequest): PermissionDecision;
}

/**
 * An indexed resolver that serves rule lookups from a store through the index.
 *
 * This wires `PermissionIndex` (fast candidate lookup) to `PermissionStore`
 * (authoritative storage) without either knowing about the other.
 *
 * @public
 */
export class IndexedRuleSource implements PermissionRuleSource {
  private readonly store: PermissionStore;
  private readonly index: PermissionIndex;

  /**
   * @param store - The authoritative store.
   * @param index - The accelerator index, kept in sync by the caller.
   */
  constructor(store: PermissionStore, index: PermissionIndex) {
    this.store = store;
    this.index = index;
  }

  getRule(ruleId: string): PermissionRule | undefined {
    return this.store.getRule(ruleId);
  }

  listRules(): PermissionRule[] {
    return this.store.listRules();
  }

  /**
   * The store backing this source.
   */
  get storeRef(): PermissionStore {
    return this.store;
  }

  /**
   * The index backing this source.
   */
  get indexRef(): PermissionIndex {
    return this.index;
  }
}

/**
 * Options for {@link createToolAuthorizer}.
 *
 * @public
 */
export interface ToolAuthorizerConfig {
  /** Checker configuration (default effect, baseline priority, etc.). */
  config?: Partial<PermissionConfig>;
  /** Rules to seed the authorizer with. */
  rules?: PermissionRule[];
  /** Capability mappings to register up front. */
  capabilities?: import('./types.js').CapabilityMapping[];
}

/**
 * High-level facade over the Permissions layer.
 *
 * Keeps store/index/checker in lock-step:
 *  - the store is authoritative,
 *  - the index accelerates candidate lookups,
 *  - the checker resolves requests.
 *
 * All mutating operations update the index incrementally so lookups stay fast
 * without a full rebuild.
 *
 * @public
 */
export class ToolAuthorizer implements ToolPermissionProvider {
  private readonly store: PermissionStore;
  private readonly index: PermissionIndex;
  private checker: PermissionChecker;
  private config: PermissionConfig;
  private readonly mappings: import('./types.js').CapabilityMapping[] = [];

  /**
   * Create an authorizer from explicit collaborators.
   *
   * @param store - Store to use (or omitted to create one).
   * @param index - Index to use (or omitted to create one).
   * @param checker - Checker to use (or omitted to create one).
   * @param config - Configuration overrides.
   */
  constructor(
    store?: PermissionStore,
    index?: PermissionIndex,
    checker?: PermissionChecker,
    config: Partial<PermissionConfig> = {}
  ) {
    this.config = resolveConfig(config);
    this.store = store ?? new PermissionStore(this.config);
    this.index = index ?? new PermissionIndex();
    this.rebuildIndex();
    this.checker =
      checker ??
      new PermissionChecker(new IndexedRuleSource(this.store, this.index), this.config);
    this.wireStoreEvents();
  }

  /**
   * Build an authorizer from a config object (see {@link ToolAuthorizerConfig}).
   *
   * @param options - Authorizer configuration.
   * @returns A configured authorizer.
   */
  static fromConfig(options: ToolAuthorizerConfig = {}): ToolAuthorizer {
    const authorizer = new ToolAuthorizer(undefined, undefined, undefined, options.config);
    if (options.rules && options.rules.length > 0) {
      authorizer.addRules(options.rules);
    }
    if (options.capabilities && options.capabilities.length > 0) {
      authorizer.registerMappings(options.capabilities);
    }
    return authorizer;
  }

  /**
   * Grant a tool to roles (creates allow rule(s)).
   *
   * @param tool - Tool name.
   * @param roles - Roles to grant.
   * @param options - Grant options.
   * @returns The created rule(s).
   */
  grant(tool: ToolName, roles: RoleName[], options: GrantOptions = {}): PermissionRule[] {
    const rules = this.store.grant(tool, roles, options);
    this.syncIndexFor(rules);
    return rules;
  }

  /**
   * Deny a tool for roles (creates deny rule(s)).
   *
   * @param tool - Tool name.
   * @param roles - Roles to deny.
   * @param options - Grant options.
   * @returns The created deny rule(s).
   */
  deny(tool: ToolName, roles: RoleName[], options: GrantOptions = {}): PermissionRule[] {
    const rules: PermissionRule[] = [];
    for (const role of Array.from(new Set(roles))) {
      const rule = this.store.upsertRule({
        id: cryptoRandomId(),
        tool,
        roles: [role],
        effect: 'deny',
        priority: options.priority,
        enabled: options.enabled ?? true,
        capability: options.capability,
        reason: options.reason ?? `explicit deny for ${tool}`,
        metadata: options.metadata,
      });
      rules.push(rule);
    }
    this.syncIndexFor(rules);
    return rules;
  }

  /**
   * Add rules directly to the authorizer.
   *
   * @param rules - Rules to add.
   * @returns The number of rules added.
   */
  addRules(rules: PermissionRule[]): number {
    const added = this.store.addMany(rules);
    this.rebuildIndex();
    return added;
  }

  /**
   * Remove a rule by id.
   *
   * @param ruleId - Rule id.
   * @returns `true` when a rule was removed.
   */
  revokeRule(ruleId: string): boolean {
    const removed = this.store.removeRule(ruleId);
    if (removed) {
      this.index.removeRule(ruleId);
    }
    return removed !== undefined;
  }

  /**
   * Revoke every rule that references a tool.
   *
   * @param tool - Tool name.
   * @returns The number of rules removed.
   */
  revokeTool(tool: ToolName): number {
    const ids = this.store
      .listRules()
      .filter((rule) => rule.tool === tool)
      .map((rule) => rule.id);
    let removed = 0;
    for (const id of ids) {
      if (this.revokeRule(id)) {
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Register capability mappings so the checker is capability-aware.
   *
   * @param mappings - Mappings to register.
   * @returns `this` for chaining.
   */
registerMappings(
    mappings: import('./types.js').CapabilityMapping[]
  ): this {
    for (const mapping of mappings) {
      this.mappings.push(mapping);
    }
    this.checker.registerMappings(mappings);
    return this;
  }

  /**
   * Evaluate a request.
   *
   * @param request - The request to evaluate.
   * @returns A {@link PermissionDecision}.
   */
  check(request: PermissionRequest): PermissionDecision {
    return this.checker.check(request);
  }

  /**
   * Boolean check.
   *
   * @param request - The request to evaluate.
   * @returns `true` when allowed.
   */
  can(request: PermissionRequest): boolean {
    return this.checker.can(request);
  }

  /**
   * Check and throw on denial.
   *
   * @param request - The request to evaluate.
   * @throws {PermissionDeniedError} When denied.
   * @returns The allowing decision.
   */
  authorize(request: PermissionRequest): PermissionDecision {
    const decision = this.checker.check(request);
    if (!decision.allowed) {
      throw new PermissionDeniedError(request, decision);
    }
    return decision;
  }

  /**
   * Change the fallback default effect at runtime.
   *
   * @param policy - The new default (`'allow'` or `'deny'`).
   * @returns `this` for chaining.
   */
  setDefault(policy: PermissionEffect): this {
    if (policy !== 'allow' && policy !== 'deny') {
      throw new TypeError(`ToolAuthorizer.setDefault: invalid policy "${String(policy)}"`);
    }
    this.config = resolveConfig({ ...this.config, default: policy });
    this.replaceChecker();
    return this;
  }

  /**
   * The number of rules currently registered.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * The current default effect.
   */
  get defaultPolicy(): PermissionEffect {
    return this.config.default;
  }

  /**
   * Live statistics from the underlying store.
   *
   * @returns Store stats.
   */
  stats(): import('./types.js').PermissionStats {
    return this.store.stats();
  }

  /**
   * Serialize the authorizer's policy.
   *
   * @returns A JSON-safe snapshot of the store.
   */
  toJSON(): import('./store.js').SerializedPermissionStore {
    return this.store.toJSON();
  }

  /**
   * Replace the current policy with a serialized snapshot.
   *
   * @param data - Output of {@link ToolAuthorizer.toJSON}.
   * @returns `this` for chaining.
   */
  restore(data: unknown): this {
    const restored = PermissionStore.fromJSON(data);
    this.store.clear();
    this.store.addMany(restored.listRules());
    this.rebuildIndex();
    return this;
  }

  /**
   * Expose the underlying checker for advanced usage.
   */
  get checkerRef(): PermissionChecker {
    return this.checker;
  }

  /**
   * Build a {@link ToolPermissionProvider} from this authorizer.
   *
   * @returns The authorizer itself (it already satisfies the interface).
   */
  asProvider(): ToolPermissionProvider {
    return this;
  }

  private wireStoreEvents(): void {
    this.store.on('add', (rule: PermissionRule) => {
      this.index.indexRule(rule);
    });
    this.store.on('change', (rule: PermissionRule) => {
      this.index.indexRule(rule);
    });
    this.store.on('remove', (rule: PermissionRule) => {
      this.index.removeRule(rule.id);
    });
    this.store.on('clear', () => {
      this.index.clear();
    });
  }

  private rebuildIndex(): void {
    this.index.rebuild(this.store.listRules());
  }

  private syncIndexFor(rules: PermissionRule[]): void {
    for (const rule of rules) {
      this.index.indexRule(rule);
    }
  }

  private replaceChecker(): void {
    const source = new IndexedRuleSource(this.store, this.index);
    const fresh = new PermissionChecker(source, this.config);
    fresh.registerMappings(this.mappings);
    this.checker = fresh;
  }
}

/**
 * Factory: create a ready-to-use authorizer.
 *
 * @param config - See {@link ToolAuthorizerConfig}.
 * @returns A configured {@link ToolAuthorizer}.
 */
export function createToolAuthorizer(config: ToolAuthorizerConfig = {}): ToolAuthorizer {
  return ToolAuthorizer.fromConfig(config);
}

/**
 * Adapter that exposes a checker-like backend through the
 * {@link ToolPermissionProvider} contract.
 *
 * This lets the rest of the tool engine depend on the stable provider
 * interface while the backend behind it can be swapped (local authorizer,
 * remote gRPC policy service, in-process mock, etc.).
 *
 * @public
 */
export class PermissionsAdapter implements ToolPermissionProvider {
  private readonly backend: ToolPermissionProvider;

  /**
   * @param backend - The backend that actually evaluates requests. Any object
   *   satisfying {@link ToolPermissionProvider} works, including another
   *   {@link PermissionsAdapter} (allowing layered/fallback chains).
   */
  constructor(backend: ToolPermissionProvider) {
    this.backend = backend;
  }

  /**
   * Delegate a check to the backend.
   *
   * @param request - The request to evaluate.
   * @returns The backend decision.
   */
  check(request: PermissionRequest): PermissionDecision {
    if (!isPermissionRequest(request)) {
      throw new TypeError('PermissionsAdapter.check: invalid request shape');
    }
    return this.backend.check(request);
  }

  /**
   * Boolean form of check.
   *
   * @param request - The request to evaluate.
   * @returns `true` when allowed.
   */
  can(request: PermissionRequest): boolean {
    return this.check(request).allowed;
  }

  /**
   * Check and throw on denial.
   *
   * @param request - The request to evaluate.
   * @throws {PermissionDeniedError} When denied.
   * @returns The allowing decision.
   */
  authorize(request: PermissionRequest): PermissionDecision {
    const decision = this.check(request);
    if (!decision.allowed) {
      throw new PermissionDeniedError(request, decision);
    }
    return decision;
  }

  /**
   * The wrapped backend.
   */
  get backendRef(): ToolPermissionProvider {
    return this.backend;
  }
}

/**
 * Build a provider that short-circuits to `allow` for every request.
 *
 * Useful for development, smoke tests, or permissive environments where the
 * permissions layer is not yet wired up.
 *
 * @returns A provider that always allows.
 */
export function createAllowAllProvider(): ToolPermissionProvider {
  return {
    check(request: PermissionRequest): PermissionDecision {
      return { allowed: true, reason: 'allow-all provider', request, source: 'default' };
    },
    can(): boolean {
      return true;
    },
    authorize(request: PermissionRequest): PermissionDecision {
      return { allowed: true, reason: 'allow-all provider', request, source: 'default' };
    },
  };
}

/**
 * Build a provider that denies everything.
 *
 * Useful for safe-by-default stubs during bootstrapping.
 *
 * @returns A provider that always denies.
 */
export function createDenyAllProvider(): ToolPermissionProvider {
  return {
    check(request: PermissionRequest): PermissionDecision {
      return { allowed: false, reason: 'deny-all provider', request, source: 'default' };
    },
    can(): boolean {
      return false;
    },
    authorize(request: PermissionRequest): PermissionDecision {
      throw new PermissionDeniedError(request, {
        allowed: false,
        reason: 'deny-all provider',
        request,
        source: 'default',
      });
    },
  };
}

/**
 * Generate a pseudo-random id without relying on `node:crypto` being imported
 * at module top-level (keeps this file browser-safe when bundled).
 *
 * @returns A unique-enough id string.
 */
function cryptoRandomId(): string {
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID === 'function') {
    return (globalThis as { crypto: { randomUUID: () => string } }).crypto.randomUUID();
  }
  return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Convenience: build a default config from an optional partial.
 *
 * @param overrides - Optional overrides.
 * @returns A fully resolved config (non-frozen).
 */
export function defaultConfig(overrides?: Partial<PermissionConfig>): PermissionConfig {
  return resolveConfig({ ...DEFAULT_PERMISSION_CONFIG, ...overrides });
}

/**
 * Re-export of the default config constant for convenience.
 */
export { DEFAULT_PERMISSION_CONFIG };