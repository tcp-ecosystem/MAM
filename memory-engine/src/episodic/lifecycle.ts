/**
 * Lifecycle management for episodic memory: pruning, consolidation, summarisation.
 *
 * Episodic memory grows without bound unless something curates it. That
 * curation is the job of {@link EpisodicLifecycle}, which implements the four
 * canonical memory-maintenance operations:
 *
 * - **Prune** — discard episodes older than a threshold
 *   ({@link EpisodicLifecycle.prune}), the oldest-in-first-out policy that
 *   keeps a bounded horizon of experience.
 * - **Consolidate** — merge several related episodes into one
 *   ({@link EpisodicLifecycle.consolidate}), collapsing repeated experiences
 *   into a single, richer record.
 * - **Summarise** — reduce an episode to a dense textual digest
 *   ({@link EpisodicLifecycle.summarizeEpisode}), keeping the gist while
 *   dropping the volume.
 * - **Trim** — cap an episode's event count, keeping the most significant
 *   events and discarding the rest ({@link EpisodicLifecycle.trim}).
 *
 * Every operation emits a lifecycle event on the shared
 * {@link EpisodicLifecycle.events} emitter so that observers (metrics, logging,
 * downstream semantic indexing) can react without coupling to the internals.
 *
 * ## Event model
 *
 * `events` is a minimal, dependency-free emitter. Listeners are invoked
 * synchronously with an {@link EpisodeLifecycleEvent}; `on(type, handler)`
 * returns an unsubscribe function. See {@link EpisodicLifecycleEvents}.
 *
 * @packageDocumentation
 * @module episodic/lifecycle
 */

import type {
  ConsolidationResult,
  Episode,
  EpisodeEvent,
  EpisodeId,
  EpisodeLifecycleEvent,
  EpisodeMetadata,
  Timestamp,
} from './types.js';
import type { EpisodicStore } from './store.js';

/**
 * The lifecycle event types that can be subscribed to.
 */
export type LifecycleEventType = 'prune' | 'consolidate' | 'summarize' | 'trim';

/**
 * Listener signature for lifecycle events.
 *
 * @param event - the emitted lifecycle event
 */
export type LifecycleListener = (event: EpisodeLifecycleEvent) => void;

/**
 * A minimal synchronous event emitter used by the lifecycle manager.
 *
 * Kept dependency-free and deliberately small: subscribers are invoked in
 * registration order, exceptions thrown by a listener do not prevent other
 * listeners from running, and each `on` call returns an unsubscribe function.
 */
export class LifecycleEmitter {
  /** type -> list of registered listeners. */
  private readonly listeners = new Map<LifecycleEventType, Set<LifecycleListener>>();

  /**
   * Register a listener for a lifecycle event type.
   *
   * @param type - the event type to subscribe to
   * @param listener - the handler to invoke
   * @returns an unsubscribe function that removes the listener
   */
  on(type: LifecycleEventType, listener: LifecycleListener): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set<LifecycleListener>();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  /**
   * Register a listener that runs exactly once for the next event of a type.
   *
   * @param type - the event type to subscribe to
   * @param listener - the one-shot handler
   * @returns an unsubscribe function
   */
  once(type: LifecycleEventType, listener: LifecycleListener): () => void {
    const unsubscribe = this.on(type, (event) => {
      unsubscribe();
      listener(event);
    });
    return unsubscribe;
  }

  /**
   * Emit an event to all listeners of its type.
   *
   * Listener exceptions are caught and swallowed individually so that a faulty
   * observer cannot break lifecycle operations.
   *
   * @param event - the event to dispatch
   */
  emit(event: EpisodeLifecycleEvent): void {
    const set = this.listeners.get(event.type);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      try {
        listener(event);
      } catch {
        // A failing observer must not break the lifecycle operation.
      }
    }
  }

  /**
   * Remove all listeners of every type.
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Number of currently-registered listeners.
   *
   * @returns the total listener count across all types
   */
  size(): number {
    let total = 0;
    for (const set of this.listeners.values()) {
      total += set.size;
    }
    return total;
  }
}

/**
 * Result of a trim operation.
 *
 * Reports how many events were removed and whether the episode still has an
 * intact (non-empty) timeline afterwards.
 */
export interface TrimResult {
  /** Id of the trimmed episode. */
  readonly episodeId: EpisodeId;
  /** Number of events removed. */
  readonly removed: number;
  /** Number of events that remain. */
  readonly remaining: number;
  /** `true` when the episode still has at least one event. */
  readonly intact: boolean;
  /** The trimmed episode as persisted. */
  readonly episode: Episode;
}

/**
 * Options controlling {@link EpisodicLifecycle.trim}.
 */
export interface TrimOptions {
  /**
   * Strategy deciding which events to keep:
   *
   * - `'oldest'` (default) keeps the first `maxEvents` events.
   * - `'newest'` keeps the last `maxEvents` events.
   * - `'mixed'` keeps the first and last halves evenly, preserving both the
   *   beginning and the end of an experience.
   */
  readonly strategy?: 'oldest' | 'newest' | 'mixed';
  /**
   * When `true` (default `true`), the episode is allowed to shrink below
   * `maxEvents` if it already holds fewer events. When `false`, episodes
   * already at or under the cap are left untouched.
   */
  readonly shrinkBelowCap?: boolean;
}

/**
 * Manages the maintenance lifecycle of an episodic store.
 *
 * A lifecycle is bound to exactly one store. All operations are synchronous
 * and delegate storage mutations to the store, then broadcast a matching
 * lifecycle event. The class is safe to share across consumers as long as
 * those consumers coordinate store access externally (the store itself is not
 * internally synchronised).
 */
export class EpisodicLifecycle {
  /** The store this lifecycle manages. */
  readonly store: EpisodicStore;
  /** Event emitter broadcasting lifecycle operations. */
  readonly events = new LifecycleEmitter();
  /** Clock used for "now" in prune decisions. */
  readonly now: () => Timestamp;

  /**
   * Construct a lifecycle over a store.
   *
   * @param store - the store to manage
   * @param now - optional clock injection for deterministic tests
   */
  constructor(store: EpisodicStore, now?: () => Timestamp) {
    this.store = store;
    this.now = now ?? (() => Date.now());
  }

  /**
   * Remove every episode whose `startedAt` is older than `olderThanMs` ms.
   *
   * The retention window is measured from the current time: an episode is
   * pruned when `now - startedAt > olderThanMs`. Episodes with a `startedAt`
   * in the future are never pruned. The operation emits a single `'prune'`
   * event whose `detail` is the number of episodes removed.
   *
   * @param olderThanMs - the retention window in milliseconds
   * @returns the number of episodes removed
   */
  prune(olderThanMs: number): number {
    if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
      throw new Error(
        `EpisodicLifecycle.prune: expected a non-negative retention window, got ${olderThanMs}`,
      );
    }
    const cutoff = this.now() - olderThanMs;
    const removed: EpisodeId[] = [];
    for (const episode of this.store.listEpisodes()) {
      if (episode.startedAt < cutoff) {
        this.store.deleteEpisode(episode.id);
        removed.push(episode.id);
      }
    }
    if (removed.length > 0) {
      this.events.emit({
        type: 'prune',
        ids: removed,
        timestamp: this.now(),
        detail: removed.length,
      });
    }
    return removed.length;
  }

  /**
   * Merge several episodes into a single episode and remove the sources.
   *
   * Delegates to {@link EpisodicStore.consolidate} for the merge semantics
   * (earliest start, latest end, union of tags/metadata, concatenated events)
   * and then emits a `'consolidate'` event carrying the
   * {@link ConsolidationResult}.
   *
   * @param episodeIds - the source episode ids, in merge order
   * @param targetId - optional id for the merged episode
   * @returns the {@link ConsolidationResult}
   * @throws {Error} when fewer than two distinct episodes are supplied
   */
  consolidate(episodeIds: readonly EpisodeId[], targetId?: EpisodeId): ConsolidationResult {
    const result = this.store.consolidate(episodeIds, targetId);
    this.events.emit({
      type: 'consolidate',
      ids: result.mergedIds,
      timestamp: this.now(),
      detail: result,
      episode: result.episode,
    });
    return result;
  }

  /**
   * Produce a dense textual summary of an episode.
   *
   * The summary is generated from the episode's own structure — name, window,
   * outcome, tags, actor/action statistics and a condensed event walk — and is
   * written as plain, human-readable prose suitable for logging, semantic
   * indexing or handoff to another agent. A `'summarize'` event is emitted
   * carrying the summary text as `detail`.
   *
   * @param episodeId - the episode to summarise
   * @param maxEvents - cap on how many individual events are described in the
   *   summary's walk; events beyond the cap are folded into a count line
   * @returns the generated summary text
   * @throws {Error} when the episode does not exist
   */
  summarizeEpisode(episodeId: EpisodeId, maxEvents = 12): string {
    const episode = this.store.requireEpisode(episodeId);
    const summary = buildEpisodeSummary(episode, maxEvents, this.now());
    this.events.emit({
      type: 'summarize',
      ids: [episode.id],
      timestamp: this.now(),
      detail: summary,
      episode,
    });
    return summary;
  }

  /**
   * Reduce an episode's event count to at most `maxEvents`.
   *
   * The retention strategy is chosen with {@link TrimOptions.strategy}.
   * Emits a `'trim'` event whose `detail` is the number of events removed.
   *
   * @param episodeId - the episode to trim
   * @param maxEvents - the maximum number of events to retain
   * @param opts - trimming controls; see {@link TrimOptions}
   * @returns a {@link TrimResult} describing the outcome
   * @throws {Error} when the episode does not exist or `maxEvents` is invalid
   */
  trim(episodeId: EpisodeId, maxEvents: number, opts?: TrimOptions): TrimResult {
    const episode = this.store.requireEpisode(episodeId);
    if (!Number.isInteger(maxEvents) || maxEvents < 0) {
      throw new Error(
        `EpisodicLifecycle.trim: maxEvents must be a non-negative integer, got ${maxEvents}`,
      );
    }
    const strategy = opts?.strategy ?? 'oldest';
    const shrinkBelowCap = opts?.shrinkBelowCap ?? true;
    const current = episode.events.length;

    if (current <= maxEvents && !shrinkBelowCap) {
      return {
        episodeId,
        removed: 0,
        remaining: current,
        intact: current > 0,
        episode,
      };
    }
    if (current <= maxEvents) {
      return {
        episodeId,
        removed: 0,
        remaining: current,
        intact: current > 0,
        episode,
      };
    }

    const kept = selectEvents(episode.events, maxEvents, strategy);
    const updated = this.store.updateEpisode(episodeId, { metadata: episode.metadata });
    const trimmedEpisode: Episode = {
      ...updated,
      events: kept,
    };
    // Persist the trimmed episode via a full re-record (store has no
    // replace-events API by design; re-record is the canonical mutation path).
    this.store.recordEpisode(trimmedEpisode);

    const removed = current - kept.length;
    const result: TrimResult = {
      episodeId,
      removed,
      remaining: kept.length,
      intact: kept.length > 0,
      episode: this.store.requireEpisode(episodeId),
    };
    this.events.emit({
      type: 'trim',
      ids: [episodeId],
      timestamp: this.now(),
      detail: removed,
      episode: result.episode,
    });
    return result;
  }

  /**
   * Remove all episodes from the store and clear every lifecycle listener.
   *
   * A full reset of the episodic subsystem under this lifecycle. No event is
   * emitted (there would be nothing left to observe a 'reset' event with).
   */
  reset(): void {
    this.store.clear();
    this.events.clear();
  }
}

/**
 * Choose which events survive a trim under the given strategy.
 *
 * @param events - the full ordered event list
 * @param maxEvents - how many to keep
 * @param strategy - the retention strategy
 * @returns the kept events, in original order
 */
export function selectEvents(
  events: readonly EpisodeEvent[],
  maxEvents: number,
  strategy: 'oldest' | 'newest' | 'mixed',
): EpisodeEvent[] {
  if (events.length <= maxEvents) {
    return [...events];
  }
  if (maxEvents === 0) {
    return [];
  }
  if (strategy === 'oldest') {
    return events.slice(0, maxEvents);
  }
  if (strategy === 'newest') {
    return events.slice(events.length - maxEvents);
  }
  // 'mixed': keep the oldest half and the newest half, preserving both the
  // opening and the closing of the experience.
  const keepFirst = Math.ceil(maxEvents / 2);
  const keepLast = maxEvents - keepFirst;
  return [...events.slice(0, keepFirst), ...events.slice(events.length - keepLast)];
}

/**
 * Build a human-readable prose summary of an episode.
 *
 * @param episode - the episode to summarise
 * @param maxEvents - maximum number of events to describe individually
 * @param now - the current time (used for age calculations)
 * @returns the generated summary text
 */
export function buildEpisodeSummary(episode: Episode, maxEvents: number, now: Timestamp): string {
  const lines: string[] = [];
  const header = episode.name
    ? `Episode "${episode.name}" (${episode.id})`
    : `Episode ${episode.id}`;
  lines.push(header);

  const duration =
    episode.endedAt && episode.endedAt >= episode.startedAt
      ? formatDuration(episode.endedAt - episode.startedAt)
      : 'in progress';
  lines.push(`  Window: ${new Date(episode.startedAt).toISOString()} → ${
    episode.endedAt ? new Date(episode.endedAt).toISOString() : 'now'
  } (${duration})`);
  lines.push(`  Outcome: ${episode.outcome ?? 'unknown'}`);
  if (episode.tags && episode.tags.length > 0) {
    lines.push(`  Tags: ${episode.tags.join(', ')}`);
  }
  if (episode.metadata && Object.keys(episode.metadata).length > 0) {
    const keys = Object.keys(episode.metadata)
      .slice(0, 6)
      .join(', ');
    lines.push(`  Metadata: ${keys}${Object.keys(episode.metadata).length > 6 ? ', …' : ''}`);
  }

  const actorCounts = new Map<string, number>();
  const actionCounts = new Map<string, number>();
  let failures = 0;
  for (const event of episode.events) {
    if (event.actor) {
      actorCounts.set(event.actor, (actorCounts.get(event.actor) ?? 0) + 1);
    }
    actionCounts.set(event.action, (actionCounts.get(event.action) ?? 0) + 1);
    if (event.outcome === 'error' || event.outcome === 'failure') {
      failures += 1;
    }
  }
  const topActors = [...actorCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([actor, count]) => `${actor} (${count})`)
    .join(', ');
  const topActions = [...actionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([action, count]) => `${action}×${count}`)
    .join(', ');
  if (topActors) {
    lines.push(`  Actors: ${topActors}`);
  }
  if (topActions) {
    lines.push(`  Top actions: ${topActions}`);
  }
  lines.push(`  Events: ${episode.events.length} total (${failures} with error/failure outcome)`);

  const walked = episode.events.slice(0, maxEvents);
  if (walked.length > 0) {
    lines.push('  Timeline:');
    for (const event of walked) {
      const actor = event.actor ? `${event.actor}: ` : '';
      const outcome = event.outcome
        ? typeof event.outcome === 'string'
          ? ` → ${event.outcome}`
          : ` → ${event.outcome.status}`
        : '';
      lines.push(`    [${new Date(event.timestamp).toISOString()}] ${actor}${event.action}${outcome}`);
    }
    if (episode.events.length > walked.length) {
      lines.push(`    … and ${episode.events.length - walked.length} more event(s)`);
    }
  }
  const ageMs = now - episode.startedAt;
  lines.push(`  Age: ${ageMs >= 0 ? formatDuration(ageMs) : 'in the future'} old`);
  return lines.join('\n');
}

/**
 * Format a duration in milliseconds as a compact human string.
 *
 * @param ms - the duration
 * @returns e.g. `"1d 2h 3m 4s"`
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }
  return parts.join(' ');
}