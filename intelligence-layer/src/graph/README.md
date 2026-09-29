# Knowledge graph

The knowledge graph is the engine's durable, navigable memory: typed entities
joined by typed relations. `GraphEngine` extracts `GraphEntity` candidates and
raw `Triplet`s from text using heuristic patterns and a shallow SVO grammar,
ingests triplets via `addTriplet` (creating/merging entities, bumping mention
counts, storing idempotent relations), and traverses the graph with `query`,
`paths`, `shortestPath` and `degreeCentrality`. `GraphStore` is the
adjacency-backed registry that enforces the endpoint invariant, `GraphIndex`
resolves names / types / predicates case-insensitively, and `GraphLifecycle`
prunes least-connected and stale entities.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `GraphEntity`, `GraphRelation`, `Triplet`, `EntityCandidate`, `EntityExtraction`, `GraphConfig`, `GraphStats`, `GraphOptions`, `DEFAULT_GRAPH_CONFIG`, guards + factories |
| `store.ts` | `GraphStore`: entity/relation registry with maintained adjacency, degree, JSON round-trip |
| `index.ts` | `GraphIndex`: by name / type / predicate, `findByNamePrefix` |
| `retrieval.ts` | `GraphEngine`: `extractEntities`, `extractTriplets`, `addTriplet`, `query`, `paths`, `shortestPath`, `degreeCentrality`, `inferType` |
| `lifecycle.ts` | `GraphLifecycle`: `addEntity`/`addRelation`/`clearEntity`, `prune`, GC timer, typed events |

## Example

```ts
import { GraphEngine, GraphLifecycle } from '@mam/intelligence-layer';

const engine = new GraphEngine();
const extraction = engine.extractEntities('Mr. John Smith works at Acme Inc.');
extraction.candidates.map((c) => `${c.name} (${c.type})`);

const triplets = engine.extractTriplets('Ada Lovelace founded DeepMind.');
// [{ subject: 'Ada Lovelace', predicate: 'founded', object: 'DeepMind' }]

const added = engine.addTriplet({ subject: 'Ada Lovelace', predicate: 'worked_at', object: 'DeepMind' });
added.created;   // true
added.subjectId; // stable id derived from the name

engine.query(added.subjectId).neighbors;   // one hop out
engine.shortestPath(added.subjectId, added.objectId); // [subjectId, objectId]
engine.paths(added.subjectId, added.objectId, 3);     // routes sorted shortest-first
engine.degreeCentrality();                 // sorted by degree descending

// Lifecycle-driven retention.
const lifecycle = new GraphLifecycle(engine.store, engine.index);
lifecycle.addEntity(/* ... */);
lifecycle.prune(100); // evict least-connected entities first
```