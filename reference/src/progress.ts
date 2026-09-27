export const PROGRESS_BAR_WIDTH = 30;

interface ProgressSnapshot {
  done: number;
  total: number;
  startedAt: number;
  updatedAt: number;
  label?: string;
}

export class ProgressTracker {
  private done = 0;
  private total: number;
  private startedAt: number;
  private updatedAt: number;
  private label?: string;
  private listeners: Array<(snapshot: ProgressSnapshot) => void> = [];
  private pausedAt?: number;
  private samples: Array<{ done: number; at: number }> = [];

  constructor(total: number, label?: string) {
    this.total = Math.max(0, total);
    this.startedAt = Date.now();
    this.updatedAt = this.startedAt;
    if (label !== undefined) {
      this.label = label;
    }
  }

  advance(by = 1): number {
    return this.set(this.done + by);
  }

  set(done: number): number {
    this.done = Math.min(Math.max(0, done), this.total);
    this.updatedAt = Date.now();
    this.emit();
    return this.done;
  }

  complete(): number {
    return this.set(this.total);
  }

  reset(total?: number): void {
    if (total !== undefined) {
      this.total = Math.max(0, total);
    }
    this.done = 0;
    this.startedAt = Date.now();
    this.updatedAt = this.startedAt;
    this.emit();
  }

  setLabel(label: string): void {
    this.label = label;
    this.emit();
  }

  getDone(): number {
    return this.done;
  }

  getTotal(): number {
    return this.total;
  }

  getRemaining(): number {
    return this.total - this.done;
  }

  isComplete(): boolean {
    return this.done >= this.total;
  }

  getRatio(): number {
    if (this.total === 0) return 1;
    return this.done / this.total;
  }

  getPercentage(): number {
    return this.getRatio() * 100;
  }

  getElapsedMs(now: number = Date.now()): number {
    return Math.max(0, now - this.startedAt);
  }

  getEstimatedRemainingMs(now: number = Date.now()): number | undefined {
    return estimateTimeRemaining(this.done, this.total, this.getElapsedMs(now));
  }

  getRatePerSecond(now: number = Date.now()): number {
    const elapsed = this.getElapsedMs(now);
    if (elapsed === 0) return 0;
    return (this.done / elapsed) * 1000;
  }

  snapshot(): ProgressSnapshot {
    const snapshot: ProgressSnapshot = {
      done: this.done,
      total: this.total,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
    };
    if (this.label !== undefined) {
      snapshot.label = this.label;
    }
    return snapshot;
  }

  onUpdate(listener: (snapshot: ProgressSnapshot) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  render(width: number = PROGRESS_BAR_WIDTH): string {
    const bar = formatProgressBar(this.done, this.total, width);
    const pct = formatPercentage(this.done, this.total);
    if (this.label) {
      return `${this.label} ${bar} ${pct}`;
    }
    return `${bar} ${pct}`;
  }

  renderWithEta(now: number = Date.now(), width: number = PROGRESS_BAR_WIDTH): string {
    const base = this.render(width);
    const remaining = this.getEstimatedRemainingMs(now);
    if (remaining === undefined) {
      return base;
    }
    return `${base} (ETA ${formatTimeRemaining(remaining)})`;
  }

  renderCompact(): string {
    return `${this.done}/${this.total} ${formatPercentage(this.done, this.total)}`;
  }

  renderRate(now: number = Date.now()): string {
    return `${this.renderCompact()} @ ${formatItemsPerSecond(this.done, this.getElapsedMs(now))}`;
  }

  pause(): void {
    this.pausedAt = Date.now();
  }

  resume(now: number = Date.now()): void {
    if (this.pausedAt !== undefined) {
      const pausedFor = Math.max(0, now - this.pausedAt);
      this.startedAt += pausedFor;
      this.pausedAt = undefined;
      this.updatedAt = now;
    }
  }

  isPaused(): boolean {
    return this.pausedAt !== undefined;
  }

  recordSample(now: number = Date.now()): void {
    this.samples.push({ done: this.done, at: now });
    if (this.samples.length > 12) {
      this.samples.splice(0, this.samples.length - 12);
    }
  }

  getSmoothedRatePerSecond(now: number = Date.now()): number {
    if (this.samples.length < 2) {
      return this.getRatePerSecond(now);
    }
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const elapsed = last.at - first.at;
    if (elapsed <= 0) return 0;
    return ((last.done - first.done) / elapsed) * 1000;
  }

  getSmoothedRemainingMs(now: number = Date.now()): number | undefined {
    const rate = this.getSmoothedRatePerSecond(now);
    if (rate <= 0) return undefined;
    if (this.done >= this.total) return 0;
    return Math.round(((this.total - this.done) / rate) * 1000);
  }

  toJSON(): { done: number; total: number; label?: string } {
    const result: { done: number; total: number; label?: string } = {
      done: this.done,
      total: this.total,
    };
    if (this.label !== undefined) {
      result.label = this.label;
    }
    return result;
  }

  restore(state: { done: number; total: number; label?: string }): void {
    this.total = Math.max(0, state.total);
    this.done = Math.min(Math.max(0, state.done), this.total);
    this.startedAt = Date.now();
    this.updatedAt = this.startedAt;
    this.pausedAt = undefined;
    this.samples = [];
    if (state.label !== undefined) {
      this.label = state.label;
    }
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export function createProgressTracker(total: number, label?: string): ProgressTracker {
  return new ProgressTracker(total, label);
}

export function formatProgressBar(done: number, total: number, width: number = PROGRESS_BAR_WIDTH): string {
  const safeWidth = Math.max(1, Math.floor(width));
  if (total <= 0) {
    return `[${'='.repeat(safeWidth)}]`;
  }
  const ratio = Math.min(Math.max(done / total, 0), 1);
  const filled = Math.round(ratio * safeWidth);
  const empty = safeWidth - filled;
  if (filled >= safeWidth) {
    return `[${'='.repeat(safeWidth)}]`;
  }
  return `[${'='.repeat(filled)}>${' '.repeat(Math.max(0, empty - 1))}]`;
}

export function formatPercentage(done: number, total: number): string {
  if (total <= 0) return '100.0%';
  const pct = (Math.min(Math.max(done / total, 0), 1) * 100).toFixed(1);
  return `${pct}%`;
}

export function estimateTimeRemaining(done: number, total: number, elapsedMs: number): number | undefined {
  if (done <= 0 || elapsedMs <= 0) return undefined;
  if (done >= total) return 0;
  const rate = done / elapsedMs;
  return Math.round((total - done) / rate);
}

export function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h ${restMinutes}m`;
}

function clampProgress(done: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(Math.max(done / total, 0), 1);
}

function formatItemsPerSecond(done: number, elapsedMs: number): string {
  if (elapsedMs <= 0) return 'n/a';
  const rate = (done / elapsedMs) * 1000;
  if (rate >= 100) return `${Math.round(rate)}/s`;
  return `${rate.toFixed(1)}/s`;
}

function buildProgressLine(label: string | undefined, bar: string, pct: string, extra?: string): string {
  const parts: string[] = [];
  if (label) parts.push(label);
  parts.push(bar, pct);
  if (extra) parts.push(extra);
  return parts.join(' ');
}

function renderLabeledBar(label: string, done: number, total: number, width: number): string {
  return buildProgressLine(label, formatProgressBar(done, total, width), formatPercentage(done, total));
}

function renderBarWithRate(done: number, total: number, elapsedMs: number, width: number): string {
  const bar = formatProgressBar(done, total, width);
  const pct = formatPercentage(done, total);
  return buildProgressLine(undefined, bar, pct, `@ ${formatItemsPerSecond(done, elapsedMs)}`);
}

function isProgressComplete(done: number, total: number): boolean {
  return total <= 0 || done >= total;
}

function summarizeProgressState(done: number, total: number, elapsedMs: number): string {
  const remaining = estimateTimeRemaining(done, total, elapsedMs);
  const eta = remaining === undefined ? 'unknown ETA' : `ETA ${formatTimeRemaining(remaining)}`;
  return `${done}/${total} (${formatPercentage(done, total)}, ${eta})`;
}
