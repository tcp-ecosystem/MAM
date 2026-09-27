/**
 * MAM Hover Provider
 *
 * Rich hover content for section names, module types, YAML keys,
 * code block languages, and markdown syntax elements.
 */

import { Hover, MarkupKind } from 'vscode-languageserver-protocol';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { MAMModule } from '@mam/parser';
import {
  SECTION_DOCS,
  V2_SECTION_DOCS,
  MODULE_TYPE_DOCS,
  VALID_RUNTIMES,
  MEMORY_FORMATS,
  MEMORY_BACKENDS,
  SCOPE_TYPES,
  PERMISSION_VALUES,
  V1_SECTIONS,
  V2_SECTIONS,
  V2_MODULE_TYPES,
  LANGUAGES,
  createHoverContent,
} from '../protocol/mam';

/**
 * Get hover content for the symbol at the given position.
 */
export function getHover(
  uri: string,
  position: { line: number; character: number },
  document: TextDocument,
  ast: MAMModule | null,
): Hover | null {
  const text = document.getText();
  const lines = text.split('\n');
  const line = lines[position.line];
  if (!line) return null;

  // 1. V1 section heading hover
  const sectionHover = getSectionHover(line);
  if (sectionHover) return sectionHover;

  // 2. V2 module type hover
  const moduleHover = getModuleTypeHover(line);
  if (moduleHover) return moduleHover;

  // 3. V2 section keyword hover
  const keywordHover = getSectionKeywordHover(line);
  if (keywordHover) return keywordHover;

  // 4. YAML key hover
  const yamlHover = getYAMLKeyHover(line);
  if (yamlHover) return yamlHover;

  // 5. Code block language hover
  const langHover = getCodeBlockLanguageHover(line);
  if (langHover) return langHover;

  // 6. Permission value hover
  const permHover = getPermissionValueHover(line);
  if (permHover) return permHover;

  // 7. Frontmatter field hover
  const fmHover = getFrontmatterFieldHover(line, text, position.line);
  if (fmHover) return fmHover;

  return null;
}

// ============================================================================
// Section Hover
// ============================================================================

function getSectionHover(line: string): Hover | null {
  const match = line.match(/^##\s+(.+)/);
  if (!match) return null;

  const name = match[1]!.trim();
  const doc = SECTION_DOCS[name];
  if (!doc) return null;

  const lines: string[] = [
    `**${name}** — MAM Section`,
    '',
    doc,
    '',
    '---',
    '',
    `*Status: ${name === 'Purpose' ? '**Required**' : 'Optional'}*`,
  ];

  // Add known content types for this section
  const contentTypes = getSupportedContentTypes(name);
  if (contentTypes.length > 0) {
    lines.push('', '**Supported content:** ' + contentTypes.join(', '));
  }

  return createHoverContent(lines.join('\n'));
}

function getSupportedContentTypes(sectionName: string): string[] {
  const typeMap: Record<string, string[]> = {
    Purpose: ['paragraph'],
    Inputs: ['table'],
    Outputs: ['table'],
    Rules: ['list'],
    Workflow: ['mermaid'],
    Mermaid: ['mermaid'],
    Python: ['codeblock (python)'],
    JavaScript: ['codeblock (javascript)'],
    TypeScript: ['codeblock (typescript)'],
    Prompt: ['paragraph'],
    Memory: ['paragraph'],
    Examples: ['codeblock', 'paragraph'],
    Tests: ['codeblock', 'list'],
    References: ['paragraph', 'list'],
    Dependencies: ['list'],
    Exports: ['list', 'codeblock'],
    Imports: ['list'],
    Plugins: ['list'],
    Permissions: ['list', 'table'],
    Capabilities: ['list'],
  };

  return typeMap[sectionName] || [];
}

// ============================================================================
// Module Type Hover
// ============================================================================

function getModuleTypeHover(line: string): Hover | null {
  const match = line.match(/^(module|agent|tool|memory|workflow|team|policy|system|service|component|resource|interface|contract|plugin|extension|runtime|package|repository|documentation)\s+(.+)/);
  if (!match) return null;

  const type = match[1]!;
  const name = match[2]!.trim();
  const typeDoc = MODULE_TYPE_DOCS[type] || 'Module type';

  const lines: string[] = [
    `**${type}**: \`${name}\``,
    '',
    typeDoc,
    '',
    '---',
    '',
    '**Required sections:**',
  ];

  const requiredSections = getRequiredSectionsForType(type);
  if (requiredSections.length > 0) {
    for (const section of requiredSections) {
      lines.push(`- \`${section}\``);
    }
  } else {
    lines.push('*None — this type uses optional sections only*');
  }

  lines.push('', '**Common sections:**');
  const commonSections = getCommonSectionsForType(type);
  for (const section of commonSections) {
    lines.push(`- \`${section}\``);
  }

  return createHoverContent(lines.join('\n'));
}

function getRequiredSectionsForType(type: string): string[] {
  const required: Record<string, string[]> = {
    module: ['Purpose'],
    agent: ['Purpose', 'Inputs', 'Outputs'],
    tool: ['Purpose', 'Inputs', 'Outputs'],
    memory: ['Purpose', 'format', 'backend'],
    workflow: ['Purpose', 'steps'],
    team: ['Purpose', 'members'],
    policy: ['Purpose', 'allow'],
    system: ['Purpose', 'members', 'edges'],
  };
  return required[type] || ['Purpose'];
}

function getCommonSectionsForType(type: string): string[] {
  const common: Record<string, string[]> = {
    module: ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Examples'],
    agent: ['Purpose', 'Inputs', 'Outputs', 'Rules', 'tools', 'memory', 'Prompt'],
    tool: ['Purpose', 'Inputs', 'Outputs', 'Rules', 'Examples'],
    memory: ['Purpose', 'format', 'backend', 'scope', 'ttl'],
    workflow: ['Purpose', 'steps', 'edges', 'inputs', 'outputs'],
    team: ['Purpose', 'members', 'handoff', 'edges'],
    policy: ['Purpose', 'allow', 'deny', 'permissions'],
    system: ['Purpose', 'members', 'edges', 'permissions'],
  };
  return common[type] || ['Purpose'];
}

// ============================================================================
// Section Keyword Hover
// ============================================================================

function getSectionKeywordHover(line: string): Hover | null {
  const match = line.match(/^(\w+)\s*:/);
  if (!match) return null;

  const key = match[1]!.toLowerCase();
  const doc = V2_SECTION_DOCS[key];
  if (!doc) return null;

  const lines: string[] = [
    `**${key}**`,
    '',
    doc,
    '',
    '---',
    '',
  ];

  // Add value type hints
  const hints = getValueHintsForKey(key);
  if (hints) {
    lines.push(hints);
  }

  return createHoverContent(lines.join('\n'));
}

function getValueHintsForKey(key: string): string | null {
  const hints: Record<string, string> = {
    type: '**Accepted values:** ' + V2_MODULE_TYPES.join(', '),
    format: '**Accepted values:** ' + MEMORY_FORMATS.join(', '),
    backend: '**Accepted values:** ' + MEMORY_BACKENDS.join(', '),
    scope: '**Accepted values:** ' + SCOPE_TYPES.join(', '),
    ttl: '**Format:** Duration string, e.g., `24h`, `7d`, `30m`',
    inputs: '**Format:** `name: type` pairs, one per line',
    outputs: '**Format:** `name: type` pairs, one per line',
    handoff: '**Format:** List of target agent names',
    members: '**Format:** List of agent module names',
    steps: '**Format:** Ordered list of step descriptions',
    edges: '**Format:** `source -> target` arrow notation',
    allow: '**Format:** List of allowed action patterns',
    deny: '**Format:** List of denied action patterns',
  };
  return hints[key] || null;
}

// ============================================================================
// YAML Key Hover
// ============================================================================

function getYAMLKeyHover(line: string): Hover | null {
  const match = line.match(/^\s*(\w[\w-]*)\s*:/);
  if (!match) return null;

  const key = match[1]!;
  const yamlDocs: Record<string, string> = {
    id: '**Module identifier.** Must be lowercase alphanumeric with hyphens. Pattern: `^[a-z][a-z0-9-]{0,63}$`',
    version: '**Semantic version.** Format: `MAJOR.MINOR.PATCH[-prerelease][+build]`',
    name: '**Human-readable module name.** Displayed in tooling and documentation.',
    author: '**Module author.** Name or organization that created this module.',
    runtime: '**Runtime language.** ' + VALID_RUNTIMES.join(', '),
    tags: '**Search tags.** Array of keywords for module discovery.',
    description: '**Module description.** Brief summary of the module\'s purpose.',
    dependencies: '**Module dependencies.** List of required module identifiers.',
    permissions: '**Security permissions.** Declares required system capabilities.',
    license: '**License identifier.** SPDX license expression.',
    repository: '**Source repository URL.** Link to version control.',
    mam_version: '**MAM specification version.** Minimum MAM version required.',
  };

  const doc = yamlDocs[key];
  if (!doc) return null;

  const lines: string[] = [
    `**${key}** — YAML Front Matter`,
    '',
    doc,
  ];

  // Add type info
  const typeInfo = getYAMLKeyType(key);
  if (typeInfo) {
    lines.push('', '**Type:** ' + typeInfo);
  }

  // Add example
  const example = getYAMLKeyExample(key);
  if (example) {
    lines.push('', '**Example:**');
    lines.push('```yaml', example, '```');
  }

  return createHoverContent(lines.join('\n'));
}

function getYAMLKeyType(key: string): string | null {
  const types: Record<string, string> = {
    id: '`string` (required)',
    version: '`string` (required, semver)',
    name: '`string` (required)',
    author: '`string` (required)',
    runtime: '`string` (required, enum)',
    tags: '`string[]`',
    description: '`string`',
    dependencies: '`string[]`',
    permissions: '`string[]`',
    license: '`string`',
    repository: '`string` (URL)',
    mam_version: '`string`',
  };
  return types[key] || null;
}

function getYAMLKeyExample(key: string): string | null {
  const examples: Record<string, string> = {
    id: 'id: my-module',
    version: 'version: 2.0.0',
    name: 'name: My Module',
    author: 'author: John Doe',
    runtime: 'runtime: python',
    tags: 'tags:\n  - utility\n  - helper',
    description: 'description: A utility module for common tasks.',
    dependencies: 'dependencies:\n  - utils@1.0.0\n  - logger@2.1.0',
    permissions: 'permissions:\n  - network\n  - filesystem',
    license: 'license: MIT',
    repository: 'repository: https://github.com/user/repo',
    mam_version: 'mam_version: 2.0.0',
  };
  return examples[key] || null;
}

// ============================================================================
// Code Block Language Hover
// ============================================================================

function getCodeBlockLanguageHover(line: string): Hover | null {
  const match = line.match(/^```(\w*)/);
  if (!match) return null;

  const lang = match[1];
  if (!lang) return null;

  const langInfo: Record<string, { name: string; description: string; features: string[] }> = {
    python: {
      name: 'Python',
      description: 'Python code block for execution within MAM modules.',
      features: ['Supports `@mam:` metadata comments', 'Sandboxed execution by default'],
    },
    javascript: {
      name: 'JavaScript',
      description: 'JavaScript code block for execution within MAM modules.',
      features: ['Supports `@mam:` metadata comments', 'Node.js runtime'],
    },
    js: {
      name: 'JavaScript (alias)',
      description: 'Alias for JavaScript code blocks.',
      features: ['Same as JavaScript'],
    },
    typescript: {
      name: 'TypeScript',
      description: 'TypeScript code block for execution within MAM modules.',
      features: ['Type annotations', 'Compiled to JavaScript'],
    },
    ts: {
      name: 'TypeScript (alias)',
      description: 'Alias for TypeScript code blocks.',
      features: ['Same as TypeScript'],
    },
    rust: {
      name: 'Rust',
      description: 'Rust code block for high-performance execution.',
      features: ['Compiled to WASM', 'Memory safe'],
    },
    go: {
      name: 'Go',
      description: 'Go code block for concurrent execution.',
      features: ['Goroutines', 'Fast compilation'],
    },
    shell: {
      name: 'Shell',
      description: 'Shell script for system commands.',
      features: ['Bash-compatible', 'System access'],
    },
    bash: {
      name: 'Bash',
      description: 'Bash shell script.',
      features: ['Full bash features', 'Scripting'],
    },
    yaml: {
      name: 'YAML',
      description: 'YAML configuration block.',
      features: ['Data serialization', 'Configuration'],
    },
    json: {
      name: 'JSON',
      description: 'JSON data block.',
      features: ['Structured data', 'API responses'],
    },
    mermaid: {
      name: 'Mermaid',
      description: 'Mermaid diagram definition.',
      features: ['Flowcharts', 'Sequence diagrams', 'Gantt charts'],
    },
  };

  const info = langInfo[lang.toLowerCase()];
  if (!info) return null;

  const lines: string[] = [
    `**${info.name}** — Code Block Language`,
    '',
    info.description,
    '',
    '---',
    '',
    '**Features:**',
    ...info.features.map(f => `- ${f}`),
  ];

  return createHoverContent(lines.join('\n'));
}

// ============================================================================
// Permission Value Hover
// ============================================================================

function getPermissionValueHover(line: string): Hover | null {
  const trimmed = line.trim().toLowerCase();

  for (const [key, values] of Object.entries(PERMISSION_VALUES)) {
    if (trimmed.startsWith(`${key}:`)) {
      const value = trimmed.replace(`${key}:`, '').trim();
      if (values.includes(value)) {
        const descriptions: Record<string, Record<string, string>> = {
          filesystem: {
            read: 'Read access to local filesystem',
            write: 'Write access to local filesystem',
            none: 'No filesystem access',
          },
          network: {
            internet: 'Full internet access',
            internal: 'Internal network only',
            none: 'No network access',
          },
          python: {
            sandbox: 'Sandboxed Python execution (restricted)',
            full: 'Full Python execution (unrestricted)',
            none: 'No Python execution',
          },
          memory: {
            local: 'Module-local memory only',
            shared: 'Shared memory across modules',
            none: 'No memory access',
          },
          exec: {
            allowed: 'System command execution allowed',
            denied: 'System command execution denied',
          },
        };

        const desc = descriptions[key]?.[value];
        if (desc) {
          return createHoverContent(`**${key}.${value}**\n\n${desc}`);
        }
      }
    }
  }

  return null;
}

// ============================================================================
// Frontmatter Field Hover
// ============================================================================

function getFrontmatterFieldHover(
  line: string,
  text: string,
  currentLine: number,
): Hover | null {
  const match = line.match(/^\s*(\w[\w-]*)\s*:/);
  if (!match) return null;

  const key = match[1]!;

  // Check if we're inside front-matter
  const lines = text.split('\n');
  let inFrontMatter = false;
  let separatorCount = 0;

  for (let i = 0; i <= currentLine; i++) {
    if (lines[i]!.trim() === '---') {
      separatorCount++;
      if (separatorCount === 1) inFrontMatter = true;
      if (separatorCount === 2) inFrontMatter = false;
    }
  }

  if (!inFrontMatter && separatorCount >= 2) return null;

  // Reuse YAML key hover
  return getYAMLKeyHover(line);
}

export function getContentTypesForSection(sectionName: string): string[] {
  return getSupportedContentTypes(sectionName);
}

export function getRequiredSections(type: string): string[] {
  return getRequiredSectionsForType(type);
}

export function getCommonSections(type: string): string[] {
  return getCommonSectionsForType(type);
}

export function getValueHint(key: string): string | null {
  return getValueHintsForKey(key);
}

export function getYAMLKeyTypeInfo(key: string): string | null {
  return getYAMLKeyType(key);
}

export function getYAMLKeyExampleText(key: string): string | null {
  return getYAMLKeyExample(key);
}

export function hasSectionDoc(name: string): boolean {
  return SECTION_DOCS[name] !== undefined;
}
