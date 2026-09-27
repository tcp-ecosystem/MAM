# Agent Module Examples

> **AI agent modules for autonomous systems.**

---

## Customer Support Agent

An AI agent that handles customer queries:

```markdown
---
id: customer-support
version: 2.0.0
name: Customer Support Agent
author: LifeJiggy
runtime: python
tags:
  - agent
  - support
  - ai
permissions:
  - network
---

## Purpose

AI agent that handles customer support queries with memory of past interactions.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | Yes | Customer query |
| session_id | string | Yes | Session identifier |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| response | string | Agent response |
| actions | list | Actions taken |

## Rules

- Always be polite and professional
- Escalate complex issues to humans
- Remember past interactions
- Never share internal information
- Log all interactions

## Prompt

You are a helpful customer support agent. Your role is to:

1. Understand customer queries
2. Provide accurate information
3. Resolve issues when possible
4. Escalate when necessary

When responding:
- Use a friendly, professional tone
- Be concise but thorough
- Reference past interactions when relevant
- Offer next steps

## Memory

```yaml
interactions: []
known_issues: {}
escalation_count: 0
```

## Python

```python
def handle_query(query: str, session_id: str, memory: dict) -> dict:
    """Handle customer query with memory."""
    # Store interaction
    memory["interactions"].append({
        "query": query,
        "session_id": session_id,
        "timestamp": datetime.now().isoformat()
    })
    
    # Check for known issues
    for issue, solution in memory.get("known_issues", {}).items():
        if issue.lower() in query.lower():
            return {
                "response": f"I understand you're having trouble with {issue}. {solution}",
                "actions": ["provided_known_solution"]
            }
    
    # Generate response
    response = generate_response(query, memory)
    
    return {
        "response": response,
        "actions": ["logged_interaction"]
    }
```
```

---

## Code Review Agent

An AI agent that reviews code:

```markdown
---
id: code-review
version: 2.0.0
name: Code Review Agent
author: LifeJiggy
runtime: python
tags:
  - agent
  - code-review
  - ai
---

## Purpose

AI agent that reviews code for quality, security, and best practices.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| code | string | Yes | Code to review |
| language | string | Yes | Programming language |
| context | string | No | Additional context |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| review | dict | Review results |
| suggestions | list | Improvement suggestions |
| score | number | Quality score (0-100) |

## Prompt

You are an expert code reviewer. Review the provided code for:

1. **Correctness** - Does the code do what it's supposed to?
2. **Security** - Are there any security vulnerabilities?
3. **Performance** - Are there any performance issues?
4. **Readability** - Is the code easy to understand?
5. **Best Practices** - Does it follow language best practices?

Provide:
- Overall quality score (0-100)
- Specific issues found
- Improvement suggestions
- Code examples for fixes

## Python

```python
def review_code(code: str, language: str, context: str = "") -> dict:
    """Review code and provide feedback."""
    issues = []
    suggestions = []
    score = 100
    
    # Check for common issues
    if "eval(" in code:
        issues.append("Use of eval() is dangerous")
        score -= 20
    
    if "except:" in code or "except Exception:" in code:
        issues.append("Bare except clause catches all exceptions")
        score -= 10
    
    if "TODO" in code or "FIXME" in code:
        suggestions.append("Contains TODO/FIXME comments")
        score -= 5
    
    return {
        "review": {
            "issues": issues,
            "score": max(0, score)
        },
        "suggestions": suggestions,
        "score": max(0, score)
    }
```
```

---

## Data Analyst Agent

An AI agent that analyzes data:

```markdown
---
id: data-analyst
version: 2.0.0
name: Data Analyst Agent
author: LifeJiggy
runtime: python
tags:
  - agent
  - data
  - analysis
---

## Purpose

AI agent that analyzes datasets and provides insights.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | list | Yes | Dataset to analyze |
| question | string | Yes | Analysis question |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| insights | list | Key insights |
| visualizations | list | Suggested visualizations |
| summary | string | Analysis summary |

## Prompt

You are a data analyst agent. Analyze the provided data and answer the question.

Steps:
1. Understand the data structure
2. Identify relevant columns
3. Perform analysis
4. Draw conclusions
5. Suggest visualizations

## Python

```python
def analyze_data(data: list, question: str) -> dict:
    """Analyze data and provide insights."""
    if not data:
        return {
            "insights": ["No data provided"],
            "visualizations": [],
            "summary": "Cannot analyze empty dataset"
        }
    
    # Analyze based on question
    insights = []
    if "trend" in question.lower():
        insights.append("Data shows an upward trend over time")
    if "distribution" in question.lower():
        insights.append("Data is normally distributed")
    
    return {
        "insights": insights,
        "visualizations": ["line_chart", "histogram"],
        "summary": f"Analysis complete for {len(data)} records"
    }
```
```

---

## Research Agent

An AI agent that conducts research:

```markdown
---
id: research-agent
version: 2.0.0
name: Research Agent
author: LifeJiggy
runtime: python
tags:
  - agent
  - research
  - ai
permissions:
  - network
---

## Purpose

AI agent that conducts research on topics and synthesizes information.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| topic | string | Yes | Research topic |
| depth | string | No | Research depth (quick, standard, deep) |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| findings | list | Research findings |
| sources | list | Information sources |
| summary | string | Research summary |

## Prompt

You are a research agent. Conduct thorough research on the topic.

Steps:
1. Identify key aspects of the topic
2. Gather information from reliable sources
3. Analyze and synthesize findings
4. Provide comprehensive summary
5. Cite all sources

## Python

```python
def research(topic: str, depth: str = "standard") -> dict:
    """Conduct research on topic."""
    findings = []
    sources = []
    
    # Research logic
    if depth == "quick":
        findings.append(f"Quick overview of {topic}")
    elif depth == "standard":
        findings.append(f"Standard analysis of {topic}")
        findings.append(f"Key points about {topic}")
    else:  # deep
        findings.append(f"Comprehensive analysis of {topic}")
        findings.append(f"Historical context of {topic}")
        findings.append(f"Current trends in {topic}")
        findings.append(f"Future outlook for {topic}")
    
    return {
        "findings": findings,
        "sources": sources,
        "summary": f"Research on {topic} completed"
    }
```
```

---

## Next Steps

- [Workflow Examples](./workflow.md) — Workflow modules
- [Writing Modules](../guides/writing-modules.md) — How to write modules

---

**Last Updated:** 2026-07-24
**MAM Version:** 1.0.0
