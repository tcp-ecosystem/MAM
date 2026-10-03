# MAM Examples

Working example modules. Unlike [`../templates/`](../templates/), which are
starting points you fill in, everything here is a **complete, runnable module**
with real logic, real tests and a concrete domain.

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format.

## Coverage

All 19 `VALID_MODULE_TYPES` from `@mam/ast` are represented. Each type has a
folder at `modules/examples/<type>/` containing a worked example of that type.

| Type | Example | What it demonstrates |
|------|---------|----------------------|
| [`module`](./module) | Text Statistics | The generic type: pure transform, no state, no I/O |
| [`agent`](./agent) | Support Triage Agent | Role, goal, tool calls, escalation, stopping condition |
| [`tool`](./tool) | Rate-Limited HTTP Fetcher | Narrow typed contract, token bucket, idempotency |
| [`memory`](./memory) | Session Memory | Per-session scoping, per-entry TTL, blocked keys |
| [`workflow`](./workflow) | Ledger ETL | `Workflow Definition` and `Step:` blocks, retry on one step |
| [`team`](./team) | Research Team | Roles, delegation, handoff records, gap reporting |
| [`policy`](./policy) | Data Access Policy | Ordered allow/deny rules, first match wins, default-deny |
| [`system`](./system) | Order Processing | `Modules` and `System Definition`, composing validate/charge/fulfil |
| [`service`](./service) | Worker Health Service | Lifecycle states, bounded loop, graceful drain |
| [`component`](./component) | Circuit Breaker | A contract-bearing part: closed/open/half-open, injected clock |
| [`resource`](./resource) | Managed Queue | External provider, desired state, reconcile loop, drain |
| [`interface`](./interface) | Paginated Search | Opaque cursors, bounded page size, version negotiation |
| [`contract`](./contract) | Cursor Pagination Contract | Guarantees, compatibility window, breaking-change policy |
| [`extension`](./extension) | Formatter Extension Point | Hook contract, host API range, priority resolution |
| [`runtime`](./runtime) | Sandboxed Step Runner | Isolation context, compute/output/timeout budgets, lifecycle |
| [`package`](./package) | Summarizer Package Manifest | Contents, half-open dependency ranges, checksums, install layout |
| [`repository`](./repository) | Content-Addressed Store | Layout, branch strategy, deterministic ids, ownership |
| [`documentation`](./documentation) | Versioned API Reference | Audience, structure, fingerprint-based staleness, owners |
| [`plugin`](./plugin) | Report Banner Plugin | `Lifecycle`, `Extensions`, `Pointcuts`, intercepting a call site |

## Example systems

The folders above are single modules. These pre-existing folders are complete
**systems** — each has a `system.mam` that composes several modules:

| Folder | Composes |
|--------|----------|
| [`basic/`](./basic) | Six small `module` examples: calculator, hello, password-gen, string-utils, temperature, text-transform |
| [`advanced/`](./advanced) | Agent, api-gateway, data-pipeline, knowledge-graph, monitoring-agent, multi-agent-debate, workflow |
| [`core/`](./core) | configuration, metadata, module, workflow |
| [`plugins/`](./plugins) | custom-section, export-plugin, memory-plugin, runtime-plugin, validation-plugin |
| [`security-system/`](./security-system) | recon, analyzer, reporter |

A handful of modules also sit loose at the top of this folder from earlier work
(`authentication`, `bug-hunter`, `data_pipeline`, `hello`, `memory`, `planner`,
`prompt`, `rag`, `security`, `workflow`).

## File format

Examples use a compact frontmatter block, distinct from the template style:

```yaml
---
id: example-tool
name: Rate-Limited HTTP Fetcher
version: 2.0.0
type: tool
author: MAM Team
description: >
  One or more lines of folded description.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - example
  - tool
dependencies: []
capabilities:
  - fetch
permissions:
  filesystem:
    - read
---
```

Fields run together with no blank lines, and there is no `# MAM Metadata`
comment marker. That marker is a template convention; examples stay terse.

Every example then carries the full V1 surface: `Purpose`, `Inputs`, `Outputs`,
`Capabilities`, `Rules`, `Workflow` (with a Mermaid diagram), `Python`, `Tests`
(Input/Expected plus a `test_*` function), `Examples` and `References`.

## Conventions

- **Examples run.** The Python, Tests and Examples blocks concatenate into a
  script that executes cleanly and passes every assertion. This is verified, not
  assumed.
- **Examples are concrete.** No `example-provider` placeholders — the templates
  folder owns generic scaffolding, so examples pick a real domain instead.
- **`type` always matches the folder.** The compiler's `checkModuleType`
  validates against `VALID_MODULE_TYPES`, so a module in `examples/tool/`
  declares `type: tool`.
- **Capability is what, workflow is when.** A module's capability list and its
  Mermaid diagram must not contradict each other.
- **The diagram is a view, not a second source of truth.** If the prose and the
  Python change, the diagram changes with them.
- **Examples link back to templates.** Each `## References` points at the
  matching `../../templates/<type>/` folder, so a reader can go from a working
  example to the starting point.

## Related

- [`../templates/`](../templates) — starter templates for all 19 types
- [`../../plan-doc/full-mam.md`](../../plan-doc/full-mam.md) — the `.mam` format specification
