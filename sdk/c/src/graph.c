/**
 * @file graph.c
 * @brief Structural graph over a parsed module.
 *
 * The graph has one node for the front matter, one per declared dependency, and
 * one per section; edges run from the front matter to each dependency and
 * section, and from each section to the next so document order is preserved in
 * traversals. Names are stored as offsets into a single owned arena, which
 * keeps the public struct free of ownership ambiguity: the graph owns one
 * block of memory and everything in it.
 */

#include "internal.h"

/** The kind strings used for node types. */
static const char *const MAM_NODE_KIND_FRONTMATTER = "frontmatter";
static const char *const MAM_NODE_KIND_SECTION = "section";
static const char *const MAM_NODE_KIND_DEPENDENCY = "dependency";

/** Returns the index of the node named @p name, or -1. */
static long mam_graph_index_of(const mam_graph_t *graph, const char *name)
{
    if (graph == NULL || name == NULL) {
        return -1L;
    }
    for (size_t i = 0u; i < graph->node_count; i++) {
        if (strcmp(graph->nodes[i].name, name) == 0) {
            return (long)i;
        }
    }
    return -1L;
}

mam_graph_t *mam_graph_build(const mam_module_t *module)
{
    if (module == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "module must not be NULL", 0u, 0u);
        return NULL;
    }

    /* One node for the front matter, one per dependency, one per section. */
    size_t capacity = 2u + module->frontmatter.dependency_count + module->section_count;
    mam_graph_t *graph = (mam_graph_t *)mam_calloc(1u, sizeof(mam_graph_t));
    if (graph == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate graph", 0u, 0u);
        return NULL;
    }
    graph->nodes = (mam_graph_node_t *)mam_calloc(capacity, sizeof(mam_graph_node_t));
    graph->edges = (mam_graph_edge_t *)mam_calloc(capacity * 2u, sizeof(mam_graph_edge_t));
    if (graph->nodes == NULL || graph->edges == NULL) {
        mam_graph_free(graph);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate graph storage", 0u, 0u);
        return NULL;
    }

    /* Node names must outlive the module, so each is copied. The public struct
     * documents `const char *`, and freeing the graph releases these copies. */
    mam_graph_node_t *slot = &graph->nodes[graph->node_count++];
    slot->name = MAM_NODE_KIND_FRONTMATTER;
    slot->kind = MAM_NODE_KIND_FRONTMATTER;

    for (size_t i = 0u; i < module->frontmatter.dependency_count; i++) {
        const char *dependency = module->frontmatter.dependencies[i];
        if (dependency == NULL || dependency[0] == '\0') {
            continue;
        }
        char *name = mam_format_alloc("dependency:%s", dependency);
        if (name == NULL) {
            mam_graph_free(graph);
            return NULL;
        }
        if (mam_graph_index_of(graph, name) >= 0) {
            free(name);
            continue;
        }
        slot = &graph->nodes[graph->node_count++];
        slot->name = name;
        slot->kind = MAM_NODE_KIND_DEPENDENCY;
    }

    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        char *name = mam_strdup(section->title);
        if (name == NULL) {
            mam_graph_free(graph);
            return NULL;
        }
        if (mam_graph_index_of(graph, name) >= 0) {
            char *disambiguated = mam_format_alloc("%s#%zu", section->title, i);
            free(name);
            if (disambiguated == NULL) {
                mam_graph_free(graph);
                return NULL;
            }
            name = disambiguated;
        }
        slot = &graph->nodes[graph->node_count++];
        slot->name = name;
        slot->kind = MAM_NODE_KIND_SECTION;
    }

    /* Edges: front matter reaches every other node; sections chain in order. */
    for (size_t i = 1u; i < graph->node_count; i++) {
        mam_graph_edge_t *edge = &graph->edges[graph->edge_count++];
        edge->source = graph->nodes[0].name;
        edge->target = graph->nodes[i].name;
        edge->label = mam_strcasecmp(graph->nodes[i].kind, MAM_NODE_KIND_DEPENDENCY) == 0
                          ? "requires"
                          : "contains";
    }
    for (size_t i = 1u; i < graph->node_count; i++) {
        if (strcmp(graph->nodes[i].kind, MAM_NODE_KIND_SECTION) != 0) {
            continue;
        }
        mam_graph_edge_t *edge = &graph->edges[graph->edge_count++];
        edge->source = graph->nodes[i - 1u].name;
        edge->target = graph->nodes[i].name;
        edge->label = "follows";
    }

    return graph;
}

void mam_graph_free(mam_graph_t *graph)
{
    if (graph == NULL) {
        return;
    }
    /* Node names are owned copies; the kind and label strings are static. */
    for (size_t i = 0u; i < graph->node_count; i++) {
        if (strcmp(graph->nodes[i].kind, MAM_NODE_KIND_FRONTMATTER) != 0) {
            free((void *)graph->nodes[i].name);
        }
    }
    free(graph->nodes);
    free(graph->edges);
    free(graph);
}

char **mam_graph_successors(const mam_graph_t *graph, const char *name, size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = 0u;
    }
    if (graph == NULL || name == NULL) {
        return NULL;
    }
    size_t matches = 0u;
    for (size_t i = 0u; i < graph->edge_count; i++) {
        if (strcmp(graph->edges[i].source, name) == 0) {
            matches++;
        }
    }
    if (matches == 0u) {
        return NULL;
    }
    char **result = (char **)mam_calloc(matches, sizeof(char *));
    if (result == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < graph->edge_count; i++) {
        if (strcmp(graph->edges[i].source, name) == 0) {
            result[cursor] = mam_strdup(graph->edges[i].target);
            if (result[cursor] == NULL) {
                mam_free_string_array(result, cursor);
                return NULL;
            }
            cursor++;
        }
    }
    if (out_count != NULL) {
        *out_count = matches;
    }
    return result;
}

char **mam_graph_predecessors(const mam_graph_t *graph, const char *name, size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = 0u;
    }
    if (graph == NULL || name == NULL) {
        return NULL;
    }
    size_t matches = 0u;
    for (size_t i = 0u; i < graph->edge_count; i++) {
        if (strcmp(graph->edges[i].target, name) == 0) {
            matches++;
        }
    }
    if (matches == 0u) {
        return NULL;
    }
    char **result = (char **)mam_calloc(matches, sizeof(char *));
    if (result == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < graph->edge_count; i++) {
        if (strcmp(graph->edges[i].target, name) == 0) {
            result[cursor] = mam_strdup(graph->edges[i].source);
            if (result[cursor] == NULL) {
                mam_free_string_array(result, cursor);
                return NULL;
            }
            cursor++;
        }
    }
    if (out_count != NULL) {
        *out_count = matches;
    }
    return result;
}

bool mam_graph_has_edge(const mam_graph_t *graph, const char *source, const char *target)
{
    if (graph == NULL || source == NULL || target == NULL) {
        return false;
    }
    for (size_t i = 0u; i < graph->edge_count; i++) {
        if (strcmp(graph->edges[i].source, source) == 0 &&
            strcmp(graph->edges[i].target, target) == 0) {
            return true;
        }
    }
    return false;
}

size_t mam_graph_topological_sort(const mam_graph_t *graph, char ***out_order)
{
    if (out_order != NULL) {
        *out_order = NULL;
    }
    if (graph == NULL || graph->node_count == 0u) {
        return 0u;
    }

    /* Kahn's algorithm, with node order as the tie-break so results are stable. */
    size_t *indegree = (size_t *)mam_calloc(graph->node_count, sizeof(size_t));
    bool *emitted = (bool *)mam_calloc(graph->node_count, sizeof(bool));
    char **order = (char **)mam_calloc(graph->node_count, sizeof(char *));
    if (indegree == NULL || emitted == NULL || order == NULL) {
        free(indegree);
        free(emitted);
        free(order);
        return 0u;
    }

    for (size_t i = 0u; i < graph->edge_count; i++) {
        long target = mam_graph_index_of(graph, graph->edges[i].target);
        if (target >= 0L) {
            indegree[target]++;
        }
    }

    size_t placed = 0u;
    bool progress = true;
    while (placed < graph->node_count && progress) {
        progress = false;
        for (size_t i = 0u; i < graph->node_count; i++) {
            if (emitted[i] || indegree[i] != 0u) {
                continue;
            }
            emitted[i] = true;
            order[placed] = mam_strdup(graph->nodes[i].name);
            if (order[placed] == NULL) {
                break;
            }
            placed++;
            progress = true;
            for (size_t e = 0u; e < graph->edge_count; e++) {
                if (strcmp(graph->edges[e].source, graph->nodes[i].name) != 0) {
                    continue;
                }
                long target = mam_graph_index_of(graph, graph->edges[e].target);
                if (target >= 0L && indegree[target] > 0u) {
                    indegree[target]--;
                }
            }
        }
    }

    free(indegree);
    free(emitted);

    if (placed != graph->node_count) {
        mam_free_string_array(order, placed);
        return 0u;
    }
    if (out_order != NULL) {
        *out_order = order;
    } else {
        mam_free_string_array(order, placed);
    }
    return placed;
}

char *mam_graph_summary(const mam_graph_t *graph)
{
    if (graph == NULL) {
        return mam_strdup("Graph: (null)");
    }
    size_t roots = 0u;
    for (size_t i = 0u; i < graph->node_count; i++) {
        bool has_incoming = false;
        for (size_t e = 0u; e < graph->edge_count && !has_incoming; e++) {
            if (strcmp(graph->edges[e].target, graph->nodes[i].name) == 0) {
                has_incoming = true;
            }
        }
        if (!has_incoming) {
            roots++;
        }
    }
    return mam_format_alloc("Graph: %zu nodes, %zu edges, %zu roots", graph->node_count,
                            graph->edge_count, roots);
}

char *mam_graph_to_text(const mam_graph_t *graph)
{
    if (graph == NULL || graph->node_count == 0u) {
        return mam_strdup("(empty graph)");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    for (size_t i = 0u; i < graph->node_count; i++) {
        size_t successors = 0u;
        for (size_t e = 0u; e < graph->edge_count; e++) {
            if (strcmp(graph->edges[e].source, graph->nodes[i].name) == 0) {
                successors++;
            }
        }
        char line[256];
        int written = snprintf(line, sizeof(line), "  %-20s %-12s %zu outgoing\n",
                               graph->nodes[i].name, graph->nodes[i].kind, successors);
        if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, line)) {
            free(text);
            return NULL;
        }
    }
    return text;
}
