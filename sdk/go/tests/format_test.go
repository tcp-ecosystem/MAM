package tests

import (
	"strings"
	"testing"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

const formatFixture = `---
title: Format Me
version: 2.0.0
author: Tester
---

## Purpose

A module for formatting.

## Python

` + "```python\nprint('hi')\n```" + `
`

func mustParseFixture(t *testing.T) *mam.Module {
	t.Helper()
	mod, err := mam.ParseString(formatFixture, "fixture.mam.md")
	if err != nil {
		t.Fatalf("ParseString() error: %v", err)
	}
	return mod
}

func TestFormatModuleSummary(t *testing.T) {
	summary := mam.FormatModuleSummary(mustParseFixture(t))
	if !strings.Contains(summary, "Format Me") {
		t.Errorf("summary missing title: %q", summary)
	}
	if !strings.Contains(summary, "2 sections") {
		t.Errorf("summary missing section count: %q", summary)
	}
	if mam.FormatModuleSummary(nil) != "nil module" {
		t.Error("nil module must summarize safely")
	}
}

func TestFormatModuleJSON(t *testing.T) {
	text, err := mam.FormatModuleJSON(mustParseFixture(t))
	if err != nil {
		t.Fatalf("FormatModuleJSON() error: %v", err)
	}
	if !strings.HasPrefix(text, "{") || !strings.Contains(text, "Format Me") {
		t.Errorf("unexpected JSON output: %q", text)
	}
}

func TestFormatSectionList(t *testing.T) {
	text := mam.FormatSectionList(mustParseFixture(t))
	if !strings.Contains(text, "Purpose") {
		t.Errorf("section list missing Purpose: %q", text)
	}
	if mam.FormatSectionList(nil) != "(no sections)" {
		t.Error("nil module must list safely")
	}
}

func TestFormatValidationReport(t *testing.T) {
	valid := mam.NewValidator().Validate(mustParseFixture(t))
	text := mam.FormatValidationReport(valid)
	if !strings.Contains(text, "valid:") {
		t.Errorf("report missing status: %q", text)
	}
	empty, err := mam.ParseString("no sections here\n", "empty.mam.md")
	if err != nil {
		t.Fatal(err)
	}
	invalid := mam.NewValidator().Validate(empty)
	bad := mam.FormatValidationReport(invalid)
	if !strings.Contains(bad, "invalid:") {
		t.Errorf("report missing invalid status: %q", bad)
	}
	if mam.FormatValidationReport(nil) != "nil report" {
		t.Error("nil report must format safely")
	}
}

func TestFormatExecutionResults(t *testing.T) {
	if mam.FormatExecutionResults(nil) != "(no results)" {
		t.Error("empty results must format safely")
	}
	results := []*mam.ExecutionResult{
		{Language: "python", Code: "x", ExitCode: 0, Duration: "1ms", Stdout: "hi\n"},
		{Language: "bash", Code: "y", ExitCode: 1, Duration: "2ms", Stderr: "boom\n"},
	}
	text := mam.FormatExecutionResults(results)
	if !strings.Contains(text, "python") || !strings.Contains(text, "ok") {
		t.Errorf("results missing success line: %q", text)
	}
	if !strings.Contains(text, "exit 1") || !strings.Contains(text, "boom") {
		t.Errorf("results missing failure detail: %q", text)
	}
}

func TestFormatCodeBlockList(t *testing.T) {
	text := mam.FormatCodeBlockList(mustParseFixture(t))
	if !strings.Contains(text, "python") {
		t.Errorf("code block list missing python: %q", text)
	}
	if mam.FormatCodeBlockList(nil) != "(no code blocks)" {
		t.Error("nil module must list safely")
	}
	plain, err := mam.ParseString("## Purpose\n\nJust words.\n", "plain.mam.md")
	if err != nil {
		t.Fatal(err)
	}
	if mam.FormatCodeBlockList(plain) != "(no code blocks)" {
		t.Error("module without blocks must list safely")
	}
}

func TestFormatFrontMatter(t *testing.T) {
	text := mam.FormatFrontMatter(mustParseFixture(t).FrontMatter)
	if !strings.Contains(text, "Format Me") || !strings.Contains(text, "title") {
		t.Errorf("front matter missing title: %q", text)
	}
	if mam.FormatFrontMatter(nil) != "(no front matter)" {
		t.Error("nil front matter must format safely")
	}
}
