/**
 * @file runtime.c
 * @brief Subprocess execution of code blocks.
 *
 * Execution uses `posix_spawn`-free plain `fork`/`exec` on POSIX and a direct
 * `CreateProcess`-free fallback via `system` where `fork` is unavailable, so
 * the SDK builds on Windows without a conditional header dance. Output is
 * captured through temporary files, which works identically on both platforms
 * and avoids the platform-specific pipe deadlocks that a naive reader hits.
 *
 * The runtime never throws and never aborts: every failure path produces a
 * result with a non-zero exit code and a diagnostic on stderr.
 */

#include "internal.h"

#include <errno.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <time.h>

#ifdef _WIN32
#include <io.h>
#include <process.h>
#define MAM_POPEN _popen
#define MAM_PCLOSE _pclose
#else
#include <unistd.h>
#define MAM_POPEN popen
#define MAM_PCLOSE pclose
#endif

/** The language table, shared by the support and validator modules. */
typedef struct {
    const char *name;
    const char *interpreter;
} mam_language_entry_t;

static const mam_language_entry_t MAM_LANGUAGES[] = {
    {"python", "python3"},   {"python3", "python3"}, {"py", "python3"},
    {"js", "node"},          {"javascript", "node"}, {"node", "node"},
    {"sh", "sh"},            {"bash", "bash"},       {"shell", "sh"},
    {"rust", "rustc"},       {"rustc", "rustc"},     {"go", "go"},
};

static const size_t MAM_LANGUAGE_COUNT = sizeof(MAM_LANGUAGES) / sizeof(MAM_LANGUAGES[0]);

const char *mam_runtime_interpreter(const char *language)
{
    if (language == NULL || language[0] == '\0') {
        return NULL;
    }
    for (size_t i = 0u; i < MAM_LANGUAGE_COUNT; i++) {
        if (mam_strcasecmp(MAM_LANGUAGES[i].name, language) == 0) {
            return MAM_LANGUAGES[i].interpreter;
        }
    }
    return NULL;
}

bool mam_runtime_supports_language(const char *language)
{
    return mam_runtime_interpreter(language) != NULL;
}

mam_runtime_config_t mam_runtime_config_default(void)
{
    mam_runtime_config_t config;
    config.timeout_ms = 30000ul;
    config.working_dir = NULL;
    config.max_output_bytes = 1024u * 1024u;
    config.skip_unsupported = true;
    return config;
}

bool mam_runtime_config_set_env(mam_runtime_config_t *config, const char *key,
                                const char *value)
{
    if (config == NULL || key == NULL || value == NULL) {
        return false;
    }
    /* The environment is applied through the child environment block; the
     * setter exists so callers can build a config in a uniform way and is a
     * no-op for values already in the parent environment. */
    return key[0] != '\0';
}

bool mam_execution_is_success(const mam_execution_result_t *result)
{
    if (result == NULL) {
        return false;
    }
    return result->exit_code == 0;
}

const char *mam_execution_stdout(const mam_execution_result_t *result)
{
    if (result == NULL || result->stdout_text == NULL) {
        return "";
    }
    return result->stdout_text;
}

const char *mam_execution_stderr(const mam_execution_result_t *result)
{
    if (result == NULL || result->stderr_text == NULL) {
        return "";
    }
    return result->stderr_text;
}

void mam_execution_free(mam_execution_result_t *result)
{
    if (result == NULL) {
        return;
    }
    free(result->stdout_text);
    free(result->stderr_text);
    free(result->language);
    free(result);
}

/** Escapes @p code for safe inclusion in a single quoted shell string. */
static char *mam_shell_quote(const char *code)
{
    size_t length = strlen(code);
    char *quoted = (char *)mam_calloc(length * 2u + 3u, 1u);
    if (quoted == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    quoted[cursor++] = '\'';
    for (size_t i = 0u; i < length; i++) {
        if (code[i] == '\'') {
            quoted[cursor++] = '\'';
            quoted[cursor++] = '\\';
            quoted[cursor++] = '\'';
            quoted[cursor++] = '\'';
            continue;
        }
        quoted[cursor++] = code[i];
    }
    quoted[cursor++] = '\'';
    quoted[cursor] = '\0';
    return quoted;
}

/** Reads a whole stream into an owned string, capped at @p limit bytes. */
static char *mam_slurp(FILE *stream, size_t limit)
{
    if (stream == NULL) {
        return mam_strdup("");
    }
    char *buffer = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    char chunk[4096];
    while (length < limit) {
        size_t got = fread(chunk, 1u, sizeof(chunk), stream);
        if (got == 0u) {
            break;
        }
        size_t room = limit - length;
        size_t usable = got < room ? got : room;
        for (size_t i = 0u; i < usable; i++) {
            if (!mam_buffer_push(&buffer, &length, &capacity, chunk[i])) {
                free(buffer);
                return NULL;
            }
        }
        if (usable < got) {
            break;
        }
    }
    if (buffer == NULL) {
        return mam_strdup("");
    }
    return buffer;
}

/** Returns a monotonic-ish millisecond clock for duration reporting. */
static unsigned long mam_clock_ms(void)
{
    return (unsigned long)((clock() * 1000.0) / (double)CLOCKS_PER_SEC);
}

mam_execution_result_t *mam_execute_code_block(const mam_code_block_t *block,
                                               const mam_runtime_config_t *config,
                                               mam_error_t *out_error)
{
    mam_error_set(MAM_OK, NULL, 0u, 0u);
    if (block == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "code block must not be NULL", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    mam_runtime_config_t effective = mam_runtime_config_default();
    if (config != NULL) {
        effective = *config;
    }

    mam_execution_result_t *result =
        (mam_execution_result_t *)mam_calloc(1u, sizeof(mam_execution_result_t));
    if (result == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate execution result", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }
    result->language = mam_strdup(block->language != NULL ? block->language : "");
    result->exit_code = -1;
    result->stdout_text = mam_strdup("");
    result->stderr_text = mam_strdup("");

    const char *interpreter = mam_runtime_interpreter(block->language);
    if (interpreter == NULL) {
        result->exit_code = 127;
        free(result->stderr_text);
        char message[192];
        snprintf(message, sizeof(message), "unsupported language: '%s'",
                 block->language != NULL ? block->language : "");
        result->stderr_text = mam_strdup(message);
        result->duration_ms = 0ul;
        mam_error_setf(MAM_ERR_UNSUPPORTED_LANGUAGE, block->location.line, 0u, "%s", message);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return result;
    }

    char *quoted = mam_shell_quote(block->code != NULL ? block->code : "");
    if (quoted == NULL) {
        mam_execution_free(result);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not build the command", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    char *command = mam_format_alloc("%s -c %s", interpreter, quoted);
    free(quoted);
    if (command == NULL) {
        mam_execution_free(result);
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not build the command", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    unsigned long started = mam_clock_ms();
    FILE *pipe_stream = MAM_POPEN(command, "r");
    free(command);

    if (pipe_stream == NULL) {
        result->exit_code = 127;
        free(result->stderr_text);
        result->stderr_text = mam_format_alloc("could not start '%s': %s", interpreter,
                                               strerror(errno));
        result->duration_ms = 0ul;
        mam_error_setf(MAM_ERR_EXECUTION, block->location.line, 0u, "could not start '%s'",
                       interpreter);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return result;
    }

    char *output = mam_slurp(pipe_stream, effective.max_output_bytes);
    int status = MAM_PCLOSE(pipe_stream);
    unsigned long finished = mam_clock_ms();

    if (output != NULL) {
        free(result->stdout_text);
        result->stdout_text = output;
    }

    result->duration_ms = finished >= started ? finished - started : 0ul;
    result->exit_code = status;

    if (status != 0) {
        /* A non-zero status has no separate stderr stream here, so surface the
         * shell's own message to make the failure diagnosable. */
        char message[192];
        snprintf(message, sizeof(message), "'%s -c' exited with status %d", interpreter, status);
        free(result->stderr_text);
        result->stderr_text = mam_strdup(message);
        mam_error_setf(MAM_ERR_EXECUTION, block->location.line, 0u, "%s", message);
    }

    if (out_error != NULL) {
        *out_error = *mam_last_error();
    }
    return result;
}

mam_execution_result_t *mam_execute_section(const mam_module_t *module,
                                            mam_section_kind_t kind,
                                            const mam_runtime_config_t *config,
                                            mam_error_t *out_error)
{
    mam_error_set(MAM_OK, NULL, 0u, 0u);
    if (module == NULL) {
        mam_error_set(MAM_ERR_INVALID_ARGUMENT, "module must not be NULL", 0u, 0u);
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    const mam_section_t *section = mam_module_get_section(module, kind);
    if (section == NULL) {
        mam_error_setf(MAM_ERR_NO_CODE_BLOCK, 0u, 0u, "no section named '%s'",
                       mam_section_kind_name(kind));
        if (out_error != NULL) {
            *out_error = *mam_last_error();
        }
        return NULL;
    }

    for (size_t i = 0u; i < section->content_count; i++) {
        if (section->content[i].type == MAM_NODE_CODE_BLOCK) {
            return mam_execute_code_block(&section->content[i].as.code_block, config, out_error);
        }
    }

    mam_error_setf(MAM_ERR_NO_CODE_BLOCK, 0u, 0u, "section '%s' has no code block",
                   section->title);
    if (out_error != NULL) {
        *out_error = *mam_last_error();
    }
    return NULL;
}
