/**
 * @file mam.hpp
 * @brief C++17 RAII wrapper over the MAM C SDK.
 *
 * This is a thin, idiomatic C++ layer: every C object is owned by a
 * `std::unique_ptr` with the matching C deleter, and every C string is exposed
 * as a `std::string_view` that borrows from the C object, or a `std::string`
 * when a copy is wanted. No C type escapes into a public signature, so there is
 * nothing for a caller to get wrong.
 *
 * Ownership mapping:
 *   - `Module`, `ValidationResult`, `ExecutionResult`, `Config`, `Cache`,
 *     `Graph`, `DoctorReport` are value types that own their C counterpart and
 *     free it in their destructor. They are move-only, since aliasing an owned
 *     C pointer would double-free.
 *   - `string_view` results borrow from the owning object and are invalidated by
 *     its destruction. `to_string()` is provided when the value must outlive it.
 *
 * The header is self-contained and includes the C headers it wraps.
 */

#ifndef MAM_CPP_MAM_HPP
#define MAM_CPP_MAM_HPP

#include <cstddef>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

extern "C" {
#include "mam/mam.h"
#include "mam/support.h"
}

namespace mam {

/* ------------------------------------------------------------------------- */
/* Error translation                                                           */
/* ------------------------------------------------------------------------- */

/** Thrown when a C call reports a failure status. */
class Error : public std::runtime_error {
public:
    /**
     * Builds an error from a C status.
     *
     * @param status The failing status code.
     * @param detail Extra context, typically the file or section involved.
     */
    Error(mam_status_t status, const std::string &detail);

    /** Returns the underlying C status code. */
    mam_status_t status() const noexcept { return status_; }

private:
    mam_status_t status_;
};

/** Throws when @p status is not MAM_OK. */
void check(mam_status_t status, const std::string &detail);

/** Copies the thread-local last error into an exception, or returns normally. */
[[noreturn]] void throw_last_error(const std::string &detail);

/* ------------------------------------------------------------------------- */
/* Front matter                                                                */
/* ------------------------------------------------------------------------- */

/** A borrowed view of a C front matter block. */
class FrontMatter {
public:
    FrontMatter() noexcept = default;
    explicit FrontMatter(const mam_frontmatter_t *fm) noexcept : fm_(fm) {}

    /** Returns the declared name, or an empty view. */
    std::string_view name() const noexcept;

    /** Returns the declared version, or an empty view. */
    std::string_view version() const noexcept;

    /** Returns the declared description, or an empty view. */
    std::string_view description() const noexcept;

    /** Returns the declared runtime, or an empty view. */
    std::string_view runtime() const noexcept;

    /** Returns the declared license, or an empty view. */
    std::string_view license() const noexcept;

    /** Returns the declared schema version, or an empty view. */
    std::string_view schema_version() const noexcept;

    /** Returns the authors as borrowed views. */
    std::vector<std::string_view> authors() const;

    /** Returns the tags as borrowed views. */
    std::vector<std::string_view> tags() const;

    /** Returns the dependencies as borrowed views. */
    std::vector<std::string_view> dependencies() const;

private:
    const mam_frontmatter_t *fm_ = nullptr;
};

/* ------------------------------------------------------------------------- */
/* Nodes and sections                                                           */
/* ------------------------------------------------------------------------- */

/** A borrowed view of one content node. */
class Node {
public:
    Node() noexcept = default;
    explicit Node(const mam_node_t *node) noexcept : node_(node) {}

    /** Returns the node kind. */
    mam_node_type_t type() const noexcept { return node_ != nullptr ? node_->type : MAM_NODE_TEXT; }

    /** Returns the printable name of the node kind. */
    std::string_view type_name() const noexcept;

    /** Returns the node's text payload, or an empty view. */
    std::string_view text() const noexcept;

    /** Returns the heading level, or 0 when this is not a heading. */
    unsigned heading_level() const noexcept;

    /** Returns the code block's language, or an empty view. */
    std::string_view code_language() const noexcept;

    /** Returns the code block's body, or an empty view. */
    std::string_view code() const noexcept;

    /** Returns the list items, or an empty vector. */
    std::vector<std::string_view> list_items() const;

    /** Returns true when the node is a list and it is ordered. */
    bool list_is_ordered() const noexcept;

    /** Returns the 1-based line the node started on, or 0. */
    std::size_t line() const noexcept;

private:
    const mam_node_t *node_ = nullptr;
};

/** A borrowed view of one section. */
class Section {
public:
    Section() noexcept = default;
    explicit Section(const mam_section_t *section) noexcept : section_(section) {}

    /** Returns the section kind. */
    mam_section_kind_t kind() const noexcept { return section_ != nullptr ? section_->kind
                                                                        : MAM_SECTION_CUSTOM; }

    /** Returns the section's heading text. */
    std::string_view title() const noexcept;

    /** Returns the section's content nodes as borrowed views. */
    std::vector<Node> content() const;

    /** Returns only the code blocks in this section. */
    std::vector<Node> code_blocks() const;

    /** Returns the concatenated text content, owned by the caller. */
    std::string text_content() const;

    /** Returns the 1-based line the section started on, or 0. */
    std::size_t line() const noexcept;

private:
    const mam_section_t *section_ = nullptr;
};

/* ------------------------------------------------------------------------- */
/* Module                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * An owned MAM module.
 *
 * Move-only: copying would double-free the underlying `mam_module_t`.
 */
class Module {
public:
    /** Parses a document held in a string. Throws on failure. */
    explicit Module(std::string_view content, std::string_view file_path = "<memory>");

    /** Parses a document from disk. Throws when the file cannot be read. */
    static Module from_file(const std::string &path);

    /** Adopts an already-parsed module. Takes ownership of @p handle. */
    static Module adopt(mam_module_t *handle) noexcept;

    Module(Module &&other) noexcept;
    Module &operator=(Module &&other) noexcept;
    ~Module();

    Module(const Module &) = delete;
    Module &operator=(const Module &) = delete;

    /** Releases ownership back to a raw pointer the caller must free. */
    mam_module_t *release() noexcept;

    /** Returns the underlying handle, or nullptr once released. */
    const mam_module_t *get() const noexcept { return handle_; }

    /** Returns the module's name, falling back to the file path. */
    std::string_view name() const noexcept;

    /** Returns the declared version, or an empty view. */
    std::string_view version() const noexcept;

    /** Returns the declared description, or an empty view. */
    std::string_view description() const noexcept;

    /** Returns the originating file path. */
    std::string_view file_path() const noexcept;

    /** Returns the front matter. */
    FrontMatter frontmatter() const noexcept { return FrontMatter(&handle_->frontmatter); }

    /** Returns the number of sections. */
    std::size_t section_count() const noexcept;

    /** Returns every section as a borrowed view. */
    std::vector<Section> sections() const;

    /** Returns the first section of the given kind, or a default Section. */
    Section get_section(mam_section_kind_t kind) const noexcept;

    /** Returns true when a section of the given kind exists. */
    bool has_section(mam_section_kind_t kind) const noexcept;

    /** Returns the section titles in document order, as owned strings. */
    std::vector<std::string> section_names() const;

    /** Returns the total number of code blocks. */
    std::size_t code_block_count() const noexcept;

    /** Returns the distinct code block languages, in first-seen order. */
    std::vector<std::string> code_languages() const;

    /** Returns the raw document text. */
    std::string_view raw_content() const noexcept;

    /** Returns a one-line summary, owned by the caller. */
    std::string summary() const;

private:
    explicit Module(mam_module_t *handle) noexcept : handle_(handle) {}

    mam_module_t *handle_ = nullptr;
};

/* ------------------------------------------------------------------------- */
/* Validation                                                                  */
/* ------------------------------------------------------------------------- */

/** A single validation finding, copied out of the C result. */
struct Diagnostic {
    /** Severity of the finding. */
    mam_severity_t severity;
    /** Human-readable message, owned. */
    std::string message;
    /** Section the finding belongs to, empty when unattributed. */
    std::string section;
    /** 1-based line, or 0 when unknown. */
    std::size_t line;
    /** True when `line` is meaningful. */
    bool has_line;
};

/**
 * The outcome of validating a module.
 *
 * Findings are copied into C++ containers at construction, so the result stays
 * valid after the module is destroyed.
 */
class ValidationResult {
public:
    /** Validates @p module. @p strict upgrades the required-field set. */
    explicit ValidationResult(const Module &module, bool strict = false);

    /** Returns true when no finding reached error severity. */
    bool is_valid() const noexcept { return is_valid_; }

    /** Returns every finding in order. */
    const std::vector<Diagnostic> &diagnostics() const noexcept { return diagnostics_; }

    /** Returns the findings at exactly @p severity. */
    std::vector<Diagnostic> at(mam_severity_t severity) const;

    /** Returns the count of findings at exactly @p severity. */
    std::size_t count(mam_severity_t severity) const noexcept;

    /** Returns true when any finding is at least a warning. */
    bool has_warnings() const noexcept { return has_warnings_; }

    /** Returns a one-line count summary, owned by the caller. */
    std::string summary() const;

    /** Renders the findings as text, owned by the caller. */
    std::string report() const;

private:
    std::vector<Diagnostic> diagnostics_;
    bool is_valid_ = true;
    bool has_warnings_ = false;
};

/* ------------------------------------------------------------------------- */
/* Runtime                                                                     */
/* ------------------------------------------------------------------------- */

/** Execution settings. */
struct ExecutionConfig {
    /** Wall clock budget in milliseconds. */
    unsigned long timeout_ms = 30000UL;
    /** Working directory for the child, empty to inherit. */
    std::string working_dir;
    /** Maximum captured output bytes. */
    std::size_t max_output_bytes = 1024UL * 1024UL;
    /** Skip blocks whose language has no interpreter. */
    bool skip_unsupported = true;
};

/** The outcome of running one code block. */
struct ExecutionResult {
    /** Process exit status. */
    int exit_code = -1;
    /** Captured standard output, owned. */
    std::string stdout_text;
    /** Captured standard error, owned. */
    std::string stderr_text;
    /** Wall clock duration in milliseconds. */
    unsigned long duration_ms = 0UL;
    /** The language that was executed. */
    std::string language;

    /** Returns true when the block exited zero. */
    bool success() const noexcept { return exit_code == 0; }
};

/** Returns true when the runtime has an interpreter for @p language. */
bool supports_language(std::string_view language) noexcept;

/** Runs every code block in @p module, keyed by section title. */
std::vector<std::pair<std::string, ExecutionResult>> execute_all(const Module &module,
                                                                 const ExecutionConfig &config = {});

/* ------------------------------------------------------------------------- */
/* Support modules                                                             */
/* ------------------------------------------------------------------------- */

/** A TTL cache of strings. */
class Cache {
public:
    /** Creates a cache whose entries live @p ttl_seconds by default. */
    explicit Cache(unsigned long ttl_seconds = 300UL);

    ~Cache();
    Cache(Cache &&) noexcept;
    Cache &operator=(Cache &&) noexcept;
    Cache(const Cache &) = delete;
    Cache &operator=(const Cache &) = delete;

    /** Stores a value. Returns false when the key is unusable. */
    bool set(std::string_view key, std::string_view value);

    /** Returns the cached value, or an empty optional on a miss. */
    std::optional<std::string> get(std::string_view key);

    /** Returns true when a live entry exists. */
    bool has(std::string_view key) const;

    /** Removes a key. Returns true when one was removed. */
    bool erase(std::string_view key);

    /** Removes every entry, keeping cumulative counters. */
    void clear() noexcept;

    /** Removes expired entries and returns how many went. */
    std::size_t prune() noexcept;

    /** Returns the number of entries held. */
    std::size_t size() const noexcept;

    /** Returns the hit rate as a fraction between 0.0 and 1.0. */
    double hit_rate() const noexcept;

    /** Renders the counters as one line, owned by the caller. */
    std::string stats() const;

private:
    mam_cache_t *handle_ = nullptr;
};

/** A structural graph over a module. */
class Graph {
public:
    /** Builds the graph of @p module. */
    explicit Graph(const Module &module);

    ~Graph();
    Graph(Graph &&) noexcept;
    Graph &operator=(Graph &&) noexcept;
    Graph(const Graph &) = delete;
    Graph &operator=(const Graph &) = delete;

    /** Returns the node names in creation order. */
    std::vector<std::string> node_names() const;

    /** Returns the direct successors of @p name. */
    std::vector<std::string> successors(std::string_view name) const;

    /** Returns the direct predecessors of @p name. */
    std::vector<std::string> predecessors(std::string_view name) const;

    /** Returns true when an edge connects the two nodes. */
    bool has_edge(std::string_view source, std::string_view target) const noexcept;

    /** Orders nodes so dependencies precede dependents; empty on a cycle. */
    std::vector<std::string> topological_order() const;

    /** Returns a one-line summary, owned by the caller. */
    std::string summary() const;

    /** Renders the graph as indented text, owned by the caller. */
    std::string to_text() const;

private:
    explicit Graph(mam_graph_t *handle) noexcept : handle_(handle) {}

    mam_graph_t *handle_ = nullptr;
};

/** SDK configuration. */
class Config {
public:
    /** Returns a configuration populated with the SDK defaults. */
    static Config defaults();

    /** Parses a configuration from JSON text. */
    static Config from_json(std::string_view json);

    /** Loads a configuration from disk, or the defaults when absent. */
    static Config load(const std::string &path);

    /** Returns the supported target names, sorted. */
    static std::vector<std::string> targets();

    /** Returns true when @p target is supported, aliases included. */
    static bool is_supported_target(std::string_view target);

    ~Config();
    Config(Config &&) noexcept;
    Config &operator=(Config &&) noexcept;
    Config(const Config &) = delete;
    Config &operator=(const Config &) = delete;

    /** Returns the schema version. */
    std::string_view version() const noexcept;

    /** Returns the working directory. */
    std::string_view work_dir() const noexcept;

    /** Returns the execution target. */
    std::string_view target() const noexcept;

    /** Returns the verbosity flag. */
    bool verbose() const noexcept;

    /** Returns every validation problem; empty means valid. */
    std::vector<std::string> validate() const;

    /** Overlays @p other on top of this configuration. */
    Config merged_with(const Config &other) const;

    /** Serialises to JSON, owned by the caller. */
    std::string to_json() const;

private:
    explicit Config(mam_config_t *handle) noexcept : handle_(handle) {}

    mam_config_t *handle_ = nullptr;
};

/** A starter module template. */
namespace template_ {

/** Returns the canonical starter kinds, sorted. */
std::vector<std::string> kinds();

/** Returns the raw template text for @p kind or an alias. */
std::string get(std::string_view kind);

/** Renders a complete starter module. */
std::string new_module(std::string_view name, std::string_view kind = "module",
                       std::string_view runtime = "python");

/** Returns every problem with @p name; empty means acceptable. */
std::vector<std::string> validate_name(std::string_view name);

/** Returns a lowercase dash-separated slug of @p name. */
std::string slugify(std::string_view name);

}  // namespace template_

/** One environment self-check result. */
struct Check {
    /** Check identifier. */
    std::string name;
    /** Outcome. */
    mam_check_status_t status;
    /** Human-readable detail, owned. */
    std::string message;
};

/** The aggregate environment report. */
struct DoctorReport {
    /** Every check that ran, in order. */
    std::vector<Check> checks;

    /** Returns true when nothing failed. */
    bool ok() const noexcept;

    /** Returns the worst status across the checks. */
    mam_check_status_t status() const noexcept;

    /** Renders the report as text, owned by the caller. */
    std::string format() const;
};

/** Runs the environment probes. Probes never execute anything. */
DoctorReport doctor();

/** Returns true when a command resolves on PATH. */
bool command_exists(std::string_view command);

/* ------------------------------------------------------------------------- */
/* Free functions                                                               */
/* ------------------------------------------------------------------------- */

/** Returns the SDK identifier, for example `mam-cpp/0.1.0`. */
std::string_view user_agent() noexcept;

/** Returns the SDK version. */
std::string_view version() noexcept;

/** Returns the printable name of a section kind. */
std::string_view section_kind_name(mam_section_kind_t kind) noexcept;

/** Maps a heading name to a section kind; unknown input is Custom. */
mam_section_kind_t section_kind_from_string(std::string_view name) noexcept;

/** Returns true when @p kind is one of the 19 standard kinds. */
bool section_kind_is_standard(mam_section_kind_t kind) noexcept;

/** Formats a module as a section list, owned by the caller. */
std::string format_section_list(const Module &module);

/** Formats a module's code blocks, owned by the caller. */
std::string format_code_block_list(const Module &module);

/** Formats a module's front matter, owned by the caller. */
std::string format_front_matter(const Module &module);

/** Formats a module as a table of contents, owned by the caller. */
std::string format_toc(const Module &module);

}  // namespace mam

#endif  // MAM_CPP_MAM_HPP
