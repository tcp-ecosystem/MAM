# MAM C++ SDK

A C++17 SDK for [MAM (Markdown as Module)](../../spec/SPEC.md), implemented as
an RAII wrapper over the [C SDK](../c).

## Status

**This package has never been compiled.** No C or C++ toolchain is installed on
the machine where it was written, so `cmake`, the build, and the test suite are
all unverified. `update.md` records the static checks that were run instead and
the failures to expect on the first build.

## Design

This is a wrapper, not a second implementation. Parsing, validation, execution,
and the support modules all live in `sdk/c`; `sdk/cpp` translates them into
idiomatic C++:

- **Move-only ownership.** Every C object is held by a C++ class whose
  destructor calls the matching `mam_*_free`. Copy construction and copy
  assignment are `= delete`d, so double-free is impossible by construction.
- **No C types leak.** Every public signature is built from `std::string`,
  `std::string_view`, `std::vector`, `std::optional`, and plain enums.
- **Borrowing is explicit.** Accessors return `std::string_view` borrowed from
  the owning object; anything that must outlive its owner returns a
  `std::string` instead. The header documents which is which per function.
- **Errors are exceptions.** `mam::Error` derives from `std::runtime_error` and
  carries the underlying `mam_status_t`, retrievable via `status()`.

## Building

The C SDK is compiled into the C++ library, so a plain checkout builds with
nothing installed:

```sh
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Options:

```sh
-DMAM_CPP_BUILD_TESTS=OFF    skip the test target
-DMAM_CPP_SANITIZE=ON         AddressSanitizer plus UndefinedBehaviorSanitizer
-DCMAKE_BUILD_TYPE=Debug     unoptimised build with assertions
```

`sdk/c` and `sdk/cpp` must be checked out side by side; `CMakeLists.txt` fails
with a clear message if the C SDK is missing.

## Usage

```cpp
#include "mam/mam.hpp"

int main()
{
    try {
        mam::Module module(R"doc(---
name: demo
version: 2.0.0
runtime: python
---

## Purpose

Does a thing.

## Python

```python
print("hello")
```
)doc",
                            "demo.mam.md");

        mam::ValidationResult report(module, /* strict */ true);
        if (!report.is_valid()) {
            std::cerr << report.report();
            return 1;
        }

        for (const mam::Section &section : module.sections()) {
            std::cout << section.title() << ": " << section.content().size() << " nodes\n";
        }

        auto results = mam::execute_all(module);
        for (const auto &[name, outcome] : results) {
            std::cout << name << " -> " << outcome.exit_code << "\n";
        }
    } catch (const mam::Error &error) {
        std::cerr << "mam failed (" << error.status() << "): " << error.what() << "\n";
        return 1;
    }
}
```

### Borrowed versus owned

```cpp
mam::Module module(source, "demo.mam.md");

// Borrowed: valid while `module` lives.
std::string_view name = module.name();
auto titles = module.section_names();          // std::vector<std::string>, owned

// Owned: safe after `module` is destroyed.
std::string summary = module.summary();
```

Returning `std::vector<std::string>` from `section_names()` rather than a vector
of views is deliberate: titles outlive the module in most call sites, and
copying a handful of short strings is cheaper than the aliasing bug it prevents.

### Move semantics

```cpp
mam::Module first(source, "a.mam.md");
mam::Module second = std::move(first);   // first is now empty, second owns the tree
```

The owning types define both a move constructor and a move assignment, and
self-move-assignment is safe. The test suite exercises both, since a hand-written
move assignment is the most likely place for this wrapper to leak or double-free.

## Support modules

```cpp
mam::Cache cache(300);                    // TTL string cache
mam::Graph graph(module);                 // structural graph, topological order
mam::Config config = mam::Config::defaults();
mam::DoctorReport health = mam::doctor(); // environment probes, never executes
std::string starter = mam::template_::new_module("my-agent", "agent", "python");
```

`mam::doctor()` only asks the operating system whether a command resolves on
`PATH`; it never runs anything, so it is safe in a build script.

## Conventions inherited from the C core

- `FrontMatter` uses `name` and `authors`, matching the javascript, python, and
  rust SDKs. `sdk/go` is the outlier.
- 19 standard section kinds plus `Custom`. The 19 are `metadata`, `purpose`,
  `inputs`, `outputs`, `rules`, `workflow`, `mermaid`, `python`, `prompt`,
  `memory`, `examples`, `tests`, `references`, `dependencies`, `exports`,
  `imports`, `plugins`, `permissions`, `capabilities` — resolved by the C core's
  `mam_section_kind_from_string`, which the wrapper re-exports.
- YAML support is the subset the C core handles; see `sdk/c/README.md`.

## Namespace note

The starter-template functions live in `mam::template_` rather than `mam::template`
because `template` is a reserved word. The trailing underscore is a conventional
way to keep the name recognisable.
