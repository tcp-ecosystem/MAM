# Traces

The Traces layer records **spans** and reconstructs full **traces** for MAM
workflow executions. Every run, retry and sub-step can be instrumented and
queries for slowest calls, error paths, or per-service breakdowns.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `TraceSpan`, `Trace`, `TraceConfig`, `TraceStats`, `SpanOptions`, `TraceEvent`, event types |
| `store.ts` | `TraceStore`: record/get/delete/has/keys/clear/size/stats, lists, JSON round-trip |
| `index.ts` | `TraceIndex`: inverted index by traceId/service/name/status |
| `retrieval.ts` | `TraceQuery`: trace tree rebuild, recent/byService/byStatus/slowest/errors |
| `lifecycle.ts` | `TraceLifecycle`: prune, completeSpan, reset, scheduled pruning, events |
| `integration.ts` | `TraceRecorder`, `TraceAdapter`, `Tracer` (startSpan/endSpan/trace), factories |

## Example

```ts
import { createTracer, TraceQuery } from '@mam/observability';

const tracer = createTracer();
const result = tracer.trace('agent.run', () => {
  const span = tracer.startSpan('tool.call', { service: 'search' });
  // ... work ...
  tracer.endSpan(span);
  return 'done';
});

const query = new TraceQuery(tracer); // or a store you supply
const slowest = query.slowest(5);
const errors = query.errors(10);