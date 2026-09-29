# Compression

The Compression layer reduces the token footprint of prompt text *without*
calling an LLM. `TokenCompressor` applies five deterministic techniques in a
fixed order — `collapse-whitespace`, `dedupe-blocks`, `trim-stopwords`,
`abbreviate`, `truncate` — and returns a `CompressionResult` with the
compressed text, token counts on both sides, aggregate `savedTokens` /
`savedPercent`, and (optionally) a per-technique `techniqueResults` breakdown.
Token counting is injectable via a `TokenCounter`, defaulting to a built-in
heuristic.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `CompressionResult`, `CompressConfig`, `CompressOptions`, `TokenCounter`, `TECHNIQUES`, guards + factories |
| `store.ts` | `CompressionStore`: content-addressed result cache, LRU eviction, JSON round-trip |
| `index.ts` | `CompressionIndex`: by technique / savings bucket, `topSavings` |
| `retrieval.ts` | `TokenCompressor`: `compress`, `collapseWhitespace`, `dedupeBlocks`, `trimStopwords`, `abbreviate`, `truncateToTokens` |
| `lifecycle.ts` | `CompressionLifecycle`: `compress`, `prune`, `clear`, GC timer, typed events |

## Example

```ts
import { TokenCompressor, CompressionLifecycle, CompressionStore, CompressionIndex } from '@mam/token-optimization';

const compressor = new TokenCompressor({
  config: { trimStopwords: true, abbreviate: true, maxTokens: 60 },
});

const result = compressor.compress(
  'Please   summarize the following information because it is very, very long...',
  { includeOriginalText: true, saveTechniqueResults: true },
);
result.text;               // the compressed text
result.savedTokens;        // tokens saved
result.savedPercent;       // savings as a percentage
result.techniques;         // techniques that actually applied
result.techniqueResults;   // per-technique breakdown (opt-in)

// Wire store + index + lifecycle for caching, GC and events.
const store = new CompressionStore();
const index = new CompressionIndex();
const lifecycle = new CompressionLifecycle(compressor, store, index);
lifecycle.on('compressed', (r) => console.log(r.savedTokens));
lifecycle.compress('some text');
lifecycle.prune();         // evict down to store.maxEntries
```