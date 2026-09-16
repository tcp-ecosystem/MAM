import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface InitOptions {
  name: string;
  template?: 'basic' | 'advanced' | 'workflow';
  dir?: string;
}

const TEMPLATES = {
  basic: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 0.1.0
type: module
author: Your Name
license: MIT
tags: [mam, module]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

A new MAM module.

## Purpose

Describe what this module does.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input | string | Yes | Input description |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output | string | Output description |

## Rules

- Rule 1
- Rule 2

## Workflow

- Step 1: Validate input
- Step 2: Process data
- Step 3: Return result

## Tests

Test the module with sample inputs.

## Examples

\`\`\`python
from ${name.replace(/-/g, '_')} import main
result = main(input="test")
print(result)
\`\`\`
`,

  advanced: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 0.1.0
type: module
author: Your Name
license: MIT
tags: [mam, module, advanced]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

An advanced MAM module with multiple capabilities.

## Purpose

Advanced module with parallel processing and branching.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| data | array | Yes | Input data array |
| options | object | No | Configuration options |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| results | array | Processed results |
| metadata | object | Processing metadata |

## Capabilities

- Parallel processing
- Error handling
- Caching

## Rules

- Handle errors gracefully
- Log all operations
- Validate input before processing

## Workflow

- Step 1: Validate and parse input
- Step 2: Check cache for existing results
- Step 3: Process data in parallel
- Step 4: Merge results
- Step 5: Update cache
- Step 6: Return results with metadata

## Permissions

- Network: outbound HTTP requests
- Filesystem: read/write cache directory

## Tests

Test parallel processing with large datasets.

## Examples

\`\`\`python
from ${name.replace(/-/g, '_')} import process
results = process(data=[1, 2, 3], options={"parallel": True})
\`\`\`
`,

  workflow: (name: string) => `---
id: ${name}
name: ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
version: 0.1.0
type: workflow
author: Your Name
license: MIT
tags: [mam, workflow, pipeline]
runtime: "python >=3.12"
---

# ${name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}

A multi-step workflow with branching.

## Purpose

Orchestrate complex multi-step processes.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| source | string | Yes | Data source |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| status | string | Workflow status |
| artifacts | array | Generated artifacts |

## Workflow

- Step 1: Fetch data from source
- Step 2: Validate data format
- Step 3: Transform data
- Step 4: Branch: if large dataset, use parallel processing
- Step 5: Generate output artifacts
- Step 6: Cleanup temporary files
- Step 7: Return status and artifacts

## Rules

- Never skip validation steps
- Log all state transitions
- Rollback on failure

## Tests

Test workflow with various data sources and sizes.
`
};

export async function initModule(options: InitOptions): Promise<{ success: boolean; file: string; error?: string }> {
  const { name, template = 'basic', dir = '.' } = options;
  
  if (!name || !name.match(/^[a-zA-Z0-9-_]+$/)) {
    return { success: false, file: '', error: 'Invalid module name. Use only letters, numbers, hyphens, and underscores.' };
  }
  
  const outDir = resolve(dir);
  if (!existsSync(outDir)) {
    await mkdir(outDir, { recursive: true });
  }
  
  const outFile = join(outDir, `${name}.mam`);
  if (existsSync(outFile)) {
    return { success: false, file: outFile, error: `File already exists: ${outFile}` };
  }
  
  const content = TEMPLATES[template](name);
  await writeFile(outFile, content, 'utf-8');
  
  return { success: true, file: outFile };
}
