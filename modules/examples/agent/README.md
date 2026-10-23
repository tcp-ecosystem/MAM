# Agent Example

Support Triage Agent — A concrete `agent`: the front desk of a SaaS support queue. It takes one inbound ticket, works out what kind of problem it is, how urgent it is, and where it should go, then stops. The agent is deliberately boring — no model calls, no network — because the interesting part of an agent is not its intelligence but its contract: what it is allowed to do, and the conditions under which it declares itself finished.

## Layout

```text
modules/examples/agent/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── agent.mam + agent.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `agent.mam` | Support Triage Agent | agent | A concrete `agent`: the front desk of a SaaS support queue. It takes one inbound ticket, works out what kind of problem it is, how urgent it is, and where it should go, then stops. The agent is deliberately boring — no model calls, no network — because the interesting part of an agent is not its intelligence but its contract: what it is allowed to do, and the conditions under which it declares itself finished. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/agent.mam
```

## What You'll Learn

- `classify` — Support Triage Agent
- `assess_urgency` — Support Triage Agent
- `plan` — Support Triage Agent

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/agent/)
- [MAM specification](../../../plan-doc/full-mam.md)
