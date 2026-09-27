# MAM Core

`sdk/core` is the language-agnostic conformance layer for the MAM SDK family.

- `CONFORMANCE.md` is the normative contract.
- `schema/frontmatter.schema.json` and `schema/section.schema.json` describe
  the typed frontmatter and section blocks.
- `fixtures/` contains shared `.mam.md` cases and adjacent `expected.json`
  descriptions.
- `runner/index.mjs` runs the fixtures against the TypeScript reference SDK.

A new language SDK adopts the layer by implementing the named parser,
validator, AST, runtime, plugin, and support-module semantics, then running
the same fixtures. Build the reference SDK first, then run the runner:

```text
pnpm --filter @mam/sdk-typescript build
node runner/index.mjs
```

The runner exits 0 only when every fixture parses and validates as expected.
