---
# MAM Metadata
id: bug-hunter
name: BugHunter System
version: 2.0.0
type: system

author: LifeJiggy

description: >
  Multi-agent bug hunting system that discovers, analyzes, and reports
  vulnerabilities.

license: MIT

runtime:
  language: python
  version: ">=3.12"

tags:
  - security
  - bug-bounty
  - multi-agent

dependencies:
  - name: recon
    version: "^1.0"
  - name: analyzer
    version: "^1.0"
  - name: reporter
    version: "^1.0"

capabilities:
  - plan
  - recon
  - analyze
  - report

permissions:
  network:
    - internet
  filesystem:
    - read
  python:
    - sandbox
---

# BugHunter System

## Purpose

Multi-agent security testing system that discovers, analyzes, and reports vulnerabilities.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| target | string | Yes | Authorized target for the run |
| authorized | boolean | No | Confirms the target is in scope (default: true) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | `completed` or `refused` |
| stages | list | Planner → Recon → Analyzer → Reporter |
| findings | list | Confirmed findings for the report |

## Modules

- Planner
- Recon
- Analyzer
- Reporter

## Capabilities

### plan

Create the execution strategy for a security testing run.

### recon

Discover attack surfaces and potential vulnerabilities.

### analyze

Assess discovered vulnerabilities for severity and impact.

### report

Generate comprehensive security reports.

## System Definition

module BugHunter

type:
    system

agents:
    - Planner
    - Recon
    - Analyzer
    - Reporter

edges:
    Planner -> Recon
    Recon -> Analyzer
    Analyzer -> Reporter

memory:
    shared: SharedMemory

policy:
    SafeExecution

## Rules

- Operate only against authorized targets
- Do not perform destructive actions
- Preserve evidence
- Validate results before reporting
- Respect the SafeExecution policy at all times

## Workflow

```mermaid
flowchart LR
    Planner --> Recon
    Recon --> Analyzer
    Analyzer --> Reporter
```

## Agent: Planner

module Planner

type:
    agent

role:
    Planning

goal:
    Create execution strategy for security testing

memory:
    shared

tools:
    - PlannerTool

handoff:
    - Recon

## Agent: Recon

module Recon

type:
    agent

role:
    Reconnaissance

goal:
    Discover attack surfaces and vulnerabilities

memory:
    shared

tools:
    - Browser
    - Python
    - Search

handoff:
    - Analyzer

## Agent: Analyzer

module Analyzer

type:
    agent

role:
    Analysis

goal:
    Analyze discovered vulnerabilities for severity and impact

memory:
    shared

tools:
    - Python

handoff:
    - Reporter

## Agent: Reporter

module Reporter

type:
    agent

role:
    Reporting

goal:
    Generate comprehensive security reports

memory:
    shared

tools:
    - Python

## Tool: Browser

module Browser

type:
    tool

provider:
    chromium

permissions:
    network: internet

capabilities:
    - navigate
    - screenshot
    - extract

## Tool: Python

module PythonRuntime

type:
    tool

provider:
    python

permissions:
    python: sandbox

capabilities:
    - execute
    - analyze

## Tool: Search

module SearchTool

type:
    tool

provider:
    search-api

permissions:
    network: internet

capabilities:
    - search
    - crawl

## Tool: PlannerTool

module PlannerTool

type:
    tool

provider:
    planner

capabilities:
    - plan
    - schedule

## Memory: SharedMemory

module SharedMemory

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

## Policy: SafeExecution

module SafeExecution

type:
    policy

allow:
    - browser
    - python
    - search

deny:
    - shell.rm
    - network.internal

permissions:
    filesystem: read
    network: internet
    python: sandbox

## Python

```python
def run_bughunter(target: str, authorized: bool = True) -> dict:
    """Run the Planner -> Recon -> Analyzer -> Reporter pipeline for one target."""
    if not authorized:
        return {"target": target, "status": "refused", "reason": "target is not authorized"}
    stages = ["planner", "recon", "analyzer", "reporter"]
    return {
        "target": target,
        "status": "completed",
        "stages": stages,
        "findings": [],
    }
```

## Tests

### Input

```yaml
target: example.com
```

### Expected

```yaml
agents: 4
tools: 4
policy: SafeExecution
```

```python
def test_bughunter_runs_all_stages():
    result = run_bughunter("example.com")
    assert result["status"] == "completed"
    assert result["stages"] == ["planner", "recon", "analyzer", "reporter"]


def test_bughunter_refuses_unauthorized_target():
    result = run_bughunter("example.com", authorized=False)
    assert result["status"] == "refused"
```

## Examples

### Run a bug-hunting pass on an authorized target

```python
result = run_bughunter("example.com")
print(result["status"])
```

### Expected Flow

```python
result = run_bughunter("example.com")
print(" -> ".join(result["stages"]))
```

## References

- MAM System Examples
- Multi-agent orchestration
