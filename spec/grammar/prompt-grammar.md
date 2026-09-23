# MAM Prompt Grammar

## Overview

The MAM Prompt grammar defines how a module describes LLM interactions. The `## Prompt` section carries instructions for an AI agent: the role it plays, the task it performs, the constraints it follows, and the output format it must produce. The grammar supports plain instruction lines, structured blocks, template variables, and few shot examples.

## Description

The Prompt section describes:

- **Role**: What the AI agent is
- **Task**: What the agent must do
- **Constraints**: What the agent must respect
- **Context**: What background the agent needs
- **Output**: What format the agent returns
- **Safety**: What the agent must avoid
- **Examples**: What good behavior looks like

## Syntax

### Section Header

```markdown
## Prompt
```

### Plain Instructions

```markdown
## Prompt

You are a helpful assistant.
Always be polite and professional.
```

### Structured Prompt

Use `###` sub headings to organize the prompt:

```markdown
## Prompt

### Role

You are an AI assistant specialized in data processing.

### Task

When a user provides data, analyze it and provide insights.

### Constraints

- Be factual and accurate
- Acknowledge uncertainty
- Provide citations when possible
```

### Template Variables

Use `{{variable}}` syntax for interpolation:

```markdown
## Prompt

You are assisting with {{module_name}}.

When processing {{input_type}} data:
1. Validate the input
2. Process according to the rules
3. Return structured output
```

### Few Shot Examples

```markdown
## Prompt

When asked to classify, follow these examples:

Input: hello
Output: greeting

Input: goodbye
Output: farewell
```

## Grammar Rules

| Rule | Description |
|------|-------------|
| Clear | Instructions must be clear and specific |
| Structured | Use structured format when possible |
| Safe | Follow AI safety guidelines |
| Accurate | Emphasize factual accuracy |
| Transparent | Be transparent about limitations |
| Consent | Inform users about AI usage |
| Private | Do not request unnecessary personal data |

## Notes

- Template variables use double brace syntax.
- Variables may appear in any instruction line.
- Sub headings must increase in level by exactly one.
- Constraints use bullet lists.
- Output format may be specified with a code block.
- Safety guidelines should always be present.

## References

- MAM Prompt section specification
- MAM section grammar specification
- MAM AST specification