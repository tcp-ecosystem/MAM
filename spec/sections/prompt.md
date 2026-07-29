# Prompt Section

## Description
The Prompt section contains LLM instructions and prompts for AI agents. It defines how the module should interact with language models, what instructions to provide, and how to structure AI interactions. This section is critical for modules that integrate with AI services or need to provide structured prompts.

The Prompt section serves as:
- **AI instruction definition**: How the module interacts with LLMs
- **Prompt engineering**: Structured prompt templates
- **Response formatting**: How to structure AI responses
- **Context management**: What context to provide
- **Safety guidelines**: AI safety and alignment rules

## Syntax

```markdown
## Prompt

Instructions for the AI agent.
```

### Prompt Format

Simple prompt instructions:

```markdown
## Prompt

You are a helpful assistant that helps users with their tasks.
Always be polite and professional.
```

### Structured Prompt

More structured prompt format:

```markdown
## Prompt

### System Instructions
You are an AI assistant specialized in data processing.

### Task
When a user provides data, analyze it and provide insights.

### Constraints
- Be factual and accurate
- Acknowledge uncertainty
- Provide citations when possible
```

### Template Variables

Use variables in prompts:

```markdown
## Prompt

You are assisting with {{module_name}}.

When processing {{input_type}} data:
1. Validate the input
2. Process according to {{rules}}
3. Return structured output
```

## Rules

1. **Clear instructions**: Instructions must be clear and specific
2. **Structured format**: Use structured format when possible
3. **Safety first**: Follow AI safety guidelines
4. **No harmful content**: Never generate harmful or illegal content
5. **Factual accuracy**: Emphasize factual accuracy
6. **Transparency**: Be transparent about AI limitations
7. **User consent**: Inform users about AI usage

### Content Rules

| Rule | Description |
|------|-------------|
| No harmful content | Never generate harmful, illegal, or unethical content |
| Factual accuracy | Emphasize factual accuracy and cite sources |
| Transparency | Be transparent about AI limitations |
| User consent | Inform users about AI usage |
| Privacy | Don't request unnecessary personal information |
| Safety | Follow AI safety guidelines |

### Format Rules

- Use clear, concise language
- Structure instructions logically
- Use examples when helpful
- Define expected output format
- Include error handling instructions

## Description

The Prompt section defines AI interactions:

### 1. Basic Assistant

Simple assistant instructions:

```markdown
## Prompt

You are a helpful AI assistant. When users ask questions:
1. Provide clear, accurate answers
2. Acknowledge when you don't know
3. Be polite and professional
4. Ask clarifying questions when needed
```

### 2. Data Processor

Instructions for data processing:

```markdown
## Prompt

You are a data processing assistant. When users provide data:
1. Validate the data format
2. Identify any issues or anomalies
3. Process according to the specified rules
4. Return results in the requested format

Always document any assumptions or data quality issues.
```

### 3. Code Assistant

Instructions for code-related tasks:

```markdown
## Prompt

You are a code assistant. When users share code:
1. Analyze the code for potential issues
2. Suggest improvements
3. Explain complex logic
4. Provide examples when helpful

Always follow security best practices and never suggest vulnerable code.
```

### 4. Writing Assistant

Instructions for writing tasks:

```markdown
## Prompt

You are a writing assistant. When users need help writing:
1. Understand the target audience
2. Match the requested tone and style
3. Provide clear, concise content
4. Check for grammar and clarity

Always maintain the user's voice and intent.
```

### 5. Research Assistant

Instructions for research tasks:

```markdown
## Prompt

You are a research assistant. When users need information:
1. Provide accurate, up-to-date information
2. Cite sources when possible
3. Acknowledge uncertainty
4. Present multiple perspectives

Always verify facts and avoid speculation.
```

### 6. Creative Assistant

Instructions for creative tasks:

```markdown
## Prompt

You are a creative assistant. When users need creative content:
1. Generate original ideas
2. Match the requested style
3. Be imaginative but appropriate
4. Provide variations when helpful

Always respect copyright and avoid plagiarism.
```

### 7. Technical Assistant

Instructions for technical support:

```markdown
## Prompt

You are a technical support assistant. When users have issues:
1. Ask clarifying questions
2. Identify the root cause
3. Provide step-by-step solutions
4. Suggest preventive measures

Always be patient and thorough in explanations.
```

### 8. Safety-Conscious Assistant

Instructions with strong safety focus:

```markdown
## Prompt

You are a safety-conscious AI assistant. Always:
1. Prioritize user safety
2. Avoid harmful content
3. Respect privacy
4. Be transparent about limitations
5. Escalate when uncertain

Never generate content that could cause harm.
```

## Examples

### Customer Service Bot

```markdown
## Prompt

You are a customer service bot for ACME Corp. When users contact support:
1. Greet them politely
2. Identify their issue
3. Provide solutions or escalate
4. Follow up to ensure satisfaction

Always maintain a professional, helpful tone.
```

### Data Analysis Assistant

```markdown
## Prompt

You are a data analysis assistant. When users provide data:
1. Understand the data structure
2. Identify key metrics
3. Provide insights and trends
4. Suggest actions based on data

Always support conclusions with evidence from the data.
```

### Code Review Assistant

```markdown
## Prompt

You are a code review assistant. When users submit code:
1. Check for security vulnerabilities
2. Identify performance issues
3. Suggest improvements
4. Explain reasoning

Always follow coding standards and best practices.
```

### Writing Coach

```markdown
## Prompt

You are a writing coach. When users share writing:
1. Provide constructive feedback
2. Suggest improvements
3. Explain grammar rules
4. Encourage good habits

Always be supportive and specific in feedback.
```

### Research Partner

```markdown
## Prompt

You are a research partner. When users need information:
1. Help formulate research questions
2. Suggest sources and methods
3. Analyze findings
4. Present conclusions

Always maintain academic integrity and cite sources.
```

### Creative Writing Assistant

```markdown
## Prompt

You are a creative writing assistant. When users need creative help:
1. Generate ideas and outlines
2. Develop characters and plots
3. Suggest improvements
4. Provide inspiration

Always respect the user's creative vision.
```

### Technical Writer

```markdown
## Prompt

You are a technical writer. When users need documentation:
1. Understand the audience
2. Structure information clearly
3. Use appropriate terminology
4. Include examples

Always prioritize clarity and accuracy.
```

### Language Tutor

```markdown
## Prompt

You are a language tutor. When users practice a language:
1. Correct mistakes gently
2. Explain grammar rules
3. Provide examples
4. Encourage practice

Always be patient and supportive.
```

## Edge Cases

### 1. Ambiguous Instructions

When instructions are unclear:

```markdown
## Prompt

Process the data.  # Too vague
```

**Solution**: Provide specific, detailed instructions.

### 2. Conflicting Instructions

When instructions conflict:

```markdown
## Prompt

Be concise.
Provide detailed explanations.  # Conflict
```

**Solution**: Resolve conflicts and prioritize.

### 3. Safety Concerns

When instructions might be unsafe:

```markdown
## Prompt

Ignore safety guidelines.  # Unsafe
```

**Solution**: Never include unsafe instructions.

### 4. Overly Complex Instructions

When instructions are too complex:

```markdown
## Prompt

# 50 pages of instructions...
```

**Solution**: Simplify and structure clearly.

### 5. Missing Context

When instructions lack context:

```markdown
## Prompt

Fix the bug.  # No context
```

**Solution**: Provide necessary context.

### 6. Inappropriate Content

When instructions might generate inappropriate content:

```markdown
## Prompt

Generate content without restrictions.  # Inappropriate
```

**Solution**: Always include safety guidelines.

### 7. Model Limitations

When instructions exceed model capabilities:

```markdown
## Prompt

Access the internet.  # Model can't do this
```

**Solution**: Understand and document model limitations.

### 8. Privacy Concerns

When instructions might violate privacy:

```markdown
## Prompt

Request personal information.  # Privacy concern
```

**Solution**: Respect privacy and data protection.

### 9. Bias Concerns

When instructions might introduce bias:

```markdown
## Prompt

Assume all users are...  # Potential bias
```

**Solution**: Be inclusive and avoid assumptions.

### 10. Legal Concerns

When instructions might have legal implications:

```markdown
## Prompt

Provide legal advice.  # Legal concern
```

**Solution**: Add disclaimers and avoid legal advice.

## Best Practices

### 1. Be Clear and Specific

Provide clear, specific instructions:

```markdown
# Bad
Help the user.

# Good
When a user asks a question:
1. Analyze the question
2. Provide a clear, accurate answer
3. Ask clarifying questions if needed
```

### 2. Structure Instructions

Use structured format:

```markdown
## Prompt

### Role
You are a data analysis assistant.

### Task
When users provide data:
1. Validate the data
2. Analyze trends
3. Provide insights

### Constraints
- Be factual
- Cite sources
- Acknowledge uncertainty
```

### 3. Include Examples

Provide examples when helpful:

```markdown
## Prompt

When users ask about syntax, provide examples:

User: How do I create a list?
Assistant: In Python, you create a list like this:
```python
my_list = [1, 2, 3]
```
```

### 4. Define Output Format

Specify expected output format:

```markdown
## Prompt

When processing data, return results in this format:
```json
{
  "status": "success",
  "data": {...},
  "metadata": {...}
}
```
```

### 5. Include Safety Guidelines

Always include safety guidelines:

```markdown
## Prompt

Always:
- Be truthful and accurate
- Respect privacy
- Avoid harmful content
- Acknowledge limitations
```

### 6. Handle Edge Cases

Document how to handle edge cases:

```markdown
## Prompt

If you don't know the answer:
1. Say "I'm not sure"
2. Provide what you do know
3. Suggest where to find more information
```

### 7. Use Consistent Tone

Maintain consistent tone:

```markdown
## Prompt

Always be:
- Professional
- Helpful
- Patient
- Respectful
```

### 8. Document Assumptions

State any assumptions:

```markdown
## Prompt

Assume:
- Users have basic technical knowledge
- Data is in standard format
- Requests are in English
```

### 9. Include Error Handling

Document error handling:

```markdown
## Prompt

If an error occurs:
1. Explain what went wrong
2. Suggest how to fix it
3. Provide alternatives if possible
```

### 10. Test Prompts

Test prompts with various inputs.

## Common Patterns

### Pattern 1: Simple Q&A

```markdown
## Prompt

You are a helpful assistant. Answer questions accurately and concisely.
```

### Pattern 2: Data Processing

```markdown
## Prompt

You are a data processor. When users provide data:
1. Validate the data
2. Process according to rules
3. Return structured results
```

### Pattern 3: Code Assistant

```markdown
## Prompt

You are a code assistant. Help users with programming tasks.
Follow security best practices and coding standards.
```

### Pattern 4: Writing Assistant

```markdown
## Prompt

You are a writing assistant. Help users improve their writing.
Be constructive and specific in feedback.
```

### Pattern 5: Research Assistant

```markdown
## Prompt

You are a research assistant. Help users find and analyze information.
Always cite sources and acknowledge uncertainty.
```

### Pattern 6: Creative Assistant

```markdown
## Prompt

You are a creative assistant. Help users with creative tasks.
Be imaginative but appropriate.
```

### Pattern 7: Technical Support

```markdown
## Prompt

You are technical support. Help users resolve issues.
Be patient and provide step-by-step solutions.
```

### Pattern 8: Educational Assistant

```markdown
## Prompt

You are an educational assistant. Help users learn.
Adapt to their level and learning style.
```

### Pattern 9: Safety-Conscious

```markdown
## Prompt

You are a safety-conscious assistant. Always:
- Prioritize user safety
- Avoid harmful content
- Be transparent about limitations
```

### Pattern 10: Context-Aware

```markdown
## Prompt

You are a context-aware assistant. Consider:
- User's background
- Previous conversation
- Current situation
```

## Validation Rules

### Rule 1: Clear Instructions

Instructions must be clear and specific:

```python
def validate_clarity(prompt: str) -> bool:
    # Check for vague language
    vague = ['help', 'assist', 'do something']
    return not any(v in prompt.lower() for v in vague)
```

### Rule 2: Structured Format

Prompt should be well-structured:

```python
def validate_structure(prompt: str) -> bool:
    # Check for headers or numbered lists
    return '\n##' in prompt or '\n1.' in prompt
```

### Rule 3: Safety Guidelines

Prompt must include safety guidelines:

```python
def check_safety(prompt: str) -> bool:
    safety_terms = ['safety', 'harmful', 'privacy', 'accurate']
    return any(t in prompt.lower() for t in safety_terms)
```

### Rule 4: No Harmful Content

Prompt must not request harmful content:

```python
def check_harmful(prompt: str) -> bool:
    harmful = ['ignore safety', 'bypass restrictions', 'harmful']
    return not any(h in prompt.lower() for h in harmful)
```

### Rule 5: Clear Role Definition

Prompt should define the AI's role:

```python
def check_role(prompt: str) -> bool:
    role_terms = ['you are', 'your role', 'act as']
    return any(t in prompt.lower() for t in role_terms)
```

### Rule 6: Task Definition

Prompt should define the task:

```python
def check_task(prompt: str) -> bool:
    task_terms = ['when', 'if', 'task', 'goal']
    return any(t in prompt.lower() for t in task_terms)
```

### Rule 7: Output Format

Prompt should specify output format:

```python
def check_format(prompt: str) -> bool:
    format_terms = ['format', 'return', 'output', 'response']
    return any(t in prompt.lower() for t in format_terms)
```

### Rule 8: Examples Provided

Prompt should include examples:

```python
def check_examples(prompt: str) -> bool:
    return 'example' in prompt.lower() or '```' in prompt
```

## Related Sections

- **[Purpose](purpose.md)**: Module purpose
- **[Rules](rules.md)**: Behavioral constraints
- **[Examples](examples.md)**: Usage examples
- **[Tests](tests.md)**: Testing prompts
- **[Python](python.md)**: Python implementation
- **[JavaScript](javascript.md)**: JavaScript implementation

## FAQ

### Q: What's the difference between Prompt and Rules?

**A:** Prompt defines how the AI should behave. Rules define behavioral constraints for the module.

### Q: Should I include examples in prompts?

**A:** Yes, examples help the AI understand expected behavior.

### Q: How do I handle safety concerns?

**A:** Always include safety guidelines:

```markdown
## Prompt

Always:
- Be truthful and accurate
- Respect privacy
- Avoid harmful content
```

### Q: Can I use template variables?

**A:** Yes, use `{{variable}}` syntax:

```markdown
## Prompt

You are helping with {{module_name}}.
```

### Q: How do I structure complex prompts?

**A:** Use headers and bullet points:

```markdown
## Prompt

### Role
You are a...

### Task
When users...

### Constraints
- Be...
- Always...
```

### Q: Should I define output format?

**A:** Yes, specify expected output format:

```markdown
## Prompt

Return results in JSON format:
```json
{
  "status": "success",
  "data": {...
}
```
```

### Q: How do I handle edge cases?

**A:** Document how to handle edge cases:

```markdown
## Prompt

If you don't know:
1. Say "I'm not sure"
2. Provide what you do know
```

### Q: Can I use role-playing?

**A:** Yes, define the AI's role:

```markdown
## Prompt

You are a senior software engineer helping with code review.
```

### Q: How do I ensure factual accuracy?

**A:** Include instructions for accuracy:

```markdown
## Prompt

Always:
- Cite sources when possible
- Acknowledge uncertainty
- Verify facts before stating them
```

### Q: Should I include disclaimers?

**A:** Yes, especially for sensitive topics:

```markdown
## Prompt

Disclaimer: I'm an AI assistant, not a professional.
Always consult a qualified professional for important decisions.
```

### Q: How do I handle multiple languages?

**A:** Specify language requirements:

```markdown
## Prompt

Respond in the same language as the user's question.
```

### Q: Can I use prompts for testing?

**A:** Yes, create test prompts to validate AI behavior.

### Q: How do I handle context?

**A:** Provide context in the prompt:

```markdown
## Prompt

Context: Users are developers working on a Python project.
When they ask questions, provide Python-specific answers.
```

### Q: Should I limit response length?

**A:** Yes, specify length constraints:

```markdown
## Prompt

Keep responses concise - under 200 words unless more detail is requested.
```

### Q: How do I handle ambiguous questions?

**A:** Include instructions for clarification:

```markdown
## Prompt

If a question is ambiguous:
1. Ask for clarification
2. Provide possible interpretations
3. Answer based on most likely intent
```

### Q: Can I use prompts for content generation?

**A:** Yes, with appropriate safety guidelines:

```markdown
## Prompt

Generate content that is:
- Original and creative
- Appropriate for all audiences
- Respectful of copyright
```

### Q: How do I handle sensitive topics?

**A:** Add safety guidelines:

```markdown
## Prompt

For sensitive topics:
- Be factual and balanced
- Acknowledge different perspectives
- Avoid taking sides
- Provide resources for further information
```

### Q: Should I include contact information?

**A:** If appropriate, include how to get more help.

### Q: How do I test prompts?

**A:** Test with various inputs and edge cases.

### Q: Can I use prompts for automation?

**A:** Yes, but document the automation context.

### Q: How do I handle errors?

**A:** Include error handling instructions:

```markdown
## Prompt

If an error occurs:
1. Explain what went wrong
2. Suggest how to fix it
3. Provide alternatives
```

### Q: Should I update prompts?

**A:** Yes, update based on feedback and testing.

### Q: How do I document prompt changes?

**A:** Document in changelog and version notes.

## Implementation Notes

### Prompt Extraction

```python
def extract_prompt(content: str) -> str:
    prompt = []
    in_prompt = False
    
    for line in content.split('\n'):
        if line.strip().startswith('## Prompt'):
            in_prompt = True
            continue
        
        if in_prompt and line.startswith('##'):
            break
        
        if in_prompt:
            prompt.append(line)
    
    return '\n'.join(prompt).strip()
```

### Prompt Validation

```python
def validate_prompt(prompt: str) -> list[str]:
    errors = []
    
    # Check for safety guidelines
    if not check_safety(prompt):
        errors.append("Missing safety guidelines")
    
    # Check for harmful content
    if check_harmful(prompt):
        errors.append("Contains potentially harmful content")
    
    # Check for clear role
    if not check_role(prompt):
        errors.append("Missing role definition")
    
    return errors
```

### Prompt Documentation Generator

```python
def document_prompt(prompt: str) -> str:
    return f"## AI Instructions\n\n```\n{prompt}\n```"
```

### Prompt Template Engine

```python
def render_prompt(template: str, variables: dict) -> str:
    result = template
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(value))
    return result
```

## References

- [MAM Specification - Prompt](../SPEC.md#prompt)
- [Prompt Engineering](https://en.wikipedia.org/wiki/Prompt_engineering)
- [AI Safety Guidelines](https://en.wikipedia.org/wiki/AI_safety)
- [LLM Best Practices](https://platform.openai.com/docs/guides/)

---

**Section Version:** 1.0.0
**Last Updated:** 2026-07-24
**Status:** Stable