# MAM SQL SDK — ADOPTION

How to map a parsed MAM module onto the tables in `schema/`, and the JSON shapes
the ingest query expects.

## The mapping

| SDK concept | Table | Notes |
| --- | --- | --- |
| `Module` | `modules` | One row per module, keyed by `slug` |
| `FrontMatter` | `modules` columns + `extra` (JSONB on PostgreSQL) | Known fields get columns; the rest go in `extra` |
| `Section` | `sections` | `kind` is a `SectionKind` name, `title` is the original heading |
| `ContentNode` | `content_nodes` | One row per node, payload columns are type-specific |
| `CodeBlock` | `content_nodes` where `node_type = 'code_block'` | Also exposed as the `v_code_blocks` view |
| `Tag` | `tags` + `module_tags` | Plus a `TEXT[]` on `modules` for PostgreSQL |
| `dependencies` | `dependencies` + `module_dependencies` | `scope` splits `pip:requests` into `pip` and `requests` |
| `Diagnostic` | `diagnostics` | `severity` is `info`, `warning`, or `error` |
| — | `parse_runs` | One row per parse attempt, successful or not |

### Why content nodes share one table

A table per node type would give stronger typing, but the node set is small and
stable (ten variants), and nearly every query filters on `node_type`, which the
`idx_nodes_type` index serves. The `CHECK` constraints keep the payload columns
honest: `level` may only be set on a `heading`, `code` only on a `code_block`, and
so on. If a language SDK ever adds a node type, the `CHECK` list and the
`mam_node_type` enum both have to change, which is the intended forcing function.

### Section kinds

`kind` stores the lower-case name of a `SectionKind`:

```
metadata purpose inputs outputs rules workflow mermaid python prompt memory
examples tests references dependencies exports imports plugins permissions
capabilities
```

An unrecognised heading is stored as `custom`, with the original heading text
preserved in `title`. Nothing is discarded on the way into the database.

## Ingest payloads

`queries/ingest.sql` takes four JSON arrays.

### `sections_json`

```json
[
  {
    "ordinal": 0,
    "kind": "purpose",
    "title": "Purpose",
    "line_start": 9,
    "line_end": 12,
    "nodes": [
      { "ordinal": 0, "node_type": "paragraph", "text": "Does a thing.", "line_start": 11 }
    ]
  },
  {
    "ordinal": 1,
    "kind": "python",
    "title": "Python",
    "line_start": 14,
    "line_end": 18,
    "nodes": [
      {
        "ordinal": 0,
        "node_type": "code_block",
        "language": "python",
        "code": "def process(payload):\n    return payload\n",
        "line_start": 16
      }
    ]
  }
]
```

### `diagnostics_json`

```json
[
  { "severity": "warning", "rule": "section-order", "message": "Python should come before Purpose", "section": "Python", "line": 14 }
]
```

`severity` must be one of `info`, `warning`, `error`; anything else is rejected
by the schema.

### `tags_json` and `dependencies_json`

```json
["utility", "agent"]
```

```json
["pip:requests", "npm:left-pad", "some-local-thing"]
```

A dependency's `scope` is derived on insert: the part before the first colon, or
`other` when there is none. So `pip:requests` becomes scope `pip` and
`some-local-thing` becomes `other`.

## Named parameters

| Parameter | Type | Required |
| --- | --- | --- |
| `:slug` | text | yes — the stable identifier, unique per module |
| `:name`, `:version`, `:description`, `:schema_version`, `:author`, `:license`, `:runtime` | text | no |
| `:source_path` | text | no |
| `:source_hash` | text | no — recommended, enables change detection |
| `:raw_content` | text | yes |
| `:tags_json` | JSON array of strings | no, pass `[]` |
| `:dependencies_json` | JSON array of strings | no, pass `[]` |
| `:diagnostics_json` | JSON array of objects | no, pass `[]` |
| `:sections_json` | JSON array of section objects | yes, pass `[]` for an empty module |

## Ingest semantics

Ingest is **idempotent by `slug`** and **destructive of the subtree**:

1. The module row is upserted on `slug`.
2. Its sections are deleted, which cascades to `content_nodes`.
3. Its diagnostics are deleted and replaced, so re-validating does not
   accumulate duplicates.
4. The new subtree, tags, dependencies, and diagnostics are inserted.

`parse_runs` is *not* touched, so history survives re-ingestion and
`queries/read.sql` can still answer "what changed since last time" by comparing
`source_hash`.

Put the whole call in a transaction. The statements are individually atomic, but
a caller that crashes between them leaves a module with sections and no
diagnostics.

## Engine differences

| Concern | SQLite | PostgreSQL |
| --- | --- | --- |
| Primary keys | `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGSERIAL` |
| Structured payloads | `TEXT` holding JSON | `JSONB`, GIN-indexed |
| Timestamps | ISO-8601 `TEXT` | `TIMESTAMPTZ` |
| Enumerations | `TEXT` + `CHECK` | Real `ENUM` types |
| Tags | Join table only | Join table **and** a `TEXT[]` on `modules` |
| `updated_at` | Application sets it | A `BEFORE UPDATE` trigger maintains it |
| `NULLS LAST` | Supported in SQLite 3.30+ | Supported |

`queries/ingest.sql` and `queries/read.sql` are written for SQLite. The
PostgreSQL file is a schema only: porting the queries means swapping
`strftime(...)` for `now()`, `INSERT OR IGNORE` for `ON CONFLICT DO NOTHING`, and
`?`-style parameters for `$1`, `$2`, and so on.

## Views

| View | Answers |
| --- | --- |
| `v_module_summary` | Headline counts per module, without loading `raw_content` |
| `v_code_blocks` | Every code block, flattened, with its section context |
| `v_dependency_edges` | One row per dependency edge, ready for graph rendering |
| `v_invalid_modules` | Modules with at least one error, for a CI gate |

Prefer `v_module_summary` over selecting from `modules` when the body is not
needed: it avoids pulling potentially large `raw_content` through the driver.

## Recursive queries

`queries/graph.sql` uses recursive CTEs for transitive dependencies and reverse
reachability. Both carry an explicit `path` column and a depth cap, because MAM
dependency data is hand-written and a cycle is a realistic input rather than a
theoretical one. The `path NOT LIKE '%/' || name || '/%'` guard terminates on
repeat visits; without it a cycle loops until the engine gives up.
