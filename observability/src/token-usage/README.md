# Token usage

The Token usage layer accounts for **input/output tokens** per model, provider,
session and call — the raw unit behind cost tracking.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `TokenUsageRecord`, `TokenBudget`, `TokenUsageConfig`, `TokenUsageStats`, `TokenTotals` |
| `store.ts` | `TokenUsageStore`: record/get/delete/stats, totals per model/provider, JSON round-trip |
| `index.ts` | `TokenUsageIndex`: index by model/provider/session/date |
| `retrieval.ts` | `TokenUsageQuery`: totalsByModel/Provider, sessionUsage, range, budgetUsage |
| `lifecycle.ts` | `TokenUsageLifecycle`: prune, reset, periodic rollup, events |
| `integration.ts` | `TokenUsageCollector`, `TokenUsageTracker` (session-scoped), `TokenUsageAdapter`, factories |

## Example

```ts
import { createTokenUsageTracker, createTokenUsageQuery } from '@mam/observability';

const tracker = createTokenUsageTracker();
tracker.record('gpt-4', 120, 300, { sessionId: 's1' });

const query = createTokenUsageQuery(tracker);
const totals = query.totalsByModel(); // gpt-4 => { input: 120, output: 300, total: 420 }
const budget = query.budgetUsage({ inputLimit: 100000, outputLimit: 100000 }); // percent consumed