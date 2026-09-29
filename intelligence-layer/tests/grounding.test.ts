import { describe, it, expect } from 'vitest';
import { GroundednessScorer } from '../src/grounding/retrieval.js';
import { GroundingStore } from '../src/grounding/store.js';
import { GroundingLifecycle } from '../src/grounding/lifecycle.js';
import {
  createEvidenceChunk,
  createGroundingResult,
  DEFAULT_GROUNDING_CONFIG,
} from '../src/grounding/types.js';

const EVIDENCE = [
  {
    id: 'kb-1',
    text: 'The API returns 204 on success when the request is valid.',
    source: 'docs/api.md',
  },
];

describe('grounding', () => {
  it('GroundednessScorer.ground returns a supported verdict with citations', () => {
    const scorer = new GroundednessScorer();
    const verdict = scorer.ground('The API returns 204 on success', EVIDENCE);

    expect(verdict.supported).toBe(true);
    expect(verdict.score).toBeGreaterThan(0.5);
    expect(verdict.citations).toContain('[docs/api.md: kb-1]');
    expect(verdict.unmatchedTerms).toEqual([]);
    expect(verdict.claim).toBe('The API returns 204 on success');
  });

  it('GroundednessScorer.ground flags unsupported claims and collects unmatched terms', () => {
    const scorer = new GroundednessScorer();
    const verdict = scorer.ground('The moon is made of cheese', EVIDENCE);

    expect(verdict.supported).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.citations).toEqual([]);
    expect(verdict.unmatchedTerms).toEqual(['moon', 'made', 'cheese']);
  });

  it('GroundednessScorer.overlap computes the Dice coefficient', () => {
    const scorer = new GroundednessScorer();
    expect(scorer.overlap(new Set(['a', 'b']), new Set(['b', 'c']))).toBe(0.5);
    expect(scorer.overlap(new Set(['a']), new Set(['a']))).toBe(1);
    expect(scorer.overlap(new Set([]), new Set([]))).toBe(0);
  });

  it('GroundednessScorer.checkMany rolls verdicts up into a GroundingResult', () => {
    const scorer = new GroundednessScorer();
    const result = scorer.checkMany(
      ['The API returns 204 on success', 'The moon is made of cheese'],
      EVIDENCE,
    );

    expect(result.claims).toHaveLength(2);
    expect(result.supportedCount).toBe(1);
    expect(result.ratio).toBeCloseTo(0.5);
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.summary).toContain('Grounded 1/2 claims');
  });

  it('GroundednessScorer.summarize flattens verdicts into a summary', () => {
    const scorer = new GroundednessScorer();
    const result = scorer.checkMany(
      ['The API returns 204 on success', 'The moon is made of cheese'],
      EVIDENCE,
    );
    const summary = scorer.summarize([result]);

    expect(summary.total).toBe(2);
    expect(summary.supported).toBe(1);
    expect(summary.unsupported).toBe(1);
    expect(summary.ratio).toBeCloseTo(0.5);
    expect(summary.details).toHaveLength(2);
  });

  it('GroundingStore round-trips results through toJSON/fromJSON', () => {
    const store = new GroundingStore(32);
    const scorer = new GroundednessScorer();
    const result = scorer.checkMany(['The API returns 204 on success'], EVIDENCE);
    store.put('mykey', result);

    expect(store.has('mykey')).toBe(true);
    expect(store.getFor('The API returns 204 on success')?.supportedCount).toBe(1);
    expect(store.size).toBe(1);

    store.fromJSON(store.toJSON());
    expect(store.size).toBe(1);
    expect(store.getFor('The API returns 204 on success')?.claims).toHaveLength(1);
  });

  it('GroundingLifecycle.record stores results and emits grounded events', () => {
    const store = new GroundingStore(100);
    const lifecycle = new GroundingLifecycle(store);
    const scorer = new GroundednessScorer();

    let groundedEvents = 0;
    lifecycle.on('grounded', () => {
      groundedEvents += 1;
    });

    const supported = scorer.checkMany(['The API returns 204 on success'], EVIDENCE);
    const key = lifecycle.record(supported);
    expect(key).toBeTruthy();
    expect(store.size).toBe(1);
    expect(groundedEvents).toBe(1);
    expect(lifecycle.stats().recorded).toBe(1);
    lifecycle.dispose();
  });

  it('GroundingLifecycle.prune evicts down to a size bound', () => {
    const store = new GroundingStore(100);
    const lifecycle = new GroundingLifecycle(store);
    const scorer = new GroundednessScorer();

    for (let i = 0; i < 20; i += 1) {
      lifecycle.record(scorer.checkMany([`claim ${i}`], EVIDENCE));
    }
    expect(store.size).toBe(20);

    const pruned = lifecycle.prune(10);
    expect(pruned).toBe(10);
    expect(store.size).toBe(10);
    expect(lifecycle.stats().pruned).toBe(10);
    lifecycle.dispose();
  });

  it('factories and defaults are available', () => {
    const chunk = createEvidenceChunk({ text: 'some text', source: 'src.md' });
    expect(chunk.id).toBeTruthy();
    expect(chunk.source).toBe('src.md');

    const result = createGroundingResult([
      { claim: 'c', supported: true, score: 0.9, citations: [], unmatchedTerms: [] },
    ]);
    expect(result.supportedCount).toBe(1);

    expect(DEFAULT_GROUNDING_CONFIG.minScore).toBe(0.55);
    expect(DEFAULT_GROUNDING_CONFIG.citationFormat).toBe('text');
  });
});