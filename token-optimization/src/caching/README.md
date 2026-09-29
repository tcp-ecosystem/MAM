# Caching

The Caching layer models *prompt-prefix and section caching*. `CacheManager`
stores reusable prompt fragments (`CachedSegment`s), serves exact and prefix
`lookup` hits — reporting the estimated tokens saved by each `CacheHit` —,
computes how much of a multi-turn sequence shares a stable prefix via
`prefixScore` (longest-common-prefix + stability), and `evict`s cold/large
segments first. Segments are promoted to `'hot'` (pinned) once they cross
`minHitsForPromotion`.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `CachedSegment`, `CacheConfig`, `CacheHit`, `CacheStats`, `CacheDecision`, `DEFAULT_CACHE_CONFIG`, guards + factories |
| `store.ts` | `CacheSegmentStore`: segment registry, `recordHit`/`touch`/`prune`, JSON round-trip |
| `index.ts` | `CacheIndex`: by model / length bucket / hits |
| `retrieval.ts` | `CacheManager`: `lookup`/`cache`/`prefixScore`/`evict`/`expire`, `createCacheManager` |
| `lifecycle.ts` | `CachingLifecycle`: periodic TTL sweep, `prune`, typed events |

## Example

```ts
import { CacheManager, CachingLifecycle } from '@mam/token-optimization';

const manager = new CacheManager({ minHitsForPromotion: 3 });

// Cache a reusable prefix.
manager.cache('You are a helpful assistant. Answer in plain text.', 14);

// Exact hit.
const exact = manager.lookup('You are a helpful assistant. Answer in plain text.');
exact.hit;                 // true
exact.savedTokens;         // 14

// Prefix hit (text starts with a cached segment).
const prefix = manager.lookup('You are a helpful assistant. Answer in plain text. Now: ...');
prefix.hit;                // true — saved the shared leading bytes

// How stable is a multi-turn sequence?
const score = manager.prefixScore(['Turn 1: hello', 'Turn 1: hello again']);
score.prefix;              // 'Turn 1: hello'
score.stability;           // 0..1

// Evict cold / large segments first.
const summary = manager.evict({ targetTokens: 100 });
summary.removed;           // segments dropped

// Or use the lifecycle for a TTL sweep + events.
const lifecycle = new CachingLifecycle({ maxSegments: 64 });
lifecycle.cache('System preamble', 8);
lifecycle.prune();         // expire stale + cap at maxSegments
```