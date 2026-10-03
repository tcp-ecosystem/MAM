# Memory Templates

Templates for MAM modules of `type: memory` — the store an agent reads from
and writes to between two calls.

## Module type

```yaml
type: memory
```

`memory` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `memory` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`memory.mam`](./memory.mam) | You want the documented full memory: `format`, `backend`, `scope`, `ttl` and a vector `search`, with the four standard capabilities. Start here. |
| [`memory-basic.mam`](./memory-basic.mam) | An agent needs to remember one thing by key. Namespaces, exact lookup, an optional per entry TTL, no ranking. |
| [`memory-advanced.mam`](./memory-advanced.mam) | A shared memory under real traffic: ranked search, retention classes, a quota sweeper, a never store policy and an audit log. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `store` / `retrieve` / `delete` | Yes | Yes | Yes |
| `search` | No | Yes | Yes |
| `purge` | Yes | No | No |
| `sweep` | No | No | Yes |
| `audit` | No | No | Yes |
| Expiry | Caller supplied `ttl`, checked on read | `ttl` on the entry | Retention classes plus a sweeper |
| Quota | No | Entry cap | Per namespace quota, enforced on write |
| Never store policy | No | No | Yes |
| Value size limit | No | No | Yes |

Start with `basic` for a per agent scratchpad. Move to `advanced` when the
memory is shared across agents, lives in a backend that survives a restart, or
holds anything you would be uncomfortable re-reading later.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block
  whose `test_*` functions pass

Type specific sections appear between `Capabilities` and `Rules`: `Storage` in
the basic template, and `Storage`, `Retention` and `Never Store` in the
advanced one.

## Conventions used by these templates

- **Namespaces are the isolation boundary.** `one::k` and `two::k` are
  different entries, and no capability ever reads across a namespace.
- **A key must be a non-empty string.** There is no anonymous entry; an
  unkeyed value has no defined lifetime.
- **Expiry is checked on read.** An elapsed entry is dropped when it is asked
  for, so a stale read never returns a stale value. The advanced variant adds
  `sweep` for entries nobody reads again.
- **A write resets the clock.** Storing an existing key replaces the value and
  the expiry together, so refresh is a plain `store`.
- **A purge is not recoverable.** There is no history and no undo; the advanced
  variant's audit log records that a purge happened, not what it contained.
- **Some things are never stored.** The advanced template checks a declared
  never store policy before the quota, and a rejection is an explicit code,
  never a silent drop.
- **Every operation is auditable.** A surprising recall has to be explainable
  without re-running the agent that produced it.

## Related

- [`../agent/`](../agent) — the reader and writer of a memory
- [`../resource/`](../resource) — managed state, reconciled rather than
  remembered
- [`../repository/`](../repository) — versioned durable storage
- [`../policy/`](../policy) — the constraints a memory must respect
