/**
 * @file template.c
 * @brief Starter module templates, placeholder rendering, and name validation.
 *
 * Templates are plain strings containing `{{name}}` markers. Rendering is done
 * with a hand-rolled scanner rather than a regex engine, which keeps the SDK
 * free of dependencies and makes the "leave unknown placeholders alone"
 * behaviour explicit: a marker with no supplied value is copied through
 * verbatim, so incomplete output is visible instead of silently blank.
 */

#include "internal.h"

const char *const MAM_STARTER_KINDS[3] = {"agent", "module", "tool"};

/** Resolves an alias such as `bot` to a canonical kind. Returns NULL if unknown. */
static const char *mam_template_resolve(const char *kind)
{
    if (kind == NULL) {
        return NULL;
    }
    struct {
        const char *alias;
        const char *canonical;
    } table[] = {
        {"module", "module"},   {"mod", "module"},      {"package", "module"},
        {"lib", "module"},      {"library", "module"},  {"agent", "agent"},
        {"bot", "agent"},       {"assistant", "agent"}, {"plugin", "agent"},
        {"tool", "tool"},       {"utility", "tool"},    {"util", "tool"},
        {"cli", "tool"},        {"script", "tool"},
    };
    for (size_t i = 0u; i < sizeof(table) / sizeof(table[0]); i++) {
        if (mam_strcasecmp(table[i].alias, kind) == 0) {
            return table[i].canonical;
        }
    }
    return NULL;
}

char **mam_template_list_kinds(size_t *out_count)
{
    const size_t count = 3u;
    if (out_count != NULL) {
        *out_count = count;
    }
    char **result = (char **)mam_calloc(count, sizeof(char *));
    if (result == NULL) {
        if (out_count != NULL) {
            *out_count = 0u;
        }
        return NULL;
    }
    for (size_t i = 0u; i < count; i++) {
        result[i] = mam_strdup(MAM_STARTER_KINDS[i]);
    }
    return result;
}

/** The module starter. */
static const char *const MAM_TEMPLATE_MODULE =
    "---\n"
    "id: {{id}}\n"
    "name: {{name}}\n"
    "version: {{version}}\n"
    "author: {{author}}\n"
    "runtime: {{runtime}}\n"
    "description: {{description}}\n"
    "---\n"
    "\n"
    "## Purpose\n"
    "\n"
    "{{description}}\n"
    "\n"
    "## Inputs\n"
    "\n"
    "Describe the inputs this module consumes.\n"
    "\n"
    "## Outputs\n"
    "\n"
    "Describe the outputs this module produces.\n"
    "\n"
    "## Rules\n"
    "\n"
    "- State the invariants this module must uphold.\n"
    "\n"
    "## Workflow\n"
    "\n"
    "1. Receive inputs\n"
    "2. Validate inputs\n"
    "3. Produce outputs\n"
    "\n"
    "## Python\n"
    "\n"
    "```python\n"
    "def process(payload):\n"
    "    return payload\n"
    "```\n"
    "\n"
    "## Exports\n"
    "\n"
    "- `process`\n";

/** The agent starter. */
static const char *const MAM_TEMPLATE_AGENT =
    "---\n"
    "id: {{id}}\n"
    "name: {{name}}\n"
    "version: {{version}}\n"
    "author: {{author}}\n"
    "runtime: python\n"
    "description: {{description}}\n"
    "---\n"
    "\n"
    "## Purpose\n"
    "\n"
    "{{name}} is an agent that {{description}}\n"
    "\n"
    "## Role\n"
    "\n"
    "You are {{name}}. Your job is to {{description}}\n"
    "\n"
    "## Inputs\n"
    "\n"
    "- The user request\n"
    "- Relevant context supplied by the caller\n"
    "\n"
    "## Outputs\n"
    "\n"
    "- A clear, actionable response\n"
    "- Supporting reasoning when asked\n"
    "\n"
    "## Rules\n"
    "\n"
    "- Never invent facts about the environment\n"
    "- State uncertainty explicitly\n"
    "- Prefer concise, structured answers\n"
    "\n"
    "## Prompt\n"
    "\n"
    "You are {{name}}. Respond to the user's request using the rules above.\n"
    "\n"
    "## Capabilities\n"
    "\n"
    "- reason\n"
    "- summarize\n";

/** The tool starter. */
static const char *const MAM_TEMPLATE_TOOL =
    "---\n"
    "id: {{id}}\n"
    "name: {{name}}\n"
    "version: {{version}}\n"
    "author: {{author}}\n"
    "runtime: {{runtime}}\n"
    "description: {{description}}\n"
    "---\n"
    "\n"
    "## Purpose\n"
    "\n"
    "{{description}}\n"
    "\n"
    "## Inputs\n"
    "\n"
    "| Name | Type | Required | Description |\n"
    "| --- | --- | --- | --- |\n"
    "| `input` | string | yes | The value to transform |\n"
    "\n"
    "## Outputs\n"
    "\n"
    "| Name | Type | Description |\n"
    "| --- | --- | --- |\n"
    "| `result` | string | The transformed value |\n"
    "\n"
    "## Rules\n"
    "\n"
    "- Validate the format before processing\n"
    "- Exit non-zero on invalid input\n"
    "\n"
    "## Usage\n"
    "\n"
    "```\n"
    "{{id}} --input value\n"
    "```\n"
    "\n"
    "## Exports\n"
    "\n"
    "- `main`\n";

char *mam_template_get(const char *kind)
{
    const char *resolved = mam_template_resolve(kind);
    if (resolved == NULL) {
        mam_error_setf(MAM_ERR_INVALID_ARGUMENT, 0u, 0u, "unknown starter kind '%s'",
                       kind != NULL ? kind : "(null)");
        return NULL;
    }
    if (strcmp(resolved, "module") == 0) {
        return mam_strdup(MAM_TEMPLATE_MODULE);
    }
    if (strcmp(resolved, "agent") == 0) {
        return mam_strdup(MAM_TEMPLATE_AGENT);
    }
    return mam_strdup(MAM_TEMPLATE_TOOL);
}

/** Returns true when @p name is a bare identifier, as placeholders must be. */
static bool mam_template_is_identifier(const char *name)
{
    if (name == NULL || name[0] == '\0') {
        return false;
    }
    char first = name[0];
    bool first_ok = (first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') || first == '_';
    if (!first_ok) {
        return false;
    }
    for (size_t i = 1u; name[i] != '\0'; i++) {
        char c = name[i];
        bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                  c == '_';
        if (!ok) {
            return false;
        }
    }
    return true;
}

/** Looks up @p name in a flat key/value array, case-insensitively. */
static const char *mam_template_lookup(const char *const *variables, size_t variable_count,
                                       const char *name)
{
    if (variables == NULL) {
        return NULL;
    }
    size_t pairs = variable_count / 2u;
    for (size_t i = 0u; i < pairs; i++) {
        const char *key = variables[i * 2u];
        const char *value = variables[i * 2u + 1u];
        if (key != NULL && mam_strcasecmp(key, name) == 0) {
            return value;
        }
    }
    return NULL;
}

char *mam_template_render(const char *template_text, const char *const *variables,
                          size_t variable_count)
{
    if (template_text == NULL) {
        return NULL;
    }

    char *out = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    size_t i = 0u;

    while (template_text[i] != '\0') {
        if (template_text[i] != '{' || template_text[i + 1u] != '{') {
            if (!mam_buffer_push(&out, &length, &capacity, template_text[i])) {
                free(out);
                return NULL;
            }
            i++;
            continue;
        }

        size_t name_start = i + 2u;
        size_t name_end = name_start;
        while (template_text[name_end] != '\0' && template_text[name_end] != '}') {
            name_end++;
        }
        if (template_text[name_end] != '}' || template_text[name_end + 1u] != '}') {
            /* Not a well-formed marker; emit the brace and carry on. */
            if (!mam_buffer_push(&out, &length, &capacity, '{')) {
                free(out);
                return NULL;
            }
            i++;
            continue;
        }

        size_t raw_length = name_end - name_start;
        char *name = (char *)mam_calloc(raw_length + 1u, 1u);
        if (name == NULL) {
            free(out);
            return NULL;
        }
        memcpy(name, template_text + name_start, raw_length);
        const char *trimmed = mam_str_trim(name);
        char trimmed_copy[64];
        size_t trimmed_length = strlen(trimmed);
        if (trimmed_length >= sizeof(trimmed_copy)) {
            trimmed_length = sizeof(trimmed_copy) - 1u;
        }
        memcpy(trimmed_copy, trimmed, trimmed_length);
        trimmed_copy[trimmed_length] = '\0';

        const char *replacement = NULL;
        if (mam_template_is_identifier(trimmed_copy)) {
            replacement = mam_template_lookup(variables, variable_count, trimmed_copy);
        }

        if (replacement != NULL) {
            for (size_t k = 0u; replacement[k] != '\0'; k++) {
                if (!mam_buffer_push(&out, &length, &capacity, replacement[k])) {
                    free(name);
                    free(out);
                    return NULL;
                }
            }
        } else {
            for (size_t k = name_start; k <= name_end + 1u; k++) {
                if (!mam_buffer_push(&out, &length, &capacity, template_text[k])) {
                    free(name);
                    free(out);
                    return NULL;
                }
            }
        }
        free(name);
        i = name_end + 2u;
    }

    return out != NULL ? out : mam_strdup("");
}

char *mam_template_slugify(const char *name)
{
    if (name == NULL) {
        return mam_strdup("");
    }
    char *out = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    bool pending_dash = false;
    for (const char *cursor = name; *cursor != '\0'; cursor++) {
        char c = *cursor;
        if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
            if (pending_dash && length > 0u) {
                if (!mam_buffer_push(&out, &length, &capacity, '-')) {
                    free(out);
                    return NULL;
                }
            }
            pending_dash = false;
            if (!mam_buffer_push(&out, &length, &capacity, c)) {
                free(out);
                return NULL;
            }
            continue;
        }
        if ((c >= 'A' && c <= 'Z')) {
            if (pending_dash && length > 0u) {
                if (!mam_buffer_push(&out, &length, &capacity, '-')) {
                    free(out);
                    return NULL;
                }
            }
            pending_dash = false;
            if (!mam_buffer_push(&out, &length, &capacity, (char)(c - 'A' + 'a'))) {
                free(out);
                return NULL;
            }
            continue;
        }
        pending_dash = true;
    }
    return out != NULL ? out : mam_strdup("");
}

char **mam_template_validate_name(const char *name, size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = 0u;
    }
    if (name == NULL) {
        return NULL;
    }

    char *problems[5];
    size_t count = 0u;
    const char *trimmed = name;
    size_t length = strlen(trimmed);
    while (length > 0u && (trimmed[length - 1u] == ' ' || trimmed[length - 1u] == '\t')) {
        length--;
    }
    size_t start = 0u;
    while (start < length && (trimmed[start] == ' ' || trimmed[start] == '\t')) {
        start++;
    }
    length -= start;
    trimmed += start;

    if (length == 0u) {
        problems[count++] = mam_strdup("name must not be empty");
    } else if (length > 64u) {
        problems[count++] = mam_strdup("name must be at most 64 characters");
    } else {
        char first = trimmed[0];
        if (!((first >= 'a' && first <= 'z') || (first >= 'A' && first <= 'Z') ||
              (first >= '0' && first <= '9') || first == '_')) {
            problems[count++] =
                mam_strdup("name must start with a letter, digit, or underscore");
        }
        for (size_t i = 0u; i < length; i++) {
            char c = trimmed[i];
            bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                      c == ' ' || c == '_' || c == '.' || c == '-';
            if (!ok) {
                problems[count++] =
                    mam_strdup("name may only contain letters, digits, spaces, dots, dashes "
                               "and underscores");
                break;
            }
        }
    }

    if (out_count == NULL) {
        mam_free_string_array(problems, count);
        return NULL;
    }
    if (count == 0u) {
        return NULL;
    }
    char **result = (char **)mam_calloc(count, sizeof(char *));
    if (result == NULL) {
        mam_free_string_array(problems, count);
        return NULL;
    }
    for (size_t i = 0u; i < count; i++) {
        result[i] = problems[i];
    }
    *out_count = count;
    return result;
}

char *mam_template_new_module(const char *name, const char *kind, const char *runtime)
{
    if (name == NULL) {
        return NULL;
    }
    size_t problem_count = 0u;
    char **problems = mam_template_validate_name(name, &problem_count);
    if (problem_count > 0u) {
        mam_free_string_array(problems, problem_count);
        mam_error_setf(MAM_ERR_INVALID_ARGUMENT, 0u, 0u, "invalid starter name '%s'", name);
        return NULL;
    }

    char *template_text = mam_template_get(kind);
    if (template_text == NULL) {
        return NULL;
    }

    const char *use_runtime = runtime != NULL && runtime[0] != '\0' ? runtime : "python";
    char *id = mam_template_slugify(name);
    if (id == NULL) {
        free(template_text);
        return NULL;
    }
    const char *trimmed_name = mam_str_trim(name);
    char *description = mam_format_alloc("Describe what %s does.", trimmed_name);

    const char *variables[12];
    size_t count = 0u;
    variables[count++] = "id";
    variables[count++] = id;
    variables[count++] = "name";
    variables[count++] = trimmed_name;
    variables[count++] = "version";
    variables[count++] = "0.1.0";
    variables[count++] = "author";
    variables[count++] = "unknown";
    variables[count++] = "runtime";
    variables[count++] = use_runtime;
    variables[count++] = "description";
    variables[count++] = description != NULL ? description : "";

    char *rendered = mam_template_render(template_text, variables, count);
    free(template_text);
    free(id);
    free(description);
    return rendered;
}
