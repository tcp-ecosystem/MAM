/**
 * @file mam.cpp
 * @brief Implementation of the C++ RAII wrapper.
 *
 * The C layer owns all memory; this file only translates. The recurring pattern
 * is: take a C string, return a `string_view` over it, and make sure the C
 * object outlives the view. Where a value must outlive its owner the string is
 * copied into a `std::string` instead, and the header says so.
 */

#include "mam/mam.hpp"

#include <algorithm>
#include <cstdlib>
#include <cstring>

namespace mam {
namespace {

/** Borrows a C string as a view, mapping NULL to an empty view. */
std::string_view view(const char *text) noexcept
{
    return text != nullptr ? std::string_view(text) : std::string_view();
}

/** Copies a C string, mapping NULL to an empty string. */
std::string copy(const char *text)
{
    return text != nullptr ? std::string(text) : std::string();
}

/** Joins a NULL-terminated C string array into owned strings. */
std::vector<std::string> collect(char *const *items, std::size_t count)
{
    std::vector<std::string> result;
    if (items == nullptr) {
        return result;
    }
    result.reserve(count);
    for (std::size_t i = 0; i < count; ++i) {
        result.push_back(copy(items[i]));
    }
    return result;
}

/** Joins a borrowed string array into borrowed views. */
std::vector<std::string_view> views(const char *const *items, std::size_t count)
{
    std::vector<std::string_view> result;
    if (items == nullptr) {
        return result;
    }
    result.reserve(count);
    for (std::size_t i = 0; i < count; ++i) {
        result.push_back(view(items[i]));
    }
    return result;
}

}  // namespace

/* ------------------------------------------------------------------------- */
/* Errors                                                                      */
/* ------------------------------------------------------------------------- */

Error::Error(mam_status_t status, const std::string &detail)
    : std::runtime_error("mam error " + std::to_string(static_cast<int>(status)) +
                         (detail.empty() ? std::string{} : ": " + detail)),
      status_(status)
{
}

void check(mam_status_t status, const std::string &detail)
{
    if (status != MAM_OK) {
        throw Error(status, detail);
    }
}

void throw_last_error(const std::string &detail)
{
    const mam_error_t *error = mam_last_error();
    throw Error(error->status, detail.empty() ? std::string(error->message)
                                              : detail + ": " + error->message);
}

/* ------------------------------------------------------------------------- */
/* Front matter                                                                */
/* ------------------------------------------------------------------------- */

std::string_view FrontMatter::name() const noexcept
{
    return fm_ != nullptr ? view(fm_->name) : std::string_view();
}

std::string_view FrontMatter::version() const noexcept
{
    return fm_ != nullptr ? view(fm_->version) : std::string_view();
}

std::string_view FrontMatter::description() const noexcept
{
    return fm_ != nullptr ? view(fm_->description) : std::string_view();
}

std::string_view FrontMatter::runtime() const noexcept
{
    return fm_ != nullptr ? view(fm_->runtime) : std::string_view();
}

std::string_view FrontMatter::license() const noexcept
{
    return fm_ != nullptr ? view(fm_->license) : std::string_view();
}

std::string_view FrontMatter::schema_version() const noexcept
{
    return fm_ != nullptr ? view(fm_->schema_version) : std::string_view();
}

std::vector<std::string_view> FrontMatter::authors() const
{
    if (fm_ == nullptr) {
        return {};
    }
    return views(fm_->authors, fm_->author_count);
}

std::vector<std::string_view> FrontMatter::tags() const
{
    if (fm_ == nullptr) {
        return {};
    }
    return views(fm_->tags, fm_->tag_count);
}

std::vector<std::string_view> FrontMatter::dependencies() const
{
    if (fm_ == nullptr) {
        return {};
    }
    return views(fm_->dependencies, fm_->dependency_count);
}

/* ------------------------------------------------------------------------- */
/* Nodes and sections                                                           */
/* ------------------------------------------------------------------------- */

std::string_view Node::type_name() const noexcept
{
    return view(mam_node_type_name(type()));
}

std::string_view Node::text() const noexcept
{
    if (node_ == nullptr) {
        return {};
    }
    switch (node_->type) {
    case MAM_NODE_HEADING:
        return view(node_->as.heading.text);
    case MAM_NODE_PARAGRAPH:
    case MAM_NODE_BLOCKQUOTE:
    case MAM_NODE_TEXT:
        return view(node_->as.text);
    case MAM_NODE_LINK:
        return view(node_->as.link.text);
    case MAM_NODE_IMAGE:
        return view(node_->as.image.alt);
    default:
        return {};
    }
}

unsigned Node::heading_level() const noexcept
{
    if (node_ == nullptr || node_->type != MAM_NODE_HEADING) {
        return 0U;
    }
    return node_->as.heading.level;
}

std::string_view Node::code_language() const noexcept
{
    if (node_ == nullptr || node_->type != MAM_NODE_CODE_BLOCK) {
        return {};
    }
    return view(node_->as.code_block.language);
}

std::string_view Node::code() const noexcept
{
    if (node_ == nullptr || node_->type != MAM_NODE_CODE_BLOCK) {
        return {};
    }
    return view(node_->as.code_block.code);
}

std::vector<std::string_view> Node::list_items() const
{
    if (node_ == nullptr || node_->type != MAM_NODE_LIST) {
        return {};
    }
    return views(node_->as.list.items, node_->as.list.item_count);
}

bool Node::list_is_ordered() const noexcept
{
    return node_ != nullptr && node_->type == MAM_NODE_LIST && node_->as.list.ordered;
}

std::size_t Node::line() const noexcept
{
    if (node_ == nullptr || node_->type != MAM_NODE_CODE_BLOCK) {
        return 0U;
    }
    return node_->as.code_block.location.line;
}

std::string_view Section::title() const noexcept
{
    return section_ != nullptr ? view(section_->title) : std::string_view();
}

std::vector<Node> Section::content() const
{
    std::vector<Node> result;
    if (section_ == nullptr) {
        return result;
    }
    result.reserve(section_->content_count);
    for (std::size_t i = 0; i < section_->content_count; ++i) {
        result.emplace_back(&section_->content[i]);
    }
    return result;
}

std::vector<Node> Section::code_blocks() const
{
    std::vector<Node> result;
    if (section_ == nullptr) {
        return result;
    }
    for (std::size_t i = 0; i < section_->content_count; ++i) {
        if (section_->content[i].type == MAM_NODE_CODE_BLOCK) {
            result.emplace_back(&section_->content[i]);
        }
    }
    return result;
}

std::string Section::text_content() const
{
    char *owned = mam_section_text_content(section_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::size_t Section::line() const noexcept
{
    return section_ != nullptr ? section_->location.line : 0U;
}

/* ------------------------------------------------------------------------- */
/* Module                                                                      */
/* ------------------------------------------------------------------------- */

Module::Module(std::string_view content, std::string_view file_path)
    : handle_(mam_parse_string(std::string(content).c_str(), std::string(file_path).c_str(),
                               nullptr))
{
    if (handle_ == nullptr) {
        throw_last_error("failed to parse module");
    }
}

Module Module::from_file(const std::string &path)
{
    mam_module_t *handle = mam_parse_file(path.c_str(), nullptr);
    if (handle == nullptr) {
        throw_last_error("failed to parse " + path);
    }
    return Module(handle);
}

Module Module::adopt(mam_module_t *handle) noexcept
{
    return Module(handle);
}

Module::Module(Module &&other) noexcept : handle_(other.handle_)
{
    other.handle_ = nullptr;
}

Module &Module::operator=(Module &&other) noexcept
{
    if (this != &other) {
        if (handle_ != nullptr) {
            mam_module_free(handle_);
        }
        handle_ = other.handle_;
        other.handle_ = nullptr;
    }
    return *this;
}

Module::~Module()
{
    if (handle_ != nullptr) {
        mam_module_free(handle_);
    }
}

mam_module_t *Module::release() noexcept
{
    mam_module_t *released = handle_;
    handle_ = nullptr;
    return released;
}

std::string_view Module::name() const noexcept
{
    return handle_ != nullptr ? view(mam_module_name(handle_)) : std::string_view();
}

std::string_view Module::version() const noexcept
{
    return handle_ != nullptr ? view(mam_module_version(handle_)) : std::string_view();
}

std::string_view Module::description() const noexcept
{
    return handle_ != nullptr ? view(mam_module_description(handle_)) : std::string_view();
}

std::string_view Module::file_path() const noexcept
{
    return handle_ != nullptr ? view(mam_module_file_path(handle_)) : std::string_view();
}

std::size_t Module::section_count() const noexcept
{
    return handle_ != nullptr ? handle_->section_count : 0U;
}

std::vector<Section> Module::sections() const
{
    std::vector<Section> result;
    if (handle_ == nullptr) {
        return result;
    }
    result.reserve(handle_->section_count);
    for (std::size_t i = 0; i < handle_->section_count; ++i) {
        result.emplace_back(&handle_->sections[i]);
    }
    return result;
}

Section Module::get_section(mam_section_kind_t kind) const noexcept
{
    if (handle_ == nullptr) {
        return Section();
    }
    return Section(mam_module_get_section(handle_, kind));
}

bool Module::has_section(mam_section_kind_t kind) const noexcept
{
    return handle_ != nullptr && mam_module_has_section(handle_, kind);
}

std::vector<std::string> Module::section_names() const
{
    std::vector<std::string> result;
    if (handle_ == nullptr) {
        return result;
    }
    result.reserve(handle_->section_count);
    for (std::size_t i = 0; i < handle_->section_count; ++i) {
        result.push_back(copy(handle_->sections[i].title));
    }
    return result;
}

std::size_t Module::code_block_count() const noexcept
{
    return handle_ != nullptr ? mam_module_code_block_count(handle_) : 0U;
}

std::vector<std::string> Module::code_languages() const
{
    std::vector<std::string> result;
    if (handle_ == nullptr) {
        return result;
    }
    for (const Section &section : sections()) {
        for (const Node &node : section.code_blocks()) {
            std::string language(node.code_language());
            if (language.empty()) {
                language = "unknown";
            }
            if (std::find(result.begin(), result.end(), language) == result.end()) {
                result.push_back(std::move(language));
            }
        }
    }
    return result;
}

std::string_view Module::raw_content() const noexcept
{
    return handle_ != nullptr ? view(handle_->raw_content) : std::string_view();
}

std::string Module::summary() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char *owned = mam_format_module_summary(handle_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

/* ------------------------------------------------------------------------- */
/* Validation                                                                  */
/* ------------------------------------------------------------------------- */

ValidationResult::ValidationResult(const Module &module, bool strict)
{
    if (module.get() == nullptr) {
        throw Error(MAM_ERR_INVALID_ARGUMENT, "module has been released");
    }
    mam_validation_result_t *result = mam_validation_run(module.get(), strict);
    if (result == nullptr) {
        throw_last_error("validation failed");
    }

    is_valid_ = mam_validation_is_valid(result);
    has_warnings_ = mam_validation_has_warnings(result);
    diagnostics_.reserve(result->count);
    for (std::size_t i = 0; i < result->count; ++i) {
        const mam_diagnostic_t &source = result->diagnostics[i];
        Diagnostic diagnostic;
        diagnostic.severity = source.severity;
        diagnostic.message = copy(source.message);
        diagnostic.section = copy(source.section);
        diagnostic.line = source.line;
        diagnostic.has_line = source.has_line;
        diagnostics_.push_back(std::move(diagnostic));
    }
    mam_validation_free(result);
}

std::vector<Diagnostic> ValidationResult::at(mam_severity_t severity) const
{
    std::vector<Diagnostic> result;
    for (const Diagnostic &diagnostic : diagnostics_) {
        if (diagnostic.severity == severity) {
            result.push_back(diagnostic);
        }
    }
    return result;
}

std::size_t ValidationResult::count(mam_severity_t severity) const noexcept
{
    std::size_t total = 0U;
    for (const Diagnostic &diagnostic : diagnostics_) {
        if (diagnostic.severity == severity) {
            total++;
        }
    }
    return total;
}

std::string ValidationResult::summary() const
{
    std::string result;
    const struct {
        mam_severity_t severity;
        const char *label;
    } groups[] = {{MAM_SEVERITY_ERROR, "error"},
                  {MAM_SEVERITY_WARNING, "warning"},
                  {MAM_SEVERITY_INFO, "info"}};

    for (const auto &group : groups) {
        const std::size_t total = count(group.severity);
        if (total == 0U) {
            continue;
        }
        if (!result.empty()) {
            result += ", ";
        }
        result += std::to_string(total);
        result += " ";
        result += group.label;
        if (total != 1U) {
            result += "s";
        }
    }
    return result.empty() ? std::string("no issues") : result;
}

std::string ValidationResult::report() const
{
    std::string result;
    for (const Diagnostic &diagnostic : diagnostics_) {
        result += "[";
        result += view(mam_severity_name(diagnostic.severity));
        result += "]";
        if (diagnostic.has_line) {
            result += " (line " + std::to_string(diagnostic.line) + ")";
        }
        if (!diagnostic.section.empty()) {
            result += " " + diagnostic.section + ":";
        }
        result += " " + diagnostic.message + "\n";
    }
    return result.empty() ? std::string("No issues found.") : result;
}

/* ------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* ------------------------------------------------------------------------- */

bool supports_language(std::string_view language) noexcept
{
    return mam_runtime_supports_language(std::string(language).c_str());
}

std::vector<std::pair<std::string, ExecutionResult>> execute_all(const Module &module,
                                                                 const ExecutionConfig &config)
{
    if (module.get() == nullptr) {
        throw Error(MAM_ERR_INVALID_ARGUMENT, "module has been released");
    }

    mam_runtime_config_t native;
    native.timeout_ms = config.timeout_ms;
    native.working_dir = config.working_dir.empty() ? nullptr : config.working_dir.c_str();
    native.max_output_bytes = config.max_output_bytes;
    native.skip_unsupported = config.skip_unsupported;

    std::vector<std::pair<std::string, ExecutionResult>> results;
    for (const Section &section : module.sections()) {
        for (const Node &node : section.code_blocks()) {
            std::string language(node.code_language());
            std::string body(node.code());
            mam_code_block_t block;
            std::memset(&block, 0, sizeof(block));
            block.language = const_cast<char *>(language.c_str());
            block.code = const_cast<char *>(body.c_str());

            mam_execution_result_t *outcome = mam_execute_code_block(&block, &native, nullptr);
            if (outcome == nullptr) {
                continue;
            }
            ExecutionResult entry;
            entry.exit_code = outcome->exit_code;
            entry.stdout_text = copy(mam_execution_stdout(outcome));
            entry.stderr_text = copy(mam_execution_stderr(outcome));
            entry.duration_ms = outcome->duration_ms;
            entry.language = copy(outcome->language);
            results.emplace_back(std::string(section.title()), std::move(entry));
            mam_execution_free(outcome);
        }
    }
    return results;
}

/* ------------------------------------------------------------------------- */
/* Cache                                                                       */
/* ------------------------------------------------------------------------- */

Cache::Cache(unsigned long ttl_seconds) : handle_(mam_cache_new(ttl_seconds))
{
    if (handle_ == nullptr) {
        throw_last_error("could not create cache");
    }
}

Cache::~Cache()
{
    if (handle_ != nullptr) {
        mam_cache_free(handle_);
    }
}

Cache::Cache(Cache &&other) noexcept : handle_(other.handle_)
{
    other.handle_ = nullptr;
}

Cache &Cache::operator=(Cache &&other) noexcept
{
    if (this != &other) {
        if (handle_ != nullptr) {
            mam_cache_free(handle_);
        }
        handle_ = other.handle_;
        other.handle_ = nullptr;
    }
    return *this;
}

bool Cache::set(std::string_view key, std::string_view value)
{
    return handle_ != nullptr && mam_cache_set(handle_, std::string(key).c_str(),
                                              std::string(value).c_str());
}

std::optional<std::string> Cache::get(std::string_view key)
{
    if (handle_ == nullptr) {
        return std::nullopt;
    }
    const char *found = mam_cache_get(handle_, std::string(key).c_str());
    if (found == nullptr) {
        return std::nullopt;
    }
    return std::string(found);
}

bool Cache::has(std::string_view key) const
{
    return handle_ != nullptr && mam_cache_has(handle_, std::string(key).c_str());
}

bool Cache::erase(std::string_view key)
{
    return handle_ != nullptr && mam_cache_delete(handle_, std::string(key).c_str());
}

void Cache::clear() noexcept
{
    if (handle_ != nullptr) {
        mam_cache_clear(handle_);
    }
}

std::size_t Cache::prune() noexcept
{
    return handle_ != nullptr ? mam_cache_prune(handle_) : 0U;
}

std::size_t Cache::size() const noexcept
{
    return handle_ != nullptr ? mam_cache_size(handle_) : 0U;
}

double Cache::hit_rate() const noexcept
{
    return handle_ != nullptr ? mam_cache_hit_rate(handle_) : 0.0;
}

std::string Cache::stats() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char *owned = mam_format_cache_stats(handle_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

/* ------------------------------------------------------------------------- */
/* Graph                                                                       */
/* ------------------------------------------------------------------------- */

Graph::Graph(const Module &module) : handle_(mam_graph_build(module.get()))
{
    if (handle_ == nullptr) {
        throw_last_error("could not build graph");
    }
}

Graph::~Graph()
{
    if (handle_ != nullptr) {
        mam_graph_free(handle_);
    }
}

Graph::Graph(Graph &&other) noexcept : handle_(other.handle_)
{
    other.handle_ = nullptr;
}

Graph &Graph::operator=(Graph &&other) noexcept
{
    if (this != &other) {
        if (handle_ != nullptr) {
            mam_graph_free(handle_);
        }
        handle_ = other.handle_;
        other.handle_ = nullptr;
    }
    return *this;
}

std::vector<std::string> Graph::node_names() const
{
    std::vector<std::string> result;
    if (handle_ == nullptr) {
        return result;
    }
    result.reserve(handle_->node_count);
    for (std::size_t i = 0; i < handle_->node_count; ++i) {
        result.push_back(copy(handle_->nodes[i].name));
    }
    return result;
}

std::vector<std::string> Graph::successors(std::string_view name) const
{
    if (handle_ == nullptr) {
        return {};
    }
    std::size_t count = 0U;
    char **found = mam_graph_successors(handle_, std::string(name).c_str(), &count);
    std::vector<std::string> result = collect(found, count);
    mam_free_string_array(found, count);
    return result;
}

std::vector<std::string> Graph::predecessors(std::string_view name) const
{
    if (handle_ == nullptr) {
        return {};
    }
    std::size_t count = 0U;
    char **found = mam_graph_predecessors(handle_, std::string(name).c_str(), &count);
    std::vector<std::string> result = collect(found, count);
    mam_free_string_array(found, count);
    return result;
}

bool Graph::has_edge(std::string_view source, std::string_view target) const noexcept
{
    if (handle_ == nullptr) {
        return false;
    }
    const std::string from(source);
    const std::string to(target);
    return mam_graph_has_edge(handle_, from.c_str(), to.c_str());
}

std::vector<std::string> Graph::topological_order() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char **order = nullptr;
    const std::size_t count = mam_graph_topological_sort(handle_, &order);
    std::vector<std::string> result = collect(order, count);
    mam_free_string_array(order, count);
    return result;
}

std::string Graph::summary() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char *owned = mam_graph_summary(handle_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::string Graph::to_text() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char *owned = mam_graph_to_text(handle_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

/* ------------------------------------------------------------------------- */
/* Config                                                                      */
/* ------------------------------------------------------------------------- */

Config Config::defaults()
{
    mam_config_t *handle = mam_config_default();
    if (handle == nullptr) {
        throw_last_error("could not create default config");
    }
    return Config(handle);
}

Config Config::from_json(std::string_view json)
{
    mam_config_t *handle = mam_config_from_json(std::string(json).c_str());
    if (handle == nullptr) {
        throw_last_error("could not parse config json");
    }
    return Config(handle);
}

Config Config::load(const std::string &path)
{
    mam_config_t *handle = mam_config_load(path.c_str());
    if (handle == nullptr) {
        throw_last_error("could not load config");
    }
    return Config(handle);
}

std::vector<std::string> Config::targets()
{
    std::size_t count = 0U;
    char **found = mam_config_list_targets(&count);
    std::vector<std::string> result = collect(found, count);
    mam_free_string_array(found, count);
    return result;
}

bool Config::is_supported_target(std::string_view target)
{
    return mam_config_is_supported_target(std::string(target).c_str());
}

Config::~Config()
{
    if (handle_ != nullptr) {
        mam_config_free(handle_);
    }
}

Config::Config(Config &&other) noexcept : handle_(other.handle_)
{
    other.handle_ = nullptr;
}

Config &Config::operator=(Config &&other) noexcept
{
    if (this != &other) {
        if (handle_ != nullptr) {
            mam_config_free(handle_);
        }
        handle_ = other.handle_;
        other.handle_ = nullptr;
    }
    return *this;
}

std::string_view Config::version() const noexcept
{
    return handle_ != nullptr ? view(handle_->version) : std::string_view();
}

std::string_view Config::work_dir() const noexcept
{
    return handle_ != nullptr ? view(handle_->work_dir) : std::string_view();
}

std::string_view Config::target() const noexcept
{
    return handle_ != nullptr ? view(handle_->target) : std::string_view();
}

bool Config::verbose() const noexcept
{
    return handle_ != nullptr && handle_->verbose;
}

std::vector<std::string> Config::validate() const
{
    if (handle_ == nullptr) {
        return {};
    }
    char **problems = nullptr;
    const std::size_t count = mam_config_validate(handle_, &problems);
    std::vector<std::string> result = collect(problems, count);
    mam_free_string_array(problems, count);
    return result;
}

Config Config::merged_with(const Config &other) const
{
    mam_config_t *merged = mam_config_merge(handle_, other.handle_);
    if (merged == nullptr) {
        throw_last_error("could not merge configs");
    }
    return Config(merged);
}

std::string Config::to_json() const
{
    if (handle_ == nullptr) {
        return "{}";
    }
    char *owned = mam_config_to_json(handle_);
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

/* ------------------------------------------------------------------------- */
/* Templates                                                                   */
/* ------------------------------------------------------------------------- */

namespace template_ {

std::vector<std::string> kinds()
{
    std::size_t count = 0U;
    char **found = mam_template_list_kinds(&count);
    std::vector<std::string> result = collect(found, count);
    mam_free_string_array(found, count);
    return result;
}

std::string get(std::string_view kind)
{
    char *owned = mam_template_get(std::string(kind).c_str());
    if (owned == nullptr) {
        throw_last_error("unknown starter kind");
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::string new_module(std::string_view name, std::string_view kind, std::string_view runtime)
{
    const std::string name_copy(name);
    const std::string kind_copy(kind);
    const std::string runtime_copy(runtime);
    char *owned = mam_template_new_module(name_copy.c_str(), kind_copy.c_str(),
                                          runtime_copy.c_str());
    if (owned == nullptr) {
        throw_last_error("could not render starter");
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::vector<std::string> validate_name(std::string_view name)
{
    const std::string name_copy(name);
    std::size_t count = 0U;
    char **problems = mam_template_validate_name(name_copy.c_str(), &count);
    std::vector<std::string> result = collect(problems, count);
    mam_free_string_array(problems, count);
    return result;
}

std::string slugify(std::string_view name)
{
    const std::string name_copy(name);
    char *owned = mam_template_slugify(name_copy.c_str());
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

}  // namespace template_

/* ------------------------------------------------------------------------- */
/* Doctor                                                                      */
/* ------------------------------------------------------------------------- */

bool DoctorReport::ok() const noexcept
{
    return status() != MAM_CHECK_FAIL;
}

mam_check_status_t DoctorReport::status() const noexcept
{
    mam_check_status_t worst = MAM_CHECK_OK;
    for (const Check &check : checks) {
        if (check.status == MAM_CHECK_FAIL) {
            return MAM_CHECK_FAIL;
        }
        if (check.status == MAM_CHECK_WARN) {
            worst = MAM_CHECK_WARN;
        }
    }
    return worst;
}

std::string DoctorReport::format() const
{
    if (checks.empty()) {
        return "No diagnostics were run.";
    }
    std::size_t width = 0U;
    for (const Check &check : checks) {
        width = std::max(width, check.name.size());
    }

    std::string result = "MAM SDK diagnostics: ";
    result += view(mam_check_status_name(status()));
    result += "\n";
    for (const Check &check : checks) {
        result += "[";
        result += view(mam_check_status_name(check.status));
        result += "] ";
        result += check.name;
        result.append(width - check.name.size(), ' ');
        result += "  ";
        result += check.message;
        result += "\n";
    }
    result += std::to_string(checks.size());
    result += " checks\n";
    return result;
}

DoctorReport doctor()
{
    mam_doctor_report_t *report = mam_doctor_run(nullptr);
    if (report == nullptr) {
        throw_last_error("doctor failed");
    }
    DoctorReport result;
    result.checks.reserve(report->count);
    for (std::size_t i = 0; i < report->count; ++i) {
        Check check;
        check.name = copy(report->checks[i].name);
        check.status = report->checks[i].status;
        check.message = copy(report->checks[i].message);
        result.checks.push_back(std::move(check));
    }
    mam_doctor_report_free(report);
    return result;
}

bool command_exists(std::string_view command)
{
    return mam_doctor_command_exists(std::string(command).c_str());
}

/* ------------------------------------------------------------------------- */
/* Free functions                                                              */
/* ------------------------------------------------------------------------- */

std::string_view user_agent() noexcept
{
    return view(mam_user_agent());
}

std::string_view version() noexcept
{
    return view(mam_version());
}

std::string_view section_kind_name(mam_section_kind_t kind) noexcept
{
    return view(mam_section_kind_name(kind));
}

mam_section_kind_t section_kind_from_string(std::string_view name) noexcept
{
    const std::string copy(name);
    return mam_section_kind_from_string(copy.c_str());
}

bool section_kind_is_standard(mam_section_kind_t kind) noexcept
{
    return mam_section_kind_is_standard(kind);
}

std::string format_section_list(const Module &module)
{
    char *owned = mam_format_section_list(module.get());
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::string format_code_block_list(const Module &module)
{
    char *owned = mam_format_code_block_list(module.get());
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::string format_front_matter(const Module &module)
{
    char *owned = mam_format_front_matter(module.get());
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

std::string format_toc(const Module &module)
{
    char *owned = mam_format_toc(module.get());
    if (owned == nullptr) {
        return {};
    }
    std::string result(owned);
    std::free(owned);
    return result;
}

}  // namespace mam
