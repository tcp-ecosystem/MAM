/**
 * @file format.c
 * @brief Human-readable renderings of modules, diagnostics, and execution.
 *
 * Every function returns a newly allocated string the caller must `free()`, or
 * NULL when allocation failed. Renderings are cached on the stack, never
 * returned as pointers into module storage, so a caller may hold a rendering
 * across a `mam_module_free`.
 */

#include "internal.h"

char *mam_format_module_summary(const mam_module_t *module)
{
    if (module == NULL) {
        return mam_strdup("(null module)");
    }
    return mam_format_alloc("Module: %s\n  version: %s\n  description: %s\n  sections: %zu\n"
                            "  code blocks: %zu",
                            mam_module_name(module), mam_module_version(module),
                            mam_module_description(module), module->section_count,
                            mam_module_code_block_count(module));
}

char *mam_format_section_list(const mam_module_t *module)
{
    if (module == NULL || module->section_count == 0u) {
        return mam_strdup("(no sections)");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    if (!mam_buffer_append(&text, &length, &capacity, "Sections:\n")) {
        return NULL;
    }
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        char line[256];
        int written = snprintf(line, sizeof(line), "  %zu. %-14s %zu nodes\n", i + 1u,
                               mam_section_kind_name(section->kind), section->content_count);
        if (written <= 0) {
            free(text);
            return NULL;
        }
        if (!mam_buffer_append(&text, &length, &capacity, line)) {
            free(text);
            return NULL;
        }
    }
    return text;
}

char *mam_format_toc(const mam_module_t *module)
{
    if (module == NULL || module->section_count == 0u) {
        return mam_strdup("(no sections)");
    }
    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    if (!mam_buffer_append(&text, &length, &capacity, "Contents:\n")) {
        return NULL;
    }
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        char line[256];
        int written = snprintf(line, sizeof(line), "  %s\n", section->title);
        if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, line)) {
            free(text);
            return NULL;
        }
    }
    return text;
}

char *mam_format_code_block_list(const mam_module_t *module)
{
    if (module == NULL) {
        return mam_strdup("(null module)");
    }
    size_t total = mam_module_code_block_count(module);
    if (total == 0u) {
        return mam_strdup("(no code blocks)");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    char header[64];
    int written = snprintf(header, sizeof(header), "Code blocks: %zu\n", total);
    if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, header)) {
        return NULL;
    }

    size_t index = 0u;
    for (size_t i = 0u; i < module->section_count; i++) {
        const mam_section_t *section = &module->sections[i];
        for (size_t j = 0u; j < section->content_count; j++) {
            const mam_node_t *node = &section->content[j];
            if (node->type != MAM_NODE_CODE_BLOCK) {
                continue;
            }
            const mam_code_block_t *block = &node->as.code_block;
            size_t lines = 0u;
            for (const char *cursor = block->code; cursor != NULL && *cursor != '\0'; cursor++) {
                if (*cursor == '\n') {
                    lines++;
                }
            }
            index++;
            char line[256];
            written = snprintf(line, sizeof(line), "  %zu. %-12s %zu lines  in %s\n", index,
                               block->language != NULL && block->language[0] != '\0'
                                   ? block->language
                                   : "(none)",
                               lines, section->title);
            if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, line)) {
                free(text);
                return NULL;
            }
        }
    }
    return text;
}

char *mam_format_front_matter(const mam_module_t *module)
{
    if (module == NULL) {
        return mam_strdup("(null module)");
    }
    const mam_frontmatter_t *fm = &module->frontmatter;

    bool any = false;
    if (fm->name != NULL || fm->version != NULL || fm->description != NULL ||
        fm->license != NULL || fm->schema_version != NULL || fm->author_count > 0u ||
        fm->tag_count > 0u || fm->dependency_count > 0u) {
        any = true;
    }
    if (!any) {
        return mam_strdup("(no front matter)");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    if (fm->schema_version != NULL &&
        (!mam_buffer_append(&text, &length, &capacity, "schema_version: ") ||
         !mam_buffer_append(&text, &length, &capacity, fm->schema_version) ||
         !mam_buffer_append(&text, &length, &capacity, "\n"))) {
        free(text);
        return NULL;
    }
    if (fm->name != NULL &&
        (!mam_buffer_append(&text, &length, &capacity, "name: ") ||
         !mam_buffer_append(&text, &length, &capacity, fm->name) ||
         !mam_buffer_append(&text, &length, &capacity, "\n"))) {
        free(text);
        return NULL;
    }
    if (fm->version != NULL &&
        (!mam_buffer_append(&text, &length, &capacity, "version: ") ||
         !mam_buffer_append(&text, &length, &capacity, fm->version) ||
         !mam_buffer_append(&text, &length, &capacity, "\n"))) {
        free(text);
        return NULL;
    }
    if (fm->description != NULL &&
        (!mam_buffer_append(&text, &length, &capacity, "description: ") ||
         !mam_buffer_append(&text, &length, &capacity, fm->description) ||
         !mam_buffer_append(&text, &length, &capacity, "\n"))) {
        free(text);
        return NULL;
    }
    if (fm->license != NULL &&
        (!mam_buffer_append(&text, &length, &capacity, "license: ") ||
         !mam_buffer_append(&text, &length, &capacity, fm->license) ||
         !mam_buffer_append(&text, &length, &capacity, "\n"))) {
        free(text);
        return NULL;
    }

    if (fm->author_count > 0u) {
        if (!mam_buffer_append(&text, &length, &capacity, "authors: ")) {
            free(text);
            return NULL;
        }
        for (size_t i = 0u; i < fm->author_count; i++) {
            if (i > 0u && !mam_buffer_append(&text, &length, &capacity, ", ")) {
                free(text);
                return NULL;
            }
            if (!mam_buffer_append(&text, &length, &capacity, fm->authors[i])) {
                free(text);
                return NULL;
            }
        }
        if (!mam_buffer_append(&text, &length, &capacity, "\n")) {
            free(text);
            return NULL;
        }
    }

    if (fm->tag_count > 0u) {
        if (!mam_buffer_append(&text, &length, &capacity, "tags: ")) {
            free(text);
            return NULL;
        }
        for (size_t i = 0u; i < fm->tag_count; i++) {
            if (i > 0u && !mam_buffer_append(&text, &length, &capacity, ", ")) {
                free(text);
                return NULL;
            }
            if (!mam_buffer_append(&text, &length, &capacity, fm->tags[i])) {
                free(text);
                return NULL;
            }
        }
        if (!mam_buffer_append(&text, &length, &capacity, "\n")) {
            free(text);
            return NULL;
        }
    }

    if (fm->dependency_count > 0u) {
        if (!mam_buffer_append(&text, &length, &capacity, "dependencies: ")) {
            free(text);
            return NULL;
        }
        for (size_t i = 0u; i < fm->dependency_count; i++) {
            if (i > 0u && !mam_buffer_append(&text, &length, &capacity, ", ")) {
                free(text);
                return NULL;
            }
            if (!mam_buffer_append(&text, &length, &capacity, fm->dependencies[i])) {
                free(text);
                return NULL;
            }
        }
        if (!mam_buffer_append(&text, &length, &capacity, "\n")) {
            free(text);
            return NULL;
        }
    }

    return text != NULL ? text : mam_strdup("(no front matter)");
}

char *mam_format_validation_report(const mam_validation_result_t *result)
{
    if (result == NULL) {
        return mam_strdup("(no result)");
    }
    if (result->count == 0u) {
        return mam_strdup("No issues found.");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;

    static const mam_severity_t ORDER[3] = {MAM_SEVERITY_ERROR, MAM_SEVERITY_WARNING,
                                             MAM_SEVERITY_INFO};
    for (size_t g = 0u; g < 3u; g++) {
        size_t count = mam_validation_count_at(result, ORDER[g]);
        if (count == 0u) {
            continue;
        }
        char header[64];
        int written = snprintf(header, sizeof(header), "%s (%zu)\n",
                               mam_severity_name(ORDER[g]), count);
        if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, header)) {
            free(text);
            return NULL;
        }
        for (size_t i = 0u; i < result->count; i++) {
            const mam_diagnostic_t *diagnostic = &result->diagnostics[i];
            if (diagnostic->severity != ORDER[g]) {
                continue;
            }
            char line[512];
            size_t cursor = 0u;
            int part = snprintf(line, sizeof(line), "  ");
            cursor += (size_t)(part > 0 ? part : 0);
            if (diagnostic->has_line) {
                part = snprintf(line + cursor, sizeof(line) - cursor, "line %zu: ", diagnostic->line);
                cursor += (size_t)(part > 0 ? part : 0);
            }
            if (diagnostic->section != NULL) {
                part = snprintf(line + cursor, sizeof(line) - cursor, "[%s] ", diagnostic->section);
                cursor += (size_t)(part > 0 ? part : 0);
            }
            snprintf(line + cursor, sizeof(line) - cursor, "%s\n",
                     diagnostic->message != NULL ? diagnostic->message : "");
            if (!mam_buffer_append(&text, &length, &capacity, line)) {
                free(text);
                return NULL;
            }
        }
    }
    return text != NULL ? text : mam_strdup("No issues found.");
}

char *mam_format_execution_result(const mam_execution_result_t *result)
{
    if (result == NULL) {
        return mam_strdup("(no result)");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    char header[192];
    int written = snprintf(header, sizeof(header), "Execution %s in %lu ms\n",
                           mam_execution_is_success(result) ? "succeeded" : "failed",
                           result->duration_ms);
    if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, header)) {
        return NULL;
    }

    const char *out = mam_execution_stdout(result);
    if (out != NULL && out[0] != '\0') {
        if (!mam_buffer_append(&text, &length, &capacity, "  stdout: ") ||
            !mam_buffer_append(&text, &length, &capacity, out)) {
            free(text);
            return NULL;
        }
    }
    const char *err = mam_execution_stderr(result);
    if (err != NULL && err[0] != '\0') {
        if (!mam_buffer_append(&text, &length, &capacity, "  stderr: ") ||
            !mam_buffer_append(&text, &length, &capacity, err)) {
            free(text);
            return NULL;
        }
    }
    return text;
}
