/**
 * @fileoverview
 * The retrieval and extraction engine of the Knowledge graph layer.
 *
 * {@link GraphEngine} is where text becomes graph.  It owns the two directions
 * of the layer's work:
 *
 *   1. **Extraction** — turning plain text into graph facts without any
 *      external NLP dependency.  `extractEntities` scans text with the
 *      heuristic patterns from {@link DEFAULT_ENTITY_PATTERNS}, resolves
 *      overlapping matches, and folds repeated mentions into candidates.
 *      `extractTriplets` applies a shallow subject-verb-object grammar to each
 *      sentence to emit raw {@link Triplet}s.
 *
 *   2. **Ingestion** — `addTriplet` turns a triplet into real graph data: it
 *      resolves the subject and object surface forms to entities (creating
 *      them, merging aliases, and bumping mention counts), then stores the
 *      relation, keeping the {@link GraphStore} and {@link GraphIndex} in
 *      lockstep.
 *
 *   3. **Traversal** — `query`, `paths`, `shortestPath`, and
 *      `degreeCentrality` read the graph back out for downstream consumers
 *      (the query layer answering "how is X related to Y?", the grounding
 *      layer citing a relation's `sourceText`).
 *
 * The engine is heuristic by design and says so plainly: it does not
 * understand grammar, it pattern-matches it.  Everything it produces is
 * deterministic, dependency-free, and explainable — every candidate carries
 * the mention spans and confidences that produced it, so callers can audit or
 * filter the results.
 *
 * @packageDocumentation
 */

import {
  type EntityCandidate,
  type EntityExtraction,
  type EntityMention,
  type EntityPattern,
  type EntityType,
  type GraphConfig,
  type GraphEntity,
  type GraphOptions,
  type GraphRelation,
  type Triplet,
  GRAPH_LIMITS,
  assertTriplet,
  createEntityCandidate,
  createEntityExtraction,
  createEntityMention,
  createGraphEntity,
  createGraphRelation,
  createTriplet,
  mergeGraphOptions,
  normalizeGraphConfig,
} from './types.js';
import { GraphStore, type Neighbor } from './store.js';
import { GraphIndex } from './index.js';

/**
 * The result of resolving one {@link Triplet} into graph data via
 * {@link GraphEngine.addTriplet}.
 */
export interface TripletResult {
  /** The id of the (created or merged) subject entity. */
  readonly subjectId: string;
  /** The id of the (created or merged) object entity. */
  readonly objectId: string;
  /** The id of the stored relation.  Empty when the triplet was degenerate. */
  readonly relationId: string;
  /** `true` when the relation was newly stored, `false` when it already existed. */
  readonly created: boolean;
}

/**
 * The result of {@link GraphEngine.query}: one entity with everything attached
 * to it.
 */
export interface QueryResult {
  /** The queried entity, or `undefined` when no such entity exists. */
  readonly entity: GraphEntity | undefined;
  /** One hop for every incident relation (the neighboring entity + relation). */
  readonly neighbors: readonly Neighbor[];
  /** Every relation that touches the entity (outgoing and incoming). */
  readonly relations: readonly GraphRelation[];
}

/**
 * A single route through the graph between two entities.
 */
export interface Path {
  /** The entity ids in order from source to target. */
  readonly nodes: readonly string[];
  /** The relation ids traversed between consecutive `nodes`. */
  readonly relations: readonly string[];
  /** `nodes.length - 1`, the number of hops. */
  readonly length: number;
}

/**
 * One row of {@link GraphEngine.degreeCentrality}.
 */
export interface CentralityEntry {
  /** An entity id. */
  readonly entityId: string;
  /** Its total (in + out) degree. */
  readonly degree: number;
  /** `degree / maxDegree` in `[0, 1]`, `0` for an empty graph. */
  readonly centrality: number;
}

/**
 * A small closed set of English copular/light verbs plus domain verbs the
 * SVO heuristic recognizes.  Non-global on purpose: the engine resets any
 * compiled global regexes it uses for scanning, and this one is used with
 * plain `exec` for a single verb per sentence.
 */
const VERB_PATTERN =
  /\b(?:is|am|are|was|were|be|been|has been|has|have|had|founded|co-founded|created|built|developed|launched|designed|invented|discovered|published|released|owns|owned|runs|ran|leads|led|joined|appointed|named|became|works at|worked at|worked for|based in|located in|sells|sold|produces|manufactures|acquired|merged|partnered|collaborates|supports|uses|used|recommends|studies|studied|argues|wrote|said|announced|introduced)\b/;

/**
 * Cache of compiled entity patterns, keyed by `flags|source`.  Compiling the
 * same pattern string repeatedly (once per extraction call) is measurable
 * overhead on hot paths, so the engine compiles once and reuses forever.
 * Entries are small and bounded by the number of distinct patterns in the
 * config, which is tiny.
 */
const PATTERN_CACHE = new Map<string, RegExp>();

/**
 * A text span before it has been grouped into a candidate.  Internal carrier
 * for the extractor's raw matches.
 */
interface RawMatch {
  readonly type: EntityType;
  readonly mention: EntityMention;
}

/**
 * The extraction and traversal engine of the graph layer.
 *
 * Create one engine per graph (or per domain), passing a config that may
 * override {@link DEFAULT_ENTITY_PATTERNS}.  The engine owns a
 * {@link GraphStore} and a {@link GraphIndex}; provide your own to share data
 * with other components (the lifecycle layer, the query layer) or let it
 * construct a fresh pair.
 */
export class GraphEngine {
  /** The store that owns authoritative entity/relation data. */
  private readonly storeInternal: GraphStore;

  /** The index that provides name/type/predicate lookups. */
  private readonly indexInternal: GraphIndex;

  /** The normalized, fully-populated config. */
  private readonly configInternal: Required<GraphConfig>;

  /**
   * Creates an engine.
   *
   * @param store - The store to use.  When omitted a fresh store is created.
   * @param index - The index to use.  When omitted a fresh index is created.
   *   If you pass a store but no index, a new (empty) index is created that is
   *   *not* pre-loaded from the store; call `rebuildFromStore()` to sync.
   * @param config - Graph tuning knobs, normalized immediately.
   */
  constructor(
    store?: GraphStore,
    index?: GraphIndex,
    config?: GraphConfig,
  ) {
    this.storeInternal = store ?? new GraphStore();
    this.indexInternal = index ?? new GraphIndex();
    this.configInternal = normalizeGraphConfig(config);
  }

  /** Returns the underlying store. */
  get store(): GraphStore {
    return this.storeInternal;
  }

  /** Returns the underlying index. */
  get index(): GraphIndex {
    return this.indexInternal;
  }

  /** Returns a copy of the effective config (safe to read and inspect). */
  getConfig(): Required<GraphConfig> {
    return { ...this.configInternal };
  }

  /**
   * Rebuilds the index from the current store contents.
   *
   * Use this when the engine was constructed with an external store that
   * already had data, or after a snapshot restore that bypassed the engine.
   *
   * @returns The number of records indexed.
   */
  rebuildFromStore(): number {
    return this.indexInternal.rebuild(
      this.storeInternal.listEntities(),
      this.storeInternal.listRelations(),
    );
  }

  /**
   * Scans text for entity candidates using the configured heuristic patterns.
   *
   * The pipeline is: split into sentences → match every pattern for every
   * requested type → resolve overlapping matches (the longest span wins) →
   * group repeated mentions into candidates → filter by confidence and the
   * configured minimum mention count → sort and cap.
   *
   * @param text - The text to scan.
   * @param options - Per-call overrides (min confidence, type filter, cap).
   * @returns An {@link EntityExtraction} with candidates in confidence order.
   */
  extractEntities(text: string, options?: GraphOptions): EntityExtraction {
    if (typeof text !== 'string') {
      throw new TypeError('extractEntities requires a string of text');
    }
    const opts = mergeGraphOptions(this.configInternal, options);

    const rawMatches: RawMatch[] = [];
    for (const type of opts.types) {
      for (const pattern of this.patternsFor(type)) {
        const regex = GraphEngine.compilePattern(pattern);
        for (const sentence of splitSentences(text)) {
          regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(sentence.text)) !== null) {
            if (match[0].length === 0) {
              regex.lastIndex += 1;
              continue;
            }
            rawMatches.push({
              type,
              mention: createEntityMention({
                text: match[0],
                start: sentence.offset + match.index,
                end: sentence.offset + match.index + match[0].length,
                confidence: pattern.confidence,
              }),
            });
          }
        }
      }
    }

    const resolved = resolveOverlaps(rawMatches);
    const candidates = this.groupCandidates(resolved, opts.mergeAliases);

    const filtered = candidates.filter(
      (candidate) =>
        candidate.mentions.length >= this.configInternal.minMentions &&
        candidate.confidence >= opts.minConfidence,
    );

    const capped = opts.maxEntities > 0 ? filtered.slice(0, opts.maxEntities) : filtered;
    return createEntityExtraction(text, capped);
  }

  /**
   * Extracts raw subject-verb-object triplets from text with a shallow
   * grammar.
   *
   * For each sentence the engine: extracts entity candidates; locates the
   * first verb; takes the entity candidate closest *before* the verb as the
   * subject (falling back to a leading capitalized phrase); takes the
   * candidate closest *after* the verb as the object (falling back to a
   * quoted span or a capitalized phrase); and emits a {@link Triplet} with the
   * predicate normalized to snake_case.
   *
   * @param text - The text to scan.
   * @param options - Per-call extraction overrides.
   * @returns The extracted triplets, in sentence order.
   */
  extractTriplets(text: string, options?: GraphOptions): Triplet[] {
    if (typeof text !== 'string') {
      throw new TypeError('extractTriplets requires a string of text');
    }
    const triplets: Triplet[] = [];
    for (const sentence of splitSentences(text)) {
      const extraction = this.extractEntities(sentence.text, options);
      VERB_PATTERN.lastIndex = 0;
      const verb = VERB_PATTERN.exec(sentence.text);
      if (verb === null) continue;

      const verbStart = verb.index;
      const verbEnd = verb.index + verb[0].length;

      const subject = GraphEngine.resolveSubject(extraction.candidates, verbStart, sentence.text);
      if (subject === null) continue;
      const object = GraphEngine.resolveObject(extraction.candidates, verbEnd, sentence.text);
      if (object === null) continue;

      triplets.push(createTriplet({
        subject,
        predicate: normalizePredicate(verb[0]),
        object,
      }));
    }
    return triplets;
  }

  /**
   * Ingests one triplet: resolves both surface forms to entities, merges
   * aliases, and stores the relation.
   *
   * Each surface form is resolved by name against the index.  When an entity
   * already exists, the surface form is folded in as an alias (if it differs
   * from the canonical name) and the entity's mention count is bumped.  When
   * none exists, an entity is created with a type inferred from its name and
   * a single mention.  The relation is then created and stored; re-adding the
   * same `<source, predicate, target>` is idempotent.
   *
   * A degenerate triplet whose subject and object resolve to the *same*
   * entity is skipped (a self-loop carries no information) and reported with
   * an empty `relationId` and `created: false`.
   *
   * @param triplet - The raw fact to ingest.
   * @param sourceText - Optional verbatim text to attach as provenance.
   */
  addTriplet(triplet: Triplet, sourceText?: string): TripletResult {
    assertTriplet(triplet);
    const subjectId = this.resolveOrCreate(triplet.subject);
    const objectId = this.resolveOrCreate(triplet.object);

    if (subjectId === objectId) {
      return { subjectId, objectId, relationId: '', created: false };
    }

    const predicate = normalizePredicate(triplet.predicate);
    const relation = createGraphRelation({
      source: subjectId,
      target: objectId,
      predicate,
      ...(sourceText !== undefined && sourceText.length > 0 ? { sourceText } : {}),
    });

    const created = this.storeInternal.addRelation(relation);
    if (created) {
      this.indexInternal.indexRelation(relation);
    }
    return { subjectId, objectId, relationId: relation.id, created };
  }

  /**
   * Ingests a batch of triplets.
   *
   * @param triplets - Facts to ingest, in order.  Each is processed via
   *   {@link addTriplet}; later triplets can reference entities created by
   *   earlier ones.
   * @returns One {@link TripletResult} per input triplet.
   */
  addTriplets(triplets: readonly Triplet[], sourceText?: string): TripletResult[] {
    const results: TripletResult[] = [];
    for (const triplet of triplets) {
      results.push(this.addTriplet(triplet, sourceText));
    }
    return results;
  }

  /**
   * Returns everything the graph knows about one entity.
   *
   * @param entityId - The entity to inspect.  Unknown ids yield a result with
   *   `entity: undefined` and empty neighbor/relation lists rather than an
   *   error, so downstream code can render an empty panel.
   */
  query(entityId: string): QueryResult {
    const entity = this.storeInternal.getEntity(entityId);
    if (entity === undefined) {
      return { entity: undefined, neighbors: [], relations: [] };
    }
    return {
      entity,
      neighbors: this.storeInternal.neighbors(entityId),
      relations: this.storeInternal.relationsFor(entityId),
    };
  }

  /**
   * Finds up to `maxPaths` distinct simple paths from `from` to `to` whose
   * length does not exceed `maxDepth`.
   *
   * Uses depth-first search over both directions of every edge (the graph is
   * traversed as undirected for reachability, since consumers usually want to
   * know "connected to" regardless of edge direction).  Paths are returned
   * sorted shortest-first.  The search is capped by {@link GraphOptions.maxPaths}
   * (default 50, hard-capped at 1000) so a dense graph cannot produce an
   * exponential blow-up.
   *
   * @returns Empty array when either endpoint is unknown or no route exists.
   */
  paths(from: string, to: string, maxDepth = 3, options?: GraphOptions): Path[] {
    const opts = mergeGraphOptions(this.configInternal, { ...options, maxDepth });
    const depthLimit = Math.max(1, Math.min(opts.maxDepth, 20));
    const pathLimit = Math.max(1, Math.min(opts.maxPaths, 1000));

    const results: Path[] = [];
    if (!this.storeInternal.hasEntity(from) || !this.storeInternal.hasEntity(to)) {
      return results;
    }
    if (from === to) {
      return [{ nodes: [from], relations: [], length: 0 }];
    }

    const visited = new Set<string>([from]);
    const nodes: string[] = [from];
    const relations: string[] = [];

    const dfs = (current: string): void => {
      if (results.length >= pathLimit) return;
      if (current === to) {
        results.push({ nodes: [...nodes], relations: [...relations], length: nodes.length - 1 });
        return;
      }
      if (nodes.length - 1 >= depthLimit) return;

      for (const neighbor of this.storeInternal.neighbors(current, 'both')) {
        const id = neighbor.entity.id;
        if (visited.has(id)) continue;
        visited.add(id);
        nodes.push(id);
        relations.push(neighbor.relation.id);
        dfs(id);
        nodes.pop();
        relations.pop();
        visited.delete(id);
        if (results.length >= pathLimit) return;
      }
    };

    dfs(from);
    return results.sort((a, b) => a.length - b.length);
  }

  /**
   * Returns the shortest hop-by-hop route from `from` to `to` as a list of
   * entity ids, or `null` when no route exists.
   *
   * Uses breadth-first search (unweighted, undirected), so the result is
   * guaranteed shortest in hops.  This is the cheap "are these two related at
   * all, and how tightly?" primitive the query layer relies on.
   *
   * @throws {@link RangeError} when either endpoint is not resident.
   */
  shortestPath(from: string, to: string): string[] | null {
    if (!this.storeInternal.hasEntity(from)) {
      throw new RangeError(`shortestPath: unknown source entity "${from}"`);
    }
    if (!this.storeInternal.hasEntity(to)) {
      throw new RangeError(`shortestPath: unknown target entity "${to}"`);
    }
    if (from === to) return [from];

    const visited = new Set<string>([from]);
    const parent = new Map<string, string>();
    const queue: string[] = [from];
    let head = 0;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      if (current === undefined) continue;
      if (current === to) break;
      for (const id of this.storeInternal.neighborIds(current, 'both')) {
        if (!visited.has(id)) {
          visited.add(id);
          parent.set(id, current);
          queue.push(id);
        }
      }
    }

    if (!parent.has(to)) return null;

    const path: string[] = [];
    let node: string | undefined = to;
    while (node !== undefined && node !== from) {
      path.push(node);
      node = parent.get(node);
    }
    if (node === undefined) return null;
    path.push(from);
    return path.reverse();
  }

  /**
   * Computes the degree centrality of every entity.
   *
   * Degree centrality is the fraction of the graph's *maximum* degree an
   * entity's own total degree represents, in `[0, 1]`.  It is the cheapest
   * meaningful "how central is this node" measure and requires no traversal —
   * it is computed straight from the store's maintained adjacency.  Entries
   * are sorted by degree descending.
   */
  degreeCentrality(): CentralityEntry[] {
    const ids = this.storeInternal.entityIds();
    const degrees = new Map<string, number>();
    let maxDegree = 0;
    for (const id of ids) {
      const degree = this.storeInternal.degreeTotal(id);
      degrees.set(id, degree);
      if (degree > maxDegree) maxDegree = degree;
    }

    const entries: CentralityEntry[] = ids.map((id) => {
      const degree = degrees.get(id) ?? 0;
      return {
        entityId: id,
        degree,
        centrality: maxDegree > 0 ? degree / maxDegree : 0,
      };
    });
    return entries.sort(
      (a, b) => b.degree - a.degree || a.entityId.localeCompare(b.entityId),
    );
  }

  /**
   * Infers the most likely {@link EntityType} for a bare name by scoring it
   * against the configured patterns and returning the highest-confidence
   * type.  Used by {@link resolveOrCreate} when a name has no existing
   * entity.  Falls back to `'other'`.
   */
  inferType(name: string, options?: GraphOptions): EntityType {
    const opts = mergeGraphOptions(this.configInternal, options);
    let best: { type: EntityType; score: number } | null = null;
    for (const type of opts.types) {
      for (const pattern of this.patternsFor(type)) {
        const regex = GraphEngine.compilePattern(pattern);
        regex.lastIndex = 0;
        const match = regex.exec(name);
        if (match !== null) {
          const score = pattern.confidence * (pattern.weight ?? 1);
          if (best === null || score > best.score) {
            best = { type, score };
          }
        }
      }
    }
    return best?.type ?? 'other';
  }

  /**
   * Returns the configured patterns for a type, or `[]` when the type has no
   * configured patterns.
   */
  private patternsFor(type: EntityType): readonly EntityPattern[] {
    return this.configInternal.entityPatterns[type] ?? [];
  }

  /**
   * Groups resolved mentions into candidates by `(type, normalized name)`,
   * folding repeated surface forms into a single candidate whose name takes
   * the casing of the first-seen mention and whose confidence is the best of
   * its mentions.
   */
  private groupCandidates(
    matches: readonly RawMatch[],
    mergeAliases: boolean,
  ): EntityCandidate[] {
    const groups = new Map<string, { name: string; type: EntityType; confidence: number; mentions: EntityMention[] }>();

    for (const item of matches) {
      const key = mergeAliases
        ? `${item.type}:${item.mention.text.toLowerCase()}`
        : `${item.type}:${item.mention.text}`;
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          name: item.mention.text,
          type: item.type,
          confidence: item.mention.confidence,
          mentions: [],
        };
        groups.set(key, group);
      } else if (item.mention.confidence > group.confidence) {
        group.confidence = item.mention.confidence;
      }
      group.mentions.push(item.mention);
    }

    const candidates: EntityCandidate[] = [];
    for (const group of groups.values()) {
      group.mentions.sort((a, b) => a.start - b.start);
      candidates.push(
        createEntityCandidate({
          name: group.name,
          type: group.type,
          confidence: group.confidence,
          mentions: group.mentions,
        }),
      );
    }
    return candidates;
  }

  /**
   * Resolves a surface form to an entity id, creating the entity when needed.
   *
   * Existing entities are matched case-insensitively by name or alias via the
   * index.  When merging is enabled, a previously unseen surface form is
   * folded into the existing entity as an alias and its mention count is
   * bumped.  New entities are created with {@link inferType} and one mention,
   * then registered in both store and index.
   */
  private resolveOrCreate(name: string, options?: GraphOptions): string {
    const opts = mergeGraphOptions(this.configInternal, options);
    const existing = this.indexInternal.findOneByName(name);

    if (existing !== undefined) {
      if (opts.mergeAliases) {
        const canonical = existing.name.toLowerCase();
        const incoming = name.toLowerCase();
        if (
          incoming !== canonical &&
          !(existing.aliases ?? []).some((alias) => alias.toLowerCase() === incoming)
        ) {
          const merged: GraphEntity = {
            ...existing,
            aliases: [...(existing.aliases ?? []), name].slice(0, GRAPH_LIMITS.MAX_ALIASES),
            mentions: (existing.mentions ?? 0) + 1,
          };
          this.storeInternal.upsertEntity(merged);
          this.indexInternal.indexEntity(merged);
        }
      }
      return existing.id;
    }

    const entity = createGraphEntity({
      name,
      type: this.inferType(name, options),
      mentions: 1,
    });
    this.storeInternal.addEntity(entity);
    this.indexInternal.indexEntity(entity);
    return entity.id;
  }

  /**
   * Compiles (or returns a cached compile of) an {@link EntityPattern} with a
   * `g` flag forced on for scanning.
   */
  private static compilePattern(pattern: EntityPattern): RegExp {
    const seen = new Set<string>(['g']);
    for (const flag of pattern.flags ?? 'i') seen.add(flag);
    const flags = [...seen].join('');
    const key = `${flags}|${pattern.pattern}`;
    const cached = PATTERN_CACHE.get(key);
    if (cached !== undefined) return cached;
    const regex = new RegExp(pattern.pattern, flags);
    PATTERN_CACHE.set(key, regex);
    return regex;
  }

  /**
   * Picks the subject of a sentence: the entity candidate whose mention ends
   * closest to (but before) the verb.  Falls back to a leading capitalized
   * phrase, then to `null`.
   */
  private static resolveSubject(
    candidates: readonly EntityCandidate[],
    verbStart: number,
    sentence: string,
  ): string | null {
    let best: EntityCandidate | null = null;
    let bestEnd = -1;
    for (const candidate of candidates) {
      for (const mention of candidate.mentions) {
        if (mention.end <= verbStart && mention.end > bestEnd) {
          bestEnd = mention.end;
          best = candidate;
        }
      }
    }
    if (best !== null) return best.name;

    const leading = LEADING_CAPITALIZED_RE.exec(sentence);
    return leading?.[1] ?? null;
  }

  /**
   * Picks the object of a sentence: the entity candidate whose mention starts
   * closest to (but after) the verb.  Falls back to a quoted span, then a
   * capitalized phrase after the verb, then `null`.
   */
  private static resolveObject(
    candidates: readonly EntityCandidate[],
    verbEnd: number,
    sentence: string,
  ): string | null {
    let best: EntityCandidate | null = null;
    let bestStart = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      for (const mention of candidate.mentions) {
        if (mention.start >= verbEnd && mention.start < bestStart) {
          bestStart = mention.start;
          best = candidate;
        }
      }
    }
    if (best !== null) return best.name;

    const after = sentence.slice(verbEnd);
    const quoted = QUOTED_SPAN_RE.exec(after);
    if (quoted !== null && quoted[1] !== undefined) return quoted[1];

    const capitalized = TRAILING_CAPITALIZED_RE.exec(after);
    return capitalized?.[1] ?? null;
  }
}

/**
 * A leading capitalized phrase used as a subject fallback: "Acme Corp
 * announced...".  Anchored at the sentence start.
 */
const LEADING_CAPITALIZED_RE = /^\s*([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)*)/;

/**
 * A quoted span (double, single, or backtick quotes) used as an object
 * fallback: `The product called "GraphQL" is...`.
 */
const QUOTED_SPAN_RE = /(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/;

/**
 * A capitalized phrase following a verb, used as an object fallback:
 * `...works at DeepMind`, `...founded DeepMind`.  Accepts one or more
 * capitalized words so bare proper nouns (including single-token names like
 * "DeepMind") are reachable when no pattern produced a candidate.
 */
const TRAILING_CAPITALIZED_RE = /[\s.,;:]([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*)*)/;

/**
 * Splits text into sentences, preserving each sentence's character offset in
 * the original text so mention spans stay globally accurate.  A trailing
 * fragment without terminal punctuation is still emitted as a sentence.
 */
export function splitSentences(text: string): ReadonlyArray<{ readonly text: string; readonly offset: number }> {
  const sentences: Array<{ text: string; offset: number }> = [];
  const re = /[^.!?]+(?:[.!?]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[0].length === 0) continue;
    sentences.push({ text: match[0], offset: match.index });
  }
  if (sentences.length === 0 && text.length > 0) {
    sentences.push({ text, offset: 0 });
  }
  return sentences;
}

/**
 * Resolves overlapping raw matches so a text span contributes to at most one
 * candidate.  Matches are sorted by start position (longest-first on ties) and
 * swept left to right; when a match overlaps the previously kept one, the
 * *stronger* match wins — higher confidence, then longer.  This makes a
 * specific, confident match beat a generic or preposition-wrapped one that
 * happens to be longer ("Acme Corp" as an `org` beats "at Acme Corp" as a
 * `location`), while still letting a phrase capture beat a bare word.
 */
export function resolveOverlaps(matches: readonly RawMatch[]): RawMatch[] {
  const sorted = [...matches].sort((a, b) => {
    if (a.mention.start !== b.mention.start) return a.mention.start - b.mention.start;
    return b.mention.end - a.mention.end;
  });

  const kept: RawMatch[] = [];
  for (const item of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || item.mention.start >= last.mention.end) {
      kept.push(item);
      continue;
    }
    const better =
      item.mention.confidence > last.mention.confidence ||
      (item.mention.confidence === last.mention.confidence &&
        item.mention.end > last.mention.end);
    if (better) kept[kept.length - 1] = item;
  }
  return kept;
}

/**
 * Normalizes a predicate surface form to snake_case: lowercased,
 * non-alphanumeric runs collapsed to a single underscore, leading/trailing
 * underscores stripped.  `"worked at"` → `"worked_at"`, `"is"` → `"is"`.
 * Falls back to `"is"` for an empty result.
 */
export function normalizePredicate(predicate: string): string {
  const normalized = predicate
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized.length > 0 ? normalized : 'is';
}