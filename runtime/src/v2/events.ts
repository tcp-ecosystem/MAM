import { EventEmitter, EventListener, MAMEvent } from './types.js';

interface EventSubscription {
  listener: EventListener;
  once: boolean;
}

interface EventMetrics {
  emitted: number;
  handled: number;
  errors: number;
  totalListeners: number;
  timingMs: number;
}

interface BatchConfig {
  maxSize: number;
  flushIntervalMs: number;
}

export class DefaultEventEmitter implements EventEmitter {
  private listeners = new Map<string, EventSubscription[]>();
  private historyLog: MAMEvent[] = [];
  private maxHistory: number;
  private metrics: Map<string, EventMetrics> = new Map();
  private middleware: Array<(event: string, data: unknown) => unknown> = [];
  private paused = false;
  private bufferedEvents: Array<{ event: string; data: unknown }> = [];
  private filterPatterns: Map<string, Set<string>> = new Map();
  private batchQueue: Array<{ event: string; data: unknown }> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private batchConfig: BatchConfig | null = null;
  private wildcardListeners: EventSubscription[] = [];
  private replayStack: MAMEvent[] = [];
  private replayIndex = 0;
  private emitTimestamps: Map<string, number[]> = new Map();

  constructor(options?: { maxHistory?: number; batch?: BatchConfig }) {
    this.maxHistory = options?.maxHistory ?? 1000;
    if (options?.batch) {
      this.batchConfig = options.batch;
    }
  }

  emit(event: string, data?: unknown): void {
    if (this.paused) {
      this.bufferedEvents.push({ event, data: data ?? null });
      return;
    }

    if (!this.shouldEmit(event)) {
      return;
    }

    const startTime = Date.now();
    let processedData: unknown = data ?? null;
    for (const mw of this.middleware) {
      try {
        processedData = mw(event, processedData);
      } catch {
        // Continue with original data
      }
    }

    const eventRecord: MAMEvent = {
      name: event,
      data: processedData,
      timestamp: Date.now(),
    };
    this.historyLog.push(eventRecord);

    if (this.historyLog.length > this.maxHistory) {
      this.historyLog.shift();
    }

    const metrics = this.getOrCreateMetrics(event);
    metrics.emitted++;
    metrics.timingMs += Date.now() - startTime;

    this.recordTimestamp(event);

    if (this.batchConfig) {
      this.batchQueue.push({ event, data: processedData });
      if (this.batchQueue.length >= this.batchConfig.maxSize) {
        this.flushBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.flushBatch(), this.batchConfig.flushIntervalMs);
      }
      return;
    }

    this.dispatchToListeners(event, processedData, eventRecord, metrics);
    this.dispatchToWildcardListeners(eventRecord);
  }

  on(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push({ listener, once: false });
  }

  off(event: string, listener: EventListener): void {
    const subscriptions = this.listeners.get(event);
    if (subscriptions) {
      const idx = subscriptions.findIndex(s => s.listener === listener);
      if (idx >= 0) {
        subscriptions.splice(idx, 1);
        if (subscriptions.length === 0) {
          this.listeners.delete(event);
        }
      }
    }
  }

  once(event: string, listener: EventListener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push({ listener, once: true });
  }

  history(): MAMEvent[] {
    return [...this.historyLog];
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    const toFlush = [...this.bufferedEvents];
    this.bufferedEvents = [];
    for (const buffered of toFlush) {
      this.emit(buffered.event, buffered.data);
    }
  }

  addMiddleware(middleware: (event: string, data: unknown) => unknown): void {
    this.middleware.push(middleware);
  }

  removeMiddleware(middleware: (event: string, data: unknown) => unknown): void {
    const idx = this.middleware.indexOf(middleware);
    if (idx >= 0) this.middleware.splice(idx, 1);
  }

  clearHistory(): void {
    this.historyLog = [];
  }

  getMetrics(event?: string): EventMetrics | Map<string, EventMetrics> {
    if (event) {
      return this.getOrCreateMetrics(event);
    }
    return new Map(this.metrics);
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.length ?? 0;
  }

  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  addFilter(event: string, pattern: string): void {
    if (!this.filterPatterns.has(event)) {
      this.filterPatterns.set(event, new Set());
    }
    this.filterPatterns.get(event)!.add(pattern);
  }

  removeFilter(event: string, pattern: string): void {
    const patterns = this.filterPatterns.get(event);
    if (patterns) {
      patterns.delete(pattern);
      if (patterns.size === 0) {
        this.filterPatterns.delete(event);
      }
    }
  }

  clearFilters(event?: string): void {
    if (event) {
      this.filterPatterns.delete(event);
    } else {
      this.filterPatterns.clear();
    }
  }

  filterEvents(predicate: (event: MAMEvent) => boolean): MAMEvent[] {
    return this.historyLog.filter(predicate);
  }

  waitForEvent(eventName: string, timeoutMs?: number): Promise<MAMEvent> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      const listener: EventListener = (data: unknown) => {
        if (timer !== null) {
          clearTimeout(timer);
        }
        this.off(eventName, listener);
        resolve({
          name: eventName,
          data,
          timestamp: Date.now(),
        });
      };
      this.on(eventName, listener);
      if (timeoutMs !== undefined && timeoutMs > 0) {
        timer = setTimeout(() => {
          this.off(eventName, listener);
          reject(new Error(`Timeout waiting for event: ${eventName}`));
        }, timeoutMs);
      }
    });
  }

  onAny(listener: (event: MAMEvent) => void | Promise<void>): void {
    this.wildcardListeners.push({ listener: (data: unknown) => listener(data as MAMEvent), once: false });
  }

  offAny(listener: (event: MAMEvent) => void | Promise<void>): void {
    const idx = this.wildcardListeners.findIndex(s => s.listener === listener);
    if (idx >= 0) {
      this.wildcardListeners.splice(idx, 1);
    }
  }

  getEventTypes(): string[] {
    const types = new Set<string>();
    for (const event of this.historyLog) {
      types.add(event.name);
    }
    Array.from(this.listeners.keys()).forEach((key) => {
      if (key !== '*') {
        types.add(key);
      }
    });
    return Array.from(types);
  }

  startBatch(config: BatchConfig): void {
    this.batchConfig = config;
    this.batchQueue = [];
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  flushBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    const events = [...this.batchQueue];
    this.batchQueue = [];
    for (const evt of events) {
      this.dispatchToListenersDirect(evt.event, evt.data);
    }
  }

  stopBatch(): void {
    this.flushBatch();
    this.batchConfig = null;
  }

  replay(fromIndex?: number): void {
    const start = fromIndex ?? 0;
    this.replayStack = this.historyLog.slice(start);
    this.replayIndex = 0;
  }

  replayNext(): MAMEvent | null {
    if (this.replayIndex >= this.replayStack.length) {
      return null;
    }
    const event = this.replayStack[this.replayIndex];
    this.replayIndex++;
    const metrics = this.getOrCreateMetrics(event.name);
    metrics.emitted++;
    this.recordTimestamp(event.name);
    this.dispatchToListeners(event.name, event.data, event, metrics);
    this.dispatchToWildcardListeners(event);
    return event;
  }

  replayAll(): MAMEvent[] {
    this.replay(0);
    const replayed: MAMEvent[] = [];
    while (true) {
      const next = this.replayNext();
      if (next === null) break;
      replayed.push(next);
    }
    return replayed;
  }

  isPaused(): boolean {
    return this.paused;
  }

  getBufferedCount(): number {
    return this.bufferedEvents.length;
  }

  clearBuffered(): void {
    this.bufferedEvents = [];
  }

  getTimingStats(event?: string): { avg: number; min: number; max: number; count: number } | Map<string, { avg: number; min: number; max: number; count: number }> {
    if (event) {
      return this.computeTimingForEvent(event);
    }
    const result = new Map<string, { avg: number; min: number; max: number; count: number }>();
    Array.from(this.metrics.keys()).forEach((key) => {
      result.set(key, this.computeTimingForEvent(key));
    });
    return result;
  }

  getFilterPatterns(): Map<string, Set<string>> {
    return new Map(this.filterPatterns);
  }

  private shouldEmit(event: string): boolean {
    const patterns = this.filterPatterns.get(event);
    if (!patterns || patterns.size === 0) {
      return true;
    }
    const arr = Array.from(patterns);
    for (let i = 0; i < arr.length; i++) {
      if (event.includes(arr[i]) || this.matchGlob(arr[i], event)) {
        return true;
      }
    }
    return false;
  }

  private matchGlob(pattern: string, value: string): boolean {
    const regexStr = '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
    try {
      return new RegExp(regexStr).test(value);
    } catch {
      return false;
    }
  }

  private dispatchToListeners(event: string, data: unknown, eventRecord: MAMEvent, metrics: EventMetrics): void {
    const subscriptions = this.listeners.get(event) ?? [];
    const toRemove: EventSubscription[] = [];
    for (const sub of subscriptions) {
      try {
        const result = sub.listener(data);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(() => {});
        }
        metrics.handled++;
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch {
        metrics.errors++;
      }
    }
    for (const sub of toRemove) {
      this.off(event, sub.listener);
    }
  }

  private dispatchToWildcardListeners(eventRecord: MAMEvent): void {
    const wildcardSubscriptions = [...this.wildcardListeners];
    const toRemove: EventSubscription[] = [];
    for (const sub of wildcardSubscriptions) {
      try {
        const result = sub.listener(eventRecord);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(() => {});
        }
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch {
        // Swallow listener errors
      }
    }
    for (const sub of toRemove) {
      const idx = this.wildcardListeners.indexOf(sub);
      if (idx >= 0) {
        this.wildcardListeners.splice(idx, 1);
      }
    }
    const starSubscriptions = this.listeners.get('*') ?? [];
    const toRemoveStar: EventSubscription[] = [];
    for (const sub of starSubscriptions) {
      try {
        const result = sub.listener(eventRecord);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(() => {});
        }
        if (sub.once) {
          toRemoveStar.push(sub);
        }
      } catch {
        // Swallow listener errors
      }
    }
    for (const sub of toRemoveStar) {
      this.off('*', sub.listener);
    }
  }

  private dispatchToListenersDirect(event: string, data: unknown): void {
    const subscriptions = this.listeners.get(event) ?? [];
    const toRemove: EventSubscription[] = [];
    for (const sub of subscriptions) {
      try {
        const result = sub.listener(data);
        if (result && typeof (result as Promise<void>).then === 'function') {
          (result as Promise<void>).catch(() => {});
        }
        if (sub.once) {
          toRemove.push(sub);
        }
      } catch {
        // Swallow
      }
    }
    for (const sub of toRemove) {
      this.off(event, sub.listener);
    }
  }

  private getOrCreateMetrics(event: string): EventMetrics {
    if (!this.metrics.has(event)) {
      this.metrics.set(event, { emitted: 0, handled: 0, errors: 0, totalListeners: 0, timingMs: 0 });
    }
    return this.metrics.get(event)!;
  }

  private recordTimestamp(event: string): void {
    if (!this.emitTimestamps.has(event)) {
      this.emitTimestamps.set(event, []);
    }
    const timestamps = this.emitTimestamps.get(event)!;
    timestamps.push(Date.now());
    if (timestamps.length > 100) {
      timestamps.shift();
    }
  }

  private computeTimingForEvent(event: string): { avg: number; min: number; max: number; count: number } {
    const timestamps = this.emitTimestamps.get(event) ?? [];
    if (timestamps.length < 2) {
      return { avg: 0, min: 0, max: 0, count: timestamps.length };
    }
    const intervals: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }
    const sum = intervals.reduce((a, b) => a + b, 0);
    return {
      avg: sum / intervals.length,
      min: Math.min(...intervals),
      max: Math.max(...intervals),
      count: timestamps.length,
    };
  }
}
