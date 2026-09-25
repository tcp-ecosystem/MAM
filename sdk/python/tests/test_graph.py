"""Tests for the dependency graph module."""

import pytest

from mam.graph import (
    DependencyGraph,
    GraphEdge,
    GraphNode,
    build_graph,
    count_edges_by_label,
    count_nodes_by_type,
    edge_labels,
    filter_nodes,
    format_graph_text,
    has_edge,
    has_node,
    leaf_nodes,
    node_names,
    node_type,
    nodes_of_type,
    predecessors,
    reachable_from,
    root_nodes,
    successors,
    summarize_graph,
    topological_sort,
)
from mam.parser import parse_mam

DOC = """---
id: graph
name: Graph Me
version: 2.0.0
runtime: python
dependencies:
  - pip:requests
---

## Purpose

A module for graphs.

## Python

```python
print(1)
```
"""


@pytest.fixture
def graph() -> DependencyGraph:
    return build_graph(parse_mam(DOC).ast)


def _linear() -> DependencyGraph:
    graph = DependencyGraph(
        nodes=[GraphNode(name="a", type="x"), GraphNode(name="b", type="x")],
        edges=[GraphEdge(source="a", target="b", label="")],
    )
    return graph.index()


class TestBuild:
    def test_builds_expected_nodes(self, graph: DependencyGraph) -> None:
        names = node_names(graph)
        assert "frontmatter" in names
        assert "runtime:python" in names
        assert "dependency:pip:requests" in names
        assert "Purpose" in names
        assert "Python" in names

    def test_builds_code_block_nodes(self, graph: DependencyGraph) -> None:
        assert count_nodes_by_type(graph, "codeblock") == 1
        assert count_nodes_by_type(graph, "section") == 2

    def test_builds_edges(self, graph: DependencyGraph) -> None:
        assert len(graph.edges) > 0
        assert has_edge(graph, "frontmatter", "Purpose") is True
        assert count_edges_by_label(graph, "contains") == 2
        assert count_edges_by_label(graph, "missing") == 0

    def test_empty_module_graph(self) -> None:
        graph = build_graph(parse_mam("").ast)
        assert node_names(graph) == ["frontmatter"]
        assert graph.edges == []

    def test_duplicate_section_names_are_disambiguated(self) -> None:
        graph = build_graph(parse_mam("## Same\n\nA\n\n## Same\n\nB\n").ast)
        assert "Same" in node_names(graph)
        assert len([n for n in node_names(graph) if n.startswith("Same")]) == 2


class TestTopologicalSort:
    def test_orders_dependencies_first(self, graph: DependencyGraph) -> None:
        order = topological_sort(graph)
        assert order.index("frontmatter") < order.index("Purpose")
        assert order.index("Purpose") < order.index("Python")

    def test_sorts_a_linear_chain(self) -> None:
        order = topological_sort(_linear())
        assert order.index("a") < order.index("b")

    def test_empty_graph(self) -> None:
        assert topological_sort(DependencyGraph()) == []

    def test_cycles_raise(self) -> None:
        graph = DependencyGraph(
            nodes=[GraphNode(name="a", type="x"), GraphNode(name="b", type="x")],
            edges=[
                GraphEdge(source="a", target="b", label=""),
                GraphEdge(source="b", target="a", label=""),
            ],
        ).index()
        with pytest.raises(ValueError, match="cycle"):
            topological_sort(graph)


class TestQueries:
    def test_successors_and_predecessors(self, graph: DependencyGraph) -> None:
        assert "Purpose" in successors(graph, "frontmatter")
        assert predecessors(graph, "frontmatter") == []
        assert successors(graph, "Purpose") != []

    def test_edge_labels(self, graph: DependencyGraph) -> None:
        assert edge_labels(graph, "frontmatter", "Purpose") == ["contains"]
        assert edge_labels(graph, "Purpose", "frontmatter") == []

    def test_roots_and_leaves(self, graph: DependencyGraph) -> None:
        assert root_nodes(graph) == ["frontmatter"]
        assert "Purpose" not in leaf_nodes(graph)
        assert len(leaf_nodes(graph)) > 0

    def test_node_lookup(self, graph: DependencyGraph) -> None:
        assert has_node(graph, "Purpose") is True
        assert has_node(graph, "nope") is False
        assert node_type(graph, "Purpose") == "section"
        assert node_type(graph, "nope") is None

    def test_nodes_of_type(self, graph: DependencyGraph) -> None:
        sections = nodes_of_type(graph, "section")
        assert len(sections) == 2
        assert all(node.type == "section" for node in sections)

    def test_reachable_from(self, graph: DependencyGraph) -> None:
        reached = reachable_from(graph, "frontmatter")
        assert "Purpose" in reached
        assert "frontmatter" not in reached

    def test_filter_nodes(self, graph: DependencyGraph) -> None:
        found = filter_nodes(graph, lambda node: node.type == "codeblock")
        assert len(found) == 1


class TestRendering:
    def test_summarize_graph(self, graph: DependencyGraph) -> None:
        text = summarize_graph(graph)
        assert "nodes" in text
        assert "edges" in text
        assert "sections: 2" in text

    def test_format_graph_text(self, graph: DependencyGraph) -> None:
        text = format_graph_text(graph)
        assert "frontmatter" in text
        assert "section:" in text
        assert format_graph_text(DependencyGraph()) == "(empty graph)"

    def test_format_graph_text_caps_nodes(self, graph: DependencyGraph) -> None:
        text = format_graph_text(graph, max_nodes=2)
        assert "more nodes" in text
