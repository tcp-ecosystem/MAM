/**
 * @file validator.c
 * @brief Specification checks over a parsed module.
 *
 * Validation is non-destructive: the module is never mutated, and every finding
 * is appended to a caller-owned result. Rules are grouped by concern so a
 * maintainer can disable or extend one area without touching the others.
 */

#include "internal.h"

const char *mam_severity_name(mam_severity_t severity)
{
    switch (severity) {
    case MAM_SEVERITY_INFO:
        return "info";
    case MAM_SEVERITY_WARNING:
        return "warning";
    case MAM_SEVERITY_ERROR:
        return "error";
    default:
        return "unknown";
    }
}

void mam_validation_free(mam_validation_result_t *result)
{
    if (result == NULL) {
        return;
    }
    for (size_t i = 0u; i < result->count; i++) {
        free(result->diagnostics[i].message);
        free(result->diagnostics[i].section);
    }
    free(result->diagnostics);
    free(result);
}

/**
 * Appends a diagnostic.
 *
 * When @p section_or_null is NULL the finding is not attributed to a section.
 * The strings are copied, so callers may pass temporaries.
 */
static bool mam_diagnostic_push(mam_validation_result_t *result, mam_severity_t severity,
                                const char *message, const char *section_or_null, size_t line,
                                bool has_line)
{
    mam_diagnostic_t *grown = (mam_diagnostic_t *)realloc(
        result->diagnostics, (result->count + 1u) * sizeof(mam_diagnostic_t));
    if (grown == NULL) {
        return false;
    }
    result->diagnostics = grown;

    mam_diagnostic_t *slot = &result->diagnostics[result->count];
    memset(slot, 0, sizeof(*slot));
    slot->severity = severity;
    slot->message = mam_strdup(message != NULL ? message : "");
    slot->section = section_or_null != NULL ? mam_strdup(section_or_null) : NULL;
    slot->line = line;
    slot->has_line = has_line;
    result->count++;

    if (severity == MAM_SEVERITY_ERROR) {
        result->is_valid = false;
    }
    return slot->message != NULL;
}

bool mam_validation_is_valid(const mam_validation_result_t *result)
{
    if (result == NULL) {
        return false;
    }
    return result->is_valid;
}

size_t mam_validation_count_at(const mam_validation_result_t *result, mam_severity_t severity)
{
    if (result == NULL) {
        return 0u;
    }
    size_t total = 0u;
    for (size_t i = 0u; i < result->count; i++) {
        if (result->diagnostics[i].severity == severity) {
            total++;
        }
    }
    return total;
}

size_t mam_validation_count_at_least(const mam_validation_result_t *result,
                                     mam_severity_t severity)
{
    if (result == NULL) {
        return 0u;
    }
    size_t total = 0u;
    for (size_t i = 0u; i < result->count; i++) {
        if (result->diagnostics[i].severity >= severity) {
            total++;
        }
    }
    return total;
}

const mam_diagnostic_t *mam_validation_at(const mam_validation_result_t *result, size_t index)
{
    if (result == NULL || index >= result->count) {
        return NULL;
    }
    return &result->diagnostics[index];
}

bool mam_validation_has_warnings(const mam_validation_result_t *result)
{
    if (result == NULL) {
        return false;
    }
    for (size_t i = 0u; i < result->count; i++) {
        if (result->diagnostics[i].severity >= MAM_SEVERITY_WARNING) {
            return true;
        }
    }
    return false;
}

char *mam_validation_summary(const mam_validation_result_t *result)
{
    if (result == NULL) {
        return mam_strdup("no result");
    }
    size_t errors = mam_validation_count_at(result, MAM_SEVERITY_ERROR);
    size_t warnings = mam_validation_count_at(result, MAM_SEVERITY_WARNING);
    size_t infos = mam_validation_count_at(result, MAM_SEVERITY_INFO);

    if (errors == 0u && warnings == 0u && infos == 0u) {
        return mam_strdup("no issues");
    }
    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    bool first = true;

    struct {
        size_t count;
        const char *label;
    } groups[3] = {{errors, "error"}, {warnings, "warning"}, {infos, "info"}};

    for (size_t g = 0u; g < 3u; g++) {
        if (groups[g].count == 0u) {
            continue;
        }
        if (!first && !mam_buffer_append(&text, &length, &capacity, ", ")) {
            free(text);
            return NULL;
        }
        first = false;
        char part[64];
        int written = snprintf(part, sizeof(part), "%zu %s%s", groups[g].count, groups[g].label,
                               groups[g].count == 1u ? "" : "s");
        if (written > 0 && !mam_buffer_append(&text, &length, &capacity, part)) {
            free(text);
            return NULL;
        }
    }
    return text != NULL ? text : mam_strdup("no issues");
}

void mam_validation_print(const mam_validation_result_t *result, FILE *stream)
{
    if (result == NULL || stream == NULL) {
        return;
    }
    for (size_t i = 0u; i < result->count; i++) {
        const mam_diagnostic_t *diagnostic = &result->diagnostics[i];
        fprintf(stream, "[%s]", mam_severity_name(diagnostic->severity));
        if (diagnostic->has_line) {
            fprintf(stream, " (line %zu)", diagnostic->line);
        }
        if (diagnostic->section != NULL) {
            fprintf(stream, " %s:", diagnostic->section);
        }
        fprintf(stream, " %s\n", diagnostic->message != NULL ? diagnostic->message : "");
    }
}

/* ------------------------------------------------------------------------- */
/* Rules                                                                       */
/* ------------------------------------------------------------------------- */

/** True when @p text is a dotted numeric version such as 1.2 or 1.2.3-beta. */
static bool mam_version_looks_valid(const char *text)
{
    if (text == NULL || text[0] == '\0') {
        return false;
    }
    size_t dots = 0u;
    size_t digits = 0u;
    for (size_t i = 0u; text[i] != '\0'; i++) {
        if (text[i] == '.') {
            dots++;
            digits = 0u;
            continue;
        }
        if (text[i] >= '0' && text[i] <= '9') {
            digits++;
            continue;
        }
        if (text[i] == '-' || text[i] == '+' || (text[i] >= 'a' && text[i] <= 'z') ||
            (text[i] >= 'A' && text[i] <= 'Z')) {
            continue;
        }
        return false;
    }
    return dots >= 1u;
}

/** Validates the front matter, honouring the strict flag. */
static void mam_check_frontmatter(const mam_module_t *module, bool strict,
                                  mam_validation_result_t *result)
{
    const mam_frontmatter_t *fm = &module->frontmatter;

    if (fm->name == NULL || fm->name[0] == '\0') {
        mam_diagnostic_push(result, MAM_SEVERITY_ERROR, "front matter is missing 'name'", NULL, 1u,
                            true);
    } else {
        for (size_t i = 0u; fm->name[i] != '\0'; i++) {
            char c = fm->name[i];
            bool allowed = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
            if (!allowed) {
                char message[192];
                snprintf(message, sizeof(message),
                         "name '%s' should use only lowercase letters, digits, '-' and '_'",
                         fm->name);
                mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, NULL, 1u, true);
                break;
            }
        }
    }

    if (strict && (fm->version == NULL || fm->version[0] == '\0')) {
        mam_diagnostic_push(result, MAM_SEVERITY_ERROR, "front matter is missing 'version'", NULL,
                            1u, true);
    } else if (fm->version != NULL && fm->version[0] != '\0' &&
               !mam_version_looks_valid(fm->version)) {
        char message[192];
        snprintf(message, sizeof(message), "version '%s' does not look like a semantic version",
                 fm->version);
        mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, NULL, 1u, true);
    }

    if (fm->description == NULL || fm->description[0] == '\0') {
        mam_diagnostic_push(result, MAM_SEVERITY_INFO, "front matter has no 'description'", NULL, 1u,
                            true);
    }
}

/** Validates that the required sections are present. */
static void mam_check_required_sections(const mam_module_t *module,
                                        mam_validation_result_t *result)
{
    if (!mam_module_has_section(module, MAM_SECTION_PURPOSE)) {
        mam_diagnostic_push(result, MAM_SEVERITY_ERROR, "missing required section: purpose", NULL,
                            0u, false);
    }
    for (size_t i = 0u; i < MAM_STANDARD_SECTION_KIND_COUNT; i++) {
        mam_section_kind_t kind = (mam_section_kind_t)i;
        const char *name = mam_section_kind_name(kind);
        if (mam_strcasecmp(name, "purpose") == 0) {
            continue;
        }
        if (!mam_module_has_section(module, kind)) {
            char message[160];
            snprintf(message, sizeof(message), "recommended section missing: %s", name);
            mam_diagnostic_push(result, MAM_SEVERITY_INFO, message, NULL, 0u, false);
        }
    }
}

/** Validates section ordering against the canonical order. */
static void mam_check_section_order(const mam_module_t *module, mam_validation_result_t *result)
{
    int last = -1;
    const char *last_name = NULL;
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        int order = mam_section_kind_order(section->kind);
        if (order < 0) {
            continue;
        }
        if (order < last) {
            char message[224];
            snprintf(message, sizeof(message), "section '%s' should come before '%s'",
                     section->title, last_name);
            mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, section->title,
                                section->location.line, true);
        } else {
            last = order;
            last_name = section->title;
        }
    }
}

/** Validates that no standard section is repeated. */
static void mam_check_duplicates(const mam_module_t *module, mam_validation_result_t *result)
{
    for (size_t i = 0u; i < module->section_count; i++) {
        size_t matches = 0u;
        for (size_t j = 0u; j < module->section_count; j++) {
            if (module->sections[i].kind == module->sections[j].kind &&
                mam_strcasecmp(module->sections[i].title, module->sections[j].title) == 0) {
                matches++;
            }
        }
        if (matches > 1u) {
            char message[224];
            snprintf(message, sizeof(message), "duplicate section '%s' found %zu times",
                     module->sections[i].title, matches);
            mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, module->sections[i].title,
                                module->sections[i].location.line, true);
            /* Skip ahead so a triple does not report three times over. */
            size_t forward = i + 1u;
            while (forward < module->section_count &&
                   module->sections[forward].kind == module->sections[i].kind &&
                   mam_strcasecmp(module->sections[forward].title, module->sections[i].title) == 0) {
                forward++;
            }
            i = forward - 1u;
        }
    }
}

/** Validates code blocks: empty bodies, missing language, unsupported language. */
static void mam_check_code_blocks(const mam_module_t *module, mam_validation_result_t *result)
{
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        for (size_t j = 0u; j < section->content_count; j++) {
            const mam_node_t *node = &section->content[j];
            if (node->type != MAM_NODE_CODE_BLOCK) {
                continue;
            }
            const mam_code_block_t *block = &node->as.code_block;
            if (block->code == NULL || mam_str_trim(block->code)[0] == '\0') {
                char message[192];
                snprintf(message, sizeof(message), "empty code block in section '%s'",
                         section->title);
                mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, section->title,
                                    block->location.line, true);
            }
            if (block->language == NULL || block->language[0] == '\0') {
                char message[192];
                snprintf(message, sizeof(message),
                         "code block in section '%s' is missing a language", section->title);
                mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, section->title,
                                    block->location.line, true);
            } else if (!mam_runtime_supports_language(block->language)) {
                char message[192];
                snprintf(message, sizeof(message), "unsupported code block language '%s'",
                         block->language);
                mam_diagnostic_push(result, MAM_SEVERITY_INFO, message, section->title,
                                    block->location.line, true);
            }
            if (!block->terminated) {
                char message[192];
                snprintf(message, sizeof(message), "unterminated code fence in section '%s'",
                         section->title);
                mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, section->title,
                                    block->location.line, true);
            }
        }
    }
}

/** Validates that sections are not empty and that the module is non-trivial. */
static void mam_check_content(const mam_module_t *module, mam_validation_result_t *result)
{
    if (module->section_count == 0u) {
        mam_diagnostic_push(result, MAM_SEVERITY_ERROR, "module contains no sections", NULL, 0u,
                            false);
        return;
    }
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        if (section->content_count == 0u) {
            char message[192];
            snprintf(message, sizeof(message), "section '%s' is empty", section->title);
            mam_diagnostic_push(result, MAM_SEVERITY_WARNING, message, section->title,
                                section->location.line, true);
        }
    }
    for (size_t i = 0u; i < module->frontmatter.dependency_count; i++) {
        const char *dependency = module->frontmatter.dependencies[i];
        if (dependency == NULL || dependency[0] == '\0') {
            mam_diagnostic_push(result, MAM_SEVERITY_WARNING,
                                "front matter declares an empty dependency", NULL, 1u, true);
        }
    }
}

mam_validation_result_t *mam_validation_run(const mam_module_t *module, bool strict)
{
    mam_error_set(MAM_OK, NULL, 0u, 0u);
    if (module == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "module must not be NULL", 0u, 0u);
        return NULL;
    }

    mam_validation_result_t *result =
        (mam_validation_result_t *)mam_calloc(1u, sizeof(mam_validation_result_t));
    if (result == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate validation result", 0u, 0u);
        return NULL;
    }
    result->is_valid = true;

    mam_check_frontmatter(module, strict, result);
    mam_check_required_sections(module, result);
    mam_check_content(module, result);
    mam_check_section_order(module, result);
    mam_check_duplicates(module, result);
    mam_check_code_blocks(module, result);

    return result;
}
