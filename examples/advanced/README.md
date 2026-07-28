# Advanced MAM Examples

This directory contains complex MAM modules showcasing multi-agent systems and workflow orchestration.

## Files

| Module | Description |
|--------|-------------|
| `agent.mam.md` | Multi-agent system with Planner, Researcher, and Writer agents |
| `workflow.mam.md` | Multi-step workflow with branching logic and parallel tasks |

## What You'll Learn

- Defining `module` declarations with `type: agent`, `type: tool`, `type: memory`
- Wiring agents together with `handoff` and `edges`
- Defining `type: workflow` with steps, conditions, and parallel execution
- Using `type: memory` for shared state across agents
- Using `type: policy` for safety guardrails
