# sdk/cpp — Update

## ⚠️ Never compiled

**No C or C++ toolchain is installed** — `gcc`, `g++`, `clang`, and `cmake` are
all absent — and installing one was out of scope.

Not run, results unknown:

- `cmake -S . -B build` — nothing has been configured or compiled
- `cmake --build build` — no compilation diagnostics
- `ctest` — the ~150 assertions in `tests/test_mam.cpp` have never executed
- The `MAM_CPP_SANITIZE=ON` path, which is the fastest way to prove the hand-written move semantics are leak-free

The first `cmake --build` is the real verification step. Expect to fix
compilation errors; expect the move-semantics tests to be the ones worth
trusting only after a sanitizer run.

## What was verified instead

The C SDK's static checkers, which understand C++ raw strings and `extern "C"`
blocks, plus checks written for this package:

| Check | Result |
| --- | --- |
| Delimiter balance across `.hpp` and `.cpp`, raw-string and `extern "C"` aware | PASS, 0 errors, 3 files |
| Every method declared in the header is defined in `mam.cpp` | PASS |
| Every owning class defines a destructor and deletes copy operations | PASS — 4 owning types (`Module`, `Cache`, `Graph`, `Config`) |
| Every `std::free` has `<cstdlib>` in scope | PASS after adding the include |
| CMake source list matches the files actually in `sdk/c/src` | PASS — exact match, 11 files |
| `CMakeLists.txt` is well-formed enough to parse the guard it depends on | PASS |

**What this cannot catch:** type errors, missing overloads, template
instantiation failures, `std::string_view` dangling, and anything requiring
semantic analysis. The wrapper is thin, which limits the blast radius, but the
code is still unproven.

## Files

| File | Lines | Purpose |
| --- | --- | --- |
| `include/mam/mam.hpp` | 579 | Public surface: errors, views, and move-only owners |
| `src/mam.cpp` | 1140 | Translation layer, including all move operations |
| `tests/test_mam.cpp` | 330 | Suite over a small harness, no framework |
| `CMakeLists.txt` | 113 | Builds the C core plus the wrapper, ctest, install rules |
| `README.md` | 140 | Design rationale and usage |
| `task.md` | 51 | The plan this implements |

## Design: wrap, do not reimplement

`sdk/c` already implements the full contract, so re-implementing it in C++ would
double the surface area and double the volume of unverified code. This package
is therefore a translation layer:

| C concept | C++ equivalent | Ownership |
| --- | --- | --- |
| `mam_module_t *` | `mam::Module` | Move-only; destructor calls `mam_module_free` |
| `mam_validation_result_t *` | `mam::ValidationResult` | Findings **copied** into `std::vector<Diagnostic>`, so the result outlives the module |
| `mam_execution_result_t *` | `mam::ExecutionResult` | Plain struct, all members owned `std::string` |
| `mam_cache_t *` | `mam::Cache` | Move-only |
| `mam_graph_t *` | `mam::Graph` | Move-only |
| `mam_config_t *` | `mam::Config` | Move-only |
| `const char *` getter | `std::string_view` | Borrowed, invalid when the parent dies |
| `char *` owned result | `std::string` | Owned, freed with `std::free` immediately |
| `mam_status_t` | `mam::Error` | Thrown; carries the status via `error.status()` |

`Module`, `Cache`, `Graph`, and `Config` all `= delete` copy operations, so
double-free cannot happen through ordinary use.

One deliberate inconsistency inside the wrapper, made for safety rather than
uniformity: `ValidationResult` copies its findings out of the C result instead of
borrowing views. A validation report is usually printed after the module goes out
of scope, and borrowing there would be a trap. `Module::section_names()` does the
same for titles.

## Risks to check on first build, in order

1. **Type errors across the boundary.** Nothing type-checks `mam.hpp` against
   `mam.h`. A mismatched enum or a wrong `size_t`/`std::size_t` will surface here.
2. **Missing `<cstdlib>` / `<cstring>`.** Both were added after an audit found
   `std::free` and `std::memset` in use without them, but the audit was textual.
3. **`std::string_view` lifetime.** `mam_module_name` returns a pointer into the
   module; the views built on it are valid only while the module lives. The suite
   checks the happy path but a dangling-view test under ASan is the real proof.
4. **Move assignment.** Hand-written for four types. Self-move-assignment is
   tested, but the leak check is what matters — run with `-DMAM_CPP_SANITIZE=ON`.
5. **Test expectations.** The suite has never run. Expect several to need
   adjusting, particularly around `execute_all` and anything gated on an
   installed interpreter.
6. **`extern "C"` placement.** The C headers are wrapped in `extern "C" { }` in
   the public header. If either C header already provides its own linkage
   specification this is still correct, but it is worth a glance.

## Recommended first commands

```sh
cmake -S . -B build
cmake --build build            # expect warnings; fix them
ctest --test-dir build         # expect a few failing assertions
cmake -S . -B build-asan -DMAM_CPP_SANITIZE=ON -DCMAKE_BUILD_TYPE=Debug
cmake --build build-asan && ctest --test-dir build-asan   # the real ownership proof
```
