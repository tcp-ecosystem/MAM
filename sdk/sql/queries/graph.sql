-- =====================================================================
-- MAM registry — dependency graph traversal
--
-- Two shapes of question, two query shapes:
--
--   * "What does this module depend on, directly?"        -> one hop
--   * "What breaks if I remove this package?"             -> reverse reachability
--   * "Show the whole graph"                              -> the edge list
--
-- The recursive CTE form is what makes the transitive cases possible without
-- a recursive trigger or an external graph extension. Cycle protection matters
-- here: MAM dependency data is hand-written, so a cycle is a realistic input
-- rather than a theoretical one. `path` guards against it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Direct edges
-- ---------------------------------------------------------------------

-- Every dependency edge in the registry.
SELECT source_slug, target_name, target_scope
  FROM v_dependency_edges
 ORDER BY source_slug, target_name;

-- Edges for one module only.
SELECT target_name, target_scope
  FROM v_dependency_edges
 WHERE source_slug = :slug
 ORDER BY target_scope, target_name;

-- Packages with no dependents, which are leaves of the graph.
SELECT d.name, d.scope
  FROM dependencies d
 WHERE NOT EXISTS (SELECT 1 FROM module_dependencies md WHERE md.dependency_id = d.id)
 ORDER BY d.name;

-- Packages nothing declares, which are roots.
SELECT d.name, d.scope
  FROM dependencies d
  JOIN module_dependencies md ON md.dependency_id = d.id
 GROUP BY d.id, d.name, d.scope
HAVING COUNT(DISTINCT md.module_id) = 1
 ORDER BY d.name;

-- ---------------------------------------------------------------------
-- Transitive dependencies of one module
--
-- :slug is the starting module. `path` records the route taken so a cycle
-- terminates instead of looping forever.
-- ---------------------------------------------------------------------
WITH RECURSIVE deps(slug, name, scope, depth, path) AS (
    SELECT m.slug,
           d.name,
           d.scope,
           0,
           '/' || m.slug || '/' || d.name || '/'
      FROM modules m
      JOIN module_dependencies md ON md.module_id = m.id
      JOIN dependencies d         ON d.id = md.dependency_id
     WHERE m.slug = :slug

    UNION ALL

    SELECT deps.slug,
           next.name,
           next.scope,
           deps.depth + 1,
           deps.path || next.name || '/'
      FROM deps
      JOIN v_dependency_edges e ON e.source_slug = deps.name
      JOIN dependencies next     ON next.name = e.target_name
     WHERE deps.path NOT LIKE '%/' || next.name || '/%'
       AND deps.depth < 64
)
SELECT name, scope, MIN(depth) AS shortest_depth
  FROM deps
 GROUP BY name, scope
 ORDER BY shortest_depth, name;

-- ---------------------------------------------------------------------
-- Reverse reachability
--
-- Which modules would be affected by removing :dependency, directly or
-- through the graph. This is the query a CI job runs before deleting a
-- dependency from a shared library.
-- ---------------------------------------------------------------------
WITH RECURSIVE dependents(name, depth, path) AS (
    SELECT m.slug, 0, '/' || m.slug || '/'
      FROM modules m
      JOIN module_dependencies md ON md.module_id = m.id
      JOIN dependencies d         ON d.id = md.dependency_id
     WHERE d.name = :dependency

    UNION ALL

    SELECT e.source_slug,
           dependents.depth + 1,
           dependents.path || e.source_slug || '/'
      FROM dependents
      JOIN v_dependency_edges e ON e.target_name = dependents.name
     WHERE dependents.path NOT LIKE '%/' || e.source_slug || '/%'
       AND dependents.depth < 64
)
SELECT name, MIN(depth) AS shortest_depth
  FROM dependents
 GROUP BY name
 ORDER BY shortest_depth, name;

-- ---------------------------------------------------------------------
-- Shared dependencies
--
-- Modules that appear together, which is the practical way to spot accidental
-- coupling between modules that were written independently.
-- ---------------------------------------------------------------------
SELECT a.slug        AS slug_a,
       b.slug        AS slug_b,
       COUNT(*)      AS shared_count
  FROM module_dependencies ma
  JOIN modules a           ON a.id = ma.module_id
  JOIN module_dependencies mb ON mb.dependency_id = ma.dependency_id
  JOIN modules b           ON b.id = mb.module_id
 WHERE a.id < b.id
 GROUP BY a.slug, b.slug
HAVING COUNT(*) > 0
 ORDER BY shared_count DESC, slug_a, slug_b
 LIMIT 100;

-- ---------------------------------------------------------------------
-- Ecosystem summary
--
-- How much of the registry depends on each ecosystem, which is the number
-- that decides whether a dependency bump is a one-module change or a fleet-wide
-- one.
-- ---------------------------------------------------------------------
WITH RECURSIVE ecosystems(scope, total_modules) AS (
    SELECT scope, (SELECT COUNT(*) FROM modules)
      FROM dependencies
     GROUP BY scope
)
SELECT e.scope,
       e.total_modules,
       (SELECT COUNT(DISTINCT md.module_id)
          FROM module_dependencies md
          JOIN dependencies d ON d.id = md.dependency_id
         WHERE d.scope = e.scope) AS using_modules,
       (SELECT COUNT(*)
          FROM dependencies d
         WHERE d.scope = e.scope) AS package_count
  FROM ecosystems e
 ORDER BY using_modules DESC, e.scope;
