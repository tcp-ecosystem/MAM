/**
 * MAM Init Command
 * 
 * Initializes a new MAM module with a template.
 */

import { writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';

export interface InitOptions {
  name?: string;
  template?: 'basic' | 'full' | 'agent' | 'workflow' | 'team';
  runtime?: string;
  dir?: string;
}

const TEMPLATES: Record<string, (name: string, runtime: string) => string> = {
  basic: (name, runtime) => `---
id: ${name}
version: 1.0.0
name: ${name}
author: Author
runtime: ${runtime}
tags: []
---

# ${name}

## Purpose

Describe what this module does.

## Rules

- Rule 1
- Rule 2

## Examples

Example usage here.
`,

  full: (name, runtime) => `---
id: ${name}
version: 1.0.0
name: ${name}
author: Author
runtime: ${runtime}
tags: []
description: Full module example
permissions:
  - network
---

# ${name}

## Purpose

Describe what this module does.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input1 | string | Yes | First input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output1 | string | First output |

## Rules

- Rule 1
- Rule 2

## Workflow

\`\`\`mermaid
flowchart TD
    A[Start] --> B[End]
\`\`\`

## Python

\`\`\`python
def process(input1: str) -> dict:
    return {"output1": input1}
\`\`\`

## Examples

\`\`\`python
result = process("hello")
print(result)
\`\`\`

## Tests

\`\`\`python
def test_process():
    result = process("test")
    assert result["output1"] == "test"
\`\`\`
`,

  agent: (name, runtime) => `---
id: ${name}
version: 1.0.0
name: ${name}
author: Author
runtime: ${runtime}
tags:
  - agent
  - ai
description: Agent module
permissions:
  - network
  - exec
---

# ${name}

## Purpose

AI agent module for automated tasks.

## Prompt

You are an AI agent that handles the following task:
Describe the agent's role and capabilities.

## Rules

- Always validate inputs before processing
- Log all actions for audit
- Handle errors gracefully
- Never expose internal state

## Workflow

\`\`\`mermaid
flowchart TD
    A[Receive Task] --> B[Parse Intent]
    B --> C[Execute Action]
    C --> D[Return Result]
\`\`\`

## Python

\`\`\`python
# @mam:timeout=60s
# @mam:requires=network

def execute(task: str) -> dict:
    """Execute the agent task."""
    return {"status": "completed", "result": f"Processed: {task}"}
\`\`\`

## Memory

- agent_state: idle
- last_task: null

## Examples

\`\`\`python
result = execute("analyze data")
print(result)
\`\`\`
`,

  workflow: (name, runtime) => `---
id: ${name}
version: 1.0.0
name: ${name}
author: Author
runtime: ${runtime}
tags:
  - workflow
description: Workflow module
---

# ${name}

## Purpose

Process workflow definition.

## Workflow

\`\`\`mermaid
flowchart TD
    A[Step 1] --> B[Step 2]
    B --> C[Step 3]
\`\`\`

## Steps

- Step 1: Initialize
- Step 2: Process
- Step 3: Finalize

## Python

\`\`\`python
def execute_workflow():
    """Execute the workflow."""
    step1()
    step2()
    step3()
\`\`\`
`,

  team: (name, runtime) => `---
id: ${name}
version: 1.0.0
name: ${name}
author: Author
runtime: ${runtime}
tags:
  - team
  - multi-agent
description: Team module
---

# ${name}

## Purpose

Multi-agent team coordination.

## Members

- Agent 1
- Agent 2
- Agent 3

## Policy

SafeExecution

## Workflow

\`\`\`mermaid
flowchart TD
    A[Agent 1] --> B[Agent 2]
    B --> C[Agent 3]
\`\`\`
`,
};

export async function initCommand(options: InitOptions): Promise<void> {
  const spinner = ora('Initializing module...').start();

  try {
    const name = options.name || 'my-module';
    const template = options.template || 'basic';
    const runtime = options.runtime || 'python';
    const dir = options.dir || process.cwd();

    const targetDir = join(dir, name);
    const targetFile = join(targetDir, `${name}.mam.md`);

    try {
      await access(targetDir);
      console.log(chalk.yellow(`Directory "${name}" already exists`));
    } catch {
      await mkdir(targetDir, { recursive: true });
    }

    const templateFn = TEMPLATES[template];
    if (!templateFn) {
      spinner.fail(`Unknown template: ${template}`);
      return;
    }

    const content = templateFn(name, runtime);
    await writeFile(targetFile, content, 'utf-8');

    spinner.succeed(`Created module: ${targetFile}`);
    console.log(chalk.gray(`  Template: ${template}`));
    console.log(chalk.gray(`  Runtime: ${runtime}`));
  } catch (error) {
    spinner.fail((error as Error).message);
    process.exit(1);
  }
}