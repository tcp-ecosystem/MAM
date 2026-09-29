# Synthesis

The synthesis layer turns a query and a pool of evidence into one coherent,
citable answer. `AnswerSynthesizer` ranks `EvidencePart`s (blending the
retriever's explicit score with lexical query overlap), extracts sentences
with an abbreviation-aware splitter, scores each sentence against the query,
dedupes near-duplicates, fuses the survivors into paragraphs, and returns an
`Answer` with `parts`, de-duplicated `citations`, a weighted `confidence` and
a `grounded` flag. `SynthesisStore` caches answers by query, `SynthesisIndex`
navigates them by source / term / confidence bucket, and `SynthesisLifecycle`
owns retention + events.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `Answer`, `AnswerRequest`, `EvidencePart`, `SynthesisPart`, `SynthesisConfig`, `SynthesizeOptions`, `SentenceScore`, `DEFAULT_SYNTHESIS_CONFIG`, guards + factories |
| `store.ts` | `SynthesisStore`: content-addressed LRU answer cache, `putFor`/`getFor` by query, JSON round-trip |
| `index.ts` | `SynthesisIndex`: by source / term / confidence bucket, `findLowConfidence` |
| `retrieval.ts` | `AnswerSynthesizer`: `synthesize`, `extractSentences`, `scoreSentences`, `dedupeSentences`, `fuse`, `buildAnswer`, `rankEvidence` |
| `lifecycle.ts` | `SynthesisLifecycle`: `record`, `prune`, GC timer, typed events |

## Example

```ts
import { AnswerSynthesizer, SynthesisStore, SynthesisLifecycle } from '@mam/intelligence-layer';

const synthesizer = new AnswerSynthesizer({ style: 'balanced' });
const answer = synthesizer.synthesize({
  query: 'What is the capital of France?',
  evidence: [
    { id: 'kb-1', text: 'Paris is the capital of France.', source: 'geography.md', score: 0.9 },
    { id: 'kb-2', text: 'Paris lies on the River Seine.', source: 'geography.md', score: 0.7 },
  ],
});
answer.text;       // fused prose
answer.parts;      // per-sentence synthesis parts with citations
answer.citations;  // ['[geography.md: kb-1]', '[geography.md: kb-2]']
answer.confidence; // weighted mean of contributing evidence scores
answer.grounded;   // confidence >= minScore

// Lower-level pieces, useful on their own.
const sentences = synthesizer.extractSentences('Dr. Smith is here. He works hard.');
const scored = synthesizer.scoreSentences(sentences, 'smith works');
const deduped = synthesizer.dedupeSentences(scored);

// Cache answers by query + lifecycle.
const store = new SynthesisStore(256);
const lifecycle = new SynthesisLifecycle(store);
lifecycle.record(answer, 'What is the capital of France?');
lifecycle.prune(128);
```