# sdk/cpp — Task

## Goal
Create the MAM C++ SDK as an idiomatic C++17 layer over the C SDK in `sdk/c`.

## Blocker: no C++ toolchain
`g++`, `clang++`, and `cmake` are all absent and must not be installed, so
nothing here can be compiled or run.

## Design decision: wrap, do not reimplement
`sdk/c` already implements parsing, validation, execution, and the six support
modules against the shared contract. Re-implementing that in C++ would double
the surface area to maintain and double the amount of unverified code. Instead
`sdk/cpp` is a thin RAII layer:

- Every C object is owned by a move-only C++ class whose destructor calls the
  matching `mam_*_free`. Copying is deleted, so double-free is impossible by
  construction.
- No C type appears in a public signature, so a caller cannot misuse ownership.
- C strings are exposed as `std::string_view` (borrowed) where the value may be
  copied on demand, and as `std::string` (owned) where it must outlive its
  parent. The header states which is which.
- Errors become `mam::Error`, derived from `std::runtime_error`, carrying the C
  status code.
- The C core is compiled directly into the C++ library by `CMakeLists.txt`, so
  the C++ SDK builds from a checkout with nothing installed.

## Plan
1. `include/mam/mam.hpp` — the full public surface: errors, `FrontMatter`, `Node`, `Section`, `Module`, `ValidationResult`, runtime types, `Cache`, `Graph`, `Config`, `template_`, `DoctorReport`, free functions.
2. `src/mam.cpp` — the translation layer, including move constructors and move assignment for every owning type.
3. `tests/test_mam.cpp` — suite over the harness, with deliberate coverage of move semantics since a hand-written move assignment is the most likely place for a leak or double-free.
4. `CMakeLists.txt` — builds the C core plus the wrapper, `MAM_CPP_SANITIZE` and `MAM_CPP_BUILD_TESTS` options, ctest registration, install rules.
5. `README.md`, `task.md`, `update.md`.

## Constraints
- C++17, no third-party dependencies, no exceptions beyond `mam::Error`.
- The wrapper must not own C memory directly: every allocation goes through the C API and is released by the C free function.
- No build output committed.

## Verification (no compiler available)
Reuse the C SDK's static checkers, extended to understand C++ raw strings and
`extern "C"` blocks, plus:
- every method declared in the header is defined in the translation unit
- every owning class defines a destructor and is non-copyable
- every `mam_*_free` in the wrapper pairs with the `mam_*` constructor beside it
- every `std::free` has `<cstdlib>` in scope

This still cannot catch type errors, missing overloads, or template
instantiation failures. Expect to fix things on the first `cmake` run.
