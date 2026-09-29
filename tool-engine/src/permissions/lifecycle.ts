/**
 * lifecycle.ts
 *
 * The {@link PermissionLifecycle} manages the temporal and operational aspects
 * of a permission set on top of a {@link PermissionStore}:
 *
 *   - **Pruning** — `prune(ruleIds)` and `pruneExpired()` remove rules from
 *     the store, emitting `revoked` events so dependent systems (caches,
 *     sessions, audit logs) can react.
 *   - **Revocation** — `revokeTool(tool)` removes every rule that constrains a
 *     given tool, regardless of role or capability.
 *   - **Reset** — `reset()` returns the store to an empty, pristine state.
 *   - **Periodic sync** — `start()`/`stop()` run a timer that periodically
 *     invokes a sync callback (e.g. re-pull rules from a remote policy source),
 *     re-applies the fetched rules, and prunes anything no longer present.
 *
 * The lifecycle extends `node:events` and emits:
 *
 *   - `'granted'` `(rule: PermissionRule)` when an allow rule is added.
 *   - `'revoked'` `(rule: PermissionRule)` when a rule is removed.
 *   - `'denied'`  `(request, decision)` when a rejected request is observed
 *     through {@link PermissionLifecycle.observe}.
 *
 * The lifecycle also owns an optional {@link PermissionChecker} so it can
 * observe and surface denials without the caller wiring the two together.
 *
 * @module permissions/lifecycle
 */

import { EventEmitter } from 'node:events';
import {
  PermissionRule,
  PermissionRequest,
  PermissionDecision,
  PermissionConfig,
  ToolName,
  RoleName,
  GrantOptions,
  createRule,
} from './types.js';
import { PermissionStore } from './store.js';
import { PermissionChecker } from './retrieval.js';

/**
 * A source that can supply rules for a periodic sync (e.g. a remote policy
 * service, a database, or a configuration file watcher).
 *
 * @public
 */
export interface RuleSyncSource {
  /** Return the current set of rules the lifecycle should converge to. */
  fetchRules(): Promise<PermissionRule[]> | PermissionRule[];
}

/**
 * Callback signature for lifecycle events.
 *
 * @public
 */
export type LifecycleEventHandler = (...args: unknown[]) => void;

/**
 * Emitted event map for the lifecycle.
 *
 * @public
 */
export interface LifecycleEvents {
  granted: [rule: PermissionRule];
  revoked: [rule: PermissionRule];
  denied: [request: PermissionRequest, decision: PermissionDecision];
  sync: [added: number, removed: number, timestamp: number];
  reset: [timestamp: number];
  started: [intervalMs: number];
  stopped: [];
  error: [error: Error];
}

/**
 * Options for constructing a {@link PermissionLifecycle}.
 *
 * @public
 */
export interface PermissionLifecycleOptions {
  /** Store backing this lifecycle. Created automatically when omitted. */
  store?: PermissionStore;
  /** Checker used to observe denials. Created automatically when omitted. */
  checker?: PermissionChecker;
  /** Config used when creating a default store. */
  config?: Partial<PermissionConfig>;
  /** Sync source polled by `start()`. */
  syncSource?: RuleSyncSource;
  /** Default polling interval in ms (default 60_000). */
  intervalMs?: number;
  /** When true, `start()` is invoked automatically at construction. */
  autoStart?: boolean;
  /**
   * When true, `revokeTool` also drops capability mappings from the checker.
   * Defaults to `true`.
   */
  revokeCapabilities?: boolean;
}

/**
 * Manages the operational lifecycle of a permission set.
 *
 * @public
 */
export class PermissionLifecycle extends EventEmitter {
  private readonly store: PermissionStore;
  private readonly checker: PermissionChecker;
  private readonly syncSource?: RuleSyncSource;
  private readonly intervalMs: number;
  private readonly revokeCapabilities: boolean;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private syncing = false;
  private generation = 0;

  /**
   * Create a lifecycle.
   *
   * @param options - See {@link PermissionLifecycleOptions}.
   */
  constructor(options: PermissionLifecycleOptions = {}) {
    super();
    this.store = options.store ?? new PermissionStore(options.config);
    this.checker =
      options.checker ?? new PermissionChecker(this.store, options.config);
    this.syncSource = options.syncSource;
    this.intervalMs = options.intervalMs ?? 60_000;
    this.revokeCapabilities = options.revokeCapabilities ?? true;
    this.wireStoreEvents();
    if (options.autoStart === true) {
      this.start();
    }
  }

  /**
   * Grant a tool to roles, delegating to the underlying store.
   *
   * The `granted` event is emitted exactly once per created allow rule via the
   * store's `add` wiring.
   *
   * @param tool - Tool name.
   * @param roles - Roles receiving the grant.
   * @param options - Grant options.
   * @returns The created rule(s).
   */
  grant(
    tool: ToolName,
    roles: RoleName[],
    options: GrantOptions = {}
  ): PermissionRule[] {
    return this.store.grant(tool, roles, options);
  }

  /**
   * Deny a tool for roles, creating deny rule(s).
   *
   * Unlike {@link PermissionLifecycle.grant}, this builds explicit `deny`
   * rules (which out-rank allow rules of equal specificity). The `granted`
   * event is not emitted for deny rules since nothing is being granted; the
   * store's `add` wiring still fires for listeners that track policy volume.
   *
   * @param tool - Tool name.
   * @param roles - Roles to deny.
   * @param options - Grant options (capability, priority, reason, metadata).
   * @returns The created deny rule(s).
   */
  deny(tool: ToolName, roles: RoleName[], options: GrantOptions = {}): PermissionRule[] {
    const created: PermissionRule[] = [];
    const uniqueRoles = Array.from(new Set(roles));
    for (const role of uniqueRoles) {
      const rule = createRule({
        tool,
        capability: options.capability,
        roles: [role],
        effect: 'deny',
        priority: options.priority,
        enabled: options.enabled,
        reason: options.reason ?? `explicit deny for ${tool}`,
        metadata: options.metadata,
      });
      this.store.addRule(rule);
      created.push(rule);
    }
    return created;
  }

  /**
   * Remove a set of rules by id. The `revoked` event fires once per removal
   * via the store's `remove` wiring.
   *
   * @param ruleIds - Ids to prune.
   * @returns The number of rules actually removed.
   */
  prune(ruleIds: string[]): number {
    let removed = 0;
    for (const id of ruleIds) {
      if (this.store.removeRule(id)) {
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Remove every rule that is disabled, emitting `revoked` per removal.
   *
   * @returns The number of rules removed.
   */
  pruneDisabled(): number {
    const disabledIds = this.store
      .listRules()
      .filter((rule) => rule.enabled === false)
      .map((rule) => rule.id);
    return this.prune(disabledIds);
  }

  /**
   * Remove rules that have an `expiresAt` metadata timestamp in the past.
   *
   * Rules are pruned when `rule.metadata.expiresAt` is a number (epoch ms)
   * strictly less than `now`.
   *
   * @param now - Reference time; defaults to `Date.now()`.
   * @returns The number of rules removed.
   */
  pruneExpired(now: number = Date.now()): number {
    const expiredIds = this.store
      .listRules()
      .filter((rule) => {
        const expiry = rule.metadata?.expiresAt;
        return typeof expiry === 'number' && expiry < now;
      })
      .map((rule) => rule.id);
    return this.prune(expiredIds);
  }

  /**
   * Revoke all rules that reference a tool.
   *
   * Optionally also clears capability mappings for the tool when the checker
   * exposes them.
   *
   * @param tool - Tool to revoke.
   * @returns The number of rules removed.
   */
  revokeTool(tool: ToolName): number {
    const ids = this.store
      .listRules()
      .filter((rule) => rule.tool === tool)
      .map((rule) => rule.id);
    const removed = this.prune(ids);
    if (this.revokeCapabilities) {
      this.revokeCheckerCapability(tool);
    }
    return removed;
  }

  /**
   * Reset the store to empty and clear any in-flight sync state.
   *
   * @emits reset
   */
  reset(): void {
    this.generation += 1;
    this.store.clear();
    this.emit('reset', Date.now());
  }

  /**
   * Start periodic sync.
   *
   * The first sync runs immediately (asynchronously), then every `intervalMs`.
   * Sync runs are serialized: if a previous fetch is still in flight, the tick
   * is skipped.
   *
   * @param intervalMs - Optional override of the polling interval.
   * @returns `this` for chaining.
   */
  start(intervalMs?: number): this {
    if (this.running) {
      return this;
    }
    const effectiveInterval = intervalMs ?? this.intervalMs;
    this.running = true;
    this.emit('started', effectiveInterval);
    if (this.syncSource) {
      void this.syncOnce();
    }
    this.timer = setInterval(() => {
      if (this.syncing) {
        return;
      }
      void this.syncOnce();
    }, effectiveInterval);
    return this;
  }

  /**
   * Stop periodic sync.
   *
   * @returns `this` for chaining.
   */
  stop(): this {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.emit('stopped');
    return this;
  }

  /**
   * Perform a single sync against the sync source.
   *
   * The sync *converges* the store: rules present in the source are upserted,
   * rules absent from the source (that came from a previous sync) are pruned.
   * Rules that existed before the first sync are left untouched unless they
   * were previously marked as synced.
   *
   * @returns A summary of added/removed counts, or `null` when no source is
   *   configured or a sync is already in flight.
   */
  async syncOnce(): Promise<{ added: number; removed: number } | null> {
    if (!this.syncSource) {
      return null;
    }
    if (this.syncing) {
      return null;
    }
    this.syncing = true;
    const generation = this.generation;
    try {
      const fetched = await this.syncSource.fetchRules();
      if (generation !== this.generation) {
        return { added: 0, removed: 0 };
      }
      return this.converge(fetched);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      return null;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Converge the store to exactly the given rule set.
   *
   * @param fetched - The desired rules.
   * @returns Added/removed counts.
   */
  converge(fetched: PermissionRule[]): { added: number; removed: number } {
    const incoming = new Map(fetched.map((rule) => [rule.id, rule]));
    let added = 0;
    let removed = 0;
    for (const rule of fetched) {
      const existing = this.store.getRule(rule.id);
      if (!existing) {
        this.store.upsertRule(rule);
        added += 1;
      } else if (!this.sameRule(existing, rule)) {
        this.store.upsertRule(rule);
        added += 1;
      }
    }
    for (const existing of this.store.listRules()) {
      if (!incoming.has(existing.id)) {
        this.store.removeRule(existing.id);
        removed += 1;
      }
    }
    this.emit('sync', added, removed, Date.now());
    return { added, removed };
  }

  /**
   * Observe a decision and surface denials through the `denied` event.
   *
   * @param request - The request that was evaluated.
   * @param decision - The resulting decision.
   */
  observe(request: PermissionRequest, decision: PermissionDecision): void {
    if (!decision.allowed) {
      this.emit('denied', request, decision);
    }
  }

  /**
   * Evaluate a request through the owned checker and surface any denial.
   *
   * @param request - The request to check.
   * @returns The decision (and emits `denied` when rejected).
   */
  checkAndObserve(request: PermissionRequest): PermissionDecision {
    const decision = this.checker.check(request);
    this.observe(request, decision);
    return decision;
  }

  /**
   * The underlying store.
   */
  get storeRef(): PermissionStore {
    return this.store;
  }

  /**
   * The underlying checker.
   */
  get checkerRef(): PermissionChecker {
    return this.checker;
  }

  /**
   * Whether periodic sync is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /**
   * The number of rules currently in the store.
   */
  get size(): number {
    return this.store.size;
  }

  /**
   * Remove all listeners and stop the timer.
   */
  dispose(): void {
    this.stop();
    this.removeAllListeners();
  }

  private wireStoreEvents(): void {
    this.store.on('add', (rule: PermissionRule) => {
      if (rule.effect === 'allow') {
        this.emit('granted', rule);
      }
    });
    this.store.on('remove', (rule: PermissionRule) => {
      this.emit('revoked', rule);
    });
  }

  private sameRule(a: PermissionRule, b: PermissionRule): boolean {
    if (a.effect !== b.effect) {
      return false;
    }
    if (a.tool !== b.tool || a.capability !== b.capability) {
      return false;
    }
    if ((a.priority ?? 0) !== (b.priority ?? 0)) {
      return false;
    }
    const rolesA = a.roles ?? [];
    const rolesB = b.roles ?? [];
    if (rolesA.length !== rolesB.length) {
      return false;
    }
    const sortedA = [...rolesA].sort();
    const sortedB = [...rolesB].sort();
    for (let i = 0; i < sortedA.length; i += 1) {
      if (sortedA[i] !== sortedB[i]) {
        return false;
      }
    }
    return true;
  }

  private revokeCheckerCapability(tool: ToolName): void {
    const checker = this.checker as PermissionChecker & {
      registerMapping?: (mapping: { tool: ToolName; capabilities: [] }) => void;
    };
    if (typeof checker.registerMapping === 'function') {
      try {
        checker.registerMapping({ tool, capabilities: [] });
      } catch {
        /* capability registry is best-effort */
      }
    }
  }
}

/**
 * Factory: create a lifecycle with sensible defaults.
 *
 * @param options - See {@link PermissionLifecycleOptions}.
 * @returns A configured lifecycle.
 */
export function createPermissionLifecycle(
  options: PermissionLifecycleOptions = {}
): PermissionLifecycle {
  return new PermissionLifecycle(options);
}