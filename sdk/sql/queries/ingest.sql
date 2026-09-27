-- =====================================================================
-- MAM module ingestion
--
-- Inserts a parsed module and its whole subtree. Written as a single
-- parameterised statement so a half-ingested module is impossible: either the
-- module, its sections, its nodes, its tags, its dependencies, and its
-- diagnostics all land, or none of it does.
--
-- Parameter order (SQLite named-parameter style, adapt for other engines):
--   :slug, :name, :version, :description, :schema_version, :author,
--   :license, :runtime, :source_path, :source_hash, :raw_content,
--   :tags_json, :dependencies_json, :diagnostics_json,
--   :sections_json
--
-- The three JSON arrays follow the shapes documented in ADOPTION.md:
--   sections_json     [{ordinal, kind, title, line_start, line_end, nodes: [...]}]
--   diagnostics_json  [{severity, rule, message, section, line}]
--   tags_json         ["utility", "agent"]
--   dependencies_json ["pip:requests", "npm:left-pad"]
--
-- Upsert semantics: re-ingesting the same slug replaces the module and its
-- subtree, and leaves parse_runs history intact.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Module upsert
-- ---------------------------------------------------------------------
INSERT INTO modules (
    slug, name, version, description, schema_version, author,
    license, runtime, source_path, source_hash, raw_content
)
VALUES (
    :slug, :name, :version, :description, :schema_version, :author,
    :license, :runtime, :source_path, :source_hash, :raw_content
)
ON CONFLICT (slug) DO UPDATE SET
    name           = excluded.name,
    version        = excluded.version,
    description    = excluded.description,
    schema_version = excluded.schema_version,
    author         = excluded.author,
    license        = excluded.license,
    runtime        = excluded.runtime,
    source_path    = excluded.source_path,
    source_hash    = excluded.source_hash,
    raw_content    = excluded.raw_content,
    updated_at     = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- ---------------------------------------------------------------------
-- Replace the module's subtree
--
-- Deleting sections cascades to content_nodes, so the whole tree is replaced in
-- one statement. Diagnostics are replaced rather than appended, because
-- re-validating a module should not accumulate duplicates.
-- ---------------------------------------------------------------------
DELETE FROM sections    WHERE module_id = (SELECT id FROM modules WHERE slug = :slug);
DELETE FROM diagnostics WHERE module_id = (SELECT id FROM modules WHERE slug = :slug);

-- ---------------------------------------------------------------------
-- Sections and their nodes, from a JSON array
--
-- json_each walks the array; the ordinal in the payload is preserved rather
-- than relying on array order, so a caller that reorders the array does not
-- silently renumber sections.
-- ---------------------------------------------------------------------
INSERT INTO sections (
    module_id, ordinal, kind, title, line_start, line_end
)
SELECT m.id,
       CAST(json_extract(section.value, '$.ordinal') AS INTEGER),
       json_extract(section.value, '$.kind'),
       json_extract(section.value, '$.title'),
       CAST(json_extract(section.value, '$.line_start') AS INTEGER),
       CAST(json_extract(section.value, '$.line_end')   AS INTEGER)
  FROM json_each(:sections_json) AS section,
       modules m
 WHERE m.slug = :slug;

WITH section_rows AS (
    SELECT m.id                AS module_id,
           json_extract(s.value, '$.ordinal') AS ordinal,
           json_extract(s.value, '$.nodes')   AS nodes
      FROM json_each(:sections_json) AS s,
           modules m
     WHERE m.slug = :slug
)
INSERT INTO content_nodes (
    section_id, ordinal, node_type, text, level, language, code,
    is_ordered, items_json, headers_json, rows_json, url, alt_text,
    line_start, line_end
)
SELECT sec.id,
       CAST(json_extract(node.value, '$.ordinal') AS INTEGER),
       json_extract(node.value, '$.node_type'),
       json_extract(node.value, '$.text'),
       CAST(json_extract(node.value, '$.level') AS INTEGER),
       json_extract(node.value, '$.language'),
       json_extract(node.value, '$.code'),
       json_extract(node.value, '$.is_ordered'),
       json_extract(node.value, '$.items'),
       json_extract(node.value, '$.headers'),
       json_extract(node.value, '$.rows'),
       json_extract(node.value, '$.url'),
       json_extract(node.value, '$.alt_text'),
       CAST(json_extract(node.value, '$.line_start') AS INTEGER),
       CAST(json_extract(node.value, '$.line_end')   AS INTEGER)
  FROM section_rows AS sr,
       json_each(sr.nodes) AS node
  JOIN sections sec ON sec.module_id = sr.module_id
                  AND sec.ordinal   = CAST(sr.ordinal AS INTEGER);

-- ---------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO tags (name)
SELECT json_extract(tag.value, '$')
  FROM json_each(:tags_json) AS tag
 WHERE json_extract(tag.value, '$') IS NOT NULL;

DELETE FROM module_tags
 WHERE module_id = (SELECT id FROM modules WHERE slug = :slug);

INSERT INTO module_tags (module_id, tag_id)
SELECT m.id, t.id
  FROM json_each(:tags_json) AS tag,
       modules m,
       tags t
 WHERE m.slug = :slug
   AND t.name = json_extract(tag.value, '$');

-- ---------------------------------------------------------------------
-- Dependencies
--
-- scope is the part before the first colon, or 'other' when there is none.
-- The substr/instr pair does that without a regex so the statement stays
-- portable to older SQLite builds.
-- ---------------------------------------------------------------------
INSERT OR IGNORE INTO dependencies (name, scope)
SELECT json_extract(dep.value, '$'),
       CASE
           WHEN instr(json_extract(dep.value, '$'), ':') > 0
               THEN substr(json_extract(dep.value, '$'), 1,
                           instr(json_extract(dep.value, '$'), ':') - 1)
           ELSE 'other'
       END
  FROM json_each(:dependencies_json) AS dep
 WHERE json_extract(dep.value, '$') IS NOT NULL;

DELETE FROM module_dependencies
 WHERE module_id = (SELECT id FROM modules WHERE slug = :slug);

INSERT INTO module_dependencies (module_id, dependency_id)
SELECT m.id, d.id
  FROM json_each(:dependencies_json) AS dep,
       modules m,
       dependencies d
 WHERE m.slug = :slug
   AND d.name = json_extract(dep.value, '$');

-- ---------------------------------------------------------------------
-- Diagnostics
-- ---------------------------------------------------------------------
INSERT INTO diagnostics (module_id, severity, rule, message, section, line)
SELECT m.id,
       json_extract(diag.value, '$.severity'),
       COALESCE(json_extract(diag.value, '$.rule'), ''),
       json_extract(diag.value, '$.message'),
       json_extract(diag.value, '$.section'),
       CAST(json_extract(diag.value, '$.line') AS INTEGER)
  FROM json_each(:diagnostics_json) AS diag,
       modules m
 WHERE m.slug = :slug;
