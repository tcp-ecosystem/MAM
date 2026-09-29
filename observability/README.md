# MAM Observability

Standalone, production-grade observability engine for the MAM ecosystem. It
records and queries **traces**, **metrics**, **token usage**, **costs** and
**evaluation** results across all of MAM's runtime activity.

Zero external dependencies — pure TypeScript on Node built-ins (`node:events`,
`node:crypto`, `node:fs/promises`).

## Architecture

```
Observability
├── Traces      spans + distributed trace reconstruction, service/status queries
├── Metrics     counters, gauges, histograms with summaries and percentiles
├── Token usage input/output token accounting per model, provider, session
├── Costs       cost accounting from token counts + pricing tables, per call/session
└── Evaluation  scored checks, quality gates and aggregate evaluation suites
```

Each layer follows the same structure: `types.ts`, `store.ts`, `index.ts`,
`retrieval.ts`, `lifecycle.ts`, `integration.ts`.

| Layer | Files | Line count |
|-------|-------|-----------:|
| Traces | `src/traces/*` | 424–726 |
| Metrics | `src/metrics/*` | 408–814 |
| Token usage | `src/token-usage/*` | 474–649 |
| Costs | `src/costs/*` | 350–905 |
| Evaluation | `src/evaluation/*` | 317–613 |

## Quick start

```ts
import {
  Tracer, TraceQuery, TraceStore,
  MetricsRegistry,
  TokenUsageTracker,
  CostCalculator, CostTracker,
  Evaluator, EvaluationEngine,
} from '@mam/observability';

// Traces
const tracer = createTracer();
tracer.trace('agent.run', () => { /* work */ });
const traces = new TraceQuery(new TraceStore()); // or tracer's store

// Metrics
const registry = createMetricsRegistry();
const latency = registry.histogram('latency_ms');
latency.observe(125);

// Token usage + Costs
const usage = createTokenUsageTracker();
usage.record('gpt-4', 120, 300, { sessionId: 's1' });
const calculator = new CostCalculator({ pricing: { 'gpt-4': { inputPer1k: 0.03, outputPer1k: 0.06 } } });
const tracker = createCostTracker({ calculator });

// Evaluation
const evaluator = createEvaluator();
const result = evaluator.evaluate('accuracy', 0.92);
const engine = createEvaluationEngine();
const suite = engine.runSuite({ accuracy: () => 0.92, latency: () => 98 });
```

## Commands

```bash
pnpm --filter @mam/observability build        # compile to dist/
pnpm --filter @mam/observability test         # vitest suite
pnpm --filter @mam/observability typecheck    # tsc --noEmit
```

## Tests

Test suites in `tests/` cover each layer's store, index, query, lifecycle and
integration adapters.

## License

MIT