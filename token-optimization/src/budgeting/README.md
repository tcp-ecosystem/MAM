# Budgeting

The Budgeting layer decides *how many tokens each prompt section may consume*.
A "section" is one logical part of a prompt (system directive, user turn, tool
results, memory, knowledge). `BudgetAllocator` grants, trims or rejects token
requests against per-section ceilings (`SectionAllocation`) and the global
`maxTotal` ceiling, honouring the configured `OverrunPolicy` (`'trim'` |
`'reject'` | `'allow'`), and `fit` truncates text at a word boundary to fit a
budget.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `SectionAllocation`, `BudgetConfig`, `AllocationResult`, `BudgetSnapshot`, `FitResult`, `DEFAULT_BUDGET_CONFIG`, guards + factories |
| `store.ts` | `AllocationStore`: section ledger, `allocate`/`release`/`reserve`, stats, JSON round-trip |
| `index.ts` | `AllocationIndex`: by `under`/`near`/`over` pressure status |
| `retrieval.ts` | `BudgetAllocator`: `check`/`allocate`/`fit`/`overall`/`available`, `createAllocator` |
| `lifecycle.ts` | `BudgetingLifecycle`: periodic snapshots, `prune`, typed events |

## Example

```ts
import { BudgetAllocator, BudgetingLifecycle } from '@mam/token-optimization';

// Trim overruns to the available headroom.
const allocator = new BudgetAllocator({ perSection: { user: 100 }, overrun: 'trim' });

allocator.check('user', 120);          // true — would exceed the ceiling
allocator.fits('user', 50);            // true
allocator.allocate('user', 80);        // { allowed: 80, used: 80, remaining: 20 }
allocator.allocate('user', 80);        // { allowed: 20, exceeded: true } — trimmed
allocator.overall();                   // { totalLimit, totalUsed, remaining, ... }
allocator.available();                 // headroom left across the budget

// Truncate a text payload to a token budget.
const fit = allocator.fit(longText, 'user', 20);
fit.truncated;                         // true when it had to cut
fit.text;                              // ends with '…'

// Or use the lifecycle for snapshots + events.
const lifecycle = new BudgetingLifecycle({ overrun: 'reject' });
lifecycle.on('overrun', (result) => console.warn('overrun', result));
lifecycle.allocate('user', 900);
lifecycle.prune();                     // drop idle (zero-used) sections
```