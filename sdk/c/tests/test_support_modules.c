/**
 * @file test_support_modules.c
 * @brief Test suite for the config, graph, and template support modules.
 */

#include "test_support.h"

static void test_config_defaults_and_targets(void)
{
    mam_config_t *config = mam_config_default();
    mam_test_report("default config allocates", config != NULL);
    if (config == NULL) {
        return;
    }
    char **problems = NULL;
    mam_test_report("the default config is valid", mam_config_validate(config, &problems) == 0u);
    mam_test_report("no problems are reported", problems == NULL);
    mam_test_report("target defaults to python", strcmp(config->target, "python") == 0);
    mam_test_report("work dir defaults to a dot", strcmp(config->work_dir, ".") == 0);
    mam_test_report("verbose defaults to false", config->verbose == false);
    mam_config_free(config);

    size_t count = 0u;
    char **targets = mam_config_list_targets(&count);
    mam_test_report("targets are listed", targets != NULL && count == 7u);
    mam_test_report("targets are sorted", targets != NULL && strcmp(targets[0], "go") == 0);
    mam_free_string_array(targets, count);
    mam_test_report("python is supported", mam_config_is_supported_target("python"));
    mam_test_report("aliases are supported", mam_config_is_supported_target("py") &&
                                            mam_config_is_supported_target("golang"));
    mam_test_report("unknown targets are rejected", !mam_config_is_supported_target("cobol"));
    mam_test_report("NULL target is rejected", !mam_config_is_supported_target(NULL));

    char *normalized = mam_config_normalize_target("  PY  ");
    mam_test_report("aliases normalize to canonical names",
                    normalized != NULL && strcmp(normalized, "python") == 0);
    free(normalized);
    char *passthrough = mam_config_normalize_target("rust");
    mam_test_report("canonical names pass through",
                    passthrough != NULL && strcmp(passthrough, "rust") == 0);
    free(passthrough);
    char *empty = mam_config_normalize_target(NULL);
    mam_test_report("NULL normalizes to empty", empty != NULL && empty[0] == '\0');
    free(empty);
}

static void test_config_validation(void)
{
    mam_config_t *bad = mam_config_default();
    free(bad->target);
    bad->target = mam_strdup("cobol");
    char **problems = NULL;
    size_t count = mam_config_validate(bad, &problems);
    mam_test_report("an unknown target is a problem", count >= 1u);
    mam_test_report("the problem names the target",
                    problems != NULL && strstr(problems[0], "cobol") != NULL);
    mam_free_string_array(problems, count);
    mam_config_free(bad);

    mam_config_t *blank = mam_config_default();
    free(blank->version);
    blank->version = mam_strdup("");
    free(blank->work_dir);
    blank->work_dir = mam_strdup("");
    problems = NULL;
    count = mam_config_validate(blank, &problems);
    mam_test_report("empty version and work dir are problems", count >= 2u);
    mam_free_string_array(problems, count);
    mam_config_free(blank);

    mam_test_report("a NULL config reports no problems", mam_config_validate(NULL, NULL) == 0u);
}

static void test_config_merge_and_json(void)
{
    mam_config_t *base = mam_config_default();
    mam_config_t *over = mam_config_default();
    free(over->target);
    over->target = mam_strdup("go");
    over->verbose = true;
    over->extra_keys = (char **)malloc(sizeof(char *));
    over->extra_values = (char **)malloc(sizeof(char *));
    over->extra_keys[0] = mam_strdup("team");
    over->extra_values[0] = mam_strdup("core");
    over->extra_count = 1u;

    mam_config_t *merged = mam_config_merge(base, over);
    mam_test_report("merge allocates", merged != NULL);
    if (merged == NULL) {
        mam_config_free(base);
        mam_config_free(over);
        return;
    }
    mam_test_report("the override wins", strcmp(merged->target, "go") == 0);
    mam_test_report("verbose is carried over", merged->verbose);
    mam_test_report("extras are merged", merged->extra_count == 1u &&
                                            strcmp(merged->extra_values[0], "core") == 0);
    mam_test_report("the base is untouched", strcmp(base->target, "python") == 0);
    mam_config_free(merged);

    char *json = mam_config_to_json(over);
    mam_test_report("config serialises to json", json != NULL && strstr(json, "\"go\"") != NULL);
    mam_test_report("json includes verbose", json != NULL && strstr(json, "true") != NULL);
    free(json);

    json = mam_config_to_json(base);
    mam_config_t *restored = mam_config_from_json(json);
    mam_test_report("config round trips", restored != NULL &&
                                           strcmp(restored->target, "python") == 0);
    free(json);
    mam_config_free(restored);

    mam_test_report("non-object json is refused", mam_config_from_json("[1,2,3]") == NULL);
    mam_test_report("NULL json is refused", mam_config_from_json(NULL) == NULL);
    mam_test_report("a NULL config still serialises", strcmp(mam_config_to_json(NULL), "{}") == 0);

    mam_config_free(base);
    mam_config_free(over);
    mam_config_free(NULL);
    mam_test_report("freeing NULL is safe", 1);
}

static void test_config_persistence(void)
{
    char *resolved = mam_config_resolve_path("somedir");
    mam_test_report("a work dir is joined with the filename",
                    resolved != NULL && strstr(resolved, "somedir") != NULL &&
                        strstr(resolved, "mam.sdk.json") != NULL);
    free(resolved);
    resolved = mam_config_resolve_path(NULL);
    mam_test_report("no work dir still yields a filename",
                    resolved != NULL && strstr(resolved, "mam.sdk.json") != NULL);
    free(resolved);

    mam_config_t *config = mam_config_default();
    free(config->target);
    config->target = mam_strdup("rust");
    mam_test_report("save writes a file", mam_config_save(config, "test-sdk-config.tmp"));
    mam_config_t *loaded = mam_config_load("test-sdk-config.tmp");
    mam_test_report("load reads it back", loaded != NULL && strcmp(loaded->target, "rust") == 0);
    mam_config_free(loaded);

    free(config->target);
    config->target = mam_strdup("cobol");
    mam_test_report("an invalid config is not saved",
                    !mam_config_save(config, "test-sdk-config.tmp"));
    mam_test_report("a NULL config is not saved", !mam_config_save(NULL, "x.tmp"));
    mam_config_free(config);

    mam_test_report("a missing file yields defaults",
                    mam_config_load("definitely-missing-9f2a.tmp") != NULL);
    remove("test-sdk-config.tmp");
}

/** Counts the graph nodes of a given kind. */
static size_t count_kind(const mam_graph_t *graph, const char *kind)
{
    size_t total = 0u;
    for (size_t i = 0u; i < graph->node_count; i++) {
        if (strcmp(graph->nodes[i].kind, kind) == 0) {
            total++;
        }
    }
    return total;
}

static void test_graph(void)
{
    mam_module_t *module = mam_parse_string(MAM_TEST_FULL_MODULE, "graph.mam.md", NULL);
    if (module == NULL) {
        return;
    }
    mam_graph_t *graph = mam_graph_build(module);
    mam_test_report("graph allocates", graph != NULL);
    if (graph == NULL) {
        mam_module_free(module);
        return;
    }
    mam_test_report("graph has a node per section plus front matter",
                    graph->node_count == 6u);
    mam_test_report("front matter is the first node",
                    strcmp(graph->nodes[0].name, "frontmatter") == 0);
    mam_test_report("dependencies become nodes", count_kind(graph, "dependency") == 1u);
    mam_test_report("edges were created", graph->edge_count > 0u);
    mam_test_report("front matter reaches the sections",
                    mam_graph_has_edge(graph, "frontmatter", "Purpose"));
    mam_test_report("reverse edges are absent",
                    !mam_graph_has_edge(graph, "Purpose", "frontmatter"));

    size_t count = 0u;
    char **successors = mam_graph_successors(graph, "frontmatter", &count);
    mam_test_report("front matter has successors", count > 0u && successors != NULL);
    mam_free_string_array(successors, count);

    successors = mam_graph_predecessors(graph, "frontmatter", &count);
    mam_test_report("front matter has no predecessors", count == 0u);
    mam_free_string_array(successors, count);

    char **order = NULL;
    size_t ordered = mam_graph_topological_sort(graph, &order);
    mam_test_report("the graph sorts", ordered == graph->node_count && order != NULL);
    mam_test_report("front matter sorts first",
                    ordered > 0u && strcmp(order[0], "frontmatter") == 0);
    mam_free_string_array(order, ordered);

    char *summary = mam_graph_summary(graph);
    mam_test_report("the graph summarises", summary != NULL && strstr(summary, "nodes") != NULL);
    free(summary);
    char *text = mam_graph_to_text(graph);
    mam_test_report("the graph renders", text != NULL && strstr(text, "frontmatter") != NULL);
    free(text);

    mam_graph_free(graph);
    mam_module_free(module);
    mam_graph_free(NULL);
    mam_test_report("freeing NULL is safe", 1);
    mam_test_report("a NULL module is refused", mam_graph_build(NULL) == NULL);
}

static void test_templates(void)
{
    size_t count = 0u;
    char **kinds = mam_template_list_kinds(&count);
    mam_test_report("three starter kinds are offered", kinds != NULL && count == 3u);
    mam_free_string_array(kinds, count);

    char *module_template = mam_template_get("module");
    mam_test_report("the module template has placeholders",
                    module_template != NULL && strstr(module_template, "{{name}}") != NULL);
    free(module_template);
    mam_test_report("aliases resolve", mam_template_get("bot") != NULL &&
                                       mam_template_get("mod") != NULL &&
                                       mam_template_get("utility") != NULL);
    free(mam_template_get("bot"));
    free(mam_template_get("mod"));
    free(mam_template_get("utility"));
    mam_test_report("an unknown kind is refused", mam_template_get("spaceship") == NULL);
    mam_test_report("a NULL kind is refused", mam_template_get(NULL) == NULL);

    const char *vars[4] = {"name", "MAM", "version", "2.0.0"};
    char *rendered = mam_template_render("Hello {{name}} v{{version}}!", vars, 4u);
    mam_test_report("placeholders are substituted",
                    rendered != NULL && strcmp(rendered, "Hello MAM v2.0.0!") == 0);
    free(rendered);
    rendered = mam_template_render("Hi {{missing}}", vars, 4u);
    mam_test_report("unknown placeholders are preserved",
                    rendered != NULL && strcmp(rendered, "Hi {{missing}}") == 0);
    free(rendered);
    rendered = mam_template_render("{{NAME}}", vars, 4u);
    mam_test_report("matching is case insensitive", rendered != NULL &&
                                                      strcmp(rendered, "MAM") == 0);
    free(rendered);
    rendered = mam_template_render("{single}", vars, 4u);
    mam_test_report("a lone brace is preserved", rendered != NULL && strcmp(rendered, "{single}") == 0);
    free(rendered);
    rendered = mam_template_render("{{not an identifier}}", vars, 4u);
    mam_test_report("a non-identifier placeholder is preserved",
                    rendered != NULL && strstr(rendered, "{{not an identifier}}") != NULL);
    free(rendered);
    mam_test_report("a NULL template renders nothing", mam_template_render(NULL, vars, 4u) == NULL);

    char *slug = mam_template_slugify("My Module Name");
    mam_test_report("slugify lowercases and dashes", slug != NULL && strcmp(slug, "my-module-name") == 0);
    free(slug);
    slug = mam_template_slugify("Already-Slug");
    mam_test_report("slugify is idempotent on slugs",
                    slug != NULL && strcmp(slug, "already-slug") == 0);
    free(slug);
    slug = mam_template_slugify(NULL);
    mam_test_report("slugify tolerates NULL", slug != NULL && slug[0] == '\0');
    free(slug);
}

static void test_template_names_and_output(void)
{
    size_t count = 0u;
    mam_test_report("a good name has no problems", mam_template_validate_name("Good Name-1", &count) == NULL &&
                                                     count == 0u);
    char **problems = mam_template_validate_name("   ", &count);
    mam_test_report("a blank name is a problem", count >= 1u && problems != NULL);
    mam_free_string_array(problems, count);
    problems = mam_template_validate_name("bad/name", &count);
    mam_test_report("a slash is a problem", count >= 1u);
    mam_free_string_array(problems, count);
    problems = mam_template_validate_name("-leading", &count);
    mam_test_report("a leading dash is a problem", count >= 1u);
    mam_free_string_array(problems, count);
    char long_name[100];
    memset(long_name, 'a', sizeof(long_name) - 1u);
    long_name[sizeof(long_name) - 1u] = '\0';
    problems = mam_template_validate_name(long_name, &count);
    mam_test_report("an overlong name is a problem", count >= 1u);
    mam_free_string_array(problems, count);

    char *starter = mam_template_new_module("demo", "module", "python");
    mam_test_report("a starter renders", starter != NULL);
    mam_test_report("the starter carries the name", starter != NULL &&
                                                     strstr(starter, "name: demo") != NULL);
    mam_test_report("the starter carries the slug id",
                    starter != NULL && strstr(starter, "id: demo") != NULL);
    mam_test_report("the starter has no leftover placeholders",
                    starter != NULL && strstr(starter, "{{") == NULL);
    mam_test_report("the starter parses as a module",
                    mam_parse_string(starter, "starter.mam.md", NULL) != NULL);
    free(starter);

    starter = mam_template_new_module("bot", "bot", "python");
    mam_test_report("an agent starter renders", starter != NULL &&
                                                  strstr(starter, "## Role") != NULL);
    free(starter);
    starter = mam_template_new_module("tool", "cli", "go");
    mam_test_report("a tool starter honours the runtime",
                    starter != NULL && strstr(starter, "runtime: go") != NULL);
    free(starter);
    mam_test_report("an invalid name refuses to render",
                    mam_template_new_module("  ", "module", "python") == NULL);
    mam_test_report("an unknown kind refuses to render",
                    mam_template_new_module("demo", "spaceship", "python") == NULL);
    mam_test_report("a NULL name refuses to render",
                    mam_template_new_module(NULL, "module", "python") == NULL);
}

int main(void)
{
    printf("test_support_modules\n");
    test_config_defaults_and_targets();
    test_config_validation();
    test_config_merge_and_json();
    test_config_persistence();
    test_graph();
    test_templates();
    test_template_names_and_output();
    return mam_test_suite_result("test_support_modules") == 0 ? 0 : 1;
}
