# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial monorepo structure with packages: parser, ast, compiler, runtime, validator, cli, sdk, plugins, lsp, visualization
- Turborepo build orchestration
- pnpm workspace configuration
- Docker support for development and production
- CI/CD scripts (build, test, lint, format, publish, release)
- ESLint and Prettier configuration
- TypeScript strict mode with project references

## [0.1.0] - 2025-01-01

### Added
- Initial release of MAM (Markdown as Module)
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
