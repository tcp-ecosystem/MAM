/**
 * MAM Init Command
 *
 * Initializes a new MAM module from 15+ production templates.
 * Supports interactive mode, dry-run, force overwrite, batch creation,
 * git init, README generation, and package scaffolding.
 */

import { writeFile, mkdir, access, readdir } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import ora from 'ora';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

export type TemplateName =
  | 'basic'
  | 'full'
  | 'agent'
  | 'workflow'
  | 'team'
  | 'tool'
  | 'memory'
  | 'policy'
  | 'api'
  | 'rag'
  | 'data-pipeline'
  | 'security'
  | 'prompt'
  | 'multi-agent'
  | 'system';

export interface InitOptions {
  name?: string;
  template?: TemplateName;
  runtime?: string;
  author?: string;
  dir?: string;
  git?: boolean;
  readme?: boolean;
  packageJson?: boolean;
  dryRun?: boolean;
  force?: boolean;
  batch?: boolean;
  verbose?: boolean;
  preview?: boolean;
}

interface TemplateMeta {
  name: TemplateName;
  label: string;
  description: string;
  tags: string[];
  permissions: string[];
}

// ---------------------------------------------------------------------------
// Template metadata
// ---------------------------------------------------------------------------

const TEMPLATE_META: TemplateMeta[] = [
  { name: 'basic', label: 'Basic', description: 'Minimal MAM module scaffold', tags: [], permissions: [] },
  { name: 'full', label: 'Full', description: 'Complete module with all sections', tags: [], permissions: ['network'] },
  { name: 'agent', label: 'Agent', description: 'AI agent with prompt and memory', tags: ['agent', 'ai'], permissions: ['network', 'exec'] },
  { name: 'workflow', label: 'Workflow', description: 'Multi-step workflow with mermaid diagram', tags: ['workflow'], permissions: [] },
  { name: 'team', label: 'Team', description: 'Multi-agent team coordination', tags: ['team', 'multi-agent'], permissions: ['network'] },
  { name: 'tool', label: 'Tool', description: 'Reusable tool with typed I/O', tags: ['tool', 'utility'], permissions: ['exec'] },
  { name: 'memory', label: 'Memory', description: 'Persistent memory / knowledge store', tags: ['memory', 'state'], permissions: [] },
  { name: 'policy', label: 'Policy', description: 'Governance and compliance rules', tags: ['policy', 'governance'], permissions: [] },
  { name: 'api', label: 'API', description: 'REST / GraphQL API integration', tags: ['api', 'network'], permissions: ['network'] },
  { name: 'rag', label: 'RAG', description: 'Retrieval-augmented generation pipeline', tags: ['rag', 'ai', 'search'], permissions: ['network'] },
  { name: 'data-pipeline', label: 'Data Pipeline', description: 'ETL / data processing pipeline', tags: ['data', 'pipeline', 'etl'], permissions: ['network', 'exec'] },
  { name: 'security', label: 'Security', description: 'Security scanning and auditing module', tags: ['security', 'audit'], permissions: ['network', 'exec'] },
  { name: 'prompt', label: 'Prompt', description: 'Prompt engineering template', tags: ['prompt', 'ai'], permissions: [] },
  { name: 'multi-agent', label: 'Multi-Agent', description: 'Orchestrated multi-agent system', tags: ['multi-agent', 'orchestration'], permissions: ['network', 'exec'] },
  { name: 'system', label: 'System', description: 'System-level configuration module', tags: ['system', 'infra'], permissions: ['network', 'exec', 'filesystem'] },
];

const VALID_TEMPLATE_NAMES = TEMPLATE_META.map((t) => t.name);

// ---------------------------------------------------------------------------
// Template content generators
// ---------------------------------------------------------------------------

function genFrontmatter(
  name: string,
  runtime: string,
  author: string,
  tags: string[],
  permissions: string[],
  extra: Record<string, unknown> = {},
): string {
  const lines: string[] = [
    '---',
    `id: ${name}`,
    'version: 1.0.0',
    `name: ${name}`,
    `author: ${author}`,
    `runtime: ${runtime}`,
  ];
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  if (permissions.length > 0) {
    lines.push('permissions:');
    for (const p of permissions) lines.push(`  - ${p}`);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const v of value) lines.push(`  - ${v}`);
    } else if (typeof value === 'object' && value !== null) {
      lines.push(`${key}:`);
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k2}: ${v2}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

const TEMPLATES: Record<TemplateName, (name: string, runtime: string, author: string) => string> = {
  // -------------------------------------------------------------------------
  // 1. basic
  // -------------------------------------------------------------------------
  basic: (name, runtime, author) => `${genFrontmatter(name, runtime, author, [], [])}

# ${name}

## Purpose

Describe what this module does in one or two sentences.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | Yes | Primary input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | Primary output |

## Rules

- Validate all inputs before processing
- Return structured output
- Log errors to stderr

## Workflow

\`\`\`mermaid
flowchart TD
    A[Receive Input] --> B[Validate]
    B --> C[Process]
    C --> D[Return Output]
\`\`\`

## Python

\`\`\`python
def process(input1: str) -> dict:
    """Process the input and return a result."""
    return {"output1": input1}
\`\`\`

## Examples

\`\`\`python
result = process("hello")
print(result)  # {"output1": "hello"}
\`\`\`

## Tests

\`\`\`python
def test_process_basic():
    result = process("test")
    assert result["output1"] == "test"

def test_process_empty():
    result = process("")
    assert result["output1"] == ""
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 2. full
  // -------------------------------------------------------------------------
  full: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['complete'], ['network'], {
    description: `Complete ${name} module with all sections`,
    license: 'MIT',
    repository: `https://github.com/example/${name}`,
    dependencies: ['requests', 'pydantic'],
  })}

# ${name}

## Purpose

Full-featured module demonstrating every MAM section type.

## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| query | string | Yes | - | Search query |
| limit | integer | No | 10 | Max results |
| format | string | No | json | Output format |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | array | List of result objects |
| metadata | object | Response metadata |
| errors | array | Any errors encountered |

## Rules

- Maximum 100 results per request
- Timeout after 30 seconds
- Retry up to 3 times on transient failure
- Never cache personal data
- All timestamps in ISO 8601 UTC

## Workflow

\`\`\`mermaid
flowchart TD
    A[Receive Query] --> B{Cache Hit?}
    B -->|Yes| C[Return Cached]
    B -->|No| D[Validate Input]
    D --> E[Fetch Data]
    E --> F[Transform Results]
    F --> G[Cache Results]
    G --> H[Return Response]
\`\`\`

## Python

\`\`\`python
import json
import hashlib
from datetime import datetime, timezone
from typing import Any

# @mam:timeout=30s
# @mam:retries=3
# @mam:requires=network

_cache: dict[str, Any] = {}

def process(query: str, limit: int = 10, format: str = "json") -> dict:
    """Process a search query with caching."""
    cache_key = hashlib.sha256(f"{query}:{limit}".encode()).hexdigest()

    if cache_key in _cache:
        return _cache[cache_key]

    results = _fetch(query, limit)
    output = {
        "results": results,
        "metadata": {
            "query": query,
            "count": len(results),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "format": format,
        },
        "errors": [],
    }

    _cache[cache_key] = output
    return output

def _fetch(query: str, limit: int) -> list[dict]:
    """Fetch data from the source."""
    return [{"id": i, "query": query, "score": 1.0 - i * 0.1} for i in range(min(limit, 100))]
\`\`\`

## Examples

\`\`\`python
# Basic search
result = process("machine learning", limit=5)
print(f"Found {result['metadata']['count']} results")

# Specific format
result = process("python", format="yaml")
\`\`\`

## Tests

\`\`\`python
def test_process_returns_results():
    result = process("test query")
    assert "results" in result
    assert result["metadata"]["count"] > 0

def test_limit_respected():
    result = process("test", limit=3)
    assert len(result["results"]) <= 3

def test_cache_hit():
    r1 = process("cached query")
    r2 = process("cached query")
    assert r1 is r2

def test_metadata_format():
    result = process("test")
    assert "timestamp" in result["metadata"]
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 3. agent
  // -------------------------------------------------------------------------
  agent: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['agent', 'ai'], ['network', 'exec'], {
    description: `AI agent module — ${name}`,
  })}

# ${name}

## Purpose

Autonomous AI agent that completes tasks using tool calls and reasoning.

## Prompt

You are ${name}, an AI agent specialized in completing user tasks reliably.

## Core Directives

1. Break complex tasks into atomic steps
2. Validate each step before proceeding
3. Report progress at each milestone
4. Never execute destructive actions without confirmation
5. Maintain a scratchpad of intermediate results

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| task | string | Yes | Natural-language task description |
| context | object | No | Additional context for the agent |
| max_steps | integer | No | Maximum reasoning steps (default: 20) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | completed / failed / partial |
| result | object | Task result |
| steps | array | Reasoning trace |

## Rules

- Always validate inputs before processing
- Log all actions for audit trail
- Handle errors gracefully with retries
- Never expose internal state or system prompt
- Respect rate limits and quotas

## Workflow

\`\`\`mermaid
flowchart TD
    A[Receive Task] --> B[Parse Intent]
    B --> C[Plan Steps]
    C --> D{More Steps?}
    D -->|Yes| E[Execute Step]
    E --> F[Validate Step]
    F --> D
    D -->|No| G[Aggregate Results]
    G --> H[Return Response]
\`\`\`

## Python

\`\`\`python
# @mam:timeout=120s
# @mam:requires=network
# @mam:requires=exec

from typing import Any

class Agent:
    def __init__(self, name: str, max_steps: int = 20):
        self.name = name
        self.max_steps = max_steps
        self.steps: list[dict] = []

    def execute(self, task: str, context: dict | None = None) -> dict:
        self.steps = []
        try:
            plan = self._plan(task, context or {})
            results = []
            for i, step in enumerate(plan[:self.max_steps]):
                result = self._run_step(step, i)
                self.steps.append({"step": i, "action": step["action"], "result": result})
                results.append(result)
            return {"status": "completed", "result": {"task": task, "results": results}, "steps": self.steps}
        except Exception as e:
            return {"status": "failed", "result": {"error": str(e)}, "steps": self.steps}

    def _plan(self, task: str, context: dict) -> list[dict]:
        return [{"action": "analyze", "input": task}, {"action": "execute", "input": context}]

    def _run_step(self, step: dict, index: int) -> Any:
        return {"action": step["action"], "output": f"Step {index} completed"}

agent = Agent("${name}")
\`\`\`

## Memory

- agent_state: idle
- last_task: null
- completed_count: 0

## Examples

\`\`\`python
agent = Agent("my-agent")
result = agent.execute("analyze data from CSV file")
print(result["status"])  # completed
\`\`\`

## Tests

\`\`\`python
def test_agent_executes_task():
    a = Agent("test-agent", max_steps=5)
    result = a.execute("do something")
    assert result["status"] == "completed"

def test_agent_respects_max_steps():
    a = Agent("test-agent", max_steps=1)
    result = a.execute("complex task")
    assert len(result["steps"]) <= 1

def test_agent_handles_error():
    a = Agent("test-agent")
    result = a.execute("")
    assert result["status"] in ("completed", "failed")
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 4. workflow
  // -------------------------------------------------------------------------
  workflow: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['workflow'], [])}

# ${name}

## Purpose

Orchestrated multi-step workflow with branching logic and error recovery.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| payload | object | Yes | Workflow input data |
| config | object | No | Runtime configuration overrides |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | Workflow completion status |
| output | object | Final workflow output |
| timeline | array | Step execution timeline |

## Rules

- Each step must complete before the next begins
- Failed steps trigger compensation logic
- Maximum 50 steps per workflow execution
- All steps must be idempotent

## Workflow

\`\`\`mermaid
flowchart TD
    A[Start] --> B[Step 1: Validate]
    B --> C[Step 2: Transform]
    C --> D{Step 3: Decision}
    D -->|Branch A| E[Step 4a: Process A]
    D -->|Branch B| F[Step 4b: Process B]
    E --> G[Step 5: Merge]
    F --> G
    G --> H[Step 6: Finalize]
    H --> I[End]
    B -->|Fail| Z[Compensate & Rollback]
    C -->|Fail| Z
    E -->|Fail| Z
    F -->|Fail| Z
\`\`\`

## Steps

- Step 1: Validate input payload
- Step 2: Transform data to canonical form
- Step 3: Branch based on data classification
- Step 4a: Process category A
- Step 4b: Process category B
- Step 5: Merge branch results
- Step 6: Finalize and emit output

## Python

\`\`\`python
from typing import Any
from datetime import datetime, timezone

def execute_workflow(payload: dict, config: dict | None = None) -> dict:
    """Execute the workflow with compensation support."""
    timeline: list[dict] = []
    state = {"payload": payload, "config": config or {}}

    try:
        t0 = _step("validate", state)
        timeline.append(t0)

        t1 = _step("transform", state)
        timeline.append(t1)

        branch = state.get("classification", "a")
        if branch == "a":
            t2 = _step("process_a", state)
        else:
            t2 = _step("process_b", state)
        timeline.append(t2)

        t3 = _step("merge", state)
        timeline.append(t3)

        t4 = _step("finalize", state)
        timeline.append(t4)

        return {"status": "completed", "output": state.get("output", {}), "timeline": timeline}
    except Exception as e:
        _compensate(timeline)
        return {"status": "failed", "output": {"error": str(e)}, "timeline": timeline}

def _step(name: str, state: dict) -> dict:
    start = datetime.now(timezone.utc)
    state["classification"] = state.get("payload", {}).get("type", "a")
    return {"step": name, "started": start.isoformat(), "completed": datetime.now(timezone.utc).isoformat()}

def _compensate(timeline: list[dict]) -> None:
    for entry in reversed(timeline):
        pass
\`\`\`

## Examples

\`\`\`python
result = execute_workflow({"type": "a", "data": [1, 2, 3]})
print(result["status"])  # completed
\`\`\`

## Tests

\`\`\`python
def test_workflow_completes():
    r = execute_workflow({"type": "a"})
    assert r["status"] == "completed"

def test_workflow_timeline():
    r = execute_workflow({"type": "b"})
    assert len(r["timeline"]) >= 3

def test_workflow_failure_compensates():
    r = execute_workflow({})
    assert r["status"] in ("completed", "failed")
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 5. team
  // -------------------------------------------------------------------------
  team: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['team', 'multi-agent'], ['network'], {
    description: `Multi-agent team — ${name}`,
  })}

# ${name}

## Purpose

Coordinated multi-agent team with role-based delegation and consensus.

## Members

| Role | Agent | Responsibility |
|------|-------|----------------|
| Lead | lead-agent | Task decomposition and delegation |
| Researcher | research-agent | Information gathering and analysis |
| Executor | executor-agent | Task execution and implementation |
| Reviewer | review-agent | Quality assurance and validation |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| objective | string | Yes | High-level goal |
| constraints | object | No | Resource and time constraints |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | object | Team deliverable |
| agent_reports | array | Per-agent status reports |
| consensus | boolean | Whether team reached consensus |

## Rules

- Lead agent has final decision authority
- All agents report progress every 5 steps
- Consensus required for critical decisions
- No agent may modify another agent's output directly

## Policy

SafeExecution

## Workflow

\`\`\`mermaid
flowchart TD
    A[Receive Objective] --> B[Lead: Decompose Task]
    B --> C[Assign to Agents]
    C --> D[Research Agent]
    C --> E[Executor Agent]
    D --> F[Share Findings]
    E --> F
    F --> G[Reviewer: Validate]
    G --> H{Consensus?}
    H -->|Yes| I[Deliver Result]
    H -->|No| J[Lead: Resolve Conflicts]
    J --> C
\`\`\`

## Python

\`\`\`python
from typing import Any

# @mam:timeout=300s
# @mam:requires=network

class Team:
    def __init__(self, name: str):
        self.name = name
        self.members: list[dict[str, Any]] = []
        self.reports: list[dict] = []

    def add_member(self, role: str, agent_name: str) -> None:
        self.members.append({"role": role, "name": agent_name, "status": "idle"})

    def execute(self, objective: str, constraints: dict | None = None) -> dict:
        task_plan = self._decompose(objective)
        for task in task_plan:
            self._delegate(task)
        consensus = self._review()
        return {
            "result": {"objective": objective, "tasks_completed": len(task_plan)},
            "agent_reports": self.reports,
            "consensus": consensus,
        }

    def _decompose(self, objective: str) -> list[dict]:
        return [{"id": i, "description": f"Task {i} for {objective}"} for i in range(3)]

    def _delegate(self, task: dict) -> None:
        self.reports.append({"task": task["id"], "status": "completed"})

    def _review(self) -> bool:
        return all(r["status"] == "completed" for r in self.reports)

team = Team("${name}")
team.add_member("lead", "lead-agent")
team.add_member("researcher", "research-agent")
team.add_member("executor", "executor-agent")
\`\`\`

## Examples

\`\`\`python
team = Team("my-team")
team.add_member("lead", "lead-agent")
result = team.execute("Build a recommendation engine")
print(result["consensus"])  # True
\`\`\`

## Tests

\`\`\`python
def test_team_execution():
    t = Team("test-team")
    t.add_member("lead", "agent-1")
    r = t.execute("objective")
    assert r["consensus"] is True

def test_team_reports():
    t = Team("test-team")
    t.add_member("exec", "agent-1")
    r = t.execute("test")
    assert len(r["agent_reports"]) >= 1
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 6. tool
  // -------------------------------------------------------------------------
  tool: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['tool', 'utility'], ['exec'], {
    description: `Reusable tool — ${name}`,
  })}

# ${name}

## Purpose

Reusable tool with typed inputs, outputs, and error handling.

## Inputs

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| data | any | Yes | - | Input data to process |
| options | object | No | {} | Processing options |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | any | Processed result |
| duration_ms | number | Processing time in milliseconds |

## Rules

- Tool must be idempotent
- Maximum input size: 10MB
- Return error objects, never throw
- Validate options against schema

## Python

\`\`\`python
import time
from typing import Any

def invoke(data: Any, options: dict | None = None) -> dict:
    """Invoke the tool with data and options."""
    start = time.monotonic()
    opts = options or {}
    try:
        result = _process(data, opts)
        duration = (time.monotonic() - start) * 1000
        return {"result": result, "duration_ms": duration}
    except Exception as e:
        duration = (time.monotonic() - start) * 1000
        return {"result": None, "duration_ms": duration, "error": str(e)}

def _process(data: Any, options: dict) -> Any:
    if isinstance(data, str):
        return data.upper() if options.get("uppercase") else data
    if isinstance(data, list):
        return sorted(data) if options.get("sort") else data
    return data
\`\`\`

## Examples

\`\`\`python
result = invoke("hello", {"uppercase": True})
print(result["result"])  # HELLO

result = invoke([3, 1, 2], {"sort": True})
print(result["result"])  # [1, 2, 3]
\`\`\`

## Tests

\`\`\`python
def test_tool_string():
    r = invoke("hello", {"uppercase": True})
    assert r["result"] == "HELLO"

def test_tool_list():
    r = invoke([3, 1], {"sort": True})
    assert r["result"] == [1, 3]

def test_tool_no_options():
    r = invoke("test")
    assert r["result"] == "test"

def test_tool_duration():
    r = invoke("x")
    assert r["duration_ms"] >= 0
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 7. memory
  // -------------------------------------------------------------------------
  memory: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['memory', 'state'], [])}

# ${name}

## Purpose

Persistent memory store for agent state, facts, and knowledge.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | get, set, delete, list, search |
| key | string | Conditional | Memory key |
| value | any | Conditional | Value to store |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| value | any | Retrieved value (for get) |
| entries | array | Matching entries (for list/search) |
| success | boolean | Operation success |

## Rules

- Keys must be namespaced: \`namespace:key\`
- Maximum 10,000 entries per namespace
- TTL support: entries expire after configured duration
- Search uses fuzzy matching on values

## Python

\`\`\`python
import time
from typing import Any

_store: dict[str, dict[str, Any]] = {}

def memory(action: str, key: str | None = None, value: Any = None, namespace: str = "default", ttl: int | None = None) -> dict:
    """Perform a memory operation."""
    ns = _store.setdefault(namespace, {})

    if action == "set" and key is not None:
        ns[key] = {"value": value, "created": time.time(), "ttl": ttl}
        return {"success": True}

    if action == "get" and key is not None:
        entry = ns.get(key)
        if entry and _is_valid(entry):
            return {"value": entry["value"], "success": True}
        return {"value": None, "success": False}

    if action == "delete" and key is not None:
        removed = ns.pop(key, None)
        return {"success": removed is not None}

    if action == "list":
        entries = [{"key": k, **v} for k, v in ns.items() if _is_valid(v)]
        return {"entries": entries, "success": True}

    if action == "search":
        query = (key or "").lower()
        entries = [{"key": k, **v} for k, v in ns.items() if query in str(v.get("value", "")).lower()]
        return {"entries": entries, "success": True}

    return {"success": False, "error": f"Unknown action: {action}"}

def _is_valid(entry: dict) -> bool:
    if entry.get("ttl") and time.time() - entry["created"] > entry["ttl"]:
        return False
    return True
\`\`\`

## Examples

\`\`\`python
memory("set", "fact:python", {"language": "Python", "version": 3.12})
result = memory("get", "fact:python")
print(result["value"])  # {"language": "Python", "version": 3.12}

result = memory("search", "python")
print(len(result["entries"]))  # >= 1
\`\`\`

## Tests

\`\`\`python
def test_set_and_get():
    memory("set", "k1", "v1")
    r = memory("get", "k1")
    assert r["value"] == "v1"

def test_delete():
    memory("set", "k2", "v2")
    r = memory("delete", "k2")
    assert r["success"] is True
    r = memory("get", "k2")
    assert r["value"] is None

def test_list():
    memory("set", "k3", "v3")
    r = memory("list")
    assert len(r["entries"]) >= 1
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 8. policy
  // -------------------------------------------------------------------------
  policy: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['policy', 'governance'], [])}

# ${name}

## Purpose

Governance policy defining rules, constraints, and compliance requirements.

## Policy Rules

| Rule ID | Category | Severity | Description |
|---------|----------|----------|-------------|
| PR-001 | Data Privacy | critical | No PII in logs or outputs |
| PR-002 | Access Control | high | All actions require authentication |
| PR-003 | Rate Limiting | medium | Maximum 100 requests per minute |
| PR-004 | Audit Trail | high | All mutations must be logged |
| PR-005 | Data Retention | medium | Delete data older than 90 days |

## Enforcement

\`\`\`mermaid
flowchart TD
    A[Action Requested] --> B{Check Policy}
    B -->|Allowed| C[Execute Action]
    C --> D[Log Audit Trail]
    B -->|Denied| E[Return Policy Violation]
    E --> F[Alert Admin]
\`\`\`

## Python

\`\`\`python
from typing import Any
from datetime import datetime, timezone

class PolicyEngine:
    def __init__(self):
        self.rules: list[dict] = []
        self.audit_log: list[dict] = []

    def add_rule(self, rule_id: str, category: str, severity: str, description: str) -> None:
        self.rules.append({"id": rule_id, "category": category, "severity": severity, "description": description})

    def check(self, action: str, context: dict | None = None) -> dict:
        violations = []
        for rule in self.rules:
            violation = self._evaluate(rule, action, context or {})
            if violation:
                violations.append(violation)

        allowed = len(violations) == 0
        self.audit_log.append({
            "action": action,
            "allowed": allowed,
            "violations": violations,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

        return {"allowed": allowed, "violations": violations}

    def _evaluate(self, rule: dict, action: str, context: dict) -> dict | None:
        if rule["severity"] == "critical" and "pii" in context:
            return {"rule": rule["id"], "reason": "PII detected in context"}
        return None

engine = PolicyEngine()
engine.add_rule("PR-001", "Data Privacy", "critical", "No PII in logs")
\`\`\`

## Examples

\`\`\`python
engine = PolicyEngine()
result = engine.check("log_data", {"pii": "ssn: 123-45-6789"})
print(result["allowed"])  # False
\`\`\`

## Tests

\`\`\`python
def test_policy_allows_clean():
    e = PolicyEngine()
    e.add_rule("R1", "privacy", "critical", "no pii")
    r = e.check("clean_action")
    assert r["allowed"] is True

def test_policy_blocks_pii():
    e = PolicyEngine()
    e.add_rule("R1", "privacy", "critical", "no pii")
    r = e.check("log", {"pii": "data"})
    assert r["allowed"] is False
    assert len(r["violations"]) > 0
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 9. api
  // -------------------------------------------------------------------------
  api: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['api', 'network'], ['network'], {
    description: `API integration — ${name}`,
  })}

# ${name}

## Purpose

REST API integration with authentication, rate limiting, and error handling.

## API Configuration

| Property | Value |
|----------|-------|
| Base URL | https://api.example.com/v1 |
| Auth | Bearer token |
| Rate Limit | 100 req/min |
| Timeout | 30s |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| endpoint | string | Yes | API endpoint path |
| method | string | No | HTTP method (default: GET) |
| body | object | No | Request body |
| headers | object | No | Additional headers |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | number | HTTP status code |
| data | object | Response body |
| headers | object | Response headers |

## Rules

- All requests must include authentication
- Retry on 429/503 with exponential backoff
- Never log request bodies containing secrets
- Validate response schema

## Python

\`\`\`python
import json
from typing import Any
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# @mam:timeout=30s
# @mam:requires=network

class APIClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.retry_count = 3

    def request(self, endpoint: str, method: str = "GET", body: dict | None = None, headers: dict | None = None) -> dict:
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        req_headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        if headers:
            req_headers.update(headers)

        data = json.dumps(body).encode() if body else None
        req = Request(url, data=data, headers=req_headers, method=method)

        for attempt in range(self.retry_count):
            try:
                with urlopen(req, timeout=30) as resp:
                    return {"status": resp.status, "data": json.loads(resp.read()), "headers": dict(resp.headers)}
            except HTTPError as e:
                if e.code in (429, 503) and attempt < self.retry_count - 1:
                    continue
                return {"status": e.code, "data": {"error": str(e)}, "headers": {}}

client = APIClient("https://api.example.com/v1", "token")
\`\`\`

## Examples

\`\`\`python
client = APIClient("https://api.example.com", "my-token")
result = client.request("/users")
print(result["status"])  # 200
\`\`\`

## Tests

\`\`\`python
def test_client_init():
    c = APIClient("https://example.com", "tok")
    assert c.base_url == "https://example.com"

def test_request_structure():
    c = APIClient("https://example.com", "tok")
    r = c.request("/test")
    assert "status" in r
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 10. rag
  // -------------------------------------------------------------------------
  rag: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['rag', 'ai', 'search'], ['network'], {
    description: `RAG pipeline — ${name}`,
  })}

# ${name}

## Purpose

Retrieval-Augmented Generation pipeline for knowledge-grounded responses.

## Pipeline Stages

| Stage | Description |
|-------|-------------|
| Ingest | Chunk and embed documents |
| Index | Store embeddings in vector store |
| Retrieve | Semantic search for relevant chunks |
| Augment | Inject context into prompt |
| Generate | LLM generates grounded response |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | User query |
| documents | array | No | Documents to index |
| top_k | integer | No | Number of chunks to retrieve (default: 5) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| answer | string | Generated response |
| sources | array | Retrieved source chunks |
| confidence | number | Confidence score 0-1 |

## Rules

- Chunk size: 512 tokens with 50-token overlap
- Minimum similarity threshold: 0.7
- Maximum context window: 8192 tokens
- Always cite sources in responses

## Python

\`\`\`python
from typing import Any

# @mam:timeout=60s
# @mam:requires=network

_vector_store: list[dict] = []

def ingest(documents: list[str], chunk_size: int = 512) -> dict:
    """Ingest documents into the vector store."""
    count = 0
    for doc in documents:
        chunks = _chunk(doc, chunk_size)
        for chunk in chunks:
            embedding = _embed(chunk)
            _vector_store.append({"text": chunk, "embedding": embedding, "source": doc[:50]})
            count += 1
    return {"ingested": count, "total_chunks": len(_vector_store)}

def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """Retrieve relevant chunks for a query."""
    q_emb = _embed(query)
    scored = [{"text": v["text"], "source": v["source"], "score": _similarity(q_emb, v["embedding"])} for v in _vector_store]
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]

def generate(query: str, top_k: int = 5) -> dict:
    """Full RAG pipeline: retrieve then generate."""
    sources = retrieve(query, top_k)
    context = "\\n".join(s["text"] for s in sources)
    answer = f"Based on {len(sources)} sources: {query}"
    confidence = sum(s["score"] for s in sources) / max(len(sources), 1)
    return {"answer": answer, "sources": sources, "confidence": confidence}

def _chunk(text: str, size: int) -> list[str]:
    return [text[i:i+size] for i in range(0, len(text), size)] or [""]

def _embed(text: str) -> list[float]:
    return [hash(text) % 100 / 100 for _ in range(8)]

def _similarity(a: list[float], b: list[float]) -> float:
    return sum(x * y for x, y in zip(a, b)) / max(len(a), 1)
\`\`\`

## Examples

\`\`\`python
ingest(["Python is a programming language", "MAM is Markdown as Module"])
result = generate("What is MAM?")
print(result["answer"])
print(len(result["sources"]))  # >= 1
\`\`\`

## Tests

\`\`\`python
def test_ingest():
    r = ingest(["test document"])
    assert r["ingested"] >= 1

def test_retrieve():
    ingest(["hello world"])
    r = retrieve("hello")
    assert len(r) >= 1

def test_generate():
    ingest(["test content"])
    r = generate("test")
    assert "answer" in r
    assert r["confidence"] >= 0
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 11. data-pipeline
  // -------------------------------------------------------------------------
  'data-pipeline': (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['data', 'pipeline', 'etl'], ['network', 'exec'], {
    description: `Data pipeline — ${name}`,
  })}

# ${name}

## Purpose

ETL data pipeline for extracting, transforming, and loading data between systems.

## Pipeline Configuration

| Stage | Description | Parallelism |
|-------|-------------|-------------|
| Extract | Pull data from sources | 4 workers |
| Transform | Clean, validate, enrich | 8 workers |
| Load | Write to destination | 2 workers |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Data source URI |
| destination | string | Yes | Target URI |
| config | object | No | Pipeline configuration |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| records_processed | integer | Total records processed |
| records_failed | integer | Failed records |
| duration_ms | number | Pipeline duration |
| stats | object | Per-stage statistics |

## Rules

- Checkpoint every 1000 records
- Dead-letter queue for failed records
- Idempotent writes (upsert semantics)
- Schema validation at each stage

## Python

\`\`\`python
import time
from typing import Any

# @mam:timeout=600s
# @mam:requires=network

class Pipeline:
    def __init__(self, name: str):
        self.name = name
        self.stats = {"extracted": 0, "transformed": 0, "loaded": 0, "failed": 0}

    def run(self, source: str, destination: str, config: dict | None = None) -> dict:
        start = time.monotonic()
        opts = config or {}
        try:
            records = self._extract(source, opts)
            transformed = self._transform(records, opts)
            self._load(transformed, destination, opts)
            duration = (time.monotonic() - start) * 1000
            return {"records_processed": self.stats["loaded"], "records_failed": self.stats["failed"], "duration_ms": duration, "stats": dict(self.stats)}
        except Exception as e:
            duration = (time.monotonic() - start) * 1000
            return {"records_processed": 0, "records_failed": self.stats["failed"], "duration_ms": duration, "error": str(e)}

    def _extract(self, source: str, config: dict) -> list[dict]:
        records = [{"id": i, "source": source, "raw": f"record_{i}"} for i in range(10)]
        self.stats["extracted"] = len(records)
        return records

    def _transform(self, records: list[dict], config: dict) -> list[dict]:
        result = []
        for r in records:
            r["transformed"] = True
            result.append(r)
        self.stats["transformed"] = len(result)
        return result

    def _load(self, records: list[dict], destination: str, config: dict) -> None:
        self.stats["loaded"] = len(records)

pipeline = Pipeline("${name}")
\`\`\`

## Examples

\`\`\`python
pipeline = Pipeline("my-pipeline")
result = pipeline.run("s3://bucket/input", "s3://bucket/output")
print(result["records_processed"])  # 10
\`\`\`

## Tests

\`\`\`python
def test_pipeline_run():
    p = Pipeline("test")
    r = p.run("src", "dst")
    assert r["records_processed"] == 10
    assert r["records_failed"] == 0

def test_pipeline_stats():
    p = Pipeline("test")
    p.run("src", "dst")
    assert p.stats["extracted"] == 10
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 12. security
  // -------------------------------------------------------------------------
  security: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['security', 'audit'], ['network', 'exec'], {
    description: `Security scanning module — ${name}`,
  })}

# ${name}

## Purpose

Security scanning, vulnerability detection, and compliance auditing.

## Scan Types

| Scan | Description | Severity Mapping |
|------|-------------|-----------------|
| Secret Detection | Find hardcoded secrets | critical |
| Dependency Audit | Check known CVEs | high-critical |
| SAST | Static application security testing | medium-critical |
| License Compliance | Verify license compatibility | low-medium |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| target | string | Yes | Path or URL to scan |
| scan_types | array | No | Specific scans to run |
| severity_threshold | string | No | Minimum severity to report |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| findings | array | Security findings |
| summary | object | Aggregated statistics |
| passed | boolean | All checks passed |

## Rules

- Never store or transmit discovered secrets
- Report findings with file location and line number
- Assign CVSS scores where applicable
- Escalate critical findings immediately

## Python

\`\`\`python
import re
from typing import Any

# @mam:timeout=120s
# @mam:requires=exec

SECRET_PATTERNS = [
    ("aws_key", r"AKIA[0-9A-Z]{16}", "critical"),
    ("api_key", r"api[_-]?key[=:]\s*['\"]?[A-Za-z0-9]{32}", "high"),
    ("password", r"password[=:]\s*['\"]?[^\s'\"]{8,}", "high"),
    ("token", r"token[=:]\s*['\"]?[A-Za-z0-9\\-_\\.]{20,}", "medium"),
]

def scan(content: str, filename: str = "<input>", scan_types: list[str] | None = None, severity_threshold: str = "low") -> dict:
    """Scan content for security issues."""
    findings: list[dict] = []
    threshold_order = ["info", "low", "medium", "high", "critical"]
    min_severity = threshold_order.index(severity_threshold) if severity_threshold in threshold_order else 0

    for pattern_name, pattern, severity in SECRET_PATTERNS:
        if severity_threshold and threshold_order.index(severity) < min_severity:
            continue
        matches = re.finditer(pattern, content, re.IGNORECASE)
        for match in matches:
            line_num = content[:match.start()].count("\\n") + 1
            findings.append({
                "type": pattern_name,
                "severity": severity,
                "file": filename,
                "line": line_num,
                "match": match.group()[:8] + "***",
            })

    return {
        "findings": findings,
        "summary": {"total": len(findings), "critical": sum(1 for f in findings if f["severity"] == "critical"), "high": sum(1 for f in findings if f["severity"] == "high")},
        "passed": len(findings) == 0,
    }
\`\`\`

## Examples

\`\`\`python
result = scan('aws_key = "AKIA12345678901234"', "config.py")
print(result["summary"]["critical"])  # 1
\`\`\`

## Tests

\`\`\`python
def test_scan_clean():
    r = scan("no secrets here")
    assert r["passed"] is True

def test_scan_finds_aws_key():
    r = scan('key = "AKIA12345678901234ABCD"')
    assert r["summary"]["critical"] >= 1

def test_scan_severity_filter():
    r = scan('password = "secret123"', severity_threshold="critical")
    assert r["summary"]["critical"] == 0
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 13. prompt
  // -------------------------------------------------------------------------
  prompt: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['prompt', 'ai'], [])}

# ${name}

## Purpose

Structured prompt engineering template with variables, few-shot examples, and output formatting.

## Prompt Template

\`\`\`
You are a helpful assistant specialized in {{domain}}.

## Task
{{task_description}}

## Context
{{context}}

## Instructions
1. {{instruction_1}}
2. {{instruction_2}}
3. {{instruction_3}}

## Few-Shot Examples
{{examples}}

## Output Format
Respond in the following format:
{
  "answer": "<your answer>",
  "confidence": <0.0-1.0>,
  "reasoning": "<your reasoning>"
}
\`\`\`

## Variables

| Name | Type | Required | Description |
|------|------|----------|-------------|
| domain | string | Yes | Area of expertise |
| task_description | string | Yes | What the model should do |
| context | string | No | Background information |
| instruction_1 | string | Yes | First instruction |
| instruction_2 | string | Yes | Second instruction |
| instruction_3 | string | No | Third instruction |
| examples | string | No | Few-shot examples |

## Rules

- Variables must be provided or have defaults
- Output must be valid JSON
- Temperature: 0.3 for factual, 0.7 for creative
- Maximum tokens: 2048

## Python

\`\`\`python
import re
from typing import Any

def render_prompt(template: str, variables: dict[str, str]) -> str:
    """Render a prompt template with variables."""
    rendered = template
    for key, value in variables.items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    missing = re.findall(r"\\{\\{(\\w+)\\}\\}", rendered)
    if missing:
        raise ValueError(f"Missing variables: {missing}")
    return rendered

def format_output(answer: str, confidence: float, reasoning: str) -> dict:
    """Format model output as structured response."""
    return {"answer": answer, "confidence": max(0.0, min(1.0, confidence)), "reasoning": reasoning}
\`\`\`

## Examples

\`\`\`python
template = "You are an expert in {{domain}}. Task: {{task}}"
result = render_prompt(template, {"domain": "Python", "task": "Review code"})
print(result)  # "You are an expert in Python. Task: Review code"
\`\`\`

## Tests

\`\`\`python
def test_render_basic():
    r = render_prompt("Hello {{name}}", {"name": "World"})
    assert r == "Hello World"

def test_render_missing():
    try:
        render_prompt("{{missing}}", {})
        assert False, "Should raise"
    except ValueError:
        pass

def test_format_output():
    r = format_output("yes", 0.9, "because")
    assert r["confidence"] == 0.9
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 14. multi-agent
  // -------------------------------------------------------------------------
  'multi-agent': (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['multi-agent', 'orchestration'], ['network', 'exec'], {
    description: `Orchestrated multi-agent system — ${name}`,
  })}

# ${name}

## Purpose

Orchestrated multi-agent system with pub/sub messaging and task delegation.

## Agents

| Agent | Capabilities | Model |
|-------|-------------|-------|
| planner | Task decomposition, scheduling | gpt-4 |
| researcher | Web search, document analysis | gpt-4 |
| coder | Code generation, testing | gpt-4 |
| critic | Review, quality assurance | gpt-4 |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| goal | string | Yes | High-level objective |
| budget | integer | No | Maximum agent invocations (default: 20) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| deliverable | object | Final output |
| agent_log | array | Per-agent activity log |
| cost | number | Total invocations used |

## Rules

- Planner initiates all tasks
- Each agent has a dedicated message queue
- Maximum 3 retries per agent call
- Budget hard-stop: no agent may exceed budget

## Workflow

\`\`\`mermaid
flowchart TD
    A[Goal] --> B[Planner: Decompose]
    B --> C[Planner: Schedule]
    C --> D[Researcher: Gather Info]
    D --> E[Coder: Implement]
    E --> F[Critic: Review]
    F --> G{Pass?}
    G -->|Yes| H[Deliver]
    G -->|No| B
\`\`\`

## Python

\`\`\`python
from typing import Any

# @mam:timeout=600s
# @mam:requires=network

class AgentBus:
    def __init__(self):
        self.queues: dict[str, list[dict]] = {}
        self.log: list[dict] = []

    def publish(self, agent: str, message: dict) -> None:
        self.queues.setdefault(agent, []).append(message)
        self.log.append({"agent": agent, "message": message.get("type", "unknown")})

    def consume(self, agent: str) -> dict | None:
        q = self.queues.get(agent, [])
        return q.pop(0) if q else None

class Orchestrator:
    def __init__(self, name: str, budget: int = 20):
        self.name = name
        self.budget = budget
        self.bus = AgentBus()
        self.cost = 0

    def run(self, goal: str) -> dict:
        plan = self._plan(goal)
        for step in plan:
            if self.cost >= self.budget:
                break
            self._execute_step(step)
            self.cost += 1

        return {"deliverable": {"goal": goal, "steps_completed": self.cost}, "agent_log": self.bus.log, "cost": self.cost}

    def _plan(self, goal: str) -> list[dict]:
        return [{"agent": "planner", "action": "decompose", "goal": goal}, {"agent": "researcher", "action": "search"}, {"agent": "coder", "action": "implement"}, {"agent": "critic", "action": "review"}]

    def _execute_step(self, step: dict) -> None:
        self.bus.publish(step["agent"], {"type": step["action"]})

orch = Orchestrator("${name}")
\`\`\`

## Examples

\`\`\`python
orch = Orchestrator("my-system", budget=10)
result = orch.run("Build a REST API for user management")
print(result["cost"])  # <= 10
\`\`\`

## Tests

\`\`\`python
def test_orchestrator_within_budget():
    o = Orchestrator("test", budget=3)
    r = o.run("task")
    assert r["cost"] <= 3

def test_bus_publish_consume():
    b = AgentBus()
    b.publish("a1", {"type": "test"})
    msg = b.consume("a1")
    assert msg["type"] == "test"

def test_empty_queue():
    b = AgentBus()
    assert b.consume("empty") is None
\`\`\`
`,

  // -------------------------------------------------------------------------
  // 15. system
  // -------------------------------------------------------------------------
  system: (name, runtime, author) => `${genFrontmatter(name, runtime, author, ['system', 'infra'], ['network', 'exec', 'filesystem'], {
    description: `System configuration — ${name}`,
  })}

# ${name}

## Purpose

System-level configuration and infrastructure management module.

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| log_level | string | info | Logging verbosity |
| max_workers | integer | 4 | Worker thread count |
| enable_metrics | boolean | true | Enable Prometheus metrics |
| health_check_interval | integer | 30 | Seconds between health checks |
| graceful_shutdown_timeout | integer | 10 | Seconds to wait for shutdown |

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| action | string | Yes | start, stop, status, reload |
| config_overrides | object | No | Override default config |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | System status |
| uptime | number | Seconds since start |
| config | object | Active configuration |

## Rules

- Config changes require validation before apply
- Graceful shutdown drains in-flight requests
- Health checks must respond within 5 seconds
- Metrics endpoint on /metrics

## Workflow

\`\`\`mermaid
flowchart TD
    A[Start] --> B[Load Config]
    B --> C[Validate Config]
    C --> D[Start Workers]
    D --> E[Health Check Loop]
    E --> F{Shutdown?}
    F -->|No| E
    F -->|Yes| G[Drain Requests]
    G --> H[Stop Workers]
    H --> I[Exit]
\`\`\`

## Python

\`\`\`python
import time
from typing import Any

# @mam:timeout=inf
# @mam:requires=exec

class SystemManager:
    def __init__(self, name: str, config: dict | None = None):
        self.name = name
        self.config = {
            "log_level": "info", "max_workers": 4, "enable_metrics": True,
            "health_check_interval": 30, "graceful_shutdown_timeout": 10,
        }
        if config:
            self.config.update(config)
        self.status = "stopped"
        self.start_time: float | None = None

    def start(self) -> dict:
        if self.status == "running":
            return {"status": "already_running", "uptime": self._uptime()}
        self.status = "running"
        self.start_time = time.time()
        return {"status": "started", "config": dict(self.config)}

    def stop(self) -> dict:
        if self.status == "stopped":
            return {"status": "already_stopped"}
        self.status = "stopped"
        return {"status": "stopped", "uptime": self._uptime()}

    def reload(self, overrides: dict | None = None) -> dict:
        if overrides:
            self.config.update(overrides)
        return {"status": "reloaded", "config": dict(self.config)}

    def health(self) -> dict:
        return {"status": self.status, "uptime": self._uptime(), "healthy": self.status == "running"}

    def _uptime(self) -> float:
        if self.start_time and self.status == "running":
            return time.time() - self.start_time
        return 0.0

sys_mgr = SystemManager("${name}")
\`\`\`

## Examples

\`\`\`python
mgr = SystemManager("my-system", {"max_workers": 8})
print(mgr.start())  # {"status": "started", ...}
print(mgr.health())  # {"status": "running", "healthy": true}
mgr.stop()
\`\`\`

## Tests

\`\`\`python
def test_start_stop():
    m = SystemManager("t")
    m.start()
    assert m.status == "running"
    m.stop()
    assert m.status == "stopped"

def test_reload():
    m = SystemManager("t")
    r = m.reload({"max_workers": 16})
    assert r["config"]["max_workers"] == 16

def test_health():
    m = SystemManager("t")
    m.start()
    assert m.health()["healthy"] is True
\`\`\`
`,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_MODULE_NAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9\-]*[a-zA-Z0-9])?$/;

function validateModuleName(name: string): string | null {
  if (!name || name.length === 0) return 'Module name cannot be empty';
  if (name.length > 64) return 'Module name must be 64 characters or fewer';
  if (name.includes(' ')) return 'Module name cannot contain spaces';
  if (!VALID_MODULE_NAME_RE.test(name)) return 'Module name must be alphanumeric with hyphens (no leading/trailing hyphen)';
  return null;
}

function gitignoreContent(): string {
  return `# MAM build artifacts
dist/
build/
*.mam-buildinfo

# Dependencies
node_modules/
.pnp.*

# Python
__pycache__/
*.pyc
*.pyo
.venv/
venv/
*.egg-info/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
logs/
`;
}

function readmeContent(name: string, template: string, runtime: string): string {
  return `# ${name}

> Generated from the **${template}** template.

## Quick Start

\`\`\`bash
# Install dependencies
${runtime === 'node' ? 'npm install' : 'pip install -r requirements.txt'}

# Run the module
${runtime === 'node' ? 'npm start' : 'python -m ${name}'}
\`\`\`

## Structure

\`\`\`
${name}/
  ${name}.mam.md    # MAM module definition
  README.md        # This file
  mam-package.json # Package metadata
\`\`\`

## Development

\`\`\`bash
# Validate
mam validate ${name}.mam.md

# Build
mam build ${name}.mam.md

# Compile
mam compile ${name}.mam.md --target python
\`\`\`
`;
}

function mamPackageJson(name: string, template: string, runtime: string, author: string): string {
  return JSON.stringify({
    name,
    version: '1.0.0',
    description: `MAM module: ${name} (${template} template)`,
    runtime,
    template,
    author,
    license: 'MIT',
    mam: { format: 1, template },
  }, null, 2) + '\n';
}

function packageJsonContent(name: string): string {
  return JSON.stringify({
    name,
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: {
      build: 'mam build src',
      validate: 'mam validate src',
      compile: 'mam compile src --target python',
    },
  }, null, 2) + '\n';
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

async function initGit(dir: string): Promise<void> {
  try {
    await execFileAsync('git', ['init'], { cwd: dir });
  } catch {
    // Git init is best-effort
  }
}

function printPreview(name: string, template: TemplateName, runtime: string, author: string): void {
  console.log(chalk.cyan('\n--- Template Preview ---\n'));
  const content = TEMPLATES[template](name, runtime, author);
  const lines = content.split('\n');
  const preview = lines.slice(0, 40).join('\n');
  console.log(preview);
  if (lines.length > 40) {
    console.log(chalk.gray(`\n... (${lines.length - 40} more lines)\n`));
  }
}

// ---------------------------------------------------------------------------
// Interactive prompts (dynamic import for inquirer)
// ---------------------------------------------------------------------------

async function promptTemplate(): Promise<TemplateName> {
  const inquirer = await import('inquirer');
  const { template } = await inquirer.default.prompt([{
    type: 'list',
    name: 'template',
    message: 'Select a template:',
    choices: TEMPLATE_META.map((t) => ({
      name: `${t.label.padEnd(18)} ${chalk.gray(t.description)}`,
      value: t.name,
    })),
  }]);
  return template;
}

async function promptRuntime(): Promise<string> {
  const inquirer = await import('inquirer');
  const { runtime } = await inquirer.default.prompt([{
    type: 'list',
    name: 'runtime',
    message: 'Select runtime:',
    choices: [
      { name: 'Python', value: 'python' },
      { name: 'Node.js', value: 'node' },
      { name: 'Go', value: 'go' },
      { name: 'Rust', value: 'rust' },
      { name: 'Java', value: 'java' },
      { name: 'C#', value: 'csharp' },
      { name: 'WASM', value: 'wasm' },
    ],
  }]);
  return runtime;
}

async function promptAuthor(): Promise<string> {
  const inquirer = await import('inquirer');
  const { author } = await inquirer.default.prompt([{
    type: 'input',
    name: 'author',
    message: 'Author name:',
    default: 'Author',
    validate: (input: string) => input.trim().length > 0 || 'Author name is required',
  }]);
  return author.trim();
}

async function promptModuleName(): Promise<string> {
  const inquirer = await import('inquirer');
  const { name } = await inquirer.default.prompt([{
    type: 'input',
    name: 'name',
    message: 'Module name:',
    validate: (input: string) => {
      const error = validateModuleName(input.trim());
      return error || true;
    },
  }]);
  return name.trim();
}

async function confirmForce(): Promise<boolean> {
  const inquirer = await import('inquirer');
  const { confirm } = await inquirer.default.prompt([{
    type: 'confirm',
    name: 'confirm',
    message: 'Directory already exists. Overwrite?',
    default: false,
  }]);
  return confirm;
}

async function confirmGitInit(): Promise<boolean> {
  const inquirer = await import('inquirer');
  const { git } = await inquirer.default.prompt([{
    type: 'confirm',
    name: 'git',
    message: 'Initialize git repository?',
    default: true,
  }]);
  return git;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

async function createModule(
  name: string,
  template: TemplateName,
  runtime: string,
  author: string,
  dir: string,
  options: InitOptions,
): Promise<void> {
  const targetDir = join(dir, name);
  const targetFile = join(targetDir, `${name}.mam.md`);

  const exists = await directoryExists(targetDir);
  if (exists && !options.force) {
    if (options.dryRun) {
      console.log(chalk.yellow(`[dry-run] Would overwrite: ${targetDir}`));
    } else {
      const confirmed = await confirmForce();
      if (!confirmed) {
        console.log(chalk.yellow('Aborted.'));
        return;
      }
    }
  }

  if (options.dryRun) {
    console.log(chalk.cyan(`[dry-run] Creating directory: ${targetDir}`));
    console.log(chalk.cyan(`[dry-run] Writing ${targetFile}`));
    if (options.readme) console.log(chalk.cyan(`[dry-run] Writing ${join(targetDir, 'README.md')}`));
    if (options.packageJson) console.log(chalk.cyan(`[dry-run] Writing ${join(targetDir, 'package.json')}`));
    console.log(chalk.cyan(`[dry-run] Writing ${join(targetDir, 'mam-package.json')}`));
    console.log(chalk.cyan(`[dry-run] Writing ${join(targetDir, '.gitignore')}`));
    if (options.git) console.log(chalk.cyan('[dry-run] Running git init'));
    return;
  }

  // Create directory
  await mkdir(targetDir, { recursive: true });

  // Write MAM file
  const content = TEMPLATES[template](name, runtime, author);
  await writeFile(targetFile, content, 'utf-8');

  // Write supporting files
  await writeFile(join(targetDir, '.gitignore'), gitignoreContent(), 'utf-8');
  await writeFile(join(targetDir, 'mam-package.json'), mamPackageJson(name, template, runtime, author), 'utf-8');

  if (options.readme) {
    await writeFile(join(targetDir, 'README.md'), readmeContent(name, template, runtime), 'utf-8');
  }

  if (options.packageJson) {
    await writeFile(join(targetDir, 'package.json'), packageJsonContent(name), 'utf-8');
  }

  // Git init
  if (options.git) {
    await initGit(targetDir);
  }

  // Report
  console.log(chalk.green(`\n  Created module: ${targetFile}`));
  console.log(chalk.gray(`    Template:     ${template}`));
  console.log(chalk.gray(`    Runtime:      ${runtime}`));
  console.log(chalk.gray(`    Author:       ${author}`));
  if (options.git) console.log(chalk.gray(`    Git:          initialized`));
  if (options.readme) console.log(chalk.gray(`    README:       yes`));
  if (options.packageJson) console.log(chalk.gray(`    package.json: yes`));
}

// ---------------------------------------------------------------------------
// Batch creation
// ---------------------------------------------------------------------------

async function batchCreate(
  names: string[],
  template: TemplateName,
  runtime: string,
  author: string,
  dir: string,
  options: InitOptions,
): Promise<void> {
  const spinner = ora(`Creating ${names.length} modules...`).start();
  let created = 0;
  let skipped = 0;

  for (const name of names) {
    const error = validateModuleName(name);
    if (error) {
      console.log(chalk.yellow(`  Skipping "${name}": ${error}`));
      skipped++;
      continue;
    }

    spinner.text = `[${created + skipped + 1}/${names.length}] Creating ${name}...`;
    try {
      await createModule(name, template, runtime, author, dir, { ...options, force: true });
      created++;
    } catch (err) {
      console.log(chalk.red(`  Failed to create "${name}": ${(err as Error).message}`));
      skipped++;
    }
  }

  spinner.succeed(`Batch complete: ${created} created, ${skipped} skipped`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function initCommand(options: InitOptions): Promise<void> {
  const spinner = ora('Initializing module...').start();

  try {
    const dir = options.dir ? resolve(options.dir) : process.cwd();

    // Interactive mode: fill in missing options
    let name = options.name;
    let template = options.template;
    let runtime = options.runtime;
    let author = options.author;

    // Determine if interactive mode is needed
    const isInteractive = !name || !template || !runtime || !author;

    if (isInteractive) {
      spinner.stop();
      if (!name) name = await promptModuleName();
      if (!template) template = await promptTemplate();
      if (!runtime) runtime = await promptRuntime();
      if (!author) author = await promptAuthor();

      if (options.git === undefined) {
        options.git = await confirmGitInit();
      }

      spinner.start();
    }

    // Validate
    if (!name) {
      spinner.fail('Module name is required');
      process.exit(1);
    }

    const nameError = validateModuleName(name);
    if (nameError) {
      spinner.fail(nameError);
      process.exit(1);
    }

    if (!template || !VALID_TEMPLATE_NAMES.includes(template)) {
      spinner.fail(`Invalid template: ${template}. Valid: ${VALID_TEMPLATE_NAMES.join(', ')}`);
      process.exit(1);
    }

    runtime = runtime || 'python';
    author = author || 'Author';

    // Preview mode
    if (options.preview) {
      spinner.stop();
      printPreview(name, template, runtime, author);
      return;
    }

    // Batch mode
    if (options.batch && options.name) {
      spinner.stop();
      const names = options.name.split(',').map((n) => n.trim()).filter(Boolean);
      if (names.length > 1) {
        await batchCreate(names, template, runtime, author, dir, options);
        return;
      }
    }

    // Single module creation
    spinner.text = `Creating ${name}...`;
    spinner.start();

    await createModule(name, template, runtime, author, dir, options);

    spinner.succeed(`Module "${name}" created successfully`);
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}

export { TEMPLATE_META, VALID_TEMPLATE_NAMES, validateModuleName };
