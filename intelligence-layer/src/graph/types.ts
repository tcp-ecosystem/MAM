/**
 * @fileoverview
 * Core domain types for the Knowledge graph layer of the MAM Intelligence
 * engine.
 *
 * A knowledge graph is the engine's durable, navigable memory of "who/what is
 * connected to whom/what".  Unlike a flat document store it models the world as
 * a set of typed **entities** (people, organizations, locations, products,
 * concepts) joined by typed **relations** (a `person` `works_at` an `org`, a
 * `product` `built_by` an `org`).  Downstream layers — the grounding layer
 * that cites evidence, the query layer that answers natural language, the
 * lifecycle layer that keeps memory bounded — all read from this shared
 * vocabulary.
 *
 * This module defines the vocabulary used across the whole graph layer:
 *
 *   - {@link GraphEntity}   — a typed node in the graph.
 *   - {@link GraphRelation} — a typed, directed edge between two entities.
 *   - {@link Triplet}       — the raw `<subject, predicate, object>` shape that
 *     the extraction pipeline emits before it is resolved into entities.
 *   - {@link GraphConfig}   — tuning knobs shared across extraction, storage,
 *     indexing, and lifecycle.
 *   - {@link GraphStats}    — an aggregate snapshot of graph shape.
 *   - {@link GraphOptions}  — per-request overrides for a single operation.
 *   - {@link EntityMention} / {@link EntityCandidate} / {@link EntityExtraction}
 *     — the "spans found in text" result of the heuristic extractor.
 *
 * In addition to the types themselves this module exports the shared defaults
 * ({@link DEFAULT_GRAPH_CONFIG}, {@link DEFAULT_ENTITY_PATTERNS}), a set of
 * defensive runtime guards (`isGraphEntity`, `isGraphRelation`, ...),
 * assertion helpers that throw actionable errors, a normalizer that folds
 * caller-supplied configuration into a fully-populated record, and small
 * factories that let callers construct valid values (or sensible empty ones)
 * without hand-rolling the required shape every time.
 *
 * @packageDocumentation
 */

/**
 * The closed set of entity types the graph understands.  Every entity must
 * belong to exactly one of these; the heuristic extractor in `retrieval.ts`
 * assigns a type via {@link DEFAULT_ENTITY_PATTERNS}, and callers that insert
 * entities programmatically should pick the most specific type that applies.
 */
export type EntityType =
  | 'person'
  | 'org'
  | 'concept'
  | 'location'
  | 'product'
  | 'other';

/**
 * All entity types, in a stable order.  Used to iterate type buckets without
 * hard-coding the union in multiple places.
 */
export const ENTITY_TYPES: readonly EntityType[] = [
  'person',
  'org',
  'concept',
  'location',
  'product',
  'other',
] as const;

/**
 * Hard bounds for graph inputs.
 *
 * These exist to keep the graph predictable even when fed hostile or
 * degenerate input, and are enforced by the factories, guards, and the store.
 * They are deliberately generous: a graph within these bounds is a serious
 * in-memory model of a domain, not a toy.
 */
export const GRAPH_LIMITS = {
  /** Absolute upper bound on resident entities (defense in depth). */
  MAX_ENTITIES: 1_000_000,
  /** Absolute upper bound on resident relations. */
  MAX_RELATIONS: 2_000_000,
  /** Longest entity name (characters) accepted by the factories. */
  MAX_NAME_LENGTH: 256,
  /** Longest predicate (characters) accepted by the factories. */
  MAX_PREDICATE_LENGTH: 128,
  /** Longest id (characters) accepted by the factories. */
  MAX_ID_LENGTH: 256,
  /** Maximum number of aliases retained on a single entity. */
  MAX_ALIASES: 100,
  /** Smallest legal value for any `[0,1]` confidence / weight field. */
  MIN_CONFIDENCE: 0,
  /** Largest legal value for any `[0,1]` confidence / weight field. */
  MAX_CONFIDENCE: 1,
} as const;

/**
 * A single text span that the heuristic extractor matched for a candidate
 * entity.
 *
 * Mentions carry provenance: where in the source text the entity appeared and
 * how strongly the pattern that matched it signals that the span really names
 * that kind of thing.  The retrieval layer folds mentions together into an
 * {@link EntityCandidate} and the store's `mentions` counter on
 * {@link GraphEntity} is derived from them.
 */
export interface EntityMention {
  /** The exact text of the matched span, verbatim from the source. */
  readonly text: string;
  /** Character offset of the start of the span in the source text. */
  readonly start: number;
  /** Character offset one past the end of the span in the source text. */
  readonly end: number;
  /**
   * Pattern confidence in `[0, 1]`.  High-confidence spans (an honorific
   * before a name, an `Inc.` suffix) strongly indicate the entity type; low
   * confidence spans are "possibly this" and can be filtered by
   * {@link GraphOptions.minConfidence}.
   */
  readonly confidence: number;
}

/**
 * A single regex pattern used by the heuristic extractor for one entity type.
 *
 * Patterns are stored as **source strings** (plus flags) rather than compiled
 * `RegExp` objects so that {@link DEFAULT_ENTITY_PATTERNS} and any
 * {@link GraphConfig.entityPatterns} override remain plain, JSON-serializable
 * data.  The retrieval layer compiles them once and caches the compiled
 * results.
 */
export interface EntityPattern {
  /** The `RegExp` source.  A `g` flag is applied at compile time. */
  readonly pattern: string;
  /** Extra flags to pass to the compiled `RegExp` (default `"i"`). */
  readonly flags?: string;
  /**
   * How much a match of this pattern signals the entity type, in `[0, 1]`.
   * A match contributes this value as its {@link EntityMention.confidence}.
   */
  readonly confidence: number;
  /**
   * Optional multiplier applied to `confidence` when combining repeated
   * mentions, letting a pattern that is rare-but-precise outweigh a
   * common-but-sloppy one.  Defaults to `1`.
   */
  readonly weight?: number;
}

/**
 * The entity-type -> patterns mapping consumed by the extractor.
 *
 * The map is partial: an absent type falls back to `'other'` behaviour (the
 * generic multi-word-capitalized pattern), and callers can replace individual
 * types without re-specifying the rest.
 */
export type EntityPatterns = Partial<Record<EntityType, readonly EntityPattern[]>>;

/**
 * The default heuristic patterns, one set per entity type.
 *
 * These are deliberately conservative and explainable:
 *
 *   - **person** — honorific + name, two-word capitalized names, and
 *     role phrases like "CEO of Acme".
 *   - **org**    — corporate suffixes (`Inc.`, `LLC`, `GmbH`, ...) and
 *     institution prefixes (University, Ministry, Agency, ...).
 *   - **location** — geographic suffixes (City, River, Bay, ...) and
 *     prepositions that usually precede a place ("in Prague").
 *   - **product** — versioned names ("iPhone 15") and "the new X" phrasing.
 *   - **concept** — "the theory of X" and morphological markers
 *     (`-tion`, `-ism`, `-ity`, ...) on capitalized words.
 *   - **other**   — any capitalized phrase of three or more words.
 *
 * Override individual types (or the whole map) through
 * {@link GraphConfig.entityPatterns}.  See {@link EntityPattern} for the
 * storage format.
 */
export const DEFAULT_ENTITY_PATTERNS: EntityPatterns = {
  person: [
    {
      pattern: '\\b(?:Mr\\.|Mrs\\.|Ms\\.|Dr\\.|Prof\\.|Sir|Dame)\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+',
      flags: 'g',
      confidence: 0.9,
    },
    {
      pattern: '\\b[A-Z][a-z]+\\s+[A-Z][a-z]+\\b',
      flags: 'g',
      confidence: 0.55,
    },
    {
      pattern: '\\b(?:CEO|CTO|CFO|CIO|COO|President|Founder|Chairman|Director)\\s+(?:of\\s+)?[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*',
      flags: 'g',
      confidence: 0.8,
      weight: 1.2,
    },
  ],
  org: [
    {
      pattern: '\\b[A-Z][\\w&.]+(?:\\s+[A-Z][\\w&.]+)*\\s+(?:Inc\\.?|Corp\\.?|Corporation|Ltd\\.?|LLC|PLC|GmbH|Co\\.?|Company|Group|Holdings|Partners)\\b',
      flags: 'g',
      confidence: 0.85,
    },
    {
      pattern: '\\b(?:University|Institute|Ministry|Department|Agency|Foundation|Laboratory|Academy|Association|Organization|School|Hospital)\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*',
      flags: 'g',
      confidence: 0.8,
    },
    {
      pattern: '\\b[A-Z][a-z]+\\s+(?:Corporation|Company|Inc|Corp|Ltd|LLC)\\b',
      flags: 'g',
      confidence: 0.75,
    },
  ],
  location: [
    {
      pattern: '\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*(?:\\s+(?:City|County|Town|Village|Mountain|River|Lake|Sea|Ocean|Bay|Gulf|Valley|Island|Peninsula|Desert|Plateau|Park))\\b',
      flags: 'g',
      confidence: 0.85,
    },
    {
      pattern: '\\b(?:in|at|from|near|to|located\\s+in)\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+',
      flags: 'g',
      confidence: 0.6,
    },
  ],
  product: [
    {
      pattern: '\\b[A-Z][A-Za-z0-9]+(?:\\s*[0-9]+)+\\b',
      flags: 'g',
      confidence: 0.5,
    },
    {
      pattern: '\\b(?:new|latest|next[- ]gen|pro|premium|beta)\\s+[A-Z][A-Za-z0-9]+(?:\\s+[A-Z][A-Za-z0-9]+)*',
      flags: 'g',
      confidence: 0.5,
    },
  ],
  concept: [
    {
      pattern: '\\b(?:the\\s+)?(?:concept|idea|notion|theory|principle|practice|field)\\s+of\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)*',
      flags: 'g',
      confidence: 0.7,
    },
    {
      pattern: '\\b[A-Z][a-z]+(?:ing|tion|ism|ity|ment|ance|ence)\\b',
      flags: 'g',
      confidence: 0.35,
    },
  ],
  other: [
    {
      pattern: '\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){2,}\\b',
      flags: 'g',
      confidence: 0.5,
    },
  ],
};

/**
 * A typed node in the knowledge graph.
 *
 * Every entity has a stable `id`, a display `name`, and exactly one
 * {@link EntityType}.  `aliases` records alternative surface forms seen in
 * text ("Bill Gates" vs "William Gates"); `attributes` is a free-form bag for
 * caller-owned facts; `mentions` is the running count of how many times the
 * extractor has observed the entity, which the lifecycle layer can use as a
 * retention signal.  Instances are immutable by convention.
 */
export interface GraphEntity {
  /** Stable, unique identifier.  See {@link entityIdFromName}. */
  readonly id: string;
  /** The canonical display name. */
  readonly name: string;
  /** The entity's single type. */
  readonly type: EntityType;
  /** Alternative surface forms, normalized, with the name excluded. */
  readonly aliases?: readonly string[];
  /** Caller-owned facts keyed by name.  Values must be JSON-serializable. */
  readonly attributes?: Readonly<Record<string, unknown>>;
  /** Running count of observed mentions; `0` when never extracted. */
  readonly mentions?: number;
  /** Unix epoch milliseconds at which the entity was first seen. */
  readonly createdAt: number;
}

/**
 * A typed, directed edge from `source` to `target`.
 *
 * Relations are always directed: "Ada works_at DeepMind" is stored as
 * `source = Ada, target = DeepMind, predicate = works_at`.  `weight` is an
 * optional caller-meaningful strength in `[0, 1]`; `sourceText` records the
 * sentence the relation was extracted from, giving the graph provenance that
 * the grounding layer can cite.
 */
export interface GraphRelation {
  /** Stable, unique identifier.  See {@link createGraphRelation}. */
  readonly id: string;
  /** Id of the source (subject) entity.  Must exist in the store. */
  readonly source: string;
  /** Id of the target (object) entity.  Must exist in the store. */
  readonly target: string;
  /** The normalized predicate, e.g. `"works_at"`. */
  readonly predicate: string;
  /** Optional strength in `[0, 1]`. */
  readonly weight?: number;
  /** Optional verbatim text the relation was extracted from. */
  readonly sourceText?: string;
}

/**
 * The raw subject-predicate-object shape emitted by the extractor before it is
 * resolved into entity ids.
 *
 * A {@link Triplet} names its members by surface text; the retrieval layer's
 * {@link GraphEngine.addTriplet} turns each name into a {@link GraphEntity}
 * (creating or merging as needed) and then into a {@link GraphRelation}.
 */
export interface Triplet {
  /** The subject surface form ("Ada Lovelace"). */
  readonly subject: string;
  /** The predicate surface form ("worked at"). */
  readonly predicate: string;
  /** The object surface form ("DeepMind"). */
  readonly object: string;
}

/**
 * Shared tuning knobs for the whole graph layer.
 *
 * These defaults apply to extraction, storage, indexing, and lifecycle unless
 * overridden per call via {@link GraphOptions}.  The canonical defaults live
 * in {@link DEFAULT_GRAPH_CONFIG}; use {@link normalizeGraphConfig} to fold a
 * partial config into a complete one.
 */
export interface GraphConfig {
  /**
   * Upper bound on resident entities.  The store does not hard-reject past
   * this bound, but the lifecycle layer uses it as a pruning target.
   * Defaults to `10_000`.
   */
  readonly maxEntities?: number;

  /**
   * Upper bound on resident relations, used by the lifecycle as a pruning
   * signal.  Defaults to `50_000`.
   */
  readonly maxRelations?: number;

  /**
   * Minimum number of mentions a candidate must have to survive extraction.
   * Raising this above `1` keeps the graph clean at the cost of dropping
   * single-mention entities.  Defaults to `1`.
   */
  readonly minMentions?: number;

  /**
   * Per-type override of {@link DEFAULT_ENTITY_PATTERNS}.  Only the types
   * present are replaced; absent types keep the defaults.  When `undefined`
   * the full default pattern set is used.
   */
  readonly entityPatterns?: EntityPatterns;
}

/**
 * The canonical default graph configuration.
 */
export const DEFAULT_GRAPH_CONFIG: Readonly<Required<GraphConfig>> = {
  maxEntities: 10_000,
  maxRelations: 50_000,
  minMentions: 1,
  entityPatterns: DEFAULT_ENTITY_PATTERNS,
} as const;

/**
 * An aggregate snapshot of graph shape.
 *
 * Produced by `stats()` on the store, the index, and the lifecycle manager.
 * `density` and `averageDegree` describe connectivity; `byType` breaks the
 * entity population down so consumers can spot type imbalances.
 */
export interface GraphStats {
  /** Number of resident entities. */
  readonly entities: number;
  /** Number of resident relations. */
  readonly relations: number;
  /** Entity counts per {@link EntityType}. */
  readonly byType: Readonly<Record<EntityType, number>>;
  /** Sum of entity mention counts. */
  readonly totalMentions: number;
  /** Mean degree across all entities; `0` when there are none. */
  readonly averageDegree: number;
  /** `relations / (n·(n-1)/2)` — the fraction of possible edges present. */
  readonly density: number;
  /** Unix epoch milliseconds at which the snapshot was computed. */
  readonly updatedAt: number;
}

/**
 * Per-request overrides applied on top of the shared {@link GraphConfig}.
 *
 * Every field is optional; absent fields inherit the normalized config.
 * Callers that want a stricter extraction pass (a compliance path, a
 * deduplication sweep) should pass overrides here rather than mutating the
 * shared config.
 */
export interface GraphOptions {
  /**
   * Minimum mention confidence for a candidate to be returned by extraction.
   * Defaults to `0.4`.
   */
  readonly minConfidence?: number;

  /**
   * Restrict extraction to these entity types.  Defaults to all
   * {@link ENTITY_TYPES}.
   */
  readonly types?: readonly EntityType[];

  /**
   * Cap on the number of candidates returned by a single extraction call.
   * Defaults to the config's `maxEntities`.
   */
  readonly maxEntities?: number;

  /**
   * When `true`, candidate names are merged case-insensitively and the
   * canonical casing of the first-seen mention wins.  Defaults to `true`.
   */
  readonly mergeAliases?: boolean;

  /**
   * Maximum path depth accepted by traversal calls.  Defaults to `3`.
   */
  readonly maxDepth?: number;

  /**
   * Maximum number of distinct paths returned by `paths()`.  Defaults to `50`.
   */
  readonly maxPaths?: number;
}

/**
 * A resolved candidate entity extracted from text: one name, one type, and
 * every text span that contributed to it.
 */
export interface EntityCandidate {
  /** The canonical name (first-seen casing when merging is on). */
  readonly name: string;
  /** The type assigned from the matching pattern set. */
  readonly type: EntityType;
  /** Aggregate confidence — the best individual mention's confidence. */
  readonly confidence: number;
  /** Every mention folded into this candidate, in source order. */
  readonly mentions: readonly EntityMention[];
}

/**
 * The full result of one extraction pass over a piece of text.
 */
export interface EntityExtraction {
  /** The exact text that was scanned. */
  readonly text: string;
  /** Candidates sorted by confidence descending, then by name. */
  readonly candidates: readonly EntityCandidate[];
  /** Unix epoch milliseconds at which the extraction ran. */
  readonly createdAt: number;
}

/**
 * Returns `true` when `value` is a plain object (a non-null object that is
 * not an array).  Internal helper used by every public guard.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Returns `true` when `obj` has its own enumerable property named `key`.
 * Uses `Object.prototype.hasOwnProperty` defensively so a hostile object with
 * an overridden `hasOwnProperty` cannot break the check.
 */
export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Returns `true` when `value` is a finite number.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Returns `true` when `value` is a finite number in the closed interval
 * `[min, max]`.
 */
export function isFiniteInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

/**
 * Returns `true` when `value` is a string with at least one non-whitespace
 * character.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns `true` when `value` is an array of non-empty strings.
 */
export function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  for (const entry of value) {
    if (!isNonEmptyString(entry)) return false;
  }
  return true;
}

/**
 * Returns `true` when `value` is a valid {@link EntityType}.
 */
export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && (ENTITY_TYPES as readonly string[]).includes(value);
}

/**
 * Returns `true` when `value` is a valid {@link EntityPattern}.
 */
export function isEntityPattern(value: unknown): value is EntityPattern {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.pattern)) return false;
  if (hasOwn(value, 'flags') && value.flags !== undefined && typeof value.flags !== 'string') return false;
  if (!isFiniteInRange(value.confidence, GRAPH_LIMITS.MIN_CONFIDENCE, GRAPH_LIMITS.MAX_CONFIDENCE)) return false;
  if (hasOwn(value, 'weight') && value.weight !== undefined && !isFiniteNumber(value.weight)) return false;
  return true;
}

/**
 * Returns `true` when `value` is a valid {@link EntityPatterns} map.
 */
export function isEntityPatterns(value: unknown): value is EntityPatterns {
  if (!isRecord(value)) return false;
  for (const [key, patterns] of Object.entries(value)) {
    if (!isEntityType(key)) return false;
    if (!Array.isArray(patterns)) return false;
    for (const pattern of patterns) {
      if (!isEntityPattern(pattern)) return false;
    }
  }
  return true;
}

/**
 * Returns `true` when `value` is a valid {@link EntityMention}.
 */
export function isEntityMention(value: unknown): value is EntityMention {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.text)) return false;
  if (!Number.isInteger(value.start) || (value.start as number) < 0) return false;
  if (!Number.isInteger(value.end) || (value.end as number) < (value.start as number)) return false;
  if (!isFiniteInRange(value.confidence, GRAPH_LIMITS.MIN_CONFIDENCE, GRAPH_LIMITS.MAX_CONFIDENCE)) return false;
  return true;
}

/**
 * Runtime guard for {@link GraphEntity}.
 *
 * A value is a valid entity when it is a record with a non-empty string `id`
 * and `name`, a valid {@link EntityType}, an optional string array of
 * aliases, an optional attributes record, an optional non-negative integer
 * mention count, and a finite `createdAt`.  Malformed optional fields are
 * treated as invalid rather than silently coerced.
 */
export function isGraphEntity(value: unknown): value is GraphEntity {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isEntityType(value.type)) return false;
  if (hasOwn(value, 'aliases') && value.aliases !== undefined && !isStringArray(value.aliases)) return false;
  if (
    hasOwn(value, 'attributes') &&
    value.attributes !== undefined &&
    (!isRecord(value.attributes))
  ) {
    return false;
  }
  if (
    hasOwn(value, 'mentions') &&
    value.mentions !== undefined &&
    (!Number.isInteger(value.mentions) || (value.mentions as number) < 0)
  ) {
    return false;
  }
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

/**
 * Runtime guard for {@link GraphRelation}.
 */
export function isGraphRelation(value: unknown): value is GraphRelation {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id)) return false;
  if (!isNonEmptyString(value.source)) return false;
  if (!isNonEmptyString(value.target)) return false;
  if (!isNonEmptyString(value.predicate)) return false;
  if (hasOwn(value, 'weight') && value.weight !== undefined && !isFiniteNumber(value.weight)) return false;
  if (hasOwn(value, 'sourceText') && value.sourceText !== undefined && typeof value.sourceText !== 'string') return false;
  return true;
}

/**
 * Runtime guard for {@link Triplet}.
 */
export function isTriplet(value: unknown): value is Triplet {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.subject)) return false;
  if (!isNonEmptyString(value.predicate)) return false;
  if (!isNonEmptyString(value.object)) return false;
  return true;
}

/**
 * Runtime guard for {@link GraphConfig}.  Every present field is checked;
 * absent fields are allowed (they inherit defaults).
 */
export function isGraphConfig(value: unknown): value is GraphConfig {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'maxEntities') && !(isFiniteNumber(value.maxEntities) && (value.maxEntities as number) > 0)) return false;
  if (hasOwn(value, 'maxRelations') && !(isFiniteNumber(value.maxRelations) && (value.maxRelations as number) > 0)) return false;
  if (hasOwn(value, 'minMentions') && !(Number.isInteger(value.minMentions) && (value.minMentions as number) > 0)) return false;
  if (hasOwn(value, 'entityPatterns') && value.entityPatterns !== undefined && !isEntityPatterns(value.entityPatterns)) return false;
  return true;
}

/**
 * Runtime guard for {@link GraphStats}.
 */
export function isGraphStats(value: unknown): value is GraphStats {
  if (!isRecord(value)) return false;
  if (typeof value.entities !== 'number') return false;
  if (typeof value.relations !== 'number') return false;
  if (!isRecord(value.byType)) return false;
  for (const type of ENTITY_TYPES) {
    if (typeof value.byType[type] !== 'number') return false;
  }
  if (typeof value.totalMentions !== 'number') return false;
  if (!isFiniteNumber(value.averageDegree)) return false;
  if (!isFiniteNumber(value.density)) return false;
  if (!isFiniteNumber(value.updatedAt)) return false;
  return true;
}

/**
 * Runtime guard for {@link GraphOptions}.
 */
export function isGraphOptions(value: unknown): value is GraphOptions {
  if (!isRecord(value)) return false;
  if (hasOwn(value, 'minConfidence') && !isFiniteInRange(value.minConfidence, 0, 1)) return false;
  if (hasOwn(value, 'types')) {
    if (!Array.isArray(value.types)) return false;
    for (const type of value.types) {
      if (!isEntityType(type)) return false;
    }
  }
  if (hasOwn(value, 'maxEntities') && !(isFiniteNumber(value.maxEntities) && (value.maxEntities as number) > 0)) return false;
  if (hasOwn(value, 'mergeAliases') && typeof value.mergeAliases !== 'boolean') return false;
  if (hasOwn(value, 'maxDepth') && !(Number.isInteger(value.maxDepth) && (value.maxDepth as number) > 0)) return false;
  if (hasOwn(value, 'maxPaths') && !(Number.isInteger(value.maxPaths) && (value.maxPaths as number) > 0)) return false;
  return true;
}

/**
 * Runtime guard for {@link EntityCandidate}.
 */
export function isEntityCandidate(value: unknown): value is EntityCandidate {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.name)) return false;
  if (!isEntityType(value.type)) return false;
  if (!isFiniteInRange(value.confidence, 0, 1)) return false;
  if (!Array.isArray(value.mentions)) return false;
  for (const mention of value.mentions) {
    if (!isEntityMention(mention)) return false;
  }
  return true;
}

/**
 * Runtime guard for {@link EntityExtraction}.
 */
export function isEntityExtraction(value: unknown): value is EntityExtraction {
  if (!isRecord(value)) return false;
  if (typeof value.text !== 'string') return false;
  if (!Array.isArray(value.candidates)) return false;
  for (const candidate of value.candidates) {
    if (!isEntityCandidate(candidate)) return false;
  }
  if (!isFiniteNumber(value.createdAt)) return false;
  return true;
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link GraphEntity}.
 */
export function assertGraphEntity(value: unknown, message = 'Expected a valid GraphEntity'): asserts value is GraphEntity {
  if (!isGraphEntity(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link GraphRelation}.
 */
export function assertGraphRelation(value: unknown, message = 'Expected a valid GraphRelation'): asserts value is GraphRelation {
  if (!isGraphRelation(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link Triplet}.
 */
export function assertTriplet(value: unknown, message = 'Expected a valid Triplet'): asserts value is Triplet {
  if (!isTriplet(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link TypeError} with `message` when `value` is not a valid
 * {@link EntityExtraction}.
 */
export function assertEntityExtraction(value: unknown, message = 'Expected a valid EntityExtraction'): asserts value is EntityExtraction {
  if (!isEntityExtraction(value)) {
    throw new TypeError(message);
  }
}

/**
 * Throws a {@link RangeError} with `message` when `value` is not a finite
 * number inside the closed interval `[min, max]`.
 */
export function assertFiniteInRange(value: unknown, min: number, max: number, message: string): asserts value is number {
  if (!isFiniteInRange(value, min, max)) {
    throw new RangeError(message);
  }
}

/**
 * Folds a partial {@link GraphConfig} into a fully-populated, `Required`
 * config.  Missing fields take their values from
 * {@link DEFAULT_GRAPH_CONFIG}.  Invalid present fields throw, so the result
 * is always usable without further checks.
 */
export function normalizeGraphConfig(config?: GraphConfig): Required<GraphConfig> {
  if (config !== undefined && !isGraphConfig(config)) {
    throw new TypeError('config must be a valid GraphConfig object');
  }
  const maxEntities = config?.maxEntities ?? DEFAULT_GRAPH_CONFIG.maxEntities;
  const maxRelations = config?.maxRelations ?? DEFAULT_GRAPH_CONFIG.maxRelations;
  const minMentions = config?.minMentions ?? DEFAULT_GRAPH_CONFIG.minMentions;
  const entityPatterns = config?.entityPatterns ?? DEFAULT_ENTITY_PATTERNS;

  if (!Number.isFinite(maxEntities) || maxEntities < 1) {
    throw new RangeError(`GraphConfig.maxEntities must be a positive number, got ${maxEntities}`);
  }
  if (!Number.isFinite(maxRelations) || maxRelations < 1) {
    throw new RangeError(`GraphConfig.maxRelations must be a positive number, got ${maxRelations}`);
  }
  if (!Number.isInteger(minMentions) || minMentions < 1) {
    throw new RangeError(`GraphConfig.minMentions must be a positive integer, got ${minMentions}`);
  }

  return {
    maxEntities,
    maxRelations,
    minMentions,
    entityPatterns,
  };
}

/**
 * Folds per-request {@link GraphOptions} on top of a normalized
 * {@link GraphConfig}.  The returned object is fully populated and can be
 * read without any `??` fallbacks downstream.
 */
export function mergeGraphOptions(
  config: Required<GraphConfig>,
  options?: GraphOptions,
): Required<GraphConfig> & {
  minConfidence: number;
  types: readonly EntityType[];
  maxEntities: number;
  mergeAliases: boolean;
  maxDepth: number;
  maxPaths: number;
} {
  if (options !== undefined && !isGraphOptions(options)) {
    throw new TypeError('options must be a valid GraphOptions object');
  }
  const maxEntities = options?.maxEntities ?? config.maxEntities;
  if (!Number.isFinite(maxEntities) || maxEntities < 1) {
    throw new RangeError(`options.maxEntities must be a positive number, got ${maxEntities}`);
  }
  return {
    maxRelations: config.maxRelations,
    minMentions: config.minMentions,
    entityPatterns: config.entityPatterns,
    minConfidence: options?.minConfidence ?? 0.4,
    types: options?.types ?? ENTITY_TYPES,
    maxEntities,
    mergeAliases: options?.mergeAliases ?? true,
    maxDepth: options?.maxDepth ?? 3,
    maxPaths: options?.maxPaths ?? 50,
  };
}

/**
 * Constructs a valid {@link EntityMention}.
 */
export function createEntityMention(input: {
  text: string;
  start: number;
  end: number;
  confidence: number;
}): EntityMention {
  if (!isNonEmptyString(input.text)) {
    throw new TypeError('EntityMention.text must be a non-empty string');
  }
  if (!Number.isInteger(input.start) || input.start < 0) {
    throw new RangeError('EntityMention.start must be a non-negative integer');
  }
  if (!Number.isInteger(input.end) || input.end < input.start) {
    throw new RangeError('EntityMention.end must be an integer >= start');
  }
  assertFiniteInRange(input.confidence, 0, 1, 'EntityMention.confidence must be in [0, 1]');
  return {
    text: input.text,
    start: input.start,
    end: input.end,
    confidence: input.confidence,
  };
}

/**
 * Constructs an {@link EntityCandidate} from a name, type, and mentions.
 * `confidence` defaults to the best individual mention confidence.
 */
export function createEntityCandidate(input: {
  name: string;
  type: EntityType;
  mentions?: readonly EntityMention[];
  confidence?: number;
}): EntityCandidate {
  if (!isNonEmptyString(input.name)) {
    throw new TypeError('EntityCandidate.name must be a non-empty string');
  }
  if (!isEntityType(input.type)) {
    throw new TypeError(`EntityCandidate.type must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  const mentions = input.mentions ?? [];
  let confidence = input.confidence;
  if (confidence === undefined) {
    confidence = 0;
    for (const mention of mentions) {
      if (mention.confidence > confidence) confidence = mention.confidence;
    }
  }
  assertFiniteInRange(confidence, 0, 1, 'EntityCandidate.confidence must be in [0, 1]');
  return { name: input.name, type: input.type, confidence, mentions };
}

/**
 * Constructs an {@link EntityExtraction} for a piece of text and its
 * candidates.  Candidates are sorted by confidence descending, then by name.
 */
export function createEntityExtraction(
  text: string,
  candidates: readonly EntityCandidate[],
): EntityExtraction {
  if (typeof text !== 'string') {
    throw new TypeError('EntityExtraction.text must be a string');
  }
  for (const candidate of candidates) {
    if (!isEntityCandidate(candidate)) {
      throw new TypeError('EntityExtraction.candidates contains an invalid EntityCandidate');
    }
  }
  const sorted = [...candidates].sort(
    (a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name),
  );
  return { text, candidates: sorted, createdAt: Date.now() };
}

/**
 * Constructs a fully-valid {@link GraphEntity}.
 *
 * `id` defaults to a stable, collision-resistant identifier derived from the
 * name via {@link entityIdFromName}, so callers that do not manage their own
 * identities can still insert usable entities.  When `id` is provided it is
 * validated and preserved.  Aliases are de-duplicated and stripped of the
 * primary name.
 */
export function createGraphEntity(input: {
  name: string;
  type?: EntityType;
  id?: string;
  aliases?: readonly string[];
  attributes?: Readonly<Record<string, unknown>>;
  mentions?: number;
  createdAt?: number;
}): GraphEntity {
  if (!isNonEmptyString(input.name) || input.name.length > GRAPH_LIMITS.MAX_NAME_LENGTH) {
    throw new TypeError(
      `GraphEntity.name must be a non-empty string of at most ${GRAPH_LIMITS.MAX_NAME_LENGTH} characters`,
    );
  }
  const type = input.type ?? 'other';
  if (!isEntityType(type)) {
    throw new TypeError(`GraphEntity.type must be one of ${ENTITY_TYPES.join(', ')}`);
  }
  const id = input.id ?? entityIdFromName(input.name);
  if (!isNonEmptyString(id) || id.length > GRAPH_LIMITS.MAX_ID_LENGTH) {
    throw new TypeError('GraphEntity.id must be a non-empty string');
  }
  let aliases: string[] = [];
  if (input.aliases !== undefined) {
    if (!isStringArray(input.aliases)) {
      throw new TypeError('GraphEntity.aliases must be an array of non-empty strings');
    }
    const normalized = new Set<string>();
    const primary = input.name.toLowerCase();
    for (const alias of input.aliases) {
      const key = alias.toLowerCase();
      if (key !== primary && !normalized.has(key)) normalized.add(key);
    }
    aliases = [...normalized].slice(0, GRAPH_LIMITS.MAX_ALIASES);
  }
  const mentions = input.mentions ?? 0;
  if (!Number.isInteger(mentions) || mentions < 0) {
    throw new RangeError('GraphEntity.mentions must be a non-negative integer');
  }
  const createdAt = input.createdAt ?? Date.now();
  if (!isFiniteNumber(createdAt)) {
    throw new TypeError('GraphEntity.createdAt must be a finite number');
  }
  return {
    id,
    name: input.name,
    type,
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(input.attributes !== undefined ? { attributes: input.attributes } : {}),
    mentions,
    createdAt,
  };
}

/**
 * Constructs a fully-valid {@link GraphRelation}.
 *
 * `id` defaults to a stable identifier derived from
 * `source:predicate:target`, so adding the same edge twice (with the same
 * endpoints) is naturally idempotent.  `weight` is optional and must be a
 * finite number; when provided it is typically the extraction confidence.
 */
export function createGraphRelation(input: {
  source: string;
  target: string;
  predicate: string;
  id?: string;
  weight?: number;
  sourceText?: string;
}): GraphRelation {
  for (const [label, value] of [
    ['source', input.source],
    ['target', input.target],
    ['predicate', input.predicate],
  ] as const) {
    if (!isNonEmptyString(value) || value.length > GRAPH_LIMITS.MAX_NAME_LENGTH) {
      throw new TypeError(`GraphRelation.${label} must be a non-empty string`);
    }
  }
  if (input.predicate.length > GRAPH_LIMITS.MAX_PREDICATE_LENGTH) {
    throw new TypeError(
      `GraphRelation.predicate must be at most ${GRAPH_LIMITS.MAX_PREDICATE_LENGTH} characters`,
    );
  }
  if (input.source === input.target) {
    throw new RangeError('GraphRelation.source and target must differ');
  }
  if (input.weight !== undefined && !isFiniteNumber(input.weight)) {
    throw new TypeError('GraphRelation.weight must be a finite number when provided');
  }
  if (input.sourceText !== undefined && typeof input.sourceText !== 'string') {
    throw new TypeError('GraphRelation.sourceText must be a string when provided');
  }
  const id = input.id ?? `${input.source}:${input.predicate}:${input.target}`;
  return {
    id,
    source: input.source,
    target: input.target,
    predicate: input.predicate,
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
    ...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
  };
}

/**
 * Constructs a {@link Triplet} from its parts, validating each surface form.
 */
export function createTriplet(input: {
  subject: string;
  predicate: string;
  object: string;
}): Triplet {
  for (const [label, value] of [
    ['subject', input.subject],
    ['predicate', input.predicate],
    ['object', input.object],
  ] as const) {
    if (!isNonEmptyString(value)) {
      throw new TypeError(`Triplet.${label} must be a non-empty string`);
    }
  }
  return {
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
  };
}

/**
 * Constructs a fully-populated {@link GraphStats} snapshot, defaulting any
 * missing counter to zero and `byType` to a zeroed per-type record.
 */
export function createGraphStats(partial?: Partial<GraphStats>): GraphStats {
  const byType: Record<EntityType, number> = {
    person: 0,
    org: 0,
    concept: 0,
    location: 0,
    product: 0,
    other: 0,
  };
  if (partial?.byType !== undefined) {
    for (const type of ENTITY_TYPES) {
      byType[type] = partial.byType[type] ?? 0;
    }
  }
  return {
    entities: partial?.entities ?? 0,
    relations: partial?.relations ?? 0,
    byType,
    totalMentions: partial?.totalMentions ?? 0,
    averageDegree: partial?.averageDegree ?? 0,
    density: partial?.density ?? 0,
    updatedAt: partial?.updatedAt ?? Date.now(),
  };
}

/**
 * Returns a zero-activity {@link GraphStats}.  Useful as the stable return
 * value for empty graphs so callers never have to branch on emptiness.
 */
export function emptyGraphStats(): GraphStats {
  return createGraphStats();
}

/**
 * Stable FNV-1a 32-bit hash of a string, hex-encoded.
 *
 * This is a content key, not a security primitive; collisions are practically
 * impossible for the short strings the graph hashes (names, predicates) but
 * not adversarially prevented.  Used by {@link entityIdFromName} and by the
 * index's normalized lookups.
 */
export function hashString(text: string): string {
  const normalized = text.normalize('NFKD').toLowerCase().trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Derives a stable, collision-resistant entity id from a display name.
 *
 * The id is `<slug>-<hash>`: the slug makes ids human-readable in logs and
 * dumps ("ada-lovelace-9a2f..."), and the hash disambiguates names that slug
 * to the same form ("ACME Corp." vs "Acme Corp").  Deterministic for
 * identical input, so the same name always maps to the same id and
 * re-insertion is naturally idempotent.
 */
export function entityIdFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : 'entity';
  return `${base}-${hashString(name)}`;
}

/**
 * Synthesizes a stable, collision-resistant identifier from arbitrary text,
 * prefixed with `rel` for relations.  Deterministic for identical input.
 */
export function syntheticId(text: string): string {
  return `rel-${hashString(text)}-${text.length.toString(16)}`;
}