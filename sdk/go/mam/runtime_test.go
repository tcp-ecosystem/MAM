package mam

import (
	"context"
	"strings"
	"testing"
)

func TestNewRuntime(t *testing.T) {
	cfg := RuntimeConfig{
		Timeout:    1000000000,
		WorkingDir: "/tmp",
		Env:        []string{"KEY=value"},
	}
	rt := NewRuntime(cfg)
	if rt == nil {
		t.Fatal("NewRuntime returned nil")
	}
}

func trimNewline(s string) string {
	return strings.TrimRight(s, "\r\n")
}

func TestExecuteBlockPython(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "print('hello from python')",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", res.ExitCode)
	}
	if got := trimNewline(res.Stdout); got != "hello from python" {
		t.Errorf("Stdout = %q, want %q", got, "hello from python")
	}
	if res.Language != "python" {
		t.Errorf("Language = %q, want %q", res.Language, "python")
	}
	if res.Duration == "" {
		t.Error("Duration should not be empty")
	}
}

func TestExecuteBlockPython3(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python3",
		Code:     "print('python3 works')",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", res.ExitCode)
	}
	if got := trimNewline(res.Stdout); got != "python3 works" {
		t.Errorf("Stdout = %q, want %q", got, "python3 works")
	}
}

func TestExecuteBlockBash(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping bash test in short mode")
	}
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "bash",
		Code:     "echo 'hello from bash'",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Skipf("bash not available: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", res.ExitCode)
	}
	if got := trimNewline(res.Stdout); got != "hello from bash" {
		t.Errorf("Stdout = %q, want %q", got, "hello from bash")
	}
}

func TestExecuteBlockUnsupportedLanguage(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "brainfuck",
		Code:     "++++++++++",
	}
	_, err := rt.ExecuteBlock(ctx, cb)
	if err == nil {
		t.Fatal("expected error for unsupported language")
	}
}

func TestExecuteBlockNotAllowedLanguage(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{
		AllowedLanguages: []string{"python"},
	})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "bash",
		Code:     "echo nope",
	}
	_, err := rt.ExecuteBlock(ctx, cb)
	if err == nil {
		t.Fatal("expected error for disallowed language")
	}
}

func TestExecuteBlockAllowedLanguage(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{
		AllowedLanguages: []string{"python", "bash"},
	})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "print('allowed')",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if res.ExitCode != 0 {
		t.Errorf("ExitCode = %d, want 0", res.ExitCode)
	}
}

func TestExecuteBlockWithEnv(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{
		Env: []string{"MAM_TEST_VAR=hello_env"},
	})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "import os; print(os.environ.get('MAM_TEST_VAR', 'NOT_SET'))",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if got := trimNewline(res.Stdout); got != "hello_env" {
		t.Errorf("Stdout = %q, want %q", got, "hello_env")
	}
}

func TestExecuteBlockWithTimeout(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{
		Timeout: 1,
	})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "import time; time.sleep(10)",
	}
	_, err := rt.ExecuteBlock(ctx, cb)
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

func TestExecuteBlockNonZeroExit(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "import sys; sys.exit(42)",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if res.ExitCode != 42 {
		t.Errorf("ExitCode = %d, want 42", res.ExitCode)
	}
}

func TestExecuteBlockStderr(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	cb := CodeBlock{
		Language: "python",
		Code:     "import sys; sys.stderr.write('error output\\n')",
	}
	res, err := rt.ExecuteBlock(ctx, cb)
	if err != nil {
		t.Fatalf("ExecuteBlock() error: %v", err)
	}
	if got := trimNewline(res.Stderr); got != "error output" {
		t.Errorf("Stderr = %q, want %q", got, "error output")
	}
}

func TestExecuteModule(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	mod := &Module{
		Sections: []Section{
			{
				Title: "Python Section",
				CodeBlocks: []CodeBlock{
					{Language: "python", Code: "print('block1')"},
					{Language: "python", Code: "print('block2')"},
				},
			},
			{
				Title: "Bash Section",
				CodeBlocks: []CodeBlock{
					{Language: "python", Code: "print('block3')"},
				},
			},
		},
	}
	results, err := rt.ExecuteModule(ctx, mod)
	if err != nil {
		t.Fatalf("ExecuteModule() error: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("results len = %d, want 3", len(results))
	}
	if got := trimNewline(results[0].Stdout); got != "block1" {
		t.Errorf("results[0].Stdout = %q, want %q", got, "block1")
	}
	if got := trimNewline(results[1].Stdout); got != "block2" {
		t.Errorf("results[1].Stdout = %q, want %q", got, "block2")
	}
	if got := trimNewline(results[2].Stdout); got != "block3" {
		t.Errorf("results[2].Stdout = %q, want %q", got, "block3")
	}
}

func TestExecuteModuleEmpty(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	mod := &Module{Sections: []Section{}}
	results, err := rt.ExecuteModule(ctx, mod)
	if err != nil {
		t.Fatalf("ExecuteModule() error: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("results len = %d, want 0", len(results))
	}
}

func TestExecuteModuleUnsupportedLanguage(t *testing.T) {
	rt := NewRuntime(RuntimeConfig{})
	ctx := context.Background()
	mod := &Module{
		Sections: []Section{
			{
				Title: "Bad Section",
				CodeBlocks: []CodeBlock{
					{Language: "brainfuck", Code: "++++++++++"},
				},
			},
		},
	}
	_, err := rt.ExecuteModule(ctx, mod)
	if err == nil {
		t.Fatal("expected error for unsupported language in module")
	}
}

func TestExecuteModuleFromPath(t *testing.T) {
	content := `---
title: Exec Module
version: 2.0.0
---

## Purpose
Test execution.

## Python
` + "```python" + `
print('executed')
` + "```" + `
`
	tmpFile := createTempMAMFile(t, content)
	ctx := context.Background()
	cfg := RuntimeConfig{}

	results, report, err := ExecuteModuleFromPath(ctx, tmpFile, cfg)
	if err != nil {
		t.Fatalf("ExecuteModuleFromPath() error: %v", err)
	}
	if !report.Valid {
		t.Error("expected valid report")
	}
	if len(results) != 1 {
		t.Fatalf("results len = %d, want 1", len(results))
	}
	if got := trimNewline(results[0].Stdout); got != "executed" {
		t.Errorf("Stdout = %q, want %q", got, "executed")
	}
}

func TestExecuteModuleFromPathInvalid(t *testing.T) {
	tmpFile := createTempMAMFile(t, "no frontmatter content\n## Purpose\nTest.\n")
	ctx := context.Background()
	cfg := RuntimeConfig{}

	_, _, err := ExecuteModuleFromPath(ctx, tmpFile, cfg)
	if err == nil {
		t.Fatal("expected error for invalid module")
	}
}

func TestExecuteModuleFromPathFileNotFound(t *testing.T) {
	ctx := context.Background()
	_, _, err := ExecuteModuleFromPath(ctx, "/nonexistent/file.mam.md", RuntimeConfig{})
	if err == nil {
		t.Fatal("expected error for nonexistent file")
	}
}
