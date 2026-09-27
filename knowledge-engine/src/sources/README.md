# Sources layer

The ingestion boundary of the Knowledge Engine. It registers raw knowledge
sources — free text, local files, remote URLs and in-process memory — and keeps
them queryable and alive.

## Key classes

| Class | Purpose |
| --- | --- |
| `KnowledgeSourceStore` | Authoritative registry of `KnowledgeSource`s. `register`, `ingestText`, `ingestFile`, `ingestUrl`, duplicate policies, content-size caps, stats and JSON persistence. |
| `SourceIndex` | Fast, incremental multi-axis index (kind / tag / MIME / name / id-prefix). |
| `SourceRetriever` | Weighted lookup: `recent`, `byKind`, `byTags`, free-text `search` and reproducible `random`. |
| `SourceLifecycle` | `refresh` (re-read files, re-fetch URLs), `prune` (stale eviction), typed events, periodic timer. |
| `KnowledgeSourceAdapter` | Façade bundling store + index + retriever behind one surface. `createSourceAdapter` is its factory. |
| `SourceRegistry` | Collection of named adapters with bulk `ingestAll`, cross-adapter `search` and `stats`. |

## Example

```ts
import { KnowledgeSourceStore, SourceRetriever, SourceLifecycle } from './store.js';

const store = new KnowledgeSourceStore({ onDuplicate: 'skip' });
await store.ingestText('welcome', 'Hello from the engine!', { tags: ['greeting'] });
await store.ingestFile('readme', './README.md');

const retriever = new SourceRetriever(store);
const hits = retriever.search('hello engine', 5);
console.log(hits.results[0].source.id); // 'welcome'

const lifecycle = new SourceLifecycle(store);
lifecycle.on('prune', (removed) => console.log('pruned', removed.length));
await lifecycle.refresh('welcome');
lifecycle.prune(60_000);
```

## Files

| File | Purpose |
| --- | --- |
| `types.ts` | Domain types (`KnowledgeSource`, `SourceConfig`, `IngestResult`, …), constants and pure helpers. |
| `store.ts` | `KnowledgeSourceStore` registry + ingestion (`register`/`ingestText`/`ingestFile`/`ingestUrl`/`getContent`). |
| `index.ts` | `SourceIndex` — inverted indexes over kind, tag, MIME, name and id-prefix. |
| `retrieval.ts` | `SourceRetriever` — recent / byKind / byTags / search / random. |
| `lifecycle.ts` | `SourceLifecycle` — refresh / prune / ingest / events / periodic timer. |
| `integration.ts` | `KnowledgeSourceAdapter`, `createSourceAdapter`, `SourceRegistry`, `SourceStore` contract. |