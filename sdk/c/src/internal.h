/**
 * @file internal.h
 * @brief Declarations shared between the SDK's translation units.
 *
 * This header is NOT installed and is not part of the public API. It pulls in
 * both public headers so every translation unit can see the complete surface,
 * and declares the small set of internal helpers that the implementation
 * files share.
 */

#ifndef MAM_INTERNAL_H
#define MAM_INTERNAL_H

#include "mam/mam.h"
#include "mam/support.h"

#include <stdarg.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/** Default cap on document size, in bytes. */
#define MAM_DEFAULT_MAX_INPUT_BYTES (8u * 1024u * 1024u)

/** Default cap on the number of sections in one document. */
#define MAM_DEFAULT_MAX_SECTIONS 4096u

/**
 * Records a failure in the thread-local error slot.
 *
 * @param status The error code.
 * @param message Human readable detail; copied into a fixed buffer.
 * @param line 1-based line, or 0 when unknown.
 * @param column 1-based column, or 0 when unknown.
 */
void mam_error_set(mam_status_t status, const char *message, size_t line, size_t column);

/** Records a failure using printf-style formatting. */
void mam_error_setf(mam_status_t status, size_t line, size_t column, const char *format, ...);

/** Duplicates a string. Returns NULL when @p text is NULL. */
char *mam_strdup(const char *text);

/** Allocates a zeroed block, guarding against overflow. NULL on failure. */
void *mam_calloc(size_t count, size_t size);

/** Frees a string array produced by this SDK. NULL safe. */
void mam_free_string_array(char **items, size_t count);

/** Joins strings with a separator into an owned result. */
char *mam_str_join(char *const *items, size_t count, const char *separator);

/**
 * Grows a string buffer.
 *
 * @param buffer In/out pointer to the buffer; may be NULL on entry.
 * @param length In/out current length excluding the terminator.
 * @param capacity In/out current allocation.
 * @param text Text to append; NULL or empty is a no-op.
 * @return false on allocation failure, in which case the buffer is unchanged.
 */
bool mam_buffer_append(char **buffer, size_t *length, size_t *capacity, const char *text);

/** Appends a single character to the growable buffer described above. */
bool mam_buffer_push(char **buffer, size_t *length, size_t *capacity, char character);

/** Formats into a freshly allocated string. Returns NULL on failure. */
char *mam_format_alloc(const char *format, ...);

/** Case-insensitive comparison of two NUL terminated strings. */
int mam_strcasecmp(const char *left, const char *right);

/** Returns a pointer to leading and trailing whitespace removed from @p text. */
const char *mam_str_trim(const char *text);

/** Copies the YAML scalar @p raw into an owned, unquoted string. */
char *mam_yaml_scalar(const char *raw);

/**
 * Splits a YAML inline sequence such as `[a, b]` into owned elements.
 *
 * @return The number of elements written, or 0 when @p raw is not a sequence.
 */
size_t mam_yaml_inline_sequence(const char *raw, char ***out_items);

/** The parser implementation state, opaque outside parser.c. */
struct mam_parser {
    mam_parser_config_t config;
};

/** The cache implementation state, opaque outside cache.c. */
struct mam_cache {
    mam_cache_entry_t *entries;
    size_t entry_count;
    size_t entry_capacity;
    unsigned long ttl_seconds;
    mam_cache_stats_t stats;
};

/** Returns the current wall clock time in seconds. */
unsigned long mam_now_seconds(void);

#endif /* MAM_INTERNAL_H */
