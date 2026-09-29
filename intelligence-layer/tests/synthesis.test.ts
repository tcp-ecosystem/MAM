import { describe, it, expect } from 'vitest';
import { AnswerSynthesizer } from '../src/synthesis/retrieval.js';
import { SynthesisStore } from '../src/synthesis/store.js';
import { SynthesisLifecycle } from '../src/synthesis/lifecycle.js';
import {
  createAnswer,
  createEvidencePart,
  createSynthesisPart,
  DEFAULT_SYNTHESIS_CONFIG,
} from '../src/synthesis/types.js';

const REQUEST = {
  query: 'What is the capital of France?',
  evidence: [
    { id: 'kb-1', text: 'Paris is the capital of France.', source: 'geo.md', score: 0.9 },
  ],
};

describe('synthesis', () => {
  it('AnswerSynthesizer.synthesize assembles a grounded, cited answer', () => {
    const synthesizer = new AnswerSynthesizer();
    const answer = synthesizer.synthesize(REQUEST);

    expect(answer.grounded).toBe(true);
    expect(answer.parts.length).toBeGreaterThanOrEqual(1);
    expect(answer.citations).toContain('[geo.md: kb-1]');
    expect(answer.confidence).toBeGreaterThan(0);
    expect(answer.confidence).toBeLessThanOrEqual(1);
    expect(answer.text.length).toBeGreaterThan(0);
    expect(answer.text).toContain('Paris');
  });

  it('AnswerSynthesizer.synthesize returns an ungrounded fallback for empty evidence', () => {
    const synthesizer = new AnswerSynthesizer();
    const answer = synthesizer.synthesize({ query: 'What is the capital of France?', evidence: [] });

    expect(answer.grounded).toBe(false);
    expect(answer.confidence).toBe(0);
    expect(answer.parts).toHaveLength(0);
    expect(answer.citations).toHaveLength(0);
    expect(answer.text).toContain('No evidence');
  });

  it('AnswerSynthesizer.extractSentences is abbreviation-aware', () => {
    const synthesizer = new AnswerSynthesizer();
    const sentences = synthesizer.extractSentences('Dr. Smith is here. He works hard.');

    expect(sentences).toEqual(['Dr. Smith is here.', 'He works hard.']);
    expect(synthesizer.extractSentences('')).toEqual([]);
  });

  it('AnswerSynthesizer.scoreSentences ranks by query term overlap', () => {
    const synthesizer = new AnswerSynthesizer();
    const scored = synthesizer.scoreSentences(
      ['The quick brown fox jumps', 'Completely unrelated text about hiking'],
      'quick brown fox',
    );

    expect(scored).toHaveLength(2);
    expect(scored[0].sentence).toBe('The quick brown fox jumps');
    expect(scored[0].score).toBeGreaterThan(0.5);
    expect(scored[0].terms).toEqual(['quick', 'brown', 'fox']);
  });

  it('AnswerSynthesizer.dedupeSentences drops near-duplicates', () => {
    const synthesizer = new AnswerSynthesizer();
    const scored = synthesizer.scoreSentences(
      [
        'Paris is the capital of France',
        'Paris is the capital of France and a major city',
        'Completely unrelated',
      ],
      'paris capital france',
    );

    const deduped = synthesizer.dedupeSentences(scored, 0.6);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].sentence).toBe('Paris is the capital of France');
  });

  it('AnswerSynthesizer.buildAnswer constructs a valid Answer', () => {
    const synthesizer = new AnswerSynthesizer();
    const answer = synthesizer.buildAnswer(
      'Paris is the capital of France.',
      [createSynthesisPart({ id: 'kb-1', text: 'Paris is the capital of France.', source: 'geo.md' })],
      ['[geo.md: kb-1]'],
      0.9,
      'extractive-fusion-v1',
      true,
    );

    expect(answer.text).toBe('Paris is the capital of France.');
    expect(answer.confidence).toBe(0.9);
    expect(answer.model).toBe('extractive-fusion-v1');
    expect(answer.grounded).toBe(true);
    expect(answer.citations).toEqual(['[geo.md: kb-1]']);
  });

  it('SynthesisStore round-trips answers through toJSON/fromJSON', () => {
    const store = new SynthesisStore(32);
    const synthesizer = new AnswerSynthesizer();
    const answer = synthesizer.synthesize(REQUEST);

    const key = store.putFor('What is the capital of France?', answer);
    expect(store.getFor('What is the capital of France?')?.grounded).toBe(true);
    expect(store.size).toBe(1);

    store.fromJSON(store.toJSON());
    expect(store.size).toBe(1);
    expect(store.get(key)?.text).toBe(answer.text);
  });

  it('SynthesisLifecycle.record stores answers and emits synthesized events', () => {
    const store = new SynthesisStore(100);
    const lifecycle = new SynthesisLifecycle(store);
    const synthesizer = new AnswerSynthesizer();

    let synthesized = 0;
    lifecycle.on('synthesized', () => {
      synthesized += 1;
    });

    const answer = synthesizer.synthesize(REQUEST);
    lifecycle.record(answer, REQUEST.query);
    expect(store.size).toBe(1);
    expect(synthesized).toBe(1);
    expect(lifecycle.stats().recorded).toBe(1);
    lifecycle.dispose();
  });

  it('SynthesisLifecycle.prune evicts down to a size bound', () => {
    const store = new SynthesisStore(100);
    const lifecycle = new SynthesisLifecycle(store);
    const synthesizer = new AnswerSynthesizer();

    for (let i = 0; i < 20; i += 1) {
      const answer = synthesizer.synthesize({ query: `query ${i}`, evidence: REQUEST.evidence });
      lifecycle.record(answer, `query ${i}`);
    }
    expect(store.size).toBe(20);

    const pruned = lifecycle.prune(10);
    expect(pruned).toBe(10);
    expect(store.size).toBe(10);
    lifecycle.dispose();
  });

  it('factories and defaults are available', () => {
    const part = createEvidencePart({ text: 'Paris is the capital of France.', id: 'kb-1' });
    expect(part.id).toBe('kb-1');

    const answer = createAnswer({ text: 'hi', confidence: 0.9 });
    expect(answer.grounded).toBe(true);

    expect(DEFAULT_SYNTHESIS_CONFIG.minScore).toBe(0.35);
    expect(DEFAULT_SYNTHESIS_CONFIG.includeCitations).toBe(true);
  });
});