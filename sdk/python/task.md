# sdk/python — Task

## Goal
Apply the same hardening pattern used for `sdk/javascript` (and previously `ast`, `lsp`, `reference`, `visualization`, `sdk/go`) to the MAM Python SDK.

## Constraints
- **Additive only** — no breaking changes, no edits to existing behavior or signatures.
- **No new dependencies** — only the existing `pyyaml>=6.0` runtime dep.
- **Python 3.10+**, stdlib-first (`hashlib`, `json`, `pathlib`, `re`, `tempfile`, `dataclasses`).
- No inline comments in new code; docstrings are fine and preferred (matches existing module style).
- New source files **≥ 300 lines** each.
- **≥ 7 new test cases per test file** (new and extended alike).
- Write `task.md` (this plan) and `update.md` (results).

## Verification
- `PYTHONPATH=src python -m pytest -q` from `sdk/python`.
- `python -m ruff check .` — lint.
- `python -m mypy` — type check (config lives in `pyproject.toml`).
- `PYTHONPATH=src python -m compileall -q src` as an extra syntax gate.

All four are enforced by the `python-sdk` job added to `.github/workflows/ci.yml`, which runs alongside the untouched `build-test` job.

## Baseline
- Package is not installed in the environment → `PYTHONPATH=src` is required to import `mam`.
- Baseline result: **161 passed, 3 failed, 1 skipped**.
- The 3 failures are pre-existing stale assertions in `tests/test_parser.py` that still expect fixture version `1.0.0` where the fixture now says `2.0.0` (same fixture-version drift already fixed in `sdk/javascript`). These get corrected as part of this work.

## Step 1 — Fix pre-existing failures
- `tests/test_parser.py`: 3 assertions `1.0.0` → `2.0.0`.

## Step 2 — 7 new features per existing source file (6 files)

| File | New features |
| --- | --- |
| `src/mam/ast.py` | `has_front_matter`, `section_count`, `count_code_blocks`, `code_block_languages`, `section_names`, `find_section`, `is_standard_section` |
| `src/mam/parser.py` | `parse_mam_safe`, `extract_front_matter`, `split_sections`, `strip_code_blocks`, `count_headings`, `extract_code_blocks`, `normalize_mam`, `detect_runtime` |
| `src/mam/runtime.py` | `is_success`, `count_successful`, `failed_sections`, `execution_languages`, `summarize_execution`, `total_duration`, `record_execution` |
| `src/mam/validator.py` | `count_issues_by_severity`, `has_errors`, `has_warnings`, `filter_by_severity`, `issue_messages`, `is_valid`, `summarize_issues` |
| `src/mam/plugins.py` | `enabled_plugin_names`, `plugin_has_hook`, `hook_count`, `plugin_meta_dicts`, `sort_plugin_meta`, `find_plugin`, `require_plugin` |
| `src/mam/cli.py` | `build_parser`, `run`, `format_ast`, `format_issues_compact`, `format_module_summary`, `exit_code_for`, `version_header` |

## Step 3 — 6 new source files (≥ 300 lines each)
- `src/mam/config.py` — SDK config load/save/validate/merge, target registry, path resolution.
- `src/mam/cache.py` — TTL result cache, key hashing, stats, hit-rate, pruning, disk persistence.
- `src/mam/format.py` — text formatters for AST, modules, sections, validation reports, execution results.
- `src/mam/graph.py` — dependency graph builder, topological sort with cycle detection, query helpers.
- `src/mam/template.py` — starter templates (module/agent/tool), placeholder rendering, name validation.
- `src/mam/diagnostics.py` — environment/self-check diagnostics: tool availability, import health, config health.

## Step 4 — Package exports
- Extend `src/mam/__init__.py` to re-export the new modules and all new public names.

## Step 5 — Tests
- Extend each of the 4 existing test files with ≥ 7 new test methods.
- Add 7 new test files: `test_config.py`, `test_cache.py`, `test_format.py`, `test_graph.py`, `test_template.py`, `test_diagnostics.py`, `test_package.py` (public export surface), each with ≥ 7 tests.

## Step 6 — Verification + docs
- Run `ruff`, `mypy`, and full `pytest`, fix all findings and failures.
- Write `update.md`.

## Step 7 — Tooling enforcement (added after review)
- Add `[tool.ruff]` and `[tool.mypy]` to `pyproject.toml`; add `ruff`/`mypy` to the dev extra.
- Keep the package's existing `typing.List`/`Optional` style by ignoring the `UP` rules that enforce PEP 585/604 built-in generics.
- Add a separate `python-sdk` job to `.github/workflows/ci.yml` running ruff, mypy, and pytest. Do not modify the existing `build-test` job.
- Fix the resulting findings, except pre-existing `SIM`/`RET` items in the runtime subprocess and CLI paths, which are left unchanged to avoid touching working behavior.
