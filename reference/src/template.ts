export const SUPPORTED_TEMPLATE_KINDS = ['module', 'agent', 'tool'] as const;

type StarterTemplateKind = (typeof SUPPORTED_TEMPLATE_KINDS)[number];

export function isTemplateKind(kind: string): kind is StarterTemplateKind {
  return (SUPPORTED_TEMPLATE_KINDS as readonly string[]).includes(kind);
}

export function getStarterTemplate(kind: StarterTemplateKind): string {
  if (kind === 'agent') return AGENT_TEMPLATE;
  if (kind === 'tool') return TOOL_TEMPLATE;
  return MODULE_TEMPLATE;
}

export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([\w-]+)\s*\}\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name]!;
    }
    return match;
  });
}

export function listTemplateVariables(template: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  const pattern = /\{\{\s*([\w-]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(template)) !== null) {
    if (!seen.has(match[1]!)) {
      seen.add(match[1]!);
      vars.push(match[1]!);
    }
  }
  return vars;
}

export function createModuleStarter(name: string, kind: StarterTemplateKind = 'module'): string {
  const template = getStarterTemplate(kind);
  const slug = slugifyTemplateName(name);
  return renderTemplate(template, {
    name,
    slug,
    date: new Date().toISOString().slice(0, 10),
  });
}

export function getTemplateDescription(kind: StarterTemplateKind): string {
  if (kind === 'agent') return 'AI agent module with role, goal, tools, and memory sections';
  if (kind === 'tool') return 'Executable tool module with provider and capability sections';
  return 'Generic module with purpose, inputs, outputs, and rules sections';
}

const MODULE_TEMPLATE = `---
id: {{slug}}
version: 2.0.0
name: {{name}}
author: ""
runtime: python
---

## Purpose

Describe what {{name}} does and why it exists.

Created on {{date}}.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| input | string | true | Primary input |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| output | string | Primary output |

## Rules

- Be precise and predictable.
- Validate all inputs before processing.
`;

const AGENT_TEMPLATE = `---
id: {{slug}}
version: 2.0.0
name: {{name}}
author: ""
runtime: python
---

## Purpose

Describe the mission of the {{name}} agent.

Created on {{date}}.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string | true | User request |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| answer | string | Agent response |

## Rules

- role: helpful assistant
- goal: resolve the user query completely

## Prompt

You are {{name}}, a helpful assistant created on {{date}}.
`;

const TOOL_TEMPLATE = `---
id: {{slug}}
version: 2.0.0
name: {{name}}
author: ""
runtime: python
---

## Purpose

Describe what the {{name}} tool executes.

Created on {{date}}.

## Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| payload | string | true | Tool input payload |

## Outputs

| Name | Type | Description |
|------|------|-------------|
| result | string | Tool execution result |

## Capabilities

- execute

## Examples

\`\`\`python
result = {{slug}}_run(payload="hello")
print(result)
\`\`\`
`;

function slugifyTemplateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'module';
}

function countTemplateVariables(template: string): number {
  return listTemplateVariables(template).length;
}

function hasTemplateVariable(template: string, name: string): boolean {
  return listTemplateVariables(template).includes(name);
}

function getUnrenderedVariables(template: string, vars: Record<string, string>): string[] {
  return listTemplateVariables(template).filter((name) => !(name in vars));
}

function validateTemplateVars(template: string, vars: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const name of getUnrenderedVariables(template, vars)) {
    errors.push(`missing template variable "${name}"`);
  }
  return errors;
}

function renderStrictTemplate(template: string, vars: Record<string, string>): string {
  const errors = validateTemplateVars(template, vars);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }
  return renderTemplate(template, vars);
}

function getTemplateLineCount(kind: StarterTemplateKind): number {
  return getStarterTemplate(kind).split('\n').length;
}

function getKindDisplayName(kind: StarterTemplateKind): string {
  if (kind === 'agent') return 'Agent';
  if (kind === 'tool') return 'Tool';
  return 'Module';
}

function normalizeTemplateKind(kind: string): StarterTemplateKind {
  const lower = kind.trim().toLowerCase();
  if (isTemplateKind(lower)) return lower;
  return 'module';
}

function mergeTemplateVars(
  base: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  return { ...base, ...extra };
}

function prefixTemplateVars(vars: Record<string, string>, prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    result[`${prefix}${key}`] = value;
  }
  return result;
}

function getTemplateSectionNames(kind: StarterTemplateKind): string[] {
  const template = getStarterTemplate(kind);
  const names: string[] = [];
  for (const line of template.split('\n')) {
    const match = line.match(/^##\s+(.+)/);
    if (match) {
      names.push(match[1]!.trim());
    }
  }
  return names;
}

function countTemplateSections(kind: StarterTemplateKind): number {
  return getTemplateSectionNames(kind).length;
}

function validateStarterName(name: string): string[] {
  const errors: string[] = [];
  if (!name || name.trim().length === 0) {
    errors.push('starter name must not be empty');
  }
  if (name.length > 64) {
    errors.push('starter name must be 64 characters or fewer');
  }
  if (/[^a-zA-Z0-9 _-]/.test(name)) {
    errors.push('starter name contains invalid characters');
  }
  return errors;
}

function renderWithDefaults(
  kind: StarterTemplateKind,
  vars: Record<string, string>,
  defaults: Record<string, string> = {},
): string {
  return renderTemplate(getStarterTemplate(kind), { ...defaults, ...vars });
}

function mergeStarterVars(
  base: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  return { ...base, ...extra };
}

function getDefaultStarterVars(name: string): Record<string, string> {
  return {
    name,
    slug: slugifyTemplateName(name),
    date: new Date().toISOString().slice(0, 10),
  };
}

function createStarterWithDefaults(name: string, kind: StarterTemplateKind): string {
  return renderTemplate(getStarterTemplate(kind), getDefaultStarterVars(name));
}

function getStarterFileName(name: string): string {
  return `${slugifyTemplateName(name)}.mam.md`;
}

function getStarterBody(kind: StarterTemplateKind): string {
  const template = getStarterTemplate(kind);
  const lines = template.split('\n');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return template;
  return lines.slice(end + 1).join('\n');
}

function getStarterFrontmatter(kind: StarterTemplateKind): string {
  const template = getStarterTemplate(kind);
  const lines = template.split('\n');
  if (lines[0]!.trim() !== '---') return '';
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) return '';
  return lines.slice(0, end + 1).join('\n');
}
