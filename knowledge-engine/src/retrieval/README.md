# Retrieval layer

Makes a knowledge corpus searchable. Owns the chunk store, the TF-IDF term
index and the hybrid retriever that turns a free-text query into ranked chunks.

## Key classes

| Class | Purpose |
| --- | --- |
| `RetrievalStore` | In-memory chunk store (`put`/`get`/`delete`/`getBySource`/`filter`/`stats`/JSON). |
| `RetrievalIndex` | Tokenizer + TF-IDF vector builder + inverted postings index (`tokenize`, `idf`, `weightedVector`, `cosineWithDocument`). |
| `KnowledgeRetriever` | Hybrid scoring retriever: `search` (full result envelope), `topK`, `recall` (query expansion), `rank`, `filter`. |
| `RetrievalLifecycle` | Cache lifecycle: `register`, `sweep`, `prune`, `clearQuery`, events. |
| `KnowledgeRetrieverAdapter` | Store + index + cache behind a single `Retriever` surface. `createRetrieverAdapter` is its factory. |
| `HybridRetriever` | Async retriever blending lexical + TF-IDF cosine + context + optional embeddings. |

## Example

```ts
import { KnowledgeRetriever } from './retrieval.js';

const retriever = new KnowledgeRetriever({ defaultTopK: 5 });
retriever.addMany([
  { chunkId: 'manual/1', sourceId: 'manual', text: 'Back up before migrating.', tags: ['ops'] },
  { chunkId: 'manual/2', sourceId: 'manual', text: 'Then migrate.', tags: ['ops'] },
]);

const result = retriever.search('how do I back up?');
console.log(result.chunks[0].chunkId, result.returned);

const top = retriever.topK('back up', 3);
console.log(top.map((c) => c.chunkId));
```

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | Domain types (`RetrievedChunk`, `RetrievalQuery`, `RetrievalOptions`, `RetrievalConfig`, `RetrievalResult`, …) and helpers. |
| `store.ts` | `RetrievalStore` — chunk registry with filtering, stats and JSON snapshots. |
| `index.ts` | `RetrievalIndex` — tokenizer, TF-IDF vector builder and inverted term index. |
| `retrieval.ts` | `KnowledgeRetriever` — hybrid `search` / `topK` / `recall` / `rank` / `filter`. |
| `lifecycle.ts` | `RetrievalLifecycle` — cache registration, TTL sweeps, pruning and events. |
| `integration.ts` | `KnowledgeRetrieverAdapter`, `createRetrieverAdapter`, `HybridRetriever`, `Retriever`/`AsyncRetriever` contracts. |