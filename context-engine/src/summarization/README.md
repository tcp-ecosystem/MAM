# Summarization

The Summarization layer is what a prompt-assembly pipeline reaches for when a
piece of context is *too long to read, but too important to drop*. It preserves
meaning by distilling a large block of text down to its most informative
sentences, its most salient keywords, or a progressively-shortened rolling
digest.

Everything here is **deterministic** — there is deliberately no LLM in the
loop. Content is ranked with classical, reproducible heuristics:

- **Extractive** — every sentence is scored from term frequency, position and
  length; the highest-scoring sentences are picked and re-ordered into their
  original sequence.
- **Keyword** — tokens are counted, stopwords discarded, and the most salient
  terms reported.
- **Rolling** — the text is chopped into sentence-aligned chunks, each summarised
  extractively, joined, and summarised again until the digest stops shrinking
  (a "summary of summaries").

## Files

| File | Contents |
|------|----------|
| `types.ts` | `SummaryResult`, `SummarizationConfig`, `KeyPoint`, factories (`createSummaryResult`, `hashString`, `lengthBucket`) |
| `store.ts` | `SummarizationStore`: LRU result cache, counters, events, JSON round-trip |
| `index.ts` | `SummarizationIndex`: by technique and length bucket |
| `retrieval.ts` | `TextSummarizer`: `extractive`, `keywords`, `rolling`, `keyPoints`, `sectionGists` |
| `lifecycle.ts` | `SummarizationLifecycle`: prune least-valuable results, forwarded events |
| `integration.ts` | `Summarizer`, `SummarizationAdapter`, `createSummarizer`, `summarizationCacheKey` |

## Key classes

- **`TextSummarizer`** — the deterministic ranking engine; every method is a
  pure function of its input, so results are reproducible and cacheable.
- **`Summarizer`** — the high-level facade wiring engine, cache, index and
  lifecycle; headline operations `run` (summarise + cache) and
  `summarizeToLength` (fit a hard character budget).
- **`SummarizationAdapter`** — an alternate facade over *existing* engine +
  store + index components.
- **`SummarizationStore`** — the keyed result cache with LRU recency.
- **`SummarizationLifecycle`** — prunes the least-valuable cached digests.

## Example

```ts
import { createSummarizer } from '@mam/context-engine';

const summarizer = createSummarizer({ maxSentences: 3 }, { lifecycle: false });

const digest = summarizer.run(longKnowledgeDump);
console.log(digest.summary);            // top sentences, original order
console.log(digest.keyPoints?.[0]);     // the most salient take-away

const fitted = summarizer.summarizeToLength(longKnowledgeDump, 512);
console.log(fitted.summaryLength <= 512); // guaranteed

const terms = summarizer.keywords(longKnowledgeDump, 10);
```