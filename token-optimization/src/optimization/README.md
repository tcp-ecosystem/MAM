# Optimization

The Optimization layer orchestrates the full token-optimization pipeline.
`PromptOptimizer` takes a prompt (a list of `PromptSection`s) and either
**analyzes** it — estimating every section's token cost, computing the total,
flagging over-budget sections and producing actionable `suggestions` — or
**optimizes** it by applying the enabled strategies in canonical order:
`reorder` (priority, system first) → `compress` (filler words, redundant
whitespace) → `dedupe` (repeated blocks) → `truncate` (enforce the global
token ceiling). The result carries the optimized text, the token accounting
before/after, and which strategies actually applied.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `PromptSection`, `AnalysisResult`, `OptimizeResult`, `OptimizationConfig`, `OptimizeOptions`, `OptimizationStats`, guards + factories |
| `store.ts` | `OptimizationStore`: content-addressed result cache, LRU eviction, JSON round-trip |
| `index.ts` | `OptimizationIndex`: by strategy / savings bucket / section count |
| `retrieval.ts` | `PromptOptimizer`: `analyze`/`optimize`/`estimateTokens`/`reorderSections`/`savingsReport`, `section` |
| `lifecycle.ts` | `OptimizationLifecycle`: cache wiring, GC timer, stats, typed events |

## Example

```ts
import { PromptOptimizer, section, OptimizationLifecycle } from '@mam/token-optimization';

const optimizer = new PromptOptimizer({ maxTotalTokens: 256 });

const sections = [
  section('system', 'You are a concise, helpful assistant.', { priority: 10 }),
  section('user', 'Explain quantum computing simply. Be really thorough about superposition and entanglement.', { priority: 8 }),
  section('memory', 'Previous topics: algorithms, data structures, complexity theory.', { priority: 4 }),
];

// Analyze: no mutation, just measurements + advice.
const analysis = optimizer.analyze(sections);
analysis.totalTokens;         // sum across sections
analysis.perSection;          // per-section token counts
analysis.overBudget;          // section keys over their ceiling
analysis.suggestions;         // actionable strings

// Optimize: reorder, compress, dedupe, truncate to budget.
const result = optimizer.optimize(sections, { track: true });
result.optimizedText;         // the optimized prompt
result.savedTokens;           // tokens saved
result.savedPercent;          // savings percentage
result.applied;               // strategies that changed something
result.strategyDetails;       // per-strategy bookkeeping (opt-in)

// Human-readable report.
console.log(optimizer.savingsReport(result));

// Or wire the lifecycle for cache short-circuiting + GC.
const lifecycle = new OptimizationLifecycle({ maxTotalTokens: 256 }, { cacheCap: 128 });
const again = lifecycle.optimize(sections);   // second call short-circuits via cache
lifecycle.getFor(result.optimizedText);       // content-addressed lookup
lifecycle.stats();                            // lifetime counters
lifecycle.prune();                            // evict idle / LRU entries
```