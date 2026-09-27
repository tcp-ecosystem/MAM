# sdk/c — Update

## ⚠️ Never compiled

**No C toolchain is installed on this machine** — `gcc`, `g++`, `cmake`, and
`make` are all absent — and installing one was explicitly out of scope. The
crate additionally has no third-party dependencies, so a toolchain alone would
have sufficed; none was available.

The following were **not** run, and their results are unknown:

- `make` — nothing has been compiled
- `make test` — the 240 assertions below have never executed
- compiler warnings under `-Wall -Wextra -Wpedantic -Wshadow -Wstrict-prototypes`
- AddressSanitizer and UndefinedBehaviorSanitizer, which the Makefile supports
  via `make SANITIZE=1` and which would be the fastest way to prove the
  ownership rules hold

Treat the first `make test` as the real verification step.

## What was verified instead

Four purpose-built static checkers, each regression-tested against known-good
and known-bad inputs before being trusted (two of them were found to have bugs
during that process and were fixed):

| Checker | Catches | Result |
| --- | --- | --- |
| `ccccheck` | Unbalanced `{}`/`()`/`[]`, aware of strings, char literals, raw strings, and nested block comments; missing header guards | PASS, 0 errors, 21 files |
| `caudit` | Parameters never referenced in their function body; non-static definitions with no prototype; allocating constructors with no matching free | PASS, 0 issues |
| `cxref` | Prototypes with no definition (a link error), and definitions with no prototype | PASS, 0 mismatches — 52 prototypes, 52 public definitions, 30 static |
| struct-field check | Every `->field` access resolving to a real field of that struct | PASS — 20 structs, all accesses valid |

**What none of this can catch:** type mismatches, wrong argument counts, missing
`return` on some paths, link errors other than missing symbols, and anything the
compiler's data-flow analysis would flag. The C SDK is the least verified package
in this series for exactly that reason.

## Files

| File | Lines | Purpose |
| --- | --- | --- |
| `include/mam/mam.h` | 546 | Public API: types, parser, validator, runtime. Ownership contract documented in the file header. |
| `include/mam/support.h` | 325 | Public API for the six support modules |
| `src/internal.h` | 105 | Translation-unit-shared declarations, not installed |
| `src/ast.c` | 590 | Value types, accessors, error slot, module lifecycle, section-kind table |
| `src/parser.c` | 780 | Front matter and Markdown section scanning |
| `src/validator.c` | 428 | Specification checks |
| `src/runtime.c` | 338 | Subprocess execution of code blocks |
| `src/format.c` | 338 | Human-readable renderings |
| `src/config.c` | 581 | Config with a hand-rolled JSON reader and writer |
| `src/cache.c` | 329 | TTL string cache with FNV-1a key hashing |
| `src/graph.c` | 345 | Structural graph with a cycle-detecting topological sort |
| `src/template.c` | 485 | Starter templates, placeholder rendering, name validation |
| `src/doctor.c` | 251 | Environment probes (never executes anything) |
| `src/util.c` | 340 | String helpers and the YAML-subset reader |
| `tests/test_support.h` | 78 | Minimal assertion harness, no framework |
| `tests/test_parser.c` | 243 | Parser and AST suite |
| `tests/test_validator.c` | 233 | Validator suite |
| `tests/test_runtime.c` | 255 | Runtime, cache, format, doctor suite |
| `tests/test_support_modules.c` | 334 | Config, graph, template suite |
| `Makefile` | 79 | Library, tests, `SANITIZE`/`COVERAGE` switches |
| `README.md` | 178 | API tour and ownership guide |
| `task.md` | 46 | The plan this implements |

**240 assertions** across four suites, each built as a standalone binary that
returns non-zero on failure.

## Memory ownership

The API follows one rule, documented at length in `mam.h`:

- Owned objects are released by their matching `mam_*_free`. 52 public functions,
  every allocating one paired.
- Getters return borrowed pointers valid only while the parent lives.
- Functions returning `char *` hand ownership to the caller, who uses `free()`.

One deliberate exception: `mam_module_summary` returns SDK-owned storage that is
replaced on the next call. It is documented as such in the header and the README,
and `mam_format_module_summary` is provided for callers who need a rendering they
own. Returning a pointer into the module's own storage was rejected because that
pointer would dangle the moment the module is freed.

No external dependency is used. The front matter reader handles the YAML subset
MAM actually needs — `key: value`, quoted strings with escapes, inline `[a, b]`
sequences — and skips block scalars rather than guessing at them.

## Naming convention

`FrontMatter` uses `name` and `authors[]`, matching the majority of the MAM
SDKs (javascript, python, rust). `sdk/go` uses `title`/`author` and is the
outlier; that divergence is recorded rather than propagated.

## Risks to check on first build, in order

1. **Type mismatches.** Nothing type-checks the code. A wrong argument type or a
   missing `const` will surface immediately.
2. **Missing `return` paths.** `caudit` cannot detect a fall-off-the-end in a
   non-`void` function. The accessors in `ast.c` are the densest cluster of
   early returns and are the most likely place for this to bite.
3. **`-Wpedantic` on the `mam_node_t` union.** Tagged-union accessors read
   through `as.heading`, `as.text`, and so on. Under strict C11 this is legal,
   but reading the wrong member is undefined behaviour at runtime, which no
   amount of compiling will catch — only a test that exercises each node type
   will, and the parser suite does create each variant.
4. **Warnings under `-Wshadow`.** The parser and validator both use `size_t i`
   in nested scopes. These are legal but may warn.
5. **Test expectations.** 240 assertions have never run. Expect to adjust
   several. The `Makefile` reports per-suite totals so failures localise quickly.
6. **Leak checking.** Run `make SANITIZE=1 test` first. The ownership rules are
   consistent and were audited symbol by symbol, but only a leak checker proves
   them, and the cache/graph/config paths allocate in loops.

## Recommended first commands

```sh
make                 # expect warnings; fix them
make test            # expect a handful of failing assertions
make SANITIZE=1 test # expect leaks if any rule was missed
```
