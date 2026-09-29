# Integration

The integration layer turns knowledge from many sources into one coherent
body of facts. `Consolidator` filters low-confidence `KnowledgeEntry`s,
orders survivors by quality (confidence → information → recency), dedupes
near-duplicates, detects contradictions between highly similar entries
(`Conflict`s with human-readable reasons), merges compatible entries into
canonical forms (concatenated content, unioned metadata, maximum confidence)
and caps the result. `KnowledgeStore` is the identity-addressed registry,
`KnowledgeIndex` navigates entries by source / token / confidence bucket, and
`IntegrateLifecycle` owns ingestion + consolidation + retention in one call.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `KnowledgeEntry`, `ConsolidationResult`, `Conflict`, `IntegrateConfig`, `IntegrateOptions`, `MergeDecision`, `IntegrateStats`, `DEFAULT_INTEGRATE_CONFIG`, guards + factories |
| `store.ts` | `KnowledgeStore`: identity-addressed entry registry, `list` filters/sorts, `retainOnly`, `replaceAll`, JSON round-trip |
| `index.ts` | `KnowledgeIndex`: by source / token, `findByTokens`, confidence buckets |
| `retrieval.ts` | `Consolidator`: `consolidate`, `similarity`, `isContradiction`, `merge`, `canonicalize`, `decide`, plus `tokenize`/`compareEntryQuality`/`jaccard`/`dice` |
| `lifecycle.ts` | `IntegrateLifecycle`: `integrate`, `prune`, GC timer, typed events |

## Example

```ts
import { Consolidator, KnowledgeStore, KnowledgeIndex, IntegrateLifecycle } from '@mam/intelligence-layer';

const consolidator = new Consolidator();
const result = consolidator.consolidate([
  { id: 'kb-1', content: 'Paris is the capital of France.', source: 'a.md', confidence: 0.9 },
  { id: 'kb-2', content: 'Paris is the capital of France.', source: 'b.md', confidence: 0.8 },
  { id: 'kb-3', content: 'Paris is the largest city in France.', source: 'c.md', confidence: 0.6 },
]);
result.kept;        // canonical set (kb-1 or a merged form, kb-3)
result.merged;      // compatible entries fused
result.removed;     // near-duplicates dropped
result.conflicts;   // detected contradictions

// Pairwise primitives.
consolidator.similarity(a, b);        // Dice coefficient in [0, 1]
consolidator.isContradiction(a, b);   // shared vocab + polarity clash?

// Registry + lifecycle.
const store = new KnowledgeStore(10_000);
const index = new KnowledgeIndex();
const lifecycle = new IntegrateLifecycle(store, index);
lifecycle.integrate([/* incoming entries */]);
lifecycle.prune(1000);
```