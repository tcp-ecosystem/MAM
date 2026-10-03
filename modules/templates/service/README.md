# Service Templates

Templates for MAM modules of `type: service` — a long-running process with a
lifecycle, a declared endpoint table, and a health report a host can poll.

## Module type

```yaml
type: service
```

`service` is one of the `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `service` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`service.mam`](./service.mam) | You want the full template: start and stop lifecycle, endpoint table and the documented three-state health check. Start here. |
| [`service-basic.mam`](./service-basic.mam) | Start, serve, stop, and answer `404` or `503`. The smallest service a host can supervise. |
| [`service-advanced.mam`](./service-advanced.mam) | Production shape: a four-state health model, graceful draining, an in-flight limit, request error paths and an event log. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `start` / `stop` | Yes | Yes | Yes |
| `health` | Yes | Yes | Yes |
| `handle_request` | Yes | Yes | Yes |
| Health states | 2 | 3 | 4, including `draining` |
| Endpoint table | Yes | Yes | Yes, plus `/metrics` |
| Unregistered endpoint | `404` | `404` | `404` |
| Handler raises | Propagates | Propagates | `500` plus an event |
| In-flight limit | No | No | Yes, answers `429` |
| Graceful drain | No | No | Yes |
| Event log | No | No | Yes |
| Use when | Local tooling | A normal service | Anything behind a supervisor |

Start with `basic` and move to `advanced` as soon as a restart can drop work in
flight. Reach for the full `service.mam` when you want the documented version
of the simple case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Type-specific sections `Endpoints` and `Health Check` appear in all three
variants, between `Capabilities` and `Rules`. The advanced variant adds
`Limits`.

## Conventions used by these templates

- **State is a small closed set.** A service is in one of a declared number of
  states and nothing else; `status` is never free text.
- **The endpoint table is the contract.** A request is matched against
  `(method, path)` and anything unmatched is a `404`, never a guess.
- **State is checked before routing.** A service that is not serving answers
  `503` without consulting the endpoint table, so a stopped process never looks
  alive.
- **Stop drains before it returns.** The advanced variant moves to `draining`,
  lets in-flight work finish, and only then reports `stopped`.
- **Request failures are responses, not exceptions.** A handler that raises
  produces a `500` and an event; it never escapes into the host.
- **Bounds are declared, not implied.** The in-flight limit is a field with a
  documented default, and exceeding it is a documented `429` rather than
  unbounded queueing.

## Related

- [`../resource/`](../resource) — reconciled state rather than a running process
- [`../policy/`](../policy) — the allow and deny rules guarding each request
- [`../system/`](../system) — a system composed of many modules
- [`../runtime/`](../runtime) — the runtime that hosts a service process
