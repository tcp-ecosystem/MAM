/**
 * @file util.c
 * @brief Shared string, formatting, and YAML-scalar helpers.
 *
 * The SDK deliberately avoids an external YAML library so that it can be
 * dropped into a project without adding a dependency. The subset handled here
 * is exactly what MAM front matter uses: scalars, quoted strings, integers,
 * booleans, null, simple `key: value` maps, and inline `[a, b]` sequences.
 * Anything more exotic is preserved as raw text rather than guessed at.
 */

#include "internal.h"

#include <time.h>

/** Records a failure using printf-style formatting. */
void mam_error_setf(mam_status_t status, size_t line, size_t column, const char *format, ...)
{
    char message[512];
    va_list args;
    va_start(args, format);
    int written = vsnprintf(message, sizeof(message), format, args);
    va_end(args);
    if (written < 0) {
        message[0] = '\0';
    }
    mam_error_set(status, message, line, column);
}

void mam_free_string_array(char **items, size_t count)
{
    if (items == NULL) {
        return;
    }
    for (size_t i = 0u; i < count; i++) {
        free(items[i]);
    }
    free(items);
}

char *mam_str_join(char *const *items, size_t count, const char *separator)
{
    const char *sep = separator != NULL ? separator : "";
    size_t sep_length = strlen(sep);
    size_t total = 0u;
    for (size_t i = 0u; i < count; i++) {
        if (items[i] == NULL) {
            continue;
        }
        if (total > 0u) {
            total += sep_length;
        }
        total += strlen(items[i]);
    }

    char *result = (char *)mam_calloc(total + 1u, 1u);
    if (result == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < count; i++) {
        if (items[i] == NULL) {
            continue;
        }
        if (cursor > 0u) {
            memcpy(result + cursor, sep, sep_length);
            cursor += sep_length;
        }
        size_t length = strlen(items[i]);
        memcpy(result + cursor, items[i], length);
        cursor += length;
    }
    result[cursor] = '\0';
    return result;
}

char *mam_format_alloc(const char *format, ...)
{
    va_list probe;
    va_start(probe, format);
    int needed = vsnprintf(NULL, 0u, format, probe);
    va_end(probe);
    if (needed < 0) {
        return NULL;
    }
    char *buffer = (char *)mam_calloc((size_t)needed + 1u, 1u);
    if (buffer == NULL) {
        return NULL;
    }
    va_list args;
    va_start(args, format);
    int written = vsnprintf(buffer, (size_t)needed + 1u, format, args);
    va_end(args);
    if (written < 0) {
        free(buffer);
        return NULL;
    }
    return buffer;
}

int mam_strcasecmp(const char *left, const char *right)
{
    if (left == NULL) {
        left = "";
    }
    if (right == NULL) {
        right = "";
    }
    while (*left != '\0' && *right != '\0') {
        char a = *left;
        char b = *right;
        if (a >= 'A' && a <= 'Z') {
            a = (char)(a - 'A' + 'a');
        }
        if (b >= 'A' && b <= 'Z') {
            b = (char)(b - 'A' + 'a');
        }
        if (a != b) {
            return (int)(unsigned char)a - (int)(unsigned char)b;
        }
        left++;
        right++;
    }
    return (int)(unsigned char)*left - (int)(unsigned char)*right;
}

const char *mam_str_trim(const char *text)
{
    if (text == NULL) {
        return "";
    }
    while (*text == ' ' || *text == '\t' || *text == '\r' || *text == '\n') {
        text++;
    }
    const char *end = text + strlen(text);
    while (end > text) {
        char c = *(end - 1);
        if (c != ' ' && c != '\t' && c != '\r' && c != '\n') {
            break;
        }
        end--;
    }
    return text;
}

/** Appends a single character to @p buffer, growing it as needed. */
static bool mam_push_char(char **buffer, size_t *length, size_t *capacity, char character)
{
    if (*buffer == NULL) {
        *capacity = 32u;
        *buffer = (char *)malloc(*capacity);
        if (*buffer == NULL) {
            return false;
        }
    }
    if (*length + 2u > *capacity) {
        size_t wanted = *capacity * 2u;
        char *grown = (char *)realloc(*buffer, wanted);
        if (grown == NULL) {
            return false;
        }
        *buffer = grown;
        *capacity = wanted;
    }
    (*buffer)[*length] = character;
    (*length)++;
    (*buffer)[*length] = '\0';
    return true;
}

/** Appends a single character to @p buffer, growing it as needed. */
bool mam_buffer_push(char **buffer, size_t *length, size_t *capacity, char character)
{
    return mam_push_char(buffer, length, capacity, character);
}

bool mam_buffer_append(char **buffer, size_t *length, size_t *capacity, const char *text)
{
    if (text == NULL) {
        return true;
    }
    for (size_t i = 0u; text[i] != '\0'; i++) {
        if (!mam_push_char(buffer, length, capacity, text[i])) {
            return false;
        }
    }
    return true;
}

/**
 * Copies the YAML scalar @p raw into an owned, unquoted string.
 *
 * Only double and single quotes are treated as quoting; an unquoted scalar is
 * returned with its whitespace trimmed.
 */
char *mam_yaml_scalar(const char *raw)
{
    const char *text = mam_str_trim(raw);
    if (*text == '\0') {
        return mam_strdup("");
    }

    char quote = *text;
    size_t raw_length = strlen(text);
    if ((quote == '"' || quote == '\'') && raw_length >= 2u && text[raw_length - 1u] == quote) {
        char *result = (char *)mam_calloc(raw_length, 1u);
        if (result == NULL) {
            return NULL;
        }
        size_t cursor = 0u;
        for (size_t i = 1u; i + 1u < raw_length; i++) {
            if (quote == '"' && text[i] == '\\' && (i + 2u) < raw_length) {
                char next = text[i + 1u];
                i++;
                switch (next) {
                case 'n':
                    result[cursor] = '\n';
                    break;
                case 't':
                    result[cursor] = '\t';
                    break;
                case 'r':
                    result[cursor] = '\r';
                    break;
                case '"':
                    result[cursor] = '"';
                    break;
                case '\\':
                    result[cursor] = '\\';
                    break;
                default:
                    result[cursor] = next;
                    break;
                }
                cursor++;
                continue;
            }
            result[cursor] = text[i];
            cursor++;
        }
        result[cursor] = '\0';
        return result;
    }

    /* Strip an unquoted trailing comment, which YAML allows after a space. */
    char *result = mam_strdup(text);
    if (result == NULL) {
        return NULL;
    }
    for (size_t i = 1u; i + 1u < raw_length; i++) {
        if (result[i] == '#' && result[i - 1u] == ' ') {
            size_t end = i;
            while (end > 0u && (result[end - 1u] == ' ' || result[end - 1u] == '\t')) {
                end--;
            }
            result[end] = '\0';
            break;
        }
    }
    return result;
}

size_t mam_yaml_inline_sequence(const char *raw, char ***out_items)
{
    if (out_items != NULL) {
        *out_items = NULL;
    }
    const char *text = mam_str_trim(raw);
    size_t length = strlen(text);
    if (length < 2u || text[0] != '[' || text[length - 1u] != ']') {
        return 0u;
    }

    char *inner = (char *)mam_calloc(length - 1u, 1u);
    if (inner == NULL) {
        return 0u;
    }
    memcpy(inner, text + 1, length - 2u);

    size_t capacity = 4u;
    char **items = (char **)mam_calloc(capacity, sizeof(char *));
    if (items == NULL) {
        free(inner);
        return 0u;
    }
    size_t count = 0u;

    char *cursor = inner;
    while (*cursor != '\0') {
        while (*cursor == ' ' || *cursor == '\t' || *cursor == ',') {
            cursor++;
        }
        if (*cursor == '\0') {
            break;
        }
        char *start = cursor;
        while (*cursor != '\0' && *cursor != ',') {
            cursor++;
        }
        char saved = *cursor;
        *cursor = '\0';
        char *value = mam_yaml_scalar(start);
        if (value == NULL) {
            free(inner);
            mam_free_string_array(items, count);
            return 0u;
        }
        if (count == capacity) {
            size_t wanted = capacity * 2u;
            char **grown = (char **)realloc(items, wanted * sizeof(char *));
            if (grown == NULL) {
                free(value);
                free(inner);
                mam_free_string_array(items, count);
                return 0u;
            }
            items = grown;
            capacity = wanted;
        }
        items[count] = value;
        count++;
        *cursor = saved;
        if (saved == '\0') {
            break;
        }
    }

    free(inner);
    if (out_items != NULL) {
        *out_items = items;
    } else {
        mam_free_string_array(items, count);
    }
    return count;
}

unsigned long mam_now_seconds(void)
{
    return (unsigned long)time(NULL);
}
