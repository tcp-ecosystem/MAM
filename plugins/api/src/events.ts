/**
 * MAM Plugin Event Bus
 *
 * Pub/sub event system with wildcard support, event filtering,
 * timed events, middleware, and event replay.
 */

import type { PluginEvent } from './types.js';

export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export interface EventSubscription {
  event: string;
  handler: EventHandler;
  once: boolean;
  id: string;
  plugin?: string;
  priority: number;
  createdAt: Date;
}

export interface EventStats {
  totalEvents: number;
  uniqueEvents: number;
  totalSubscriptions: number;
  eventsByName: Record<string, number>;
  lastEventTime?: Date;
  averageHandlersPerEvent: number;
}

export interface EmittedEvent {
  event: string;
  timestamp: Date;
  data?: unknown;
  handlerCount: number;
  durationMs: number;
}

let subscriptionId = 0;

export class PluginEventBus {
  private handlers: Map<string, EventSubscription[]> = new Map();
  private eventLog: EmittedEvent[] = [];
  private eventCounts: Map<string, number> = new Map();
  private wildcardHandlers: EventSubscription[] = [];
  private middleware: Array<{
    event: string;
    handler: (data: unknown, next: () => Promise<unknown>) => Promise<unknown>;
  }> = [];
  private maxLogSize: number;
  private isPaused = false;
  private pausedEvents: Array<{ event: string; data?: unknown; timestamp: Date }> = [];

  constructor(options?: { maxLogSize?: number }) {
    this.maxLogSize = options?.maxLogSize ?? 1000;
  }

  // ─── Subscription ───────────────────────────────────────────────

  on(event: string, handler: EventHandler, options?: { priority?: number; plugin?: string }): () => void {
    return this.subscribe(event, handler, false, options);
  }

  once(event: string, handler: EventHandler, options?: { priority?: number; plugin?: string }): () => void {
    return this.subscribe(event, handler, true, options);
  }

  onAny(handler: EventHandler): () => void {
    const sub: EventSubscription = {
      event: '*',
      handler,
      once: false,
      id: `wildcard-${++subscriptionId}`,
      priority: 0,
      createdAt: new Date(),
    };
    this.wildcardHandlers.push(sub);
    this.wildcardHandlers.sort((a, b) => a.priority - b.priority);
    return () => {
      const idx = this.wildcardHandlers.indexOf(sub);
      if (idx !== -1) this.wildcardHandlers.splice(idx, 1);
    };
  }

  private subscribe(
    event: string,
    handler: EventHandler,
    once: boolean,
    options?: { priority?: number; plugin?: string },
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    const sub: EventSubscription = {
      event,
      handler,
      once,
      id: `sub-${++subscriptionId}`,
      plugin: options?.plugin,
      priority: options?.priority ?? 100,
      createdAt: new Date(),
    };
    this.handlers.get(event)!.push(sub);
    this.handlers.get(event)!.sort((a, b) => a.priority - b.priority);

    return () => this.unsubscribe(sub.id);
  }

  unsubscribe(id: string): boolean {
    for (const subs of this.handlers.values()) {
      const idx = subs.findIndex((s) => s.id === id);
      if (idx !== -1) {
        subs.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  // ─── Emission ───────────────────────────────────────────────────

  async emit(event: string, data?: unknown): Promise<void> {
    if (this.isPaused) {
      this.pausedEvents.push({ event, data, timestamp: new Date() });
      return;
    }

    const startTime = performance.now();
    const count = (this.eventCounts.get(event) || 0) + 1;
    this.eventCounts.set(event, count);

    // Run middleware
    let processedData = data;
    for (const mw of this.middleware.filter((m) => m.event === event || m.event === '*')) {
      processedData = await new Promise((resolve) => {
        mw.handler(processedData, () => Promise.resolve(processedData)).then(resolve);
      });
    }

    const subs = this.handlers.get(event) || [];
    const allSubs = [...this.wildcardHandlers, ...subs];
    const toRemove: EventSubscription[] = [];

    for (const sub of allSubs) {
      try {
        await sub.handler(processedData);
        if (sub.once) toRemove.push(sub);
      } catch (err) {
        console.error(`Event handler error for "${event}":`, err);
      }
    }

    for (const sub of toRemove) {
      if (sub.event === '*') {
        const idx = this.wildcardHandlers.indexOf(sub);
        if (idx !== -1) this.wildcardHandlers.splice(idx, 1);
      } else {
        const subs = this.handlers.get(sub.event);
        if (subs) {
          const idx = subs.indexOf(sub);
          if (idx !== -1) subs.splice(idx, 1);
        }
      }
    }

    const durationMs = performance.now() - startTime;
    this.eventLog.push({ event, timestamp: new Date(), data: processedData, handlerCount: subs.length, durationMs });

    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog = this.eventLog.slice(-this.maxLogSize);
    }
  }

  // ─── Unsubscription ─────────────────────────────────────────────

  off(event: string, handler?: EventHandler): void {
    if (!handler) {
      this.handlers.delete(event);
      return;
    }
    const subs = this.handlers.get(event);
    if (subs) {
      const idx = subs.findIndex((s) => s.handler === handler);
      if (idx !== -1) subs.splice(idx, 1);
    }
  }

  offPlugin(plugin: string): number {
    let removed = 0;
    for (const subs of this.handlers.values()) {
      const before = subs.length;
      const filtered = subs.filter((s) => s.plugin !== plugin);
      subs.length = 0;
      subs.push(...filtered);
      removed += before - subs.length;
    }
    return removed;
  }

  // ─── Middleware ──────────────────────────────────────────────────

  use(event: string, handler: (data: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void {
    this.middleware.push({ event, handler });
    return () => {
      const idx = this.middleware.findIndex((m) => m.handler === handler);
      if (idx !== -1) this.middleware.splice(idx, 1);
    };
  }

  // ─── Pause / Resume ─────────────────────────────────────────────

  pause(): void { this.isPaused = true; }

  async resume(): Promise<void> {
    this.isPaused = false;
    for (const { event, data } of this.pausedEvents) {
      await this.emit(event, data);
    }
    this.pausedEvents = [];
  }

  getPausedCount(): number { return this.pausedEvents.length; }

  // ─── Query ──────────────────────────────────────────────────────

  listenerCount(event: string): number {
    return (this.handlers.get(event)?.length || 0) + this.wildcardHandlers.length;
  }

  eventNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  getSubscriptions(event: string): EventSubscription[] {
    return [...(this.handlers.get(event) || [])];
  }

  getAllSubscriptions(): EventSubscription[] {
    const all: EventSubscription[] = [];
    for (const subs of this.handlers.values()) all.push(...subs);
    all.push(...this.wildcardHandlers);
    return all;
  }

  getSubscriptionsByPlugin(plugin: string): EventSubscription[] {
    return this.getAllSubscriptions().filter((s) => s.plugin === plugin);
  }

  // ─── Log ────────────────────────────────────────────────────────

  getEventLog(event?: string, count?: number): EmittedEvent[] {
    let log = event ? this.eventLog.filter((e) => e.event === event) : this.eventLog;
    if (count) log = log.slice(-count);
    return log;
  }

  getEventCount(event: string): number {
    return this.eventCounts.get(event) || 0;
  }

  clearEventLog(): void {
    this.eventLog = [];
    this.eventCounts.clear();
  }

  // ─── Stats ──────────────────────────────────────────────────────

  getStats(): EventStats {
    const eventsByName: Record<string, number> = {};
    for (const [event, count] of this.eventCounts) {
      eventsByName[event] = count;
    }
    const totalSubs = this.getAllSubscriptions().length;
    const uniqueEvents = this.handlers.size;

    return {
      totalEvents: this.eventLog.length,
      uniqueEvents,
      totalSubscriptions: totalSubs,
      eventsByName,
      lastEventTime: this.eventLog.length > 0 ? this.eventLog[this.eventLog.length - 1]!.timestamp : undefined,
      averageHandlersPerEvent: uniqueEvents > 0 ? totalSubs / uniqueEvents : 0,
    };
  }

  // ─── Lifecycle ──────────────────────────────────────────────────

  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers = [];
    this.middleware = [];
    this.eventLog = [];
    this.eventCounts.clear();
    this.pausedEvents = [];
    this.isPaused = false;
  }
}
