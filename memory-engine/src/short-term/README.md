# Short-term memory

The **working set** of an agent or runtime: facts, fragments and intermediate
products that are relevant *right now* and that should be allowed to decay once
they stop being useful.

Key properties:

- **Ephemeral** — entries may carry a TTL and expire automatically (`fixed`,
  `sliding`, or `persistent` retention).
- **Access-aware** — frequently-accessed entries rank higher and (with sliding
  retention) are kept alive longer.
- **Bounded** — the store enforces a `maxEntries` bound, evicting the
  least-recently-used entries when it is exceeded.
- **Scoped** — entries can be tagged and assigned to logical scopes so
  concurrent sessions or subsystems do not bleed into each other.

## Key classes

| Class | File | Purpose |
| --- | --- | --- |
| `ShortTermStore` | `store.ts` | In-memory persistence: put/get/peek/touch/update, TTL expiry, LRU eviction, prune/evict, toJSON/fromJSON |
| `ShortTermIndex` | `index.ts` | Inverted tag/scope + text index for O(matched) lookups |
| `ShortTermRetriever` | `retrieval.ts` | `recent`, `frequent`, `tagged`, `scoped`, `hybrid` scoring |
| `ShortTermLifecycle` | `lifecycle.ts` | Scheduled pruning, forced eviction, reset, events |
| `ShortTermRuntimeAdapter` | `integration.ts` | `RuntimeMemory` surface (async set/get/search/recall) |
| `ShortTermSession` | `integration.ts` | Namespaced per-session view over a shared store |

## Usage

```ts
import { ShortTermStore, ShortTermIndex, ShortTermRetriever } from './index.js';

const store = new ShortTermStore({ maxEntries: 1000 });
const index = new ShortTermIndex();
const retriever = new ShortTermRetriever(store, index);

const entry = store.put({
  id: 'draft:42',
  value: 'parser needs an EOF token',
  options: { ttlMs: 60_000, tags: ['draft'], scope: 'session:user-7' },
});
index.indexEntry(entry);

retriever.hybrid('EOF token', { tags: ['draft'] }); // scored, best first
```

## What each file is

| File | Responsibility |
| --- | --- |
| `types.ts` | `ShortTermEntry`, config, stats, TTL/retention model, `RuntimeMemory` contract |
| `store.ts` | The store plus tag/TTL normalisation helpers |
| `index.ts` | The tag/scope/text index |
| `retrieval.ts` | Recency/frequency/tag/hybrid ranking |
| `lifecycle.ts` | Timer-driven pruning, eviction, `'prune'`/`'evict'`/`'reset'` events |
| `integration.ts` | `ShortTermRuntimeAdapter`, `createShortTermAdapter`, `ShortTermSession`, `createWorkingMemory` |