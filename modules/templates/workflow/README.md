# Workflow Templates

Templates for MAM modules of `type: workflow` — a multi step process whose
steps, dependencies and failure behaviour are declared rather than emergent.

## Module type

```yaml
type: workflow
```

`workflow` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `workflow` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`workflow.mam`](./workflow.mam) | You want the documented full workflow: a six step DAG with conditions, error handlers, the `## Workflow Definition` and `## Step:` blocks, and the 100 step cap. Start here. |
| [`workflow-basic.mam`](./workflow-basic.mam) | A linear chain of three steps with no branches, no retries and no timeouts. The order is the whole contract. |
| [`workflow-advanced.mam`](./workflow-advanced.mam) | A pipeline that talks to systems which sometimes fail: conditional steps, bounded retries with backoff, per step timeouts, compensation and a run trace. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `define` / `validate` / `run` | Yes | Yes | Yes |
| `retry` | No | Per step, capped at 5 | Per step, with linear backoff |
| `compensate` | No | Declared | Enforced, reverse order |
| `trace` | No | No | Yes |
| Steps | 3 | 6 | 6 |
| Branching | None | Conditions | Conditions |
| Per step timeout | No | No | Yes |
| Skipped vs failed | Skipped | Both, documented | Both, traced |
| Use when | Deterministic transform | A real pipeline | Unreliable upstreams |

Start with `basic`: if a linear chain covers it, a branch you did not need is
just a place for the order to go wrong. Move to `advanced` when a step talks to
something outside the process, because that is where retries, timeouts and
compensation earn their keep.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block
  whose `test_*` functions pass

Type specific sections mirror the full template: `## Workflow Definition`
followed by one `## Step: <name>` block per step, carrying `depends_on`,
`timeout_seconds`, `retries` and any `condition`, `error_handler` or
`compensate` that the step declares. The advanced variant adds
`Retry and Timeout Policy` and `Compensation`.

## Conventions used by these templates

- **A step is a `tool` module.** Steps never do work themselves; they name a
  handler, exactly as the `## Step:` block declares a provider and its
  capabilities.
- **Step order is the definition.** Execution follows dependency order, so the
  `## Workflow Definition` list and the Mermaid diagram must agree.
- **Skipped is not failed.** A step whose dependency did not complete, or
  whose condition was false, is `skipped` and carries no error.
- **Retries are bounded by three things at once.** A step runs at most
  `1 + retries` times, never past its `timeout_seconds`, and never on an error
  that retrying cannot fix.
- **A failure ends the run and starts compensation.** Completed work is rolled
  back newest first, and a failed rollback does not stop the remaining ones.
- **The engine never raises to the caller.** `status` carries the outcome, so a
  failed run is still inspectable rather than an exception in a log.
- **The trace is the explanation.** Every attempt is recorded, including the
  ones that were retried, so a failed run can be read without re-running it.

## Related

- [`../tool/`](../tool) — the handler a step invokes
- [`../service/`](../service) — the long-running process a step may call
- [`../module/`](../module) — a single reusable transform
- [`../agent/`](../agent) — the non-deterministic alternative to a workflow
