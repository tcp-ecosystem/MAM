/**
 * Runtime integration layer: expose episodic memory behind a uniform surface.
 *
 * The episodic subsystem speaks in episodes and events; a runtime frequently
 * wants to speak in keys and values. {@link EpisodicRuntimeAdapter} bridges
 * the two without forcing either side to change:
 *
 * - It implements the {@link RuntimeMemory} contract (`set`/`get`/`delete`/
 *   `has`/`keys`/`clear`/`stats`), so an agent runtime that already treats
 *   semantic or working memory as a key/value store can hold episodic memory
 *   behind the exact same interface.
 * - It adds episodic-native operations on top: {@link EpisodicRuntimeAdapter.record}
 *   for direct episode ingestion, {@link EpisodicRuntimeAdapter.search} for
 *   facet-driven lookup, and {@link EpisodicRuntimeAdapter.recall} for
 *   context-based recall.
 *
 * {@link createEpisodicAdapter} is the one-line factory that wires a store,
 * an index and a lifecycle into a fully-populated adapter.
 *
 * ## The fluent recorder
 *
 * {@link EpisodeRecorder} makes building an episode ergonomic:
 *
 * ```ts
 * const episode = new EpisodeRecorder('ep-1')
 *   .named('Checkout attempt')
 *   .actor('alice')
 *   .act('search', { query: 'socks' })
 *   .act('add_to_cart')
 *   .finish('success')
 *   .tag('checkout')
 *   .record(adapter);
 * ```
 *
 * @packageDocumentation
 * @module episodic/integration
 */

import type {
  ConsolidationResult,
  Episode,
  EpisodeConfig,
  EpisodeEvent,
  EpisodeHit,
  EpisodeId,
  EpisodeMetadata,
  EpisodeOptions,
  EpisodeOutcome,
  EpisodeStats,
  RuntimeMemory,
  Timestamp,
} from './types.js';
import { EpisodicStore } from './store.js';
import { EpisodicIndex } from './index.js';
import { EpisodicLifecycle, LifecycleEventType, LifecycleListener } from './lifecycle.js';
import { EpisodicRetriever } from './retrieval.js';

/**
 * A single search clause narrowing retrieval by one facet.
 *
 * Multiple clauses are combined with AND semantics across facets and OR
 * semantics within a facet's value list.
 */
export interface SearchClause {
  /** The facet to filter on: actor, action, outcome or tags. */
  readonly facet: 'actor' | 'action' | 'outcome' | 'tags';
  /** Values to match; any single match satisfies the clause. */
  readonly values: readonly string[];
}

/**
 * A search query: an optional text plus optional facet clauses.
 */
export interface EpisodicSearchQuery {
  /** Free-text context scored by {@link EpisodicRetriever.recall} when set. */
  readonly text?: string;
  /** Facet clauses to AND together. */
  readonly clauses?: readonly SearchClause[];
  /** Maximum results. */
  readonly limit?: number;
}

/**
 * One search result: the matched episode plus a relevance score and reason.
 */
export interface EpisodicSearchResult extends EpisodeHit {
  /** The facets that caused this episode to match (empty for text recall). */
  readonly facets: Readonly<Record<string, readonly string[]>>;
}

/**
 * The full episodic surface exposed by an adapter.
 *
 * Union of the {@link RuntimeMemory} contract and the episodic-native methods
 * added by {@link EpisodicRuntimeAdapter}.
 */
export interface EpisodicRuntime extends RuntimeMemory {
  /** Directly record an episode. See {@link EpisodicRuntimeAdapter.record}. */
  record(episode: Episode | Record<string, unknown>): Episode;
  /** Facet/recall search. See {@link EpisodicRuntimeAdapter.search}. */
  search(query: EpisodicSearchQuery | string): EpisodicSearchResult[];
  /** Context recall. See {@link EpisodicRuntimeAdapter.recall}. */
  recall(context: string, opts?: EpisodeOptions): EpisodeHit[];
}

/**
 * Adapter presenting episodic memory behind the uniform {@link RuntimeMemory}
 * surface while exposing episodic-native operations.
 *
 * Values stored through {@link EpisodicRuntimeAdapter.set} are coerced to
 * episodes: plain objects are treated as episode-shaped records, strings are
 * wrapped into a single-event episode. The adapter keeps an
 * {@link EpisodicIndex} in lock-step with the store and exposes a
 * {@link EpisodicLifecycle} for maintenance.
 */
export class EpisodicRuntimeAdapter implements EpisodicRuntime {
  /** The underlying store. */
  readonly store: EpisodicStore;
  /** The index kept in lock-step with the store. */
  readonly index: EpisodicIndex;
  /** The retriever used by search and recall. */
  readonly retriever: EpisodicRetriever;
  /** The lifecycle manager for pruning/consolidation. */
  readonly lifecycle: EpisodicLifecycle;

  /** Clock used for derived timestamps. */
  private readonly now: () => Timestamp;

  /**
   * Construct an adapter.
   *
   * @param config - optional tuning configuration
   * @param store - optional pre-built store (defaults to a fresh one)
   */
  constructor(config?: EpisodeConfig, store?: EpisodicStore) {
    this.store = store ?? new EpisodicStore(config);
    this.now = config?.now ?? (() => Date.now());
    this.index = new EpisodicIndex(this.store);
    this.retriever = new EpisodicRetriever(this.store, this.index, config?.defaultLimit);
    this.lifecycle = new EpisodicLifecycle(this.store, config?.now);
  }

  /**
   * Store a value under a key, coercing it into an episode.
   *
   * Key semantics: the key becomes the episode id. Value semantics:
   *
   * - an {@link Episode} (or object with `id`, `startedAt` and `events`) is
   *   recorded directly (its `id` is overridden by `key` when key is given);
   * - a string is wrapped into a single-event episode with action `'set'`;
   * - any other object is treated as an episode-shaped record or, when it has
   *   no episode shape, as the payload of a single `'set'` event.
   *
   * The index is updated immediately.
   *
   * @param key - the episode id
   * @param value - the value to coerce into an episode
   * @param metadata - metadata attached to the episode when created here
   * @returns resolves once the episode is recorded
   */
  async set(key: string, value: unknown, metadata?: EpisodeMetadata): Promise<void> {
    this.record(coerceToEpisode(key, value, this.now(), metadata));
  }

  /**
   * Retrieve an episode stored under a key.
   *
   * @param key - the episode id
   * @returns the stored episode, or `undefined`
   */
  async get(key: string): Promise<unknown> {
    return this.store.getEpisode(key);
  }

  /**
   * Remove an episode and de-index it.
   *
   * @param key - the episode id
   * @returns `true` when an episode was removed
   */
  async delete(key: string): Promise<boolean> {
    const existed = this.store.deleteEpisode(key);
    if (existed) {
      this.index.removeEpisode(key);
    }
    return existed;
  }

  /**
   * Whether an episode is stored under a key.
   *
   * @param key - the episode id
   * @returns `true` when present
   */
  async has(key: string): Promise<boolean> {
    return this.store.hasEpisode(key);
  }

  /**
   * All stored episode ids.
   *
   * @returns the list of episode ids
   */
  async keys(): Promise<string[]> {
    return this.store.listEpisodes().map((episode) => episode.id);
  }

  /**
   * Remove every episode and clear the index.
   */
  async clear(): Promise<void> {
    this.store.clear();
    this.index.clear();
  }

  /**
   * Aggregate statistics over the stored episodes.
   *
   * @returns an {@link EpisodeStats} snapshot
   */
  async stats(): Promise<EpisodeStats> {
    return this.store.stats();
  }

  /**
   * Directly record an episode, keeping the index in lock-step.
   *
   * @param episode - the episode (or episode-shaped record) to record
   * @returns the canonical stored episode
   */
  record(episode: Episode | Record<string, unknown>): Episode {
    const coerced =
      episode && typeof episode === 'object' && 'events' in episode && 'id' in episode
        ? (episode as Episode)
        : coerceToEpisode(String((episode as Record<string, unknown>)?.id ?? this.nextId()), episode, this.now());
    const stored = this.store.recordEpisode(coerced);
    this.index.indexEpisode(stored);
    return stored;
  }

  /**
   * Run a search over the episodic corpus.
   *
   * When {@link EpisodicSearchQuery.text} is set, the free text drives recall
   * scoring. Facet clauses are applied as AND constraints on top; episodes
   * that pass the facets are re-scored with the text when both are given.
   *
   * @param query - a {@link EpisodicSearchQuery}, or a bare string treated as text
   * @returns ranked results with facet attribution
   */
  search(query: EpisodicSearchQuery | string): EpisodicSearchResult[] {
    const q: EpisodicSearchQuery = typeof query === 'string' ? { text: query } : query;
    const limit = q.limit ?? this.retriever.defaultLimit;
    const clauses = q.clauses ?? [];
    const facetFilter = buildFacetFilter(this.index, clauses);
    const candidates = facetFilter ?? this.index.findByDateRange(null, null);
    const episodes = candidates
      .map((id) => this.store.getEpisode(id))
      .filter((episode): episode is Episode => Boolean(episode));

    const results: EpisodicSearchResult[] = [];
    for (const episode of episodes) {
      const facets = facetMatches(episode, clauses);
      let score = 1;
      let reason = 'facet match';
      if (q.text && q.text.trim().length > 0) {
        const recalled = this.recall(q.text, { limit, fullText: true });
        const hit = recalled.find((candidate) => candidate.episode.id === episode.id);
        if (hit) {
          score = hit.score;
          reason = hit.reason;
        } else {
          continue;
        }
      }
      results.push({ episode, score, reason, facets });
    }

    results.sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.episode.startedAt - a.episode.startedAt;
    });
    return results.slice(0, limit);
  }

  /**
   * Context-based recall of the most relevant episodes.
   *
   * Delegates to {@link EpisodicRetriever.recall}.
   *
   * @param context - the recall context text
   * @param opts - retrieval options
   * @returns ranked episode hits
   */
  recall(context: string, opts?: EpisodeOptions): EpisodeHit[] {
    return this.retriever.recall(context, opts);
  }

  /**
   * Convenience: prune episodes older than a window.
   *
   * Delegates to {@link EpisodicLifecycle.prune} and keeps the index in sync
   * by removing pruned ids from it.
   *
   * @param olderThanMs - the retention window in milliseconds
   * @returns the number of episodes removed
   */
  prune(olderThanMs: number): number {
    const removed = this.lifecycle.prune(olderThanMs);
    if (removed > 0) {
      this.index.rebuild(this.store);
    }
    return removed;
  }

  /**
   * Convenience: consolidate episodes, keeping the index in sync.
   *
   * @param episodeIds - source episode ids
   * @param targetId - optional merged-episode id
   * @returns the {@link ConsolidationResult}
   */
  consolidate(episodeIds: readonly EpisodeId[], targetId?: EpisodeId): ConsolidationResult {
    const result = this.lifecycle.consolidate(episodeIds, targetId);
    this.index.rebuild(this.store);
    return result;
  }

  /**
   * Register a listener on the lifecycle emitter.
   *
   * @param type - the lifecycle event type
   * @param listener - the handler
   * @returns an unsubscribe function
   */
  on(type: LifecycleEventType, listener: LifecycleListener): () => void {
    return this.lifecycle.events.on(type, listener);
  }

  /**
   * Serialise the adapter's store.
   *
   * @returns a JSON-safe snapshot
   */
  toJSON() {
    return this.store.toJSON();
  }

  /**
   * Generate a fresh episode id for values that do not carry one.
   *
   * @returns an id like `ep-<epoch>-<counter>`
   */
  private nextId(): EpisodeId {
    return `ep-${this.now()}-${Math.floor(Math.random() * 0xffff)}`;
  }
}

/**
 * Factory for a fully-wired episodic adapter.
 *
 * Builds a store, index, retriever and lifecycle with a single configuration
 * object and returns the assembled adapter.
 *
 * @param config - optional {@link EpisodeConfig}
 * @returns a ready-to-use {@link EpisodicRuntimeAdapter}
 */
export function createEpisodicAdapter(config?: EpisodeConfig): EpisodicRuntimeAdapter {
  return new EpisodicRuntimeAdapter(config);
}

/**
 * Fluent builder for recording an episode together with its events.
 *
 * The recorder accumulates a *named actor*, a stream of *actions*, an
 * *outcome*, *tags* and *metadata*, then materialises them into an
 * {@link Episode} via {@link EpisodeRecorder.build} or records them directly
 * via {@link EpisodeRecorder.record}. Actions may carry payloads and per-event
 * outcomes. The recorder is single-shot: calling `build`/`record` consumes it.
 */
export class EpisodeRecorder {
  /** The episode id this recorder produces. */
  readonly id: EpisodeId;
  /** Optional human-readable episode name. */
  name?: string;
  /** Optional aggregate episode outcome. */
  outcome?: EpisodeOutcome;
  /** Collected tags. */
  readonly tags = new Set<string>();
  /** Collected metadata. */
  readonly metadata: EpisodeMetadata = {};
  /** Events accumulated so far. */
  readonly events: EpisodeEvent[] = [];
  /** The currently-active default actor (null until set). */
  private defaultActor: string | null = null;
  /** The episode start timestamp. */
  readonly startedAt: Timestamp;

  /** Monotonic counter used for auto-generated event ids. */
  private eventCounter = 0;

  /**
   * Construct a recorder for an episode.
   *
   * @param id - the episode id
   * @param startedAt - optional start time (defaults to now)
   */
  constructor(id: EpisodeId, startedAt?: Timestamp) {
    this.id = id;
    this.startedAt = startedAt ?? Date.now();
  }

  /**
   * Set the episode's human-readable name.
   *
   * @param name - the display name
   * @returns `this` for chaining
   */
  named(name: string): this {
    this.name = name;
    return this;
  }

  /**
   * Set the default actor used by subsequent {@link EpisodeRecorder.act}
   * calls that do not specify their own actor.
   *
   * @param actor - the actor id
   * @returns `this` for chaining
   */
  actor(actor: string): this {
    this.defaultActor = actor;
    return this;
  }

  /**
   * Append an action to the episode timeline.
   *
   * @param action - the action name
   * @param payload - optional structured payload
   * @param opts - optional per-event outcome, actor override and timestamp
   * @returns `this` for chaining
   */
  act(
    action: string,
    payload?: EpisodeMetadata,
    opts?: { outcome?: string | { status: string; detail?: string }; actor?: string; timestamp?: Timestamp },
  ): this {
    const timestamp = opts?.timestamp ?? Date.now();
    this.eventCounter += 1;
    this.events.push({
      id: `evt-${this.id}-${this.eventCounter}`,
      actor: opts?.actor ?? this.defaultActor ?? undefined,
      action,
      payload,
      timestamp,
      outcome: opts?.outcome,
    });
    return this;
  }

  /**
   * Set the episode's aggregate outcome.
   *
   * @param outcome - the outcome value
   * @returns `this` for chaining
   */
  finish(outcome: EpisodeOutcome): this {
    this.outcome = outcome;
    return this;
  }

  /**
   * Add tags to the episode.
   *
   * @param tags - tags to add (any number)
   * @returns `this` for chaining
   */
  tag(...tags: string[]): this {
    for (const tag of tags) {
      this.tags.add(tag);
    }
    return this;
  }

  /**
   * Attach metadata to the episode.
   *
   * @param metadata - metadata entries to merge in
   * @returns `this` for chaining
   */
  meta(metadata: EpisodeMetadata): this {
    Object.assign(this.metadata, metadata);
    return this;
  }

  /**
   * Add a raw event directly to the timeline (bypassing the default actor).
   *
   * @param event - the event to append; its id and timestamp default if absent
   * @returns `this` for chaining
   */
  event(event: Partial<EpisodeEvent> & { action: string }): this {
    this.eventCounter += 1;
    this.events.push({
      id: event.id ?? `evt-${this.id}-${this.eventCounter}`,
      actor: event.actor ?? this.defaultActor ?? undefined,
      action: event.action,
      payload: event.payload,
      timestamp: event.timestamp ?? Date.now(),
      outcome: event.outcome,
    });
    return this;
  }

  /**
   * Materialise the accumulated state into an {@link Episode}.
   *
   * @returns the built episode (with tags/events copied from the recorder)
   */
  build(): Episode {
    return {
      id: this.id,
      name: this.name,
      startedAt: this.startedAt,
      events: [...this.events],
      outcome: this.outcome,
      tags: [...this.tags],
      metadata: { ...this.metadata },
    };
  }

  /**
   * Record the built episode into a store or adapter.
   *
   * @param target - the store (or adapter) to record into
   * @returns the canonical stored episode
   */
  record(target: EpisodicStore | EpisodicRuntimeAdapter): Episode {
    if (target instanceof EpisodicRuntimeAdapter) {
      return target.record(this.build());
    }
    return target.recordEpisode(this.build());
  }

  /**
   * The number of events accumulated so far.
   *
   * @returns the event count
   */
  eventCount(): number {
    return this.events.length;
  }
}

/**
 * Coerce an arbitrary runtime value into an {@link Episode}.
 *
 * @param key - the episode id (or a value used as the id when the value is not
 *   an episode-shaped object)
 * @param value - the runtime value
 * @param now - the current time
 * @param metadata - optional metadata to attach when constructing the episode
 * @returns an episode representing the value
 */
export function coerceToEpisode(
  key: string,
  value: unknown,
  now: Timestamp,
  metadata?: EpisodeMetadata,
): Episode {
  const base = { id: key, startedAt: now, events: [] as EpisodeEvent[] };

  if (typeof value === 'string') {
    return {
      ...base,
      events: [{ id: `${key}:set`, action: 'set', payload: { value }, timestamp: now }],
      metadata,
    };
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.id === 'string' && Array.isArray(record.events)) {
      return {
        id: record.id,
        name: typeof record.name === 'string' ? record.name : undefined,
        startedAt:
          typeof record.startedAt === 'number' ? record.startedAt : now,
        endedAt: typeof record.endedAt === 'number' ? record.endedAt : null,
        events: record.events as unknown as EpisodeEvent[],
        outcome: record.outcome as EpisodeOutcome | undefined,
        tags: Array.isArray(record.tags) ? (record.tags as string[]) : undefined,
        metadata: (record.metadata as EpisodeMetadata) ?? metadata,
      };
    }
    return {
      ...base,
      events: [{ id: `${key}:set`, action: 'set', payload: record, timestamp: now }],
      metadata,
    };
  }

  return {
    ...base,
    events: [{ id: `${key}:set`, action: 'set', payload: { value }, timestamp: now }],
    metadata,
  };
}

/**
 * Resolve the candidate episode ids satisfying all search clauses.
 *
 * Returns `null` when no clauses were supplied (meaning "no facet filter").
 *
 * @param index - the index to query
 * @param clauses - the clauses to AND together
 * @returns candidate ids, or `null`
 */
export function buildFacetFilter(
  index: EpisodicIndex,
  clauses: readonly SearchClause[],
): EpisodeId[] | null {
  if (clauses.length === 0) {
    return null;
  }
  let acc: Set<EpisodeId> | null = null;
  for (const clause of clauses) {
    let ids: EpisodeId[];
    switch (clause.facet) {
      case 'actor':
        ids = clause.values.flatMap((v) => index.findByActor(v));
        break;
      case 'action':
        ids = clause.values.flatMap((v) => index.findByAction(v));
        break;
      case 'outcome':
        ids = clause.values.flatMap((v) => index.findByOutcome(v));
        break;
      case 'tags':
        ids = index.findByTags(clause.values, 'any');
        break;
    }
    const union = new Set(ids);
    if (acc === null) {
      acc = union;
    } else {
      acc = new Set([...acc].filter((id) => union.has(id)));
    }
  }
  return acc ? [...acc] : [];
}

/**
 * Compute the facet attribution for an episode against the given clauses.
 *
 * @param episode - the episode to attribute
 * @param clauses - the clauses to evaluate
 * @returns a facet -> matched values map
 */
export function facetMatches(
  episode: Episode,
  clauses: readonly SearchClause[],
): Record<string, readonly string[]> {
  const result: Record<string, readonly string[]> = {};
  const eventActors = new Set(episode.events.map((e) => e.actor).filter(Boolean));
  const eventActions = new Set(episode.events.map((e) => e.action));
  const outcomes = new Set<string>();
  if (episode.outcome) {
    outcomes.add(episode.outcome);
  }
  for (const event of episode.events) {
    if (typeof event.outcome === 'string') {
      outcomes.add(event.outcome);
    }
  }
  const tags = new Set(episode.tags ?? []);

  for (const clause of clauses) {
    const matched = clause.values.filter((value) => {
      switch (clause.facet) {
        case 'actor':
          return eventActors.has(value);
        case 'action':
          return eventActions.has(value);
        case 'outcome':
          return outcomes.has(value);
        case 'tags':
          return tags.has(value.toLowerCase());
      }
    });
    if (matched.length > 0) {
      result[clause.facet] = matched;
    }
  }
  return result;
}
