import { describe, it, expect } from 'vitest';
import {
  TokenCompressor,
  splitSentences,
  isStopword,
  isTechnique,
} from '../src/compression/retrieval.js';
import { CompressionStore } from '../src/compression/store.js';
import { CompressionIndex, INDEX_BUCKET_SIZE } from '../src/compression/index.js';
import { CompressionLifecycle } from '../src/compression/lifecycle.js';
import {
  TECHNIQUES,
  createCompressionResult,
  defaultTokenCounter,
  normalizeCompressConfig,
  DEFAULT_COMPRESS_CONFIG,
} from '../src/compression/types.js';

describe('compression', () => {
  it('TokenCompressor.compress collapses whitespace by default', () => {
    const compressor = new TokenCompressor();
    const result = compressor.compress('Hello   world\n\n\n\nthis\ttext');

    expect(result.text).toBe('Hello world\n\nthis text');
    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.techniques).toContain('collapse-whitespace');
  });

  it('TokenCompressor.compress removes repeated blocks', () => {
    const compressor = new TokenCompressor();
    const paragraph =
      'This is the repeated paragraph that appears twice in the document and should be dropped the second time.';
    const text = [paragraph, '', paragraph, '', 'A unique closing paragraph that stays put.'].join('\n');

    const result = compressor.compress(text);
    expect(result.techniques).toContain('dedupe-blocks');
    const occurrences = result.text.split(paragraph).length - 1;
    expect(occurrences).toBe(1);
    expect(result.text).toContain('A unique closing paragraph that stays put.');
  });

  it('TokenCompressor.trimStopwords removes sentence-edge filler', () => {
    const compressor = new TokenCompressor({ config: { trimStopwords: true } });
    const result = compressor.compress('Please summarize the results. Thanks.');
    expect(result.text).not.toMatch(/\bPlease\b/);
    expect(result.text).not.toMatch(/\bThanks\.\z/);
    expect(result.techniques).toContain('trim-stopwords');
  });

  it('TokenCompressor.abbreviate shortens common phrases', () => {
    const compressor = new TokenCompressor({ config: { abbreviate: true } });
    const result = compressor.compress('Please note the configuration for example');
    // Abbreviation preserves the case of the first letter of the match.
    expect(result.text).toMatch(/pls note/i);
    expect(result.text).toContain('config');
    expect(result.text).toContain('e.g.');
    expect(result.techniques).toContain('abbreviate');
  });

  it('TokenCompressor.compress truncates to maxTokens with an ellipsis', () => {
    const compressor = new TokenCompressor({ config: { maxTokens: 10 } });
    const longText =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
    const result = compressor.compress(longText);

    expect(result.techniques).toContain('truncate');
    expect(result.text).toMatch(/…$/);
    expect(result.text.length).toBeLessThan(longText.length);
    expect(compressor.count(result.text)).toBeLessThanOrEqual(10);
  });

  it('TokenCompressor.compress reports savedTokens and savedPercent', () => {
    const compressor = new TokenCompressor({
      config: { trimStopwords: true, abbreviate: true },
    });
    const result = compressor.compress(
      'The very long information about the configuration and optimization please',
      { includeOriginalText: true, saveTechniqueResults: true },
    );

    expect(result.savedTokens).toBeGreaterThan(0);
    expect(result.savedPercent).toBeGreaterThan(0);
    expect(result.savedPercent).toBeLessThanOrEqual(100);
    expect(result.originalText).toBeDefined();
    expect(result.techniqueResults).toBeDefined();
    expect(result.techniqueResults!.length).toBeGreaterThan(0);
    const sum = result.techniqueResults!.reduce((acc, t) => acc + t.savedTokens, 0);
    expect(sum).toBeGreaterThanOrEqual(result.savedTokens);
  });

  it('TokenCompressor.compress supports an injected counter', () => {
    const counter = (text: string): number => Math.max(1, Math.round(text.length / 2));
    const compressor = new TokenCompressor({ counter });
    const result = compressor.compress('ab   cd', { counter });
    expect(result.originalTokens).toBeGreaterThan(0);
  });

  it('CompressionStore round-trips results through toJSON/fromJSON', () => {
    const store = new CompressionStore({ maxEntries: 100 });
    const compressor = new TokenCompressor({ store });
    const result = compressor.compress('The   original text   with spaces', {
      includeOriginalText: true,
    });

    expect(store.getFor('The   original text   with spaces')?.text).toBe(result.text);
    expect(store.hasFor('The   original text   with spaces')).toBe(true);

    const restored = new CompressionStore({ maxEntries: 100 });
    const count = restored.fromJSON(store.toJSON());
    expect(count).toBe(1);
    expect(restored.getFor('The   original text   with spaces')?.savedTokens).toBe(
      result.savedTokens,
    );
  });

  it('CompressionStore stats aggregate saved tokens', () => {
    const store = new CompressionStore({ maxEntries: 100 });
    store.put(
      createCompressionResult('short', 10, 4, ['collapse-whitespace'], { originalText: 'orig' }),
    );
    const stats = store.stats();
    expect(stats.entries).toBe(1);
    expect(stats.savedTokensTotal).toBe(6);
    expect(stats.avgSavedPercent).toBe(60);
  });

  it('CompressionIndex indexes by technique and savings', () => {
    const index = new CompressionIndex();
    const result = createCompressionResult('text', 20, 8, ['collapse-whitespace', 'abbreviate']);
    index.indexResult(result);

    expect(index.size).toBe(1);
    expect(index.findByTechnique('abbreviate')).toHaveLength(1);
    expect(index.findByTechnique('dedupe-blocks')).toHaveLength(0);
    expect(index.topSavings(1)).toHaveLength(1);
    expect(index.stats().techniques).toBe(2);
    expect(INDEX_BUCKET_SIZE).toBe(20);
  });

  it('CompressionLifecycle.prune evicts entries and reconciles the index', () => {
    const store = new CompressionStore({ maxEntries: 100 });
    const index = new CompressionIndex();
    const compressor = new TokenCompressor({ store, index });
    const lifecycle = new CompressionLifecycle(compressor, store, index);

    for (let i = 0; i < 20; i += 1) {
      lifecycle.compress(`entry ${i} with some   extra   spaces`, {
        includeOriginalText: true,
      });
    }
    expect(store.size).toBe(20);
    expect(index.size).toBe(20);

    // Prune targets below MIN_MAX_CACHE_ENTRIES (16) clamp to 16.
    const evicted = lifecycle.prune(16);
    expect(evicted).toBe(4);
    expect(store.size).toBe(16);
    expect(index.size).toBe(16);
    expect(lifecycle.stats().totalEvicted).toBeGreaterThanOrEqual(4);
    lifecycle.dispose();
  });

  it('CompressionLifecycle emits a compressed event', () => {
    const lifecycle = new CompressionLifecycle(
      new TokenCompressor(),
      new CompressionStore({ maxEntries: 16 }),
      new CompressionIndex(),
    );
    let seen = 0;
    lifecycle.on('compressed', () => {
      seen += 1;
    });
    lifecycle.compress('hello world');
    lifecycle.compress('another  text');
    expect(seen).toBe(2);
    lifecycle.dispose();
  });

  it('helpers: splitSentences, isStopword, isTechnique, defaultTokenCounter', () => {
    expect(splitSentences('First sentence. Second one! Third?')).toHaveLength(3);
    expect(isStopword('The', ['the'])).toBe(true);
    expect(isStopword('hello', ['the'])).toBe(false);
    expect(isTechnique('truncate')).toBe(true);
    expect(isTechnique('bogus')).toBe(false);
    expect(defaultTokenCounter('hello world')).toBeGreaterThan(0);
    expect(normalizeCompressConfig({ trimStopwords: true }).trimStopwords).toBe(true);
    expect(DEFAULT_COMPRESS_CONFIG.collapseWhitespace).toBe(true);
    expect(TECHNIQUES).toContain('abbreviate');
  });
});