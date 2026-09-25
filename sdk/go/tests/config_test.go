package tests

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

func TestDefaultSDKConfig(t *testing.T) {
	cfg := mam.DefaultSDKConfig()
	if cfg.Version == "" || cfg.WorkDir == "" || cfg.Target == "" {
		t.Fatal("defaults must set version, work_dir, and target")
	}
	if len(cfg.Validate()) != 0 {
		t.Fatalf("defaults must validate, got %v", cfg.Validate())
	}
}

func TestLoadSaveRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "mam.sdk.json")
	want := mam.DefaultSDKConfig()
	want.Verbose = true
	want.Extra = map[string]string{"team": "core"}
	if err := want.Save(path); err != nil {
		t.Fatalf("Save() error: %v", err)
	}
	got, err := mam.LoadSDKConfig(path)
	if err != nil {
		t.Fatalf("LoadSDKConfig() error: %v", err)
	}
	if got.Version != want.Version || got.WorkDir != want.WorkDir || got.Target != want.Target {
		t.Errorf("round trip mismatch: %+v", got)
	}
	if !got.Verbose || got.Extra["team"] != "core" {
		t.Errorf("round trip lost fields: %+v", got)
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := mam.LoadSDKConfig(filepath.Join(t.TempDir(), "nope.json"))
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(path, []byte("{oops"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := mam.LoadSDKConfig(path); err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestValidateSDKConfig(t *testing.T) {
	if problems := (mam.SDKConfig{}).Validate(); len(problems) == 0 {
		t.Fatal("expected problems for empty config")
	}
	bad := mam.DefaultSDKConfig()
	bad.Target = "cobol"
	found := false
	for _, p := range bad.Validate() {
		if strings.Contains(p, "cobol") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected target problem, got %v", bad.Validate())
	}
}

func TestMergeSDKConfig(t *testing.T) {
	base := mam.DefaultSDKConfig()
	merged := mam.MergeSDKConfig(base, mam.SDKConfig{Target: "go", Verbose: true, Extra: map[string]string{"k": "v"}})
	if merged.Target != "go" || !merged.Verbose || merged.Extra["k"] != "v" {
		t.Errorf("merge failed: %+v", merged)
	}
	if base.Target != "python" {
		t.Error("merge must not mutate base")
	}
	merged2 := mam.MergeSDKConfig(base, mam.SDKConfig{})
	if merged2.Target != "python" || merged2.Verbose {
		t.Errorf("empty override must keep base: %+v", merged2)
	}
}

func TestResolveSDKConfigPath(t *testing.T) {
	path := mam.ResolveSDKConfigPath(t.TempDir())
	if !strings.HasSuffix(path, "mam.sdk.json") {
		t.Errorf("unexpected path %q", path)
	}
	if got := mam.ResolveSDKConfigPath(""); !strings.HasSuffix(got, "mam.sdk.json") {
		t.Errorf("empty dir must fall back, got %q", got)
	}
}

func TestSaveRefusesInvalid(t *testing.T) {
	bad := mam.SDKConfig{}
	if err := bad.Save(filepath.Join(t.TempDir(), "x.json")); err == nil {
		t.Fatal("expected refusal for invalid config")
	}
}
