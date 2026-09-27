import { describe, it, expect, vi } from 'vitest';
import {
  PROGRESS_BAR_WIDTH,
  ProgressTracker,
  createProgressTracker,
  formatProgressBar,
  formatPercentage,
  estimateTimeRemaining,
  formatTimeRemaining,
} from '../src/progress.js';

describe('ProgressTracker', () => {
  it('should advance and clamp progress', () => {
    const tracker = new ProgressTracker(10);
    expect(tracker.getDone()).toBe(0);
    expect(tracker.advance(3)).toBe(3);
    expect(tracker.set(99)).toBe(10);
    expect(tracker.isComplete()).toBe(true);
    expect(tracker.getRemaining()).toBe(0);
  });

  it('should complete and reset', () => {
    const tracker = createProgressTracker(5, 'build');
    tracker.advance(2);
    tracker.complete();
    expect(tracker.getDone()).toBe(5);
    tracker.reset();
    expect(tracker.getDone()).toBe(0);
    tracker.reset(20);
    expect(tracker.getTotal()).toBe(20);
  });

  it('should compute ratios and rates', () => {
    const tracker = new ProgressTracker(4);
    tracker.set(1);
    expect(tracker.getRatio()).toBe(0.25);
    expect(tracker.getPercentage()).toBe(25);
    expect(tracker.getElapsedMs()).toBeGreaterThanOrEqual(0);
    expect(tracker.getRatePerSecond(Date.now())).toBeGreaterThanOrEqual(0);
    expect(new ProgressTracker(0).getRatio()).toBe(1);
  });

  it('should render bars with labels', () => {
    const tracker = new ProgressTracker(2, 'build');
    tracker.set(1);
    expect(tracker.render()).toContain('build');
    expect(tracker.render()).toContain('50.0%');
    expect(tracker.renderCompact()).toBe('1/2 50.0%');
    expect(tracker.renderRate()).toContain('1/2');
    expect(tracker.renderWithEta()).toContain('50.0%');
  });

  it('should pause and resume', () => {
    const tracker = new ProgressTracker(10);
    expect(tracker.isPaused()).toBe(false);
    tracker.pause();
    expect(tracker.isPaused()).toBe(true);
    tracker.resume(Date.now() + 5000);
    expect(tracker.isPaused()).toBe(false);
  });

  it('should notify listeners and unsubscribe', () => {
    const tracker = new ProgressTracker(10);
    const seen: number[] = [];
    const off = tracker.onUpdate((snapshot) => seen.push(snapshot.done));
    tracker.advance(2);
    off();
    tracker.advance(2);
    expect(seen).toEqual([2]);
  });

  it('should smooth rates from samples', () => {
    const tracker = new ProgressTracker(10);
    expect(tracker.getSmoothedRatePerSecond()).toBe(0);
    const now = Date.now();
    tracker.set(2);
    tracker.recordSample(now);
    tracker.set(4);
    tracker.recordSample(now + 1000);
    expect(tracker.getSmoothedRatePerSecond(now + 1000)).toBe(2);
    expect(tracker.getSmoothedRemainingMs(now + 1000)).toBe(3000);
  });

  it('should serialize and restore state', () => {
    const tracker = new ProgressTracker(10, 'job');
    tracker.set(4);
    const json = tracker.toJSON();
    const other = new ProgressTracker(1);
    other.restore(json);
    expect(other.getDone()).toBe(4);
    expect(other.getTotal()).toBe(10);
    expect(other.render()).toContain('job');
  });

  it('should manage labels', () => {
    const tracker = new ProgressTracker(10);
    tracker.setLabel('step');
    expect(tracker.render()).toContain('step');
    expect(tracker.snapshot().label).toBe('step');
  });
});

describe('formatProgressBar', () => {
  it('should draw proportional bars', () => {
    expect(formatProgressBar(0, 4, 4)).toBe('[>   ]');
    expect(formatProgressBar(4, 4, 4)).toBe('[====]');
    expect(formatProgressBar(0, 0)).toBe(`[${'='.repeat(PROGRESS_BAR_WIDTH)}]`);
    expect(PROGRESS_BAR_WIDTH).toBe(30);
  });
});

describe('formatPercentage', () => {
  it('should format percentages', () => {
    expect(formatPercentage(1, 2)).toBe('50.0%');
    expect(formatPercentage(0, 0)).toBe('100.0%');
    expect(formatPercentage(5, 4)).toBe('100.0%');
  });
});

describe('estimateTimeRemaining', () => {
  it('should estimate from rate', () => {
    expect(estimateTimeRemaining(1, 2, 1000)).toBe(1000);
    expect(estimateTimeRemaining(0, 2, 1000)).toBeUndefined();
    expect(estimateTimeRemaining(2, 2, 1000)).toBe(0);
  });
});

describe('formatTimeRemaining', () => {
  it('should format durations', () => {
    expect(formatTimeRemaining(0)).toBe('0s');
    expect(formatTimeRemaining(5000)).toBe('5s');
    expect(formatTimeRemaining(90000)).toBe('1m 30s');
    expect(formatTimeRemaining(120000)).toBe('2m');
    expect(formatTimeRemaining(3600000)).toBe('1h');
    expect(formatTimeRemaining(5400000)).toBe('1h 30m');
  });
});
