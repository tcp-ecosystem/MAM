package mam

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// sdkConfigFileName is the conventional SDK config file name.
const sdkConfigFileName = "mam.sdk.json"

// SDKConfig holds SDK-level settings for CLI runs: schema version, working
// directory, default build target, verbosity, and free-form extras.
//
// The zero value is not valid; use DefaultSDKConfig as a starting point.
type SDKConfig struct {
	Version string            `json:"version"`
	WorkDir string            `json:"work_dir"`
	Target  string            `json:"target"`
	Verbose bool              `json:"verbose"`
	Extra   map[string]string `json:"extra,omitempty"`
}

// DefaultSDKConfig returns an SDKConfig with sensible defaults: schema
// version "1", current directory, python target, quiet output.
func DefaultSDKConfig() SDKConfig {
	return SDKConfig{
		Version: "1",
		WorkDir: ".",
		Target:  "python",
		Verbose: false,
	}
}

// LoadSDKConfig reads, parses, validates, and environment-overrides an SDK
// config file. An empty path searches upwards from the working directory
// for mam.sdk.json and falls back to defaults when nothing is found.
func LoadSDKConfig(path string) (SDKConfig, error) {
	cfg := DefaultSDKConfig()
	resolved := expandConfigPath(path)
	if strings.TrimSpace(resolved) == "" {
		found, err := findSDKConfigUpwards(".")
		if err != nil {
			return cfg, err
		}
		if found == "" {
			return applySDKEnvOverrides(cfg), nil
		}
		resolved = found
	}
	raw, err := os.ReadFile(resolved)
	if err != nil {
		return cfg, fmt.Errorf("read config %s: %w", resolved, err)
	}
	parsed, err := parseSDKConfigBytes(raw)
	if err != nil {
		return cfg, fmt.Errorf("parse config %s: %w", resolved, err)
	}
	cfg = MergeSDKConfig(cfg, parsed)
	if problems := cfg.Validate(); len(problems) > 0 {
		return cfg, fmt.Errorf("invalid config %s: %s", resolved, strings.Join(problems, "; "))
	}
	return applySDKEnvOverrides(cfg), nil
}

// Save validates the config, then writes it to path as indented JSON with
// a trailing newline, creating parent directories as needed.
func (c SDKConfig) Save(path string) error {
	if problems := c.Validate(); len(problems) > 0 {
		return fmt.Errorf("refusing to save invalid config: %s", strings.Join(problems, "; "))
	}
	path = expandConfigPath(path)
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("create config dir: %w", err)
		}
	}
	raw, err := json.MarshalIndent(normalizeSDKConfig(c), "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	raw = append(raw, '\n')
	if existing, err := os.ReadFile(path); err == nil && string(existing) == string(raw) {
		return nil
	}
	if err := os.WriteFile(path, raw, 0644); err != nil {
		return fmt.Errorf("write config %s: %w", path, err)
	}
	return nil
}

// Validate returns human-readable problems with the config. An empty slice
// means the config is usable.
func (c SDKConfig) Validate() []string {
	var problems []string
	if strings.TrimSpace(c.Version) == "" {
		problems = append(problems, "version is required")
	} else if !isVersionLike(c.Version) {
		problems = append(problems, fmt.Sprintf("version %q must be numeric dotted (e.g. \"1\" or \"1.0\")", c.Version))
	}
	if strings.TrimSpace(c.Target) == "" {
		problems = append(problems, "target is required")
	} else if !isKnownSDKTarget(c.Target) {
		problems = append(problems, fmt.Sprintf("target %q is not a supported target", c.Target))
	}
	if strings.TrimSpace(c.WorkDir) == "" {
		problems = append(problems, "work_dir is required")
	}
	for k, v := range c.Extra {
		if strings.TrimSpace(k) == "" {
			problems = append(problems, "extra keys must not be empty")
			break
		}
		if strings.Contains(v, "\n") {
			problems = append(problems, fmt.Sprintf("extra[%q] must be a single line", k))
		}
	}
	return problems
}

// MergeSDKConfig overlays non-zero override fields onto base and returns the
// result. Neither input is mutated.
func MergeSDKConfig(base, override SDKConfig) SDKConfig {
	merged := base
	if strings.TrimSpace(override.Version) != "" {
		merged.Version = override.Version
	}
	if strings.TrimSpace(override.WorkDir) != "" {
		merged.WorkDir = override.WorkDir
	}
	if strings.TrimSpace(override.Target) != "" {
		merged.Target = override.Target
	}
	if override.Verbose {
		merged.Verbose = true
	}
	if len(override.Extra) > 0 {
		if merged.Extra == nil {
			merged.Extra = make(map[string]string, len(override.Extra))
		} else {
			merged.Extra = cloneStringMap(merged.Extra)
		}
		for k, v := range override.Extra {
			merged.Extra[k] = v
		}
	}
	return merged
}

// ResolveSDKConfigPath returns the default config file path inside dir.
func ResolveSDKConfigPath(dir string) string {
	if strings.TrimSpace(dir) == "" {
		dir = "."
	}
	return filepath.Join(dir, sdkConfigFileName)
}

func parseSDKConfigBytes(raw []byte) (SDKConfig, error) {
	var cfg SDKConfig
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&cfg); err != nil {
		return SDKConfig{}, err
	}
	return normalizeSDKConfig(cfg), nil
}

func normalizeSDKConfig(cfg SDKConfig) SDKConfig {
	cfg.Version = strings.TrimSpace(cfg.Version)
	cfg.WorkDir = strings.TrimSpace(cfg.WorkDir)
	cfg.Target = strings.ToLower(strings.TrimSpace(cfg.Target))
	if cfg.Extra != nil {
		normalised := make(map[string]string, len(cfg.Extra))
		for k, v := range cfg.Extra {
			key := strings.TrimSpace(k)
			if key == "" {
				continue
			}
			normalised[key] = v
		}
		cfg.Extra = normalised
	}
	return cfg
}

func cloneStringMap(m map[string]string) map[string]string {
	clone := make(map[string]string, len(m))
	for k, v := range m {
		clone[k] = v
	}
	return clone
}

func isKnownSDKTarget(target string) bool {
	for _, known := range knownSDKTargets() {
		if target == known {
			return true
		}
	}
	return false
}

func knownSDKTargets() []string {
	return []string{
		"python", "javascript", "typescript", "go", "rust",
		"json", "yaml", "openai", "langgraph", "crewai",
		"csharp", "java", "wasm", "gemini", "autogen",
		"kubernetes", "terraform",
	}
}

func findSDKConfigUpwards(dir string) (string, error) {
	current, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolve %s: %w", dir, err)
	}
	for {
		candidate := filepath.Join(current, sdkConfigFileName)
		if configFileExists(candidate) {
			return candidate, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", nil
		}
		current = parent
	}
}

func applySDKEnvOverrides(cfg SDKConfig) SDKConfig {
	if v := strings.TrimSpace(os.Getenv("MAM_VERSION")); v != "" {
		cfg.Version = v
	}
	if v := strings.TrimSpace(os.Getenv("MAM_WORK_DIR")); v != "" {
		cfg.WorkDir = v
	}
	if v := strings.TrimSpace(os.Getenv("MAM_TARGET")); v != "" {
		cfg.Target = strings.ToLower(v)
	}
	if v := strings.TrimSpace(os.Getenv("MAM_VERBOSE")); v != "" {
		cfg.Verbose = v == "1" || strings.EqualFold(v, "true") || strings.EqualFold(v, "yes")
	}
	if v := strings.TrimSpace(os.Getenv("MAM_EXTRA")); v != "" {
		for k, value := range parseExtraList(v) {
			if cfg.Extra == nil {
				cfg.Extra = make(map[string]string)
			}
			cfg.Extra[k] = value
		}
	}
	return cfg
}

func parseExtraList(list string) map[string]string {
	result := make(map[string]string)
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		key, value, found := strings.Cut(item, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			continue
		}
		result[key] = strings.TrimSpace(value)
	}
	return result
}

func expandConfigPath(path string) string {
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, path[2:])
		}
	}
	return os.ExpandEnv(path)
}

func configFileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func isVersionLike(version string) bool {
	if version == "" {
		return false
	}
	for i, part := range strings.Split(version, ".") {
		if part == "" {
			return false
		}
		for _, r := range part {
			if r < '0' || r > '9' {
				return false
			}
		}
		if i == 0 && len(part) > 1 && part[0] == '0' {
			return false
		}
	}
	return true
}
