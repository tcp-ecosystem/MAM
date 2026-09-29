# Metrics

The Metrics layer collects **counters**, **gauges** and **histograms** for MAM
runtime activity — execution counts, latencies, throughput, queue depths.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `MetricType`, `MetricSample`, `Metric`, `MetricsConfig`, `MetricsStats`, `MetricOptions`, handles |
| `store.ts` | `MetricStore`: record/increment/decrement/set/sample, summaries (min/max/avg/stddev/percentiles), JSON round-trip |
| `index.ts` | `MetricIndex`: inverted index by name/type/label |
| `retrieval.ts` | `MetricQuery`: latest, range, byLabel, top, summary, aggregate |
| `lifecycle.ts` | `MetricLifecycle`: prune, reset, periodic rollup, events |
| `integration.ts` | `MetricsRegistry` (counter/gauge/histogram handles), `MetricsAdapter`, Prometheus export, factories |

## Example

```ts
import { createMetricsRegistry, MetricQuery } from '@mam/observability';

const registry = createMetricsRegistry();
const calls = registry.counter('executions');
calls.increment();
const latency = registry.histogram('latency_ms');
latency.observe(125);

const query = new MetricQuery(registry);
const summary = query.summary('latency_ms'); // count/min/max/avg/p95