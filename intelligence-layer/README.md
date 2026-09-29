# MAM Intelligence Engine

Standalone MAM intelligence engine: **Query understanding**, **Grounding**,
**Synthesis**, **Knowledge graph** and **Integration** layers. A
dependency-free pipeline that turns a raw user query into a grounded,
cited, consolidated answer — from intent classification and evidence scoring
up to canonical knowledge-base fusion.

## Overview

The intelligence engine answers a full question-answering loop without an
LLM. Each layer solves one problem and exposes a small, ergonomic integration
surface:

- **Query understanding** is the first stage: `QueryAnalyzer` turns a
  free-text query into a structured `QueryAnalysis` — normalised text,
  a classified `QueryIntent` (factoid / howto / comparison / exploration /
  summarization), salient extracted terms, synonym/thesaurus expansion,
  sub-query decomposition, entity candidates and a language guess.
  `QueryStore` caches analyses by content address and `QueryIndex` answers
  "which past queries were about intent X / term Y". `QueryLifecycle`
  curates the cache and orchestrates the pipeline.
- **Grounding** decides whether a claim is supported by evidence:
  `GroundednessScorer` tokenizes a claim and a pool of `EvidenceChunk`s,
  scores every chunk with a Dice overlap, combines best-chunk overlap with
  claim vocabulary coverage, and returns a `GroundedClaim` with citations and
  `unmatchedTerms` — the strongest hallucination signal. `GroundingStore`
  caches verdicts, `GroundingIndex` navigates them by source / support /
  term, `GroundingLifecycle` adds retention + events.
- **Synthesis** turns evidence into prose: `AnswerSynthesizer` ranks
  `EvidencePart`s, extracts sentences with an abbreviation-aware splitter,
  scores them against the query, dedupes near-duplicates, fuses them into
  coherent paragraphs and returns an `Answer` with `parts`, `citations` and a
  weighted `confidence` plus a `grounded` flag. `SynthesisStore` caches
  answers, `SynthesisIndex` navigates them, `SynthesisLifecycle` manages
  retention.
- **Knowledge graph** is the engine's durable memory: `GraphEngine` extracts
  typed `GraphEntity` candidates and raw `Triplet`s from text with heuristic
  patterns and a shallow SVO grammar, ingests triplets via `addTriplet`
  (merging aliases, bumping mention counts), and traverses the graph with
  `query`, `paths`, `shortestPath` and `degreeCentrality`. `GraphStore` is
  the adjacency-backed registry, `GraphIndex` resolves names/types/
  predicates, `GraphLifecycle` prunes least-connected and stale entities.
- **Integration** makes many sources one coherent body of facts:
  `Consolidator` filters low-confidence `KnowledgeEntry`s, dedupes
  near-duplicates, detects contradictions (`Conflict`s with human-readable
  reasons), merges compatible entries into canonical forms and caps the
  result. `KnowledgeStore` is the registry, `KnowledgeIndex` navigates it,
  `IntegrateLifecycle` owns ingestion + consolidation + retention.

Every layer is organised in the same five-part shape: `types` (the contract),
`store` (the state), `index` (denormalised lookups), `retrieval` (the
algorithms) and `lifecycle` (the operational facade).

## Architecture

```
Intelligence (@mam/intelligence-layer)
├── Query understanding src/query/        QueryAnalyzer, QueryStore, QueryIndex, QueryLifecycle
├── Grounding         src/grounding/      GroundednessScorer, GroundingStore, GroundingIndex, GroundingLifecycle
├── Synthesis         src/synthesis/      AnswerSynthesizer, SynthesisStore, SynthesisIndex, SynthesisLifecycle
├── Knowledge graph   src/graph/          GraphEngine, GraphStore, GraphIndex, GraphLifecycle
└── Integration       src/integration/    Consolidator, KnowledgeStore, KnowledgeIndex, IntegrateLifecycle
```

Each layer exposes its public surface from the package barrel:

```ts
import {
  QueryAnalyzer,
  GroundednessScorer,
  AnswerSynthesizer,
  GraphEngine,
  Consolidator,
} from '@mam/intelligence-layer';
```

## Quick start

A full pipeline: analyse the query, ground the retrieved claims, synthesize
the answer.

```ts
import {
  QueryAnalyzer,
  GroundednessScorer,
  AnswerSynthesizer,
} from '@mam/intelligence-layer';

// 1. Understand the query.
const analyzer = new QueryAnalyzer();
const analysis = analyzer.analyze('How do I configure TLS in Postgres?');
analysis.intent;   // 'howto'
analysis.terms;    // ['configure', 'postgres', 'tls'] (ranked)
analysis.subQueries; // undefined (atomic query)

// 2. Ground the candidate claims against retrieved evidence.
const scorer = new GroundednessScorer({ minScore: 0.55 });
const grounded = scorer.ground(
  'TLS is enabled in Postgres via ssl = on in postgresql.conf',
  [
    {
      id: 'docs/postgres-tls.md#l12',
      text: 'Set ssl = on in postgresql.conf to enable TLS for Postgres.',
      source: 'docs/postgres-tls.md',
    },
  ],
);
grounded.supported;      // true
grounded.citations;      // ['[docs/postgres-tls.md: docs/postgres-tls.md#l12]']
grounded.unmatchedTerms; // []

// 3. Synthesize a cited answer from the evidence pool.
const synthesizer = new AnswerSynthesizer({ style: 'balanced' });
const answer = synthesizer.synthesize({
  query: analysis.original,
  evidence: [
    {
      id: 'docs/postgres-tls.md#l12',
      text: 'Set ssl = on in postgresql.conf to enable TLS for Postgres.',
      source: 'docs/postgres-tls.md',
    },
  ],
});
answer.text;       // the assembled prose
answer.citations;  // de-duplicated citation set
answer.confidence; // 0..1
answer.grounded;   // whether it cleared the minimum score
```

## Commands

```sh
pnpm install                                    # install all workspace packages
pnpm --filter @mam/intelligence-layer build     # compile src/ -> dist/ (tsc)
pnpm --filter @mam/intelligence-layer test      # run the vitest suite
pnpm --filter @mam/intelligence-layer typecheck # tsc --noEmit
pnpm --filter @mam/intelligence-layer clean     # rm -rf dist
```

## Layer file table

| Layer | File | Contents |
|-------|------|----------|
| Query understanding | `types.ts` | `QueryAnalysis`, `QueryIntent`, `AnalysisConfig`, `QUERY_INTENTS`, guards + factories |
| | `store.ts` | `QueryStore`: content-addressed analysis cache, LRU eviction, JSON round-trip |
| | `index.ts` | `QueryIndex`: by intent / term, `findByTerm`/`findByTerms` |
| | `retrieval.ts` | `QueryAnalyzer`: `analyze`/`classifyIntent`/`extractTerms`/`expand`/`decompose` |
| | `lifecycle.ts` | `QueryLifecycle`: process, prune, GC timer, typed events |
| Grounding | `types.ts` | `GroundedClaim`, `GroundingResult`, `GroundingConfig`, `EvidenceChunk`, guards + factories |
| | `store.ts` | `GroundingStore`: content-addressed verdict cache, LRU, JSON round-trip |
| | `index.ts` | `GroundingIndex`: by source / supported / claim term |
| | `retrieval.ts` | `GroundednessScorer`: `ground`/`scoreClaim`/`overlap`/`checkMany`/`summarize` |
| | `lifecycle.ts` | `GroundingLifecycle`: record, prune, GC timer, typed events |
| Synthesis | `types.ts` | `Answer`, `AnswerRequest`, `SynthesisConfig`, `EvidencePart`, guards + factories |
| | `store.ts` | `SynthesisStore`: content-addressed answer cache, LRU, JSON round-trip |
| | `index.ts` | `SynthesisIndex`: by source / term / confidence bucket |
| | `retrieval.ts` | `AnswerSynthesizer`: `synthesize`/`extractSentences`/`scoreSentences`/`dedupeSentences`/`fuse`/`buildAnswer` |
| | `lifecycle.ts` | `SynthesisLifecycle`: record, prune, GC timer, typed events |
| Knowledge graph | `types.ts` | `GraphEntity`, `GraphRelation`, `Triplet`, `GraphConfig`, `GraphStats`, guards + factories |
| | `store.ts` | `GraphStore`: adjacency-backed entity/relation registry, JSON round-trip |
| | `index.ts` | `GraphIndex`: by name / type / predicate |
| | `retrieval.ts` | `GraphEngine`: `extractEntities`/`extractTriplets`/`addTriplet`/`query`/`paths`/`shortestPath`/`degreeCentrality` |
| | `lifecycle.ts` | `GraphLifecycle`: prune leaves, GC timer, typed events |
| Integration | `types.ts` | `KnowledgeEntry`, `ConsolidationResult`, `Conflict`, `IntegrateConfig`, guards + factories |
| | `store.ts` | `KnowledgeStore`: identity-addressed entry registry, JSON round-trip |
| | `index.ts` | `KnowledgeIndex`: by source / token / confidence bucket |
| | `retrieval.ts` | `Consolidator`: `consolidate`/`similarity`/`isContradiction`/`merge`/`canonicalize` |
| | `lifecycle.ts` | `IntegrateLifecycle`: integrate, prune, GC timer, typed events |

## Per-layer docs

- [`src/query/README.md`](src/query/README.md)
- [`src/grounding/README.md`](src/grounding/README.md)
- [`src/synthesis/README.md`](src/synthesis/README.md)
- [`src/graph/README.md`](src/graph/README.md)
- [`src/integration/README.md`](src/integration/README.md)