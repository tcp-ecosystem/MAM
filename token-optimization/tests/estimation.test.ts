import { describe, it, expect } from 'vitest';
import { TokenEstimator } from '../src/estimation/retrieval.js';
import { EstimateStore } from '../src/estimation/store.js';
import { EstimateIndex } from '../src/estimation/index.js';
import { EstimationLifecycle } from '../src/estimation/lifecycle.js';
import {
  createTokenEstimate,
  createCalibrationSample,
  MODEL_PROFILES,
  DEFAULT_ESTIMATION_CONFIG,
} from '../src/estimation/types.js';

describe('estimation', () => {
  it('TokenEstimator.estimate uses the chars-per-token heuristic', () => {
    const estimator = new TokenEstimator();
    const text = 'The quick brown fox jumps over the lazy dog';
    const estimate = estimator.estimate(text);

    expect(estimate.tokens).toBeGreaterThan(0);
    expect(Number.isInteger(estimate.tokens)).toBe(true);
    expect(estimate.input).toBe(text);
    expect(estimate.method).toBe('chars-per-token');
    expect(estimate.model).toBe('gpt-4');
    expect(estimate.confidence).toBeGreaterThan(0);
    expect(estimate.confidence).toBeLessThanOrEqual(1);
  });

  it('TokenEstimator.charsPerToken returns the profile ratio and honors a model', () => {
    const estimator = new TokenEstimator();
    // Profiles are keyed by short family names (e.g. 'gpt4', 'claude3').
    expect(estimator.charsPerToken('gpt4')).toBe(MODEL_PROFILES.gpt4.charsPerToken);
    expect(estimator.charsPerToken('claude3')).toBe(MODEL_PROFILES.claude3.charsPerToken);
    expect(estimator.charsPerToken()).toBe(estimator.charsPerToken('gpt4'));
  });

  it('TokenEstimator.estimateMany shares a batchId across results', () => {
    const estimator = new TokenEstimator();
    const estimates = estimator.estimateMany(['alpha', 'beta', 'gamma'], { model: 'gpt-4' });

    expect(estimates).toHaveLength(3);
    expect(estimates.map((e) => e.input)).toEqual(['alpha', 'beta', 'gamma']);
    const batchIds = new Set(estimates.map((e) => e.batchId));
    expect(batchIds.size).toBe(1);
    expect(batchIds.values().next().value).toBeTruthy();
  });

  it('TokenEstimator.calibrate refines the ratio and switches the method', () => {
    const estimator = new TokenEstimator();
    const sampleText = 'short sample';
    const sample = estimator.calibrate('gpt-4', sampleText, 8);

    expect(sample.model).toBe('gpt-4');
    expect(sample.text).toBe(sampleText);
    expect(sample.actualTokens).toBe(8);
    expect(sample.chars).toBe(sampleText.length);
    expect(sample.ratio).toBeCloseTo(sampleText.length / 8);

    expect(estimator.charsPerToken('gpt-4')).toBeCloseTo(sample.ratio);
    const estimate = estimator.estimate(sampleText, { model: 'gpt-4' });
    expect(estimate.method).toBe('calibrated');
    expect(estimator.calibrationSamples('gpt-4')).toHaveLength(1);
    expect(estimator.calibrationSnapshot()['gpt-4']).toHaveLength(1);
  });

  it('TokenEstimator.calibrate validates the ground-truth token count', () => {
    const estimator = new TokenEstimator();
    expect(() => estimator.calibrate('gpt-4', 'text', -1)).toThrow(RangeError);
  });

  it('EstimateStore round-trips estimates through toJSON/fromJSON', () => {
    const store = new EstimateStore({ maxEntries: 100 });
    const estimate = createTokenEstimate('hello world', 4, 'chars-per-token', {
      model: 'gpt-4',
    });
    store.put(estimate);

    expect(store.getFor('hello world', 'gpt-4')?.tokens).toBe(4);
    expect(store.hasFor('hello world', 'gpt-4')).toBe(true);

    const restored = new EstimateStore({ maxEntries: 100 });
    const count = restored.fromJSON(store.toJSON());
    expect(count).toBe(1);
    expect(restored.getFor('hello world', 'gpt-4')?.method).toBe('chars-per-token');
  });

  it('EstimateStore reports stats and prunes to a target', () => {
    const store = new EstimateStore({ maxEntries: 16 });
    for (let i = 0; i < 20; i += 1) {
      store.put(createTokenEstimate(`text ${i}`, i, 'chars-per-token', { model: 'gpt-4' }));
    }
    expect(store.size).toBe(16); // LRU cap enforced on writes

    const evicted = store.prune(16);
    expect(evicted).toBe(0);
    expect(store.size).toBe(16);
    expect(store.stats().hitRate).toBe(0);
  });

  it('EstimationLifecycle.prune evicts entries and reconciles the index', () => {
    const store = new EstimateStore({ maxEntries: 100 });
    const index = new EstimateIndex();
    const estimator = new TokenEstimator({ store, index });
    const lifecycle = new EstimationLifecycle(estimator, store, index);

    for (let i = 0; i < 20; i += 1) {
      lifecycle.estimate(`entry ${i}`);
    }
    expect(store.size).toBe(20);
    expect(index.size).toBe(20); // index is reconciled lazily, on prune

    let prunedEvent: number | undefined;
    lifecycle.on('pruned', (event: { evicted: number }) => {
      prunedEvent = event.evicted;
    });

    // Prune targets below MIN_MAX_CACHE_ENTRIES (16) clamp to 16.
    const evicted = lifecycle.prune(16);
    expect(evicted).toBe(4);
    expect(store.size).toBe(16);
    expect(index.size).toBe(16);
    expect(prunedEvent).toBe(4);
    lifecycle.dispose();
  });

  it('EstimationLifecycle emits an estimated event per estimate', () => {
    const estimator = new TokenEstimator();
    const store = new EstimateStore({ maxEntries: 16 });
    const index = new EstimateIndex();
    const lifecycle = new EstimationLifecycle(estimator, store, index);

    let seen = 0;
    lifecycle.on('estimated', () => {
      seen += 1;
    });
    lifecycle.estimate('hello');
    lifecycle.estimate('world');
    expect(seen).toBe(2);
    expect(lifecycle.stats().estimated).toBe(2);
    lifecycle.dispose();
  });

  it('DEFAULT_ESTIMATION_CONFIG and createCalibrationSample are available', () => {
    expect(DEFAULT_ESTIMATION_CONFIG.cacheEstimates).toBe(true);
    expect(DEFAULT_ESTIMATION_CONFIG.defaultModel).toBe('gpt-4');
    const sample = createCalibrationSample('gpt-4', 'abc', 2, 'prose');
    expect(sample.label).toBe('prose');
    expect(sample.ratio).toBeCloseTo(1.5);
  });
});