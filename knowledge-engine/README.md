# @mam/knowledge-engine

Standalone MAM Knowledge Engine — a dependency-free, in-memory pipeline that turns
raw knowledge sources into ranked, retrievable, prompt-ready context. Four layers,
each with the same shape: **store**, **index**, **retriever/ranker**, **lifecycle**
and **integration adapter**.

## Layers

| Layer | Responsibility |
| --- | --- |
| [Sources](src/sources/README.md) | Ingestion boundary. Registers text, files, URLs and memory sources with duplicate policies, size caps, an incremental multi-axis `SourceIndex`, weighted `SourceRetriever` search, and a refresh/prune `SourceLifecycle`. |
| [Ranking](src/ranking/README.md) | Scoring. `RankIndex` (df/idf), `KnowledgeRanker` (BM25 + TF-IDF cosine + lexical overlap + recency + authority), a `RankingStore` cache, `RankingLifecycle` and `RankingAdapter` / `ScoredRetriever` facades. |
| [Retrieval](src/retrieval/README.md) | Searchable corpus. `RetrievalStore` chunk store, `RetrievalIndex` (tokenizer + TF-IDF), `KnowledgeRetriever` (hybrid search / topK / recall), `RetrievalLifecycle` and `KnowledgeRetrieverAdapter` / `HybridRetriever`. |
| [RAG](src/rag/README.md) | Grounded generation. `RagStore` cache, `RagIndex` (source→context), `RagRetriever` (retrieve / assemble / buildPrompt), `RagLifecycle` and the fully-wired `RagEngine`. |

## Architecture

```
                    ┌──────────────────────────┐
                    │   @mam/knowledge-engine   │
                    └──────────────────────────┘
                                    │
        ┌──────────────┬────────────┼────────────┬──────────────┐
        ▼              ▼            ▼            ▼              ▼
   ┌──────────┐  ┌──────────┐ ┌──────────┐ ┌──────────┐  ┌──────────┐
   │  Sources  │  │  Ranking  │ │ Retrieval│ │   RAG    │  │   …      │
   │  (ingest) │  │  (score)  │ │ (search) │ │ (answer) │  │          │
   └──────────┘  └──────────┘ └──────────┘ └──────────┘  └──────────┘
```

The pipeline is: **Sources** register raw knowledge → **Retrieval** makes it
searchable → **Ranking** decides what deserves to surface first → **RAG** turns
the winners into an assembled, budget-bounded context and prompt.

## Quick start

```ts
import {
  KnowledgeSourceStore,
  KnowledgeRetriever,
  KnowledgeRanker,
  RagEngine,
} from '@mam/knowledge-engine';

// 1. Ingest sources
const store = new KnowledgeSourceStore();
await store.ingestText('manual', 'Always back up before migrating.');

// 2. Search the corpus
const retriever = new KnowledgeRetriever();
retriever.addChunk({ chunkId: 'manual/1', sourceId: 'manual', text: 'Always back up before migrating.' });
const result = retriever.search('how do I back up?');

// 3. Rank the candidates
const ranker = new KnowledgeRanker();
const ranked = ranker.best(
  result.chunks.map((c) => ({ chunkId: c.chunkId, sourceId: c.sourceId, text: c.text })),
  { text: 'how do I back up?' },
);

// 4. Answer from context
const engine = new RagEngine();
engine.indexPiece({ id: 'manual/1', sourceId: 'manual', text: 'Always back up before migrating.', score: 0.9 });
const answer = await engine.retrieveAndGenerate('how do I back up?', { includePrompt: true });
console.log(answer.prompt);
```

## Commands

```bash
pnpm install                 # link the workspace package
pnpm --filter @mam/knowledge-engine build     # tsc → dist/
pnpm --filter @mam/knowledge-engine test      # vitest run
pnpm --filter @mam/knowledge-engine typecheck # tsc --noEmit
pnpm --filter @mam/knowledge-engine clean     # rm -rf dist
```

## Files

| File | Purpose |
| --- | --- |
| `src/index.ts` | Public barrel re-exporting all four layers. |
| `src/sources/` | Sources layer (types, store, index, retrieval, lifecycle, integration). |
| `src/ranking/` | Ranking layer (types, store, index, retrieval, lifecycle, integration). |
| `src/retrieval/` | Retrieval layer (types, store, index, retrieval, lifecycle, integration). |
| `src/rag/` | RAG layer (types, store, index, retrieval, lifecycle, integration). |
| `tests/` | Vitest suites — one per layer. |

## Per-layer files

| Layer | types | store | index | retrieval | lifecycle | integration |
| --- | --- | --- | --- | --- | --- | --- |
| Sources | `types.ts` | `store.ts` | `index.ts` | `retrieval.ts` | `lifecycle.ts` | `integration.ts` |
| Ranking | `types.ts` | `store.ts` | `index.ts` | `retrieval.ts` | `lifecycle.ts` | `integration.ts` |
| Retrieval | `types.ts` | `store.ts` | `index.ts` | `retrieval.ts` | `lifecycle.ts` | `integration.ts` |
| RAG | `types.ts` | `store.ts` | `index.ts` | `retrieval.ts` | `lifecycle.ts` | `integration.ts` |

Each layer's README (in `src/<layer>/README.md`) documents the layer, its key
classes, a usage example and what each file does.