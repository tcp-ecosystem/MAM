-- =====================================================================
-- MAM module registry — PostgreSQL schema
--
-- Same logical model as schema/sqlite.sql, expressed with PostgreSQL types.
-- Differences worth knowing:
--   * Identity columns replace AUTOINCREMENT.
--   * TEXT[] replaces the tag and dependency join tables for the common case
--     where ordering and membership are all that matter. The normalised tables
--     from the SQLite schema are kept too, because they are what the
--     dependency graph queries traverse.
--   * JSONB replaces TEXT for structured front matter and list payloads, so
--     payloads are queryable rather than opaque.
--   * TIMESTAMPTZ replaces ISO-8601 text timestamps.
--   * CHECK constraints are kept; they are the cheapest schema-level guarantee
--     that a writer cannot store a section kind the SDK does not know.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------

-- gen_random_uuid() lives in pgcrypto on older servers and in core from
-- PostgreSQL 13 onward, so the extension is created defensively.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Enumerated domains
--
-- Using a real ENUM type rather than TEXT with a CHECK means an invalid value
-- is rejected at the type level and shows up in tooling as a named type.
-- ---------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mam_severity') THEN
        CREATE TYPE mam_severity AS ENUM ('info', 'warning', 'error');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mam_node_type') THEN
        CREATE TYPE mam_node_type AS ENUM (
            'heading', 'paragraph', 'code_block', 'list', 'table',
            'blockquote', 'horizontal_rule', 'link', 'image', 'text');
    END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Modules
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS modules (
    id              BIGSERIAL PRIMARY KEY,
    slug            TEXT        NOT NULL UNIQUE,
    name            TEXT,
    version         TEXT,
    description     TEXT,
    schema_version  TEXT,
    author          TEXT,
    license         TEXT,
    runtime         TEXT,
    source_path     TEXT,
    source_hash     TEXT,
    raw_content     TEXT        NOT NULL,
    -- Front matter that has no dedicated column, queryable rather than opaque.
    extra           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    tags            TEXT[]      NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_modules_name    ON modules (name);
CREATE INDEX IF NOT EXISTS idx_modules_runtime ON modules (runtime);
CREATE INDEX IF NOT EXISTS idx_modules_hash    ON modules (source_hash);
CREATE INDEX IF NOT EXISTS idx_modules_tags    ON modules USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_modules_extra   ON modules USING GIN (extra);

-- Keep updated_at honest without relying on every writer to remember.
CREATE OR REPLACE FUNCTION mam_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_modules_touch ON modules;
CREATE TRIGGER trg_modules_touch
    BEFORE UPDATE ON modules
    FOR EACH ROW EXECUTE FUNCTION mam_touch_updated_at();

-- ---------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sections (
    id          BIGSERIAL PRIMARY KEY,
    module_id   BIGINT NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    kind        TEXT   NOT NULL,
    title       TEXT   NOT NULL,
    line_start  INTEGER,
    line_end    INTEGER,
    UNIQUE (module_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_sections_module ON sections (module_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_sections_kind   ON sections (kind);

-- ---------------------------------------------------------------------
-- Content nodes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_nodes (
    id            BIGSERIAL PRIMARY KEY,
    section_id    BIGINT      NOT NULL REFERENCES sections (id) ON DELETE CASCADE,
    ordinal       INTEGER     NOT NULL,
    node_type     mam_node_type NOT NULL,
    text          TEXT,
    level         SMALLINT,
    language      TEXT,
    code          TEXT,
    is_ordered    BOOLEAN,
    items         JSONB,
    headers       JSONB,
    rows          JSONB,
    url           TEXT,
    alt_text      TEXT,
    line_start    INTEGER,
    line_end      INTEGER,
    UNIQUE (section_id, ordinal),
    CHECK (level IS NULL OR node_type = 'heading'),
    CHECK (code IS NULL OR node_type = 'code_block'),
    CHECK (items IS NULL OR node_type = 'list'),
    CHECK (headers IS NULL OR node_type = 'table'),
    CHECK (is_ordered IS NULL OR node_type = 'list')
);

CREATE INDEX IF NOT EXISTS idx_nodes_section ON content_nodes (section_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_nodes_type    ON content_nodes (node_type);
CREATE INDEX IF NOT EXISTS idx_nodes_lang    ON content_nodes (language) WHERE language IS NOT NULL;

-- ---------------------------------------------------------------------
-- Tags
--
-- The array on modules covers simple membership queries. The normalised table
-- exists so tags can be listed and counted across modules without unnesting.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    id   BIGSERIAL PRIMARY KEY,
    name TEXT   NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS module_tags (
    module_id BIGINT NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    tag_id    BIGINT NOT NULL REFERENCES tags (id)    ON DELETE CASCADE,
    PRIMARY KEY (module_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_module_tags_tag ON module_tags (tag_id);

-- ---------------------------------------------------------------------
-- Dependencies
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dependencies (
    id    BIGSERIAL PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'other'
);

CREATE INDEX IF NOT EXISTS idx_dependencies_scope ON dependencies (scope);

CREATE TABLE IF NOT EXISTS module_dependencies (
    module_id     BIGINT NOT NULL REFERENCES modules (id)      ON DELETE CASCADE,
    dependency_id BIGINT NOT NULL REFERENCES dependencies (id) ON DELETE CASCADE,
    PRIMARY KEY (module_id, dependency_id)
);

CREATE INDEX IF NOT EXISTS idx_module_deps_dep ON module_dependencies (dependency_id);

-- ---------------------------------------------------------------------
-- Validation diagnostics
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diagnostics (
    id         BIGSERIAL PRIMARY KEY,
    module_id  BIGINT      NOT NULL REFERENCES modules (id) ON DELETE CASCADE,
    severity   mam_severity NOT NULL,
    rule       TEXT        NOT NULL DEFAULT '',
    message    TEXT        NOT NULL,
    section    TEXT,
    line       INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagnostics_module  ON diagnostics (module_id);
CREATE INDEX IF NOT EXISTS idx_diagnostics_severity ON diagnostics (severity);

-- ---------------------------------------------------------------------
-- Parse runs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parse_runs (
    id             BIGSERIAL PRIMARY KEY,
    source_path    TEXT,
    source_hash    TEXT        NOT NULL,
    parser_version TEXT        NOT NULL,
    succeeded      BOOLEAN     NOT NULL DEFAULT FALSE,
    error_count    INTEGER     NOT NULL DEFAULT 0,
    warning_count  INTEGER     NOT NULL DEFAULT 0,
    module_id      BIGINT REFERENCES modules (id) ON DELETE SET NULL,
    started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_parse_runs_hash ON parse_runs (source_hash);
CREATE INDEX IF NOT EXISTS idx_parse_runs_path ON parse_runs (source_path);

-- ---------------------------------------------------------------------
-- Convenience views
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_module_summary AS
SELECT m.id,
       m.slug,
       m.name,
       m.version,
       m.runtime,
       m.updated_at,
       (SELECT COUNT(*) FROM sections s WHERE s.module_id = m.id)      AS section_count,
       (SELECT COUNT(*) FROM content_nodes n
          JOIN sections s ON s.id = n.section_id
         WHERE s.module_id = m.id)                                      AS node_count,
       (SELECT COUNT(*) FROM content_nodes n
          JOIN sections s ON s.id = n.section_id
         WHERE s.module_id = m.id AND n.node_type = 'code_block')       AS code_block_count,
       (SELECT COUNT(*) FROM diagnostics d WHERE d.module_id = m.id
          AND d.severity = 'error')                                     AS error_count,
       (SELECT COUNT(*) FROM diagnostics d WHERE d.module_id = m.id
          AND d.severity = 'warning')                                   AS warning_count
  FROM modules m;

CREATE OR REPLACE VIEW v_code_blocks AS
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

CREATE OR REPLACE VIEW v_dependency_edges AS
SELECT src.slug AS source_slug,
       dst.name AS target_name,
       dst.scope AS target_scope
  FROM module_dependencies md
  JOIN modules      src ON src.id = md.module_id
  JOIN dependencies dst ON dst.id = md.dependency_id;

CREATE OR REPLACE VIEW v_invalid_modules AS
SELECT module_id, slug, error_count, warning_count
  FROM v_module_summary
 WHERE error_count > 0;

COMMIT;
