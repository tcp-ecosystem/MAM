# Awesome MAM

> Curated modules, tools, and resources for [MAM (Machine Agent Modules)](https://github.com/tcp-ecosystem/MAM) — describe systems, compile anywhere.

## Registry

- [MAM Hub](https://github.com/tcp-ecosystem/MAM/tree/main/registry) — production module registry (HTTP + GraphQL + typed client)

## Founding Modules (live on MAM Hub)

| Module | Type | What it does |
|--------|------|--------------|
| `example-agent` | agent | Support triage: classify, score urgency, route, stop with reason |
| `example-workflow` | workflow | Ledger ETL: extract → normalize → retry-safe load |
| `example-team` | team | Planner + researchers with handoffs |
| `example-tool` | tool | Rate-limited URL fetcher |
| `example-memory` | memory | Per-session persistent memory with TTL |
| `example-policy` | policy | Allow/deny pre-execution policy |
| `example-system` | system | Order processing: validate → charge → … |
| `example-service` | service | Background service with lifecycle + health |
| `example-component` | component | Circuit breaker for flaky dependencies |
| `example-contract` | contract | List-API producer/consumer agreement |
| `example-interface` | interface | Versioned search contract, opaque cursors |
| `example-module` | module | Text statistics computation |
| `example-package` | package | Distributable unit manifest |
| `example-plugin` | plugin | Host formatter extension |
| `example-repository` | repository | Content-addressed document collection |
| `example-resource` | resource | External queue broker sync |
| `example-runtime` | runtime | Untrusted step execution engine |
| `example-documentation` | documentation | API reference as a module |
| `example-extension` | extension | Host report-format extension point |

## Templates

- [`mam new <type> <name>`](https://github.com/tcp-ecosystem/MAM/tree/main/modules/templates) — 19 type scaffolds (basic + advanced)

## Editors

- [VS Code](https://open-vsx.org/extension/arkhangellifejiggy/mam-language) — syntax, snippets, diagnostics (`arkhangellifejiggy.mam-language` on OpenVSX)
- [Neovim / Vim / Sublime / Emacs / JetBrains / Zed](https://github.com/tcp-ecosystem/MAM/tree/main/desktop-extension) — 14 editors covered

## Spec & Docs

- [Specification](https://github.com/tcp-ecosystem/MAM/blob/main/spec/SPEC.md)
- [Usage guide](https://github.com/tcp-ecosystem/MAM/blob/main/usage.md)
- [Purpose](https://github.com/tcp-ecosystem/MAM/blob/main/purpose.md) · [Goal](https://github.com/tcp-ecosystem/MAM/blob/main/goal.md) · [Scope](https://github.com/tcp-ecosystem/MAM/blob/main/scope.md) · [Brain](https://github.com/tcp-ecosystem/MAM/blob/main/brain.md)

## Contribute

Publishing a module? Open a PR adding it to the table above (name, type,
one line, registry link). Quality bar: parses (`mam validate`), ships
`.mam` + `.mam.md` twins, has tests.
