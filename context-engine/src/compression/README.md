# Compression

The Compression layer shrinks context text *deterministically* — no LLM
involved — so a long prompt section can be made to fit a token budget without
losing the information a caller still cares about.

- **Lossless shrinking** — collapse whitespace runs and remove duplicated
  blocks. These change formatting, not content.
- **Lossy shrinking** — strip markdown syntax (keeping the words) and
  hard-truncate to a maximum length. Applied only when a hard limit demands it.
- **Keyword extraction** — distill a section down to its most frequent,
  distinctive words.
- **Tiered compression** — compose the above in a fixed order
  (`lossless → lossy → truncate`) and report exactly what happened via a
  `CompressionResult`.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `CompressionResult`, `CompressionConfig`, `CompressOptions`, ratio/bucket helpers |
| `store.ts` | `CompressionStore`: keyed result cache, eviction by cap, JSON round-trip |
| `index.ts` | `CompressionIndex`: by technique and ratio bucket |
| `retrieval.ts` | `TextCompressor`: `compress`, `truncate`, `collapseWhitespace`, `dedupeBlocks`, `stripMarkdown`, `keywordExtract` |
| `lifecycle.ts` | `CompressionLifecycle`: bounded cache pruning |
| `integration.ts` | `Compressor`, `CompressionAdapter`, `createCompressor` |

## Key classes

- **`TextCompressor`** — the deterministic algorithm worker. Stateless apart
  from configuration and clock.
- **`Compressor`** — the high-level facade wiring algorithms, cache, index and
  lifecycle; headline operations `run` (compress + cache) and
  `compressToMax` (guaranteed fit).
- **`CompressionAdapter`** — an alternate facade over *existing* store + index
  + compressor components.
- **`CompressionStore`** — the keyed result cache; identical text+options reuse
  a cached result.
- **`CompressionLifecycle`** — prunes the least-valuable (lowest-ratio) cached
  results.

## Example

```ts
import { createCompressor } from '@mam/context-engine';

const compressor = createCompressor(
  { stripMarkdown: true, maxLength: 8000 },
  { lifecycle: false },
);

const result = compressor.run(longToolOutput);
console.log(`${result.ratio * 100}% smaller; ${result.droppedBlocks} blocks dropped`);

const fitted = compressor.compressToMax(entireKnowledgeSection, 10_000);
console.log(fitted.text.length <= 10_000); // guaranteed
```