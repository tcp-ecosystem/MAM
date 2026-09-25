package tests

import (
	"strings"
	"testing"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

func TestListStarterKinds(t *testing.T) {
	kinds := mam.ListStarterKinds()
	if strings.Join(kinds, ",") != "agent,module,tool" {
		t.Errorf("kinds = %v, want sorted agent,module,tool", kinds)
	}
}

func TestGetStarterTemplate(t *testing.T) {
	tmpl, err := mam.GetStarterTemplate("module")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tmpl, "{{name}}") {
		t.Error("module starter must contain placeholders")
	}
	agent, err := mam.GetStarterTemplate("bot")
	if err != nil {
		t.Fatalf("alias lookup error: %v", err)
	}
	if !strings.Contains(agent, "role") {
		t.Error("bot alias must resolve to the agent starter")
	}
	if _, err := mam.GetStarterTemplate("spaceship"); err == nil {
		t.Fatal("expected error for unknown kind")
	} else if !strings.Contains(err.Error(), "mod") {
		t.Errorf("error %q should list valid kinds", err)
	}
}

func TestRenderStarter(t *testing.T) {
	got := mam.RenderStarter("Hello {{name}}!", map[string]string{"name": "MAM"})
	if got != "Hello MAM!" {
		t.Errorf("RenderStarter() = %q, want greeting", got)
	}
	if got := mam.RenderStarter("Hi {{missing}}", nil); got != "Hi {{missing}}" {
		t.Errorf("unknown placeholders must survive, got %q", got)
	}
}

func TestStarterVariables(t *testing.T) {
	vars := mam.StarterVariables("{{a}} {{b}} {{a}}")
	if strings.Join(vars, ",") != "a,b" {
		t.Errorf("vars = %v, want deduplicated order", vars)
	}
	if len(mam.StarterVariables("no vars")) != 0 {
		t.Error("expected no variables")
	}
}

func TestNewModuleStarter(t *testing.T) {
	rendered, err := mam.NewModuleStarter("Demo", "module", nil)
	if err != nil {
		t.Fatalf("NewModuleStarter() error: %v", err)
	}
	for _, want := range []string{"Demo", "## Purpose", "Describe Demo."} {
		if !strings.Contains(rendered, want) {
			t.Errorf("starter missing %q", want)
		}
	}
	if strings.Contains(rendered, "{{") {
		t.Error("starter must not contain unrendered placeholders")
	}
	if _, err := mam.NewModuleStarter("Demo", "spaceship", nil); err == nil {
		t.Fatal("expected error for unknown kind")
	}
	if _, err := mam.NewModuleStarter("   ", "module", nil); err == nil {
		t.Fatal("expected error for blank name")
	}
}

func TestValidateStarterName(t *testing.T) {
	if len(mam.ValidateStarterName("Good Name-1")) != 0 {
		t.Error("valid name must pass")
	}
	if len(mam.ValidateStarterName("  ")) == 0 {
		t.Error("blank name must fail")
	}
	if len(mam.ValidateStarterName("bad/name")) == 0 {
		t.Error("slash name must fail")
	}
	long := strings.Repeat("a", 65)
	if len(mam.ValidateStarterName(long)) == 0 {
		t.Error("overlong name must fail")
	}
}

func TestStarterFileName(t *testing.T) {
	if got := mam.StarterFileName("My Module"); got != "my-module.mam.md" {
		t.Errorf("StarterFileName() = %q", got)
	}
	if got := mam.StarterFileName("!!!"); got != "module.mam.md" {
		t.Errorf("StarterFileName() fallback = %q", got)
	}
}
