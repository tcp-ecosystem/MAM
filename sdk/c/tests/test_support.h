/**
 * @file test_support.h
 * @brief Minimal assertion helpers for the C SDK test suites.
 *
 * Deliberately tiny and dependency free: the SDK ships with no test framework
 * so that it can be vendored into a project without pulling anything in. Each
 * check prints a line and increments a counter; the runner reports totals and
 * returns non-zero when anything failed.
 */

#ifndef MAM_TEST_SUPPORT_H
#define MAM_TEST_SUPPORT_H

#include "mam/mam.h"
#include "mam/support.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/** Counters shared by every test in a translation unit. */
static int mam_test_failures = 0;
static int mam_test_checks = 0;

/** Prints a PASS or FAIL line and updates the counters. */
static void mam_test_report(const char *name, int passed)
{
    mam_test_checks++;
    if (passed) {
        printf("  ok   %s\n", name);
        return;
    }
    mam_test_failures++;
    printf("  FAIL %s\n", name);
}

/** Reports the totals for one suite and returns the failure count. */
static int mam_test_suite_result(const char *suite)
{
    printf("%s: %d checks, %d failures\n", suite, mam_test_checks, mam_test_failures);
    return mam_test_failures;
}

/** The full document used by most tests. */
static const char *const MAM_TEST_FULL_MODULE =
    "---\n"
    "name: Test Module\n"
    "version: 2.0.0\n"
    "author: Tester\n"
    "runtime: python\n"
    "description: A module used by the C SDK tests.\n"
    "tags:\n"
    "  - utility\n"
    "dependencies:\n"
    "  - pip:requests\n"
    "---\n"
    "\n"
    "## Purpose\n"
    "\n"
    "Does useful things for the test suite.\n"
    "\n"
    "## Inputs\n"
    "\n"
    "A payload dictionary.\n"
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
    "```\n";

#endif /* MAM_TEST_SUPPORT_H */
