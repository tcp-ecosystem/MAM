# sdk/rust — Update

## ⚠️ NOT COMPILED — read this first

**Nothing in this package has been compiler-verified.** Rust is not installed on this machine and was explicitly not to be installed. There is no `cargo`, no `rustc`, and no `~/.rustup`. The crate also declares 12 external dependencies, so it could not be built even if a compiler were present.

Specifically, the following were **not** run and their results are unknown:

- `cargo build` — compilation status unknown
- `cargo test` — the 133 `#[test]` functions below have never executed
- `cargo clippy` — lint status unknown
- `cargo fmt` — formatting not applied

This is materially weaker than the `sdk/javascript` and `sdk/python` work in this same series, where typecheck and the full test suite actually ran. Treat the first `cargo build` as the real verification step for this package.

### What was done instead
A purpose-built static checker was written and run over all 12 files. It is a structural check, **not** a compiler:

| Check | What it catches |
| --- | --- |
| Delimiter balance | Unbalanced `{}`, `()`, `[]`, with string, raw-string, char-literal, lifetime, and nested-block-comment awareness |
| Struct-variant fields | A bare type in a struct variant (the `plugins.rs` bug class) |
| `pub use` resolution | Re-exported names that do not exist in the target module |
| `crate::` path resolution | Cross-module references to non-existent items |
| Dependency audit | Any crate referenced but not declared in `Cargo.toml` |

The checker was itself regression-tested: it is confirmed to detect a bare-type variant, a bad re-export, a bad `crate::` path, and delimiter imbalance, while not false-positiving on struct literals such as `Self { .. }`, on char literals such as `')'`, or on lifetimes such as `fn f<'a>(..)`.

**What this cannot catch:** type mismatches, trait-bound errors, borrow-checker errors, lifetime errors, wrong argument counts, and moved values. The code was written to minimize exposure to these — simple `std`-only code, no `unsafe`, no new trait objects, no new generic bounds, and owned `String`s in the algorithm that would otherwise be borrow-sensitive (see `graph.rs::topological_sort`).

Current checker result: **PASS, 0 structural errors across 12 files.**

## Pre-existing defects fixed
The crate could not have built as it stood. Two defects predating this work:

1. **`plugins.rs` did not compile.** `PluginError::ExecutionError` was declared as `ExecutionError { name: String, String }` — a bare type in a struct variant, which the compiler rejects. Fixed to a named field with the `thiserror` format string pointed at it:
   ```rust
   #[error("Plugin '{name}' execution error: {message}")]
   ExecutionError { name: String, message: String },
   ```
2. **`parser.rs` had a failing test.** `test_parse_with_frontmatter` fed a fixture declaring `version: 2.0.0` but asserted `Some("1.0.0")`. This is the same fixture-version drift already corrected in `sdk/javascript` and `sdk/python`. Corrected to `Some("2.0.0")`.

Because Rust was never available, these bugs had gone unnoticed — strong evidence the package had never been built.

## Existing files — 7 new features each, additive
No existing function body was modified except the two repairs above.

| File | Before | After | New features |
| --- | --- | --- | --- |
| `src/ast.rs` | 281 | 415 | `has_front_matter`, `section_count`, `count_code_blocks`, `code_block_languages`, `find_section_by_title`, `is_standard_section`, `total_content_nodes` |
| `src/parser.rs` | 335 | 577 | `parse_mam`, `extract_front_matter_text`, `split_sections`, `count_headings`, `extract_code_blocks`, `strip_code_blocks`, `normalize_mam`, `detect_runtime` |
| `src/validator.rs` | 361 | 533 | `count_by_severity`, `has_errors`, `has_warnings`, `diagnostics_of_severity`, `diagnostic_messages`, `result_is_valid`, `summarize_result` |
| `src/runtime.rs` | 225 | 416 | `result_is_success`, `collect_languages`, `collect_failures`, `count_successes`, `total_duration_ms`, `summarize_execution`, `format_execution_output` |
| `src/plugins.rs` | 396 | 536 | `plugin_names`, `enabled_plugin_names`, `registry_has_plugin`, `plugin_version`, `hook_count_for`, `filter_by_enabled`, `describe_plugins` |
| `src/lib.rs` | 64 | 198 | `module_name`, `module_summary`, `module_is_valid`, `module_section_names`, `module_code_languages`, `parse_with_source`, `sdk_info` |

Notes on two of these:
- `runtime.rs::collect_languages` deliberately takes a `&Module`, not the execution map, because `ExecutionResult` does not record which language produced it. The doc comment says so.
- `plugins.rs::hook_count_for` reads the private `plugins` field of `PluginRegistry`, which is legal because these free functions live in the same module.

## New files — all ≥ 300 lines, `std` + already-declared `serde` only

| File | Lines | Tests | Contents |
| --- | --- | --- | --- |
| `src/config.rs` | 532 | 12 | `SdkConfig` (`to_json`, `from_json_value`, `get`, `copy_config`), `ConfigError` (manual `Display` + `Error`), `validate_sdk_config`, `merge_sdk_configs`, `find_sdk_config` (walks ancestors), `resolve_sdk_config_path` (honors `MAM_SDK_CONFIG`), `load_sdk_config`, `save_sdk_config`, `normalize_target`, `is_supported_target`, `list_sdk_targets` |
| `src/cache.rs` | 637 | 13 | `CacheEntry`, `CacheStats`, `CacheError`, `ResultCache` (`get`/`set`/`set_with_ttl`/`get_or_set`/`has`/`delete`/`clear`/`prune`/`keys`/`stats`/`hit_rate`/`remaining_ttl`/`save_to_file`/`load_from_file`), `create_result_cache`, `hash_cache_key` (FNV-1a, NUL-delimited), `format_cache_stats`, `is_valid_cache_key`, `default_cache_path` |
| `src/format.rs` | 462 | 10 | `format_module_summary`, `format_ast_json`, `format_section_list`, `format_toc`, `format_code_block_list`, `format_front_matter`, `format_dependency_table`, `format_validation_report`, `format_diagnostics`, `format_execution_report`, `format_content_breakdown`, `format_section_text` |
| `src/graph.rs` | 552 | 10 | `GraphNode`, `GraphEdge`, `DependencyGraph`, `build_graph`, `topological_sort` (cycle-detecting, deterministic), `node_names`, `successors`, `predecessors`, `has_edge`, `edge_labels`, `root_nodes`, `leaf_nodes`, `nodes_of_kind`, `count_edges_by_label`, `count_nodes_by_kind`, `reachable_from`, `summarize_graph`, `format_graph_text` |
| `src/template.rs` | 547 | 12 | `STARTER_KINDS`, `TemplateError`, `list_starter_kinds`, `resolve_starter_kind` (aliases `mod`/`bot`/`assistant`/`util`/`cli`/…), `get_starter_template` (module/agent/tool), `render_starter` (hand-rolled scanner, case-insensitive, preserves unknown placeholders and non-identifier braces), `starter_variables`, `slugify`, `validate_starter_name`, `default_variables`, `new_module_starter`, `render_all_starters` |
| `src/diagnostics.rs` | 442 | 11 | `DiagnosticStatus`, `DiagnosticCheck`, `DiagnosticReport`, `KNOWN_COMMANDS`, `command_exists` (resolves on `PATH`, **never executes**), `check_language_runtimes`, `check_sdk_config`, `check_config_discovery`, `check_config_value`, `check_environment`, `run_diagnostics`, `format_diagnostics` |

### Dependency audit
`Cargo.toml` is **unchanged** (`git diff` empty). The only external crate referenced by any new file is `serde_json`, which was already declared. The new files use no `tokio`, `pest`, `libloading`, `uuid`, `chrono`, `dirs`, `dyn-clone`, or `regex`.

### Wiring
`lib.rs` gained six `pub mod` lines and re-exports the new public API. The checker's `pub use` resolution confirms every re-exported name exists in its target module.

## Tests
| File | Pre-existing | New | Total |
| --- | --- | --- | --- |
| `ast.rs` | 4 | 7 | 11 |
| `parser.rs` | 5 | 7 | 12 |
| `validator.rs` | 5 | 7 | 12 |
| `runtime.rs` | 3 | 7 | 10 |
| `plugins.rs` | 4 | 7 | 11 |
| `lib.rs` | 2 | 7 | 9 |
| `config.rs` | — | 12 | 12 |
| `cache.rs` | — | 13 | 13 |
| `format.rs` | — | 10 | 10 |
| `graph.rs` | — | 10 | 10 |
| `template.rs` | — | 12 | 12 |
| `diagnostics.rs` | — | 11 | 11 |
| **Total** | **23** | **110** | **133** |

Every existing file gained at least 7; every new file has at least 10. Tests are inline `#[cfg(test)] mod tests`, matching the existing convention — this package has no `tests/` integration directory.

**None of these 133 tests have been executed.**

## Risks to check on first build
Called out honestly, ordered by likelihood:

1. **Type inference in the `serde_json` paths.** `config.rs` and `cache.rs` build `serde_json::Value` by hand. Constructors like `serde_json::json!` and `Value::Object(Map::new())` are standard, but exact inference is the most likely place for a first-build error.
2. **Borrow-checker in `graph.rs::topological_sort`.** Deliberately written with owned `String` keys and a `Copy` position closure to avoid overlapping borrows. Reviewed by hand, but unproven.
3. **Match ergonomics.** I removed every `Some(Enum::Variant(binding))`-against-`Option<&T>` pattern in favour of `and_then(|item| item.as_str())` / `as_bool()` / `as_u64()`, which cannot mis-bind. Worth a scan on build.
4. **Unused-import warnings.** `plugins.rs` imports `Section` and `validator.rs` tests import `CodeBlock`/`ContentNode`/`Section` that may be unused. These are pre-existing and are warnings, not errors.
5. **Test-expectation drift.** Since the tests never ran, assertions in the 110 new tests may encode an incorrect expectation about runtime behavior even where the code compiles. The pre-existing `version` bug in `parser.rs` is direct evidence that untested assertions in this repo do go stale.
6. **`format.rs` and `graph.rs` format-string arity.** Many `format!` calls with several arguments; a mismatch is a compile error that only shows on build.

## Recommended next step
Install the toolchain and run the gates for real:
```
cargo build
cargo test
cargo clippy -- -D warnings
```
Expect to spend a short pass fixing items 1-3 and any test expectations from item 5. Items 1-3 are the code; item 5 is inherent to writing tests without executing them.
