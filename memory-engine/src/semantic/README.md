# Semantic memory

**Facts and knowledge** — timeless, decontextualised assertions about the world
that an agent has learned and wishes to consult later: "the deploy pipeline runs
on Node 20", "the API key is rotated every 90 days".

The layer ships a built-in **TF-IDF vector engine** (`SemanticIndex`) so entries
can be located by *meaning* rather than literal substring match — no external
vector database required.

Key properties:

- **Fact-centric** — every entry has a human-readable `fact` string plus an
  optional `subject`/`predicate`/`object` triple for relational queries.
- **Meaning-based retrieval** — `search` / `topK` / `similarTo` rank by TF-IDF
  cosine similarity.
- **Confidence** — entries carry a confidence in `[0, 1]` that the lifecycle can
  decay over time.
- **Housekeeping** — dedupe identical facts, prune to a bound, decay stale
  beliefs, and re-normalise vectors.

## Key classes

| Class | File | Purpose |
| --- | --- | --- |
| `SemanticStore` | `store.ts` | Fact CRUD, triple fields, confidence, toJSON/fromJSON |
| `SemanticIndex` | `index.ts` | Tokenise/stem + TF-IDF `computeVector`, vocabulary, cosine similarity |
| `SemanticRetriever` | `retrieval.ts` | `search`, `similarTo`, `topK`, `byTag`, `bySubject`, `byConfidence` |
| `SemanticLifecycle` | `lifecycle.ts` | `prune`, `dedupe`, `decayStale`, `normalize` + events |
| `SemanticRuntimeAdapter` | `integration.ts` | `RuntimeMemory` surface plus `search` / `recall` |
| `KnowledgeBase` | `integration.ts` | Friendly agent API: `put` / `search` / `topK` / housekeeping |

## Usage

```ts
import { createKnowledgeBase } from './integration.js';

const kb = createKnowledgeBase();
kb.put('the database is postgres 16', { tags: ['infra'], confidence: 0.9 });
kb.put('the parser tokenizes markdown', { tags: ['parser'] });

kb.search('postgres database'); // TF-IDF cosine hits, best first
kb.topK('postgres', 5);
kb.dedupe(); // collapse identical facts
```

## What each file is

| File | Responsibility |
| --- | --- |
| `types.ts` | Entry/config/stats/types, result shapes, `RuntimeMemory` contract |
| `store.ts` | The store plus confidence/tag normalisation helpers |
| `index.ts` | The TF-IDF vocabulary + vector engine |
| `retrieval.ts` | Cosine-ranked search and faceted filtering |
| `lifecycle.ts` | Prune, dedupe, decay, normalise + emitter |
| `integration.ts` | `SemanticRuntimeAdapter`, `createSemanticAdapter`, `KnowledgeBase` |