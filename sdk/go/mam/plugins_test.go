package mam

import (
	"errors"
	"testing"
)

func TestNewPluginRegistry(t *testing.T) {
	r := NewPluginRegistry()
	if r == nil {
		t.Fatal("NewPluginRegistry returned nil")
	}
	plugins := r.Plugins()
	if len(plugins) != 0 {
		t.Errorf("Plugins() len = %d, want 0", len(plugins))
	}
}

func TestPluginRegistryRegisterAndGet(t *testing.T) {
	r := NewPluginRegistry()
	p := &FuncPlugin{
		NameVal:    "test-plugin",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
	}
	if err := r.Register(p); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	names := r.Plugins()
	if len(names) != 1 {
		t.Fatalf("Plugins() len = %d, want 1", len(names))
	}
	if names[0] != "test-plugin" {
		t.Errorf("Plugins()[0] = %q, want %q", names[0], "test-plugin")
	}
}

func TestPluginRegistryDuplicateRegister(t *testing.T) {
	r := NewPluginRegistry()
	p1 := &FuncPlugin{NameVal: "dup", VersionVal: "1.0.0", HooksVal: []Hook{HookAfterParse}}
	p2 := &FuncPlugin{NameVal: "dup", VersionVal: "2.0.0", HooksVal: []Hook{HookAfterParse}}
	if err := r.Register(p1); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	if err := r.Register(p2); err == nil {
		t.Fatal("expected error for duplicate registration")
	}
}

func TestPluginRegistryUnregister(t *testing.T) {
	r := NewPluginRegistry()
	p := &FuncPlugin{NameVal: "removable", VersionVal: "1.0.0", HooksVal: []Hook{HookAfterParse}}
	if err := r.Register(p); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	r.Unregister("removable")
	names := r.Plugins()
	if len(names) != 0 {
		t.Errorf("Plugins() len = %d, want 0", len(names))
	}
}

func TestPluginRegistryUnregisterNonexistent(t *testing.T) {
	r := NewPluginRegistry()
	r.Unregister("nonexistent")
	names := r.Plugins()
	if len(names) != 0 {
		t.Errorf("Plugins() len = %d, want 0 after unregistering nonexistent", len(names))
	}
}

func TestPluginRegistryMultiplePlugins(t *testing.T) {
	r := NewPluginRegistry()
	p1 := &FuncPlugin{NameVal: "alpha", VersionVal: "1.0.0", HooksVal: []Hook{HookAfterParse}}
	p2 := &FuncPlugin{NameVal: "beta", VersionVal: "1.0.0", HooksVal: []Hook{HookBeforeExecute}}
	p3 := &FuncPlugin{NameVal: "gamma", VersionVal: "1.0.0", HooksVal: []Hook{HookAfterParse, HookBeforeExecute}}
	for _, p := range []Plugin{p1, p2, p3} {
		if err := r.Register(p); err != nil {
			t.Fatalf("Register(%q) error: %v", p.Name(), err)
		}
	}
	names := r.Plugins()
	if len(names) != 3 {
		t.Errorf("Plugins() len = %d, want 3", len(names))
	}
}

func TestPluginRegistryFire(t *testing.T) {
	r := NewPluginRegistry()
	fired := false
	p := &FuncPlugin{
		NameVal:    "firing",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
		Handler: func(hook Hook, ctx *PluginContext) error {
			fired = true
			return nil
		},
	}
	if err := r.Register(p); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	ctx := &PluginContext{
		Module: &Module{},
		Extra:  make(map[string]interface{}),
	}
	if err := r.Fire(HookAfterParse, ctx); err != nil {
		t.Fatalf("Fire() error: %v", err)
	}
	if !fired {
		t.Error("plugin handler was not called")
	}
}

func TestPluginRegistryFireNotRegistered(t *testing.T) {
	r := NewPluginRegistry()
	ctx := &PluginContext{Module: &Module{}, Extra: make(map[string]interface{})}
	if err := r.Fire(HookAfterParse, ctx); err != nil {
		t.Fatalf("Fire() on empty registry should not error: %v", err)
	}
}

func TestPluginRegistryFireError(t *testing.T) {
	r := NewPluginRegistry()
	p := &FuncPlugin{
		NameVal:    "erroring",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
		Handler: func(hook Hook, ctx *PluginContext) error {
			return errors.New("plugin failed")
		},
	}
	if err := r.Register(p); err != nil {
		t.Fatalf("Register() error: %v", err)
	}
	ctx := &PluginContext{Module: &Module{}, Extra: make(map[string]interface{})}
	if err := r.Fire(HookAfterParse, ctx); err == nil {
		t.Fatal("expected error from plugin handler")
	}
}

func TestPluginRegistryFireCancel(t *testing.T) {
	r := NewPluginRegistry()
	callCount := 0
	p1 := &FuncPlugin{
		NameVal:    "first",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
		Handler: func(hook Hook, ctx *PluginContext) error {
			callCount++
			ctx.Cancelled = true
			return nil
		},
	}
	p2 := &FuncPlugin{
		NameVal:    "second",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
		Handler: func(hook Hook, ctx *PluginContext) error {
			callCount++
			return nil
		},
	}
	if err := r.Register(p1); err != nil {
		t.Fatalf("Register(p1) error: %v", err)
	}
	if err := r.Register(p2); err != nil {
		t.Fatalf("Register(p2) error: %v", err)
	}
	ctx := &PluginContext{Module: &Module{}, Extra: make(map[string]interface{})}
	if err := r.Fire(HookAfterParse, ctx); err != nil {
		t.Fatalf("Fire() error: %v", err)
	}
	if callCount != 1 {
		t.Errorf("callCount = %d, want 1 (second plugin should not fire after cancel)", callCount)
	}
}

func TestPluginRegistryFireOrder(t *testing.T) {
	r := NewPluginRegistry()
	var order []string
	for _, name := range []string{"first", "second", "third"} {
		name := name
		p := &FuncPlugin{
			NameVal:    name,
			VersionVal: "1.0.0",
			HooksVal:   []Hook{HookAfterParse},
			Handler: func(hook Hook, ctx *PluginContext) error {
				order = append(order, name)
				return nil
			},
		}
		if err := r.Register(p); err != nil {
			t.Fatalf("Register(%q) error: %v", name, err)
		}
	}
	ctx := &PluginContext{Module: &Module{}, Extra: make(map[string]interface{})}
	if err := r.Fire(HookAfterParse, ctx); err != nil {
		t.Fatalf("Fire() error: %v", err)
	}
	expected := []string{"first", "second", "third"}
	if len(order) != len(expected) {
		t.Fatalf("order len = %d, want %d", len(order), len(expected))
	}
	for i, name := range expected {
		if order[i] != name {
			t.Errorf("order[%d] = %q, want %q", i, order[i], name)
		}
	}
}

func TestHookConstants(t *testing.T) {
	if HookBeforeParse != "before_parse" {
		t.Errorf("HookBeforeParse = %q, want %q", HookBeforeParse, "before_parse")
	}
	if HookAfterParse != "after_parse" {
		t.Errorf("HookAfterParse = %q, want %q", HookAfterParse, "after_parse")
	}
	if HookBeforeExecute != "before_execute" {
		t.Errorf("HookBeforeExecute = %q, want %q", HookBeforeExecute, "before_execute")
	}
	if HookAfterExecute != "after_execute" {
		t.Errorf("HookAfterExecute = %q, want %q", HookAfterExecute, "after_execute")
	}
	if HookOnError != "on_error" {
		t.Errorf("HookOnError = %q, want %q", HookOnError, "on_error")
	}
}

func TestFuncPluginNilHandler(t *testing.T) {
	p := &FuncPlugin{
		NameVal:    "nil-handler",
		VersionVal: "1.0.0",
		HooksVal:   []Hook{HookAfterParse},
		Handler:    nil,
	}
	ctx := &PluginContext{Module: &Module{}, Extra: make(map[string]interface{})}
	err := p.Handle(HookAfterParse, ctx)
	if err != nil {
		t.Fatalf("nil handler should return nil, got: %v", err)
	}
}

func TestFuncPluginFields(t *testing.T) {
	p := &FuncPlugin{
		NameVal:    "my-plugin",
		VersionVal: "2.0.0",
		HooksVal:   []Hook{HookBeforeExecute, HookAfterExecute},
	}
	if p.Name() != "my-plugin" {
		t.Errorf("Name() = %q, want %q", p.Name(), "my-plugin")
	}
	if p.Version() != "2.0.0" {
		t.Errorf("Version() = %q, want %q", p.Version(), "2.0.0")
	}
	if len(p.Hooks()) != 2 {
		t.Errorf("Hooks() len = %d, want 2", len(p.Hooks()))
	}
}

func TestPluginContext(t *testing.T) {
	mod := &Module{Path: "test.mam.md"}
	extra := map[string]interface{}{"key": "value"}
	ctx := &PluginContext{
		Module: mod,
		Extra:  extra,
	}
	if ctx.Module != mod {
		t.Error("Module mismatch")
	}
	if ctx.Extra["key"] != "value" {
		t.Errorf("Extra[key] = %v, want %q", ctx.Extra["key"], "value")
	}
	if ctx.Cancelled {
		t.Error("default Cancelled should be false")
	}
}
