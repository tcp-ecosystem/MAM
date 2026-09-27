# sdk/c — Task

## Goal
Create the MAM C SDK, following the structure of `sdk/go` and the shared SDK
contract used by the other language bindings.

## Blocker: no C toolchain
`gcc`, `g++`, `cmake`, and `make` are all absent and must not be installed.
The SDK therefore **cannot be compiled or run here**. Static verification is
substituted, and `update.md` must say so plainly rather than implying a build
succeeded.

## Shared contract (majority convention, not Go's)
- `FrontMatter`: `name`, `authors[]`, `version`, `description`, `schema_version`, `license`, `tags[]`, `dependencies[]`, `metadata`. **Not** `title`/`author`, which is `sdk/go`'s deviation.
- 19 standard `SectionKind` variants plus `Custom`, so 20 in total.
- `ValidationResult` exposes `is_valid`; `Diagnostic` exposes `severity`, `message`, `line`, `section`.
- `ExecutionResult` exposes `exit_code`, `stdout`, `stderr`, `duration_ms`.
- Six support modules mirroring `sdk/go/mam/`: config, cache, format, graph, template, doctor.
- Every folder gets `README.md`, `task.md`, `update.md`, source, tests.

## Plan
1. `include/mam/mam.h` — public API with the ownership contract documented up front.
2. `include/mam/support.h` — public API for the six support modules.
3. `src/internal.h` — translation-unit-shared declarations, not installed.
4. `src/util.c` — string helpers plus the YAML-subset reader.
5. `src/ast.c` — value types, accessors, error slot, module lifecycle.
6. `src/parser.c` — front matter and section scanning.
7. `src/validator.c` — specification checks.
8. `src/runtime.c` — subprocess execution.
9. `src/format.c`, `src/cache.c`, `src/config.c`, `src/graph.c`, `src/template.c`, `src/doctor.c`.
10. `tests/` — four suites over a tiny shared assertion header, no framework.
11. `Makefile` — static library, test binaries, `make test`, `SANITIZE` and `COVERAGE` switches.

## Constraints
- C11, no third-party dependencies. YAML is parsed by hand for the subset MAM uses.
- Every object has a matching `mam_*_free`; every getter returns a borrowed pointer; every `char *` result is documented as owned or borrowed.
- No build output committed.

## Verification (no compiler available)
- **Delimiter balance** with string, char, raw-string, and nested-comment awareness.
- **Ownership audit**: every parameter is referenced in its function body; every non-static definition is declared in a header; every allocating constructor has a matching free.
- **Declaration/definition cross-check**: nothing declared without a definition (a link error waiting to happen), nothing defined without a prototype.
- **Struct field check**: every `->field` access resolves to a real field.
- Each checker is regression-tested against known-good and known-bad inputs before being trusted.

This is strictly weaker than compiling: it cannot catch type mismatches, missing returns, or link errors between translation units beyond the symbol-level cross-check above.
