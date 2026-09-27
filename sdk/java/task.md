# Task — java SDK

## Scope

Create the `java` SDK package with six core files (AST, parser, validator, runtime, plugins, and package entry), six support modules (`config`, `cache`, `format`, `graph`, `template`, `doctor`), documented public APIs, and tests.

## Contract

- Front matter uses `name` (optional), `authors`, `version`, `description`, `schema_version`, `license`, `tags`, `dependencies`, and `metadata`.
- `SectionKind` has nineteen standard kinds and one custom variant.
- `Module`, `Section`, `CodeBlock`, validation, execution, plugin, cache, graph, and template APIs are defensive where the language permits.
- `VERSION`, `SDK_NAME`, `userAgent`, `moduleSummary`, and `isValidModule` are exposed through the package entry point.

## Constraints

- No third-party dependencies.
- No toolchain installation.
- No changes outside `sdk/java`.
- Tests are present but have never been executed.
