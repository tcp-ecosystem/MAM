# sdk/sql — Update

## ⚠️ Never executed

**No SQL engine is installed** — `sqlite3`, `psql`, and every other client are
absent — and installing one was out of scope. Nothing here has ever been run
against a database.

Not run, results unknown:

- `sqlite3 mam.db < schema/sqlite.sql` — the schema may not apply
- Loading `tests/fixtures.sql` — the inserts may not succeed
- Any query in `queries/` — the syntax and semantics are unproven
- The PostgreSQL schema, which additionally depends on `pgcrypto` being available

The first `sqlite3` run is the real verification step.

## What was verified instead

A structural checker plus a conformance suite, **194 assertions, all passing**:

| Group | Assertions | Checks |
| --- | --- | --- |
| Relations | 13 | All 9 tables and 4 views exist, with the right kind |
| Ingest columns | 38 | Every column `ingest.sql` writes exists on its table |
| Identifiers | 30 | Every parsed column name is a valid identifier |
| Constraints | 6 | `UNIQUE` pairs, `CHECK` lists, and `ON DELETE CASCADE` all present |
| Node types | 10 | All ten `ContentNode` variants appear in the schema |
| Section kinds | 19 | All 19 standard kinds are documented in the schema or `ADOPTION.md` |
| Query references | 40 | Every relation a query names is defined, or is a CTE, derived table, alias, or TVF |
| Recursion | 3 | Both recursive CTEs are cycle-guarded and depth-capped |
| Structure | 35 | Statement termination and delimiter balance on all 7 `.sql` files, with comments and string literals blanked first |

The checkers were regression-tested: confirmed to flag a query against a
non-existent table, to pass one that resolves, and to be unconfused by `FROM (SELECT …)`,
CTE column lists, and `DO UPDATE SET`.

**What none of this can check:** expression syntax, parameter counts, type
compatibility, whether a `WHERE` clause means what was intended, and any semantic
error. Two bugs found by inspection and fixed before writing the checker are
recorded below, which is a reasonable proxy for how much more is hiding.

## Bugs found and fixed during review

1. **`ingest.sql` had a broken node insert.** It tried to reach into the section
   JSON array from a sibling `FROM` item (`json_each(sections.value, '$.nodes')`
   where `sections` was not in scope, and `json_extract` takes one argument, not
   two). Rewritten as a CTE (`section_rows`) that carries `nodes` alongside
   `module_id`, then joined back to `sections` on the ordinal. This would have
   failed at runtime.
2. **Missing `<cstdlib>`-class include in the C++ wrapper**, found by an audit of
   `std::free` usage rather than by the compiler. Belongs to `sdk/cpp`; noted
   here because it came out of the same review pass.

## Files

| File | Lines | Purpose |
| --- | --- | --- |
| `schema/sqlite.sql` | 248 | Reference dialect: 9 tables, 4 views, constraints, indexes |
| `schema/postgres.sql` | 263 | PostgreSQL types, enums, JSONB, GIN indexes, `updated_at` trigger |
| `queries/ingest.sql` | 172 | Idempotent upsert plus subtree replacement |
| `queries/read.sql` | 254 | Read queries grouped by subject, with integrity checks |
| `queries/graph.sql` | 150 | Transitive deps, reverse reachability, shared deps, ecosystems |
| `ADOPTION.md` | 190 | AST-to-table mapping, JSON payload shapes, engine differences |
| `tests/fixtures.sql` | 141 | Two fixture modules with expected results written out |
| `README.md` | 160 | Overview and example queries |

## Deliberate deviation: the 300-line bar
The other seven packages in this series hold every source file to ≥ 300 lines.
`.sql` files are not held to that here, and the reason is recorded in `task.md`:
padding SQL to hit a line count adds noise, not value. These files are 150-263
lines, which is the size the content warrants. The package has more total
verification coverage (194 assertions) than any other in the series despite
having the fewest lines of code.

## Design notes worth surfacing

**One content-node table, not ten.** The node set is small and stable, most
queries filter on `node_type` (which `idx_nodes_type` serves), and `CHECK`
constraints keep the payload columns honest. Adding a node type requires
touching the `CHECK` list and the `mam_node_type` enum — an intentional forcing
function, since a silent new variant would otherwise store with no constraint.

**Cycle-safe recursion.** Both recursive CTEs in `graph.sql` carry a `path`
column and a depth cap of 64. MAM dependency data is hand-written, so a cycle is
a realistic input. Without the `path NOT LIKE '%/' || name || '/%'` guard, a
cycle loops until the engine gives up.

**Ingest preserves history.** Re-ingesting a `slug` replaces sections and
diagnostics but leaves `parse_runs` alone, which is what makes
`read.sql`'s "what changed since the last successful parse" query work by
comparing `source_hash`.

## Risks on first execution, in order

1. **`ingest.sql` node insert.** Rewritten once already; the CTE-to-`sections`
   join on ordinal is the most intricate statement in the package and has never
   run. Verify counts against `v_module_summary` first.
2. **SQLite JSON support.** `json_each`, `json_extract`, and `json_type` require
   the JSON1 extension. It is compiled in by default since SQLite 3.38 but was
   optional before that. If a query fails with "no such function", the database
   needs a JSON-enabled build.
3. **`ON CONFLICT ... DO UPDATE`** requires SQLite 3.24+ (2018) and PostgreSQL
   9.5+. Fine on anything current; a problem on a decade-old system image.
4. **`NULLS LAST` in `read.sql`** requires SQLite 3.30+ (2019). On older builds,
   drop the keyword — SQLite sorts NULLs first by default, so the ordering
   changes but the result set does not.
5. **PostgreSQL `DO $$` block.** The enum creation is wrapped in a `DO` block
   that checks `pg_type` first, making it idempotent. It needs `plpgsql`, which
   is installed by default, and `pgcrypto` for `gen_random_uuid()`.
6. **`INSERT OR IGNORE`** in `ingest.sql` is SQLite syntax. The PostgreSQL
   equivalent is `ON CONFLICT DO NOTHING`; this is called out in `ADOPTION.md`
   but is the first thing to hit when porting.
7. **Expectation drift in `tests/fixtures.sql`.** The expected results are
   written as comments and were derived by hand, never observed. Several will
   need adjusting after the first real run.

## Recommended first commands

```sh
sqlite3 :memory: < schema/sqlite.sql     # expect clean apply
sqlite3 :memory: < tests/fixtures.sql   # expect clean insert
sqlite3 :memory: "SELECT * FROM v_module_summary;"
sqlite3 :memory: "SELECT * FROM v_code_blocks;"
sqlite3 :memory: "SELECT * FROM v_dependency_edges;"
```

Then diff each result against the `EXPECT` block at the bottom of
`tests/fixtures.sql` and correct whichever side is wrong.
