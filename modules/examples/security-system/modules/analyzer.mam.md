---
id: analyzer
name: Analyzer
version: 2.0.0
type: module
author: MAM Team
description: >
  Analyzes discovered assets for risk and relevance.
license: MIT
runtime:
  language: python
  version: ">=3.12"
tags:
  - security
  - analysis
dependencies:
  - name: recon
    version: ">=1.0.0"
capabilities:
  - analyze
permissions:
  filesystem:
    - read
---

# Analyzer

## Purpose

Consumes discovered assets and produces findings ranked by severity.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| assets | list | Yes | Assets from the recon stage |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| findings | list | Ranked findings |

## Capabilities

### analyze

Assess assets and produce ranked findings.

## Rules

- Preserve evidence for every finding.
- Validate results before reporting.

## Workflow

```mermaid
flowchart TD
    A[Assets] --> B[Analyze]
    B --> C[Findings]
```

## Python

```python
def analyze(assets: list) -> list:
    """Assess assets and return ranked findings."""
    return [{"asset": a.get("asset"), "severity": "medium"} for a in assets]
```

## Tests

### Input

```yaml
assets:
  - asset: example.com
```

### Expected

```yaml
findings: present
```

## References

- MAM documentation
