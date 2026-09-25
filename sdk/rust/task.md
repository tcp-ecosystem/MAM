# sdk/rust — Task

## Goal
Apply the same hardening pattern used for `sdk/javascript` and `sdk/python` to the MAM Rust SDK.

## CRITICAL CONSTRAINT: no Rust toolchain
**Rust is not installed on this machine and must not be installed.** There is no `cargo`, no `rustc`, and no `~/.rustup`. The crate also declares 12 external dependencies, so it cannot be compiled even if a compiler were present.

Consequences, accepted up front:
- **No `cargo build`, `cargo test`, `cargo clippy`, or `cargo fmt` can be run.** Nothing in this package is compiler-verified.
- Static verification is used instead (see "Verification" below), and `update.md` must state this limitation plainly rather than implying the code was compiled.
- Code is therefore restricted to **simple, conservative Rust**: `std` plus the already-declared `serde`/`serde_json`/`serde_yaml`. No lifetimes beyond those already in the signatures, no complex generics, no `unsafe`, no new trait objects.
- **No new dependencies.** `Cargo.toml` is not modified.
- Additive-only: no existing function body is edited except where a pre-existing defect must be repaired (see Step 1).

## Pre-existing defects found during review
These exist before any of this work and must be fixed for the crate to even build:

1. **`plugins.rs:12` is not valid Rust.** `ExecutionError { name: String, String }` declares a bare type in a struct variant, which the compiler rejects. Fix: name the second field and point the `thiserror` format string at it.
2. **`parser.rs:301` is a stale assertion.** The fixture declares `version: 2.0.0` but the assertion expects `Some("1.0.0")`, so the test fails at runtime. This is the same fixture-version drift already corrected in `sdk/javascript` and `sdk/python`.

## Verification (static, no compiler)
A custom Python checker is used to substitute for `rustc`:
- **Delimiter balance** with string, char, raw-string, and comment awareness across every `.rs` file.
- **Struct-variant field sanity** to catch the `plugins.rs:12` class of error anywhere else.
- **Cross-reference resolution**: every `use crate::<module>::<Item>` resolves to a real `pub` item; every `SectionKind::Variant` referenced exists in the enum; every field/field-name referenced on a type exists on that type.
- **No-new-dependency audit**: confirm `Cargo.toml` is unchanged and no new external crate is referenced.
- **Test inventory**: count `#[test]` fns per module against the target.

This is strictly weaker than compiling. It cannot catch type errors, trait-bound problems, borrow errors, or lifetime errors.

## Step 1 — Repair pre-existing defects
- `plugins.rs`: fix the `PluginError::ExecutionError` variant.
- `parser.rs`: fix the stale `version` assertion.

## Step 2 — 7 new features per existing source file (6 files), additive

| File | New features |
| --- | --- |
| `src/ast.rs` | `has_front_matter`, `section_count`, `count_code_blocks`, `code_block_languages`, `find_section_by_title`, `is_standard_section`, `total_content_nodes` |
| `src/parser.rs` | `parse_mam`, `extract_front_matter_text`, `split_sections`, `count_headings`, `extract_code_blocks`, `strip_code_blocks`, `normalize_mam`, `detect_runtime` |
| `src/validator.rs` | `count_by_severity`, `has_errors`, `has_warnings`, `diagnostics_of_severity`, `diagnostic_messages`, `result_is_valid`, `summarize_result` |
| `src/runtime.rs` | `result_is_success`, `collect_languages`, `collect_failures`, `count_successes`, `total_duration_ms`, `summarize_execution`, `format_execution_output` |
| `src/plugins.rs` | `plugin_names`, `enabled_plugin_names`, `registry_has_plugin`, `plugin_version`, `hook_count_for`, `filter_by_enabled`, `describe_plugins` |
| `src/lib.rs` | `module_name`, `module_summary`, `module_is_valid`, `module_section_names`, `module_code_languages`, `parse_with_source`, `sdk_info` |

## Step 3 — 6 new source files (≥ 300 lines each), `std` + existing serde only
- `src/config.rs` — SDK config load/save/validate/merge, target registry, path resolution.
- `src/cache.rs` — TTL result cache, key hashing, stats, pruning, JSON persistence.
- `src/format.rs` — text formatters for modules, sections, validation reports, execution output.
- `src/graph.rs` — dependency graph builder, topological sort with cycle detection, query helpers.
- `src/template.rs` — starter templates, placeholder rendering, name validation.
- `src/diagnostics.rs` — self-checks: interpreter-independent health, config health, runtime availability.

## Step 4 — Wire into `lib.rs`
Add the 6 `pub mod` lines and re-export the new public API.

## Step 5 — Tests
- ≥ 7 new `#[test]` functions in each existing `#[cfg(test)] mod tests` (6 files).
- New `#[cfg(test)]` modules inside each new file, ≥ 7 tests each.

## Step 6 — Static verification + docs
- Run the static checker over all files; fix everything it reports.
- Write `update.md` with an explicit "not compiled" warning.
