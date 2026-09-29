# Estimation

The Estimation layer turns text into a token count without a real tokenizer.
`TokenEstimator` uses cheap, deterministic heuristics: a chars-per-token ratio
per model family (from `MODEL_PROFILES`), a word-based fallback, optional
length-based calibration, and `calibrate` — feed it `(model, sampleText,
actualTokens)` and it records a `CalibrationSample` and refines the ratio for
that model (estimates then report `method: 'calibrated'`).

## Files

| File | Contents |
|------|----------|
| `types.ts` | `TokenEstimate`, `ModelProfile`, `EstimationConfig`, `EstimateOptions`, `MODEL_PROFILES`, `DEFAULT_ESTIMATION_CONFIG`, guards + factories |
| `store.ts` | `EstimateStore`: content-addressed estimate cache, LRU eviction, JSON round-trip |
| `index.ts` | `EstimateIndex`: by model family / token-length bucket / estimation method |
| `retrieval.ts` | `TokenEstimator`: `estimate`, `estimateMany`, `calibrate`, `charsPerToken`, `tokensPerWord`, `profileFor`, `countChars`, `countWords` |
| `lifecycle.ts` | `EstimationLifecycle`: `estimate`, `calibrate`, `prune`, `clearFor`, GC timer, typed events |

## Example

```ts
import { TokenEstimator, EstimateStore, EstimateIndex, EstimationLifecycle } from '@mam/token-optimization';

const estimator = new TokenEstimator();
const est = estimator.estimate('The quick brown fox jumps over the lazy dog');
est.tokens;                    // an integer estimate
est.method;                    // 'chars-per-token' (or 'calibrated' after calibrate)
est.confidence;                // 0..1

// Estimate a batch, sharing one batch id.
const batch = estimator.estimateMany(['one', 'two', 'three'], { model: 'gpt-4' });

// Teach the estimator the real ratio for a model.
const sample = estimator.calibrate('gpt-4', sampleText, realTokenCount);
estimator.charsPerToken('gpt-4'); // now the calibrated ratio

// Wire store + index + lifecycle for caching, GC and events.
const store = new EstimateStore({ maxEntries: 1000 });
const index = new EstimateIndex();
const lifecycle = new EstimationLifecycle(estimator, store, index);
lifecycle.on('estimated', (e) => console.log(e.tokens));
lifecycle.estimate('cached text');
lifecycle.prune();               // evict down to store.maxEntries
```