# Costs

The Costs layer converts token usage into **monetary cost** using pricing
tables, and tracks spend per call, model, provider and session.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `CostRecord`, `CostConfig`, `CostStats`, `CostOptions`, `PricingTable`, currency helpers |
| `store.ts` | `CostStore`: record/get/delete/stats, incremental aggregates, capacity policy, JSON round-trip |
| `index.ts` | `CostIndex`: index by model/provider/session/date with sorted date buckets |
| `retrieval.ts` | `CostQuery`: total, byModel, byProvider, sessionCost, range, top, median, costPerThousandTokens |
| `lifecycle.ts` | `CostLifecycle`: prune, reset, periodic rollup, events |
| `integration.ts` | `CostCalculator`, `CostTracker` (begin/end sessions), `CostAdapter`, `createCostPipeline`, factories |

## Example

```ts
import { createCostTracker } from '@mam/observability';

const tracker = createCostTracker({
  pricing: {
    'gpt-4': { inputPer1k: 0.03, outputPer1k: 0.06 },
    'gpt-3.5-turbo': { inputPer1k: 0.001, outputPer1k: 0.002 },
  },
});

const handle = tracker.track('gpt-4', { sessionId: 's1' });
handle.inputTokens(120);
handle.outputTokens(300);
handle.finish(); // computes cost = 120/1000*0.03 + 300/1000*0.06

const total = tracker.total(); // currency + amount
const byModel = tracker.byModel();