# RAG layer

Grounds generation in evidence. Collects candidate pieces, assembles a
budget-bounded context, builds a context-augmented prompt and — via the
`RagEngine` — runs the whole pipeline behind one call.

## Key classes

| Class | Purpose |
| --- | --- |
| `RagStore` | Bounded cache (TTL + LRU) for pieces, contexts and results. |
| `RagIndex` | Source-to-context index: `findBySource`, `findByQuery`, `indexQuery` provenance associations. |
| `RagRetriever` | `retrieve` (full pipeline), `retrievePieces`, `assemble` (sequential/hybrid budget fitting), `buildPrompt`. |
| `RagLifecycle` | Sweep / prune / assemble / events for the RAG cache. |
| `RagEngine` | Fully-wired composite (store + index + retriever + lifecycle): `retrieveAndGenerate`, `retrieve`, `generate`, `indexPiece`. `createRagEngine` is its factory. |
| `RagAdapter` | Delegating wrapper over any `Rag`-shaped object. |

## Example

```ts
import { RagEngine } from './integration.js';

const engine = new RagEngine({ config: { topK: 5, budgetTokens: 400 } });
engine.indexPiece({ id: 'manual/1', sourceId: 'manual', text: 'Always back up before migrating.', score: 0.9 });
engine.indexPiece({ id: 'faq/2', sourceId: 'faq', text: 'Rollback on failure.', score: 0.6 });

const result = await engine.retrieveAndGenerate('how do I back up?', { includePrompt: true });
console.log(result.prompt);
console.log(result.sources); // ['manual', 'faq']
engine.dispose();
```

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | Domain types (`RagPiece`, `RagContext`, `RagConfig`, `RagOptions`, `RagResult`, `RagStats`, …) and helpers. |
| `store.ts` | `RagStore` — TTL/LRU cache with piece indexing and JSON persistence. |
| `index.ts` | `RagIndex` — source-to-context inverted index. |
| `retrieval.ts` | `RagRetriever` — `retrieve` / `retrievePieces` / `assemble` / `buildPrompt`. |
| `lifecycle.ts` | `RagLifecycle` — sweep / prune / assemble / events. |
| `integration.ts` | `RagEngine`, `RagAdapter`, `createRagEngine`, `createCorpusEngine`, `Rag` contract. |