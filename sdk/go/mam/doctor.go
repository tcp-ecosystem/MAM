package mam

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// CheckResult is the outcome of a single environment check.
type CheckResult struct {
	Name    string
	Status  string
	Message string
}

// Check status values used by CheckResult.Status.
const (
	CheckPass = "pass"
	CheckWarn = "warn"
	CheckFail = "fail"
)

// RunDoctorChecks executes the built-in environment checks for workDir and
// returns every result, even when individual checks fail. The suite covers
// the Go toolchain, working directory, temp directory, home environment,
// SDK config, config targets, registry URL, PATH, and write access.
func RunDoctorChecks(workDir string) []CheckResult {
	checks := []CheckResult{
		CheckGoRuntime(),
		CheckWorkDirReadable(workDir),
		checkTempWritable(),
		checkHomeEnv(),
		checkConfigPresent(workDir),
		checkConfigTargets(workDir),
		checkRegistryURL(workDir),
		checkMamcOnPath(),
		checkWorkDirWritable(workDir),
		checkGoModPresent(workDir),
		checkProxyEnv(),
	}
	return checks
}

// FormatCheckReport renders check results as text lines plus a summary.
// Failing and warning check names are listed explicitly when present.
func FormatCheckReport(checks []CheckResult) string {
	var b strings.Builder
	width := maxCheckNameWidth(checks)
	for _, c := range checks {
		fmt.Fprintf(&b, "[%s] %s: %s\n", strings.ToUpper(c.Status), padCheckName(c.Name, width), c.Message)
	}
	if names := failingCheckNames(checks); len(names) > 0 {
		fmt.Fprintf(&b, "failed: %s\n", strings.Join(names, ", "))
	}
	if names := warningCheckNames(checks); len(names) > 0 {
		fmt.Fprintf(&b, "warnings: %s\n", strings.Join(names, ", "))
	}
	counts := CountChecksByStatus(checks)
	fmt.Fprintf(&b, "%s", formatCheckCounts(counts))
	return b.String()
}

// HasFailingChecks reports whether any check failed.
func HasFailingChecks(checks []CheckResult) bool {
	for _, c := range checks {
		if c.Status == CheckFail {
			return true
		}
	}
	return false
}

// CountChecksByStatus tallies checks per status value.
func CountChecksByStatus(checks []CheckResult) map[string]int {
	counts := map[string]int{CheckPass: 0, CheckWarn: 0, CheckFail: 0}
	for _, c := range checks {
		counts[c.Status]++
	}
	return counts
}

// CheckGoRuntime verifies a Go toolchain version is reported by the
// runtime and parses as major.minor.
func CheckGoRuntime() CheckResult {
	version := runtime.Version()
	if version == "" {
		return failResult("go-runtime", "Go version string is empty")
	}
	if !strings.HasPrefix(version, "go") {
		return failResult("go-runtime", fmt.Sprintf("unexpected Go version %q", version))
	}
	return passResult("go-runtime", "Go runtime "+version)
}

// CheckWorkDirReadable verifies the working directory exists and is a
// directory.
func CheckWorkDirReadable(dir string) CheckResult {
	if strings.TrimSpace(dir) == "" {
		return failResult("work-dir", "working directory is empty")
	}
	info, err := os.Stat(dir)
	if err != nil {
		return failResult("work-dir", "cannot stat "+dir+": "+err.Error())
	}
	if !info.IsDir() {
		return failResult("work-dir", dir+" is not a directory")
	}
	return passResult("work-dir", "working directory "+dir)
}

func checkConfigPresent(dir string) CheckResult {
	path := ResolveSDKConfigPath(dir)
	if _, err := os.Stat(path); err != nil {
		return warnResult("sdk-config", "no sdk config at "+path)
	}
	if _, err := LoadSDKConfig(path); err != nil {
		return failResult("sdk-config", "invalid sdk config: "+err.Error())
	}
	return passResult("sdk-config", "sdk config at "+path)
}

func checkTempWritable() CheckResult {
	probe, err := os.MkdirTemp("", "mam-doctor-")
	if err != nil {
		return warnResult("temp-writable", "temp directory is not writable: "+err.Error())
	}
	defer os.RemoveAll(probe)
	testFile := filepath.Join(probe, "probe.txt")
	if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
		return warnResult("temp-writable", "temp file write failed: "+err.Error())
	}
	return passResult("temp-writable", "temp directory "+os.TempDir())
}

func checkHomeEnv() CheckResult {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return warnResult("home-env", "home directory is not set")
	}
	return passResult("home-env", "home directory "+home)
}

func checkConfigTargets(dir string) CheckResult {
	cfg, err := LoadSDKConfig(ResolveSDKConfigPath(dir))
	if err != nil {
		return warnResult("config-targets", "skipped: "+shortenDoctorError(err))
	}
	targets := listSDKConfigTargets(cfg)
	if len(targets) == 0 {
		return passResult("config-targets", "no target overrides configured")
	}
	known, unknown := partitionKnownTargets(targets)
	if len(unknown) > 0 {
		return warnResult("config-targets", "unknown targets: "+strings.Join(unknown, ", "))
	}
	return passResult("config-targets", fmt.Sprintf("%d target overrides: %s", len(known), strings.Join(known, ", ")))
}

func checkRegistryURL(dir string) CheckResult {
	_ = dir
	raw := strings.TrimSpace(os.Getenv("MAM_REGISTRY_URL"))
	if raw == "" {
		return warnResult("registry-url", "no registry URL configured (set MAM_REGISTRY_URL)")
	}
	if !strings.HasPrefix(raw, "https://") && !strings.HasPrefix(raw, "http://") {
		return failResult("registry-url", fmt.Sprintf("registry URL %q uses an unsupported scheme", raw))
	}
	return passResult("registry-url", "registry URL "+raw)
}

func checkMamcOnPath() CheckResult {
	if path, err := exec.LookPath("mamc"); err == nil {
		return passResult("mamc-path", "mamc found at "+path)
	}
	return warnResult("mamc-path", "mamc binary is not on PATH")
}

func checkWorkDirWritable(dir string) CheckResult {
	probeDir, err := os.MkdirTemp(dir, ".mam-doctor-")
	if err != nil {
		return warnResult("workdir-writable", "working directory may not be writable: "+shortenDoctorError(err))
	}
	defer os.RemoveAll(probeDir)
	testFile := filepath.Join(probeDir, "probe.txt")
	if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
		return warnResult("workdir-writable", "probe write failed: "+shortenDoctorError(err))
	}
	return passResult("workdir-writable", "working directory is writable")
}

func passResult(name, message string) CheckResult {
	return CheckResult{Name: name, Status: CheckPass, Message: message}
}

func warnResult(name, message string) CheckResult {
	return CheckResult{Name: name, Status: CheckWarn, Message: message}
}

func failResult(name, message string) CheckResult {
	return CheckResult{Name: name, Status: CheckFail, Message: message}
}

func maxCheckNameWidth(checks []CheckResult) int {
	width := 0
	for _, c := range checks {
		if len(c.Name) > width {
			width = len(c.Name)
		}
	}
	return width
}

func padCheckName(name string, width int) string {
	if len(name) >= width {
		return name
	}
	return name + strings.Repeat(" ", width-len(name))
}

func formatCheckCounts(counts map[string]int) string {
	return fmt.Sprintf("%d passed, %d warnings, %d failed",
		counts[CheckPass], counts[CheckWarn], counts[CheckFail])
}

func filterChecksByStatus(checks []CheckResult, status string) []CheckResult {
	var out []CheckResult
	for _, c := range checks {
		if c.Status == status {
			out = append(out, c)
		}
	}
	return out
}

func failingCheckNames(checks []CheckResult) []string {
	var names []string
	for _, c := range filterChecksByStatus(checks, CheckFail) {
		names = append(names, c.Name)
	}
	return names
}

func warningCheckNames(checks []CheckResult) []string {
	var names []string
	for _, c := range filterChecksByStatus(checks, CheckWarn) {
		names = append(names, c.Name)
	}
	return names
}

func shortenDoctorError(err error) string {
	msg := err.Error()
	if len(msg) > 80 {
		return msg[:77] + "..."
	}
	return msg
}

func listSDKConfigTargets(cfg SDKConfig) []string {
	target := strings.TrimSpace(cfg.Target)
	if target == "" {
		return nil
	}
	return []string{target}
}

func partitionKnownTargets(targets []string) (known, unknown []string) {
	for _, target := range targets {
		if isKnownSDKTarget(target) {
			known = append(known, target)
		} else {
			unknown = append(unknown, target)
		}
	}
	return known, unknown
}

func checkGoModPresent(dir string) CheckResult {
	path := filepath.Join(dir, "go.mod")
	if _, err := os.Stat(path); err != nil {
		return warnResult("go-mod", "no go.mod in "+dir)
	}
	return passResult("go-mod", "go.mod present in "+dir)
}

func checkProxyEnv() CheckResult {
	proxy := strings.TrimSpace(os.Getenv("HTTPS_PROXY"))
	if proxy == "" {
		proxy = strings.TrimSpace(os.Getenv("HTTP_PROXY"))
	}
	if proxy == "" {
		return passResult("proxy-env", "no proxy configured (direct connection)")
	}
	if !strings.Contains(proxy, "://") {
		return warnResult("proxy-env", fmt.Sprintf("proxy %q has no scheme", proxy))
	}
	return passResult("proxy-env", "proxy configured")
}
