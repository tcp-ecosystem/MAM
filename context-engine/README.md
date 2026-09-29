# MAM Context Engine

Standalone MAM Context Engine: **Context Assembly**, **Token Budgeting**,
**Compression**, **Summarization** and **Prioritization** layers. A
dependency-free, deterministic engine that takes raw context inputs and
produces a single, budget-aware, model-ready prompt.

## Overview

The Context Engine is the final gateway between an agent's raw inputs and the
model prompt. Each layer solves one problem and exposes a small, ergonomic
integration surface:

- **Context Assembly** turns a pile of possibly-redundant, out-of-order parts
  (system instructions, user turns, tool results, memory, knowledge, examples)
  into one deduplicated, ordered, budget-aware prompt string.
- **Token Budgeting** decides how much of the context window each section may
  use, tracks used/reserved tokens per section, and trims or rejects overruns.
- **Compression** shrinks context text deterministically (no LLM) via
  whitespace collapsing, block deduplication, markdown stripping, keyword
  extraction and hard truncation.
- **Summarization** distils long sections into extractive summaries, keyword
  digests or rolling "summary of summaries" — deterministic, reproducible.
- **Prioritization** ranks context parts/items by salience so only the most
  important content survives to the prompt.

Every layer is organised in the same five-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms), `lifecycle` (housekeeping) and `integration` (the facade you
actually call).

> **Status:** the Context Assembly, Token Budgeting, Compression and
> Summarization layers are implemented in this checkout. The Prioritization
> layer is part of the intended architecture but not yet present under
> `src/prioritization/`, so it has no barrel exports, README or tests yet.

## Architecture

```
Context Engine (@mam/context-engine)
├── Context Assembly        src/context-assembly/    ContextAssembler, ContextPipeline
├── Token Budgeting         src/token-budgeting/     TokenBudgeter, BudgetManager
├── Compression             src/compression/         Compressor, TextCompressor
├── Summarization           src/summarization/       Summarizer, TextSummarizer
└── Prioritization          src/prioritization/      Prioritizer, PriorityScorer
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  createContextAssembler, ContextPipeline,
  createTokenBudgeter, TokenBudgeter,
  createCompressor, Compressor,
  createSummarizer, Summarizer,
} from '@mam/context-engine';
```

## Quick start

```ts
import { ContextPipeline, createTokenBudgeter, createSummarizer } from '@mam/context-engine';

// Assemble a prompt from parts.
const pipeline = new ContextPipeline({ assemblyConfig: { maxTokens: 4096 } });
const result = pipeline.run([
  { id: 's', role: 'system', content: 'Be concise.' },
  { id: 'k', role: 'knowledge', content: 'Docs: v2 changes.', tags: ['docs'] },
  { id: 'u', role: 'user', content: 'Summarise the changes.' },
]);
console.log(result.prompt);

// Budget the sections of the prompt.
const budgeter = createTokenBudgeter({ perSection: { knowledge: 2000 } });
const fitted = budgeter.fit(longKnowledge, 'knowledge');
budgeter.allocate('knowledge', fitted.tokens);

// Summarise a section that is too long to keep verbatim.
const summarizer = createSummarizer({ maxSentences: 3 });
const digest = summarizer.summarizeToLength(longMemory, 512);
```

## Commands

```sh
pnpm install                          # install all workspace packages
pnpm --filter @mam/context-engine build       # compile src/ -> dist/ (tsc)
pnpm --filter @mam/context-engine test        # run the vitest suite
pnpm --filter @mam/context-engine typecheck   # tsc --noEmit
pnpm --filter @mam/context-engine clean       # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Context Assembly | `types.ts` | `ContextPart`, `AssembledContext`, role constants, part factories, `estimateTokens` |
| | `store.ts` | `ContextAssemblyStore`: part registry, CRUD, filters, JSON round-trip |
| | `index.ts` | `AssemblyIndex`: by role/source/tag, composite `query` |
| | `retrieval.ts` | `ContextAssembler`: collect, dedupe, order, budget, render |
| | `lifecycle.ts` | `AssemblyLifecycle`: refresh tracking, TTL prune, events |
| | `integration.ts` | `ContextAssemblerAdapter`, `ContextPipeline`, `createContextAssembler` |
| Token Budgeting | `types.ts` | `SectionBudget`, `TokenBudgetConfig`, `BudgetAllocation`, helpers |
| | `store.ts` | `TokenBudgetStore`: allocate/release/reserve, events, JSON round-trip |
| | `index.ts` | `BudgetIndex`: status buckets (`ok`/`warn`/`critical`/`over`) |
| | `retrieval.ts` | `BudgetManager`: `check`, `trim`, `overall`, `available` |
| | `lifecycle.ts` | `BudgetLifecycle`: bounded table pruning, GC passes |
| | `integration.ts` | `TokenBudgeter`, `BudgetAdapter`, `createTokenBudgeter` |
| Compression | `types.ts` | `CompressionResult`, `CompressionConfig`, `CompressOptions`, ratio helpers |
| | `store.ts` | `CompressionStore`: keyed result cache, eviction, JSON round-trip |
| | `index.ts` | `CompressionIndex`: by technique and ratio bucket |
| | `retrieval.ts` | `TextCompressor`: collapse, dedupe, strip-markdown, keywords, truncate |
| | `lifecycle.ts` | `CompressionLifecycle`: bounded cache pruning |
| | `integration.ts` | `Compressor`, `CompressionAdapter`, `createCompressor` |
| Summarization | `types.ts` | `SummaryResult`, `SummarizationConfig`, `KeyPoint`, factories |
| | `store.ts` | `SummarizationStore`: LRU result cache, counters, JSON round-trip |
| | `index.ts` | `SummarizationIndex`: by technique and length bucket |
| | `retrieval.ts` | `TextSummarizer`: extractive, keywords, rolling, key points |
| | `lifecycle.ts` | `SummarizationLifecycle`: least-valuable-result pruning |
| | `integration.ts` | `Summarizer`, `SummarizationAdapter`, `createSummarizer` |