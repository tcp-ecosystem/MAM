# Team Templates

Templates for MAM modules of `type: team` — a group of agents with distinct
roles, an explicit handoff order, and a shared policy applied to every member.

## Module type

```yaml
type: team
```

`team` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `team` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`team.mam`](./team.mam) | You want the full template: member list, role table, three capabilities and the documented handoff order. Start here. |
| [`team-basic.mam`](./team-basic.mam) | Three members, one handoff order, no budgets or traces. The smallest team that still has a complete lifecycle. |
| [`team-advanced.mam`](./team-advanced.mam) | Production shape: per-member budgets, escalation on exhaustion, an explicit handoff protocol and a replayable trace. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `assign` / `coordinate` / `review` | Yes | Yes | Yes |
| Members and role table | Yes | Yes | Yes |
| Handoff order | Recorded | Documented | Documented as a protocol |
| Per-member budget | No | No | Yes |
| `escalate` | No | No | Yes |
| `trace` | No | No | Yes |
| Unknown members | Unassigned | Unassigned | Refused with an error |
| Failed review | Reported | Reported | Can never approve |
| Use when | A small fixed crew | A normal team | A team that must be debuggable |

Start with `basic` and move to `advanced` when a run has to be explained after
the fact or when a member can loop. Reach for the full `team.mam` when you want
the documented version of the simple case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Type-specific sections (`Members`, `Roles`, and a handoff table) appear in all
three variants, between `Capabilities` and `Rules`.

## Conventions used by these templates

- **Members are nouns, capabilities are verbs.** A member is who does the work,
  a capability is what the team exposes. Every `capabilities:` entry has a
  matching `###` heading under `Capabilities`.
- **The handoff order is data, not code.** The order lives in a table and in
  `Team.handoff`; nothing in the Python hard-codes "coordinator then specialist
  then reviewer" beyond the declared default.
- **Roles are distinct.** A team with two members in the same role is a
  configuration error, not a configuration choice.
- **A team never reports completion before review passes.** Approval is a
  separate step from execution, and the advanced variant ties it to the policy
  and to the absence of escalations.
- **An escalated run can never be approved.** The advanced template makes that
  a rule rather than a convention, so a blocked run cannot be talked into
  success.
- **Every handoff is recorded.** `trace` is append-only, which is what makes a
  failed team run replayable.

## Related

- [`../agent/`](../agent) — a single agent with a role and goals
- [`../workflow/`](../workflow) — multi-step pipelines
- [`../policy/`](../policy) — the allow and deny rules a team runs under
- [`../system/`](../system) — a system composed of many modules
