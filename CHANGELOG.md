# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Full MAMModule → V2ModuleNode transformer (`compiler/src/transformer.ts`)
  - Type inference from sections (role+goal → agent, provider → tool, etc.)
  - Type-specific field extraction (agent, tool, memory, workflow, team, policy, system)
  - Table parsing for inputs/outputs sections
  - `rules` and `prompts` fields on V2ModuleNode interface
- 65 E2E tests for full `.mam.md → .mam.<target>` pipeline (`tests/e2e/compile.test.ts`)
- 16 compiler targets all verified working:
  - Python, JavaScript, Go, Rust, C#, Java, WebAssembly
  - Kubernetes, Terraform, Docker
  - OpenAI, LangGraph, CrewAI, Gemini, AutoGen, Claude SDK
- Test fixtures: agent.mam.md, tool.mam.md, minimal.mam.md, basic.mam.md, full.mam.md
- MIT LICENSE file
- plan-doc/current-state.md with comprehensive status overview

### Fixed
- Parser tokenizer: hyphens in text (e.g., "well-sourced") no longer trigger UNEXPECTED_CHARACTER error
- Parser table tokenization: TABLE_ROW_CELL emitted for data rows based on preceding token type
- Parser parseTable: whitespace and TABLE_PIPE tokens now consumed between table rows
- V2ModuleNode: added `rules` and `prompts` fields (previously missing from interface)
- Transformer: rules now populate `rules` field instead of `documentation`
- **Critical**: Section parser H1 hierarchy bug — H1 sections no longer consume H2+ content as nested sections (line 258: added `parentLevel === 1` break condition)
- **Critical**: Indented list items (`- item` after 4-space indent) — `readListItem()` now emits NEWLINE token after consuming line end, and `nextToken` no longer resets `atLineStart` after list item parsing
- **Critical**: MAM edge syntax `->` in text — `readText()` now skips `->` as a unit instead of breaking at `-` or `>` individually
- Transformer: prompts now populate `prompts` field instead of `documentation`
- @mam/package-manager: added `@types/node` devDependency, tsconfig `"types": ["node"]`
- @mam/plugin-api: tsconfig `"types": ["node"]` for Node.js type definitions
- @mam/registry-client: auth token expiry, test config keys, DELETE 204 handling
- @mam/compiler WasmTarget: comments and WAT code generation
- @mam/compiler KubernetesTarget: type-specific dispatch (agent, tool, memory, etc.)
- Root package.json: removed deprecated `pnpm.overrides`, fixed JSON syntax
- Test assertions updated: `rules` field instead of `documentation` for rule content

### Changed
- E2E tests: all frontmatter blocks include required `id`, `author`, `runtime` fields
- plan-doc files: compiler targets updated from 8/9 → 16 across all docs

## [0.1.0] - 2025-01-01

### Added
- Initial release of MAM (Machine Agent Modules)
- Core parser for Markdown-as-module format
- AST representation
- Compiler pipeline
- Runtime execution engine
- Validator for module validation
- CLI interface
- SDK for programmatic access
- Plugin system
- LSP support
- Visualization tools
