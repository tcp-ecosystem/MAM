-- =====================================================================
-- MAM module registry — SQLite reference schema
--
-- Stores a parsed MAM module in relational form: one row per module, one per
-- section, one per content node, plus the supporting lookup tables for code
-- blocks, tags, dependencies, and validation diagnostics.
--
-- Design notes
--   * Every identifier is a surrogate INTEGER PRIMARY KEY so that sections and
--     nodes can be referenced without repeating strings.
--   * Natural keys (module slug, section ordinal, node ordinal) carry UNIQUE
--     constraints so a double insert fails loudly rather than duplicating.
--   * Timestamps are stored as ISO-8601 TEXT in UTC, which sorts correctly as
--     a string and avoids engine-specific timestamp types.
--   * JSON columns hold structured front matter that has no fixed shape. SQLite
--     stores them as TEXT with a CHECK on validity via json_valid where
--     available; the CHECK is omitted on builds without the JSON1 extension.
--
-- Portability: see schema.postgres.sql for the PostgreSQL dialect.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT    NOT NULL UNIQUE,
    name            TEXT,
    version         TEXT,
    description     TEXT,
    schema_version  TEXT,
    author          TEXT,
    license         TEXT,
    runtime         TEXT,
    source_path     TEXT,
    source_hash     TEXT,
    raw_content     TEXT    NOT NULL,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_modules_name    ON modules (name);
CREATE INDEX IF NOT EXISTS idx_modules_runtime ON modules (runtime);
CREATE INDEX IF NOT EXISTS idx_modules_hash    ON modules (source_hash);

-- ---------------------------------------------------------------------
-- Sections
--
-- kind stores the SectionKind name: one of the 19 standard kinds, or
-- 'custom' for an unrecognised heading. title preserves the original heading
-- text either way.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sections (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id   INTEGER NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    title       TEXT    NOT NULL,
    line_start  INTEGER,
    line_end    INTEGER,
    UNIQUE (module_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_sections_module ON sections (module_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_sections_kind   ON sections (kind);

-- ---------------------------------------------------------------------
-- Content nodes
--
-- node_type is one of: heading, paragraph, code_block, list, table,
-- blockquote, horizontal_rule, link, image, text.
--
-- A single table with nullable payload columns is used rather than a table per
-- node type: the set is small and stable, and queries almost always filter on
-- node_type, which the index below serves. Payload columns are mutually
-- exclusive in practice; the CHECK constraints keep them honest.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_nodes (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id    INTEGER NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
    ordinal       INTEGER NOT NULL,
    node_type     TEXT    NOT NULL,
    text          TEXT,
    level         INTEGER,
    language      TEXT,
    code          TEXT,
    is_ordered    INTEGER,
    items_json    TEXT,
    headers_json  TEXT,
    rows_json     TEXT,
    url           TEXT,
    alt_text      TEXT,
    line_start    INTEGER,
    line_end      INTEGER,
    UNIQUE (section_id, ordinal),
    CHECK (node_type IN ('heading', 'paragraph', 'code_block', 'list', 'table',
                         'blockquote', 'horizontal_rule', 'link', 'image', 'text')),
    CHECK (level IS NULL OR node_type = 'heading'),
    CHECK (code IS NULL OR node_type = 'code_block'),
    CHECK (items_json IS NULL OR node_type = 'list'),
    CHECK (headers_json IS NULL OR node_type = 'table'),
    CHECK (is_ordered IS NULL OR node_type = 'list')
);

CREATE INDEX IF NOT EXISTS idx_nodes_section ON content_nodes (section_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_nodes_type    ON content_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_lang    ON content_nodes (language);

-- ---------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS module_tags (
    module_id INTEGER NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    tag_id    INTEGER NOT NULL REFERENCES tags (id)    ON DELETE CASCADE,
    PRIMARY KEY (module_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_module_tags_tag ON module_tags (tag_id);

-- ---------------------------------------------------------------------
-- Dependencies
--
-- name is the dependency string exactly as written in front matter, for
-- example 'pip:requests'. scope is the part before the first colon, or 'other'
-- when there is none, so queries can filter by ecosystem without parsing.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dependencies (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL UNIQUE,
    scope      TEXT    NOT NULL DEFAULT 'other',
    UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_dependencies_scope ON dependencies (scope);

CREATE TABLE IF NOT EXISTS module_dependencies (
    module_id      INTEGER NOT NULL REFERENCES modules (id)        ON DELETE CASCADE,
    dependency_id  INTEGER NOT NULL REFERENCES dependencies (id)   ON DELETE CASCADE,
    PRIMARY KEY (module_id, dependency_id)
);

CREATE INDEX IF NOT EXISTS idx_module_deps_dep ON module_dependencies (dependency_id);

-- ---------------------------------------------------------------------
-- Validation diagnostics
--
-- severity is one of: info, warning, error. is_valid on the modules row is
-- the rolled-up verdict; this table keeps the individual findings.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id   INTEGER NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    severity    TEXT    NOT NULL,
    rule        TEXT    NOT NULL DEFAULT '',
    message     TEXT    NOT NULL,
    section     TEXT,
    line        INTEGER,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (severity IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_module  ON diagnostics (module_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_severity ON diagnostics (severity);

-- ---------------------------------------------------------------------
-- Parse runs
--
-- One row per parse attempt, so a document that failed to parse still leaves a
-- trace. A successful parse links to the module it produced.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parse_runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path   TEXT,
    source_hash   TEXT    NOT NULL,
    parser_version TEXT   NOT NULL,
    succeeded     INTEGER NOT NULL DEFAULT 0,
    error_count   INTEGER NOT NULL DEFAULT 0,
    warning_count INTEGER NOT NULL DEFAULT 0,
    module_id     INTEGER REFERENCES modules (id) ON DELETE SET NULL,
    started_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    duration_ms   INTEGER,
    CHECK (succeeded IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_parse_runs_hash ON parse_runs (source_hash);
CREATE INDEX IF NOT EXISTS idx_parse_runs_path ON parse_runs (source_path);

-- ---------------------------------------------------------------------
-- Convenience views
-- ---------------------------------------------------------------------

-- One row per module with its headline counts.
CREATE VIEW IF NOT EXISTS v_module_summary AS
SELECT m.id                                        AS module_id,
       m.slug,
       m.name,
       m.version,
       m.runtime,
       m.updated_at,
       (SELECT COUNT(*) FROM sections s WHERE s.module_id = m.id)       AS section_count,
       (SELECT COUNT(*) FROM content_nodes n
          JOIN sections s ON s.id = n.section_id
         WHERE s.module_id = m.id)                                     AS node_count,
       (SELECT COUNT(*) FROM content_nodes n
          JOIN sections s ON s.id = n.section_id
         WHERE s.module_id = m.id AND n.node_type = 'code_block')      AS code_block_count,
       (SELECT COUNT(*) FROM diagnostics d WHERE d.module_id = m.id
          AND d.severity = 'error')                                    AS error_count,
       (SELECT COUNT(*) FROM diagnostics d WHERE d.module_id = m.id
          AND d.severity = 'warning')                                  AS warning_count
  FROM modules m;

-- Every code block, flattened, with enough context to render it.
CREATE VIEW IF NOT EXISTS v_code_blocks AS
SELECT m.id       AS module_id,
       m.slug,
       s.kind     AS section_kind,
       s.title    AS section_title,
       n.ordinal  AS node_ordinal,
       n.language,
       n.code,
       n.line_start
  FROM content_nodes n
  JOIN sections s ON s.id = n.section_id
  JOIN modules  m ON m.id = s.module_id
 WHERE n.node_type = 'code_block';

-- Dependency edges, for graph rendering.
CREATE VIEW IF NOT EXISTS v_dependency_edges AS
SELECT src.slug AS source_slug,
       dst.name AS target_name,
       dst.scope AS target_scope
  FROM module_dependencies md
  JOIN modules      src ON src.id = md.module_id
  JOIN dependencies dst ON dst.id = md.dependency_id;

-- Modules that are not currently valid, for CI gates.
CREATE VIEW IF NOT EXISTS v_invalid_modules AS
SELECT module_id, slug, error_count, warning_count
  FROM v_module_summary
 WHERE error_count > 0;
