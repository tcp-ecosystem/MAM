# MAM Token Optimization Engine

Standalone MAM token-optimization engine: **Estimation**, **Budgeting**,
**Compression**, **Caching** and **Optimization** layers. A dependency-free
pipeline that plans, budgets, shrinks, reuses and re-packs the token footprint
of prompts — from a heuristic tokenizer up to a full prompt-optimization
orchestrator.

## Overview

The token-optimization engine keeps prompts inside a model's context window
without calling an LLM. Each layer solves one problem and exposes a small,
ergonomic integration surface:

- **Estimation** is the measurement primitive: `TokenEstimator` converts text
  into a `TokenEstimate` using cheap deterministic heuristics (chars-per-token
  by model family, with a word-based fallback), supports length-based
  calibration and `calibrate` teaches it the *true* ratio from
  `(text, actualTokens)` samples. `EstimateStore` caches estimates and
  `EstimationLifecycle` adds GC + events.
- **Budgeting** decides *how many tokens each prompt section may consume*:
  `BudgetAllocator` grants, trims or rejects requests against
  `SectionAllocation` ceilings, honours the global `maxTotal` ceiling, and
  `fit` truncates text at a word boundary to a token budget.
  `AllocationStore` is the ledger, `BudgetingLifecycle` adds snapshots + events.
- **Compression** reduces the token footprint deterministically: `TokenCompressor`
  applies five techniques in a fixed order — collapse-whitespace, dedupe-blocks,
  trim-stopwords, abbreviate and truncate-to-tokens — and reports per-technique
  and aggregate savings via a `CompressionResult`. `CompressionStore` caches
  results, `CompressionLifecycle` adds GC + events.
- **Caching** models *prompt-prefix and section caching*: `CacheManager` stores
  reusable `CachedSegment`s, serves exact/prefix `lookup` hits (reporting the
  tokens saved), computes multi-turn `prefixScore` (longest-common-prefix +
  stability) and `evict`s cold/large segments first. `CacheSegmentStore` is the
  registry, `CachingLifecycle` adds a TTL sweep + events.
- **Optimization** orchestrates the whole pipeline: `PromptOptimizer.analyze`
  estimates every `PromptSection`, flags over-budget sections and produces
  suggestions; `optimize` applies reorder → compress → dedupe → truncate in
  canonical order and returns an `OptimizeResult` with token accounting and a
  `savingsReport`. `OptimizationStore` content-addresses results,
  `OptimizationLifecycle` wires cache + GC + events.

Every layer is organised in the same five-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms) and `lifecycle` (the operational facade).

## Architecture

```
Token Optimization (@mam/token-optimization)
├── Estimation   src/estimation/     TokenEstimator, EstimateStore, EstimateIndex, EstimationLifecycle
├── Budgeting    src/budgeting/      BudgetAllocator, AllocationStore, AllocationIndex, BudgetingLifecycle
├── Compression  src/compression/    TokenCompressor, CompressionStore, CompressionIndex, CompressionLifecycle
├── Caching      src/caching/        CacheManager, CacheSegmentStore, CacheIndex, CachingLifecycle
└── Optimization src/optimization/   PromptOptimizer, OptimizationStore, OptimizationIndex, OptimizationLifecycle
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  TokenEstimator,
  BudgetAllocator,
  TokenCompressor,
  CacheManager,
  PromptOptimizer,
} from '@mam/token-optimization';
```

## Quick start

```ts
import { PromptOptimizer, section } from '@mam/token-optimization';

// 1. Build a prompt from sections.
const sections = [
  section('system', 'You are a concise, helpful assistant.', { priority: 10 }),
  section('user', 'Explain quantum computing simply. Please be really thorough about superposition and entanglement.', { priority: 8 }),
  section('memory', 'Previous topics: algorithms, data structures, complexity theory.', { priority: 4 }),
];

// 2. Analyze: how many tokens does the prompt cost?
const optimizer = new PromptOptimizer({ maxTotalTokens: 128 });
const analysis = optimizer.analyze(sections);
analysis.totalTokens;        // estimated tokens across every section
analysis.perSection;         // per-section breakdown (keyed by id or role:index)
analysis.overBudget;         // section keys that blew their ceiling
analysis.suggestions;        // actionable advice

// 3. Optimize: reorder, compress, dedupe, truncate to the budget.
const result = optimizer.optimize(sections);
result.optimizedText;        // the optimized prompt, ready to send
result.originalTokens;       // tokens before
result.optimizedTokens;      // tokens after
result.savedTokens;          // tokens saved
result.savedPercent;         // savings as a percentage
result.applied;              // which strategies actually changed something

// 4. Render a human-readable report.
console.log(optimizer.savingsReport(result));
```

## Commands

```sh
pnpm install                                  # install all workspace packages
pnpm --filter @mam/token-optimization build   # compile src/ -> dist/ (tsc)
pnpm --filter @mam/token-optimization test    # run the vitest suite
pnpm --filter @mam/token-optimization typecheck  # tsc --noEmit
pnpm --filter @mam/token-optimization clean   # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Estimation | `types.ts` | `TokenEstimate`, `ModelProfile`, `EstimationConfig`, `MODEL_PROFILES`, guards + factories |
| | `store.ts` | `EstimateStore`: content-addressed estimate cache, LRU eviction, JSON round-trip |
| | `index.ts` | `EstimateIndex`: by model / length bucket / method |
| | `retrieval.ts` | `TokenEstimator`: `estimate`/`estimateMany`/`calibrate`/`charsPerToken` |
| | `lifecycle.ts` | `EstimationLifecycle`: prune, GC timer, typed events |
| Budgeting | `types.ts` | `SectionAllocation`, `BudgetConfig`, `AllocationResult`, `FitResult`, guards + factories |
| | `store.ts` | `AllocationStore`: section ledger, allocate/release/reserve, JSON round-trip |
| | `index.ts` | `AllocationIndex`: by under/near/over status |
| | `retrieval.ts` | `BudgetAllocator`: `check`/`allocate`/`fit`/`overall`/`available` |
| | `lifecycle.ts` | `BudgetingLifecycle`: snapshots, prune, typed events |
| Compression | `types.ts` | `CompressionResult`, `CompressConfig`, `TokenCounter`, `TECHNIQUES`, guards + factories |
| | `store.ts` | `CompressionStore`: content-addressed result cache, LRU, JSON round-trip |
| | `index.ts` | `CompressionIndex`: by technique / savings bucket |
| | `retrieval.ts` | `TokenCompressor`: `compress`, five deterministic techniques |
| | `lifecycle.ts` | `CompressionLifecycle`: prune, GC timer, typed events |
| Caching | `types.ts` | `CachedSegment`, `CacheConfig`, `CacheHit`, `CacheDecision`, guards + factories |
| | `store.ts` | `CacheSegmentStore`: segment registry, recordHit/touch/prune, JSON round-trip |
| | `index.ts` | `CacheIndex`: by model / length bucket / hits |
| | `retrieval.ts` | `CacheManager`: `lookup`/`cache`/`prefixScore`/`evict` |
| | `lifecycle.ts` | `CachingLifecycle`: TTL sweep, prune, typed events |
| Optimization | `types.ts` | `PromptSection`, `AnalysisResult`, `OptimizeResult`, `OptimizationConfig`, guards + factories |
| | `store.ts` | `OptimizationStore`: content-addressed result cache, LRU, JSON round-trip |
| | `index.ts` | `OptimizationIndex`: by strategy / savings bucket / section count |
| | `retrieval.ts` | `PromptOptimizer`: `analyze`/`optimize`/`reorderSections`/`savingsReport` |
| | `lifecycle.ts` | `OptimizationLifecycle`: cache wiring, GC timer, stats |

## Per-layer docs

- [`src/estimation/README.md`](src/estimation/README.md)
- [`src/budgeting/README.md`](src/budgeting/README.md)
- [`src/compression/README.md`](src/compression/README.md)
- [`src/caching/README.md`](src/caching/README.md)
- [`src/optimization/README.md`](src/optimization/README.md)