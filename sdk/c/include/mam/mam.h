/**
 * @file mam.h
 * @brief Public API for the MAM C SDK.
 *
 * MAM (Markdown as Module) turns a Markdown document with YAML front matter
 * into a structured, executable module. This SDK parses that document into an
 * AST, validates it against the specification, and optionally executes its
 * code blocks.
 *
 * @section ownership Memory ownership
 *
 * The single rule that governs this entire API:
 *
 * - Every `mam_*_create`, `mam_module_new`, `mam_parser_new`,
 *   `mam_validation_run`, `mam_execute_*` returning an owned object transfers
 *   ownership to the caller.
 * - Every owned object is released by its matching `mam_*_free` function.
 *   Objects are NOT reference counted and are NOT thread safe unless
 *   documented otherwise.
 * - Every `const char *` returned by a getter is a BORROWED pointer owned by
 *   its parent object. It stays valid only until that parent is freed or
 *   mutated. Never free a borrowed pointer, and never store one beyond the
 *   parent's lifetime.
 * - The SDK never returns a pointer to a temporary or to freed memory. If a
 *   function returns a `char *`, the caller owns it and must `free()` it.
 *
 * A worked example::
 *
 *     mam_module_t *module = mam_parse_string(source, "<memory>", NULL);
 *     if (module == NULL) { return; }
 *     printf("%s\n", mam_module_summary(module));  // borrowed
 *     mam_validation_result_t *result = mam_validation_run(module, true);
 *     if (!mam_validation_is_valid(result)) {    // borrowed
 *         mam_validation_print(result, stderr);  // borrowed
 *     }
 *     mam_validation_free(result);
 *     mam_module_free(module);                    // frees every string inside
 *
 * @section quickstart Quick start
 *
 *     mam_module_t *module = mam_parse_file("agent.mam.md");
 *     if (module == NULL) {
 *         fprintf(stderr, "parse failed: %s\n", mam_last_error());
 *         return 1;
 *     }
 *     mam_validation_result_t *report = mam_validation_run(module, true);
 *     if (mam_validation_error_count(report) > 0) {
 *         mam_validation_print(report, stderr);
 *     }
 *     mam_validation_free(report);
 *     mam_module_free(module);
 */

#ifndef MAM_H
#define MAM_H

#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ------------------------------------------------------------------------- */
/* Version                                                                    */
/* ------------------------------------------------------------------------- */

#define MAM_VERSION "0.1.0"
#define MAM_SDK_NAME "mam-c"

/** Returns the SDK identifier, for example `mam-c/0.1.0`. */
const char *mam_user_agent(void);

/** Returns the SDK version string. */
const char *mam_version(void);

/** Returns a human readable name for the SDK. */
const char *mam_sdk_name(void);

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

/** Error codes reported through mam_error_t. */
typedef enum {
    MAM_OK = 0,
    MAM_ERR_INVALID_ARGUMENT = 1,
    MAM_ERR_IO = 2,
    MAM_ERR_NO_FRONTMATTER = 3,
    MAM_ERR_MALFORMED_FRONTMATTER = 4,
    MAM_ERR_OUT_OF_MEMORY = 5,
    MAM_ERR_PARSE = 6,
    MAM_ERR_UNSUPPORTED_LANGUAGE = 7,
    MAM_ERR_NO_CODE_BLOCK = 8,
    MAM_ERR_EXECUTION = 9,
    MAM_ERR_TIMEOUT = 10
} mam_status_t;

/** Describes a failure. Always owned by the SDK; never free it. */
typedef struct {
    mam_status_t status;
    char message[512];
    size_t line;
    size_t column;
} mam_error_t;

/** Returns the most recent error on the calling thread. Never NULL. */
const mam_error_t *mam_last_error(void);

/** Copies the last error message into `buffer`. Returns the message length. */
size_t mam_last_error_message(char *buffer, size_t buffer_size);

/** Clears the thread-local last error. */
void mam_clear_error(void);

/** Formats an error into a caller supplied buffer. Never fails. */
void mam_error_format(const mam_error_t *error, char *buffer, size_t buffer_size);

/* ------------------------------------------------------------------------- */
/* Source locations                                                           */
/* ------------------------------------------------------------------------- */

/** Points at a region of the original document. Borrowed from its parent. */
typedef struct {
    const char *file;
    size_t line;
    size_t column;
    size_t offset;
    size_t length;
} mam_source_location_t;

/* ------------------------------------------------------------------------- */
/* Content nodes                                                              */
/* ------------------------------------------------------------------------- */

/** Discriminator for mam_node_t. */
typedef enum {
    MAM_NODE_HEADING = 0,
    MAM_NODE_PARAGRAPH = 1,
    MAM_NODE_CODE_BLOCK = 2,
    MAM_NODE_LIST = 3,
    MAM_NODE_TABLE = 4,
    MAM_NODE_BLOCKQUOTE = 5,
    MAM_NODE_HORIZONTAL_RULE = 6,
    MAM_NODE_LINK = 7,
    MAM_NODE_IMAGE = 8,
    MAM_NODE_TEXT = 9
} mam_node_type_t;

/** A fenced code block. */
typedef struct {
    /** Info string of the opening fence, for example `python`. Owned. */
    char *language;
    /** Block contents, newline terminated. Owned. */
    char *code;
    /** Where the opening fence appeared. Borrowed from the parent section. */
    mam_source_location_t location;
    /** False when the closing fence was missing; the content is still kept. */
    bool terminated;
} mam_code_block_t;

/**
 * A single content node inside a section.
 *
 * The payload lives in a union, so only the member matching @c type is
 * meaningful. Use the mam_node_* accessors rather than reading the union
 * directly; they return sensible defaults for a mismatched tag instead of
 * reading uninitialised memory.
 */
typedef struct {
    mam_node_type_t type;
    union {
        struct {
            unsigned level;
            char *text;
        } heading;
        char *text;
        mam_code_block_t code_block;
        struct {
            bool ordered;
            char **items;
            size_t item_count;
        } list;
        struct {
            char **headers;
            size_t header_count;
            char **cells;
            size_t row_count;
            size_t column_count;
        } table;
        struct {
            char *text;
            char *url;
        } link;
        struct {
            char *alt;
            char *url;
        } image;
    } as;
} mam_node_t;

/** Returns the printable name of a node type, for example `code_block`. */
const char *mam_node_type_name(mam_node_type_t type);

/** Returns a borrowed name for the node, or `""` when it has none. */
const char *mam_node_name(const mam_node_t *node);

/* ------------------------------------------------------------------------- */
/* Sections                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Section kinds.
 *
 * There are 19 standard kinds plus MAM_SECTION_CUSTOM, giving 20 variants in
 * total. An unrecognised heading becomes MAM_SECTION_CUSTOM and its text is
 * preserved in mam_section_t::title.
 */
typedef enum {
    MAM_SECTION_METADATA = 0,
    MAM_SECTION_PURPOSE = 1,
    MAM_SECTION_INPUTS = 2,
    MAM_SECTION_OUTPUTS = 3,
    MAM_SECTION_RULES = 4,
    MAM_SECTION_WORKFLOW = 5,
    MAM_SECTION_MERMAID = 6,
    MAM_SECTION_PYTHON = 7,
    MAM_SECTION_PROMPT = 8,
    MAM_SECTION_MEMORY = 9,
    MAM_SECTION_EXAMPLES = 10,
    MAM_SECTION_TESTS = 11,
    MAM_SECTION_REFERENCES = 12,
    MAM_SECTION_DEPENDENCIES = 13,
    MAM_SECTION_EXPORTS = 14,
    MAM_SECTION_IMPORTS = 15,
    MAM_SECTION_PLUGINS = 16,
    MAM_SECTION_PERMISSIONS = 17,
    MAM_SECTION_CAPABILITIES = 18,
    MAM_SECTION_CUSTOM = 19
} mam_section_kind_t;

/** The number of standard section kinds, excluding MAM_SECTION_CUSTOM. */
#define MAM_STANDARD_SECTION_KIND_COUNT 19

/** A single named section. */
typedef struct {
    mam_section_kind_t kind;
    char *title;
    mam_node_t *content;
    size_t content_count;
    mam_source_location_t location;
} mam_section_t;

/** Returns the lowercase name of a section kind, borrowed and static. */
const char *mam_section_kind_name(mam_section_kind_t kind);

/** Maps a heading name to a section kind; unknown input is CUSTOM. */
mam_section_kind_t mam_section_kind_from_string(const char *name);

/** Returns true when @p kind is one of the 19 standard kinds. */
bool mam_section_kind_is_standard(mam_section_kind_t kind);

/** Returns the index of @p kind in the canonical order, or -1 if custom. */
int mam_section_kind_order(mam_section_kind_t kind);

/* ------------------------------------------------------------------------- */
/* Front matter                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Parsed YAML front matter.
 *
 * Naming follows the majority convention across the MAM SDKs: `name` and
 * `authors`, not `title` and `author`. Every `char *` and `char **` member is
 * owned by the enclosing module and freed with it.
 */
typedef struct {
    char *schema_version;
    char *name;
    char *version;
    char *description;
    char *license;
    char **authors;
    size_t author_count;
    char **tags;
    size_t tag_count;
    char **dependencies;
    size_t dependency_count;
} mam_frontmatter_t;

/* ------------------------------------------------------------------------- */
/* Module                                                                     */
/* ------------------------------------------------------------------------- */

/** A fully parsed MAM document. */
typedef struct {
    mam_frontmatter_t frontmatter;
    mam_section_t *sections;
    size_t section_count;
    char *raw_content;
    char *file_path;
} mam_module_t;

/** Allocates an empty module. Owned by the caller; free with mam_module_free. */
mam_module_t *mam_module_new(void);

/** Releases a module and every string it owns. NULL safe. */
void mam_module_free(mam_module_t *module);

/** Returns a borrowed one line summary, or `"(untitled)"` when unnamed. */
const char *mam_module_summary(const mam_module_t *module);

/** Returns a borrowed module name, falling back to the file name. */
const char *mam_module_name(const mam_module_t *module);

/** Returns a borrowed module version, or `"(none)"`. */
const char *mam_module_version(const mam_module_t *module);

/** Returns a borrowed description, or `"(none)"`. */
const char *mam_module_description(const mam_module_t *module);

/** Returns a borrowed file path, or `"(memory)"` for string input. */
const char *mam_module_file_path(const mam_module_t *module);

/** Total number of code blocks across all sections. */
size_t mam_module_code_block_count(const mam_module_t *module);

/** Total number of content nodes across all sections. */
size_t mam_module_node_count(const mam_module_t *module);

/** Returns the first section of the given kind, or NULL. Borrowed. */
const mam_section_t *mam_module_get_section(const mam_module_t *module,
                                             mam_section_kind_t kind);

/** Returns all sections of the given kind. Borrowed; free the array. */
const mam_section_t **mam_module_get_sections(const mam_module_t *module,
                                              mam_section_kind_t kind,
                                              size_t *out_count);

/** Returns true when a section of the given kind exists. */
bool mam_module_has_section(const mam_module_t *module, mam_section_kind_t kind);

/** Returns a borrowed section title by index, or NULL when out of range. */
const char *mam_module_section_title(const mam_module_t *module, size_t index);

/** Returns the code blocks of a section. Borrowed; free the array. */
const mam_code_block_t **mam_section_code_blocks(const mam_section_t *section,
                                                 size_t *out_count);

/** Returns the concatenated text of a section. Owned by the caller. */
char *mam_section_text_content(const mam_section_t *section);

/* ------------------------------------------------------------------------- */
/* Parser                                                                     */
/* ------------------------------------------------------------------------- */

/** Parser configuration. */
typedef struct {
    /** Reject unterminated front matter instead of ignoring it. */
    bool require_frontmatter_delimiter;
    /** Cap on the number of sections, to bound hostile input. 0 means 4096. */
    size_t max_sections;
    /** Cap on the document size in bytes. 0 means 8 MiB. */
    size_t max_input_bytes;
} mam_parser_config_t;

/** Returns a configuration with the documented defaults. */
mam_parser_config_t mam_parser_config_default(void);

/** A reusable parser. Owned by the caller; free with mam_parser_free. */
typedef struct mam_parser mam_parser_t;

/** Creates a parser using the default configuration. */
mam_parser_t *mam_parser_new(void);

/** Creates a parser with an explicit configuration. */
mam_parser_t *mam_parser_new_with_config(const mam_parser_config_t *config);

/** Releases a parser. NULL safe. */
void mam_parser_free(mam_parser_t *parser);

/**
 * Parses a document held in memory.
 *
 * @param content NUL terminated document text. Required.
 * @param file_path Reported in diagnostics; may be NULL.
 * @param out_error Receives the failure detail; may be NULL.
 * @return An owned module, or NULL on failure.
 */
mam_module_t *mam_parse_string(const char *content,
                               const char *file_path,
                               mam_error_t *out_error);

/**
 * Parses a document from disk.
 *
 * @return An owned module, or NULL when the file cannot be read or parsed.
 */
mam_module_t *mam_parse_file(const char *path, mam_error_t *out_error);

/** Parses with an explicit parser configuration. */
mam_module_t *mam_parse_string_with(const mam_parser_t *parser,
                                    const char *content,
                                    const char *file_path,
                                    mam_error_t *out_error);

/* ------------------------------------------------------------------------- */
/* Validation                                                                 */
/* ------------------------------------------------------------------------- */

/** Diagnostic severities, ordered from least to most severe. */
typedef enum {
    MAM_SEVERITY_INFO = 0,
    MAM_SEVERITY_WARNING = 1,
    MAM_SEVERITY_ERROR = 2
} mam_severity_t;

/** A single validation finding. */
typedef struct {
    mam_severity_t severity;
    char *message;
    char *section;
    size_t line;
    bool has_line;
} mam_diagnostic_t;

/** The outcome of validating a module. */
typedef struct {
    mam_diagnostic_t *diagnostics;
    size_t count;
    bool is_valid;
} mam_validation_result_t;

/** Returns the printable severity name, for example `error`. */
const char *mam_severity_name(mam_severity_t severity);

/** Validates a module. Owned by the caller; free with mam_validation_free. */
mam_validation_result_t *mam_validation_run(const mam_module_t *module, bool strict);

/** Releases a validation result. NULL safe. */
void mam_validation_free(mam_validation_result_t *result);

/** Returns true when no diagnostic reached MAM_SEVERITY_ERROR. */
bool mam_validation_is_valid(const mam_validation_result_t *result);

/** Counts diagnostics at exactly @p severity. */
size_t mam_validation_count_at(const mam_validation_result_t *result,
                                mam_severity_t severity);

/** Counts diagnostics at @p severity or more severe. */
size_t mam_validation_count_at_least(const mam_validation_result_t *result,
                                     mam_severity_t severity);

/** Returns the diagnostic at @p index, or NULL when out of range. Borrowed. */
const mam_diagnostic_t *mam_validation_at(const mam_validation_result_t *result,
                                          size_t index);

/** Returns true when at least one diagnostic is at least a warning. */
bool mam_validation_has_warnings(const mam_validation_result_t *result);

/** Returns an owned summary line, for example `2 errors, 1 warning`. */
char *mam_validation_summary(const mam_validation_result_t *result);

/** Writes every diagnostic to @p stream as one line each. */
void mam_validation_print(const mam_validation_result_t *result, FILE *stream);

/* ------------------------------------------------------------------------- */
/* Runtime                                                                    */
/* ------------------------------------------------------------------------- */

/** Execution settings. */
typedef struct {
    /** Wall clock budget in milliseconds. 0 means 30000. */
    unsigned long timeout_ms;
    /** Working directory for the child process, or NULL to inherit. */
    const char *working_dir;
    /** Maximum captured stdout/stderr bytes. 0 means 1 MiB. */
    size_t max_output_bytes;
    /** Skip blocks whose language is not supported. */
    bool skip_unsupported;
} mam_runtime_config_t;

/** Returns a configuration with the documented defaults. */
mam_runtime_config_t mam_runtime_config_default(void);

/** Adds an environment variable for the child process. */
bool mam_runtime_config_set_env(mam_runtime_config_t *config,
                                const char *key,
                                const char *value);

/** The outcome of running one code block. */
typedef struct {
    int exit_code;
    char *stdout_text;
    char *stderr_text;
    unsigned long duration_ms;
    char *language;
} mam_execution_result_t;

/** Returns true when the block exited with status zero. */
bool mam_execution_is_success(const mam_execution_result_t *result);

/** Releases an execution result. NULL safe. */
void mam_execution_free(mam_execution_result_t *result);

/** Returns a borrowed owned-by-parent pointer to the captured stdout. */
const char *mam_execution_stdout(const mam_execution_result_t *result);

/** Returns a borrowed pointer to the captured stderr. */
const char *mam_execution_stderr(const mam_execution_result_t *result);

/** Returns true when the language has a registered interpreter. */
bool mam_runtime_supports_language(const char *language);

/** Returns the interpreter command used for @p language, or NULL. */
const char *mam_runtime_interpreter(const char *language);

/**
 * Runs one code block.
 *
 * @return An owned result, or NULL when execution could not be attempted.
 */
mam_execution_result_t *mam_execute_code_block(const mam_code_block_t *block,
                                               const mam_runtime_config_t *config,
                                               mam_error_t *out_error);

/** Runs the first code block of the named section. */
mam_execution_result_t *mam_execute_section(const mam_module_t *module,
                                            mam_section_kind_t kind,
                                            const mam_runtime_config_t *config,
                                            mam_error_t *out_error);

#ifdef __cplusplus
}
#endif

#endif /* MAM_H */
