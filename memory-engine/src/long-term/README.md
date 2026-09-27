# Long-term memory

Durable, taggable, importance-scored memory that **survives process restarts**.
The layer is intentionally dependency-free (Node built-ins only) and can be
backed by a JSON file on disk via atomic write-temp-then-rename persistence.

Key properties:

- **Durable** — `persist()` / `load()` round-trip the whole store through a
  JSON snapshot; an optional lifecycle auto-persists on a cadence.
- **Importance-scored** — every entry can carry an importance in `[0, 1]` so
  retrieval and pruning can treat precious memories specially.
- **Tagged & attributed** — free-form tags and a `source` string power the tag
  and source indexes.
- **Soft delete** — archived entries stay on disk but drop out of normal
  retrieval until un-archived.

## Key classes

| Class | File | Purpose |
| --- | --- | --- |
| `LongTermStore` | `store.ts` | In-memory + file-backed CRUD, archive/unarchive, getByTag/getByImportance, persist/load |
| `LongTermIndex` | `index.ts` | Inverted tag/importance/source/date indexes + ordered date scans |
| `LongTermRetriever` | `retrieval.ts` | `recent`, `important`, `tagged`, `source`, `dateRange`, `hybrid` |
| `LongTermLifecycle` | `lifecycle.ts` | Auto-persist timer, prune, archiveOld, consolidate, events |
| `LongTermRuntimeAdapter` | `integration.ts` | `RuntimeMemory` surface plus `search` / `recall` / `persist` |
| `LongTermRepository` | `integration.ts` | Higher-level knowledge base (`remember` / `recall` / `snapshot`) |

## Usage

```ts
import { createLongTermAdapter } from './integration.js';

const memory = createLongTermAdapter({ persistPath: './memories.json' });
memory.set('goal', 'ship the parser', { tags: ['goal'], importance: 0.9 });
memory.recall('what should I ship?'); // scored hits
await memory.persist();
```

## What each file is

| File | Responsibility |
| --- | --- |
| `types.ts` | Entry/config/stats types, JSON round-tripping, pure helpers |
| `store.ts` | The store plus snapshot persistence |
| `index.ts` | The inverted + ordered index |
| `retrieval.ts` | Ranked retrievals and the hybrid scorer |
| `lifecycle.ts` | Persistence scheduling, pruning, consolidation, events |
| `integration.ts` | `LongTermRuntimeAdapter`, `createLongTermAdapter`, `LongTermRepository` |