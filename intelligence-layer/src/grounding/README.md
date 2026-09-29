# Grounding

The grounding layer answers "is this claim actually supported by the evidence
we retrieved for it?". `GroundednessScorer` tokenizes a claim and a pool of
`EvidenceChunk`s, scores every chunk with a Dice overlap, combines the best
chunk's overlap with claim vocabulary coverage into a `[0, 1]` score, and
returns a `GroundedClaim` — `supported`, `citations`, and `unmatchedTerms`
(the claim vocabulary no evidence chunk touched, the strongest hallucination
signal). `GroundingStore` caches verdicts, `GroundingIndex` navigates them by
source / support / term, and `GroundingLifecycle` owns retention + events.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `EvidenceChunk`, `GroundingRequest`, `GroundedClaim`, `GroundingResult`, `GroundingConfig`, `GroundingStats`, `GroundOptions`, `DEFAULT_GROUNDING_CONFIG`, guards + factories |
| `store.ts` | `GroundingStore`: content-addressed LRU verdict cache, JSON round-trip, access-time tracking |
| `index.ts` | `GroundingIndex`: by source / supported / claim term, `findByScore` |
| `retrieval.ts` | `GroundednessScorer`: `ground`, `scoreClaim`, `overlap`, `checkMany`, `summarize`, `tokenize` |
| `lifecycle.ts` | `GroundingLifecycle`: `record`, `prune`, GC timer, typed events |

## Example

```ts
import { GroundednessScorer, GroundingStore, GroundingLifecycle } from '@mam/intelligence-layer';

const scorer = new GroundednessScorer({ minScore: 0.55 });
const verdict = scorer.ground(
  'The API returns 204 on success',
  [
    {
      id: 'docs/api.md#l42',
      text: 'The API returns 204 on success when the request is valid.',
      source: 'docs/api.md',
    },
  ],
);
verdict.supported;       // true
verdict.score;           // ~1.0
verdict.citations;       // ['[docs/api.md: docs/api.md#l42]']
verdict.unmatchedTerms;  // []

// Batch a whole answer's claims.
const result = scorer.checkMany(['claim one', 'claim two'], evidence);
result.ratio;            // supportedCount / claims.length
result.summary;          // human-readable one-liner

// Cache verdicts + lifecycle.
const store = new GroundingStore(512);
const lifecycle = new GroundingLifecycle(store);
lifecycle.record(result);
lifecycle.prune(64);
```