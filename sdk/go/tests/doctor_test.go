package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

func TestCheckGoRuntime(t *testing.T) {
	result := mam.CheckGoRuntime()
	if result.Name != "go-runtime" {
		t.Errorf("Name = %q", result.Name)
	}
	if result.Status != mam.CheckPass {
		t.Errorf("Status = %q, want pass", result.Status)
	}
	if !strings.Contains(result.Message, "Go") {
		t.Errorf("Message = %q, want Go version", result.Message)
	}
}

func TestCheckWorkDirReadable(t *testing.T) {
	if got := mam.CheckWorkDirReadable(t.TempDir()); got.Status != mam.CheckPass {
		t.Errorf("temp dir Status = %q, want pass", got.Status)
	}
	if got := mam.CheckWorkDirReadable(""); got.Status != mam.CheckFail {
		t.Error("empty dir must fail")
	}
	missing := filepath.Join(t.TempDir(), "nope")
	if got := mam.CheckWorkDirReadable(missing); got.Status != mam.CheckFail {
		t.Error("missing dir must fail")
	}
	file := filepath.Join(t.TempDir(), "file.txt")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if got := mam.CheckWorkDirReadable(file); got.Status != mam.CheckFail {
		t.Error("plain file must fail")
	}
}

func TestRunDoctorChecks(t *testing.T) {
	checks := mam.RunDoctorChecks(t.TempDir())
	if len(checks) != 11 {
		t.Fatalf("len(checks) = %d, want 11", len(checks))
	}
	names := make([]string, 0, len(checks))
	for _, c := range checks {
		names = append(names, c.Name)
		if c.Status != mam.CheckPass && c.Status != mam.CheckWarn && c.Status != mam.CheckFail {
			t.Errorf("check %q has bad status %q", c.Name, c.Status)
		}
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{"go-runtime", "work-dir", "sdk-config", "mamc-path"} {
		if !strings.Contains(joined, want) {
			t.Errorf("suite missing %q in %v", want, names)
		}
	}
}

func TestFormatCheckReport(t *testing.T) {
	checks := []mam.CheckResult{
		{Name: "a", Status: mam.CheckPass, Message: "ok"},
		{Name: "b", Status: mam.CheckFail, Message: "bad"},
	}
	text := mam.FormatCheckReport(checks)
	if !strings.Contains(text, "[PASS]") || !strings.Contains(text, "[FAIL]") {
		t.Errorf("report missing statuses: %q", text)
	}
	if !strings.Contains(text, "failed: b") {
		t.Errorf("report missing failed list: %q", text)
	}
	if !strings.Contains(text, "1 passed") {
		t.Errorf("report missing summary: %q", text)
	}
}

func TestHasFailingChecks(t *testing.T) {
	passing := []mam.CheckResult{{Name: "a", Status: mam.CheckPass, Message: "ok"}}
	if mam.HasFailingChecks(passing) {
		t.Error("passing suite must not fail")
	}
	if mam.HasFailingChecks(nil) {
		t.Error("empty suite must not fail")
	}
	failing := []mam.CheckResult{{Name: "b", Status: mam.CheckFail, Message: "bad"}}
	if !mam.HasFailingChecks(failing) {
		t.Error("failing suite must fail")
	}
}

func TestCountChecksByStatus(t *testing.T) {
	checks := []mam.CheckResult{
		{Name: "a", Status: mam.CheckPass, Message: "ok"},
		{Name: "b", Status: mam.CheckWarn, Message: "hmm"},
		{Name: "c", Status: mam.CheckFail, Message: "bad"},
	}
	counts := mam.CountChecksByStatus(checks)
	if counts[mam.CheckPass] != 1 || counts[mam.CheckWarn] != 1 || counts[mam.CheckFail] != 1 {
		t.Errorf("counts = %v", counts)
	}
}

func TestDoctorEndToEndTmp(t *testing.T) {
	dir := t.TempDir()
	checks := mam.RunDoctorChecks(dir)
	text := mam.FormatCheckReport(checks)
	if !strings.Contains(text, "sdk-config") {
		t.Errorf("report must mention sdk-config: %q", text)
	}
	counts := mam.CountChecksByStatus(checks)
	total := counts[mam.CheckPass] + counts[mam.CheckWarn] + counts[mam.CheckFail]
	if total != len(checks) {
		t.Errorf("counts %v do not sum to %d", counts, len(checks))
	}
}
