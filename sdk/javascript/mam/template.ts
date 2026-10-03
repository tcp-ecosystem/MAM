const STARTER_TEMPLATES: Record<string, string> = {
  module: [
    '---',
    'title: {{name}}',
    'version: 2.0.0',
    'author: {{author}}',
    '---',
    '',
    '## Purpose',
    '',
    '{{description}}',
    '',
    '## Inputs',
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    '| input | string | true | Primary input |',
    '',
    '## Outputs',
    '',
    '| Name | Type | Description |',
    '|------|------|-------------|',
    '| output | string | Primary output |',
    '',
    '## Rules',
    '',
    '- Be precise and predictable.',
    '- Validate all inputs before processing.',
    '- Document every public interface.',
    '',
    '## Examples',
    '',
    '```text',
    '{{name}} processes input into output.',
    '```',
    '',
    '## Tests',
    '',
    '- purpose section exists',
    '- inputs table has one row',
    '',
    '## References',
    '',
    '- https://mam.dev/specs/module',
    '',
  ].join('\n'),
  agent: [
    '---',
    'title: {{name}}',
    'version: 2.0.0',
    'author: {{author}}',
    '---',
    '',
    '## Purpose',
    '',
    '{{description}}',
    '',
    '## Rules',
    '',
    '- role: helpful assistant',
    '- goal: resolve the user query completely',
    '- escalate when confidence is low',
    '',
    '## Inputs',
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    '| query | string | true | User request |',
    '| context | string | false | Conversation context |',
    '',
    '## Outputs',
    '',
    '| Name | Type | Description |',
    '|------|------|-------------|',
    '| answer | string | Agent response |',
    '| confidence | number | Confidence between 0 and 1 |',
    '',
    '## Prompt',
    '',
    'You are {{name}}, a helpful assistant.',
    '',
    'Answer concisely and cite sources when available.',
    '',
    '## Memory',
    '',
    'No persistent memory configured.',
    '',
    '## Examples',
    '',
    '```text',
    'User: hello',
    '{{name}}: Hello! How can I help?',
    '```',
    '',
  ].join('\n'),
  tool: [
    '---',
    'title: {{name}}',
    'version: 2.0.0',
    'author: {{author}}',
    '---',
    '',
    '## Purpose',
    '',
    '{{description}}',
    '',
    '## Inputs',
    '',
    '| Name | Type | Required | Description |',
    '|------|------|----------|-------------|',
    '| payload | string | true | Tool input payload |',
    '| verbose | boolean | false | Enable verbose output |',
    '',
    '## Outputs',
    '',
    '| Name | Type | Description |',
    '|------|------|-------------|',
    '| result | string | Tool execution result |',
    '| exit_code | number | Process exit code |',
    '',
    '## Capabilities',
    '',
    '- execute',
    '',
    '## Rules',
    '',
    '- exit zero on success and non-zero on failure',
    '- never print secrets to stdout',
    '',
    '## Examples',
    '',
    '```text',
    '{{name}} --help',
    '{{name}} run --payload hello',
    '```',
    '',
    '## Tests',
    '',
    '- tool exits zero on valid payload',
    '- invalid payload reports an error',
    '',
    '## References',
    '',
    '- https://mam.dev/specs/tool',
    '',
  ].join('\n'),
};

const STARTER_KIND_ALIASES: Record<string, string> = {
  mod: 'module',
  bot: 'agent',
  assistant: 'agent',
  utility: 'tool',
  cli: 'tool',
};

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g;

export const STARTER_KINDS: readonly string[] = ['agent', 'module', 'tool'];

export function listStarterKinds(): string[] {
  return [...STARTER_KINDS];
}

export function getStarterTemplate(kind: string): string {
  const canonical = canonicalStarterKind(kind);
  const template = STARTER_TEMPLATES[canonical];
  if (template === undefined) {
    throw new Error(`Unknown starter kind ${JSON.stringify(kind)} (want one of ${listStarterKinds().join(', ')})`);
  }
  return template;
}

export function renderStarter(template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER_PATTERN, (match: string, rawName: string) => {
    const name = rawName.trim();
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      return vars[name] as string;
    }
    const lowered = name.toLowerCase();
    for (const key of Object.keys(vars)) {
      if (key.trim().toLowerCase() === lowered) {
        return vars[key] as string;
      }
    }
    return match;
  });
}

export function starterVariables(template: string): string[] {
  const vars: string[] = [];
  const seen = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] as string;
    if (!seen.has(name)) {
      seen.add(name);
      vars.push(name);
    }
  }
  return vars;
}

export function newModuleStarter(name: string, kind: string, vars: Record<string, string> = {}): string {
  const problems = validateStarterName(name);
  if (problems.length > 0) {
    throw new Error(`Invalid starter name: ${problems.join('; ')}`);
  }
  const canonical = canonicalStarterKind(kind);
  const template = STARTER_TEMPLATES[canonical] as string;
  const merged = mergeStarterVars(defaultStarterVars(name), vars);
  const missing = unrenderedStarterVariables(template, merged);
  if (missing.length > 0) {
    throw new Error(`Cannot render: missing template variables ${missing.join(', ')}`);
  }
  const rendered = renderStarter(template, merged);
  if (templateSectionCount(template) === 0) {
    throw new Error(`Starter ${JSON.stringify(canonical)} produced no sections`);
  }
  return rendered;
}

export function validateStarterName(name: string): string[] {
  const problems: string[] = [];
  const trimmed = name.trim();
  if (trimmed === '') {
    problems.push('name must not be empty');
  }
  if (name.length > 64) {
    problems.push('name must be 64 characters or fewer');
  }
  if (/[^a-zA-Z0-9 _-]/.test(name)) {
    problems.push('name contains invalid characters (want letters, digits, space, _ or -)');
  }
  if (trimmed !== '' && trimmed.replace(/[-_]/g, '') === '') {
    problems.push('name must contain at least one letter or digit');
  }
  return problems;
}

function canonicalStarterKind(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(STARTER_TEMPLATES, normalized)) {
    return normalized;
  }
  const aliased = STARTER_KIND_ALIASES[normalized];
  if (aliased !== undefined) {
    return aliased;
  }
  const suggestion = suggestStarterKind(normalized);
  const hint = suggestion === '' ? '' : ` (did you mean ${JSON.stringify(suggestion)}?)`;
  throw new Error(`Unknown starter kind ${JSON.stringify(kind)}${hint} (want one of ${listStarterKinds().join(', ')})`);
}

function suggestStarterKind(input: string): string {
  if (input === '') {
    return '';
  }
  for (const kind of listStarterKinds()) {
    if (kind.startsWith(input)) {
      return kind;
    }
  }
  for (const alias of Object.keys(STARTER_KIND_ALIASES)) {
    if (alias.startsWith(input)) {
      return STARTER_KIND_ALIASES[alias] as string;
    }
  }
  return '';
}

function defaultStarterVars(name: string): Record<string, string> {
  const trimmed = name.trim() === '' ? 'Untitled Module' : name.trim();
  return {
    name: trimmed,
    description: `Describe ${trimmed}.`,
    author: defaultStarterAuthor(),
    year: currentYear(),
  };
}

function defaultStarterAuthor(): string {
  const user = process.env.USER?.trim() ?? '';
  if (user !== '') {
    return user;
  }
  return (process.env.USERNAME ?? '').trim();
}

function currentYear(): string {
  return String(new Date().getFullYear());
}

function unrenderedStarterVariables(template: string, vars: Record<string, string>): string[] {
  const lowered = new Set(Object.keys(vars).map((key) => key.trim().toLowerCase()));
  return starterVariables(template).filter((name) => !lowered.has(name.toLowerCase()));
}

function mergeStarterVars(base: Record<string, string>, extra: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    merged[key.trim()] = value;
  }
  return merged;
}

function templateSectionCount(template: string): number {
  let count = 0;
  for (const line of template.split('\n')) {
    if (/^#{1,6}\s+/.test(line)) {
      count++;
    }
  }
  return count;
}
