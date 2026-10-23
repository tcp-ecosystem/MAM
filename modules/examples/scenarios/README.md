# Scenarios Example

A composed MAM system of 10 modules.

## Layout

```text
modules/examples/scenarios/
├── mam.toml
├── README.md
├── system.mam
├── system.mam.md
└── modules/
    ├── authentication.mam + authentication.mam.md
    ├── bug-hunter.mam + bug-hunter.mam.md
    ├── data_pipeline.mam + data_pipeline.mam.md
    ├── hello.mam + hello.mam.md
    ├── memory.mam + memory.mam.md
    ├── planner.mam + planner.mam.md
    ├── prompt.mam + prompt.mam.md
    ├── rag.mam + rag.mam.md
    ├── security.mam + security.mam.md
    ├── workflow.mam + workflow.mam.md
```

## Modules

| File | Name | Type | What it does |
|------|------|------|--------------|
| `authentication.mam` | Authentication Module | module | Provide secure user authentication using JWT tokens. This module handles token generation, validation, and refresh operations with built-in security best practices. |
| `bug-hunter.mam` | BugHunter System | system | Multi-agent security testing system that discovers, analyzes, and reports vulnerabilities. |
| `data_pipeline.mam` | Data Pipeline Module | module | Provides a reusable ETL (Extract-Transform-Load) pipeline framework. Handles data extraction from multiple source types, configurable transformations, schema validation, and loading into target stores with retry and dead-letter support. |
| `hello.mam` | Hello | module | Return a greeting for a given name. This module is a standalone `.mam` artifact executed natively by the MAM runtime, without compiling to Python, JavaScript, or any other target. |
| `memory.mam` | Memory Module | module | Provides a persistent memory layer for AI agents. Supports key-value storage, vector similarity search, TTL-based expiration, and workspace-scoped isolation between agent sessions. |
| `planner.mam` | Planner Module | module | Decomposes a high-level goal into an ordered graph of sub-tasks. Each task has an id, description, dependencies, priority, and estimated effort. The planner detects circular dependencies and produces a valid topological execution order. |
| `prompt.mam` | Prompt Module | module | Manages reusable prompt templates with variable interpolation, few-shot example injection, and chain-of-thought scaffolding. Produces finalized prompt strings ready for LLM consumption. |
| `rag.mam` | RAG Module | module | Implements a Retrieval-Augmented Generation pipeline: chunk documents into overlapping segments, compute simple TF-IDF embeddings, store them in a vector index, and retrieve the most relevant chunks for a given query. |
| `security.mam` | Security Module | module | Provides security primitives for MAM modules: secret detection in text, input sanitization, rate limiting, and policy enforcement. Designed to be embedded as a guardrail in agent workflows and pipelines. |
| `workflow.mam` | Workflow Module | workflow | Orchestrates multi-step workflows as directed acyclic graphs (DAGs). Each step is an atomic operation with optional conditions, retries, and error handlers. The engine executes steps in dependency order with support for parallel execution and branching. |

Every module ships as a `.mam` and an identical `.mam.md` pair. The
`system.mam` entry composes the modules into one runnable system.

## Commands

From this directory:

```text
mam validate
mam build
mam run system.mam
```

## What You'll Learn

- `generate_token` — Authentication Module
- `validate_token` — Authentication Module
- `refresh_access_token` — Authentication Module
- `hash_password` — Authentication Module
- `verify_password` — Authentication Module
- `plan` — BugHunter System, Planner Module
- `recon` — BugHunter System
- `analyze` — BugHunter System

## Related

- [Examples index](../README.md)
- [Templates for this type](../../templates/scenarios/)
- [MAM specification](../../../plan-doc/full-mam.md)
