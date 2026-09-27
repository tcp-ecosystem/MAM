-- =====================================================================
-- MAM SQL SDK — conformance cases
--
-- Each case is a named expectation about the schema and queries, expressed so
-- it can be checked mechanically by tests/check_structure.py: that is, without
-- a database. They assert on structure — which relations exist, which columns
-- they have, which constraints and views are declared, and which relations the
-- queries reference.
--
-- The `.sql` fixtures below are the data each case would load if a real engine
-- were available. They are deliberately small and hand-checkable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- fixture: minimal module
--
-- The smallest document that validates: name and version in front matter, and
-- a purpose section.
-- ---------------------------------------------------------------------

INSERT INTO modules (slug, name, version, runtime, source_hash, raw_content)
VALUES ('minimal', 'Minimal', '2.0.0', 'python', 'hash-minimal', '---\nname: Minimal\nversion: 2.0.0\n---\n\n## Purpose\n\nDoes the minimum.\n');

INSERT INTO sections (module_id, ordinal, kind, title, line_start)
SELECT id, 0, 'purpose', 'Purpose', 7 FROM modules WHERE slug = 'minimal';

INSERT INTO content_nodes (section_id, ordinal, node_type, text)
SELECT s.id, 0, 'paragraph', 'Does the minimum.'
  FROM sections s JOIN modules m ON m.id = s.module_id
 WHERE m.slug = 'minimal' AND s.ordinal = 0;

INSERT OR IGNORE INTO tags (name) VALUES ('utility');
INSERT INTO module_tags (module_id, tag_id)
SELECT m.id, t.id FROM modules m, tags t
 WHERE m.slug = 'minimal' AND t.name = 'utility';

-- ---------------------------------------------------------------------
-- fixture: full module with code blocks, dependencies, and diagnostics
-- ---------------------------------------------------------------------

INSERT INTO modules (slug, name, version, description, runtime, source_hash, raw_content)
VALUES ('full', 'Full Module', '2.0.0', 'A module with everything.', 'python', 'hash-full', '---\nname: Full Module\nversion: 2.0.0\nruntime: python\n---\n\n## Purpose\n\nDoes everything.\n\n## Rules\n\n- One.\n- Two.\n\n## Python\n\n```python\nprint(1)\n```\n');

INSERT INTO sections (module_id, ordinal, kind, title, line_start)
SELECT id, 0, 'purpose', 'Purpose', 7 FROM modules WHERE slug = 'full';
INSERT INTO sections (module_id, ordinal, kind, title, line_start)
SELECT id, 1, 'rules', 'Rules', 9 FROM modules WHERE slug = 'full';
INSERT INTO sections (module_id, ordinal, kind, title, line_start)
SELECT id, 2, 'python', 'Python', 13 FROM modules WHERE slug = 'full';

INSERT INTO content_nodes (section_id, ordinal, node_type, text)
SELECT s.id, 0, 'paragraph', 'Does everything.'
  FROM sections s JOIN modules m ON m.id = s.module_id
 WHERE m.slug = 'full' AND s.ordinal = 0;

INSERT INTO content_nodes (section_id, ordinal, node_type, is_ordered, items_json)
SELECT s.id, 0, 'list', 0, '["One","Two"]'
  FROM sections s JOIN modules m ON m.id = s.module_id
 WHERE m.slug = 'full' AND s.ordinal = 1;

INSERT INTO content_nodes (section_id, ordinal, node_type, language, code, line_start)
SELECT s.id, 0, 'code_block', 'python', 'print(1)', 15
  FROM sections s JOIN modules m ON m.id = s.module_id
 WHERE m.slug = 'full' AND s.ordinal = 2;

INSERT OR IGNORE INTO dependencies (name, scope) VALUES ('pip:requests', 'pip');
INSERT OR IGNORE INTO dependencies (name, scope) VALUES ('npm:left-pad', 'npm');

INSERT INTO module_dependencies (module_id, dependency_id)
SELECT m.id, d.id FROM modules m, dependencies d
 WHERE m.slug = 'full' AND d.name IN ('pip:requests', 'npm:left-pad');

INSERT INTO diagnostics (module_id, severity, rule, message, section, line)
SELECT id, 'warning', 'section-order', 'Python should come before Purpose', 'Python', 13
  FROM modules WHERE slug = 'full';
INSERT INTO diagnostics (module_id, severity, rule, message, section, line)
SELECT id, 'info', 'recommended', 'Recommended section missing: outputs', 'purpose', 7
  FROM modules WHERE slug = 'full';

INSERT INTO parse_runs (source_path, source_hash, parser_version, succeeded, error_count, warning_count, module_id, duration_ms)
SELECT 'full.mam.md', 'hash-full', 'mam-c/0.1.0', 1, 0, 1, id, 4 FROM modules WHERE slug = 'full';

-- =====================================================================
-- Expected results
--
-- Written as comments so the expectations are reviewable by a human and
-- machine-checkable by counting the statements above.
-- =====================================================================
--
-- EXPECT modules: 2 rows
--   minimal: section_count 1, node_count 1, code_block_count 0
--   full:    section_count 3, node_count 3, code_block_count 1
--
-- EXPECT v_module_summary for 'full':
--   error_count 0, warning_count 1
--
-- EXPECT v_code_blocks for 'full':
--   exactly 1 row, language 'python', section_kind 'python', code 'print(1)'
--
-- EXPECT v_code_blocks language summary across the registry:
--   one row, language 'python', block_count 1, module_count 1
--
-- EXPECT dependencies: 2 rows, scopes 'npm' and 'pip'
-- EXPECT v_dependency_edges: 2 rows, both with source_slug 'full'
--
-- EXPECT shared-dependency query over the fixture set:
--   0 rows, because no two modules declare the same dependency
--
-- EXPECT diagnostics for 'full', most severe first:
--   row 1 severity 'warning' (errors sort before warnings; there are none)
--   row 2 severity 'info'
--
-- EXPECT severity counts for 'full':
--   warning 1, info 1
--
-- EXPECT v_invalid_modules: 0 rows, because neither fixture has an error
--
-- EXPECT recursive transitive dependencies of 'full':
--   2 rows, pip:requests and npm:left-pad, both at depth 0
--
-- EXPECT reverse reachability of 'pip:requests':
--   1 row, 'full', at depth 0
--
-- EXPECT modules declaring no dependencies:
--   1 row, 'minimal'
--
-- EXPECT integrity queries: 0 rows in all three
--   no orphaned sections, no orphaned nodes, and both modules have dense
--   0-based section ordinals
--
-- EXPECT module housekeeping: module_count 2, total_bytes the sum of both
--   raw_content lengths
