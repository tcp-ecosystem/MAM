/**
 * @file support.h
 * @brief Public API for the MAM C SDK support modules.
 *
 * These modules mirror the support surface of the other MAM SDKs: `config`,
 * `cache`, `format`, `graph`, `template`, and `doctor`. They are deliberately
 * free of any dependency on the parser, so each can be used on its own.
 *
 * The ownership rules stated in mam.h apply here without exception:
 *   - Owned objects are released by their matching `mam_*_free` function.
 *   - Borrowed `const char *` pointers stay valid only while their parent
 *     object lives.
 *   - Any function documented as returning a `char *` hands ownership to the
 *     caller, who must release it with `free()`.
 */

#ifndef MAM_SUPPORT_H
#define MAM_SUPPORT_H

#include "mam.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------- */
/* config                                                                     */
/* ------------------------------------------------------------------------- */

/** Name of the configuration file. */
#define MAM_CONFIG_FILENAME "mam.sdk.json"

/** SDK configuration. Free with mam_config_free. */
typedef struct {
    char *version;
    char *work_dir;
    char *target;
    bool verbose;
    char **extra_keys;
    char **extra_values;
    size_t extra_count;
} mam_config_t;

/** Returns a configuration populated with the SDK defaults. */
mam_config_t *mam_config_default(void);

/** Releases a configuration. NULL safe. */
void mam_config_free(mam_config_t *config);

/** Returns the supported target names, sorted. Caller frees the array. */
char **mam_config_list_targets(size_t *out_count);

/** Returns true when @p target is supported, accepting common aliases. */
bool mam_config_is_supported_target(const char *target);

/** Maps an alias such as `py` to its canonical target name. Owned. */
char *mam_config_normalize_target(const char *target);

/**
 * Validates a configuration.
 *
 * @param out_problems Receives an owned array of problem strings; may be NULL.
 * @return The number of problems found. Zero means valid.
 */
size_t mam_config_validate(const mam_config_t *config, char ***out_problems);

/** Overlays @p over on top of @p base. Neither input is modified. Owned. */
mam_config_t *mam_config_merge(const mam_config_t *base, const mam_config_t *over);

/** Serialises a configuration to JSON. Caller frees the string. */
char *mam_config_to_json(const mam_config_t *config);

/** Parses JSON into a configuration. Owned, or NULL on malformed input. */
mam_config_t *mam_config_from_json(const char *json_text);

/** Loads a config from disk, or returns the defaults when the path is absent. */
mam_config_t *mam_config_load(const char *path);

/** Writes a config to disk. Returns true on success. */
bool mam_config_save(const mam_config_t *config, const char *path);

/** Returns the path a config would be read from or written to. Owned. */
char *mam_config_resolve_path(const char *work_dir);

/* ------------------------------------------------------------------------- */
/* cache                                                                      */
/* ------------------------------------------------------------------------- */

/** Default entry lifetime, in seconds. Zero means never expire. */
#define MAM_CACHE_DEFAULT_TTL 300u

/** A cached value. Borrowed from its owning cache. */
typedef struct {
    char *key;
    char *value;
    unsigned long created_at;
    unsigned long expires_at;
    unsigned long hits;
} mam_cache_entry_t;

/** Cumulative cache counters. */
typedef struct {
    size_t entries;
    unsigned long hits;
    unsigned long misses;
    unsigned long evictions;
    unsigned long sets;
    unsigned long deletes;
} mam_cache_stats_t;

/** A TTL cache. Free with mam_cache_free. */
typedef struct mam_cache mam_cache_t;

/** Creates a cache with the given default lifetime. */
mam_cache_t *mam_cache_new(unsigned long ttl_seconds);

/** Releases a cache and every entry. NULL safe. */
void mam_cache_free(mam_cache_t *cache);

/** Stores a string value. Returns false when the key is unusable. */
bool mam_cache_set(mam_cache_t *cache, const char *key, const char *value);

/** Stores a string value with an explicit lifetime. */
bool mam_cache_set_with_ttl(mam_cache_t *cache,
                            const char *key,
                            const char *value,
                            unsigned long ttl_seconds);

/** Returns a borrowed value, or NULL on a miss or expiry. */
const char *mam_cache_get(mam_cache_t *cache, const char *key);

/** Returns true when a live entry exists. */
bool mam_cache_has(const mam_cache_t *cache, const char *key);

/** Removes a key. Returns true when an entry was removed. */
bool mam_cache_delete(mam_cache_t *cache, const char *key);

/** Removes every entry, keeping cumulative counters. */
void mam_cache_clear(mam_cache_t *cache);

/** Removes expired entries and returns how many were removed. */
size_t mam_cache_prune(mam_cache_t *cache);

/** Returns the number of entries, including expired ones. */
size_t mam_cache_size(const mam_cache_t *cache);

/** Copies the counters into @p out_stats. */
void mam_cache_stats(const mam_cache_t *cache, mam_cache_stats_t *out_stats);

/** Returns the hit rate as a fraction between 0.0 and 1.0. */
double mam_cache_hit_rate(const mam_cache_t *cache);

/** Returns an owned one line rendering of the cache counters. */
char *mam_format_cache_stats(const mam_cache_t *cache);

/** Returns a stable hash of the supplied parts, as an owned hex string. */
char *mam_cache_hash_key(const char *const *parts, size_t part_count);

/* ------------------------------------------------------------------------- */
/* format                                                                     */
/* ------------------------------------------------------------------------- */

/** Renders a short module summary. Caller frees the string. */
char *mam_format_module_summary(const mam_module_t *module);

/** Renders a numbered section list. Caller frees the string. */
char *mam_format_section_list(const mam_module_t *module);

/** Renders the code blocks with language and line counts. Caller frees. */
char *mam_format_code_block_list(const mam_module_t *module);

/** Renders a grouped validation report. Caller frees the string. */
char *mam_format_validation_report(const mam_validation_result_t *result);

/** Renders the execution result of a block. Caller frees the string. */
char *mam_format_execution_result(const mam_execution_result_t *result);

/** Renders aligned front matter fields. Caller frees the string. */
char *mam_format_front_matter(const mam_module_t *module);

/** Renders the module as a table of contents. Caller frees the string. */
char *mam_format_toc(const mam_module_t *module);

/* ------------------------------------------------------------------------- */
/* graph                                                                      */
/* ------------------------------------------------------------------------- */

/** A node in the module dependency graph. Borrowed from its graph. */
typedef struct {
    const char *name;
    const char *kind;
} mam_graph_node_t;

/** A directed edge. Borrowed from its graph. */
typedef struct {
    const char *source;
    const char *target;
    const char *label;
} mam_graph_edge_t;

/** A graph of module structure. Free with mam_graph_free. */
typedef struct {
    mam_graph_node_t *nodes;
    size_t node_count;
    mam_graph_edge_t *edges;
    size_t edge_count;
} mam_graph_t;

/** Builds the structural graph of a module. Owned by the caller. */
mam_graph_t *mam_graph_build(const mam_module_t *module);

/** Releases a graph. NULL safe. */
void mam_graph_free(mam_graph_t *graph);

/**
 * Orders node names so dependencies precede dependents.
 *
 * @param out_order Receives an owned array of owned names.
 * @return The number of nodes ordered, or 0 when the graph has a cycle.
 */
size_t mam_graph_topological_sort(const mam_graph_t *graph, char ***out_order);

/** Returns the direct successors of a node. Caller frees the array. */
char **mam_graph_successors(const mam_graph_t *graph, const char *name, size_t *out_count);

/** Returns the direct predecessors of a node. Caller frees the array. */
char **mam_graph_predecessors(const mam_graph_t *graph, const char *name, size_t *out_count);

/** Returns true when an edge connects the two nodes. */
bool mam_graph_has_edge(const mam_graph_t *graph, const char *source, const char *target);

/** Returns an owned one line summary of the graph. */
char *mam_graph_summary(const mam_graph_t *graph);

/** Returns an owned indented rendering of the graph. */
char *mam_graph_to_text(const mam_graph_t *graph);

/* ------------------------------------------------------------------------- */
/* template                                                                   */
/* ------------------------------------------------------------------------- */

/** The canonical starter kinds. */
extern const char *const MAM_STARTER_KINDS[3];

/** Returns the canonical starter kinds, sorted. Caller frees the array. */
char **mam_template_list_kinds(size_t *out_count);

/** Returns the template for a kind or alias. Caller frees; NULL if unknown. */
char *mam_template_get(const char *kind);

/**
 * Substitutes `{{name}}` placeholders.
 *
 * @param variables Key/value pairs; an even count, or NULL.
 * @return An owned rendered string. Unknown placeholders are preserved.
 */
char *mam_template_render(const char *template_text,
                          const char *const *variables,
                          size_t variable_count);

/** Renders a complete starter module. Caller frees; NULL on bad input. */
char *mam_template_new_module(const char *name, const char *kind, const char *runtime);

/** Returns an owned array of problems with @p name; zero count means valid. */
char **mam_template_validate_name(const char *name, size_t *out_count);

/** Returns an owned lowercase dash separated slug of @p name. */
char *mam_template_slugify(const char *name);

/* ------------------------------------------------------------------------- */
/* doctor                                                                     */
/* ------------------------------------------------------------------------- */

/** Health status of a single check. */
typedef enum {
    MAM_CHECK_OK = 0,
    MAM_CHECK_WARN = 1,
    MAM_CHECK_FAIL = 2
} mam_check_status_t;

/** A single diagnostic check result. */
typedef struct {
    char *name;
    mam_check_status_t status;
    char *message;
} mam_check_t;

/** An aggregate health report. Free with mam_doctor_report_free. */
typedef struct {
    mam_check_t *checks;
    size_t count;
} mam_doctor_report_t;

/** Returns the short label for a status, for example `PASS`. */
const char *mam_check_status_name(mam_check_status_t status);

/**
 * Runs the environment checks.
 *
 * @param languages NULL terminated array of language names to probe, or NULL
 *        to probe every known language.
 * @return An owned report, or NULL when the report could not be allocated.
 */
mam_doctor_report_t *mam_doctor_run(const char *const *languages);

/** Releases a report. NULL safe. */
void mam_doctor_report_free(mam_doctor_report_t *report);

/** Returns true when no check failed. */
bool mam_doctor_report_is_ok(const mam_doctor_report_t *report);

/** Returns the worst status across all checks. */
mam_check_status_t mam_doctor_report_status(const mam_doctor_report_t *report);

/** Returns an owned rendering of the report. */
char *mam_doctor_report_format(const mam_doctor_report_t *report);

/** Returns true when an executable of that name is resolvable on PATH. */
bool mam_doctor_command_exists(const char *command);

#ifdef __cplusplus
}
#endif

#endif /* MAM_SUPPORT_H */
