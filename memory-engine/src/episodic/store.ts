/**
 * In-memory implementation of the episodic store for the MAM Memory Engine.
 *
 * {@link EpisodicStore} is the persistence heart of the episodic subsystem. It
 * owns a `Map<EpisodeId, Episode>` and provides the full lifecycle for
 * episodes and the events they contain:
 *
 * - **Record** an episode with {@link EpisodicStore.recordEpisode}.
 * - **Read** episodes and their timelines with {@link EpisodicStore.getEpisode},
 *   {@link EpisodicStore.listEpisodes} and {@link EpisodicStore.getEvents}.
 * - **Mutate** an in-flight experience with {@link EpisodicStore.appendEvent},
 *   {@link EpisodicStore.setOutcome} and {@link EpisodicStore.updateEpisode}.
 * - **Remove** with {@link EpisodicStore.deleteEpisode} and
 *   {@link EpisodicStore.clear}.
 * - **Inspect** the whole collection with {@link EpisodicStore.size} and
 *   {@link EpisodicStore.stats}.
 * - **Persist / restore** the entire collection with
 *   {@link EpisodicStore.toJSON} and {@link EpisodicStore.fromJSON}.
 *
 * The store is a *plain in-memory* implementation: it imposes no filesystem,
 * network or database dependency, which keeps the episodic layer embeddable in
 * any Node process. For durability across restarts, callers periodically
 * serialise with {@link EpisodicStore.toJSON} and restore with
 * {@link EpisodicStore.fromJSON}.
 *
 * ## Threading and ordering guarantees
 *
 * - Events are appended in insertion order and are never re-sorted on read.
 * - Tags are lower-cased and deduplicated at record time when
 *   {@link EpisodeConfig.normalizeTags} is enabled (the default).
 * - Episodes are stored as deep clones when
 *   {@link EpisodeConfig.cloneEpisodes} is enabled (the default), so caller
 *   mutation cannot corrupt persisted state.
 *
 * @packageDocumentation
 * @module episodic/store
 */

import type {
  ConsolidationResult,
  Episode,
  EpisodeConfig,
  EpisodeEvent,
  EpisodeId,
  EpisodeMetadata,
  EpisodeOutcome,
  EpisodeStats,
  MutableEpisode,
  Timestamp,
} from './types.js';

/**
 * Default configuration applied when the caller supplies none.
 *
 * These values are deliberately conservative: tagging is normalised, episodes
 * are cloned to prevent external mutation, no event cap is imposed, and the
 * eager index is disabled so write-heavy workloads are not penalised.
 */
export const DEFAULT_EPISODE_CONFIG: Required<Pick<
  EpisodeConfig,
  'normalizeTags' | 'requireEvents' | 'cloneEpisodes' | 'maxEventsPerEpisode' | 'eagerIndex'
>> = {
  normalizeTags: true,
  requireEvents: false,
  cloneEpisodes: true,
  maxEventsPerEpisode: 0,
  eagerIndex: false,
};

/**
 * Deep-clone a plain JSON-serialisable value.
 *
 * Used internally to enforce the store's copy-on-write guarantee. Values are
 * cloned with `structuredClone` when available and fall back to JSON
 * round-tripping otherwise, so metadata payloads must be JSON-serialisable.
 *
 * @param value - the value to clone
 * @returns a structurally identical, independent copy
 */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value) as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Normalise a list of raw tags.
 *
 * Lower-cases each tag, trims surrounding whitespace, drops empty entries and
 * removes duplicates while preserving first-seen order.
 *
 * @param raw - the raw tags to normalise (may be `undefined`)
 * @param normalize - when `false`, tags are deduplicated but left verbatim
 * @returns a fresh, ordered array of distinct tags
 */
export function normalizeTags(raw: readonly string[] | undefined, normalize: boolean): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const cleaned = String(tag).trim();
    const key = normalize ? cleaned.toLowerCase() : cleaned;
    if (key.length > 0 && !seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/**
 * Compute the set of distinct event ids already present in an episode.
 *
 * @param episode - the episode whose event ids should be collected
 * @returns a set of event ids (empty for a fresh episode)
 */
export function collectEventIds(episode: Episode): Set<string> {
  const ids = new Set<string>();
  for (const event of episode.events) {
    ids.add(event.id);
  }
  return ids;
}

/**
 * Canonical serialisable shape used by {@link EpisodicStore.toJSON}.
 *
 * Persisting the store as a single object — rather than an array of episodes —
 * gives the format room to grow (e.g. versioning and index caches) without
 * breaking existing dumps.
 */
export interface EpisodicStoreSnapshot {
  /**
   * Format version. Bumped whenever the serialised layout changes.
   */
  readonly version: 1;

  /**
   * The episodes held by the store, keyed by episode id.
   */
  readonly episodes: Record<EpisodeId, Episode>;

  /**
   * Wall-clock time at which the snapshot was created.
   */
  readonly savedAt: Timestamp;
}

/**
 * Fully-capable in-memory episodic store.
 *
 * See the module documentation for a high-level overview and the method
 * documentation for exact semantics. All methods are synchronous, so the store
 * is trivially embeddable; asynchronous durability is the caller's concern.
 */
export class EpisodicStore {
  /** Backing map from episode id to the stored (cloned) episode. */
  private readonly episodes = new Map<EpisodeId, Episode>();

  /** Configuration controlling normalisation, validation and cloning. */
  private readonly config: Required<
    Pick<EpisodeConfig, 'normalizeTags' | 'requireEvents' | 'cloneEpisodes' | 'maxEventsPerEpisode'>
  > & Pick<EpisodeConfig, 'defaultLimit' | 'eagerIndex' | 'now'>;

  /**
   * Construct an empty episodic store.
   *
   * @param config - optional tuning knobs; see {@link EpisodeConfig}
   */
  constructor(config?: EpisodeConfig) {
    this.config = {
      normalizeTags:
        config?.normalizeTags ?? DEFAULT_EPISODE_CONFIG.normalizeTags,
      requireEvents: config?.requireEvents ?? DEFAULT_EPISODE_CONFIG.requireEvents,
      cloneEpisodes: config?.cloneEpisodes ?? DEFAULT_EPISODE_CONFIG.cloneEpisodes,
      maxEventsPerEpisode:
        config?.maxEventsPerEpisode ?? DEFAULT_EPISODE_CONFIG.maxEventsPerEpisode,
      defaultLimit: config?.defaultLimit ?? 20,
      eagerIndex: config?.eagerIndex ?? DEFAULT_EPISODE_CONFIG.eagerIndex,
      now: config?.now ?? (() => Date.now()),
    };
  }

  /**
   * Return the configuration in effect for this store.
   *
   * The returned object is a plain, read-only projection of the internal
   * configuration so callers can inspect behaviour (e.g. event caps) without
   * being able to mutate the live store.
   */
  get configSnapshot(): Readonly<EpisodeConfig> {
    return { ...this.config };
  }

  /**
   * Normalise and persist an episode, overwriting any existing episode with
   * the same id.
   *
   * The stored form is produced by {@link EpisodicStore.normalizeEpisode}:
   * tags are normalised (when configured), the event list is copied, event
   * timestamps are defaulted, and a deep clone is taken when
   * `cloneEpisodes` is enabled.
   *
   * @param episode - the episode to record (may be a mutable builder view)
   * @returns the canonical, stored {@link Episode}
   * @throws {Error} if `requireEvents` is enabled and the episode has no events
   * @throws {Error} if the episode's events exceed `maxEventsPerEpisode`
   */
  recordEpisode(episode: MutableEpisode | Episode): Episode {
    if (this.config.requireEvents && episode.events?.length === 0) {
      throw new Error(
        `EpisodicStore.recordEpisode: requireEvents is enabled but episode "${episode.id}" has no events`,
      );
    }
    const stored = this.normalizeEpisode(episode);
    if (
      this.config.maxEventsPerEpisode > 0 &&
      stored.events.length > this.config.maxEventsPerEpisode
    ) {
      throw new Error(
        `EpisodicStore.recordEpisode: episode "${stored.id}" has ${stored.events.length} events exceeding maxEventsPerEpisode=${this.config.maxEventsPerEpisode}`,
      );
    }
    this.episodes.set(stored.id, stored);
    return stored;
  }

  /**
   * Coerce a raw episode (or builder view) into the canonical immutable form.
   *
   * Applies, in order: tag normalisation; event id deduplication guard
   * (duplicate event ids are preserved but flagged via a thrown error);
   * event timestamp defaulting to the store clock; `startedAt` derivation
   * from the earliest event timestamp when the caller did not supply one;
   * and optional deep cloning.
   *
   * @param episode - the raw episode to normalise
   * @returns the canonical episode ready for storage
   */
  normalizeEpisode(episode: MutableEpisode | Episode): Episode {
    const tags = normalizeTags(episode.tags, this.config.normalizeTags);
    const clock = this.config.now();
    const events = (episode.events ?? []).map((raw, idx): EpisodeEvent => {
      const event: EpisodeEvent = {
        id: raw.id,
        actor: raw.actor,
        action: raw.action,
        payload: raw.payload,
        timestamp: raw.timestamp ?? clock,
        outcome: raw.outcome,
      };
      return event;
    });
    const startedAt =
      episode.startedAt ??
      (events.length > 0 ? Math.min(...events.map((e) => e.timestamp)) : clock);
    const canonical: Episode = {
      id: episode.id,
      name: episode.name,
      startedAt,
      endedAt: episode.endedAt ?? null,
      events,
      outcome: episode.outcome,
      tags,
      metadata: episode.metadata,
    };
    return this.config.cloneEpisodes ? deepClone(canonical) : canonical;
  }

  /**
   * Retrieve the stored episode with the given id.
   *
   * @param id - the episode id to look up
   * @returns the stored {@link Episode}, or `undefined` when absent
   */
  getEpisode(id: EpisodeId): Episode | undefined {
    return this.episodes.get(id);
  }

  /**
   * Retrieve the stored episode, throwing when it does not exist.
   *
   * Useful for callers that treat a missing episode as a hard invariant
   * violation rather than a soft `undefined` case.
   *
   * @param id - the episode id to look up
   * @returns the stored {@link Episode}
   * @throws {Error} when no episode with `id` exists
   */
  requireEpisode(id: EpisodeId): Episode {
    const episode = this.episodes.get(id);
    if (!episode) {
      throw new Error(`EpisodicStore: unknown episode id "${id}"`);
    }
    return episode;
  }

  /**
   * Remove an episode and all of its events from the store.
   *
   * @param id - the episode id to delete
   * @returns `true` when an episode was removed, `false` when it did not exist
   */
  deleteEpisode(id: EpisodeId): boolean {
    return this.episodes.delete(id);
  }

  /**
   * Whether an episode with the given id is currently stored.
   *
   * @param id - the episode id to test
   * @returns `true` when present
   */
  hasEpisode(id: EpisodeId): boolean {
    return this.episodes.has(id);
  }

  /**
   * All episodes currently stored, ordered by id insertion.
   *
   * The returned array is a fresh copy; mutating it does not affect the store.
   * Each element is the live stored reference (read-only by convention).
   *
   * @returns an array of stored episodes
   */
  listEpisodes(): Episode[] {
    return Array.from(this.episodes.values());
  }

  /**
   * Number of episodes currently stored.
   *
   * @returns the episode count
   */
  size(): number {
    return this.episodes.size;
  }

  /**
   * Remove every episode from the store.
   */
  clear(): void {
    this.episodes.clear();
  }

  /**
   * The ordered event timeline of an episode.
   *
   * Returns a *copy* of the event array so callers may sort, slice or mutate
   * the result without affecting the store.
   *
   * @param episodeId - the owning episode
   * @returns the episode's events, most-inserted-first order preserved
   * @throws {Error} when the episode does not exist
   */
  getEvents(episodeId: EpisodeId): EpisodeEvent[] {
    const episode = this.requireEpisode(episodeId);
    return [...episode.events];
  }

  /**
   * Append a single event to an episode's timeline.
   *
   * The event's `timestamp` defaults to the store clock when omitted, and a
   * per-event `id` may be auto-derived from the action plus a monotonic
   * counter when the caller left the id empty. Appending to a finalised
   * episode (one with a non-null `endedAt`) is rejected.
   *
   * @param episodeId - the episode to extend
   * @param event - the event to append (id and/or timestamp may be omitted)
   * @returns the appended, fully-resolved {@link EpisodeEvent}
   * @throws {Error} when the episode is unknown or already finalised
   * @throws {Error} when the event exceeds `maxEventsPerEpisode`
   */
  appendEvent(
    episodeId: EpisodeId,
    event: Partial<EpisodeEvent> & { action: string },
  ): EpisodeEvent {
    const episode = this.requireEpisode(episodeId);
    if (episode.endedAt !== null && episode.endedAt !== undefined) {
      throw new Error(
        `EpisodicStore.appendEvent: episode "${episodeId}" already finalised at ${episode.endedAt}`,
      );
    }
    if (
      this.config.maxEventsPerEpisode > 0 &&
      episode.events.length >= this.config.maxEventsPerEpisode
    ) {
      throw new Error(
        `EpisodicStore.appendEvent: episode "${episodeId}" is at maxEventsPerEpisode=${this.config.maxEventsPerEpisode}`,
      );
    }
    const resolved: EpisodeEvent = {
      id: event.id ?? `${event.action}.${episode.events.length + 1}`,
      actor: event.actor,
      action: event.action,
      payload: event.payload,
      timestamp: event.timestamp ?? this.config.now(),
      outcome: event.outcome,
    };
    const next: Episode = {
      ...episode,
      events: [...episode.events, resolved],
    };
    this.episodes.set(episodeId, this.config.cloneEpisodes ? deepClone(next) : next);
    return resolved;
  }

  /**
   * Append several events to an episode's timeline in one call.
   *
   * Behaves as repeated {@link EpisodicStore.appendEvent} but performs the
   * existence and finalisation checks once up front, making it cheaper for
   * bulk captures of a burst of events.
   *
   * @param episodeId - the episode to extend
   * @param events - the events to append, in order
   * @returns the number of events appended
   */
  appendEvents(
    episodeId: EpisodeId,
    events: Array<Partial<EpisodeEvent> & { action: string }>,
  ): number {
    if (events.length === 0) {
      return 0;
    }
    const episode = this.requireEpisode(episodeId);
    if (episode.endedAt !== null && episode.endedAt !== undefined) {
      throw new Error(
        `EpisodicStore.appendEvents: episode "${episodeId}" already finalised at ${episode.endedAt}`,
      );
    }
    const appended: EpisodeEvent[] = events.map((event, idx) => ({
      id: event.id ?? `${event.action}.${episode.events.length + idx + 1}`,
      actor: event.actor,
      action: event.action,
      payload: event.payload,
      timestamp: event.timestamp ?? this.config.now(),
      outcome: event.outcome,
    }));
    this.episodes.set(
      episodeId,
      this.config.cloneEpisodes
        ? deepClone({ ...episode, events: [...episode.events, ...appended] })
        : { ...episode, events: [...episode.events, ...appended] },
    );
    return appended.length;
  }

  /**
   * Set the aggregate outcome of an episode, optionally finalising it.
   *
   * When `endedAt` is supplied (defaults to the store clock), the episode is
   * marked final and can no longer be appended to. Use `endedAt: null` to
   * update the outcome of an episode that should remain open.
   *
   * @param episodeId - the episode to update
   * @param outcome - the new aggregate outcome
   * @param endedAt - optional end timestamp; defaults to now
   * @returns the updated episode
   * @throws {Error} when the episode does not exist
   */
  setOutcome(
    episodeId: EpisodeId,
    outcome: EpisodeOutcome,
    endedAt: Timestamp | null = this.config.now(),
  ): Episode {
    const episode = this.requireEpisode(episodeId);
    const updated: Episode = {
      ...episode,
      outcome,
      endedAt: endedAt ?? null,
    };
    this.episodes.set(episodeId, this.config.cloneEpisodes ? deepClone(updated) : updated);
    return updated;
  }

  /**
   * Apply a partial update to a stored episode and persist the result.
   *
   * Only the fields present in the patch are changed; absent fields keep their
   * stored values. `events`, `tags` and `metadata` patches replace the stored
   * values wholesale — use {@link EpisodicStore.appendEvent} to extend the
   * timeline incrementally. Tags are re-normalised through
   * {@link EpisodicStore.normalizeTags}.
   *
   * @param id - the episode id to update
   * @param patch - partial fields to apply
   * @returns the updated episode
   * @throws {Error} when the episode does not exist
   */
  updateEpisode(
    id: EpisodeId,
    patch: Partial<Pick<MutableEpisode, 'name' | 'endedAt' | 'outcome' | 'tags' | 'metadata'>>,
  ): Episode {
    const episode = this.requireEpisode(id);
    const updated: Episode = {
      ...episode,
      name: patch.name !== undefined ? patch.name : episode.name,
      endedAt: patch.endedAt !== undefined ? patch.endedAt : episode.endedAt,
      outcome: patch.outcome !== undefined ? patch.outcome : episode.outcome,
      tags:
        patch.tags !== undefined
          ? normalizeTags(patch.tags, this.config.normalizeTags)
          : episode.tags,
      metadata: patch.metadata !== undefined ? patch.metadata : episode.metadata,
    };
    this.episodes.set(id, this.config.cloneEpisodes ? deepClone(updated) : updated);
    return updated;
  }

  /**
   * Merge several episodes into a single episode and record the result.
   *
   * The merged episode keeps the earliest `startedAt`, the latest `endedAt`,
   * the union of tags and metadata (later episodes win key conflicts), and the
   * concatenated events in source order. All source ids must exist; the
   * surviving episode may be one of them or a brand new id.
   *
   * @param ids - source episode ids, in the order their events should be merged
   * @param targetId - optional id for the merged episode (defaults to a new id)
   * @returns a {@link ConsolidationResult} describing the merge
   * @throws {Error} when fewer than two distinct episodes are supplied
   */
  consolidate(ids: readonly EpisodeId[], targetId?: EpisodeId): ConsolidationResult {
    const distinct = [...new Set(ids)];
    if (distinct.length < 2) {
      throw new Error(
        `EpisodicStore.consolidate: expected at least 2 distinct episode ids, got ${distinct.length}`,
      );
    }
    const sources = distinct.map((id) => this.requireEpisode(id));
    const events: EpisodeEvent[] = [];
    const tags = new Set<string>();
    const metadata: EpisodeMetadata = {};
    let startedAt = Number.POSITIVE_INFINITY;
    let endedAt: Timestamp | null = null;

    for (const source of sources) {
      events.push(...source.events);
      for (const tag of source.tags ?? []) {
        tags.add(tag);
      }
      Object.assign(metadata, source.metadata ?? {});
      if (source.startedAt < startedAt) {
        startedAt = source.startedAt;
      }
      if (source.endedAt && (endedAt === null || source.endedAt > endedAt)) {
        endedAt = source.endedAt;
      }
    }

    if (!Number.isFinite(startedAt)) {
      startedAt = this.config.now();
    }

    const merged: Episode = {
      id: targetId ?? `merged-${this.config.now()}`,
      startedAt,
      endedAt,
      events,
      tags: [...tags],
      metadata,
      outcome: sources[sources.length - 1].outcome,
    };
    this.episodes.set(merged.id, this.config.cloneEpisodes ? deepClone(merged) : merged);
    for (const id of distinct) {
      this.episodes.delete(id);
    }
    return { targetId: merged.id, mergedIds: distinct, events: merged.events.length, episode: merged };
  }

  /**
   * Compute aggregate statistics over the current store contents.
   *
   * The scan is O(n) over all episodes and events; results are computed on
   * demand rather than cached. See {@link EpisodeStats} for the shape.
   *
   * @returns a fresh {@link EpisodeStats} snapshot
   */
  stats(): EpisodeStats {
    const episodes = Array.from(this.episodes.values());
    let events = 0;
    let taggedEpisodes = 0;
    const distinctTags = new Set<string>();
    const distinctActors = new Set<string>();
    const distinctActions = new Set<string>();
    const outcomes: Record<EpisodeOutcome, number> = {
      success: 0,
      failure: 0,
      partial: 0,
      aborted: 0,
      unknown: 0,
    };
    let oldestAt: number | null = null;
    let newestAt: number | null = null;

    for (const episode of episodes) {
      events += episode.events.length;
      if (episode.tags && episode.tags.length > 0) {
        taggedEpisodes += 1;
        for (const tag of episode.tags) {
          distinctTags.add(tag);
        }
      }
      for (const event of episode.events) {
        if (event.actor !== undefined) {
          distinctActors.add(event.actor);
        }
        distinctActions.add(event.action);
      }
      if (episode.outcome) {
        outcomes[episode.outcome] = (outcomes[episode.outcome] ?? 0) + 1;
      }
      if (oldestAt === null || episode.startedAt < oldestAt) {
        oldestAt = episode.startedAt;
      }
      if (newestAt === null || episode.startedAt > newestAt) {
        newestAt = episode.startedAt;
      }
    }

    return {
      episodes: episodes.length,
      events,
      taggedEpisodes,
      distinctTags: distinctTags.size,
      distinctActors: distinctActors.size,
      distinctActions: distinctActions.size,
      outcomes,
      oldestAt,
      newestAt,
    };
  }

  /**
   * Serialise the entire store to a plain JSON-safe object.
   *
   * The snapshot includes a format version and the episodes keyed by id, so a
   * dumped store can be restored exactly with {@link EpisodicStore.fromJSON}.
   *
   * @returns an {@link EpisodicStoreSnapshot} suitable for `JSON.stringify`
   */
  toJSON(): EpisodicStoreSnapshot {
    return {
      version: 1,
      episodes: Object.fromEntries(this.episodes),
      savedAt: this.config.now(),
    };
  }

  /**
   * Restore the store contents from a previously-produced snapshot.
   *
   * Existing contents are replaced wholesale. The snapshot is validated
   * minimally: it must carry `version: 1` and a non-null episodes record.
   * Episodes are re-normalised through {@link EpisodicStore.normalizeEpisode}
   * so that config changes between save and restore are honoured.
   *
   * @param snapshot - the snapshot to load (as produced by {@link toJSON})
   * @returns the number of episodes restored
   * @throws {Error} when the snapshot is malformed or has an unsupported version
   */
  fromJSON(snapshot: EpisodicStoreSnapshot | string): number {
    const parsed: EpisodicStoreSnapshot =
      typeof snapshot === 'string' ? (JSON.parse(snapshot) as EpisodicStoreSnapshot) : snapshot;
    if (!parsed || parsed.version !== 1 || !parsed.episodes) {
      throw new Error(
        `EpisodicStore.fromJSON: unsupported or malformed snapshot (version=${parsed?.version ?? '<missing>'})`,
      );
    }
    this.episodes.clear();
    for (const [id, raw] of Object.entries(parsed.episodes)) {
      this.episodes.set(id, this.normalizeEpisode({ ...raw, id }));
    }
    return this.episodes.size;
  }

  /**
   * Create a store whose contents are populated from a JSON string.
   *
   * Convenience factory equivalent to constructing an empty store and then
   * calling {@link EpisodicStore.fromJSON}.
   *
   * @param json - a JSON snapshot string as produced by {@link toJSON}
   * @param config - optional store configuration
   * @returns a configured, populated store
   */
  static fromJSON(json: string, config?: EpisodeConfig): EpisodicStore {
    const store = new EpisodicStore(config);
    store.fromJSON(json);
    return store;
  }
}