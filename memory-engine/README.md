# @mam/memory-engine

Standalone MAM Memory Engine. A dependency-free, in-memory multi-layer memory
system for agents and runtimes, packaged as its own workspace package so any MAM
component (or any external project) can embed it.

```
                    ┌─────────────────────────────┐
                    │        Memory Engine        │
                    │         (src/index.ts)      │
                    └─────────────┬───────────────┘
                                  │
        ┌──────────────┬──────────┼──────────┬──────────────┐
        ▼              ▼          ▼          ▼              ▼
 ┌─────────────┐ ┌────────────┐ ┌─────────┐ ┌──────────┐
 │ Short-term  │ │ Long-term  │ │Episodic │ │ Semantic │
 │ (working    │ │ (durable   │ │(recorded│ │ (facts & │
 │  set, TTL,  │ │ facts,     │ │ experi- │ │  knowledge│
 │  LRU, scope)│ │ importance)│ │ ences)  │ │  TF-IDF) │
 └─────────────┘ └────────────┘ └─────────┘ └──────────┘
```

Each layer follows the same architecture — **store** (persistence), **index**
(lookup acceleration), **retriever** (ranking/filtering), **lifecycle**
(maintenance: prune/expire/consolidate) and an **integration adapter** that
implements a uniform `RuntimeMemory` key/value contract so the four layers can
be swapped behind one consumer.

## Layers

| Layer | Package dir | What it stores | Core class |
| --- | --- | --- | --- |
| Short-term | `src/short-term/` | Ephemeral working set with TTL expiry, LRU eviction, tags, scopes | `ShortTermStore` |
| Long-term | `src/long-term/` | Durable, importance-scored, taggable records with file persistence | `LongTermStore` |
| Episodic | `src/episodic/` | Discrete experiences with ordered event timelines and outcomes | `EpisodicStore` |
| Semantic | `src/semantic/` | Timeless facts/knowledge with built-in TF-IDF vector retrieval | `SemanticStore` |

## Quick start

```ts
import { createShortTermAdapter, createSemanticAdapter } from '@mam/memory-engine';

// A bounded working-memory adapter with automatic pruning.
const working = createShortTermAdapter(
  { maxEntries: 500, defaultTtlMs: 60_000 },
  { lifecycle: true },
);
await working.set('current-goal', 'ship the parser', { tags: ['goal'] });
await working.recall('goal'); // scored working-set hits

// A semantic knowledge base over the same package.
const kb = createSemanticAdapter();
await kb.set('db', 'the database is postgres 16', { tags: ['infra'] });
kb.search('postgres'); // TF-IDF cosine hits
```

## Commands

From the repo root:

```bash
pnpm install                          # link the workspace package
pnpm --filter @mam/memory-engine build     # compile src -> dist (tsc)
pnpm --filter @mam/memory-engine test      # run the vitest suite
pnpm --filter @mam/memory-engine typecheck # type-check without emitting
pnpm --filter @mam/memory-engine clean     # remove dist/
```

## Files per layer

Every layer ships the same six files:

| File | Responsibility |
| --- | --- |
| `types.ts` | Domain types, config, stats and result shapes |
| `store.ts` | In-memory persistence and CRUD |
| `index.ts` | Index class for accelerated lookups |
| `retrieval.ts` | Ranking / filtering entry points |
| `lifecycle.ts` | Prune, expiry, consolidation and events |
| `integration.ts` | `RuntimeMemory` adapter + factories |

See the per-layer READMEs under `src/<layer>/README.md` for details and usage
examples.

## Tests

The test suite lives in `tests/` and mirrors the four layers:

- `tests/short-term.test.ts`
- `tests/long-term.test.ts`
- `tests/episodic.test.ts`
- `tests/semantic.test.ts`

Run them with `pnpm --filter @mam/memory-engine test`.