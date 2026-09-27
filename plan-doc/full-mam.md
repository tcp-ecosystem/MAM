Absolutely. At this point, I would define `.mam.md` as the **canonical MAM source format**: Markdown remains the human-facing language, while structured sections provide the machine-readable system model.

The important distinction is that **not every possible future capability needs to be mandatory in V1**. We should define a concrete core that is usable now and extensible later.

# `.mam.md` — MAM Source Format V1

## 1. What `.mam.md` is

A `.mam.md` file is a **MAM Module**.

It combines:

```text
Markdown
+
Metadata
+
YAML
+
System Definitions
+
Capabilities
+
Workflows
+
Rules
+
Python
+
Mermaid
+
Tests
+
Documentation
```

The fundamental model is:

```text
.mam.md
   │
   ▼
Parser
   │
   ▼
MAM AST
   │
   ├── Metadata
   ├── Configuration
   ├── Module
   ├── Capabilities
   ├── Inputs / Outputs
   ├── Rules
   ├── Workflow
   ├── Python
   ├── Mermaid
   └── Tests
```

---

# 2. Canonical File Structure

A production `.mam.md` should follow this general structure:

````markdown
---
# MAM Metadata
id: security-recon
name: Security Reconnaissance
version: 2.0.0
type: module

author: TCP Ecosystems

description: >
  Modular reconnaissance system.

license: Apache-2.0

runtime:
  language: python
  version: ">=3.12"

tags:
  - security
  - reconnaissance
  - automation

dependencies:
  - http-client

capabilities:
  - discover
  - analyze

permissions:
  network: internet
  filesystem: read
---

# Security Reconnaissance

## Purpose

Describe what this module does.

## Inputs

- target

## Outputs

- findings

## Capabilities

### discover

Discovers publicly authorized assets.

### analyze

Analyzes discovered assets.

## Rules

- Operate only against authorized targets.
- Do not perform destructive actions.
- Preserve evidence.
- Validate results before reporting.

## Workflow

```mermaid
flowchart TD
    A[Input Target] --> B[Discovery]
    B --> C[Analysis]
    C --> D[Validation]
    D --> E[Findings]
````

## Python

```python
def discover(target):
    """Implementation-specific runtime logic."""
    return []
```

## Tests

### Input

```yaml
target: example.com
```

### Expected

```yaml
status: valid
```

## Examples

Example usage and behavior.

## References

Relevant documentation and specifications.

````

That is the **canonical mental model**.

---

# 3. Metadata Layer

The YAML front matter is the machine-readable identity of the module.

Example:

```yaml
---
id: authentication
name: Authentication Module
version: 2.0.0
type: module
author: TCP Ecosystems
description: Authentication capabilities.

license: Apache-2.0

tags:
  - authentication
  - security

runtime:
  language: python
  version: ">=3.12"
---
````

### Core metadata

| Field          | Purpose                      |
| -------------- | ---------------------------- |
| `id`           | Unique module identifier     |
| `name`         | Human-readable name          |
| `version`      | Module version               |
| `type`         | Module/system/component/etc. |
| `author`       | Maintainer                   |
| `description`  | Module description           |
| `license`      | Licensing information        |
| `tags`         | Discovery/classification     |
| `runtime`      | Runtime requirements         |
| `dependencies` | Required modules             |
| `capabilities` | Exposed capabilities         |
| `permissions`  | Required permissions         |

---

# 4. Module Types

MAM should support a small set of semantic types.

```yaml
type: module
```

Possible V1 types:

```text
module
system
component
service
workflow
tool
resource
plugin
agent
```

`agent` is allowed, but it is **not special to the language**.

It is simply another kind of system module.

---

# 5. Purpose

Every module should explain its responsibility.

```markdown
## Purpose

This module provides structured reconnaissance
capabilities for authorized security testing.
```

This is primarily human-readable, but can also become documentation metadata.

---

# 6. Inputs

Modules explicitly declare what they consume.

```markdown
## Inputs

- target
- scope
- configuration
```

For structured definitions:

```yaml
inputs:
  - name: target
    type: string
    required: true

  - name: scope
    type: object
    required: true
```

---

# 7. Outputs

Modules declare what they produce.

```yaml
outputs:
  - name: findings
    type: object

  - name: evidence
    type: array
```

This makes modules composable.

```text
Module A
   │
   │ output
   ▼
Module B
   │
   │ output
   ▼
Module C
```

---

# 8. Capabilities

Capabilities describe **what a module can do**.

```markdown
## Capabilities

### discover

Discover resources within the permitted scope.

### analyze

Analyze discovered resources.

### validate

Validate generated results.
```

Or structurally:

```yaml
capabilities:
  - discover
  - analyze
  - validate
```

The important distinction:

> **Capability describes what is possible. Workflow describes when/how it happens.**

---

# 9. Rules

Rules define behavioral constraints.

```markdown
## Rules

- Operate only within authorized scope.
- Never expose secrets.
- Never perform destructive operations.
- Validate important results.
- Preserve reproducibility.
```

Rules are intentionally declarative.

Implementation belongs to the runtime.

---

# 10. Permissions

Permissions define what resources a module may access.

```yaml
permissions:
  filesystem:
    - read

  network:
    - internet

  environment:
    - read
```

Future implementations can map these permissions to sandboxing systems.

---

# 11. Dependencies

Modules can depend on other modules.

```yaml
dependencies:
  - name: http-client
    version: "^1.2"

  - name: evidence
    version: "^2.0"
```

This is one of the foundations for the future MAM package ecosystem.

---

# 12. Workflow

Workflows describe system behavior.

Simple:

```markdown
## Workflow

Input

↓

Discovery

↓

Analysis

↓

Validation

↓

Output
```

Or structured:

```yaml
workflow:
  - discover
  - analyze
  - validate
  - report
```

Or visualized with Mermaid.

---

# 13. Mermaid

Mermaid provides the architectural visualization layer.

````markdown
## Workflow

```mermaid
flowchart TD
    Input --> Discovery
    Discovery --> Analysis
    Analysis --> Validation
    Validation --> Output
````

````

The Mermaid diagram should represent the same architecture described by the MAM module—not become a contradictory second source of truth.

---

# 14. Python

Python is the initial execution/integration layer.

```markdown
## Python

```python
def analyze(data):
    results = []

    for item in data:
        results.append(item)

    return results
````

````

The critical principle:

> **Python implements MAM-described behavior; Python does not define the MAM language.**

That keeps MAM above the implementation layer.

---

# 15. Tests

MAM modules should be testable.

```markdown
## Tests

### Test: Valid Input

Input:

```yaml
target: example.com
````

Expected:

```yaml
status: success
```

````

Eventually this can map to a dedicated MAM testing framework.

---

# 16. Examples

Every reusable module should provide examples.

```markdown
## Examples

### Basic Usage

```yaml
target: example.com
````

### Expected Flow

```text
Input → Discover → Analyze → Validate
```

````

---

# 17. References

```markdown
## References

- Architecture specification
- Runtime documentation
- Dependency documentation
- Related modules
````

This allows a MAM module to carry its own knowledge context.

---

# 18. System-Level `.mam.md`

A module can compose other modules into a complete system.

````markdown
---
id: security-platform
name: Security Platform
version: 2.0.0
type: system

dependencies:
  - recon
  - analyzer
  - reporter
---

# Security Platform

## Modules

- Recon
- Analyzer
- Reporter

## Workflow

```mermaid
flowchart LR
    Recon --> Analyzer
    Analyzer --> Reporter
````

## Rules

* All modules operate within declared scope.
* Findings must be validated before reporting.

````

This is where MAM moves from **module format** to **system description language**.

---

# 19. MAM Composition

Multiple `.mam.md` files can form one system:

```text
security-system/
│
├── mam.toml
│
├── modules/
│   ├── recon.mam.md
│   ├── analyzer.mam.md
│   ├── evidence.mam.md
│   └── reporter.mam.md
│
└── system.mam.md
````

The system file composes the modules.

```text
Recon
  ↓
Analyzer
  ↓
Evidence
  ↓
Reporter
```

---

# 20. The MAM Processing Pipeline

The concrete V1 lifecycle should be:

```text
                .mam.md
                   │
                   ▼
                Parser
                   │
                   ▼
             Syntax Validation
                   │
                   ▼
             Semantic Analysis
                   │
                   ▼
                MAM AST
                   │
                   ├──────► Mermaid / Graph
                   │
                   ├──────► Documentation
                   │
                   ├──────► Validation
                   │
                   ▼
                Runtime
                   │
                   ▼
              Implementation
```

---

# 21. Core Commands

For the current foundation, I'd keep the CLI focused.

### Initialize

```bash
mam init
```

### Create module

```bash
mam new module authentication
```

### Validate

```bash
mam validate
```

### Lint

```bash
mam lint
```

### Format

```bash
mam fmt
```

### Build

```bash
mam build
```

### Inspect AST

```bash
mam ast authentication.mam.md
```

### Generate graph

```bash
mam graph authentication.mam.md
```

### Run

```bash
mam run authentication.mam.md
```

### Test

```bash
mam test
```

### Generate documentation

```bash
mam docs
```

### Compile

```bash
mam compile
```

---

# 22. MAM's Current Core

If we strip everything down to the **essential V1**, the language is fundamentally:

```text
.mam.md
   │
   ├── Metadata
   ├── Module
   ├── Purpose
   ├── Inputs
   ├── Outputs
   ├── Capabilities
   ├── Rules
   ├── Dependencies
   ├── Permissions
   ├── Workflow
   ├── Python
   ├── Mermaid
   ├── Tests
   ├── Examples
   └── References
```

That's enough to establish the core without prematurely forcing future concepts like registries, package managers, LSPs, binary formats, or multiple compiler targets into V1.

And the most important invariant should remain:

```text
                    MAM
                     │
             ┌───────┴───────┐
             ▼               ▼
        Human Layer      Machine Layer
             │               │
         Markdown          Parser
             │               │
             └───────┬───────┘
                     ▼
                  MAM AST
                     │
                     ▼
                 Runtime
```

**Markdown remains the source of truth. The AST is the machine representation. Python is an implementation mechanism. Mermaid is visualization. YAML/metadata provide structure. Modules compose into systems.**

That keeps `.mam.md` faithful to the original idea while giving it enough formal structure to grow into the larger MAM DSL we've been designing.
