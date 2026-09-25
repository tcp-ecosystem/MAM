package mam

import (
	"fmt"
	"sort"
	"strings"
)

// DepNode is a single node in a module dependency graph.
type DepNode struct {
	Name string
	Type string
}

// DepEdge is a directed dependency between two nodes.
type DepEdge struct {
	From  string
	To    string
	Label string
}

// DepGraph is a directed graph of module dependencies.
//
// Node taxonomy:
//   - "module:<path-or-title>" — the root node every other node hangs from.
//   - "frontmatter" — present when the module has a YAML front matter
//     block, linked from the root with a "describes" edge.
//   - "<Section Title>" — one node per section, typed by SectionType
//     (falling back to "section"), linked from the root with a
//     "contains" edge.
//   - "runtime:<lang>" — one pseudo-node per code language used anywhere
//     in the module, linked from each section that embeds it. The edge
//     label carries the original language tag.
//
// Edges are deduplicated and nodes are kept sorted by name so that two
// builds of the same module always produce identical graphs.
type DepGraph struct {
	Nodes []DepNode
	Edges []DepEdge
}

// BuildDepGraph derives a dependency graph from a module. A nil module
// yields an empty graph. Nodes and edges are deduplicated and nodes are
// sorted by name for deterministic output. Edges that would dangle (an
// endpoint with no node) are pruned before the graph is returned.
func BuildDepGraph(mod *Module) *DepGraph {
	g := newDepGraph()
	if mod == nil {
		return g
	}
	root := moduleRootName(mod)
	g.addNode(root, "module")
	if mod.FrontMatter != nil {
		g.addNode("frontmatter", "frontmatter")
		g.addEdge(root, "frontmatter", "describes")
	}
	for _, s := range mod.Sections {
		sectionType := string(s.SectionType)
		if sectionType == "" {
			sectionType = "section"
		}
		g.addNode(s.Title, sectionType)
		g.addEdge(root, s.Title, "contains")
		for _, cb := range s.CodeBlocks {
			runtime := "runtime:" + normalizeRuntimeLabel(cb.Language)
			g.addNode(runtime, "runtime")
			g.addEdge(s.Title, runtime, cb.Language)
		}
	}
	g.pruneDanglingEdges()
	g.sortNodes()
	g.sortEdges()
	return g
}

// TopoSort returns node names in dependency order such that every edge
// From appears before its To.
//
// The implementation is Kahn's algorithm with lexicographically sorted
// frontiers, so the output is fully deterministic: the same graph always
// yields the same order, and independent nodes appear alphabetically.
// Endpoints that only occur inside edges are treated as first-class
// nodes, which keeps the sort total even for graphs built by hand.
//
// It returns a descriptive error naming the cycle (e.g. "a -> b -> a")
// when the graph is not a DAG. An empty graph sorts to an empty order
// with no error.
func (g *DepGraph) TopoSort() ([]string, error) {
	inDegree := buildInDegrees(g)
	adj := adjacencyOf(g)
	var queue []string
	for name, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, name)
		}
	}
	sort.Strings(queue)
	var order []string
	for len(queue) > 0 {
		name := queue[0]
		queue = queue[1:]
		order = append(order, name)
		targets := append([]string(nil), adj[name]...)
		sort.Strings(targets)
		for _, to := range targets {
			inDegree[to]--
			if inDegree[to] == 0 {
				queue = append(queue, to)
			}
		}
		sort.Strings(queue)
	}
	if len(order) != len(inDegree) {
		if cycle := detectCyclePath(g); len(cycle) > 0 {
			return nil, fmt.Errorf("dependency cycle detected: %s", formatCyclePath(cycle))
		}
		return nil, fmt.Errorf("dependency cycle detected")
	}
	return order, nil
}

// NodeNames returns every node name in sorted order.
func (g *DepGraph) NodeNames() []string {
	names := make([]string, 0, len(g.Nodes))
	for _, n := range g.Nodes {
		names = append(names, n.Name)
	}
	sort.Strings(names)
	return names
}

// EdgeCount returns the number of edges in the graph.
func (g *DepGraph) EdgeCount() int {
	return len(g.Edges)
}

func newDepGraph() *DepGraph {
	return &DepGraph{}
}

func (g *DepGraph) addNode(name, typ string) {
	if g.hasNode(name) {
		return
	}
	g.Nodes = append(g.Nodes, DepNode{Name: name, Type: typ})
}

func (g *DepGraph) addEdge(from, to, label string) {
	for _, e := range g.Edges {
		if e.From == from && e.To == to && e.Label == label {
			return
		}
	}
	g.Edges = append(g.Edges, DepEdge{From: from, To: to, Label: label})
}

func (g *DepGraph) sortNodes() {
	sort.Slice(g.Nodes, func(i, j int) bool { return g.Nodes[i].Name < g.Nodes[j].Name })
}

func (g *DepGraph) sortEdges() {
	sort.Slice(g.Edges, func(i, j int) bool {
		if g.Edges[i].From != g.Edges[j].From {
			return g.Edges[i].From < g.Edges[j].From
		}
		if g.Edges[i].To != g.Edges[j].To {
			return g.Edges[i].To < g.Edges[j].To
		}
		return g.Edges[i].Label < g.Edges[j].Label
	})
}

func (g *DepGraph) hasNode(name string) bool {
	for _, n := range g.Nodes {
		if n.Name == name {
			return true
		}
	}
	return false
}

func (g *DepGraph) pruneDanglingEdges() {
	kept := g.Edges[:0]
	for _, e := range g.Edges {
		if g.hasNode(e.From) && g.hasNode(e.To) {
			kept = append(kept, e)
		}
	}
	for i := len(kept); i < len(g.Edges); i++ {
		g.Edges[i] = DepEdge{}
	}
	g.Edges = kept
}

func moduleRootName(mod *Module) string {
	if mod.Path != "" {
		return "module:" + mod.Path
	}
	if mod.FrontMatter != nil && mod.FrontMatter.Title != "" {
		return "module:" + mod.FrontMatter.Title
	}
	return "module:root"
}

func formatCyclePath(cycle []string) string {
	return strings.Join(cycle, " -> ")
}

func buildInDegrees(g *DepGraph) map[string]int {
	inDegree := make(map[string]int, len(g.Nodes))
	for _, n := range g.Nodes {
		inDegree[n.Name] = 0
	}
	for _, e := range g.Edges {
		if _, ok := inDegree[e.From]; !ok {
			inDegree[e.From] = 0
		}
		if _, ok := inDegree[e.To]; !ok {
			inDegree[e.To] = 0
		}
		inDegree[e.To]++
	}
	return inDegree
}

func adjacencyOf(g *DepGraph) map[string][]string {
	adj := make(map[string][]string, len(g.Nodes))
	for _, n := range g.Nodes {
		adj[n.Name] = nil
	}
	for _, e := range g.Edges {
		adj[e.From] = append(adj[e.From], e.To)
		if _, ok := adj[e.To]; !ok {
			adj[e.To] = nil
		}
	}
	return adj
}

func detectCyclePath(g *DepGraph) []string {
	adj := adjacencyOf(g)
	visited := make(map[string]bool, len(g.Nodes))
	var stack []string
	var cycle []string
	var visit func(node string) bool
	visit = func(node string) bool {
		if containsString(stack, node) {
			cycle = append(append([]string(nil), stack[indexOfString(stack, node):]...), node)
			return true
		}
		if visited[node] {
			return false
		}
		visited[node] = true
		stack = append(stack, node)
		targets := append([]string(nil), adj[node]...)
		sort.Strings(targets)
		for _, to := range targets {
			if visit(to) {
				return true
			}
		}
		stack = stack[:len(stack)-1]
		return false
	}
	names := g.NodeNames()
	for _, name := range names {
		if visit(name) {
			return cycle
		}
	}
	return nil
}

func normalizeRuntimeLabel(lang string) string {
	trimmed := strings.TrimSpace(strings.ToLower(lang))
	if trimmed == "" {
		return "unknown"
	}
	return trimmed
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func indexOfString(items []string, target string) int {
	for i, item := range items {
		if item == target {
			return i
		}
	}
	return -1
}

