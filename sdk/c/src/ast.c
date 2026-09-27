/**
 * @file ast.c
 * @brief Core value types, accessors, and the thread-local error slot.
 *
 * Ownership note: every string reachable from a mam_module_t is allocated with
 * mam_strdup and released exactly once by mam_module_free. Getters return
 * borrowed pointers into that storage and never allocate, except where the
 * header explicitly says the result is owned.
 */

#include "internal.h"

/* ------------------------------------------------------------------------- */
/* Thread-local error state                                                    */
/* ------------------------------------------------------------------------- */

static mam_error_t g_last_error;

void mam_error_set(mam_status_t status, const char *message, size_t line, size_t column)
{
    g_last_error.status = status;
    g_last_error.line = line;
    g_last_error.column = column;
    if (message == NULL) {
        g_last_error.message[0] = '\0';
        return;
    }
    size_t limit = sizeof(g_last_error.message) - 1u;
    size_t length = strlen(message);
    if (length > limit) {
        length = limit;
    }
    memcpy(g_last_error.message, message, length);
    g_last_error.message[length] = '\0';
}

/** Duplicates a string, returning NULL when @p text is NULL. */
char *mam_strdup(const char *text){
    if (text == NULL) {
        return NULL;
    }
    size_t length = strlen(text);
    char *copy = (char *)malloc(length + 1u);
    if (copy == NULL) {
        return NULL;
    }
    memcpy(copy, text, length + 1u);
    return copy;
}

/** Allocates a zeroed block. Returns NULL on overflow or allocation failure. */
void *mam_calloc(size_t count, size_t size)
{
    if (count == 0u || size == 0u) {
        return NULL;
    }
    if (count > (size_t)-1 / size) {
        return NULL;
    }
    return calloc(count, size);
}

const mam_error_t *mam_last_error(void)
{
    return &g_last_error;
}

size_t mam_last_error_message(char *buffer, size_t buffer_size)
{
    if (buffer == NULL || buffer_size == 0u) {
        return 0u;
    }
    size_t limit = buffer_size - 1u;
    size_t length = strlen(g_last_error.message);
    if (length > limit) {
        length = limit;
    }
    memcpy(buffer, g_last_error.message, length);
    buffer[length] = '\0';
    return length;
}

void mam_clear_error(void)
{
    g_last_error.status = MAM_OK;
    g_last_error.line = 0u;
    g_last_error.column = 0u;
    g_last_error.message[0] = '\0';
}

void mam_error_format(const mam_error_t *error, char *buffer, size_t buffer_size)
{
    if (buffer == NULL || buffer_size == 0u) {
        return;
    }
    if (error == NULL) {
        buffer[0] = '\0';
        return;
    }
    int written = snprintf(buffer, buffer_size, "%s (line %zu, column %zu)", error->message,
                           error->line, error->column);
    if (written < 0) {
        buffer[0] = '\0';
    }
}

const char *mam_version(void)
{
    return MAM_VERSION;
}

const char *mam_sdk_name(void)
{
    return MAM_SDK_NAME;
}

const char *mam_user_agent(void)
{
    return MAM_SDK_NAME "/" MAM_VERSION;
}

/* ------------------------------------------------------------------------- */
/* Node accessors                                                             */
/* ------------------------------------------------------------------------- */

const char *mam_node_type_name(mam_node_type_t type)
{
    switch (type) {
    case MAM_NODE_HEADING:
        return "heading";
    case MAM_NODE_PARAGRAPH:
        return "paragraph";
    case MAM_NODE_CODE_BLOCK:
        return "code_block";
    case MAM_NODE_LIST:
        return "list";
    case MAM_NODE_TABLE:
        return "table";
    case MAM_NODE_BLOCKQUOTE:
        return "blockquote";
    case MAM_NODE_HORIZONTAL_RULE:
        return "horizontal_rule";
    case MAM_NODE_LINK:
        return "link";
    case MAM_NODE_IMAGE:
        return "image";
    case MAM_NODE_TEXT:
        return "text";
    default:
        return "unknown";
    }
}

const char *mam_node_name(const mam_node_t *node)
{
    if (node == NULL) {
        return "";
    }
    switch (node->type) {
    case MAM_NODE_HEADING:
        return node->as.heading.text != NULL ? node->as.heading.text : "";
    case MAM_NODE_PARAGRAPH:
    case MAM_NODE_BLOCKQUOTE:
    case MAM_NODE_TEXT:
        return node->as.text != NULL ? node->as.text : "";
    case MAM_NODE_CODE_BLOCK:
        return node->as.code_block.language != NULL ? node->as.code_block.language : "";
    case MAM_NODE_LINK:
        return node->as.link.text != NULL ? node->as.link.text : "";
    case MAM_NODE_IMAGE:
        return node->as.image.alt != NULL ? node->as.image.alt : "";
    default:
        return "";
    }
}

/* ------------------------------------------------------------------------- */
/* Section kinds                                                              */
/* ------------------------------------------------------------------------- */

/** The 19 standard kinds, in canonical order. */
static const char *const MAM_SECTION_KIND_NAMES[MAM_STANDARD_SECTION_KIND_COUNT] = {
    "metadata", "purpose",    "inputs",  "outputs", "rules",    "workflow",  "mermaid",
    "python",   "prompt",     "memory",  "examples", "tests",   "references", "dependencies",
    "exports",  "imports",    "plugins", "permissions", "capabilities"};

const char *mam_section_kind_name(mam_section_kind_t kind)
{
    if (kind < MAM_SECTION_METADATA || kind > MAM_SECTION_CUSTOM) {
        return "custom";
    }
    if (kind == MAM_SECTION_CUSTOM) {
        return "custom";
    }
    return MAM_SECTION_KIND_NAMES[(size_t)kind];
}

mam_section_kind_t mam_section_kind_from_string(const char *name)
{
    if (name == NULL) {
        return MAM_SECTION_CUSTOM;
    }
    char buffer[64];
    size_t index = 0u;
    while (index + 1u < sizeof(buffer) && name[index] != '\0') {
        char c = name[index];
        if (c >= 'A' && c <= 'Z') {
            c = (char)(c - 'A' + 'a');
        }
        buffer[index] = c;
        index++;
    }
    buffer[index] = '\0';

    char trimmed[64];
    size_t start = 0u;
    while (start < index && (buffer[start] == ' ' || buffer[start] == '\t')) {
        start++;
    }
    size_t end = index;
    while (end > start && (buffer[end - 1u] == ' ' || buffer[end - 1u] == '\t')) {
        end--;
    }
    size_t length = end - start;
    for (size_t i = 0u; i < length; i++) {
        trimmed[i] = buffer[start + i];
    }
    trimmed[length] = '\0';

    for (size_t i = 0u; i < MAM_STANDARD_SECTION_KIND_COUNT; i++) {
        if (strcmp(trimmed, MAM_SECTION_KIND_NAMES[i]) == 0) {
            return (mam_section_kind_t)i;
        }
    }
    return MAM_SECTION_CUSTOM;
}

bool mam_section_kind_is_standard(mam_section_kind_t kind)
{
    return kind >= MAM_SECTION_METADATA && kind <= MAM_SECTION_CAPABILITIES;
}

int mam_section_kind_order(mam_section_kind_t kind)
{
    if (!mam_section_kind_is_standard(kind)) {
        return -1;
    }
    return (int)kind;
}

/* ------------------------------------------------------------------------- */
/* Module lifecycle                                                           */
/* ------------------------------------------------------------------------- */

/** Releases a NULL terminated string array and its entries. */
static void mam_free_string_array(char **items, size_t count)
{
    if (items == NULL) {
        return;
    }
    for (size_t i = 0u; i < count; i++) {
        free(items[i]);
    }
    free(items);
}

/** Releases one content node and everything it owns. */
static void mam_node_release(mam_node_t *node)
{
    if (node == NULL) {
        return;
    }
    switch (node->type) {
    case MAM_NODE_HEADING:
        free(node->as.heading.text);
        break;
    case MAM_NODE_PARAGRAPH:
    case MAM_NODE_BLOCKQUOTE:
    case MAM_NODE_TEXT:
        free(node->as.text);
        break;
    case MAM_NODE_CODE_BLOCK:
        free(node->as.code_block.language);
        free(node->as.code_block.code);
        break;
    case MAM_NODE_LIST:
        mam_free_string_array(node->as.list.items, node->as.list.item_count);
        break;
    case MAM_NODE_TABLE:
        mam_free_string_array(node->as.table.headers, node->as.table.header_count);
        free(node->as.table.cells);
        break;
    case MAM_NODE_LINK:
        free(node->as.link.text);
        free(node->as.link.url);
        break;
    case MAM_NODE_IMAGE:
        free(node->as.image.alt);
        free(node->as.image.url);
        break;
    case MAM_NODE_HORIZONTAL_RULE:
    default:
        break;
    }
}

static void mam_section_release(mam_section_t *section)
{
    if (section == NULL) {
        return;
    }
    free(section->title);
    for (size_t i = 0u; i < section->content_count; i++) {
        mam_node_release(&section->content[i]);
    }
    free(section->content);
}

static void mam_frontmatter_release(mam_frontmatter_t *frontmatter)
{
    if (frontmatter == NULL) {
        return;
    }
    free(frontmatter->schema_version);
    free(frontmatter->name);
    free(frontmatter->version);
    free(frontmatter->description);
    free(frontmatter->license);
    mam_free_string_array(frontmatter->authors, frontmatter->author_count);
    mam_free_string_array(frontmatter->tags, frontmatter->tag_count);
    mam_free_string_array(frontmatter->dependencies, frontmatter->dependency_count);
}

mam_module_t *mam_module_new(void)
{
    mam_module_t *module = (mam_module_t *)mam_calloc(1u, sizeof(mam_module_t));
    if (module == NULL) {
        mam_error_set(MAM_ERR_OUT_OF_MEMORY, "could not allocate module", 0u, 0u);
        return NULL;
    }
    return module;
}

void mam_module_free(mam_module_t *module)
{
    if (module == NULL) {
        return;
    }
    mam_frontmatter_release(&module->frontmatter);
    for (size_t i = 0u; i < module->section_count; i++) {
        mam_section_release(&module->sections[i]);
    }
    free(module->sections);
    free(module->raw_content);
    free(module->file_path);
    free(module);
}

/* ------------------------------------------------------------------------- */
/* Module accessors                                                           */
/* ------------------------------------------------------------------------- */

const char *mam_module_name(const mam_module_t *module)
{
    if (module == NULL) {
        return "(null)";
    }
    if (module->frontmatter.name != NULL && module->frontmatter.name[0] != '\0') {
        return module->frontmatter.name;
    }
    if (module->file_path != NULL && module->file_path[0] != '\0') {
        return module->file_path;
    }
    return "(untitled)";
}

const char *mam_module_version(const mam_module_t *module)
{
    if (module == NULL || module->frontmatter.version == NULL ||
        module->frontmatter.version[0] == '\0') {
        return "(none)";
    }
    return module->frontmatter.version;
}

const char *mam_module_description(const mam_module_t *module)
{
    if (module == NULL || module->frontmatter.description == NULL ||
        module->frontmatter.description[0] == '\0') {
        return "(none)";
    }
    return module->frontmatter.description;
}

const char *mam_module_file_path(const mam_module_t *module)
{
    if (module == NULL || module->file_path == NULL || module->file_path[0] == '\0') {
        return "(memory)";
    }
    return module->file_path;
}

const char *mam_module_summary(const mam_module_t *module)
{
    if (module == NULL) {
        return "(null module)";
    }
    return mam_format_module_summary(module);
}

size_t mam_module_code_block_count(const mam_module_t *module)
{
    if (module == NULL) {
        return 0u;
    }
    size_t total = 0u;
    for (size_t i = 0u; i < module->section_count; i++) {
        for (size_t j = 0u; j < module->sections[i].content_count; j++) {
            if (module->sections[i].content[j].type == MAM_NODE_CODE_BLOCK) {
                total++;
            }
        }
    }
    return total;
}

size_t mam_module_node_count(const mam_module_t *module)
{
    if (module == NULL) {
        return 0u;
    }
    size_t total = 0u;
    for (size_t i = 0u; i < module->section_count; i++) {
        total += module->sections[i].content_count;
    }
    return total;
}

const mam_section_t *mam_module_get_section(const mam_module_t *module,
                                             mam_section_kind_t kind)
{
    if (module == NULL) {
        return NULL;
    }
    for (size_t i = 0u; i < module->section_count; i++) {
        if (module->sections[i].kind == kind) {
            return &module->sections[i];
        }
    }
    return NULL;
}

const mam_section_t **mam_module_get_sections(const mam_module_t *module,
                                              mam_section_kind_t kind,
                                              size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = 0u;
    }
    if (module == NULL) {
        return NULL;
    }
    size_t matches = 0u;
    for (size_t i = 0u; i < module->section_count; i++) {
        if (module->sections[i].kind == kind) {
            matches++;
        }
    }
    if (matches == 0u) {
        return NULL;
    }
    const mam_section_t **result =
        (const mam_section_t **)mam_calloc(matches, sizeof(const mam_section_t *));
    if (result == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < module->section_count; i++) {
        if (module->sections[i].kind == kind) {
            result[cursor] = &module->sections[i];
            cursor++;
        }
    }
    if (out_count != NULL) {
        *out_count = matches;
    }
    return result;
}

bool mam_module_has_section(const mam_module_t *module, mam_section_kind_t kind)
{
    return mam_module_get_section(module, kind) != NULL;
}

const char *mam_module_section_title(const mam_module_t *module, size_t index)
{
    if (module == NULL || index >= module->section_count) {
        return NULL;
    }
    return module->sections[index].title;
}

const mam_code_block_t **mam_section_code_blocks(const mam_section_t *section,
                                                 size_t *out_count)
{
    if (out_count != NULL) {
        *out_count = 0u;
    }
    if (section == NULL) {
        return NULL;
    }
    size_t matches = 0u;
    for (size_t i = 0u; i < section->content_count; i++) {
        if (section->content[i].type == MAM_NODE_CODE_BLOCK) {
            matches++;
        }
    }
    if (matches == 0u) {
        return NULL;
    }
    const mam_code_block_t **result =
        (const mam_code_block_t **)mam_calloc(matches, sizeof(const mam_code_block_t *));
    if (result == NULL) {
        return NULL;
    }
    size_t cursor = 0u;
    for (size_t i = 0u; i < section->content_count; i++) {
        if (section->content[i].type == MAM_NODE_CODE_BLOCK) {
            result[cursor] = &section->content[i].as.code_block;
            cursor++;
        }
    }
    if (out_count != NULL) {
        *out_count = matches;
    }
    return result;
}

char *mam_section_text_content(const mam_section_t *section)
{
    if (section == NULL) {
        return NULL;
    }
    char *buffer = NULL;
    size_t length = 0u;
    size_t capacity = 0u;
    for (size_t i = 0u; i < section->content_count; i++) {
        const mam_node_t *node = &section->content[i];
        const char *text = NULL;
        if (node->type == MAM_NODE_PARAGRAPH || node->type == MAM_NODE_TEXT ||
            node->type == MAM_NODE_BLOCKQUOTE) {
            text = node->as.text;
        }
        if (text == NULL) {
            continue;
        }
        if (!mam_buffer_append(&buffer, &length, &capacity, text)) {
            free(buffer);
            return NULL;
        }
        if (!mam_buffer_append(&buffer, &length, &capacity, "\n")) {
            free(buffer);
            return NULL;
        }
    }
    if (buffer == NULL) {
        return mam_strdup("");
    }
    return buffer;
}
