# Evaluation

The Evaluation layer scores MAM outputs and runs **quality gates** — accuracy,
latency, cost and custom checks — with per-check pass/fail outcomes.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `EvaluationMetric`, `QualityGate`, `EvaluationCheck`, `EvaluationResult`, `EvaluationConfig`, `EvalOptions` |
| `store.ts` | `EvaluationStore`: record/get/delete/stats, listRecent, JSON round-trip |
| `index.ts` | `EvaluationIndex`: index by name/passed/date |
| `retrieval.ts` | `EvaluationQuery`: recent, byName, passed/failed, averageScore, best, trend |
| `lifecycle.ts` | `EvaluationLifecycle`: prune, reset, scheduled pruning, events |
| `integration.ts` | `Evaluator` (evaluate/gate), `EvaluationEngine` (runSuite, summary), `createEvaluator`/`createEvaluationEngine` |

## Example

```ts
import { createEvaluator, createEvaluationEngine } from '@mam/observability';

const evaluator = createEvaluator({
  gates: {
    accuracy: { min: 0.85 },
    latency: { max: 1000 },
  },
});

const result = evaluator.evaluate('accuracy', 0.92); // passed: true
const gate = evaluator.gate(result);

const engine = createEvaluationEngine();
const suite = engine.runSuite({
  accuracy: () => 0.92,
  latency: () => 98,
  cost: () => 0.004,
});
console.log(engine.summary(suite)); // { total, passed, averageScore, byName }