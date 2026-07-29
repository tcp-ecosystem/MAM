/**
 * MAM Plugin Event Bus
 *
 * Pub/sub event system for inter-plugin communication.
 */

import type { PluginEvent } from './types.js';

export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

export interface EventSubscription {
  event: string;
  handler: EventHandler;
  once: boolean;
}

export class PluginEventBus {
  private handlers: Map<string, EventSubscription[]> = new Map();
  private eventLog: Array<{ event: string; timestamp: Date; data?: unknown }> = [];

  on(event: string, handler: EventHandler): () => void {
    return this.subscribe(event, handler, false);
  }

  once(event: string, handler: EventHandler): () => void {
    return this.subscribe(event, handler, true);
  }

  private subscribe(event: string, handler: EventHandler, once: boolean): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    const subscription: EventSubscription = { event, handler, once };
    this.handlers.get(event)!.push(subscription);

    return () => {
      const subs = this.handlers.get(event);
      if (subs) {
        const idx = subs.indexOf(subscription);
        if (idx !== -1) subs.splice(idx, 1);
      }
    };
  }

  async emit(event: string, data?: unknown): Promise<void> {
    this.eventLog.push({ event, timestamp: new Date(), data });
    const subs = this.handlers.get(event) || [];
    const toRemove: EventSubscription[] = [];

    for (const sub of subs) {
      try {
        await sub.handler(data);
        if (sub.once) toRemove.push(sub);
      } catch (err) {
        console.error(`Event handler error for "${event}":`, err);
      }
    }

    for (const sub of toRemove) {
      const idx = subs.indexOf(sub);
      if (idx !== -1) subs.splice(idx, 1);
    }
  }

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

  listenerCount(event: string): number {
    return this.handlers.get(event)?.length || 0;
  }

  eventNames(): string[] {
    return Array.from(this.handlers.keys());
  }

  getEventLog(event?: string): typeof this.eventLog {
    if (event) return this.eventLog.filter((e) => e.event === event);
    return [...this.eventLog];
  }

  clearEventLog(): void {
    this.eventLog = [];
  }

  clear(): void {
    this.handlers.clear();
    this.eventLog = [];
  }
}
