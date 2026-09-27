# MAM C SDK

A dependency-free C11 SDK for [MAM (Markdown as Module)](../../spec/SPEC.md).

It parses a `.mam.md` document into a tree you can walk, validates that tree
against the specification, and executes its code blocks. Nothing outside the C
standard library is required, so the SDK can be vendored into a project without
adding a package to its build.

## Status

**This package has never been compiled.** No C toolchain (`gcc`, `clang`,
`cmake`) is installed on the machine where it was written, so `make`, `make
test`, and every compiler warning are unverified. See `update.md` for the static
checks that were run in place of a compiler, and for the most likely first-build
failures.

## Layout

| Path | Purpose |
| --- | --- |
| `include/mam/mam.h` | Public API: types, parser, validator, runtime |
| `include/mam/support.h` | Public API: config, cache, format, graph, template, doctor |
| `src/ast.c` | Value types, accessors, the thread-local error slot |
| `src/parser.c` | Front matter and Markdown section scanning |
| `src/validator.c` | Specification checks |
| `src/runtime.c` | Subprocess execution of code blocks |
| `src/format.c` | Human-readable renderings |
| `src/cache.c` | TTL string cache |
| `src/config.c` | SDK configuration with a hand-rolled JSON reader/writer |
| `src/graph.c` | Structural graph with a topological sort |
| `src/template.c` | Starter templates and placeholder rendering |
| `src/doctor.c` | Environment self-checks |
| `src/util.c` | Shared string and YAML-subset helpers |
| `src/internal.h` | Declarations shared between translation units (not installed) |
| `tests/` | Four suites, built as standalone binaries |

## Building

```sh
make            # static library plus test binaries
make test       # build and run every suite
make clean      # remove build output
```

No configure step and no dependency download. Useful overrides:

```sh
make CC=clang
make SANITIZE=1      # AddressSanitizer plus UndefinedBehaviorSanitizer
make COVERAGE=1      # gcov instrumentation
```

## Memory ownership

The whole API follows one rule, documented at length in `mam.h`:

- A function returning an **owned** object hands ownership to the caller. Release
  it with the matching `mam_*_free`.
- A getter returning `const char *` returns a **borrowed** pointer. It is valid
  only while its parent object lives, must not be freed, and must not outlive
  the parent.
- A function documented as returning `char *` gives the caller an owned string
  to release with `free()`.

Every getter follows that rule. The single deliberate exception is
`mam_module_summary`, which returns a pointer into SDK-owned storage that is
replaced by the next call; it is documented as such in `mam.h`. Use
`mam_format_module_summary` when you want a rendering you own, which is what the
example below does.

```c
mam_module_t *module = mam_parse_file("agent.mam.md");
if (module == NULL) {
    fprintf(stderr, "%s\n", mam_last_error()->message);
    return 1;
}

mam_validation_result_t *report = mam_validation_run(module, true);
if (!mam_validation_is_valid(report)) {
    mam_validation_print(report, stderr);   /* borrowed strings */
}

char *summary = mam_format_module_summary(module);   /* owned */
printf("%s\n", summary);
free(summary);

mam_validation_free(report);
mam_module_free(module);
```

Objects are not reference counted and are not thread safe. The only shared state
is `mam_last_error`, which is a `static` in `ast.c` and therefore per-process
rather than per-thread; if you parse from several threads, pass your own
`mam_error_t` out-parameter instead of reading the global.

## Usage

### Parse

```c
mam_module_t *module = mam_parse_string(source, "inline.mam.md", NULL);
mam_parser_t *parser = mam_parser_new();          /* reuse across documents */
mam_module_t *again = mam_parse_string_with(parser, source, NULL, &error);
```

Unrecognised headings are preserved as `MAM_SECTION_CUSTOM` rather than dropped,
so a document with a typo still yields a usable tree. A malformed front matter
block is reported through `mam_error_t`; pass
`mam_parser_config_t::require_frontmatter_delimiter` to make it fatal instead.

### Validate

```c
mam_validation_result_t *result = mam_validation_run(module, /* strict */ true);
size_t errors = mam_validation_count_at(result, MAM_SEVERITY_ERROR);
char *summary = mam_validation_summary(result);   /* "2 errors, 1 warning" */
```

### Execute

```c
mam_runtime_config_t config = mam_runtime_config_default();
mam_execution_result_t *ran = mam_execute_section(module, MAM_SECTION_PYTHON,
                                                   &config, &error);
if (ran != NULL && mam_execution_is_success(ran)) {
    printf("%s", mam_execution_stdout(ran));
}
```

An unsupported language is not an error: the result comes back with exit code
127 and an explanatory `stderr`, so a module can be validated on a machine that
lacks every interpreter.

### Support modules

```c
mam_config_t *config = mam_config_default();
char **targets = mam_config_list_targets(&count);

mam_cache_t *cache = mam_cache_new(300);
mam_cache_set(cache, "module:a", rendered);

mam_graph_t *graph = mam_graph_build(module);
char **order = NULL;
size_t n = mam_graph_topological_sort(graph, &order);

char *starter = mam_template_new_module("my-agent", "agent", "python");

mam_doctor_report_t *doctor = mam_doctor_run(NULL);
```

`mam_doctor_run` never executes anything; it only asks the operating system
whether a command resolves on `PATH`, so it is safe in a build script.

## YAML support

Front matter is parsed by a small hand-rolled reader supporting the subset MAM
actually uses: `key: value` scalars, quoted strings with escapes, integers,
booleans, null, and inline `[a, b]` sequences. Block scalars (`|`, `>`) are
skipped. Anything more exotic is preserved as raw text rather than guessed at.
If you need full YAML, post-process the `raw_content` of the module.

## Section kinds

There are 19 standard kinds plus `MAM_SECTION_CUSTOM`, giving 20 variants:

```
metadata purpose inputs outputs rules workflow mermaid python prompt memory
examples tests references dependencies exports imports plugins permissions
capabilities
```

## Naming convention

`FrontMatter` uses `name` and `authors`, not `title` and `author`. That matches
the majority of the MAM SDKs (javascript, python, rust); the Go SDK is the
outlier and is documented as such.
