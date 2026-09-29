/**
 * retrieval.ts
 *
 * The {@link PermissionChecker} is the resolution engine of the permissions
 * layer. Given a {@link PermissionRequest} it decides whether the request is
 * allowed by:
 *
 *   1. Gathering the candidate rules relevant to the request (rules matching
 *      the tool, the capability, and any of the caller's roles).
 *   2. Selecting the winning rule using the precedence contract:
 *        a. more specific rules win (see `ruleSpecificity`);
 *        b. on equal specificity, higher `priority` wins;
 *        c. on an exact tie, `deny` wins (fail closed);
 *        d. if nothing matches, the configured default applies.
 *   3. Producing an immutable {@link PermissionDecision}.
 *
 * The checker is also responsible for capability awareness:
 *
 *   - {@link PermissionChecker.requiresCapability} reports whether a tool
 *     declares a given capability (through a {@link CapabilityMapping}).
 *   - {@link PermissionChecker.extractCapabilities} parses a tool definition
 *     and derives the capabilities it exposes from a `capabilities` field,
 *     its name, and its tags.
 *
 * The checker reads rules through an injected resolver (usually a
 * {@link PermissionStore} or a {@link PermissionIndex}), which keeps it
 * decoupled from storage and trivially testable.
 *
 * @module permissions/retrieval
 */

import {
  PermissionRequest,
  PermissionDecision,
  PermissionConfig,
  PermissionRule,
  CapabilityMapping,
  ToolName,
  CapabilityName,
  RoleName,
  PermissionEffect,
  WILDCARD,
  CAPABILITY_SEPARATOR,
  isPermissionRequest,
  isPermissionRule,
  isCapabilityMapping,
  allowDecision,
  denyDecision,
  resolveConfig,
  ruleSpecificity,
  capabilityCovers,
} from './types.js';

/**
 * A rule source that the checker can pull candidate rules from.
 *
 * The interface is deliberately minimal so that a store, an index or any
 * custom collection can satisfy it.
 *
 * @public
 */
export interface PermissionRuleSource {
  /** Return the rule with the given id, or `undefined`. */
  getRule(ruleId: string): PermissionRule | undefined;
  /** Return all rules the source knows about (used for full scans). */
  listRules(): PermissionRule[];
}

/**
 * A source of tool -> capability mappings (e.g. derived from tool registry).
 *
 * @public
 */
export interface CapabilitySource {
  /** Return the mapping for a tool, or `undefined`. */
  getCapabilities(tool: ToolName): CapabilityName[] | undefined;
}

/**
 * A generic tool definition shape understood by capability extraction.
 *
 * The checker only relies on the optional `capabilities`, `name` and `tags`
 * fields; every other field is ignored and may vary per platform (MCP tools,
 * CLI definitions, OpenAPI operations, etc).
 *
 * @public
 */
export interface ToolDefinition {
  /** The tool's name, used to derive capabilities when not declared. */
  name?: string;
  /**
   * Capabilities declared directly by the tool. May be:
   *   - `string[]` (list of capability names),
   *   - `Record<string, boolean>` (capability -> enabled),
   *   - `Record<string, unknown>` (capability -> any truthy metadata).
   */
  capabilities?: string[] | Record<string, unknown>;
  /** Free-form tags used to derive capabilities. */
  tags?: string[];
  /** Category / domain of the tool, also considered for derivation. */
  category?: string;
  /** Arbitrary other definition fields. */
  [key: string]: unknown;
}

/**
 * Options that control how {@link PermissionChecker.extractCapabilities}
 * derives capabilities from a tool definition.
 *
 * @public
 */
export interface ExtractionOptions {
  /**
   * Tag -> capability prefixes. A tag `read` with prefix `file` yields
   * `file.read`. Defaults to an empty map (no tag derivation).
   */
  tagPrefixes?: Record<string, string>;
  /**
   * When true, the tool's bare name is added as a capability (`fs.readFile`
   * also yields capability `fs.readFile`). Defaults to `true`.
   */
  includeName?: boolean;
  /**
   * When true, the `category` field is included as a `category.<name>`
   * capability. Defaults to `false`.
   */
  includeCategory?: boolean;
}

/**
 * Result of a capability extraction run.
 *
 * @public
 */
export interface ExtractionResult {
  /** The tool the result describes. */
  tool: ToolName;
  /** Capabilities extracted (declared first, then derived). */
  capabilities: CapabilityName[];
  /** How each capability was obtained. */
  provenance: Map<CapabilityName, 'declared' | 'derived-name' | 'derived-tag' | 'derived-category'>;
}

/**
 * The outcome of gathering candidate rules for a request.
 *
 * @public
 */
export interface GatherResult {
  /** Rules that are relevant to the request. */
  candidates: PermissionRule[];
  /** The winning rule, when one matched. */
  winner: PermissionRule | undefined;
  /** The winning specificity score (0 when nothing matched). */
  winnerSpecificity: number;
}

/**
 * Resolution engine for permission requests.
 *
 * @public
 */
export class PermissionChecker {
  private readonly config: PermissionConfig;
  private readonly rules: PermissionRuleSource;
  private capabilities: CapabilitySource;
  private readonly rawCapabilities = new Map<ToolName, CapabilityName[]>();

  /**
   * Create a checker.
   *
   * @param rules - Rule source (store/index) used to resolve rules.
   * @param config - Checker configuration; see {@link PermissionConfig}.
   * @param capabilities - Optional capability source for capability-aware
   *   checks and `requiresCapability`.
   */
  constructor(
    rules: PermissionRuleSource,
    config: Partial<PermissionConfig> = {},
    capabilities?: CapabilitySource
  ) {
    this.rules = rules;
    this.config = resolveConfig(config);
    if (capabilities) {
      this.capabilities = capabilities;
      this.snapshotCapabilities(capabilities);
    } else {
      this.capabilities = { getCapabilities: (tool) => this.rawCapabilities.get(tool) };
    }
  }

  /**
   * Evaluate a single request and produce a {@link PermissionDecision}.
   *
   * @param request - The request to evaluate.
   * @returns A decision; `allowed === true` only when a winning rule (or the
   *   default) permits the request.
   * @throws {TypeError} When the request is malformed.
   */
  check(request: PermissionRequest): PermissionDecision {
    if (!isPermissionRequest(request)) {
      throw new TypeError('PermissionChecker.check: invalid request shape');
    }
    const { winner } = this.gather(request);
    if (!winner) {
      return this.config.default === 'allow'
        ? allowDecision(undefined, request, 'allowed by default policy')
        : denyDecision(undefined, request, 'denied by default policy (no matching rule)');
    }
    const matched = winner.effect === 'allow';
    return matched
      ? allowDecision(winner, request, winner.reason ?? `allowed by rule "${winner.id}"`)
      : denyDecision(winner, request, winner.reason ?? `denied by rule "${winner.id}"`);
  }

  /**
   * Convenience boolean form of {@link PermissionChecker.check}.
   *
   * @param request - The request to evaluate.
   * @returns `true` when the request is allowed.
   */
  can(request: PermissionRequest): boolean {
    return this.check(request).allowed;
  }

  /**
   * Evaluate many requests in a single call.
   *
   * @param requests - Requests to evaluate.
   * @returns One decision per request, in input order.
   */
  checkMany(requests: PermissionRequest[]): PermissionDecision[] {
    return requests.map((request) => this.check(request));
  }

  /**
   * Test whether the checker would allow every request in a batch.
   *
   * @param requests - Requests to evaluate.
   * @returns `true` only when all requests are allowed.
   */
  canAll(requests: PermissionRequest[]): boolean {
    return this.checkMany(requests).every((decision) => decision.allowed);
  }

  /**
   * Whether a tool declares the given capability (through the injected
   * capability source).
   *
   * @param tool - Tool name.
   * @param cap - Capability to test.
   * @returns `true` when the tool's declared capabilities cover `cap`.
   */
  requiresCapability(tool: ToolName, cap: CapabilityName): boolean {
    const declared = this.capabilities.getCapabilities(tool);
    if (!declared || declared.length === 0) {
      return false;
    }
    return declared.some((d) => capabilityCovers(cap, d));
  }

  /**
   * Extract capabilities from a tool definition.
   *
   * Declaration order is: declared `capabilities` first, then derivations.
   * The declared form accepts a string array or a record; record values that
   * are `false`/`0`/`''`/`null`/`undefined` are treated as disabled and
   * excluded.
   *
   * @param toolDef - The tool definition to parse.
   * @param options - Derivation options.
   * @returns An {@link ExtractionResult}.
   */
  extractCapabilities(
    toolDef: ToolDefinition,
    options: ExtractionOptions = {}
  ): ExtractionResult {
    const tool =
      toolDef.name !== undefined && toolDef.name.length > 0
        ? toolDef.name
        : String(toolDef.name ?? 'unnamed');
    const caps: CapabilityName[] = [];
    const provenance = new Map<
      CapabilityName,
      'declared' | 'derived-name' | 'derived-tag' | 'derived-category'
    >();

    const declared = this.collectDeclared(toolDef);
    for (const cap of declared) {
      if (!caps.includes(cap)) {
        caps.push(cap);
        provenance.set(cap, 'declared');
      }
    }

    if (options.includeName !== false) {
      if (!caps.includes(tool)) {
        caps.push(tool);
        provenance.set(tool, 'derived-name');
      }
    }

    const tags = toolDef.tags ?? [];
    const tagPrefixes = options.tagPrefixes ?? {};
    for (const tag of tags) {
      const prefix = tagPrefixes[tag];
      if (prefix === undefined) {
        continue;
      }
      const derived = `${prefix}${CAPABILITY_SEPARATOR}${tag}`;
      if (!caps.includes(derived)) {
        caps.push(derived);
        provenance.set(derived, 'derived-tag');
      }
    }

    if (options.includeCategory === true && typeof toolDef.category === 'string' && toolDef.category.length > 0) {
      const derived = `${toolDef.category}`;
      if (!caps.includes(derived)) {
        caps.push(derived);
        provenance.set(derived, 'derived-category');
      }
    }

    return { tool, capabilities: caps, provenance };
  }

  /**
   * Build a {@link CapabilityMapping} for a tool definition using the current
   * extraction settings.
   *
   * @param toolDef - The tool definition.
   * @param options - Extraction options.
   * @returns A mapping usable as a {@link CapabilitySource}.
   */
  toCapabilityMapping(toolDef: ToolDefinition, options: ExtractionOptions = {}): CapabilityMapping {
    const result = this.extractCapabilities(toolDef, options);
    const hasDeclared = result.capabilities.some(
      (cap) => result.provenance.get(cap) === 'declared'
    );
    return {
      tool: result.tool,
      capabilities: result.capabilities,
      source: hasDeclared ? 'declared' : 'derived',
    };
  }

  /**
   * Register a tool definition so the checker becomes capability-aware for it.
   *
   * This mutates the checker's internal capability registry in place.
   *
   * @param toolDef - The tool definition.
   * @param options - Extraction options.
   * @returns The registered {@link CapabilityMapping}.
   */
  registerTool(toolDef: ToolDefinition, options: ExtractionOptions = {}): CapabilityMapping {
    const mapping = this.toCapabilityMapping(toolDef, options);
    this.registerMapping(mapping);
    return mapping;
  }

  /**
   * Register pre-built capability mappings.
   *
   * @param mappings - Mappings to register.
   * @returns `this` for chaining.
   */
  registerMappings(mappings: CapabilityMapping[]): this {
    for (const mapping of mappings) {
      this.registerMapping(mapping);
    }
    return this;
  }

  /**
   * Register a single capability mapping.
   *
   * @param mapping - The mapping to register.
   * @returns `this` for chaining.
   * @throws {TypeError} When the mapping is invalid.
   */
  registerMapping(mapping: CapabilityMapping): this {
    if (!isCapabilityMapping(mapping)) {
      throw new TypeError('PermissionChecker.registerMapping: invalid mapping');
    }
    this.overrideCapabilities(mapping.tool, mapping.capabilities);
    return this;
  }

  /**
   * Build a request-scoped capability check: return the first declared
   * capability of a tool that covers the requested capability, if any.
   *
   * @param tool - Tool name.
   * @param cap - Requested capability.
   * @returns The covering declared capability, or `undefined`.
   */
  coveredBy(tool: ToolName, cap: CapabilityName): CapabilityName | undefined {
    const declared = this.capabilities.getCapabilities(tool);
    if (!declared) {
      return undefined;
    }
    return declared.find((d) => capabilityCovers(cap, d));
  }

  /**
   * Evaluate a request against a specific role (rather than the roles carried
   * on the request). Useful for "does this role have access?" checks.
   *
   * @param tool - Tool name.
   * @param role - Role to test.
   * @param capability - Optional capability filter.
   * @returns A decision for the synthesized request.
   */
  checkForRole(tool: ToolName, role: RoleName, capability?: CapabilityName): PermissionDecision {
    const request: PermissionRequest = {
      tool,
      capability,
      roles: [role],
    };
    return this.check(request);
  }

  /**
   * Current checker configuration.
   */
  get configSnapshot(): PermissionConfig {
    return { ...this.config };
  }

  /**
   * Gather candidate rules for a request and pick the winner.
   *
   * @param request - The request.
   * @returns {@link GatherResult}.
   */
  gather(request: PermissionRequest): GatherResult {
    const candidates = this.collectCandidates(request);
    const sorted = [...candidates].sort((a, b) => {
      const specDiff = ruleSpecificity(b) - ruleSpecificity(a);
      if (specDiff !== 0) {
        return specDiff;
      }
      const priA = a.priority ?? this.config.priority ?? 0;
      const priB = b.priority ?? this.config.priority ?? 0;
      const priDiff = priB - priA;
      if (priDiff !== 0) {
        return priDiff;
      }
      if (a.effect !== b.effect) {
        return a.effect === 'deny' ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });
    const winner = sorted[0];
    return {
      candidates,
      winner,
      winnerSpecificity: winner ? ruleSpecificity(winner) : 0,
    };
  }

  /**
   * Apply the configured default effect to a synthesized request.
   *
   * @param tool - Tool name.
   * @param capability - Optional capability.
   * @returns The decision the default would produce.
   */
  defaultDecision(tool: ToolName, capability?: CapabilityName): PermissionDecision {
    const request: PermissionRequest = { tool, capability };
    return this.config.default === 'allow'
      ? allowDecision(undefined, request, 'allowed by default policy')
      : denyDecision(undefined, request, 'denied by default policy (no matching rule)');
  }

  private collectCandidates(request: PermissionRequest): PermissionRule[] {
    const relevant = new Set<PermissionRule>();

    for (const rule of this.rules.listRules()) {
      if (rule.enabled === false) {
        continue;
      }
      if (this.ruleMatches(rule, request)) {
        relevant.add(rule);
      }
    }
    return Array.from(relevant);
  }

  private ruleMatches(rule: PermissionRule, request: PermissionRequest): boolean {
    if (rule.tool !== undefined && rule.tool !== request.tool) {
      return false;
    }
    if (rule.capability !== undefined) {
      if (request.capability === undefined) {
        return false;
      }
      if (!capabilityCovers(request.capability, rule.capability)) {
        return false;
      }
    }
    if (rule.roles !== undefined && rule.roles.length > 0) {
      const roles = this.requestRoles(request);
      if (roles.length === 0) {
        return false;
      }
      const hasWildcard = rule.roles.includes(WILDCARD);
      const matches = roles.some((role) => rule.roles!.includes(role));
      if (!matches && !hasWildcard) {
        return false;
      }
    }
    return true;
  }

  private requestRoles(request: PermissionRequest): RoleName[] {
    const roles = new Set<RoleName>();
    for (const role of request.roles ?? []) {
      roles.add(role);
    }
    const identity = request.identity;
    if (identity !== undefined) {
      roles.add(identity.subject);
      for (const group of identity.groups ?? []) {
        roles.add(group);
      }
    }
    return Array.from(roles);
  }

  private collectDeclared(toolDef: ToolDefinition): CapabilityName[] {
    const field = toolDef.capabilities;
    if (field === undefined) {
      return [];
    }
    if (Array.isArray(field)) {
      return field.filter(
        (cap): cap is string => typeof cap === 'string' && cap.length > 0
      );
    }
    const out: CapabilityName[] = [];
    for (const [cap, value] of Object.entries(field)) {
      if (value === false || value === 0 || value === '' || value === null || value === undefined) {
        continue;
      }
      out.push(cap);
    }
    return out;
  }

  private overrideCapabilities(tool: ToolName, capabilities: CapabilityName[]): void {
    this.rawCapabilities.set(tool, [...capabilities]);
    this.capabilities = { getCapabilities: (t) => this.rawCapabilities.get(t) };
  }

  private snapshotCapabilities(source: CapabilitySource): void {
    for (const tool of this.listKnownTools(source)) {
      const caps = source.getCapabilities(tool);
      if (caps) {
        this.rawCapabilities.set(tool, [...caps]);
      }
    }
  }

  private listKnownTools(source: CapabilitySource): ToolName[] {
    const probe = source as Partial<CapabilitySource> & { tools?: Iterable<ToolName> };
    if (typeof probe.tools !== 'undefined' && probe.tools !== null) {
      return Array.from(probe.tools);
    }
    return Array.from(this.rawCapabilities.keys());
  }
}

/**
 * A rules source backed by a plain array of rules.
 *
 * Useful for one-off checks or tests that do not need a full store.
 *
 * @public
 */
export class ArrayRuleSource implements PermissionRuleSource {
  private readonly byId = new Map<string, PermissionRule>();

  /**
   * @param rules - Initial rules.
   */
  constructor(rules: PermissionRule[] = []) {
    for (const rule of rules) {
      if (isPermissionRule(rule)) {
        this.byId.set(rule.id, rule);
      }
    }
  }

  getRule(ruleId: string): PermissionRule | undefined {
    return this.byId.get(ruleId);
  }

  listRules(): PermissionRule[] {
    return Array.from(this.byId.values());
  }

  /** The number of rules held. */
  get size(): number {
    return this.byId.size;
  }

  /** Add a rule to the source. */
  add(rule: PermissionRule): void {
    this.byId.set(rule.id, rule);
  }
}

/**
 * A capability source backed by a plain array of mappings.
 *
 * @public
 */
export class ArrayCapabilitySource implements CapabilitySource {
  private readonly byTool = new Map<ToolName, CapabilityName[]>();

  /**
   * @param mappings - Initial mappings.
   */
  constructor(mappings: CapabilityMapping[] = []) {
    for (const mapping of mappings) {
      this.byTool.set(mapping.tool, [...mapping.capabilities]);
    }
  }

  getCapabilities(tool: ToolName): CapabilityName[] | undefined {
    return this.byTool.get(tool);
  }
}

/**
 * Convenience: build a checker from a plain rule list and optional mappings.
 *
 * @param rules - Rules the checker should resolve against.
 * @param config - Optional checker configuration.
 * @param mappings - Optional capability mappings.
 * @returns A fully configured checker.
 */
export function createPermissionChecker(
  rules: PermissionRule[],
  config: Partial<PermissionConfig> = {},
  mappings: CapabilityMapping[] = []
): PermissionChecker {
  const source = new ArrayRuleSource(rules);
  const capSource = new ArrayCapabilitySource(mappings);
  return new PermissionChecker(source, config, capSource);
}