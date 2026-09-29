# Token Budgeting

The Token Budgeting layer answers *"how much of my model's context window does
each section of the prompt get to use, and what happens when a section tries to
take more than its fair share?"* It sits between context assembly (which
produces the `system`, `user`, `tool`, `memory` and `knowledge` sections) and
generation (which consumes the flattened prompt).

- **Budgeting** — per-section token limits plus a configurable overrun policy
  (`'trim' | 'reject' | 'allow'`).
- **Accounting** — tracks `used` and `reserved` tokens per section as the
  engine allocates and releases.
- **Indexing** — answers status queries (`ok`/`warn`/`critical`/`over`) cheaply.
- **Lifecycle** — prunes, resets and periodically garbage-collects the budget
  table so it stays bounded.
- **Integration** — high-level facades combine budgeting with a heuristic
  `estimate(text)` counter and a `fit(text, section)` truncator.

## Files

| File | Contents |
|------|----------|
| `types.ts` | `SectionBudget`, `TokenBudgetConfig`, `BudgetAllocation`, `BudgetCheck`, pure helpers (`estimateTokens`, `computeStatus`, `effectiveLimit`) |
| `store.ts` | `TokenBudgetStore`: allocate/release/reserve, policy enforcement, events, JSON round-trip |
| `index.ts` | `BudgetIndex`: status buckets with `findByStatus` / `overloaded` |
| `retrieval.ts` | `BudgetManager`: `check`, `trim`, `overall`, `available` |
| `lifecycle.ts` | `BudgetLifecycle`: bounded table pruning, GC passes, forwarded events |
| `integration.ts` | `TokenBudgeter`, `BudgetAdapter`, `createTokenBudgeter`, `createBudgetAdapter` |

## Key classes

- **`TokenBudgetStore`** — the section-keyed budget registry and accounting
  engine; the single source of truth.
- **`BudgetManager`** — the decision-maker layered over the store: *"may I
  afford this?"*, *"grant it, but only this much"*, *"cut by how many?"*.
- **`TokenBudgeter`** — the high-level facade combining store + manager +
  lifecycle and adding `estimate` and `fit`.
- **`BudgetAdapter`** — an alternate facade over an *existing* store + manager
  pair, for callers already sharing components.
- **`BudgetLifecycle`** — keeps the table bounded by pruning the least-used
  sections.

## Example

```ts
import { createTokenBudgeter } from '@mam/context-engine';

const budgeter = createTokenBudgeter(
  { perSection: { knowledge: 2000 }, overrunPolicy: 'trim' },
  { lifecycle: false },
);

const text = 'A very long knowledge chunk...';
const fitted = budgeter.fit(text, 'knowledge'); // trims to remaining headroom
budgeter.allocate('knowledge', fitted.tokens);

budgeter.estimate('How do I migrate?'); // heuristic token count
budgeter.check('knowledge', 500);       // dry-run, no mutation
budgeter.available('knowledge');        // remaining headroom
```