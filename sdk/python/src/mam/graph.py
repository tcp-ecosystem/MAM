"""
Dependency Graph for Python.

Builds a directed graph of a MAM module's structural relationships: sections,
code blocks, front matter, and the edges that connect them. The graph supports
topological sorting with cycle detection plus a query surface for traversal and
inspection.

Example::

    from mam.graph import build_graph, topological_sort
    from mam.parser import parse_mam

    graph = build_graph(parse_mam(content).ast)
    for name in topological_sort(graph):
        print(name)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Set

from .ast import AST

__all__ = [
    "GraphNode",
    "GraphEdge",
    "DependencyGraph",
    "build_graph",
    "topological_sort",
    "node_names",
    "summarize_graph",
    "successors",
    "predecessors",
    "has_edge",
    "edge_labels",
    "leaf_nodes",
    "root_nodes",
    "format_graph_text",
    "nodes_of_type",
    "count_edges_by_label",
    "count_nodes_by_type",
    "has_node",
    "node_type",
    "reachable_from",
    "filter_nodes",
]


@dataclass
class GraphNode:
    """A single node in the dependency graph."""

    name: str
    type: str
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Return the node as a plain dictionary."""

        return {"name": self.name, "type": self.type, "metadata": dict(self.metadata)}


@dataclass
class GraphEdge:
    """A directed edge between two nodes."""

    source: str
    target: str
    label: str = ""

    def to_dict(self) -> Dict[str, Any]:
        """Return the edge as a plain dictionary."""

        return {"source": self.source, "target": self.target, "label": self.label}


@dataclass
class DependencyGraph:
    """A directed graph of module structure."""

    nodes: List[GraphNode] = field(default_factory=list)
    edges: List[GraphEdge] = field(default_factory=list)
    _by_name: Dict[str, GraphNode] = field(default_factory=dict, repr=False)
    _out: Dict[str, List[str]] = field(default_factory=dict, repr=False)
    _in: Dict[str, List[str]] = field(default_factory=dict, repr=False)

    def index(self) -> DependencyGraph:
        """(Re)build the internal lookup indexes and return the graph."""

        self._by_name = {node.name: node for node in self.nodes}
        self._out = {name: [] for name in self._by_name}
        self._in = {name: [] for name in self._by_name}
        for edge in self.edges:
            if edge.source in self._out and edge.target in self._out:
                self._out[edge.source].append(edge.target)
                self._in[edge.target].append(edge.source)
        return self

    def get_node(self, name: str) -> Optional[GraphNode]:
        """Return the node with the given name, or None."""

        if not self._by_name:
            self.index()
        return self._by_name.get(name)

    def to_dict(self) -> Dict[str, Any]:
        """Return the graph as a plain dictionary."""

        return {
            "nodes": [node.to_dict() for node in self.nodes],
            "edges": [edge.to_dict() for edge in self.edges],
        }


def _unique_push(items: List[str], value: str) -> None:
    if value not in items:
        items.append(value)


def build_graph(ast: AST) -> DependencyGraph:
    """Build a dependency graph from a parsed module.

    Nodes are created for the front matter, every section, and every code
    block. Edges run from front matter to sections, from each section to its
    code blocks, and between consecutive sections so that document order is
    preserved in traversals.
    """

    graph = DependencyGraph()
    used_names: Set[str] = set()

    fm_name = "frontmatter"
    graph.nodes.append(
        GraphNode(
            name=fm_name,
            type="frontmatter",
            metadata={
                "id": ast.frontmatter.id,
                "version": ast.frontmatter.version,
                "runtime": ast.frontmatter.runtime,
            },
        )
    )
    used_names.add(fm_name)

    if ast.frontmatter.runtime:
        runtime_name = f"runtime:{ast.frontmatter.runtime}"
        graph.nodes.append(GraphNode(name=runtime_name, type="runtime"))
        used_names.add(runtime_name)
        graph.edges.append(GraphEdge(source=fm_name, target=runtime_name, label="declares"))

    for dependency in ast.frontmatter.dependencies:
        dep_name = f"dependency:{dependency}"
        if dep_name not in used_names:
            graph.nodes.append(GraphNode(name=dep_name, type="dependency"))
            used_names.add(dep_name)
        graph.edges.append(GraphEdge(source=fm_name, target=dep_name, label="requires"))

    previous_section: Optional[str] = None
    for section in ast.sections:
        section_name = section.name
        if section_name in used_names:
            section_name = f"{section_name}#{len(graph.nodes)}"
        graph.nodes.append(
            GraphNode(
                name=section_name,
                type="section",
                metadata={"standard": section.is_standard},
            )
        )
        used_names.add(section_name)
        graph.edges.append(GraphEdge(source=fm_name, target=section_name, label="contains"))
        if previous_section is not None:
            graph.edges.append(
                GraphEdge(source=previous_section, target=section_name, label="follows")
            )
        previous_section = section_name

        for index, block in enumerate(section.code_blocks):
            language = block.language or "unknown"
            block_name = f"{section_name}/code:{language}:{index}"
            graph.nodes.append(
                GraphNode(
                    name=block_name,
                    type="codeblock",
                    metadata={
                        "language": language,
                        "executable": block.is_executable,
                        "lines": len(block.code.splitlines()),
                    },
                )
            )
            used_names.add(block_name)
            graph.edges.append(
                GraphEdge(source=section_name, target=block_name, label="embeds")
            )

    return graph.index()


def topological_sort(graph: DependencyGraph) -> List[str]:
    """Return node names in dependency order.

    Ties are broken by insertion order, so the result is deterministic.

    Raises:
        ValueError: When the graph contains a cycle.
    """

    adjacency: Dict[str, List[str]] = {node.name: [] for node in graph.nodes}
    indegree: Dict[str, int] = {node.name: 0 for node in graph.nodes}
    for edge in graph.edges:
        if edge.source in adjacency and edge.target in adjacency:
            adjacency[edge.source].append(edge.target)
            indegree[edge.target] += 1

    order_index = {node.name: index for index, node in enumerate(graph.nodes)}
    ready = [name for name, degree in indegree.items() if degree == 0]
    ready.sort(key=lambda name: order_index[name])

    ordered: List[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for target in adjacency[current]:
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
        ready.sort(key=lambda name: order_index[name])

    if len(ordered) != len(graph.nodes):
        visited = set(ordered)
        remaining = [node.name for node in graph.nodes if node.name not in visited]
        raise ValueError("Dependency graph contains a cycle involving: " + ", ".join(remaining))
    return ordered


def node_names(graph: DependencyGraph, type_filter: Optional[str] = None) -> List[str]:
    """Return node names, optionally filtered by node type."""

    return [
        node.name
        for node in graph.nodes
        if type_filter is None or node.type == type_filter
    ]


def successors(graph: DependencyGraph, name: str) -> List[str]:
    """Return the names of nodes reachable in one step from ``name``."""

    if not graph._out:
        graph.index()
    return list(graph._out.get(name, []))


def predecessors(graph: DependencyGraph, name: str) -> List[str]:
    """Return the names of nodes that point directly at ``name``."""

    if not graph._in:
        graph.index()
    return list(graph._in.get(name, []))


def has_edge(graph: DependencyGraph, source: str, target: str) -> bool:
    """Return True when an edge connects the two nodes."""

    return target in successors(graph, source)


def edge_labels(graph: DependencyGraph, source: str, target: str) -> List[str]:
    """Return the labels of all edges between the two nodes."""

    return [edge.label for edge in graph.edges if edge.source == source and edge.target == target]


def leaf_nodes(graph: DependencyGraph) -> List[str]:
    """Return nodes with no outgoing edges."""

    if not graph._out:
        graph.index()
    return [name for name in graph._out if not graph._out[name]]


def root_nodes(graph: DependencyGraph) -> List[str]:
    """Return nodes with no incoming edges."""

    if not graph._in:
        graph.index()
    return [name for name in graph._in if not graph._in[name]]


def nodes_of_type(graph: DependencyGraph, type_filter: str) -> List[GraphNode]:
    """Return all nodes of the given type."""

    return [node for node in graph.nodes if node.type == type_filter]


def count_edges_by_label(graph: DependencyGraph, label: str) -> int:
    """Return the number of edges carrying the given label."""

    return sum(1 for edge in graph.edges if edge.label == label)


def count_nodes_by_type(graph: DependencyGraph, type_filter: str) -> int:
    """Return the number of nodes of the given type."""

    return sum(1 for node in graph.nodes if node.type == type_filter)


def has_node(graph: DependencyGraph, name: str) -> bool:
    """Return True when a node with the given name exists."""

    if not graph._by_name:
        graph.index()
    return name in graph._by_name


def node_type(graph: DependencyGraph, name: str) -> Optional[str]:
    """Return the type of the named node, or None when absent."""

    node = graph.get_node(name)
    return node.type if node is not None else None


def reachable_from(graph: DependencyGraph, name: str) -> Set[str]:
    """Return the set of nodes reachable from ``name``, excluding itself.

    A ``max_depth`` of 0 means unlimited traversal.
    """

    if not graph._out:
        graph.index()
    seen: Set[str] = set()
    frontier = list(graph._out.get(name, []))
    while frontier:
        current = frontier.pop(0)
        if current in seen:
            continue
        seen.add(current)
        frontier.extend(graph._out.get(current, []))
    seen.discard(name)
    return seen


def filter_nodes(
    graph: DependencyGraph, predicate: Callable[[GraphNode], bool]
) -> List[GraphNode]:
    """Return the nodes satisfying the predicate, in document order."""

    return [node for node in graph.nodes if predicate(node)]


def summarize_graph(graph: DependencyGraph) -> str:
    """Return a one-line summary of the graph."""

    lines = [
        f"Graph: {len(graph.nodes)} nodes, {len(graph.edges)} edges",
        f"  sections: {count_nodes_by_type(graph, 'section')}",
        f"  code blocks: {count_nodes_by_type(graph, 'codeblock')}",
        f"  dependencies: {count_nodes_by_type(graph, 'dependency')}",
        f"  roots: {len(root_nodes(graph))}",
        f"  leaves: {len(leaf_nodes(graph))}",
    ]
    return "\n".join(lines)


def format_graph_text(graph: DependencyGraph, max_nodes: int = 0) -> str:
    """Render the graph as indented text grouped by node type.

    Args:
        graph: The graph to render.
        max_nodes: Maximum nodes to render; 0 means all of them.
    """

    if not graph.nodes:
        return "(empty graph)"

    shown = graph.nodes if max_nodes <= 0 else graph.nodes[:max_nodes]
    lines: List[str] = []
    by_type: Dict[str, List[GraphNode]] = {}
    for node in shown:
        by_type.setdefault(node.type, []).append(node)

    for type_name in sorted(by_type):
        lines.append(f"{type_name}:")
        for node in by_type[type_name]:
            outgoing = successors(graph, node.name)
            suffix = f" -> {', '.join(outgoing)}" if outgoing else ""
            lines.append(f"  {node.name}{suffix}")

    if max_nodes > 0 and max_nodes < len(graph.nodes):
        lines.append(f"... and {len(graph.nodes) - max_nodes} more nodes")
    return "\n".join(lines)
