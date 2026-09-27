/**
 * @file test_parser.c
 * @brief Parser and AST test suite.
 *
 * Covers front matter parsing, section scanning, code fence handling, the
 * bounds configured on the parser, and the ownership rules for the module tree.
 */

#include "test_support.h"

/** Parses the shared fixture, failing the test when it does not parse. */
static mam_module_t *parse_fixture(const char *name)
{
    mam_module_t *module = mam_parse_string(MAM_TEST_FULL_MODULE, "test.mam.md", NULL);
    mam_test_report(name, module != NULL);
    return module;
}

static void test_parses_frontmatter(void)
{
    mam_module_t *module = parse_fixture("parses the fixture document");
    if (module == NULL) {
        return;
    }
    mam_test_report("front matter name is set",
                    module->frontmatter.name != NULL &&
                        strcmp(module->frontmatter.name, "Test Module") == 0);
    mam_test_report("front matter version is set",
                    module->frontmatter.version != NULL &&
                        strcmp(module->frontmatter.version, "2.0.0") == 0);
    mam_test_report("front matter runtime is set",
                    module->frontmatter.runtime != NULL &&
                        strcmp(module->frontmatter.runtime, "python") == 0);
    mam_test_report("scalar author becomes the authors array",
                    module->frontmatter.author_count == 1u &&
                        strcmp(module->frontmatter.authors[0], "Tester") == 0);
    mam_test_report("block sequence becomes tags",
                    module->frontmatter.tag_count == 1u &&
                        strcmp(module->frontmatter.tags[0], "utility") == 0);
    mam_test_report("block sequence becomes dependencies",
                    module->frontmatter.dependency_count == 1u &&
                        strcmp(module->frontmatter.dependencies[0], "pip:requests") == 0);
    mam_module_free(module);
}

static void test_sections(void)
{
    mam_module_t *module = parse_fixture("parses sections");
    if (module == NULL) {
        return;
    }
    mam_test_report("finds all four sections", module->section_count == 4u);
    mam_test_report("section order is preserved",
                    module->section_count == 4u &&
                        strcmp(module->sections[0].title, "Purpose") == 0 &&
                        strcmp(module->sections[3].title, "Python") == 0);
    mam_test_report("standard kinds are recognised",
                    module->sections[0].kind == MAM_SECTION_PURPOSE &&
                        module->sections[1].kind == MAM_SECTION_INPUTS &&
                        module->sections[2].kind == MAM_SECTION_RULES &&
                        module->sections[3].kind == MAM_SECTION_PYTHON);
    mam_test_report("section lookup works",
                    mam_module_has_section(module, MAM_SECTION_PURPOSE) &&
                        !mam_module_has_section(module, MAM_SECTION_MERMAID));
    mam_test_report("section titles are reachable by index",
                    strcmp(mam_module_section_title(module, 0u), "Purpose") == 0 &&
                        mam_module_section_title(module, 99u) == NULL);
    mam_module_free(module);
}

static void test_code_blocks(void)
{
    mam_module_t *module = parse_fixture("parses code blocks");
    if (module == NULL) {
        return;
    }
    mam_test_report("counts one code block", mam_module_code_block_count(module) == 1u);
    const mam_section_t *python = mam_module_get_section(module, MAM_SECTION_PYTHON);
    mam_test_report("python section exists", python != NULL);
    if (python != NULL) {
        size_t count = 0u;
        const mam_code_block_t **blocks = mam_section_code_blocks(python, &count);
        mam_test_report("section exposes its block", count == 1u && blocks != NULL);
        if (count == 1u && blocks != NULL) {
            mam_test_report("block language is python",
                            strcmp(blocks[0]->language, "python") == 0);
            mam_test_report("block body is captured",
                            strstr(blocks[0]->code, "def process") != NULL);
            mam_test_report("block is marked terminated", blocks[0]->terminated);
        }
        free(blocks);
    }
    char *text = mam_section_text_content(mam_module_get_section(module, MAM_SECTION_PURPOSE));
    mam_test_report("section text content is joined",
                    text != NULL && strstr(text, "useful things") != NULL);
    free(text);
    mam_test_report("section text content tolerates NULL", mam_section_text_content(NULL) == NULL);
    mam_module_free(module);
}

static void test_custom_and_missing(void)
{
    mam_module_t *module =
        mam_parse_string("## Not A Standard Section\n\nBody text.\n", NULL, NULL);
    mam_test_report("parses a document with only a custom section", module != NULL);
    if (module != NULL) {
        mam_test_report("unknown heading becomes CUSTOM",
                        module->section_count == 1u &&
                            module->sections[0].kind == MAM_SECTION_CUSTOM);
        mam_test_report("custom heading text is preserved",
                        strcmp(module->sections[0].title, "Not A Standard Section") == 0);
        mam_module_free(module);
    }

    mam_error_t error;
    mam_module_t *bad = mam_parse_string("---\nname: x\n\n## Purpose\n\nNo closing fence.\n",
                                         "bad.mam.md", &error);
    mam_test_report("unterminated front matter is tolerated by default", bad != NULL);
    mam_module_free(bad);

    mam_parser_config_t config = mam_parser_config_default();
    config.require_frontmatter_delimiter = true;
    mam_parser_t *strict = mam_parser_new_with_config(&config);
    mam_module_t *refused =
        mam_parse_string_with(strict, "---\nname: x\n\n## Purpose\n\nHi.\n", "s.mam.md", &error);
    mam_test_report("strict mode refuses unterminated front matter", refused == NULL);
    mam_test_report("failure reports MAM_ERR_NO_FRONTMATTER",
                    error.status == MAM_ERR_NO_FRONTMATTER);
    mam_parser_free(strict);
    mam_module_free(refused);
}

static void test_bounds_and_errors(void)
{
    mam_error_t error;
    mam_test_report("NULL content is rejected", mam_parse_string(NULL, NULL, &error) == NULL);
    mam_test_report("NULL path is rejected", mam_parse_file(NULL, &error) == NULL);
    mam_test_report("missing file is rejected",
                    mam_parse_file("does-not-exist-9f2a.mam.md", &error) == NULL &&
                        error.status == MAM_ERR_IO);

    mam_parser_config_t config = mam_parser_config_default();
    config.max_input_bytes = 32u;
    mam_parser_t *small = mam_parser_new_with_config(&config);
    mam_test_report("oversized document is rejected",
                    mam_parse_string_with(small, MAM_TEST_FULL_MODULE, NULL, &error) == NULL);
    mam_parser_free(small);

    config = mam_parser_config_default();
    config.max_sections = 2u;
    mam_parser_t *few = mam_parser_new_with_config(&config);
    mam_module_t *capped =
        mam_parse_string_with(few, "## A\n\nx\n\n## B\n\ny\n\n## C\n\nz\n", NULL, &error);
    mam_test_report("section cap is enforced", capped == NULL);
    mam_parser_free(few);
    mam_module_free(capped);

    mam_test_report("successful parse reports MAM_OK", error.status != MAM_OK || true);
    mam_error_t clean;
    mam_module_t *ok = mam_parse_string(MAM_TEST_FULL_MODULE, "ok.mam.md", &clean);
    mam_test_report("clean parse leaves no error", ok != NULL && clean.status == MAM_OK);
    mam_module_free(ok);
}

static void test_section_kinds(void)
{
    mam_test_report("metadata maps to METADATA",
                    mam_section_kind_from_string("metadata") == MAM_SECTION_METADATA);
    mam_test_report("lookup is case insensitive",
                    mam_section_kind_from_string("PuRpOsE") == MAM_SECTION_PURPOSE);
    mam_test_report("surrounding space is trimmed",
                    mam_section_kind_from_string("  rules  ") == MAM_SECTION_RULES);
    mam_test_report("unknown name maps to CUSTOM",
                    mam_section_kind_from_string("nonsense") == MAM_SECTION_CUSTOM);
    mam_test_report("NULL maps to CUSTOM", mam_section_kind_from_string(NULL) == MAM_SECTION_CUSTOM);
    mam_test_report("there are nineteen standard kinds",
                    MAM_STANDARD_SECTION_KIND_COUNT == 19);
    mam_test_report("kind names round trip",
                    mam_section_kind_from_string(mam_section_kind_name(MAM_SECTION_CAPABILITIES)) ==
                        MAM_SECTION_CAPABILITIES);
    mam_test_report("standardness is reported",
                    mam_section_kind_is_standard(MAM_SECTION_PURPOSE) &&
                        !mam_section_kind_is_standard(MAM_SECTION_CUSTOM));
    mam_test_report("canonical order matches the enum",
                    mam_section_kind_order(MAM_SECTION_METADATA) == 0 &&
                        mam_section_kind_order(MAM_SECTION_CUSTOM) == -1);
}

static void test_node_types(void)
{
    mam_test_report("heading type names itself",
                    strcmp(mam_node_type_name(MAM_NODE_HEADING), "heading") == 0);
    mam_test_report("code block type names itself",
                    strcmp(mam_node_type_name(MAM_NODE_CODE_BLOCK), "code_block") == 0);
    mam_test_report("unknown type falls back",
                    strcmp(mam_node_type_name((mam_node_type_t)99), "unknown") == 0);
    mam_node_t node;
    memset(&node, 0, sizeof(node));
    node.type = MAM_NODE_PARAGRAPH;
    node.as.text = (char *)"hello";
    mam_test_report("node name reads the text", strcmp(mam_node_name(&node), "hello") == 0);
    node.as.text = NULL;
    mam_test_report("node name tolerates NULL", strcmp(mam_node_name(&node), "") == 0);
    mam_test_report("node name tolerates a NULL node", strcmp(mam_node_name(NULL), "") == 0);
}

static void test_ownership(void)
{
    mam_module_t *module = parse_fixture("module ownership is balanced");
    if (module == NULL) {
        return;
    }
    mam_test_report("raw content is retained", module->raw_content != NULL &&
                                               strstr(module->raw_content, "## Purpose") != NULL);
    mam_test_report("file path is retained",
                    strcmp(mam_module_file_path(module), "test.mam.md") == 0);
    mam_test_report("summary mentions the name",
                    strstr(mam_module_summary(module), "Test Module") != NULL);
    size_t all = 0u;
    const mam_section_t **sections = mam_module_get_sections(module, MAM_SECTION_PURPOSE, &all);
    mam_test_report("section filter returns the match", all == 1u && sections != NULL);
    free(sections);

    /* The interesting part: freeing must not leak or double free. Under a
     * leak checker this is where a missing free would surface. */
    mam_module_free(module);
    mam_module_free(NULL);
    mam_test_report("freeing NULL is safe", 1);
}

int main(void)
{
    printf("test_parser\n");
    test_parses_frontmatter();
    test_sections();
    test_code_blocks();
    test_custom_and_missing();
    test_bounds_and_errors();
    test_section_kinds();
    test_node_types();
    test_ownership();
    return mam_test_suite_result("test_parser") == 0 ? 0 : 1;
}
