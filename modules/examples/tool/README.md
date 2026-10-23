# Tool Example

Rate-Limited HTTP Fetcher — A `tool` is something an agent calls with arguments and gets a typed result back. This one is the least glamorous tool that still matters in production: a URL fetcher wrapped in a token bucket and an exponential backoff. It is **side-effecting** in the sense that it makes outbound requests, but it is **idempotent** from the caller's point of view — fetching the same URL twice returns the same body and does not double-charge the bucket for a retry of the same request.

## Layout

```text
modules/examples/tool/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── tool.mam + tool.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `tool.mam` | Rate-Limited HTTP Fetcher | tool | A `tool` is something an agent calls with arguments and gets a typed result back. This one is the least glamorous tool that still matters in production: a URL fetcher wrapped in a token bucket and an exponential backoff. It is **side-effecting** in the sense that it makes outbound requests, but it is **idempotent** from the caller's point of view — fetching the same URL twice returns the same body and does not double-charge the bucket for a retry of the same request. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run modules/tool.mam
```

## What You'll Learn

- `fetch` — Rate-Limited HTTP Fetcher
- `acquire_token` — Rate-Limited HTTP Fetcher

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/tool/)
- [MAM specification](../../../plan-doc/full-mam.md)
