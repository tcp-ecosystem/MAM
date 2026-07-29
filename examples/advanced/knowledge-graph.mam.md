---
id: knowledge-graph
version: 1.0.0
name: Knowledge Graph Builder
author: MAM Team
runtime: python
tags:
  - knowledge-graph
  - workflow
  - nlp
  - entity-extraction
  - advanced
description: A multi-step workflow that ingests text, extracts entities and relationships, builds a knowledge graph, and supports natural language queries.
---

# Knowledge Graph Builder

## Purpose

A structured workflow that processes raw text into a queryable knowledge graph. Each step progressively enriches the data: extraction identifies entities and relations, graph construction links them, and the query step supports natural language lookups.

## Workflow Definition

module KnowledgeGraphPipeline

type:
    workflow

steps:
    - Ingest
    - ExtractEntities
    - BuildGraph
    - Query
    - Respond

## Step: Ingest

module Ingest

type:
    tool

provider:
    python

capabilities:
    - read
    - normalize
    - chunk

## Step: ExtractEntities

module ExtractEntities

type:
    tool

provider:
    python

capabilities:
    - named-entity-recognition
    - relation-detection

## Step: BuildGraph

module BuildGraph

type:
    tool

provider:
    python

capabilities:
    - create-nodes
    - create-edges
    - deduplicate

## Step: Query

module Query

type:
    tool

provider:
    python

capabilities:
    - search
    - traverse
    - filter

## Step: Respond

module Respond

type:
    tool

provider:
    python

capabilities:
    - format
    - summarize

## Memory: KnowledgeMemory

module KnowledgeMemory

type:
    memory

format:
    vector

backend:
    sqlite

scope:
    workspace

ttl:
    24h

## Policy: ReadOnlyPolicy

module ReadOnlyPolicy

type:
    policy

allow:
    - python
    - knowledge-query

deny:
    - shell.rm
    - filesystem.write

permissions:
    filesystem: read
    python: sandbox

## Python

```python
from dataclasses import dataclass, field
from typing import List, Dict, Set, Optional, Tuple
from collections import defaultdict
import re


@dataclass
class Entity:
    id: str
    name: str
    entity_type: str
    attributes: Dict[str, str] = field(default_factory=dict)


@dataclass
class Relationship:
    source_id: str
    target_id: str
    relation_type: str
    weight: float = 1.0


@dataclass
class KnowledgeGraph:
    entities: Dict[str, Entity] = field(default_factory=dict)
    relationships: List[Relationship] = field(default_factory=list)
    adjacency: Dict[str, List[str]] = field(
        default_factory=lambda: defaultdict(list)
    )

    def add_entity(self, entity: Entity) -> None:
        self.entities[entity.id] = entity

    def add_relationship(self, rel: Relationship) -> None:
        self.relationships.append(rel)
        self.adjacency[rel.source_id].append(rel.target_id)
        self.adjacency[rel.target_id].append(rel.source_id)

    def get_neighbors(self, entity_id: str) -> List[Entity]:
        neighbor_ids = self.adjacency.get(entity_id, [])
        return [self.entities[n] for n in neighbor_ids if n in self.entities]

    def get_entity_by_name(self, name: str) -> Optional[Entity]:
        for e in self.entities.values():
            if e.name.lower() == name.lower():
                return e
        return None

    def get_relationships_for(self, entity_id: str) -> List[Relationship]:
        return [
            r for r in self.relationships
            if r.source_id == entity_id or r.target_id == entity_id
        ]


PERSON_KW = {"mr", "mrs", "dr", "prof", "ceo", "cto"}
ORG_KW = {"inc", "corp", "ltd", "llc", "company", "university"}
LOC_KW = {"city", "country", "state", "mountain", "river"}


def _detect_type(name: str) -> str:
    low = name.lower()
    if any(k in low for k in PERSON_KW):
        return "PERSON"
    if any(k in low for k in ORG_KW):
        return "ORG"
    if any(k in low for k in LOC_KW):
        return "LOCATION"
    if name[0].isupper() and len(name.split()) == 1:
        return "PERSON"
    return "CONCEPT"


def _make_id(name: str, etype: str) -> str:
    clean = re.sub(r"[^a-z0-9]", "_", name.lower())
    return f"{etype.lower()}_{clean}"


def extract_entities(text: str) -> List[Entity]:
    sentences = re.split(r"[.!?]+", text)
    entities: List[Entity] = []
    seen: Set[str] = set()
    for sentence in sentences:
        words = sentence.split()
        i = 0
        while i < len(words):
            w = words[i].strip(",;:'\"()")
            if w and w[0].isupper() and len(w) > 1:
                parts = [w]
                j = i + 1
                while j < len(words) and words[j][0:1].isupper():
                    parts.append(words[j].strip(",;:'\"()"))
                    j += 1
                name = " ".join(parts)
                etype = _detect_type(name)
                eid = _make_id(name, etype)
                if eid not in seen:
                    seen.add(eid)
                    entities.append(Entity(id=eid, name=name, entity_type=etype))
                i = j
            else:
                i += 1
    return entities


REL_PATTERNS = [
    (r"(\w[\w\s]*?)\s+works?\s+at\s+(\w[\w\s]*?)", "WORKS_AT"),
    (r"(\w[\w\s]*?)\s+is\s+(?:a|an)\s+(\w[\w\s]*?)", "IS_A"),
    (r"(\w[\w\s]*?)\s+located?\s+in\s+(\w[\w\s]*?)", "LOCATED_IN"),
    (r"(\w[\w\s]*?)\s+owns?\s+(\w[\w\s]*?)", "OWNS"),
    (r"(\w[\w\s]*?)\s+manages?\s+(\w[\w\s]*?)", "MANAGES"),
]


def extract_relationships(
    text: str, entities: List[Entity]
) -> List[Relationship]:
    names = {e.name.lower(): e.id for e in entities}
    rels: List[Relationship] = []
    seen: Set[Tuple[str, str, str]] = set()
    for pattern, rtype in REL_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            src = m.group(1).strip()
            tgt = m.group(2).strip()
            src_id = names.get(src.lower())
            tgt_id = names.get(tgt.lower())
            if src_id and tgt_id and (src_id, tgt_id, rtype) not in seen:
                seen.add((src_id, tgt_id, rtype))
                rels.append(Relationship(src_id, tgt_id, rtype))
    return rels


def build_graph(
    entities: List[Entity], relationships: List[Relationship]
) -> KnowledgeGraph:
    graph = KnowledgeGraph()
    for e in entities:
        graph.add_entity(e)
    for r in relationships:
        if r.source_id in graph.entities and r.target_id in graph.entities:
            graph.add_relationship(r)
    return graph


def query_graph(graph: KnowledgeGraph, entity_name: str) -> Dict:
    entity = graph.get_entity_by_name(entity_name)
    if entity is None:
        return {"found": False, "query": entity_name}
    neighbors = graph.get_neighbors(entity.id)
    rels = graph.get_relationships_for(entity.id)
    return {
        "found": True,
        "entity": {"id": entity.id, "name": entity.name, "type": entity.entity_type},
        "neighbors": [{"id": n.id, "name": n.name, "type": n.entity_type} for n in neighbors],
        "relationships": [
            {"source": r.source_id, "target": r.target_id, "type": r.relation_type}
            for r in rels
        ],
    }


def run_pipeline(text: str, query_name: Optional[str] = None) -> Dict:
    entities = extract_entities(text)
    relationships = extract_relationships(text, entities)
    graph = build_graph(entities, relationships)
    result = {
        "entity_count": len(graph.entities),
        "relationship_count": len(graph.relationships),
        "entities": [
            {"id": e.id, "name": e.name, "type": e.entity_type}
            for e in graph.entities.values()
        ],
    }
    if query_name:
        result["query_result"] = query_graph(graph, query_name)
    return result
```

## Examples

```python
text = (
    "Alice works at Acme Corp. Bob manages Alice. "
    "Acme Corp is located in New York. Dr Smith owns Acme Corp."
)

result = run_pipeline(text, query_name="Alice")
print(result["entity_count"])        # 4
print(result["relationship_count"])  # 3
print(result["query_result"]["found"])  # True
print(result["query_result"]["neighbors"])  # [{'id': 'org_acme_corp', ...}]
```

## Tests

```python
def test_extract_entities():
    entities = extract_entities("Alice works at Acme Corp.")
    names = [e.name for e in entities]
    assert "Alice" in names
    assert "Acme Corp" in names


def test_entity_type_detection():
    entities = extract_entities("Dr Smith works at Acme Corp.")
    types = {e.name: e.entity_type for e in entities}
    assert types.get("Dr Smith") == "PERSON"
    assert types.get("Acme Corp") == "ORG"


def test_extract_relationships():
    entities = [
        Entity(id="person_alice", name="Alice", entity_type="PERSON"),
        Entity(id="org_acme", name="Acme Corp", entity_type="ORG"),
    ]
    rels = extract_relationships("Alice works at Acme Corp.", entities)
    assert len(rels) == 1
    assert rels[0].relation_type == "WORKS_AT"


def test_build_graph():
    entities = [Entity(id="a", name="A", entity_type="CONCEPT")]
    graph = build_graph(entities, [])
    assert len(graph.entities) == 1


def test_query_graph_found():
    entities = [Entity(id="e1", name="Alice", entity_type="PERSON")]
    graph = build_graph(entities, [])
    result = query_graph(graph, "Alice")
    assert result["found"] is True
    assert result["entity"]["name"] == "Alice"


def test_query_graph_not_found():
    graph = build_graph([], [])
    result = query_graph(graph, "Nobody")
    assert result["found"] is False


def test_run_pipeline():
    result = run_pipeline("Alice works at Acme Corp in New York.")
    assert result["entity_count"] >= 2
    assert result["relationship_count"] >= 1


def test_run_pipeline_with_query():
    result = run_pipeline("Bob owns Tech Inc.", query_name="Bob")
    assert result["query_result"]["found"] is True
```

## Dependencies

- None (standard library only)
