# Prioritization

The Prioritization layer scores and orders context parts by **importance** —
recency, relevance to the active query, role weight and size — then selects
the top-K or whatever fits a token budget.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `ContextPart`, `PriorityScore`, `PriorityEntry`, `PrioritizationConfig`, `PrioritizeOptions`, `PrioritizationStats`, defaults + helpers |
| `store.ts` | `PriorityStore`: cache of scored entries (lowest-score evicts over cap), JSON round-trip |
| `index.ts` | `PriorityIndex`: score-bucket + role secondary indexes |
| `retrieval.ts` | `PriorityScorer`: `scorePart` (weighted recency + relevance + role + size), `prioritize`, `topK`, `withinBudget` |
| `lifecycle.ts` | `PriorityLifecycle`: TTL + cap pruning, `clearPart`, `reset`, start/stop |
| `integration.ts` | `Prioritizer` (`run`/`best`/`fitBudget`), `createPrioritizer`, `PrioritizationAdapter` |

## Example

```ts
import { createPrioritizer } from '@mam/context-engine';

const prioritizer = createPrioritizer();
const parts = [
  { partId: 'p1', content: 'onboarding flow steps and welcome email', role: 'system', createdAt: Date.now() },
  { partId: 'p2', content: 'unrelated note about groceries', role: 'user', createdAt: Date.now() - 100000 },
];

const ranked = prioritizer.run(parts, { query: 'onboarding' });
const best = prioritizer.best(parts, 1, { query: 'onboarding' });
const fitted = prioritizer.fitBudget(parts, 1024, { query: 'onboarding' });