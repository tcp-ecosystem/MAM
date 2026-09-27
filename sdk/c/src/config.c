/**
 * @file config.c
 * @brief SDK configuration: defaults, validation, merging, and JSON round-trip.
 *
 * JSON is produced and consumed with a small hand-rolled reader and writer
 * rather than an external library, so the SDK stays dependency free. The
 * supported shape is intentionally narrow — a flat object of scalars — which is
 * all the SDK configuration needs. Anything the reader does not understand is
 * preserved as an extra key rather than silently dropped.
 */

#include "internal.h"

/** The targets the SDK can execute, sorted. */
static const char *const MAM_CONFIG_TARGETS[] = {"go",     "javascript", "markdown", "python",
                                                 "rust",   "shell",      "typescript"};
static const size_t MAM_CONFIG_TARGET_COUNT =
    sizeof(MAM_CONFIG_TARGETS) / sizeof(MAM_CONFIG_TARGETS[0]);

static const char *const MAM_CONFIG_KNOWN_KEYS[] = {"version", "work_dir", "target", "verbose"};
static const size_t MAM_CONFIG_KNOWN_COUNT = 4u;

mam_config_t *mam_config_default(void)
{
    mam_config_t *config = (mam_config_t *)mam_calloc(1u, sizeof(mam_config_t));
    if (config == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate config", 0u, 0u);
        return NULL;
    }
    config->version = mam_strdup("1.0.0");
    config->work_dir = mam_strdup(".");
    config->target = mam_strdup("python");
    config->verbose = false;
    return config;
}

void mam_config_free(mam_config_t *config)
{
    if (config == NULL) {
        return;
    }
    free(config->version);
    free(config->work_dir);
    free(config->target);
    for (size_t i = 0u; i < config->extra_count; i++) {
        free(config->extra_keys[i]);
        free(config->extra_values[i]);
    }
    free(config->extra_keys);
    free(config->extra_values);
    free(config);
}

char *mam_config_normalize_target(const char *target)
{
    if (target == NULL) {
        return mam_strdup("");
    }
    const char *trimmed = mam_str_trim(target);
    struct {
        const char *alias;
        const char *canonical;
    } table[] = {
        {"py", "python"},  {"python3", "python"}, {"js", "javascript"}, {"node", "javascript"},
        {"ts", "typescript"}, {"golang", "go"},   {"bash", "shell"},    {"sh", "shell"},
        {"md", "markdown"},
    };
    for (size_t i = 0u; i < sizeof(table) / sizeof(table[0]); i++) {
        if (mam_strcasecmp(table[i].alias, trimmed) == 0) {
            return mam_strdup(table[i].canonical);
        }
    }
    return mam_strdup(trimmed);
}

bool mam_config_is_supported_target(const char *target)
{
    if (target == NULL || target[0] == '\0') {
        return false;
    }
    for (size_t i = 0u; i < MAM_CONFIG_TARGET_COUNT; i++) {
        if (mam_strcasecmp(MAM_CONFIG_TARGETS[i], target) == 0) {
            return true;
        }
    }
    return false;
}

char **mam_config_list_targets(size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = MAM_CONFIG_TARGET_COUNT;
    }
    char **result = (char **)mam_calloc(MAM_CONFIG_TARGET_COUNT, sizeof(char *));
    if (result == NULL) {
        if (out_count != NULL) {
            *out_count = 0u;
        }
        return NULL;
    }
    for (size_t i = 0u; i < MAM_CONFIG_TARGET_COUNT; i++) {
        result[i] = mam_strdup(MAM_CONFIG_TARGETS[i]);
        if (result[i] == NULL) {
            mam_free_string_array(result, i);
            if (out_count != NULL) {
                *out_count = 0u;
            }
            return NULL;
        }
    }
    return result;
}

size_t mam_config_validate(const mam_config_t *config, char ***out_problems)
{
    if (out_problems != NULL) {
        *out_problems = NULL;
    }
    if (config == NULL) {
        return 0u;
    }

    char *problems[MAM_CONFIG_KNOWN_COUNT];
    size_t count = 0u;

    if (config->version == NULL || config->version[0] == '\0') {
        problems[count++] = mam_strdup("field 'version' must not be empty");
    } else if (strchr(config->version, '.') == NULL) {
        problems[count++] = mam_format_alloc("field 'version' should look like a semantic "
                                            "version, got '%s'",
                                            config->version);
    }

    if (config->work_dir == NULL || config->work_dir[0] == '\0') {
        problems[count++] = mam_strdup("field 'work_dir' must not be empty");
    }

    if (config->target == NULL || config->target[0] == '\0') {
        problems[count++] = mam_strdup("field 'target' must not be empty");
    } else if (!mam_config_is_supported_target(config->target)) {
        problems[count++] = mam_format_alloc("field 'target' must be a supported target, got '%s'",
                                            config->target);
    }

    if (out_problems == NULL) {
        mam_free_string_array(problems, count);
        return count;
    }
    if (count == 0u) {
        return 0u;
    }
    char **result = (char **)mam_calloc(count, sizeof(char *));
    if (result == NULL) {
        mam_free_string_array(problems, count);
        return 0u;
    }
    for (size_t i = 0u; i < count; i++) {
        result[i] = problems[i];
    }
    *out_problems = result;
    return count;
}

mam_config_t *mam_config_merge(const mam_config_t *base, const mam_config_t *over)
{
    if (base == NULL && over == NULL) {
        return mam_config_default();
    }
    if (base == NULL) {
        base = over;
        over = NULL;
    }

    mam_config_t *merged = (mam_config_t *)mam_calloc(1u, sizeof(mam_config_t));
    if (merged == NULL) {
        return NULL;
    }

    merged->version = mam_strdup((over != NULL && over->version != NULL && over->version[0] != '\0')
                                     ? over->version
                                     : base->version);
    merged->work_dir = mam_strdup(
        (over != NULL && over->work_dir != NULL && over->work_dir[0] != '\0') ? over->work_dir
                                                                             : base->work_dir);
    merged->target = mam_strdup((over != NULL && over->target != NULL && over->target[0] != '\0')
                                    ? over->target
                                    : base->target);
    merged->verbose = base->verbose || (over != NULL && over->verbose);

    size_t base_extra = base->extra_count;
    size_t over_extra = over != NULL ? over->extra_count : 0u;
    size_t total = base_extra + over_extra;
    if (total > 0u) {
        merged->extra_keys = (char **)mam_calloc(total, sizeof(char *));
        merged->extra_values = (char **)mam_calloc(total, sizeof(char *));
        if (merged->extra_keys == NULL || merged->extra_values == NULL) {
            mam_config_free(merged);
            return NULL;
        }
    }
    for (size_t i = 0u; i < base_extra; i++) {
        merged->extra_keys[merged->extra_count] = mam_strdup(base->extra_keys[i]);
        merged->extra_values[merged->extra_count] = mam_strdup(base->extra_values[i]);
        merged->extra_count++;
    }
    for (size_t i = 0u; over != NULL && i < over_extra; i++) {
        bool replaced = false;
        for (size_t j = 0u; j < merged->extra_count; j++) {
            if (strcmp(merged->extra_keys[j], over->extra_keys[i]) != 0) {
                continue;
            }
            free(merged->extra_values[j]);
            merged->extra_values[j] = mam_strdup(over->extra_values[i]);
            replaced = true;
            break;
        }
        if (!replaced) {
            merged->extra_keys[merged->extra_count] = mam_strdup(over->extra_keys[i]);
            merged->extra_values[merged->extra_count] = mam_strdup(over->extra_values[i]);
            merged->extra_count++;
        }
    }
    return merged;
}

/** Escapes @p text for inclusion in a JSON string. Owned. */
static char *mam_json_escape(const char *text)
{
    size_t length = strlen(text);
    char *out = (char *)mam_calloc(length * 6u + 1u, 1u);
    if (out == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < length; i++) {
        unsigned char c = (unsigned char)text[i];
        switch (c) {
        case '"':
            out[cursor++] = '\\';
            out[cursor++] = '"';
            break;
        case '\\':
            out[cursor++] = '\\';
            out[cursor++] = '\\';
            break;
        case '\n':
            out[cursor++] = '\\';
            out[cursor++] = 'n';
            break;
        case '\t':
            out[cursor++] = '\\';
            out[cursor++] = 't';
            break;
        case '\r':
            out[cursor++] = '\\';
            out[cursor++] = 'r';
            break;
        default:
            if (c < 0x20u) {
                static const char HEX[] = "0123456789abcdef";
                out[cursor++] = '\\';
                out[cursor++] = 'u';
                out[cursor++] = '0';
                out[cursor++] = '0';
                out[cursor++] = HEX[(c >> 4) & 0x0fu];
                out[cursor++] = HEX[c & 0x0fu];
            } else {
                out[cursor++] = (char)c;
            }
            break;
        }
    }
    out[cursor] = '\0';
    return out;
}

char *mam_config_to_json(const mam_config_t *config)
{
    if (config == NULL) {
        return mam_strdup("{}");
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    if (!mam_buffer_append(&text, &length, &capacity, "{\n  \"version\": \"")) {
        return NULL;
    }
    char *escaped = mam_json_escape(config->version != NULL ? config->version : "");
    if (escaped == NULL ||
        !mam_buffer_append(&text, &length, &capacity, escaped) ||
        !mam_buffer_append(&text, &length, &capacity, "\",\n  \"work_dir\": \"")) {
        free(escaped);
        free(text);
        return NULL;
    }
    free(escaped);

    escaped = mam_json_escape(config->work_dir != NULL ? config->work_dir : "");
    if (escaped == NULL ||
        !mam_buffer_append(&text, &length, &capacity, escaped) ||
        !mam_buffer_append(&text, &length, &capacity, "\",\n  \"target\": \"")) {
        free(escaped);
        free(text);
        return NULL;
    }
    free(escaped);

    escaped = mam_json_escape(config->target != NULL ? config->target : "");
    if (escaped == NULL ||
        !mam_buffer_append(&text, &length, &capacity, escaped) ||
        !mam_buffer_append(&text, &length, &capacity, "\",\n  \"verbose\": ")) {
        free(escaped);
        free(text);
        return NULL;
    }
    free(escaped);

    if (!mam_buffer_append(&text, &length, &capacity, config->verbose ? "true" : "false")) {
        free(text);
        return NULL;
    }
    for (size_t i = 0u; i < config->extra_count; i++) {
        char *key = mam_json_escape(config->extra_keys[i]);
        char *value = mam_json_escape(config->extra_values[i]);
        if (key == NULL || value == NULL ||
            !mam_buffer_append(&text, &length, &capacity, ",\n  \"") ||
            !mam_buffer_append(&text, &length, &capacity, key) ||
            !mam_buffer_append(&text, &length, &capacity, "\": \"") ||
            !mam_buffer_append(&text, &length, &capacity, value) ||
            !mam_buffer_append(&text, &length, &capacity, "\"")) {
            free(key);
            free(value);
            free(text);
            return NULL;
        }
        free(key);
        free(value);
    }
    if (!mam_buffer_append(&text, &length, &capacity, "\n}\n")) {
        free(text);
        return NULL;
    }
    return text;
}

/** Returns true when @p name is one of the four known fields. */
static bool mam_config_key_known(const char *name)
{
    for (size_t i = 0u; i < MAM_CONFIG_KNOWN_COUNT; i++) {
        if (strcmp(MAM_CONFIG_KNOWN_KEYS[i], name) == 0) {
            return true;
        }
    }
    return false;
}

/** Reads the next JSON string token, advancing @p cursor. Owned, or NULL. */
static char *mam_json_next_string(const char *json, size_t *cursor)
{
    while (json[*cursor] != '\0' && json[*cursor] != '"') {
        (*cursor)++;
    }
    if (json[*cursor] != '"') {
        return NULL;
    }
    (*cursor)++;

    char *out = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    while (json[*cursor] != '\0' && json[*cursor] != '"') {
        char c = json[*cursor];
        if (c == '\\' && json[*cursor + 1u] != '\0') {
            (*cursor)++;
            char escaped = json[*cursor];
            switch (escaped) {
            case 'n':
                c = '\n';
                break;
            case 't':
                c = '\t';
                break;
            case 'r':
                c = '\r';
                break;
            default:
                c = escaped;
                break;
            }
        }
        if (!mam_buffer_push(&out, &length, &capacity, c)) {
            free(out);
            return NULL;
        }
        (*cursor)++;
    }
    if (json[*cursor] == '"') {
        (*cursor)++;
    }
    return out != NULL ? out : mam_strdup("");
}

mam_config_t *mam_config_from_json(const char *json_text)
{
    if (json_text == NULL) {
        return NULL;
    }
    const char *trimmed = mam_str_trim(json_text);
    if (trimmed[0] != '{') {
        mam_error_set(MAM_ERR_PARSE, "config JSON must be an object", 0u, 0u);
        return NULL;
    }

    mam_config_t *config = mam_config_default();
    if (config == NULL) {
        return NULL;
    }

    size_t cursor = 1u;
    while (trimmed[cursor] != '\0' && trimmed[cursor] != '}') {
        char *key = mam_json_next_string(trimmed, &cursor);
        if (key == NULL) {
            break;
        }
        while (trimmed[cursor] == ' ' || trimmed[cursor] == ':' || trimmed[cursor] == '\t' ||
               trimmed[cursor] == '\n' || trimmed[cursor] == '\r') {
            cursor++;
        }

        if (mam_strcasecmp(key, "version") == 0) {
            char *value = mam_json_next_string(trimmed, &cursor);
            if (value != NULL) {
                free(config->version);
                config->version = value;
            }
        } else if (mam_strcasecmp(key, "work_dir") == 0) {
            char *value = mam_json_next_string(trimmed, &cursor);
            if (value != NULL) {
                free(config->work_dir);
                config->work_dir = value;
            }
        } else if (mam_strcasecmp(key, "target") == 0) {
            char *value = mam_json_next_string(trimmed, &cursor);
            if (value != NULL) {
                char *normalized = mam_config_normalize_target(value);
                free(value);
                free(config->target);
                config->target = normalized;
            }
        } else if (mam_strcasecmp(key, "verbose") == 0) {
            if (strncmp(trimmed + cursor, "true", 4) == 0) {
                config->verbose = true;
            }
            while (trimmed[cursor] != '\0' && trimmed[cursor] != ',' &&
                   trimmed[cursor] != '}') {
                cursor++;
            }
        } else if (!mam_config_key_known(key)) {
            char *value = mam_json_next_string(trimmed, &cursor);
            if (value != NULL) {
                char **keys = (char **)realloc(config->extra_keys,
                                               (config->extra_count + 1u) * sizeof(char *));
                if (keys == NULL) {
                    free(value);
                    free(key);
                    mam_config_free(config);
                    return NULL;
                }
                config->extra_keys = keys;
                keys = (char **)realloc(config->extra_values,
                                        (config->extra_count + 1u) * sizeof(char *));
                if (keys == NULL) {
                    free(value);
                    free(key);
                    mam_config_free(config);
                    return NULL;
                }
                config->extra_values = keys;
                config->extra_keys[config->extra_count] = key;
                config->extra_values[config->extra_count] = value;
                config->extra_count++;
                key = NULL;
            }
        }

        if (key != NULL) {
            free(key);
        }
        while (trimmed[cursor] == ' ' || trimmed[cursor] == '\t' || trimmed[cursor] == '\n' ||
               trimmed[cursor] == '\r') {
            cursor++;
        }
        if (trimmed[cursor] == ',') {
            cursor++;
        }
    }
    return config;
}

char *mam_config_resolve_path(const char *work_dir)
{
    if (work_dir != NULL && work_dir[0] != '\0') {
        return mam_format_alloc("%s/%s", work_dir, MAM_CONFIG_FILENAME);
    }
    return mam_format_alloc("%s", MAM_CONFIG_FILENAME);
}

mam_config_t *mam_config_load(const char *path)
{
    char *resolved = mam_config_resolve_path(path);
    if (resolved == NULL) {
        return NULL;
    }
    FILE *handle = fopen(resolved, "rb");
    if (handle == NULL) {
        free(resolved);
        return mam_config_default();
    }
    fseek(handle, 0L, SEEK_END);
    long size = ftell(handle);
    rewind(handle);
    if (size < 0L) {
        fclose(handle);
        free(resolved);
        return mam_config_default();
    }
    char *buffer = (char *)mam_calloc((size_t)size + 1u, 1u);
    if (buffer == NULL) {
        fclose(handle);
        free(resolved);
        return NULL;
    }
    size_t read = fread(buffer, 1u, (size_t)size, handle);
    fclose(handle);
    buffer[read] = '\0';
    free(resolved);

    if (mam_str_trim(buffer)[0] == '\0') {
        free(buffer);
        return mam_config_default();
    }
    mam_config_t *config = mam_config_from_json(buffer);
    free(buffer);
    return config;
}

bool mam_config_save(const mam_config_t *config, const char *path)
{
    if (config == NULL) {
        return false;
    }
    char **problems = NULL;
    if (mam_config_validate(config, &problems) > 0u) {
        mam_free_string_array(problems, 0u);
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "refusing to save an invalid config", 0u, 0u);
        return false;
    }

    char *resolved = mam_config_resolve_path(path);
    if (resolved == NULL) {
        return false;
    }
    char *json = mam_config_to_json(config);
    if (json == NULL) {
        free(resolved);
        return false;
    }
    FILE *handle = fopen(resolved, "wb");
    if (handle == NULL) {
        free(json);
        free(resolved);
        mam_error_setf(MAM_ERR_IO, 0u, 0u, "could not open '%s' for writing", resolved);
        return false;
    }
    size_t written = fwrite(json, 1u, strlen(json), handle);
    fclose(handle);
    free(json);
    free(resolved);
    return written > 0u;
}
