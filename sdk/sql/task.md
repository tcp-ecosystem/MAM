# sdk/sql — Task

## Goal
Create the MAM SQL SDK: relational schemas and queries for storing and querying
parsed MAM modules, following the structure of `sdk/go` and the shared SDK
contract.

## Blocker: no SQL engine
`sqlite3`, `psql`, and every other database client are absent and must not be
installed, so no statement here can be executed.

## Scope decision: this is a SQL-first package
The other seven SDKs in this series are parser bindings in a host language. A SQL
SDK is not that, so the deliverables are different in kind:

- `schema/sqlite.sql` — the reference dialect
- `schema/postgres.sql` — the same model in PostgreSQL types
- `queries/ingest.sql` — write path, idempotent by module slug
- `queries/read.sql` — read path, grouped by subject
- `queries/graph.sql` — dependency traversal via recursive CTEs
- `ADOPTION.md` — how a language SDK maps its AST onto the tables
- `tests/` — structural conformance cases
- `README.md`, `task.md`, `update.md`

## Model
Nine tables and four views:

| Table | Holds |
| --- | --- |
| `modules` | one row per module, keyed by `slug` |
| `sections` | one row per section, ordinal preserved |
| `content_nodes` | one row per node, type-specific payload columns |
| `tags`, `module_tags` | tag membership |
| `dependencies`, `module_dependencies` | dependency edges, with a derived `scope` |
| `diagnostics` | validation findings |
| `parse_runs` | one row per parse attempt, successful or not |

## Design decisions
- **Surrogate integer keys** with `UNIQUE` natural keys, so a double insert fails
  loudly rather than duplicating.
- **One content-node table, not ten.** The node set is small and stable, most
  queries filter on `node_type`, and `CHECK` constraints keep the payload columns
  honest. Documented as the forcing function for adding a node type.
- **Cycle-safe recursion.** `queries/graph.sql` carries an explicit `path` column
  and a depth cap, because hand-written dependency data can contain a cycle.
- **Idempotent, subtree-destructive ingest.** Re-ingesting a slug replaces its
  sections and diagnostics but leaves `parse_runs` history intact, which is what
  makes change detection by `source_hash` possible.
- **Deliberate deviation:** `.sql` files are not held to the 300-line bar applied
  elsewhere in this series. Padding SQL to hit a line count would add noise, not
  value. The files are 150-263 lines, which is the size the content warrants.

## Verification (no engine available)
A structural checker that confirms:
- statement termination and parenthesis balance, with comments and string
  literals blanked first
- every relation referenced by a query is defined in the schema, or is a CTE, a
  derived table, an alias, or a table-valued function argument
- the checker is regression-tested against a known-bad and a known-good case

This cannot check expression syntax, parameter counts, or semantics.
