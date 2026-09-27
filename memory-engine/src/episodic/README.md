# Episodic memory

Discrete, **situated experiences** — self-contained units of lived time in
which actors perform actions, observe outcomes, and leave behind an audit trail
of ordered events. Unlike semantic memory (timeless facts), episodic memory is
anchored to a window of time, a set of participants, and a sequence of causally
ordered events.

Key properties:

- **Event timelines** — every episode is an ordered list of `EpisodeEvent`s
  (actor + action + optional payload/outcome + timestamp).
- **Outcomes** — episodes and individual events can carry `success` / `failure`
  / `partial` / `aborted` / `unknown` outcomes.
- **Faceted retrieval** — episodes are indexed by actor, action, tag, outcome
  and date range.
- **Curatable** — the lifecycle prunes, consolidates, summarises and trims
  episodes so memory does not grow without bound.

## Key classes

| Class | File | Purpose |
| --- | --- | --- |
| `EpisodicStore` | `store.ts` | Record/append events/set outcome, consolidate, toJSON/fromJSON |
| `EpisodicIndex` | `index.ts` | Inverted actor/action/tag/outcome indexes + ordered date index |
| `EpisodicRetriever` | `retrieval.ts` | `recent`, `byActor`, `byAction`, `byOutcome`, `timeline`, `pattern`, `recall` |
| `EpisodicLifecycle` | `lifecycle.ts` | `prune`, `consolidate`, `summarizeEpisode`, `trim` + events |
| `EpisodicRuntimeAdapter` | `integration.ts` | `RuntimeMemory` surface plus `record` / `search` / `recall` |
| `EpisodeRecorder` | `integration.ts` | Fluent builder: `named().actor().act().finish().tag()` |

## Usage

```ts
import { createEpisodicAdapter, EpisodeRecorder } from './integration.js';

const adapter = createEpisodicAdapter();
new EpisodeRecorder('ep-1')
  .named('Checkout attempt')
  .actor('alice')
  .act('search', { query: 'socks' })
  .act('add_to_cart')
  .finish('success')
  .tag('checkout')
  .record(adapter);

adapter.recall('alice checked out'); // ranked EpisodeHits
```

## What each file is

| File | Responsibility |
| --- | --- |
| `types.ts` | `Episode`, `EpisodeEvent`, stats, config, `RuntimeMemory` contract |
| `store.ts` | The store plus episode normalisation helpers |
| `index.ts` | The inverted facet indexes |
| `retrieval.ts` | Facet/timeline/pattern/recall retrieval |
| `lifecycle.ts` | Prune, consolidate, summarise, trim + emitter |
| `integration.ts` | `EpisodicRuntimeAdapter`, `createEpisodicAdapter`, `EpisodeRecorder` |