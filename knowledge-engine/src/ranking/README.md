# Ranking layer

Decides which retrieved chunks deserve to surface first, and explains why.
Sits between Retrieval (candidates) and RAG (evidence).

## Key classes

| Class | Purpose |
| --- | --- |
| `RankIndex` | Lightweight inverted index of term/document statistics: `termFrequency`, `documentFrequency`, `inverseDocumentFrequency`, BM25 context, TF-IDF vectors. |
| `KnowledgeRanker` | Hybrid scorer: `score` (BM25 + TF-IDF cosine + lexical overlap + recency decay + authority), `rank`, `best`, `cosine`, `lexicalOverlap`. |
| `RankingStore` | Bounded result cache (TTL + LRU eviction). |
| `RankingLifecycle` | Sweeps expired cache entries, prunes to a cap, emits `cache`/`prune`/`sweep`/`reset` events. |
| `RankingAdapter` | Cache-backed facade over a `KnowledgeRanker`. `createRankingAdapter` is its factory. |
| `ScoredRetriever` | Wraps an arbitrary retrieval source and decorates its output with ranked, explainable scores. |

## Example

```ts
import { RankIndex, KnowledgeRanker } from './index.js';

const index = new RankIndex();
index.indexDocument('manual', 'always back up before migrating');

const ranker = new KnowledgeRanker();
const ranked = ranker.rank(
  [
    { chunkId: 'manual/1', sourceId: 'manual', text: 'Always back up before migrating.', metadata: { updatedAt: Date.now(), authority: 3 } },
    { chunkId: 'faq/2', sourceId: 'faq', text: 'Rollback on failure.' },
  ],
  { text: 'how do I back up?' },
);
console.log(ranked[0].chunkId, ranked[0].score, ranked[0].reasons);
```

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | Domain types (`ChunkCandidate`, `RankedChunk`, `RankingQuery`, `RankingWeights`, `RankScore`, `Bm25Context`, …) and pure helpers. |
| `store.ts` | `RankingStore` — TTL/LRU result cache with stats and JSON round-trips. |
| `index.ts` | `RankIndex` — df/idf postings index powering BM25 and TF-IDF cosine. |
| `retrieval.ts` | `KnowledgeRanker` — hybrid `score` / `rank` / `best` / `bm25` / `cosine`. |
| `lifecycle.ts` | `RankingLifecycle` — sweep / prune / events. |
| `integration.ts` | `RankingAdapter`, `createRankingAdapter`, `createRanker`, `ScoredRetriever`, `Ranker` contract. |