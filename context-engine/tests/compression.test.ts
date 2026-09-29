import { describe, it, expect } from 'vitest';
import { createCompressor, Compressor, CompressionAdapter } from '../src/compression/integration.js';
import { TextCompressor } from '../src/compression/retrieval.js';
import { CompressionStore } from '../src/compression/store.js';
import { CompressionLifecycle } from '../src/compression/lifecycle.js';
import { CompressionIndex } from '../src/compression/index.js';

describe('compression', () => {
  it('TextCompressor collapses whitespace losslessly', () => {
    const compressor = new TextCompressor();
    const result = compressor.compress('a    b\n\n\nc', { technique: 'collapse' });
    expect(result.text).toBe('a b\n\nc');
    expect(result.ratio).toBeGreaterThan(0);
  });

  it('TextCompressor truncates at a word boundary', () => {
    const compressor = new TextCompressor();
    expect(compressor.truncate('aaa bbb ccc', 8)).toBe('aaa bbb');
    expect(compressor.truncate('short', 100)).toBe('short');
  });

  it('TextCompressor dedupes duplicate blocks', () => {
    const compressor = new TextCompressor();
    const deduped = compressor.dedupeBlocks('alpha\n\nbeta\n\nalpha');
    expect(deduped.dropped).toBe(1);
    expect(deduped.text).toBe('alpha\n\nbeta');
  });

  it('TextCompressor strips markdown but keeps the words', () => {
    const compressor = new TextCompressor();
    const stripped = compressor.stripMarkdown('# Title\n\n**bold** and [link](url)');
    expect(stripped.dropped).toBeGreaterThan(0);
    expect(stripped.text).toContain('Title');
    expect(stripped.text).toContain('bold');
    expect(stripped.text).toContain('link');
    expect(stripped.text).not.toContain('**');
  });

  it('TextCompressor extracts the most frequent keywords', () => {
    const compressor = new TextCompressor();
    const keywords = compressor.keywordExtract(
      'token token token budgeting budget budget context engine',
    );
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords[0]).toBe('token');
    expect(keywords).toContain('budget');
  });

  it('Compressor.run compresses and caches identical input', () => {
    const compressor = createCompressor(undefined, { lifecycle: false });
    const first = compressor.run('hello    world');
    const second = compressor.run('hello    world');
    expect(first.text).toBe(second.text);
    expect(first.text).toBe('hello world');
    expect(compressor.misses()).toBe(1);
    expect(compressor.hits()).toBe(1);
    expect(compressor.stats().results).toBe(1);
  });

  it('Compressor.compressToMax guarantees the output fits', () => {
    const compressor = createCompressor(undefined, { lifecycle: false });
    const result = compressor.compressToMax('word '.repeat(200), 50);
    expect(result.text.length).toBeLessThanOrEqual(50);
    expect(result.truncated).toBe(true);
  });

  it('CompressionAdapter adapts a pre-built store and index', () => {
    const store = new CompressionStore();
    const index = new CompressionIndex();
    const adapter = new CompressionAdapter({ store, index, lifecycle: false });
    const result = adapter.run('lots   of   spaces here');
    expect(result.text).toBe('lots of spaces here');
    expect(adapter.indexStats().size).toBe(1);
  });

  it('CompressionLifecycle prunes the lowest-ratio results', () => {
    const store = new CompressionStore();
    const tc = new TextCompressor();
    store.put('k1', tc.compress('short text', { maxLength: 100 }));
    store.put('k2', tc.compress('x'.repeat(400), { maxLength: 100 }));
    const lifecycle = new CompressionLifecycle(store, { maxEntries: 1 });
    const removed = lifecycle.prune(1);
    expect(removed).toBe(1);
    expect(store.size).toBe(1);
    expect(store.has('k2')).toBe(true);
  });
});