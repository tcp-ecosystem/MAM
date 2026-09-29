import { describe, it, expect } from 'vitest';
import { createSummarizer, Summarizer, SummarizationAdapter } from '../src/summarization/integration.js';
import { TextSummarizer } from '../src/summarization/retrieval.js';
import { SummarizationStore } from '../src/summarization/store.js';
import { SummarizationLifecycle } from '../src/summarization/lifecycle.js';
import { SummarizationIndex } from '../src/summarization/index.js';

const source =
  'The quick brown fox jumps over the lazy dog. It is a well known pangram. ' +
  'Many typists practice it every day. The sentence tests every letter of the alphabet.';

describe('summarization', () => {
  it('TextSummarizer produces an extractive summary', () => {
    const summarizer = new TextSummarizer({ config: { maxSentences: 2 } });
    const result = summarizer.extractive(source, 2);
    expect(result.technique).toBe('extractive');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summaryLength).toBeLessThanOrEqual(source.length);
    expect(result.ratio).toBeLessThanOrEqual(1);
  });

  it('TextSummarizer extracts keywords', () => {
    const summarizer = new TextSummarizer();
    const keywords = summarizer.keywords(
      'fox fox fox dog dog dog dog pangram pangram alphabet',
      3,
    );
    expect(keywords).toHaveLength(3);
    expect(keywords[0]).toBe('dog');
  });

  it('TextSummarizer produces a rolling digest', () => {
    const summarizer = new TextSummarizer();
    const result = summarizer.rolling(source, 200);
    expect(result.technique).toBe('rolling');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summaryLength).toBeLessThanOrEqual(source.length);
  });

  it('TextSummarizer extracts ranked key points', () => {
    const summarizer = new TextSummarizer();
    const points = summarizer.keyPoints(source, 3);
    expect(points).toHaveLength(3);
    expect(points[0].rank).toBe(1);
    expect(points.map((p) => p.rank)).toEqual([1, 2, 3]);
    expect(points[0].score).toBeGreaterThanOrEqual(points[1].score);
  });

  it('Summarizer.run summarises and caches deterministically', () => {
    const summarizer = createSummarizer(undefined, { lifecycle: false });
    const first = summarizer.run(source);
    const second = summarizer.run(source);
    expect(first.summary).toBe(second.summary);
    expect(summarizer.store.size).toBe(1);
    const stats = summarizer.store.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('Summarizer.summarizeToLength fits a hard character budget', () => {
    const summarizer = createSummarizer({ maxSentences: 5 }, { lifecycle: false });
    const result = summarizer.summarizeToLength(source, 80);
    expect(result.summaryLength).toBeLessThanOrEqual(80);
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('Summarizer.keywords and keyPoints delegate to the engine', () => {
    const summarizer = createSummarizer(undefined, { lifecycle: false });
    const keywords = summarizer.keywords(source, 2);
    expect(keywords.length).toBeGreaterThan(0);
    const points = summarizer.keyPoints(source, 2);
    expect(points.length).toBeGreaterThan(0);
  });

  it('SummarizationAdapter adapts a pre-built engine and store', () => {
    const store = new SummarizationStore();
    const index = SummarizationIndex.from(store.entries().map((entry) => [entry.key, entry.result]));
    const adapter = new SummarizationAdapter({ store, index });
    const result = adapter.run(source);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(adapter.stats().results).toBe(1);
  });

  it('SummarizationLifecycle prunes the least-valuable results', () => {
    const store = new SummarizationStore();
    const ts = new TextSummarizer();
    store.put('k1', ts.extractive(source, 1));
    store.put('k2', ts.rolling(source, 200));
    const lifecycle = new SummarizationLifecycle(store, { maxEntries: 1 });
    const removed = lifecycle.prune(1);
    expect(removed).toBe(1);
    expect(store.size).toBe(1);
  });
});