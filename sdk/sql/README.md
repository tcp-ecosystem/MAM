# MAM SQL SDK

Relational schemas and queries for storing and querying parsed
[MAM (Markdown as Module)](../../spec/SPEC.md) documents.

Unlike the other SDKs in this series, this one is not a host-language binding.
It defines the storage layer: how a module's AST maps onto tables, how to
ingest one, and how to ask the questions you actually have of a module registry —
what does this depend on, what breaks if I remove that, which modules fail
validation, what changed since the last run.

## Status

**Nothing here has been executed.** No SQL engine (`sqlite3`, `psql`, or any
other client) is installed on the machine where this was written. The statements
have been checked structurally but never run. `update.md` records what that
means in practice.

## Layout

| Path | Purpose |
| --- | --- |
| `schema/sqlite.sql` | Reference dialect: 9 tables, 4 views |
| `schema/postgres.sql` | Same model with PostgreSQL types, enums, and JSONB |
| `queries/ingest.sql` | Write path. Idempotent by `slug`, replaces the subtree |
| `queries/read.sql` | Read path, grouped by subject |
| `queries/graph.sql` | Dependency traversal via cycle-safe recursive CTEs |
| `ADOPTION.md` | How a language SDK maps its AST onto these tables |
| `tests/fixtures.sql` | Conformance fixtures with expected results written out |

## The model

| Table | Holds |
| --- | --- |
| `modules` | One row per module, keyed by a stable `slug` |
| `sections` | One row per section, document ordinal preserved |
| `content_nodes` | One row per node, with type-specific payload columns |
| `tags`, `module_tags` | Tag membership |
| `dependencies`, `module_dependencies` | Dependency edges, with a derived `scope` |
| `diagnostics` | Validation findings, one row per issue |
| `parse_runs` | One row per parse attempt, successful or not |

Four views sit on top: `v_module_summary` (headline counts without loading
`raw_content`), `v_code_blocks` (every block flattened with its section
context), `v_dependency_edges` (ready for graph rendering), and
`v_invalid_modules` (modules with at least one error, for a CI gate).

## Getting started

```sh
sqlite3 mam.db < schema/sqlite.sql
sqlite3 mam.db < tests/fixtures.sql
sqlite3 mam.db "SELECT * FROM v_module_summary;"
```

The fixtures insert two modules — `minimal` and `full` — and end with the
expected results written out as comments, so you can diff reality against
intent.

## Design decisions

**One content-node table, not ten.** The node set is small and stable, almost
every query filters on `node_type`, and `CHECK` constraints keep the payload
columns honest (`level` only on a `heading`, `code` only on a `code_block`, and
so on). If a language SDK adds a node type, both the `CHECK` list and the
`mam_node_type` enum have to change — which is the point.

**Surrogate keys with natural `UNIQUE` constraints.** Sections and nodes get
integer keys so they can be referenced cheaply, but `(module_id, ordinal)` and
`(section_id, ordinal)` are unique, so a double insert fails loudly instead of
duplicating.

**Cycle-safe recursion.** `queries/graph.sql` carries an explicit `path` column
and a depth cap on every recursive CTE. MAM dependency data is hand-written, so
a cycle is a realistic input, not a theoretical one.

**Ingest is idempotent and subtree-destructive.** Re-ingesting a `slug` replaces
its sections and diagnostics but leaves `parse_runs` history intact — which is
exactly what makes change detection by `source_hash` work.

## Example queries

The questions a module registry gets asked, and the file each lives in:

```sql
-- What does this module depend on, transitively?          queries/graph.sql
-- What breaks if I remove this package?                   queries/graph.sql
-- Which modules currently fail validation?                queries/read.sql
-- Which languages are in use, so I know what to install?   queries/read.sql
-- Which modules changed since the last successful parse?  queries/read.sql
-- Which modules declare no dependencies at all?           queries/read.sql
```

The language breakdown is the one to run before provisioning a CI image:

```sql
SELECT COALESCE(NULLIF(language, ''), '(none)') AS language,
       COUNT(*) AS block_count,
       COUNT(DISTINCT module_id) AS module_count
  FROM v_code_blocks
 GROUP BY COALESCE(NULLIF(language, ''), '(none)')
 ORDER BY block_count DESC;
```

## Engine differences

| Concern | SQLite | PostgreSQL |
| --- | --- | --- |
| Primary keys | `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL` |
| Structured payloads | `TEXT` holding JSON | `JSONB`, GIN-indexed |
| Timestamps | ISO-8601 `TEXT` | `TIMESTAMPTZ` |
| Enumerations | `TEXT` + `CHECK` | Real `ENUM` types |
| Tags | Join table only | Join table **and** a `TEXT[]` on `modules` |
| `updated_at` | Application sets it | A `BEFORE UPDATE` trigger maintains it |

`queries/*.sql` are written for SQLite. Porting them to PostgreSQL means
swapping `strftime(...)` for `now()`, `INSERT OR IGNORE` for
`ON CONFLICT DO NOTHING`, and `:name` parameters for `$1`, `$2`, and so on.
`ADOPTION.md` has the full list.

## Validation

With no engine available, the package ships with a structural checker and 194
assertions covering:

- statement termination and parenthesis balance, with comments and string
  literals blanked first so their contents cannot mask a real delimiter
- every relation a query references is defined in the schema, or is a CTE, a
  derived table, an alias, or a table-valued function
- every column `ingest.sql` writes actually exists on that table
- the `CHECK` constraints, `UNIQUE` pairs, and cascade rules are all present
- all ten node types and all three severities appear in the schema
- all 19 standard section kinds are documented
- both recursive CTEs are cycle-guarded and depth-capped

The checker is not a SQL parser. It cannot validate expression syntax, parameter
counts, or semantics — a first run against a real engine is still required, and
`update.md` lists what to expect.
