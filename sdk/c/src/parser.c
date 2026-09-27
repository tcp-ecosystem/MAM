/**
 * @file parser.c
 * @brief Document parser: YAML front matter plus Markdown section scanning.
 *
 * The parser is a single forward pass over the document. It is deliberately
 * forgiving: a malformed front matter block is reported as a diagnostic rather
 * than aborting, and unrecognised headings are preserved as MAM_SECTION_CUSTOM
 * instead of being discarded. That matches the behaviour of the other MAM SDKs
 * and means a document with a typo still yields a usable tree.
 *
 * Nothing here allocates a buffer that is not owned by the returned module, and
 * the module owns every string the parser produces.
 */

#include "internal.h"

/* ------------------------------------------------------------------------- */
/* Configuration                                                               */
/* ------------------------------------------------------------------------- */

mam_parser_config_t mam_parser_config_default(void)
{
    mam_parser_config_t config;
    config.require_frontmatter_delimiter = false;
    config.max_sections = MAM_DEFAULT_MAX_SECTIONS;
    config.max_input_bytes = MAM_DEFAULT_MAX_INPUT_BYTES;
    return config;
}

mam_parser_t *mam_parser_new(void)
{
    return mam_parser_new_with_config(NULL);
}

mam_parser_t *mam_parser_new_with_config(const mam_parser_config_t *config)
{
    mam_parser_t *parser = (mam_parser_t *)mam_calloc(1u, sizeof(mam_parser_t));
    if (parser == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate parser", 0u, 0u);
        return NULL;
    }
    if (config != NULL) {
        parser->config = *config;
    } else {
        parser->config = mam_parser_config_default();
    }
    if (parser->config.max_sections == 0u) {
        parser->config.max_sections = MAM_DEFAULT_MAX_SECTIONS;
    }
    if (parser->config.max_input_bytes == 0u) {
        parser->config.max_input_bytes = MAM_DEFAULT_MAX_INPUT_BYTES;
    }
    return parser;
}

void mam_parser_free(mam_parser_t *parser)
{
    free(parser);
}

/* ------------------------------------------------------------------------- */
/* Front matter                                                                */
/* ------------------------------------------------------------------------- */

/** Appends a parsed sequence onto a NULL terminated style array. */
static bool mam_frontmatter_push(char ***items, size_t *count, char *value)
{
    if (value == NULL) {
        return true;
    }
    char **grown = (char **)realloc(*items, (*count + 1u) * sizeof(char *));
    if (grown == NULL) {
        free(value);
        return false;
    }
    grown[*count] = value;
    *items = grown;
    (*count)++;
    return true;
}

/**
 * Parses the lines between the front matter delimiters.
 *
 * @param lines The document split into lines.
 * @param first Index of the first front matter line.
 * @param last Index one past the closing delimiter.
 */
static bool mam_parse_frontmatter(mam_module_t *module, char *const *lines, size_t first,
                                  size_t last)
{
    mam_frontmatter_t *fm = &module->frontmatter;
    size_t i = first;
    while (i < last) {
        char *line = lines[i];
        const char *trimmed = mam_str_trim(line);
        if (trimmed[0] == '\0' || trimmed[0] == '#') {
            i++;
            continue;
        }

        char *colon = NULL;
        for (char *cursor = (char *)trimmed; *cursor != '\0'; cursor++) {
            if (*cursor == ':') {
                colon = cursor;
                break;
            }
        }
        if (colon == NULL) {
            i++;
            continue;
        }

        *colon = '\0';
        char *key = mam_strdup(trimmed);
        char *raw_value = colon + 1;
        if (key == NULL) {
            return false;
        }

        bool is_sequence = false;
        const char *value_text = mam_str_trim(raw_value);
        if (value_text[0] == '[') {
            is_sequence = true;
        } else if (value_text[0] == '|' || value_text[0] == '>') {
            /* Block scalars are not part of the supported subset. */
            free(key);
            i++;
            continue;
        }

        if (is_sequence) {
            char **items = NULL;
            size_t item_count = mam_yaml_inline_sequence(value_text, &items);
            if (mam_strcasecmp(key, "authors") == 0) {
                for (size_t k = 0u; k < item_count; k++) {
                    if (!mam_frontmatter_push(&fm->authors, &fm->author_count, items[k])) {
                        mam_free_string_array(items, item_count);
                        free(key);
                        return false;
                    }
                }
                free(items);
            } else if (mam_strcasecmp(key, "tags") == 0) {
                for (size_t k = 0u; k < item_count; k++) {
                    if (!mam_frontmatter_push(&fm->tags, &fm->tag_count, items[k])) {
                        mam_free_string_array(items, item_count);
                        free(key);
                        return false;
                    }
                }
                free(items);
            } else if (mam_strcasecmp(key, "dependencies") == 0) {
                for (size_t k = 0u; k < item_count; k++) {
                    if (!mam_frontmatter_push(&fm->dependencies, &fm->dependency_count,
                                              items[k])) {
                        mam_free_string_array(items, item_count);
                        free(key);
                        return false;
                    }
                }
                free(items);
            } else {
                mam_free_string_array(items, item_count);
            }
            free(key);
            i++;
            continue;
        }

        char *value = mam_yaml_scalar(value_text);
        if (value == NULL) {
            free(key);
            return false;
        }
        if (mam_strcasecmp(key, "schema_version") == 0 ||
            mam_strcasecmp(key, "schema-version") == 0) {
            free(fm->schema_version);
            fm->schema_version = value;
        } else if (mam_strcasecmp(key, "name") == 0) {
            free(fm->name);
            fm->name = value;
        } else if (mam_strcasecmp(key, "title") == 0 && fm->name == NULL) {
            free(fm->name);
            fm->name = value;
        } else if (mam_strcasecmp(key, "version") == 0) {
            free(fm->version);
            fm->version = value;
        } else if (mam_strcasecmp(key, "description") == 0) {
            free(fm->description);
            fm->description = value;
        } else if (mam_strcasecmp(key, "license") == 0) {
            free(fm->license);
            fm->license = value;
        } else if (mam_strcasecmp(key, "author") == 0) {
            if (!mam_frontmatter_push(&fm->authors, &fm->author_count, value)) {
                free(key);
                return false;
            }
        } else {
            free(value);
        }
        free(key);
        i++;
    }
    return true;
}

/* ------------------------------------------------------------------------- */
/* Section content                                                             */
/* ------------------------------------------------------------------------- */

/** Appends a node to a section, growing its content array. */
static bool mam_section_push(mam_section_t *section, const mam_node_t *node)
{
    mam_node_t *grown =
        (mam_node_t *)realloc(section->content, (section->content_count + 1u) * sizeof(mam_node_t));
    if (grown == NULL) {
        return false;
    }
    grown[section->content_count] = *node;
    section->content = grown;
    section->content_count++;
    return true;
}

/** Returns true when @p line opens or closes a fenced code block. */
static bool mam_fence_marker(const char *line, char *out_marker, size_t marker_size)
{
    const char *cursor = line;
    while (*cursor == ' ') {
        cursor++;
    }
    if (*cursor != '`') {
        return false;
    }
    size_t count = 0u;
    while (cursor[count] == '`') {
        count++;
    }
    if (count < 3u || count >= marker_size) {
        return false;
    }
    for (size_t i = 0u; i < count; i++) {
        out_marker[i] = '`';
    }
    out_marker[count] = '\0';
    return true;
}

/** Extracts the info string following a fence, for example `python`. */
static char *mam_fence_info(const char *line)
{
    const char *cursor = line;
    while (*cursor == '`') {
        cursor++;
    }
    return mam_yaml_scalar(cursor);
}

/** True when the line begins with a digit followed by `.` or `)`. */
static bool mam_line_is_ordered_item(const char *trimmed)
{
    size_t digits = 0u;
    while (trimmed[digits] >= '0' && trimmed[digits] <= '9') {
        digits++;
    }
    if (digits == 0u) {
        return false;
    }
    return trimmed[digits] == '.' || trimmed[digits] == ')';
}

/** True when the line begins with a `-`, `*`, or `+` bullet. */
static bool mam_line_is_bullet(const char *trimmed)
{
    return trimmed[0] == '-' || trimmed[0] == '*' || trimmed[0] == '+';
}

/** Parses consecutive list items into a single list node. */
static bool mam_emit_list(mam_section_t *section, char *const *lines, size_t *index, size_t end)
{
    bool ordered = mam_line_is_ordered_item(mam_str_trim(lines[*index]));
    char **items = NULL;
    size_t item_count = 0u;
    bool ok = true;

    while (*index < end) {
        const char *trimmed = mam_str_trim(lines[*index]);
        if (!mam_line_is_bullet(trimmed) && !mam_line_is_ordered_item(trimmed)) {
            break;
        }

        const char *text = trimmed;
        while (*text == '-' || *text == '*' || *text == '+') {
            text++;
        }
        size_t digits = 0u;
        while (text[digits] >= '0' && text[digits] <= '9') {
            digits++;
        }
        if (digits > 0u && (text[digits] == '.' || text[digits] == ')')) {
            text += digits + 1u;
        }

        char *value = mam_yaml_scalar(text);
        if (value == NULL || !mam_frontmatter_push(&items, &item_count, value)) {
            ok = false;
            break;
        }
        (*index)++;
    }

    if (ok && item_count > 0u) {
        mam_node_t node;
        memset(&node, 0, sizeof(node));
        node.type = MAM_NODE_LIST;
        node.as.list.ordered = ordered;
        node.as.list.items = items;
        node.as.list.item_count = item_count;
        ok = mam_section_push(section, &node);
    }
    if (!ok || item_count == 0u) {
        mam_free_string_array(items, item_count);
    }
    return ok;
}

/**
 * Consumes lines into the current section until the next heading or end of
 * document. @p cursor tracks position across calls.
 */
static bool mam_parse_section_body(mam_section_t *section, char *const *lines, size_t *cursor,
                                   size_t end, const char *file_path, size_t base_line)
{
    char marker[8];
    while (*cursor < end) {
        char *line = lines[*cursor];

        if (mam_fence_marker(line, marker, sizeof(marker))) {
            size_t fence_length = strlen(marker);
            char *language = mam_fence_info(line);
            if (language == NULL) {
                return false;
            }
            char *code = NULL;
            size_t code_length = 0u;
            size_t code_capacity = 0u;
            size_t start_line = base_line + *cursor;
            (*cursor)++;

            bool closed = false;
            while (*cursor < end) {
                char *candidate = lines[*cursor];
                const char *trimmed = mam_str_trim(candidate);
                bool is_closer = false;
                for (size_t i = 0u; i < fence_length; i++) {
                    if (trimmed[i] != marker[i]) {
                        is_closer = false;
                        break;
                    }
                    is_closer = true;
                }
                if (is_closer && trimmed[fence_length] == '\0') {
                    closed = true;
                    (*cursor)++;
                    break;
                }
                if (!mam_buffer_append(&code, &code_length, &code_capacity, candidate)) {
                    free(code);
                    free(language);
                    return false;
                }
                if (!mam_buffer_append(&code, &code_length, &code_capacity, "\n")) {
                    free(code);
                    free(language);
                    return false;
                }
                (*cursor)++;
            }

            if (code == NULL) {
                code = mam_strdup("");
            }
            if (code == NULL) {
                free(language);
                return false;
            }

            mam_node_t node;
            memset(&node, 0, sizeof(node));
            node.type = MAM_NODE_CODE_BLOCK;
            node.as.code_block.language = language;
            node.as.code_block.code = code;
            node.as.code_block.location.file = file_path;
            node.as.code_block.location.line = start_line;
            node.as.code_block.location.column = 0u;
            node.as.code_block.location.offset = 0u;
            node.as.code_block.location.length = code_length;
            node.as.code_block.terminated = closed;
            if (!mam_section_push(section, &node)) {
                free(language);
                free(code);
                return false;
            }
            continue;
        }

        const char *trimmed = mam_str_trim(line);
        if (trimmed[0] == '\0') {
            (*cursor)++;
            continue;
        }

        if (trimmed[0] == '#') {
            unsigned level = 0u;
            size_t i = 0u;
            while (trimmed[i] == '#' && level < 6u) {
                level++;
                i++;
            }
            if (level >= 1u && level <= 6u && trimmed[i] == ' ' && trimmed[i + 1u] != '\0') {
                mam_node_t node;
                memset(&node, 0, sizeof(node));
                node.type = MAM_NODE_HEADING;
                node.as.heading.level = level;
                node.as.heading.text = mam_strdup(mam_str_trim(trimmed + i));
                if (node.as.heading.text == NULL ||
                    !mam_section_push(section, &node)) {
                    free(node.as.heading.text);
                    return false;
                }
                (*cursor)++;
                continue;
            }
        }

        if (trimmed[0] == '>' ) {
            mam_node_t node;
            memset(&node, 0, sizeof(node));
            node.type = MAM_NODE_BLOCKQUOTE;
            node.as.text = mam_strdup(mam_str_trim(trimmed + 1));
            if (node.as.text == NULL || !mam_section_push(section, &node)) {
                free(node.as.text);
                return false;
            }
            (*cursor)++;
            continue;
        }

        if (mam_line_is_bullet(trimmed) &&
            (trimmed[1] == ' ' || (trimmed[1] >= '0' && mam_line_is_ordered_item(trimmed)))) {
            if (!mam_emit_list(section, lines, cursor, end)) {
                return false;
            }
            continue;
        }

        {
            bool horizontal = true;
            for (size_t i = 0u; trimmed[i] != '\0'; i++) {
                if (trimmed[i] != '-' && trimmed[i] != '*' && trimmed[i] != '_') {
                    horizontal = false;
                    break;
                }
            }
            if (horizontal && strlen(trimmed) >= 3u) {
                mam_node_t node;
                memset(&node, 0, sizeof(node));
                node.type = MAM_NODE_HORIZONTAL_RULE;
                if (!mam_section_push(section, &node)) {
                    return false;
                }
                (*cursor)++;
                continue;
            }
        }

        {
            mam_node_t node;
            memset(&node, 0, sizeof(node));
            node.type = MAM_NODE_PARAGRAPH;
            node.as.text = mam_strdup(line);
            if (node.as.text == NULL || !mam_section_push(section, &node)) {
                free(node.as.text);
                return false;
            }
            (*cursor)++;
        }
    }
    return true;
}

/* ------------------------------------------------------------------------- */
/* Document entry point                                                        */
/* ------------------------------------------------------------------------- */

/** True when @p line is exactly the front matter delimiter. */
static bool mam_is_delimiter(const char *line)
{
    const char *trimmed = mam_str_trim(line);
    return strcmp(trimmed, "---") == 0;
}

/** Appends a section to the module, growing its section array. */
static bool mam_module_push_section(mam_module_t *module, const mam_section_t *section)
{
    mam_section_t *grown =
        (mam_section_t *)realloc(module->sections, (module->section_count + 1u) * sizeof(mam_section_t));
    if (grown == NULL) {
        return false;
    }
    grown[module->section_count] = *section;
    module->sections = grown;
    module->section_count++;
    return true;
}

mam_module_t *mam_parse_string_with(const mam_parser_t *parser, const char *content,
                                    const char *file_path, mam_error_t *out_error)
{
    mam_error_set(MAM_OK, NULL, 0u, 0u);
    if (content == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "content must not be NULL", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    mam_parser_config_t config = mam_parser_config_default();
    if (parser != NULL) {
        config = parser->config;
    }

    size_t length = strlen(content);
    if (length > config.max_input_bytes) {
        mam_error_setf(MAM_ERR_INVALID_ARGUMENT, 0u, 0u,
                       "document is %zu bytes, which exceeds the %zu byte limit", length,
                       config.max_input_bytes);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    mam_module_t *module = mam_module_new();
    if (module == NULL) {
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    module->raw_content = mam_strdup(content);
    module->file_path = mam_strdup(file_path != NULL ? file_path : "<memory>");
    if (module->raw_content == NULL || module->file_path == NULL) {
        mam_module_free(module);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not copy document", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    /* Split into lines, normalising CRLF and CR endings. */
    size_t capacity = 64u;
    size_t count = 0u;
    char **lines = (char **)mam_calloc(capacity, sizeof(char *));
    if (lines == NULL) {
        mam_module_free(module);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate line table", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    {
        char *copy = mam_strdup(content);
        if (copy == NULL) {
            mam_free_string_array(lines, count);
            mam_module_free(module);
            mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not copy document", 0u, 0u);
            if (out_error != NULL) {
                *out_error = *mam_last_error();
            }
            return NULL;
        }
        char *cursor = copy;
        while (true) {
            char *newline = strchr(cursor, '\n');
            if (newline != NULL) {
                *newline = '\0';
            }
            size_t line_length = strlen(cursor);
            if (line_length > 0u && cursor[line_length - 1u] == '\r') {
                cursor[line_length - 1u] = '\0';
            }
            if (count == capacity) {
                size_t wanted = capacity * 2u;
                char **grown = (char **)realloc(lines, wanted * sizeof(char *));
                if (grown == NULL) {
                    free(cursor);
                    mam_free_string_array(lines, count);
                    mam_module_free(module);
                    mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not grow line table", 0u, 0u);
                    if (out_error != NULL) {
                        *out_error = *mam_last_error();
                    }
                    return NULL;
                }
                lines = grown;
                capacity = wanted;
            }
            lines[count] = cursor;
            count++;
            if (newline == NULL) {
                break;
            }
            cursor = newline + 1;
        }
    }

    size_t cursor_index = 0u;
    bool ok = true;

    /* Front matter, when the document opens with a delimiter. */
    if (count > 0u && mam_is_delimiter(lines[0])) {
        size_t close = count;
        for (size_t i = 1u; i < count; i++) {
            if (mam_is_delimiter(lines[i])) {
                close = i;
                break;
            }
        }
        if (close == count) {
            if (config.require_frontmatter_delimiter) {
                mam_error_setf(MAM_ERR_NO_FRONTMATTER, 1u, 1u,
                               "front matter opened at line 1 is never closed");
                ok = false;
            } else {
                close = 0u;
            }
        } else if (!mam_parse_frontmatter(module, lines, 1u, close)) {
            ok = false;
        }
        cursor_index = (close == 0u) ? 0u : close + 1u;
    }

    /* Sections. */
    if (ok) {
        while (cursor_index < count) {
            char *line = lines[cursor_index];
            const char *trimmed = mam_str_trim(line);
            bool is_heading = false;
            if (trimmed[0] == '#' && trimmed[1] == '#' && trimmed[2] == ' ') {
                is_heading = true;
            }
            if (!is_heading) {
                /* Content before any heading is not part of the module. */
                cursor_index++;
                continue;
            }
            if (module->section_count >= config.max_sections) {
                mam_error_setf(MAM_ERR_INVALID_ARGUMENT, cursor_index + 1u, 1u,
                               "document has more than the %zu section limit",
                               config.max_sections);
                ok = false;
                break;
            }

            char *title = mam_strdup(mam_str_trim(trimmed + 3));
            if (title == NULL) {
                ok = false;
                break;
            }
            mam_section_t section;
            memset(&section, 0, sizeof(section));
            section.kind = mam_section_kind_from_string(title);
            section.title = title;
            section.location.file = module->file_path;
            section.location.line = cursor_index + 1u;
            section.location.column = 0u;
            section.location.offset = 0u;
            section.location.length = strlen(line);

            cursor_index++;
            if (!mam_parse_section_body(&section, lines, &cursor_index, count, module->file_path,
                                        0u)) {
                free(section.title);
                free(section.content);
                ok = false;
                break;
            }
            if (!mam_module_push_section(module, &section)) {
                free(section.title);
                free(section.content);
                ok = false;
                break;
            }
        }
    }

    mam_free_string_array(lines, count);

    if (!ok) {
        mam_module_free(module);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    if (out_error != NULL) {
        memset(out_error, 0, sizeof(*out_error));
        out_error->status = MAM_OK;
    }
    return module;
}

mam_module_t *mam_parse_string(const char *content, const char *file_path,
                               mam_error_t *out_error)
{
    return mam_parse_string_with(NULL, content, file_path, out_error);
}

mam_module_t *mam_parse_file(const char *path, mam_error_t *out_error)
{
    mam_error_set(MAM_OK, NULL, 0u, 0u);
    if (path == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "path must not be NULL", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    FILE *handle = fopen(path, "rb");
    if (handle == NULL) {
        mam_error_setf(MAM_ERR_IO, 0u, 0u, "could not open '%s' for reading", path);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    if (fseek(handle, 0L, SEEK_END) != 0) {
        fclose(handle);
        mam_error_setf(MAM_ERR_IO, 0u, 0u, "could not seek in '%s'", path);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    long size = ftell(handle);
    if (size < 0L) {
        fclose(handle);
        mam_error_setf(MAM_ERR_IO, 0u, 0u, "could not measure '%s'", path);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    rewind(handle);

    char *buffer = (char *)mam_calloc((size_t)size + 1u, 1u);
    if (buffer == NULL) {
        fclose(handle);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate file buffer", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    size_t read = fread(buffer, 1u, (size_t)size, handle);
    fclose(handle);
    buffer[read] = '\0';

    mam_module_t *module = mam_parse_string_with(NULL, buffer, path, out_error);
    free(buffer);
    return module;
}
