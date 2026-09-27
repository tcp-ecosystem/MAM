/**
 * @file doctor.c
 * @brief Environment self-checks.
 *
 * These probes never execute anything: they ask the operating system whether a
 * command resolves on PATH and report what they find. That keeps the check safe
 * to run in a build script and means a doctor run cannot itself fail for lack
 * of permissions.
 */

#include "internal.h"

#ifdef _WIN32
#include <direct.h>
#define MAM_ACCESS _access
#define MAM_FILE_MODE 0
#else
#include <unistd.h>
#define MAM_ACCESS access
#define MAM_FILE_MODE R_OK | X_OK
#endif

/** The interpreters the runtime knows about, probed by default. */
static const char *const MAM_DOCTOR_LANGUAGES[] = {"python", "node", "sh", "go", "rustc"};
static const size_t MAM_DOCTOR_LANGUAGE_COUNT =
    sizeof(MAM_DOCTOR_LANGUAGES) / sizeof(MAM_DOCTOR_LANGUAGES[0]);

const char *mam_check_status_name(mam_check_status_t status)
{
    switch (status) {
    case MAM_CHECK_OK:
        return "PASS";
    case MAM_CHECK_WARN:
        return "WARN";
    case MAM_CHECK_FAIL:
        return "FAIL";
    default:
        return "UNKNOWN";
    }
}

bool mam_doctor_command_exists(const char *command)
{
    if (command == NULL || command[0] == '\0') {
        return false;
    }
    const char *path = getenv("PATH");
    if (path == NULL) {
        return false;
    }
#ifdef _WIN32
    const char separator = ';';
    const char *suffixes[] = {".exe", ".com", ".bat", ""};
#else
    const char separator = ':';
    const char *suffixes[] = {""};
#endif
    size_t suffix_count = sizeof(suffixes) / sizeof(suffixes[0]);

    const char *cursor = path;
    while (*cursor != '\0') {
        const char *end = cursor;
        while (*end != '\0' && *end != separator) {
            end++;
        }
        size_t directory_length = (size_t)(end - cursor);
        for (size_t s = 0u; s < suffix_count; s++) {
            size_t need = directory_length + 1u + strlen(command) + strlen(suffixes[s]) + 1u;
            char *candidate = (char *)mam_calloc(need, 1u);
            if (candidate == NULL) {
                return false;
            }
            memcpy(candidate, cursor, directory_length);
            size_t at = directory_length;
            if (at > 0u && candidate[at - 1u] != '/' && candidate[at - 1u] != '\\') {
                candidate[at++] = '/';
            }
            strcpy(candidate + at, command);
            strcat(candidate, suffixes[s]);
            if (MAM_ACCESS(candidate, MAM_FILE_MODE) == 0) {
                free(candidate);
                return true;
            }
            free(candidate);
        }
        cursor = (*end == separator) ? end + 1 : end;
    }
    return false;
}

void mam_doctor_report_free(mam_doctor_report_t *report)
{
    if (report == NULL) {
        return;
    }
    for (size_t i = 0u; i < report->count; i++) {
        free(report->checks[i].name);
        free(report->checks[i].message);
    }
    free(report->checks);
    free(report);
}

/** Appends a check. Takes ownership of nothing; both strings are copied. */
static bool mam_doctor_push(mam_doctor_report_t *report, const char *name,
                            mam_check_status_t status, const char *message)
{
    mam_check_t *grown =
        (mam_check_t *)realloc(report->checks, (report->count + 1u) * sizeof(mam_check_t));
    if (grown == NULL) {
        return false;
    }
    report->checks = grown;
    report->checks[report->count].name = mam_strdup(name);
    report->checks[report->count].status = status;
    report->checks[report->count].message = mam_strdup(message);
    report->count++;
    return true;
}

mam_doctor_report_t *mam_doctor_run(const char *const *languages)
{
    mam_doctor_report_t *report = (mam_doctor_report_t *)mam_calloc(1u, sizeof(mam_doctor_report_t));
    if (report == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate report", 0u, 0u);
        return NULL;
    }

    char message[256];
    int written = snprintf(message, sizeof(message), "mam-c %s reporting %s", MAM_VERSION,
                           MAM_SDK_NAME);
    if (written > 0) {
        mam_doctor_push(report, "sdk", MAM_CHECK_OK, message);
    }

    written = snprintf(message, sizeof(message), "%d supported section kinds", 19);
    if (written > 0) {
        mam_doctor_push(report, "ast", MAM_CHECK_OK, message);
    }

    for (size_t i = 0u; languages != NULL && languages[i] != NULL; i++) {
        if (mam_doctor_command_exists(languages[i])) {
            written = snprintf(message, sizeof(message), "%s is available on PATH", languages[i]);
            if (written > 0) {
                mam_doctor_push(report, languages[i], MAM_CHECK_OK, message);
            }
        } else {
            written = snprintf(message, sizeof(message),
                               "%s was not found on PATH; modules using it cannot be executed",
                               languages[i]);
            if (written > 0) {
                mam_doctor_push(report, languages[i], MAM_CHECK_WARN, message);
            }
        }
    }

    if (languages == NULL) {
        for (size_t i = 0u; i < MAM_DOCTOR_LANGUAGE_COUNT; i++) {
            if (mam_doctor_command_exists(MAM_DOCTOR_LANGUAGES[i])) {
                written = snprintf(message, sizeof(message), "%s is available on PATH",
                                   MAM_DOCTOR_LANGUAGES[i]);
                if (written > 0) {
                    mam_doctor_push(report, MAM_DOCTOR_LANGUAGES[i], MAM_CHECK_OK, message);
                }
            } else {
                written = snprintf(message, sizeof(message),
                                   "%s was not found on PATH; modules using it cannot be executed",
                                   MAM_DOCTOR_LANGUAGES[i]);
                if (written > 0) {
                    mam_doctor_push(report, MAM_DOCTOR_LANGUAGES[i], MAM_CHECK_WARN, message);
                }
            }
        }
    }

    return report;
}

mam_check_status_t mam_doctor_report_status(const mam_doctor_report_t *report)
{
    if (report == NULL) {
        return MAM_CHECK_FAIL;
    }
    mam_check_status_t worst = MAM_CHECK_OK;
    for (size_t i = 0u; i < report->count; i++) {
        if (report->checks[i].status == MAM_CHECK_FAIL) {
            return MAM_CHECK_FAIL;
        }
        if (report->checks[i].status == MAM_CHECK_WARN) {
            worst = MAM_CHECK_WARN;
        }
    }
    return worst;
}

bool mam_doctor_report_is_ok(const mam_doctor_report_t *report)
{
    return mam_doctor_report_status(report) != MAM_CHECK_FAIL;
}

char *mam_doctor_report_format(const mam_doctor_report_t *report)
{
    if (report == NULL || report->count == 0u) {
        return mam_strdup("No diagnostics were run.");
    }

    size_t width = 0u;
    for (size_t i = 0u; i < report->count; i++) {
        size_t length = strlen(report->checks[i].name);
        if (length > width) {
            width = length;
        }
    }

    char *text = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    char header[128];
    int written = snprintf(header, sizeof(header), "MAM SDK diagnostics: %s\n",
                           mam_check_status_name(mam_doctor_report_status(report)));
    if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, header)) {
        return NULL;
    }

    for (size_t i = 0u; i < report->count; i++) {
        char line[512];
        char padded[64];
        size_t name_length = strlen(report->checks[i].name);
        size_t copy = name_length < sizeof(padded) - 1u ? name_length : sizeof(padded) - 1u;
        memcpy(padded, report->checks[i].name, copy);
        padded[copy] = '\0';
        for (size_t k = copy; k < width && k + 1u < sizeof(padded); k++) {
            padded[k] = ' ';
        }
        padded[copy < width + 1u ? width : sizeof(padded) - 1u] = '\0';
        written = snprintf(line, sizeof(line), "[%s] %s  %s\n",
                           mam_check_status_name(report->checks[i].status), padded,
                           report->checks[i].message);
        if (written <= 0 || !mam_buffer_append(&text, &length, &capacity, line)) {
            free(text);
            return NULL;
        }
    }

    char footer[128];
    written = snprintf(footer, sizeof(footer), "%zu checks\n", report->count);
    if (written > 0) {
        mam_buffer_append(&text, &length, &capacity, footer);
    }
    return text;
}
