/**
 * @file test_runtime.c
 * @brief Runtime and support-module test suite.
 *
 * Execution tests are written to tolerate a missing interpreter: each asserts
 * on the shape of the outcome rather than requiring a successful run, so the
 * suite passes on a machine that has only some toolchains installed.
 */

#include "test_support.h"

static void test_language_table(void)
{
    mam_test_report("python is supported", mam_runtime_supports_language("python"));
    mam_test_report("js is an alias for node", mam_runtime_supports_language("js"));
    mam_test_report("lookup is case insensitive", mam_runtime_supports_language("PYTHON"));
    mam_test_report("brainfuck is not supported", !mam_runtime_supports_language("brainfuck"));
    mam_test_report("NULL is not supported", !mam_runtime_supports_language(NULL));
    mam_test_report("empty is not supported", !mam_runtime_supports_language(""));
    mam_test_report("interpreter is reported for python",
                    mam_runtime_interpreter("python") != NULL);
    mam_test_report("interpreter is NULL for unknown",
                    mam_runtime_interpreter("cobol") == NULL);
}

static void test_config_defaults(void)
{
    mam_runtime_config_t config = mam_runtime_config_default();
    mam_test_report("timeout defaults to thirty seconds", config.timeout_ms == 30000ul);
    mam_test_report("output cap defaults to one mebibyte", config.max_output_bytes == 1024u * 1024u);
    mam_test_report("working directory is unset", config.working_dir == NULL);
    mam_test_report("unsupported languages are skipped", config.skip_unsupported);
    mam_test_report("setting an env var is accepted",
                    mam_runtime_config_set_env(&config, "K", "V"));
    mam_test_report("setting a NULL key is rejected",
                    !mam_runtime_config_set_env(&config, NULL, "V"));
    mam_test_report("setting on a NULL config is rejected",
                    !mam_runtime_config_set_env(NULL, "K", "V"));
    mam_test_report("setting an empty key is rejected",
                    !mam_runtime_config_set_env(&config, "", "V"));
}

static void test_execution(void)
{
    mam_error_t error;
    mam_test_report("NULL block is rejected", mam_execute_code_block(NULL, NULL, &error) == NULL);
    mam_test_report("rejection names the argument",
                    error.status == MAM_ERR_INVALID_ARGUMENT);

    mam_code_block_t block;
    memset(&block, 0, sizeof(block));
    block.language = (char *)"brainfuck";
    block.code = (char *)"++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.";
    mam_execution_result_t *result = mam_execute_code_block(&block, NULL, &error);
    mam_test_report("an unsupported language still returns a result", result != NULL);
    if (result != NULL) {
        mam_test_report("an unsupported language reports failure",
                        !mam_execution_is_success(result));
        mam_test_report("an unsupported language explains itself",
                        mam_execution_stderr(result) != NULL &&
                            strstr(mam_execution_stderr(result), "unsupported") != NULL);
        mam_test_report("the language is recorded", strcmp(result->language, "brainfuck") == 0);
        mam_execution_free(result);
    }

    block.language = (char *)"python";
    block.code = (char *)"print('mam')";
    mam_execution_result_t *ran = mam_execute_code_block(&block, NULL, &error);
    mam_test_report("a supported language produces a result", ran != NULL);
    if (ran != NULL) {
        mam_test_report("stdout accessors never return NULL",
                        mam_execution_stdout(ran) != NULL && mam_execution_stderr(ran) != NULL);
        mam_execution_free(ran);
    }
    mam_execution_free(NULL);
    mam_test_report("freeing a NULL result is safe", 1);
    mam_test_report("a NULL result is not a success", !mam_execution_is_success(NULL));
    mam_test_report("NULL stdout reads as empty", strcmp(mam_execution_stdout(NULL), "") == 0);
}

static void test_execute_section(void)
{
    mam_module_t *module = mam_parse_string(MAM_TEST_FULL_MODULE, "rt.mam.md", NULL);
    if (module == NULL) {
        return;
    }
    mam_error_t error;
    mam_test_report("a missing section is reported",
                    mam_execute_section(module, MAM_SECTION_MERMAID, NULL, &error) == NULL &&
                        error.status == MAM_ERR_NO_CODE_BLOCK);
    mam_test_report("a NULL module is rejected", mam_execute_section(NULL, MAM_SECTION_PYTHON, NULL,
                                                                    &error) == NULL);
    mam_execution_result_t *ran = mam_execute_section(module, MAM_SECTION_PYTHON, NULL, &error);
    mam_test_report("a section with a block executes", ran != NULL);
    mam_execution_free(ran);
    mam_module_free(module);
}

static void test_cache(void)
{
    mam_cache_t *cache = mam_cache_new(60ul);
    mam_test_report("cache allocates", cache != NULL);
    if (cache == NULL) {
        return;
    }
    mam_test_report("set then get", mam_cache_set(cache, "a", "one") &&
                                     strcmp(mam_cache_get(cache, "a"), "one") == 0);
    mam_test_report("overwrite replaces", mam_cache_set(cache, "a", "two") &&
                                           strcmp(mam_cache_get(cache, "a"), "two") == 0);
    mam_test_report("size counts entries", mam_cache_size(cache) == 1u);
    mam_test_report("has reflects presence", mam_cache_has(cache, "a") &&
                                            !mam_cache_has(cache, "b"));
    mam_test_report("miss returns NULL", mam_cache_get(cache, "missing") == NULL);
    mam_test_report("blank keys are refused", !mam_cache_set(cache, "   ", "x"));
    mam_test_report("newline keys are refused", !mam_cache_set(cache, "a\nb", "x"));
    mam_test_report("NULL values are refused", !mam_cache_set(cache, "k", NULL));
    mam_test_report("delete removes", mam_cache_delete(cache, "a") && !mam_cache_delete(cache, "a"));
    mam_test_report("deleting a missing key is false", !mam_cache_delete(cache, "zzz"));
    mam_cache_clear(cache);
    mam_test_report("clear empties", mam_cache_size(cache) == 0u);

    mam_cache_set(cache, "x", "1");
    mam_cache_set(cache, "y", "2");
    mam_cache_get(cache, "x");
    mam_cache_get(cache, "nope");
    mam_cache_stats_t stats;
    mam_cache_stats(cache, &stats);
    mam_test_report("stats count entries", stats.entries == 2u);
    mam_test_report("stats count a hit", stats.hits == 1u);
    mam_test_report("stats count a miss", stats.misses == 1u);
    mam_test_report("hit rate is a fraction", mam_cache_hit_rate(cache) > 0.0 &&
                                                 mam_cache_hit_rate(cache) < 1.0);
    char *rendered = mam_format_cache_stats(cache);
    mam_test_report("stats render to text", rendered != NULL && strstr(rendered, "hit rate") != NULL);
    free(rendered);

    mam_cache_t *expiring = mam_cache_new(0ul);
    mam_cache_set_with_ttl(expiring, "gone", "x", 0ul);
    mam_test_report("a zero ttl never expires", mam_cache_has(expiring, "gone"));
    mam_cache_free(expiring);

    mam_cache_free(cache);
    mam_cache_free(NULL);
    mam_test_report("freeing NULL is safe", 1);
    mam_test_report("a NULL cache has no size", mam_cache_size(NULL) == 0u);
    mam_test_report("a NULL cache has a zero hit rate", mam_cache_hit_rate(NULL) == 0.0);
}

static void test_cache_hashing(void)
{
    const char *parts_a[2] = {"a", "b"};
    const char *parts_b[2] = {"a", "c"};
    const char *parts_c[1] = {"a:b"};
    char *first = mam_cache_hash_key(parts_a, 2u);
    char *again = mam_cache_hash_key(parts_a, 2u);
    char *other = mam_cache_hash_key(parts_b, 2u);
    char *joined = mam_cache_hash_key(parts_c, 1u);
    mam_test_report("hashing is stable", first != NULL && strcmp(first, again) == 0);
    mam_test_report("different parts hash differently", strcmp(first, other) != 0);
    mam_test_report("the delimiter prevents collisions", strcmp(joined, first) != 0);
    mam_test_report("the hash is sixteen hex digits", strlen(first) == 16u);
    free(first);
    free(again);
    free(other);
    free(joined);
}

static void test_formatters(void)
{
    mam_module_t *module = mam_parse_string(MAM_TEST_FULL_MODULE, "fmt.mam.md", NULL);
    if (module == NULL) {
        return;
    }
    char *summary = mam_format_module_summary(module);
    mam_test_report("summary renders the name", summary != NULL &&
                                               strstr(summary, "Test Module") != NULL);
    free(summary);

    char *sections = mam_format_section_list(module);
    mam_test_report("section list renders titles", sections != NULL &&
                                                strstr(sections, "Purpose") != NULL);
    free(sections);

    char *toc = mam_format_toc(module);
    mam_test_report("toc renders", toc != NULL && strstr(toc, "Contents") != NULL);
    free(toc);

    char *blocks = mam_format_code_block_list(module);
    mam_test_report("code block list renders the language",
                    blocks != NULL && strstr(blocks, "python") != NULL);
    free(blocks);

    char *front = mam_format_front_matter(module);
    mam_test_report("front matter renders", front != NULL && strstr(front, "version") != NULL);
    free(front);

    mam_validation_result_t *result = mam_validation_run(module, false);
    char *report = mam_format_validation_report(result);
    mam_test_report("validation report renders", report != NULL);
    free(report);
    mam_validation_free(result);
    mam_module_free(module);

    mam_test_report("a NULL module still formats", mam_format_module_summary(NULL) != NULL);
    mam_test_report("an empty module reports no sections",
                    strcmp(mam_format_section_list(NULL), "(no sections)") == 0);
    mam_test_report("no code blocks is stated plainly",
                    strcmp(mam_format_code_block_list(NULL), "(no code blocks)") == 0);
}

static void test_doctor(void)
{
    mam_doctor_report_t *report = mam_doctor_run(NULL);
    mam_test_report("doctor produces a report", report != NULL);
    if (report == NULL) {
        return;
    }
    mam_test_report("doctor ran at least one check", report->count > 0u);
    mam_test_report("the report is ok when nothing failed", mam_doctor_report_is_ok(report));
    mam_test_report("status is a known value",
                    mam_doctor_report_status(report) == MAM_CHECK_OK ||
                        mam_doctor_report_status(report) == MAM_CHECK_WARN);
    char *text = mam_doctor_report_format(report);
    mam_test_report("the report renders", text != NULL && strstr(text, "diagnostics") != NULL);
    free(text);
    mam_doctor_report_free(report);

    const char *absent[2] = {"definitely-not-a-real-tool-9f2a", NULL};
    mam_doctor_report_t *missing = mam_doctor_run(absent);
    mam_test_report("a missing tool only warns",
                    missing != NULL && mam_doctor_report_status(missing) == MAM_CHECK_WARN);
    mam_doctor_report_free(missing);

    mam_test_report("command_exists rejects NULL", !mam_doctor_command_exists(NULL));
    mam_test_report("command_exists rejects empty", !mam_doctor_command_exists(""));
    mam_test_report("status names are stable",
                    strcmp(mam_check_status_name(MAM_CHECK_OK), "PASS") == 0 &&
                        strcmp(mam_check_status_name(MAM_CHECK_FAIL), "FAIL") == 0);
    mam_doctor_report_free(NULL);
    mam_test_report("freeing a NULL report is safe", 1);
}

int main(void)
{
    printf("test_runtime\n");
    test_language_table();
    test_config_defaults();
    test_execution();
    test_execute_section();
    test_cache();
    test_cache_hashing();
    test_formatters();
    test_doctor();
    return mam_test_suite_result("test_runtime") == 0 ? 0 : 1;
}
