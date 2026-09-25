# sdk/python — Update

## Status

| Check | Command | Result |
| --- | --- | --- |
| Lint | `python -m ruff check .` | PASS — all checks passed |
| Type check | `python -m mypy` | PASS — no issues in 14 source files |
| Test | `PYTHONPATH=src python -m pytest -q` | PASS — 11 files, 344 passed, 1 skipped |
| Compile | `PYTHONPATH=src python -m compileall -q src` | PASS |

All three gates are now enforced in CI (see "Tooling enforcement" below).

## Pre-existing failures fixed

The package is not installed in the environment, so `import mam` fails and **all 4 test files error during collection** until `PYTHONPATH=src` is set. This is the documented invocation for this package; no packaging change was made.

Baseline was **161 passed, 3 failed, 1 skipped**. The 3 failures were stale assertions in `tests/test_parser.py` still expecting fixture version `1.0.0` where the fixture says `2.0.0` — the same fixture-version drift already corrected in `sdk/javascript`:

- `test_parse_full_module` — `ast.frontmatter.version`
- `test_frontmatter_properties` — `fm.version`
- `test_ast_version` — `ast.version`

## Existing files — 7+ new features each

### `src/mam/ast.py` (747 → 825)
Seven module-level query helpers over `AST`:

| Feature | Behavior |
| --- | --- |
| `has_front_matter(ast)` | `True` when front matter declares fields or has raw text |
| `section_count(ast)` | Number of sections |
| `count_code_blocks(ast)` | Total code blocks across all sections |
| `code_block_languages(ast)` | Distinct languages, first-seen order; unlabeled blocks report `"unknown"` |
| `section_names(ast)` | Section titles in document order |
| `find_section(ast, name)` | Case-insensitive, whitespace-tolerant section lookup |
| `is_standard_section(name)` | Whether the name is a standard MAM section |

### `src/mam/parser.py` (700 → 926)
Eight text-level helpers that do not require a full parse:

| Feature | Behavior |
| --- | --- |
| `parse_mam_safe(content, ...)` | Parses without ever raising; internal failures become `ParseError` entries |
| `extract_front_matter(content)` | Front matter mapping, `{}` when absent or not a mapping |
| `split_sections(content)` | `[(heading, body)]` pairs, front matter ignored |
| `strip_code_blocks(content)` | Fenced blocks replaced by ` ``` ` markers for prose analysis |
| `count_headings(content)` | Number of Markdown headings |
| `extract_code_blocks(content)` | `CodeBlock` list, usable on documents that do not parse |
| `normalize_mam(content)` | CRLF/CR → LF, strips trailing whitespace, collapses blank runs, ends with one newline |
| `detect_runtime(content)` | Front matter `runtime` wins, else most common code language, alias-mapped |

### `src/mam/runtime.py` (546 → 685)
Eight helpers over the dict payload returned by `execute()` (and over a single `ExecutionResult`):

| Feature | Behavior |
| --- | --- |
| `is_success(result)` | Success of a payload or a single result |
| `count_successful(result)` | Per-block successes |
| `failed_sections(result)` | Sections with a `failed`/`timeout`/`error` block; `skipped` does not count |
| `execution_languages(result)` | Distinct languages, first-seen order |
| `total_duration(result)` | Payload total, else summed block times |
| `summarize_execution(result)` | `Execution succeeded: 2/3 blocks succeeded (failed: B)` |
| `record_execution(history, entry)` | Appends a defensive copy, returns the history |
| `format_execution_output(result)` | Per-block status/stdout/stderr rendering |

### `src/mam/validator.py` (708 → 793)
Seven helpers over `ValidationIssue[]`:

| Feature | Behavior |
| --- | --- |
| `count_issues_by_severity(issues)` | Counts keyed by severity, every severity present as 0 |
| `has_errors(issues)` | Any issue at `error` or above |
| `has_warnings(issues)` | Any issue at `warning` or above |
| `filter_by_severity(issues, severity)` | Exact-severity subset |
| `issue_messages(issues)` | Ordered messages |
| `is_valid(issues)` | `True` only when nothing is at `error` or above |
| `summarize_issues(issues)` | `2 errors, 1 warning`, pluralized; `no issues` when empty |

### `src/mam/plugins.py` (341 → 423)
Seven helpers over `PluginManager`:

| Feature | Behavior |
| --- | --- |
| `enabled_plugin_names(manager)` | Sorted names of enabled plugins |
| `plugin_has_hook(manager, name)` | Whether a hook with that name is registered |
| `hook_count(manager, lifecycle=None)` | Hook count, optionally per lifecycle |
| `plugin_meta_dicts(manager)` | Metadata dicts sorted by name |
| `sort_plugin_meta(metas, key)` | New sorted list; raises `ValueError` on an unknown key |
| `find_plugin(manager, predicate)` | First match in sorted name order, for deterministic results |
| `require_plugin(manager, name)` | Metadata or `KeyError` listing what *is* registered |

### `src/mam/cli.py` (334 → 469)
Seven embeddable helpers alongside the existing argparse CLI:

| Feature | Behavior |
| --- | --- |
| `build_parser()` | Public parser accessor for embedding |
| `run(args)` | Runs the CLI and **returns an exit code** (0 ok, 1 failure, 2 usage) instead of `sys.exit` |
| `exit_code_for(issues, success)` | Maps validation/execution outcomes to 0/1/2 |
| `version_header(name)` | `mam-sdk <version>` banner |
| `format_ast(result)` | Compact structural summary of a parse result |
| `format_issues_compact(issues, limit)` | One line per issue, capped, with overflow count |
| `format_module_summary(module)` | Compact summary of a built `MAMModule` |

## New files (all ≥ 300 lines)

| File | Lines | Contents |
| --- | --- | --- |
| `src/mam/config.py` | 388 | `SDKConfig` (with `to_dict`/`to_json`/`copy`/`get`), `DEFAULT_SDK_CONFIG`, `CONFIG_FILENAME`, `SUPPORTED_TARGETS`, `validate_sdk_config`, `merge_sdk_configs` (merges `extra`, does not mutate inputs), `config_from_dict`, `normalize_target`, `find_sdk_config` (walks up parents), `resolve_sdk_config_path` (honors `MAM_SDK_CONFIG`), `load_sdk_config`, `save_sdk_config` (**atomic**: temp file in the destination directory + `Path.replace`) |
| `src/mam/cache.py` | 412 | `CacheEntry`, `CacheStats`, `ResultCache` (`get`/`set`/`get_or_set`/`has`/`delete`/`clear`/`prune`/`size`/`keys`/`items`/`remaining_ttl`/`stats`/`hit_rate`/`save_to_file`/`load_from_file`), `create_result_cache`, `DEFAULT_CACHE_TTL_SECONDS`, `hash_cache_key` (SHA-256, NUL-delimited so `["a:b"]` ≠ `["a","b"]`), `format_cache_stats`, `is_valid_cache_key` |
| `src/mam/format.py` | 352 | `format_module_summary`, `format_ast_json`, `format_section_list`, `format_validation_report`, `format_execution_report`, `format_code_block_list`, `format_front_matter`, `format_dependency_table`, `format_toc`, `format_built_module`, `format_parse_errors` |
| `src/mam/graph.py` | 395 | `GraphNode`, `GraphEdge`, `DependencyGraph`, `build_graph`, `topological_sort` (**cycle-detecting**), `node_names`, `successors`, `predecessors`, `has_edge`, `edge_labels`, `root_nodes`, `leaf_nodes`, `nodes_of_type`, `count_nodes_by_type`, `count_edges_by_label`, `has_node`, `node_type`, `reachable_from`, `filter_nodes`, `summarize_graph`, `format_graph_text` |
| `src/mam/template.py` | 385 | `STARTER_KINDS`, `STARTER_ALIASES` (mod/bot/assistant/utility/cli/…), `list_starter_kinds`, `get_starter_template` (module/agent/tool), `render_starter` (case-insensitive, leaves unknown placeholders visible), `starter_variables`, `slugify`, `validate_starter_name`, `default_variables`, `new_module_starter` |
| `src/mam/diagnostics.py` | 352 | `DiagnosticStatus`, `DiagnosticCheck`, `DiagnosticReport`, `check_python_version`, `check_environment`, `check_imports`, `check_language_runtimes` (PATH probe, warn-by-default), `check_sdk_config`, `run_diagnostics`, `format_diagnostics` |

## Package exports

`src/mam/__init__.py` now re-exports all six new modules and every new helper — **147 names in `__all__`**, all verified resolvable by `test_all_exports_resolve`.

## Tests

- Existing 4 files extended with new test classes: `TestASTQueryHelpers` (7), `TestParserHelpers` (8), `TestRuntimeHelpers` (8), `TestValidatorHelpers` (7).
- 6 new test files: `test_config.py` (25), `test_cache.py` (28), `test_format.py` (23), `test_graph.py` (19), `test_template.py` (19), `test_diagnostics.py` (16), plus `test_package.py` (20) covering the export surface, the plugin helpers, and the CLI helpers.
- Total: **344 passed, 1 skipped** (the skip is pre-existing).

## Bugs found and fixed in the new code

1. **`save_sdk_config` treated its `path` argument as a directory**, appending `mam.sdk.json` to a full file path and producing `.../mam.sdk.json/mam.sdk.json`. Now the `path` argument is a file path; `resolve_sdk_config_path` keeps the directory-based semantics.
2. **`config_from_dict` nested `extra` inside `extra`**, because `extra` was not in the recognized key list. A save/load round trip of `SDKConfig(extra={"team": "core"})` returned `{"extra": {"team": "core"}}`. The nested mapping is now read correctly and unknown top-level keys are still preserved.
3. **`DependencyGraph` index staleness** during graph construction — `has_node` short-circuited on a non-empty index, so nodes added after the first lookup were invisible. Construction now tracks names locally and indexes once at the end.
4. **`Section.content` does not exist** (the field is `content_nodes`); corrected in `format.py` and `cli.py` before shipping.
5. **`FrontMatter.to_dict()` is always truthy** (`{"data": {}}`), so an early `has_front_matter` draft would have returned `True` for every module; it now inspects `data`/`raw`.

## Tooling enforcement

`ruff` and `mypy` were already available in the environment but had no configuration, so nothing was checked. Both are now configured in `pyproject.toml` and wired into CI.

### `pyproject.toml`
- Dev extra extended with `ruff>=0.6` and `mypy>=1.10` alongside the existing `pytest>=7.0`.
- `[tool.ruff]`: `line-length = 100` (matches the repo's existing Prettier `printWidth: 100` convention in `.prettierrc`), `target-version = "py310"` (the declared `requires-python` floor), `src = ["src", "tests"]`.
- `[tool.ruff.lint]`: selects `F` (pyflakes), `E`/`W` (pycodestyle), `I` (isort), `B` (bugbear), `C4` (comprehensions), `UP` (pyupgrade).
  - **Ignores `UP006`, `UP007`, `UP035`, `UP045`** — these enforce PEP 585/604 built-in generics (`list[str]`, `str | None`) over the package's existing deliberate `typing.List`/`Optional` style paired with `from __future__ import annotations`. Enabling them would rewrite **439 annotations** across working code for no correctness gain, so the family is explicitly off and documented inline.
  - `per-file-ignores` for `src/mam/__init__.py` (`F401`), since it re-exports the public API and is additionally protected by `__all__`.
- `[tool.mypy]`: `files = ["src"]`, `python_version = "3.10"`, plus `disallow_untyped_defs`, `disallow_incomplete_defs`, `check_untyped_defs`, `no_implicit_optional`, `warn_return_any`, `warn_unused_ignores`, `warn_redundant_casts`, `warn_unused_configs`.

### CI
A new **`python-sdk`** job was added to `.github/workflows/ci.yml`. It is a separate job; the existing `build-test` job is byte-for-byte unchanged (still 7 steps), so the main protocol is untouched and neither job can block the other.

Steps: `actions/setup-python` (3.10, pip-cached) → install `ruff`/`mypy`/`pytest`/`pyyaml` → `ruff check .` → `mypy` → `pytest -q`, with `PYTHONPATH: src` for the latter two. `PYTHONPATH=src` rather than `pip install -e .` deliberately matches the locally verified invocation, so the gate does not depend on a packaging step.

### Violations fixed to reach a clean baseline
All fixes are mechanical and behavior-preserving; the 344-test suite passed after every batch.

| Count | Rule | Fix |
| --- | --- | --- |
| 18 | `F401` unused import | Removed. Genuinely dead imports across `ast`, `cache`, `cli`, `format`, `plugins`, `runtime`, `validator` and 4 test files |
| 14 | `I001` import order | Ruff autofix |
| 18 | `E501` line > 100 | Wrapped comprehensions and split long test literals into implicit concatenation; the two in `src` were `parser.py` table-separator condition and `runtime.py` duration sum |
| 3 | `UP037` quoted annotation | Unquoted `-> "CacheEntry"`, `-> "DependencyGraph"`, `-> "re.Match[str]"` (safe under `from __future__ import annotations`) |
| 1 | `UP018` | `str(tmp_path / CONFIG_FILENAME)` → direct path |
| 2 | mypy `no-any-return` | `FrontMatter.tags`/`dependencies`/`permissions` got an explicit local annotation (no runtime change) and `merge_sdk_configs` now binds a typed `base_config` local instead of reassigning an `Any` parameter |
| 3 | mypy `unused-ignore` | Removed three stale `# type: ignore` comments in `cli.py` that the stricter settings proved unnecessary |
| 2 | mypy `union-attr` | `format_validation_report` / `format_issues_compact` now bind `getattr(severity, "to_string", None)` and check `callable(...)`, so the `None` case is narrowed properly instead of relying on a `hasattr` guard mypy cannot see |
| 5 | `SIM`/`RET` in new code | `is_standard_section` → `any(...)`, `is_valid_cache_key` returns the condition directly, `ResultCache.stats()` drops a redundant local, `format_front_matter` uses a ternary and `key in data`, yoda condition in `test_template` |

### Deliberately not changed
`SIM`/`RET` are **not** in the selected rule set. Four of the 11 findings they report are pre-existing `open()` calls without a context manager in the `runtime.py` subprocess path, plus one pre-existing `if`/`else` in `cli.py`. Converting those would alter file-handling and execution behavior in the working runtime, so the family is left off rather than silenced with per-file ignores. The pre-existing code is unchanged in those spots; the new code is written clean.

## Notes and deviations

- `config.py`, `cache.py`, `graph.py`, and `template.py` export more than 7 symbols because they are cohesive families (config loader + validator + target registry; cache class + hashing + stats; graph builder + full query surface; templates + rendering + validation). Every file meets or exceeds the 7-feature target.
- No new dependencies: the new modules use only the standard library plus the already-declared `pyyaml`. The only third-party import added anywhere is `pyyaml`, already a runtime dependency and used in `extract_front_matter`.
- Docstrings are used throughout (matching the existing module style); no inline comments were added.
- The generated starter templates intentionally embed `{{...}}`-free Python dict literals such as `{{"payload": payload}}`, which the placeholder renderer leaves untouched, so starters parse as valid Python.
