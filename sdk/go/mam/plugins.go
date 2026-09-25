package mam

import (
	"fmt"
	"sync"
)

// Hook points in the MAM pipeline where plugins can inject logic.
type Hook string

const (
	HookBeforeParse   Hook = "before_parse"
	HookAfterParse    Hook = "after_parse"
	HookBeforeExecute Hook = "before_execute"
	HookAfterExecute  Hook = "after_execute"
	HookOnError       Hook = "on_error"
)

// Plugin is the interface every MAM plugin must implement.
type Plugin interface {
	// Name returns a unique identifier for the plugin.
	Name() string

	// Version returns a semver-compatible version string.
	Version() string

	// Hooks returns the set of hooks this plugin wants to register for.
	Hooks() []Hook

	// Handle is called when a registered hook fires. The payload type depends
	// on the hook (see hook-specific doc).
	Handle(hook Hook, ctx *PluginContext) error
}

// PluginContext carries state between the host and a plugin during hook
// execution.
type PluginContext struct {
	Module   *Module
	Extra    map[string]interface{}
	Error    error
	Cancelled bool
}

// PluginRegistry manages plugin registration and dispatch.
type PluginRegistry struct {
	mu      sync.RWMutex
	plugins map[string]Plugin
	hooks   map[Hook][]string // hook -> ordered plugin names
}

// NewPluginRegistry creates an empty registry.
func NewPluginRegistry() *PluginRegistry {
	return &PluginRegistry{
		plugins: make(map[string]Plugin),
		hooks:   make(map[Hook][]string),
	}
}

// Register adds a plugin and wires up its hooks.
func (r *PluginRegistry) Register(p Plugin) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := p.Name()
	if _, exists := r.plugins[name]; exists {
		return fmt.Errorf("plugin %q already registered", name)
	}
	r.plugins[name] = p
	for _, h := range p.Hooks() {
		r.hooks[h] = append(r.hooks[h], name)
	}
	return nil
}

// Unregister removes a plugin by name and cleans up hook registrations.
func (r *PluginRegistry) Unregister(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	delete(r.plugins, name)
	for h, list := range r.hooks {
		var filtered []string
		for _, n := range list {
			if n != name {
				filtered = append(filtered, n)
			}
		}
		r.hooks[h] = filtered
	}
}

// Fire invokes every plugin registered for the given hook in registration
// order. Execution stops early if any plugin returns an error or marks the
// context as cancelled.
func (r *PluginRegistry) Fire(hook Hook, ctx *PluginContext) error {
	r.mu.RLock()
	names := r.hooks[hook]
	r.mu.RUnlock()

	for _, name := range names {
		r.mu.RLock()
		p, ok := r.plugins[name]
		r.mu.RUnlock()
		if !ok {
			continue
		}
		if err := p.Handle(hook, ctx); err != nil {
			return fmt.Errorf("plugin %s: %w", name, err)
		}
		if ctx.Cancelled {
			break
		}
	}
	return nil
}

// Plugins returns the names of all registered plugins.
func (r *PluginRegistry) Plugins() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var names []string
	for name := range r.plugins {
		names = append(names, name)
	}
	return names
}

// Get returns the plugin with the given name, or false when absent.
func (r *PluginRegistry) Get(name string) (Plugin, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.plugins[name]
	return p, ok
}

// MustRegister registers a plugin and panics on error. It is intended for
// static setup where duplicates are programming errors.
func (r *PluginRegistry) MustRegister(p Plugin) {
	if err := r.Register(p); err != nil {
		panic(err)
	}
}

// HookNames returns the ordered plugin names registered for a hook.
func (r *PluginRegistry) HookNames(hook Hook) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return append([]string(nil), r.hooks[hook]...)
}

// Count returns the number of registered plugins.
func (r *PluginRegistry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.plugins)
}

// Clear removes every registered plugin and hook wiring.
func (r *PluginRegistry) Clear() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.plugins = make(map[string]Plugin)
	r.hooks = make(map[Hook][]string)
}

// KnownHooks returns every hook point in the MAM pipeline.
func KnownHooks() []Hook {
	return []Hook{HookBeforeParse, HookAfterParse, HookBeforeExecute, HookAfterExecute, HookOnError}
}

// NewPluginContext creates a hook context for the given module.
func NewPluginContext(mod *Module) *PluginContext {
	return &PluginContext{Module: mod, Extra: make(map[string]interface{})}
}

// ---- built-in helper plugin -----------------------------------------------

// FuncPlugin is a convenience adapter that turns plain functions into a
// Plugin implementation.  Useful for ad-hoc hooks or testing.
type FuncPlugin struct {
	NameVal    string
	VersionVal string
	HooksVal   []Hook
	Handler    func(Hook, *PluginContext) error
}

func (f *FuncPlugin) Name() string     { return f.NameVal }
func (f *FuncPlugin) Version() string  { return f.VersionVal }
func (f *FuncPlugin) Hooks() []Hook    { return f.HooksVal }
func (f *FuncPlugin) Handle(h Hook, ctx *PluginContext) error {
	if f.Handler != nil {
		return f.Handler(h, ctx)
	}
	return nil
}
