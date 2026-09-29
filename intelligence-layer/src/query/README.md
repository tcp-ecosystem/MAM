# Query understanding

The first stage of the Intelligence engine. `QueryAnalyzer` turns a raw
free-text query into a structured, serialisable `QueryAnalysis` by running a
deterministic, dependency-free pipeline: normalise → classify intent →
extract terms → detect entities → expand with synonyms/thesaurus →
decompose into sub-queries → detect language. `QueryStore` caches analyses by
content address, `QueryIndex` answers "which past queries were about X", and
`QueryLifecycle` curates the cache.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `QueryAnalysis`, `QueryIntent`, `IntentSignal`, `AnalysisConfig`, `AnalyzeOptions`, `AnalysisStats`, `QUERY_INTENTS`, `DEFAULT_ANALYSIS_CONFIG`, guards + factories |
| `store.ts` | `QueryStore`: content-addressed LRU analysis cache, JSON round-trip, eviction hook |
| `index.ts` | `QueryIndex`: inverted index by intent and term, `findByIntent`/`findByTerm`/`findByTerms`, `sync` |
| `retrieval.ts` | `QueryAnalyzer`: `analyze`, `classifyIntent`, `extractTerms`, `expand`, `decompose`, `normalize`, `detectLanguage`, `detectEntities` |
| `lifecycle.ts` | `QueryLifecycle`: `process`, `record`, `prune`, `pruneByAge`, GC timer, typed events |

## Example

```ts
import { QueryAnalyzer, QueryStore, QueryIndex, QueryLifecycle } from '@mam/intelligence-layer';

const analyzer = new QueryAnalyzer();
const analysis = analyzer.analyze('compare Postgres vs MySQL for analytics');
analysis.intent;    // 'comparison'
analysis.terms;     // ranked salient terms
analysis.subQueries; // ['postgres', 'mysql'] (decomposed on 'vs')
analysis.expanded;   // widened term set (when expansion added anything)

const signal = analyzer.classifyIntent('how to bake a sourdough loaf');
signal.intent;   // 'howto'
signal.reasons;  // ['explicit how-to phrase', ...]

// Cache + index + lifecycle wiring.
const store = new QueryStore({ capacity: 1000 });
const index = new QueryIndex({ store });
const lifecycle = new QueryLifecycle(store, { analyzer, index });
const result = lifecycle.process('what is a vector database?');
lifecycle.prune(100); // evict down to the size bound
```