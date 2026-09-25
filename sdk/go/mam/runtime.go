package mam

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ExecutionResult holds the output of running a single code block.
type ExecutionResult struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exit_code"`
	Duration string `json:"duration"`
}

// RuntimeConfig controls how code blocks are executed.
type RuntimeConfig struct {
	// Timeout is the maximum time a code block may run. Zero means no limit.
	Timeout time.Duration

	// WorkingDir sets the working directory for subprocesses.
	WorkingDir string

	// Env adds extra environment variables (KEY=VALUE).
	Env []string

	// AllowedLanguages restricts execution to a subset of languages.
	// An empty slice allows all languages.
	AllowedLanguages []string
}

// Runtime executes MAM code blocks via os/exec.
type Runtime struct {
	config RuntimeConfig
}

// NewRuntime creates a Runtime with the given configuration.
func NewRuntime(cfg RuntimeConfig) *Runtime {
	return &Runtime{config: cfg}
}

// ExecuteBlock runs a single CodeBlock and returns the result.
func (r *Runtime) ExecuteBlock(ctx context.Context, cb CodeBlock) (*ExecutionResult, error) {
	if r.config.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, r.config.Timeout)
		defer cancel()
	}

	if !r.isAllowed(cb.Language) {
		return nil, fmt.Errorf("language %q is not in the allowed list", cb.Language)
	}

	interpreter, args, err := r.interpreterFor(cb.Language)
	if err != nil {
		return nil, err
	}

	args = append(args, cb.Code)

	cmd := exec.CommandContext(ctx, interpreter, args...)
	cmd.Dir = r.config.WorkingDir
	if len(r.config.Env) > 0 {
		cmd.Env = append(cmd.Environ(), r.config.Env...)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	start := time.Now()
	err = cmd.Run()
	duration := time.Since(start)

	res := &ExecutionResult{
		Language: cb.Language,
		Code:     cb.Code,
		Stdout:   stdout.String(),
		Stderr:   stderr.String(),
		Duration: duration.String(),
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			res.ExitCode = exitErr.ExitCode()
		} else {
			return res, fmt.Errorf("exec: %w", err)
		}
	}
	return res, nil
}

// ExecuteModule runs every code block in the module sequentially and returns
// all results.
func (r *Runtime) ExecuteModule(ctx context.Context, mod *Module) ([]*ExecutionResult, error) {
	var results []*ExecutionResult
	for _, s := range mod.Sections {
		for _, cb := range s.CodeBlocks {
			res, err := r.ExecuteBlock(ctx, cb)
			if err != nil {
				return results, fmt.Errorf("section %q: %w", s.Title, err)
			}
			results = append(results, res)
		}
	}
	return results, nil
}

// interpreterFor maps a MAM language tag to an interpreter binary and flag.
func (r *Runtime) interpreterFor(lang string) (string, []string, error) {
	switch strings.ToLower(lang) {
	case "python", "python3", "py":
		return "python", []string{"-c"}, nil
	case "javascript", "js", "node":
		return "node", []string{"-e"}, nil
	case "go":
		return "go", []string{"run", "-"}, nil
	case "bash", "sh", "shell":
		return "bash", []string{"-c"}, nil
	case "ruby", "rb":
		return "ruby", []string{"-e"}, nil
	case "perl", "pl":
		return "perl", []string{"-e"}, nil
	default:
		return "", nil, fmt.Errorf("unsupported language: %q", lang)
	}
}

// isAllowed checks whether the language is permitted by configuration.
func (r *Runtime) isAllowed(lang string) bool {
	if len(r.config.AllowedLanguages) == 0 {
		return true
	}
	lower := strings.ToLower(lang)
	for _, a := range r.config.AllowedLanguages {
		if strings.ToLower(a) == lower {
			return true
		}
	}
	return false
}

// Config returns a copy of the runtime configuration.
func (r *Runtime) Config() RuntimeConfig {
	return r.config
}

// DefaultRuntimeConfig returns a RuntimeConfig with sensible defaults.
func DefaultRuntimeConfig() RuntimeConfig {
	return RuntimeConfig{}
}

// IsLanguageAllowed reports whether the language may be executed under the
// current configuration.
func (r *Runtime) IsLanguageAllowed(lang string) bool {
	return r.isAllowed(lang)
}

// SupportedLanguages lists every language tag the runtime can execute.
func SupportedLanguages() []string {
	return []string{"python", "javascript", "go", "bash", "ruby", "perl"}
}

// Succeeded reports whether the process exited with code zero.
func (res *ExecutionResult) Succeeded() bool {
	return res.ExitCode == 0
}

// CombinedOutput returns stdout and stderr concatenated with a separator.
func (res *ExecutionResult) CombinedOutput() string {
	if res.Stderr == "" {
		return res.Stdout
	}
	if res.Stdout == "" {
		return res.Stderr
	}
	return res.Stdout + "\n" + res.Stderr
}

// CountResultsByLanguage tallies execution results per language.
func CountResultsByLanguage(results []*ExecutionResult) map[string]int {
	counts := make(map[string]int)
	for _, res := range results {
		counts[res.Language]++
	}
	return counts
}

// ExecuteModuleFromPath is a convenience function that parses, validates, and
// executes a .mam.md file end-to-end.
func ExecuteModuleFromPath(ctx context.Context, path string, cfg RuntimeConfig) ([]*ExecutionResult, *ValidationReport, error) {
	mod, err := ParseFile(path)
	if err != nil {
		return nil, nil, fmt.Errorf("parse: %w", err)
	}
	v := NewValidator()
	report := v.Validate(mod)
	if !report.Valid {
		return nil, report, fmt.Errorf("validation failed with %d diagnostics", len(report.Diagnostics))
	}

	rt := NewRuntime(cfg)
	results, err := rt.ExecuteModule(ctx, mod)
	if err != nil {
		return results, report, fmt.Errorf("execute: %w", err)
	}
	return results, report, nil
}
