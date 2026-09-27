# Task — Create sdk/core

Create the language-agnostic MAM conformance layer.

- Define the normative type surface, section order, frontmatter fields,
  diagnostic severities, and support-module behavior.
- Add JSON Schemas for frontmatter and sections.
- Add shared `.mam.md` fixtures with machine-readable `expected.json` files.
- Add a Node runner that exits non-zero on any mismatch.
- Do not add a language toolchain or modify another package.
