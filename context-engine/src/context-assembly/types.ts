/**
 * Shared domain types for the Context Assembly layer of the standalone MAM
 * Context Engine.
 *
 * The Context Assembly layer is the final gateway between an agent's raw
 * inputs and the model prompt. It answers the question every prompt builder
 * asks: *"given a pile of possibly-redundant, possibly-out-of-order parts,
 * what is the single, budget-aware, deterministic context string I should
 * send?"*
 *
 * The layer takes zero or more {@link ContextPart}s — system instructions,
 * user turns, tool results, memory records, knowledge entries and few-shot
 * examples — and produces one {@link AssembledContext}:
 *
 * 1. **Collect** — gather the raw parts supplied by the caller.
 * 2. **Dedupe** — drop parts whose content hash collides, so the same memory
 *    or tool result can never appear twice in one prompt.
 * 3. **Order** — sort parts by role priority (system first) overridden by any
 *    explicit per-part `order` value the caller assigned.
 * 4. **Budget** — when a token cap is configured, trim the least-retained
 *    parts (memory, then tool results) while always keeping protected roles
 *    such as `system`, so a model can never lose its instructions.
 * 5. **Render** — concatenate the survivors into a prompt string with role
 *    markers (`<|system|>`, `<|user|>`, ...) for the model's parser.
 *
 * The types in this module form the public contract shared by every other
 * file of the subsystem:
 *
 * - {@link ContextPart} — one addressable unit of context with a role,
 *   content and optional ordering/provenance metadata.
 * - {@link AssembledContext} — the result of an assembly pass: the kept
 *   parts, token count and the final prompt string.
 * - {@link AssemblyConfig} — construction-time behaviour options for the
 *   {@link ContextAssembler}, store, index and lifecycle.
 * - {@link AssembleOptions} — per-call overrides accepted by
 *   `assemble`/`run`.
 * - {@link AssemblyStats} — aggregate counters describing an assembly pass.
 *
 * Every value here is JSON-serialisable (metadata excluded only when it
 * contains non-serialisable values), so an {@link AssembledContext} can be
 * persisted for replay, evals or audit trails.
 *
 * @packageDocumentation
 * @module context-assembly/types
 */

/**
 * The set of roles a {@link ContextPart} may play inside an assembled prompt.
 *
 * The seven roles cover the three things a prompt is made of: instructions
 * (`system`), evidence (`memory`, `knowledge`, `example`) and the live
 * conversation (`user`, `assistant`, `tool`). Keeping them as a closed union
 * lets the layer compute role priorities, retention order and render markers
 * without string switches scattered across the code base.
 */
export type ContextRole =
  | 'system'
  | 'user'
  | 'assistant'
  | 'tool'
  | 'memory'
  | 'knowledge'
  | 'example';

/**
 * Unique identifier for a {@link ContextPart}.
 *
 * Part ids are opaque to the assembly layer — any collision-free scheme is
 * acceptable (a document id, a UUID, a counter). The layer uses them only as
 * map keys in the {@link ContextAssemblyStore} and {@link AssemblyIndex}.
 */
export type PartId = string;

/**
 * Epoch-millisecond timestamp.
 *
 * All wall-clock values in the context-assembly layer use epoch milliseconds
 * so they interoperate cleanly with `Date`, injected clocks and the TTL
 * arithmetic performed by the lifecycle.
 */
export type Timestamp = number;

/**
 * Strategy used to order assembled parts.
 *
 * - `'priority'` (default) — sort by role priority first (system, examples,
 *   knowledge, memory, then the live conversation), using each part's
 *   explicit {@link ContextPart.order} to break ties.
 * - `'explicit'` — honour only the per-part `order` value; parts without an
 *   order keep their insertion position.
 * - `'none'` — preserve the input order verbatim.
 */
export type OrderingStrategy = 'priority' | 'explicit' | 'none';

/**
 * Tag matching mode used by tag-aware lookups.
 *
 * `'all'` requires every requested tag to be present on a part; `'any'`
 * accepts a part carrying at least one of them.
 */
export type TagMode = 'all' | 'any';

/**
 * A single addressable unit of prompt context.
 *
 * Every role the engine understands is a {@link ContextPart}: a system
 * instruction, a user turn, an assistant reply, a tool result, a memory
 * record, a knowledge entry or a few-shot example. A part carries its
 * content, an estimated token count (computed lazily when omitted) and
 * optional provenance (`source`, `tags`) plus ordering hints (`order`).
 *
 * Parts are treated as immutable by the assembly layer: stores copy input
 * into canonical parts and never mutate the caller's objects.
 *
 * @example
 * ```ts
 * const sys: ContextPart = {
 *   id: 'sys-1',
 *   role: 'system',
 *   content: 'You are a helpful assistant.',
 *   tokens: 9,
 * };
 * const user: ContextPart = {
 *   id: 'usr-1',
 *   role: 'user',
 *   content: 'Summarise the release notes.',
 *   order: 0,
 * };
 * ```
 */
export interface ContextPart {
  /**
   * Unique identifier of the part. See {@link PartId}.
   */
  readonly id: PartId;

  /**
   * The role the part plays in the assembled prompt. Drives ordering,
   * retention and the render marker. See {@link ContextRole}.
   */
  readonly role: ContextRole;

  /**
   * The verbatim textual content of the part. This is what eventually lands
   * in the prompt string, so the assembly layer never rewrites it.
   */
  readonly content: string;

  /**
   * Precomputed token estimate for `content`. When omitted, the layer derives
   * one via {@link estimateTokens}. Storing it lets callers override the
   * heuristic with a model-accurate count from their tokenizer.
   */
  readonly tokens?: number;

  /**
   * Optional provenance label describing where the part came from (a file
   * name, a tool name, a memory namespace). Used by {@link AssemblyIndex}
   * source-based lookups and by {@link ContextAssemblyStore.bySource}.
   */
  readonly source?: string;

  /**
   * Optional set of tags attached to the part. Used by tag-based filtering in
   * the store, the index and include-role selection.
   */
  readonly tags?: readonly string[];

  /**
   * Optional explicit ordering hint. Parts with an `order` are emitted before
   * parts without one, and ties within a role are broken by ascending order.
   */
  readonly order?: number;

  /**
   * Caller-owned structured metadata preserved verbatim (e.g. `createdAt`,
   * `ttl`, `provenance`). The assembly layer never interprets it, but the
   * lifecycle may read `metadata.createdAt` when tracking age.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The input shape accepted by part factories and the store's `add` methods.
 *
 * Structurally identical to {@link ContextPart}; the only difference is
 * intent — an input may omit derived fields (`tokens`) and let the layer
 * compute them. A fully-formed {@link ContextPart} is a legal input too.
 */
export interface PartInput {
  /**
   * Unique identifier of the part. See {@link PartId}.
   */
  readonly id: PartId;

  /**
   * The role the part plays. See {@link ContextRole}.
   */
  readonly role: ContextRole;

  /**
   * The part's verbatim textual content.
   */
  readonly content: string;

  /**
   * Optional precomputed token estimate; defaults to
   * {@link estimateTokens}(`content`).
   */
  readonly tokens?: number;

  /**
   * Optional provenance label. See {@link ContextPart.source}.
   */
  readonly source?: string;

  /**
   * Optional set of tags. See {@link ContextPart.tags}.
   */
  readonly tags?: readonly string[];

  /**
   * Optional explicit ordering hint. See {@link ContextPart.order}.
   */
  readonly order?: number;

  /**
   * Optional caller-owned metadata. See {@link ContextPart.metadata}.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * The result of a single assembly pass.
 *
 * Produced by {@link ContextAssembler.assemble} and by
 * {@link ContextPipeline.run}. Carries the kept (deduped, ordered, budgeted)
 * parts, the total token count, the rendered prompt string and the pass's
 * statistics. The `prompt` field is `undefined` when the caller disabled
 * rendering (`AssembleOptions.buildPrompt === false`).
 */
export interface AssembledContext {
  /**
   * The parts that survived collection, deduplication, ordering and budget
   * trimming, in final display order.
   */
  readonly parts: readonly ContextPart[];

  /**
   * Total estimated tokens across `parts`.
   */
  readonly tokens: number;

  /**
   * The final prompt string rendered from `parts`, or `undefined` when the
   * caller disabled prompt building for this pass.
   */
  readonly prompt?: string;

  /**
   * Statistics about this pass (candidates, deduped/trimmed counts, role
   * distribution, timing). See {@link AssemblyStats}.
   */
  readonly stats: AssemblyStats;
}

/**
 * Construction-time configuration for the context-assembly subsystem.
 *
 * Every field is optional; the defaults are chosen so that a bare
 * `new ContextAssembler()` produces a sane, ordered, deduped prompt from any
 * input. Per-call {@link AssembleOptions} override these values for one pass.
 */
export interface AssemblyConfig {
  /**
   * Maximum number of tokens the assembled context may use. `0` (default)
   * disables the budget entirely. When exceeded, the lowest-retention parts
   * (see {@link ROLE_RETENTION}) are trimmed first; protected roles are never
   * trimmed.
   */
  readonly maxTokens?: number;

  /**
   * When `true` (default), parts whose content hash collides are collapsed to
   * their first occurrence. See {@link partHash}.
   */
  readonly dedupe?: boolean;

  /**
   * Optional whitelist of roles eligible for assembly. Parts whose role is
   * not listed are discarded before ordering. Defaults to all roles.
   */
  readonly includeRoles?: readonly ContextRole[];

  /**
   * Ordering strategy. See {@link OrderingStrategy}. Defaults to
   * `'priority'`.
   */
  readonly ordering?: OrderingStrategy;

  /**
   * Optional per-role overrides for the display priority table. Keys not
   * present fall back to {@link ROLE_PRIORITY}. Lower values sort earlier.
   */
  readonly rolePriority?: Partial<Readonly<Record<ContextRole, number>>>;

  /**
   * Optional per-role overrides for the retention table used by budget
   * trimming. Keys not present fall back to {@link ROLE_RETENTION}. Higher
   * values are trimmed first when the budget is exceeded.
   */
  readonly retention?: Partial<Readonly<Record<ContextRole, number>>>;

  /**
   * Roles that budget trimming must never remove. Defaults to `['system']` so
   * a model always keeps its instructions.
   */
  readonly protectRoles?: readonly ContextRole[];

  /**
   * Separator used between rendered parts when building the prompt string.
   * Defaults to {@link DEFAULT_SEPARATOR}.
   */
  readonly separator?: string;

  /**
   * Optional custom renderer for a single part. When set, it replaces
   * {@link ContextAssembler.render} for prompt construction. Receives the
   * part and returns the part's prompt fragment.
   */
  readonly labeler?: (part: ContextPart) => string;

  /**
   * Optional clock used instead of `Date.now()` for all timestamps. Injecting
   * a clock makes the layer deterministic under test.
   */
  readonly now?: () => Timestamp;
}

/**
 * Per-call overrides for a single assembly pass.
 *
 * Every field is optional; fields omitted fall back to the
 * {@link AssemblyConfig} the assembler was constructed with. Only `parts`
 * (the input collection) is assembly-specific and required in practice.
 */
export interface AssembleOptions {
  /**
   * The parts to assemble. Accepts fully-formed {@link ContextPart}s or
   * raw {@link PartInput}s, which are canonicalised before processing.
   * When omitted (e.g. from a {@link ContextPipeline} wired to a store), the
   * pipeline supplies the store's current contents.
   */
  readonly parts?: Iterable<ContextPart | PartInput>;

  /**
   * Optional role whitelist for this pass. Overrides
   * {@link AssemblyConfig.includeRoles}.
   */
  readonly includeRoles?: readonly ContextRole[];

  /**
   * Optional token budget for this pass. Overrides
   * {@link AssemblyConfig.maxTokens}. `0` disables the budget.
   */
  readonly maxTokens?: number;

  /**
   * Optional deduplication switch for this pass. Overrides
   * {@link AssemblyConfig.dedupe}.
   */
  readonly dedupe?: boolean;

  /**
   * Optional ordering strategy for this pass. Overrides
   * {@link AssemblyConfig.ordering}.
   */
  readonly ordering?: OrderingStrategy;

  /**
   * Optional protected-role set for this pass. Overrides
   * {@link AssemblyConfig.protectRoles}.
   */
  readonly protectRoles?: readonly ContextRole[];

  /**
   * Optional per-role display-priority overrides for this pass. Overrides
   * {@link AssemblyConfig.rolePriority} for the duration of the pass.
   */
  readonly rolePriority?: Partial<Readonly<Record<ContextRole, number>>>;

  /**
   * Optional per-role retention overrides for this pass. Overrides
   * {@link AssemblyConfig.retention} for the duration of the pass.
   */
  readonly retention?: Partial<Readonly<Record<ContextRole, number>>>;

  /**
   * Optional prompt separator for this pass. Overrides
   * {@link AssemblyConfig.separator}.
   */
  readonly separator?: string;

  /**
   * Optional custom per-part renderer for this pass. Overrides
   * {@link AssemblyConfig.labeler}.
   */
  readonly labeler?: (part: ContextPart) => string;

  /**
   * When `false`, the prompt string is not rendered and
   * {@link AssembledContext.prompt} is left `undefined`. Defaults to `true`.
   */
  readonly buildPrompt?: boolean;

  /**
   * Optional clock override for this pass's timestamps. When omitted, the
   * assembler's configured clock (or `Date.now()`) is used.
   */
  readonly now?: () => Timestamp;
}

/**
 * Aggregate statistics describing a single assembly pass (or, for
 * {@link ContextAssembler.stats}, a rolling summary of every pass so far).
 */
export interface AssemblyStats {
  /**
   * Number of parts in the final assembled context.
   */
  readonly parts: number;

  /**
   * Number of candidate parts supplied to the pass (before deduplication).
   */
  readonly candidates: number;

  /**
   * Total estimated tokens across the final parts.
   */
  readonly totalTokens: number;

  /**
   * Estimated tokens of the rendered prompt string (0 when rendering was
   * disabled).
   */
  readonly promptTokens: number;

  /**
   * Number of parts removed by content-hash deduplication.
   */
  readonly deduped: number;

  /**
   * Number of parts removed by budget trimming (0 when no budget is set or
   * the budget was not exceeded).
   */
  readonly trimmed: number;

  /**
   * Distribution of final parts by role, as a zero-filled record.
   */
  readonly roleCounts: Readonly<Record<ContextRole, number>>;

  /**
   * Epoch-millisecond time at which the pass completed.
   */
  readonly at: Timestamp;

  /**
   * Wall-clock duration of the pass in milliseconds.
   */
  readonly tookMs: number;
}

/**
 * All known roles, in canonical order (display priority order).
 */
export const ALL_ROLES: readonly ContextRole[] = [
  'system',
  'example',
  'knowledge',
  'memory',
  'user',
  'tool',
  'assistant',
];

/**
 * Display priority for each role: lower values sort earlier in the prompt.
 *
 * System instructions come first, followed by evidence-style parts (examples,
 * knowledge, memory) that support the conversation, then the live turns.
 */
export const ROLE_PRIORITY: Readonly<Record<ContextRole, number>> = {
  system: 0,
  example: 1,
  knowledge: 2,
  memory: 3,
  user: 4,
  tool: 5,
  assistant: 6,
};

/**
 * Retention priority used by budget trimming: **higher** values are dropped
 * first when the assembled context exceeds the token budget.
 *
 * System and user are nearly un-trimmable (system is additionally protected
 * by default); examples and knowledge are nice-to-have; memory and tool
 * results are the most expendable.
 */
export const ROLE_RETENTION: Readonly<Record<ContextRole, number>> = {
  system: 0,
  user: 1,
  example: 2,
  knowledge: 3,
  memory: 4,
  tool: 5,
  assistant: 6,
};

/**
 * Human-readable labels for each role, used in stats and diagnostics.
 */
export const ROLE_LABELS: Readonly<Record<ContextRole, string>> = {
  system: 'SYSTEM',
  user: 'USER',
  assistant: 'ASSISTANT',
  tool: 'TOOL',
  memory: 'MEMORY',
  knowledge: 'KNOWLEDGE',
  example: 'EXAMPLE',
};

/**
 * Prompt render markers for each role.
 *
 * {@link ContextAssembler.render} prefixes each part's content with its
 * marker so model parsers (and prompt-templating frameworks) can delimit
 * sections unambiguously. The format follows the widely-recognised
 * `<|role|>` convention.
 */
export const ROLE_MARKERS: Readonly<Record<ContextRole, string>> = {
  system: '<|system|>',
  user: '<|user|>',
  assistant: '<|assistant|>',
  tool: '<|tool_result|>',
  memory: '<|memory|>',
  knowledge: '<|knowledge|>',
  example: '<|example|>',
};

/**
 * Default separator between rendered parts in the prompt string.
 */
export const DEFAULT_SEPARATOR = '\n\n';

/**
 * Default token budget. `0` means unbounded — no trimming happens.
 */
export const DEFAULT_MAX_TOKENS = 0;

/**
 * Default deduplication behaviour: on.
 */
export const DEFAULT_DEDUPE = true;

/**
 * Default ordering strategy: role priority with explicit-order tie-breaks.
 */
export const DEFAULT_ORDERING: OrderingStrategy = 'priority';

/**
 * Roles that budget trimming protects by default.
 */
export const DEFAULT_PROTECTED_ROLES: readonly ContextRole[] = ['system'];

/**
 * Roles that default include-role filtering applies to (i.e. everything).
 */
export const DEFAULT_INCLUDE_ROLES: readonly ContextRole[] = ALL_ROLES;

/**
 * Structural type guard for {@link ContextRole}.
 *
 * @param value - the value to test
 * @returns `true` when `value` is one of the seven known roles
 */
export function isContextRole(value: unknown): value is ContextRole {
  return (
    typeof value === 'string' &&
    (ALL_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Structural type guard for {@link ContextPart}.
 *
 * Checks the three required fields (`id`, `role`, `content`) and tolerates
 * partial records, so it can also accept {@link PartInput}s.
 *
 * @param value - the value to test
 * @returns `true` when the value can be treated as a part
 */
export function isContextPart(value: unknown): value is ContextPart {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Partial<ContextPart>;
  return (
    typeof record.id === 'string' &&
    typeof record.content === 'string' &&
    isContextRole(record.role)
  );
}

/**
 * Coerce a raw role into a canonical {@link ContextRole}.
 *
 * Unknown roles fall back to `'user'`, so a malformed input never crashes an
 * assembly pass — it degrades gracefully to the most permissive role.
 *
 * @param role - the raw role value
 * @returns a known role, defaulting to `'user'`
 */
export function normalizeRole(role: unknown): ContextRole {
  return isContextRole(role) ? role : 'user';
}

/**
 * Clamp a number into `[min, max]`.
 *
 * @param value - the value to clamp
 * @param min - inclusive lower bound
 * @param max - inclusive upper bound
 * @returns the clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Normalise free text for hashing and comparison.
 *
 * Trims surrounding whitespace and collapses internal runs of whitespace to a
 * single space. Optionally lower-cases the result. Used to canonicalise
 * content before {@link partHash} so deduplication is robust to formatting
 * noise.
 *
 * @param text - the raw text to normalise
 * @param lower - when `true` (default), the result is lower-cased
 * @returns the normalised text, or `''` when `text` is falsy
 */
export function normalizeText(text: string | undefined, lower = true): string {
  if (!text) {
    return '';
  }
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return lower ? collapsed.toLowerCase() : collapsed;
}

/**
 * Estimate the token count of a piece of text.
 *
 * Uses a hybrid heuristic — the larger of the whitespace-delimited word count
 * and `length / 4` — which tracks the behaviour of common BPE tokenizers well
 * enough for budget bookkeeping. Callers with a real tokenizer should store
 * their own estimate in {@link ContextPart.tokens} instead.
 *
 * @param text - the text to estimate
 * @returns an estimated token count, `0` for empty input
 */
export function estimateTokens(text: string | undefined): number {
  if (!text) {
    return 0;
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(words, Math.ceil(text.length / 4));
}

/**
 * Compute a stable, collision-resistant content hash.
 *
 * Implements the FNV-1a 32-bit hash over the input. Deterministic across
 * processes and platforms, so hashes produced by one process can be compared
 * with those produced by another (e.g. a persisted dedupe cache). An optional
 * salt separates namespaces that share a hashing table.
 *
 * @param content - the string to hash
 * @param salt - optional namespace salt prepended to the input
 * @returns a zero-padded 8-hex-digit hash string
 */
export function contentHash(content: string, salt = ''): string {
  const input = `${salt}\u0000${content}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Compute the deduplication hash for a part.
 *
 * Hashes the normalised (whitespace-collapsed, case-preserved) content
 * together with the role, so two parts that differ only in role or in
 * whitespace layout are still treated as distinct where it matters.
 *
 * @param part - the part (or a role/content pair) to hash
 * @returns the deduplication hash
 */
export function partHash(
  part: Pick<ContextPart, 'role' | 'content'>,
): string {
  return contentHash(`${part.role}\u0000${normalizeText(part.content, false)}`);
}

/**
 * Canonicalise a part input into a fully-populated {@link ContextPart}.
 *
 * Derives the token estimate when omitted, copies tag/metadata arrays so the
 * caller's mutable objects can never alias store contents, and normalises the
 * role.
 *
 * @param input - the raw part input
 * @returns a new, canonical {@link ContextPart}
 */
export function createPart(input: PartInput): ContextPart {
  const role = normalizeRole(input.role);
  const tokens = input.tokens ?? estimateTokens(input.content);
  return {
    id: input.id,
    role,
    content: input.content,
    tokens,
    source: input.source,
    tags: input.tags ? [...input.tags] : undefined,
    order: input.order,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

/**
 * Build a role-tagged part from free-form input.
 *
 * The returned part always carries the requested `role` regardless of any
 * `overrides` that might collide with it; only id/source/tags/order/metadata/
 * tokens are overridable.
 *
 * @param role - the role to force on the part
 * @param content - the part's content
 * @param overrides - optional fields (id, source, tags, order, tokens, ...)
 * @returns a canonical {@link ContextPart}
 */
export function createRolePart(
  role: ContextRole,
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createPart({
    ...overrides,
    id: overrides.id ?? `${role}-${contentHash(normalizeText(content))}`,
    role,
    content,
  });
}

/**
 * Factory for a `system` part (model instructions).
 *
 * @param content - the instruction text
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical system part
 */
export function systemPart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('system', content, overrides);
}

/**
 * Factory for a `user` part (a user turn).
 *
 * @param content - the user's message
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical user part
 */
export function userPart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('user', content, overrides);
}

/**
 * Factory for an `assistant` part (a model reply).
 *
 * @param content - the assistant's message
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical assistant part
 */
export function assistantPart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('assistant', content, overrides);
}

/**
 * Factory for a `tool` part (a tool invocation result).
 *
 * @param content - the tool result text
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical tool part
 */
export function toolPart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('tool', content, overrides);
}

/**
 * Factory for a `memory` part (a recalled conversation memory record).
 *
 * @param content - the memory content
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical memory part
 */
export function memoryPart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('memory', content, overrides);
}

/**
 * Factory for a `knowledge` part (a retrieved knowledge-base entry).
 *
 * @param content - the knowledge content
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical knowledge part
 */
export function knowledgePart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('knowledge', content, overrides);
}

/**
 * Factory for an `example` part (a few-shot demonstration).
 *
 * @param content - the example content
 * @param overrides - optional fields (id, source, tags, order, ...)
 * @returns a canonical example part
 */
export function examplePart(
  content: string,
  overrides: Omit<Partial<PartInput>, 'role' | 'content'> = {},
): ContextPart {
  return createRolePart('example', content, overrides);
}

/**
 * Resolve the effective display-priority table from a config.
 *
 * Merges the caller's per-role overrides over {@link ROLE_PRIORITY}.
 *
 * @param config - optional configuration
 * @returns a complete role → priority table
 */
export function resolveRolePriority(
  config?: Pick<AssemblyConfig, 'rolePriority'>,
): Readonly<Record<ContextRole, number>> {
  return { ...ROLE_PRIORITY, ...(config?.rolePriority ?? {}) };
}

/**
 * Resolve the effective retention table from a config.
 *
 * Merges the caller's per-role overrides over {@link ROLE_RETENTION}.
 *
 * @param config - optional configuration
 * @returns a complete role → retention table
 */
export function resolveRetention(
  config?: Pick<AssemblyConfig, 'retention'>,
): Readonly<Record<ContextRole, number>> {
  return { ...ROLE_RETENTION, ...(config?.retention ?? {}) };
}

/**
 * Merge two configurations, with `overrides` winning.
 *
 * Deep-merges the `rolePriority` and `retention` tables (so per-call overrides
 * are additive rather than replacing) and shallow-overrides scalar fields.
 * Used to combine constructor config with per-call options.
 *
 * @param base - the base (constructor) configuration
 * @param overrides - the overriding (per-call) configuration
 * @returns a merged configuration
 */
export function mergeConfig(
  base: AssemblyConfig = {},
  overrides: AssemblyConfig = {},
): AssemblyConfig {
  return {
    maxTokens: overrides.maxTokens ?? base.maxTokens ?? DEFAULT_MAX_TOKENS,
    dedupe: overrides.dedupe ?? base.dedupe ?? DEFAULT_DEDUPE,
    includeRoles: overrides.includeRoles ?? base.includeRoles,
    ordering: overrides.ordering ?? base.ordering ?? DEFAULT_ORDERING,
    rolePriority: { ...(base.rolePriority ?? {}), ...(overrides.rolePriority ?? {}) },
    retention: { ...(base.retention ?? {}), ...(overrides.retention ?? {}) },
    protectRoles: overrides.protectRoles ?? base.protectRoles ?? DEFAULT_PROTECTED_ROLES,
    separator: overrides.separator ?? base.separator ?? DEFAULT_SEPARATOR,
    labeler: overrides.labeler ?? base.labeler,
    now: overrides.now ?? base.now,
  };
}

/**
 * Build a zero-filled role-count record (all roles present, value `0`).
 *
 * @returns a fresh role-count record
 */
export function emptyRoleCounts(): Record<ContextRole, number> {
  const counts = {} as Record<ContextRole, number>;
  for (const role of ALL_ROLES) {
    counts[role] = 0;
  }
  return counts;
}