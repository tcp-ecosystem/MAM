/**
 * @file test_validator.c
 * @brief Validator test suite.
 *
 * Each rule is exercised against a document crafted to trigger exactly that
 * rule, so a failure points at one behaviour rather than a whole category.
 */

#include "test_support.h"

/** Parses @p source, reporting a failure when it does not parse. */
static mam_module_t *parse(const char *name, const char *source)
{
    mam_module_t *module = mam_parse_string(source, name, NULL);
    mam_test_report("fixture parses", module != NULL);
    return module;
}

static void test_valid_module(void)
{
    mam_module_t *module = parse("valid.mam.md", MAM_TEST_FULL_MODULE);
    if (module == NULL) {
        return;
    }
    mam_validation_result_t *result = mam_validation_run(module, false);
    mam_test_report("validation returns a result", result != NULL);
    if (result == NULL) {
        mam_module_free(module);
        return;
    }
    char *summary = mam_validation_summary(result);
    mam_test_report("a complete module has no errors", mam_validation_is_valid(result));
    mam_test_report("a complete module has no findings",
                    mam_validation_count_at(result, MAM_SEVERITY_ERROR) == 0u);
    mam_test_report("summary is produced", summary != NULL);
    free(summary);
    mam_validation_free(result);
    mam_validation_free(NULL);
    mam_test_report("freeing a NULL result is safe", 1);
    mam_module_free(module);
}

static void test_frontmatter_rules(void)
{
    mam_module_t *no_name = parse("no-name.mam.md", "---\nversion: 2.0.0\n---\n\n## Purpose\n\nx\n");
    if (no_name != NULL) {
        mam_validation_result_t *result = mam_validation_run(no_name, false);
        mam_test_report("missing name is an error", !mam_validation_is_valid(result));
        mam_test_report("missing name is reported by message",
                        mam_validation_count_at(result, MAM_SEVERITY_ERROR) >= 1u);
        mam_validation_free(result);
        mam_module_free(no_name);
    }

    mam_module_t *no_version = parse("no-version.mam.md", "---\nname: x\n---\n\n## Purpose\n\nx\n");
    if (no_version != NULL) {
        mam_validation_result_t *lax = mam_validation_run(no_version, false);
        mam_validation_result_t *strict = mam_validation_run(no_version, true);
        mam_test_report("lax mode tolerates a missing version",
                        mam_validation_count_at(lax, MAM_SEVERITY_ERROR) <= 1u);
        mam_test_report("strict mode requires a version",
                        mam_validation_count_at(strict, MAM_SEVERITY_ERROR) >
                            mam_validation_count_at(lax, MAM_SEVERITY_ERROR));
        mam_validation_free(lax);
        mam_validation_free(strict);
        mam_module_free(no_version);
    }

    mam_module_t *bad_version = parse("bad-version.mam.md",
                                      "---\nname: x\nversion: not-a-version\n---\n\n## Purpose\n\nx\n");
    if (bad_version != NULL) {
        mam_validation_result_t *result = mam_validation_run(bad_version, false);
        mam_test_report("malformed version warns",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(bad_version);
    }

    mam_module_t *upper_name = parse("upper.mam.md",
                                     "---\nname: Not Lowercase\nversion: 2.0.0\n---\n\n## Purpose\n\nx\n");
    if (upper_name != NULL) {
        mam_validation_result_t *result = mam_validation_run(upper_name, false);
        mam_test_report("uppercase name warns",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(upper_name);
    }
}

static void test_structure_rules(void)
{
    mam_module_t *empty = parse("empty.mam.md", "---\nname: x\nversion: 2.0.0\n---\n");
    if (empty != NULL) {
        mam_validation_result_t *result = mam_validation_run(empty, false);
        mam_test_report("a module with no sections is invalid", !mam_validation_is_valid(result));
        mam_test_report("missing sections is reported",
                        mam_validation_count_at(result, MAM_SEVERITY_ERROR) >= 1u);
        mam_validation_free(result);
        mam_module_free(empty);
    }

    mam_module_t *no_purpose = parse("no-purpose.mam.md",
                                     "---\nname: x\nversion: 2.0.0\n---\n\n## Rules\n\nx\n");
    if (no_purpose != NULL) {
        mam_validation_result_t *result = mam_validation_run(no_purpose, false);
        mam_test_report("missing purpose is an error", !mam_validation_is_valid(result));
        mam_validation_free(result);
        mam_module_free(no_purpose);
    }

    mam_module_t *reordered = parse("reordered.mam.md",
                                    "---\nname: x\nversion: 2.0.0\n---\n\n## Python\n\nx\n\n"
                                    "## Purpose\n\ny\n");
    if (reordered != NULL) {
        mam_validation_result_t *result = mam_validation_run(reordered, false);
        mam_test_report("out of order sections warn",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(reordered);
    }

    mam_module_t *duplicated = parse("dup.mam.md",
                                     "---\nname: x\nversion: 2.0.0\n---\n\n## Purpose\n\nA\n\n"
                                     "## Purpose\n\nB\n");
    if (duplicated != NULL) {
        mam_validation_result_t *result = mam_validation_run(duplicated, false);
        mam_test_report("duplicate sections warn",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(duplicated);
    }

    mam_module_t *blank = parse("blank.mam.md",
                                "---\nname: x\nversion: 2.0.0\n---\n\n## Purpose\n\n");
    if (blank != NULL) {
        mam_validation_result_t *result = mam_validation_run(blank, false);
        mam_test_report("an empty section warns",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(blank);
    }
}

static void test_code_block_rules(void)
{
    mam_module_t *module = parse("blocks.mam.md",
                                 "---\nname: x\nversion: 2.0.0\n---\n\n## Python\n\n"
                                 "```\nplain\n```\n\n```brainfuck\n+[->+<]\n```\n\n"
                                 "```python\n\n```\n");
    if (module == NULL) {
        return;
    }
    mam_validation_result_t *result = mam_validation_run(module, false);
    mam_test_report("a missing language warns",
                    mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
    mam_test_report("an unsupported language is informational",
                    mam_validation_count_at(result, MAM_SEVERITY_INFO) >= 1u);
    mam_validation_free(result);
    mam_module_free(module);

    mam_module_t *unterminated = parse("unterminated.mam.md",
                                       "---\nname: x\nversion: 2.0.0\n---\n\n## Python\n\n"
                                       "```python\nprint(1)\n");
    if (unterminated != NULL) {
        mam_validation_result_t *result = mam_validation_run(unterminated, false);
        mam_test_report("an unterminated fence warns",
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING) >= 1u);
        mam_validation_free(result);
        mam_module_free(unterminated);
    }
}

static void test_result_api(void)
{
    mam_module_t *module = parse("api.mam.md", MAM_TEST_FULL_MODULE);
    if (module == NULL) {
        return;
    }
    mam_validation_result_t *result = mam_validation_run(module, false);

    mam_test_report("severity names are lower case",
                    strcmp(mam_severity_name(MAM_SEVERITY_ERROR), "error") == 0 &&
                        strcmp(mam_severity_name(MAM_SEVERITY_WARNING), "warning") == 0 &&
                        strcmp(mam_severity_name(MAM_SEVERITY_INFO), "info") == 0);
    mam_test_report("indexed access is bounds checked",
                    mam_validation_at(result, 0u) != NULL &&
                        mam_validation_at(result, 10000u) == NULL);
    mam_test_report("count at least is monotonic",
                    mam_validation_count_at_least(result, MAM_SEVERITY_WARNING) >=
                        mam_validation_count_at(result, MAM_SEVERITY_WARNING));
    mam_test_report("warnings predicate is consistent",
                    mam_validation_has_warnings(result) ==
                        (mam_validation_count_at_least(result, MAM_SEVERITY_WARNING) > 0u));
    mam_validation_free(result);

    mam_test_report("NULL module is rejected", mam_validation_run(NULL, false) == NULL);
    mam_test_report("NULL result is not valid", !mam_validation_is_valid(NULL));
    mam_test_report("NULL result has no warnings", !mam_validation_has_warnings(NULL));
    mam_test_report("printing a NULL result is safe", (mam_validation_print(NULL, stdout), 1));
    char *summary = mam_validation_summary(NULL);
    mam_test_report("summarising a NULL result is safe", summary != NULL);
    free(summary);
    mam_module_free(module);
}

static void test_singular_plural(void)
{
    mam_module_t *module = parse("singular.mam.md",
                                 "---\nname: x\nversion: 2.0.0\n---\n\n## Purpose\n\nx\n\n"
                                 "## Inputs\n\ny\n");
    if (module == NULL) {
        return;
    }
    mam_validation_result_t *result = mam_validation_run(module, false);
    char *summary = mam_validation_summary(result);
    mam_test_report("summary does not over-count a clean module",
                    summary != NULL && strstr(summary, "error") == NULL);
    free(summary);
    mam_validation_free(result);
    mam_module_free(module);
}

int main(void)
{
    printf("test_validator\n");
    test_valid_module();
    test_frontmatter_rules();
    test_structure_rules();
    test_code_block_rules();
    test_result_api();
    test_singular_plural();
    return mam_test_suite_result("test_validator") == 0 ? 0 : 1;
}
