-- =====================================================================
-- MAM registry — read queries
--
-- Every query here is read-only and parameterised. `:slug` is the module
-- identifier used throughout the ingest path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Module lookup
-- ---------------------------------------------------------------------

-- Full row for one module, or no rows when the slug is unknown.
SELECT id, slug, name, version, description, schema_version, author,
       license, runtime, source_path, source_hash, raw_content,
       created_at, updated_at
  FROM modules
 WHERE slug = :slug;

-- Headline counts without loading the module body. Prefer this over selecting
-- from `modules` directly when raw_content is not needed; it avoids pulling
-- potentially large text through the driver.
SELECT module_id, slug, name, version, runtime, updated_at,
       section_count, node_count, code_block_count, error_count, warning_count
  FROM v_module_summary
 WHERE slug = :slug;

-- Search by free text across the fields a user is likely to type.
SELECT module_id, slug, name, version, runtime
  FROM v_module_summary
 WHERE name LIKE '%' || :needle || '%'
    OR description LIKE '%' || :needle || '%'
   ORDER BY name;

-- ---------------------------------------------------------------------
-- Sections
-- ---------------------------------------------------------------------

-- Section outline for one module, in document order.
SELECT s.ordinal,
       s.kind,
       s.title,
       s.line_start,
       s.line_end,
       (SELECT COUNT(*) FROM content_nodes n WHERE n.section_id = s.id) AS node_count
  FROM sections s
  JOIN modules m ON m.id = s.module_id
 WHERE m.slug = :slug
 ORDER BY s.ordinal;

-- Only the sections of one kind, for example every 'python' section.
SELECT s.ordinal, s.title, s.line_start
  FROM sections s
  JOIN modules m ON m.id = s.module_id
 WHERE m.slug = :slug
   AND s.kind = :kind
 ORDER BY s.ordinal;

-- Every distinct section kind in the registry, with usage counts.
SELECT kind, COUNT(*) AS section_count, COUNT(DISTINCT module_id) AS module_count
  FROM sections
 GROUP BY kind
 ORDER BY section_count DESC, kind;

-- ---------------------------------------------------------------------
-- Code blocks
-- ---------------------------------------------------------------------

-- All code blocks in a module, in document order.
SELECT section_kind, section_title, node_ordinal, language, code, line_start
  FROM v_code_blocks
 WHERE module_id = (SELECT id FROM modules WHERE slug = :slug)
 ORDER BY section_kind, node_ordinal;

-- Code blocks of one language across the whole registry.
SELECT slug, section_title, line_start, code
  FROM v_code_blocks
 WHERE language = :language
 ORDER BY slug, line_start;

-- Which languages are in use, and how often. Useful for deciding which
-- interpreters a CI image needs.
SELECT COALESCE(NULLIF(language, ''), '(none)') AS language,
       COUNT(*)                                 AS block_count,
       COUNT(DISTINCT module_id)                 AS module_count
  FROM v_code_blocks
 GROUP BY COALESCE(NULLIF(language, ''), '(none)')
 ORDER BY block_count DESC, language;

-- Modules that have at least one executable-looking block.
SELECT slug, name, runtime, code_block_count
  FROM v_module_summary
 WHERE code_block_count > 0
 ORDER BY slug;

-- ---------------------------------------------------------------------
-- Tags
-- ---------------------------------------------------------------------

-- Modules carrying one tag.
SELECT m.id, m.slug, m.name, m.version
  FROM modules m
  JOIN module_tags mt ON mt.module_id = m.id
  JOIN tags t         ON t.id = mt.tag_id
 WHERE t.name = :tag
 ORDER BY m.name;

-- Tag popularity, most used first.
SELECT t.name, COUNT(*) AS module_count
  FROM tags t
  JOIN module_tags mt ON mt.tag_id = t.id
 GROUP BY t.name
 ORDER BY module_count DESC, t.name;

-- Modules carrying every tag in :tags, for AND-style filtering.
SELECT m.id, m.slug, m.name
  FROM modules m
  JOIN module_tags mt ON mt.module_id = m.id
  JOIN tags t         ON t.id = mt.tag_id
 WHERE t.name IN (SELECT value FROM json_each(:tags))
 GROUP BY m.id, m.slug, m.name
HAVING COUNT(DISTINCT t.name) = (
        SELECT COUNT(*) FROM json_each(:tags))
 ORDER BY m.name;

-- ---------------------------------------------------------------------
-- Dependencies
-- ---------------------------------------------------------------------

-- Direct dependencies of one module.
SELECT d.name, d.scope
  FROM module_dependencies md
  JOIN dependencies d ON d.id = md.dependency_id
  JOIN modules m       ON m.id = md.module_id
 WHERE m.slug = :slug
 ORDER BY d.scope, d.name;

-- Which modules depend on a given package.
SELECT m.slug, m.name, m.version
  FROM modules m
  JOIN module_dependencies md ON md.module_id = m.id
  JOIN dependencies d         ON d.id = md.dependency_id
 WHERE d.name = :dependency
 ORDER BY m.name;

-- Dependency usage across the registry, by ecosystem.
SELECT scope,
       COUNT(DISTINCT d.id) AS dependency_count,
       COUNT(*)             AS reference_count
  FROM dependencies d
  JOIN module_dependencies md ON md.dependency_id = d.id
 GROUP BY scope
 ORDER BY reference_count DESC, scope;

-- Modules that declare no dependencies at all, which is often a smell.
SELECT slug, name, runtime
  FROM v_module_summary
 WHERE slug NOT IN (SELECT m.slug
                      FROM modules m
                      JOIN module_dependencies md ON md.module_id = m.id)
 ORDER BY slug;

-- ---------------------------------------------------------------------
-- Validation
-- ---------------------------------------------------------------------

-- Findings for one module, most severe first.
SELECT severity, rule, message, section, line
  FROM diagnostics
 WHERE module_id = (SELECT id FROM modules WHERE slug = :slug)
 ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
          line NULLS LAST, id;

-- Counts by severity for one module.
SELECT severity, COUNT(*) AS finding_count
  FROM diagnostics
 WHERE module_id = (SELECT id FROM modules WHERE slug = :slug)
 GROUP BY severity
 ORDER BY finding_count DESC;

-- Every module that currently fails validation, for a CI gate.
SELECT module_id, slug, error_count, warning_count
  FROM v_invalid_modules
 ORDER BY error_count DESC, slug;

-- The most frequently triggered rules, which points at the schema or the
-- writers rather than at any one module.
SELECT rule, severity, COUNT(*) AS finding_count
  FROM diagnostics
 GROUP BY rule, severity
HAVING COUNT(*) > 0
 ORDER BY finding_count DESC, rule
 LIMIT 50;

-- ---------------------------------------------------------------------
-- Parse history
-- ---------------------------------------------------------------------

-- Recent parse runs, newest first, for one source path.
SELECT id, source_path, parser_version, succeeded,
       error_count, warning_count, duration_ms, started_at
  FROM parse_runs
 WHERE source_path = :source_path
 ORDER BY started_at DESC
 LIMIT 50;

-- Modules that have never parsed successfully.
SELECT DISTINCT pr.source_path, MAX(pr.started_at) AS last_attempt
  FROM parse_runs pr
 WHERE pr.succeeded = 0
   AND NOT EXISTS (
       SELECT 1 FROM parse_runs ok
        WHERE ok.source_path = pr.source_path
          AND ok.succeeded = 1)
 GROUP BY pr.source_path
 ORDER BY last_attempt DESC;

-- Which source documents changed since a given point, by hash.
SELECT source_path, source_hash, started_at
  FROM parse_runs
 WHERE succeeded = 1
   AND source_hash <> (
       SELECT source_hash FROM parse_runs prev
        WHERE prev.source_path = parse_runs.source_path
          AND prev.succeeded = 1
          AND prev.started_at < parse_runs.started_at
        ORDER BY prev.started_at DESC LIMIT 1)
   AND source_hash IS NOT NULL
 ORDER BY started_at DESC;

-- ---------------------------------------------------------------------
-- Integrity
-- ---------------------------------------------------------------------

-- Orphaned sections, which would indicate a broken ingest.
SELECT s.id, s.module_id
  FROM sections s
 WHERE s.module_id NOT IN (SELECT id FROM modules);

-- Orphaned nodes, same purpose.
SELECT n.id, n.section_id
  FROM content_nodes n
 WHERE n.section_id NOT IN (SELECT id FROM sections);

-- Sections whose ordinals are not a dense 0-based sequence.
SELECT module_id, COUNT(*) AS section_count, MIN(ordinal) AS min_ordinal, MAX(ordinal) AS max_ordinal
  FROM sections
 GROUP BY module_id
HAVING MIN(ordinal) <> 0 OR MAX(ordinal) <> COUNT(*) - 1;

-- Module count and body size, for housekeeping.
SELECT COUNT(*)                       AS module_count,
       COALESCE(SUM(LENGTH(raw_content)), 0) AS total_bytes,
       COALESCE(AVG(LENGTH(raw_content)), 0) AS average_bytes
  FROM modules;
