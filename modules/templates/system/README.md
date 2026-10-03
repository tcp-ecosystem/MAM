# System Templates

Templates for MAM modules of `type: system` — a composition of several modules
wired into one executable pipeline.

## Module type

```yaml
type: system
```

`system` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `system` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`system.mam`](./system.mam) | You want the full template: a module list, a system definition block, and a documented planner / executor / reporter pipeline. Start here. |
| [`system-basic.mam`](./system-basic.mam) | Three fixed slots, an unregistered module is skipped, and the last stage is the result. The smallest runnable system. |
| [`system-advanced.mam`](./system-advanced.mam) | Production shape: dependency-derived ordering, cycle rejection, bounded retries, failure isolation, verification and a reverse-order shutdown. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `orchestrate` / `delegate` / `aggregate` | Yes | Yes | Yes |
| Run order | Declared slot list | Declared slot list | Derived from the edges |
| Cycle rejection | No | No | Yes, before anything runs |
| Unregistered module | Skipped | Skipped | Logged, `complete` stays false |
| Module failure | Propagates | Propagates | Retried, then isolated |
| `verify` | No | No | Yes |
| `shutdown` | No | No | Yes, reverse order |
| Use when | A demo pipeline | A normal system | A system others depend on |

Start with `basic` and move to `advanced` when a module can fail, when the run
order is no longer obvious from reading the file, or when something has to be
torn down in the right order.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Type-specific sections `Modules` and `System Definition` appear in all three
variants. The advanced variant adds `Edges` and `Failure Handling`.

## Conventions used by these templates

- **A system composes; it does not implement.** A system module's job is
  ordering, delegation and aggregation. The actual work stays in the modules it
  composes.
- **One module finishes before the next starts.** Stages are sequential, and
  each stage reads a shared context written by the stages before it.
- **A missing module is not a failure.** A partially registered system still
  runs; the advanced variant makes that visible through `complete` rather than
  hiding it.
- **Order is derived, never assumed.** The advanced variant computes the run
  order from the declared edges and refuses a cyclic composition instead of
  guessing an order that satisfies nothing.
- **Failure is isolated and reported.** A failing module stops the pipeline, and
  every attempt is recorded in `failures` with its reason.
- **Aggregation uses the last stage that succeeded.** A partial run still
  returns a real result, and `complete` tells the caller it is partial.

## Related

- [`../module/`](../module) — a single module a system composes
- [`../component/`](../component) — a part of a larger system with a contract
- [`../workflow/`](../workflow) — multi-step pipelines
- [`../policy/`](../policy) — the policy enforced across every module
