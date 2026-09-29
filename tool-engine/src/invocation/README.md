# Invocation

The Invocation layer executes tool handlers with per-attempt timeouts, retries
with exponential backoff, an internal (or external) result cache and
mock-mode stand-ins — recording history and statistics for every invocation
that passes through it.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `InvocationRequest`, `InvocationResult`, `ExecutionRecord`, `RetryPolicy`, `InvocationConfig`, `TimeoutError`, `InvocationError` |
| `store.ts` | `InvocationStore`: bounded history + per-tool/aggregate statistics, `toJSON`/`fromJSON` |
| `index.ts` | `InvocationIndex`: record index by tool/ok/error/cache/mock |
| `retrieval.ts` | `ToolExecutor`: `execute` (never throws), `executeWithTimeout`, `retry`, recording |
| `lifecycle.ts` | `InvocationLifecycle`: history GC, `clearHistory`, `resetStats`, events |
| `integration.ts` | `ToolInvoker` (facade), `InvocationAdapter` (stable `ToolExecutor` contract), `createToolInvoker` |

## Example

```ts
import { createToolInvoker } from '@mam/tool-engine';

const invoker = createToolInvoker({ config: { timeoutMs: 1000 } });

const result = await invoker.invoke(
  { tool: 'math.add', params: { a: 1, b: 2 } },
  async ({ a, b }) => a + b,
);
if (result.ok) console.log(result.value); // 3

invoker.setTimeout(500);
invoker.setRetry({ maxRetries: 3, backoffMs: 50 });
invoker.enableCache();
invoker.mockTool('flaky', 'stubbed');     // deterministic stand-in

const cached = await invoker.invokeWithCache(
  { tool: 'math.add', params: { a: 1, b: 2 } },
  handler,
  externalCache,
);

const history = invoker.getExecutionHistory();
const stats = invoker.getStats();
```

`execute` never throws: handler failures, timeouts and retry exhaustion are all
folded into an `InvocationResult` with `ok: false`. The lower-level
`executeWithTimeout` and `retry` helpers throw, for callers that want
exceptions instead of result objects. Abort-style errors (the caller asked to
cancel) are never retried.