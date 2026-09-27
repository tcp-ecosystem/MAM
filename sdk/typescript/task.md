# Task — Create sdk/typescript

Implement the shared MAM SDK contract as an idiomatic ESM TypeScript package.

- Mirror the JavaScript SDK layout while exposing the Go contract names.
- Add AST, parser, validator, runtime, plugins, and six support modules.
- Add the public barrel export, tests with at least seven cases per file, and
  honest verification documentation.
- Add no runtime dependency and do not modify another package.

The implementation uses a deliberately small YAML-frontmatter reader because
the contract only requires scalar values and string lists; it avoids coupling
the package to a workspace-only parser.
