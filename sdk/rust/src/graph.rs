//! Dependency graph for the MAM Rust SDK.
//!
//! Builds a directed graph of a module's structural relationships: front
//! matter, sections, and code blocks, plus the edges that connect them.
//! Supports topological sorting with cycle detection and a query surface for
//! traversal and inspection.

use crate::ast::Module;
use std::collections::{BTreeMap, HashMap, HashSet};

/// A single node in the dependency graph.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphNode {
    /// Unique node name.
    pub name: String,
    /// Node category, for example `section` or `codeblock`.
    pub kind: String,
    /// Free-form metadata, such as the language of a code block.
    pub metadata: BTreeMap<String, String>,
}

impl GraphNode {
    /// Creates a node with empty metadata.
    pub fn new(name: &str, kind: &str) -> Self {
        Self {
            name: name.to_string(),
            kind: kind.to_string(),
            metadata: BTreeMap::new(),
        }
    }

    /// Attaches a metadata entry.
    pub fn with_metadata(mut self, key: &str, value: &str) -> Self {
        self.metadata.insert(key.to_string(), value.to_string());
        self
    }
}

/// A directed edge between two nodes.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphEdge {
    /// Origin node name.
    pub source: String,
    /// Destination node name.
    pub target: String,
    /// Relationship label.
    pub label: String,
}

impl GraphEdge {
    /// Creates an edge.
    pub fn new(source: &str, target: &str, label: &str) -> Self {
        Self {
            source: source.to_string(),
            target: target.to_string(),
            label: label.to_string(),
        }
    }
}

/// A directed graph of module structure.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DependencyGraph {
    /// All nodes, in creation order.
    pub nodes: Vec<GraphNode>,
    /// All edges, in creation order.
    pub edges: Vec<GraphEdge>,
}

impl DependencyGraph {
    /// Creates an empty graph.
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true when a node with the given name exists.
    pub fn has_node(&self, name: &str) -> bool {
        self.nodes.iter().any(|node| node.name == name)
    }

    /// Returns the kind of the named node, or `None` when absent.
    pub fn node_kind(&self, name: &str) -> Option<String> {
        self.nodes
            .iter()
            .find(|node| node.name == name)
            .map(|node| node.kind.clone())
    }

    /// Appends an edge, ignoring self-loops and unknown endpoints.
    pub fn add_edge(&mut self, source: &str, target: &str, label: &str) {
        if source == target {
            return;
        }
        if !self.has_node(source) || !self.has_node(target) {
            return;
        }
        let duplicate = self
            .edges
            .iter()
            .any(|edge| edge.source == source && edge.target == target && edge.label == label);
        if duplicate {
            return;
        }
        self.edges.push(GraphEdge::new(source, target, label));
    }
}

/// Builds a dependency graph from a parsed module.
///
/// Front matter connects to every declared runtime, dependency, and section;
/// each section connects to its code blocks; and consecutive sections are
/// linked so document order survives traversal.
pub fn build_graph(module: &Module) -> DependencyGraph {
    let mut graph = DependencyGraph::new();
    let mut used: HashSet<String> = HashSet::new();

    let front = "frontmatter";
    graph.nodes.push(
        GraphNode::new(front, "frontmatter")
            .with_metadata("version", module.frontmatter.version.as_deref().unwrap_or("")),
    );
    used.insert(front.to_string());

    if let Some(runtime) = module.frontmatter.metadata.get("runtime") {
        let name = format!("runtime:{}", runtime.as_str().trim_matches('"'));
        if !used.contains(&name) {
            graph.nodes.push(GraphNode::new(&name, "runtime"));
            used.insert(name.clone());
            graph.add_edge(front, &name, "declares");
        }
    }

    for dependency in &module.frontmatter.dependencies {
        let name = format!("dependency:{}", dependency);
        if !used.contains(&name) {
            graph.nodes.push(GraphNode::new(&name, "dependency"));
            used.insert(name.clone());
            graph.add_edge(front, &name, "requires");
        }
    }

    let mut previous: Option<String> = None;
    for section in &module.sections {
        let mut name = section.title.clone();
        if used.contains(&name) {
            name = format!("{}#{}", name, graph.nodes.len());
        }
        graph
            .nodes
            .push(GraphNode::new(&name, "section").with_metadata("kind", section.kind.as_str()));
        used.insert(name.clone());
        graph.add_edge(front, &name, "contains");

        if let Some(before) = &previous {
            graph.add_edge(before, &name, "follows");
        }
        previous = Some(name.clone());

        for (index, block) in section.get_code_blocks().iter().enumerate() {
            let language = if block.language.trim().is_empty() {
                "unknown".to_string()
            } else {
                block.language.clone()
            };
            let block_name = format!("{}/code:{}:{}", name, language, index);
            let lines = block.code.lines().count();
            graph.nodes.push(
                GraphNode::new(&block_name, "codeblock")
                    .with_metadata("language", &language)
                    .with_metadata("lines", &lines.to_string()),
            );
            used.insert(block_name.clone());
            graph.add_edge(&name, &block_name, "embeds");
        }
    }

    graph
}

/// Returns node names, optionally filtered by kind.
pub fn node_names(graph: &DependencyGraph, kind: Option<&str>) -> Vec<String> {
    graph
        .nodes
        .iter()
        .filter(|node| match kind {
            None => true,
            Some(wanted) => node.kind == wanted,
        })
        .map(|node| node.name.clone())
        .collect()
}

/// Returns the nodes reachable from `name` in one step.
pub fn successors(graph: &DependencyGraph, name: &str) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for edge in &graph.edges {
        if edge.source == name && !result.contains(&edge.target) {
            result.push(edge.target.clone());
        }
    }
    result
}

/// Returns the nodes that point directly at `name`.
pub fn predecessors(graph: &DependencyGraph, name: &str) -> Vec<String> {
    let mut result: Vec<String> = Vec::new();
    for edge in &graph.edges {
        if edge.target == name && !result.contains(&edge.source) {
            result.push(edge.source.clone());
        }
    }
    result
}

/// Returns true when an edge connects the two nodes.
pub fn has_edge(graph: &DependencyGraph, source: &str, target: &str) -> bool {
    graph
        .edges
        .iter()
        .any(|edge| edge.source == source && edge.target == target)
}

/// Returns the labels of all edges between the two nodes.
pub fn edge_labels(graph: &DependencyGraph, source: &str, target: &str) -> Vec<String> {
    graph
        .edges
        .iter()
        .filter(|edge| edge.source == source && edge.target == target)
        .map(|edge| edge.label.clone())
        .collect()
}

/// Returns the nodes with no outgoing edges.
pub fn leaf_nodes(graph: &DependencyGraph) -> Vec<String> {
    graph
        .nodes
        .iter()
        .filter(|node| !graph.edges.iter().any(|edge| edge.source == node.name))
        .map(|node| node.name.clone())
        .collect()
}

/// Returns the nodes with no incoming edges.
pub fn root_nodes(graph: &DependencyGraph) -> Vec<String> {
    graph
        .nodes
        .iter()
        .filter(|node| !graph.edges.iter().any(|edge| edge.target == node.name))
        .map(|node| node.name.clone())
        .collect()
}

/// Returns the names of nodes with the given kind.
pub fn nodes_of_kind(graph: &DependencyGraph, kind: &str) -> Vec<String> {
    node_names(graph, Some(kind))
}

/// Counts the edges carrying the given label.
pub fn count_edges_by_label(graph: &DependencyGraph, label: &str) -> usize {
    graph.edges.iter().filter(|edge| edge.label == label).count()
}

/// Counts the nodes with the given kind.
pub fn count_nodes_by_kind(graph: &DependencyGraph, kind: &str) -> usize {
    graph.nodes.iter().filter(|node| node.kind == kind).count()
}

/// Returns every node reachable from `name`, excluding `name` itself.
pub fn reachable_from(graph: &DependencyGraph, name: &str) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut frontier: Vec<String> = vec![name.to_string()];
    while !frontier.is_empty() {
        let current = frontier.remove(0);
        for next in successors(graph, &current) {
            if next == name {
                continue;
            }
            if seen.insert(next.clone()) {
                frontier.push(next);
            }
        }
    }
    let mut result: Vec<String> = seen.into_iter().collect();
    result.sort();
    result
}

/// Orders node names so dependencies precede their dependents.
///
/// Ties are broken by node creation order, so the result is deterministic.
///
/// Returns an error naming the nodes involved when the graph has a cycle.
pub fn topological_sort(graph: &DependencyGraph) -> Result<Vec<String>, String> {
    let names: Vec<String> = graph.nodes.iter().map(|node| node.name.clone()).collect();
    let mut order: HashMap<String, usize> = HashMap::new();
    let mut indegree: HashMap<String, usize> = HashMap::new();
    let mut adjacency: HashMap<String, Vec<String>> = HashMap::new();

    for (index, name) in names.iter().enumerate() {
        order.insert(name.clone(), index);
        indegree.insert(name.clone(), 0);
        adjacency.insert(name.clone(), Vec::new());
    }

    for edge in &graph.edges {
        if !adjacency.contains_key(&edge.source) || !indegree.contains_key(&edge.target) {
            continue;
        }
        if let Some(list) = adjacency.get_mut(&edge.source) {
            list.push(edge.target.clone());
        }
        if let Some(degree) = indegree.get_mut(&edge.target) {
            *degree += 1;
        }
    }

    let position = |name: &String| order.get(name).copied().unwrap_or(usize::MAX);

    let mut ready: Vec<String> = indegree
        .iter()
        .filter(|(_, degree)| **degree == 0)
        .map(|(name, _)| name.clone())
        .collect();
    ready.sort_by_key(position);

    let mut ordered: Vec<String> = Vec::new();
    while !ready.is_empty() {
        let current = ready.remove(0);
        ordered.push(current.clone());
        if let Some(targets) = adjacency.get(&current).cloned() {
            for target in targets {
                if let Some(degree) = indegree.get_mut(&target) {
                    *degree -= 1;
                    if *degree == 0 {
                        ready.push(target);
                    }
                }
            }
        }
        ready.sort_by_key(position);
    }

    if ordered.len() != graph.nodes.len() {
        let placed: HashSet<&String> = ordered.iter().collect();
        let remaining: Vec<String> = graph
            .nodes
            .iter()
            .filter(|node| !placed.contains(&node.name))
            .map(|node| node.name.clone())
            .collect();
        return Err(format!(
            "dependency graph contains a cycle involving: {}",
            remaining.join(", ")
        ));
    }

    Ok(ordered)
}

/// Returns a one-line summary of the graph.
pub fn summarize_graph(graph: &DependencyGraph) -> String {
    format!(
        "Graph: {} nodes, {} edges ({} sections, {} code blocks, {} roots, {} leaves)",
        graph.nodes.len(),
        graph.edges.len(),
        count_nodes_by_kind(graph, "section"),
        count_nodes_by_kind(graph, "codeblock"),
        root_nodes(graph).len(),
        leaf_nodes(graph).len()
    )
}

/// Renders the graph as text grouped by node kind.
pub fn format_graph_text(graph: &DependencyGraph, max_nodes: usize) -> String {
    if graph.nodes.is_empty() {
        return "(empty graph)".to_string();
    }
    let limit = if max_nodes == 0 {
        graph.nodes.len()
    } else {
        max_nodes.min(graph.nodes.len())
    };

    let mut kinds: Vec<String> = Vec::new();
    for node in graph.nodes.iter().take(limit) {
        if !kinds.contains(&node.kind) {
            kinds.push(node.kind.clone());
        }
    }
    kinds.sort();

    let mut lines: Vec<String> = Vec::new();
    for kind in kinds {
        lines.push(format!("{}:", kind));
        for node in graph.nodes.iter().take(limit) {
            if node.kind != kind {
                continue;
            }
            let outgoing = successors(graph, &node.name);
            if outgoing.is_empty() {
                lines.push(format!("  {}", node.name));
            } else {
                lines.push(format!("  {} -> {}", node.name, outgoing.join(", ")));
            }
        }
    }
    if limit < graph.nodes.len() {
        lines.push(format!("... and {} more nodes", graph.nodes.len() - limit));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::Parser;

    fn fixture() -> Module {
        let input = "---\nid: graph\nname: Graph Me\nversion: 2.0.0\nruntime: python\n\
                     dependencies:\n  - pip:requests\n---\n\n\
                     ## Purpose\n\nA module for graphs.\n\n\
                     ## Python\n\n```python\nprint(1)\n```\n";
        Parser::new().parse(input, None).unwrap()
    }

    fn linear() -> DependencyGraph {
        let mut graph = DependencyGraph::new();
        graph.nodes.push(GraphNode::new("a", "test"));
        graph.nodes.push(GraphNode::new("b", "test"));
        graph.add_edge("a", "b", "links");
        graph
    }

    #[test]
    fn test_build_creates_expected_nodes() {
        let graph = build_graph(&fixture());
        let names = node_names(&graph, None);
        assert!(names.contains(&"frontmatter".to_string()));
        assert!(names.contains(&"Purpose".to_string()));
        assert!(names.contains(&"Python".to_string()));
        assert!(names.contains(&"dependency:pip:requests".to_string()));
        assert!(graph.edges.len() > 0);
    }

    #[test]
    fn test_build_counts_kinds() {
        let graph = build_graph(&fixture());
        assert_eq!(count_nodes_by_kind(&graph, "section"), 2);
        assert_eq!(count_nodes_by_kind(&graph, "codeblock"), 1);
        assert_eq!(count_nodes_by_kind(&graph, "dependency"), 1);
        assert_eq!(count_edges_by_label(&graph, "contains"), 2);
        assert_eq!(count_edges_by_label(&graph, "missing"), 0);
    }

    #[test]
    fn test_build_of_empty_module() {
        let graph = build_graph(&Module::new(String::new()));
        assert_eq!(graph.nodes.len(), 1);
        assert!(graph.edges.is_empty());
        assert_eq!(leaf_nodes(&graph), vec!["frontmatter".to_string()]);
    }

    #[test]
    fn test_duplicate_titles_are_disambiguated() {
        let module = Parser::new()
            .parse("## Same\n\nA\n\n## Same\n\nB\n", None)
            .unwrap();
        let graph = build_graph(&module);
        let matching: Vec<String> = node_names(&graph, Some("section"))
            .into_iter()
            .filter(|name| name.starts_with("Same"))
            .collect();
        assert_eq!(matching.len(), 2);
    }

    #[test]
    fn test_queries() {
        let graph = build_graph(&fixture());
        assert!(successors(&graph, "frontmatter").contains(&"Purpose".to_string()));
        assert!(predecessors(&graph, "frontmatter").is_empty());
        assert!(has_edge(&graph, "frontmatter", "Purpose"));
        assert_eq!(edge_labels(&graph, "frontmatter", "Purpose"), vec!["contains".to_string()]);
        assert_eq!(root_nodes(&graph), vec!["frontmatter".to_string()]);
        assert!(nodes_of_kind(&graph, "section").len() == 2);
        assert!(graph.has_node("Purpose"));
        assert!(!graph.has_node("nope"));
        assert_eq!(graph.node_kind("Purpose"), Some("section".to_string()));
        assert_eq!(graph.node_kind("nope"), None);
    }

    #[test]
    fn test_reachable_from() {
        let graph = build_graph(&fixture());
        let reached = reachable_from(&graph, "frontmatter");
        assert!(reached.contains(&"Purpose".to_string()));
        assert!(!reached.contains(&"frontmatter".to_string()));
        assert!(reachable_from(&graph, "Purpose").contains(&"Purpose/code:python:0".to_string()));
    }

    #[test]
    fn test_topological_sort_orders_dependencies() {
        let graph = build_graph(&fixture());
        let order = topological_sort(&graph).unwrap();
        let index = |name: &str| order.iter().position(|item| item == name).unwrap();
        assert!(index("frontmatter") < index("Purpose"));
        assert!(index("Purpose") < index("Python"));
        assert_eq!(order.len(), graph.nodes.len());
    }

    #[test]
    fn test_topological_sort_handles_empty_and_cycles() {
        assert!(topological_sort(&DependencyGraph::new()).unwrap().is_empty());

        let order = topological_sort(&linear()).unwrap();
        assert_eq!(order, vec!["a".to_string(), "b".to_string()]);

        let mut cyclic = DependencyGraph::new();
        cyclic.nodes.push(GraphNode::new("a", "test"));
        cyclic.nodes.push(GraphNode::new("b", "test"));
        cyclic.edges.push(GraphEdge::new("a", "b", ""));
        cyclic.edges.push(GraphEdge::new("b", "a", ""));
        let error = topological_sort(&cyclic).unwrap_err();
        assert!(error.contains("cycle"));
    }

    #[test]
    fn test_summarize_and_render() {
        let graph = build_graph(&fixture());
        let summary = summarize_graph(&graph);
        assert!(summary.contains("nodes"));
        assert!(summary.contains("edges"));

        let text = format_graph_text(&graph, 0);
        assert!(text.contains("frontmatter:"));
        assert!(text.contains("section:"));
        assert_eq!(format_graph_text(&DependencyGraph::new(), 0), "(empty graph)");

        let capped = format_graph_text(&graph, 2);
        assert!(capped.contains("more nodes"));
    }

    #[test]
    fn test_add_edge_is_guarded() {
        let mut graph = DependencyGraph::new();
        graph.nodes.push(GraphNode::new("a", "test"));
        graph.add_edge("a", "a", "self");
        graph.add_edge("a", "missing", "unknown");
        assert!(graph.edges.is_empty());
        graph.add_edge("a", "a", "self");
        assert!(graph.edges.is_empty());
    }
}
