# Agent Templates

Templates for MAM modules of `type: agent` — a system that decides, calls
tools, reads and writes memory, and has to justify when it stopped.

## Module type

```yaml
type: agent
```

`agent` is not special to the MAM language: it is one of the `VALID_MODULE_TYPES`
in `@mam/ast`, and the compiler's `checkModuleType` rejects a module whose
`type` is not on that list. Every variant below keeps the value `agent`.

## Variants

| File | Use when |
|------|----------|
| [`agent.mam`](./agent.mam) | You want the documented multi agent system: a Coordinator and a Worker, a shared `SharedMemory`, a `SafetyPolicy`, and the full MAM block vocabulary. Start here. |
| [`agent-basic.mam`](./agent-basic.mam) | One agent, one role, two tools and a stop reason. The smallest agent that still declares when it is finished. |
| [`agent-advanced.mam`](./agent-advanced.mam) | A production agent: tool and token budgets, guardrails screened before and after every step, refusal handling, redaction and a run trace. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| Agents in the system | 1 | 2+ | 1 |
| `plan` / `execute` / `remember` | Yes | Yes | Yes |
| `guard` | No | SafetyPolicy | Yes |
| `report` | No | No | Yes |
| Turn budget | Yes | No | Yes |
| Token budget | No | No | Yes |
| Redaction | No | No | Yes |
| Per run trace | No | No | Yes |
| Handoff to another agent | No | Yes | No |

Start with `basic` while you are still working out the role and the tool list.
Move to `advanced` the moment something other than you will call the agent.
Reach for the full `agent.mam` when the task genuinely needs more than one
agent and a shared memory.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block
  whose `test_*` functions pass

Type specific sections appear between `Capabilities` and `Rules`:
`Agent Definition` in all three, plus `Stop Conditions` in the basic template
and `Budgets`, `Guardrails`, `Error Codes` and `Permissions` in the advanced
one.

## Conventions used by these templates

- **An agent always says why it stopped.** `stop_reason` is a declared output,
  not a comment. A run that ends for any reason — including an empty task —
  reports which reason it was.
- **Capabilities are nouns, workflows are verbs.** `plan` says the agent can
  decompose a task; the `Workflow` diagram says when it does.
- **Tools are an allow list, not a suggestion.** A step outside the list is
  refused and recorded, never silently attempted.
- **Budgets are enforced by the agent.** `max_turns` and `max_tokens` are
  checked inside the loop, so a caller cannot exceed them by asking nicely.
- **Errors are values.** No variant raises to the caller; a refusal or a
  failure comes back as a code alongside the partial answer.
- **The trace never echoes step values.** Observability records what happened,
  counts and tools, so a secret cannot leak through the telemetry path.
- **Memory is scoped to the agent.** The basic agent reads and writes its own
  notes and never another agent's; see [`../memory/`](../memory) for the store.

## Related

- [`../tool/`](../tool) — the callable tools an agent is allowed to use
- [`../memory/`](../memory) — what an agent remembers between runs
- [`../workflow/`](../workflow) — deterministic pipelines, the alternative to
  an agent
- [`../policy/`](../policy) — the declarative constraints a system enforces
