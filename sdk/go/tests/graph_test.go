package tests

import (
	"strings"
	"testing"

	mam "github.com/LifeJiggy/MAM/sdk/go/mam"
)

const graphFixture = `---
title: Graph Me
version: 1.0.0
---

## Purpose

A module for graphs.

## Python

` + "```python\nprint('hi')\n```" + `
`

func TestBuildDepGraph(t *testing.T) {
	mod, err := mam.ParseString(graphFixture, "graph.mam.md")
	if err != nil {
		t.Fatal(err)
	}
	g := mam.BuildDepGraph(mod)
	names := g.NodeNames()
	joined := strings.Join(names, ",")
	for _, want := range []string{"Purpose", "Python", "runtime:python", "frontmatter"} {
		if !strings.Contains(joined, want) {
			t.Errorf("graph missing node %q in %v", want, names)
		}
	}
	if g.EdgeCount() == 0 {
		t.Error("expected edges from sections to runtimes")
	}
}

func TestBuildDepGraphNil(t *testing.T) {
	g := mam.BuildDepGraph(nil)
	if len(g.NodeNames()) != 0 || g.EdgeCount() != 0 {
		t.Error("nil module must build an empty graph")
	}
}

func TestTopoSortOrder(t *testing.T) {
	g := &mam.DepGraph{
		Nodes: []mam.DepNode{{Name: "a"}, {Name: "b"}, {Name: "c"}},
		Edges: []mam.DepEdge{{From: "a", To: "b"}, {From: "b", To: "c"}},
	}
	order, err := g.TopoSort()
	if err != nil {
		t.Fatalf("TopoSort() error: %v", err)
	}
	if strings.Join(order, ",") != "a,b,c" {
		t.Errorf("order = %v, want a,b,c", order)
	}
}

func TestTopoSortCycle(t *testing.T) {
	g := &mam.DepGraph{
		Nodes: []mam.DepNode{{Name: "a"}, {Name: "b"}},
		Edges: []mam.DepEdge{{From: "a", To: "b"}, {From: "b", To: "a"}},
	}
	if _, err := g.TopoSort(); err == nil {
		t.Fatal("expected cycle error")
	} else if !strings.Contains(err.Error(), "cycle") {
		t.Errorf("error %q must mention cycle", err)
	}
}

func TestTopoSortEmpty(t *testing.T) {
	g := &mam.DepGraph{}
	order, err := g.TopoSort()
	if err != nil || len(order) != 0 {
		t.Errorf("empty sort = %v, %v; want [], nil", order, err)
	}
}

func TestNodeNames(t *testing.T) {
	g := &mam.DepGraph{
		Nodes: []mam.DepNode{{Name: "b"}, {Name: "a"}},
	}
	names := g.NodeNames()
	if strings.Join(names, ",") != "a,b" {
		t.Errorf("names = %v, want sorted", names)
	}
}

func TestEdgeCount(t *testing.T) {
	g := &mam.DepGraph{Edges: []mam.DepEdge{{From: "a", To: "b"}}}
	if g.EdgeCount() != 1 {
		t.Errorf("EdgeCount() = %d, want 1", g.EdgeCount())
	}
	if (&mam.DepGraph{}).EdgeCount() != 0 {
		t.Error("empty EdgeCount() must be 0")
	}
}

func TestModuleRootNode(t *testing.T) {
	mod, err := mam.ParseString("## Purpose\n\nHi.\n", "rooted.mam.md")
	if err != nil {
		t.Fatal(err)
	}
	g := mam.BuildDepGraph(mod)
	found := false
	for _, name := range g.NodeNames() {
		if strings.Contains(name, "rooted.mam.md") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected module root node in %v", g.NodeNames())
	}
}
