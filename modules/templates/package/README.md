# Package Templates

Templates for MAM modules of `type: package` — distributable units that declare
their contents, version and dependency ranges, install layout and integrity
verification.

## Module type

```yaml
type: package
```

`package` is one of the 19 `VALID_MODULE_TYPES` in `@mam/ast`. The compiler's
`checkModuleType` rejects a module whose `type` is not on that list, so the
value must stay `package` in every variant below.

## Variants

| File | Use when |
|------|----------|
| [`package.mam`](./package.mam) | You want the full template: contents table, dependency-range table, install layout and sha256 verification. Start here. |
| [`package-basic.mam`](./package-basic.mam) | One module, one manifest, one directory. The smallest unit that still installs into a versioned prefix. |
| [`package-advanced.mam`](./package-advanced.mam) | Production shape: a lockfile, per-entry sizes and digests, a detached signature, provenance and install size ceilings. |

Each `.mam` has a byte-identical `.mam.md` twin, per the `full-mam.md` V1
specification in which `.mam.md` is the canonical module format. Keep the pair
in lockstep: they are the same module under two extensions.

## Choosing a variant

|  | basic | full | advanced |
|---|---|---|---|
| `manifest` / `install` | Yes | Yes | Yes |
| `resolve` (ranges) | No | Yes | Yes |
| `verify` (digests) | No | Yes | Yes |
| `lock` / `attest` / `publish` | No | No | Yes |
| Multiple entries | No | Yes | Yes |
| Versioned install prefix | Yes | Yes | Yes |
| Lockfile | No | No | Yes |
| Signature check | No | No | Yes |
| Provenance record | No | No | Yes |
| Size ceilings | No | No | Yes |
| Telemetry dependency | No | No | Yes |

Start with `basic` and move to `advanced` when the unit is published to someone
who cannot trust the transport. Reach for the full `package.mam` when you want
the documented range-and-digest case rather than either extreme.

## Required surface

Every variant satisfies the `full-mam.md` V1 core:

- **Metadata** — `id`, `name`, `version`, `type`, `author`, `description`,
  `license`, `tags`, `runtime`, `capabilities`, `permissions`
- **Sections** — `Purpose`, `Inputs`, `Outputs`, `Capabilities`, `Rules`,
  `Workflow`, `Python`, `Tests`, `Examples`, `References`
- **Blocks** — a `mermaid` diagram inside `Workflow`, and a `python` block

Variant-specific sections (`Contents`, `Layout`) appear in all three;
`Dependency Ranges` and `Integrity` appear in the full and advanced templates,
which add `Provenance` and `Size Limits`.

## Conventions used by these templates

- **The manifest is the whole truth.** Every file that ships is listed with its
  size and digest, and every listed file must exist. An unlisted file is a
  packaging error, not a curiosity.
- **The version is part of the path.** Every install goes to
  `./dist/<name>/<version>/`, so two versions coexist and a rollback is a
  pointer change rather than a reinstall.
- **Verification happens before anything is loaded.** Sizes first, then
  digests, then the signature. The first failure stops the install.
- **A failed install leaves nothing behind.** The partially written prefix is
  removed, so a consumer never sees a partly trusted package.
- **Required and optional dependencies fail differently.** A required
  dependency outside its range fails the install; an optional one is recorded in
  `problems` as `skipped` and the install continues.
- **Rules are declarative.** They constrain publisher and consumer; no rule here
  is implemented in Python.

## Related

- [`../repository/`](../repository) — where a package's sources are hosted
- [`../runtime/`](../runtime) — the engine that loads modules after install
- [`../contract/`](../contract) — the agreement a published package makes
- [`../resource/`](../resource) — state a package may provision after install
