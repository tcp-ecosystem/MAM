/**
 * @file test_mam.cpp
 * @brief C++ wrapper test suite.
 *
 * Built on a tiny assertion harness rather than a framework, matching the C
 * SDK's approach so the two suites stay comparable and dependency free. The
 * suite deliberately exercises move semantics, because a mistake in the
 * hand-written move assignment is the most likely way this wrapper leaks or
 * double-frees.
 */

#include "mam/mam.hpp"

#include <cstdio>
#include <string>

namespace {

int g_failures = 0;
int g_checks = 0;

void report(const char *name, bool passed)
{
    ++g_checks;
    if (passed) {
        std::printf("  ok   %s\n", name);
        return;
    }
    ++g_failures;
    std::printf("  FAIL %s\n", name);
}

int suite_result(const char *name)
{
    std::printf("%s: %d checks, %d failures\n", name, g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}

const char *const kFullModule =
    "---\n"
    "name: Cpp Module\n"
    "version: 2.0.0\n"
    "author: Tester\n"
    "runtime: python\n"
    "description: A module used by the C++ tests.\n"
    "tags:\n"
    "  - utility\n"
    "dependencies:\n"
    "  - pip:requests\n"
    "---\n"
    "\n"
    "## Purpose\n"
    "\n"
    "Does useful things for the C++ suite.\n"
    "\n"
    "## Rules\n"
    "\n"
    "- Be deterministic.\n"
    "- Never mutate the input.\n"
    "\n"
    "## Python\n"
    "\n"
    "```python\n"
    "def process(payload):\n"
    "    return payload\n"
    "```\n"
    "\n"
    "### A subsection\n"
    "\n"
    "- first\n"
    "- second\n"
    "\n"
    "> a quoted line\n";

}  // namespace

static void test_parsing()
{
    mam::Module module(kFullModule, "cpp.mam.md");
    report("parses a full document", module.section_count() == 4U);
    report("name is exposed", module.name() == "Cpp Module");
    report("version is exposed", module.version() == "2.0.0");
    report("description is exposed", module.description().size() > 0U);
    report("file path is exposed", module.file_path() == "cpp.mam.md");
    report("raw content is retained", module.raw_content().find("## Purpose") != std::string_view::npos);
    report("section names are collected", module.section_names().size() == 4U);
    report("has_section works", module.has_section(mam::MAM_SECTION_PURPOSE));
    report("has_section is false when absent", !module.has_section(mam::MAM_SECTION_MERMAID));
    report("code blocks are counted", module.code_block_count() == 1U);
    report("code languages are collected",
           module.code_languages().size() == 1U && module.code_languages()[0] == "python");
    report("summary is owned and non-empty", !module.summary().empty());
}

static void test_frontmatter_and_nodes()
{
    mam::Module module(kFullModule, "cpp.mam.md");
    const mam::FrontMatter fm = module.frontmatter();
    report("front matter name", fm.name() == "Cpp Module");
    report("front matter version", fm.version() == "2.0.0");
    report("front matter runtime", fm.runtime() == "python");
    report("front matter tags", fm.tags().size() == 1U);
    report("front matter dependencies", fm.dependencies().size() == 1U);
    report("absent fields are empty views", fm.license().empty());

    const mam::Section purpose = module.get_section(mam::MAM_SECTION_PURPOSE);
    report("purpose section found", purpose.kind() == mam::MAM_SECTION_PURPOSE);
    report("section title", purpose.title() == "Purpose");
    report("section has content", !purpose.content().empty());
    report("purpose has no code blocks", purpose.code_blocks().empty());
    report("text content is joined", purpose.text_content().find("useful things") != std::string::npos);

    const mam::Section rules = module.get_section(mam::MAM_SECTION_RULES);
    std::size_t headings = 0U;
    std::size_t lists = 0U;
    std::size_t quotes = 0U;
    std::size_t list_items = 0U;
    for (const mam::Node &node : rules.content()) {
        switch (node.type()) {
        case mam::MAM_NODE_HEADING:
            ++headings;
            report("heading level is read", node.heading_level() == 3U);
            report("heading text is read", node.text() == "A subsection");
            break;
        case mam::MAM_NODE_LIST:
            ++lists;
            list_items = node.list_items().size();
            report("list reports ordered", !node.list_is_ordered());
            break;
        case mam::MAM_NODE_BLOCKQUOTE:
            ++quotes;
            report("blockquote text is read", node.text() == "a quoted line");
            break;
        default:
            break;
        }
    }
    report("one heading was parsed", headings == 1U);
    report("one list was parsed", lists == 1U);
    report("one blockquote was parsed", quotes == 1U);
    report("list items are exposed", list_items == 2U);

    const mam::Section python = module.get_section(mam::MAM_SECTION_PYTHON);
    report("python section has one block", python.code_blocks().size() == 1U);
    if (!python.code_blocks().empty()) {
        const mam::Node block = python.code_blocks()[0];
        report("block language", block.code_language() == "python");
        report("block body", block.code().find("def process") != std::string_view::npos);
        report("block line is recorded", block.line() > 0U);
    }
}

static void test_validation()
{
    mam::Module module(kFullModule, "cpp.mam.md");
    const mam::ValidationResult good(module, false);
    report("a complete module is valid", good.is_valid());
    report("a complete module has no errors", good.count(mam::MAM_SEVERITY_ERROR) == 0U);
    report("summary reports no issues", good.summary() == "no issues");
    report("report is populated", !good.report().empty());
    report("at() filters by severity", good.at(mam::MAM_SEVERITY_ERROR).empty());

    mam::Module broken("---\nversion: 2.0.0\n---\n\n## Rules\n\nx\n", "broken.mam.md");
    const mam::ValidationResult bad(broken, true);
    report("a module without a name is invalid", !bad.is_valid());
    report("errors are reported", bad.count(mam::MAM_SEVERITY_ERROR) >= 1U);
    report("summary counts errors", bad.summary().find("error") != std::string::npos);
    report("warnings are considered", !bad.has_warnings() || bad.count(mam::MAM_SEVERITY_WARNING) > 0U);
}

static void test_move_semantics()
{
    mam::Module first(kFullModule, "a.mam.md");
    const std::size_t sections = first.section_count();
    mam::Module second(std::move(first));
    report("move transfers the section count", second.section_count() == sections);
    report("moved-from module is released", first.get() == nullptr);
    report("moved-from module reports zero sections", first.section_count() == 0U);
    report("moved-from name is empty", first.name().empty());

    mam::Module assigned(kFullModule, "b.mam.md");
    mam::Module target(kFullModule, "c.mam.md");
    target = std::move(assigned);
    report("move assignment works", target.get() != nullptr && assigned.get() == nullptr);
    report("self move assignment is safe", (target = target, target.get() != nullptr));
}

static void test_support_modules()
{
    mam::Cache cache(60UL);
    report("cache accepts a set", cache.set("a", "one"));
    const std::optional<std::string> hit = cache.get("a");
    report("cache returns a hit", hit.has_value() && *hit == "one");
    report("cache reports presence", cache.has("a"));
    const std::optional<std::string> miss = cache.get("nope");
    report("cache returns a miss", !miss.has_value());
    report("cache erases", cache.erase("a") && !cache.erase("a"));
    cache.set("b", "two");
    cache.get("b");
    report("cache counts entries", cache.size() == 1U);
    report("cache hit rate is a fraction", cache.hit_rate() >= 0.0 && cache.hit_rate() <= 1.0);
    report("cache stats render", !cache.stats().empty());
    cache.clear();
    report("cache clears", cache.size() == 0U);
    report("cache prune is safe", cache.prune() == 0U);

    mam::Module module(kFullModule, "graph.mam.md");
    mam::Graph graph(module);
    report("graph builds", !graph.node_names().empty());
    report("front matter is a node", graph.node_names().front() == "frontmatter");
    report("front matter has successors", !graph.successors("frontmatter").empty());
    report("front matter has no predecessors", graph.predecessors("frontmatter").empty());
    report("edge exists", graph.has_edge("frontmatter", "Purpose"));
    const std::vector<std::string> order = graph.topological_order();
    report("graph sorts", order.size() == graph.node_names().size());
    report("front matter sorts first", !order.empty() && order.front() == "frontmatter");
    report("graph summary renders", graph.summary().find("nodes") != std::string::npos);
    report("graph text renders", graph.to_text().find("frontmatter") != std::string::npos);
}

static void test_config_and_templates()
{
    const mam::Config defaults = mam::Config::defaults();
    report("default target is python", defaults.target() == "python");
    report("default config is valid", defaults.validate().empty());
    report("targets are listed", mam::Config::targets().size() == 7U);
    report("aliases are supported", mam::Config::is_supported_target("py"));
    report("unknown targets are rejected", !mam::Config::is_supported_target("cobol"));

    const mam::Config round_trip = mam::Config::from_json(defaults.to_json());
    report("config round trips", round_trip.target() == "python");
    report("config keeps its version", round_trip.version() == "1.0.0");
    report("merge produces a config", defaults.merged_with(round_trip).validate().empty());

    bool threw = false;
    try {
        (void)mam::Config::from_json("[1,2,3]");
    } catch (const mam::Error &) {
        threw = true;
    }
    report("malformed config throws", threw);

    report("starter kinds are offered", mam::template_::kinds().size() == 3U);
    report("module template renders", mam::template_::get("module").find("{{name}}") != std::string::npos);
    report("agent alias resolves", !mam::template_::get("bot").empty());
    report("slugify works", mam::template_::slugify("My Module") == "my-module");
    report("good names validate", mam::template_::validate_name("Good Name").empty());
    report("bad names are reported", !mam::template_::validate_name("bad/name").empty());

    const std::string starter = mam::template_::new_module("demo", "module", "python");
    report("starter renders", starter.find("name: demo") != std::string::npos);
    report("starter has no placeholders left", starter.find("{{") == std::string::npos);

    threw = false;
    try {
        (void)mam::template_::new_module("  ", "module", "python");
    } catch (const mam::Error &) {
        threw = true;
    }
    report("an invalid starter name throws", threw);
}

static void test_doctor_and_helpers()
{
    const mam::DoctorReport report = mam::doctor();
    report("doctor ran checks", !report.checks.empty());
    report("doctor is ok when nothing failed", report.ok());
    report("doctor status is known",
           report.status() == mam::MAM_CHECK_OK || report.status() == mam::MAM_CHECK_WARN);
    report("doctor report renders", report.format().find("diagnostics") != std::string::npos);
    report("command_exists rejects nonsense", !mam::command_exists("definitely-not-a-tool-9f2a"));
    report("command_exists accepts an empty check", !mam::command_exists(""));

    report("user agent names the sdk", mam::user_agent().find("mam-c") == 0U);
    report("version is exposed", !mam::version().empty());
    report("section kind names resolve", mam::section_kind_name(mam::MAM_SECTION_PURPOSE) == "purpose");
    report("section kinds parse case insensitively",
           mam::section_kind_from_string("PuRpOsE") == mam::MAM_SECTION_PURPOSE);
    report("unknown sections become custom",
           mam::section_kind_from_string("nonsense") == mam::MAM_SECTION_CUSTOM);
    report("there are nineteen standard kinds",
           mam::section_kind_is_standard(mam::MAM_SECTION_CAPABILITIES) &&
               !mam::section_kind_is_standard(mam::MAM_SECTION_CUSTOM));
}

static void test_formatting()
{
    mam::Module module(kFullModule, "cpp.mam.md");
    report("section list renders", mam::format_section_list(module).find("Purpose") != std::string::npos);
    report("code block list renders",
           mam::format_code_block_list(module).find("python") != std::string::npos);
    report("front matter renders", mam::format_front_matter(module).find("version") != std::string::npos);
    report("toc renders", mam::format_toc(module).find("Contents") != std::string::npos);
}

static void test_errors()
{
    bool threw = false;
    try {
        mam::Module broken("---\nname: x\n\n## Purpose\n\nunterminated\n", "strict.mam.md");
        (void)broken;
    } catch (const mam::Error &) {
        threw = true;
    }
    report("a malformed document does not throw by default", !threw);

    threw = false;
    try {
        mam::Module from_missing = mam::Module::from_file("definitely-missing-9f2a.mam.md");
        (void)from_missing;
    } catch (const mam::Error &error) {
        threw = error.status() == mam::MAM_ERR_IO;
    }
    report("a missing file throws MAM_ERR_IO", threw);
}

int main()
{
    std::printf("test_mam\n");
    test_parsing();
    test_frontmatter_and_nodes();
    test_validation();
    test_move_semantics();
    test_support_modules();
    test_config_and_templates();
    test_doctor_and_helpers();
    test_formatting();
    test_errors();
    return suite_result("test_mam");
}
